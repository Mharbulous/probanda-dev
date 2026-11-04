// A job's last activity is one stored stamp (kv_store `last_activity` / `tickets:<id>`, schema v80).
// Every server write made for a held job moves it, the research_filing writes too when they name the
// job, and drafting_data__touch_job moves it at the holder's turn end. A write by any session that
// does not hold the lock moves nothing, and a research_filing write naming a job it does not hold is
// refused not_held and files nothing. board_card's `last activity` and the idle tag read it, and a
// ⏳ step counts as activity until its wake-up minute passes. No revision moves.

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const { freshSubmissionDb } = await import("./helpers/template-db.mjs");
const { submissionDataExecute, submissionDataQuery } = await import("../build/submission/backend.js");
const { fetchProceeding } = await import("../build/submission/forms/query.js");
const { buildPreFilingBoardData } = await import("../build/submission/forms/render-work-board.js");
const { renderLiveLanes, submissionFormsBoardCard } = await import("../build/submission/matter-pages.js");
const { nowMinute } = await import("../build/submission/forms/timings.js");
const { callTool } = await import("../build/index.js");

const SEED = `INSERT INTO proceedings (id, matter_reference, forum) VALUES (1, 'L8470 - Larchmont', NULL);
  INSERT INTO tickets (id, proceeding_id, filing_id, title, intent, status, priority, kind, billing_anchor, locked_by, locked_at, plan_approved_at, created)
    VALUES (1, 1, NULL, 'Legal research: When did time start to run?', 'When did time start to run?', 'wip', 0, 'work', 'L8470|limitation', 'sess-holder', '2026-01-16 09:00', '2026-01-16 09:00', '2026-01-16 08:55');
  INSERT INTO tickets (id, proceeding_id, filing_id, title, intent, status, priority, kind, billing_anchor, created)
    VALUES (2, 1, NULL, 'Check the guarantor', 'Is the guarantor a party?', 'queued', 0, 'work', 'L8470|guarantor', '2026-01-16 08:56');
  INSERT INTO ticket_steps (ticket_id, ordinal, text, done_at) VALUES (1, 1, 'Run the research', NULL);`;

async function seeded(t) {
  const matter = realpathSync.native(mkdtempSync(join(tmpdir(), "coclerk-job-activity-")));
  const downloads = realpathSync.native(mkdtempSync(join(tmpdir(), "coclerk-job-activity-downloads-")));
  const before = process.env.COCLERK_DOWNLOADS_DIR;
  process.env.COCLERK_DOWNLOADS_DIR = downloads;
  t.after(() => {
    if (before === undefined) delete process.env.COCLERK_DOWNLOADS_DIR;
    else process.env.COCLERK_DOWNLOADS_DIR = before;
    rmSync(matter, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    rmSync(downloads, { recursive: true, force: true });
  });
  writeFileSync(join(matter, "coclerk.json"), "{}\n");
  mkdirSync(join(matter, "0. DRAFT"));
  const law = join(matter, "6. LAW", "Limitation");
  mkdirSync(law, { recursive: true });
  writeFileSync(join(downloads, "2021 BCSC 963.pdf"), "decision\n");
  const dbPath = join(matter, "drafting.sqlite");
  await freshSubmissionDb(dbPath);
  await submissionDataExecute(dbPath, SEED);
  return { dbPath, matter, law };
}

const query = (dbPath, sql, params = []) => submissionDataQuery(dbPath, sql, params).rows;
const revision = (dbPath) => query(dbPath, "SELECT value FROM db_meta WHERE key = 'revision'")[0].value;
const stamp = (dbPath, id) => {
  const [row] = query(dbPath, "SELECT value FROM kv_store WHERE namespace = 'last_activity' AND key = ?", [`tickets:${id}`]);
  return row === undefined ? null : JSON.parse(row.value);
};
const clear = (dbPath) => submissionDataExecute(dbPath, "DELETE FROM kv_store WHERE namespace = 'last_activity'");

/** Runs `write` with the stamp cleared, then asserts it moved to the minute the write ran in. */
async function moves(dbPath, id, label, write) {
  await clear(dbPath);
  const from = nowMinute();
  await write();
  const to = nowMinute();
  const at = stamp(dbPath, id);
  assert.ok(at !== null && at >= from && at <= to, `${label} moved the stamp (got ${at})`);
}

test("every write made for a held job moves its one stored stamp, and no revision moves", async (t) => {
  const { dbPath, matter, law } = await seeded(t);
  const job = { db_path: dbPath, ticket_id: 1, session_token: "sess-holder" };
  const before = revision(dbPath);

  await moves(dbPath, 2, "assign_job", () => callTool({}, "drafting_data__assign_job", { db_path: dbPath, ticket_id: 2, session_token: "sess-other" }));
  await moves(dbPath, 1, "set_step", () => callTool({}, "drafting_data__set_step", { ...job, ordinal: 1, status: "waiting" }));
  assert.equal(query(dbPath, "SELECT value FROM db_meta WHERE key = 'job_active:1'")[0].value, stamp(dbPath, 1), "set_step moves the session-active stamp in the same write");
  await moves(dbPath, 1, "approve_plan", () => callTool({}, "drafting_data__approve_plan", job));
  await moves(dbPath, 1, "rewrite_job", () => callTool({}, "drafting_data__rewrite_job", { ...job, held: true, steps: ["Save the memo"], append: true }));
  await moves(dbPath, 1, "track_source", () => callTool({}, "drafting_data__track_source", { ...job, add: [{ kind: "decision", label: "2021 BCSC 963" }] }));
  await moves(dbPath, 1, "save_answer", () => callTool({}, "research_filing__save_answer", { ...job, destination_dir: law, filename: "answer.md", text: "Answer.\n" }));
  await moves(dbPath, 1, "file_download", async () => {
    const filed = await callTool({}, "research_filing__file_download", { ...job, destination_dir: law, source_filename: "2021 BCSC 963.pdf" });
    assert.deepEqual(filed.job, { ticket_id: 1, recorded: true });
  });
  await moves(dbPath, 1, "append_manifest", () => callTool({}, "research_filing__append_manifest", { ...job, destination_dir: law, record: { citation: "2021 BCSC 963", status: "downloaded" } }));
  await moves(dbPath, 1, "write_scratch", () => callTool({}, "research_filing__write_scratch", { ...job, matter_root: matter, filename: "notes.md", text: "Notes.\n" }));
  await moves(dbPath, 1, "touch_job", async () => {
    const touched = await callTool({}, "drafting_data__touch_job", job);
    assert.equal(touched.recorded, true);
  });
  assert.equal(query(dbPath, "SELECT value FROM db_meta WHERE key = 'job_active:1'")[0].value, stamp(dbPath, 1), "touch_job writes the session-active stamp too");
  assert.equal(revision(dbPath), before);
});

test("a write by a session that does not hold the job's lock moves nothing", async (t) => {
  const { dbPath, matter, law } = await seeded(t);
  const stale = { db_path: dbPath, ticket_id: 1, session_token: "sess-before-takeover" };

  assert.equal((await callTool({}, "drafting_data__set_step", { ...stale, ordinal: 1, status: "waiting" })).outcome, "not_held");
  assert.equal((await callTool({}, "drafting_data__track_source", { ...stale, add: [{ kind: "decision", label: "2021 BCSC 963" }] })).outcome, "not_held");
  const notHeld = (err) => err.code === "not_held" || assert.fail(`${err.code} ${err.message}`);
  await assert.rejects(callTool({}, "research_filing__save_answer", { ...stale, destination_dir: law, filename: "answer.md", text: "Answer.\n" }), notHeld);
  await assert.rejects(callTool({}, "research_filing__append_manifest", { ...stale, destination_dir: law, record: { status: "downloaded" } }), notHeld);
  await assert.rejects(callTool({}, "research_filing__write_scratch", { ...stale, matter_root: matter, filename: "notes.md", text: "Notes.\n" }), notHeld);
  assert.deepEqual(readdirSync(law), [], "a refused filing writes no file");
  const touched = await callTool({}, "drafting_data__touch_job", stale);
  assert.equal(touched.recorded, false);
  assert.match(touched.note, /not this session's/);

  assert.equal(stamp(dbPath, 1), null);
  assert.deepEqual(query(dbPath, "SELECT key FROM db_meta WHERE key LIKE 'job_active:%'"), []);
});

test("a research_filing write naming only part of a job is refused before anything is written", async (t) => {
  const { dbPath, law } = await seeded(t);
  const calls = {
    research_filing__file_download: { source_filename: "2021 BCSC 963.pdf" },
    research_filing__append_manifest: { record: {} },
    research_filing__file_fetched: { url: "https://example.org", filename: "x.md", record: {} },
  };
  for (const [name, args] of Object.entries(calls)) {
    await assert.rejects(callTool({}, name, { db_path: dbPath, ticket_id: 1, destination_dir: law, ...args }), (err) => err.code === "invalid_job" || assert.fail(`${name}: ${err.code} ${err.message}`));
  }
  assert.deepEqual(query(dbPath, "SELECT key FROM kv_store"), []);
});

test("board_card's last activity and the idle tag read the stamp, and a ⏳ step counts until its minute passes", async (t) => {
  const { dbPath } = await seeded(t);
  const line = (rendered) =>
    renderLiveLanes(buildPreFilingBoardData(dbPath, fetchProceeding(dbPath, 1), { revision: 1, matter: "", client: "", rendered })).find((l) => l.startsWith("- Job #1 "));
  const head = "- Job #1 Legal research: When did time start to run? · In Progress 0/1";

  assert.equal(line("2026-01-16 09:20"), `${head} · idle 20 min, about 0%`, "no stamp yet: the lock");
  await submissionDataExecute(dbPath, `INSERT INTO kv_store (namespace, key, value, updated_at) VALUES ('last_activity', 'tickets:1', '"2026-01-16T11:00"', '2026-01-16T19:00:00.000Z');`);
  assert.equal(line("2026-01-16 11:40"), `${head} · idle 40 min, about 0%`);
  assert.match(submissionFormsBoardCard({ db_path: dbPath, proceeding_id: 1, jobs: [1] }, {}, "2026-01-16 11:40").card, / · last activity: 2026-01-16T11:00\n/);

  await submissionDataExecute(dbPath, "UPDATE ticket_steps SET status = 'waiting', wait_until = '2026-01-16T12:30' WHERE ticket_id = 1;");
  assert.equal(line("2026-01-16 12:10"), head, "waiting: not idle");
  assert.equal(line("2026-01-16 13:00"), `${head} · idle 30 min, about 0%`, "idle from the wake-up minute once it has passed");
});

// ADR 0015: a held job stays held until 60 minutes idle; then its lock has lapsed and every board
// reads it as released, so Dispatch can choose it.
test("a held job stays held until 60 minutes idle, then reads as released", async (t) => {
  const { dbPath } = await seeded(t);
  const ticket = (rendered) => buildPreFilingBoardData(dbPath, fetchProceeding(dbPath, 1), { revision: 1, matter: "", client: "", rendered }).tickets.find((x) => x.id === 1);

  assert.equal(ticket("2026-01-16 09:10").category, "wip");
  assert.equal(ticket("2026-01-16 09:45").category, "wip", "45 minutes: still held");
  const lapsed = ticket("2026-01-16 10:01");
  assert.equal(lapsed.category, "ready", "61 minutes: the lock has lapsed");
  assert.equal(lapsed.locked_by, null, "a lapsed lock reads as released, so no holder shows");
  assert.deepEqual(lapsed.dispatch_skips, []);
  assert.equal(query(dbPath, "SELECT status FROM tickets WHERE id = 1")[0].status, "wip", "the board writes nothing");
});
