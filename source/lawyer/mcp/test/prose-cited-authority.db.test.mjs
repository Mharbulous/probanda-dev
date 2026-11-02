// A Writing's prose-cited authorities (#1214; work-markers.md rows 📜 📍 🔬 🏅; filing-checklists.md
// §13 "Authorities cited"): a statement of law the Writing's own text cites is linked to it by
// filing_law (schema v36) and printed as its own item of the mockup header's optional "Authorities
// cited" list (plan 2026-10-07 step 3), with the statement-line markers a doctrinal statement line
// prints and its own 🧐. The markers count toward the declared held criteria, so the pre-send hold
// reads them, and the sent face drops the whole header. The letter is /draft's shipped letter to
// opposing counsel on a proceeding with no forum.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { assertFiledFaceClean } from "./helpers/filed-face-scan.mjs";
import { generalWritingFixture } from "./helpers/general-writing-fixture.mjs";
import { boardDataOf } from "./fixtures/forms-render-seeds.mjs";

const { submissionFormsRender } = await import("../build/submission/forms.js");
const { submissionDataRecordSent } = await import("../build/submission/forms/sent-write.js");
const { fetchRevision } = await import("../build/submission/forms/query.js");
const { reviewSnapshotSql } = await import("../build/submission/forms/markers.js");
const { splitGlyphs } = await import("../build/submission/forms/symbol-table.js");
const { submissionDataMigrate } = await import("../build/submission/migrate.js");
const { hopsFrom } = await import("./helpers/schema-hops.mjs");
const { submissionDataMigrateScriptsDir } = await import("../build/repo-root.js");
const { submissionDataExecute, submissionDataQuery } = await import("../build/submission/backend.js");

const SHIPPED_LETTER = new URL("../../../../.claude/skills/draft/references/CAN/BC/_NoVenue/Documents/letter-to-opposing-counsel.md", import.meta.url);
const LETTER_BLOCK = JSON.parse(/^```json\n([\s\S]*?)\n```$/m.exec(readFileSync(SHIPPED_LETTER, "utf-8").replace(/\r\n/g, "\n"))[1]);

const CLIENT = { clientName: "Ada Client", clientNo: "0001", matterNo: "L0000" };
const NOW = "2026-09-27 10:00";
const SLOTS = [
  ["date", "28 September 2026"],
  ["addressee", "Cara Counsel\nCounsel Chambers\nVancouver, BC"],
  ["salutation", "Dear Ms. Counsel:"],
  ["re", "Re: Late Objection"],
  ["body", "Your objection came after the time Example v. Authority, 2020 BCSC 1, allows.\n\nPlease withdraw it by 3 October 2026."],
];
const TO_LINE = "To: Cara Counsel — counsel for Bert Other (cara@counsel.test)";
const AS_SENT = SLOTS.map(([, text]) => text).join("\n\n");

// #1365: a render returns its board as board_summary; the board's data is this filing's section of
// the matter's Work Board page, read the way the page builds it, right after the render.
const render = (g, id, mode = "mockup") => {
  const result = submissionFormsRender(g.dbPath, id, CLIENT, mode, undefined, undefined, undefined, NOW);
  return mode === "mockup" ? { ...result, board: boardDataOf(g.dbPath, id, CLIENT, NOW) } : result;
};
const letterOf = (result) => result.documents.find((d) => d.document_type === "General_writing").markdown;
const criterionOf = (result, id) => result.board.criteria.find((c) => c.id === id);
const held = (result) => ["excerpts", "noting-up", "primary-authority"].map((id) => [id, criterionOf(result, id).state, criterionOf(result, id).outstanding]);

/** The mockup header, both `---` lines included. */
const headerOf = (md) => md.slice(0, md.indexOf("\n---\n") + "\n---\n".length);

/** The authority's item in the header's "Authorities cited", split into its printed sets; `glyphs`
 * splits those sets further, for a line whose tail is markers only. */
function citedLine(md) {
  const m = /^ {2}- > \*Example v\. Authority\*, 2020 BCSC 1(.*?) <!-- statement_of_law_id (\d+) -->$/m.exec(headerOf(md));
  assert.ok(m, md);
  const sets = m[1].trim().split(" ").filter(Boolean);
  return { text: m[0], sets, get glyphs() { return sets.flatMap(splitGlyphs); }, statementId: Number(m[2]) };
}

/** The shipped letter, every slot written, Cara as `to`, a Deliver job for the Pre-send gate job to copy
 * its billing anchor from, and, unless `cite` is false, one prose-cited case: the authority, its lead
 * statement and the link written in one script, the write contract's idiom (filing-checklists.md §13).
 * An `unconfirmed` letter is a Writing drafted before schema v40, so its stored layout predates the
 * letter type declaring `noting-up` (render-general.ts, authorityUnconfirmed). */
async function drafted(t, { cite = true, unconfirmed = false } = {}) {
  const block = unconfirmed ? { ...LETTER_BLOCK, goal_criteria: LETTER_BLOCK.goal_criteria.filter((c) => c !== "noting-up") } : LETTER_BLOCK;
  const g = await generalWritingFixture(t, { front: null, block });
  const { filing_id: id } = await g.createLetter({ proceeding_id: 1, unconfirmed });
  for (const [slot, text] of SLOTS) await g.prose(id, slot, text);
  await g.recipient(id, 1, "to");
  await g.execute(
    `INSERT INTO tickets (proceeding_id, filing_id, title, intent, kind, priority, billing_anchor, created)
       VALUES (1, ${id}, 'Deliver', 'Send this letter to its recipients and record it as sent.', 'work', 0, 'L0000|late objection', '2026-09-27T09:00');`
  );
  if (cite) {
    await g.execute(
      `INSERT INTO authorities (id, proceeding_id, style_of_cause_or_title, citation, kind) VALUES (4, 1, 'Example v. Authority', '2020 BCSC 1', 'case');
       INSERT INTO statements_of_law (proceeding_id, law_assertion_id, authority_id, verification)
         VALUES ((SELECT proceeding_id FROM filings WHERE id = ${id}), NULL, 4, 'lead');
       INSERT INTO filing_law (filing_id, statement_id) VALUES (${id}, last_insert_rowid());`
    );
  }
  return { g, id };
}

test("a lead cited in a letter's prose prints in the header's Authorities cited with 📜 📍 🔬 📇 🏅, the Legend lists them, and the Work Board reads excerpts and primary authority unmet", async (t) => {
  const { g, id } = await drafted(t);
  const [link] = g.query("SELECT fl.statement_id, sl.law_assertion_id, sl.verification FROM filing_law fl JOIN statements_of_law sl ON sl.id = fl.statement_id WHERE fl.filing_id = ?", [id]);
  assert.deepEqual([link.law_assertion_id, link.verification], [null, "lead"], "the script wrote the statement and its link together");

  const result = render(g, id);
  const md = letterOf(result);
  const line = citedLine(md);
  assert.equal(line.statementId, link.statement_id);
  assert.deepEqual([...line.glyphs].sort(), ["📇", "📍", "📜", "🔬", "🏅"].sort(), line.text);
  assert.equal(line.sets.length, 1, `one statement's markers print as one fused set: ${line.text}`);
  assert.ok(headerOf(md).includes(`\nAuthorities cited:\n${line.text}\n`), md);
  // Plan 2026-10-07 step 3 (c): the markers sit only in the header, and the Legend still lists them.
  const [, body, legend] = /^---\n[\s\S]*?\n---\n([\s\S]*)\n## Legend\n([\s\S]*)$/.exec(md);
  assert.ok(body.trimEnd().endsWith(TO_LINE), "the letter's text ends at its To line");
  for (const glyph of ["📜", "📍", "🔬", "📇", "🏅"]) {
    assert.ok(!body.includes(glyph), `${glyph} sits only in the header`);
    assert.ok(legend.includes(`| ${glyph} |`), `the Legend lists ${glyph}`);
  }

  assert.deepEqual(held(result), [
    ["excerpts", "unmet", 1],
    // 📇 is the ladder's last rung: an authority is noted up once one of its statements has cleared
    // 📜 📍 🔬 (proposal-inventory.ts, isCurrentRung), so its note-up is not yet counted.
    ["noting-up", "met", 0],
    ["primary-authority", "unmet", 1],
  ]);
  assert.deepEqual(criterionOf(result, "excerpts").items, ["Example v. Authority, 2020 BCSC 1"]);
  assert.deepEqual(criterionOf(result, "primary-authority").items, ["Example v. Authority, 2020 BCSC 1"]);
  // Plan 2026-10-07 step 3 (d): moving Authorities cited into the header leaves open-items' count as it was.
  const openItems = criterionOf(result, "open-items");
  assert.deepEqual([openItems.state, openItems.outstanding, openItems.items], ["met", 0, []]);
});

test("the sent face drops the header's Authorities cited and keeps the signature block and the To line", async (t) => {
  const { g, id } = await drafted(t);
  const face = render(g, id, "filed").documents[0].markdown;
  assert.doesNotMatch(face, /Authorities cited|Example v\. Authority, 2020 BCSC 1 |<!--/);
  assert.ok(face.includes("Your objection came after the time Example v. Authority, 2020 BCSC 1, allows."), face);
  assert.ok(face.includes("Pat Example"), face);
  assert.ok(face.trimEnd().endsWith(TO_LINE), face);
  assertFiledFaceClean(face, "General_writing");
});

test("record_sent holds the letter while its prose-cited lead is unquoted and leaves a Pre-send gate job", async (t) => {
  const { g, id } = await drafted(t);
  render(g, id);
  const revision = g.revision();
  await assert.rejects(
    submissionDataRecordSent({ db_path: g.dbPath, filing_id: id, sent_on: "2026-09-28", sent_copy_text: AS_SENT, expect_revision: fetchRevision(g.dbPath) }, g.seams.env),
    (err) => {
      assert.equal(err.code, "held", err.message);
      assert.match(err.message, /excerpts \(Example v\. Authority, 2020 BCSC 1\)/);
      assert.match(err.message, /primary-authority \(Example v\. Authority, 2020 BCSC 1\)/);
      return true;
    }
  );
  const [job] = g.query("SELECT id, status FROM tickets WHERE filing_id = ? AND title = 'Pre-send gate'", [id]);
  assert.equal(job.status, "queued");
  assert.deepEqual(
    g.query("SELECT text FROM ticket_steps WHERE ticket_id = ? ORDER BY ordinal", [job.id]).map((s) => s.text),
    [
      `primary-authority — Every proposition of law rests on primary authority: unmet (1 open) [rev ${revision}]`,
      `excerpts — Every excerpt is quoted, pinpointed and checked: unmet (1 open) [rev ${revision}]`,
    ]
  );
  assert.equal(g.query("SELECT filed_on FROM filings WHERE id = ?", [id])[0].filed_on, null);
});

test("quoted, pinpointed, rated, verified and noted up, the line clears the held criteria and reads 🧐 until counsel approves it", async (t) => {
  const { g, id } = await drafted(t);
  const [{ statement_id: sid }] = g.query("SELECT statement_id FROM filing_law WHERE filing_id = ?", [id]);
  await g.execute(
    // The verified write snapshots the pair it leaves (v47), so the reopen trigger keeps the row verified.
    `UPDATE statements_of_law SET excerpt = 'An objection is late after 14 days.', pinpoint = 'para. 12', source = 'primary', verification = 'verified',
       scrutinized_authority_id = authority_id, scrutinized_pinpoint = 'para. 12', scrutinized_excerpt = 'An objection is late after 14 days.' WHERE id = ${sid};
     UPDATE authorities SET treatment = 'good_law' WHERE id = 4;`
  );
  const cleared = render(g, id);
  const line = citedLine(letterOf(cleared));
  assert.equal(line.text, `  - > *Example v. Authority*, 2020 BCSC 1, para. 12 🧐 <!-- statement_of_law_id ${sid} -->`);
  assert.deepEqual(held(cleared), [
    ["excerpts", "met", 0],
    ["noting-up", "met", 0],
    ["primary-authority", "met", 0],
  ]);
  assert.ok(criterionOf(cleared, "counsel-review").items.includes("Example v. Authority, 2020 BCSC 1"));

  await g.execute(
    `INSERT INTO review_approvals (entity, entity_id, approved_at, session_token, practitioner, revision, snapshot)
       SELECT 'statements_of_law', id, '2026-09-27T10:30', 'sess-a1', 'Pat Example',
              (SELECT CAST(value AS INTEGER) FROM db_meta WHERE key = 'revision'), ${reviewSnapshotSql("statements_of_law")}
         FROM statements_of_law WHERE id = ${sid};`
  );
  const approved = render(g, id);
  assert.equal(citedLine(letterOf(approved)).text, `  - > *Example v. Authority*, 2020 BCSC 1, para. 12 <!-- statement_of_law_id ${sid} -->`);
  assert.ok(!criterionOf(approved, "counsel-review").items.includes("Example v. Authority, 2020 BCSC 1"));
});

// #1628: noting up a statute, regulation or rule is the statute-currency check alone, so its 📇
// reads `currency_status`, not `treatment`; doctrine never prints 📇. A repealed one still prints
// 📇 and proposes no note-up, yet the noting-up row still counts it until it is replaced.
test("a prose-cited statute's 📇 follows its currency, not its treatment, and doctrine prints none", async (t) => {
  const { g, id } = await drafted(t);
  const [{ statement_id: sid }] = g.query("SELECT statement_id FROM filing_law WHERE filing_id = ?", [id]);
  await g.execute(
    `UPDATE statements_of_law SET excerpt = 'An objection is late after 14 days.', pinpoint = 'para. 12', source = 'primary', verification = 'verified',
       scrutinized_authority_id = authority_id, scrutinized_pinpoint = 'para. 12', scrutinized_excerpt = 'An objection is late after 14 days.' WHERE id = ${sid};`
  );
  const noteUp = async (sql) => {
    await g.execute(sql);
    const result = render(g, id);
    const noting = criterionOf(result, "noting-up");
    return [citedLine(letterOf(result)).text.includes("📇"), noting.state, noting.outstanding];
  };
  assert.deepEqual(await noteUp("UPDATE authorities SET kind = 'case' WHERE id = 4;"), [true, "unmet", 1], "a case with treatment ∅ is unchanged");
  assert.deepEqual(await noteUp("UPDATE authorities SET kind = 'statute' WHERE id = 4;"), [true, "unmet", 1], "unchecked currency");
  assert.deepEqual(await noteUp("UPDATE authorities SET currency_status = 'not-found' WHERE id = 4;"), [true, "unmet", 1]);
  assert.deepEqual(await noteUp("UPDATE authorities SET currency_status = 'current' WHERE id = 4;"), [true, "unmet", 1], "current with no check date is stale");
  // A statute's 'current' stays fresh for 30 days from its check date, read against today's local date.
  const d = new Date();
  const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  assert.deepEqual(await noteUp(`UPDATE authorities SET currency_checked_on = '${today}' WHERE id = 4;`), [false, "met", 0], "current, checked today, treatment ∅");
  assert.deepEqual(await noteUp("UPDATE authorities SET currency_status = 'repealed' WHERE id = 4;"), [true, "unmet", 1], "repealed: 📇, no job, still outstanding");
  assert.deepEqual(await noteUp("UPDATE authorities SET kind = 'doctrine', currency_status = NULL WHERE id = 4;"), [false, "met", 0]);
});

test("a killed authority's line keeps its killed tag and prints no marker, 🧐 included; an overruled one prints ⛔", async (t) => {
  const { g, id } = await drafted(t);
  const [{ statement_id: sid }] = g.query("SELECT statement_id FROM filing_law WHERE filing_id = ?", [id]);
  await g.execute("UPDATE authorities SET killed_on = '2026-09-26' WHERE id = 4;");
  assert.equal(citedLine(letterOf(render(g, id))).text, `  - > *Example v. Authority*, 2020 BCSC 1 (killed 2026-09-26) <!-- statement_of_law_id ${sid} -->`);

  await g.execute("UPDATE authorities SET killed_on = NULL, treatment = 'overruled' WHERE id = 4;");
  // ⛔ is an event marker, not a work marker, so the unapproved statement's 🧐 prints beside it, in
  // the statement's one set.
  assert.deepEqual(citedLine(letterOf(render(g, id))).sets, ["⛔🧐"]);
});

test("a confirmed Writing with no filing_law row prints no Authorities cited field", async (t) => {
  const { g, id } = await drafted(t, { cite: false });
  const md = letterOf(render(g, id));
  assert.doesNotMatch(md, /Authorities cited|statement_of_law_id/);
  // The letter's text ends at its To line; only the legend follows it.
  assert.ok(md.split("\n## Legend\n")[0].trimEnd().endsWith(TO_LINE), md);
});

// #1231: a Writing drafted before schema v40 has authority_confirmed_on NULL. Nothing parses its
// prose: the column records that it links its cited authority or cites none.
const NOT_CONFIRMED = "Authority not confirmed: link each authority this text cites, or record that it cites none. Sending is held until then.";
const CONFIRM = (id) => `UPDATE filings SET authority_confirmed_on = '2026-09-29' WHERE id = ${id};`;

test("an unconfirmed Writing prints a plain, glyph-free item in the header's Authorities cited even with no filing_law row, and the sent face drops it", async (t) => {
  const { g, id } = await drafted(t, { cite: false, unconfirmed: true });
  const result = render(g, id);
  const md = letterOf(result);
  assert.ok(headerOf(md).includes(`\nAuthorities cited:\n  - ${NOT_CONFIRMED}\n`), md);
  assert.equal(criterionOf(result, "open-items").state, "met", "the line carries no glyph, so open-items does not count it");
  const face = letterOf(render(g, id, "filed"));
  assert.doesNotMatch(face, /Authorities cited|Authority not confirmed/);
  assert.ok(face.trimEnd().endsWith(TO_LINE), face);
});

test("the line prints above a linked authority while unconfirmed, and setting the column clears it", async (t) => {
  const { g, id } = await drafted(t, { unconfirmed: true });
  const before = letterOf(render(g, id));
  assert.ok(headerOf(before).includes(`\nAuthorities cited:\n  - ${NOT_CONFIRMED}\n  - > *Example v. Authority*`), before);
  await g.execute(CONFIRM(id));
  const after = letterOf(render(g, id));
  assert.doesNotMatch(after, /Authority not confirmed/);
  assert.ok(headerOf(after).includes(`\nAuthorities cited:\n  - > *Example v. Authority*`), after);
});

test("record_sent holds an unconfirmed letter on authority-confirmed alone, leaves a Pre-send gate step, and sends once the column is set", async (t) => {
  const { g, id } = await drafted(t, { cite: false, unconfirmed: true });
  render(g, id);
  const revision = g.revision();
  const send = () => submissionDataRecordSent({ db_path: g.dbPath, filing_id: id, sent_on: "2026-09-29", sent_copy_text: AS_SENT, expect_revision: fetchRevision(g.dbPath) }, g.seams.env);
  await assert.rejects(send(), (err) => {
    assert.equal(err.code, "held", err.message);
    assert.match(err.message, /authority-confirmed \(link each authority the text cites, or record that it cites none\) unmet now/);
    return true;
  });
  const [job] = g.query("SELECT id FROM tickets WHERE filing_id = ? AND title = 'Pre-send gate'", [id]);
  assert.deepEqual(
    g.query("SELECT text FROM ticket_steps WHERE ticket_id = ? ORDER BY ordinal", [job.id]).map((s) => s.text),
    [`authority-confirmed — The Writing records that its cited authority is linked, or that it cites none: unmet (1 open) [rev ${revision}]`]
  );
  const gate = criterionOf(render(g, id), "gate");
  assert.equal(gate.state, "unmet", "the gate row reads the held job");

  await g.execute(CONFIRM(id));
  render(g, id);
  const sent = await send();
  assert.equal(g.query("SELECT filed_on FROM filings WHERE id = ?", [id])[0].filed_on, "2026-09-29");
  assert.ok(sent, "the Sent write records it");
});

test("the v35 -> v36 hop adds filing_law with its index, revision and proceeding guard triggers, and each link is unique per Writing and within its proceeding", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "filing-law-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const dbPath = join(dir, "submission.sqlite");
  const done = spawnSync(
    process.env.COCLERK_PYTHON || "python",
    ["-c", "import sys; sys.path.insert(0, sys.argv[1]); import migrate_engine as e; e.migrate(sys.argv[2], target_version=35)", submissionDataMigrateScriptsDir(process.env), dbPath],
    { encoding: "utf-8" }
  );
  assert.equal(done.status, 0, done.stderr || String(done.error));
  const query = (sql, params = []) => submissionDataQuery(dbPath, sql, params).rows;
  assert.deepEqual(query("SELECT name FROM sqlite_master WHERE name LIKE '%filing_law%'"), []);

  const migrated = await submissionDataMigrate(dbPath);
  assert.deepEqual(migrated.applied, hopsFrom(35), JSON.stringify(migrated));
  assert.equal(query("SELECT value FROM db_meta WHERE key = 'schema_version'")[0].value, String(hopsFrom(35).at(-1).to));
  assert.deepEqual(
    query("SELECT type, name FROM sqlite_master WHERE tbl_name = 'filing_law' AND name NOT LIKE 'sqlite_%' ORDER BY type, name").map((r) => [r.type, r.name]),
    [
      ["index", "idx_filing_law_filing"],
      ["table", "filing_law"],
      ["trigger", "guard_filing_law_frozen_del"],
      ["trigger", "guard_filing_law_frozen_ins"],
      ["trigger", "guard_filing_law_frozen_upd"],
      ["trigger", "guard_filing_law_proceeding_ins"],
      ["trigger", "guard_filing_law_proceeding_upd"],
      ["trigger", "rev_filing_law_del"],
      ["trigger", "rev_filing_law_ins"],
      ["trigger", "rev_filing_law_upd"],
    ]
  );

  await submissionDataExecute(
    dbPath,
    `INSERT INTO proceedings (id, matter_reference, forum) VALUES (1, 'L0000', NULL);
     INSERT INTO filings (id, proceeding_id, kind, title, needs_forum_parts) VALUES (1, 1, 'letter_to_opposing_counsel', 'Letter', 0);
     INSERT INTO authorities (id, proceeding_id, style_of_cause_or_title, citation, kind) VALUES (1, 1, 'Example v. Authority', '2020 BCSC 1', 'case');
     INSERT INTO statements_of_law (id, proceeding_id, authority_id, verification) VALUES (1, 1, 1, 'lead');`
  );
  const revision = () => Number(query("SELECT value FROM db_meta WHERE key = 'revision'")[0].value);
  const before = revision();
  await submissionDataExecute(dbPath, "INSERT INTO filing_law (filing_id, statement_id) VALUES (1, 1);");
  assert.equal(revision(), before + 1, "a link moves the revision");
  await assert.rejects(submissionDataExecute(dbPath, "INSERT INTO filing_law (filing_id, statement_id) VALUES (1, 1);"), /UNIQUE/);
  await submissionDataExecute(dbPath, "DELETE FROM filing_law WHERE filing_id = 1;");
  assert.equal(revision(), before + 2, "an unlink moves it too");
  assert.equal(query("SELECT COUNT(*) AS n FROM statements_of_law")[0].n, 1, "unlinking leaves the statement");

  await submissionDataExecute(
    dbPath,
    `INSERT INTO proceedings (id, matter_reference, forum) VALUES (2, 'L0001', NULL);
     INSERT INTO authorities (id, proceeding_id, style_of_cause_or_title, citation, kind) VALUES (2, 2, 'Other v. Authority', '2021 BCSC 2', 'case');
     INSERT INTO statements_of_law (id, proceeding_id, authority_id, verification) VALUES (2, 2, 2, 'lead');`
  );
  const ACROSS = /a Writing links only a statement of law of its own proceeding/;
  await assert.rejects(submissionDataExecute(dbPath, "INSERT INTO filing_law (filing_id, statement_id) VALUES (1, 2);"), ACROSS);
  await submissionDataExecute(dbPath, "INSERT INTO filing_law (filing_id, statement_id) VALUES (1, 1);");
  await assert.rejects(submissionDataExecute(dbPath, "UPDATE filing_law SET statement_id = 2 WHERE filing_id = 1;"), ACROSS);
  assert.deepEqual(query("SELECT filing_id, statement_id FROM filing_law"), [{ filing_id: 1, statement_id: 1 }], "neither refused write landed");
});
