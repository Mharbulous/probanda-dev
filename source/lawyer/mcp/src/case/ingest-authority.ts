// matter_data__ingest_authority: the Path D writes for one extracted authority, from the extractor's
// staged result (/matter-data design-decisions.md #68, #76). /matter-data's operations/ingest-extract.md
// Path D is its only caller.
//
// Spawns /matter-data's references/scripts/ingest_authority.py the way case/resolve-participant.ts
// spawns resolve_participant.py: an embedded plumbing driver, the skill's scripts directory on
// PYTHONPATH. The script checks the result and returns the statements to run, with every table and
// column name in them, so this wrapper holds no SQL and no schema. The statements run through
// matter_data__execute's own path (backend.ts): the case lock, one transaction, the trigger layer and
// the evidence.sql dump.

import { DataServerError } from "../errors.js";
import { pythonDriverFile } from "../python-driver.js";
import { runPythonDriver } from "../python-spawn.js";
import { pythonTimeoutMs, READ_TIMEOUT_MS } from "../python-timeout.js";
import { caseDataMigrateScriptsDir } from "../repo-root.js";
import { caseDataExecuteStatements, type CaseStatement } from "./backend.js";
import { stagedResultPath } from "./stage-result.js";

// Pure plumbing: one JSON request in on stdin, one JSON response out on stdout.
const DRIVER = String.raw`
import json, sys


def main():
    request = json.loads(sys.stdin.read())
    try:
        from ingest_authority import plan
        sys.stdout.write(json.dumps({"ok": True, "result": plan(request)}))
    except BaseException as exc:
        sys.stdout.write(json.dumps({"ok": False, "error": "%s: %s" % (type(exc).__name__, exc)}))


main()
`.trim();

export interface AuthorityIngestRequest {
  matter_root: string;
  /** What matter_data__stage_result returned for the extractor's JSON object (#76). */
  result_id: string;
  /** The authority's file, relative to the matter root, and the SHA-256 of its bytes. */
  file_path: string;
  file_hash: string;
  /** Only for an entry of a bundled book of authorities: its pages in the book. */
  bundled_pages?: string;
}

/** What the script asks of each statement's result; the table names in `count` are its own. */
interface PlannedStatement extends CaseStatement {
  count?: { table: string; of: number };
  value_as?: string;
  rows_as?: string;
}

type AuthorityPlan =
  | { problems: string[] }
  | { params: Record<string, unknown>; statements: PlannedStatement[]; treats_prior: unknown; held_back: unknown[] };

export type AuthorityIngest =
  | {
      ok: true;
      authority_id: number;
      /** Per table: rows inserted, and rows offered that were already held. */
      counts: Record<string, { inserted: number; skipped: number }>;
      /** Each determined-by concept stubbed because no concept of that name was held. */
      stubs: Array<{ name: string; jurisdiction: string | null }>;
      /** The result's own treats_prior, unwritten: treatments stay with matter_data__execute. */
      treats_prior: unknown;
      /** Links unwritten because the relationship CHECK cannot hold their value
       *  (shared/treatment-vocabulary.md). Reported to the practitioner, never remapped. */
      held_back: unknown[];
      evidence_sql: string;
      warning?: string | null;
    }
  /** The result or the stored rows refuse the write. Nothing was written. */
  | { ok: false; problems: string[] };

export async function ingestAuthority(request: AuthorityIngestRequest, env: NodeJS.ProcessEnv = process.env): Promise<AuthorityIngest> {
  const { result_id, ...rest } = request;
  const parsed = runPythonDriver({
    label: "matter-data authority ingest planner",
    driver: pythonDriverFile("case-ingest-authority-driver", DRIVER),
    payload: JSON.stringify({ ...rest, result_path: stagedResultPath(result_id, env) }),
    env,
    timeoutMs: pythonTimeoutMs(env, READ_TIMEOUT_MS, "COCLERK_CASE_PYTHON_TIMEOUT_MS"),
    extraEnv: { PYTHONPATH: caseDataMigrateScriptsDir(env) },
  }) as { ok: boolean; result?: AuthorityPlan; error?: string };
  if (!parsed.ok || !parsed.result) {
    throw new DataServerError(`matter_data__ingest_authority could not read the result: ${parsed.error ?? "no result"}. Nothing was written.`);
  }
  const plan = parsed.result;
  if ("problems" in plan) return { ok: false, problems: plan.problems };

  const done = await caseDataExecuteStatements(request.matter_root, plan.statements, plan.params, env);
  if (!done.ok) return { ok: false, problems: done.refused.map(String) };

  const counts: Record<string, { inserted: number; skipped: number }> = {};
  const named: Record<string, unknown> = {};
  plan.statements.forEach((statement, i) => {
    const { rowcount, rows } = done.results[i];
    if (statement.count) {
      const count = (counts[statement.count.table] ??= { inserted: 0, skipped: 0 });
      count.inserted += rowcount;
      count.skipped += statement.count.of - rowcount;
    }
    if (statement.value_as) named[statement.value_as] = Object.values(rows[0])[0];
    if (statement.rows_as) named[statement.rows_as] = rows;
  });
  return {
    ok: true,
    ...(named as { authority_id: number; stubs: Array<{ name: string; jurisdiction: string | null }> }),
    counts,
    treats_prior: plan.treats_prior ?? null,
    held_back: plan.held_back ?? [],
    evidence_sql: done.evidence_sql,
    warning: done.warning,
  };
}
