// The dispatch key of a research dispatch on a job: the holder's session_token and the claim_no its
// drafting_data__assign_job returned. drafting_data__track_source lists what to dispatch only to the
// holder at the current claim, and lists a source the job already got under `landed`, never again under
// `dispatch`. Every research_filing write naming the job refuses any other key and files nothing;
// research naming no job files without one.

import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const { freshSubmissionDb } = await import("./helpers/template-db.mjs");
const { submissionDataExecute, submissionDataQuery } = await import("../build/submission/backend.js");
const { callTool } = await import("../build/dispatch.js");

const A = "session-aaaa1111";
const B = "session-bbbb2222";
const CITE = { kind: "decision", label: "2021 BCSC 963" };

async function seeded(t) {
  const dir = realpathSync.native(mkdtempSync(join(tmpdir(), "coclerk-dispatch-key-")));
  const downloads = realpathSync.native(mkdtempSync(join(tmpdir(), "coclerk-dispatch-key-downloads-")));
  const before = process.env.COCLERK_DOWNLOADS_DIR;
  process.env.COCLERK_DOWNLOADS_DIR = downloads;
  t.after(() => {
    if (before === undefined) delete process.env.COCLERK_DOWNLOADS_DIR;
    else process.env.COCLERK_DOWNLOADS_DIR = before;
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    rmSync(downloads, { recursive: true, force: true });
  });
  writeFileSync(join(downloads, "2021 BCSC 963.pdf"), "decision\n");
  const dbPath = join(dir, "submission.sqlite");
  await freshSubmissionDb(dbPath);
  await submissionDataExecute(
    dbPath,
    `INSERT INTO proceedings (id, matter_reference, forum) VALUES (1, 'L8470 - Larchmont', 'CAN/BC/BCSC');
     INSERT INTO tickets (id, proceeding_id, title, intent, status, kind, billing_anchor, created) VALUES (1, 1, 'Legal research: Is it?', 'Is it?', 'queued', 'work', 'L8470|x', '2026-10-01T09:00');
     INSERT INTO ticket_steps (ticket_id, ordinal, text) VALUES (1, 1, 'Read the file.');`
  );
  const law = join(dir, "6. LAW", "Issue");
  mkdirSync(law, { recursive: true });
  return { dbPath, law };
}

const assign = (dbPath, token, args = {}) => callTool({}, "drafting_data__assign_job", { db_path: dbPath, ticket_id: 1, session_token: token, ...args });
const track = (dbPath, key, args) => callTool({}, "drafting_data__track_source", { db_path: dbPath, ticket_id: 1, ...key, ...args });
const code = (expected) => (err) => {
  assert.equal(err.code, expected, err.message);
  return true;
};

test("only the holder at the current claim is told to dispatch", async (t) => {
  const { dbPath } = await seeded(t);
  const first = (await assign(dbPath, A)).claim_no;
  const held = await track(dbPath, { session_token: A, claim_no: first }, { add: [CITE] });
  assert.equal(held.outcome, "recorded");
  assert.deepEqual(held.dispatch, ["decision: 2021 BCSC 963"]);

  const other = await track(dbPath, { session_token: B, claim_no: first }, { add: [CITE] });
  assert.equal(other.outcome, "not_held");
  assert.deepEqual(other.dispatch, []);

  await assert.rejects(track(dbPath, { session_token: A }, { add: [CITE] }), code("stale_claim"));
  await assert.rejects(track(dbPath, { session_token: A, claim_no: first + 1 }, { add: [CITE] }), code("stale_claim"));
});

test("a filing under a stale or missing key, or by a session that lost the job, is refused and files nothing", async (t) => {
  const { dbPath, law } = await seeded(t);
  const first = (await assign(dbPath, A)).claim_no;
  const job = { db_path: dbPath, ticket_id: 1 };
  const download = (key) => callTool({}, "research_filing__file_download", { ...job, ...key, destination_dir: law, source_filename: "2021 BCSC 963.pdf" });
  const manifest = (key) => callTool({}, "research_filing__append_manifest", { ...job, ...key, destination_dir: law, record: { citation: "2021 BCSC 963", status: "downloaded" } });
  const save = (key) => callTool({}, "research_filing__save_answer", { ...job, ...key, destination_dir: law, filename: "answer.md", text: "Answer.\n" });

  for (const write of [download, manifest, save]) await assert.rejects(write({ session_token: A }), code("stale_claim"));
  assert.deepEqual(readdirSync(law), []);

  await submissionDataExecute(
    dbPath,
    `INSERT OR REPLACE INTO kv_store (namespace, key, value, updated_at) VALUES ('last_activity', 'tickets:1', '"' || strftime('%Y-%m-%dT%H:%M', 'now', 'localtime', '-45 minutes') || '"', '2026-10-01T00:00:00Z')`
  );
  const card = submissionDataQuery(dbPath, "SELECT trim(value, '\"') AS v FROM kv_store WHERE namespace = 'last_activity' AND key = 'tickets:1'").rows[0].v;
  const taken = await assign(dbPath, B, { takeover: true, expected_holder: "aaaa1111", expected_last_activity: card });
  assert.equal(taken.outcome, "assigned");
  for (const write of [download, manifest, save]) await assert.rejects(write({ session_token: A, claim_no: first }), code("not_held"));
  assert.deepEqual(readdirSync(law), [], "nothing the old holder's dispatch got is filed");

  assert.deepEqual((await download({ session_token: B, claim_no: taken.claim_no })).job, { ticket_id: 1, recorded: true });
  assert.ok(existsSync(join(law, "2021 BCSC 963.pdf")));
});

test("research naming no job files without a key", async (t) => {
  const { law } = await seeded(t);
  const saved = await callTool({}, "research_filing__save_answer", { destination_dir: law, filename: "answer.md", text: "Answer.\n" });
  assert.equal(saved.job, undefined);
  assert.ok(existsSync(saved.path));
});

test("a repeated request for a source already got returns it as landed and dispatches nothing; one not retrieved is dispatched again", async (t) => {
  const { dbPath } = await seeded(t);
  const key = { session_token: A, claim_no: (await assign(dbPath, A)).claim_no };
  const ACT = { kind: "legislation", label: "Limitation Act, SBC 2012, c 13" };
  await track(dbPath, key, { add: [CITE, ACT] });
  await track(dbPath, key, { close: [{ ...CITE, outcome: "got" }, { ...ACT, outcome: "not_retrieved", reason: "not-dispatched" }] });

  const again = await track(dbPath, key, { add: [CITE, ACT] });
  assert.equal(again.outcome, "recorded");
  assert.deepEqual(again.dispatch, ["legislation: Limitation Act, SBC 2012, c 13"]);
  assert.equal(again.landed.length, 1);
  assert.equal(again.landed[0].label, "2021 BCSC 963");
  assert.equal(again.landed[0].outcome, "got");
  assert.match(again.note, /already got/);
  assert.equal(again.sources.find((s) => s.label === "2021 BCSC 963").outcome, "got", "a landed source stays closed");
  assert.equal(again.sources.find((s) => s.kind === "legislation").closed_at, null, "a source not retrieved is reopened");
});
