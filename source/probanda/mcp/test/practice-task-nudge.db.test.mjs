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
  const candidates = [process.env.COCLERK_PYTHON, "python", "python3"].filter(Boolean);
  let lastError;
  for (const python of candidates) {
    const result = spawnSync(python, ["-c", script, dbPath], { encoding: "utf-8" });
    if (result.error?.code === "ENOENT") {
      lastError = result.error;
      continue;
    }
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stderr);
    return result.stdout;
  }
  throw lastError ?? new Error("No Python interpreter found");
}

test("nudge fields round-trip through upsert_task and open_tasks", async (t) => {
  const dbPath = tempDatabase(t, "nudge-roundtrip");
  const admin = new LocalPracticeAdmin({ ...process.env, COCLERK_DB_PATH: dbPath });

  const nudging = await writes.upsert_task(admin, OWNER, {
    task_type: "admin",
    description: "Chase the entered order",
    next_nudge_date: "2026-08-10",
    nudge_interval_days: 7,
  });
  assert.equal(nudging.next_nudge_date, "2026-08-10");
  assert.equal(nudging.nudge_interval_days, 7);
  assert.equal(nudging.last_nudged_at, null);

  const plain = await writes.upsert_task(admin, OWNER, {
    task_type: "admin",
    description: "Not in the rotation",
  });
  assert.equal(plain.next_nudge_date, null);
  assert.equal(plain.nudge_interval_days, null);
  assert.equal(plain.last_nudged_at, null);

  const { rows } = await reads.open_tasks(admin, OWNER, {});
  const byDescription = new Map(rows.map((row) => [row.description, row]));
  assert.equal(byDescription.get("Chase the entered order").next_nudge_date, "2026-08-10");
  assert.equal(byDescription.get("Chase the entered order").nudge_interval_days, 7);
  assert.equal(byDescription.get("Not in the rotation").next_nudge_date, null);
});

test("advancing a nudge by id leaves the other task fields alone; explicit null clears it", async (t) => {
  const dbPath = tempDatabase(t, "nudge-advance");
  const admin = new LocalPracticeAdmin({ ...process.env, COCLERK_DB_PATH: dbPath });

  const created = await writes.upsert_task(admin, OWNER, {
    task_type: "client",
    description: "Ingest the entered order",
    time_estimate_hours: 1.5,
    deadline_date: "2026-09-01",
    next_nudge_date: "2026-08-10",
    nudge_interval_days: 30,
  });

  const advanced = await writes.upsert_task(admin, OWNER, {
    id: created.id,
    next_nudge_date: "2026-09-09",
    last_nudged_at: "2026-08-10T14:00:00.000Z",
  });
  assert.equal(advanced.next_nudge_date, "2026-09-09");
  assert.equal(advanced.last_nudged_at, "2026-08-10T14:00:00.000Z");
  assert.equal(advanced.nudge_interval_days, 30, "interval survives an advance");
  assert.equal(advanced.description, "Ingest the entered order");
  assert.equal(advanced.time_estimate_hours, 1.5);
  assert.equal(advanced.deadline_date, "2026-09-01");
  assert.equal(advanced.status, "open");

  const cleared = await writes.upsert_task(admin, OWNER, {
    id: created.id,
    next_nudge_date: null,
    nudge_interval_days: null,
  });
  assert.equal(cleared.next_nudge_date, null);
  assert.equal(cleared.nudge_interval_days, null);
  assert.equal(cleared.status, "open", "leaving the rotation does not close the task");
});

test("upsert_task rejects a nudge interval below one day", async (t) => {
  const dbPath = tempDatabase(t, "nudge-validate");
  const admin = new LocalPracticeAdmin({ ...process.env, COCLERK_DB_PATH: dbPath });

  await assert.rejects(
    () => writes.upsert_task(admin, OWNER, { task_type: "admin", description: "x", nudge_interval_days: 0 }),
    /nudge_interval_days/
  );
});

test("LocalPracticeAdmin adds the nudge columns to a legacy practice_tasks table", async (t) => {
  const dbPath = tempDatabase(t, "legacy-tasks");
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
  completed_at TEXT, created_at TEXT, updated_at TEXT
);
INSERT INTO practice_tasks (id, description, task_type, status)
VALUES ('task-old', 'Pre-existing task', 'admin', 'open');
""")
db.commit()
db.close()
`, dbPath);

  const admin = new LocalPracticeAdmin({ ...process.env, COCLERK_DB_PATH: dbPath });
  const { rows } = await reads.open_tasks(admin, OWNER, {});
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, "task-old");
  assert.equal(rows[0].next_nudge_date, null, "existing rows are untouched — absence = not in rotation");
  assert.equal(rows[0].nudge_interval_days, null);
  assert.equal(rows[0].last_nudged_at, null);

  const nudging = await writes.upsert_task(admin, OWNER, {
    id: "task-old",
    next_nudge_date: "2026-08-10",
    nudge_interval_days: 7,
  });
  assert.equal(nudging.next_nudge_date, "2026-08-10");
  assert.equal(nudging.nudge_interval_days, 7);
});
