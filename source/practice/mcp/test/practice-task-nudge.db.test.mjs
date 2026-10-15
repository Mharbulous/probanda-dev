import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { startFakeCloud } from "./helpers/fake-cloud.mjs";

const { PracticeStore } = await import("../build/practice/store.js");
const reads = await import("../build/tools/practice/reads.js");
const writes = await import("../build/tools/practice/writes.js");


function tempDatabase(t, label) {
  const dbPath = join(tmpdir(), `coclerk-practice-${label}-${randomUUID()}.db`);
  t.after(() => rmSync(dbPath, { force: true }));
  return dbPath;
}

test("nudge fields round-trip through upsert_task and open_tasks", async (t) => {
  const dbPath = tempDatabase(t, "nudge-roundtrip");
  const admin = new PracticeStore({ ...process.env, ...(await startFakeCloud(t)).env, COCLERK_DB_PATH: dbPath });

  const nudging = await writes.upsert_task(admin, {
    task_type: "admin",
    description: "Chase the entered order",
    next_nudge_date: "2026-08-10",
    nudge_interval_days: 7,
  });
  assert.equal(nudging.next_nudge_date, "2026-08-10");
  assert.equal(nudging.nudge_interval_days, 7);
  assert.equal(nudging.last_nudged_at, null);

  const plain = await writes.upsert_task(admin, {
    task_type: "admin",
    description: "Not in the rotation",
  });
  assert.equal(plain.next_nudge_date, null);
  assert.equal(plain.nudge_interval_days, null);
  assert.equal(plain.last_nudged_at, null);

  const { rows } = await reads.open_tasks(admin, {});
  const byDescription = new Map(rows.map((row) => [row.description, row]));
  assert.equal(byDescription.get("Chase the entered order").next_nudge_date, "2026-08-10");
  assert.equal(byDescription.get("Chase the entered order").nudge_interval_days, 7);
  assert.equal(byDescription.get("Not in the rotation").next_nudge_date, null);
});

test("advancing a nudge by id leaves the other task fields alone; explicit null clears it", async (t) => {
  const dbPath = tempDatabase(t, "nudge-advance");
  const admin = new PracticeStore({ ...process.env, ...(await startFakeCloud(t)).env, COCLERK_DB_PATH: dbPath });

  const created = await writes.upsert_task(admin, {
    task_type: "client",
    description: "Ingest the entered order",
    time_estimate_hours: 1.5,
    deadline_date: "2026-09-01",
    next_nudge_date: "2026-08-10",
    nudge_interval_days: 30,
  });

  const advanced = await writes.upsert_task(admin, {
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

  const cleared = await writes.upsert_task(admin, {
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
  const admin = new PracticeStore({ ...process.env, ...(await startFakeCloud(t)).env, COCLERK_DB_PATH: dbPath });

  await assert.rejects(
    () => writes.upsert_task(admin, { task_type: "admin", description: "x", nudge_interval_days: 0 }),
    /nudge_interval_days/
  );
});

