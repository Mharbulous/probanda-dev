// drafting_data__create_job: one call writes a job with its steps, scope, links and conversion
// records under its kind's duplicate guard (jobs-create.md §3, §3e, §3f; jobs-stock.md §3c, §3d,
// §3g). The guard is tested before the row exists, so it never matches the job it guards, and a
// guarded call writes nothing.

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const { freshSubmissionDb } = await import("./helpers/template-db.mjs");
const { submissionDataExecute, submissionDataQuery } = await import("../build/submission/backend.js");
const { callTool } = await import("../build/dispatch.js");

const TOOL = "drafting_data__create_job";

async function board(t) {
  const dir = mkdtempSync(join(tmpdir(), "coclerk-create-job-"));
  t.after(() => rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }));
  const dbPath = join(dir, "submission.sqlite");
  await freshSubmissionDb(dbPath);
  await submissionDataExecute(
    dbPath,
    `INSERT INTO proceedings (id, matter_reference, forum) VALUES (1, 'L8470 - Larchmont', 'CAN/BC/BCSC');
     INSERT INTO filings (id, proceeding_id, kind, round, title) VALUES (1, 1, 'submissions_package', 'opening', 'Opening Submissions Package');
     INSERT INTO tickets (id, proceeding_id, filing_id, title, intent, status, kind, billing_anchor, priority, created) VALUES (1, 1, 1, 'Queued here', 'Do it.', 'queued', 'work', 'L8470|x', 3, '2026-10-01T09:00');
     INSERT INTO tickets (id, proceeding_id, filing_id, title, intent, status, kind, billing_anchor, priority, created) VALUES (2, 1, NULL, 'General job', 'Do it.', 'queued', 'work', 'L8470|x', -2, '2026-10-01T09:00');
     INSERT INTO tickets (id, proceeding_id, filing_id, title, intent, status, kind, billing_anchor, priority, created, locked_by, locked_at) VALUES (3, 1, 1, 'Held job', 'Do it.', 'wip', 'work', 'L8470|x', 5, '2026-10-01T09:00', 'sess-a1', '2026-10-01T09:05');
     INSERT INTO ticket_scope (ticket_id, entity, entity_id) VALUES (3, 'facts', NULL);
     INSERT INTO seeds (id, proceeding_id, filing_id, created, surfaced_by, idea) VALUES (1, 1, 1, '2026-10-01T09:00', 'session', 'an idea');`
  );
  return dbPath;
}

const query = (dbPath, sql, params = []) => submissionDataQuery(dbPath, sql, params).rows;
const ticketCount = (dbPath) => query(dbPath, "SELECT COUNT(*) AS n FROM tickets")[0].n;
const base = { proceeding_id: 1, filing_id: 1, title: "Reply to attornment", intent: "Reply to their attornment argument.", kind: "work", billing_anchor: "L8470|attornment", steps: ["Draft the reply"], guard: "none" };
const create = (dbPath, args = {}) => callTool({}, TOOL, { db_path: dbPath, ...base, ...args });
const code = (expected) => (err) => {
  assert.equal(err.code, expected, err.message);
  return true;
};

test("a plain create writes the job, its steps, scope, blocks, seed and created_by in one call", async (t) => {
  const dbPath = await board(t);
  const result = await create(dbPath, {
    priority: "bottom",
    steps: ["Audit the exhibit list", "Reconcile against the disclosure log"],
    scope: [{ entity: "facts", entity_id: null }],
    blocks: [1],
    conflicts: [2],
    seed_id: 1,
    created_by: "sess-a1",
  });
  assert.equal(result.outcome, "created");
  const id = result.ticket_id;
  // The Writing's queue holds jobs 1 (3) and 2 (-2, proceeding-scoped): bottom is -3.
  assert.equal(result.priority, -3);
  assert.deepEqual(query(dbPath, "SELECT status, priority, created_by, filing_id FROM tickets WHERE id = ?", [id])[0], { status: "queued", priority: -3, created_by: "sess-a1", filing_id: 1 });
  assert.deepEqual(query(dbPath, "SELECT ordinal, text FROM ticket_steps WHERE ticket_id = ? ORDER BY ordinal", [id]), [
    { ordinal: 1, text: "Audit the exhibit list" },
    { ordinal: 2, text: "Reconcile against the disclosure log" },
  ]);
  assert.deepEqual(query(dbPath, "SELECT entity, entity_id FROM ticket_scope WHERE ticket_id = ?", [id]), [{ entity: "facts", entity_id: null }]);
  assert.deepEqual(query(dbPath, "SELECT blocker_id FROM ticket_blocks WHERE blocked_id = ?", [id]), [{ blocker_id: 1 }]);
  assert.deepEqual(query(dbPath, "SELECT a_id, b_id FROM ticket_conflicts"), [{ a_id: 2, b_id: id }]);
  assert.equal(query(dbPath, "SELECT charted_into FROM seeds WHERE id = 1")[0].charted_into, id);
});

test("top reads the Writing's queue; a Work Board's job reads the Work Board's alone", async (t) => {
  const dbPath = await board(t);
  assert.equal((await create(dbPath, { priority: "top" })).priority, 4);
  const milestone = await callTool({}, "drafting_data__create_milestone", { db_path: dbPath, proceeding_id: 1, title: "Settlement" });
  // Job 2 is proceeding-scoped and never queues on a Work Board, so the Work Board starts at 0.
  assert.equal((await create(dbPath, { filing_id: milestone.filing_id, priority: "bottom" })).priority, 0);
});

test("live_key: a live holder of a key guards the create, writes nothing and is named", async (t) => {
  const dbPath = await board(t);
  const keys = [{ key: "note-up:authorities:5", item: "Smith v. Jones" }];
  const first = await create(dbPath, { filing_id: null, priority: 0, guard: "live_key", proposal_keys: keys });
  assert.equal(first.outcome, "created");
  assert.deepEqual(query(dbPath, "SELECT proposal_key, item FROM ticket_proposals WHERE ticket_id = ?", [first.ticket_id]), [{ proposal_key: "note-up:authorities:5", item: "Smith v. Jones" }]);
  const before = ticketCount(dbPath);
  const second = await create(dbPath, { filing_id: null, priority: 0, guard: "live_key", proposal_keys: keys });
  assert.equal(second.outcome, "guarded");
  assert.equal(second.holder_id, first.ticket_id);
  assert.equal(ticketCount(dbPath), before);
  // A completed holder no longer guards live_key, but still guards never_held_key.
  await submissionDataExecute(dbPath, `UPDATE tickets SET status = 'completed', completed_at = '2026-10-02T09:00' WHERE id = ${first.ticket_id}`);
  assert.equal((await create(dbPath, { filing_id: null, priority: 0, guard: "never_held_key", proposal_keys: keys })).outcome, "guarded");
  assert.equal((await create(dbPath, { filing_id: null, priority: 0, guard: "live_key", proposal_keys: keys })).outcome, "created");
});

test("title_live_with_step: counsel's review pair lands whole once, the second job blocked on the first", async (t) => {
  const dbPath = await board(t);
  const pair = {
    title: "Prepare the review pages",
    intent: "Extract the source pages.",
    steps: ["Extract the source pages into the Writing's folder"],
    priority: "top",
    guard: "title_live_with_step",
    companions: [{ title: "Counsel's review of Opening Submissions Package", intent: "Counsel reviews.", steps: ["Review every paragraph"], scope: [{ entity: "facts", entity_id: null }], blocked_by_lead: true }],
  };
  const first = await create(dbPath, pair);
  assert.equal(first.outcome, "created");
  assert.equal(first.companion_ids.length, 1);
  const [review] = first.companion_ids;
  assert.deepEqual(query(dbPath, "SELECT blocker_id FROM ticket_blocks WHERE blocked_id = ?", [review]), [{ blocker_id: first.ticket_id }]);
  assert.equal(query(dbPath, "SELECT priority FROM tickets WHERE id = ?", [review])[0].priority, first.priority);
  const before = ticketCount(dbPath);
  const second = await create(dbPath, pair);
  assert.equal(second.outcome, "guarded");
  assert.equal(ticketCount(dbPath), before);
});

test("title_and_step_any_status and scrutiny_statement guard repeats", async (t) => {
  const dbPath = await board(t);
  const finding = { title: "Decide an overstatement finding", steps: ['¶3: "x" — overstated'], priority: 0, guard: "title_and_step_any_status" };
  assert.equal((await create(dbPath, finding)).outcome, "created");
  assert.equal((await create(dbPath, finding)).outcome, "guarded");
  assert.equal((await create(dbPath, { ...finding, steps: ['¶4: "y" — overstated'] })).outcome, "created");
  const scrutiny = { filing_id: null, title: "Review scrutiny finding: Smith (statement 12)", priority: "top", guard: "scrutiny_statement", scope: [{ entity: "statements_of_law", entity_id: 12 }, { entity: "authorities", entity_id: null }] };
  const s1 = await create(dbPath, scrutiny);
  assert.equal(s1.outcome, "created");
  const s2 = await create(dbPath, scrutiny);
  assert.equal(s2.outcome, "guarded");
  assert.equal(s2.holder_id, s1.ticket_id);
});

test("holder_lock copies the held job's scope, and writes nothing once the lock is lost", async (t) => {
  const dbPath = await board(t);
  const blocker = { title: "Does attornment defeat the stay", priority: 5, guard: "holder_lock", session_token: "sess-a1", held_ticket_id: 3, steps: ["Create a plan for how to complete this job."] };
  const made = await create(dbPath, blocker);
  assert.equal(made.outcome, "created");
  assert.deepEqual(query(dbPath, "SELECT entity, entity_id FROM ticket_scope WHERE ticket_id = ?", [made.ticket_id]), [{ entity: "facts", entity_id: null }]);
  const before = ticketCount(dbPath);
  const lost = await create(dbPath, { ...blocker, session_token: "sess-other" });
  assert.equal(lost.outcome, "guarded");
  assert.equal(ticketCount(dbPath), before);
});

test("refusals write nothing", async (t) => {
  const dbPath = await board(t);
  const before = ticketCount(dbPath);
  await assert.rejects(create(dbPath, { priority: 0, steps: [] }), code("invalid_steps"));
  await assert.rejects(create(dbPath, { priority: 0, guard: "live_key" }), code("invalid_proposal_keys"));
  await assert.rejects(create(dbPath, { priority: 0, proposal_keys: [{ key: "k", item: "i" }] }), code("invalid_proposal_keys"));
  await assert.rejects(callTool({}, TOOL, { db_path: dbPath, ...base, filing_id: undefined, priority: 0 }), code("invalid_filing_id"));
  await assert.rejects(create(dbPath, { priority: 0, seed_id: 99 }), code("invalid_seed_id"));
  assert.equal(ticketCount(dbPath), before);
});
