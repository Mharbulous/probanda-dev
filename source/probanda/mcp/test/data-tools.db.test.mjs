import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const { submissionDataExecute, submissionDataQuery } = await import("../build/submission/backend.js");
const { acquireDataLock } = await import("../build/submission/lock.js");

// Keep the lock files out of %LOCALAPPDATA% so a test never contends with a
// real session.
function isolatedEnv() {
  const scratch = mkdtempSync(join(tmpdir(), "coclerk-submission-lock-env-"));
  return {
    env: { ...process.env, COCLERK_SUBMISSION_LOCK_ROOT: join(scratch, "locks") },
    cleanup: () => rmSync(scratch, { recursive: true, force: true }),
  };
}

function python() {
  return process.env.COCLERK_PYTHON || "python";
}

// Stands in for drafting_data__migrate, which build ticket #295 (not this
// one) implements -- these tests exercise query/execute against a database
// that already exists, the same contract migrate is responsible for handing
// them.
function emptyDbFixture() {
  const dir = mkdtempSync(join(tmpdir(), "coclerk-submission-db-"));
  const dbPath = join(dir, "submission.sqlite");
  const result = spawnSync(
    python(),
    ["-c", "import sqlite3,sys; c=sqlite3.connect(sys.argv[1]); c.execute('CREATE TABLE marker(value TEXT)'); c.execute(\"INSERT INTO marker VALUES ('live')\"); c.commit(); c.close()", dbPath],
    { encoding: "utf-8" },
  );
  if (result.status !== 0) throw new Error(`fixture Python failed: ${result.stderr}`);
  return { dir, dbPath, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

// One job row held by session sess-a1, for guarded-release tests.
function ticketsDbFixture() {
  const dir = mkdtempSync(join(tmpdir(), "coclerk-submission-db-"));
  const dbPath = join(dir, "submission.sqlite");
  const result = spawnSync(
    python(),
    ["-c", "import sqlite3,sys; c=sqlite3.connect(sys.argv[1]); c.execute('CREATE TABLE tickets(id INTEGER PRIMARY KEY, status TEXT, locked_by TEXT, locked_at TEXT)'); c.execute(\"INSERT INTO tickets VALUES (42, 'wip', 'sess-a1', '2026-10-04T09:00')\"); c.commit(); c.close()", dbPath],
    { encoding: "utf-8" },
  );
  if (result.status !== 0) throw new Error(`fixture Python failed: ${result.stderr}`);
  return { dir, dbPath, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

const RELEASE = (holder) =>
  `UPDATE tickets SET status = 'queued', locked_by = NULL, locked_at = NULL WHERE id = 42 AND locked_by = '${holder}';`;

test("query runs against an empty per-matter database", () => {
  const f = emptyDbFixture();
  try {
    const result = submissionDataQuery(f.dbPath, "SELECT value FROM marker");
    assert.deepEqual(result.rows, [{ value: "live" }]);
  } finally {
    f.cleanup();
  }
});

test("query rejects a write statement", () => {
  const f = emptyDbFixture();
  try {
    assert.throws(
      () => submissionDataQuery(f.dbPath, "DELETE FROM marker"),
      /only accepts SELECT\/WITH\/PRAGMA/,
    );
  } finally {
    f.cleanup();
  }
});

test("query accepts a read that opens with comments", () => {
  const f = emptyDbFixture();
  try {
    const result = submissionDataQuery(f.dbPath, "-- probe\n/* a\nblock */\n  SELECT value FROM marker");
    assert.deepEqual(result.rows, [{ value: "live" }]);
  } finally {
    f.cleanup();
  }
});

test("query rejects a write behind leading comments", () => {
  const f = emptyDbFixture();
  try {
    for (const sql of [
      "-- SELECT\nINSERT INTO marker VALUES ('x')",
      "/* SELECT */ UPDATE marker SET value = 'x'",
      "-- note\n/* select */\nDELETE FROM marker",
    ]) {
      assert.throws(() => submissionDataQuery(f.dbPath, sql), /only accepts SELECT\/WITH\/PRAGMA/, sql);
    }
  } finally {
    f.cleanup();
  }
});

test("query fails loudly when the database does not exist", () => {
  const dir = mkdtempSync(join(tmpdir(), "coclerk-submission-missing-"));
  const dbPath = join(dir, "submission.sqlite");
  try {
    assert.throws(
      () => submissionDataQuery(dbPath, "SELECT 1 AS ok"),
      /no submission database found.*drafting_data__migrate/i,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("execute mutates the database and query observes the write", async () => {
  const f = emptyDbFixture();
  try {
    const result = await submissionDataExecute(f.dbPath, "INSERT INTO marker VALUES ('added');");
    assert.equal(result.ok, true);
    assert.equal(result.changes, 1);
    assert.deepEqual(
      submissionDataQuery(f.dbPath, "SELECT value FROM marker ORDER BY value").rows,
      [{ value: "added" }, { value: "live" }],
    );
  } finally {
    f.cleanup();
  }
});

test("execute reports changes 0 when a guarded release matches no row", async () => {
  const f = ticketsDbFixture();
  try {
    const result = await submissionDataExecute(f.dbPath, RELEASE("sess-zz"));
    assert.equal(result.ok, true);
    assert.equal(result.changes, 0);
    assert.deepEqual(
      submissionDataQuery(f.dbPath, "SELECT status, locked_by FROM tickets WHERE id = 42").rows,
      [{ status: "wip", locked_by: "sess-a1" }],
    );
  } finally {
    f.cleanup();
  }
});

test("execute reports changes 1 when the holder's guarded release lands", async () => {
  const f = ticketsDbFixture();
  try {
    const result = await submissionDataExecute(f.dbPath, RELEASE("sess-a1"));
    assert.equal(result.ok, true);
    assert.equal(result.changes, 1);
    assert.deepEqual(
      submissionDataQuery(f.dbPath, "SELECT status, locked_by FROM tickets WHERE id = 42").rows,
      [{ status: "queued", locked_by: null }],
    );
  } finally {
    f.cleanup();
  }
});

test("execute tolerates a final statement missing its trailing semicolon", async () => {
  const f = emptyDbFixture();
  try {
    const result = await submissionDataExecute(f.dbPath, "CREATE TABLE t(x); INSERT INTO t VALUES(1)");
    assert.equal(result.ok, true);
    assert.deepEqual(submissionDataQuery(f.dbPath, "SELECT x FROM t").rows, [{ x: 1 }]);
  } finally {
    f.cleanup();
  }
});

test("execute rolls back and leaves the database untouched on a mid-script failure", async () => {
  const f = emptyDbFixture();
  try {
    await assert.rejects(
      () => submissionDataExecute(f.dbPath, "INSERT INTO marker VALUES ('doomed'); SELECT * FROM absent;"),
      /no such table: absent/,
    );
    assert.deepEqual(submissionDataQuery(f.dbPath, "SELECT value FROM marker").rows, [{ value: "live" }]);
  } finally {
    f.cleanup();
  }
});

// The clobber this guards against: execute stages a temp copy, mutates it,
// then copies it back. Two sessions staging from the same starting bytes both
// "succeed" and the second copy-back silently discards the first's writes.
test("a second execute is refused while another session holds the data lock", async () => {
  const f = emptyDbFixture();
  const { env, cleanup } = isolatedEnv();
  try {
    const held = await acquireDataLock(f.dbPath, env);
    try {
      await assert.rejects(
        () => submissionDataExecute(f.dbPath, "INSERT INTO marker VALUES ('blocked');", env),
        (err) => {
          assert.equal(err.code, "lock_unavailable");
          assert.match(err.message, /drafting-data write lock/);
          return true;
        },
      );
    } finally {
      held.release();
    }
    assert.deepEqual(submissionDataQuery(f.dbPath, "SELECT value FROM marker").rows, [{ value: "live" }]);
  } finally {
    cleanup();
    f.cleanup();
  }
});

// Reads are the hot path and copy nothing back, so they must not be gated.
test("query is not blocked by a held data lock", async () => {
  const f = emptyDbFixture();
  const { env, cleanup } = isolatedEnv();
  try {
    const held = await acquireDataLock(f.dbPath, env);
    try {
      assert.deepEqual(submissionDataQuery(f.dbPath, "SELECT value FROM marker").rows, [{ value: "live" }]);
    } finally {
      held.release();
    }
  } finally {
    cleanup();
    f.cleanup();
  }
});
