// drafting_data__execute never records a Writing as sent, filed or served. Setting filings.filed_on
// or filings.sent_copy_id to a value it did not hold is the one-way act that record_sent, record_filed
// and record_served carry behind the approval gate, so a raw script that does it is refused whole,
// however it is written. Clearing filed_on stays an ordinary update (the documented undo).
// Plan: docs/Plans/2026-10-28_guardrail-gaps.md, gap 1.

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const { freshSubmissionDb, seedSql } = await import("./helpers/template-db.mjs");
const { submissionDataExecute, submissionDataQuery } = await import("../build/submission/backend.js");

const SEED = `
INSERT INTO proceedings (id, matter_reference, forum, court_or_centre, file_number, style_of_cause)
  VALUES (1, 'L9100 - Terrace Holdings', 'CAN/BC/Vancouver-International-Arbitration-Centre', 'VanIAC', 'DCA-24-118', 'Terrace Holdings v. Brackwell');
INSERT INTO filings (id, proceeding_id, kind, round, title) VALUES (1, 1, 'submissions_package', 'opening', 'Opening');
INSERT INTO filings (id, proceeding_id, kind, round, title) VALUES (2, 1, 'submissions_package', 'reply', 'Reply');
INSERT INTO documents (id, proceeding_id, label, document_date) VALUES (9, 1, 'Sent copy', '2026-05-04');
`;

async function db(t) {
  const dir = mkdtempSync(join(tmpdir(), "coclerk-execute-filed-on-"));
  t.after(() => rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }));
  const dbPath = join(dir, "submission.sqlite");
  await freshSubmissionDb(dbPath);
  await submissionDataExecute(dbPath, SEED);
  seedSql(dbPath, "UPDATE filings SET filed_on = '2026-05-04' WHERE id = 2;");
  return dbPath;
}

const filings = async (dbPath) =>
  (await submissionDataQuery(dbPath, "SELECT id, filed_on, sent_copy_id, decided_on FROM filings ORDER BY id")).rows;

for (const [label, script] of [
  ["setting filed_on", "UPDATE filings SET filed_on = '2026-10-01' WHERE id = 1;"],
  ["moving a filed_on to another date", "UPDATE filings SET filed_on = '2026-10-01' WHERE id = 2;"],
  ["inserting a filed Writing", "INSERT INTO filings (id, proceeding_id, kind, round, title, filed_on) VALUES (3, 1, 'submissions_package', 'reply', 'Late', '2026-10-01');"],
  ["setting sent_copy_id", "UPDATE filings SET sent_copy_id = 9 WHERE id = 1;"],
  ["committing before setting filed_on", "UPDATE filings SET decided_on = '2026-09-01' WHERE id = 1; COMMIT; BEGIN; UPDATE filings SET filed_on = '2026-10-01' WHERE id = 1;"],
]) {
  test(`execute refuses ${label}, writing nothing`, async (t) => {
    const dbPath = await db(t);
    const before = await filings(dbPath);
    await assert.rejects(submissionDataExecute(dbPath, script), /set only by drafting_data__record_sent, record_filed or record_served/);
    assert.deepEqual(await filings(dbPath), before);
  });
}

test("execute still clears a filed_on and writes the other dates", async (t) => {
  const dbPath = await db(t);
  await submissionDataExecute(dbPath, "UPDATE filings SET filed_on = NULL WHERE id = 2; UPDATE filings SET decided_on = '2026-09-01' WHERE id = 1;");
  assert.deepEqual(
    (await filings(dbPath)).map((r) => [r.id, r.filed_on, r.decided_on]),
    [[1, null, "2026-09-01"], [2, null, null]]
  );
});
