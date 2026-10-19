// The per-device config file, `%APPDATA%\Probanda\probanda.json` (case_data_root, person,
// signature, repo_root). One copy for every reader, so an override cannot miss one.
//
// The folder was `%APPDATA%\Coclerk` and the file was coclerk.json. When Probanda\probanda.json
// does not exist and a Coclerk settings file does, the first read migrates: every file in the
// Coclerk folder is copied into the Probanda folder (the settings file, from probanda.json else
// coclerk.json, saved as probanda.json, and last, so a migration cut short runs again). Nothing in
// Coclerk is changed or removed. A writer also writes both Coclerk files while that folder exists
// (configWritePaths), so an older copy of the plugin that reads only Coclerk keeps working.
//
// COCLERK_CONFIG_PATH names another file to read in its place. A session sets it (through
// the `env` block of a `.claude/settings.local.json` in the folder it opens in) to run
// against scratch data while other sessions keep reading the live file. Set but missing
// is an error naming the file, never a fall back to the live one; empty counts as unset.
// A write then goes to that one file only, and nothing is migrated.

import { copyFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { ValidationError } from "./errors.js";

export const CONFIG_FILE = "probanda.json";
export const LEGACY_CONFIG_FILE = "coclerk.json";
export const CONFIG_FOLDER = "Probanda";
export const LEGACY_CONFIG_FOLDER = "Coclerk";

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

function roaming(env: NodeJS.ProcessEnv): string {
  return env.APPDATA || join(homedir(), "AppData", "Roaming");
}

/** Copies the Coclerk folder's files into the Probanda folder once, when only Coclerk holds settings. */
function migrate(env: NodeJS.ProcessEnv): void {
  const folder = join(roaming(env), CONFIG_FOLDER);
  const target = join(folder, CONFIG_FILE);
  if (existsSync(target)) return;
  const legacyFolder = join(roaming(env), LEGACY_CONFIG_FOLDER);
  const source = [CONFIG_FILE, LEGACY_CONFIG_FILE].map((file) => join(legacyFolder, file)).find((path) => existsSync(path));
  if (!source) return;
  try {
    mkdirSync(folder, { recursive: true });
    for (const entry of readdirSync(legacyFolder, { withFileTypes: true })) {
      if (!entry.isFile() || entry.name === CONFIG_FILE || entry.name === LEGACY_CONFIG_FILE) continue;
      const to = join(folder, entry.name);
      if (!existsSync(to)) copyFileSync(join(legacyFolder, entry.name), to);
    }
    copyFileSync(source, target);
  } catch (err) {
    throw new ValidationError(
      `Could not copy the settings in ${legacyFolder} to ${folder}: ${(err as Error).message}. ` +
      `Nothing in ${legacyFolder} was changed.`
    );
  }
}

/** The file to read: the override, else Probanda\probanda.json, migrated from Coclerk first when
 * only Coclerk holds settings. */
export function configPath(env: NodeJS.ProcessEnv): string {
  const named = override(env);
  if (named) return named;
  migrate(env);
  return join(roaming(env), CONFIG_FOLDER, CONFIG_FILE);
}

/** Every file a write goes to, with the same content: the override alone, else
 * Probanda\probanda.json, plus both Coclerk files while the Coclerk folder exists. The first is
 * the one a result reports. */
export function configWritePaths(env: NodeJS.ProcessEnv): string[] {
  const named = override(env);
  if (named) return [named];
  const legacyFolder = join(roaming(env), LEGACY_CONFIG_FOLDER);
  return [
    join(roaming(env), CONFIG_FOLDER, CONFIG_FILE),
    ...(existsSync(legacyFolder) ? [join(legacyFolder, CONFIG_FILE), join(legacyFolder, LEGACY_CONFIG_FILE)] : []),
  ];
}
