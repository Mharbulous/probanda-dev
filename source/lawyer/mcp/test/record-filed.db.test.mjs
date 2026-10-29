// drafting_data__record_filed (party/counsel SSOT; submission schema v42): a Writing that is not a
// general one is recorded as filed through this tool, reached through the dispatch path. In one
// transaction it writes the party rows the Writing was filed with, counsel and the address for
// service read from case data and never the submission copy, then sets filed_on, which the v42 guard
// refuses any other way while the proceeding has a party. It refuses while a party drifts, and every
// refusal writes nothing. A Writing that already has snapshot rows keeps them.

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

const { freshSubmissionDb, seedSql } = await import("./helpers/template-db.mjs");
const { updateCaseData } = await import("./helpers/matter-data-fixture.mjs");
const { seedBcscConsentOrder } = await import("./fixtures/forms-render-seeds.mjs");
const { submissionDataExecute, submissionDataQuery } = await import("../build/submission/backend.js");
const { callTool } = await import("../build/dispatch.js");

const TOOL = "drafting_data__record_filed";
const GENERAL = JSON.stringify({ layout: { renderer: "general", parts: [] }, venue: null, passage_hashes: {} });

/** The BCSC consent-order requisition, its two parties linked to case data beside it, where the
 * defendant's counsel is Y. Counsel and the submission copy still reads D. Lawyer. */
async function consentOrder(t) {
  const dir = mkdtempSync(join(tmpdir(), "coclerk-record-filed-"));
  t.after(() => rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }));
  const dbPath = join(dir, "submission.sqlite");
  await freshSubmissionDb(dbPath);
  await seedBcscConsentOrder(dbPath);
  updateCaseData(dir, "UPDATE parties SET lawyer_name = 'Y. Counsel', address = '2 Y St' WHERE party_id = 2;");
  return dbPath;
}

const query = (dbPath, sql, params = []) => submissionDataQuery(dbPath, sql, params).rows;
const revision = (dbPath) => Number(query(dbPath, "SELECT value FROM db_meta WHERE key = 'revision'")[0].value);
const filedOn = (dbPath, id = 1) => query(dbPath, "SELECT filed_on FROM filings WHERE id = ?", [id])[0].filed_on;
const printed = (dbPath, id = 1) =>
  query(dbPath, "SELECT party_id, name, role, counsel_name, address_for_service FROM parties_snapshot WHERE filing_id = ? ORDER BY party_id", [id]).map((r) => [
    r.party_id,
    r.name,
    r.role,
    r.counsel_name,
    r.address_for_service,
  ]);
const record = (dbPath, args = {}) =>
  callTool({}, TOOL, { db_path: dbPath, filing_id: 1, filed_on: "2026-10-01", expect_revision: revision(dbPath), ...args });
const code = (expected, message) => (err) => {
  assert.equal(err.code, expected, err.message);
  if (message) assert.match(err.message, message);
  return true;
};

test("record_filed writes the party rows from case data, not the submission copy, then sets filed_on", async (t) => {
  const dbPath = await consentOrder(t);
  const before = revision(dbPath);
  const result = await record(dbPath);
  assert.deepEqual([result.filing_id, result.filed_on], [1, "2026-10-01"]);
  assert.equal(filedOn(dbPath), "2026-10-01");
  assert.deepEqual(printed(dbPath), [
    [1, "Larchmont (B.C.) Inc.", "Plaintiff", "C. Lawyer", null],
    [2, "Example Defendant Ltd.", "Defendant", "Y. Counsel", "2 Y St"],
  ]);
  assert.equal(result.revision, revision(dbPath));
  assert.equal(revision(dbPath), before + 3, "two snapshot rows and the filed_on update each move the revision");
});

test("record_filed refuses while a party drifts, and writes nothing", async (t) => {
  const dbPath = await consentOrder(t);
  await submissionDataExecute(dbPath, "UPDATE parties SET case_party_id = NULL WHERE id = 2;");
  const before = revision(dbPath);
  await assert.rejects(record(dbPath), code("parties_drift", /Example Defendant Ltd\. \(unlinked\).*drafting_data__record_filed again/));
  assert.equal(filedOn(dbPath), null);
  assert.deepEqual(printed(dbPath), []);
  assert.equal(revision(dbPath), before);
});

test("record_filed refuses a bad date, a missing, retired or filed Writing, and a general Writing, writing nothing", async (t) => {
  const dbPath = await consentOrder(t);
  seedSql(
    dbPath,
    `INSERT INTO filings (id, proceeding_id, kind, title, needs_forum_parts, layout_snapshot) VALUES (2, 1, 'letter_to_opposing_counsel', 'Letter', 0, '${GENERAL}');
     INSERT INTO filings (id, proceeding_id, kind, subkind, title, retired_on, retirement_reason) VALUES (3, 1, 'requisition_consent', 'consent', 'Retired', '2026-09-30', 'other');
     INSERT INTO filings (id, proceeding_id, kind, subkind, title, filed_on) VALUES (4, 1, 'requisition_consent', 'consent', 'Filed', '2026-09-30');`
  );
  const before = revision(dbPath);
  for (const filed_on of ["2026-02-31", "26-10-01", "2026-10-1"]) {
    await assert.rejects(record(dbPath, { filed_on }), code("invalid_filed_on"), filed_on);
  }
  await assert.rejects(record(dbPath, { filing_id: 99 }), code("not_found"));
  await assert.rejects(record(dbPath, { filing_id: 2 }), code("general_writing", /record it as sent, not as filed/));
  await assert.rejects(record(dbPath, { filing_id: 3 }), code("writing_retired"));
  await assert.rejects(record(dbPath, { filing_id: 4 }), code("already_filed"));
  assert.equal(revision(dbPath), before);
  assert.deepEqual(query(dbPath, "SELECT DISTINCT filing_id FROM parties_snapshot"), []);
});

test("record_filed refuses an expect_revision the database has moved past, writing nothing", async (t) => {
  const dbPath = await consentOrder(t);
  const before = revision(dbPath);
  await assert.rejects(record(dbPath, { expect_revision: before - 1 }), code("revision_moved", new RegExp(`revision ${before - 1}, where this act was approved, to ${before}`)));
  assert.equal(filedOn(dbPath), null);
  assert.equal(revision(dbPath), before);
});

test("a filed_on cleared in error and recorded again keeps the first snapshot, whatever case data says now", async (t) => {
  const dbPath = await consentOrder(t);
  await record(dbPath);
  const first = printed(dbPath);
  await submissionDataExecute(dbPath, "UPDATE filings SET filed_on = NULL WHERE id = 1;");
  updateCaseData(dirname(dbPath), "UPDATE parties SET lawyer_name = 'Z. Counsel' WHERE party_id = 2;");
  await submissionDataExecute(dbPath, "UPDATE parties SET case_party_id = NULL WHERE id = 2;");
  const result = await record(dbPath, { filed_on: "2026-10-02" });
  assert.equal(result.filed_on, "2026-10-02");
  assert.equal(filedOn(dbPath), "2026-10-02");
  assert.deepEqual(printed(dbPath), first);
});

test("a Writing on a proceeding with no party is recorded as filed with no snapshot rows", async (t) => {
  const dbPath = await consentOrder(t);
  await submissionDataExecute(
    dbPath,
    `INSERT INTO proceedings (id, matter_reference, forum) VALUES (2, 'L8470 - Larchmont', 'CAN/BC/BCSC');
     INSERT INTO filings (id, proceeding_id, kind, subkind, title) VALUES (5, 2, 'requisition_consent', 'consent', 'No parties');`
  );
  await record(dbPath, { filing_id: 5 });
  assert.equal(filedOn(dbPath, 5), "2026-10-01");
  assert.deepEqual(printed(dbPath, 5), []);
});

test("record_filed records each of the Writing's recipients as it was filed with, and a later service-list edit leaves them (#1307)", async (t) => {
  const dbPath = await consentOrder(t);
  await submissionDataExecute(
    dbPath,
    `INSERT INTO recipients (id, proceeding_id, name, capacity, email, address, party_id, ordinal) VALUES
       (1, 1, 'Dan Registrar', 'the registry', NULL, '800 Smithe Street', NULL, 1),
       (2, 1, NULL, 'counsel for the Defendant', NULL, NULL, 2, 2);
     INSERT INTO filing_recipients (filing_id, recipient_id, role, ordinal) VALUES (1, 1, 'to', 1), (1, 2, 'cc', 1);`
  );
  const snapshot = () => query(dbPath, "SELECT recipient_id, capacity, party_id, name, email, address FROM recipients_snapshot WHERE filing_id = 1 ORDER BY recipient_id");
  await record(dbPath);
  const filed = [
    { recipient_id: 1, capacity: "the registry", party_id: null, name: "Dan Registrar", email: null, address: "800 Smithe Street" },
    { recipient_id: 2, capacity: "counsel for the Defendant", party_id: 2, name: null, email: null, address: null },
  ];
  assert.deepEqual(snapshot(), filed);
  await submissionDataExecute(dbPath, "UPDATE recipients SET name = 'Eve Registrar' WHERE id = 1; UPDATE recipients SET party_id = 1 WHERE id = 2;");
  assert.deepEqual(snapshot(), filed);
});
