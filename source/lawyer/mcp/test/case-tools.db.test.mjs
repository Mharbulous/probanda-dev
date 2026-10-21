import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";

const { caseDataExecute, caseDataQuery } = await import("../build/case/backend.js");
const { acquireCaseLock } = await import("../build/case/case-lock.js");

// execute reads the trigger layer from the skills tree (design-decisions.md #52), so every
// write here points COCLERK_REPO_ROOT at a scratch tree holding synthetic triggers.sql text.
const triggerRoots = [];
after(() => triggerRoots.forEach((root) => rmSync(root, { recursive: true, force: true })));

function triggersEnv(text, base = process.env) {
  const root = mkdtempSync(join(tmpdir(), "coclerk-case-triggers-"));
  triggerRoots.push(root);
  const references = join(root, ".claude", "skills", "matter-data", "references");
  mkdirSync(references, { recursive: true });
  if (text !== null) writeFileSync(join(references, "triggers.sql"), text);
  return { ...base, COCLERK_REPO_ROOT: root };
}

// Keep the lock files out of %LOCALAPPDATA% so a test never contends with a
// real session.
function isolatedEnv() {
  const scratch = mkdtempSync(join(tmpdir(), "coclerk-case-lock-env-"));
  return {
    env: { ...process.env, COCLERK_CASE_LOCK_ROOT: join(scratch, "locks") },
    cleanup: () => rmSync(scratch, { recursive: true, force: true }),
  };
}

function fixture(version) {
  const matterRoot = mkdtempSync(join(tmpdir(), "coclerk-case-runtime-"));
  const caseDataDir = join(matterRoot, "matter-data");
  mkdirSync(caseDataDir);
  const main = join(caseDataDir, "main.sqlite");
  const python = process.env.COCLERK_PYTHON || "python";
  const result = spawnSync(
    python,
    ["-c", "import sqlite3,sys; c=sqlite3.connect(sys.argv[1]); c.execute('PRAGMA user_version = %s' % sys.argv[2]); c.close()", main, String(version)],
    { encoding: "utf-8" },
  );
  if (result.status !== 0) throw new Error(`fixture Python failed: ${result.stderr}`);
  writeFileSync(join(matterRoot, "coclerk.json"), JSON.stringify({
    schema_version: 5,
    matter_root: matterRoot,
    case_data_dir: caseDataDir,
    evidence_sql_path: join("4. LAWYER BRIEF", "CoWork", "evidence.sql"),
  }));
  return { matterRoot, cleanup: () => rmSync(matterRoot, { recursive: true, force: true }) };
}

function liveDerivedFixture({
  stored = "C:\\Users\\DeletedProfile\\case-data",
  createDatabase = true,
  matterFolder = "T9999 Scratch Matter",
  databaseFolder = matterFolder,
  metadata,
} = {}) {
  const scratch = mkdtempSync(join(tmpdir(), "coclerk-case-live-derived-"));
  const litigationRoot = join(scratch, "Litigation - Documents");
  const matterRoot = join(litigationRoot, matterFolder);
  const caseDataDir = join(litigationRoot, "0. CASE DATA", databaseFolder);
  mkdirSync(matterRoot, { recursive: true });
  if (createDatabase) {
    mkdirSync(caseDataDir, { recursive: true });
    const main = join(caseDataDir, "main.sqlite");
    const python = process.env.COCLERK_PYTHON || "python";
    const result = spawnSync(
      python,
      ["-c", "import json,sqlite3,sys; c=sqlite3.connect(sys.argv[1]); c.execute('PRAGMA user_version = 90'); c.execute('CREATE TABLE marker(value TEXT)'); c.execute(\"INSERT INTO marker VALUES ('live')\"); m=json.loads(sys.argv[2]); c.execute('CREATE TABLE matter_metadata(key TEXT PRIMARY KEY, value TEXT)') if m else None; c.executemany('INSERT INTO matter_metadata VALUES (?, ?)', m.items()) if m else None; c.commit(); c.close()", main, JSON.stringify(metadata ?? {})],
      { encoding: "utf-8" },
    );
    if (result.status !== 0) throw new Error(`fixture Python failed: ${result.stderr}`);
  }
  writeFileSync(join(matterRoot, "coclerk.json"), JSON.stringify({
    schema_version: 5,
    matter_root: "C:\\Users\\DeletedProfile\\Litigation - Documents\\T9999 Scratch Matter",
    case_data_dir: stored,
    evidence_sql_path: join("4. LAWYER BRIEF", "CoWork", "evidence.sql"),
  }));
  return {
    matterRoot,
    caseDataDir,
    pointerPath: join(matterRoot, "coclerk.json"),
    cleanup: () => rmSync(scratch, { recursive: true, force: true }),
  };
}

test("query rejects a stale stored nominee, uses the live-derived database, and heals the pointer", () => {
  const f = liveDerivedFixture();
  try {
    const evidence = join(f.matterRoot, "4. LAWYER BRIEF", "CoWork", "evidence.sql");
    mkdirSync(join(f.matterRoot, "4. LAWYER BRIEF", "CoWork"), { recursive: true });
    writeFileSync(evidence, "-- stale dump\n");
    const result = caseDataQuery(f.matterRoot, "SELECT value FROM marker");
    assert.deepEqual(result.rows, [{ value: "live" }]);
    assert.match(result.warning, /stored case_data_dir.*live-derived/i);
    assert.match(result.warning, /evidence\.sql.*predates/i);
    const healed = JSON.parse(readFileSync(f.pointerPath, "utf-8"));
    assert.equal(healed.matter_root, f.matterRoot);
    assert.equal(healed.case_data_dir, f.caseDataDir);
  } finally {
    f.cleanup();
  }
});

test("live metadata identity beats a renamed matter folder", () => {
  const f = liveDerivedFixture({
    matterFolder: "T9999 Renamed Matter",
    databaseFolder: "T9999 Original Name",
    metadata: { matter_id: "T9999", short_name: "Original Name" },
  });
  try {
    const result = caseDataQuery(f.matterRoot, "SELECT value FROM marker");
    assert.deepEqual(result.rows, [{ value: "live" }]);
    assert.equal(JSON.parse(readFileSync(f.pointerPath, "utf-8")).case_data_dir, f.caseDataDir);
  } finally {
    f.cleanup();
  }
});

test("an existing empty nominee loses to the live-derived database", () => {
  const f = liveDerivedFixture({ stored: "empty-nominee" });
  mkdirSync(join(f.matterRoot, "empty-nominee"));
  try {
    const result = caseDataQuery(f.matterRoot, "SELECT value FROM marker");
    assert.deepEqual(result.rows, [{ value: "live" }]);
    assert.equal(JSON.parse(readFileSync(f.pointerPath, "utf-8")).case_data_dir, f.caseDataDir);
  } finally {
    f.cleanup();
  }
});

test("query accepts a read that opens with comments", () => {
  const f = liveDerivedFixture();
  try {
    const result = caseDataQuery(f.matterRoot, "-- relocate-source probe\n/* a\nblock */\n  SELECT value FROM marker");
    assert.deepEqual(result.rows, [{ value: "live" }]);
  } finally {
    f.cleanup();
  }
});

test("query rejects a write behind leading comments", () => {
  const f = liveDerivedFixture();
  try {
    for (const sql of [
      "-- SELECT\nINSERT INTO marker VALUES ('x')",
      "/* SELECT */ UPDATE marker SET value = 'x'",
      "-- note\n/* select */\nDELETE FROM marker",
    ]) {
      assert.throws(() => caseDataQuery(f.matterRoot, sql), /only accepts SELECT\/WITH\/PRAGMA/, sql);
    }
  } finally {
    f.cleanup();
  }
});

test("query fails loudly when neither a stored nominee nor the live-derived database exists", () => {
  const f = liveDerivedFixture({ createDatabase: false });
  try {
    assert.throws(
      () => caseDataQuery(f.matterRoot, "SELECT 1 AS ok"),
      /no case database found.*main\.sqlite/i,
    );
  } finally {
    f.cleanup();
  }
});

test("query preserves a valid relative non-standard nominee", () => {
  const f = liveDerivedFixture({ stored: "custom-data", createDatabase: false });
  const custom = join(f.matterRoot, "custom-data");
  mkdirSync(custom);
  const python = process.env.COCLERK_PYTHON || "python";
  const created = spawnSync(
    python,
    ["-c", "import sqlite3,sys; c=sqlite3.connect(sys.argv[1]); c.execute('PRAGMA user_version = 90'); c.execute('CREATE TABLE marker(value TEXT)'); c.execute(\"INSERT INTO marker VALUES ('custom')\"); c.commit(); c.close()", join(custom, "main.sqlite")],
    { encoding: "utf-8" },
  );
  if (created.status !== 0) throw new Error(`fixture Python failed: ${created.stderr}`);
  try {
    const result = caseDataQuery(f.matterRoot, "SELECT value FROM marker");
    assert.deepEqual(result.rows, [{ value: "custom" }]);
    assert.equal(result.warning, null);
    assert.equal(JSON.parse(readFileSync(f.pointerPath, "utf-8")).case_data_dir, "custom-data");
  } finally {
    f.cleanup();
  }
});

test("execute bootstraps the matter's own 0. CASE DATA folder and rewrites matter_root", async () => {
  // ADR 0013: a new matter's case data lives inside the matter folder, stored relative.
  const f = liveDerivedFixture({ stored: "", createDatabase: false });
  const { env, cleanup } = isolatedEnv();
  try {
    const result = await caseDataExecute(
      f.matterRoot,
      "CREATE TABLE marker(value TEXT); INSERT INTO marker VALUES ('bootstrapped'); PRAGMA user_version = 90;",
      triggersEnv("SELECT 1;", env),
    );
    assert.equal(result.ok, true);
    assert.deepEqual(caseDataQuery(f.matterRoot, "SELECT value FROM marker").rows, [{ value: "bootstrapped" }]);
    assert.ok(existsSync(join(f.matterRoot, "0. CASE DATA", "main.sqlite")));
    assert.ok(!existsSync(f.caseDataDir), "nothing is created under the firm root");
    const healed = JSON.parse(readFileSync(f.pointerPath, "utf-8"));
    assert.equal(healed.matter_root, f.matterRoot);
    assert.equal(healed.case_data_dir, "0. CASE DATA");
  } finally {
    cleanup();
    f.cleanup();
  }
});

// The guard names migrate, not rebuild: rebuild replays an already-current dump
// and its require_source_version rejects an out-of-date one, so the old
// "run the rebuild operation" text sent every agent down a dead end.
test("matter-data runtime rejects v8.9 and directs migrate to v9.0", () => {
  const f = fixture(89);
  try {
    assert.throws(
      () => caseDataQuery(f.matterRoot, "SELECT 1 AS ok"),
      /schema is at v8\.9.*requires v9\.0.*matter_data__migrate.*plan/s,
    );
  } finally {
    f.cleanup();
  }
});

test("matter-data runtime accepts v9.0 and writes a v9.0 dump header", async () => {
  const f = fixture(90);
  try {
    const result = caseDataQuery(f.matterRoot, "SELECT 1 AS ok");
    assert.deepEqual(result.rows, [{ ok: 1 }]);
    const write = await caseDataExecute(f.matterRoot, "SELECT 1;", triggersEnv("SELECT 1;"));
    assert.equal(readFileSync(write.evidence_sql, "utf-8").split(/\r?\n/, 1)[0], "-- Case Data evidence dump -- schema v9.0");
  } finally {
    f.cleanup();
  }
});

test("a pointer without evidence_sql_path gets its dump in the matter-data folder", async () => {
  const f = liveDerivedFixture();
  try {
    writeFileSync(f.pointerPath, JSON.stringify({ schema_version: 5, case_data_dir: f.caseDataDir }));
    const write = await caseDataExecute(f.matterRoot, "SELECT 1;", triggersEnv("SELECT 1;"));
    assert.equal(write.evidence_sql, join(f.caseDataDir, "evidence.sql"));
    assert.equal(
      JSON.parse(readFileSync(f.pointerPath, "utf-8")).evidence_sql_path,
      join("..", "0. CASE DATA", "T9999 Scratch Matter", "evidence.sql"),
    );
  } finally {
    f.cleanup();
  }
});

// The wrap is executescript("BEGIN;\n" + sql_script + "\n;\nCOMMIT;") -- the
// injected "\n;\n" terminates a caller script whose final statement has no
// trailing semicolon (or is a harmless empty statement when it already did),
// so it no longer collides with the appended COMMIT ("near COMMIT: syntax
// error").
test("execute tolerates a final statement missing its trailing semicolon", async () => {
  const f = fixture(90);
  try {
    const result = await caseDataExecute(
      f.matterRoot,
      "CREATE TABLE t(x); INSERT INTO t VALUES(1)",
      triggersEnv("-- no cross-db triggers needed for this test"),
    );
    assert.equal(result.ok, true);
    assert.deepEqual(
      caseDataQuery(f.matterRoot, "SELECT x FROM t").rows,
      [{ x: 1 }],
    );
  } finally {
    f.cleanup();
  }
});

// initialize's one call creates every table the FK triggers reference, so
// loading triggers.sql first could never succeed on a brand-new matter
// ("no such table: criteria_facts") -- the schema could not be built at all.
test("execute builds a brand-new matter whose triggers reference its own new tables", async () => {
  const f = fixture(90);
  const triggers = "CREATE TEMP TRIGGER trg_t BEFORE INSERT ON t BEGIN SELECT 1; END;";
  try {
    const result = await caseDataExecute(f.matterRoot, "CREATE TABLE t(x);", triggersEnv(triggers));
    assert.equal(result.ok, true);
    assert.deepEqual(
      caseDataQuery(f.matterRoot, "SELECT count(*) AS n FROM sqlite_master WHERE name = 't'").rows,
      [{ n: 1 }],
    );
  } finally {
    f.cleanup();
  }
});

// Deferred, never skipped: on the bootstrap path the triggers still run, so a
// schema missing a table the FK layer guards fails before any copy-back.
test("execute fails a bootstrap whose script omits a table the triggers guard", async () => {
  const f = fixture(90);
  const triggers = "CREATE TEMP TRIGGER trg_missing BEFORE INSERT ON absent BEGIN SELECT 1; END;";
  try {
    await assert.rejects(
      () => caseDataExecute(f.matterRoot, "CREATE TABLE t(x);", triggersEnv(triggers)),
      /no such table: absent/,
    );
    assert.deepEqual(
      caseDataQuery(f.matterRoot, "SELECT count(*) AS n FROM sqlite_master WHERE name = 't'").rows,
      [{ n: 0 }],
    );
  } finally {
    f.cleanup();
  }
});

// #1254: the caller no longer sends the trigger layer, so the backend must find it itself and
// must refuse to write without it (#12) -- before anything is staged or committed.
test("execute refuses to write when the skills tree has no triggers.sql, and commits nothing", async () => {
  const f = fixture(90);
  try {
    await assert.rejects(
      () => caseDataExecute(f.matterRoot, "CREATE TABLE t(x);", triggersEnv(null)),
      (err) => {
        assert.match(err.message, /cannot load the cross-database trigger layer: .*triggers\.sql not found/);
        return true;
      },
    );
    assert.deepEqual(
      caseDataQuery(f.matterRoot, "SELECT count(*) AS n FROM sqlite_master WHERE name = 't'").rows,
      [{ n: 0 }],
    );
  } finally {
    f.cleanup();
  }
});

test("execute refuses to write when triggers.sql is empty, and commits nothing", async () => {
  const f = fixture(90);
  try {
    await assert.rejects(
      () => caseDataExecute(f.matterRoot, "CREATE TABLE t(x);", triggersEnv(" \n")),
      /empty triggers\.sql -- a write session must not proceed without the cross-database FK layer/,
    );
    assert.deepEqual(
      caseDataQuery(f.matterRoot, "SELECT count(*) AS n FROM sqlite_master WHERE name = 't'").rows,
      [{ n: 0 }],
    );
  } finally {
    f.cleanup();
  }
});

// triggers.sql is the single source (#12): a caller can no longer supply its own trigger text.
test("query and execute reject a caller-supplied triggers_sql", async () => {
  const { caseDataToolDefinitions } = await import("../build/schema-gen.js");
  const { validateToolInput } = await import("../build/validate.js");
  const valid = { query: { matter_root: "M", sql: "SELECT 1" }, execute: { matter_root: "M", sql_script: "SELECT 1;" } };
  for (const [op, input] of Object.entries(valid)) {
    const tool = caseDataToolDefinitions().find((t) => t.name.endsWith(op));
    validateToolInput(tool, input);
    assert.throws(
      () => validateToolInput(tool, { ...input, triggers_sql: "SELECT 1;" }),
      /unknown field "triggers_sql"/,
      tool.name,
    );
  }
});

// On an ordinary (non-bootstrap) write the layer the backend read is loaded before the script runs.
test("execute loads the skills tree's triggers.sql before an ordinary write", async () => {
  const f = fixture(90);
  try {
    await caseDataExecute(f.matterRoot, "CREATE TABLE t(x);", triggersEnv("SELECT 1;"));
    const guard = "CREATE TEMP TRIGGER trg_guard BEFORE INSERT ON main.t BEGIN SELECT RAISE(ABORT, 'guarded by triggers.sql'); END;";
    await assert.rejects(
      () => caseDataExecute(f.matterRoot, "INSERT INTO t VALUES (1);", triggersEnv(guard)),
      /guarded by triggers\.sql/,
    );
    assert.deepEqual(caseDataQuery(f.matterRoot, "SELECT count(*) AS n FROM t").rows, [{ n: 0 }]);
  } finally {
    f.cleanup();
  }
});

// The clobber this guards against: execute stages temp copies of all three
// databases, mutates them, then copies all three back. Two sessions staging
// from the same starting binaries both "succeed" and the second copy-back
// silently discards the first's writes.
test("a second execute is refused while another session holds the case lock", async () => {
  const f = fixture(90);
  const { env, cleanup } = isolatedEnv();
  try {
    await caseDataExecute(f.matterRoot, "CREATE TABLE marker(x);", triggersEnv("SELECT 1;", env));

    // Acquiring here at all proves the first execute released its lock; holding
    // it stands in for a second session mid-stage.
    const held = await acquireCaseLock(f.matterRoot, env);
    try {
      await assert.rejects(
        () => caseDataExecute(f.matterRoot, "DROP TABLE marker;", triggersEnv("SELECT 1;", env)),
        (err) => {
          assert.equal(err.code, "lock_unavailable");
          assert.match(err.message, /matter-data write lock/);
          return true;
        },
      );
    } finally {
      held.release();
    }

    // Refused, not applied: the refusal is loud and the first session's write stands.
    assert.deepEqual(
      caseDataQuery(f.matterRoot, "SELECT count(*) AS n FROM sqlite_master WHERE name = 'marker'").rows,
      [{ n: 1 }],
    );
  } finally {
    cleanup();
    f.cleanup();
  }
});

// A fixture with two real natives, so the copy-back has a second database to
// fail on. DBS order is main, law, privileged.
function twoNativeFixture() {
  const matterRoot = mkdtempSync(join(tmpdir(), "coclerk-case-copyback-"));
  const caseDataDir = join(matterRoot, "matter-data");
  mkdirSync(caseDataDir);
  const python = process.env.COCLERK_PYTHON || "python";
  const seeded = spawnSync(
    python,
    ["-c", "import sqlite3,sys\nfor p in sys.argv[1:]:\n    c = sqlite3.connect(p)\n    c.execute('PRAGMA user_version = 90')\n    c.execute('CREATE TABLE marker(value TEXT)')\n    c.execute(\"INSERT INTO marker VALUES ('before')\")\n    c.commit()\n    c.close()", join(caseDataDir, "main.sqlite"), join(caseDataDir, "law.sqlite")],
    { encoding: "utf-8" },
  );
  if (seeded.status !== 0) throw new Error(`fixture Python failed: ${seeded.stderr}`);
  writeFileSync(join(matterRoot, "coclerk.json"), JSON.stringify({
    schema_version: 5,
    matter_root: matterRoot,
    case_data_dir: caseDataDir,
    evidence_sql_path: join("4. LAWYER BRIEF", "CoWork", "evidence.sql"),
  }));
  return {
    matterRoot,
    lawSqlite: join(caseDataDir, "law.sqlite"),
    cleanup: () => rmSync(matterRoot, { recursive: true, force: true }),
  };
}

// Hold an OS handle on `path` in a separate process, opened GENERIC_READ with
// FILE_SHARE_READ and nothing else. That share mask is the point: reads of the
// file still succeed, so staging is unaffected, while any attempt to write over
// it or rename onto it is refused -- which is what a cloud-sync client or a
// scanner holding a destination file actually does.
async function holdShareRestricted(path) {
  const python = process.env.COCLERK_PYTHON || "python";
  const holder = spawn(python, ["-c",
    "import ctypes, sys, time; " +
    "k = ctypes.WinDLL('kernel32', use_last_error=True); " +
    "k.CreateFileW.restype = ctypes.c_void_p; " +
    "h = k.CreateFileW(sys.argv[1], 0x80000000, 0x00000001, None, 3, 0, None); " +
    "print('failed' if h in (None, -1, 4294967295, 18446744073709551615) else 'held', flush=True); " +
    "time.sleep(120)",
    path], { encoding: "utf-8" });
  const status = await new Promise((resolve, reject) => {
    holder.stdout.setEncoding("utf-8");
    holder.stdout.once("data", (chunk) => resolve(chunk.trim()));
    holder.once("error", reject);
    holder.once("exit", () => resolve("exited"));
  });
  return { status, release: () => holder.kill() };
}

// The transaction is atomic; committing the three binaries to disk is not. As
// three sequential shutil.copy2 calls, a destination that was momentarily
// unwritable -- a normal event on the SharePoint/OneDrive-synced `0. CASE DATA`
// tree -- left the databases already copied carrying the new state and the rest
// the old. That is the cross-database inconsistency I5 exists to prevent, and
// it was reported as an opaque temp path with no hint of which half landed.
//
// The injected failure has to permit the staging read and fail the write:
// occupying the native path with a directory instead fails inside stage_copies,
// before the transaction, and never reaches this window at all.
test("a failed copy-back on the second database rolls the first one back", async () => {
  const f = twoNativeFixture();
  const { env, cleanup } = isolatedEnv();
  const holder = await holdShareRestricted(f.lawSqlite);
  try {
    assert.equal(holder.status, "held", "could not hold law.sqlite; the failure was never injected");
    await assert.rejects(
      () => caseDataExecute(
        f.matterRoot,
        "UPDATE marker SET value = 'after'; UPDATE law.marker SET value = 'after';",
        triggersEnv("SELECT 1;", env),
      ),
      (err) => {
        assert.match(err.message, /law\.sqlite/);
        assert.match(err.message, /rolled back and the previous set is intact/);
        return true;
      },
    );
  } finally {
    holder.release();
    cleanup();
  }
  try {
    // Both halves: main was replaced before law failed, and it was put back.
    assert.deepEqual(caseDataQuery(f.matterRoot, "SELECT value FROM marker").rows, [{ value: "before" }]);
    assert.deepEqual(caseDataQuery(f.matterRoot, "SELECT value FROM law.marker").rows, [{ value: "before" }]);
  } finally {
    f.cleanup();
  }
});

// Reads are the hot path and copy nothing back, so they must not be gated.
test("query is not blocked by a held case lock", async () => {
  const f = fixture(90);
  const { env, cleanup } = isolatedEnv();
  try {
    const held = await acquireCaseLock(f.matterRoot, env);
    try {
      assert.deepEqual(caseDataQuery(f.matterRoot, "SELECT 1 AS ok").rows, [{ ok: 1 }]);
    } finally {
      held.release();
    }
  } finally {
    cleanup();
    f.cleanup();
  }
});

// A holder whose lock was taken over as stale must not, on release, delete the
// new holder's lock.
test("releasing a case lock leaves another holder's lock in place", async () => {
  const { env, cleanup } = isolatedEnv();
  try {
    const held = await acquireCaseLock("C:\\matter-release", env);
    const lock = join(env.COCLERK_CASE_LOCK_ROOT, readdirSync(env.COCLERK_CASE_LOCK_ROOT)[0]);
    const other = JSON.stringify({ pid: 1, ts: new Date().toISOString(), token: "another-holder" });
    writeFileSync(lock, other);

    held.release();
    assert.equal(readFileSync(lock, "utf-8"), other);
  } finally {
    cleanup();
  }
});

test("an aged case lock is taken over and reported as broken stale", async () => {
  const { env, cleanup } = isolatedEnv();
  try {
    const first = await acquireCaseLock("C:\\matter-stale", env);
    const name = readdirSync(env.COCLERK_CASE_LOCK_ROOT)[0];
    const lock = join(env.COCLERK_CASE_LOCK_ROOT, name);
    const past = new Date(Date.now() - 3_600_000);
    utimesSync(lock, past, past);

    const second = await acquireCaseLock("C:\\matter-stale", env);
    assert.equal(first.brokeStale, false);
    assert.equal(second.brokeStale, true);
    // The stale lock is gone: only the fresh lock remains.
    assert.deepEqual(readdirSync(env.COCLERK_CASE_LOCK_ROOT), [name]);

    second.release();
    assert.equal(existsSync(lock), false);
  } finally {
    cleanup();
  }
});

// The committed-then-error window this pins, re-confirmed against the backend
// as it stands after the all-or-nothing commit (#613): do_execute commits the
// transaction and commits all three binaries to native storage BEFORE it
// regenerates evidence.sql, so a dump that fails (cloud sync holding the file,
// a disk error) reports the whole call as failed on a write that already
// landed. #613 narrowed the copy-back itself to all-or-nothing; it did not move
// the dump ahead of the commit, so this window survives it. A caller that
// treats non-success as "nothing was written" and blindly re-runs duplicates
// rows. Occupying the evidence.sql path with a non-empty directory makes
// write_dump's os.replace fail on demand. Guidance: /matter-data
// shared/conventions.md section 2.3.
test("execute reports failure but keeps the committed write when the evidence.sql dump fails", async () => {
  const f = fixture(90);
  try {
    await caseDataExecute(f.matterRoot, "CREATE TABLE t(x);", triggersEnv("SELECT 1;"));

    // Replace the dump the bootstrap just wrote with a directory os.replace
    // cannot overwrite. Non-empty so no platform can quietly rename onto it.
    const dump = join(f.matterRoot, "4. LAWYER BRIEF", "CoWork", "evidence.sql");
    rmSync(dump, { force: true });
    mkdirSync(dump, { recursive: true });
    writeFileSync(join(dump, "occupant.txt"), "not a dump\n");

    await assert.rejects(
      () => caseDataExecute(f.matterRoot, "INSERT INTO t VALUES (1);", triggersEnv("SELECT 1;")),
      /matter-data sqlite helper/,
    );

    // The load-bearing assertion: the row is there despite the failure report.
    // If the dump ever moves ahead of the commit, this drops back to 0 and the
    // doc text in section 2.3 stops describing the code.
    assert.deepEqual(
      caseDataQuery(f.matterRoot, "SELECT count(*) AS n FROM t").rows,
      [{ n: 1 }],
    );
  } finally {
    f.cleanup();
  }
});
