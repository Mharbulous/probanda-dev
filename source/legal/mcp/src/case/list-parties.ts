// Every party in one matter's case data, for practice_data__contact_checks' second check: a
// case-data party no practice-data matter role points to (ADR 0009, firm-wide contacts spec 4.4).
//
// Spawns /case-data's references/scripts/list_parties.py the way case/parties-of-record.ts
// spawns parties_of_record.py: an embedded plumbing driver, the skill's scripts directory on
// PYTHONPATH. Every table name and all the SQL stay in that script (#56). Read-only and lock-free,
// like case_data__query (#28).

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
        from list_parties import run
        sys.stdout.write(json.dumps({"ok": True, "result": run(request)}))
    except BaseException as exc:
        sys.stdout.write(json.dumps({"ok": False, "error": "%s: %s" % (type(exc).__name__, exc)}))


main()
`.trim();

export interface CaseParty {
  party_id: number;
  name: string;
  party_type: string | null;
  lawyer_name: string | null;
  lawyer_firm: string | null;
  lawyer_email: string | null;
  lawyer_phone: string | null;
  address: string | null;
  contact_info: string | null;
  proceedings: { proceeding_id: number; role: string }[];
}

export type CaseParties =
  | { status: "ok"; parties: CaseParty[] }
  /** No case-data database in the matter's folder. */
  | { status: "not_applicable"; reason: string }
  /** A database behind the current schema, or a failed read. */
  | { status: "unavailable"; reason: string };

/** Every party in the case data in `caseDataDir`. Never throws. */
export function listCaseParties(caseDataDir: string, env: NodeJS.ProcessEnv = process.env): CaseParties {
  try {
    const parsed = runPythonDriver({
      label: "case-data party list",
      driver: pythonDriverFile("case-list-parties-driver", DRIVER),
      payload: JSON.stringify({ case_data_dir: caseDataDir }),
      env,
      timeoutMs: pythonTimeoutMs(env, READ_TIMEOUT_MS, "COCLERK_CASE_PYTHON_TIMEOUT_MS"),
      extraEnv: { PYTHONPATH: caseDataMigrateScriptsDir(env) },
    }) as { ok: boolean; result?: CaseParties; error?: string };
    if (!parsed.ok || !parsed.result) {
      return { status: "unavailable", reason: `listing the case-data parties failed: ${parsed.error ?? "no result"}` };
    }
    return parsed.result;
  } catch (err) {
    return { status: "unavailable", reason: `listing the case-data parties failed: ${(err as Error).message}` };
  }
}
