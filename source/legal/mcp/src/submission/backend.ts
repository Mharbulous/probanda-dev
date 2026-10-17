// Local drafting-data backend: generic connection-discipline primitives
// over one SQLite file per matter (issue 291 §1 -- a single database, not the
// Probanda plugin's main+law+privileged triple). Reached through the host
// Python `sqlite3` module, mirroring plugins/litigation/mcp/src/case/backend.ts
// (the ratified CLAUDE.md exception: shelling out to host Python keeps the
// Node >=20 pin and adds no node:sqlite dependency or build step).
//
// `drafting_data__query` and `drafting_data__execute` are intentionally
// NOT an entity/ORM surface (issue 292's "generic connection-discipline
// primitives" framing, matching case-data's plan D2): this backend never
// embeds a query, a table name, or a column name. All SQL and schema
// knowledge stays inside the /drafting-data gatekeeper skill (build ticket
// #295).
//
// Callers pass an absolute db_path -- the resolved location of one matter's
// submission database -- rather than a matter_root the backend resolves
// itself. Unlike case-data's probanda.json pointer (which exists to survive a
// matter folder rename independent of its database folder, and a legacy `9.
// AI` migration), this is a brand-new schema with no legacy state and no
// pointer file to heal, so the gatekeeper skill computes the path once and
// hands it in. Keeping path convention out of this backend is itself a
// genericity choice: the matter-workspace layout for the submission database
// is /drafting-data's decision, not this primitive's.
//
// Simplified relative to case-data's backend on purpose (v1 has one database,
// not three ATTACHed together, and no evidence.sql dump requirement -- ADR
// 0004 dropped the privileged/main/law split entirely): `execute` stages a
// temp copy, mutates it under one BEGIN...COMMIT, and copies it back only
// after a clean commit and a closed connection -- the same staged-mutation
// discipline as case-data's I2, without the multi-database ATTACH or dump
// machinery that discipline was built around.
//
// `query` runs in one long-lived sidecar interpreter instead of a process per
// call (issue #517; see sidecarQuery). case/ and practice/ backends still
// spawn per call. `execute` stays one spawn per call, under the data lock.

import { join } from "node:path";
import { MessageChannel, type MessagePort, receiveMessageOnPort, Worker } from "node:worker_threads";

import { DataServerError, PythonTimeoutError, ValidationError } from "../errors.js";
import { pythonDriverFile } from "../python-driver.js";
import { pythonStarts, runPythonDriver } from "../python-spawn.js";
import { pythonTimeoutMs as namespaceTimeoutMs, READ_TIMEOUT_MS, WRITE_TIMEOUT_MS } from "../python-timeout.js";
import { acquireDataLock } from "./lock.js";

const PY_HELPER = String.raw`
import json, os, re, shutil, sqlite3, sys, tempfile, traceback


# Leading whitespace, '--' line comments and '/* */' block comments are
# skipped before the keyword check, so a query copied verbatim from a skill
# file that opens with a comment is not refused. Each comment matches only up
# to its own terminator, the way SQLite reads it, so a comment cannot hide a
# write. One character of whitespace per step keeps the match linear.
READ_ONLY_RE = r'(?is)^(?:\s|--[^\n]*(?:\n|$)|/\*(?:(?!\*/).)*\*/)*(select|with|pragma)\b'


def do_query(req):
    db_path = req['db_path']
    sql = req['sql'].strip()
    if not re.match(READ_ONLY_RE, sql):
        raise SystemExit("drafting_data__query only accepts SELECT/WITH/PRAGMA statements; use drafting_data__execute for writes.")
    if not os.path.exists(db_path):
        raise SystemExit(
            f"No submission database found at {db_path}. Run drafting_data__migrate first.")
    uri = 'file:' + db_path.replace('\\', '/').replace('?', '%3f').replace('#', '%23') + '?mode=ro'
    con = sqlite3.connect(uri, uri=True)
    try:
        cur = con.execute(sql, req.get('params') or [])
        cols = [d[0] for d in cur.description] if cur.description else []
        rows = [dict(zip(cols, r)) for r in cur.fetchall()]
    finally:
        con.close()
    return {"rows": rows}


def do_execute(req):
    db_path = req['db_path']
    if not os.path.exists(db_path):
        raise SystemExit(
            f"No submission database found at {db_path}. Run drafting_data__migrate first.")
    tmp = tempfile.mkdtemp(prefix=f'coclerk_submission_execute_{os.environ["COCLERK_STAGING_TAG"]}_')
    try:
        staged = os.path.join(tmp, os.path.basename(db_path))
        shutil.copy2(db_path, staged)
        con = sqlite3.connect(staged)
        try:
            con.execute("PRAGMA journal_mode = DELETE")
            con.execute("PRAGMA foreign_keys = ON")
            mode = con.execute("PRAGMA journal_mode").fetchone()[0]
            if str(mode).lower() != 'delete':
                raise SystemExit(f"Refusing to operate: journal_mode is '{mode}', expected 'delete'.")
            try:
                con.executescript("BEGIN;\n" + req['sql_script'] + "\n;\nCOMMIT;")
            except Exception:
                con.execute("ROLLBACK")
                raise
            changes = con.total_changes
        finally:
            con.close()
        # Copy the mutated binary back only after a successful commit and a
        # closed connection -- never mutate the live (possibly synced) file
        # in place.
        shutil.copy2(staged, db_path)
        return {"ok": True, "changes": changes}
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def do_write(req):
    # One parameterized statement, staged exactly as do_execute stages a script, so a value
    # (a JSON snapshot full of quotes) is bound rather than spliced into SQL text.
    db_path = req['db_path']
    if not os.path.exists(db_path):
        raise SystemExit(
            f"No submission database found at {db_path}. Run drafting_data__migrate first.")
    tmp = tempfile.mkdtemp(prefix=f'coclerk_submission_write_{os.environ["COCLERK_STAGING_TAG"]}_')
    try:
        staged = os.path.join(tmp, os.path.basename(db_path))
        shutil.copy2(db_path, staged)
        con = sqlite3.connect(staged, isolation_level=None)
        try:
            con.execute("PRAGMA journal_mode = DELETE")
            con.execute("PRAGMA foreign_keys = ON")
            mode = con.execute("PRAGMA journal_mode").fetchone()[0]
            if str(mode).lower() != 'delete':
                raise SystemExit(f"Refusing to operate: journal_mode is '{mode}', expected 'delete'.")
            con.execute("BEGIN")
            try:
                cur = con.execute(req['sql'], req.get('params') or [])
                out = {"ok": True, "rowid": cur.lastrowid, "changes": cur.rowcount}
                con.execute("COMMIT")
            except Exception:
                con.execute("ROLLBACK")
                raise
        finally:
            con.close()
        shutil.copy2(staged, db_path)
        return out
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def do_write_all(req):
    # Several parameterized statements in one transaction, staged as do_write stages one. A
    # statement carrying expect_changes that changes another number of rows rolls the whole
    # transaction back, and the live file is never touched.
    db_path = req['db_path']
    if not os.path.exists(db_path):
        raise SystemExit(
            f"No submission database found at {db_path}. Run drafting_data__migrate first.")
    tmp = tempfile.mkdtemp(prefix=f'coclerk_submission_write_{os.environ["COCLERK_STAGING_TAG"]}_')
    try:
        staged = os.path.join(tmp, os.path.basename(db_path))
        shutil.copy2(db_path, staged)
        con = sqlite3.connect(staged, isolation_level=None)
        try:
            con.execute("PRAGMA journal_mode = DELETE")
            con.execute("PRAGMA foreign_keys = ON")
            mode = con.execute("PRAGMA journal_mode").fetchone()[0]
            if str(mode).lower() != 'delete':
                raise SystemExit(f"Refusing to operate: journal_mode is '{mode}', expected 'delete'.")
            con.execute("BEGIN")
            results = []
            try:
                for i, st in enumerate(req['statements']):
                    cur = con.execute(st['sql'], st.get('params') or [])
                    results.append({"rowid": cur.lastrowid, "changes": cur.rowcount})
                    expected = st.get('expect_changes')
                    if expected is not None and cur.rowcount != expected:
                        con.execute("ROLLBACK")
                        return {"ok": False, "failed": i, "changes": cur.rowcount}
                con.execute("COMMIT")
            except Exception:
                con.execute("ROLLBACK")
                raise
        finally:
            con.close()
        shutil.copy2(staged, db_path)
        return {"ok": True, "results": results}
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def main():
    req = json.load(sys.stdin)
    op = req['op']
    if op == 'execute':
        return do_execute(req)
    if op == 'write':
        return do_write(req)
    if op == 'write_all':
        return do_write_all(req)
    raise SystemExit(f"unknown op: {op}")


def serve():
    # Query sidecar: one request per stdin line, one reply per stdout line.
    # EOF on stdin ends it, so it never outlives the server that started it.
    while True:
        line = sys.stdin.readline()
        if not line:
            return
        try:
            out = do_query(json.loads(line))
        except SystemExit as exc:
            out = {"error": str(exc)}
        except Exception:
            out = {"error": traceback.format_exc().strip()}
        sys.stdout.write(json.dumps(out) + "\n")
        sys.stdout.flush()


if sys.argv[1:] == ['--serve']:
    serve()
else:
    print(json.dumps(main()))
`.trim();

// Runs in a worker thread and owns the long-lived query sidecar (the helper above in --serve
// mode). The main thread blocks on `signal[0]` while this thread talks to Python asynchronously;
// `signal[1]` carries the interpreter's pid so the main thread can kill a hung one outright.
const SIDECAR_WORKER = String.raw`
const { parentPort, workerData } = require("node:worker_threads");
const { spawn } = require("node:child_process");
const { createInterface } = require("node:readline");
const { port, signal, helper, candidates, env } = workerData;
let child = null;
let py = "";
let failure = null;
let pending = null;
let inFlight = false;
let lastErr = "";

function reply(message) {
  port.postMessage(message);
  Atomics.store(signal, 0, 1);
  Atomics.notify(signal, 0);
}

function pump() {
  if (pending === null) return;
  if (failure) { pending = null; reply(failure); return; }
  if (!child) return;
  inFlight = true;
  child.stdin.write(pending + "\n");
  pending = null;
}

function launch(i) {
  if (i >= candidates.length) { failure = { kind: "no_python", lastErr }; pump(); return; }
  const c = spawn(candidates[i], [helper, "--serve"], { env, windowsHide: true });
  let stderr = "";
  c.stderr.setEncoding("utf-8").on("data", (d) => { stderr += d; });
  c.on("error", (err) => {
    if (err.code === "ENOENT" && child !== c) { lastErr = err.message; launch(i + 1); return; }
    failure = { kind: "failed", py: candidates[i], message: err.message };
    if (inFlight) { inFlight = false; reply(failure); } else pump();
  });
  c.on("spawn", () => {
    child = c;
    py = candidates[i];
    Atomics.store(signal, 1, c.pid);
    createInterface({ input: c.stdout }).on("line", (line) => { inFlight = false; reply({ kind: "result", py, line }); });
    pump();
  });
  c.on("exit", (code) => {
    if (child !== c) return;
    child = null;
    Atomics.store(signal, 1, 0);
    failure = { kind: "exited", py, code, stderr };
    if (inFlight) { inFlight = false; reply(failure); } else pump();
  });
}

process.on("uncaughtException", (err) => {
  failure = { kind: "failed", py, message: String((err && err.stack) || err) };
  inFlight = false;
  reply(failure);
});
parentPort.on("message", (request) => { pending = request; pump(); });
launch(0);
`.trim();

function helperFile(): string {
  return pythonDriverFile("submission-sqlite", PY_HELPER);
}

const PY_CANDIDATES = [process.env.COCLERK_PYTHON, "python", "python3"].filter(Boolean) as string[];

/** Budgets for one host Python call (issue #517, rationale in ../python-timeout.ts). Reads are
 * bootstrap's and render's whole path. */
export { READ_TIMEOUT_MS, WRITE_TIMEOUT_MS };

/** COCLERK_SUBMISSION_PYTHON_TIMEOUT_MS overrides every budget (tests use it to force expiry). */
export function pythonTimeoutMs(env: NodeJS.ProcessEnv, defaultMs: number): number {
  return namespaceTimeoutMs(env, defaultMs, "COCLERK_SUBMISSION_PYTHON_TIMEOUT_MS");
}

interface QueryRequest {
  op: "query";
  db_path: string;
  sql: string;
  params?: unknown[];
}

interface ExecuteRequest {
  op: "execute";
  db_path: string;
  sql_script: string;
}

interface WriteRequest {
  op: "write";
  db_path: string;
  sql: string;
  params: unknown[];
}

/** One statement of a `write_all` transaction. With `expect_changes`, any other row count rolls
 * the whole transaction back. */
export interface WriteStatement {
  sql: string;
  params: unknown[];
  expect_changes?: number;
}

interface WriteAllRequest {
  op: "write_all";
  db_path: string;
  statements: WriteStatement[];
}

type SidecarReply =
  | { kind: "result"; py: string; line: string }
  | { kind: "no_python"; lastErr: string }
  | { kind: "failed"; py: string; message: string }
  | { kind: "exited"; py: string; code: number | null; stderr: string };

interface Sidecar {
  worker: Worker;
  port: MessagePort;
  signal: Int32Array;
}

let sidecar: Sidecar | undefined;

function startSidecar(): Sidecar {
  const { port1, port2 } = new MessageChannel();
  const signal = new Int32Array(new SharedArrayBuffer(8));
  const worker = new Worker(SIDECAR_WORKER, {
    eval: true,
    workerData: {
      port: port2,
      signal,
      helper: helperFile(),
      candidates: PY_CANDIDATES,
      env: { ...process.env, PYTHONIOENCODING: "utf-8" },
    },
    transferList: [port2],
  });
  // Neither may keep the server (or a test run) alive; the interpreter follows via stdin EOF.
  worker.unref();
  port1.unref();
  pythonStarts.count++;
  return { worker, port: port1, signal };
}

/** Kills the interpreter directly: a hung Python never reads the EOF that ending the worker sends. */
function discardSidecar(): void {
  if (!sidecar) return;
  const pid = Atomics.load(sidecar.signal, 1);
  if (pid) {
    try {
      process.kill(pid);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ESRCH") throw err;
    }
  }
  void sidecar.worker.terminate();
  sidecar = undefined;
}

/**
 * Queries go to one long-lived sidecar interpreter rather than a process each (issue #517):
 * a Python start costs 150-500ms on Windows, and one bootstrap on a two-filing matter ran
 * ~120 queries. The main thread blocks on the reply exactly as spawnSync did, so tool calls
 * stay serialized. Each query still opens its own read-only connection, so a write copied back
 * by `execute` is visible to the very next query. Any failure discards the sidecar; the next
 * query starts a fresh one.
 */
function sidecarQuery(request: QueryRequest): Record<string, unknown> {
  sidecar ??= startSidecar();
  const { worker, port, signal } = sidecar;
  const timeoutMs = pythonTimeoutMs(process.env, READ_TIMEOUT_MS);
  Atomics.store(signal, 0, 0);
  worker.postMessage(JSON.stringify(request));
  if (Atomics.wait(signal, 0, 0, timeoutMs) === "timed-out") {
    discardSidecar();
    throw new PythonTimeoutError(`drafting-data sqlite sidecar did not answer a query within ${timeoutMs}ms and was killed`);
  }
  const reply = receiveMessageOnPort(port)?.message as SidecarReply | undefined;
  if (reply?.kind === "result") {
    let out: Record<string, unknown>;
    try {
      out = JSON.parse(reply.line) as Record<string, unknown>;
    } catch (err) {
      throw new DataServerError(
        `drafting-data sqlite helper (${reply.py}) produced unparseable output: ${(err as Error).message}. ` +
          `Output began: ${JSON.stringify(reply.line.slice(0, 200))}`
      );
    }
    if (typeof out.error === "string") {
      throw new ValidationError(`drafting-data sqlite helper (${reply.py}) failed: ${out.error}`);
    }
    return out;
  }
  discardSidecar();
  if (reply?.kind === "no_python") {
    throw new ValidationError(
      `No Python interpreter found for the drafting-data sqlite backend (tried ${PY_CANDIDATES.join(", ")}). ` +
      `Install Python 3 or set COCLERK_PYTHON. Last error: ${reply.lastErr}`
    );
  }
  if (reply?.kind === "failed") {
    throw new ValidationError(`drafting-data sqlite helper failed (${reply.py}): ${reply.message}`);
  }
  if (reply?.kind === "exited") {
    throw new ValidationError(`drafting-data sqlite helper (${reply.py}) exited ${reply.code}: ${reply.stderr.trim()}`);
  }
  throw new DataServerError("drafting-data sqlite sidecar signalled a reply but none arrived");
}

function runHelper(request: ExecuteRequest | WriteRequest | WriteAllRequest, env: NodeJS.ProcessEnv): Record<string, unknown> {
  // The copy-back is a sub-second tail of the call, so the kill lands inside it only if the copy
  // itself hangs past the whole budget -- which would otherwise hold the server forever. It can
  // then leave db_path truncated, and execute keeps no backup of its own.
  return runPythonDriver({
    label: "drafting-data sqlite helper",
    driver: helperFile(),
    payload: JSON.stringify(request),
    env,
    timeoutMs: pythonTimeoutMs(env, WRITE_TIMEOUT_MS),
  }) as Record<string, unknown>;
}

export function submissionDataQuery(
  dbPath: string,
  sql: string,
  params?: unknown[]
): { rows: Record<string, unknown>[] } {
  const result = sidecarQuery({ op: "query", db_path: dbPath, sql, params });
  return result as { rows: Record<string, unknown>[] };
}

/**
 * Writes take the cross-process data lock (lock.ts) for the whole
 * stage -> mutate -> copy-back window, for the same reason case-data's execute
 * does: without it, two sessions stage from the same starting bytes and the
 * second copy-back silently discards the first session's writes. `query` stays
 * lock-free on purpose -- it is the hot path and never copies anything back.
 */
export async function submissionDataExecute(
  dbPath: string,
  sqlScript: string,
  env: NodeJS.ProcessEnv = process.env
): Promise<{ ok: true; changes: number; warning?: string }> {
  const lock = await acquireDataLock(dbPath, env);
  try {
    const result = runHelper({ op: "execute", db_path: dbPath, sql_script: sqlScript }, env) as { ok: true; changes: number };
    const withWarning: { ok: true; changes: number; warning?: string } = { ...result };
    if (lock.brokeStale) {
      // A stale lock this long almost certainly means a crashed migrate or
      // execute -- say so rather than writing over whatever it left behind in
      // silence (mirrors case/backend.ts's caseDataExecute).
      withWarning.warning =
        "broke a stale drafting-data write lock (>15 min old) before writing; if another " +
        "session is still writing to or migrating this database, stop and reconcile";
    }
    return withWarning;
  } finally {
    lock.release();
  }
}

/**
 * One parameterized statement in one transaction, under the same data lock and staged copy as
 * `execute`. The caller's SQL binds its values, so a large JSON value needs no escaping, and the
 * result carries the new row's id. The caller owns the SQL; this primitive holds none.
 */
export async function submissionDataWrite(
  dbPath: string,
  sql: string,
  params: unknown[],
  env: NodeJS.ProcessEnv = process.env
): Promise<{ ok: true; rowid: number; changes: number; warning?: string }> {
  const lock = await acquireDataLock(dbPath, env);
  try {
    const result = runHelper({ op: "write", db_path: dbPath, sql, params }, env) as { ok: true; rowid: number; changes: number };
    return lock.brokeStale
      ? {
          ...result,
          warning:
            "broke a stale drafting-data write lock (>15 min old) before writing; if another " +
            "session is still writing to or migrating this database, stop and reconcile",
        }
      : result;
  } finally {
    lock.release();
  }
}

export type WriteAllResult =
  | { ok: true; results: { rowid: number; changes: number }[]; warning?: string }
  | { ok: false; failed: number; changes: number; warning?: string };

/**
 * Several parameterized statements in one transaction, under the same data lock and staged copy
 * as `write`. A statement whose `expect_changes` does not match its row count rolls every
 * statement back and returns `ok: false` naming it, so a guard written as a WHERE clause can
 * refuse the whole write. The caller owns the SQL; this primitive holds none.
 */
export async function submissionDataWriteAll(
  dbPath: string,
  statements: WriteStatement[],
  env: NodeJS.ProcessEnv = process.env
): Promise<WriteAllResult> {
  const lock = await acquireDataLock(dbPath, env);
  try {
    const result = runHelper({ op: "write_all", db_path: dbPath, statements }, env) as WriteAllResult;
    return lock.brokeStale
      ? {
          ...result,
          warning:
            "broke a stale drafting-data write lock (>15 min old) before writing; if another " +
            "session is still writing to or migrating this database, stop and reconcile",
        }
      : result;
  } finally {
    lock.release();
  }
}
