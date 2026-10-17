// Host-side confined move for /housekeeping's approved rows (housekeeping redesign spec §B9.3).
//
// The sibling of file_ops__trash: one file, within one matter. The source must be under the
// matter root and outside its protected zones. The destination must be inside a matter folder
// outside folders 0 and 1, TRASH, and any privileged or disclosed tree, with two exceptions: the
// matter's `0. DRAFT*` folder itself, only for "Move to 0. DRAFT unchanged", which keeps the
// current name; and that folder's `Superseded` subfolder, only for case-data's supersede-draft
// (`superseded`), under any name (the rules live in housekeeping/zones.ts). Only folders named in
// `create_folders` are created. It never overwrites and never adds a suffix, and refuses a
// cross-device move before creating anything. Every refusal is thrown before the first filesystem change. Even under a race
// it never overwrites: the destination is claimed by an exclusive create before the rename
// replaces that placeholder.

import { closeSync, lstatSync, mkdirSync, openSync, readdirSync, realpathSync, renameSync, statSync, unlinkSync } from "node:fs";
import { win32 as pathWin32 } from "node:path";

import { DataServerError } from "../errors.js";
import { POINTER_FILES, validateMatterRoot } from "../files/matter-root.js";
import { bareNameProblem } from "../housekeeping/proposal.js";
import { sameFile } from "../housekeeping/resolve.js";
import { destinationProblem, inFirewall, isDraftFolder, supersededDestinationProblem } from "../housekeeping/zones.js";

export interface MoveResult {
  moved_from: string;
  /** The actual destination path, as it now reads on disk. */
  moved_to: string;
  created_folders: string[];
}

export function fileOpsMove(
  matterRoot: string,
  source: string,
  destination: string,
  createFolders: string[] = [],
  draftUnchanged = false,
  superseded = false
): MoveResult {
  const root = validateMatterRoot(matterRoot);
  if (draftUnchanged && superseded) {
    throw new DataServerError("draft_unchanged and superseded are two different moves; pass one", "invalid_argument");
  }
  for (const [label, p] of [["source", source], ["destination", destination], ...createFolders.map((f) => ["create_folders", f])]) {
    if (typeof p !== "string" || !pathWin32.isAbsolute(p)) {
      throw new DataServerError(`${label} must be an absolute host path: ${p}`, "invalid_path");
    }
  }
  // A folder is created only under a name Windows tools can open: never one ending in a dot or a space.
  for (const folder of createFolders) {
    const problem = bareNameProblem(pathWin32.basename(folder));
    if (problem) throw new DataServerError(`folder name ${JSON.stringify(pathWin32.basename(folder))} ${problem}; it is never created: ${folder}`, "invalid_filename");
  }

  // Resolve the source's parent, not the leaf, so a link named as the source is what moves.
  let src: string;
  try {
    src = pathWin32.join(realpathSync.native(pathWin32.dirname(source)), pathWin32.basename(source));
    if (!lstatSync(src).isFile()) throw new DataServerError(`source is not a file: ${source}`, "not_a_file");
  } catch (err) {
    if (err instanceof DataServerError) throw err;
    throw new DataServerError(`source does not exist: ${source}`, "not_found");
  }
  const srcRel = relativeInside(root, src, "source");
  const srcSegments = srcRel.split(pathWin32.sep).map((s) => s.toLowerCase());
  if (
    (srcSegments.length === 1 && POINTER_FILES.includes(srcSegments[0])) ||
    srcSegments[0] === "trash" ||
    srcSegments[0] === "0. case data" ||
    inFirewall(srcSegments)
  ) {
    throw new DataServerError(`source is protected (the matter pointer, TRASH, 0. CASE DATA, or a privileged/disclosed tree): ${src}`, "protected");
  }

  const name = pathWin32.basename(destination);
  const nameProblem = bareNameProblem(name);
  if (nameProblem) throw new DataServerError(`destination file name ${nameProblem}: ${destination}`, "invalid_filename");
  const destDir = resolveDeepestExisting(pathWin32.dirname(destination));
  const destRel = relativeInside(root, destDir, "destination");
  if (destRel === "") throw new DataServerError(`destination must be inside a matter folder, not the matter root: ${destination}`, "protected");
  const destSegments = destRel.split(pathWin32.sep);
  if (superseded) {
    const drafts = readdirSync(root, { withFileTypes: true })
      .filter((e) => (e.isDirectory() || e.isSymbolicLink()) && isDraftFolder(e.name))
      .map((e) => e.name);
    if (drafts.length !== 1) {
      throw new DataServerError(
        `superseded moves into the matter's one 0. DRAFT folder's Superseded folder; the matter has ${drafts.length} 0. DRAFT folders`,
        "invalid_argument"
      );
    }
    if (supersededDestinationProblem(destSegments, drafts[0])) {
      throw new DataServerError(`superseded moves only into ${drafts[0]}\\Superseded: ${destination}`, "invalid_argument");
    }
    const other = createFolders.find((f) => pathWin32.resolve(f).toLowerCase() !== destDir.toLowerCase());
    if (other !== undefined) {
      throw new DataServerError(`with superseded, create_folders may name only ${destDir}: ${other}`, "invalid_argument");
    }
  } else if (draftUnchanged) {
    if (destinationProblem(destSegments, true)) {
      throw new DataServerError(`draft_unchanged moves only into the matter's 0. DRAFT folder: ${destination}`, "invalid_argument");
    }
    if (name !== pathWin32.basename(src)) {
      throw new DataServerError(`Move to 0. DRAFT unchanged keeps the current name (${pathWin32.basename(src)}), not ${name}`, "draft_name_changed");
    }
  } else if (destinationProblem(destSegments)) {
    throw new DataServerError(
      `destination is protected (folders 0 and 1 except Move to 0. DRAFT unchanged, TRASH, or a privileged/disclosed tree): ${destination}`,
      "protected"
    );
  }

  // Folders to create: every missing ancestor of the destination, each one approved by name.
  const missing: string[] = [];
  for (let dir = destDir; !exists(dir); dir = pathWin32.dirname(dir)) missing.unshift(dir);
  const approved = new Set(createFolders.map((f) => pathWin32.resolve(f).toLowerCase()));
  const unapproved = missing.filter((dir) => !approved.has(dir.toLowerCase()));
  if (unapproved.length) {
    throw new DataServerError(`destination folder does not exist and was not approved for creation: ${unapproved[0]}`, "folder_not_approved");
  }
  const onPath = createFolders.filter((f) => {
    const dir = pathWin32.resolve(f).toLowerCase();
    return destDir.toLowerCase() !== dir && !destDir.toLowerCase().startsWith(dir + "\\");
  });
  if (onPath.length) throw new DataServerError(`create_folders must lie on the destination's own path: ${onPath[0]}`, "invalid_argument");

  const dest = pathWin32.join(destDir, name);
  if (dest === src) throw new DataServerError(`source and destination are the same path: ${src}`, "invalid_argument");
  if (present(dest) && !sameFile(src, dest)) {
    throw new DataServerError(`destination already exists; nothing is overwritten: ${dest}`, "dest_exists");
  }
  const existingAncestor = missing.length ? pathWin32.dirname(missing[0]) : destDir;
  if (statSync(src).dev !== statSync(existingAncestor).dev) {
    throw new DataServerError(`cannot move across devices; nothing was moved: ${src} -> ${dest}`, "cross_device");
  }

  for (const dir of missing) mkdirSync(dir);
  // Claim the destination by an exclusive create, so a file that appears there after the check
  // above is refused, never overwritten; the rename then replaces this placeholder. A case-only
  // rename moves one file onto itself and claims nothing.
  const claim = !sameFile(src, dest);
  if (claim) {
    try {
      closeSync(openSync(dest, "wx"));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "EEXIST") {
        throw new DataServerError(`destination already exists; nothing is overwritten: ${dest}`, "dest_exists");
      }
      throw err;
    }
  }
  try {
    renameSync(src, dest);
  } catch (err) {
    if (claim) {
      // Only the placeholder this call created.
      try {
        unlinkSync(dest);
      } catch (cleanup) {
        throw new DataServerError(
          `the move failed (${(err as Error).message}) and its empty placeholder could not be removed (${(cleanup as Error).message}): ${dest}`,
          "placeholder_left"
        );
      }
    }
    if ((err as NodeJS.ErrnoException).code === "EXDEV") {
      throw new DataServerError(`cannot move across devices; nothing was moved: ${src} -> ${dest}`, "cross_device");
    }
    throw err;
  }
  return { moved_from: src, moved_to: realpathSync.native(dest), created_folders: missing };
}

/** `path` relative to `root`, or a refusal when it is not inside it. "" is the root itself. */
function relativeInside(root: string, path: string, label: string): string {
  const rel = pathWin32.relative(root, path);
  if (rel.startsWith("..") || pathWin32.isAbsolute(rel)) {
    throw new DataServerError(`${label} is not under the matter root ${root}: ${path}`, "path_out_of_scope");
  }
  return rel;
}

/** The deepest existing ancestor through realpath, with the missing tail re-appended. */
function resolveDeepestExisting(target: string): string {
  const tail: string[] = [];
  let cursor = pathWin32.resolve(target);
  for (;;) {
    try {
      const base = realpathSync.native(cursor);
      return tail.length ? pathWin32.join(base, ...tail.reverse()) : base;
    } catch {
      const parent = pathWin32.dirname(cursor);
      if (parent === cursor) return pathWin32.resolve(target);
      tail.push(pathWin32.basename(cursor));
      cursor = parent;
    }
  }
}

function exists(path: string): boolean {
  try {
    statSync(path);
    return true;
  } catch {
    return false;
  }
}

function present(path: string): boolean {
  try {
    lstatSync(path);
    return true;
  } catch {
    return false;
  }
}
