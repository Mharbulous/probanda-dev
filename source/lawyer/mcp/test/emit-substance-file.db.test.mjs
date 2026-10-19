// emit_form32 / emit_form33's optional case_data_folder (#1267, ADR 0025): the server writes the
// filed face to <matter-data folder>\bcsc-form-substance\form-3N.md, where publish-bcsc-form's
// asm32/asm33 locate steps read it. Temp directories only.

import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import { DEFAULT_JUDGMENT_CASE_DATA, seedApplicationResponse } from "./fixtures/forms-render-seeds.mjs";

const { freshSubmissionDb } = await import("./helpers/template-db.mjs");
const { writePartiesOfRecord } = await import("./helpers/matter-data-fixture.mjs");
const { submissionFormsEmitForm32, submissionFormsEmitForm33 } = await import("../build/submission/forms.js");
const { writeSubstanceFile } = await import("../build/submission/substance-file.js");
const { callTool } = await import("../build/dispatch.js");
const { submissionDataExecute } = await import("../build/submission/backend.js");

function caseDataFixture() {
  const base = mkdtempSync(join(tmpdir(), "coclerk-emit-substance-"));
  const caseData = join(base, "Matter case data");
  mkdirSync(caseData);
  return { base, caseData, dbPath: join(caseData, "submission.sqlite"), cleanup: () => rmSync(base, { recursive: true, force: true }) };
}

function codeOf(fn) {
  try {
    fn();
  } catch (err) {
    return err.code;
  }
  throw new Error("expected a throw, got none");
}

// Copied from form32-emitter.db.test.mjs, which holds the reviewed data it seeds.
async function seedNoticeOfApplication(dbPath) {
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

    INSERT INTO order_sought (id, proceeding_id, wording)
      VALUES (1, 1, 'damages to be assessed'), (2, 1, 'costs to be assessed');

    INSERT INTO documents (id, proceeding_id, label, document_date, description, file_path)
      VALUES (1, 1, 'Draft default judgment', '2026-08-01', NULL, NULL);

    INSERT INTO filings (id, proceeding_id, kind, subkind, round, title)
      VALUES (1, 1, 'notice_of_application', NULL, NULL, 'Notice of Application');

    INSERT INTO filing_orders (filing_id, order_sought_id, document, ordinal) VALUES (1, 1, 'form', 1), (1, 2, 'form', 3);
    INSERT INTO filing_documents (filing_id, document_id, ordinal, role) VALUES (1, 1, 1, 'order');

    INSERT INTO hearing_details (filing_id, hearing_date, hearing_time, time_estimate_minutes, associate_judge)
      VALUES (1, '2026-09-01', '9:45 am', 45, 1);

    INSERT INTO facts (id, proceeding_id, postulate)
      VALUES
        (1, 1, 'Corbin Vasey has not filed a response to civil claim.'),
        (2, 1, 'The property was inspected and found vacant on the relevant date.'),
        (3, 1, 'The final walkthrough occurred before handover.');
    INSERT INTO filing_facts (filing_id, fact_id, document, part, ordinal) VALUES (1, 1, 'form', 'part2', 1), (1, 2, 'form', 'part2', 2), (1, 3, 'form', 'part2', 3);
    -- Fact 1's Written Argument pointer, carrying this kind's own part value
    -- exactly as checklists section 9 requires of a both-documents pair. It is
    -- an accounting pointer only and must never reach the filed face.
    INSERT INTO filing_facts (filing_id, fact_id, document, part, ordinal) VALUES (1, 1, 'written_argument', 'part2', 1);

    INSERT INTO authorities (id, proceeding_id, style_of_cause_or_title, citation, kind, weight, treatment)
      VALUES (1, 1, 'Miazga v. Kvello Estate', '2009 SCC 51', 'case', 'binding', 'good_law');
    INSERT INTO submissions (id, proceeding_id, contention, ordinal)
      VALUES (1, 1, 'Corbin Vasey is in default under the Rules.', 1);
    INSERT INTO law_assertions (id, proceeding_id, proposition, dead_end)
      VALUES (1, 1, 'a defendant who fails to file a response to civil claim within the prescribed time is in default', 0);
    INSERT INTO statements_of_law (id, proceeding_id, law_assertion_id, authority_id, pinpoint, excerpt, verification)
      VALUES (1, 1, 1, 1, 'para 15', 'default judgment may be entered once the response period has expired without a filed response', 'verified');
    INSERT INTO submission_law (submission_id, law_assertion_id) VALUES (1, 1);
    INSERT INTO submission_facts (submission_id, fact_id) VALUES (1, 1);
    INSERT INTO filing_submissions (filing_id, submission_id, document, ordinal) VALUES (1, 1, 'form', 1);

    -- Crossed-out order interleaved at ordinal 2, between the two live orders
    -- (proves it's excluded and the live ones renumber contiguously, not
    -- just happen to already be contiguous).
    INSERT INTO order_sought (id, proceeding_id, wording, crossed_out_on)
      VALUES (4, 1, 'leave to file a further affidavit at the hearing', '2026-08-20');
    INSERT INTO filing_orders (filing_id, order_sought_id, document, ordinal) VALUES (1, 4, 'form', 2);

    -- Revision reset LAST: schema v21 triggers move db_meta.revision on every seeded row (#607).
    UPDATE db_meta SET value = '1' WHERE key = 'revision';
    `.trim()
  );
}

test("given case_data_folder, emit_form32 writes its markdown to bcsc-form-substance\\form-32.md and reports the path", async () => {
  const f = caseDataFixture();
  try {
    await freshSubmissionDb(f.dbPath);
    await seedNoticeOfApplication(f.dbPath);
    const result = submissionFormsEmitForm32(f.dbPath, 1, f.caseData);
    const expected = join(realpathSync.native(f.caseData), "bcsc-form-substance", "form-32.md");
    assert.equal(result.written_path, expected);
    assert.equal(readFileSync(expected, "utf-8"), result.markdown);
    assert.equal("written_path" in submissionFormsEmitForm32(f.dbPath, 1), false);
  } finally {
    f.cleanup();
  }
});

test("given case_data_folder, emit_form33 writes its markdown to bcsc-form-substance\\form-33.md and reports the path", async () => {
  const f = caseDataFixture();
  try {
    await freshSubmissionDb(f.dbPath);
    await seedApplicationResponse(f.dbPath);
    const result = submissionFormsEmitForm33(f.dbPath, 1, f.caseData);
    const expected = join(realpathSync.native(f.caseData), "bcsc-form-substance", "form-33.md");
    assert.equal(result.written_path, expected);
    assert.equal(readFileSync(expected, "utf-8"), result.markdown);

    // A second emit replaces the working file in place.
    writeFileSync(expected, "stale");
    submissionFormsEmitForm33(f.dbPath, 1, f.caseData);
    assert.equal(readFileSync(expected, "utf-8"), result.markdown);
  } finally {
    f.cleanup();
  }
});

test("without case_data_folder, emit_form33 writes nothing, as before", async () => {
  const f = caseDataFixture();
  try {
    await freshSubmissionDb(f.dbPath);
    await seedApplicationResponse(f.dbPath);
    const result = submissionFormsEmitForm33(f.dbPath, 1);
    assert.equal("written_path" in result, false);
    assert.equal(existsSync(join(f.caseData, "bcsc-form-substance")), false);
  } finally {
    f.cleanup();
  }
});

test("a case_data_folder that is not the folder holding db_path is refused before anything is read or written", async () => {
  const f = caseDataFixture();
  const other = join(f.base, "Other case data");
  mkdirSync(other);
  try {
    // db_path's folder exists but holds no database: the refusal comes first.
    for (const emit of [submissionFormsEmitForm32, submissionFormsEmitForm33]) {
      assert.equal(codeOf(() => emit(f.dbPath, 1, other)), "path_out_of_scope");
      assert.equal(codeOf(() => emit(f.dbPath, 1, "Matter case data")), "path_out_of_scope");
      assert.equal(codeOf(() => emit(f.dbPath, 1, join(f.base, "missing"))), "case_data_missing");
    }
    for (const tool of ["drafting_forms__emit_form32", "drafting_forms__emit_form33"]) {
      await assert.rejects(callTool({}, tool, { db_path: f.dbPath, filing_id: 1, case_data_folder: other }), (err) => err.code === "path_out_of_scope");
    }
    assert.deepEqual(readdirSync(other), []);
    assert.deepEqual(readdirSync(f.caseData), []);
  } finally {
    f.cleanup();
  }
});

test("the write creates only the substance subfolder, and refuses a subfolder that is a link elsewhere", () => {
  const f = caseDataFixture();
  const outside = mkdtempSync(join(tmpdir(), "coclerk-outside-"));
  try {
    const path = writeSubstanceFile(f.caseData, "form-32.md", "# Form 32\n");
    assert.equal(path, join(f.caseData, "bcsc-form-substance", "form-32.md"));
    assert.equal(readFileSync(path, "utf-8"), "# Form 32\n");
    assert.deepEqual(readdirSync(f.caseData), ["bcsc-form-substance"]);

    rmSync(join(f.caseData, "bcsc-form-substance"), { recursive: true });
    symlinkSync(outside, join(f.caseData, "bcsc-form-substance"), "junction");
    assert.equal(codeOf(() => writeSubstanceFile(f.caseData, "form-33.md", "x")), "path_out_of_scope");
    assert.deepEqual(readdirSync(outside), []);
  } finally {
    f.cleanup();
    rmSync(outside, { recursive: true, force: true });
  }
});
