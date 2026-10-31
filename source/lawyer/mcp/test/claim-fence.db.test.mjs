// The claim number (kv_store claim_no / tickets:<id>): drafting_data__assign_job raises it on every
// claim of a job and returns it, and every holder-guarded write on the job takes it. A write carrying
// an older claim, or none on a job that has one, is refused stale_claim and writes nothing, even from
// the session that holds the job now, as after a lapse and a re-take by the same session.

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const { freshSubmissionDb } = await import("./helpers/template-db.mjs");
const { submissionDataExecute, submissionDataQuery } = await import("../build/submission/backend.js");
const { callTool } = await import("../build/dispatch.js");

const A = "session-aaaa1111";
const B = "session-bbbb2222";

async function seeded(t) {
  const dir = mkdtempSync(join(tmpdir(), "coclerk-claim-fence-"));
  t.after(() => rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }));
  const dbPath = join(dir, "submission.sqlite");
  await freshSubmissionDb(dbPath);
  await submissionDataExecute(
    dbPath,
    `INSERT INTO proceedings (id, matter_reference, forum) VALUES (1, 'L8470 - Larchmont', 'CAN/BC/BCSC');
     INSERT INTO tickets (id, proceeding_id, title, intent, status, kind, billing_anchor, created) VALUES (1, 1, 'The job', 'Do it.', 'queued', 'work', 'L8470|x', '2026-10-01T09:00');
     INSERT INTO tickets (id, proceeding_id, title, intent, status, kind, billing_anchor, created) VALUES (2, 1, 'A duplicate', 'Do it.', 'queued', 'work', 'L8470|x', '2026-10-01T09:00');
     INSERT INTO ticket_steps (ticket_id, ordinal, text) VALUES (1, 1, 'Read the file.'), (1, 2, 'Write the memo.'), (2, 1, 'Read it again.');`
  );
  const law = join(dir, "6. LAW", "Issue");
  mkdirSync(law, { recursive: true });
  return { dbPath, dir, law };
}

const query = (dbPath, sql, params = []) => submissionDataQuery(dbPath, sql, params).rows;
const assign = (dbPath, token, args = {}) => callTool({}, "drafting_data__assign_job", { db_path: dbPath, ticket_id: 1, session_token: token, ...args });
/** Sets job 1's last activity to `minutes` before SQLite's local now. */
const idle = (dbPath, minutes) =>
  submissionDataExecute(
    dbPath,
    `INSERT OR REPLACE INTO kv_store (namespace, key, value, updated_at) VALUES ('last_activity', 'tickets:1', '"' || strftime('%Y-%m-%dT%H:%M', 'now', 'localtime', '-${minutes} minutes') || '"', '2026-10-01T00:00:00Z')`
  );
/** Every row a job write could touch. */
const snapshot = (dbPath) =>
  ["tickets", "ticket_steps", "ticket_sources", "ticket_answers", "ticket_scope", "kv_store", "db_meta"].map((table) => query(dbPath, `SELECT * FROM ${table} ORDER BY 1, 2`));
const code = (expected) => (err) => {
  assert.equal(err.code, expected, err.message);
  return true;
};

test("each claim of a job returns a strictly larger claim_no: an assign, a re-take after a release, a take-over and a re-take after a lapse", async (t) => {
  const { dbPath } = await seeded(t);
  const first = await assign(dbPath, A);
  assert.equal(first.outcome, "assigned");
  assert.equal(first.claim_no, 1);
  assert.equal((await assign(dbPath, A)).claim_no, 1, "a re-assign that writes nothing is no new claim");
  assert.equal((await assign(dbPath, B)).claim_no, null, "a lost race returns no claim_no");

  assert.equal((await callTool({}, "drafting_data__release_job", { db_path: dbPath, ticket_id: 1, session_token: A, claim_no: 1 })).outcome, "released");
  const second = await assign(dbPath, A);
  assert.equal(second.claim_no, 2);

  await idle(dbPath, 45);
  const card = query(dbPath, "SELECT trim(value, '\"') AS v FROM kv_store WHERE namespace = 'last_activity' AND key = 'tickets:1'")[0].v;
  const taken = await assign(dbPath, B, { takeover: true, expected_holder: "aaaa1111", expected_last_activity: card });
  assert.equal(taken.outcome, "assigned");
  assert.equal(taken.claim_no, 3);

  await idle(dbPath, 61);
  const lapsed = await assign(dbPath, A);
  assert.equal(lapsed.outcome, "assigned");
  assert.equal(lapsed.claim_no, 4);
});

test("after a lapse and a re-take by the same session, every holder-guarded write carrying the earlier claim is refused and writes nothing", async (t) => {
  const { dbPath, dir, law } = await seeded(t);
  const earlier = (await assign(dbPath, A)).claim_no;
  await idle(dbPath, 61);
  const retaken = await assign(dbPath, A);
  assert.equal(retaken.changes, 1);
  assert.match(retaken.note, /lock had lapsed/);
  assert.ok(retaken.claim_no > earlier);

  const before = snapshot(dbPath);
  const job = { db_path: dbPath, ticket_id: 1, session_token: A };
  const calls = {
    set_step: (claim) => callTool({}, "drafting_data__set_step", { ...job, ...claim, ordinal: 1, status: "done" }),
    approve_plan: (claim) => callTool({}, "drafting_data__approve_plan", { ...job, ...claim }),
    track_source: (claim) => callTool({}, "drafting_data__track_source", { ...job, ...claim, add: [{ kind: "decision", label: "2021 BCSC 963" }] }),
    rewrite_job: (claim) => callTool({}, "drafting_data__rewrite_job", { ...job, ...claim, held: true, steps: ["Save the memo."], append: true }),
    touch_job: (claim) => callTool({}, "drafting_data__touch_job", { ...job, ...claim }),
    release_job: (claim) => callTool({}, "drafting_data__release_job", { ...job, ...claim }),
    complete_job: (claim) => callTool({}, "drafting_data__complete_job", { ...job, ...claim, draft_dir: dir }),
    delete_job: (claim) => callTool({}, "drafting_data__delete_job", { db_path: dbPath, ticket_ids: [1], session_token: A, ...claim }),
    merge_jobs: (claim) => callTool({}, "drafting_data__merge_jobs", { db_path: dbPath, survivor_id: 1, absorbed_id: 2, session_token: A, ...claim }),
    create_job: (claim) =>
      callTool({}, "drafting_data__create_job", {
        db_path: dbPath, proceeding_id: 1, filing_id: null, title: "A spin-off", intent: "Do it.", kind: "work", billing_anchor: "L8470|x", priority: 1,
        steps: ["Create a plan for how to complete this job."], guard: "holder_lock", session_token: A, held_ticket_id: 1, ...claim,
      }),
    save_answer: (claim) => callTool({}, "research_filing__save_answer", { ...job, ...claim, destination_dir: law, filename: "answer.md", text: "Answer.\n" }),
    append_manifest: (claim) => callTool({}, "research_filing__append_manifest", { ...job, ...claim, destination_dir: law, record: { citation: "2021 BCSC 963", status: "downloaded" } }),
  };
  for (const [tool, call] of Object.entries(calls)) {
    await assert.rejects(call({ claim_no: earlier }), code("stale_claim"), `${tool} with the earlier claim`);
    await assert.rejects(call({}), code("stale_claim"), `${tool} with no claim`);
  }
  assert.deepEqual(snapshot(dbPath), before, "nothing was written");
  assert.equal(query(dbPath, "SELECT COUNT(*) AS n FROM tickets")[0].n, 2);

  const done = await calls.set_step({ claim_no: retaken.claim_no });
  assert.equal(done.outcome, "set");
  assert.equal((await calls.touch_job({ claim_no: retaken.claim_no })).recorded, true);
});

test("a malformed claim_no is refused before anything is written", async (t) => {
  const { dbPath } = await seeded(t);
  await assign(dbPath, A);
  const before = snapshot(dbPath);
  for (const claim_no of [0, -1, 1.5]) {
    await assert.rejects(callTool({}, "drafting_data__set_step", { db_path: dbPath, ticket_id: 1, session_token: A, claim_no, ordinal: 1, status: "done" }), code("invalid_claim_no"));
  }
  assert.deepEqual(snapshot(dbPath), before);
});

test("a job locked before claims were numbered is still written by its holder with no claim_no", async (t) => {
  const { dbPath } = await seeded(t);
  await submissionDataExecute(dbPath, `UPDATE tickets SET status = 'wip', locked_by = '${A}', locked_at = '2026-10-01T09:05' WHERE id = 1`);
  const result = await callTool({}, "drafting_data__set_step", { db_path: dbPath, ticket_id: 1, session_token: A, ordinal: 1, status: "done" });
  assert.equal(result.outcome, "set");
});
