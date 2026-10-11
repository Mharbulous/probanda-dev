// Issue #612: case-data and timecamping-data ran host Python through spawnSync with no timeout, so
// a hung helper froze every tool on the server. These pin the named timeout on each of their
// Python paths and check that the server answers the next call once the helper is killed.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import test from "node:test";

const { caseDataExecute, caseDataQuery } = await import("../build/case/backend.js");
const { caseDataMigrate } = await import("../build/case/migrate.js");
const { timecampingDataExecute, timecampingDataQuery } = await import("../build/timecamping/backend.js");
const { timecampingDataMigrate } = await import("../build/timecamping/migrate.js");
const { withTempDir } = await import("./helpers/temp-dir.mjs");

const CASE_VAR = "COCLERK_CASE_PYTHON_TIMEOUT_MS";
const TIMECAMPING_VAR = "COCLERK_TIMECAMPING_PYTHON_TIMEOUT_MS";

async function withTimeoutOverride(variable, ms, fn) {
  process.env[variable] = String(ms);
  try {
    return await fn();
  } finally {
    delete process.env[variable];
  }
}

function isPythonTimeout(err) {
  assert.equal(err.name, "PythonTimeoutError");
  assert.equal(err.code, "python_timeout");
  assert.match(err.message, /did not finish within \d+ms and was killed/);
  return true;
}

// A case matter at v9.0 whose write lock lives in scratch, never in %LOCALAPPDATA%.
function caseFixture(t) {
  const matterRoot = mkdtempSync(join(tmpdir(), "coclerk-case-timeout-"));
  t.after(() => rmSync(matterRoot, { recursive: true, force: true }));
  const caseDataDir = join(matterRoot, "case-data");
  mkdirSync(caseDataDir);
  const python = process.env.COCLERK_PYTHON || "python";
  const result = spawnSync(
    python,
    ["-c", "import sqlite3,sys; c=sqlite3.connect(sys.argv[1]); c.execute('PRAGMA user_version = 90'); c.close()", join(caseDataDir, "main.sqlite")],
    { encoding: "utf-8" },
  );
  if (result.status !== 0) throw new Error(`fixture Python failed: ${result.stderr}`);
  writeFileSync(join(matterRoot, "coclerk.json"), JSON.stringify({
    schema_version: 5,
    matter_root: matterRoot,
    case_data_dir: caseDataDir,
    evidence_sql_path: join("4. LAWYER BRIEF", "CoWork", "evidence.sql"),
  }));
  // execute reads triggers.sql from the skills tree (#1254): give it a synthetic one.
  const references = join(matterRoot, "skills-root", ".claude", "skills", "case-data", "references");
  mkdirSync(references, { recursive: true });
  writeFileSync(join(references, "triggers.sql"), "SELECT 1;");
  return {
    matterRoot,
    env: { ...process.env, COCLERK_CASE_LOCK_ROOT: join(matterRoot, "locks"), COCLERK_REPO_ROOT: join(matterRoot, "skills-root") },
  };
}

// A migrated timecamping database: a live call on a second namespace.
async function timecampingFixture(t) {
  const scratch = mkdtempSync(join(tmpdir(), "coclerk-timecamping-timeout-"));
  t.after(() => rmSync(scratch, { recursive: true, force: true }));
  const env = { ...process.env, COCLERK_TIMECAMPING_DB_PATH: join(scratch, "timecamping.db") };
  await timecampingDataMigrate(env);
  return { env };
}

test("a case-data execute that outlives its budget fails with a named timeout that does not claim rollback, and the server answers the next calls", async (t) => {
  const f = caseFixture(t);
  const tc = await timecampingFixture(t);
  await assert.rejects(() => caseDataExecute(f.matterRoot, "SELECT 1;", { ...f.env, [CASE_VAR]: "1" }), (err) => {
    isPythonTimeout(err);
    assert.match(err.message, /may already have committed: verify before retrying/);
    assert.match(err.message, /\.coclerk_execute_\*/);
    assert.doesNotMatch(err.message, /rolled back/);
    return true;
  });
  // A different namespace answers, and so does case-data's own write path: the killed call freed the lock.
  assert.deepEqual(timecampingDataQuery("SELECT 1 AS ok", undefined, tc.env).rows, [{ ok: 1 }]);
  assert.deepEqual((await caseDataExecute(f.matterRoot, "SELECT 1;", f.env)).ok, true);
});

test("a case-data query that outlives its budget fails with a named timeout, and the next query recovers", async (t) => {
  const f = caseFixture(t);
  await withTimeoutOverride(CASE_VAR, 1, () =>
    assert.throws(() => caseDataQuery(f.matterRoot, "SELECT 1 AS ok"), (err) => {
      isPythonTimeout(err);
      assert.doesNotMatch(err.message, /committed/);
      return true;
    })
  );
  assert.deepEqual(caseDataQuery(f.matterRoot, "SELECT 1 AS ok").rows, [{ ok: 1 }]);
});

// The CREATE runs first and the CTE never finishes in budget, so the kill lands inside Python before COMMIT.
test("a case-data execute killed mid-script leaves the databases untouched", async (t) => {
  const f = caseFixture(t);
  const never = "WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM c WHERE x < 1000000000) SELECT count(*) FROM c;";
  await withTempDir(f.matterRoot, () =>
    assert.rejects(
      () => caseDataExecute(f.matterRoot, `CREATE TABLE timeout_probe (x);\n${never}`, { ...f.env, [CASE_VAR]: "3000" }),
      { name: "PythonTimeoutError" }
    )
  );
  assert.deepEqual(caseDataQuery(f.matterRoot, "SELECT name FROM sqlite_master WHERE name = 'timeout_probe'").rows, []);
  // #703: the killed helper's staging copy (privileged.sqlite included) does not outlive it.
  assert.deepEqual(readdirSync(f.matterRoot).filter((name) => name.startsWith("coclerk_")), []);
});

// A copy of the case-data scripts whose plan staging stalls: sitecustomize runs at interpreter start
// (PYTHONPATH is the scripts dir) and, before the first copy into a plan folder, records that
// folder in `sentinel` and sleeps past the budget.
function stallingCaseDataRepo(t, sentinel) {
  const repo = mkdtempSync(join(tmpdir(), "coclerk-migrate-stall-repo-"));
  t.after(() => rmSync(repo, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));
  const references = join(repo, ".claude", "skills", "case-data", "references");
  cpSync(join(import.meta.dirname, "..", "..", "..", "..", ".claude", "skills", "case-data", "references"), references, { recursive: true });
  writeFileSync(join(references, "scripts", "sitecustomize.py"), [
    "import os, shutil, time",
    "_copy2 = shutil.copy2",
    "def copy2(src, dst, *a, **k):",
    "    if 'coclerk_migrate_plan_' in str(dst):",
    `        open(${JSON.stringify(sentinel)}, 'w').write(os.path.dirname(str(dst)))`,
    "        time.sleep(20)",
    "    return _copy2(src, dst, *a, **k)",
    "shutil.copy2 = copy2",
    "",
  ].join("\n"));
  return repo;
}

test("the case-data migrate driver fails with a named timeout when it outlives its budget, and leaves no staging copy", async (t) => {
  const f = caseFixture(t);
  // plan stages the whole set, so it refuses before staging unless law and privileged exist too.
  for (const db of ["law", "privileged"]) {
    copyFileSync(join(f.matterRoot, "case-data", "main.sqlite"), join(f.matterRoot, "case-data", `${db}.sqlite`));
  }
  const temp = mkdtempSync(join(tmpdir(), "coclerk-migrate-timeout-temp-"));
  t.after(() => rmSync(temp, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));
  const sentinel = join(f.matterRoot, "stalled-in.txt");
  const repo = stallingCaseDataRepo(t, sentinel);
  // Another call's staging folder, which this call's cleanup must not touch.
  mkdirSync(join(temp, "coclerk_migrate_plan_0123456789abcdef_decoy"));
  // migrate reads its budget from the env it is passed, not process.env.
  await withTempDir(temp, () =>
    assert.rejects(() => caseDataMigrate(f.matterRoot, "plan", {}, { ...f.env, COCLERK_REPO_ROOT: repo, [CASE_VAR]: "5000" }), (err) => {
      isPythonTimeout(err);
      assert.match(err.message, /mode 'restore'/);
      return true;
    })
  );
  // #1060: the kill landed while the tagged plan folder existed, and that copy of the databases
  // does not outlive it. The filter skips the driver file, which is named coclerk-..., not coclerk_.
  const stalledIn = readFileSync(sentinel, "utf-8");
  assert.equal(dirname(stalledIn), temp);
  assert.match(basename(stalledIn), /^coclerk_migrate_plan_[0-9a-f]{16}_/);
  assert.equal(existsSync(stalledIn), false);
  assert.deepEqual(readdirSync(temp).filter((name) => name.startsWith("coclerk_")), ["coclerk_migrate_plan_0123456789abcdef_decoy"]);
});

test("a timecamping-data execute that outlives its budget fails with a named timeout, and the next query recovers", async (t) => {
  const tc = await timecampingFixture(t);
  await assert.rejects(() => timecampingDataExecute("SELECT 1;", { ...tc.env, [TIMECAMPING_VAR]: "1" }), (err) => {
    isPythonTimeout(err);
    assert.match(err.message, /may already have committed: verify before retrying/);
    assert.doesNotMatch(err.message, /rolled back/);
    return true;
  });
  assert.deepEqual(timecampingDataQuery("SELECT 1 AS ok", undefined, tc.env).rows, [{ ok: 1 }]);
});

test("the timecamping-data migrate driver fails with a named timeout when it outlives its budget", async (t) => {
  const tc = await timecampingFixture(t);
  await assert.rejects(() => timecampingDataMigrate({ ...tc.env, [TIMECAMPING_VAR]: "1" }), isPythonTimeout);
});

// Issue #693: practice-data and time-pipeline were the last host-Python spawns with no timeout.
// Both helpers apply each write as one SQLite transaction in DELETE journal mode, so a kill leaves
// the write whole or absent: the message asks for a read-back, never a staging-folder check.

const { LocalPracticeAdmin, practiceTimeoutMs } = await import("../build/practice/backend.js");
const { practiceEntityFor } = await import("../build/practice-registry.js");
const {
  timePipelineBulkApply,
  timePipelineGet,
  timePipelineList,
  timePipelineSet,
  timePipelineTimeoutMs,
} = await import("../build/time-pipeline/backend.js");
const { EXECUTE_TIMEOUT_MS, READ_TIMEOUT_MS, WRITE_TIMEOUT_MS } = await import("../build/python-timeout.js");

const PRACTICE_VAR = "COCLERK_PRACTICE_PYTHON_TIMEOUT_MS";
const TIME_PIPELINE_VAR = "COCLERK_TIME_PIPELINE_PYTHON_TIMEOUT_MS";

function isWriteTimeout(err) {
  isPythonTimeout(err);
  assert.match(err.message, /may already have committed: verify .*before retrying/);
  assert.doesNotMatch(err.message, /staging|coclerk_execute|mixed|rolled back/);
  return true;
}

function isReadTimeout(err) {
  isPythonTimeout(err);
  assert.doesNotMatch(err.message, /committed/);
  return true;
}

function practiceFixture(t) {
  const scratch = mkdtempSync(join(tmpdir(), "coclerk-practice-timeout-"));
  t.after(() => rmSync(scratch, { recursive: true, force: true }));
  const env = { ...process.env, COCLERK_DB_PATH: join(scratch, "practice.db") };
  return { env, clients: practiceEntityFor("practice_clients") };
}

function timePipelineFixture(t) {
  const scratch = mkdtempSync(join(tmpdir(), "coclerk-time-pipeline-timeout-"));
  t.after(() => rmSync(scratch, { recursive: true, force: true }));
  return { scratch, env: { ...process.env, COCLERK_TIME_PIPELINE_DB_PATH: join(scratch, "time_pipeline.db") } };
}

test("a practice query that outlives its budget fails with a named read timeout, and the next query recovers", async (t) => {
  const f = practiceFixture(t);
  const admin = new LocalPracticeAdmin(f.env);
  await admin.query(f.clients);
  const hung = new LocalPracticeAdmin({ ...f.env, [PRACTICE_VAR]: "1" });
  await assert.rejects(() => hung.query(f.clients), (err) => {
    isReadTimeout(err);
    assert.match(err.message, /^practice-data sqlite helper \(/);
    return true;
  });
  assert.deepEqual(await admin.query(f.clients), []);
});

test("a killed practice write fails with a verify-before-retry timeout and leaves the table whole and readable", async (t) => {
  const f = practiceFixture(t);
  const admin = new LocalPracticeAdmin(f.env);
  await admin.query(f.clients);
  const rows = Array.from({ length: 200 }, (_, i) => ({ id: `c${i}`, name: `Client ${i}` }));
  const hung = new LocalPracticeAdmin({ ...f.env, [PRACTICE_VAR]: "1" });
  await assert.rejects(() => hung.insertMany(f.clients, rows), isWriteTimeout);
  const after = await admin.query(f.clients);
  assert.ok(after.length === 0 || after.length === rows.length, `partial write: ${after.length} rows`);
  // The server is not left blocked: the same backend writes on the next call.
  await admin.insert(f.clients, { id: "next", name: "Next" });
  assert.equal((await admin.query(f.clients, { id: "eq.next" })).length, 1);
});

test("time-pipeline get and set that outlive their budget fail with named timeouts, and the next call recovers", (t) => {
  const f = timePipelineFixture(t);
  timePipelineSet("timeline", "k", "\"v\"", f.env);
  const hung = { ...f.env, [TIME_PIPELINE_VAR]: "1" };
  assert.throws(() => timePipelineGet("timeline", "k", hung), (err) => {
    isReadTimeout(err);
    assert.match(err.message, /^time-pipeline sqlite helper \(/);
    return true;
  });
  assert.throws(() => timePipelineSet("timeline", "k", "\"w\"", hung), isWriteTimeout);
  const { value } = timePipelineGet("timeline", "k", f.env);
  assert.ok(value === "\"v\"" || value === "\"w\"", `unexpected value ${value}`);
  timePipelineSet("timeline", "k2", "\"x\"", f.env);
  assert.deepEqual(timePipelineGet("timeline", "k2", f.env), { value: "\"x\"" });
});

// 5000 sets run first, then merges into one ever-growing array (quadratic, many seconds), so the
// kill lands inside the transaction and SQLite must roll every set back on the next open.
test("a time-pipeline bulk_apply killed mid-transaction leaves the database unchanged and readable", (t) => {
  const f = timePipelineFixture(t);
  timePipelineSet("timeline", "before", "\"kept\"", f.env);
  const lines = [];
  for (let i = 0; i < 5000; i++) lines.push(JSON.stringify({ op: "set", key: `bulk:${i}`, value: "1" }));
  for (let i = 0; i < 40000; i++) lines.push(JSON.stringify({ op: "merge", key: "index", add: [`id-${i}`] }));
  const file = join(f.scratch, "bulk.jsonl");
  writeFileSync(file, lines.join("\n"), "utf-8");
  assert.throws(() => timePipelineBulkApply("timeline", file, { ...f.env, [TIME_PIPELINE_VAR]: "3000" }), isWriteTimeout);
  assert.deepEqual(timePipelineList("timeline", "", f.env).items, [{ key: "before", value: "\"kept\"" }]);
});

test("with no override each practice and time-pipeline operation takes its brief's budget", () => {
  const env = {};
  assert.equal(practiceTimeoutMs("query", env), READ_TIMEOUT_MS);
  for (const op of ["insert", "insertMany", "update", "delete"]) assert.equal(practiceTimeoutMs(op, env), EXECUTE_TIMEOUT_MS);
  for (const op of ["get", "list"]) assert.equal(timePipelineTimeoutMs(op, env), READ_TIMEOUT_MS);
  for (const op of ["set", "delete"]) assert.equal(timePipelineTimeoutMs(op, env), EXECUTE_TIMEOUT_MS);
  assert.equal(timePipelineTimeoutMs("bulk_apply", env), WRITE_TIMEOUT_MS);
});

test("an invalid practice or time-pipeline timeout override is rejected naming the variable", async (t) => {
  const f = practiceFixture(t);
  const tp = timePipelineFixture(t);
  for (const bad of ["0", "-5", "soon"]) {
    await assert.rejects(
      () => new LocalPracticeAdmin({ ...f.env, [PRACTICE_VAR]: bad }).query(f.clients),
      (err) => err.name === "ValidationError" && err.message.includes(PRACTICE_VAR),
    );
    assert.throws(
      () => timePipelineGet("timeline", "k", { ...tp.env, [TIME_PIPELINE_VAR]: bad }),
      (err) => err.name === "ValidationError" && err.message.includes(TIME_PIPELINE_VAR),
    );
  }
});
