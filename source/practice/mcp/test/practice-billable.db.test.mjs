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

test("upsert_client_matter creates a non-billable matter, preserves it on re-upsert, and can flip it back", async (t) => {
  const dbPath = tempDatabase(t, "billable-upsert");
  const admin = new PracticeStore({ ...process.env, ...(await startFakeCloud(t)).env, COCLERK_DB_PATH: dbPath });

  const created = await writes.upsert_client_matter(admin, {
    client_num: "9001",
    name: "Firm Internal",
    matt_num: "LIF001",
    description: "LIF professional-liability file",
    billable: false,
  });
  {
    const { rows } = await reads.matter_lookup(admin, { matt_num: "LIF001" });
    assert.equal(rows[0].billable, false);
  }

  // A routine re-upsert (e.g. CSV re-import) omitting billable must not flip it back on.
  await writes.upsert_client_matter(admin, {
    client_num: "9001",
    matt_num: "LIF001",
    description: "LIF professional-liability file",
  });
  {
    const { rows } = await reads.matter_lookup(admin, { matt_num: "LIF001" });
    assert.equal(rows[0].billable, false, "omitting billable on update leaves it untouched");
  }

  await writes.upsert_client_matter(admin, {
    client_num: "9001",
    matt_num: "LIF001",
    billable: true,
  });
  {
    const { rows } = await reads.matter_lookup(admin, { matt_num: "LIF001" });
    assert.equal(rows[0].billable, true, "billable: true flips it back");
  }
  assert.equal(created.matter_created, true);
});

test("non-billable matter is excluded from the all-matters wip_hours and ar_data sweeps, but stays reachable directly", async (t) => {
  const dbPath = tempDatabase(t, "billable-sweeps");
  const admin = new PracticeStore({ ...process.env, ...(await startFakeCloud(t)).env, COCLERK_DB_PATH: dbPath });

  const billable = await writes.upsert_client_matter(admin, {
    client_num: "9002", name: "Client A", matt_num: "L2000",
  });
  const nonBillable = await writes.upsert_client_matter(admin, {
    client_num: "9003", name: "Firm Internal", matt_num: "LIF002", billable: false,
  });

  await writes.insert_time_entry(admin, {
    matter_id: billable.matter_id, entry_date: "2026-08-01", hours: 2, description: "Billable work",
  });
  await writes.insert_time_entry(admin, {
    matter_id: nonBillable.matter_id, entry_date: "2026-08-01", hours: 3, description: "LIF work",
  });

  const sweep = await reads.wip_hours(admin, {});
  const sweepByMatter = new Map(sweep.rows.map((r) => [r.matter_id, r]));
  assert.ok(sweepByMatter.has(billable.matter_id), "billable matter appears in the sweep");
  assert.ok(!sweepByMatter.has(nonBillable.matter_id), "non-billable matter is excluded from the sweep");

  // The entry inherited the matter's flag, so the targeted call has no billable
  // hours to report -- the matter itself is still reachable (below).
  const targeted = await reads.wip_hours(admin, { matt_num: "LIF002" });
  assert.equal(targeted.rows.length, 0, "a targeted call reports no billable hours for it");

  // An entry explicitly marked billable on that same matter does come back.
  await writes.insert_time_entry(admin, {
    matter_id: nonBillable.matter_id, entry_date: "2026-08-02", hours: 1.5,
    description: "Chargeable work on the internal file", billable: true,
  });
  const targetedAgain = await reads.wip_hours(admin, { matt_num: "LIF002" });
  assert.equal(targetedAgain.rows.length, 1, "a targeted call returns the non-billable matter's billable entries");
  assert.equal(targetedAgain.rows[0].total_hours, 1.5);

  const ar = await reads.ar_data(admin);
  const arIds = new Set(ar.rows.map((r) => r.id));
  assert.ok(arIds.has(billable.matter_id));
  assert.ok(!arIds.has(nonBillable.matter_id), "non-billable matter is excluded from ar_data");

  // Ordinary matter operations still work on it.
  const { rows: lookupRows } = await reads.matter_lookup(admin, { matt_num: "LIF002" });
  assert.equal(lookupRows.length, 1);
  const { rows: trustRows } = await reads.trust_summary(admin, { matt_num: "LIF002" });
  assert.equal(trustRows.length, 1);
});

test("insert_time_entry inherits the matter's billable flag and honours an explicit override and batch_tag", async (t) => {
  const dbPath = tempDatabase(t, "entry-billable-default");
  const admin = new PracticeStore({ ...process.env, ...(await startFakeCloud(t)).env, COCLERK_DB_PATH: dbPath });

  const billable = await writes.upsert_client_matter(admin, {
    client_num: "9100", name: "Client B", matt_num: "L3000",
  });
  const nonBillable = await writes.upsert_client_matter(admin, {
    client_num: "9101", name: "Firm Internal", matt_num: "LIF300", billable: false,
  });

  await writes.insert_time_entry(admin, {
    matter_id: billable.matter_id, entry_date: "2026-08-01", hours: 1, description: "Default billable",
  });
  await writes.insert_time_entry(admin, {
    matter_id: billable.matter_id, entry_date: "2026-08-02", hours: 1, description: "Note-up",
    billable: false, batch_tag: "retire:7:2026-08-02",
  });
  await writes.insert_time_entry(admin, {
    matter_id: nonBillable.matter_id, entry_date: "2026-08-03", hours: 1, description: "Internal",
  });

  const { rows } = await reads.time_entries_query(admin, { matt_num: "L3000" });
  const byDescription = new Map(rows.map((row) => [row.description, row]));
  assert.equal(byDescription.get("Default billable").billable, true, "defaults to the matter's flag");
  assert.equal(byDescription.get("Default billable").batch_tag ?? null, null);
  assert.equal(byDescription.get("Note-up").billable, false, "explicit false wins on a billable matter");
  assert.equal(byDescription.get("Note-up").batch_tag, "retire:7:2026-08-02");

  const internal = await reads.time_entries_query(admin, { matt_num: "LIF300" });
  assert.equal(internal.rows[0].billable, false, "a non-billable matter's entries default to false");

  // The non-billable entry is out of WIP even though its matter is billable.
  const sweep = await reads.wip_hours(admin, {});
  const wipRow = sweep.rows.find((row) => row.matter_id === billable.matter_id);
  assert.equal(wipRow.total_hours, 1, "wip_hours counts only the billable entry");

  const ar = await reads.ar_data(admin);
  const arRow = ar.rows.find((row) => row.id === billable.matter_id);
  assert.equal(arRow.wip_hours, 1, "ar_data counts only the billable entry");
});
