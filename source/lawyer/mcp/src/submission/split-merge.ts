// drafting_data__split_merge: compares the two copies a sync conflict split a matter's drafting records
// into, and writes the practitioner's merge of them to a new file (/drafting-data references/sync-split.md).
// The comparison and the merge are /drafting-data's split_merge.py; this finds the two inputs and runs it.

import { existsSync } from "node:fs";
import { basename, dirname, join } from "node:path";

import { DataServerError } from "../errors.js";
import { resolveDbPath, validateMatterRoot } from "../files/matter-root.js";
import { runPythonDriver } from "../python-spawn.js";
import { submissionDataMigrateScriptsDir } from "../repo-root.js";
import { pythonTimeoutMs, syncSplitCopies, WRITE_TIMEOUT_MS } from "./backend.js";

/** The merge's own output, never an input. */
export const MERGED_FILE = "submission-merged.sqlite";

export interface SplitMergeRequest {
  matter_root: string;
  op: "diff" | "merge";
  sha256?: string[];
  decisions?: Record<string, "a" | "b">;
}

export function splitMerge(request: SplitMergeRequest, env: NodeJS.ProcessEnv = process.env): Record<string, unknown> {
  const dbPath = resolveDbPath(validateMatterRoot(request.matter_root));
  const dir = dirname(dbPath);
  const names = [...(existsSync(dbPath) ? [basename(dbPath)] : []), ...syncSplitCopies(dbPath).filter((name) => name.toLowerCase() !== MERGED_FILE)].sort();
  if (names.length !== 2) {
    throw new DataServerError(`drafting_data__split_merge compares exactly two copies of ${dbPath}; found ${names.length}: ${names.join(", ") || "none"}. Nothing was read or written.`, "split_not_two", { copies: names });
  }
  const result = runPythonDriver({
    label: "drafting records split merge (split_merge.py)",
    driver: join(submissionDataMigrateScriptsDir(env), "split_merge.py"),
    payload: JSON.stringify({ op: request.op, inputs: names.map((name) => join(dir, name)), sha256: request.sha256, decisions: request.decisions, out: join(dir, MERGED_FILE) }),
    env,
    timeoutMs: pythonTimeoutMs(env, WRITE_TIMEOUT_MS),
  }) as Record<string, unknown>;
  if (typeof result.refused === "string") throw new DataServerError(String(result.message), result.refused);
  return result;
}
