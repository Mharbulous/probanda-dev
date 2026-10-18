// /housekeeping's read-only preflight (spec §B2 step 3, §B9.2): the host-side facts a Cowork
// session cannot see for itself. Moves, writes and queries nothing.

import { existsSync, readdirSync } from "node:fs";
import { win32 as pathWin32 } from "node:path";

import { HALF_COMMIT_PREFIX, caseDataFolder } from "../case/backend.js";
import { DataServerError } from "../errors.js";
import { findPointer, validateMatterRoot } from "../files/matter-root.js";
import { templateRoot } from "./resolve.js";
import { isDirectory } from "./run-dir.js";

export interface Preflight {
  /** Absolute paths of every `.coclerk_execute_*` entry in the matter's case-data folder. */
  half_commit: string[];
  case_data_found: boolean;
  /** Template-relative folder paths, every level, backslash separators. Only when asked for. */
  template_folders?: string[];
}

export function preflight(matterRoot: string, includeTemplate = false, env: NodeJS.ProcessEnv = process.env): Preflight {
  // A matter folder with no pointer (neither probanda.json nor coclerk.json yet, or only a
  // legacy `9. AI` pointer) has no case data to check: /housekeeping Step 4 offers to set it up.
  // Anything not a directory still fails.
  const pointerless =
    typeof matterRoot === "string" &&
    pathWin32.isAbsolute(matterRoot) &&
    isDirectory(matterRoot) &&
    findPointer(matterRoot) === undefined;
  const out: Preflight = pointerless ? { half_commit: [], case_data_found: false } : halfCommits(matterRoot, env);
  if (includeTemplate) {
    const root = templateRoot(env);
    if (!isDirectory(root)) throw new DataServerError(`the template matter was not found at ${root}`, "template_missing");
    out.template_folders = folderTree(root, "");
  }
  return out;
}

function halfCommits(matterRoot: string, env: NodeJS.ProcessEnv): Preflight {
  validateMatterRoot(matterRoot);
  const dir = caseDataFolder(matterRoot, env);
  const found = isDirectory(dir);
  return {
    half_commit: found
      ? readdirSync(dir)
          .filter((name) => name.startsWith(HALF_COMMIT_PREFIX))
          .sort()
          .map((name) => pathWin32.join(dir, name))
      : [],
    case_data_found: found,
  };
}

function folderTree(root: string, rel: string): string[] {
  const out: string[] = [];
  const entries = readdirSync(pathWin32.join(root, rel), { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
  for (const name of entries) {
    const child = rel ? `${rel}\\${name}` : name;
    out.push(child, ...folderTree(root, child));
  }
  return out;
}
