// practice.db as one generic kv_store (docs/Plans/2026-10-14_practice-db-conversion.md, "Local
// storage"), through the real host-Python SQLite helper and a fake Probanda's Cloud: the file
// holds no other table, a file in the old format is refused naming its migration, and a write the
// cloud saved but practice.db did not apply is kept there and replayed.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { startFakeCloud } from "./helpers/fake-cloud.mjs";

const { callTool, createDispatchContext } = await import("../build/index.js");
const { freshSubmissionDb } = await import("./helpers/template-db.mjs");

function runPython(script, dbPath) {
  const python = process.env.COCLERK_PYTHON || "python";
  const result = spawnSync(python, ["-c", script, dbPath], { encoding: "utf-8" });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}

async function practice(t) {
  const dbPath = join(tmpdir(), `coclerk-practice-store-${randomUUID()}.db`);
  t.after(() => rmSync(dbPath, { force: true }));
  const cloud = await startFakeCloud(t);
  const context = await createDispatchContext({ ...process.env, ...cloud.env, COCLERK_DB_PATH: dbPath });
  return { dbPath, cloud, context };
}

const tables = (dbPath) => JSON.parse(runPython(
  "import json, sqlite3, sys; print(json.dumps(sorted(r[0] for r in sqlite3.connect(sys.argv[1]).execute(\"SELECT name FROM sqlite_master WHERE type = 'table'\"))))",
  dbPath
));
const namespaces = (dbPath) => JSON.parse(runPython(
  "import json, sqlite3, sys; print(json.dumps(sorted(r[0] for r in sqlite3.connect(sys.argv[1]).execute('SELECT DISTINCT namespace FROM kv_store'))))",
  dbPath
));

test("practice.db holds only kv_store, under the item, meta and pending namespaces", async (t) => {
  const { dbPath, cloud, context } = await practice(t);
  await callTool(context, "practice_data__upsert_client_matter", { client_num: "C-1", name: "Acme Co", matt_num: "L100" });
  await callTool(context, "practice_data__upsert_task", { matt_num: "L100", task_type: "client", description: "Settle it" });
  assert.deepEqual(tables(dbPath), ["kv_store"]);
  assert.deepEqual(namespaces(dbPath), ["item", "meta"], "no write is left pending");

  cloud.mode = "sync-down";
  await assert.rejects(callTool(context, "practice_data__upsert_task", { matt_num: "L100", task_type: "admin", description: "File it" }), /saved this write/);
  assert.deepEqual(namespaces(dbPath), ["item", "meta", "pending"]);
  assert.deepEqual(tables(dbPath), ["kv_store"]);

  const status = await callTool(context, "practice_data__config_status", {});
  assert.equal(status.pending_writes, 1);
  assert.equal(status.cloud_credential, "present");

  cloud.mode = "ok";
  const open = await callTool(context, "practice_data__open_tasks", {});
  assert.deepEqual(open.rows.map((row) => row.description).sort(), ["File it", "Settle it"]);
  assert.equal(open.replayed_writes.length, 1);
  assert.equal(open.replayed_writes[0].tool, "upsert_task");
  assert.deepEqual(namespaces(dbPath), ["item", "meta"]);
});

test("an unreachable cloud leaves practice.db's items as they were", async (t) => {
  const { dbPath, cloud, context } = await practice(t);
  await callTool(context, "practice_data__upsert_client_matter", { client_num: "C-1", name: "Acme Co", matt_num: "L100" });
  const items = () => runPython("import json, sqlite3, sys; print(json.dumps(sqlite3.connect(sys.argv[1]).execute(\"SELECT namespace, key, value FROM kv_store WHERE namespace <> 'meta' ORDER BY namespace, key\").fetchall()))", dbPath);
  const before = items();
  cloud.mode = "down";
  await assert.rejects(
    callTool(context, "practice_data__upsert_task", { matt_num: "L100", task_type: "admin", description: "File it" }),
    /^DataServerError: Probanda's Cloud did not answer|Probanda's Cloud did not answer \(.+\)\. Nothing was saved, in the cloud or in practice\.db\./
  );
  assert.equal(items(), before);
  // Reads still answer.
  assert.equal((await callTool(context, "practice_data__matter_lookup", { matt_num: "L100" })).rows.length, 1);
});

test("a practice.db holding any table but kv_store is refused, naming the migration, and left unchanged", async (t) => {
  const { dbPath, cloud, context } = await practice(t);
  // Any SQLite file with tables of its own will do: here, a fresh drafting database.
  await freshSubmissionDb(dbPath);
  const digest = () => createHash("sha256").update(readFileSync(dbPath)).digest("hex");
  const before = digest();

  for (const [name, args] of [["practice_data__matter_lookup", { matt_num: "L100" }], ["practice_data__upsert_task", { task_type: "admin", description: "x" }]]) {
    await assert.rejects(callTool(context, name, args), (err) => {
      assert.equal(err.code, "practice_db_legacy");
      assert.match(err.message, /holds tables other than kv_store/);
      assert.match(err.message, /scripts\/migrate_practice_db\.py/);
      return true;
    });
  }
  assert.equal(digest(), before, "the old file is not touched");
  assert.equal(cloud.requests.length, 0);
});
