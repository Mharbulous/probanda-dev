// Adapter for the /matter-data migrate operation (matter_data__migrate).
//
// Shells out to host Python, importing migrate_engine.py from the skills tree
// (resolved lazily -- see repo-root.ts) rather than embedding it:
// the migration chain, the schema-guard bypass, and the reference SQL are all
// matter-data gatekept material and must stay inside the /matter-data skill per the
// root CLAUDE.md's database-encapsulation rule. Only this thin driver --
// plumbing, no SQL -- is embedded as a string.
//
// DELIBERATELY SEPARATE FROM case/backend.ts. backend.ts serves query/execute
// and carries its own pointer resolver with NO migrate_only parameter; the
// guard bypass lives only in migrate_engine.py, in this separate spawn, as a
// hardcoded literal never derived from tool input. Do not "simplify" backend.ts
// into importing resolve_paths -- that would put the bypass one keyword
// argument away from the read path.
//
// PYTHONIOENCODING=utf-8 on every spawn: host Python's stdout otherwise defaults
// to the Windows locale encoding, and a migration refusal can quote arbitrary
// pleading text.

import { join } from "node:path";

import { type DriverResponse, MIGRATE_DRIVER, pushStaleLockWarning, throwDriverRefusal } from "../migrate-driver.js";
import { pythonDriverFile } from "../python-driver.js";
import { runPythonDriver } from "../python-spawn.js";
import { pythonTimeoutMs, WRITE_TIMEOUT_MS } from "../python-timeout.js";
import { caseDataMigrateScriptsDir } from "../repo-root.js";
import { acquireCaseLock, withExclusive, type CaseLock } from "./case-lock.js";

function driverFile(): string {
  return pythonDriverFile("case-migrate-driver", MIGRATE_DRIVER);
}

export type MigrateMode = "plan" | "apply" | "restore" | "backups";

export interface MigrateOptions {
  planToken?: string;
  userConfirmation?: string;
  backupId?: string;
}

export async function caseDataMigrate(
  matterRoot: string,
  mode: MigrateMode,
  opts: MigrateOptions = {},
  env: NodeJS.ProcessEnv = process.env
): Promise<Record<string, unknown>> {
  const work = (lock: CaseLock) => {
    const result = runDriver(matterRoot, mode, opts, env);
    if (lock.brokeStale) pushStaleLockWarning(result, "matter-data", "matter", "its holder died, or it was >5 min old");
    return result;
  };
  // A change to the whole matter shuts out new runs and file claims; a plan or a listing changes nothing.
  if (mode === "apply" || mode === "restore") return withExclusive(matterRoot, env, work);
  const lock = await acquireCaseLock(matterRoot, env);
  try {
    return work(lock);
  } finally {
    lock.release();
  }
}

function runDriver(
  matterRoot: string,
  mode: MigrateMode,
  opts: MigrateOptions,
  env: NodeJS.ProcessEnv
): Record<string, unknown> {
  const scriptsDir = caseDataMigrateScriptsDir(env);
  const payload = JSON.stringify({
    mode,
    matter_root: matterRoot,
    plan_token: opts.planToken,
    user_confirmation: opts.userConfirmation,
    backup_id: opts.backupId,
  });
  // Every mode shares the migrate budget (issue #612). The engine marks an apply in flight
  // before it replaces the databases, so a kill from then on is caught by its own guard.
  const parsed = runPythonDriver({
    label: "matter-data migrate driver",
    driver: driverFile(),
    payload,
    env,
    timeoutMs: pythonTimeoutMs(env, WRITE_TIMEOUT_MS, "COCLERK_CASE_PYTHON_TIMEOUT_MS"),
    extraEnv: { PYTHONPATH: scriptsDir },
    timeoutAdvice:
      `If an apply had begun replacing the databases, the next migrate refuses with ` +
      `apply_interrupted until it is recovered with mode 'restore'.`,
  }) as DriverResponse;
  if (!parsed.ok) throwDriverRefusal(parsed, "matter-data migrate refused");
  return parsed.result ?? {};
}
