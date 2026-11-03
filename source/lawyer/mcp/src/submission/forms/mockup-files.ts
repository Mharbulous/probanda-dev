// What a mockup render does to files on disk: archive the previous copy, write the new one,
// remove old board files and refuse a target the render did not write.

import { existsSync, mkdirSync, renameSync, unlinkSync } from "node:fs";
import { basename, dirname, extname, join } from "node:path";

import { manifestDir, readManifest, type RenderManifest } from "../render-manifest.js";
import { readExistingRevision, sanitizeForPath } from "../writing-folder.js";
import { writeStatusFile } from "../../status-file.js";
import { WORKBOARD_DATA_FILE } from "./render-work-board.js";
import { DataServerError, ValidationError } from "../../errors.js";
import { type DocumentOutput } from "./render-documents.js";
import { nowStamp } from "./timings.js";

/**
 * What is actually on disk for one filing, now that bootstrap renders nothing (#584): the
 * advocacy mockups its manifest lists and that still exist. A filing never rendered reports none,
 * and its `render_state` says `never`. Existence only -- no mockup is opened, so a cloud-sync
 * placeholder costs nothing here.
 */
export function existingMockupPaths(dbPath: string, filingId: number): string[] {
  const manifest = readManifest(dbPath, filingId);
  if (manifest === null) return [];
  const dir = manifestDir(dbPath, manifest);
  return manifest.files.map((f) => join(dir, f.file_name)).filter((p) => existsSync(p));
}

/** A file name without its extension: the name an archived copy of the file is labelled with. */
function fileStem(fileName: string): string {
  return fileName.slice(0, fileName.length - extname(fileName).length);
}

/** Archives the previous copy of `filePath` under `archive/<document name> @rev<N> <timestamp><ext>` only when its stamped revision differs from `currentRevision`. */
function archiveIfStale(filePath: string, formLabel: string, currentRevision: number): void {
  const existingRevision = readExistingRevision(filePath);
  if (existingRevision === undefined || existingRevision === currentRevision) return;
  archiveFile(filePath, formLabel, existingRevision);
}

function archiveFile(filePath: string, formLabel: string, revision: number): void {
  const archiveDir = join(dirname(filePath), "archive");
  mkdirSync(archiveDir, { recursive: true });
  // Two files of one type archived at one revision in one minute -- two witness statements -- would
  // share a name, and the second rename would replace the first copy, so a later one is numbered.
  const name = `${sanitizeForPath(formLabel)} @rev${revision} ${nowStamp().replace(/[: ]/g, "-")}`;
  let archivePath = join(archiveDir, `${name}${extname(filePath)}`);
  for (let n = 2; existsSync(archivePath); n++) archivePath = join(archiveDir, `${name} (${n})${extname(filePath)}`);
  renameSync(filePath, archivePath);
}

/** Archives each file the previous render's manifest listed that this render no longer writes
 * (#1339): a re-snapshot after the type's title changed, a retitled stock-type Writing, a witness
 * removed, a companion dropped. Named as archiveIfStale names a copy, with the revision that manifest
 * stamped, under the name this render gives a document of the same type, so a renamed document's
 * archive reads as one. Only listed files move, from the folder the manifest names, never one outside
 * it. A file already gone, or locked or refused by the sync client, is left in place rather than
 * failing the render, as removeRetiredBoardFiles leaves one. The new manifest does not list a file
 * left that way, so no later render retries it: listing it would make a memoisation hit serve it as
 * one of the filing's documents. */
export function archiveDroppedFiles(dbPath: string, previous: RenderManifest | null, written: readonly DocumentOutput[]): void {
  if (!previous) return;
  const dir = manifestDir(dbPath, previous);
  for (const file of previous.files) {
    if (written.some((doc) => doc.fileName === file.file_name) || basename(file.file_name) !== file.file_name) continue;
    // A one-of-its-type document the render renamed (a retitle) archives under its new name; any other under its own.
    const sameType = written.filter((doc) => doc.documentType === file.document_type);
    const single = sameType.length === 1 && previous.files.filter((f) => f.document_type === file.document_type).length === 1;
    const renamed = single ? sameType[0] : undefined;
    try {
      archiveFile(join(dir, file.file_name), fileStem(renamed?.fileName ?? file.file_name), previous.stamp.revision);
    } catch (err) {
      if (!["ENOENT", "EBUSY", "EPERM"].includes((err as NodeJS.ErrnoException).code ?? "")) throw err;
    }
  }
}

export function writeDocument(baseDir: string, output: DocumentOutput, revision: number): string {
  mkdirSync(baseDir, { recursive: true });
  const filePath = join(baseDir, output.fileName);
  archiveIfStale(filePath, fileStem(output.fileName), revision);
  const code = writeStatusFile(filePath, output.markdown);
  if (code) throw new DataServerError(`could not write ${filePath}: ${code}`);
  return filePath;
}

/**
 * The files the board was split into before it became one self-contained page (local-only design,
 * amended 2026-09-15): the stylesheet and behaviour script one level up, the data script beside it.
 * A render deletes any it finds in `dir` -- these fixed names only, never recursively, never inside
 * archive/ (ADR 0012's amendment). The tree is OneDrive-synced, so a file that is already gone, or
 * locked or refused by the sync client, is left for a later render rather than failing this one.
 */
const RETIRED_BOARD_FILES = ["workboard.css", "workboard.js", WORKBOARD_DATA_FILE];

function removeRetiredBoardFiles(dir: string, names: readonly string[] = RETIRED_BOARD_FILES): void {
  for (const name of names) {
    const file = join(dir, name);
    try {
      if (existsSync(file)) unlinkSync(file);
    } catch (err) {
      if (!["ENOENT", "EBUSY", "EPERM"].includes((err as NodeJS.ErrnoException).code ?? "")) throw err;
    }
  }
}

const STALE_WORKBOARD_MARKDOWN = "Work Board.md";

/** The board files an older render left in the Writing's folder `dir` and at the draft folder's top:
 * the retired support files, and in `dir` a `Work Board.md` carrying a render revision stamp, as every
 * Markdown board did (2026-09-03 design doc §3, #966). The folder is the practitioner's too, so an
 * unstamped `Work Board.md` there is theirs and is never deleted. */
export function removeOldBoardFiles(dir: string): void {
  const stale = readExistingRevision(join(dir, STALE_WORKBOARD_MARKDOWN)) !== undefined ? [STALE_WORKBOARD_MARKDOWN] : [];
  removeRetiredBoardFiles(dir, [...RETIRED_BOARD_FILES, ...stale]);
  removeRetiredBoardFiles(dirname(dir));
}

/** Refuses, before any is written, a mockup target in the Writing's folder that exists and carries no
 * render revision stamp: this renderer did not write it, so it is the practitioner's (AGENTS.md: never
 * overwrite a file this skill did not write). */
export function refuseForeignTargets(dir: string, fileNames: readonly string[]): void {
  for (const name of fileNames) {
    const target = join(dir, name);
    if (existsSync(target) && readExistingRevision(target) === undefined) {
      throw new ValidationError(`${target} was not written by Probanda, so it is not overwritten. Move it out of the Writing's folder, then render again`);
    }
  }
}
