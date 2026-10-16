// The Litigation Strategy's to-do -> filing pointer (ADR 0021 D5, #871): one nullable filing_ref on a
// to-do (its `filing` link), naming a filing or a pre-filing proceeding in the row's own matter's
// submission database. And open_tasks' matter filter, which the Litigation Strategy reads one matter by.

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

async function withMatters(t, label) {
  const admin = new PracticeStore({ ...process.env, ...(await startFakeCloud(t)).env, COCLERK_DB_PATH: tempDatabase(t, label) });
  for (const [num, name] of [["L8470", "Larchmont"], ["L9999", "Other Client"]]) {
    await writes.upsert_client_matter(admin, { client_num: `C-${num}`, name, matt_num: num, file_number: `F-${num}` });
  }
  return admin;
}

test("filing_ref round-trips through upsert_task and open_tasks, and explicit null clears it", async (t) => {
  const admin = await withMatters(t, "filing-ref-roundtrip");

  const toFiling = await writes.upsert_task(admin, { matt_num: "L8470", task_type: "client", description: "Settle the requisition", filing_ref: "filing:3" });
  assert.equal(toFiling.filing_ref, "filing:3");
  const toProceeding = await writes.upsert_task(admin, { matt_num: "L8470", task_type: "client", description: "Choose the forum", filing_ref: "proceeding:2" });
  assert.equal(toProceeding.filing_ref, "proceeding:2");
  const unpointed = await writes.upsert_task(admin, { matt_num: "L8470", task_type: "client", description: "Call the client" });
  assert.equal(unpointed.filing_ref ?? null, null, "the pointer is optional");

  const { rows } = await reads.open_tasks(admin, {});
  const byDescription = new Map(rows.map((row) => [row.description, row]));
  assert.equal(byDescription.get("Settle the requisition").filing_ref, "filing:3");
  assert.equal(byDescription.get("Choose the forum").filing_ref, "proceeding:2");

  const moved = await writes.upsert_task(admin, { id: toFiling.id, filing_ref: "filing:4" });
  assert.equal(moved.filing_ref, "filing:4");
  assert.equal(moved.description, "Settle the requisition", "setting the pointer leaves the other fields alone");

  const cleared = await writes.upsert_task(admin, { id: toFiling.id, filing_ref: null });
  assert.equal(cleared.filing_ref ?? null, null);
  assert.equal(cleared.status, "open", "clearing the pointer does not close the to-do");
});

test("upsert_task refuses a filing_ref that names neither a filing nor a proceeding", async (t) => {
  const admin = await withMatters(t, "filing-ref-shape");
  for (const bad of ["3", "filing:", "filing:0", "filing:03", "filing:3 ", "matter:3", "Filing:3", "filing:3,proceeding:2"]) {
    await assert.rejects(
      () => writes.upsert_task(admin, { matt_num: "L8470", task_type: "client", description: "x", filing_ref: bad }),
      /filing_ref/,
      `expected ${JSON.stringify(bad)} refused`
    );
  }
});

test("open_tasks narrows to one matter's open rows by matt_num", async (t) => {
  const admin = await withMatters(t, "open-tasks-matter");
  await writes.upsert_task(admin, { matt_num: "L8470", task_type: "client", description: "Ours, open" });
  const done = await writes.upsert_task(admin, { matt_num: "L8470", task_type: "client", description: "Ours, completed" });
  await writes.complete_task(admin, { id: done.id });
  await writes.upsert_task(admin, { matt_num: "L9999", task_type: "client", description: "Another matter's" });
  await writes.upsert_task(admin, { task_type: "admin", description: "No matter at all" });

  const narrowed = await reads.open_tasks(admin, { matt_num: "L8470" });
  assert.deepEqual(narrowed.rows.map((row) => row.description), ["Ours, open"]);
  assert.equal(narrowed.rows[0].matt_num, "L8470");

  const everything = await reads.open_tasks(admin, {});
  assert.deepEqual(everything.rows.map((row) => row.description).sort(), ["Another matter's", "No matter at all", "Ours, open"]);

  await assert.rejects(() => reads.open_tasks(admin, { matt_num: "L0000" }), /No matter matched/);
});
