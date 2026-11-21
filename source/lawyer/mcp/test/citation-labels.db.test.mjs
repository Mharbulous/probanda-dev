// A witness statement carries its witness in documents.deponent (filing-checklists.md), but it is
// not an affidavit: the Notice of Application cites it by its own label, never "Affidavit of NAME".

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const { freshSubmissionDb } = await import("./helpers/template-db.mjs");
const { submissionDataExecute } = await import("../build/submission/backend.js");
const { fetchCitationLabels } = await import("../build/submission/forms/exhibit-documents.js");

test("a witness statement with a deponent is cited by its own label, an affidavit by its deponent", async () => {
  const dir = mkdtempSync(join(tmpdir(), "coclerk-citation-labels-"));
  mkdirSync(join(dir, "0. CASE DATA"), { recursive: true });
  const dbPath = join(dir, "0. CASE DATA", "submission.sqlite");
  try {
    await freshSubmissionDb(dbPath);
    await submissionDataExecute(
      dbPath,
      `
      INSERT INTO proceedings (id, matter_reference, forum) VALUES (1, 'L0001 - Test', 'CAN/BC/BCSC');
      INSERT INTO witnesses (id, proceeding_id, name) VALUES (1, 1, 'B. Tester');
      INSERT INTO documents (id, proceeding_id, label, instrument, deponent)
        VALUES (1, 1, 'Witness Statement of B. Tester', 'witness_statement', 1);
      INSERT INTO documents (id, proceeding_id, label, instrument, deponent, affidavit_number)
        VALUES (2, 1, 'Affidavit #2 of B. Tester', 'affidavit', 1, '2');
      `.trim()
    );
    const labels = fetchCitationLabels(dbPath, [1, 2]);
    assert.equal(labels.get(1), "Witness Statement of B. Tester", "expected the witness statement cited by its own label");
    assert.equal(labels.get(2), "Affidavit #2 of B. Tester", "expected the affidavit named from its deponent and number");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
