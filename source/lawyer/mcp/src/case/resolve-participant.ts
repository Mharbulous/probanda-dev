// case_data__resolve_participant: a name, surname or file-name code resolved to the participants it
// could mean, each with every name, alias and file code on record (/case-data design-decisions.md
// #65, #66). The first model-facing narrow case-data tool; /case-data's operations/participants.md
// is its only caller.
//
// Spawns /case-data's references/scripts/resolve_participant.py the way case/parties-of-record.ts
// spawns parties_of_record.py: an embedded plumbing driver, the skill's scripts directory on
// PYTHONPATH. Every table and column name and all the matching stay in that script, so this wrapper
// holds no SQL and no schema. Read-only and lock-free, like case_data__query (#28).

import { pythonDriverFile } from "../python-driver.js";
import { runPythonDriver } from "../python-spawn.js";
import { pythonTimeoutMs, READ_TIMEOUT_MS } from "../python-timeout.js";
import { caseDataMigrateScriptsDir } from "../repo-root.js";
import { caseDataFolder } from "./backend.js";

// Pure plumbing: one JSON request in on stdin, one JSON response out on stdout.
const DRIVER = String.raw`
import json, sys


def main():
    request = json.loads(sys.stdin.read())
    try:
        from resolve_participant import run
        sys.stdout.write(json.dumps({"ok": True, "result": run(request)}))
    except BaseException as exc:
        sys.stdout.write(json.dumps({"ok": False, "error": "%s: %s" % (type(exc).__name__, exc)}))


main()
`.trim();

export type ParticipantRole = "party" | "counsel" | "witness" | "expert" | "tribunal";

export interface ParticipantMatch {
  role: ParticipantRole;
  id: number;
  name: string;
  /** A tribunal member's capacity, a party's proceeding roles, counsel's clients, an expert's field. */
  capacity: string | null;
  /** The forum, for a tribunal member. */
  body: string | null;
  /** Counsel only: every party they act for. */
  party_ids?: number[];
  match: "exact" | "near";
  matched: string;
  /** Near matches only: the edit distance on the surname. */
  distance?: number;
  search_terms: string[];
}

export type ParticipantResolution =
  | { status: "ok"; query: string; matches: ParticipantMatch[] }
  /** Nothing on record matches, exactly or near: search the name as given. */
  | { status: "not_found"; query: string; reason: string }
  /** No name, no case-data database, a database behind the current schema, or a failed read. */
  | { status: "unavailable"; reason: string };

/**
 * The participants `name` could mean in the matter at `matterRoot`. Never throws: a helper that
 * fails or cannot start reads `unavailable`, naming the failure.
 */
export function resolveParticipant(matterRoot: string, name: string, env: NodeJS.ProcessEnv = process.env): ParticipantResolution {
  try {
    const caseDataDir = caseDataFolder(matterRoot, env);
    const parsed = runPythonDriver({
      label: "case-data participant resolver",
      driver: pythonDriverFile("case-resolve-participant-driver", DRIVER),
      payload: JSON.stringify({ case_data_dir: caseDataDir, name }),
      env,
      timeoutMs: pythonTimeoutMs(env, READ_TIMEOUT_MS, "COCLERK_CASE_PYTHON_TIMEOUT_MS"),
      extraEnv: { PYTHONPATH: caseDataMigrateScriptsDir(env) },
    }) as { ok: boolean; result?: ParticipantResolution; error?: string };
    if (!parsed.ok || !parsed.result) {
      return { status: "unavailable", reason: `resolving the participant failed: ${parsed.error ?? "no result"}` };
    }
    return parsed.result;
  } catch (err) {
    return { status: "unavailable", reason: `resolving the participant failed: ${(err as Error).message}` };
  }
}
