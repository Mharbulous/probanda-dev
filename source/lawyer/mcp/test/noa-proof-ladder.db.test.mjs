// The Notice of Application's Part 2 proof ladder (plan: progressive citation line and expanded
// proof ladder): each statement's rung prints on its own citation line beneath the bare postulate,
// the citation builds up as the instrument is drafted, and Part 4 lists the affidavit undated with
// its marker until it is sworn.

import assert from "node:assert/strict";
import test from "node:test";
import { seededDbFixture, seedBcscDefaultJudgment } from "./fixtures/forms-render-seeds.mjs";
const { freshSubmissionDb } = await import("./helpers/template-db.mjs");
const { submissionDataExecute } = await import("../build/submission/backend.js");
const { submissionFormsEmitForm32, submissionFormsRender } = await import("../build/submission/forms.js");
const { reviewSnapshotSql } = await import("../build/submission/forms/markers.js");

const CLIENT = { clientName: "Halloway", clientNo: "9002", matterNo: "L9002" };

// One fact in Part 2, and an affidavit whose stored label differs from its composed name, so the
// citation shows the composition. Every document is the best copy, so 🏆 stays off the lines.
const BASE = `
  INSERT INTO hearing_details (filing_id, hearing_date, hearing_time, time_estimate_minutes, associate_judge)
    VALUES (1, '2026-09-01', '9:45 am', 45, 1);
  UPDATE filings SET kind = 'notice_of_application', subkind = NULL, title = 'Notice of Application' WHERE id = 1;
  UPDATE documents SET is_best_copy = 1;
  INSERT INTO witnesses (id, proceeding_id, name) VALUES (10, 1, 'A. Marlowe'), (11, 1, 'B. Quill');
  INSERT INTO documents (id, proceeding_id, label, instrument, deponent, affidavit_number, is_best_copy)
    VALUES (20, 1, 'Marlowe affidavit draft', 'affidavit', 10, '1', 1);
  INSERT INTO facts (id, proceeding_id, postulate)
    VALUES (10, 1, 'The roof leaked in March.'), (11, 1, 'The tenant reported the leak.');
  INSERT INTO filing_facts (filing_id, fact_id, document, part, ordinal) VALUES (1, 10, 'form', 'part2', 1);
`;

const STATEMENT = "INSERT INTO statements_of_fact (id, proceeding_id, fact_id, witness_id, interviewed) VALUES (10, 1, 10, 10, 0);";
const INTERVIEWED = "UPDATE statements_of_fact SET interviewed = 1 WHERE id = 10;";
// Stage 4 also links a second statement (on a fact outside Part 2) to the same affidavit.
const INSTRUMENT = `
  UPDATE statements_of_fact SET instrument = 20 WHERE id = 10;
  INSERT INTO statements_of_fact (id, proceeding_id, fact_id, witness_id, instrument, interviewed) VALUES (11, 1, 11, 10, 20, 1);
`;
const OWN_PARAGRAPH = `
  INSERT INTO statement_paragraphs (id, document_id, ordinal, text) VALUES (100, 20, 1, 'The roof leaked in March.');
  INSERT INTO paragraph_statements_of_fact (statement_paragraph_id, statement_of_fact_id) VALUES (100, 10);
`;
const SIBLING_PARAGRAPH = `
  INSERT INTO statement_paragraphs (id, document_id, ordinal, text) VALUES (101, 20, 2, 'The tenant reported the leak.');
  INSERT INTO paragraph_statements_of_fact (statement_paragraph_id, statement_of_fact_id) VALUES (101, 11);
`;
const SWORN = "UPDATE documents SET execution = '2026-08-01', signed_at = 'Vancouver' WHERE id = 20; UPDATE statements_of_fact SET pinpoint = 'para. 1' WHERE id = 10;";
const approve = (table, id) => `
  INSERT INTO review_approvals (entity, entity_id, approved_at, session_token, practitioner, revision, snapshot)
    SELECT '${table}', id, '2026-11-20T10:00', 'sess', 'Pat Example', 1, ${reviewSnapshotSql(table)} FROM ${table} WHERE id = ${id};
`;
const APPROVED = approve("facts", 10) + approve("statements_of_fact", 10);

const STAGES = [
  [],
  [STATEMENT],
  [STATEMENT, INTERVIEWED],
  [STATEMENT, INTERVIEWED, INSTRUMENT],
  [STATEMENT, INTERVIEWED, INSTRUMENT, OWN_PARAGRAPH],
  [STATEMENT, INTERVIEWED, INSTRUMENT, OWN_PARAGRAPH, SIBLING_PARAGRAPH],
  [STATEMENT, INTERVIEWED, INSTRUMENT, OWN_PARAGRAPH, SIBLING_PARAGRAPH, SWORN],
  [STATEMENT, INTERVIEWED, INSTRUMENT, OWN_PARAGRAPH, SIBLING_PARAGRAPH, SWORN, APPROVED],
];

async function withNotice(writes, fn) {
  const f = seededDbFixture();
  try {
    await freshSubmissionDb(f.dbPath);
    await seedBcscDefaultJudgment(f.dbPath, { layout: false });
    await submissionDataExecute(f.dbPath, BASE.trim());
    for (const sql of writes) await submissionDataExecute(f.dbPath, sql.trim());
    return await fn(f.dbPath);
  } finally {
    f.cleanup();
  }
}

const noticeOf = (dbPath, mode = "mockup") =>
  submissionFormsRender(dbPath, 1, mode === "mockup" ? CLIENT : {}, mode).documents.find((d) => d.file_name === "Notice of Application.md").markdown;
const between = (md, from, to) => md.slice(md.indexOf(from) + from.length, md.indexOf(to)).split("\n").filter((l) => l.trim() !== "");
const part2 = (md) => between(md, "## PART 2: FACTUAL BASIS", "## PART 3");
const part4 = (md) => between(md, "## PART 4: MATERIAL TO BE RELIED ON", "Pleadings filed");

const POSTULATE = "1. The roof leaked in March.";
const EXPECTED = [
  "   > 👤 <!-- fact 1 --> <!-- mockup-only -->",
  "   > A. Marlowe 🗣️ <!-- fact 1 --> <!-- mockup-only -->",
  "   > A. Marlowe 🗒️ <!-- fact 1 --> <!-- mockup-only -->",
  "   > Affidavit #1 of A. Marlowe ✍️ <!-- fact 1 -->",
  "   > Affidavit #1 of A. Marlowe, para. 1 📝 <!-- fact 1 -->",
  "   > Affidavit #1 of A. Marlowe, para. 1 ✒️ <!-- fact 1 -->",
  "   > Affidavit #1 of A. Marlowe, para. 1 🧐 <!-- fact 1 -->",
  "   > Affidavit #1 of A. Marlowe, para. 1 <!-- fact 1 -->",
];

STAGES.forEach((writes, i) => {
  test(`stage ${i + 1}: the postulate prints bare and the citation line carries the one rung`, () =>
    withNotice(writes, (dbPath) => assert.deepEqual(part2(noticeOf(dbPath)), [POSTULATE, EXPECTED[i]])));
});

test("two witnesses at different stages print one citation line each, with their own rungs", () =>
  withNotice(
    [STATEMENT, INTERVIEWED, INSTRUMENT, OWN_PARAGRAPH, "INSERT INTO statements_of_fact (id, proceeding_id, fact_id, witness_id, interviewed) VALUES (12, 1, 10, 11, 1);"],
    (dbPath) =>
      assert.deepEqual(part2(noticeOf(dbPath)), [
        POSTULATE,
        "   > Affidavit #1 of A. Marlowe, para. 1 📝",
        "   > B. Quill 🗒️ <!-- fact 1 --> <!-- mockup-only -->",
      ])
  ));

test("reordering the paragraphs before swearing moves the pinpoint; after swearing it does not", () =>
  withNotice(STAGES[5], async (dbPath) => {
    await submissionDataExecute(dbPath, "UPDATE statement_paragraphs SET ordinal = 3 WHERE id = 100;");
    assert.equal(part2(noticeOf(dbPath))[1], "   > Affidavit #1 of A. Marlowe, para. 2 ✒️ <!-- fact 1 -->");
    await submissionDataExecute(dbPath, "UPDATE documents SET execution = '2026-08-01' WHERE id = 20; UPDATE statements_of_fact SET pinpoint = 'para. 2' WHERE id = 10;");
    await submissionDataExecute(dbPath, "UPDATE statement_paragraphs SET ordinal = 0 WHERE id = 100;");
    assert.equal(part2(noticeOf(dbPath))[1], "   > Affidavit #1 of A. Marlowe, para. 2 🧐 <!-- fact 1 -->");
  }));

test("after swearing, a statement with no stored pinpoint owes 🧷 and cites none", () =>
  withNotice([...STAGES[5], "UPDATE documents SET execution = '2026-08-01' WHERE id = 20;"], (dbPath) =>
    assert.equal(part2(noticeOf(dbPath))[1], "   > Affidavit #1 of A. Marlowe 🧷 <!-- fact 1 -->")
  ));

test("Part 4 lists the affidavit from stage 4, undated with ✍️ then ✒️, and dated once sworn", async () => {
  const listed = (lines) => lines.find((l) => l.includes("Marlowe affidavit draft"));
  for (const i of [0, 1, 2]) await withNotice(STAGES[i], (dbPath) => assert.equal(listed(part4(noticeOf(dbPath))), undefined, `stage ${i + 1}`));
  await withNotice(STAGES[3], (dbPath) => assert.equal(listed(part4(noticeOf(dbPath))), "2. Marlowe affidavit draft ✍️ <!-- document 2 -->"));
  await withNotice(STAGES[4], (dbPath) => assert.equal(listed(part4(noticeOf(dbPath))), "2. Marlowe affidavit draft ✍️ <!-- document 2 -->"));
  await withNotice(STAGES[5], (dbPath) => assert.equal(listed(part4(noticeOf(dbPath))), "2. Marlowe affidavit draft ✒️ <!-- document 2 -->"));
  await withNotice(STAGES[6], (dbPath) => assert.equal(listed(part4(noticeOf(dbPath))), "2. Marlowe affidavit draft, dated August 1, 2026 <!-- document 2 -->"));
});

test("the filed face keeps the citation and drops the witness-only line, every glyph and every comment", () =>
  withNotice(
    [STATEMENT, INTERVIEWED, INSTRUMENT, OWN_PARAGRAPH, "INSERT INTO statements_of_fact (id, proceeding_id, fact_id, witness_id, interviewed) VALUES (12, 1, 10, 11, 1);"],
    (dbPath) => {
      const lines = part2(noticeOf(dbPath, "filed"));
      assert.deepEqual(lines.map((l) => l.trim()), [POSTULATE, "> Affidavit #1 of A. Marlowe, para. 1"]);
    }
  ));

test("the emitted Form 32 cites the live paragraph and lists the unattached affidavit after the selected documents", () =>
  withNotice(STAGES[5], (dbPath) => {
    const { markdown } = submissionFormsEmitForm32(dbPath, 1);
    assert.match(markdown, /^1\. The roof leaked in March\.\n>> Affidavit #1 of A\. Marlowe, para\. 1$/m);
    assert.match(markdown, /^- Draft default judgment\n- Affidavit #1 of A\. Marlowe, made \[date\]$/m);
  }));

// 🤫 is no work marker, so the fact's own 🧐 joins it in the fact's set.
test("a suppressed 👤 prints 🤫 on its own line", () =>
  withNotice(
    ["INSERT INTO marker_suppressions (marker, keyed_table, keyed_id, item, suppressed_on, note) SELECT '👤', 'facts', id, postulate, '2026-11-20', 'Counsel will prove it by cross-examination.' FROM facts WHERE id = 10;"],
    (dbPath) => assert.deepEqual(part2(noticeOf(dbPath)), [POSTULATE, "   > 🤫🧐 <!-- fact 1 --> <!-- mockup-only -->"])
  ));
