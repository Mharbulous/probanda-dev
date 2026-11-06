// drafting_data__assign_job with reopen (jobs-closeout.md §10e): a completed job goes back to wip under
// the caller, with its plan and done steps kept, its completion cleared, a fresh claim, and the
// completion it lifts recorded in its history. Re-completing seals it again. The practitioner's yes
// is the practitioner-words hook's to check, not the tool's.

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const { freshSubmissionDb } = await import("./helpers/template-db.mjs");
const { submissionDataExecute, submissionDataQuery } = await import("../build/submission/backend.js");
const { callTool } = await import("../build/dispatch.js");

const SEED = `INSERT INTO proceedings (id, matter_reference, forum) VALUES (1, 'L8470 - Larchmont', 'CAN/BC/BCSC');
  INSERT INTO tickets (id, proceeding_id, title, intent, status, kind, billing_anchor, created) VALUES (1, 1, 'Settle it', 'Do it.', 'queued', 'work', 'L8470|x', '2026-10-01T09:00');
  INSERT INTO tickets (id, proceeding_id, title, intent, status, kind, billing_anchor, created, rejected_at) VALUES (2, 1, 'Shelved', 'Do it.', 'queued', 'work', 'L8470|x', '2026-10-01T09:00', '2026-10-02T09:00');
  INSERT INTO ticket_steps (ticket_id, ordinal, text) VALUES (1, 1, 'Read the file.');`;

/** Job 1 assigned to sess-a1, its one step done, its plan approved, and completed. */
async function completedJob(t) {
  const dir = mkdtempSync(join(tmpdir(), "coclerk-reopen-job-"));
  t.after(() => rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }));
  const dbPath = join(dir, "submission.sqlite");
  await freshSubmissionDb(dbPath);
  await submissionDataExecute(dbPath, SEED);
  const first = await callTool({}, "drafting_data__assign_job", { db_path: dbPath, ticket_id: 1, session_token: "sess-a1" });
  const held = { db_path: dbPath, ticket_id: 1, session_token: "sess-a1", claim_no: first.claim_no };
  assert.equal((await callTool({}, "drafting_data__approve_plan", held)).outcome, "approved");
  assert.equal((await callTool({}, "drafting_data__set_step", { ...held, ordinal: 1, status: "done" })).outcome, "set");
  assert.equal((await callTool({}, "drafting_data__complete_job", { ...held, draft_dir: dir })).outcome, "completed");
  return { dbPath, dir, first };
}

const job = (dbPath) => submissionDataQuery(dbPath, "SELECT status, locked_by, completed_at, plan_approved_at FROM tickets WHERE id = 1").rows[0];
const history = (dbPath) => JSON.parse(submissionDataQuery(dbPath, "SELECT value FROM kv_store WHERE namespace = 'reopened' AND key = 'tickets:1'").rows[0]?.value ?? "[]");
const reopen = (dbPath, token, extra = {}) => callTool({}, "drafting_data__assign_job", { db_path: dbPath, ticket_id: 1, session_token: token, reopen: true, ...extra });

test("a reopen gives the completed job to the caller under a fresh claim, keeps its plan and done step, and records the completion it lifts", async (t) => {
  const { dbPath, first } = await completedJob(t);
  const completed = job(dbPath);

  const result = await reopen(dbPath, "sess-b2");

  assert.equal(result.outcome, "assigned", result.note);
  assert.ok(result.claim_no > first.claim_no);
  assert.match(result.note, /reopened/);
  assert.deepEqual(job(dbPath), { status: "wip", locked_by: "sess-b2", completed_at: null, plan_approved_at: completed.plan_approved_at });
  assert.notEqual(submissionDataQuery(dbPath, "SELECT done_at FROM ticket_steps WHERE ticket_id = 1 AND ordinal = 1").rows[0].done_at, null);
  const [entry] = history(dbPath);
  assert.equal(entry.completed_at, completed.completed_at);
  assert.equal(entry.plan_approved_at, completed.plan_approved_at);
  assert.ok(entry.reopened_at);
});

test("work under the claim before the reopen writes nothing, and re-completing seals the job again", async (t) => {
  const { dbPath, dir, first } = await completedJob(t);
  const again = await reopen(dbPath, "sess-a1");
  assert.equal(again.outcome, "assigned");
  const held = { db_path: dbPath, ticket_id: 1, session_token: "sess-a1" };

  await assert.rejects(callTool({}, "drafting_data__complete_job", { ...held, claim_no: first.claim_no, draft_dir: dir }), (err) => err.code === "stale_claim" || /stale_claim/.test(err.message));
  assert.equal(job(dbPath).status, "wip");

  const sealed = await callTool({}, "drafting_data__complete_job", { ...held, claim_no: again.claim_no, draft_dir: dir });
  assert.equal(sealed.outcome, "completed");
  assert.equal(job(dbPath).status, "completed");
  assert.equal(history(dbPath).length, 1);

  assert.equal((await reopen(dbPath, "sess-a1")).outcome, "assigned");
  assert.equal(history(dbPath).length, 2, "each reopen adds one entry");
});

test("a reopen matches only a completed job, and writes nothing otherwise", async (t) => {
  const { dbPath } = await completedJob(t);
  await submissionDataExecute(dbPath, "UPDATE tickets SET status = 'queued', completed_at = NULL WHERE id = 1;");
  for (const id of [1, 2]) {
    const result = await callTool({}, "drafting_data__assign_job", { db_path: dbPath, ticket_id: id, session_token: "sess-b2", reopen: true });
    assert.equal(result.outcome, "no_match", `job ${id}`);
  }
  assert.deepEqual(history(dbPath), []);
});

test("reopen and takeover are never passed together", async (t) => {
  const { dbPath } = await completedJob(t);
  await assert.rejects(reopen(dbPath, "sess-b2", { takeover: true, expected_holder: "abcdefgh", expected_last_activity: "2026-10-01T09:00" }), (err) => /invalid_reopen|never passed together/.test(`${err.code} ${err.message}`));
  assert.equal(job(dbPath).status, "completed");
});
