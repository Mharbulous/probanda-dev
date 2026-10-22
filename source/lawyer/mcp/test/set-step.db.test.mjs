// drafting_data__set_step: the session holding a job sets one step's status (schema v78) under the
// lock-holder guard, then reads it back: retry, cancelled and deferred (only on the practitioner's
// words), waiting (wait_until = now + wait_minutes, default 5, "setting timer for N minutes"), and
// open, which clears all three. A done step is frozen. It moves no revision.

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const { freshSubmissionDb, submissionDbAt } = await import("./helpers/template-db.mjs");
const { submissionDataExecute, submissionDataQuery } = await import("../build/submission/backend.js");
const { callTool } = await import("../build/dispatch.js");

const TOOL = "drafting_data__set_step";
const SEED = `INSERT INTO proceedings (id, matter_reference, forum) VALUES (1, 'L8470 - Larchmont', 'CAN/BC/BCSC');
  INSERT INTO tickets (id, proceeding_id, title, intent, status, kind, billing_anchor, created, locked_by, locked_at, plan_approved_at) VALUES (1, 1, 'Mine', 'Do it.', 'wip', 'work', 'L8470|x', '2026-10-01T09:00', 'sess-a1', '2026-10-01T09:05', '2026-10-01T09:06');
  INSERT INTO tickets (id, proceeding_id, title, intent, status, kind, billing_anchor, created, locked_by, locked_at, plan_approved_at) VALUES (2, 1, 'Held elsewhere', 'Do it.', 'wip', 'work', 'L8470|x', '2026-10-01T09:00', 'sess-other', '2026-10-01T09:05', '2026-10-01T09:06');
  INSERT INTO ticket_steps (ticket_id, ordinal, text, done_at) VALUES (1, 1, 'Read the file.', '2026-10-01T09:07'), (1, 2, 'Run the Westlaw query.', NULL), (2, 1, 'Run the Westlaw query.', NULL);`;

async function seeded(t, version) {
  const dir = mkdtempSync(join(tmpdir(), "coclerk-set-step-"));
  t.after(() => rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }));
  const dbPath = join(dir, "submission.sqlite");
  if (version === undefined) await freshSubmissionDb(dbPath);
  else submissionDbAt(dbPath, version);
  await submissionDataExecute(dbPath, SEED);
  return dbPath;
}

const query = (dbPath, sql, params = []) => submissionDataQuery(dbPath, sql, params).rows;
const revision = (dbPath) => Number(query(dbPath, "SELECT value FROM db_meta WHERE key = 'revision'")[0].value);
const step = (dbPath, id, ordinal) => query(dbPath, "SELECT done_at, status, wait_until, status_note FROM ticket_steps WHERE ticket_id = ? AND ordinal = ?", [id, ordinal])[0];
const set = (dbPath, args) => callTool({}, TOOL, { db_path: dbPath, ticket_id: 1, ordinal: 2, session_token: "sess-a1", ...args });
const code = (expected) => (err) => {
  assert.equal(err.code, expected, err.message);
  return true;
};
/** The local minute `minutes` from now, as SQL's strftime writes it. */
const localMinute = (dbPath, minutes) => query(dbPath, `SELECT strftime('%Y-%m-%dT%H:%M', 'now', 'localtime', '+${minutes} minutes') AS m`)[0].m;

test("retry, cancelled and deferred each land on the held step, and open clears them, moving no revision", async (t) => {
  const dbPath = await seeded(t);
  const before = revision(dbPath);

  const retry = await set(dbPath, { status: "retry" });
  assert.equal(retry.outcome, "set");
  assert.equal(retry.changes, 1);
  assert.deepEqual(step(dbPath, 1, 2), { done_at: null, status: "retry", wait_until: null, status_note: null });

  const cancelled = await set(dbPath, { status: "cancelled", practitioner_words: "  Skip Westlaw, we have enough.  " });
  assert.equal(cancelled.outcome, "set");
  assert.deepEqual(step(dbPath, 1, 2), { done_at: null, status: "cancelled", wait_until: null, status_note: "Skip Westlaw, we have enough." });

  const deferred = await set(dbPath, { status: "deferred", practitioner_words: "Leave it until the reply comes in." });
  assert.equal(deferred.outcome, "set");
  assert.deepEqual(step(dbPath, 1, 2), { done_at: null, status: "deferred", wait_until: null, status_note: "Leave it until the reply comes in." });

  const open = await set(dbPath, { status: "open" });
  assert.equal(open.outcome, "set");
  assert.deepEqual(step(dbPath, 1, 2), { done_at: null, status: null, wait_until: null, status_note: null });
  assert.equal(revision(dbPath), before, "the job tables carry no revision triggers");
});

test("waiting sets wait_until to now plus 5 minutes by default, or wait_minutes, and says it is setting the timer", async (t) => {
  const dbPath = await seeded(t);
  const low = localMinute(dbPath, 5);
  const result = await set(dbPath, { status: "waiting" });
  const high = localMinute(dbPath, 5);
  assert.equal(result.outcome, "set");
  assert.equal(result.status, "waiting");
  assert.ok(result.wait_until === low || result.wait_until === high, `${result.wait_until} is now + 5 minutes`);
  assert.match(result.note, /^setting timer for 5 minutes: step 2 of job 1 waits until \d{2}:\d{2}\./);
  assert.ok(result.note.includes(result.wait_until.slice(11)), result.note);
  assert.equal(step(dbPath, 1, 2).status_note, null);

  const ten = await set(dbPath, { status: "waiting", wait_minutes: 10 });
  assert.match(ten.note, /^setting timer for 10 minutes/);
  assert.ok([localMinute(dbPath, 10), localMinute(dbPath, 9)].includes(ten.wait_until), ten.wait_until);
});

test("another session's job and a done step are left as they are", async (t) => {
  const dbPath = await seeded(t);

  const elsewhere = await set(dbPath, { ticket_id: 2, ordinal: 1, status: "retry" });
  assert.equal(elsewhere.outcome, "not_held");
  assert.equal(elsewhere.changes, 0);
  assert.deepEqual(step(dbPath, 2, 1), { done_at: null, status: null, wait_until: null, status_note: null });

  const done = await set(dbPath, { ordinal: 1, status: "retry" });
  assert.equal(done.outcome, "done");
  assert.equal(done.changes, 0);
  assert.deepEqual(step(dbPath, 1, 1), { done_at: "2026-10-01T09:07", status: null, wait_until: null, status_note: null }, "the stamp stays frozen");

  const missing = await set(dbPath, { ordinal: 9, status: "retry" });
  assert.equal(missing.outcome, "no_match");
});

test("cancelled and deferred need the practitioner's words, and nothing is written without them", async (t) => {
  const dbPath = await seeded(t);
  for (const status of ["cancelled", "deferred"]) {
    await assert.rejects(set(dbPath, { status }), code("practitioner_words_required"));
    await assert.rejects(set(dbPath, { status, practitioner_words: "   " }), code("practitioner_words_required"));
  }
  await assert.rejects(set(dbPath, { status: "retry", practitioner_words: "Because." }), code("invalid_practitioner_words"));
  await assert.rejects(set(dbPath, { status: "retry", wait_minutes: 5 }), code("invalid_wait_minutes"));
  await assert.rejects(set(dbPath, { status: "waiting", wait_minutes: 0 }), code("invalid_wait_minutes"));
  await assert.rejects(set(dbPath, { status: "done" }), /status/);
  assert.deepEqual(step(dbPath, 1, 2), { done_at: null, status: null, wait_until: null, status_note: null });
});

test("a database held below v78 is refused, writing nothing", async (t) => {
  const dbPath = await seeded(t, 77);
  await assert.rejects(set(dbPath, { status: "retry" }), code("schema_below_v78"));
  assert.deepEqual(query(dbPath, "SELECT done_at FROM ticket_steps WHERE ticket_id = 1 AND ordinal = 2")[0], { done_at: null });
});
