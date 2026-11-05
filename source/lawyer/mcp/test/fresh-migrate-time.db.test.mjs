// A matter with no drafting-data database gets one on its first session entry: the migration
// engine runs every hop from 0 to the target. That must fit well inside the driver's 120 s
// budget, or a first session on a slow machine is killed (#241).

import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const { submissionDataMigrate, currentSchemaVersion } = await import("../build/submission/migrate.js");

test("a database created from nothing reaches the current schema within the db test budget", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "coclerk-fresh-migrate-"));
  t.after(() => rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }));
  const started = Date.now();
  await submissionDataMigrate(join(dir, "submission.sqlite"));
  const seconds = (Date.now() - started) / 1000;
  assert.ok(currentSchemaVersion() > 0);
  assert.ok(seconds < 30, `a fresh database took ${seconds.toFixed(1)} s to create`);
});

test("a database created from nothing leaves no journal file behind", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "coclerk-fresh-migrate-"));
  t.after(() => rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }));
  await submissionDataMigrate(join(dir, "submission.sqlite"));
  assert.deepEqual(readdirSync(dir), ["submission.sqlite"]);
});
