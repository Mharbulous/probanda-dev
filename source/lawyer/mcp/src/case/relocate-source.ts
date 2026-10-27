// matter_data__relocate_source: /matter-data's operations/relocate-source.md as one call, for a caller that
// applies an approved move with no model in the loop (design-decisions.md #75).
//
// Spawns /matter-data's references/scripts/relocate_source.py the way case/ingest-authority.ts spawns its
// planner: an embedded plumbing driver, the skill's scripts directory on PYTHONPATH. The script executes the
// operation's own fenced probe and relocate_plan, so this wrapper holds no SQL and no schema. The probe runs
// through matter_data__query and the write through matter_data__execute's own path (backend.ts): the case
// lock, one transaction, the trigger layer and the evidence.sql dump.

import { DataServerError } from "../errors.js";
import { pythonDriverFile } from "../python-driver.js";
import { runPythonDriver } from "../python-spawn.js";
import { pythonTimeoutMs, READ_TIMEOUT_MS } from "../python-timeout.js";
import { caseDataMigrateScriptsDir } from "../repo-root.js";
import { caseDataExecute, caseDataQuery } from "./backend.js";

const DRIVER = String.raw`
import json, sys


def main():
    request = json.loads(sys.stdin.read())
    try:
        from relocate_source import run
        sys.stdout.write(json.dumps({"ok": True, "result": run(request)}))
    except BaseException as exc:
        sys.stdout.write(json.dumps({"ok": False, "error": "%s: %s" % (type(exc).__name__, exc)}))


main()
`.trim();

export interface RelocateSourceRequest {
  matter_root: string;
  hash: string;
  store: "main" | "privileged" | "law";
  old_path: string;
  new_path: string;
}

/** One record of the file and what the plan did with it, in the operation's own words. */
type PlanRow = Record<string, unknown>;

interface Plan {
  outcome: "relocated" | "already_current" | "failed";
  reason: string | null;
  rows: PlanRow[];
  sql: string | null;
  stored_path: string;
}

export interface RelocateSourceResult {
  outcome: Plan["outcome"];
  stored_path: string;
  rows: PlanRow[];
  /** With `failed`: no_rows, twin_at_stored_path or write_not_confirmed. */
  reason: string | null;
  /** With write_not_confirmed: every record as read after the write. */
  rows_now?: Record<string, unknown>[];
  evidence_sql?: string;
  warning?: string | null;
}

function script(step: Record<string, unknown>, env: NodeJS.ProcessEnv): unknown {
  const parsed = runPythonDriver({
    label: "matter-data relocate-source planner",
    driver: pythonDriverFile("case-relocate-source-driver", DRIVER),
    payload: JSON.stringify(step),
    env,
    timeoutMs: pythonTimeoutMs(env, READ_TIMEOUT_MS, "COCLERK_CASE_PYTHON_TIMEOUT_MS"),
    extraEnv: { PYTHONPATH: caseDataMigrateScriptsDir(env) },
  }) as { ok: boolean; result?: unknown; error?: string };
  if (!parsed.ok) {
    throw new DataServerError(`matter_data__relocate_source refused: ${parsed.error ?? "no result"}. Nothing was written.`, "relocate_source_refused");
  }
  return parsed.result;
}

export async function relocateSource(request: RelocateSourceRequest, env: NodeJS.ProcessEnv = process.env): Promise<RelocateSourceResult> {
  const { matter_root: matterRoot } = request;
  const probe = script({ op: "probe", hash: request.hash }, env) as { sql: string; params: unknown[] };
  const rows = caseDataQuery(matterRoot, probe.sql, probe.params).rows;
  const plan = script({ op: "plan", rows, ...request }, env) as Plan;
  const result: RelocateSourceResult = { outcome: plan.outcome, stored_path: plan.stored_path, rows: plan.rows, reason: plan.reason };
  if (plan.outcome !== "relocated") return result;

  const done = await caseDataExecute(matterRoot, plan.sql as string, env);
  const now = caseDataQuery(matterRoot, probe.sql, probe.params).rows;
  const { confirmed } = script({ op: "confirm", rows: now, plan_rows: plan.rows, matter_root: matterRoot, new_path: request.new_path }, env) as { confirmed: boolean };
  if (!confirmed) return { ...result, outcome: "failed", reason: "write_not_confirmed", rows_now: now, warning: done.warning };
  return { ...result, evidence_sql: done.evidence_sql, warning: done.warning };
}
