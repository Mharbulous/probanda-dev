// The file of one stored authority, found hash-first and given as a PDF, for /draft's scrutiny
// review (/case-data design-decisions.md #61).
//
// Spawns /case-data's references/scripts/resolve_authority_source.py the way
// case/parties-of-record.ts spawns parties_of_record.py: an embedded plumbing driver, the skill's
// scripts directory on PYTHONPATH. Every case-data table and column name stays in that script, and
// its result already speaks the drafting runtime's field names (`path`, `sha256`), so this wrapper
// holds no SQL and no schema. Read-only and lock-free, like case_data__query (#28); the one file it
// writes is the converted PDF in the host-local cache folder the caller names.

import { homedir } from "node:os";
import { win32 as pathWin32 } from "node:path";

import { DataServerError } from "../errors.js";
import { pythonDriverFile } from "../python-driver.js";
import { runPythonDriver } from "../python-spawn.js";
import { caseDataMigrateScriptsDir } from "../repo-root.js";

// Pure plumbing: one JSON request in on stdin, one JSON response out on stdout.
const DRIVER = String.raw`
import json, sys


def main():
    request = json.loads(sys.stdin.read())
    try:
        from resolve_authority_source import run
        sys.stdout.write(json.dumps({"ok": True, "result": run(request)}))
    except BaseException as exc:
        sys.stdout.write(json.dumps({"ok": False, "error": "%s: %s" % (type(exc).__name__, exc)}))


main()
`.trim();

/** Word plus the script's own 20 s hash-search deadline; the script stops itself at 38 s. */
export const AUTHORITY_SOURCE_TIMEOUT_MS = 40_000;

export interface AuthoritySourceRequest {
  caseDataDir: string;
  matterRoot: string;
  /** The drafting authority's citation, matched as the script describes. */
  citation: string;
  /** A file the practitioner named, absolute, already confined by the caller. */
  sourcePath?: string;
  /** Where converted PDFs are kept, by sha256. */
  cacheDir: string;
}

export interface Tried {
  path: string | null;
  reason: string;
}

interface Found {
  arm: "recorded_path" | "hash_search" | "named_path";
  path: string;
  sha256: string;
  hash_identity: boolean;
  source_format: "pdf" | "rtf" | "docx" | "doc" | null;
  converter: "word" | null;
  tried: Tried[];
  searched: string[];
  search_truncated: boolean;
  /** Files the hash search skipped because OneDrive holds them in the cloud only. */
  skipped_cloud_only: number;
  /** Files the hash search could not read. */
  unreadable: string[];
}

export type AuthoritySource =
  | (Found & { status: "ok"; pdf: string; cached: boolean })
  | (Found & { status: "converter_missing" | "conversion_failed"; detail: string })
  /** Two or more stored authorities match the citation; each is listed as the script gives it. */
  | { status: "authority_ambiguous"; candidates: Record<string, unknown>[] }
  | {
      status: "unresolved";
      reason: string;
      tried: Tried[];
      searched: string[];
      search_truncated: boolean;
      skipped_cloud_only: number;
      unreadable: string[];
    };

/** Finds and converts the authority's file. A failed or timed-out spawn throws, as every host step does. */
export function resolveAuthoritySource(request: AuthoritySourceRequest, env: NodeJS.ProcessEnv = process.env, installRoot?: string): AuthoritySource {
  const parsed = runPythonDriver({
    label: "case-data authority-source resolver",
    driver: pythonDriverFile("case-authority-source-driver", DRIVER),
    payload: JSON.stringify({
      case_data_dir: request.caseDataDir,
      matter_root: request.matterRoot,
      citation: request.citation,
      source_path: request.sourcePath ?? null,
      cache_dir: request.cacheDir,
    }),
    env,
    timeoutMs: AUTHORITY_SOURCE_TIMEOUT_MS,
    extraEnv: { PYTHONPATH: caseDataMigrateScriptsDir(env, installRoot) },
    timeoutAdvice:
      "Word may still be converting, or the matter tree is slow to hash. A finished conversion is cached, so call again.",
    stagingDescription: "staging copy of the case-data law database",
  }) as { ok: boolean; result?: AuthoritySource; error?: string };
  if (!parsed.ok || !parsed.result) {
    throw new DataServerError(`resolving the authority's file failed: ${parsed.error ?? "no result"}`);
  }
  return parsed.result;
}

/** The host-local cache of converted PDFs (ADR 0031 decision 5: per-machine renders). */
export function authorityPdfCacheDir(env: NodeJS.ProcessEnv): string {
  return pathWin32.join(env.LOCALAPPDATA || homedir(), "Coclerk", "scrutiny-review");
}
