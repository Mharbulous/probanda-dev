// A case brief's .docx name in the Legal Memos reader (forms/legal-memos.ts), and the template's re-brief: where
// it looks for a saved brief, where it saves, and a sent or retired Writing. case-briefs.db.test.mjs holds the
// Case Briefs reader and the re-brief of a Writing in draft. Every name is synthetic.

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";
import { fileURLToPath } from "node:url";

process.env.COCLERK_SUBMISSION_LOCK_ROOT = mkdtempSync(join(tmpdir(), "coclerk-case-brief-rebrief-locks-"));
process.env.COCLERK_REPO_ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
after(() => rmSync(process.env.COCLERK_SUBMISSION_LOCK_ROOT, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }));

const { freshSubmissionDb } = await import("./helpers/template-db.mjs");
const { submissionDataExecute, submissionDataQuery } = await import("../build/submission/backend.js");
const { submissionFormsRender } = await import("../build/submission/forms.js");
const { isCaseBriefFile, memoSourceOf } = await import("../build/submission/forms/legal-memos.js");
const { submissionDataCreateWriting } = await import("../build/submission/forms/layout-snapshot.js");
const { saveAnswer } = await import("../build/files/research-filing.js");
const { awaitBackgroundJobs } = await import("../build/submission/render-job.js");

const NOW = "2026-11-01 09:00";
const FORUM = "CAN/BC/Vancouver-International-Arbitration-Centre";

test("a brief saved as .docx is no Westlaw report", () => {
  assert.equal(memoSourceOf("2026-10-01 case brief A v B, 2020 BCCA 1.docx"), null);
  assert.equal(memoSourceOf("case brief A v B.docx"), null);
  assert.equal(isCaseBriefFile("2026-10-01 case brief A v B, 2020 BCCA 1.docx"), false, "and is not listed as a brief");
  assert.equal(memoSourceOf("2026-10-01 Deep Research on case brief practice.docx"), "westlaw");
});

test("the template finds a saved brief through the whole law tree and re-saves it beside itself", () => {
  const template = readFileSync(new URL("../../../../.claude/skills/shared/case-brief-template.md", import.meta.url), "utf-8");
  assert.match(template, /with no board, look through `6\. LAW` and every folder under it by `case-brief\/SKILL\.md` step 3's route/);
  assert.doesNotMatch(template, /or `research_filing__list_law_folder` with no board/);
  assert.match(template, /numbered only within one folder, so its `destination_dir` is the folder holding that brief/);
  assert.match(template, /When that title's only Writing has `filed_on` or `retired_on` set/);
});

test("a re-brief of a sent or retired Writing leaves it alone and saves the next version on a new Writing of that title", async (t) => {
  const base = mkdtempSync(join(tmpdir(), "coclerk-case-brief-rebrief-"));
  t.after(async () => {
    await awaitBackgroundJobs();
    rmSync(base, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  });
  const matterRoot = join(base, "L9999 Test Matter");
  const law = join(matterRoot, "6. LAW");
  mkdirSync(join(matterRoot, "0. CASE DATA"), { recursive: true });
  mkdirSync(join(matterRoot, "0. DRAFT"));
  mkdirSync(law);
  writeFileSync(join(matterRoot, "coclerk.json"), JSON.stringify({ schema_version: 5, matter_root: matterRoot, case_data_dir: "0. CASE DATA", evidence_sql_path: "x.sql" }), "utf-8");
  const dbPath = join(matterRoot, "0. CASE DATA", "submission.sqlite");
  await freshSubmissionDb(dbPath);
  await submissionDataExecute(
    dbPath,
    `INSERT INTO proceedings (id, matter_reference, forum) VALUES (1, 'L9999', '${FORUM}');
     INSERT INTO authorities (id, proceeding_id, style_of_cause_or_title, citation, kind) VALUES (60, 1, 'Alpha v Beta', '2020 BCCA 1', 'case');`
  );
  const stem = "2026-10-01 case brief Alpha v Beta, 2020 BCCA 1";
  const create = () => submissionDataCreateWriting({ db_path: dbPath, proceeding_id: 1, tree: { country: "CAN", jurisdiction: "BC", venue: "_NoVenue" }, kind: "case_brief", recipient: "internal", title: stem });
  const prose = (id, slot, text) => `INSERT INTO filing_prose (filing_id, slot, text) VALUES (${id}, '${slot}', '${text}');`;
  const write = (id, statement, holding) =>
    submissionDataExecute(
      dbPath,
      `INSERT INTO statements_of_law (id, proceeding_id, authority_id, pinpoint, excerpt, source, verification) VALUES (${statement}, 1, 60, 'para. 5', '${holding}', 'primary', 'lead');
       INSERT INTO filing_law (filing_id, statement_id) VALUES (${id}, ${statement});
       ${prose(id, "case", "Alpha v Beta, 2020 BCCA 1.\nNot noted up by this brief.")}${prose(id, "facts", "A fact.")}${prose(id, "procedural-history", "An appeal.")}${prose(id, "issues", "An issue?")}
       ${prose(id, "holding", `${holding} <!-- statement_of_law_id ${statement} -->`)}${prose(id, "ratio", "None.")}${prose(id, "obiter", "None.")}${prose(id, "disposition", "Dismissed.")}`
    );
  const save = (id) => {
    const r = submissionFormsRender(dbPath, id, {}, "mockup", ["General_writing"], undefined, undefined, NOW, "tok");
    return saveAnswer(law, `${stem}.md`, undefined, undefined, r.documents.find((d) => d.document_type === "General_writing").path);
  };
  const { filing_id: first } = await create();
  await write(first, 100, "First holding.");
  save(first);
  await submissionDataExecute(dbPath, `UPDATE filings SET retired_on = '2026-10-10' WHERE id = ${first}`);
  await assert.rejects(submissionDataExecute(dbPath, `DELETE FROM filing_law WHERE filing_id = ${first}`), /do not change/, "the template's delete script stops on it");
  const { filing_id: second } = await create();
  assert.notEqual(second, first);
  await write(second, 101, "Second holding.");
  const saved = save(second);
  assert.match(saved.path, / v2\.md$/);
  assert.match(readFileSync(saved.path, "utf-8"), /Second holding\./);
  assert.deepEqual(submissionDataQuery(dbPath, `SELECT statement_id FROM filing_law WHERE filing_id = ${first}`).rows.map((r) => r.statement_id), [100], "the retired Writing keeps its item");
});
