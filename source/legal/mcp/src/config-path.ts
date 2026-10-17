// The per-device config file, `%APPDATA%\Coclerk\probanda.json` (case_data_root, person,
// signature, repo_root). One copy for every reader, so an override cannot miss one.
//
// The file was named coclerk.json. A reader takes probanda.json when it exists, else coclerk.json.
// A writer writes both with the same content (configWritePaths), so an older copy of the plugin
// that reads only coclerk.json keeps working. Neither file is ever renamed or removed.
//
// COCLERK_CONFIG_PATH names another file to read in its place. A session sets it (through
// the `env` block of a `.claude/settings.local.json` in the folder it opens in) to run
// against scratch data while other sessions keep reading the live file. Set but missing
// is an error naming the file, never a fall back to the live one; empty counts as unset.
// A write then goes to that one file only.

import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { ValidationError } from "./errors.js";

export const CONFIG_FILE = "probanda.json";
export const LEGACY_CONFIG_FILE = "coclerk.json";

function override(env: NodeJS.ProcessEnv): string | undefined {
  const named = env.COCLERK_CONFIG_PATH;
  if (!named) return undefined;
  if (!existsSync(named)) {
    throw new ValidationError(
      `COCLERK_CONFIG_PATH names ${named}, which does not exist. Create it, or unset the variable ` +
      `to read the live ${CONFIG_FILE}.`
    );
  }
  return named;
}

function liveFolder(env: NodeJS.ProcessEnv): string {
  return join(env.APPDATA || join(homedir(), "AppData", "Roaming"), "Coclerk");
}

/** The file to read: the override, else probanda.json when it exists or coclerk.json is absent,
 * else coclerk.json. */
export function configPath(env: NodeJS.ProcessEnv): string {
  const named = override(env);
  if (named) return named;
  const current = join(liveFolder(env), CONFIG_FILE);
  const legacy = join(liveFolder(env), LEGACY_CONFIG_FILE);
  return existsSync(current) || !existsSync(legacy) ? current : legacy;
}

/** Every file a write goes to, with the same content: the override alone, else probanda.json
 * and coclerk.json. The first is the one a result reports. */
export function configWritePaths(env: NodeJS.ProcessEnv): string[] {
  const named = override(env);
  if (named) return [named];
  return [join(liveFolder(env), CONFIG_FILE), join(liveFolder(env), LEGACY_CONFIG_FILE)];
}
