// drafting_data__release_job: a /draft session returns a wip job to Ready in one call, the guarded
// releasing write followed by its confirm-read (jobs-run.md §10), classified as released,
// taken_over, shelved, completed or no_match from the confirm-read. Only the status and the lock
// change; it never retries and moves no revision.

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const { freshSubmissionDb } = await import("./helpers/template-db.mjs");
const { submissionDataExecute, submissionDataQuery } = await import("../build/submission/backend.js");
const { callTool } = await import("../build/dispatch.js");

const TOOL = "drafting_data__release_job";

async function jobs(t) {
  const dir = mkdtempSync(join(tmpdir(), "coclerk-release-job-"));
  t.after(() => rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }));
  const dbPath = join(dir, "submission.sqlite");
  await freshSubmissionDb(dbPath);
  await submissionDataExecute(
    dbPath,
    `INSERT INTO proceedings (id, matter_reference, forum) VALUES (1, 'L8470 - Larchmont', 'CAN/BC/BCSC');
     INSERT INTO tickets (id, proceeding_id, title, intent, status, kind, billing_anchor, created, locked_by, locked_at, plan_approved_at) VALUES (1, 1, 'Mine', 'Do it.', 'wip', 'work', 'L8470|x', '2026-10-01T09:00', 'sess-a1', '2026-10-01T09:05', '2026-10-01T09:06');
     INSERT INTO tickets (id, proceeding_id, title, intent, status, kind, billing_anchor, created, locked_by, locked_at, plan_approved_at) VALUES (2, 1, 'Held elsewhere', 'Do it.', 'wip', 'work', 'L8470|x', '2026-10-01T09:00', 'sess-other', '2026-10-01T09:05', '2026-10-01T09:06');
     INSERT INTO tickets (id, proceeding_id, title, intent, status, kind, billing_anchor, created, rejected_at) VALUES (3, 1, 'Shelved', 'Do it.', 'queued', 'work', 'L8470|x', '2026-10-01T09:00', '2026-10-01T09:10');
     INSERT INTO tickets (id, proceeding_id, title, intent, status, kind, billing_anchor, created) VALUES (4, 1, 'Retirement-superseded', 'Do it.', 'superseded', 'work', 'L8470|x', '2026-10-01T09:00');
     INSERT INTO tickets (id, proceeding_id, title, intent, status, kind, billing_anchor, created, completed_at) VALUES (5, 1, 'Completed', 'Do it.', 'completed', 'work', 'L8470|x', '2026-10-01T09:00', '2026-10-01T09:20');
     INSERT INTO tickets (id, proceeding_id, title, intent, status, kind, billing_anchor, created) VALUES (6, 1, 'Ready job', 'Do it.', 'queued', 'work', 'L8470|x', '2026-10-01T09:00');
     INSERT INTO ticket_steps (ticket_id, ordinal, text, done_at) VALUES (1, 1, 'First step.', '2026-10-01T09:07'), (1, 2, 'Second step.', NULL), (2, 1, 'First step.', '2026-10-01T09:07'), (2, 2, 'Second step.', NULL);
     INSERT INTO ticket_scope (ticket_id, entity, entity_id) VALUES (1, 'filing', 1), (2, 'filing', 1);
     INSERT INTO ticket_proposals (ticket_id, proposal_key, item) VALUES (1, 'k1', 'An item.'), (2, 'k2', 'An item.');`
  );
  return dbPath;
}

const query = (dbPath, sql, params = []) => submissionDataQuery(dbPath, sql, params).rows;
const revision = (dbPath) => Number(query(dbPath, "SELECT value FROM db_meta WHERE key = 'revision'")[0].value);
const row = (dbPath, id) => query(dbPath, "SELECT status, locked_by, locked_at, rejected_at FROM tickets WHERE id = ?", [id])[0];
/** Every column but the three the release writes, and every child row, for one job. */
const kept = (dbPath, id) => {
  const { status, locked_by, locked_at, ...rest } = query(dbPath, "SELECT * FROM tickets WHERE id = ?", [id])[0];
  return {
    ticket: rest,
    steps: query(dbPath, "SELECT * FROM ticket_steps WHERE ticket_id = ? ORDER BY ordinal", [id]),
    scope: query(dbPath, "SELECT * FROM ticket_scope WHERE ticket_id = ? ORDER BY id", [id]),
    proposals: query(dbPath, "SELECT * FROM ticket_proposals WHERE ticket_id = ? ORDER BY proposal_key", [id]),
  };
};
const release = (dbPath, args = {}) => callTool({}, TOOL, { db_path: dbPath, ticket_id: 1, session_token: "sess-a1", ...args });
const code = (expected) => (err) => {
  assert.equal(err.code, expected, err.message);
  return true;
};

test("the caller's own wip job is released to Ready, every other column and child row kept, no revision moved", async (t) => {
  const dbPath = await jobs(t);
  const before = revision(dbPath);
  const keptBefore = kept(dbPath, 1);
  const result = await release(dbPath);
  assert.equal(result.outcome, "released");
  assert.equal(result.changes, 1);
  assert.equal(result.locked_by, null);
  assert.equal(result.status, "queued");
  assert.deepEqual(row(dbPath, 1), { status: "queued", locked_by: null, locked_at: null, rejected_at: null });
  assert.deepEqual(kept(dbPath, 1), keptBefore);
  assert.equal(keptBefore.ticket.plan_approved_at, "2026-10-01T09:06");
  assert.equal(keptBefore.steps.filter((s) => s.done_at !== null).length, 1);
  assert.equal(revision(dbPath), before);
});

test("expected_holder releases another session's job while that holder is still on the row", async (t) => {
  const dbPath = await jobs(t);
  const before = revision(dbPath);
  const keptBefore = kept(dbPath, 2);
  const result = await release(dbPath, { ticket_id: 2, expected_holder: "ss-other" });
  assert.equal(result.outcome, "released");
  assert.equal(result.changes, 1);
  assert.deepEqual(row(dbPath, 2), { status: "queued", locked_by: null, locked_at: null, rejected_at: null });
  assert.deepEqual(kept(dbPath, 2), keptBefore);
  assert.equal(revision(dbPath), before);
});

test("without expected_holder another session's job is taken_over, and the row is untouched", async (t) => {
  const dbPath = await jobs(t);
  const before = revision(dbPath);
  const result = await release(dbPath, { ticket_id: 2 });
  assert.equal(result.outcome, "taken_over");
  assert.equal(result.changes, 0);
  assert.equal(result.locked_by, "sess-other");
  assert.deepEqual(row(dbPath, 2), { status: "wip", locked_by: "sess-other", locked_at: "2026-10-01T09:05", rejected_at: null });
  assert.equal(revision(dbPath), before);
});

test("expected_holder naming a stale holder writes nothing and reads taken_over", async (t) => {
  const dbPath = await jobs(t);
  // The job changed hands after the card was read.
  const takeover = await callTool({}, "drafting_data__assign_job", { db_path: dbPath, ticket_id: 2, session_token: "sess-b2", takeover: true, expected_holder: "ss-other" });
  assert.equal(takeover.outcome, "assigned");
  const before = revision(dbPath);
  const held = row(dbPath, 2);
  const keptBefore = kept(dbPath, 2);
  const result = await release(dbPath, { ticket_id: 2, expected_holder: "ss-other" });
  assert.equal(result.outcome, "taken_over");
  assert.equal(result.changes, 0);
  assert.equal(result.locked_by, "sess-b2");
  assert.deepEqual(row(dbPath, 2), held);
  assert.deepEqual(kept(dbPath, 2), keptBefore);
  assert.equal(revision(dbPath), before);
});

test("a shelved job is shelved with and without expected_holder, writing nothing", async (t) => {
  const dbPath = await jobs(t);
  const before = revision(dbPath);
  for (const extra of [{}, { expected_holder: "ss-other" }]) {
    const result = await release(dbPath, { ticket_id: 3, ...extra });
    assert.equal(result.outcome, "shelved");
    assert.equal(result.changes, 0);
    assert.equal(result.rejected_at, "2026-10-01T09:10");
  }
  assert.deepEqual(row(dbPath, 3), { status: "queued", locked_by: null, locked_at: null, rejected_at: "2026-10-01T09:10" });
  assert.equal(revision(dbPath), before);
});

test("a completed job is completed, writing nothing", async (t) => {
  const dbPath = await jobs(t);
  const before = revision(dbPath);
  const result = await release(dbPath, { ticket_id: 5, expected_holder: "ss-other" });
  assert.equal(result.outcome, "completed");
  assert.equal(result.changes, 0);
  assert.equal(result.status, "completed");
  assert.equal(revision(dbPath), before);
});

test("a job already in Ready, a superseded job, and a second release are no_match, writing nothing", async (t) => {
  const dbPath = await jobs(t);
  const ready = await release(dbPath, { ticket_id: 6 });
  assert.equal(ready.outcome, "no_match");
  assert.equal(ready.changes, 0);
  assert.deepEqual(row(dbPath, 6), { status: "queued", locked_by: null, locked_at: null, rejected_at: null });
  const superseded = await release(dbPath, { ticket_id: 4, expected_holder: "ss-other" });
  assert.equal(superseded.outcome, "no_match");
  assert.equal(superseded.status, "superseded");
  const first = await release(dbPath);
  assert.equal(first.outcome, "released");
  const before = revision(dbPath);
  const second = await release(dbPath);
  assert.equal(second.outcome, "no_match");
  assert.equal(second.changes, 0);
  assert.equal(revision(dbPath), before);
});

test("a bad expected_holder, a blank token, a bad id and a missing job are refused, writing nothing", async (t) => {
  const dbPath = await jobs(t);
  const before = revision(dbPath);
  await assert.rejects(release(dbPath, { ticket_id: 2, expected_holder: "   " }), code("invalid_expected_holder"));
  await assert.rejects(release(dbPath, { ticket_id: 2, expected_holder: "sess-other" }), code("invalid_expected_holder"));
  await assert.rejects(release(dbPath, { session_token: "   " }), code("invalid_session_token"));
  await assert.rejects(release(dbPath, { ticket_id: 0 }), code("invalid_ticket_id"));
  await assert.rejects(release(dbPath, { ticket_id: 99 }), code("not_found"));
  assert.deepEqual(row(dbPath, 1), { status: "wip", locked_by: "sess-a1", locked_at: "2026-10-01T09:05", rejected_at: null });
  assert.deepEqual(row(dbPath, 2), { status: "wip", locked_by: "sess-other", locked_at: "2026-10-01T09:05", rejected_at: null });
  assert.equal(revision(dbPath), before);
});
