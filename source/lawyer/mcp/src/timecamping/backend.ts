// Local timecamping-data backend: generic connection-discipline primitives
// over a single, fixed, per-practitioner SQLite file (issue #430), mirroring
// plugins/litigation/mcp/src/submission/backend.ts's query/execute staging
// discipline but resolving its path server-side like practice.db and
// time_pipeline.db (single-file, not per-matter) -- see timecamping/backend.ts's
// resolveTimecampingDbPath below, which mirrors resolveTimePipelineDbPath
// exactly. Reached through the host Python `sqlite3` module (the ratified
// CLAUDE.md exception: shelling out to host Python keeps the Node >=20 pin
// and adds no node:sqlite dependency or build step).
//
// `timecamping_data__query` and `timecamping_data__execute` are generic
// connection-discipline primitives, same as matter_data__query/execute and
// drafting_data__query/execute: this backend never embeds a query, a table
// name, or a column name. All SQL and schema knowledge stays inside the
// /timecamping-data gatekeeper skill (root CLAUDE.md's database-encapsulation
// rule).
//
// `execute` stages a temp copy, mutates it under one BEGIN...COMMIT, and
// copies it back only after a clean commit and a closed connection -- the
// same staged-mutation discipline drafting-data's backend uses, load-bearing
// here for the same reason: timecamping.db lives in the same SharePoint/OneDrive
// -synced `0. CASE DATA` tree as practice.db and time_pipeline.db, where a
// live handle left on a synced binary risks stale-metadata corruption (see
// .claude/skills/matter-data/shared/conventions.md §1/§2.1). `query` opens the
// live file directly with mode=ro -- the drafting-data precedent, since the
// staging discipline binds writes, not reads.

import { join } from "node:path";

import { resolveCaseDataRoot } from "../practice/backend.js";
import { pythonDriverFile } from "../python-driver.js";
import { runPythonDriver } from "../python-spawn.js";
import { EXECUTE_TIMEOUT_MS, pythonTimeoutMs, READ_TIMEOUT_MS, WRITE_TIMEOUT_MS } from "../python-timeout.js";
import { acquireDataLock } from "./lock.js";

// COCLERK_TIMECAMPING_DB_PATH is a full-path test override, mirroring
// COCLERK_TIME_PIPELINE_DB_PATH; otherwise the file sits alongside
// practice.db and time_pipeline.db under the same case_data_root\_practice\
// folder -- single, fixed, per-practitioner, not per-matter.
export function resolveTimecampingDbPath(env: NodeJS.ProcessEnv = process.env): string {
  if (env.COCLERK_TIMECAMPING_DB_PATH) return env.COCLERK_TIMECAMPING_DB_PATH;
  const root = resolveCaseDataRoot(env);
  return join(root, "_practice", env.COCLERK_TIMECAMPING_DB_NAME || "timecamping.db");
}

const PY_HELPER = String.raw`
import json, os, re, shutil, sqlite3, sys, tempfile


def _strip_leading_line_comments(sql):
    # references/splice.sql (and any other reference .sql file meant to be
    # read and passed through verbatim) starts with a header comment block --
    # skip leading blank lines and full-line '--' comments before checking
    # the statement's leading keyword, so a verbatim read isn't rejected for
    # its own documentation.
    lines = sql.splitlines()
    i = 0
    while i < len(lines) and (not lines[i].strip() or lines[i].strip().startswith('--')):
        i += 1
    return '\n'.join(lines[i:])


def do_query(req):
    db_path = req['db_path']
    sql = req['sql'].strip()
    if not re.match(r'(?is)^\s*(select|with|pragma)\b', _strip_leading_line_comments(sql)):
        raise SystemExit("timecamping_data__query only accepts SELECT/WITH/PRAGMA statements; use timecamping_data__execute for writes.")
    if not os.path.exists(db_path):
        raise SystemExit(
            f"No timecamping database found at {db_path}. Run timecamping_data__migrate first.")
    uri = 'file:' + db_path.replace('\\', '/').replace('?', '%3f').replace('#', '%23') + '?mode=ro'
    con = sqlite3.connect(uri, uri=True)
    try:
        cur = con.execute(sql, req.get('params') or [])
        cols = [d[0] for d in cur.description] if cur.description else []
        rows = [dict(zip(cols, r)) for r in cur.fetchall()]
    finally:
        con.close()
    return {"rows": rows}


def copy_fsync(src, dst):
    """copy2 then flush to disk, so a later rename cannot expose a torn file."""
    shutil.copy2(src, dst)
    with open(dst, 'rb+') as fh:
        os.fsync(fh.fileno())
    return dst


def replace_live(staged, db_path):
    # Stage the finished file beside db_path (same volume), flush it, then rename it over the
    # live file, so a kill at any point leaves db_path whole: old or new, never torn.
    sibling = os.path.join(os.path.dirname(db_path), f'coclerk_timecamping_replace_{os.environ["COCLERK_STAGING_TAG"]}.db')
    try:
        copy_fsync(staged, sibling)
        os.replace(sibling, db_path)
    finally:
        if os.path.exists(sibling):
            os.remove(sibling)


def do_execute(req):
    db_path = req['db_path']
    if not os.path.exists(db_path):
        raise SystemExit(
            f"No timecamping database found at {db_path}. Run timecamping_data__migrate first.")
    tmp = tempfile.mkdtemp(prefix=f'coclerk_timecamping_execute_{os.environ["COCLERK_STAGING_TAG"]}_')
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
                if con.in_transaction:
                    con.execute("ROLLBACK")
                raise
        finally:
            con.close()
        # Replace the live file only after a successful commit and a closed
        # connection -- never mutate the live (possibly synced) file in place.
        replace_live(staged, db_path)
        return {"ok": True}
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


_IDENT = re.compile(r'^[A-Za-z_][A-Za-z0-9_]*$')


def _ident(name, line_no, what):
    if not isinstance(name, str) or not _IDENT.match(name):
        raise SystemExit(f"line {line_no}: {what} {name!r} is not a valid identifier")
    return '"' + name + '"'


def _upsert_statement(entry, line_no):
    # Table, key and column names arrive in the file (written by the gatekeeper
    # skill's own script), never in this backend -- the same schema-free stance
    # as execute. Every identifier is validated and quoted; every value is bound.
    if not isinstance(entry, dict):
        raise SystemExit(f"line {line_no}: expected a JSON object with table, key and row")
    table = _ident(entry.get('table'), line_no, 'table')
    row = entry.get('row')
    if not isinstance(row, dict) or not row:
        raise SystemExit(f"line {line_no}: row must be a non-empty JSON object")
    columns = []
    values = []
    for col, value in row.items():
        columns.append(_ident(col, line_no, 'column'))
        if value is not None and not isinstance(value, (bool, int, float, str)):
            raise SystemExit(f"line {line_no}: column {col!r} holds a nested value; values must be JSON scalars")
        values.append(value)
    key = entry.get('key')
    if not isinstance(key, list) or not key:
        raise SystemExit(f"line {line_no}: key must be a non-empty list of column names")
    key_cols = [_ident(k, line_no, 'key column') for k in key]
    for k in key:
        if k not in row:
            raise SystemExit(f"line {line_no}: key column {k!r} is not in row")
    rest = [c for c in columns if c not in key_cols]
    action = ("DO UPDATE SET " + ", ".join(f"{c} = excluded.{c}" for c in rest)) if rest else "DO NOTHING"
    # ON CONFLICT DO UPDATE, never INSERT OR REPLACE: a replace deletes and
    # re-inserts, renumbering id, and proposals.evidence_chain points at ids.
    sql = (f"INSERT INTO {table} ({', '.join(columns)}) VALUES ({', '.join('?' for _ in columns)}) "
           f"ON CONFLICT ({', '.join(key_cols)}) {action}")
    return entry['table'], sql, values


def do_bulk_upsert(req):
    db_path = req['db_path']
    path = req['path']
    if not os.path.isfile(path):
        raise SystemExit(f"file not found: {path}")
    if not os.path.exists(db_path):
        raise SystemExit(
            f"No timecamping database found at {db_path}. Run timecamping_data__migrate first.")
    tmp = tempfile.mkdtemp(prefix=f'coclerk_timecamping_bulk_upsert_{os.environ["COCLERK_STAGING_TAG"]}_')
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
            lines = 0
            rows = {}
            con.execute("BEGIN")
            try:
                with open(path, 'r', encoding='utf-8') as fh:
                    for line_no, raw in enumerate(fh, 1):
                        raw = raw.strip()
                        if not raw:
                            continue
                        try:
                            entry = json.loads(raw)
                        except ValueError as exc:
                            raise SystemExit(f"line {line_no} is not valid JSON: {exc}")
                        table, sql, values = _upsert_statement(entry, line_no)
                        try:
                            con.execute(sql, values)
                        except sqlite3.Error as exc:
                            raise SystemExit(f"line {line_no}: {exc}")
                        lines += 1
                        rows[table] = rows.get(table, 0) + 1
                con.execute("COMMIT")
            except BaseException:
                if con.in_transaction:
                    con.execute("ROLLBACK")
                raise
        finally:
            con.close()
        # Same copy-back discipline as execute: only after a clean commit and
        # a closed connection, never mutating the live file in place.
        replace_live(staged, db_path)
        return {"lines": lines, "rows": rows}
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def main():
    req = json.load(sys.stdin)
    op = req['op']
    if op == 'query':
        return do_query(req)
    if op == 'execute':
        return do_execute(req)
    if op == 'bulk_upsert':
        return do_bulk_upsert(req)
    raise SystemExit(f"unknown op: {op}")


print(json.dumps(main()))
`.trim();

function helperFile(): string {
  return pythonDriverFile("timecamping-sqlite", PY_HELPER);
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

interface BulkUpsertRequest {
  op: "bulk_upsert";
  db_path: string;
  path: string;
}

export interface BulkUpsertResult {
  lines: number;
  rows: Record<string, number>;
  warning?: string;
}

// The copy-back renames a flushed sibling over the live file, so a kill leaves timecamping.db
// whole, either before or after the write.
const EXECUTE_TIMEOUT_ADVICE =
  "The write may already have committed: verify before retrying (/timecamping-data Operation Routing).";

// A bulk_upsert is a whole day's evidence file in one transaction -- like
// time_pipeline__bulk_apply, killing a slow but healthy load is worse than
// letting it finish, so it takes the write budget rather than execute's.
function runHelper(
  request: QueryRequest | ExecuteRequest | BulkUpsertRequest,
  env: NodeJS.ProcessEnv
): Record<string, unknown> {
  const write = request.op !== "query";
  const defaultMs = request.op === "bulk_upsert" ? WRITE_TIMEOUT_MS : write ? EXECUTE_TIMEOUT_MS : READ_TIMEOUT_MS;
  return runPythonDriver({
    label: "timecamping-data sqlite helper",
    driver: helperFile(),
    payload: JSON.stringify(request),
    env,
    timeoutMs: pythonTimeoutMs(env, defaultMs, "COCLERK_TIMECAMPING_PYTHON_TIMEOUT_MS"),
    timeoutAdvice: write ? EXECUTE_TIMEOUT_ADVICE : undefined,
  }) as Record<string, unknown>;
}

export function timecampingDataQuery(
  sql: string,
  params: unknown[] | undefined,
  env: NodeJS.ProcessEnv = process.env
): { rows: Record<string, unknown>[] } {
  const dbPath = resolveTimecampingDbPath(env);
  const result = runHelper({ op: "query", db_path: dbPath, sql, params }, env);
  return result as { rows: Record<string, unknown>[] };
}

/**
 * Writes take the cross-process data lock (lock.ts) for the whole
 * stage -> mutate -> copy-back window, for the same reason drafting-data's
 * execute does: without it, two sessions stage from the same starting bytes
 * and the second copy-back silently discards the first session's writes.
 * `query` stays lock-free on purpose -- it is the hot path and never copies
 * anything back.
 */
export async function timecampingDataExecute(
  sqlScript: string,
  env: NodeJS.ProcessEnv = process.env
): Promise<{ ok: true; warning?: string }> {
  const dbPath = resolveTimecampingDbPath(env);
  const lock = await acquireDataLock(dbPath, env);
  try {
    const result = runHelper({ op: "execute", db_path: dbPath, sql_script: sqlScript }, env) as { ok: true };
    const withWarning: { ok: true; warning?: string } = { ...result };
    if (lock.brokeStale) {
      // A stale lock this long almost certainly means a crashed migrate or
      // execute -- say so rather than writing over whatever it left behind in
      // silence (mirrors submission/backend.ts's timecampingDataExecute).
      withWarning.warning = STALE_LOCK_WARNING;
    }
    return withWarning;
  } finally {
    lock.release();
  }
}

const STALE_LOCK_WARNING =
  "broke a stale timecamping-data write lock (>15 min old) before writing; if another " +
  "session is still writing to or migrating this database, stop and reconcile";

/**
 * Upserts every line of a caller-written JSONL file in one transaction, under
 * the same lock and stage -> mutate -> copy-back discipline as execute. The
 * server reads the file itself, so a day's source rows (thousands of them)
 * never pass through tool arguments. Each line names its own table, key and
 * columns; this backend still holds no table or column name.
 */
export async function timecampingDataBulkUpsert(
  path: string,
  env: NodeJS.ProcessEnv = process.env
): Promise<BulkUpsertResult> {
  const dbPath = resolveTimecampingDbPath(env);
  const lock = await acquireDataLock(dbPath, env);
  try {
    const result = runHelper({ op: "bulk_upsert", db_path: dbPath, path }, env) as unknown as BulkUpsertResult;
    return lock.brokeStale ? { ...result, warning: STALE_LOCK_WARNING } : result;
  } finally {
    lock.release();
  }
}
