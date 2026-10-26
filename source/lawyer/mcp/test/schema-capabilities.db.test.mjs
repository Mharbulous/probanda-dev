// The schema-capability snapshot (#184): a present table or column is answered from one snapshot per
// database, a miss re-reads it so a column a migrate adds in the same process is seen at once, and
// resetSchemaCapabilities forgets a snapshot.

import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";

const dir = mkdtempSync(join(tmpdir(), "coclerk-schema-capabilities-"));
process.env.COCLERK_SUBMISSION_LOCK_ROOT = join(dir, "locks");
after(() => rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }));

const { submissionDataExecute } = await import("../build/submission/backend.js");
const { hasColumn, hasTable, resetSchemaCapabilities } = await import("../build/submission/schema-capabilities.js");

async function freshDb(name) {
  const dbPath = join(dir, name);
  writeFileSync(dbPath, "");
  await submissionDataExecute(dbPath, "CREATE TABLE tickets (id INTEGER PRIMARY KEY, title TEXT);");
  return dbPath;
}

test("answers present and absent tables and columns", async () => {
  const dbPath = await freshDb("answers.db");
  assert.equal(hasTable(dbPath, "tickets"), true);
  assert.equal(hasColumn(dbPath, "tickets", "title"), true);
  assert.equal(hasTable(dbPath, "ticket_sources"), false);
  assert.equal(hasColumn(dbPath, "tickets", "deleted_at"), false);
});

test("a miss after a migrate in the same process sees the new table and column", async () => {
  const dbPath = await freshDb("migrated.db");
  assert.equal(hasColumn(dbPath, "tickets", "deleted_at"), false);
  assert.equal(hasTable(dbPath, "ticket_sources"), false);
  await submissionDataExecute(dbPath, "ALTER TABLE tickets ADD COLUMN deleted_at TEXT; CREATE TABLE ticket_sources (id INTEGER PRIMARY KEY);");
  assert.equal(hasColumn(dbPath, "tickets", "deleted_at"), true);
  assert.equal(hasTable(dbPath, "ticket_sources"), true);
});

test("resetSchemaCapabilities forgets a remembered table", async () => {
  const dbPath = await freshDb("reset.db");
  assert.equal(hasTable(dbPath, "tickets"), true);
  await submissionDataExecute(dbPath, "DROP TABLE tickets;");
  assert.equal(hasTable(dbPath, "tickets"), true, "a present table is answered from the snapshot");
  resetSchemaCapabilities(dbPath);
  assert.equal(hasTable(dbPath, "tickets"), false);
});
