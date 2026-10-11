// The Litigation Strategy's to-do -> filing pointer (ADR 0021 D5, #871): one nullable filing_ref on a
// practice_tasks row, naming a filing or a pre-filing proceeding in the row's own matter's
// submission database. And open_tasks' matter filter, which the Litigation Strategy reads one matter by.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const { LocalPracticeAdmin } = await import("../build/practice/backend.js");
const reads = await import("../build/tools/practice/reads.js");
const writes = await import("../build/tools/practice/writes.js");

const OWNER = "00000000-0000-4000-8000-0000000000aa";

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
  for (const [num, name] of [["L8470", "Larchmont"], ["L9999", "Other Client"]]) {
    await writes.upsert_client_matter(admin, OWNER, { client_num: `C-${num}`, name, matt_num: num, file_number: `F-${num}` });
  }
  return admin;
}

test("filing_ref round-trips through upsert_task and open_tasks, and explicit null clears it", async (t) => {
  const admin = await withMatters(t, "filing-ref-roundtrip");

  const toFiling = await writes.upsert_task(admin, OWNER, { matt_num: "L8470", task_type: "client", description: "Settle the requisition", filing_ref: "filing:3" });
  assert.equal(toFiling.filing_ref, "filing:3");
  const toProceeding = await writes.upsert_task(admin, OWNER, { matt_num: "L8470", task_type: "client", description: "Choose the forum", filing_ref: "proceeding:2" });
  assert.equal(toProceeding.filing_ref, "proceeding:2");
  const unpointed = await writes.upsert_task(admin, OWNER, { matt_num: "L8470", task_type: "client", description: "Call the client" });
  assert.equal(unpointed.filing_ref, null, "the pointer is optional");

  const { rows } = await reads.open_tasks(admin, OWNER, {});
  const byDescription = new Map(rows.map((row) => [row.description, row]));
  assert.equal(byDescription.get("Settle the requisition").filing_ref, "filing:3");
  assert.equal(byDescription.get("Choose the forum").filing_ref, "proceeding:2");

  const moved = await writes.upsert_task(admin, OWNER, { id: toFiling.id, filing_ref: "filing:4" });
  assert.equal(moved.filing_ref, "filing:4");
  assert.equal(moved.description, "Settle the requisition", "setting the pointer leaves the other fields alone");

  const cleared = await writes.upsert_task(admin, OWNER, { id: toFiling.id, filing_ref: null });
  assert.equal(cleared.filing_ref, null);
  assert.equal(cleared.status, "open", "clearing the pointer does not close the to-do");
});

test("upsert_task refuses a filing_ref that names neither a filing nor a proceeding", async (t) => {
  const admin = await withMatters(t, "filing-ref-shape");
  for (const bad of ["3", "filing:", "filing:0", "filing:03", "filing:3 ", "matter:3", "Filing:3", "filing:3,proceeding:2"]) {
    await assert.rejects(
      () => writes.upsert_task(admin, OWNER, { matt_num: "L8470", task_type: "client", description: "x", filing_ref: bad }),
      /filing_ref/,
      `expected ${JSON.stringify(bad)} refused`
    );
  }
});

test("upsert_task refuses a filing_ref on a to-do with no matter", async (t) => {
  const admin = await withMatters(t, "filing-ref-matterless");
  await assert.rejects(
    () => writes.upsert_task(admin, OWNER, { task_type: "admin", description: "CLE reporting", filing_ref: "filing:1" }),
    /filing_ref.*matter/
  );
  const matterless = await writes.upsert_task(admin, OWNER, { task_type: "admin", description: "CLE reporting" });
  await assert.rejects(() => writes.upsert_task(admin, OWNER, { id: matterless.id, filing_ref: "filing:1" }), /filing_ref.*matter/);

  const own = await writes.upsert_task(admin, OWNER, { matt_num: "L8470", task_type: "client", description: "Settle it" });
  const pointed = await writes.upsert_task(admin, OWNER, { id: own.id, filing_ref: "filing:1" });
  assert.equal(pointed.filing_ref, "filing:1", "an update keyed by id takes the row's own matter");
});

test("open_tasks narrows to one matter's open rows by matt_num", async (t) => {
  const admin = await withMatters(t, "open-tasks-matter");
  await writes.upsert_task(admin, OWNER, { matt_num: "L8470", task_type: "client", description: "Ours, open" });
  const done = await writes.upsert_task(admin, OWNER, { matt_num: "L8470", task_type: "client", description: "Ours, completed" });
  await writes.complete_task(admin, OWNER, { id: done.id });
  await writes.upsert_task(admin, OWNER, { matt_num: "L9999", task_type: "client", description: "Another matter's" });
  await writes.upsert_task(admin, OWNER, { task_type: "admin", description: "No matter at all" });

  const narrowed = await reads.open_tasks(admin, OWNER, { matt_num: "L8470" });
  assert.deepEqual(narrowed.rows.map((row) => row.description), ["Ours, open"]);
  assert.equal(narrowed.rows[0].matt_num, "L8470");

  const everything = await reads.open_tasks(admin, OWNER, {});
  assert.deepEqual(everything.rows.map((row) => row.description).sort(), ["Another matter's", "No matter at all", "Ours, open"]);

  await assert.rejects(() => reads.open_tasks(admin, OWNER, { matt_num: "L0000" }), /No matter matched/);
});

// The migration is additive and idempotent: a practice_tasks table already carrying the nudge
// columns (every practice.db in use today) gains filing_ref, every existing value unchanged, and a
// second connection adds nothing.
test("LocalPracticeAdmin adds filing_ref to an existing practice_tasks table, once", async (t) => {
  const dbPath = tempDatabase(t, "legacy-filing-ref");
  runPython(String.raw`
import sqlite3, sys
db = sqlite3.connect(sys.argv[1])
db.executescript("""
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
  created_at TEXT, updated_at TEXT
);
CREATE TABLE practice_retainer_notices (
  id TEXT PRIMARY KEY, matter_id TEXT NOT NULL, sent_at TEXT NOT NULL,
  created_at TEXT, updated_at TEXT
);
CREATE TABLE practice_tasks (
  id TEXT PRIMARY KEY, matter_id TEXT, description TEXT,
  task_type TEXT NOT NULL CHECK (task_type IN ('client', 'admin', 'professional')),
  time_estimate_hours REAL, actual_hours REAL, deadline_date TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'completed', 'paused')),
  completed_at TEXT, next_nudge_date TEXT, nudge_interval_days INTEGER, last_nudged_at TEXT,
  created_at TEXT, updated_at TEXT
);
INSERT INTO practice_tasks (id, description, task_type, deadline_date, status, next_nudge_date, nudge_interval_days, last_nudged_at, created_at, updated_at)
VALUES ('task-old', 'Pre-existing task', 'admin', '2026-10-15', 'open', '2026-09-01', 7, '2026-08-25T10:00:00.000Z', '2026-08-01T00:00:00.000Z', '2026-08-25T10:00:00.000Z');
""")
db.commit()
db.close()
`, dbPath);
  const snapshot = () =>
    runPython(
      String.raw`
import json, sqlite3, sys
db = sqlite3.connect(sys.argv[1])
print(json.dumps({
  "columns": [r[1] for r in db.execute("PRAGMA table_info('practice_tasks')")],
  "rows": [list(r) for r in db.execute("SELECT * FROM practice_tasks ORDER BY id")],
}))
`,
      dbPath
    );

  const before = JSON.parse(snapshot());
  const admin = new LocalPracticeAdmin({ ...process.env, COCLERK_DB_PATH: dbPath });
  await reads.open_tasks(admin, OWNER, {});
  const once = JSON.parse(snapshot());
  assert.deepEqual(once.columns, [...before.columns, "filing_ref"], "one column, added at the end");
  assert.deepEqual(once.rows, before.rows.map((row) => [...row, null]), "every existing value unchanged, the pointer NULL");

  await reads.open_tasks(admin, OWNER, {});
  assert.deepEqual(JSON.parse(snapshot()), once, "a second connection changes nothing");

  const pointed = await writes.upsert_task(admin, OWNER, { id: "task-old", filing_ref: null });
  assert.equal(pointed.filing_ref, null);
});
