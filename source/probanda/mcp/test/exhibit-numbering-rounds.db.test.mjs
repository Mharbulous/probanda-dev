// Issue #712: exhibit numbering across a proceeding's rounds.
//
// A document keeps one Ex. N for the life of a VanIAC proceeding, so an exhibit first produced in
// the Opening is still Ex. 2 when the Reply cites it, and the Reply's own new exhibits continue
// after the highest already assigned. Neither forum requires this -- the VanIAC Rules never say
// "exhibit", and Supreme Court Civil Rules 22-2 and 8-1 read complete impose nothing on labelling
// across rounds -- so it is the firm's convention, settled on #712.
//
// Companion to exhibit-numbering.db.test.mjs (#458), which pins that every face of ONE filing
// numbers identically. That invariant is unchanged; this file adds the cross-round dimension.

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const { freshSubmissionDb } = await import("./helpers/template-db.mjs");
const { submissionDataExecute } = await import("../build/submission/backend.js");
const { fetchProceedingExhibitNumbers } = await import("../build/submission/forms/render-vaniac-submissions.js");
const { checkExhibitNumbering, extractExhibitReferences } = await import("../build/submission/pre-filing/checks.js");

/** A VanIAC proceeding with a FILED Opening (three exhibits) and a DRAFT Reply that relies on the
 * Opening's second exhibit plus two new documents. Document 2 is the shared one. */
async function seedOpeningAndReply(dbPath) {
  await submissionDataExecute(
    dbPath,
    `
    INSERT INTO proceedings (id, matter_reference, forum, court_or_centre, file_number, style_of_cause)
      VALUES (1, 'L9100 - Terrace Holdings', 'CAN/BC/Vancouver-International-Arbitration-Centre', 'VanIAC', 'DCA-24-118', 'Terrace Holdings v. Brackwell');

    -- Both start as drafts. The Opening is marked filed only AFTER its exhibits are linked: the
    -- 23->24 guards refuse a filing_documents write against an already-filed filing, so
    -- draft -> link exhibits -> file is the only order that works. That is the real authoring
    -- order, and the guard enforcing it is the point of the hop.
    INSERT INTO filings (id, proceeding_id, kind, round, title, filed_on)
      VALUES (1, 1, 'submissions_package', 'opening', 'Opening Submissions', NULL);
    INSERT INTO filings (id, proceeding_id, kind, round, title, filed_on)
      VALUES (2, 1, 'submissions_package', 'reply', 'Reply Submissions', NULL);

    INSERT INTO documents (id, proceeding_id, label, document_date) VALUES
      (1, 1, 'Notice of dispute', '2026-01-12'),
      (2, 1, 'Lease amendment', '2026-02-03'),
      (3, 1, 'Site photographs', '2026-02-20'),
      (4, 1, 'Email chain re access', '2026-06-01'),
      (5, 1, 'Invoice 5512', '2026-06-14');

    -- Opening ships three. Reply relies on the lease amendment (already delivered) and ships two new.
    INSERT INTO filing_documents (filing_id, document_id, ordinal, role, provenance) VALUES
      (1, 1, 1, 'evidence', 'served_with_this_response'),
      (1, 2, 2, 'evidence', 'served_with_this_response'),
      (1, 3, 3, 'evidence', 'served_with_this_response');
    INSERT INTO filing_documents (filing_id, document_id, ordinal, role, provenance) VALUES
      (2, 2, 1, 'evidence', 'already_in_court_file'),
      (2, 4, 2, 'evidence', 'served_with_this_response'),
      (2, 5, 3, 'evidence', 'served_with_this_response');

    UPDATE filings SET filed_on = '2026-05-04' WHERE id = 1;

    UPDATE db_meta SET value = '1' WHERE key = 'revision';
    `.trim()
  );
}

function citingDoc(fileName, text) {
  return { file_name: fileName, kind: "pdf", pages: 1, text_by_page: [text] };
}

function indexRow(exhibit_number, document_id, label, already_delivered = false) {
  return { exhibit_number, document_id, label, file_path: null, already_delivered };
}

test("a Reply continues the Opening's sequence, and a shared document keeps its original number", async () => {
  const dir = mkdtempSync(join(tmpdir(), "coclerk-exhibit-rounds-"));
  const dbPath = join(dir, "submission.sqlite");
  try {
    await freshSubmissionDb(dbPath);
    await seedOpeningAndReply(dbPath);

    const numbers = fetchProceedingExhibitNumbers(dbPath, 1);

    assert.equal(numbers.get(1), 1, "Notice of dispute is the Opening's first exhibit");
    assert.equal(numbers.get(2), 2, "the shared lease amendment keeps the Opening's Ex. 2");
    assert.equal(numbers.get(3), 3, "Site photographs is the Opening's third");
    assert.equal(numbers.get(4), 4, "the Reply's first new exhibit continues at Ex. 4, not Ex. 1");
    assert.equal(numbers.get(5), 5, "the Reply's second new exhibit is Ex. 5");
    assert.equal(numbers.size, 5, "one number per document, the shared one counted once");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a filed filing's exhibit links are immutable, so its derived numbers cannot move", async () => {
  const dir = mkdtempSync(join(tmpdir(), "coclerk-exhibit-rounds-frozen-"));
  const dbPath = join(dir, "submission.sqlite");
  try {
    await freshSubmissionDb(dbPath);
    await seedOpeningAndReply(dbPath);

    // Inserting into the FILED Opening would renumber the Reply behind it. The 23->24 guards refuse.
    await assert.rejects(
      () =>
        submissionDataExecute(
          dbPath,
          `INSERT INTO filing_documents (filing_id, document_id, ordinal, role, provenance)
           VALUES (1, 4, 4, 'evidence', 'served_with_this_response');`
        ),
      /a filed filing's exhibits do not change/,
      "expected the insert guard to refuse a new exhibit on a filed filing"
    );
    await assert.rejects(
      () => submissionDataExecute(dbPath, `UPDATE filing_documents SET ordinal = 9 WHERE filing_id = 1 AND document_id = 2;`),
      /a filed filing's exhibits do not change/,
      "expected the update guard to refuse a reorder of a filed filing"
    );
    await assert.rejects(
      () => submissionDataExecute(dbPath, `DELETE FROM filing_documents WHERE filing_id = 1 AND document_id = 3;`),
      /a filed filing's exhibits do not change/,
      "expected the delete guard to refuse removing a filed filing's exhibit"
    );

    // The draft Reply is still freely editable, and its numbers follow.
    await submissionDataExecute(dbPath, `UPDATE filing_documents SET ordinal = 9 WHERE filing_id = 2 AND document_id = 4;`);
    const numbers = fetchProceedingExhibitNumbers(dbPath, 1);
    assert.equal(numbers.get(5), 4, "moving the draft's email chain last promotes Invoice 5512 to Ex. 4");
    assert.equal(numbers.get(4), 5, "the reordered email chain becomes Ex. 5");
    assert.equal(numbers.get(2), 2, "the filed Opening's lease amendment is untouched by the draft's reorder");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("C1 passes a Reply citing an earlier round's exhibit without re-shipping its file", () => {
  const index = [
    indexRow(2, 2, "Lease amendment", true), // already before the tribunal -- no file in this package
    indexRow(4, 4, "Email chain re access"),
    indexRow(5, 5, "Invoice 5512"),
  ];
  const docs = [
    citingDoc("Written Argument of the Respondent.pdf", "The lease amendment at Ex. 2 governs, as does Ex. 4 and Ex. 5."),
    citingDoc("Exhibit 4 - Email chain re access.pdf", "…"),
    citingDoc("Exhibit 5 - Invoice 5512.pdf", "…"),
  ];
  const proceedingNumbers = new Map([[1, 1], [2, 2], [3, 3], [4, 4], [5, 5]]);

  const result = checkExhibitNumbering(docs, index, proceedingNumbers);
  assert.equal(result.status, "pass", `expected no findings; got: ${JSON.stringify(result.findings, null, 2)}`);
});

test("C1 still fails a cited exhibit that is genuinely absent from the proceeding", () => {
  const index = [indexRow(4, 4, "Email chain re access")];
  const docs = [
    citingDoc("Written Argument of the Respondent.pdf", "See Ex. 4 and Ex. 11."),
    citingDoc("Exhibit 4 - Email chain re access.pdf", "…"),
  ];
  const proceedingNumbers = new Map([[4, 4]]);

  const result = checkExhibitNumbering(docs, index, proceedingNumbers);
  assert.equal(result.status, "fail");
  assert.ok(
    result.findings.some((f) => /cites Exhibit 11, which is not in the Index of Exhibits/.test(f.problem)),
    `expected the unknown-exhibit finding; got: ${result.findings.map((f) => f.problem).join(" | ")}`
  );
});

test("C1 names an earlier round's exhibit cited but left off this filing's Index", () => {
  const index = [indexRow(4, 4, "Email chain re access")];
  const docs = [
    citingDoc("Written Argument of the Respondent.pdf", "The lease amendment at Ex. 2 governs. See also Ex. 4."),
    citingDoc("Exhibit 4 - Email chain re access.pdf", "…"),
  ];
  const proceedingNumbers = new Map([[2, 2], [4, 4]]);

  const result = checkExhibitNumbering(docs, index, proceedingNumbers);
  assert.equal(result.status, "fail");
  const finding = result.findings.find((f) => /Exhibit 2/.test(f.problem));
  assert.ok(finding, `expected a finding naming Ex. 2; got: ${result.findings.map((f) => f.problem).join(" | ")}`);
  assert.match(finding.problem, /an exhibit of an earlier round in this proceeding, but this filing's Index of Exhibits has no row for it/);
  assert.ok(
    !result.findings.some((f) => /no "Exhibit 2 - …" file is in the package folder/.test(f.problem)),
    "the missing file is not the defect here -- the missing Index row is"
  );
});

test("C1 flags an already-delivered exhibit that was re-shipped anyway", () => {
  const index = [indexRow(2, 2, "Lease amendment", true), indexRow(4, 4, "Email chain re access")];
  const docs = [
    citingDoc("Written Argument of the Respondent.pdf", "See Ex. 2 and Ex. 4."),
    citingDoc("Exhibit 2 - Lease amendment.pdf", "…"),
    citingDoc("Exhibit 4 - Email chain re access.pdf", "…"),
  ];
  const proceedingNumbers = new Map([[2, 2], [4, 4]]);

  const result = checkExhibitNumbering(docs, index, proceedingNumbers);
  assert.equal(result.status, "fail");
  assert.ok(
    result.findings.some((f) => /listed as already before the forum, but an "Exhibit 2 - …" file is in this package folder/.test(f.problem)),
    `expected the re-shipped finding; got: ${result.findings.map((f) => f.problem).join(" | ")}`
  );
});

test("a party-qualified citation names the other side's exhibit and is left alone", () => {
  const refs = extractExhibitReferences(
    citingDoc("Written Argument of the Respondent.pdf", "Contrast the Claimant's Exhibit 9 with Ex. 4.")
  );
  assert.deepEqual(
    refs.map((r) => ({ number: r.number, qualified: r.qualified })),
    [
      { number: 9, qualified: true },
      { number: 4, qualified: false },
    ],
    "expected the qualifier to be captured on Ex. 9 only"
  );

  const index = [indexRow(4, 4, "Email chain re access")];
  const docs = [
    citingDoc("Written Argument of the Respondent.pdf", "Contrast the Claimant's Exhibit 9 with Ex. 4."),
    citingDoc("Exhibit 4 - Email chain re access.pdf", "…"),
  ];
  const result = checkExhibitNumbering(docs, index, new Map([[4, 4]]));
  assert.equal(
    result.status,
    "pass",
    `the other side's Exhibit 9 is neither in our Index nor our package, by design; got: ${JSON.stringify(result.findings, null, 2)}`
  );
});

test("an unqualified citation is ours even where the qualifier words appear nearby", () => {
  const refs = extractExhibitReferences(
    citingDoc("Written Argument of the Respondent.pdf", "The Respondent relies on Ex. 4, and on Respondent's Exhibit 7 only for context.")
  );
  assert.deepEqual(
    refs.map((r) => ({ number: r.number, qualified: r.qualified })),
    [
      { number: 4, qualified: false },
      { number: 7, qualified: true },
    ],
    "a qualifier binds only when it immediately precedes the citation"
  );
});
