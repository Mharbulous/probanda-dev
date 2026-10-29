// Local matter-data backend (permission-fatigue conversion, handover 123B).
//
// Flips `/matter-data` database I/O from in-VM Bash/Python heredocs to a
// host-side MCP process, reached through the host Python `sqlite3` module (the
// ratified CLAUDE.md exception: shelling out to host Python keeps the Node >=20
// pin and adds no node:sqlite dependency or build step). Mirrors the B4
// practice-data pattern (../practice/backend.ts) but is intentionally NOT an
// entity/ORM surface: per plan D2, the two tools here (`matter_data__query`,
// `matter_data__execute`) are generic connection-discipline primitives. All SQL
// and schema knowledge stays inside the /matter-data skill's operation files —
// this backend never embeds a query, a table name, or a column name.
//
// Ported here, host-side, per plan D3/D4 (single code path, no in-VM fallback):
//   - shared/conventions.md §2.3 pointer resolution (schema_version bumped to 5:
//     the pointer now carries a durable `matter_root`, the absolute host path of
//     the matter folder, since a Cowork VM only ever sees a sandbox-mounted path
//     for it -- see plan D3). A pre-v5 pointer hard-fails "re-run initialize".
//   - references/scripts/fuse_safe_io.py staging/ATTACH/DELETE-journal discipline.
//   - references/scripts/dump.py evidence.sql regeneration (invariant I4).
//
// Invariants preserved (shared/conventions.md, matter-data/references/design-decisions.md #12):
//   I1 three-file firewall (attach, never merge) -- I2 temp-copy staging, DELETE
//   journal, WAL forbidden -- I3 TEMP triggers loaded per-connection on every
//   execute, from the matter-data skill's references/triggers.sql, which this
//   backend reads itself install-first, as migrate reads its reference SQL
//   (design-decisions.md #52; the backend embeds no copy) --
//   I4 dump after every mutation -- I5 one BEGIN...COMMIT per execute --
//   I6 schema-version guard.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { DataServerError } from "../errors.js";
import { pythonDriverFile } from "../python-driver.js";
import { runPythonDriver } from "../python-spawn.js";
import { EXECUTE_TIMEOUT_MS, pythonTimeoutMs, READ_TIMEOUT_MS } from "../python-timeout.js";
import { resolveShippedRoot } from "../repo-root.js";
import { acquireCaseLock } from "./case-lock.js";
import CASE_DATA_RESOLVER from "./case-data-resolver.py.js";

/** The prefix of the sidecar folder execute commits through; one left behind is a half-commit (#612). */
export const HALF_COMMIT_PREFIX = ".coclerk_execute_";

// The resolver itself comes first: the matter-data skill's bypass-free case_data_resolver.py,
// pasted in at build time (scripts/resolver.mjs), so this helper imports nothing at run time.
const PY_HELPER = CASE_DATA_RESOLVER + String.raw`
import json, os, re, shutil, sqlite3, sys, tempfile

LEGACY_ARTIFACTS_DIR = '9. AI'
EXPECTED_USER_VERSION = 90
EXPECTED_SCHEMA_VERSION = 5
POINTER_NAMES = ('probanda.json', 'coclerk.json')
DBS = ('main', 'law', 'privileged')
DUMP_HEADER = "-- Case Data evidence dump -- schema v9.0"


def pointer_case_data_dir(matter_root, case_data_dir):
    """The pointer's case_data_dir value: relative to the matter root when the folder is
    inside it, absolute otherwise, as evidence_sql_path is stored."""
    try:
        rel = os.path.relpath(case_data_dir, matter_root)
    except ValueError:
        return case_data_dir
    if rel in (os.curdir, os.pardir) or rel.startswith(os.pardir + os.sep):
        return case_data_dir
    return rel


def default_evidence_sql(matter_root, case_data_dir):
    """The text dump beside the databases, relative to the matter root so the pointer survives
    a change of user profile; absolute when the two are on different drives."""
    path = norm_join(case_data_dir, 'evidence.sql')
    try:
        return os.path.relpath(path, matter_root)
    except ValueError:
        return path


def read_user_version(sqlite_path):
    tmp = tempfile.mkdtemp(prefix=f'coclerk_guard_{os.environ["COCLERK_STAGING_TAG"]}_')
    probe = os.path.join(tmp, os.path.basename(sqlite_path))
    try:
        shutil.copy2(sqlite_path, probe)
        con = sqlite3.connect(probe)
        try:
            return con.execute("PRAGMA user_version").fetchone()[0]
        finally:
            con.close()
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def read_pointer(matter_root):
    # probanda.json first; coclerk.json is the legacy name, kept updated on every write so an
    # older copy of the plugin still finds the matter (spec 2026-10-16, Option 1).
    root_ptrs = [norm_join(matter_root, name) for name in POINTER_NAMES]
    legacy_ptrs = [norm_join(matter_root, LEGACY_ARTIFACTS_DIR, name) for name in POINTER_NAMES]
    pointer_path = next((p for p in root_ptrs + legacy_ptrs if os.path.exists(p)), None)
    if pointer_path is None:
        raise SystemExit("probanda.json not found; initialize the matter first.")

    with open(pointer_path, 'rb') as fh:
        raw = fh.read()
    pointer = json.loads(raw.replace(b'\x00', b'').decode('utf-8'))

    schema_version = pointer.get('schema_version')
    if schema_version != EXPECTED_SCHEMA_VERSION:
        raise SystemExit(
            "stale pointer -- re-run initialize "
            f"(the pointer is schema_version {schema_version!r}, expected {EXPECTED_SCHEMA_VERSION})")
    return root_ptrs, pointer_path in legacy_ptrs, pointer_path, pointer


def locate_case_data_dir(matter_root):
    """The matter-data folder resolve_pointer chooses, found without writing: no pointer heal, no
    legacy migration, no database version guard. A legacy (9. AI) pointer means no execute has
    run since, so skipping its migration cannot hide an execute sidecar."""
    matter_root = os.path.normpath(matter_root)
    pointer = read_pointer(matter_root)[3]
    case_data_dir, _ = resolve_case_data_dir(
        matter_root, pointer.get('case_data_dir'), case_data_root(matter_root),
        norm_join(matter_root, LEGACY_ARTIFACTS_DIR))
    return {'case_data_dir': case_data_dir}


def resolve_pointer(matter_root):
    matter_root = os.path.normpath(matter_root)
    root_ptrs, from_legacy, pointer_path, pointer = read_pointer(matter_root)

    root = case_data_root(matter_root)
    legacy_dir = norm_join(matter_root, LEGACY_ARTIFACTS_DIR)
    stored = pointer.get('case_data_dir')

    def is_legacy_value(p):
        if not p:
            return False
        resolved = os.path.normpath(p) if is_absolute(p) else norm_join(matter_root, p)
        return resolved == legacy_dir

    case_data_dir, rejected_nominee = resolve_case_data_dir(
        matter_root, stored, root, legacy_dir)

    # Legacy migration: 9. AI -> the matter's 0. CASE DATA folder.
    if is_legacy_value(pointer.get('case_data_dir')) or from_legacy:
        os.makedirs(case_data_dir, exist_ok=True)
        if os.path.isdir(legacy_dir):
            for fn in ('main.sqlite', 'law.sqlite', 'privileged.sqlite'):
                src = norm_join(legacy_dir, fn)
                dst = norm_join(case_data_dir, fn)
                if os.path.exists(src) and not os.path.exists(dst):
                    shutil.move(src, dst)
        mid, _ = identity_from_metadata(norm_join(case_data_dir, 'main.sqlite'))
        if mid:
            preferred = matter_case_data_dir(matter_root)
            if preferred != case_data_dir:
                os.makedirs(os.path.dirname(preferred), exist_ok=True)
                if not os.path.exists(preferred):
                    shutil.move(case_data_dir, preferred)
                    case_data_dir = preferred

    normalized = {
        'schema_version': EXPECTED_SCHEMA_VERSION,
        'matter_root': matter_root,
        'case_data_dir': pointer_case_data_dir(matter_root, case_data_dir),
        'evidence_sql_path': pointer.get(
            'evidence_sql_path', default_evidence_sql(matter_root, case_data_dir)),
    }
    # Migrate-on-write: probanda.json, and coclerk.json with the same content so an older
    # copy of the plugin still finds the matter.
    for root_ptr in root_ptrs:
        with open(root_ptr, 'w', encoding='utf-8') as fh:
            json.dump(normalized, fh, indent=2)

    main_sqlite = norm_join(case_data_dir, 'main.sqlite')

    if os.path.exists(main_sqlite):
        uv = read_user_version(main_sqlite)
        version = 62 if uv == 0 else uv
        if version < EXPECTED_USER_VERSION:
            major, minor = version // 10, version % 10
            raise SystemExit(
                f"Database schema is at v{major}.{minor} but this skill "
                "requires v9.0. Run the migrate operation: call "
                "matter_data__migrate with mode 'plan' first, then 'apply' with "
                "the plan_token it returns. (Not rebuild -- rebuild replays a "
                "current dump and rejects an out-of-date one.)")

    evidence_sql = norm_join(matter_root, normalized['evidence_sql_path'])
    warnings = []
    if rejected_nominee:
        warnings.append(
            "Stored case_data_dir nominee did not contain main.sqlite; "
            f"selected live-derived location {case_data_dir} and healed probanda.json.")
    if os.path.exists(evidence_sql):
        try:
            with open(evidence_sql, 'r', encoding='utf-8', errors='replace') as fh:
                first = fh.readline()
            m = re.search(r'schema v(\d+)\.(\d+)', first)
            if not m or (int(m.group(1)) * 10 + int(m.group(2))) < EXPECTED_USER_VERSION:
                warnings.append(
                    "evidence.sql is missing a v9.0 schema header or predates "
                    "v9.0. Regenerate it via maintain; the rebuild-only "
                    "transition through v7.6 is the sole exception.")
        except Exception:
            pass

    return {
        'case_data_dir': case_data_dir,
        'main_sqlite': main_sqlite,
        'law_sqlite': norm_join(case_data_dir, 'law.sqlite'),
        'privileged_sqlite': norm_join(case_data_dir, 'privileged.sqlite'),
        'evidence_sql': evidence_sql,
        'warning': " ".join(warnings) or None,
    }


def copy_fsync(src, dst):
    """copy2 then flush to disk, so a later rename cannot expose a torn file."""
    shutil.copy2(src, dst)
    with open(dst, 'rb+') as fh:
        os.fsync(fh.fileno())
    return dst


def stage_copies(resolved, tmpdir_):
    copies = {}
    for db in DBS:
        native = resolved[f'{db}_sqlite']
        dst = os.path.join(tmpdir_, f'{db}.sqlite')
        if os.path.exists(native):
            shutil.copy2(native, dst)
        copies[db] = dst
    return copies


def open_attached(copies, triggers_sql):
    con = sqlite3.connect(copies['main'])
    con.execute("ATTACH DATABASE '%s' AS law" % copies['law'].replace("'", "''"))
    con.execute("ATTACH DATABASE '%s' AS privileged" % copies['privileged'].replace("'", "''"))
    if triggers_sql:
        con.executescript(triggers_sql)
    con.execute("PRAGMA journal_mode = DELETE")
    con.execute("PRAGMA foreign_keys = ON")
    mode = con.execute("PRAGMA journal_mode").fetchone()[0]
    if str(mode).lower() != 'delete':
        raise SystemExit(f"Refusing to operate: journal_mode is '{mode}', expected 'delete'.")
    return con


def dump_db(path):
    c = sqlite3.connect(path)
    try:
        return "\n".join(c.iterdump())
    finally:
        c.close()


def write_dump(resolved, copies):
    lines = [DUMP_HEADER]
    for db in DBS:
        body = dump_db(copies[db])
        lines.append(f"-- ===== v6 BEGIN {db} =====")
        lines.append(body)
        lines.append(f"-- ===== v6 END {db} =====")
    text = "\n".join(lines) + "\n"
    path = resolved['evidence_sql']
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + '.tmp'
    with open(tmp, 'w', encoding='utf-8', newline='\n') as fh:
        fh.write(text)
    os.replace(tmp, path)


# Leading whitespace, '--' line comments and '/* */' block comments are
# skipped before the keyword check, so a query copied verbatim from a skill
# file that opens with a comment is not refused. Each comment matches only up
# to its own terminator, the way SQLite reads it, so a comment cannot hide a
# write. One character of whitespace per step keeps the match linear.
READ_ONLY_RE = r'(?is)^(?:\s|--[^\n]*(?:\n|$)|/\*(?:(?!\*/).)*\*/)*(select|with|pragma)\b'


def do_query(req, resolved):
    sql = req['sql'].strip()
    if not re.match(READ_ONLY_RE, sql):
        raise SystemExit("matter_data__query only accepts SELECT/WITH/PRAGMA statements; use matter_data__execute for writes.")
    if not os.path.exists(resolved['main_sqlite']):
        raise SystemExit(
            "No case database found: resolved main.sqlite is missing at "
            f"{resolved['main_sqlite']}. Re-run matter-data initialize for a new matter "
            "or restore the database at the live-derived location.")
    tmp = tempfile.mkdtemp(prefix=f'coclerk_case_query_{os.environ["COCLERK_STAGING_TAG"]}_')
    try:
        copies = stage_copies(resolved, tmp)
        con = open_attached(copies, '')
        try:
            cur = con.execute(sql, req.get('params') or [])
            cols = [d[0] for d in cur.description] if cur.description else []
            rows = [dict(zip(cols, r)) for r in cur.fetchall()]
        finally:
            con.close()
        return {"rows": rows, "warning": resolved.get('warning')}
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def databases_are_empty(copies):
    for db in DBS:
        con = sqlite3.connect(copies[db])
        try:
            if con.execute("SELECT count(*) FROM sqlite_master").fetchone()[0]:
                return False
        finally:
            con.close()
    return True


def atomic_replace_set(resolved, copies):
    """Commit the mutated binaries to native storage as close to atomically as
    three separate files allow: stage every finished binary and a rollback copy
    of every existing native in a same-volume sidecar, flush both to disk, then
    replace the natives by rename. A rename that fails part-way is undone, so a
    failed commit-to-disk never leaves some databases carrying the new state and
    the rest the old -- the cross-database inconsistency I5 exists to prevent.

    Ported from migrate_engine.atomic_replace_set rather than imported:
    matter_data__execute runs in a separate spawn whose Python is this
    self-contained helper with no PYTHONPATH imports, and that process
    separation is what contains the schema-guard bypass (matter-data/references/design-decisions.md
    #27). A shared import would collapse it.

    os.replace is atomic only within a volume and COCLERK_CASE_DATA_ROOT can
    point at another drive or a UNC path, so the sidecar is created INSIDE
    case_data_dir to guarantee same-volume renames by construction. Every
    connection is closed before anything reaches the sidecar, so no live handle
    is ever held on synced storage.
    """
    natives = {db: resolved[f'{db}_sqlite'] for db in DBS}
    for dst in natives.values():
        os.makedirs(os.path.dirname(dst), exist_ok=True)
    sidecar = tempfile.mkdtemp(prefix='${HALF_COMMIT_PREFIX}', dir=resolved['case_data_dir'])
    try:
        rollback_dir = os.path.join(sidecar, 'rollback')
        os.makedirs(rollback_dir)
        staged, rollback = {}, {}
        for db in DBS:
            staged[db] = copy_fsync(copies[db], os.path.join(sidecar, f'{db}.sqlite'))
            # The rollback source is the native, not the staged copy -- the
            # transaction mutated the staged copies in place. Reading the native
            # now is safe because execute holds the cross-process lock across
            # this whole window, so it is unchanged since staging. A native that
            # never existed (the bootstrap path) is undone by removal instead.
            rollback[db] = (
                copy_fsync(natives[db], os.path.join(rollback_dir, f'{db}.sqlite'))
                if os.path.exists(natives[db]) else None)

        replaced = []
        try:
            for db in DBS:
                os.replace(staged[db], natives[db])
                replaced.append(db)
        except Exception as exc:
            failed = DBS[len(replaced)]
            for i, db in enumerate(replaced):
                try:
                    if rollback[db] is None:
                        os.remove(natives[db])
                    else:
                        os.replace(rollback[db], natives[db])
                except Exception as rollback_exc:
                    # Databases before index i were already undone.
                    raise SystemExit(
                        "Replacing %s.sqlite failed (%s) AND undoing %s.sqlite failed "
                        "(%s). The case databases are now a mix of new and previous "
                        "state: %s carry the new state, the rest the previous. Do not "
                        "write again. Recover from evidence.sql (it still holds the last "
                        "committed state: maintain rebuild), or from the synced folder's "
                        "version history, or from a matter_data__migrate backup if one exists."
                        % (failed, exc, db, rollback_exc, ", ".join(replaced[i:])))
            raise SystemExit(
                "Replacing %s.sqlite in native storage failed (%s); every database was "
                "rolled back and the previous set is intact." % (failed, exc))
    finally:
        shutil.rmtree(sidecar, ignore_errors=True)


def run_one(con, statement, params):
    cur = con.execute(statement['sql'], params)
    cols = [d[0] for d in cur.description] if cur.description else []
    rows = [dict(zip(cols, r)) for r in cur.fetchall()] if cols else []
    return {"rowcount": cur.rowcount, "rows": rows}


def run_group(con, n, group, params, results, failed):
    """One statement group (ingest orchestrator spec 2.1) under its own savepoint: an exception or a
    'refuse' row inside it rolls back only the group, records {ref, reason}, and the call goes on.
    Each statement still gets a result, zero for a rolled-back group's."""
    merged = {**params, **(group.get('params') or {})}
    own = []
    con.execute("SAVEPOINT g_%d" % n)
    try:
        for statement in group['statements']:
            result = run_one(con, statement, merged)
            own.append(result)
            if statement.get('refuse') and result['rows']:
                raise LookupError(str(next(iter(result['rows'][0].values()))))
        con.execute("RELEASE g_%d" % n)
    except Exception as exc:
        con.execute("ROLLBACK TO g_%d" % n)
        con.execute("RELEASE g_%d" % n)
        failed.append({"ref": group['ref'], "reason": str(exc)})
        own = []
    results.extend(own + [{"rowcount": 0, "rows": []}] * (len(group['statements']) - len(own)))


def run_statements(con, req):
    """The other way to supply an execute's writes: a list of statements, each run with the same
    named params, in one transaction. A statement marked 'refuse' is a guard, and any row it
    returns is a reason to write nothing: the transaction rolls back before the next write and
    the reasons are returned. Otherwise each statement's rowcount and rows are returned. An entry
    {ref, params?, statements} is a statement group (run_group); a failure outside any group keeps
    this rule and rolls back everything."""
    con.isolation_level = None
    params = req.get('params') or {}
    results, refused, failed = [], [], []
    con.execute("BEGIN")
    try:
        for n, statement in enumerate(req['statements']):
            if refused and not statement.get('refuse'):
                break
            if 'statements' in statement:
                run_group(con, n, statement, params, results, failed)
                continue
            result = run_one(con, statement, params)
            if statement.get('refuse'):
                refused.extend(next(iter(r.values())) for r in result['rows'])
            results.append(result)
        con.execute("ROLLBACK" if refused else "COMMIT")
    except Exception:
        if con.in_transaction:
            con.execute("ROLLBACK")
        raise
    return {"refused": refused} if refused else {"results": results, "failed": failed}


def do_execute(req, resolved):
    triggers_sql = req.get('triggers_sql')
    if not triggers_sql or not triggers_sql.strip():
        raise SystemExit("matter_data__execute found an empty triggers.sql -- a write session must not proceed without the cross-database FK layer loaded.")
    tmp = tempfile.mkdtemp(prefix=f'coclerk_case_execute_{os.environ["COCLERK_STAGING_TAG"]}_')
    try:
        copies = stage_copies(resolved, tmp)
        # Bootstrap (initialize) inverts the trigger order, and only then. Every
        # table the FK triggers reference is created by this very script, so
        # loading them first is unsatisfiable ("no such table: criteria_facts").
        # They load after the commit instead, where they still prove the new
        # schema carries every table the FK layer guards -- I3 is verified, not
        # skipped, and a failure raises before any copy-back.
        bootstrap = databases_are_empty(copies)
        con = open_attached(copies, '' if bootstrap else triggers_sql)
        outcome = {}
        try:
            if 'statements' in req:
                outcome = run_statements(con, req)
            else:
                try:
                    con.executescript("BEGIN;\n" + req['sql_script'] + "\n;\nCOMMIT;")
                except Exception:
                    if con.in_transaction:
                        con.execute("ROLLBACK")
                    raise
            if bootstrap:
                con.executescript(triggers_sql)
        finally:
            con.close()
        if 'refused' in outcome:
            return {"ok": False, "warning": resolved.get('warning'), **outcome}
        # Commit the mutated binaries to native storage only after a successful
        # commit and a closed connection (I2), and all-or-nothing (I5).
        atomic_replace_set(resolved, copies)
        write_dump(resolved, copies)
        return {"ok": True, "evidence_sql": resolved['evidence_sql'], "warning": resolved.get('warning'), **outcome}
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def main():
    req = json.load(sys.stdin)
    op = req['op']
    if op == 'locate':
        return locate_case_data_dir(req['matter_root'])
    resolved = resolve_pointer(req['matter_root'])
    if op == 'query':
        return do_query(req, resolved)
    if op == 'execute':
        return do_execute(req, resolved)
    raise SystemExit(f"unknown op: {op}")


print(json.dumps(main()))
`.trim();

function helperFile(): string {
  return pythonDriverFile("case-sqlite", PY_HELPER);
}

interface CaseQueryRequest {
  op: "query";
  matter_root: string;
  sql: string;
  params?: unknown[];
}

interface CaseLocateRequest {
  op: "locate";
  matter_root: string;
}

/** One statement of a statement-list execute. `refuse` marks a guard: a row it returns stops the write. */
export interface CaseStatement {
  sql: string;
  refuse?: boolean;
}

/** A statement group (ingest orchestrator spec §2.1): its own savepoint, so its failure rolls back
 *  only the group and is reported under `ref`. Its `params` are added to the call's own. */
export interface CaseStatementGroup {
  ref: string;
  params?: Record<string, unknown>;
  statements: CaseStatement[];
}

/** An execute's writes: one script, or a list of statements sharing one set of named params. */
type CaseExecuteWork =
  | { sql_script: string }
  | { statements: Array<CaseStatement | CaseStatementGroup>; params: Record<string, unknown> };

type CaseExecuteRequest = { op: "execute"; matter_root: string; triggers_sql: string } & CaseExecuteWork;

export type CaseStatementsResult =
  | {
      ok: true;
      evidence_sql: string;
      warning?: string | null;
      /** One per statement, a group's statements in place; a rolled-back group's read zero. */
      results: Array<{ rowcount: number; rows: Record<string, unknown>[] }>;
      /** Each group rolled back, with the exception or refusal that stopped it. */
      failed: Array<{ ref: string; reason: string }>;
    }
  /** A guard returned rows: nothing was written, and `refused` holds each row's first value. */
  | { ok: false; refused: unknown[]; warning?: string | null };

// A kill skips atomic_replace_set's undo and its sidecar cleanup, so a kill landing between
// its renames leaves a mixed set and the sidecar behind (issue #612). The message says so.
const EXECUTE_TIMEOUT_ADVICE =
  "The write may already have committed: verify before retrying (/matter-data shared/conventions.md §2.3). " +
  `If a ${HALF_COMMIT_PREFIX}* folder remains in the matter's matter-data folder, the kill landed inside the ` +
  "commit-to-disk step and the databases may be a mix of new and previous state: do not write again " +
  "until reconciled. Any complete copy in its rollback subfolder is a previous database (one that did " +
  "not exist before has none); delete the folder once reconciled. evidence.sql may not yet reflect a " +
  "committed write.";

function runHelper(request: CaseQueryRequest | CaseLocateRequest | CaseExecuteRequest, env: NodeJS.ProcessEnv): Record<string, unknown> {
  const execute = request.op === "execute";
  return runPythonDriver({
    label: "matter-data sqlite helper",
    driver: helperFile(),
    payload: JSON.stringify(request),
    env,
    timeoutMs: pythonTimeoutMs(env, execute ? EXECUTE_TIMEOUT_MS : READ_TIMEOUT_MS, "COCLERK_CASE_PYTHON_TIMEOUT_MS"),
    timeoutAdvice: execute ? EXECUTE_TIMEOUT_ADVICE : undefined,
  }) as Record<string, unknown>;
}

export function caseDataQuery(
  matterRoot: string,
  sql: string,
  params?: unknown[]
): { rows: Record<string, unknown>[]; warning?: string | null } {
  const result = runHelper({ op: "query", matter_root: matterRoot, sql, params }, process.env);
  return result as { rows: Record<string, unknown>[]; warning?: string | null };
}

/** The matter's matter-data folder as query and execute resolve it, found without writing
 * anything (no pointer heal, no legacy migration). It may not exist. */
export function caseDataFolder(matterRoot: string, env: NodeJS.ProcessEnv = process.env): string {
  return (runHelper({ op: "locate", matter_root: matterRoot }, env) as { case_data_dir: string }).case_data_dir;
}

/** The cross-database trigger layer (#12), read fresh for every write from the matter-data
 * skill tree this server ships with, install-first (design-decisions.md #52). A missing file
 * fails here, before the lock or any staging; an empty one fails in do_execute, also before. */
function caseDataTriggersSql(env: NodeJS.ProcessEnv): string {
  const shipped = resolveShippedRoot("matter-data/references/triggers.sql", env, {
    subject: "the matter-data trigger layer",
    plugin: "lawyer",
  });
  const path = join(shipped.root, "matter-data", "references", "triggers.sql");
  if (!existsSync(path)) {
    throw new DataServerError(
      `matter_data__execute cannot load the cross-database trigger layer: ${path} not found. Nothing was written.`,
      "skills_root_missing"
    );
  }
  return readFileSync(path, "utf-8");
}

/**
 * Writes take the cross-process case lock (case-lock.ts) for the whole
 * stage → mutate → copy-back window. Without it two sessions stage from the
 * same starting binaries and the second copy-back silently discards the first
 * session's writes. `caseDataQuery` stays lock-free on purpose: it is the hot
 * path and never copies anything back.
 */
export async function caseDataExecute(
  matterRoot: string,
  sqlScript: string,
  env: NodeJS.ProcessEnv = process.env
): Promise<{ ok: true; evidence_sql: string; warning?: string | null }> {
  return await executeUnderLock(matterRoot, { sql_script: sqlScript }, env) as { ok: true; evidence_sql: string; warning?: string | null };
}

/**
 * `caseDataExecute` for a list of statements that share one set of named params: the same lock,
 * staging, trigger layer, single transaction, commit to disk and evidence.sql dump. The SQL comes
 * from a script in the /matter-data skill tree, never from this server. A refusal writes nothing.
 */
export async function caseDataExecuteStatements(
  matterRoot: string,
  statements: Array<CaseStatement | CaseStatementGroup>,
  params: Record<string, unknown>,
  env: NodeJS.ProcessEnv = process.env
): Promise<CaseStatementsResult> {
  return await executeUnderLock(matterRoot, { statements, params }, env) as CaseStatementsResult;
}

async function executeUnderLock(
  matterRoot: string,
  work: CaseExecuteWork,
  env: NodeJS.ProcessEnv
): Promise<{ warning?: string | null }> {
  const triggersSql = caseDataTriggersSql(env);
  const lock = await acquireCaseLock(matterRoot, env);
  try {
    const result = runHelper({
      op: "execute",
      matter_root: matterRoot,
      triggers_sql: triggersSql,
      ...work,
    }, env) as { warning?: string | null };
    if (lock.brokeStale) {
      // An execute never legitimately holds the lock for 15 minutes, so a stale
      // one almost certainly means a crashed migrate -- say so rather than
      // writing over whatever it left behind in silence.
      result.warning = [
        "broke a stale matter-data write lock (>15 min old) before writing; if another " +
          "session is still writing to or migrating this matter, stop and reconcile",
        result.warning,
      ].filter(Boolean).join(" -- ");
    }
    return result;
  } finally {
    lock.release();
  }
}
