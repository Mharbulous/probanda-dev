// The parties of record of one proceeding, or the parties named by case_party_id where a proceeding
// has no file number yet, read live from /matter-data (party/counsel SSOT).
//
// Spawns /matter-data's references/scripts/parties_of_record.py the way case/migrate.ts spawns
// migrate_engine.py: an embedded plumbing driver, the skill's scripts directory on PYTHONPATH.
// Every matter-data table and column name stays in that script (/matter-data design-decisions.md #56),
// and its result already speaks the drafting runtime's field names, so this wrapper holds no SQL
// and no schema. Read-only and lock-free, like matter_data__query (#28).

import { existsSync } from "node:fs";
import { join } from "node:path";

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
        from parties_of_record import run
        sys.stdout.write(json.dumps({"ok": True, "result": run(request)}))
    except BaseException as exc:
        sys.stdout.write(json.dumps({"ok": False, "error": "%s: %s" % (type(exc).__name__, exc)}))


main()
`.trim();

export interface PartyOfRecord {
  case_party_id: number;
  name: string;
  roles: string[];
  counsel_name: string | null;
  counsel_firm: string | null;
  counsel_email: string | null;
  counsel_phone: string | null;
  address_for_service: string | null;
  address_for_service_filed_on: string | null;
}

export type PartiesOfRecord =
  | { status: "ok"; parties: PartyOfRecord[] }
  /** No matter-data database in the folder, or nothing asked for: there is nothing to read. */
  | { status: "not_applicable"; reason: string }
  /** The record cannot be read as asked; the reason says why. */
  | { status: "unavailable"; reason: string };

/**
 * The parties of record of the proceeding with `fileNumber`, from the matter-data database in
 * `caseDataDir`. Never throws: a helper that fails or cannot start reads `unavailable`, naming
 * the failure, so a caller holds every party rather than passing one nobody checked.
 */
export function readPartiesOfRecord(caseDataDir: string, fileNumber: string, env: NodeJS.ProcessEnv = process.env): PartiesOfRecord {
  return read(caseDataDir, { file_number: fileNumber }, env);
}

/**
 * The matter-data parties with these ids, each with its own counsel and address for service and no
 * per-proceeding override: a proceeding with no file number has no court record of its own. An id
 * case data does not hold is absent from `parties`. Never throws, as readPartiesOfRecord.
 */
export function readPartiesById(caseDataDir: string, casePartyIds: readonly number[], env: NodeJS.ProcessEnv = process.env): PartiesOfRecord {
  return read(caseDataDir, { file_number: null, case_party_ids: casePartyIds }, env);
}

function read(caseDataDir: string, request: object, env: NodeJS.ProcessEnv): PartiesOfRecord {
  // The script says the same; answering here spares a Python start where there is nothing to read.
  if (!existsSync(join(caseDataDir, "main.sqlite"))) {
    return { status: "not_applicable", reason: `no matter-data database in ${caseDataDir}` };
  }
  try {
    const parsed = runPythonDriver({
      label: "matter-data parties-of-record reader",
      driver: pythonDriverFile("case-parties-of-record-driver", DRIVER),
      payload: JSON.stringify({ case_data_dir: caseDataDir, ...request }),
      env,
      timeoutMs: pythonTimeoutMs(env, READ_TIMEOUT_MS, "COCLERK_CASE_PYTHON_TIMEOUT_MS"),
      extraEnv: { PYTHONPATH: caseDataMigrateScriptsDir(env) },
    }) as { ok: boolean; result?: PartiesOfRecord; error?: string };
    if (!parsed.ok || !parsed.result) {
      return { status: "unavailable", reason: `reading the parties of record failed: ${parsed.error ?? "no result"}` };
    }
    return parsed.result;
  } catch (err) {
    return { status: "unavailable", reason: `reading the parties of record failed: ${(err as Error).message}` };
  }
}
