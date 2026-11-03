// Adapter for the /matter-data relocate operation (matter_data__relocate, ADR 0013).
//
// Shells out to host Python, importing relocate_case_data.py from the skills tree the way
// case/migrate.ts imports migrate_engine.py: the copy, the checks and the pointer rewrite stay
// inside the /matter-data skill. Only this thin driver -- plumbing -- is embedded as a string.
//
// It holds the matter's case lock and the drafting-data lock on the old submission.sqlite for the
// whole run, so no execute, migrate or drafting write lands in the old folder mid-copy.

import { join } from "node:path";

import { DataServerError } from "../errors.js";
import { pythonDriverFile } from "../python-driver.js";
import { runPythonDriver } from "../python-spawn.js";
import { pythonTimeoutMs, WRITE_TIMEOUT_MS } from "../python-timeout.js";
import { caseDataMigrateScriptsDir } from "../repo-root.js";
import { acquireDataLock } from "../submission/lock.js";
import { caseDataFolder } from "./locate.js";
import { acquireCaseLock, withExclusive, type CaseLock } from "./case-lock.js";

const RELOCATE_DRIVER = String.raw`
import json, sys


def main():
    request = json.loads(sys.stdin.read())
    from migrate_engine import MigrateError
    from relocate_case_data import run
    try:
        sys.stdout.write(json.dumps({"ok": True, "result": run(request)}))
    except MigrateError as exc:
        sys.stdout.write(json.dumps({"ok": False, "error": exc.as_dict()}))
    except BaseException as exc:
        sys.stdout.write(json.dumps({
            "ok": False,
            "error": {
                "code": "internal_error",
                "message": "Unexpected relocate driver failure",
                "details": {"exception": type(exc).__name__, "reason": str(exc)},
            },
        }))


main()
`.trim();

export type RelocateMode = "plan" | "apply";

interface DriverResponse {
  ok: boolean;
  result?: Record<string, unknown>;
  error?: { code?: string; message?: string; details?: Record<string, unknown> };
}

export async function caseDataRelocate(
  matterRoot: string,
  mode: RelocateMode,
  env: NodeJS.ProcessEnv = process.env
): Promise<Record<string, unknown>> {
  const work = async (caseLock: CaseLock) => {
    const dataLock = await acquireDataLock(join(caseDataFolder(matterRoot, env), "submission.sqlite"), env);
    try {
      const result = runDriver(matterRoot, mode, env);
      if (caseLock.brokeStale || dataLock.brokeStale) {
        result.warnings = [
          "broke a stale write lock before running; if another session is still " +
            "writing to this matter, stop and reconcile before continuing",
        ];
      }
      return result;
    } finally {
      dataLock.release();
    }
  };
  if (mode === "apply") return withExclusive(matterRoot, env, work);
  const caseLock = await acquireCaseLock(matterRoot, env);
  try {
    return await work(caseLock);
  } finally {
    caseLock.release();
  }
}

function runDriver(matterRoot: string, mode: RelocateMode, env: NodeJS.ProcessEnv): Record<string, unknown> {
  const parsed = runPythonDriver({
    label: "matter-data relocate driver",
    driver: pythonDriverFile("case-relocate-driver", RELOCATE_DRIVER),
    payload: JSON.stringify({ mode, matter_root: matterRoot }),
    env,
    timeoutMs: pythonTimeoutMs(env, WRITE_TIMEOUT_MS, "COCLERK_CASE_PYTHON_TIMEOUT_MS"),
    extraEnv: { PYTHONPATH: caseDataMigrateScriptsDir(env) },
    timeoutAdvice:
      "The pointer is rewritten only after every copy is verified, so it is either unchanged or " +
      "names the new folder. A .probanda_relocate_* folder left in the matter is a staging copy.",
  }) as DriverResponse;
  if (!parsed.ok) {
    const error = parsed.error ?? {};
    const details = error.details && Object.keys(error.details).length
      ? ` [${JSON.stringify(error.details)}]`
      : "";
    throw new DataServerError(
      `${error.message ?? "matter-data relocate refused"}${details}`,
      error.code ?? "relocate_error"
    );
  }
  return parsed.result ?? {};
}
