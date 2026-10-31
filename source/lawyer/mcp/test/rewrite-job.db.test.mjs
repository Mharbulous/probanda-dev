// drafting_data__rewrite_job: a job's title and steps rewritten under one guard riding every
// statement, then read back. Ready mode (the pickup rewrite) refuses a job that is locked, shelved,
// approved or has a step done, and replaces the whole list. Held mode (the partial replace and the
// held-job title cleanup) matches only this session's job, deletes only the steps not done (none with
// append), and moves the session-active stamp. It moves no revision.

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const { freshSubmissionDb } = await import("./helpers/template-db.mjs");
const { submissionDataExecute, submissionDataQuery } = await import("../build/submission/backend.js");
const { callTool } = await import("../build/dispatch.js");

const TOOL = "drafting_data__rewrite_job";
const job = (id, title, extra = "") =>
  `INSERT INTO tickets (id, proceeding_id, title, intent, status, kind, billing_anchor, created${extra ? ", " + extra.split("=")[0] : ""}) VALUES (${id}, 1, '${title}', 'Do it.', 'queued', 'work', 'L8470|x', '2026-10-01T09:00'${extra ? ", " + extra.split("=")[1] : ""});`;
const SEED = `INSERT INTO proceedings (id, matter_reference, forum) VALUES (1, 'L8470 - Larchmont', 'CAN/BC/BCSC');
  ${job(1, "Ready")}
  ${job(2, "Shelved", "rejected_at='2026-10-01T09:10'")}
  ${job(3, "Approved", "plan_approved_at='2026-10-01T09:10'")}
  ${job(4, "Has a done step")}
  INSERT INTO tickets (id, proceeding_id, title, intent, status, kind, billing_anchor, created, locked_by, locked_at, plan_approved_at) VALUES (5, 1, 'Held', 'Do it.', 'wip', 'work', 'L8470|x', '2026-10-01T09:00', 'sess-a1', '2026-10-01T09:05', '2026-10-01T09:06');
  INSERT INTO tickets (id, proceeding_id, title, intent, status, kind, billing_anchor, created, locked_by, locked_at) VALUES (6, 1, 'Held elsewhere', 'Do it.', 'wip', 'work', 'L8470|x', '2026-10-01T09:00', 'sess-other', '2026-10-01T09:05');
  INSERT INTO ticket_steps (ticket_id, ordinal, text, done_at) VALUES
    (1, 1, 'Draft the reply and check the costs figure', NULL), (2, 1, 'Old', NULL), (3, 1, 'Old', NULL),
    (4, 1, 'Read', '2026-10-01T09:07'), (4, 2, 'Write', NULL),
    (5, 1, 'Read the file', '2026-10-01T09:07'), (5, 2, 'Restate the request', NULL), (5, 3, 'Also restated', NULL),
    (6, 1, 'Old', NULL);`;

async function seeded(t) {
  const dir = mkdtempSync(join(tmpdir(), "coclerk-rewrite-job-"));
  t.after(() => rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }));
  const dbPath = join(dir, "submission.sqlite");
  await freshSubmissionDb(dbPath);
  await submissionDataExecute(dbPath, SEED);
  return dbPath;
}

const query = (dbPath, sql, params = []) => submissionDataQuery(dbPath, sql, params).rows;
const revision = (dbPath) => Number(query(dbPath, "SELECT value FROM db_meta WHERE key = 'revision'")[0].value);
const steps = (dbPath, id) => query(dbPath, "SELECT ordinal, text, done_at FROM ticket_steps WHERE ticket_id = ? ORDER BY ordinal", [id]);
const title = (dbPath, id) => query(dbPath, "SELECT title FROM tickets WHERE id = ?", [id])[0].title;
const rewrite = (dbPath, args) => callTool({}, TOOL, { db_path: dbPath, ...args });
const code = (expected) => (err) => {
  assert.equal(err.code, expected, err.message);
  return true;
};

test("ready mode replaces a Ready job's steps whole and its title, verbatim, stamping nothing", async (t) => {
  const dbPath = await seeded(t);
  const before = revision(dbPath);
  const result = await rewrite(dbPath, { ticket_id: 1, title: "Reply to the letter of 3 May", steps: ["Draft the reply", "check the costs figure"] });
  assert.equal(result.outcome, "rewritten");
  assert.equal(result.title, "Reply to the letter of 3 May");
  assert.deepEqual(result.steps, [
    { ordinal: 1, text: "Draft the reply", done_at: null },
    { ordinal: 2, text: "check the costs figure", done_at: null },
  ]);
  assert.equal(result.plan_approved_at, null);
  assert.equal(result.locked_by, null);
  assert.deepEqual(query(dbPath, "SELECT key FROM db_meta WHERE key LIKE 'job_active:%'"), []);
  assert.equal(revision(dbPath), before);
});

test("ready mode refuses a job that is locked, shelved, approved or has a step done, writing nothing", async (t) => {
  const dbPath = await seeded(t);
  for (const [id, outcome] of [[2, "shelved"], [3, "approved"], [4, "step_done"], [5, "locked"]]) {
    const before = steps(dbPath, id);
    const result = await rewrite(dbPath, { ticket_id: id, title: "New", steps: ["New step"] });
    assert.equal(result.outcome, outcome, `job ${id}`);
    assert.deepEqual(steps(dbPath, id), before, `job ${id}'s steps are untouched`);
    assert.notEqual(title(dbPath, id), "New");
  }
});

test("held mode deletes only the steps not done, appends after the highest left, and re-stamps the approval", async (t) => {
  const dbPath = await seeded(t);
  const result = await rewrite(dbPath, { ticket_id: 5, held: true, session_token: "sess-a1", steps: ["Save the memo"] });
  assert.equal(result.outcome, "rewritten");
  assert.deepEqual(steps(dbPath, 5), [
    { ordinal: 1, text: "Read the file", done_at: "2026-10-01T09:07" },
    { ordinal: 2, text: "Save the memo", done_at: null },
  ]);
  assert.ok(result.plan_approved_at > "2026-10-01T09:06", "the approval travels with the new steps");
  assert.equal(query(dbPath, "SELECT count(*) AS n FROM db_meta WHERE key = 'job_active:5'")[0].n, 1, "the session-active stamp moved");

  await rewrite(dbPath, { ticket_id: 5, held: true, session_token: "sess-a1", steps: ["Run the Westlaw query"], append: true });
  assert.deepEqual(steps(dbPath, 5).map((s) => s.text), ["Read the file", "Save the memo", "Run the Westlaw query"], "append deletes nothing");

  const approvedAt = query(dbPath, "SELECT plan_approved_at FROM tickets WHERE id = 5")[0].plan_approved_at;
  const retitled = await rewrite(dbPath, { ticket_id: 5, held: true, session_token: "sess-a1", title: "Held, retitled" });
  assert.equal(retitled.outcome, "rewritten");
  assert.equal(title(dbPath, 5), "Held, retitled");
  assert.equal(retitled.plan_approved_at, approvedAt, "a title alone touches no stamp");
  assert.equal(steps(dbPath, 5).length, 3);
});

test("held mode on another session's job writes nothing", async (t) => {
  const dbPath = await seeded(t);
  const result = await rewrite(dbPath, { ticket_id: 6, held: true, session_token: "sess-a1", title: "Mine now", steps: ["New"] });
  assert.equal(result.outcome, "not_held");
  assert.deepEqual(steps(dbPath, 6), [{ ordinal: 1, text: "Old", done_at: null }]);
  assert.equal(title(dbPath, 6), "Held elsewhere");
  assert.deepEqual(query(dbPath, "SELECT key FROM db_meta WHERE key LIKE 'job_active:%'"), []);
});

test("bad arguments are refused before anything is written", async (t) => {
  const dbPath = await seeded(t);
  await assert.rejects(rewrite(dbPath, { ticket_id: 1 }), code("nothing_to_write"));
  await assert.rejects(rewrite(dbPath, { ticket_id: 1, steps: [] }), code("invalid_steps"));
  await assert.rejects(rewrite(dbPath, { ticket_id: 1, steps: ["two\nlines"] }), code("invalid_steps"));
  await assert.rejects(rewrite(dbPath, { ticket_id: 1, title: "  " }), code("invalid_title"));
  await assert.rejects(rewrite(dbPath, { ticket_id: 1, title: "T", session_token: "sess-a1" }), code("invalid_session_token"));
  await assert.rejects(rewrite(dbPath, { ticket_id: 5, held: true, title: "T" }), code("invalid_session_token"));
  await assert.rejects(rewrite(dbPath, { ticket_id: 1, steps: ["S"], append: true }), code("invalid_append"));
  await assert.rejects(rewrite(dbPath, { ticket_id: 99, title: "T" }), code("not_found"));
  assert.equal(title(dbPath, 1), "Ready");
});
