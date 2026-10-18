// ADR 0023: a to-do is one outcome. A matter holds at most one open to-do per filing reference
// (D4), and a to-do entered in error or merged into another is withdrawn, kept but never open (D6).
// The rule itself is Probanda's Cloud's (R3, tested in cloud/items/tests/). What stays here is
// relaying its refusal, which names the open to-do by id and description, and the withdrawn
// state's reading.

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

async function withMatters(t, label) {
  const dbPath = join(tmpdir(), `coclerk-practice-${label}-${randomUUID()}.db`);
  t.after(() => rmSync(dbPath, { force: true }));
  const cloud = await startFakeCloud(t);
  const admin = new PracticeStore({ ...process.env, ...cloud.env, COCLERK_DB_PATH: dbPath });
  for (const num of ["L-ONE", "L-TWO"]) {
    await writes.upsert_client_matter(admin, { client_num: `C-${num}`, name: `Client ${num}`, matt_num: num, file_number: `F-${num}` });
  }
  return { admin, cloud };
}

const todo = (admin, args) => writes.upsert_task(admin, { matt_num: "L-ONE", task_type: "client", ...args });

async function openDescriptions(admin, matt_num) {
  return (await reads.open_tasks(admin, { matt_num })).rows.map((row) => row.description).sort();
}

test("the cloud's refusal of a second open to-do names the first by id and description, and nothing is written", async (t) => {
  const { admin, cloud } = await withMatters(t, "one-open-refusal");
  const first = await todo(admin, { description: "Re-file default judgment application", filing_ref: "filing:3" });
  cloud.refuse = (write) => write.tool === "upsert_task"
    ? `Is this work part of the open to-do {{item:${first.id}}}, which already covers this filing?`
    : undefined;

  await assert.rejects(todo(admin, { description: "Research the rejection", filing_ref: "filing:3" }), (err) => {
    assert.ok(err.message.includes(first.id), err.message);
    assert.ok(err.message.includes(first.description), err.message);
    assert.match(err.message, /open to-do .*which already covers this filing\?$/);
    return true;
  });
  assert.deepEqual(await openDescriptions(admin, "L-ONE"), [first.description], "the refused to-do is not written");
  assert.equal(admin.pendingCount(), 0);
});

test("withdrawing through upsert_task keeps the row, and open_tasks leaves it out", async (t) => {
  const { admin, cloud } = await withMatters(t, "withdraw");
  const kept = await todo(admin, { description: "Re-file default judgment application", filing_ref: "filing:3" });
  const merged = await todo(admin, { description: "Research the rejection" });

  const withdrawn = await writes.upsert_task(admin, { id: merged.id, status: "withdrawn" });
  assert.deepEqual(cloud.writes().at(-1).ops, [{ op: "update", id: merged.id, kind: "task", state: "withdrawn", tags: {}, links: {}, hashes: {} }]);
  assert.equal(withdrawn.status, "withdrawn");
  assert.equal(withdrawn.completed_at, null, "withdrawing is not completing");
  assert.equal(withdrawn.description, "Research the rejection", "withdrawing leaves the other fields alone");

  assert.deepEqual(await openDescriptions(admin, "L-ONE"), [kept.description]);
  assert.deepEqual((await reads.open_tasks(admin, {})).rows.map((row) => row.id), [kept.id]);
  const stored = admin.rows("task").filter((row) => row.id === merged.id);
  assert.equal(stored.length, 1, "the withdrawn row is not deleted");
  assert.equal(stored[0].status, "withdrawn");
});
