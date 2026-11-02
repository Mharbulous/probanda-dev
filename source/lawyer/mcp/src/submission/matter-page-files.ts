// The page files on disk: their paths, the marker guard that refuses a foreign file, the atomic
// write, and the D3 TRASH sweep of old pages (matter-pages.ts has the whole picture).

import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";

import { DataServerError, ValidationError } from "../errors.js";
import { fileOpsTrash, type TrashResult } from "../file_ops/trash.js";
import { BoardIndex } from "./forms/board-members.js";
import { readExistingRevision } from "./forms.js";
import { LOOSE_THREADS_FILE, LOOSE_THREADS_PAGE_NAME } from "./forms/loose-ideas-page.js";
import { MATTER_BOARD_FILE, MATTER_BOARD_MARKER } from "./forms/matter-board-shell.js";
import { liveMembers, pageGroups, viewTargets } from "./matter-page-groups.js";
import { writeStatusFile } from "./render-job.js";
import { isViewPageFile, VIEW_PAGE_MARKER, type ViewPage, type ViewPagePath } from "./view-pages.js";
import { writingFolders } from "./writing-folder.js";

/** On every Work Board page's root element: the overwrite guard recognises this server's own page by it. */
const MILESTONE_MARKER = "data-workboard-shell";

/** A Work Board page: a live filing's (filing_id set) or a pre-filing proceeding's (filing_id null). */
export interface MilestonePage {
  filing_id: number | null;
  proceeding_id: number;
  path: string;
}

export interface PagesWritten {
  /** Every Work Board page this write put in the draft folder, in page order. */
  milestone_paths: MilestonePage[];
  matter_board_path: string;
  /** The matter's one Loose Threads page, beside the Litigation Strategy. */
  loose_threads_path: string;
  /** Every view page this write put in the draft folder (ADR 0033, 2026-10-07 amendment): each
   * live filing's, in page order, in registry order within a filing. */
  view_page_paths: ViewPagePath[];
  /** Old page files this generator wrote, moved into the matter's TRASH by this write (D3). */
  moved_to_trash?: { from: string; to: string }[];
  /** Old page files the move could not take, and why; left where they are. */
  trash_skipped?: { path: string; error: string }[];
}

/** Refuses a page target that exists without its page's marker, every page's name read from the
 * database alone: what a render checks before it lists its documents, ahead of the page
 * write itself. */
export function refuseForeignMatterPages(draftDir: string, dbPath: string): void {
  const { live, preFiling } = liveMembers(dbPath);
  const folders = writingFolders(dbPath, draftDir);
  const groups = pageGroups(new BoardIndex(dbPath), live, preFiling, folders);
  refuseForeignPages(draftDir, guardTargets(groups.map((g) => g.file), viewTargets(groups, folders)));
}

/** The page written for the section with this filing id, or with this proceeding id when the filing
 * id is null; undefined when it has none, as a retired filing has none. */
export function pagePathFor(pages: PagesWritten, section: { filing_id: number | null; proceeding_id?: number }): string | undefined {
  const { filing_id, proceeding_id } = section;
  return pages.milestone_paths.find((p) => (filing_id !== null ? p.filing_id === filing_id : p.filing_id === null && p.proceeding_id === proceeding_id))?.path;
}

/** A page file, relative to the draft folder, with the marker the overwrite guard checks it by and the page's name. */
export interface GuardTarget {
  name: string;
  marker: string;
  page: string;
}

/** The Litigation Strategy, the Loose Threads page, then the Work Board pages named in `names`, then the view pages in `views`. */
export function guardTargets(names: string[], views: { page: ViewPage; file: string }[]): GuardTarget[] {
  return [
    { name: MATTER_BOARD_FILE, marker: MATTER_BOARD_MARKER, page: "Litigation Strategy" },
    { name: LOOSE_THREADS_FILE, marker: VIEW_PAGE_MARKER, page: LOOSE_THREADS_PAGE_NAME },
    ...names.map((name) => ({ name, marker: MILESTONE_MARKER, page: "Work Board" })),
    ...views.map((v) => ({ name: v.file, marker: VIEW_PAGE_MARKER, page: v.page.name })),
  ];
}

/** Refuses, before any page is written, a target that exists without its page's marker. */
export function refuseForeignPages(draftDir: string, targets: GuardTarget[]): void {
  for (const { name, marker, page } of targets) {
    const file = join(draftDir, name);
    if (existsSync(file) && !readFileSync(file, "utf-8").includes(marker)) {
      throw new ValidationError(`refusing to overwrite ${file} -- it does not carry the ${page}'s marker, so this renderer did not write it`);
    }
  }
}

export function writePage(file: string, html: string): void {
  mkdirSync(dirname(file), { recursive: true });
  const code = writeStatusFile(file, html);
  if (code !== null) throw new DataServerError(`could not write ${file}: ${code}`);
}

/** A page file's name in any layout or copy this generator ever wrote (D3), matched case-insensitively:
 * a view page's `<page name> - filing <id>.html` is its name before 2026-10-09, and
 * `Provable Facts - Work Board <id>.html` the Material Facts page's before 2026-10-20 (docs/ADRs/0011), and
 * `Job Board …` the Work Board's name before 2026-10-28, and each board's Loose Threads page before 2026-10-29
 * (the matter's own, at the top, is a current target), and `Raw Research …` and `Legal Memos …` the Legal Research page's before 2026-10-31 and 2026-11-01. */
const OLD_PAGE = /^(?:Work Board.*|job board.*|to do list(?:-\d+)?|litigation strategy-\d+|work board.*|matter board.*|work_board @rev.*|loose ideas - filing \d+|(?:provable facts|raw research|arguments) - filing \d+|loose threads(?: - (?:filing|Work Board|job board)(?: - proceeding)? \d+)?|provable facts - Work Board(?: - proceeding)? \d+|provable facts - job board(?: - proceeding)? \d+|(?:raw research|legal memos)(?: - (?:Work Board|job board)(?: - proceeding)? \d+)?)\.html$/i;

/** A preview pages__preview wrote beside the pages (src/pages/preview.ts): never an old page, so the sweep leaves it,
 * unless it previews a page whose name is retired (RETIRED_PREVIEW). */
const PREVIEW_FILE = / preview \d+\.html$/i;
const RETIRED_PREVIEW = /^(?:raw research|legal memos)(?: - (?:Work Board|job board)(?: - proceeding)? \d+)? preview \d+\.html$/i;

/** Whether this generator wrote the file: a page marker, or a revision the Work Board's older layouts carried. */
function generatorWrote(file: string): boolean {
  const text = readFileSync(file, "utf-8");
  return text.includes(MILESTONE_MARKER) || text.includes(MATTER_BOARD_MARKER) || text.includes(VIEW_PAGE_MARKER) || readExistingRevision(file) !== undefined;
}

/**
 * D3: moves every old page file this generator wrote in `draftDir` and its immediate subfolders
 * (never deeper, never an archive folder) into the matter's TRASH, through file_ops__trash's own
 * mover: an older page name, and a registered view page no live filing has now. The current targets,
 * `names` (relative to `draftDir`) and the Litigation Strategy, stay. A file without a
 * marker is the practitioner's and is left. A file that cannot be moved -- locked, gone, or outside a
 * matter with a probanda.json -- is reported.
 */
export function sweepOldPages(draftDir: string, names: string[]): Pick<PagesWritten, "moved_to_trash" | "trash_skipped"> {
  const moved: { from: string; to: string }[] = [];
  const skipped: { path: string; error: string }[] = [];
  const targets = new Set([...names, MATTER_BOARD_FILE].map((name) => join(name).toLowerCase()));
  const subfolders = readdirSync(draftDir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && e.name.toLowerCase() !== "archive")
    .map((e) => join(draftDir, e.name));
  for (const dir of [draftDir, ...subfolders]) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const old = RETIRED_PREVIEW.test(entry.name) || (!PREVIEW_FILE.test(entry.name) && (OLD_PAGE.test(entry.name) || isViewPageFile(entry.name)));
      if (!entry.isFile() || !old) continue;
      const file = join(dir, entry.name);
      if (targets.has(relative(draftDir, file).toLowerCase())) continue;
      try {
        if (!generatorWrote(file)) continue;
        const result = fileOpsTrash(file) as TrashResult;
        moved.push({ from: result.moved_from, to: result.moved_to });
      } catch (err) {
        if (!(err instanceof DataServerError) && !["ENOENT", "EBUSY", "EPERM", "EACCES"].includes((err as NodeJS.ErrnoException).code ?? "")) throw err;
        skipped.push({ path: file, error: (err as Error).message });
      }
    }
  }
  return { ...(moved.length > 0 ? { moved_to_trash: moved } : {}), ...(skipped.length > 0 ? { trash_skipped: skipped } : {}) };
}
