// Local drafting-data backend: generic connection-discipline primitives
// over one SQLite file per matter (issue 291 §1 -- a single database, not the
// Probanda plugin's main+law+privileged triple). Reached through the host
// Python `sqlite3` module, mirroring plugins/litigation/mcp/src/case/backend.ts
// (the ratified CLAUDE.md exception: shelling out to host Python keeps the
// Node >=20 pin and adds no node:sqlite dependency or build step).
//
// `drafting_data__query` and `drafting_data__execute` are intentionally
// NOT an entity/ORM surface (issue 292's "generic connection-discipline
// primitives" framing, matching matter-data's plan D2): this backend never
// embeds a query, a table name, or a column name. All SQL and schema
// knowledge stays inside the /drafting-data gatekeeper skill (build ticket
// #295).
//
// Callers pass an absolute db_path -- the resolved location of one matter's
// submission database -- rather than a matter_root the backend resolves
// itself. Unlike matter-data's probanda.json pointer (which exists to survive a
// matter folder rename independent of its database folder, and a legacy `9.
// AI` migration), this is a brand-new schema with no legacy state and no
// pointer file to heal, so the gatekeeper skill computes the path once and
// hands it in. Keeping path convention out of this backend is itself a
// genericity choice: the matter-workspace layout for the submission database
// is /drafting-data's decision, not this primitive's.
//
// Simplified relative to matter-data's backend on purpose (v1 has one database,
// not three ATTACHed together, and no evidence.sql dump requirement -- ADR
// 0004 dropped the privileged/main/law split entirely): `execute` stages a
// temp copy, mutates it under one BEGIN...COMMIT, and copies it back only
// after a clean commit and a closed connection -- the same staged-mutation
// discipline as matter-data's I2, without the multi-database ATTACH or dump
// machinery that discipline was built around.
//
// `query` runs in one long-lived sidecar interpreter instead of a process per
// call (issue #517; see sidecarQuery). case/ and practice/ backends still
// spawn per call. `execute` stays one spawn per call, under the data lock.

import { join } from "node:path";
import { MessageChannel, type MessagePort, receiveMessageOnPort, Worker } from "node:worker_threads";

import { forgetPerCall, oncePerCall } from "../call-memo.js";
import { DataServerError, PythonTimeoutError, ValidationError } from "../errors.js";
import { pythonDriverFile } from "../python-driver.js";
import { pythonStarts, runPythonDriver } from "../python-spawn.js";
import { pythonTimeoutMs as namespaceTimeoutMs, READ_TIMEOUT_MS, WRITE_TIMEOUT_MS } from "../python-timeout.js";
import { stagedStorePython } from "../staged-store.js";
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


${stagedStorePython({ store: "submission", ext: ".sqlite", migrateTool: "drafting_data__migrate" })}


# Recording a Writing as sent, filed or served is one-way and belongs to record_sent, record_filed
# and record_served, behind the approval gate. So a script that leaves any filing's filed_on or
# sent_copy_id holding a value it did not hold before is refused whole. It is judged by the state
# after the script, never by its text, and raised on the staged copy, so even a script that commits
# itself changes nothing live. Clearing either one stays an update. A database from before a
# column existed is checked on the columns it has.
def recorded(con):
    have = {row[1] for row in con.execute("PRAGMA table_info(filings)")}
    cols = [c for c in ("filed_on", "sent_copy_id") if c in have]
    return {row[0]: row[1:] for row in con.execute(f"SELECT {', '.join(['id'] + cols)} FROM filings")} if cols else {}


# A job's moves belong to the guarded job tools, which write through the write and write_all ops and never
# reach this check. So drafting_data__execute refuses a script that leaves any of these holding a value
# it did not hold: a job's lock, plan approval, completion or deletion stamp, a step's done stamp or
# status, and the job keys of db_meta and kv_store, whose rows are refused changed or removed too.
# Clearing a job column, inserting or deleting an unstamped step, and every other job write stay
# allowed (shelving, supersession, restore, outlining). Judged by state like recorded(), on the
# columns the database has.
JOB_MOVES = (
    ("tickets", "id", ("locked_by", "locked_at"), "drafting_data__assign_job"),
    ("tickets", "id", ("plan_approved_at",), "drafting_data__approve_plan or drafting_data__rewrite_job"),
    ("tickets", "id", ("completed_at",), "drafting_data__complete_job"),
    ("tickets", "id", ("deleted_at",), "drafting_data__delete_job"),
    ("ticket_steps", "ticket_id, ordinal", ("done_at", "status", "wait_until", "status_note"), "drafting_data__set_step"),
)
JOB_KEYS = (
    ("db_meta", "key", "key LIKE 'job_active:%'", "drafting_data__touch_job"),
    ("kv_store", "namespace, key", "namespace IN ('last_activity', 'lock_lapsed')", "drafting_data__touch_job or drafting_data__assign_job"),
    ("kv_store", "namespace, key", "namespace = 'claim_no'", "drafting_data__assign_job"),
)


def job_state(con):
    tables = {row[0] for row in con.execute("SELECT name FROM sqlite_master WHERE type = 'table'")}
    out = []
    for table, key, cols, tool in JOB_MOVES:
        have = {row[1] for row in con.execute(f'PRAGMA table_info("{table}")')} if table in tables else set()
        cols = [c for c in cols if c in have]
        rows = {r[:-len(cols)]: r[-len(cols):] for r in con.execute(f'SELECT {key}, {", ".join(cols)} FROM "{table}"')} if cols else {}
        out.append((table, cols, tool, rows, False))
    for table, key, where, tool in JOB_KEYS:
        rows = {r[:-1]: r[-1:] for r in con.execute(f'SELECT {key}, value FROM "{table}" WHERE {where}')} if table in tables else {}
        out.append((table, ["value"], tool, rows, True))
    return out


def job_move(before, after):
    for (table, cols, tool, was, strict), (_, _, _, now, _) in zip(before, after):
        for row in sorted(set(was) | set(now) if strict else now, key=str):
            new, old = now.get(row, (None,) * len(cols)), was.get(row, (None,) * len(cols))
            for col, n, o in zip(cols, new, old):
                if n != o and (strict or n is not None):
                    return f"job_write_refused: use {tool}. {table} {', '.join(map(str, row))}: {col} is written only by that tool. Nothing was written."
    return None


def do_execute(req):
    def mutate(con):
        before = recorded(con)
        jobs = job_state(con) if req.get('guard_jobs') else None
        try:
            con.executescript("BEGIN;\n" + req['sql_script'] + "\n;\nCOMMIT;")
        except Exception:
            if con.in_transaction:
                con.execute("ROLLBACK")
            raise
        for filing, now in recorded(con).items():
            was = before.get(filing, (None,) * len(now))
            if any(new is not None and new != old for new, old in zip(now, was)):
                raise SystemExit(
                    "filed_on and sent_copy_id are set only by drafting_data__record_sent, record_filed or "
                    f"record_served; clearing filed_on stays an update. Nothing was written (filing {filing}).")
        refused = jobs is not None and job_move(jobs, job_state(con))
        if refused:
            raise SystemExit(refused)
        return {"ok": True, "changes": con.total_changes}, True
    return staged_write(req, 'execute', mutate)


def do_write(req):
    # One parameterized statement, staged exactly as do_execute stages a script, so a value
    # (a JSON snapshot full of quotes) is bound rather than spliced into SQL text.
    def mutate(con):
        con.execute("BEGIN")
        try:
            cur = con.execute(req['sql'], req.get('params') or [])
            out = {"ok": True, "rowid": cur.lastrowid, "changes": cur.rowcount}
            con.execute("COMMIT")
        except Exception:
            if con.in_transaction:
                con.execute("ROLLBACK")
            raise
        return out, True
    return staged_write(req, 'write', mutate, isolation_level=None)


def do_write_all(req):
    # Several parameterized statements in one transaction, staged as do_write stages one. A
    # statement carrying expect_changes that changes another number of rows rolls the whole
    # transaction back, and the live file is never touched. A parameter {"$rowid": n} binds the
    # rowid statement n inserted, so a later statement can name a row this transaction created.
    def mutate(con):
        con.execute("BEGIN")
        results = []
        try:
            for i, st in enumerate(req['statements']):
                params = [results[p['$rowid']]['rowid'] if isinstance(p, dict) else p for p in (st.get('params') or [])]
                cur = con.execute(st['sql'], params)
                results.append({"rowid": cur.lastrowid, "changes": cur.rowcount})
                expected = st.get('expect_changes')
                if expected is not None and cur.rowcount != expected:
                    con.execute("ROLLBACK")
                    return {"ok": False, "failed": i, "changes": cur.rowcount}, False
            con.execute("COMMIT")
        except Exception:
            if con.in_transaction:
                con.execute("ROLLBACK")
            raise
        return {"ok": True, "results": results}, True
    return staged_write(req, 'write', mutate, isolation_level=None)


def do_trial(req):
    # The statements of a write_all run on a disposable copy of the database, with every trigger
    # and guard firing, and the live file is never opened for writing (pinned-revision quick edits).
    # The caller's tables are read before and after, by rowid, so the result names every row the
    # statements and their triggers inserted, updated or deleted. A statement that raises, or whose
    # expect_changes does not match, rolls the copy back and the copy is removed. Otherwise the copy
    # is committed and kept, and the caller renders from it and removes its folder.
    db_path = req['db_path']
    if not os.path.exists(db_path):
        raise SystemExit(
            f"No submission database found at {db_path}. Run drafting_data__migrate first.")
    tmp = tempfile.mkdtemp(prefix=f'coclerk_submission_trial_{os.environ["COCLERK_STAGING_TAG"]}_')
    keep = False
    try:
        staged = os.path.join(tmp, os.path.basename(db_path))
        shutil.copy2(db_path, staged)
        con = sqlite3.connect(staged, isolation_level=None)
        try:
            con.execute("PRAGMA journal_mode = DELETE")
            con.execute("PRAGMA foreign_keys = ON")

            def snapshot():
                out = {}
                for table in req['tables']:
                    cur = con.execute(f'SELECT rowid, * FROM "{table}"')
                    out[table] = {r[0]: json.dumps(list(r[1:]), default=str) for r in cur.fetchall()}
                return out

            before = snapshot()
            con.execute("BEGIN")
            results = []
            for i, st in enumerate(req['statements']):
                params = [results[p['$rowid']]['rowid'] if isinstance(p, dict) else p for p in (st.get('params') or [])]
                try:
                    cur = con.execute(st['sql'], params)
                except sqlite3.Error as exc:
                    con.execute("ROLLBACK")
                    return {"ok": False, "failed": i, "error": str(exc)}
                results.append({"rowid": cur.lastrowid, "changes": cur.rowcount})
                expected = st.get('expect_changes')
                if expected is not None and cur.rowcount != expected:
                    con.execute("ROLLBACK")
                    return {"ok": False, "failed": i, "changes": cur.rowcount}
            after = snapshot()
            changed = {}
            for table in req['tables']:
                b, a = before[table], after[table]
                changed[table] = {
                    "inserted": sorted(k for k in a if k not in b),
                    "deleted": sorted(k for k in b if k not in a),
                    "updated": sorted(k for k in a if k in b and a[k] != b[k]),
                }
            con.execute("COMMIT")
        finally:
            con.close()
        keep = True
        return {"ok": True, "results": results, "changed": changed, "staged_path": staged, "staged_dir": tmp}
    finally:
        if not keep:
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
    if op == 'trial':
        return do_trial(req)
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
  /** Refuse a job move (JOB_MOVES above): set by the drafting_data__execute tool, never by a fixture seed. */
  guard_jobs?: boolean;
}

interface WriteRequest {
  op: "write";
  db_path: string;
  sql: string;
  params: unknown[];
}

/** One statement of a `write_all` transaction. With `expect_changes`, any other row count rolls
 * the whole transaction back. A `{ $rowid: n }` parameter binds the rowid statement n inserted. */
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

interface TrialRequest {
  op: "trial";
  db_path: string;
  statements: WriteStatement[];
  tables: string[];
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

function runHelper(request: ExecuteRequest | WriteRequest | WriteAllRequest | TrialRequest, env: NodeJS.ProcessEnv): Record<string, unknown> {
  forgetDraftingQueries(request.db_path);
  // The budget stops a hung copy-back from holding the server forever. replace_live renames a
  // flushed sibling over db_path, so a kill at any point leaves db_path whole, old or new.
  return runPythonDriver({
    label: "drafting-data sqlite helper",
    driver: helperFile(),
    payload: JSON.stringify(request),
    env,
    timeoutMs: pythonTimeoutMs(env, WRITE_TIMEOUT_MS),
  }) as Record<string, unknown>;
}

/** A query's key in the call memo: `drafting-query`, then the database, the SQL and its parameters. */
const queryKey = (dbPath: string, sql: string, params?: unknown[]) => JSON.stringify(["drafting-query", dbPath, sql, params ?? []]);
const isQueryOf = (dbPath: string) => (key: unknown) => typeof key === "string" && key.startsWith(JSON.stringify(["drafting-query", dbPath]).slice(0, -1) + ",");

/** One round trip per distinct query inside call-memo.ts's inOneCall (session entry asks the same
 * lists many times over); every write to the database drops its memoised reads. Each caller gets
 * its own row objects. */
export function submissionDataQuery(
  dbPath: string,
  sql: string,
  params?: unknown[]
): { rows: Record<string, unknown>[] } {
  const result = oncePerCall(queryKey(dbPath, sql, params), () => sidecarQuery({ op: "query", db_path: dbPath, sql, params }) as { rows: Record<string, unknown>[] });
  return { ...result, rows: result.rows.map((row) => ({ ...row })) };
}

/** Called by every write to `dbPath`, so no later read in the same call is served from before it. */
export function forgetDraftingQueries(dbPath: string): void {
  forgetPerCall(isQueryOf(dbPath));
}

/** The attachment trigger's refusal says a proceeding with a Writing has no board of its own, which is not
 * so when its only Writings are research Writings. The trigger stays as it is, so the refusal adds the way on
 * and drops the trigger's design-record reference: a session quotes this refusal to the practitioner. */
function withAttachHint<T>(run: () => T): T {
  try {
    return run();
  } catch (err) {
    if (err instanceof Error && err.message.includes("a proceeding with a Writing has no board of its own")) {
      err.message =
        err.message.replace(/ \(ADR \d+\)/, ".") +
        " Nothing was written. If this proceeding's only Writings are research memos or case briefs, its own Work Board is still there: " +
        "attach the draft to a live one of them, and it shows on that Work Board and moves to the first Writing that is not a memo or case brief when one is created. " +
        "A retired one takes no draft, so if all of them are retired, this Work Board takes none until one is recovered or another Writing is created.";
    }
    throw err;
  }
}

/**
 * Writes take the cross-process data lock (lock.ts) for the whole
 * stage -> mutate -> copy-back window, for the same reason matter-data's execute
 * does: without it, two sessions stage from the same starting bytes and the
 * second copy-back silently discards the first session's writes. `query` stays
 * lock-free on purpose -- it is the hot path and never copies anything back. guardJobs, set by the
 * drafting_data__execute tool alone, refuses a job move a guarded job tool owns (JOB_MOVES).
 */
export async function submissionDataExecute(
  dbPath: string,
  sqlScript: string,
  env: NodeJS.ProcessEnv = process.env,
  guardJobs = false
): Promise<{ ok: true; changes: number; warning?: string }> {
  const lock = await acquireDataLock(dbPath, env);
  try {
    const result = withAttachHint(() => runHelper({ op: "execute", db_path: dbPath, sql_script: sqlScript, guard_jobs: guardJobs }, env)) as { ok: true; changes: number };
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

export interface TrialChanges {
  inserted: number[];
  deleted: number[];
  updated: number[];
}

export type TrialResult =
  | {
      ok: true;
      results: { rowid: number; changes: number }[];
      /** Per table named, the rowids the statements and their triggers inserted, deleted or updated. */
      changed: Record<string, TrialChanges>;
      /** The committed disposable copy. The caller reads it and removes staged_dir. */
      staged_path: string;
      staged_dir: string;
    }
  | { ok: false; failed: number; error?: string; changes?: number };

/**
 * The statements of a write_all, run on a disposable copy with every trigger and guard firing; the
 * live file is never written (pinned-revision quick edits, drafting_forms__preview_edit). The data
 * lock is held only so the copy is taken whole, never mid copy-back. `tables` are read before and
 * after to name every row changed. A statement that raises returns its message verbatim in `error`.
 * The caller owns the SQL and the table names; this primitive holds none.
 */
export async function submissionDataTrial(
  dbPath: string,
  statements: WriteStatement[],
  tables: string[],
  env: NodeJS.ProcessEnv = process.env
): Promise<TrialResult> {
  const lock = await acquireDataLock(dbPath, env);
  try {
    return runHelper({ op: "trial", db_path: dbPath, statements, tables }, env) as TrialResult;
  } finally {
    lock.release();
  }
}
