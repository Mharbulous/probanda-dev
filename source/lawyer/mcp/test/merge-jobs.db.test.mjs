// drafting_data__merge_jobs: a /draft session merges a duplicate job into the job that survives, on
// the practitioner's yes, in one transaction (jobs-closeout.md §9c): the absorbed job's undone steps
// are appended after the survivor's, its scope and Proposal keys are copied, jobs waiting on it wait
// on the survivor, the survivor's approval is cleared, and the absorbed job is superseded by the
// survivor. The survivor's done steps keep their stamps. Every refusal writes nothing.

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const { freshSubmissionDb } = await import("./helpers/template-db.mjs");
const { submissionDataExecute, submissionDataQuery } = await import("../build/submission/backend.js");
const { callTool } = await import("../build/dispatch.js");

const TOOL = "drafting_data__merge_jobs";
const COLS = "(id, proceeding_id, filing_id, title, intent, status, kind, billing_anchor, created";

async function jobs(t) {
  const dir = mkdtempSync(join(tmpdir(), "coclerk-merge-jobs-"));
  t.after(() => rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }));
  const dbPath = join(dir, "submission.sqlite");
  await freshSubmissionDb(dbPath);
  await submissionDataExecute(
    dbPath,
    `INSERT INTO proceedings (id, matter_reference, forum) VALUES (1, 'L8470 - Larchmont', 'CAN/BC/BCSC'), (2, 'L8470 - Larchmont', 'CAN/BC/BCCA');
     INSERT INTO filings (id, proceeding_id, kind, round, title) VALUES (1, 1, 'submissions_package', 'opening', 'Notice of Application'), (2, 1, 'submissions_package', 'reply', 'Reply'), (3, 2, 'submissions_package', 'opening', 'Appeal');
     INSERT INTO tickets ${COLS}, plan_approved_at) VALUES (1, 1, 1, 'Set the hearing down', 'File a notice of hearing.', 'queued', 'work', 'L8470|x', '2026-10-01T09:00', '2026-10-01T09:06');
     INSERT INTO tickets ${COLS}) VALUES (2, 1, 1, 'Fill out the notice of hearing', 'Fill the form step by step.', 'queued', 'work', 'L8470|x', '2026-10-01T09:00');
     INSERT INTO tickets ${COLS}) VALUES (3, 1, 1, 'Serve the notice', 'Serve it.', 'queued', 'work', 'L8470|x', '2026-10-01T09:00');
     INSERT INTO tickets ${COLS}, locked_by, locked_at, plan_approved_at) VALUES (4, 1, 1, 'Held here', 'Do it.', 'wip', 'work', 'L8470|x', '2026-10-01T09:00', 'sess-a1', '2026-10-01T09:05', '2026-10-01T09:06');
     INSERT INTO tickets ${COLS}, locked_by, locked_at) VALUES (5, 1, 1, 'Held elsewhere', 'Do it.', 'wip', 'work', 'L8470|x', '2026-10-01T09:00', 'sess-other', '2026-10-01T09:05');
     INSERT INTO tickets ${COLS}, completed_at) VALUES (6, 1, 1, 'Completed', 'Do it.', 'completed', 'work', 'L8470|x', '2026-10-01T09:00', '2026-10-01T09:20');
     INSERT INTO tickets ${COLS}) VALUES (7, 1, 2, 'Other Writing', 'Do it.', 'queued', 'work', 'L8470|x', '2026-10-01T09:00');
     INSERT INTO tickets ${COLS}) VALUES (8, 2, 3, 'Other proceeding', 'Do it.', 'queued', 'work', 'L8470|x', '2026-10-01T09:00');
     INSERT INTO tickets ${COLS}) VALUES (9, 1, 1, 'Either side', 'Do it.', 'queued', 'work', 'L8470|x', '2026-10-01T09:00');
     INSERT INTO tickets ${COLS}) VALUES (10, 1, 1, 'Or side', 'Do it.', 'queued', 'work', 'L8470|x', '2026-10-01T09:00');
     INSERT INTO tickets ${COLS}) VALUES (11, 1, 1, 'Waits on 12', 'Do it.', 'queued', 'work', 'L8470|x', '2026-10-01T09:00');
     INSERT INTO tickets ${COLS}) VALUES (12, 1, 1, 'Blocker of 11', 'Do it.', 'queued', 'work', 'L8470|x', '2026-10-01T09:00');
     INSERT INTO tickets ${COLS}, rejected_at) VALUES (13, 1, 1, 'Shelved', 'Do it.', 'queued', 'work', 'L8470|x', '2026-10-01T09:00', '2026-10-01T09:10');
     INSERT INTO tickets ${COLS}) VALUES (14, 1, NULL, 'General one', 'Do it.', 'queued', 'work', 'L8470|x', '2026-10-01T09:00');
     INSERT INTO tickets ${COLS}) VALUES (15, 1, NULL, 'General two', 'Do it.', 'queued', 'work', 'L8470|x', '2026-10-01T09:00');
     INSERT INTO tickets ${COLS}, deleted_at) VALUES (16, 1, 1, 'Deleted', 'Do it.', 'queued', 'work', 'L8470|x', '2026-10-01T09:00', '2026-10-01T09:30');
     INSERT INTO ticket_steps (ticket_id, ordinal, text, done_at) VALUES
       (1, 1, 'Check the hearing list.', '2026-10-01T09:07'), (1, 2, 'File the notice of hearing.', NULL),
       (2, 1, 'Open the form.', '2026-10-01T09:08'), (2, 2, 'Fill Part 1.', NULL), (2, 3, 'Fill Part 2.', NULL),
       (4, 1, 'Held step one.', '2026-10-01T09:07'), (4, 2, 'Held step two.', NULL),
       (14, 1, 'General step.', NULL), (15, 1, 'Other general step.', NULL);
     INSERT INTO ticket_scope (ticket_id, entity, entity_id) VALUES (1, 'filing', 1), (2, 'filing', 1), (2, 'fact', 9);
     INSERT INTO ticket_proposals (ticket_id, proposal_key, item) VALUES (1, 'k1', 'Item one.'), (2, 'k1', 'Item one, reworded.'), (2, 'k2', 'Item two.');
     INSERT INTO ticket_blocks (blocker_id, blocked_id) VALUES (2, 3), (12, 11);
     INSERT INTO ticket_conflicts (a_id, b_id) VALUES (9, 10);`
  );
  return dbPath;
}

const query = (dbPath, sql, params = []) => submissionDataQuery(dbPath, sql, params).rows;
const revision = (dbPath) => Number(query(dbPath, "SELECT value FROM db_meta WHERE key = 'revision'")[0].value);
const steps = (dbPath, id) => query(dbPath, "SELECT ordinal, text, done_at FROM ticket_steps WHERE ticket_id = ? ORDER BY ordinal", [id]);
/** Every job row and every child row: what a refusal must leave as it was. */
const everything = (dbPath) => ({
  tickets: query(dbPath, "SELECT * FROM tickets ORDER BY id"),
  steps: query(dbPath, "SELECT * FROM ticket_steps ORDER BY ticket_id, ordinal"),
  scope: query(dbPath, "SELECT * FROM ticket_scope ORDER BY id"),
  proposals: query(dbPath, "SELECT * FROM ticket_proposals ORDER BY ticket_id, proposal_key"),
  blocks: query(dbPath, "SELECT * FROM ticket_blocks ORDER BY blocker_id, blocked_id"),
});
const merge = (dbPath, args = {}) => callTool({}, TOOL, { db_path: dbPath, survivor_id: 1, absorbed_id: 2, session_token: "sess-a1", ...args });
const code = (expected) => (err) => {
  assert.equal(err.code, expected, err.message);
  return true;
};

test("the absorbed job's undone steps follow the survivor's, whose done steps keep their stamps", async (t) => {
  const dbPath = await jobs(t);
  const before = revision(dbPath);
  const result = await merge(dbPath);
  assert.equal(result.outcome, "merged");
  assert.equal(result.steps_added, 2);
  assert.deepEqual(steps(dbPath, 1), [
    { ordinal: 1, text: "Check the hearing list.", done_at: "2026-10-01T09:07" },
    { ordinal: 2, text: "File the notice of hearing.", done_at: null },
    { ordinal: 3, text: "Fill Part 1.", done_at: null },
    { ordinal: 4, text: "Fill Part 2.", done_at: null },
  ]);
  // The absorbed job keeps its own record.
  assert.equal(steps(dbPath, 2).length, 3);
  assert.equal(revision(dbPath), before);
});

test("scope and Proposal keys are copied without duplicates, and the absorbed job's rows stay", async (t) => {
  const dbPath = await jobs(t);
  const result = await merge(dbPath);
  assert.equal(result.scope_added, 1);
  assert.equal(result.keys_added, 1);
  assert.deepEqual(query(dbPath, "SELECT entity, entity_id FROM ticket_scope WHERE ticket_id = 1 ORDER BY id"), [
    { entity: "filing", entity_id: 1 },
    { entity: "fact", entity_id: 9 },
  ]);
  assert.deepEqual(query(dbPath, "SELECT proposal_key, item FROM ticket_proposals WHERE ticket_id = 1 ORDER BY proposal_key"), [
    { proposal_key: "k1", item: "Item one." },
    { proposal_key: "k2", item: "Item two." },
  ]);
  assert.equal(query(dbPath, "SELECT COUNT(*) AS n FROM ticket_proposals WHERE ticket_id = 2")[0].n, 2);
});

test("the absorbed job is superseded by the survivor, not deleted, and the survivor's approval is cleared", async (t) => {
  const dbPath = await jobs(t);
  await merge(dbPath);
  const [absorbed] = query(dbPath, "SELECT status, superseded_by, deleted_at FROM tickets WHERE id = 2");
  assert.deepEqual(absorbed, { status: "superseded", superseded_by: 1, deleted_at: null });
  const [survivor] = query(dbPath, "SELECT status, locked_by, plan_approved_at FROM tickets WHERE id = 1");
  assert.deepEqual(survivor, { status: "queued", locked_by: null, plan_approved_at: null });
});

test("a job waiting on the absorbed job waits on the survivor", async (t) => {
  const dbPath = await jobs(t);
  const result = await merge(dbPath);
  assert.equal(result.blocks_moved, 1);
  assert.deepEqual(query(dbPath, "SELECT blocker_id, blocked_id FROM ticket_blocks ORDER BY blocker_id"), [
    { blocker_id: 1, blocked_id: 3 },
    { blocker_id: 12, blocked_id: 11 },
  ]);
});

test("a survivor that waited on the absorbed job is not made to wait on itself", async (t) => {
  const dbPath = await jobs(t);
  const result = await merge(dbPath, { survivor_id: 3 });
  assert.equal(result.outcome, "merged");
  assert.equal(result.blocks_moved, 0);
  assert.deepEqual(query(dbPath, "SELECT blocker_id, blocked_id FROM ticket_blocks ORDER BY blocker_id"), [{ blocker_id: 12, blocked_id: 11 }]);
});

test("a survivor this session holds keeps its lock and done steps", async (t) => {
  const dbPath = await jobs(t);
  const result = await merge(dbPath, { survivor_id: 4 });
  assert.equal(result.outcome, "merged");
  assert.deepEqual(steps(dbPath, 4).map((s) => [s.ordinal, s.done_at]), [[1, "2026-10-01T09:07"], [2, null], [3, null], [4, null]]);
  const [survivor] = query(dbPath, "SELECT status, locked_by, plan_approved_at FROM tickets WHERE id = 4");
  assert.deepEqual(survivor, { status: "wip", locked_by: "sess-a1", plan_approved_at: null });
});

test("two General Jobs of one proceeding merge", async (t) => {
  const dbPath = await jobs(t);
  const result = await merge(dbPath, { survivor_id: 14, absorbed_id: 15 });
  assert.equal(result.outcome, "merged");
  assert.deepEqual(steps(dbPath, 14).map((s) => s.text), ["General step.", "Other general step."]);
});

test("each refusal writes nothing", async (t) => {
  const dbPath = await jobs(t);
  const before = revision(dbPath);
  const untouched = everything(dbPath);
  const cases = [
    [{ absorbed_id: 5 }, "held_elsewhere", "absorbed"],
    [{ survivor_id: 5 }, "held_elsewhere", "survivor"],
    [{ absorbed_id: 4 }, "held_here", "absorbed"],
    [{ absorbed_id: 6 }, "completed", "absorbed"],
    [{ survivor_id: 6 }, "completed", "survivor"],
    [{ absorbed_id: 13 }, "shelved", "absorbed"],
    [{ absorbed_id: 16 }, "deleted", "absorbed"],
    [{ absorbed_id: 7 }, "different_writing", "absorbed"],
    [{ absorbed_id: 14 }, "different_writing", "absorbed"],
    [{ absorbed_id: 8 }, "different_proceeding", "absorbed"],
    [{ absorbed_id: 9 }, "either_or", "absorbed"],
    [{ absorbed_id: 11 }, "blocked", "absorbed"],
    [{ survivor_id: 11 }, "blocked", "survivor"],
  ];
  for (const [args, outcome, job] of cases) {
    const result = await merge(dbPath, args);
    assert.equal(result.outcome, outcome, JSON.stringify(args));
    assert.equal(result.refused_job, job, JSON.stringify(args));
    assert.equal(result.steps_added, 0);
  }
  assert.deepEqual(everything(dbPath), untouched);
  assert.equal(revision(dbPath), before);
});

test("a second merge of the same pair is refused as superseded", async (t) => {
  const dbPath = await jobs(t);
  await merge(dbPath);
  const after = everything(dbPath);
  const again = await merge(dbPath);
  assert.equal(again.outcome, "superseded");
  assert.deepEqual(everything(dbPath), after);
});

test("bad ids, the same job twice, a blank token and a missing job are refused, writing nothing", async (t) => {
  const dbPath = await jobs(t);
  const untouched = everything(dbPath);
  await assert.rejects(merge(dbPath, { survivor_id: 0 }), code("invalid_ticket_id"));
  await assert.rejects(merge(dbPath, { absorbed_id: 1 }), code("same_job"));
  await assert.rejects(merge(dbPath, { session_token: "   " }), code("invalid_session_token"));
  await assert.rejects(merge(dbPath, { absorbed_id: 99 }), code("not_found"));
  assert.deepEqual(everything(dbPath), untouched);
});
