// The per-device config file, `%APPDATA%\Coclerk\coclerk.json` (case_data_root, person,
// signature, repo_root). One copy for every reader, so an override cannot miss one.
//
// COCLERK_CONFIG_PATH names another file to read in its place. A session sets it (through
// the `env` block of a `.claude/settings.local.json` in the folder it opens in) to run
// against scratch data while other sessions keep reading the live file. Set but missing
// is an error naming the file, never a fall back to the live one; empty counts as unset.

import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { ValidationError } from "./errors.js";

export function configPath(env: NodeJS.ProcessEnv): string {
  const override = env.COCLERK_CONFIG_PATH;
  if (override) {
    if (!existsSync(override)) {
      throw new ValidationError(
        `COCLERK_CONFIG_PATH names ${override}, which does not exist. Create it, or unset the variable ` +
        `to read the live coclerk.json.`
      );
    }
    return override;
  }
  return join(env.APPDATA || join(homedir(), "AppData", "Roaming"), "Coclerk", "coclerk.json");
}
