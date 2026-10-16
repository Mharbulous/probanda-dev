// The practitioner's "0. CASE DATA" folder, resolved from coclerk.json. Kept out of
// backend.ts so a server that needs only this (the file-manager plugin's `files`
// server, through housekeeping/resolve.ts) does not bundle the practice database.
import { existsSync, readFileSync } from "node:fs";

import { configPath } from "../config-path.js";
import { ValidationError } from "../errors.js";

// Appended to the path-resolution errors below (spec 2026-10-06_practice-db-config-repair).
const CONFIG_STATUS_HINT =
  "Call practice_data__config_status to see what is missing and the candidate root.";

// Resolves the practitioner's "0. CASE DATA" folder from the Roaming
// coclerk.json `case_data_root` key. Shared by every local database that
// lives under it (practice.db here, time_pipeline.db in ../time-pipeline/backend.ts)
// so the config-reading and error-reporting logic has exactly one copy.
// `fallback` is consulted only when that file is absent: a string is the root, null leaves the
// missing-file error standing. A present file always wins and the fallback is never called.
export function resolveCaseDataRoot(env: NodeJS.ProcessEnv = process.env, fallback?: () => string | null): string {
  const configFile = configPath(env);
  if (!existsSync(configFile)) {
    const derived = fallback?.() ?? null;
    if (derived !== null) return derived;
    throw new ValidationError(
      `Cannot locate the practice database: ${configFile} not found. Probanda has not been set up ` +
      `on this device: run /practice:probanda-setup, and never write coclerk.json by hand.`
    );
  }
  let root: unknown;
  try {
    root = (JSON.parse(readFileSync(configFile, "utf-8")) as Record<string, unknown>).case_data_root;
  } catch (err) {
    throw new ValidationError(`coclerk.json is not valid JSON: ${(err as Error).message}`);
  }
  if (typeof root !== "string" || root === "") {
    throw new ValidationError(
      `coclerk.json is missing "case_data_root" (the path to your "0. CASE DATA" folder). ` +
      `Add it, or set the COCLERK_DB_PATH env override. ` + CONFIG_STATUS_HINT
    );
  }
  if (!existsSync(root)) {
    throw new ValidationError(
      `Configured case_data_root does not exist: ${root}. Update ${configFile} after moving ` +
      `the Litigation Documents library, or restore that root. No _practice directory was created.`
    );
  }
  return root;
}
