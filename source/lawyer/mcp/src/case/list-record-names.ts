// The names many matters' case data records, for the suggestion cross-check (suggestions/records.ts):
// each document's title and file name, each proceeding's file number and style of cause, and each
// party's name with its counsel and firm.
//
// Spawns /matter-data's references/scripts/list_record_names.py once for every folder, the way
// list-parties.ts spawns list_parties.py: an embedded plumbing driver, the skill's scripts directory
// on PYTHONPATH. Every table name and all the SQL stay in that script (#56). Read-only and lock-free.
// What it returns is client information: it is matched in memory and never logged or sent.

import { pythonDriverFile } from "../python-driver.js";
import { runPythonDriver } from "../python-spawn.js";
import { pythonTimeoutMs, READ_TIMEOUT_MS } from "../python-timeout.js";
import { caseDataMigrateScriptsDir } from "../repo-root.js";

// Pure plumbing: one JSON request in on stdin, one JSON response out on stdout.
const DRIVER = String.raw`
import json, sys


def main():
    request = json.loads(sys.stdin.read())
    try:
        from list_record_names import run
        sys.stdout.write(json.dumps({"ok": True, "result": run(request)}))
    except BaseException as exc:
        sys.stdout.write(json.dumps({"ok": False, "error": type(exc).__name__}))


main()
`.trim();

export type CaseRecordNames =
  | { status: "ok"; titles: string[]; file_names: string[]; matter: string[]; parties: string[] }
  /** No matter-data database in the folder. */
  | { status: "not_applicable" }
  /** A database behind the current schema, or a failed read. */
  | { status: "unavailable" };

/** One result per folder of `caseDataDirs`, in order. Never throws: a failed spawn reads every folder unavailable. */
export function listCaseRecordNames(caseDataDirs: string[], env: NodeJS.ProcessEnv = process.env): CaseRecordNames[] {
  if (caseDataDirs.length === 0) return [];
  const unavailable = caseDataDirs.map((): CaseRecordNames => ({ status: "unavailable" }));
  try {
    const parsed = runPythonDriver({
      label: "matter-data name list",
      driver: pythonDriverFile("case-list-record-names-driver", DRIVER),
      payload: JSON.stringify({ case_data_dirs: caseDataDirs }),
      env,
      timeoutMs: pythonTimeoutMs(env, READ_TIMEOUT_MS, "COCLERK_CASE_PYTHON_TIMEOUT_MS"),
      extraEnv: { PYTHONPATH: caseDataMigrateScriptsDir(env) },
    }) as { ok: boolean; result?: { results?: unknown[] } };
    const results = parsed.ok ? parsed.result?.results : undefined;
    if (!Array.isArray(results) || results.length !== caseDataDirs.length) return unavailable;
    return results.map((raw): CaseRecordNames => {
      const r = raw as Record<string, unknown>;
      if (r?.status === "not_applicable") return { status: "not_applicable" };
      if (r?.status !== "ok") return { status: "unavailable" };
      const list = (value: unknown) => (Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : []);
      return { status: "ok", titles: list(r.titles), file_names: list(r.file_names), matter: list(r.matter), parties: list(r.parties) };
    });
  } catch {
    return unavailable;
  }
}
