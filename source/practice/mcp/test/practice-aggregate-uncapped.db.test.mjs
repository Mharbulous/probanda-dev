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

function runPython(script, ...args) {
  const candidates = [process.env.COCLERK_PYTHON, "python", "python3"].filter(Boolean);
  let lastError;
  for (const python of candidates) {
    const result = spawnSync(python, ["-c", script, ...args], { encoding: "utf-8" });
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

// The Supabase-era page size of 1,000 rows must not truncate an aggregate.
test("wip_hours, ar_data and time_entries_query see every entry past 1,000 rows", async (t) => {
  const dbPath = join(tmpdir(), `coclerk-practice-uncapped-${randomUUID()}.db`);
  t.after(() => rmSync(dbPath, { force: true }));
  const admin = new LocalPracticeAdmin({ ...process.env, COCLERK_DB_PATH: dbPath });

  const a = await writes.upsert_client_matter(admin, OWNER, { client_num: "9200", name: "Client A", matt_num: "L4000" });
  const b = await writes.upsert_client_matter(admin, OWNER, { client_num: "9201", name: "Client B", matt_num: "L4001" });

  // 700 one-hour entries on each matter: 1,400 billable rows in all.
  runPython(String.raw`
import sqlite3, sys
db = sqlite3.connect(sys.argv[1])
rows = [("e-%s-%d" % (m, i), m, "2026-08-01", 1.0, 1) for m in sys.argv[2:4] for i in range(700)]
db.executemany("INSERT INTO practice_time_entries (id, matter_id, entry_date, hours, billable) VALUES (?, ?, ?, ?, ?)", rows)
db.commit()
db.close()
`, dbPath, a.matter_id, b.matter_id);

  const wip = await reads.wip_hours(admin, OWNER, {});
  const wipByMatter = new Map(wip.rows.map((row) => [row.matter_id, row.total_hours]));
  assert.equal(wipByMatter.get(a.matter_id), 700);
  assert.equal(wipByMatter.get(b.matter_id), 700);

  const ar = await reads.ar_data(admin, OWNER);
  const arByMatter = new Map(ar.rows.map((row) => [row.id, row.wip_hours]));
  assert.equal(arByMatter.get(a.matter_id), 700);
  assert.equal(arByMatter.get(b.matter_id), 700);

  const listed = await reads.time_entries_query(admin, OWNER, {});
  assert.equal(listed.rows.length, 1400, "time_entries_query returns every entry");
});
