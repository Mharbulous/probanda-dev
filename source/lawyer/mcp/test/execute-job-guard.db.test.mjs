// drafting_data__execute refuses a job move a guarded job tool owns (spec 2026-10-30, execute refuses
// unguarded job writes): taking or moving a lock, stamping a plan approval, a completion or a deletion,
// stamping a step done or setting its status, and the job keys of db_meta and kv_store. The refusal is
// judged by state, writes nothing and names the tool. Every other job write stays a script: shelving,
// supersession, restore, outlining afresh. A fixture seed through submissionDataExecute is not the tool
// and is not guarded.

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const { freshSubmissionDb } = await import("./helpers/template-db.mjs");
const { submissionDataExecute, submissionDataQuery } = await import("../build/submission/backend.js");
const { callTool } = await import("../build/dispatch.js");

const SEED = `INSERT INTO proceedings (id, matter_reference, forum) VALUES (1, 'L8470 - Larchmont', 'CAN/BC/BCSC');
  INSERT INTO tickets (id, proceeding_id, title, intent, status, kind, billing_anchor, created) VALUES (1, 1, 'Ready', 'Do it.', 'queued', 'work', 'L8470|x', '2026-10-01T09:00');
  INSERT INTO tickets (id, proceeding_id, title, intent, status, kind, billing_anchor, created, locked_by, locked_at, plan_approved_at) VALUES (2, 1, 'Held', 'Do it.', 'wip', 'work', 'L8470|x', '2026-10-01T09:00', 'sess-other', '2026-10-01T09:05', '2026-10-01T09:06');
  INSERT INTO tickets (id, proceeding_id, title, intent, status, kind, billing_anchor, created, deleted_at) VALUES (3, 1, 'Deleted', 'Do it.', 'queued', 'work', 'L8470|x', '2026-10-01T09:00', '2026-10-02T10:00');
  INSERT INTO tickets (id, proceeding_id, title, intent, status, kind, billing_anchor, created, completed_at) VALUES (4, 1, 'Done', 'Do it.', 'completed', 'work', 'L8470|x', '2026-10-01T09:00', '2026-10-02T11:00');
  INSERT INTO ticket_steps (ticket_id, ordinal, text, done_at) VALUES (1, 1, 'Read the file.', NULL), (2, 1, 'Read the file.', '2026-10-01T09:07'), (2, 2, 'Draft it.', NULL);
  INSERT INTO db_meta (key, value) VALUES ('job_active:2', '2026-10-01T09:07');
  INSERT INTO kv_store (namespace, key, value, updated_at) VALUES ('claim_no', 'tickets:2', '1', '2026-10-01T09:05:00Z'), ('last_activity', 'tickets:2', '"2026-10-01T09:07"', '2026-10-01T09:07:00Z');`;

async function seeded(t) {
  const dir = mkdtempSync(join(tmpdir(), "coclerk-execute-job-guard-"));
  t.after(() => rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }));
  const dbPath = join(dir, "submission.sqlite");
  await freshSubmissionDb(dbPath);
  await submissionDataExecute(dbPath, SEED);
  return dbPath;
}

const execute = (dbPath, sql_script) => callTool({}, "drafting_data__execute", { db_path: dbPath, sql_script });
const snapshot = (dbPath) =>
  JSON.stringify(
    ["SELECT * FROM tickets ORDER BY id", "SELECT * FROM ticket_steps ORDER BY ticket_id, ordinal", "SELECT * FROM db_meta WHERE key LIKE 'job_active:%'", "SELECT * FROM kv_store ORDER BY namespace, key"].map(
      (sql) => submissionDataQuery(dbPath, sql).rows
    )
  );

for (const [label, script, tool] of [
  ["taking a lock", "UPDATE tickets SET status = 'wip', locked_by = 'sess-a1', locked_at = '2026-10-03T09:00' WHERE id = 1;", "drafting_data__assign_job"],
  ["moving a lock to another holder", "UPDATE tickets SET locked_by = 'sess-a1' WHERE id = 2;", "drafting_data__assign_job"],
  ["stamping a plan approval", "UPDATE tickets SET plan_approved_at = '2026-10-03T09:00' WHERE id = 1;", "drafting_data__approve_plan or drafting_data__rewrite_job"],
  ["completing a job", "UPDATE tickets SET status = 'completed', completed_at = '2026-10-03T09:00', locked_by = NULL, locked_at = NULL WHERE id = 2;", "drafting_data__complete_job"],
  ["deleting a job", "UPDATE tickets SET deleted_at = '2026-10-03T09:00' WHERE id = 1;", "drafting_data__delete_job"],
  ["stamping a step done", "UPDATE ticket_steps SET done_at = '2026-10-03T09:00' WHERE ticket_id = 2 AND ordinal = 2;", "drafting_data__set_step"],
  ["setting a step's status", "UPDATE ticket_steps SET status = 'retry' WHERE ticket_id = 1 AND ordinal = 1;", "drafting_data__set_step"],
  ["inserting a done step", "INSERT INTO ticket_steps (ticket_id, ordinal, text, done_at) VALUES (1, 2, 'Check it.', '2026-10-03T09:00');", "drafting_data__set_step"],
  ["writing the active stamp", "INSERT OR REPLACE INTO db_meta (key, value) VALUES ('job_active:2', '2026-10-03T09:00');", "drafting_data__touch_job"],
  ["deleting the active stamp", "DELETE FROM db_meta WHERE key = 'job_active:2';", "drafting_data__touch_job"],
  ["moving the last activity", "UPDATE kv_store SET value = '\"2026-10-03T09:00\"' WHERE namespace = 'last_activity';", "drafting_data__touch_job or drafting_data__assign_job"],
  ["reopening a completed job", "UPDATE tickets SET status = 'queued', completed_at = NULL WHERE id = 4;", "drafting_data__assign_job with reopen"],
  ["forging a reopen history", "INSERT INTO kv_store (namespace, key, value, updated_at) VALUES ('reopened', 'tickets:4', '[]', '2026-10-03T09:00:00Z');", "drafting_data__assign_job"],
  ["resetting the claim number", "DELETE FROM kv_store WHERE namespace = 'claim_no';", "drafting_data__assign_job"],
  ["a guarded move after an allowed write", "UPDATE tickets SET bf_on = '2026-11-02' WHERE id = 1; UPDATE ticket_steps SET done_at = '2026-10-03T09:00' WHERE ticket_id = 1;", "drafting_data__set_step"],
  ["committing before a guarded move", "UPDATE tickets SET bf_on = '2026-11-02' WHERE id = 1; COMMIT; BEGIN; UPDATE tickets SET plan_approved_at = '2026-10-03T09:00' WHERE id = 1;", "drafting_data__approve_plan or drafting_data__rewrite_job"],
]) {
  test(`execute refuses ${label}, naming the tool and writing nothing`, async (t) => {
    const dbPath = await seeded(t);
    const before = snapshot(dbPath);
    await assert.rejects(execute(dbPath, script), (err) => {
      assert.ok(err.message.includes(`job_write_refused: use ${tool}.`), err.message);
      assert.ok(err.message.includes("Nothing was written."), err.message);
      return true;
    });
    assert.equal(snapshot(dbPath), before);
  });
}

for (const [label, script, check] of [
  [
    "shelving another session's job, clearing its lock",
    "UPDATE tickets SET status = 'queued', locked_by = NULL, locked_at = NULL, rejected_at = '2026-10-03T09:00' WHERE id = 2;",
    "SELECT status = 'queued' AND locked_by IS NULL AND rejected_at IS NOT NULL AS ok FROM tickets WHERE id = 2",
  ],
  ["superseding a completed job", "UPDATE tickets SET status = 'superseded', completed_at = NULL WHERE id = 4;", "SELECT status = 'superseded' AS ok FROM tickets WHERE id = 4"],
  ["superseding a queued job", "UPDATE tickets SET status = 'superseded' WHERE id = 1;", "SELECT status = 'superseded' AS ok FROM tickets WHERE id = 1"],
  ["restoring a deleted job", "UPDATE tickets SET deleted_at = NULL WHERE id = 3;", "SELECT deleted_at IS NULL AS ok FROM tickets WHERE id = 3"],
  [
    "outlining a ready job afresh",
    "DELETE FROM ticket_steps WHERE ticket_id = 1; INSERT INTO ticket_steps (ticket_id, ordinal, text) VALUES (1, 1, 'Audit the list.'), (1, 2, 'Reconcile it.'); UPDATE tickets SET plan_approved_at = NULL WHERE id = 1;",
    "SELECT COUNT(*) = 2 AS ok FROM ticket_steps WHERE ticket_id = 1 AND done_at IS NULL",
  ],
  ["bringing a job forward", "UPDATE tickets SET bf_on = '2026-11-02' WHERE id = 1;", "SELECT bf_on = '2026-11-02' AS ok FROM tickets WHERE id = 1"],
]) {
  test(`execute still writes ${label}`, async (t) => {
    const dbPath = await seeded(t);
    const result = await execute(dbPath, script);
    assert.equal(result.ok, true);
    assert.equal(submissionDataQuery(dbPath, check).rows[0].ok, 1);
  });
}

test("the guarded tools still write what execute refuses", async (t) => {
  const dbPath = await seeded(t);
  const assigned = await callTool({}, "drafting_data__assign_job", { db_path: dbPath, ticket_id: 1, session_token: "sess-a1" });
  assert.equal(assigned.outcome, "assigned");
  const done = await callTool({}, "drafting_data__set_step", { db_path: dbPath, ticket_id: 1, ordinal: 1, session_token: "sess-a1", claim_no: assigned.claim_no, status: "done" });
  assert.equal(done.outcome, "set");
  assert.notEqual(submissionDataQuery(dbPath, "SELECT value FROM db_meta WHERE key = 'job_active:1'").rows.length, 0);
});
