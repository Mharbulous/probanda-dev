// Issue #458: every face of one filing numbers "Ex. N" identically. A witness
// statement is its own rendered document, never an exhibit, so a
// witness_statement row ordered ahead of an evidence row must not shift the
// evidence's number on the Notice of Application -- mockup or filed face --
// relative to the Written Arguments, and never lists in Part 4.

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

const { freshSubmissionDb } = await import("./helpers/template-db.mjs");
const { DEFAULT_JUDGMENT_CASE_DATA } = await import("./fixtures/forms-render-seeds.mjs");
const { writePartiesOfRecord } = await import("./helpers/matter-data-fixture.mjs");
const { submissionDataExecute } = await import("../build/submission/backend.js");
const { submissionFormsRender, submissionFormsEmitForm32 } = await import("../build/submission/forms.js");

async function seedNoticeOfApplicationWithWitnessStatementFirst(dbPath) {
  writePartiesOfRecord(dirname(dbPath), DEFAULT_JUDGMENT_CASE_DATA);
  await submissionDataExecute(
    dbPath,
    `
    INSERT INTO proceedings (id, matter_reference, forum, court_or_centre, registry, file_number, style_of_cause, courthouse_address)
      VALUES (1, 'L9002 - Halloway', 'CAN/BC/BCSC', 'BC Supreme Court', 'Vancouver', 'S-901433', 'Halloway v. Vasey', '800 Smithe Street');
    INSERT INTO parties (id, proceeding_id, name, role, ordinal, is_client, is_applicant, to_be_served, case_party_id)
      VALUES
        (1, 1, 'Wren Halloway', 'Plaintiff', 1, 1, 1, 0, 1),
        (2, 1, 'Corbin Vasey', 'Defendant', 2, 0, 0, 1, 2);

    INSERT INTO filings (id, proceeding_id, kind, subkind, round, title)
      VALUES (1, 1, 'notice_of_application', NULL, NULL, 'Notice of Application');
    INSERT INTO hearing_details (filing_id, hearing_date, hearing_time, time_estimate_minutes, associate_judge)
      VALUES (1, '2026-09-01', '9:45 am', 45, 1);
    INSERT INTO order_sought (id, proceeding_id, wording) VALUES (1, 1, 'damages to be assessed');
    INSERT INTO filing_orders (filing_id, order_sought_id, document, ordinal) VALUES (1, 1, 'form', 1);

    -- The witness statement sits at ordinal 1, ahead of the only exhibit.
    INSERT INTO witnesses (id, proceeding_id, name) VALUES (1, 1, 'A. Renwick');
    INSERT INTO documents (id, proceeding_id, label, instrument, deponent)
      VALUES (1, 1, 'Witness Statement of A. Renwick', 'witness_statement', 1);
    INSERT INTO documents (id, proceeding_id, label, document_date)
      VALUES (2, 1, 'Invoice #114', '2026-03-01');
    INSERT INTO filing_documents (filing_id, document_id, ordinal, role)
      VALUES (1, 1, 1, 'witness_statement'), (1, 2, 2, 'evidence');

    INSERT INTO facts (id, proceeding_id, postulate) VALUES (1, 1, 'Corbin Vasey was invoiced $4,200.');
    INSERT INTO filing_facts (filing_id, fact_id, document, part, ordinal) VALUES (1, 1, 'form', 'part2', 1);
    INSERT INTO statements_of_fact (id, proceeding_id, fact_id, witness_id, instrument, exhibit_id, pinpoint, exhibit_excerpt, exhibit_pinpoint, interviewed)
      VALUES (1, 1, 1, 1, 1, 2, 'para 1', 'Total due: $4,200', 'p. 1', 1);

    -- One submission on both faces, citing the invoice through fact 1's statement.
    INSERT INTO submissions (id, proceeding_id, contention, ordinal) VALUES (1, 1, 'Corbin Vasey owes the invoiced amount.', 1);
    INSERT INTO submission_facts (submission_id, fact_id) VALUES (1, 1);
    INSERT INTO filing_submissions (filing_id, submission_id, document, ordinal)
      VALUES (1, 1, 'form', 1), (1, 1, 'written_argument', 1);

    -- Revision reset LAST: schema v21 triggers move db_meta.revision on every seeded row (#607).
    UPDATE db_meta SET value = '1' WHERE key = 'revision';
    `.trim()
  );
}

test("a witness statement ahead of an exhibit shifts no Ex. N on the Notice of Application and stays out of Part 4", async () => {
  const dir = mkdtempSync(join(tmpdir(), "coclerk-exhibit-numbering-"));
  const matter = join(dir, "L4801 Matter");
  mkdirSync(join(matter, "0. CASE DATA"), { recursive: true });
  mkdirSync(join(matter, "0. DRAFT"));
  const dbPath = join(matter, "0. CASE DATA", "submission.sqlite");
  try {
    await freshSubmissionDb(dbPath);
    await seedNoticeOfApplicationWithWitnessStatementFirst(dbPath);

    const { documents } = submissionFormsRender(dbPath, 1, { clientName: "Ledger", clientNo: "1", matterNo: "L1" });
    const noa = documents.find((d) => d.document_type === "Notice_of_application").markdown;
    const wa = documents.find((d) => d.document_type === "Written_arguments").markdown;
    const filed = submissionFormsEmitForm32(dbPath, 1).markdown;

    assert.match(wa, /> Witness Statement of A\. Renwick, para 1, Ex\. 1, p\. 1/, "expected the Written Arguments to number the invoice Ex. 1");
    // Fact 1 is Part 2 paragraph 1, so neither Notice of Application face re-prints it, or the
    // statement's citation line, under Part 3: the mockup names it by number, the filed face omits it.
    assert.match(noa, /<!-- submission_id 1 --> <!-- supporting fact paragraphs: 1 -->/, "expected the Notice of Application mockup to reference fact 1's Part 2 paragraph");
    assert.match(filed.split("## Part 3")[0], /^>> Witness Statement of A\. Renwick, para 1, Ex\. 1, p\. 1$/m, "expected the filed face's Part 2 to cite the statement under fact 1");
    assert.doesNotMatch(filed.split("## Part 3")[1], /Witness Statement of A\. Renwick/, "expected the filed face to state fact 1 once, in Part 2, with no citation line under Part 3");

    const noaPart4 = noa.split("## PART 4: MATERIAL TO BE RELIED ON")[1];
    const noaPart4Items = noaPart4.split("\n").filter((l) => /<!-- document \d+ -->$/.test(l));
    assert.equal(noaPart4Items.length, 1, `expected Part 4 to list the invoice only; got: ${noaPart4Items.join(" | ")}`);
    assert.match(noaPart4Items[0], /^1\. Invoice #114 \(2026-03-01\)/);

    assert.equal(
      filed.split("## Part 4")[1].trim(),
      "- Invoice #114 (March 1, 2026)\n- Pleadings filed in this proceeding",
      "expected the filed face's Part 4 to list the invoice, its date as Form 32 prints it, then the pleadings line alone"
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
