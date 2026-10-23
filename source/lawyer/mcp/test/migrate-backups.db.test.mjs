// Backup retention after a drafting-data migrate (migrate-backups.ts): a successful migrate keeps the
// copy taken before its first hop and removes every older timestamped backup, never a hand-labelled
// one. Runs submissionDataMigrate against real databases the engine built.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

process.env.COCLERK_SUBMISSION_LOCK_ROOT ??= mkdtempSync(join(tmpdir(), "coclerk-migrate-backups-locks-"));

const { submissionDataMigrate } = await import("../build/submission/migrate.js");
const { submissionDbAt, freshSubmissionDb } = await import("./helpers/template-db.mjs");

const OLD = ["submission.sqlite.bak-20260101T000000Z", "submission.sqlite.bak-20260102T000000Z-1"];
const LABELLED = "submission.sqlite.bak-before-review-seed";

function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), "coclerk-migrate-backups-"));
  t.after(() => rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }));
  return { dir, dbPath: join(dir, "submission.sqlite") };
}

const timestamped = (dir) => readdirSync(dir).filter((f) => /^submission\.sqlite\.bak-\d{8}T\d{6}Z(-\d+)?$/.test(f));

function storedVersion(path) {
  const res = spawnSync(
    process.env.COCLERK_PYTHON || "python",
    ["-c", "import sqlite3, sys; print(sqlite3.connect(sys.argv[1]).execute(\"SELECT value FROM db_meta WHERE key = 'schema_version'\").fetchone()[0])", path],
    { encoding: "utf-8" }
  );
  assert.equal(res.status, 0, res.stderr);
  return Number(res.stdout.trim());
}

/** Older backups and a labelled one beside the database, each a real copy of it. */
function plantBackups(f) {
  for (const name of [...OLD, LABELLED]) copyFileSync(f.dbPath, join(f.dir, name));
}

test("a two-step migrate from below v42 keeps only the copy taken before its first hop", async (t) => {
  const f = fixture(t);
  submissionDbAt(f.dbPath, 40);
  plantBackups(f);

  const result = await submissionDataMigrate(f.dbPath);

  assert.equal(result.applied[0].from, 40);
  const left = timestamped(f.dir);
  assert.equal(left.length, 1, `left: ${left}`);
  assert.ok(!OLD.includes(left[0]));
  assert.equal(storedVersion(join(f.dir, left[0])), 40, "the kept copy predates the stop at v42");
  assert.ok(existsSync(join(f.dir, LABELLED)), "a hand-labelled copy is never touched");
  assert.equal(result.warnings, undefined);
});

test("a migrate with nothing to do removes no backup", async (t) => {
  const f = fixture(t);
  await freshSubmissionDb(f.dbPath);
  plantBackups(f);

  const result = await submissionDataMigrate(f.dbPath);

  assert.deepEqual(result.applied, []);
  assert.deepEqual(timestamped(f.dir).sort(), [...OLD].sort());
});

test("a backup that cannot be removed is a warning, and the migrate still succeeds", async (t) => {
  const f = fixture(t);
  submissionDbAt(f.dbPath, 77);
  plantBackups(f);
  // A folder with a backup's name: unlinking it fails on every platform.
  const stuck = "submission.sqlite.bak-20251231T000000Z";
  mkdirSync(join(f.dir, stuck));

  const result = await submissionDataMigrate(f.dbPath);

  assert.ok(result.applied.length > 0);
  assert.equal(result.warnings.length, 1);
  assert.match(result.warnings[0], new RegExp(`could not remove the older migration backup ${stuck}`));
  assert.deepEqual(timestamped(f.dir).filter((n) => n !== stuck).length, 1);
});
