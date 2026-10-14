// Which files in the matter folders a caller names the case database does not yet hold, read at
// session entry (/case-data design-decisions.md #60). The caller passes the folders the opened
// filing's type declares as its ingest inputs (shared/declared-layout.md section 5), drawn from the
// solicitor-client, correspondence, court-file and discovery folders.
//
// Spawns /case-data's references/scripts/ingest_coverage.py the way case/parties-of-record.ts
// spawns parties_of_record.py: an embedded plumbing driver, the skill's scripts directory on
// PYTHONPATH. The script runs /case-data's own ingest-coverage operation, so this wrapper holds no
// SQL and no schema. Read-only and lock-free, like case_data__query (#28).

import { existsSync } from "node:fs";
import { join } from "node:path";

import { pythonDriverFile } from "../python-driver.js";
import { runPythonDriver } from "../python-spawn.js";
import { pythonTimeoutMs } from "../python-timeout.js";
import { caseDataMigrateScriptsDir } from "../repo-root.js";

// Pure plumbing: one JSON request in on stdin, one JSON response out on stdout.
const DRIVER = String.raw`
import json, sys


def main():
    request = json.loads(sys.stdin.read())
    try:
        from ingest_coverage import run
        sys.stdout.write(json.dumps({"ok": True, "result": run(request)}))
    except BaseException as exc:
        sys.stdout.write(json.dumps({"ok": False, "error": "%s: %s" % (type(exc).__name__, exc)}))


main()
`.trim();

const FOLDER_GLOBS = ["2. SOLICITOR CLIENT*", "3. CORRESPONDENCE*", "5. COURT*", "7. DISCOVERY*"];
const CORRESPONDENCE_GLOBS = FOLDER_GLOBS.slice(0, 2);

// Hashing a discovery folder over OneDrive can outlast READ_TIMEOUT_MS's 20 s, and 30 s keeps
// open_session under the Cowork bridge's 60 s limit alongside its other phases. A kill leaves no
// staging folder behind: the script tags its temp folder with staging_prefix, and runPythonDriver
// removes that tag's folders.
export const COVERAGE_TIMEOUT_MS = 30_000;

export type IngestCoverage =
  | {
      status: "ok";
      /** Matter-relative paths of the files with no ingested record. */
      to_ingest: string[];
      /** One entry per `to_ingest` path, in the same order, saying why the file is not held:
       * `verdict` `none` is no usable record, `partial` a partly ingested one and `failed` a failed
       * one. `source_id` is the case-data source behind the verdict, and `possible_version_of` the
       * source its pending supersede marker names as another version of the file; each is null when
       * there is none. */
      records: {
        path: string;
        verdict: "none" | "partial" | "failed";
        source_id: number | null;
        possible_version_of: number | null;
      }[];
      /** Files whose record is damaged: no ingest takes them until it is repaired. */
      damaged: string[];
      /** Files whose bytes could not be read, so their state is unknown. */
      unreadable: { path: string; error: string }[];
      /** The checked folder patterns that matched no folder. */
      missing: string[];
      /** The newest dated correspondence the case database holds, or null when none carries a date
       * or no correspondence folder was checked. */
      newest_correspondence: { date: string; path: string } | null;
    }
  /** No case-data database in the folder: there is nothing to check against. */
  | { status: "not_applicable"; reason: string }
  /** The check could not run; the reason says why. Never read as "ingested". */
  | { status: "unavailable"; reason: string };

/**
 * The ingest coverage of `folderGlobs` in the matter at `matterRoot` (a host path, used for both the
 * walk and the stored-path comparison) against the case-data database in `caseDataDir`. The
 * solicitor-client and correspondence folders among them count as correspondence. Never throws: a
 * helper that fails, cannot start or outlives its budget reads `unavailable`, naming the failure.
 */
export function readIngestCoverage(
  caseDataDir: string,
  matterRoot: string,
  folderGlobs: readonly string[] = FOLDER_GLOBS,
  env: NodeJS.ProcessEnv = process.env
): IngestCoverage {
  // The script says the same; answering here spares a Python start where there is nothing to read.
  if (!existsSync(join(caseDataDir, "main.sqlite"))) {
    return { status: "not_applicable", reason: `no case-data database in ${caseDataDir}` };
  }
  try {
    const timeoutMs = pythonTimeoutMs(env, COVERAGE_TIMEOUT_MS, "COCLERK_CASE_PYTHON_TIMEOUT_MS");
    const parsed = runPythonDriver({
      label: "case-data ingest-coverage reader",
      driver: pythonDriverFile("case-ingest-coverage-driver", DRIVER),
      payload: JSON.stringify({
        case_data_dir: caseDataDir,
        matter_root: matterRoot,
        folder_globs: folderGlobs,
        correspondence_globs: folderGlobs.filter((g) => CORRESPONDENCE_GLOBS.includes(g)),
      }),
      env,
      timeoutMs,
      extraEnv: { PYTHONPATH: caseDataMigrateScriptsDir(env) },
      timeoutAdvice:
        `Hashing the matter's folders needs more than its ${timeoutMs} ms budget. The session reports ` +
        "ingest coverage as unavailable for this opening; the check writes nothing, so nothing is lost.",
      stagingDescription: "staging copy of the case-data databases",
    }) as { ok: boolean; result?: IngestCoverage; error?: string };
    if (!parsed.ok || !parsed.result) {
      return { status: "unavailable", reason: `checking ingest coverage failed: ${parsed.error ?? "no result"}` };
    }
    return parsed.result;
  } catch (err) {
    return { status: "unavailable", reason: `checking ingest coverage failed: ${(err as Error).message}` };
  }
}
