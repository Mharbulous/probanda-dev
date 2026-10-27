// matter_data__housekeeping_log: /matter-data's operations/housekeeping-log.md modes `record` and `retry` as
// one call each, for a caller that applies an approved run with no model in the loop (design-decisions.md #75).
// Mode `lookup` stays with housekeeping_lookup.py (#73).
//
// Spawns /matter-data's references/scripts/housekeeping_log.py the way case/ingest-authority.ts spawns its
// planner. The script checks the entries and returns the operation's own fenced statements with every value
// bound, so this wrapper holds no SQL and no schema. They run through matter_data__execute's own path
// (backend.ts): the case lock, one transaction for the whole batch, the trigger layer and the evidence.sql dump.

import { DataServerError } from "../errors.js";
import { pythonDriverFile } from "../python-driver.js";
import { runPythonDriver } from "../python-spawn.js";
import { pythonTimeoutMs, READ_TIMEOUT_MS } from "../python-timeout.js";
import { caseDataMigrateScriptsDir } from "../repo-root.js";
import { caseDataExecuteStatements, type CaseStatement } from "./backend.js";

const DRIVER = String.raw`
import json, sys


def main():
    request = json.loads(sys.stdin.read())
    try:
        from housekeeping_log import plan
        sys.stdout.write(json.dumps({"ok": True, "result": plan(request)}))
    except BaseException as exc:
        sys.stdout.write(json.dumps({"ok": False, "error": "%s: %s" % (type(exc).__name__, exc)}))


main()
`.trim();

export interface HousekeepingLogRequest {
  matter_root: string;
  mode: "record" | "retry";
  /** record: one per file, `{file_name, file_hash, folder_type, outcome, reason?, failure_class?}`. */
  entries?: unknown[];
  /** retry: the file hashes to try reading again next run. */
  hashes?: string[];
}

export type HousekeepingLogResult =
  | { ok: true; mode: "record"; recorded: number; evidence_sql: string; warning?: string | null }
  /** `unmatched`: each hash with no remembered ingest failure, so nothing was scheduled for it. */
  | { ok: true; mode: "retry"; updated: number; unmatched: string[]; evidence_sql: string; warning?: string | null }
  /** The entries break the operation's input. Nothing was written. */
  | { ok: false; problems: string[] };

export async function housekeepingLog(request: HousekeepingLogRequest, env: NodeJS.ProcessEnv = process.env): Promise<HousekeepingLogResult> {
  const { matter_root: matterRoot, ...work } = request;
  const parsed = runPythonDriver({
    label: "matter-data housekeeping-log planner",
    driver: pythonDriverFile("case-housekeeping-log-driver", DRIVER),
    payload: JSON.stringify(work),
    env,
    timeoutMs: pythonTimeoutMs(env, READ_TIMEOUT_MS, "COCLERK_CASE_PYTHON_TIMEOUT_MS"),
    extraEnv: { PYTHONPATH: caseDataMigrateScriptsDir(env) },
  }) as { ok: boolean; result?: { problems: string[] } | { statements: CaseStatement[]; params: Record<string, unknown> }; error?: string };
  if (!parsed.ok || !parsed.result) {
    throw new DataServerError(`matter_data__housekeeping_log could not plan the write: ${parsed.error ?? "no result"}. Nothing was written.`);
  }
  const plan = parsed.result;
  if ("problems" in plan) return { ok: false, problems: plan.problems };

  const done = await caseDataExecuteStatements(matterRoot, plan.statements, plan.params, env);
  if (!done.ok) return { ok: false, problems: done.refused.map(String) };
  const counts = done.results.map((r) => r.rowcount);
  const total = counts.reduce((a, b) => a + b, 0);
  if (request.mode === "record") {
    return { ok: true, mode: "record", recorded: total, evidence_sql: done.evidence_sql, warning: done.warning };
  }
  const unmatched = (request.hashes ?? []).filter((_, i) => counts[i] === 0);
  return { ok: true, mode: "retry", updated: total, unmatched, evidence_sql: done.evidence_sql, warning: done.warning };
}
