import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { seedItems, startFakeCloud } from "./helpers/fake-cloud.mjs";

const { SqlitePracticeKv } = await import("../build/practice/backend.js");
const { PracticeStore } = await import("../build/practice/store.js");
const reads = await import("../build/tools/practice/reads.js");
const writes = await import("../build/tools/practice/writes.js");

// The Supabase-era page size of 1,000 rows must not truncate an aggregate.
test("wip_hours, ar_data and time_entries_query see every entry past 1,000 rows", async (t) => {
  const dbPath = join(tmpdir(), `coclerk-practice-uncapped-${randomUUID()}.db`);
  t.after(() => rmSync(dbPath, { force: true }));
  const cloud = await startFakeCloud(t);
  const env = { ...process.env, ...cloud.env, COCLERK_DB_PATH: dbPath };
  const kv = new SqlitePracticeKv(env);
  const store = new PracticeStore(env, kv);

  const a = await writes.upsert_client_matter(store, { client_num: "9200", name: "Client A", matt_num: "L4000" });
  const b = await writes.upsert_client_matter(store, { client_num: "9201", name: "Client B", matt_num: "L4001" });

  // 700 one-hour entries on each matter: 1,400 billable items in all, written straight to practice.db.
  seedItems(kv, [a.matter_id, b.matter_id].flatMap((matter) => Array.from({ length: 700 }, () => ({
    id: randomUUID(), kind: "time_entry", data: { entry_date: "2026-08-01", hours: 1.0 }, tags: { billable: true }, links: { matter },
  }))));

  const wip = await reads.wip_hours(store, {});
  const wipByMatter = new Map(wip.rows.map((row) => [row.matter_id, row.total_hours]));
  assert.equal(wipByMatter.get(a.matter_id), 700);
  assert.equal(wipByMatter.get(b.matter_id), 700);

  const ar = await reads.ar_data(store);
  const arByMatter = new Map(ar.rows.map((row) => [row.id, row.wip_hours]));
  assert.equal(arByMatter.get(a.matter_id), 700);
  assert.equal(arByMatter.get(b.matter_id), 700);

  const listed = await reads.time_entries_query(store, {});
  assert.equal(listed.rows.length, 1400, "time_entries_query returns every entry");
});
