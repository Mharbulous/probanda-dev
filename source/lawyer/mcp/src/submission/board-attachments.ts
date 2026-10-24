// A board's attachments as found on disk (ADR 0042): a client letter's folder or a reply's file,
// attached to a Job Board by a board_attachments row that holds only the board and the path (schema
// v67). The Job Board page and board_card's attached lane both read them here, at the moment they
// are written or read, so nothing about a file is ever stored.
//
// A client letter's counsel's-review status lives only in its review draft's first line
// (/draft letters.md section 10). That one line is read, from each `.md` at the top of the folder,
// and nothing else of the file is read or drawn. A path that leaves the matter's draft folder, by its
// stored or its real path, or whose real path lies where nothing is read (files/zones.ts), is reported and
// never read; a path with nothing at it is reported as missing, and one that cannot be read as
// unreadable, never dropped.

import { closeSync, existsSync, openSync, readdirSync, readSync, realpathSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

import { zoneProblem } from "../files/zones.js";
import type { AttachedDraft, WorkBoardData } from "./forms/render-work-board.js";

/** The hold line's opening (/draft letters.md section 10); the rest of the line is the status. */
const REVIEW_LINE = /^Counsel['’]s review:\s*/;

/** The most of a review draft read to find its first line. */
const FIRST_LINE_BYTES = 4096;

/** The file's first line, BOM stripped, read from its first few kilobytes only. */
function firstLine(file: string): string {
  const fd = openSync(file, "r");
  try {
    const buffer = Buffer.alloc(FIRST_LINE_BYTES);
    const read = readSync(fd, buffer, 0, FIRST_LINE_BYTES, 0);
    return buffer.subarray(0, read).toString("utf-8").replace(/^﻿/, "").split(/\r?\n/)[0];
  } finally {
    closeSync(fd);
  }
}

/** Each review draft's status: a `.md` (the folder's top-level ones, or the attached file itself)
 * whose first line is a counsel's-review line. A file that cannot be read says so. */
function reviewStatuses(abs: string, name: string, isFolder: boolean): { file: string; status: string }[] {
  const files = isFolder
    ? readdirSync(abs, { withFileTypes: true })
        .filter((e) => e.isFile() && /\.md$/i.test(e.name))
        .map((e) => ({ file: join(abs, e.name), label: e.name }))
        .sort((x, y) => x.label.localeCompare(y.label))
    : /\.md$/i.test(abs)
      ? [{ file: abs, label: name }]
      : [];
  const found: { file: string; status: string }[] = [];
  for (const { file, label } of files) {
    let line: string;
    try {
      line = firstLine(file);
    } catch (err) {
      found.push({ file: label, status: `unreadable (${(err as NodeJS.ErrnoException).code ?? "error"})` });
      continue;
    }
    if (REVIEW_LINE.test(line)) found.push({ file: label, status: line.replace(REVIEW_LINE, "").trim() });
  }
  return found;
}

/** Whether a path relative to the draft folder leaves it: the folder itself, `..`, a path under `..`,
 * or another drive. A name that only begins with `..`, such as `..foo`, stays inside. */
function leavesDraftFolder(rel: string): boolean {
  return rel === "" || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel);
}

/**
 * The section's attachments as found now. `draftDir` is the matter's confined `0. DRAFT*` folder,
 * whose parent is the matter root the stored paths are relative to. Confinement is checked on the
 * stored path and again on both real paths, so a junction inside the folder that leads out of it is
 * refused. A read that fails reports that one attachment `unreadable`, with its error code, and never
 * fails the page.
 */
export function attachedDrafts(draftDir: string, section: WorkBoardData): AttachedDraft[] {
  const matterRoot = dirname(draftDir);
  return section.attachments.map((a): AttachedDraft => {
    const segments = a.path.split(/[\\/]+/).filter((s) => s !== "");
    const abs = resolve(matterRoot, ...segments);
    const name = segments[segments.length - 1] ?? a.path;
    const entry = {
      id: a.id,
      kind: a.kind,
      path: a.path,
      name,
      attached_on: a.attached_on,
      proceeding_wide: section.meta.filing_id !== null && a.filing_id === null,
    };
    if (leavesDraftFolder(relative(draftDir, abs))) return { ...entry, state: "outside", review: [] };
    if (!existsSync(abs)) return { ...entry, state: "missing", review: [] };
    try {
      const real = realpathSync.native(abs);
      if (leavesDraftFolder(relative(realpathSync.native(draftDir), real)) || zoneProblem("read", real)) {
        return { ...entry, state: "outside", review: [] };
      }
      const isFolder = statSync(abs).isDirectory();
      return { ...entry, state: "present", review: a.kind === "client_letter" ? reviewStatuses(abs, name, isFolder) : [] };
    } catch (err) {
      return { ...entry, state: "unreadable", error: (err as NodeJS.ErrnoException).code ?? "error", review: [] };
    }
  });
}
