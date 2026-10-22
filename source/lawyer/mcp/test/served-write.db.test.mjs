// drafting_data__record_served (amended Rule 8-1, B.C. Reg. 105/2026): a Notice of Application or
// Application Response is recorded as served, reached through the dispatch path. One transaction
// writes the party rows from case data, the served copy's documents row, sent_copy_id and filed_on =
// the service date, which freezes the Writing. Its lifecycle reads Served. Every refusal writes
// nothing, and record_filed then refuses the served Writing.

import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const { freshSubmissionDb } = await import("./helpers/template-db.mjs");
const { seedApplicationResponse } = await import("./fixtures/forms-render-seeds.mjs");
const { submissionDataExecute, submissionDataQuery } = await import("../build/submission/backend.js");
const { deriveLifecycle } = await import("../build/submission/forms/lifecycle.js");
const { callTool } = await import("../build/dispatch.js");

const TOOL = "drafting_data__record_served";

async function response(t) {
  const dir = mkdtempSync(join(tmpdir(), "coclerk-record-served-"));
  t.after(() => rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }));
  const dbPath = join(dir, "submission.sqlite");
  await freshSubmissionDb(dbPath);
  await seedApplicationResponse(dbPath);
  return { dir, dbPath };
}

const query = (dbPath, sql, params = []) => submissionDataQuery(dbPath, sql, params).rows;
const revision = (dbPath) => Number(query(dbPath, "SELECT value FROM db_meta WHERE key = 'revision'")[0].value);
const filing = (dbPath, id = 1) => query(dbPath, "SELECT * FROM filings WHERE id = ?", [id])[0];
const record = (dbPath, args = {}) => callTool({}, TOOL, { db_path: dbPath, filing_id: 1, served_on: "2026-10-05", ...args });
const code = (expected, message) => (err) => {
  assert.equal(err.code, expected, err.message);
  if (message) assert.match(err.message, message);
  return true;
};

test("record_served writes the party rows, the served copy and sent_copy_id, and freezes the Writing at service", async (t) => {
  const { dir, dbPath } = await response(t);
  const copy = join(dir, "served.pdf");
  writeFileSync(copy, "%PDF-1.4");
  const result = await record(dbPath, { served_copy_path: copy });

  const row = filing(dbPath);
  assert.equal(row.filed_on, "2026-10-05");
  assert.equal(result.sent_copy_id, row.sent_copy_id);
  const [doc] = query(dbPath, "SELECT label, document_date, file_path FROM documents WHERE id = ?", [row.sent_copy_id]);
  assert.deepEqual(doc, { label: "Served copy — Application Response", document_date: "2026-10-05", file_path: copy });
  assert.equal(result.parties_snapshot_rows, 2);
  assert.equal(query(dbPath, "SELECT COUNT(*) AS n FROM parties_snapshot WHERE filing_id = 1")[0].n, 2);
  assert.equal(result.revision, revision(dbPath));

  assert.equal(deriveLifecycle(row, null, "2026-10-21").state, "served");
  await assert.rejects(
    submissionDataExecute(dbPath, "INSERT INTO filing_facts (filing_id, fact_id, document, part, ordinal) VALUES (1, 3, 'form', 'part4', 3);"),
    "a served Writing is frozen"
  );
});

test("record_filed refuses a served Writing, naming the job that files it", async (t) => {
  const { dbPath } = await response(t);
  await record(dbPath);
  const before = revision(dbPath);
  await assert.rejects(
    callTool({}, "drafting_data__record_filed", { db_path: dbPath, filing_id: 1, filed_on: "2026-10-12" }),
    code("served_writing", /Set down for hearing or File the served response/)
  );
  assert.equal(filing(dbPath).filed_on, "2026-10-05");
  assert.equal(revision(dbPath), before);
});

test("record_served refuses, writing nothing, a bad date or copy, a missing, retired, frozen or other-kind Writing, and party drift", async (t) => {
  const { dir, dbPath } = await response(t);
  await submissionDataExecute(
    dbPath,
    `INSERT INTO filings (id, proceeding_id, kind, subkind, title) VALUES (2, 1, 'requisition_consent', 'consent', 'Requisition');
     INSERT INTO filings (id, proceeding_id, kind, title, retired_on, retirement_reason) VALUES (3, 1, 'notice_of_application', 'Retired', '2026-09-30', 'other');
     INSERT INTO filings (id, proceeding_id, kind, title, filed_on) VALUES (4, 1, 'notice_of_application', 'Filed the old way', '2026-09-30');`
  );
  const before = revision(dbPath);
  const documents = query(dbPath, "SELECT COUNT(*) AS n FROM documents")[0].n;
  for (const served_on of ["2026-02-31", "26-10-05"]) {
    await assert.rejects(record(dbPath, { served_on }), code("invalid_served_on"), served_on);
  }
  await assert.rejects(record(dbPath, { served_copy_path: join(dir, "missing.pdf") }), code("invalid_served_copy"));
  await assert.rejects(record(dbPath, { filing_id: 99 }), code("not_found"));
  await assert.rejects(record(dbPath, { filing_id: 2 }), code("not_served_kind", /record_filed/));
  await assert.rejects(record(dbPath, { filing_id: 3 }), code("writing_retired"));
  await assert.rejects(record(dbPath, { filing_id: 4 }), code("already_filed"));
  assert.equal(revision(dbPath), before);
  await submissionDataExecute(dbPath, "UPDATE parties SET case_party_id = NULL WHERE id = 2;");
  const drifted = revision(dbPath);
  await assert.rejects(record(dbPath), code("parties_drift"));
  assert.equal(revision(dbPath), drifted);
  assert.equal(filing(dbPath).filed_on, null);
  assert.equal(filing(dbPath).sent_copy_id, null);
  assert.equal(query(dbPath, "SELECT COUNT(*) AS n FROM documents")[0].n, documents);
  assert.deepEqual(query(dbPath, "SELECT DISTINCT filing_id FROM parties_snapshot"), []);
});
