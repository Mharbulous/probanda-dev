// Adapter for the /timecamping-data migrate operation (timecamping_data__migrate).
//
// Shells out to host Python, importing migrate_engine.py from the skills tree
// (resolved lazily via ../repo-root.js's timecampingDataMigrateScriptsDir)
// rather than embedding it: the migration chain and the schema SQL are
// /timecamping-data gatekept material and stay inside that skill, per the
// root CLAUDE.md's database-encapsulation rule. Only this thin driver --
// plumbing, no SQL -- is embedded as a string, mirroring
// plugins/litigation/mcp/src/submission/migrate.ts and
// plugins/litigation/mcp/src/case/migrate.ts.
//
// DELIBERATELY A SEPARATE SPAWN FROM timecamping/backend.ts. backend.ts serves
// query/execute against an already-migrated database and has no schema-guard
// bypass of any kind; this is the only tool that may create or upgrade the
// timecamping database's schema. Do not fold this into backend.ts.
//
// The tool itself takes no db_path -- the path is resolved server-side
// (resolveTimecampingDbPath, a single fixed per-practitioner file) -- but the
// driver payload to migrate_engine.run still needs {"db_path": str}, so this
// adapter resolves the path and threads it through.
//
// migrate_engine.py owes this driver one function and one constant:
//   run(request: {"db_path": str}) -> dict
//   TARGET_SCHEMA_VERSION: int
// raising MigrateError(message, code=None, details=None) on a refusal.
// Before applying any hop to a pre-existing database the engine copies the
// db file aside (timestamped .bak-*, next to the db; a fresh create backs
// up nothing) -- same KISS copy-aside-only backup story as drafting-data's
// engine (no matter-data-style plan/apply/restore ceremony; restore is a
// by-hand file copy).
//
// PYTHONIOENCODING=utf-8 on every spawn, for the reason documented in
// case/migrate.ts: host Python's stdout otherwise defaults to the Windows
// locale encoding, and a migration refusal can quote arbitrary text.

import { join } from "node:path";

import { pruneBackups, timestampedBackups } from "../migrate-backups.js";
import { type DriverResponse, MIGRATE_DRIVER, pushStaleLockWarning, throwDriverRefusal } from "../migrate-driver.js";
import { pythonDriverFile } from "../python-driver.js";
import { runPythonDriver } from "../python-spawn.js";
import { pythonTimeoutMs, WRITE_TIMEOUT_MS } from "../python-timeout.js";
import { timecampingDataMigrateScriptsDir } from "../repo-root.js";
import { resolveTimecampingDbPath } from "./backend.js";
import { acquireDataLock } from "./lock.js";

function driverFile(name: string, source: string): string {
  return pythonDriverFile(`timecamping-${name}-driver`, source);
}

export async function timecampingDataMigrate(
  env: NodeJS.ProcessEnv = process.env
): Promise<Record<string, unknown>> {
  const dbPath = resolveTimecampingDbPath(env);
  const lock = await acquireDataLock(dbPath, env);
  try {
    const backupsBefore = timestampedBackups(dbPath);
    const result = runDriver("migrate", driverFile("migrate", MIGRATE_DRIVER), JSON.stringify({ db_path: dbPath }), env);
    if (lock.brokeStale) pushStaleLockWarning(result, "timecamping-data", "database");
    // After a successful migrate only the copy taken before its first hop is kept (../migrate-backups.ts).
    const pruneWarnings = pruneBackups(dbPath, backupsBefore);
    if (pruneWarnings.length > 0) result.warnings = [...(Array.isArray(result.warnings) ? (result.warnings as string[]) : []), ...pruneWarnings];
    return result;
  } finally {
    lock.release();
  }
}

function runDriver(
  label: string,
  driver: string,
  payload: string,
  env: NodeJS.ProcessEnv
): Record<string, unknown> {
  const scriptsDir = timecampingDataMigrateScriptsDir(env);
  const parsed = runPythonDriver({
    label: `timecamping-data ${label} driver`,
    driver,
    payload,
    env,
    timeoutMs: pythonTimeoutMs(env, WRITE_TIMEOUT_MS, "COCLERK_TIMECAMPING_PYTHON_TIMEOUT_MS"),
    extraEnv: { PYTHONPATH: scriptsDir },
    // Hops apply one at a time (issue #612), so a kill can stop between them.
    timeoutAdvice:
      `It may have stopped between hops. Before migrating again, check whether the database is at ` +
      `the target schema version; if it is not, copy back the timecamping.db.bak-* this run wrote ` +
      `(stamped at this run's start -- an older one would discard every write made since it). A fresh ` +
      `create has no backup; delete the partial database instead.`,
  }) as DriverResponse;
  if (!parsed.ok) throwDriverRefusal(parsed, "timecamping-data migrate refused");
  return parsed.result ?? {};
}
