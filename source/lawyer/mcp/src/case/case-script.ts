// Runs one function of a /matter-data references/scripts module host-side, the way
// case/ingest-authority.ts runs ingest_authority.py: an embedded plumbing driver, the skill's scripts
// directory on PYTHONPATH, one JSON request in and one JSON result out. Every table and column name
// stays in the script (#56, #68).

import { DataServerError } from "../errors.js";
import { pythonDriverFile } from "../python-driver.js";
import { runPythonDriver } from "../python-spawn.js";
import { pythonTimeoutMs, READ_TIMEOUT_MS } from "../python-timeout.js";
import { caseDataMigrateScriptsDir } from "../repo-root.js";

export function runCaseScript<T>(module: string, fn: string, request: unknown, env: NodeJS.ProcessEnv): T {
  const driver = String.raw`
import json, sys


def main():
    request = json.loads(sys.stdin.read())
    try:
        from ${module} import ${fn}
        sys.stdout.write(json.dumps({"ok": True, "result": ${fn}(request)}))
    except BaseException as exc:
        sys.stdout.write(json.dumps({"ok": False, "error": "%s: %s" % (type(exc).__name__, exc)}))


main()
`.trim();
  const parsed = runPythonDriver({
    label: `matter-data ${module}`,
    driver: pythonDriverFile(`case-${module}-${fn}-driver`, driver),
    payload: JSON.stringify(request),
    env,
    timeoutMs: pythonTimeoutMs(env, READ_TIMEOUT_MS, "COCLERK_CASE_PYTHON_TIMEOUT_MS"),
    extraEnv: { PYTHONPATH: caseDataMigrateScriptsDir(env) },
  }) as { ok: boolean; result?: T; error?: string };
  if (!parsed.ok || parsed.result === undefined) {
    throw new DataServerError(`${module} failed: ${parsed.error ?? "no result"}. Nothing was written.`);
  }
  return parsed.result;
}
