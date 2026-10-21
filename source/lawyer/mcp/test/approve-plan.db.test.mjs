// drafting_data__approve_plan: a /draft session stamps the approval of its held job's plan in one
// call, the guarded stamp followed by its confirm-read (jobs-run.md §5), classified as approved,
// already_approved, not_held, shelved, completed or no_match from the confirm-read. A job already
// approved is left alone; it never retries and moves no revision.

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const { freshSubmissionDb } = await import("./helpers/template-db.mjs");
const { submissionDataExecute, submissionDataQuery } = await import("../build/submission/backend.js");
const { callTool } = await import("../build/dispatch.js");

const TOOL = "drafting_data__approve_plan";

async function jobs(t) {
  const dir = mkdtempSync(join(tmpdir(), "coclerk-approve-plan-"));
  t.after(() => rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }));
  const dbPath = join(dir, "submission.sqlite");
  await freshSubmissionDb(dbPath);
  await submissionDataExecute(
    dbPath,
    `INSERT INTO proceedings (id, matter_reference, forum) VALUES (1, 'L8470 - Larchmont', 'CAN/BC/BCSC');
     INSERT INTO tickets (id, proceeding_id, title, intent, status, kind, billing_anchor, created, locked_by, locked_at) VALUES (1, 1, 'Mine', 'Do it.', 'wip', 'work', 'L8470|x', '2026-10-01T09:00', 'sess-a1', '2026-10-01T09:05');
     INSERT INTO tickets (id, proceeding_id, title, intent, status, kind, billing_anchor, created, locked_by, locked_at) VALUES (2, 1, 'Held elsewhere', 'Do it.', 'wip', 'work', 'L8470|x', '2026-10-01T09:00', 'sess-other', '2026-10-01T09:05');
     INSERT INTO tickets (id, proceeding_id, title, intent, status, kind, billing_anchor, created, rejected_at) VALUES (3, 1, 'Shelved', 'Do it.', 'queued', 'work', 'L8470|x', '2026-10-01T09:00', '2026-10-01T09:10');
     INSERT INTO tickets (id, proceeding_id, title, intent, status, kind, billing_anchor, created, completed_at) VALUES (4, 1, 'Completed', 'Do it.', 'completed', 'work', 'L8470|x', '2026-10-01T09:00', '2026-10-01T09:20');
     INSERT INTO tickets (id, proceeding_id, title, intent, status, kind, billing_anchor, created) VALUES (5, 1, 'Ready job', 'Do it.', 'queued', 'work', 'L8470|x', '2026-10-01T09:00');
     INSERT INTO tickets (id, proceeding_id, title, intent, status, kind, billing_anchor, created, locked_by, locked_at) VALUES (6, 1, 'No steps', 'Do it.', 'wip', 'work', 'L8470|x', '2026-10-01T09:00', 'sess-a1', '2026-10-01T09:05');
     INSERT INTO tickets (id, proceeding_id, title, intent, status, kind, billing_anchor, created, locked_by, locked_at, plan_approved_at) VALUES (7, 1, 'Approved', 'Do it.', 'wip', 'work', 'L8470|x', '2026-10-01T09:00', 'sess-a1', '2026-10-01T09:05', '2026-10-01T09:06');
     INSERT INTO tickets (id, proceeding_id, title, intent, status, kind, billing_anchor, created, locked_by, locked_at) VALUES (8, 1, 'Marker only', 'Do it.', 'wip', 'work', 'L8470|x', '2026-10-01T09:00', 'sess-a1', '2026-10-01T09:05');
     INSERT INTO ticket_steps (ticket_id, ordinal, text, done_at) VALUES
       (1, 1, 'First step.', NULL), (1, 2, 'Second step.', NULL), (2, 1, 'First step.', NULL), (3, 1, 'First step.', NULL),
       (4, 1, 'First step.', '2026-10-01T09:15'), (5, 1, 'First step.', NULL), (7, 1, 'First step.', '2026-10-01T09:07'),
       (8, 1, 'Create a plan for how to complete this job.', NULL);`
  );
  return dbPath;
}

const query = (dbPath, sql, params = []) => submissionDataQuery(dbPath, sql, params).rows;
const revision = (dbPath) => Number(query(dbPath, "SELECT value FROM db_meta WHERE key = 'revision'")[0].value);
const stamp = (dbPath, id) => query(dbPath, "SELECT plan_approved_at FROM tickets WHERE id = ?", [id])[0].plan_approved_at;
const steps = (dbPath, id) => query(dbPath, "SELECT * FROM ticket_steps WHERE ticket_id = ? ORDER BY ordinal", [id]);
const approve = (dbPath, args = {}) => callTool({}, TOOL, { db_path: dbPath, ticket_id: 1, session_token: "sess-a1", ...args });
const code = (expected) => (err) => {
  assert.equal(err.code, expected, err.message);
  return true;
};

test("the held job's plan is stamped once, and a second call is already_approved with the stamp unchanged", async (t) => {
  const dbPath = await jobs(t);
  const before = revision(dbPath);
  const stepsBefore = steps(dbPath, 1);
  const first = await approve(dbPath);
  assert.equal(first.outcome, "approved");
  assert.equal(first.changes, 1);
  assert.match(first.plan_approved_at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
  assert.deepEqual([first.locked_by, first.status, first.rejected_at], ["sess-a1", "wip", null]);
  assert.equal(stamp(dbPath, 1), first.plan_approved_at);

  const second = await approve(dbPath);
  assert.equal(second.outcome, "already_approved");
  assert.equal(second.changes, 0);
  assert.equal(second.plan_approved_at, first.plan_approved_at);
  assert.equal(stamp(dbPath, 1), first.plan_approved_at);
  assert.deepEqual(steps(dbPath, 1), stepsBefore, "the steps are the plan approved and stay as they are");
  assert.equal(revision(dbPath), before);
});

test("a job approved earlier is already_approved, and its stamp and step stamps stand", async (t) => {
  const dbPath = await jobs(t);
  const before = revision(dbPath);
  const stepsBefore = steps(dbPath, 7);
  const result = await approve(dbPath, { ticket_id: 7 });
  assert.equal(result.outcome, "already_approved");
  assert.equal(result.changes, 0);
  assert.equal(result.plan_approved_at, "2026-10-01T09:06");
  assert.equal(stamp(dbPath, 7), "2026-10-01T09:06");
  assert.deepEqual(steps(dbPath, 7), stepsBefore);
  assert.equal(revision(dbPath), before);
});

test("another session's job is not_held, and the row is untouched", async (t) => {
  const dbPath = await jobs(t);
  const before = revision(dbPath);
  const result = await approve(dbPath, { ticket_id: 2 });
  assert.equal(result.outcome, "not_held");
  assert.equal(result.changes, 0);
  assert.equal(result.locked_by, "sess-other");
  assert.equal(result.plan_approved_at, null);
  assert.equal(stamp(dbPath, 2), null);
  assert.equal(revision(dbPath), before);
});

test("a shelved, a completed and an unheld Ready job read shelved, completed and no_match, writing nothing", async (t) => {
  const dbPath = await jobs(t);
  const before = revision(dbPath);
  for (const [id, outcome, status] of [
    [3, "shelved", "queued"],
    [4, "completed", "completed"],
    [5, "no_match", "queued"],
  ]) {
    const result = await approve(dbPath, { ticket_id: id });
    assert.equal(result.outcome, outcome, `job ${id}`);
    assert.equal(result.changes, 0);
    assert.equal(result.status, status);
    assert.equal(result.locked_by, null);
    assert.equal(stamp(dbPath, id), null);
  }
  assert.equal(revision(dbPath), before);
});

test("a job whose only step is the plan marker is refused with a guiding question, writing nothing", async (t) => {
  const dbPath = await jobs(t);
  const before = revision(dbPath);
  await assert.rejects(approve(dbPath, { ticket_id: 8 }), (err) => {
    assert.equal(err.code, "plan_marker_only", err.message);
    assert.match(err.message, /What steps will complete this job\?$/);
    return true;
  });
  assert.equal(stamp(dbPath, 8), null);
  assert.equal(revision(dbPath), before);
});

test("a missing job, a job with no steps, an empty token and a bad id are refused, writing nothing", async (t) => {
  const dbPath = await jobs(t);
  const before = revision(dbPath);
  await assert.rejects(approve(dbPath, { ticket_id: 99 }), code("not_found"));
  await assert.rejects(approve(dbPath, { ticket_id: 6 }), code("no_steps"));
  // An empty token is refused by the shared input validator as a missing required field; a blank one reaches the tool's own check.
  await assert.rejects(approve(dbPath, { session_token: "" }), /session_token is required/);
  await assert.rejects(approve(dbPath, { session_token: "   " }), code("invalid_session_token"));
  await assert.rejects(approve(dbPath, { ticket_id: 0 }), code("invalid_ticket_id"));
  assert.equal(stamp(dbPath, 1), null);
  assert.equal(stamp(dbPath, 6), null);
  assert.equal(revision(dbPath), before);
});
