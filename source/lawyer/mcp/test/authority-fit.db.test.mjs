// Authority-fit checks (schema v61; planning/1. Design/2026-10-06_authority-fit-checks-spec.md),
// through the real renderer.
//
// A case decided before a provision its proposition also cites came into force carries 🕰️ on its
// statement line; an excerpt the judgment quotes from another source carries a plain-text
// "(quoting <source>)" tag. Both render on the mockup for the human and never on the filed face.
//
// Seed pattern follows scrutiny-settled.db.test.mjs. All names are synthetic.

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

const { freshSubmissionDb } = await import("./helpers/template-db.mjs");
const { writePartiesOfRecord } = await import("./helpers/case-data-fixture.mjs");
const { assertFiledFaceDocumentsClean } = await import("./helpers/filed-face-scan.mjs");
const { submissionDataExecute } = await import("../build/submission/backend.js");
const { submissionFormsRender } = await import("../build/submission/forms.js");

const CASE_DATA = {
  parties: [
    { id: 1, name: "Claimant Co.", counsel_name: "A. Lawyer" },
    { id: 2, name: "Respondent Co." },
  ],
};

const SEED = `
INSERT INTO proceedings (id, matter_reference, forum, court_or_centre, registry, file_number, style_of_cause, courthouse_address)
  VALUES (1, 'L9061 - Fit', 'CAN/BC/Vancouver-International-Arbitration-Centre', 'VanIAC', NULL, NULL, 'Fit v. Test', NULL);

INSERT INTO parties (id, proceeding_id, name, role, ordinal, is_client, is_applicant, to_be_served, case_party_id)
  VALUES
    (1, 1, 'Claimant Co.', 'Claimant', 1, 1, 1, 0, 1),
    (2, 1, 'Respondent Co.', 'Respondent', 2, 0, 0, 1, 2);

INSERT INTO filings (id, proceeding_id, kind, subkind, round, title)
  VALUES (1, 1, 'submissions_package', NULL, 'opening', 'Opening Submissions Package');

INSERT INTO authorities (id, proceeding_id, style_of_cause_or_title, citation, kind, weight, treatment, currency_status, currency_checked_on)
  VALUES
    (1, 1, 'Older Case v. Example', '2011 BCCA 1', 'case', 'binding', 'good_law', NULL, NULL),
    (2, 1, 'Example Act', 'SBC 2020, c 1', 'statute', 'binding', NULL, 'current', '2026-10-01'),
    (3, 1, 'Later Case v. Example', '2022 BCCA 2', 'case', 'binding', 'good_law', NULL, NULL),
    (4, 1, 'Revised Example Act', 'RSBC 1996, c 1', 'statute', 'binding', NULL, 'current', '2026-10-01'),
    (5, 1, 'Mid Case v. Example', '2010 BCCA 3', 'case', 'binding', 'good_law', NULL, NULL);

INSERT INTO submissions (id, proceeding_id, contention, ordinal) VALUES (1, 1, 'A deployed contention.', 1);
INSERT INTO filing_submissions (filing_id, submission_id, document, ordinal) VALUES (1, 1, 'form', 1);

INSERT INTO law_assertions (id, proceeding_id, proposition, dead_end)
  VALUES
    (1, 1, 'a proposition citing a case and a later Act', 0),
    (2, 1, 'a proposition citing a section brought into force later', 0);
INSERT INTO submission_law (submission_id, law_assertion_id) VALUES (1, 1), (1, 2);

INSERT INTO statements_of_law (id, proceeding_id, law_assertion_id, authority_id, pinpoint, excerpt, source, verification,
                               scrutinized_authority_id, scrutinized_pinpoint, scrutinized_excerpt, excerpt_speaker, verified_on)
  VALUES
    (1, 1, 1, 1, 'para 12', 'A passage the court quotes from an earlier decision.', 'primary', 'verified',
     1, 'para 12', 'A passage the court quotes from an earlier decision.', 'Lord Example in An Earlier Case', '2026-10-06'),
    (2, 1, 1, 2, 's 3', 'The text of section 3.', 'primary', 'verified', 2, 's 3', 'The text of section 3.', NULL, '2026-10-06'),
    (3, 1, 1, 3, 'para 7', 'A passage in the court''s own words.', 'primary', 'verified',
     3, 'para 7', 'A passage in the court''s own words.', NULL, '2026-10-06'),
    (4, 1, 2, 4, 's 9', 'The text of section 9.', 'primary', 'verified', 4, 's 9', 'The text of section 9.', NULL, '2026-10-06'),
    (5, 1, 2, 5, 'para 4', 'A passage on section 9.', 'primary', 'verified', 5, 'para 4', 'A passage on section 9.', NULL, '2026-10-06');

INSERT INTO provision_currency (authority_id, provision, currency_status, checked_on, current_to, in_force_on)
  VALUES (2, 's 3', 'current', '2026-10-01', '2026-09-01', NULL),
         (4, 's 9', 'current', '2026-10-01', '2026-09-01', '2015-03-01');

UPDATE db_meta SET value = '1' WHERE key = 'revision';
`.trim();

const CLIENT = { clientName: "Fit", clientNo: "9061", matterNo: "L9061" };
const QUOTING = " (quoting Lord Example in An Earlier Case)";

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "coclerk-authority-fit-"));
  return { dbPath: join(dir, "submission.sqlite"), cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

async function seeded(f) {
  await freshSubmissionDb(f.dbPath);
  writePartiesOfRecord(dirname(f.dbPath), CASE_DATA);
  await submissionDataExecute(f.dbPath, SEED);
}

function doc(result, type) {
  const d = result.documents.find((x) => x.document_type === type);
  assert.ok(d, `expected a ${type} document`);
  return d;
}

/** The marker line traced `trace`, and the citation line just above it. */
function traced(md, trace) {
  const lines = md.split("\n");
  const i = lines.findIndex((l) => l.includes(trace));
  assert.ok(i > 0, `expected a line traced ${trace}`);
  return { line: lines[i], before: lines[i - 1] };
}

test("a case decided before a linked provision carries 🕰️ and its quoting tag on the mockup, and neither on the filed face", async () => {
  const f = fixture();
  try {
    await seeded(f);
    const md = doc(submissionFormsRender(f.dbPath, 1, CLIENT), "Written_arguments").markdown;

    const older = traced(md, "<!-- statement_of_law_id 1 -->");
    assert.match(older.line, /🕰️/, older.line);
    assert.ok(older.before.endsWith(`*Older Case v. Example*, 2011 BCCA 1, para 12${QUOTING}`), older.before);

    // The Act itself and a case decided after it carry neither.
    for (const id of [2, 3]) {
      const s = traced(md, `<!-- statement_of_law_id ${id} -->`);
      assert.doesNotMatch(s.line, /🕰️/, s.line);
      assert.doesNotMatch(s.before, /quoting/, s.before);
    }

    const filed = submissionFormsRender(f.dbPath, 1, CLIENT, "filed");
    const face = doc(filed, "Written_arguments").markdown;
    assert.ok(face.includes("*Older Case v. Example*, 2011 BCCA 1, para 12"), "expected the verified citation on the filed face");
    assert.ok(face.includes("A passage the court quotes from an earlier decision."), "expected the excerpt on the filed face");
    assert.doesNotMatch(face, /quoting|🕰/, "expected no quoting tag and no 🕰️ on the filed face");
    assertFiledFaceDocumentsClean(filed.documents);
  } finally {
    f.cleanup();
  }
});

test("a recorded in-force date outranks the provision's citation year", async () => {
  const f = fixture();
  try {
    await seeded(f);
    const md = doc(submissionFormsRender(f.dbPath, 1, CLIENT), "Written_arguments").markdown;
    // RSBC 1996 alone would not flag a 2010 case; the section's 2015 in-force date does.
    assert.match(traced(md, "<!-- statement_of_law_id 5 -->").line, /🕰️/);
    await submissionDataExecute(f.dbPath, "UPDATE provision_currency SET in_force_on = NULL WHERE authority_id = 4;");
    const after = doc(submissionFormsRender(f.dbPath, 1, CLIENT), "Written_arguments").markdown;
    assert.doesNotMatch(traced(after, "<!-- statement_of_law_id 5 -->").line, /🕰️/);
  } finally {
    f.cleanup();
  }
});

test("a verified statement with no pinpoint is refused", async () => {
  const f = fixture();
  try {
    await seeded(f);
    await assert.rejects(
      () => submissionDataExecute(
        f.dbPath,
        "INSERT INTO statements_of_law (proceeding_id, law_assertion_id, authority_id, verification) VALUES (1, 1, 3, 'verified');"
      ),
      /needs a pinpoint/
    );
  } finally {
    f.cleanup();
  }
});
