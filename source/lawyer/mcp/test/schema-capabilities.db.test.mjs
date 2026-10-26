// The schema-capability snapshot (#184): a present table or column is answered from one snapshot per
// database, a miss re-reads it so a column a migrate adds in the same process is seen at once, and
// resetSchemaCapabilities forgets a snapshot. A v46 database lacks statements_of_law.settled_on (v47)
// and ticket_sources (v76).

import assert from "node:assert/strict";
import { copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";

const dir = mkdtempSync(join(tmpdir(), "coclerk-schema-capabilities-"));
process.env.COCLERK_SUBMISSION_LOCK_ROOT = join(dir, "locks");
after(() => rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }));

const { submissionDataMigrate } = await import("../build/submission/migrate.js");
const { hasColumn, hasTable, resetSchemaCapabilities } = await import("../build/submission/schema-capabilities.js");
const { freshSubmissionDb, submissionDbAt } = await import("./helpers/template-db.mjs");

test("answers present and absent tables and columns", () => {
  const dbPath = join(dir, "answers.sqlite");
  submissionDbAt(dbPath, 46);
  assert.equal(hasTable(dbPath, "filings"), true);
  assert.equal(hasColumn(dbPath, "filings", "title"), true);
  assert.equal(hasTable(dbPath, "ticket_sources"), false);
  assert.equal(hasColumn(dbPath, "statements_of_law", "settled_on"), false);
});

test("a miss after a migrate in the same process sees the new table and column", async () => {
  const dbPath = join(dir, "migrated.sqlite");
  submissionDbAt(dbPath, 46);
  assert.equal(hasColumn(dbPath, "statements_of_law", "settled_on"), false);
  assert.equal(hasTable(dbPath, "ticket_sources"), false);
  await submissionDataMigrate(dbPath);
  assert.equal(hasColumn(dbPath, "statements_of_law", "settled_on"), true);
  assert.equal(hasTable(dbPath, "ticket_sources"), true);
});

test("resetSchemaCapabilities forgets a remembered table", async () => {
  const dbPath = join(dir, "reset.sqlite");
  const older = join(dir, "older.sqlite");
  await freshSubmissionDb(dbPath);
  submissionDbAt(older, 46);
  assert.equal(hasTable(dbPath, "ticket_sources"), true);
  copyFileSync(older, dbPath);
  assert.equal(hasTable(dbPath, "ticket_sources"), true, "a present table is answered from the snapshot");
  resetSchemaCapabilities(dbPath);
  assert.equal(hasTable(dbPath, "ticket_sources"), false);
});
