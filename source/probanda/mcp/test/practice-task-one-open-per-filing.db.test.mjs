// ADR 0023: a to-do is one outcome. A matter holds at most one open to-do per filing reference
// (D4), and a to-do entered in error or merged into another is withdrawn, kept but never open (D6).

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const { LocalPracticeAdmin } = await import("../build/practice/backend.js");
const { practiceEntityFor } = await import("../build/practice-registry.js");
const reads = await import("../build/tools/practice/reads.js");
const writes = await import("../build/tools/practice/writes.js");

const OWNER = "00000000-0000-4000-8000-0000000000aa";
const tasks = practiceEntityFor("practice_tasks");

function tempDatabase(t, label) {
  const dbPath = join(tmpdir(), `coclerk-practice-${label}-${randomUUID()}.db`);
  t.after(() => rmSync(dbPath, { force: true }));
  return dbPath;
}

function runPython(script, dbPath) {
  const python = process.env.COCLERK_PYTHON || "python";
  const result = spawnSync(python, ["-c", script, dbPath], { encoding: "utf-8" });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}

async function withMatters(t, label) {
  const admin = new LocalPracticeAdmin({ ...process.env, COCLERK_DB_PATH: tempDatabase(t, label) });
  for (const num of ["L-ONE", "L-TWO"]) {
    await writes.upsert_client_matter(admin, OWNER, { client_num: `C-${num}`, name: `Client ${num}`, matt_num: num, file_number: `F-${num}` });
  }
  return admin;
}

const todo = (admin, args) => writes.upsert_task(admin, OWNER, { matt_num: "L-ONE", task_type: "client", ...args });

// The refusal names the to-do that holds the reference, by id and description.
async function refusedFor(write, holder) {
  await assert.rejects(write, (err) => {
    assert.match(err.message, /already has an open to-do/);
    assert.ok(err.message.includes(holder.id), err.message);
    assert.ok(err.message.includes(holder.description), err.message);
    return true;
  });
}

async function openDescriptions(admin, matt_num) {
  return (await reads.open_tasks(admin, OWNER, { matt_num })).rows.map((row) => row.description).sort();
}

test("a second open to-do on the same filing_ref in one matter is refused, naming the first", async (t) => {
  const admin = await withMatters(t, "one-open-create");
  const first = await todo(admin, { description: "Re-file default judgment application", filing_ref: "filing:3" });

  await refusedFor(() => todo(admin, { description: "Research the rejection", filing_ref: "filing:3" }), first);
  const forum = await todo(admin, { description: "Choose the forum", filing_ref: "proceeding:2" });
  await refusedFor(() => todo(admin, { description: "Research the forum", filing_ref: "proceeding:2" }), forum);

  await todo(admin, { description: "Settle a different filing", filing_ref: "filing:4" });
  await todo(admin, { description: "A proceeding sharing the number", filing_ref: "proceeding:3" });
  await todo(admin, { description: "Points nowhere" });
  await todo(admin, { description: "Also points nowhere" });
  assert.deepEqual(await openDescriptions(admin, "L-ONE"), [
    "A proceeding sharing the number",
    "Also points nowhere",
    "Choose the forum",
    "Points nowhere",
    "Re-file default judgment application",
    "Settle a different filing",
  ], "nothing refused was written");
});

test("the same filing_ref in a different matter is allowed", async (t) => {
  const admin = await withMatters(t, "one-open-other-matter");
  await todo(admin, { description: "Ours", filing_ref: "filing:3" });
  const theirs = await todo(admin, { matt_num: "L-TWO", description: "Theirs", filing_ref: "filing:3" });
  assert.equal(theirs.filing_ref, "filing:3");
  assert.deepEqual(await openDescriptions(admin, "L-TWO"), ["Theirs"]);
});

test("a completed, paused or withdrawn holder does not block", async (t) => {
  const admin = await withMatters(t, "one-open-closed-holders");

  const completed = await todo(admin, { description: "First attempt", filing_ref: "filing:3" });
  await writes.complete_task(admin, OWNER, { id: completed.id });
  const second = await todo(admin, { description: "Second attempt", filing_ref: "filing:3" });

  await writes.upsert_task(admin, OWNER, { id: second.id, status: "withdrawn" });
  await todo(admin, { description: "Third attempt", filing_ref: "filing:3" });

  await todo(admin, { description: "On hold", filing_ref: "filing:5", status: "paused" });
  await todo(admin, { description: "Taken up again", filing_ref: "filing:5" });

  assert.deepEqual(await openDescriptions(admin, "L-ONE"), ["Taken up again", "Third attempt"]);
});

test("re-pointing, moving or re-opening into a held reference is refused", async (t) => {
  const admin = await withMatters(t, "one-open-update");
  const holder = await todo(admin, { description: "Re-file default judgment application", filing_ref: "filing:3" });

  const other = await todo(admin, { description: "Other filing", filing_ref: "filing:4" });
  await refusedFor(() => writes.upsert_task(admin, OWNER, { id: other.id, filing_ref: "filing:3" }), holder);

  const elsewhere = await todo(admin, { matt_num: "L-TWO", description: "Other matter", filing_ref: "filing:3" });
  await refusedFor(() => writes.upsert_task(admin, OWNER, { id: elsewhere.id, matt_num: "L-ONE" }), holder);

  const done = await todo(admin, { description: "Done earlier" });
  await writes.complete_task(admin, OWNER, { id: done.id });
  const pointed = await writes.upsert_task(admin, OWNER, { id: done.id, filing_ref: "filing:3" });
  assert.equal(pointed.filing_ref, "filing:3", "a completed to-do may carry a held reference, since it holds none");
  await refusedFor(() => writes.upsert_task(admin, OWNER, { id: done.id, status: "open" }), holder);

  const withdrawn = await todo(admin, { description: "Entered in error" });
  await writes.upsert_task(admin, OWNER, { id: withdrawn.id, status: "withdrawn" });
  await refusedFor(() => writes.upsert_task(admin, OWNER, { id: withdrawn.id, status: "open", filing_ref: "filing:3" }), holder);

  const again = await writes.upsert_task(admin, OWNER, { id: holder.id, filing_ref: "filing:3", description: "Re-file it" });
  assert.equal(again.description, "Re-file it", "the holder may restate its own reference");

  const [otherRow] = await admin.query(tasks, { id: `eq.${other.id}` }, { limit: 1 });
  assert.equal(otherRow.filing_ref, "filing:4", "a refused re-point changes nothing");
  const [doneRow] = await admin.query(tasks, { id: `eq.${done.id}` }, { limit: 1 });
  assert.equal(doneRow.status, "completed", "a refused re-open changes nothing");
});

test("an update touching no matter, pointer or status still lands on two to-dos already sharing a reference", async (t) => {
  const admin = await withMatters(t, "one-open-legacy-pair");
  const first = await todo(admin, { description: "First", filing_ref: "filing:3" });
  // A pair written before the rule existed, inserted past upsert_task the way an old database holds it.
  const [matter] = (await reads.open_tasks(admin, OWNER, { matt_num: "L-ONE" })).rows;
  await admin.insert(tasks, { id: "task-legacy", owner_id: OWNER, matter_id: matter.matter_id, description: "Second", task_type: "client", status: "open", filing_ref: "filing:3" });

  const nudged = await writes.upsert_task(admin, OWNER, { id: "task-legacy", next_nudge_date: "2026-10-01", last_nudged_at: "2026-09-24T09:00:00.000Z" });
  assert.equal(nudged.next_nudge_date, "2026-10-01");
  await refusedFor(() => writes.upsert_task(admin, OWNER, { id: "task-legacy", filing_ref: "filing:3" }), first);
});

test("withdrawing through upsert_task keeps the row, and open_tasks leaves it out", async (t) => {
  const admin = await withMatters(t, "withdraw");
  const kept = await todo(admin, { description: "Re-file default judgment application", filing_ref: "filing:3" });
  const merged = await todo(admin, { description: "Research the rejection" });

  const withdrawn = await writes.upsert_task(admin, OWNER, { id: merged.id, status: "withdrawn" });
  assert.equal(withdrawn.status, "withdrawn");
  assert.equal(withdrawn.completed_at, null, "withdrawing is not completing");
  assert.equal(withdrawn.description, "Research the rejection", "withdrawing leaves the other fields alone");

  assert.deepEqual(await openDescriptions(admin, "L-ONE"), [kept.description]);
  assert.deepEqual((await reads.open_tasks(admin, OWNER, {})).rows.map((row) => row.id), [kept.id]);
  const stored = await admin.query(tasks, { id: `eq.${merged.id}` }, { limit: 1 });
  assert.equal(stored.length, 1, "the withdrawn row is not deleted");
  assert.equal(stored[0].status, "withdrawn");
});

// A practice.db made before `withdrawn` carries the old CHECK, which SQLite cannot alter. The
// table is rebuilt once, every row and column kept, `filing_ref` included.
test("LocalPracticeAdmin widens the legacy practice_tasks status CHECK without losing rows", async (t) => {
  const dbPath = tempDatabase(t, "legacy-task-status");
  runPython(String.raw`
import sqlite3, sys
db = sqlite3.connect(sys.argv[1])
db.executescript("""
PRAGMA foreign_keys = ON;
CREATE TABLE practice_clients (
  id TEXT PRIMARY KEY, name TEXT, client_num TEXT, orig_lawyer TEXT,
  resp_lawyer TEXT, type_of_law TEXT, major_client TEXT,
  created_at TEXT, updated_at TEXT
);
CREATE TABLE practice_matters (
  id TEXT PRIMARY KEY, client_id TEXT, description TEXT, file_number TEXT,
  matt_num TEXT, orig_lawyer TEXT, resp_lawyer TEXT, status TEXT, type_of_law TEXT,
  billable INTEGER NOT NULL DEFAULT 1,
  regular_trust REAL CHECK (regular_trust <= 0), term_trust REAL, last_trust_date TEXT,
  created_at TEXT, updated_at TEXT,
  FOREIGN KEY (client_id) REFERENCES practice_clients (id)
);
CREATE TABLE practice_retainer_notices (
  id TEXT PRIMARY KEY, matter_id TEXT NOT NULL, sent_at TEXT NOT NULL,
  created_at TEXT, updated_at TEXT,
  FOREIGN KEY (matter_id) REFERENCES practice_matters (id)
);
CREATE TABLE practice_tasks (
  id TEXT PRIMARY KEY, matter_id TEXT, description TEXT,
  task_type TEXT NOT NULL CHECK (task_type IN ('client', 'admin', 'professional')),
  time_estimate_hours REAL, actual_hours REAL, deadline_date TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'completed', 'paused')),
  completed_at TEXT, next_nudge_date TEXT, nudge_interval_days INTEGER, last_nudged_at TEXT,
  created_at TEXT, updated_at TEXT, filing_ref TEXT,
  FOREIGN KEY (matter_id) REFERENCES practice_matters (id)
);
INSERT INTO practice_clients VALUES ('client-old', 'Legacy client', 'C-OLD', NULL, NULL, NULL, NULL, '2025-01-01T00:00:00Z', '2025-01-02T00:00:00Z');
INSERT INTO practice_matters VALUES ('matter-old', 'client-old', 'Legacy matter', 'F-OLD', 'L-OLD', NULL, NULL, 'active', NULL, 1, NULL, NULL, NULL, '2025-01-03T00:00:00Z', '2025-01-04T00:00:00Z');
INSERT INTO practice_tasks VALUES ('task-open', 'matter-old', 'Re-file the application', 'client', 2.0, NULL, '2026-10-15', 'open', NULL, '2026-09-30', 7, '2026-09-23T09:00:00.000Z', '2026-09-01T00:00:00.000Z', '2026-09-23T09:00:00.000Z', 'filing:3');
INSERT INTO practice_tasks VALUES ('task-done', 'matter-old', 'First attempt', 'client', 1.0, 1.5, NULL, 'completed', '2026-09-10T00:00:00.000Z', NULL, NULL, NULL, '2026-08-01T00:00:00.000Z', '2026-09-10T00:00:00.000Z', 'filing:3');
INSERT INTO practice_tasks VALUES ('task-paused', NULL, 'CLE reporting', 'admin', NULL, NULL, NULL, 'paused', NULL, NULL, NULL, NULL, '2026-07-01T00:00:00.000Z', '2026-07-01T00:00:00.000Z', NULL);
""")
db.commit()
db.close()
`, dbPath);
  const snapshot = () =>
    JSON.parse(
      runPython(
        String.raw`
import json, sqlite3, sys
db = sqlite3.connect(sys.argv[1])
print(json.dumps({
  "columns": [r[1] for r in db.execute("PRAGMA table_info('practice_tasks')")],
  "rows": [list(r) for r in db.execute("SELECT * FROM practice_tasks ORDER BY id")],
  "schema": db.execute("SELECT sql FROM sqlite_master WHERE type='table' AND name='practice_tasks'").fetchone()[0],
  "temps": db.execute("SELECT count(*) FROM sqlite_master WHERE name='practice_tasks__upgrade'").fetchone()[0],
  "fk_errors": db.execute("PRAGMA foreign_key_check").fetchall(),
}))
`,
        dbPath
      )
    );

  const before = snapshot();
  assert.doesNotMatch(before.schema, /'withdrawn'/);
  const admin = new LocalPracticeAdmin({ ...process.env, COCLERK_DB_PATH: dbPath });
  await reads.open_tasks(admin, OWNER, {});
  const once = snapshot();
  assert.match(once.schema, /'withdrawn'/);
  assert.deepEqual(once.columns, before.columns, "every column kept");
  assert.deepEqual(once.rows, before.rows, "every row and value kept, filing_ref included");
  assert.equal(once.temps, 0);
  assert.deepEqual(once.fk_errors, []);

  await reads.open_tasks(admin, OWNER, {});
  assert.deepEqual(snapshot(), once, "a second connection changes nothing");

  const withdrawn = await writes.upsert_task(admin, OWNER, { id: "task-open", status: "withdrawn" });
  assert.equal(withdrawn.status, "withdrawn");
  assert.deepEqual((await reads.open_tasks(admin, OWNER, {})).rows, []);
});
