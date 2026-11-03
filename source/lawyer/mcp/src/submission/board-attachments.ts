// A board's attachments as found on disk (ADR 0042): a client letter's or a reply's file, or another
// party's filed document (schema v81), attached to a Work Board by a board_attachments row that holds
// only the board and the path (schema v67).
// The Work Board page and board_card's attached lane both read them here, at the moment they are
// written or read, so nothing about a file is ever stored.
//
// A client letter's counsel's-review status lives only in its first line (/draft letters.md section
// 10), which in a Word letter is its first paragraph, and a Word letter with none is approved. That
// one line is kept, and nothing else of the file is kept or drawn. A path that leaves the
// matter's draft folder, by its stored or its real path, or whose real path lies where nothing is
// read (files/zones.ts), is reported and never read; a path with nothing at it is reported as
// missing, and one that cannot be read as unreadable, never dropped.
//
// A job is linked to an attachment by a ticket_scope row naming it (`board_attachments:<id>`); its
// pending jobs are read across the whole proceeding, since a job never leaves it. The card's code is
// the file-naming registry's, through /file-naming's own name gate: no code list lives here.

import { closeSync, existsSync, openSync, readSync, realpathSync, statSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";

import { docxText } from "../files/extract/docx.js";
import { zoneProblem } from "../files/zones.js";
import { runNameGate } from "../housekeeping/name-gate.js";
import { buildProceedingBoard } from "./forms/build-proceeding-board.js";
import { fetchAllFilingsForProceeding } from "./forms/query.js";
import type { AttachedDraft, WorkBoardData } from "./forms/render-work-board.js";

/** The hold line's opening (/draft letters.md section 10); the rest of the line is the status. */
const REVIEW_LINE = /^Counsel['’]s review:\s*/;

/** The most of a review draft read to find its first line. */
const FIRST_LINE_BYTES = 4096;

/** A job's categories that count as pending: Ready, In Progress, Bring Forward and Blocked. */
const PENDING = new Set(["ready", "wip", "bring_forward", "waiting"]);

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

/** A review draft's status: the rest of its hold line. With no hold line a Word letter is approved,
 * since approval removes the line (letters.md section 10), and a Markdown draft has no status. Blank
 * paragraphs above a Word letter's line are passed over, so one typed there never reads as approved. */
export function reviewStatus(file: string): string | null {
  const word = /\.docx$/i.test(file);
  const line = word ? docxText(file).trimStart().split("\n")[0] : firstLine(file);
  if (REVIEW_LINE.test(line)) return line.replace(REVIEW_LINE, "").trim();
  return word ? "approved" : null;
}

/** Whether a path relative to the draft folder leaves it: the folder itself, `..`, a path under `..`,
 * or another drive. A name that only begins with `..`, such as `..foo`, stays inside. */
export function leavesDraftFolder(rel: string): boolean {
  return rel === "" || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel);
}

/** A local date as YYYY-MM-DD. */
function localDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * The section's attachments as found now. `draftDir` is the matter's confined `0. DRAFT*` folder,
 * whose parent is the matter root the stored paths are relative to. Confinement is checked on the
 * stored path and again on both real paths, so a junction inside the folder that leads out of it is
 * refused. A read that fails reports that one attachment `unreadable`, with its error code, and never
 * fails the page. `code` is null here; withCodes fills it.
 */
export function attachedDrafts(dbPath: string, draftDir: string, section: WorkBoardData): AttachedDraft[] {
  if (section.attachments.length === 0) return [];
  const matterRoot = dirname(draftDir);
  const writings = new Map(fetchAllFilingsForProceeding(dbPath, section.meta.proceeding_id).map((f) => [f.id, f.title]));
  const linked = buildProceedingBoard(dbPath, section.meta.proceeding_id).tickets.filter(({ ticket }) => PENDING.has(ticket.category));
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
      code: null,
      jobs: linked
        .filter(({ ticket }) => ticket.scope.includes(`board_attachments:${a.id}`))
        .map(({ filing_id, ticket }) => ({ id: ticket.id, title: ticket.title, category: ticket.category, writing: filing_id === null ? null : (writings.get(filing_id) ?? null) })),
    };
    const absent = { ...entry, modified: null, review: null };
    // Another party's filed document is in the court-file folder, so it is confined to the matter, not the draft folder.
    const base = a.kind === "opposing_filing" ? matterRoot : draftDir;
    if (leavesDraftFolder(relative(base, abs))) return { ...absent, state: "outside" };
    if (!existsSync(abs)) return { ...absent, state: "missing" };
    try {
      const real = realpathSync.native(abs);
      if (leavesDraftFolder(relative(realpathSync.native(base), real)) || zoneProblem("read", real)) {
        return { ...absent, state: "outside" };
      }
      const modified = localDate(statSync(abs).mtime);
      return { ...entry, modified, state: "present", review: a.kind === "client_letter" ? reviewStatus(abs) : null };
    } catch (err) {
      return { ...absent, state: "unreadable", error: (err as NodeJS.ErrnoException).code ?? "error" };
    }
  });
}

/** Each attachment's registry code, from one run of /file-naming's name gate over every name; null
 * where the name does not conform. A gate that cannot run never fails the page: each card says why. */
export function withCodes(drafts: AttachedDraft[]): AttachedDraft[] {
  if (drafts.length === 0) return drafts;
  try {
    const [results] = runNameGate([{ names: drafts.map((d) => d.name), flag_tokens: [] }]);
    return drafts.map((d, i) => ({ ...d, code: results[i].code }));
  } catch (err) {
    return drafts.map((d) => ({ ...d, code_error: (err as Error).message }));
  }
}
