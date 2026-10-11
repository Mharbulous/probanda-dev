// Adapter for the /case-data migrate operation (case_data__migrate).
//
// Shells out to host Python, importing migrate_engine.py from the skills tree
// (resolved lazily -- see repo-root.ts) rather than embedding it:
// the migration chain, the schema-guard bypass, and the reference SQL are all
// case-data gatekept material and must stay inside the /case-data skill per the
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

import { DataServerError } from "../errors.js";
import { pythonDriverFile } from "../python-driver.js";
import { runPythonDriver } from "../python-spawn.js";
import { pythonTimeoutMs, WRITE_TIMEOUT_MS } from "../python-timeout.js";
import { caseDataMigrateScriptsDir } from "../repo-root.js";
import { acquireCaseLock } from "./case-lock.js";

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

function driverFile(): string {
  return pythonDriverFile("case-migrate-driver", MIGRATE_DRIVER);
}

export type MigrateMode = "plan" | "apply" | "restore" | "backups";

export interface MigrateOptions {
  planToken?: string;
  userConfirmation?: string;
  backupId?: string;
}

interface DriverResponse {
  ok: boolean;
  result?: Record<string, unknown>;
  error?: { code?: string; message?: string; details?: Record<string, unknown> };
}

export async function caseDataMigrate(
  matterRoot: string,
  mode: MigrateMode,
  opts: MigrateOptions = {},
  env: NodeJS.ProcessEnv = process.env
): Promise<Record<string, unknown>> {
  const lock = await acquireCaseLock(matterRoot, env);
  try {
    const result = runDriver(matterRoot, mode, opts, env);
    if (lock.brokeStale) {
      const warnings = Array.isArray(result.warnings) ? (result.warnings as string[]) : [];
      warnings.push(
        "broke a stale case-data write lock (>15 min old) before running; if another session " +
          "is still writing to or migrating this matter, stop and reconcile before continuing"
      );
      result.warnings = warnings;
    }
    return result;
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
    label: "case-data migrate driver",
    driver: driverFile(),
    payload,
    env,
    timeoutMs: pythonTimeoutMs(env, WRITE_TIMEOUT_MS, "COCLERK_CASE_PYTHON_TIMEOUT_MS"),
    extraEnv: { PYTHONPATH: scriptsDir },
    timeoutAdvice:
      `If an apply had begun replacing the databases, the next migrate refuses with ` +
      `apply_interrupted until it is recovered with mode 'restore'.`,
  }) as DriverResponse;
  if (!parsed.ok) {
    const error = parsed.error ?? {};
    // DataServerError carries no details field, and these details are the
    // difference between a usable refusal ("backup 2026...-9f2c1a is
    // available") and a mystery -- so fold them into the message.
    const details = error.details && Object.keys(error.details).length
      ? ` [${JSON.stringify(error.details)}]`
      : "";
    throw new DataServerError(
      `${error.message ?? "case-data migrate refused"}${details}`,
      error.code ?? "migrate_error"
    );
  }
  return parsed.result ?? {};
}
