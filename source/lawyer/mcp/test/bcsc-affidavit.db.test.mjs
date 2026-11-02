// The BCSC supporting-affidavit companion (#1486): one mockup per affidavit a Notice of Application
// or Application Response lists under role 'affidavit', with exhibit letters derived from the
// {exhibit:<document_id>} tokens in its paragraphs and the three 🧩 cases #1425 decided. Its
// filed-face emitter, drafting_forms__emit_affidavit (#1487), is tested at the end.

import assert from "node:assert/strict";
import { mkdirSync, readFileSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { assertMatchesGolden, seededDbFixture, seedApplicationResponse, seedBcscDefaultJudgment } from "./fixtures/forms-render-seeds.mjs";
const { freshSubmissionDb } = await import("./helpers/template-db.mjs");
const { submissionDataExecute } = await import("../build/submission/backend.js");
const { submissionFormsEmitAffidavit, submissionFormsRender } = await import("../build/submission/forms.js");
const { currentSchemaVersion } = await import("../build/submission/migrate.js");
const { callTool } = await import("../build/dispatch.js");
const { exhibitLetters } = await import("../build/submission/forms/render-bcsc-affidavit.js");

const CLIENT = { clientName: "Halloway", clientNo: "9002", matterNo: "L9002" };

// Affidavit #1 (unsworn) attaches the invoice and then the agreement in paragraph 2, so the
// invoice is A. Paragraph 3 attaches the letter, which its linked statement does not tender, and
// that statement tenders the lease, which no affidavit attaches. Paragraph 4 is linked to nothing.
// Affidavit #2 (sworn) attaches the letter first, so its letters start again at A.
const AFFIDAVITS = `
  INSERT INTO hearing_details (filing_id, hearing_date, hearing_time, time_estimate_minutes, associate_judge)
    VALUES (1, '2026-09-01', '9:45 am', 45, 1);
  UPDATE filings SET kind = 'notice_of_application', subkind = NULL, title = 'Notice of Application' WHERE id = 1;

  INSERT INTO witnesses (id, proceeding_id, name) VALUES (10, 1, 'R. Deponent');
  INSERT INTO documents (id, proceeding_id, label, instrument, deponent, affidavit_number, execution, signed_at)
    VALUES
      (20, 1, 'Affidavit #1 of R. Deponent', 'affidavit', 10, '1', NULL, NULL),
      (21, 1, 'Affidavit #2 of R. Deponent', 'affidavit', 10, '2', '2026-08-01', 'Vancouver');
  INSERT INTO documents (id, proceeding_id, label, document_date)
    VALUES
      (30, 1, 'First Amending Agreement', '2024-03-01'),
      (31, 1, 'Invoice 1001', '2024-04-01'),
      (32, 1, 'Letter of 1 May 2024', '2024-05-01'),
      (33, 1, 'Lease', '2023-01-01');
  INSERT INTO filing_documents (filing_id, document_id, ordinal, role) VALUES (1, 20, 2, 'affidavit'), (1, 21, 3, 'affidavit');

  INSERT INTO facts (id, proceeding_id, postulate)
    VALUES
      (10, 1, 'R. Deponent is the plaintiff''s bookkeeper and knows the facts deposed.'),
      (11, 1, 'Document 1.03 on the Defendants'' List of Documents is the First Amending Agreement.'),
      (12, 1, 'Document 1.04 on the Defendants'' List of Documents is Invoice 1001.'),
      (13, 1, 'Document 1.05 on the Defendants'' List of Documents is the letter of 1 May 2024.'),
      (14, 1, 'Document 1.01 on the Defendants'' List of Documents is the Lease.');
  INSERT INTO statements_of_fact (id, proceeding_id, fact_id, witness_id, instrument, exhibit_id, interviewed, excerpt, exhibit_excerpt, exhibit_pinpoint, pinpoint)
    VALUES
      (10, 1, 10, 10, 20, NULL, 1, 'I am the bookkeeper of the plaintiff.', NULL, NULL, 'para 1'),
      (11, 1, 11, 10, 20, 30, 1, NULL, 'FIRST AMENDING AGREEMENT dated March 1, 2024', 'p. 1', 'para 2'),
      (12, 1, 12, 10, 20, 31, 1, NULL, 'INVOICE 1001 dated April 1, 2024', 'p. 1', 'para 2'),
      (13, 1, 13, 10, 21, 32, 1, NULL, 'Letter dated May 1, 2024', 'p. 1', 'para 1'),
      (14, 1, 14, 10, 20, 33, 1, NULL, 'LEASE dated January 1, 2023', 'p. 1', 'para 3');
  INSERT INTO statement_paragraphs (id, document_id, ordinal, text)
    VALUES
      (100, 20, 1, 'I am the bookkeeper of the plaintiff.'),
      (101, 20, 2, 'Attached hereto and marked as {exhibit:31} is a true copy of Invoice 1001, issued under the agreement attached as {exhibit:30}.'),
      (102, 20, 3, 'I wrote to the defendant on 1 May 2024, a copy of which is {exhibit:32}.'),
      (103, 20, 4, 'The defendant never replied.'),
      (110, 21, 1, 'Attached hereto and marked as {exhibit:32} is a true copy of my letter of 1 May 2024.');
  INSERT INTO paragraph_statements_of_fact (statement_paragraph_id, statement_of_fact_id)
    VALUES (100, 10), (101, 11), (101, 12), (102, 14), (110, 13);
`;

async function seedNoticeWithAffidavits(dbPath) {
  await freshSubmissionDb(dbPath);
  await seedBcscDefaultJudgment(dbPath);
  await submissionDataExecute(dbPath, AFFIDAVITS.trim());
}

const markdownOf = (result, fileName) => {
  const doc = result.documents.find((d) => d.file_name === fileName);
  assert.ok(doc, `expected ${fileName} among ${result.documents.map((d) => d.file_name).join(", ")}`);
  return doc.markdown;
};
const paragraph = (md, n) => md.split("\n").find((l) => l.includes(`<!-- statement_paragraph ${n} -->`));

test("exhibit letters follow first appearance and run past Z", () => {
  assert.deepEqual([...exhibitLetters(["{exhibit:7} and {exhibit:3}", "{exhibit:7} then {exhibit:9}"])], [[7, "A"], [3, "B"], [9, "C"]]);
  const many = exhibitLetters([Array.from({ length: 28 }, (_, i) => `{exhibit:${i + 1}}`).join(" ")]);
  assert.equal(many.get(26), "Z");
  assert.equal(many.get(27), "AA");
  assert.equal(many.get(28), "AB");
});

test("a Notice of Application renders one affidavit mockup per supporting affidavit, lettering each from A", async () => {
  const f = seededDbFixture();
  try {
    await seedNoticeWithAffidavits(f.dbPath);
    const result = submissionFormsRender(f.dbPath, 1, CLIENT);
    assert.deepEqual(
      result.documents.filter((d) => d.document_type === "Affidavit").map((d) => d.file_name),
      ["Affidavit #1 of R. Deponent.md", "Affidavit #2 of R. Deponent.md"]
    );
    const first = markdownOf(result, "Affidavit #1 of R. Deponent.md");
    const second = markdownOf(result, "Affidavit #2 of R. Deponent.md");

    assert.match(first, /^This is Affidavit #1 of R\. Deponent in this case and was made on _+\.$/m);
    assert.equal(
      paragraph(first, 2),
      '2. Attached hereto and marked as **Exhibit "A"** is a true copy of Invoice 1001, issued under the agreement attached as **Exhibit "B"**. [facts F11, F12] <!-- statement_paragraph 2 -->'
    );
    assert.match(paragraph(first, 3), /a copy of which is \*\*Exhibit "C"\*\*\./);
    assert.equal(
      paragraph(second, 1),
      '1. Attached hereto and marked as **Exhibit "A"** is a true copy of my letter of 1 May 2024. [facts F13] <!-- statement_paragraph 1 -->',
      "expected the second affidavit's letters to restart at A"
    );
    assert.doesNotMatch(first + second, /\{exhibit:/, "expected no raw token on the mockup");

    // ✒️ on the unsworn affidavit's jurat only.
    assert.match(first, /^SWORN \(OR AFFIRMED\) BEFORE ME at _+, British Columbia on _+\. ✒️$/m);
    assert.match(second, /^SWORN \(OR AFFIRMED\) BEFORE ME at Vancouver, British Columbia on 2026-08-01\.$/m);
  } finally {
    f.cleanup();
  }
});

test("an unknown document name lists each available type once, and a shared type returns both affidavits (#1646)", async () => {
  const f = seededDbFixture();
  try {
    await seedNoticeWithAffidavits(f.dbPath);
    assert.throws(
      () => submissionFormsRender(f.dbPath, 1, CLIENT, "mockup", ["list-names"]),
      (err) => {
        assert.match(err.message, /\(it has: Notice_of_application, Affidavit, Written_arguments, practice_board\)$/);
        return true;
      }
    );
    const affidavits = submissionFormsRender(f.dbPath, 1, CLIENT, "mockup", ["Affidavit"]);
    assert.deepEqual(affidavits.documents.map((d) => d.file_name), ["Affidavit #1 of R. Deponent.md", "Affidavit #2 of R. Deponent.md"]);
  } finally {
    f.cleanup();
  }
});

test("the affidavit mockup marks the three 🧩 cases", async () => {
  const f = seededDbFixture();
  try {
    await seedNoticeWithAffidavits(f.dbPath);
    const first = markdownOf(submissionFormsRender(f.dbPath, 1, CLIENT), "Affidavit #1 of R. Deponent.md");

    // An unlinked paragraph.
    assert.equal(paragraph(first, 4), "4. The defendant never replied. 🧩 [GAP -- no fact linked] <!-- statement_paragraph 4 -->");
    // A token naming a document no statement linked to its paragraph tenders.
    assert.match(
      first,
      /^ {3}🧩 Exhibit "C" \(Letter of 1 May 2024\) is attached here, but no statement of fact linked to this paragraph tenders it <!-- mockup-only -->$/m
    );
    // A linked statement whose exhibit no affidavit in the proceeding attaches.
    assert.match(first, /^ {3}🧩 Lease is tendered by a statement of fact linked to this paragraph, but no affidavit in this proceeding attaches it <!-- mockup-only -->$/m);
    // The letter is attached by Affidavit #2, so its statement there raises nothing.
    // Counted above the closing legend, which lists 🧩 once more.
    assert.equal(first.split("\n## Legend\n")[0].split("🧩").length - 1, 3, "expected exactly the three 🧩 lines");
  } finally {
    f.cleanup();
  }
});

test("an unsworn affidavit with no deponent or no paragraphs shows its 🧩; a sworn one relied on owes none", async () => {
  const f = seededDbFixture();
  try {
    await seedNoticeWithAffidavits(f.dbPath);
    await submissionDataExecute(
      f.dbPath,
      `INSERT INTO documents (id, proceeding_id, label, instrument, deponent, execution)
         VALUES
           (22, 1, 'Affidavit #1 of an unnamed deponent', 'affidavit', NULL, NULL),
           (23, 1, 'Affidavit #3 of R. Deponent', 'affidavit', 10, '2026-07-01');
       INSERT INTO filing_documents (filing_id, document_id, ordinal, role) VALUES (1, 22, 4, 'affidavit'), (1, 23, 5, 'affidavit');`
    );
    const result = submissionFormsRender(f.dbPath, 1, CLIENT);
    const unnamed = markdownOf(result, "Affidavit #1 of an unnamed deponent.md");
    assert.match(unnamed, /^🧩 no deponent recorded <!-- mockup-only -->$/m);
    assert.match(unnamed, /^🧩 no paragraphs drafted <!-- mockup-only -->$/m);
    assert.doesNotMatch(markdownOf(result, "Affidavit #3 of R. Deponent.md"), /🧩/);
  } finally {
    f.cleanup();
  }
});

test("the filed render withholds every mockup-only line of the affidavit", async () => {
  const f = seededDbFixture();
  try {
    await seedNoticeWithAffidavits(f.dbPath);
    const filed = submissionFormsRender(f.dbPath, 1, {}, "filed").documents.find((d) => d.file_name === "Affidavit #1 of R. Deponent.md").markdown;
    assert.doesNotMatch(filed, /🧩|✒️|<!--|\[facts|\{exhibit:/);
    assert.match(filed, /^2\. Attached hereto and marked as \*\*Exhibit "A"\*\* is a true copy of Invoice 1001/m);
  } finally {
    f.cleanup();
  }
});

test("the Notice of Application lists each supporting affidavit in Part 4", async () => {
  const f = seededDbFixture();
  try {
    await seedNoticeWithAffidavits(f.dbPath);
    const noa = markdownOf(submissionFormsRender(f.dbPath, 1, CLIENT), "Notice of Application.md");
    const part4 = noa.slice(noa.indexOf("## PART 4: MATERIAL TO BE RELIED ON"));
    assert.match(part4, /^2\. Affidavit #1 of R\. Deponent .*<!-- document 2 -->$/m);
    assert.match(part4, /^3\. Affidavit #2 of R\. Deponent .*<!-- document 3 -->$/m);
    assert.doesNotMatch(part4, /First Amending Agreement|Invoice 1001/, "expected the exhibits listed through the affidavit alone");
  } finally {
    f.cleanup();
  }
});

test("revising an affidavit is a write followed by a re-render", async () => {
  const f = seededDbFixture();
  try {
    await seedNoticeWithAffidavits(f.dbPath);
    submissionFormsRender(f.dbPath, 1, CLIENT);
    await submissionDataExecute(f.dbPath, "UPDATE statement_paragraphs SET text = 'The defendant has not replied to date.' WHERE id = 103;");
    const first = markdownOf(submissionFormsRender(f.dbPath, 1, CLIENT), "Affidavit #1 of R. Deponent.md");
    assert.match(paragraph(first, 4), /^4\. The defendant has not replied to date\. /);
  } finally {
    f.cleanup();
  }
});

test("an Application Response renders its supporting affidavit and lists it in Part 6", async () => {
  const f = seededDbFixture();
  try {
    await freshSubmissionDb(f.dbPath);
    await seedApplicationResponse(f.dbPath);
    await submissionDataExecute(
      f.dbPath,
      `INSERT INTO witnesses (id, proceeding_id, name) VALUES (10, 1, 'S. Responder');
       INSERT INTO documents (id, proceeding_id, label, instrument, deponent, affidavit_number)
         VALUES (20, 1, 'Affidavit #1 of S. Responder', 'affidavit', 10, '1');
       INSERT INTO filing_documents (filing_id, document_id, ordinal, role) VALUES (1, 20, 2, 'affidavit');
       INSERT INTO statement_paragraphs (id, document_id, ordinal, text) VALUES (100, 20, 1, 'I am the defendant''s controller.');`
    );
    const result = submissionFormsRender(f.dbPath, 1, CLIENT);
    // The seed's own role='affidavit' row names a plain document, listed for Part 6 alone.
    assert.deepEqual(
      result.documents.filter((d) => d.document_type === "Affidavit").map((d) => d.file_name),
      ["Affidavit #1 of S. Responder.md"]
    );
    const ar = markdownOf(result, "Application Response.md");
    assert.match(ar.slice(ar.indexOf("## PART 6: MATERIAL TO BE RELIED ON")), /Affidavit #1 of S\. Responder/);
  } finally {
    f.cleanup();
  }
});

// drafting_forms__emit_affidavit (#1487). The seed's three 🧩 are cleared here: paragraph 3 (the
// untendered letter, linked to the unattached lease) and paragraph 4 (unlinked) are removed, which
// leaves Affidavit #1 lettering Invoice 1001 A and the agreement B, and Affidavit #2 the letter A.
const CLEAR_GAPS = `
  DELETE FROM paragraph_statements_of_fact WHERE statement_paragraph_id = 102;
  DELETE FROM statement_paragraphs WHERE id IN (102, 103);
`;

async function seedCleanAffidavits(dbPath) {
  await seedNoticeWithAffidavits(dbPath);
  await submissionDataExecute(dbPath, CLEAR_GAPS.trim());
}

const numbered = (md) => md.split("\n").filter((l) => /^\d+\. /.test(l));
const frontmatter = (md, key) => md.split("\n").find((l) => l.startsWith(`${key}: `))?.slice(key.length + 2);

test("the emitted affidavit matches the mockup's paragraph text and letters at the same revision, each affidavit from A", async () => {
  const f = seededDbFixture();
  try {
    await seedCleanAffidavits(f.dbPath);
    const filed = submissionFormsRender(f.dbPath, 1, {}, "filed");
    for (const [documentId, fileName] of [
      [20, "Affidavit #1 of R. Deponent.md"],
      [21, "Affidavit #2 of R. Deponent.md"],
    ]) {
      const emitted = submissionFormsEmitAffidavit(f.dbPath, 1, documentId);
      assert.equal(emitted.revision, filed.revision);
      assert.equal(emitted.file_name, `affidavit-${documentId}.md`);
      assert.deepEqual(numbered(emitted.markdown), numbered(markdownOf(filed, fileName)));
    }

    // Affidavit #1 is unsworn (execution NULL) and still emits.
    const first = submissionFormsEmitAffidavit(f.dbPath, 1, 20).markdown;
    assert.equal(frontmatter(first, "deponent"), "R. Deponent");
    assert.equal(frontmatter(first, "affidavit_number"), "1");
    assert.deepEqual(JSON.parse(frontmatter(first, "exhibits")), [
      { letter: "A", label: "Invoice 1001", file_path: null },
      { letter: "B", label: "First Amending Agreement", file_path: null },
    ]);
    assert.deepEqual(JSON.parse(frontmatter(submissionFormsEmitAffidavit(f.dbPath, 1, 21).markdown, "exhibits")), [
      { letter: "A", label: "Letter of 1 May 2024", file_path: null },
    ]);
    assert.doesNotMatch(first, /🧩|✒️|<!--|\[facts|\{exhibit:/);
    assertMatchesGolden("affidavit-emitted", first);
  } finally {
    f.cleanup();
  }
});

test("the emitter refuses on each 🧩 the mockup shows and on a NULL affidavit_number", async () => {
  const cases = [
    ["an unlinked paragraph", `INSERT INTO statement_paragraphs (id, document_id, ordinal, text) VALUES (103, 20, 4, 'The defendant never replied.');`, /no fact linked/],
    [
      "a token no linked statement tenders",
      `INSERT INTO statement_paragraphs (id, document_id, ordinal, text) VALUES (102, 20, 3, 'I wrote on 1 May 2024, a copy of which is {exhibit:32}.');
       INSERT INTO paragraph_statements_of_fact (statement_paragraph_id, statement_of_fact_id) VALUES (102, 10);`,
      /Exhibit "C" \(Letter of 1 May 2024\) is attached here, but no statement of fact linked to this paragraph tenders it/,
    ],
    [
      "a tendered exhibit no affidavit in the proceeding attaches",
      `INSERT INTO paragraph_statements_of_fact (statement_paragraph_id, statement_of_fact_id) VALUES (100, 14);`,
      /Lease is tendered by a statement of fact linked to this paragraph, but no affidavit in this proceeding attaches it/,
    ],
    ["no deponent", `UPDATE documents SET deponent = NULL WHERE id = 20;`, /no deponent recorded/],
    [
      "no paragraphs drafted",
      `DELETE FROM paragraph_statements_of_fact WHERE statement_paragraph_id IN (100, 101);
       DELETE FROM statement_paragraphs WHERE document_id = 20;`,
      /no paragraphs drafted/,
    ],
    ["a NULL affidavit_number", `UPDATE documents SET affidavit_number = NULL WHERE id = 20;`, /its affidavit number is not recorded/],
  ];
  for (const [name, sql, message] of cases) {
    const f = seededDbFixture();
    try {
      await seedCleanAffidavits(f.dbPath);
      await submissionDataExecute(f.dbPath, sql);
      assert.throws(() => submissionFormsEmitAffidavit(f.dbPath, 1, 20), message, name);
    } finally {
      f.cleanup();
    }
  }
});

test("the emitter refuses a sworn affidavit with no paragraphs, a document the filing does not list as an affidavit, and another filing kind", async () => {
  const f = seededDbFixture();
  try {
    await seedCleanAffidavits(f.dbPath);
    await submissionDataExecute(
      f.dbPath,
      `DELETE FROM paragraph_statements_of_fact WHERE statement_paragraph_id = 110;
       DELETE FROM statement_paragraphs WHERE id = 110;`
    );
    assert.throws(() => submissionFormsEmitAffidavit(f.dbPath, 1, 21), /no paragraphs are stored/);
    assert.throws(() => submissionFormsEmitAffidavit(f.dbPath, 1, 30), /is not an affidavit listed as supporting/);
  } finally {
    f.cleanup();
  }

  const g = seededDbFixture();
  try {
    await freshSubmissionDb(g.dbPath);
    await seedBcscDefaultJudgment(g.dbPath);
    assert.throws(() => submissionFormsEmitAffidavit(g.dbPath, 1, 1), /the only Writings whose supporting affidavits are made here/);
  } finally {
    g.cleanup();
  }
});

test("the emitter refuses a database ahead of the installed bundle", async () => {
  const f = seededDbFixture();
  try {
    await freshSubmissionDb(f.dbPath);
    await submissionDataExecute(f.dbPath, `UPDATE db_meta SET value = '${currentSchemaVersion() + 1}' WHERE key = 'schema_version';`);
    const result = submissionFormsEmitAffidavit(f.dbPath, 1, 20);
    assert.equal(result.bundle_outdated, true);
    assert.match(result.note, /drafting_forms__emit_affidavit/);
  } finally {
    f.cleanup();
  }
});

test("given case_data_folder, the tool writes bcsc-form-substance\\affidavit-<id>.md, and refuses any other folder", async () => {
  const f = seededDbFixture();
  try {
    await seedCleanAffidavits(f.dbPath);
    const caseData = dirname(f.dbPath);
    const result = await callTool({}, "drafting_forms__emit_affidavit", { db_path: f.dbPath, filing_id: 1, document_id: 20, case_data_folder: caseData });
    const expected = join(realpathSync.native(caseData), "bcsc-form-substance", "affidavit-20.md");
    assert.equal(result.written_path, expected);
    assert.equal(readFileSync(expected, "utf-8"), result.markdown);

    const other = join(f.dir, "other");
    mkdirSync(other);
    assert.throws(() => submissionFormsEmitAffidavit(f.dbPath, 1, 20, other), (err) => err.code === "path_out_of_scope");
  } finally {
    f.cleanup();
  }
});
