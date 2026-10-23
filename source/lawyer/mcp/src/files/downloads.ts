// The OS Downloads folder, shared by research filing (which copies a download into a `6. LAW`
// folder) and file-manager's file_ops__move_from_downloads (which moves one into a matter folder).
// Kept apart from research-filing.ts so the `files` bundle does not pull in its fetch and text
// extraction modules.

import { statSync } from "node:fs";
import { homedir } from "node:os";
import { win32 as pathWin32 } from "node:path";

import { DataServerError } from "../errors.js";
import { canonicalRoot } from "./scope.js";

export const IN_PROGRESS_EXTENSIONS = new Set([".crdownload", ".tmp", ".partial"]);

export function downloadsDir(env: NodeJS.ProcessEnv = process.env): string {
  const probe = env.COCLERK_DOWNLOADS_DIR || pathWin32.join(homedir(), "Downloads");
  const dir = canonicalRoot(probe, `Downloads folder not found at ${probe}`, "downloads_missing");
  if (!statSync(dir).isDirectory()) {
    throw new DataServerError(`Downloads path is not a folder: ${probe}`, "downloads_missing");
  }
  return dir;
}
