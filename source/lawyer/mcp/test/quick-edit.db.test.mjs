// Pinned-revision quick edits (paragraph-revision.md section 8): a mockup render records the
// paragraph map of its revision; drafting_forms__preview_edit resolves the practitioner's printed numbers
// through it, trial-runs the edit on a disposable copy and returns a code-generated diff; and
// drafting_forms__apply_edit writes it only while every touched row is as the preview found it, then
// appends its audit to the filing's quick-edits log. paragraph_revisions is never written.

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { seededDbFixture, seedBcscDefaultJudgment, ASHBOURNE } from "./fixtures/forms-render-seeds.mjs";
const { freshSubmissionDb } = await import("./helpers/template-db.mjs");
const { submissionDataExecute, submissionDataQuery } = await import("../build/submission/backend.js");
const { submissionFormsRender } = await import("../build/submission/forms.js");
const { submissionFormsApplyEdit, submissionFormsPreviewEdit } = await import("../build/submission/forms/quick-edit.js");
const { paragraphMapDir, recordsDir } = await import("../build/submission/render-manifest.js");

const SESSION = "sess-a1";
const FACTS = ["The lease began on 1 March 2024.", "The tenant paid no rent after June 2024.", "The landlord served a notice to end the tenancy."];
const SUBMISSIONS = ["The tenancy ended on the notice.", "The arrears are owing."];

const rows = (dbPath, sql, params = []) => submissionDataQuery(dbPath, sql, params).rows;
const logPath = (dbPath) => join(recordsDir(dbPath), "quick-edits-1.jsonl");
const logLines = (dbPath) => (existsSync(logPath(dbPath)) ? readFileSync(logPath(dbPath), "utf-8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);

/** A drafting Notice of Application: three facts in Part 2, two submissions in Part 3, rendered once. */
async function matter(t) {
  const f = seededDbFixture();
  t.after(f.cleanup);
  await freshSubmissionDb(f.dbPath);
  await seedBcscDefaultJudgment(f.dbPath);
  const quote = (s) => `'${s.replace(/'/g, "''")}'`;
  await submissionDataExecute(
    f.dbPath,
    `UPDATE filings SET kind = 'notice_of_application', subkind = NULL, title = 'Notice of Application' WHERE id = 1;
     INSERT INTO facts (id, proceeding_id, postulate) VALUES ${FACTS.map((p, i) => `(${i + 1}, 1, ${quote(p)})`).join(", ")};
     INSERT INTO filing_facts (filing_id, fact_id, document, part, ordinal) VALUES (1, 1, 'form', 'part2', 1), (1, 2, 'form', 'part2', 2), (1, 3, 'form', 'part2', 3);
     INSERT INTO submissions (id, proceeding_id, contention, ordinal) VALUES ${SUBMISSIONS.map((c, i) => `(${i + 1}, 1, ${quote(c)}, ${i + 1})`).join(", ")};
     INSERT INTO filing_submissions (filing_id, submission_id, document, ordinal) VALUES (1, 1, 'form', 1), (1, 2, 'form', 2);`
  );
  const rendered = submissionFormsRender(f.dbPath, 1, ASHBOURNE);
  return { dbPath: f.dbPath, revision: rendered.revision };
}

const target = (part, n) => ({ document: "form", part, printed_number: n });

test("a mockup render records the paragraph map of its revision", async (t) => {
  const { dbPath, revision } = await matter(t);
  const file = join(paragraphMapDir(dbPath, 1), `rev-${revision}.json`);
  assert.ok(existsSync(file), "the map is written");
  const map = JSON.parse(readFileSync(file, "utf-8"));
  const facts = map.entries.filter((e) => e.entity === "facts" && e.part === "Part 2").map((e) => [e.number, e.row_id]);
  assert.deepEqual(facts, [["1", 1], ["2", 2], ["3", 3]]);
  const submissions = map.entries.filter((e) => e.entity === "submissions" && e.part === "Part 3").map((e) => [e.number, e.row_id]);
  assert.deepEqual(submissions, [["1", 1], ["2", 2]]);
});

test("a move previews a code-generated diff, writes nothing, and applies with its line in the quick-edits log", async (t) => {
  const { dbPath, revision } = await matter(t);
  const preview = await submissionFormsPreviewEdit({
    db_path: dbPath, filing_id: 1, session_token: SESSION, seen_revision: revision,
    ops: [{ op: "move", target: target("2", 3), anchor: { ...target("2", 1), position: "before" } }],
  });
  assert.equal(preview.appliable, true, preview.note);
  assert.equal(preview.diff.length, 1);
  assert.match(preview.diff[0].text, /Part 2 ¶3 → Part 2 ¶1/);
  assert.match(preview.diff[0].text, new RegExp(FACTS[2]));
  assert.deepEqual(rows(dbPath, "SELECT fact_id FROM filing_facts WHERE filing_id = 1 AND document = 'form' ORDER BY ordinal").map((r) => r.fact_id), [1, 2, 3], "the preview wrote nothing");

  const applied = await submissionFormsApplyEdit({ db_path: dbPath, preview_token: preview.preview_token, session_token: SESSION });
  assert.equal(applied.applied, true, applied.note);
  assert.deepEqual(rows(dbPath, "SELECT fact_id FROM filing_facts WHERE filing_id = 1 AND document = 'form' ORDER BY ordinal").map((r) => r.fact_id), [3, 1, 2]);
  assert.equal(applied.audit_log, logPath(dbPath));
  assert.deepEqual(applied.audit_lines, [1]);
  const [line, ...more] = logLines(dbPath);
  assert.deepEqual(more, [], "one line per change");
  const { applied_at, ...fields } = line;
  assert.match(applied_at, /^\d{4}-\d{2}-\d{2}T/);
  const placement = rows(dbPath, "SELECT id FROM filing_facts WHERE filing_id = 1 AND fact_id = 3").at(0).id;
  assert.deepEqual(fields, {
    session_token: SESSION, preview_token: preview.preview_token, seen_revision: revision, new_revision: applied.revision,
    op: "move", document: "form", entity: "facts", entity_id: 3, deployment_id: placement, from: 3, to: 1, old_hash: null, new_hash: null,
  });
  assert.equal(rows(dbPath, "SELECT COUNT(*) AS n FROM paragraph_revisions").at(0).n, 0, "the table is not written");

  const again = await submissionFormsApplyEdit({ db_path: dbPath, preview_token: preview.preview_token, session_token: SESSION });
  assert.equal(again.refused, "used_token", "one preview, one write");
});

test("a remove on a row changed after the preview refuses stale_preview and writes nothing", async (t) => {
  const { dbPath, revision } = await matter(t);
  const preview = await submissionFormsPreviewEdit({
    db_path: dbPath, filing_id: 1, session_token: SESSION, seen_revision: revision,
    ops: [{ op: "remove", target: target("3", 2), document: "form" }],
  });
  assert.equal(preview.appliable, true, preview.note);
  await submissionDataExecute(dbPath, "UPDATE submissions SET contention = 'The arrears are owing in full.' WHERE id = 2;");
  const applied = await submissionFormsApplyEdit({ db_path: dbPath, preview_token: preview.preview_token, session_token: SESSION });
  assert.equal(applied.refused, "stale_preview");
  assert.equal(rows(dbPath, "SELECT COUNT(*) AS n FROM filing_submissions WHERE filing_id = 1").at(0).n, 2);
  assert.equal(rows(dbPath, "SELECT COUNT(*) AS n FROM paragraph_revisions").at(0).n, 0);
  assert.deepEqual(logLines(dbPath), [], "a refused apply logs nothing");
});

test("an edit elsewhere does not refuse, and a renumber holds the record seen", async (t) => {
  const { dbPath, revision } = await matter(t);
  // Another session rewords fact 1 after the render: the remove of Part 3 ¶1 touches none of it.
  await submissionDataExecute(dbPath, "UPDATE facts SET postulate = 'The lease began on 2 March 2024.' WHERE id = 1;");
  const preview = await submissionFormsPreviewEdit({
    db_path: dbPath, filing_id: 1, session_token: SESSION, seen_revision: revision,
    ops: [{ op: "remove", target: target("3", 1), document: "form" }],
  });
  assert.equal(preview.appliable, true, preview.note);
  const applied = await submissionFormsApplyEdit({ db_path: dbPath, preview_token: preview.preview_token, session_token: SESSION });
  assert.equal(applied.applied, true, applied.note);
  assert.deepEqual(rows(dbPath, "SELECT submission_id FROM filing_submissions WHERE filing_id = 1").map((r) => r.submission_id), [2]);
  assert.deepEqual(logLines(dbPath).map((l) => [l.op, l.entity, l.entity_id, l.from]), [["remove", "submissions", 1, 1]]);

  // The remove's log line is what a restore names.
  const seen = submissionFormsRender(dbPath, 1, ASHBOURNE).revision;
  const restore = await submissionFormsPreviewEdit({
    db_path: dbPath, filing_id: 1, session_token: SESSION, seen_revision: seen, ops: [{ op: "restore", remove_line: applied.audit_lines[0] }],
  });
  assert.equal(restore.appliable, true, restore.note);
  const restored = await submissionFormsApplyEdit({ db_path: dbPath, preview_token: restore.preview_token, session_token: SESSION });
  assert.equal(restored.applied, true, restored.note);
  assert.deepEqual(rows(dbPath, "SELECT submission_id FROM filing_submissions WHERE filing_id = 1 AND document = 'form' ORDER BY ordinal").map((r) => r.submission_id), [1, 2]);
  const back = rows(dbPath, "SELECT id FROM filing_submissions WHERE filing_id = 1 AND submission_id = 1").at(0).id;
  assert.deepEqual(logLines(dbPath).map((l) => [l.op, l.entity_id, l.deployment_id, l.to]).at(1), ["restore", 1, back, 2]);
});

test("a paragraph changed since seen, or a revision with no map, refuses before any trial", async (t) => {
  const { dbPath, revision } = await matter(t);
  const unknown = await submissionFormsPreviewEdit({
    db_path: dbPath, filing_id: 1, session_token: SESSION, seen_revision: revision + 100,
    ops: [{ op: "remove", target: target("3", 1), document: "form" }],
  });
  assert.equal(unknown.refused, "seen_revision_unknown");
  await submissionDataExecute(dbPath, "UPDATE facts SET postulate = 'The lease began on 2 March 2024.' WHERE id = 1;");
  const changed = await submissionFormsPreviewEdit({
    db_path: dbPath, filing_id: 1, session_token: SESSION, seen_revision: revision,
    ops: [{ op: "move", target: target("2", 1), anchor: { ...target("2", 3), position: "after" } }],
  });
  assert.equal(changed.refused, "changed_since_seen");
  assert.equal(changed.preview_token, null);
  assert.deepEqual(changed.changed_since_seen.map((c) => [c.row_id, c.what]), [[1, "text"]]);
});

test("a recast makes a Part 2 fact a new Part 3 submission at its anchor and takes the fact off the form", async (t) => {
  const { dbPath, revision } = await matter(t);
  const preview = await submissionFormsPreviewEdit({
    db_path: dbPath, filing_id: 1, session_token: SESSION, seen_revision: revision,
    ops: [{ op: "recast", target: target("2", 2), anchor: { ...target("3", 1), position: "after" }, new_type: "submission" }],
  });
  assert.equal(preview.appliable, true, preview.note);
  assert.deepEqual(preview.recast_menu, ["submission"]);
  const applied = await submissionFormsApplyEdit({ db_path: dbPath, preview_token: preview.preview_token, session_token: SESSION });
  assert.equal(applied.applied, true, applied.note);
  const placed = rows(dbPath, "SELECT s.contention FROM filing_submissions fs JOIN submissions s ON s.id = fs.submission_id WHERE fs.filing_id = 1 AND fs.document = 'form' ORDER BY fs.ordinal");
  assert.deepEqual(placed.map((r) => r.contention), [SUBMISSIONS[0], FACTS[1], SUBMISSIONS[1]]);
  assert.deepEqual(rows(dbPath, "SELECT fact_id FROM filing_facts WHERE filing_id = 1 AND document = 'form' ORDER BY ordinal").map((r) => r.fact_id), [1, 3]);
  const created = rows(dbPath, "SELECT id FROM submissions WHERE contention = ?", [FACTS[1]]).at(0).id;
  assert.deepEqual(logLines(dbPath).map((l) => [l.op, l.entity, l.entity_id]), [["remove", "facts", 2], ["recast", "submissions", created]]);
  assert.equal(rows(dbPath, "SELECT COUNT(*) AS n FROM paragraph_revisions").at(0).n, 0);
});

test("apply_edit succeeds on a database at schema version 80", async (t) => {
  const { dbPath, revision } = await matter(t);
  assert.equal(Number(rows(dbPath, "SELECT value FROM db_meta WHERE key = 'schema_version'").at(0).value), 80);
  const preview = await submissionFormsPreviewEdit({
    db_path: dbPath, filing_id: 1, session_token: SESSION, seen_revision: revision,
    ops: [{ op: "move", target: target("3", 2), anchor: { ...target("3", 1), position: "before" } }],
  });
  assert.equal(preview.appliable, true, preview.note);
  const applied = await submissionFormsApplyEdit({ db_path: dbPath, preview_token: preview.preview_token, session_token: SESSION });
  assert.equal(applied.applied, true, applied.note);
  assert.deepEqual(rows(dbPath, "SELECT submission_id FROM filing_submissions WHERE filing_id = 1 AND document = 'form' ORDER BY ordinal").map((r) => r.submission_id), [2, 1]);
});
