// drafting_data__assign_job: a /draft session assigns a Ready job to itself in one call, the
// guarded assigning write followed by its confirm-read (jobs.md §4), classified as assigned,
// lost_race, holder_changed or no_match from the confirm-read. It never retries and moves no revision.

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const { freshSubmissionDb } = await import("./helpers/template-db.mjs");
const { submissionDataExecute, submissionDataQuery } = await import("../build/submission/backend.js");
const { callTool } = await import("../build/dispatch.js");

const TOOL = "drafting_data__assign_job";

async function jobs(t) {
  const dir = mkdtempSync(join(tmpdir(), "coclerk-assign-job-"));
  t.after(() => rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }));
  const dbPath = join(dir, "submission.sqlite");
  await freshSubmissionDb(dbPath);
  await submissionDataExecute(
    dbPath,
    `INSERT INTO proceedings (id, matter_reference, forum) VALUES (1, 'L8470 - Larchmont', 'CAN/BC/BCSC');
     INSERT INTO tickets (id, proceeding_id, title, intent, status, kind, billing_anchor, created) VALUES (1, 1, 'Ready job', 'Do it.', 'queued', 'work', 'L8470|x', '2026-10-01T09:00');
     INSERT INTO tickets (id, proceeding_id, title, intent, status, kind, billing_anchor, created, locked_by, locked_at) VALUES (2, 1, 'Held elsewhere', 'Do it.', 'wip', 'work', 'L8470|x', '2026-10-01T09:00', 'sess-other', '2026-10-01T09:05');
     INSERT INTO tickets (id, proceeding_id, title, intent, status, kind, billing_anchor, created, rejected_at) VALUES (3, 1, 'Shelved', 'Do it.', 'queued', 'work', 'L8470|x', '2026-10-01T09:00', '2026-10-01T09:10');
     INSERT INTO tickets (id, proceeding_id, title, intent, status, kind, billing_anchor, created) VALUES (4, 1, 'Retirement-superseded', 'Do it.', 'superseded', 'work', 'L8470|x', '2026-10-01T09:00');
     INSERT INTO tickets (id, proceeding_id, title, intent, status, kind, billing_anchor, created, completed_at) VALUES (5, 1, 'Completed', 'Do it.', 'completed', 'work', 'L8470|x', '2026-10-01T09:00', '2026-10-01T09:20');`
  );
  return dbPath;
}

const query = (dbPath, sql, params = []) => submissionDataQuery(dbPath, sql, params).rows;
const revision = (dbPath) => Number(query(dbPath, "SELECT value FROM db_meta WHERE key = 'revision'")[0].value);
const row = (dbPath, id) => query(dbPath, "SELECT status, locked_by, locked_at, rejected_at FROM tickets WHERE id = ?", [id])[0];
const assign = (dbPath, args = {}) => callTool({}, TOOL, { db_path: dbPath, ticket_id: 1, session_token: "sess-a1", ...args });
const code = (expected) => (err) => {
  assert.equal(err.code, expected, err.message);
  return true;
};

test("a queued, unlocked, unshelved job is assigned to the caller's token", async (t) => {
  const dbPath = await jobs(t);
  const before = revision(dbPath);
  const result = await assign(dbPath);
  assert.equal(result.outcome, "assigned");
  assert.equal(result.changes, 1);
  assert.equal(result.locked_by, "sess-a1");
  const after = row(dbPath, 1);
  assert.equal(after.status, "wip");
  assert.equal(after.locked_by, "sess-a1");
  assert.notEqual(after.locked_at, null);
  assert.equal(revision(dbPath), before);
});

test("a job another session holds is a lost race without takeover, and the row is untouched", async (t) => {
  const dbPath = await jobs(t);
  const before = revision(dbPath);
  const result = await assign(dbPath, { ticket_id: 2 });
  assert.equal(result.outcome, "lost_race");
  assert.equal(result.changes, 0);
  assert.equal(result.locked_by, "sess-other");
  assert.deepEqual(row(dbPath, 2), { status: "wip", locked_by: "sess-other", locked_at: "2026-10-01T09:05", rejected_at: null });
  assert.equal(revision(dbPath), before);
});

test("a shelved job is no_match with and without takeover", async (t) => {
  const dbPath = await jobs(t);
  const before = revision(dbPath);
  for (const takeover of [false, true]) {
    const result = await assign(dbPath, { ticket_id: 3, takeover, ...(takeover ? { expected_holder: "ss-other" } : {}) });
    assert.equal(result.outcome, "no_match", `takeover ${takeover}`);
    assert.equal(result.changes, 0);
    assert.equal(result.rejected_at, "2026-10-01T09:10");
  }
  assert.equal(row(dbPath, 3).locked_by, null);
  assert.equal(row(dbPath, 3).rejected_at, "2026-10-01T09:10");
  assert.equal(revision(dbPath), before);
});

test("a retirement-superseded job is no_match with and without takeover", async (t) => {
  const dbPath = await jobs(t);
  const before = revision(dbPath);
  for (const takeover of [false, true]) {
    const result = await assign(dbPath, { ticket_id: 4, takeover, ...(takeover ? { expected_holder: "ss-other" } : {}) });
    assert.equal(result.outcome, "no_match", `takeover ${takeover}`);
    assert.equal(result.status, "superseded");
  }
  assert.equal(row(dbPath, 4).locked_by, null);
  assert.equal(revision(dbPath), before);
});

test("a completed job is no_match even with takeover", async (t) => {
  const dbPath = await jobs(t);
  const before = revision(dbPath);
  const result = await assign(dbPath, { ticket_id: 5, takeover: true, expected_holder: "ss-other" });
  assert.equal(result.outcome, "no_match");
  assert.equal(result.status, "completed");
  assert.equal(row(dbPath, 5).locked_by, null);
  assert.equal(revision(dbPath), before);
});

test("takeover assigns a job another session holds, with a new lock stamp", async (t) => {
  const dbPath = await jobs(t);
  const before = revision(dbPath);
  const result = await assign(dbPath, { ticket_id: 2, takeover: true, expected_holder: "ss-other" });
  assert.equal(result.outcome, "assigned");
  assert.equal(result.changes, 1);
  assert.equal(result.locked_by, "sess-a1");
  assert.notEqual(result.locked_at, "2026-10-01T09:05");
  assert.equal(row(dbPath, 2).locked_by, "sess-a1");
  assert.equal(revision(dbPath), before);
});

test("two take-overs naming the same holder: the first is assigned, the second is holder_changed", async (t) => {
  const dbPath = await jobs(t);
  const before = revision(dbPath);
  const first = await assign(dbPath, { ticket_id: 2, takeover: true, expected_holder: "ss-other" });
  assert.equal(first.outcome, "assigned");
  assert.equal(first.changes, 1);
  assert.equal(row(dbPath, 2).locked_by, "sess-a1");
  // Back to back, inside one clock minute: the compare is on the token, not the lock time.
  const second = await assign(dbPath, { ticket_id: 2, session_token: "sess-b2", takeover: true, expected_holder: "ss-other" });
  assert.equal(second.outcome, "holder_changed");
  assert.equal(second.changes, 0);
  assert.equal(second.locked_by, "sess-a1");
  assert.equal(row(dbPath, 2).locked_by, "sess-a1");
  assert.equal(revision(dbPath), before);
});

test("a take-over of a job released since the card was read is no_match, and the row is untouched", async (t) => {
  const dbPath = await jobs(t);
  const before = revision(dbPath);
  const result = await assign(dbPath, { ticket_id: 1, takeover: true, expected_holder: "ss-other" });
  assert.equal(result.outcome, "no_match");
  assert.equal(result.changes, 0);
  assert.equal(result.status, "queued");
  assert.equal(result.rejected_at, null);
  assert.deepEqual(row(dbPath, 1), { status: "queued", locked_by: null, locked_at: null, rejected_at: null });
  assert.equal(revision(dbPath), before);
});

test("a take-over without a valid 8-character expected_holder, or expected_holder without takeover, is refused", async (t) => {
  const dbPath = await jobs(t);
  const before = revision(dbPath);
  await assert.rejects(assign(dbPath, { ticket_id: 2, takeover: true }), code("invalid_expected_holder"));
  await assert.rejects(assign(dbPath, { ticket_id: 2, takeover: true, expected_holder: "   " }), code("invalid_expected_holder"));
  await assert.rejects(assign(dbPath, { ticket_id: 2, takeover: true, expected_holder: "sess-other" }), code("invalid_expected_holder"));
  await assert.rejects(assign(dbPath, { ticket_id: 2, expected_holder: "ss-other" }), code("invalid_expected_holder"));
  assert.deepEqual(row(dbPath, 2), { status: "wip", locked_by: "sess-other", locked_at: "2026-10-01T09:05", rejected_at: null });
  assert.equal(revision(dbPath), before);
});

test("a job already holding the caller's token reads as assigned with changes 0", async (t) => {
  const dbPath = await jobs(t);
  await assign(dbPath);
  const before = revision(dbPath);
  const result = await assign(dbPath);
  assert.equal(result.outcome, "assigned");
  assert.equal(result.changes, 0);
  assert.equal(result.locked_by, "sess-a1");
  assert.equal(revision(dbPath), before);
});

test("a missing job, an empty token and a bad id are refused, writing nothing", async (t) => {
  const dbPath = await jobs(t);
  const before = revision(dbPath);
  await assert.rejects(assign(dbPath, { ticket_id: 99 }), code("not_found"));
  // An empty token is refused by the shared input validator as a missing required field; a blank one reaches the tool's own check.
  await assert.rejects(assign(dbPath, { session_token: "" }), /session_token is required/);
  await assert.rejects(assign(dbPath, { session_token: "   " }), code("invalid_session_token"));
  await assert.rejects(assign(dbPath, { ticket_id: 0 }), code("invalid_ticket_id"));
  assert.deepEqual(row(dbPath, 1), { status: "queued", locked_by: null, locked_at: null, rejected_at: null });
  assert.equal(revision(dbPath), before);
});
