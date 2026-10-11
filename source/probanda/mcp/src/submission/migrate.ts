// Adapter for the /drafting-data migrate operation (drafting_data__migrate).
//
// Shells out to host Python, importing migrate_engine.py from the skills tree
// (resolved lazily -- see ../repo-root.ts) rather than embedding it: the
// migration chain and the schema SQL are /drafting-data gatekept material
// and stay inside that skill (build ticket #295), per the root CLAUDE.md's
// database-encapsulation rule. Only this thin driver -- plumbing, no SQL -- is
// embedded as a string, mirroring plugins/litigation/mcp/src/case/migrate.ts
// and plugins/litigation/mcp/src/timecamping/migrate.ts.
//
// DELIBERATELY A SEPARATE SPAWN FROM ./backend.ts. backend.ts serves
// query/execute against an already-migrated database and has no schema-guard
// bypass of any kind; this is the only tool that may create or upgrade a
// database's schema. Do not fold this into backend.ts.
//
// #295's migrate_engine.py owes this driver one function and one constant:
//   run(request: {"db_path": str, "target_version"?: int}) -> dict
//   TARGET_SCHEMA_VERSION: int   (read by currentSchemaVersion(), issue #351)
// raising MigrateError(message, code=None, details=None) on a refusal.
//
// The hop that drops the submission copy of counsel of record (v42 -> v43, party/counsel SSOT) is
// gated here first, because only the runtime reads case data: while any counsel offer or
// parties_drift row stands it refuses, code counsel_not_reconciled, naming each, before the engine
// runs. A database older than v42 is first migrated to v42, where its parties can be linked and
// the runtime still reads it, so a refusal leaves it there.
//
// Before applying any hop to a pre-existing database the engine copies the
// db file aside (timestamped .bak-*, next to the db; a fresh create backs
// up nothing) -- added by #353 once a prior schema version existed to
// migrate FROM (#307). Case-data's heavier plan/apply/restore/backups
// ceremony stays deliberately unported (KISS): the copy-aside is the whole
// backup story, and restore is a by-hand file copy.
//
// PYTHONIOENCODING=utf-8 on every spawn, for the reason documented in
// case/migrate.ts: host Python's stdout otherwise defaults to the Windows
// locale encoding, and a migration refusal can quote arbitrary text.

import { existsSync, statSync } from "node:fs";
import { join } from "node:path";

import { DataServerError } from "../errors.js";
import { pythonDriverFile } from "../python-driver.js";
import { runPythonDriver } from "../python-spawn.js";
import { submissionDataMigrateScriptsDir } from "../repo-root.js";
import { pythonTimeoutMs, READ_TIMEOUT_MS, submissionDataQuery, WRITE_TIMEOUT_MS } from "./backend.js";
import { acquireDataLock } from "./lock.js";
import { counselOffers, matterPartiesDrift, type CounselOffer, type PartiesDriftRow } from "./parties-drift.js";
import { assertMigrationWithinBundle } from "./schema-ceiling.js";

// Pure plumbing: one JSON request in on stdin, one JSON response out on stdout.
// Contains no SQL, no schema, no migration knowledge.
const MIGRATE_DRIVER = String.raw`
import json, sys


def main():
    request = json.loads(sys.stdin.read())
    from migrate_engine import MigrateError, run
    try:
        sys.stdout.write(json.dumps({"ok": True, "result": run(request)}))
    except MigrateError as exc:
        sys.stdout.write(json.dumps({"ok": False, "error": exc.as_dict()}))
    except BaseException as exc:
        sys.stdout.write(json.dumps({
            "ok": False,
            "error": {
                "code": "internal_error",
                "message": "Unexpected migrate driver failure",
                "details": {"exception": type(exc).__name__, "reason": str(exc)},
            },
        }))


main()
`.trim();

// Read-only companion to the driver above: reports the version the engine
// targets, without opening a database or applying anything. TARGET_SCHEMA_VERSION
// is the SSOT for that number ("the single place this version is stated for the
// Python side" -- migrate_engine.py's own docstring), so asking the engine is
// the only way a caller can tell a stale database from a current one without
// restating the constant here and letting the two drift silently (issue #351).
const VERSION_DRIVER = String.raw`
import json, sys

from migrate_engine import TARGET_SCHEMA_VERSION

sys.stdout.write(json.dumps({"ok": True, "result": {"target_schema_version": TARGET_SCHEMA_VERSION}}))
`.trim();

function driverFile(name: string, source: string): string {
  return pythonDriverFile(`submission-${name}-driver`, source);
}

interface DriverResponse {
  ok: boolean;
  result?: Record<string, unknown>;
  error?: { code?: string; message?: string; details?: Record<string, unknown> };
}

export async function submissionDataMigrate(
  dbPath: string,
  env: NodeJS.ProcessEnv = process.env
): Promise<Record<string, unknown>> {
  // Before the lock and before any spawn (#812): a withheld migration must leave the database
  // file, its recorded version and its backup set exactly as they were. Refusing here is what
  // makes that true -- the engine's copy-aside (#353) happens inside the spawn.
  const target = currentSchemaVersion(env);
  assertMigrationWithinBundle(dbPath, target, env);

  const lock = await acquireDataLock(dbPath, env);
  try {
    const migrate = (targetVersion?: number) =>
      runDriver(
        "migrate",
        driverFile("migrate", MIGRATE_DRIVER),
        JSON.stringify({ db_path: dbPath, ...(targetVersion !== undefined ? { target_version: targetVersion } : {}) }),
        env,
        WRITE_TIMEOUT_MS
      );
    const stored = storedSchemaVersion(dbPath);
    let staged: Record<string, unknown> | undefined;
    if (stored !== null && stored < COUNSEL_COPY_DROPPED && target >= COUNSEL_COPY_DROPPED) {
      // The counsel gate reads parties.case_party_id (v41), and a refused database must stay readable
      // (forms.ts MIN_READABLE_SCHEMA_VERSION, v42), so a database older than v42 is first taken there.
      if (stored < COUNSEL_COPY_DROPPED - 1) staged = migrate(COUNSEL_COPY_DROPPED - 1);
      assertCounselReconciled(dbPath, staged, env);
    }
    const result = migrate();
    if (staged !== undefined) result.applied = [...(staged.applied as unknown[]), ...(result.applied as unknown[])];
    if (lock.brokeStale) {
      const warnings = Array.isArray(result.warnings) ? (result.warnings as string[]) : [];
      warnings.push(
        "broke a stale drafting-data write lock (>15 min old) before running; if another " +
          "session is still writing to or migrating this database, stop and reconcile before continuing"
      );
      result.warnings = warnings;
    }
    return result;
  } finally {
    lock.release();
  }
}

/** The schema hop that drops the submission copy of counsel of record (party/counsel SSOT). */
const COUNSEL_COPY_DROPPED = 43;

/** The database's recorded schema version, or null for a database not created yet. */
function storedSchemaVersion(dbPath: string): number | null {
  if (!existsSync(dbPath)) return null;
  const [meta] = submissionDataQuery(dbPath, "SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name = 'db_meta'").rows as unknown as { n: number }[];
  if (meta.n === 0) return null;
  const [row] = submissionDataQuery(dbPath, "SELECT value FROM db_meta WHERE key = 'schema_version'").rows as unknown as { value: string }[];
  return row === undefined ? null : Number(row.value);
}

function describeOffer(o: CounselOffer): string {
  const who = `${o.name} (${o.role}, proceeding ${o.proceeding_id})`;
  if (o.kind === "offer") {
    return `${who}: ${o.field} held here as ${JSON.stringify(o.held_value)}, case data ${o.case_data_value === null ? "holds none" : `holds ${JSON.stringify(o.case_data_value)}`}`;
  }
  const held = Object.keys(o.held ?? {}).join(", ");
  if (o.kind === "unchecked") return `${who}: holds ${held}, and case data could not be read: ${o.reason}`;
  return `${who}: ${o.kind}, holding ${held}; link it first through the section 0 confirm write`;
}

function describeDrift(r: PartiesDriftRow): string {
  return `${r.name} (${r.role}, proceeding ${r.proceeding_id}): ${r.kind}${r.reason !== undefined ? ` (${r.reason})` : ""}`;
}

/**
 * The runtime gate on the hop that drops the submission copy of counsel of record: refuses, writing
 * nothing more, while any counsel offer or parties_drift row stands, naming each. The engine's own
 * refusal before that hop is the floor beneath it.
 */
function assertCounselReconciled(dbPath: string, staged: Record<string, unknown> | undefined, env: NodeJS.ProcessEnv): void {
  const offers = counselOffers(dbPath, env);
  const drift = matterPartiesDrift(dbPath, env);
  if (offers.length === 0 && drift.rows.length === 0) return;
  throw new DataServerError(
    `Migration of ${dbPath} to schema version ${COUNSEL_COPY_DROPPED} refused: that hop drops the submission copy of counsel ` +
      "of record and the address for service, which case data owns, and it waits until every party is linked and every " +
      `value the copy holds is decided. ${offers.length} counsel offer(s) and ${drift.rows.length} parties_drift row(s) stand. ` +
      (staged !== undefined
        ? `The database was first migrated to schema version ${COUNSEL_COPY_DROPPED - 1}, so its parties can be linked; nothing past it was applied. `
        : "Nothing was written. ") +
      "Decide each with the practitioner (/drafting-data references/filing-checklists.md section 0): link each unlinked or " +
      "not-of-record party through the confirm write, then apply each offer to case data through /case-data's gate, discard " +
      "it here, or hold it, which keeps this database where it is. " +
      (offers.length > 0 ? `Counsel offers: ${offers.map(describeOffer).join("; ")}. ` : "") +
      (drift.rows.length > 0 ? `Drift: ${drift.rows.map(describeDrift).join("; ")}.` : "") +
      (drift.note !== undefined ? ` (${drift.note})` : ""),
    "counsel_not_reconciled"
  );
}

/**
 * The schema version the /drafting-data migration engine currently targets.
 * Read-only -- takes no db_path, acquires no lock, opens no database.
 *
 * Deliberately spawns rather than restating the number in TypeScript (issue
 * #351): a hard-coded copy would go stale on the next schema bump and let a
 * database one version behind come back looking healthy, which is the exact
 * failure this reporting exists to prevent.
 *
 * The answer is reused while migrate_engine.py is unchanged: the spawn cost
 * ~2-3.7 s per call and a bootstrap made one per filing (#580). The key is the
 * file's identity, so a schema bump mid-session is read on the next call, and
 * the timeout, so a caller's budget override still runs the driver.
 */
let versionCache: { key: string; value: number } | undefined;

export function currentSchemaVersion(env: NodeJS.ProcessEnv = process.env): number {
  const scriptsDir = submissionDataMigrateScriptsDir(env);
  const engine = statSync(join(scriptsDir, "migrate_engine.py"));
  const key = [scriptsDir, engine.mtimeMs, engine.size, pythonTimeoutMs(env, READ_TIMEOUT_MS)].join("|");
  if (versionCache?.key === key) return versionCache.value;

  const result = runDriver("schema-version", driverFile("schema-version", VERSION_DRIVER), "", env, READ_TIMEOUT_MS);
  const value = Number(result.target_schema_version);
  if (!Number.isInteger(value)) {
    throw new DataServerError(
      `drafting-data schema-version driver returned no usable target version: ${JSON.stringify(result)}`,
      "migrate_error"
    );
  }
  versionCache = { key, value };
  return value;
}

// Every driver run carries a budget (issue #517, budgets in ./backend.ts). A killed migrate can
// stop between non-atomic hops; its copy-aside backup (#353) is the remedy.
function runDriver(
  label: string,
  driver: string,
  payload: string,
  env: NodeJS.ProcessEnv,
  defaultTimeoutMs: number
): Record<string, unknown> {
  const scriptsDir = submissionDataMigrateScriptsDir(env);
  const parsed = runPythonDriver({
    label: `drafting-data ${label} driver`,
    driver,
    payload,
    env,
    timeoutMs: pythonTimeoutMs(env, defaultTimeoutMs),
    extraEnv: { PYTHONPATH: scriptsDir },
  }) as DriverResponse;
  if (!parsed.ok) {
    const error = parsed.error ?? {};
    const details = error.details && Object.keys(error.details).length
      ? ` [${JSON.stringify(error.details)}]`
      : "";
    throw new DataServerError(
      `${error.message ?? "drafting-data migrate refused"}${details}`,
      error.code ?? "migrate_error"
    );
  }
  return parsed.result ?? {};
}
