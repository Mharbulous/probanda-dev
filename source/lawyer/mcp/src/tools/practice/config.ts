// The per-user settings file (config-path.ts): report what it holds, and repair a missing or
// broken `case_data_root` (spec 2026-10-06_practice-db-config-repair). Files, not practice.db
// rows: only config_set_root's `initialize`, which /probanda-setup passes once the practitioner
// approves a new device's root, creates `_practice` and `practice.db`. config_status also reports
// whether Probanda's Cloud credential is present and how many writes practice.db holds pending.
//
// config_set_root never repoints a root that already resolves to an existing practice.db,
// because repointing redirects every running session (planning/CLAUDE.md).
// COCLERK_CONFIG_PATH keeps its rule: set but missing is an error, never a fall back.

import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";

import { loadCloudKey } from "../../cloud-key.js";
import { CONFIG_FILE, CONFIG_FOLDER, configPath, configWritePaths, LEGACY_CONFIG_FILE, LEGACY_CONFIG_FOLDER } from "../../config-path.js";
import { DataServerError, ValidationError } from "../../errors.js";
import { caseDataRootFromMatterRoot } from "../../files/matter-root.js";
import { resolvePracticeDbPath } from "../../practice/backend.js";
import { PracticeStore } from "../../practice/store.js";

// The top-level keys practice-data/SKILL.md § Configuration documents.
export const DOCUMENTED_KEYS = [
  "version",
  "case_data_root",
  "firm",
  "review",
  "person",
  "signature",
  "practice_quirks",
  "briefing",
  "accounting",
  "repo_root",
  "page_api_port",
];

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

function isDir(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function practiceDb(root: string): string {
  return join(root, "_practice", "practice.db");
}

/** A root works when it is an existing folder holding `_practice\practice.db`. */
function rootWorks(root: unknown): root is string {
  return typeof root === "string" && root !== "" && isDir(root) && isFile(practiceDb(root));
}

function keysMissing(config: Record<string, unknown>): string[] {
  return DOCUMENTED_KEYS.filter((key) => config[key] === undefined || config[key] === null || config[key] === "");
}

/** Copies under a packaged app's redirected Roaming folder. Reported only; never read for settings. */
function redirectedCopies(env: NodeJS.ProcessEnv): string[] {
  const packages = join(env.LOCALAPPDATA || join(homedir(), "AppData", "Local"), "Packages");
  let names: string[];
  try {
    names = readdirSync(packages);
  } catch {
    return [];
  }
  return names
    .flatMap((name) => [CONFIG_FOLDER, LEGACY_CONFIG_FOLDER].flatMap((folder) =>
      [CONFIG_FILE, LEGACY_CONFIG_FILE].map((file) => join(packages, name, "LocalCache", "Roaming", folder, file))))
    .filter(isFile);
}

export interface ConfigStatus {
  path: string | null;
  override: boolean;
  exists: boolean;
  error?: string;
  parse_error?: string;
  keys_present: string[];
  keys_missing: string[];
  case_data_root: string | null;
  root_exists: boolean;
  practice_db_exists: boolean;
  /** This practitioner's environment notes, verbatim; null when the file is absent or sets none. */
  practice_quirks: string | null;
  candidates: { root: string; source: "matter_root" | "scan"; practice_db_exists: boolean }[];
  candidate_error?: string;
  /** The profile scan stopped at SCAN_LIMIT folders, so a root may exist that it did not reach. */
  scan_truncated?: boolean;
  redirected_copies: string[];
  /** Whether Probanda's Cloud credential, which every practice write needs, is in Credential Manager (or the env override). Never the key. */
  cloud_credential: "present" | "missing";
  /** Writes the cloud saved that practice.db has not applied yet; null when practice.db cannot be read. */
  pending_writes: number | null;
}

const SCAN_DEPTH = 4;
const SCAN_LIMIT = 5000;
const SCAN_SKIP = new Set(["appdata", "node_modules"]);

/** Folders under the user's profile, to SCAN_DEPTH deep, that are named "0. CASE DATA" or hold
 * `_practice\practice.db`. statSync follows symlinks and junctions, so a synced library reached
 * through a link is found at the path the link gives it. Dot folders, AppData and node_modules are
 * skipped; past SCAN_LIMIT folders the scan stops and says so. */
function scanCandidates(env: NodeJS.ProcessEnv): { roots: string[]; truncated: boolean } {
  const roots: string[] = [];
  const queue: [string, number][] = [[env.USERPROFILE || homedir(), 0]];
  let visited = 0;
  for (let i = 0; i < queue.length; i++) {
    const [dir, depth] = queue[i];
    let names: string[];
    try {
      names = readdirSync(dir);
    } catch {
      continue;
    }
    for (const name of names) {
      if (name.startsWith(".") || SCAN_SKIP.has(name.toLowerCase())) continue;
      const child = join(dir, name);
      if (!isDir(child)) continue;
      if (++visited > SCAN_LIMIT) return { roots, truncated: true };
      if (name.toLowerCase() === "0. case data" || rootWorks(child)) roots.push(child);
      else if (depth + 1 < SCAN_DEPTH) queue.push([child, depth + 1]);
    }
  }
  return { roots, truncated: false };
}

/** The pending writes of the practice.db this machine resolves; 0 when it has none or is empty. */
function pendingWrites(env: NodeJS.ProcessEnv): number | null {
  try {
    const path = resolvePracticeDbPath(env);
    if (!isFile(path) || statSync(path).size === 0) return 0;
    return new PracticeStore(env).pendingCount();
  } catch {
    return null;
  }
}

export async function config_status(
  args: Record<string, unknown>,
  env: NodeJS.ProcessEnv = process.env
): Promise<ConfigStatus> {
  const status: ConfigStatus = {
    path: null,
    override: !!env.COCLERK_CONFIG_PATH,
    exists: false,
    keys_present: [],
    keys_missing: [...DOCUMENTED_KEYS],
    case_data_root: null,
    root_exists: false,
    practice_db_exists: false,
    practice_quirks: null,
    candidates: [],
    redirected_copies: redirectedCopies(env),
    cloud_credential: (await loadCloudKey(env)).configured ? "present" : "missing",
    pending_writes: pendingWrites(env),
  };
  try {
    status.path = configPath(env);
    status.exists = isFile(status.path);
  } catch (err) {
    status.path = env.COCLERK_CONFIG_PATH ?? null;
    status.error = (err as Error).message;
  }
  if (status.exists && status.path) {
    try {
      const config = JSON.parse(readFileSync(status.path, "utf-8")) as Record<string, unknown>;
      status.keys_present = Object.keys(config);
      status.keys_missing = keysMissing(config);
      if (typeof config.practice_quirks === "string" && config.practice_quirks !== "") {
        status.practice_quirks = config.practice_quirks;
      }
      if (typeof config.case_data_root === "string" && config.case_data_root !== "") {
        status.case_data_root = config.case_data_root;
        status.root_exists = isDir(config.case_data_root);
        status.practice_db_exists = rootWorks(config.case_data_root);
      }
    } catch (err) {
      status.parse_error = (err as Error).message;
    }
  }
  if (args.matter_root !== undefined) {
    try {
      const root = caseDataRootFromMatterRoot(args.matter_root, env);
      if (root !== null) status.candidates.push({ root, source: "matter_root", practice_db_exists: rootWorks(root) });
      else status.candidate_error = "the matter's matter-data folder does not sit in a \"0. CASE DATA\" folder";
    } catch (err) {
      status.candidate_error = (err as Error).message;
    }
  } else if (!status.exists && !status.error) {
    // A new device (/probanda-setup): no settings file, so look for the root under the profile.
    const scan = scanCandidates(env);
    for (const root of scan.roots) status.candidates.push({ root, source: "scan", practice_db_exists: rootWorks(root) });
    if (scan.truncated) status.scan_truncated = true;
  }
  return status;
}

export interface ConfigSetRootResult {
  path: string;
  created: boolean;
  previous_case_data_root: string | null;
  case_data_root: string;
  keys_missing: string[];
  initialized?: true;
}

export async function config_set_root(
  args: Record<string, unknown>,
  env: NodeJS.ProcessEnv = process.env
): Promise<ConfigSetRootResult> {
  const path = configPath(env);
  const root = args.case_data_root;
  if (typeof root !== "string" || root === "" || !isAbsolute(root)) {
    throw new ValidationError("case_data_root must be an absolute path to the \"0. CASE DATA\" folder");
  }
  // initialize (a new device, on the practitioner's approval) may name a root with no practice.db
  // yet, or a root folder still to be made in an existing parent.
  const initialize = args.initialize === true && !rootWorks(root);
  if (initialize && !isDir(root) && !isDir(dirname(root))) {
    throw new ValidationError(`Refused: neither ${root} nor its parent folder exists. Nothing was written.`);
  }
  if (!initialize && !rootWorks(root)) {
    throw new ValidationError(
      `Refused: ${practiceDb(root)} does not exist. case_data_root must name a folder that already holds ` +
        "_practice\\practice.db, unless initialize is true for a new device's approved root. Nothing was written."
    );
  }

  const created = !existsSync(path);
  let config: Record<string, unknown> = { version: 1 };
  if (!created) {
    try {
      config = JSON.parse(readFileSync(path, "utf-8")) as Record<string, unknown>;
    } catch (err) {
      throw new ValidationError(`${path} is not valid JSON (${(err as Error).message}); repair it by hand. Nothing was written.`);
    }
    if (config === null || typeof config !== "object" || Array.isArray(config)) {
      throw new ValidationError(`${path} does not hold a JSON object; repair it by hand. Nothing was written.`);
    }
    if (rootWorks(config.case_data_root)) {
      throw new DataServerError(
        `Refused: ${path} already sets case_data_root to ${config.case_data_root}, which holds _practice\\practice.db. ` +
          "A working root is never repointed, because every running session reads it. Nothing was written.",
        "root_already_working"
      );
    }
  }

  const previous = typeof config.case_data_root === "string" ? config.case_data_root : null;
  config.case_data_root = root;
  if (initialize) mkdirSync(join(root, "_practice"), { recursive: true });
  const written = configWritePaths(env);
  for (const target of written) {
    mkdirSync(dirname(target), { recursive: true });
    const temp = `${target}.${process.pid}.tmp`;
    writeFileSync(temp, JSON.stringify(config, null, 2) + "\n", "utf-8");
    renameSync(temp, target);
  }
  const result: ConfigSetRootResult = { path: written[0], created, previous_case_data_root: previous, case_data_root: root, keys_missing: keysMissing(config) };
  if (initialize) {
    // Opening the store creates practice.db and its schema at the root just written.
    new PracticeStore(env).pendingCount();
    result.initialized = true;
  }
  return result;
}
