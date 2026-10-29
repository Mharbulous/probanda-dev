// Host-side soft delete for client-matter files (ADR 0014).
//
// One verb: move an item to <matter root>/TRASH/<same relative path>. The move runs on the
// host, outside the Cowork sandbox, so it needs no shell, raises no delete-permission prompt and
// still works while the device mount is down. No code path here deletes anything: every refusal
// is thrown before the first filesystem change, and a destination collision gets a new name
// rather than an overwrite.

import {
  appendFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  realpathSync,
  renameSync,
  statSync,
} from "node:fs";
import { win32 as pathWin32 } from "node:path";

import { DataServerError } from "../errors.js";
import { POINTER_FILES } from "../files/matter-root.js";
import { zoneProblem } from "../files/zones.js";
import { type RunRow, requireApprovedRow } from "./approved-row.js";

const TRASH = "TRASH";
const TRASH_LOG = ".trash-log.jsonl";

export interface TrashPlan {
  would_move_from: string;
  would_move_to: string;
}

export interface TrashResult {
  moved_from: string;
  moved_to: string;
  kind: "file" | "dir";
  entries?: number;
  bytes?: number;
  /** Present only when the move succeeded but its log line could not be written. */
  log_error?: string;
}

export function fileOpsTrash(path: string, dryRun = false, now = new Date(), row: RunRow = {}): TrashPlan | TrashResult {
  if (typeof path !== "string" || !pathWin32.isAbsolute(path)) {
    throw new DataServerError(`path must be an absolute host path: ${path}`, "invalid_path");
  }

  // Resolve the parent, not the leaf, so a link named as the target is moved, not its target.
  let target: string;
  try {
    target = pathWin32.join(realpathSync.native(pathWin32.dirname(path)), pathWin32.basename(path));
    lstatSync(target);
  } catch {
    throw new DataServerError(`path does not exist: ${path}`, "not_found");
  }
  const stat = lstatSync(target);

  const ancestors = [target];
  for (let dir = pathWin32.dirname(target); dir !== ancestors[ancestors.length - 1]; dir = pathWin32.dirname(dir)) {
    ancestors.push(dir);
  }
  if (ancestors.some((dir) => existsSync(pathWin32.join(dir, ".git")))) {
    throw new DataServerError(
      `path is inside a Git worktree; ordinary repository rules apply there: ${target}`,
      "git_worktree"
    );
  }
  const root = ancestors.find((dir) => POINTER_FILES.some((marker) => isFile(pathWin32.join(dir, marker))));
  if (root === undefined) {
    throw new DataServerError(
      `no ${POINTER_FILES.join(" or ")} at or above the path; not a client-matter file: ${target}`,
      "not_a_matter_file"
    );
  }

  const rel = pathWin32.relative(root, target);
  if (zoneProblem("move-from", target, root)) {
    throw new DataServerError(
      `path is protected (the workspace root, the matter pointer, ${TRASH}, the matter-data folder, or a privileged/disclosed tree): ${target}`,
      "protected"
    );
  }
  requireApprovedRow(root, row, target);

  let dest = pathWin32.join(root, TRASH, rel);
  if (present(dest)) {
    const suffix = ` (trashed ${stamp(now)})`;
    const ext = stat.isDirectory() ? "" : pathWin32.extname(dest);
    dest = dest.slice(0, dest.length - ext.length) + suffix + ext;
    if (present(dest)) {
      throw new DataServerError(`destination already exists: ${dest}`, "dest_exists");
    }
  }

  if (dryRun) return { would_move_from: target, would_move_to: dest };

  const result: TrashResult = stat.isDirectory()
    ? { moved_from: target, moved_to: dest, kind: "dir", entries: readdirSync(target, { recursive: true }).length }
    : { moved_from: target, moved_to: dest, kind: "file", bytes: stat.size };

  mkdirSync(pathWin32.dirname(dest), { recursive: true });
  try {
    renameSync(target, dest);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "EXDEV") {
      throw new DataServerError(
        `cannot move across devices (a junction inside the matter?); nothing was moved: ${target}`,
        "cross_device"
      );
    }
    throw err;
  }

  try {
    const line = JSON.stringify({ when: now.toISOString(), from: target, to: dest });
    appendFileSync(pathWin32.join(root, TRASH, TRASH_LOG), line + "\n", "utf-8");
  } catch (err) {
    result.log_error = err instanceof Error ? err.message : String(err);
  }
  return result;
}

function isFile(path: string): boolean {
  return existsSync(path) && statSync(path).isFile();
}

function present(path: string): boolean {
  try {
    lstatSync(path);
    return true;
  } catch {
    return false;
  }
}

/** Local time as `YYYY-MM-DD HHMMSS`. */
function stamp(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}
