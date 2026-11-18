// A write that changes no row leaves the live drafting database alone, so a sync service sees no new
// work (spec 2026-11-17 drafting-records-sync-safety §3.4 and §3.6, criteria 2 and 3). A job's last
// activity and session-active stamp move at most every 15 minutes, so a touch inside that window
// changes no row and replaces nothing. A write whose only effect is a trigger's, and a script that
// only changes the schema, still replace the file.

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const { freshSubmissionDb } = await import("./helpers/template-db.mjs");
const { submissionDataExecute, submissionDataQuery, submissionDataWrite } = await import("../build/submission/backend.js");
const { nowMinute } = await import("../build/submission/forms/timings.js");
const { callTool } = await import("../build/index.js");

const SEED = `INSERT INTO proceedings (id, matter_reference, forum) VALUES (1, 'L8470 - Larchmont', NULL);
  INSERT INTO tickets (id, proceeding_id, filing_id, title, intent, status, priority, kind, billing_anchor, locked_by, locked_at, created)
    VALUES (1, 1, NULL, 'Check the limitation date', 'When did time start to run?', 'wip', 0, 'work', 'L8470|limitation', 'sess-holder', '2026-01-16 09:00', '2026-01-16 08:55');
  INSERT INTO tickets (id, proceeding_id, filing_id, title, intent, status, priority, kind, billing_anchor, created)
    VALUES (2, 1, NULL, 'Check the guarantor', 'Is the guarantor a party?', 'queued', 0, 'work', 'L8470|guarantor', '2026-01-16 08:56');`;

async function seeded(t) {
  const matter = realpathSync.native(mkdtempSync(join(tmpdir(), "coclerk-write-skip-")));
  t.after(() => rmSync(matter, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }));
  writeFileSync(join(matter, "coclerk.json"), "{}\n");
  mkdirSync(join(matter, "0. DRAFT"));
  const dbPath = join(matter, "drafting.sqlite");
  await freshSubmissionDb(dbPath);
  await submissionDataExecute(dbPath, SEED);
  return dbPath;
}

const PAST = new Date("2026-01-01T00:00:00Z");

/** The file's bytes, modification time and file id, after setting that time to a fixed past instant.
 * A replace renames a new file over the live one, so it shows as a new file id even when it keeps the
 * bytes and, through copy2, the modification time. */
function snapshot(dbPath) {
  utimesSync(dbPath, PAST, PAST);
  const st = statSync(dbPath, { bigint: true });
  return { bytes: readFileSync(dbPath), mtime: st.mtimeMs, ino: st.ino };
}

function unchanged(dbPath, before, label) {
  const st = statSync(dbPath, { bigint: true });
  assert.equal(st.ino, before.ino, `${label}: not replaced (same file id)`);
  assert.equal(st.mtimeMs, before.mtime, `${label}: modification time unchanged`);
  assert.ok(readFileSync(dbPath).equals(before.bytes), `${label}: bytes unchanged`);
}

function changed(dbPath, before, label) {
  assert.notEqual(statSync(dbPath, { bigint: true }).ino, before.ino, `${label}: the file was replaced`);
}

/** The local minute `minutes` before now, as the server stamps it. */
const ago = (minutes) => nowMinute(-minutes);

/** Sets job `id`'s last activity and session-active stamp by hand to `minutes` ago. */
const stampBoth = (dbPath, id, minutes) =>
  submissionDataExecute(
    dbPath,
    `INSERT OR REPLACE INTO kv_store (namespace, key, value, updated_at) VALUES ('last_activity', 'tickets:${id}', '"${ago(minutes)}"', '2026-01-01T00:00:00Z');
     INSERT OR REPLACE INTO db_meta (key, value) VALUES ('job_active:${id}', '${ago(minutes)}');`
  );

const touch = (dbPath, token) => callTool({}, "drafting_data__touch_job", { db_path: dbPath, ticket_id: 1, session_token: token });

test("touch_job for a job this session does not hold leaves the file unchanged", async (t) => {
  const dbPath = await seeded(t);
  const before = snapshot(dbPath);
  const out = (await touch(dbPath, "sess-other"));
  assert.equal(out.recorded, false);
  unchanged(dbPath, before, "touch_job by a non-holder");
});

test("a release_job that matches no row leaves the file unchanged", async (t) => {
  const dbPath = await seeded(t);
  const before = snapshot(dbPath);
  const out = (await callTool({}, "drafting_data__release_job", { db_path: dbPath, ticket_id: 2, session_token: "sess-holder" }));
  assert.equal(out.changes, 0);
  assert.equal(out.outcome, "no_match");
  unchanged(dbPath, before, "release_job matching no row");
});

test("touch_job moves the stamps at most every 15 minutes, and replaces the file only when it does", async (t) => {
  const dbPath = await seeded(t);
  const kv = () => JSON.parse(submissionDataQuery(dbPath, "SELECT value FROM kv_store WHERE namespace = 'last_activity' AND key = 'tickets:1'", []).rows[0].value);
  const active = () => submissionDataQuery(dbPath, "SELECT value FROM db_meta WHERE key = 'job_active:1'", []).rows[0].value;

  await stampBoth(dbPath, 1, 20);
  let before = snapshot(dbPath);
  let out = (await touch(dbPath, "sess-holder"));
  assert.equal(out.recorded, true);
  changed(dbPath, before, "the first touch, 20 minutes after the last");
  assert.ok(kv() >= ago(1), "last activity moved to now");
  assert.ok(active() >= ago(1), "session-active stamp moved to now");

  // The second touch, 5 minutes after the first.
  await stampBoth(dbPath, 1, 5);
  const [kept, keptActive] = [kv(), active()];
  before = snapshot(dbPath);
  out = (await touch(dbPath, "sess-holder"));
  assert.equal(out.recorded, true, "the job is still this session's, its stamps within the window");
  unchanged(dbPath, before, "a touch 5 minutes after the last");
  assert.equal(kv(), kept, "last activity kept");
  assert.equal(active(), keptActive, "session-active stamp kept");

  // A third, 15 minutes after the last.
  await stampBoth(dbPath, 1, 15);
  before = snapshot(dbPath);
  out = (await touch(dbPath, "sess-holder"));
  assert.equal(out.recorded, true);
  changed(dbPath, before, "a touch 15 minutes after the last");
  assert.ok(kv() >= ago(1), "last activity moved to now");
  assert.ok(active() >= ago(1), "session-active stamp moved to now");
});

test("a tool's own write carrying the touch still replaces the file inside the window", async (t) => {
  const dbPath = await seeded(t);
  await submissionDataExecute(dbPath, "INSERT INTO ticket_steps (ticket_id, ordinal, text, done_at) VALUES (1, 1, 'Run the research', NULL);");
  await stampBoth(dbPath, 1, 5);
  const before = snapshot(dbPath);
  await callTool({}, "drafting_data__set_step", { db_path: dbPath, ticket_id: 1, session_token: "sess-holder", ordinal: 1, status: "waiting" });
  changed(dbPath, before, "set_step inside the window");
  assert.equal(submissionDataQuery(dbPath, "SELECT status FROM ticket_steps WHERE ticket_id = 1 AND ordinal = 1", []).rows[0].status, "waiting");
});

test("a write whose only effect is a trigger's still replaces the file: total_changes counts it", async (t) => {
  const dbPath = await seeded(t);
  await submissionDataExecute(
    dbPath,
    `CREATE TABLE probe (x INTEGER);
     CREATE TABLE probe_log (y INTEGER);
     CREATE TRIGGER probe_ignore BEFORE INSERT ON probe BEGIN INSERT INTO probe_log VALUES (NEW.x); SELECT RAISE(IGNORE); END;`
  );
  const before = snapshot(dbPath);
  const out = await submissionDataWrite(dbPath, "INSERT INTO probe VALUES (7)", []);
  assert.equal(out.changes, 0, "the statement itself changed no row");
  changed(dbPath, before, "the trigger-only write");
  assert.deepEqual(submissionDataQuery(dbPath, "SELECT y FROM probe_log", []).rows, [{ y: 7 }]);
  assert.deepEqual(submissionDataQuery(dbPath, "SELECT x FROM probe", []).rows, []);
});

test("a script that only changes the schema still replaces the file; one that changes nothing does not", async (t) => {
  const dbPath = await seeded(t);
  let before = snapshot(dbPath);
  await submissionDataExecute(dbPath, "CREATE INDEX probe_idx ON tickets (billing_anchor);");
  changed(dbPath, before, "a schema-only script");
  assert.equal(submissionDataQuery(dbPath, "SELECT count(*) AS n FROM sqlite_master WHERE name = 'probe_idx'", []).rows[0].n, 1);

  before = snapshot(dbPath);
  const out = await submissionDataExecute(dbPath, "UPDATE tickets SET title = 'x' WHERE id = 999;");
  assert.equal(out.ok, true);
  assert.equal(out.changes, 0);
  unchanged(dbPath, before, "a script matching no row");
});
