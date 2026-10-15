// The per-user settings file (config-path.ts): report what it holds, and repair a missing or
// broken `case_data_root` (spec 2026-10-06_practice-db-config-repair). Files, not practice.db
// rows: neither tool ever creates `_practice` or `practice.db`. config_status also reports
// whether Probanda's Cloud credential is present and how many writes practice.db holds pending.
//
// config_set_root is repair-only: a root that already resolves to an existing practice.db is
// never repointed, because repointing redirects every running session (planning/CLAUDE.md).
// COCLERK_CONFIG_PATH keeps its rule: set but missing is an error, never a fall back.

import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";

import { loadCloudKey } from "../../cloud-key.js";
import { configPath } from "../../config-path.js";
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
    .map((name) => join(packages, name, "LocalCache", "Roaming", "Coclerk", "coclerk.json"))
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
  candidates: { root: string; source: "matter_root"; practice_db_exists: boolean }[];
  candidate_error?: string;
  redirected_copies: string[];
  /** Whether Probanda's Cloud credential, which every practice write needs, is configured. */
  cloud_credential: "present" | "missing";
  /** Writes the cloud saved that practice.db has not applied yet; null when practice.db cannot be read. */
  pending_writes: number | null;
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
      else status.candidate_error = "the matter's case-data folder does not sit in a \"0. CASE DATA\" folder";
    } catch (err) {
      status.candidate_error = (err as Error).message;
    }
  }
  return status;
}

export interface ConfigSetRootResult {
  path: string;
  created: boolean;
  previous_case_data_root: string | null;
  case_data_root: string;
  keys_missing: string[];
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
  if (!rootWorks(root)) {
    throw new ValidationError(
      `Refused: ${practiceDb(root)} does not exist. case_data_root must name a folder that already holds ` +
        "_practice\\practice.db; this tool never creates a database. Nothing was written."
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
  mkdirSync(dirname(path), { recursive: true });
  const temp = `${path}.${process.pid}.tmp`;
  writeFileSync(temp, JSON.stringify(config, null, 2) + "\n", "utf-8");
  renameSync(temp, path);
  return { path, created, previous_case_data_root: previous, case_data_root: root, keys_missing: keysMissing(config) };
}
