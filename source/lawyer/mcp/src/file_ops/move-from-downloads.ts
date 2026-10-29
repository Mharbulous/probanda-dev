// Host-side move of one download into a client matter: the practitioner's "move it from Downloads
// into the file". A move, never a copy: the file leaves Downloads by one rename on the same drive,
// and nothing here copies or deletes a file. The source is a bare file name in the OS Downloads
// folder (the server finds the folder itself). The destination is a full file path in an existing
// matter folder outside folders 0 and 1, TRASH and any privileged or disclosed tree (the rules in
// files/zones.ts); no folder is created. A taken name gets the next " vN", so nothing is
// overwritten, even under a race: the name is claimed by an exclusive create before the rename
// replaces that placeholder. A move across drives is refused before anything changes. Every move is
// logged to `<matter-data folder>\file-manager\move-log.jsonl`.

import { closeSync, lstatSync, mkdirSync, openSync, realpathSync, renameSync, statSync, unlinkSync } from "node:fs";
import { win32 as pathWin32 } from "node:path";

import { DataServerError } from "../errors.js";
import { downloadsDir, IN_PROGRESS_EXTENSIONS } from "../files/downloads.js";
import { validateMatterRoot } from "../files/matter-root.js";
import { nextVersionName } from "../files/version-name.js";
import { zoneProblem } from "../files/zones.js";
import { bareNameProblem } from "../housekeeping/proposal.js";
import { appendLineDurably, openMatter } from "../housekeeping/run-dir.js";
import { type RunRow, requireApprovedRow } from "./approved-row.js";
import { relativeInside } from "./move.js";

const MOVE_LOG = "move-log.jsonl";
// Each attempt re-scans the folder, so this bound is only reached when something keeps creating
// the very name we picked; fail loudly then rather than loop.
const MAX_ATTEMPTS = 100;

export interface MoveFromDownloadsResult {
  moved_from: string;
  /** The actual destination path, as it now reads on disk. */
  moved_to: string;
  /** True when the name asked for was taken and a " vN" name was used instead. */
  versioned: boolean;
  /** Present only when the move succeeded but its log line could not be written. */
  log_error?: string;
}

export interface MoveFromDownloadsSeams {
  /** Tests only: the device id of a path, to stand in for a second drive. */
  dev?: (path: string) => number;
}

export function fileOpsMoveFromDownloads(
  matterRoot: string,
  sourceFilename: string,
  destination: string,
  env: NodeJS.ProcessEnv = process.env,
  seams: MoveFromDownloadsSeams = {},
  now = new Date(),
  row: RunRow = {}
): MoveFromDownloadsResult {
  const root = validateMatterRoot(matterRoot);
  const sourceProblem = bareNameProblem(sourceFilename);
  if (sourceProblem) throw new DataServerError(`source_filename ${sourceProblem}: ${sourceFilename}`, "invalid_filename");
  const src = pathWin32.join(downloadsDir(env), sourceFilename);
  let isFile: boolean;
  try {
    isFile = lstatSync(src).isFile();
  } catch {
    throw new DataServerError(`no such file in Downloads: ${sourceFilename}`, "not_found");
  }
  if (!isFile) throw new DataServerError(`source is not a file: ${src}`, "not_a_file");
  if (IN_PROGRESS_EXTENSIONS.has(pathWin32.extname(sourceFilename).toLowerCase())) {
    throw new DataServerError(`download still in progress: ${sourceFilename}`, "in_progress");
  }
  requireApprovedRow(root, row, src);

  if (typeof destination !== "string" || !pathWin32.isAbsolute(destination)) {
    throw new DataServerError(`destination must be an absolute host path: ${destination}`, "invalid_path");
  }
  const name = pathWin32.basename(destination);
  const nameProblem = bareNameProblem(name);
  if (nameProblem) throw new DataServerError(`destination file name ${nameProblem}: ${destination}`, "invalid_filename");
  let destDir: string;
  try {
    destDir = realpathSync.native(pathWin32.dirname(destination));
    if (!statSync(destDir).isDirectory()) throw new Error("not a folder");
  } catch {
    throw new DataServerError(`destination folder does not exist; no folder is created: ${pathWin32.dirname(destination)}`, "not_found");
  }
  const destRel = relativeInside(root, destDir, "destination");
  if (destRel === "") throw new DataServerError(`destination must be inside a matter folder, not the matter root: ${destination}`, "protected");
  if (zoneProblem("move-to", destDir, root)) {
    throw new DataServerError(
      `destination is protected (folders 0 and 1, TRASH, or a privileged/disclosed tree): ${destination}`,
      "protected"
    );
  }
  const dev = seams.dev ?? ((path: string) => statSync(path).dev);
  if (dev(src) !== dev(destDir)) {
    throw new DataServerError(`cannot move across drives; nothing was moved: ${src} -> ${destDir}`, "cross_device");
  }

  // Claim the next free name by an exclusive create, so a file that appears there after the scan is
  // never overwritten; the rename then replaces this placeholder.
  const ext = pathWin32.extname(name);
  const stem = name.slice(0, name.length - ext.length);
  let dest: string | undefined;
  for (let attempt = 0; attempt < MAX_ATTEMPTS && dest === undefined; attempt++) {
    const candidate = pathWin32.join(destDir, nextVersionName(destDir, stem, ext));
    try {
      closeSync(openSync(candidate, "wx"));
      dest = candidate;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
    }
  }
  if (dest === undefined) {
    throw new DataServerError(`no free version of ${name} in ${destDir} after ${MAX_ATTEMPTS} attempts`, "dest_exists");
  }
  try {
    renameSync(src, dest);
  } catch (err) {
    // Only the placeholder this call created.
    try {
      unlinkSync(dest);
    } catch (cleanup) {
      throw new DataServerError(
        `the move failed (${(err as Error).message}) and its empty placeholder could not be removed (${(cleanup as Error).message}): ${dest}`,
        "placeholder_left"
      );
    }
    if ((err as NodeJS.ErrnoException).code === "EXDEV") {
      throw new DataServerError(`cannot move across drives; nothing was moved: ${src} -> ${dest}`, "cross_device");
    }
    throw err;
  }

  const movedTo = realpathSync.native(dest);
  const result: MoveFromDownloadsResult = {
    moved_from: src,
    moved_to: movedTo,
    versioned: pathWin32.basename(movedTo).toLowerCase() !== name.toLowerCase(),
  };
  try {
    const logDir = pathWin32.join(openMatter(root).caseData, "file-manager");
    mkdirSync(logDir, { recursive: true });
    appendLineDurably(pathWin32.join(logDir, MOVE_LOG), JSON.stringify({ when: now.toISOString(), from: src, to: movedTo }));
  } catch (err) {
    result.log_error = err instanceof Error ? err.message : String(err);
  }
  return result;
}
