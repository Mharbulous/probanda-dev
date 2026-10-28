// Which board each live filing and pre-filing proceeding is drawn on, and the file each Milestone
// page and view page goes in (matter-pages.ts has the whole picture).

import { join } from "node:path";

import { BoardIndex, boardKey, type BoardRef, sameBoard } from "./forms/board-members.js";
import { fetchAllFilingsForProceeding, fetchAllProceedings, isJobOnlyBoard, type FilingRow, type ProceedingRow } from "./forms/query.js";
import { VIEW_PAGES, viewPageFile, type ViewPage } from "./view-pages.js";
import type { WritingFolder } from "./writing-folder.js";

/** One board section's page: the section's own ids, and the file of the page it is drawn on. */
export interface PageTarget {
  filing_id: number | null;
  proceeding_id: number;
  file: string;
}

/** A board section: a live filing's, or a pre-filing proceeding's (filing null). */
export interface Member {
  proceeding: ProceedingRow;
  filing: FilingRow | null;
}

/** One page: its survivor board and every section drawn on it, the survivor's own first (ADR 0010). */
export interface PageGroup {
  board: BoardRef;
  file: string;
  members: Member[];
}

/** A Writing's Milestone page, in the Writing's own folder (spec 2026-10-22 §9). */
export const WRITING_JOB_BOARD_FILE = "Milestone.html";

/** The draft folder's subfolder a board's pages go in: its survivor Writing's own folder, or none for
 * a board whose survivor is a pre-filing proceeding or a Milestone with no Writing. */
function boardFolder(board: BoardRef, folders: ReadonlyMap<number, WritingFolder>): string | undefined {
  return board.filing_id === null ? undefined : folders.get(board.filing_id)?.name;
}

/** A board's page, relative to the draft folder: `Milestone.html` in its survivor Writing's folder,
 * else at the top, named by its survivor's id. */
function boardFile(board: BoardRef, folders: ReadonlyMap<number, WritingFolder>): string {
  const folder = boardFolder(board, folders);
  if (folder !== undefined) return join(folder, WRITING_JOB_BOARD_FILE);
  return board.filing_id === null ? `Milestone - proceeding ${board.proceeding_id}.html` : `Milestone ${board.filing_id}.html`;
}

/** The live filings, then the pre-filing proceedings, grouped by the board each is drawn on: one
 * page per survivor, in the order its first section comes, the survivor's own section first. A
 * survivor that is retired keeps its page while any section on it is live. */
export function pageGroups(
  index: BoardIndex,
  live: { proceeding: ProceedingRow; filing: FilingRow }[],
  preFiling: ProceedingRow[],
  folders: ReadonlyMap<number, WritingFolder>
): PageGroup[] {
  const groups = new Map<string, PageGroup>();
  for (const m of [...live.map((l): Member => l), ...preFiling.map((p): Member => ({ proceeding: p, filing: null }))]) {
    const ref = { filing_id: m.filing?.id ?? null, proceeding_id: m.proceeding.id };
    const board = index.survivorOf(ref);
    const key = boardKey(board);
    const group = groups.get(key) ?? { board, file: boardFile(board, folders), members: [] };
    if (sameBoard(ref, board)) group.members.unshift(m);
    else group.members.push(m);
    groups.set(key, group);
  }
  return [...groups.values()];
}

/** A member's board: its filing's, or its pre-filing proceeding's. */
export function memberRef(m: Member): BoardRef {
  return { filing_id: m.filing?.id ?? null, proceeding_id: m.proceeding.id };
}

/** Every live filing and every pre-filing proceeding, read from the database alone. */
export function liveMembers(dbPath: string): { live: { proceeding: ProceedingRow; filing: FilingRow }[]; preFiling: ProceedingRow[] } {
  const proceedings = fetchAllProceedings(dbPath).map((proceeding) => ({ proceeding, filings: fetchAllFilingsForProceeding(dbPath, proceeding.id) }));
  return {
    live: proceedings.flatMap(({ proceeding, filings }) => filings.filter((f) => !f.retired_on).map((filing) => ({ proceeding, filing }))),
    preFiling: proceedings.filter(({ filings }) => filings.length === 0).map(({ proceeding }) => proceeding),
  };
}

/** Each section's page, in page order. */
export function pageTargets(groups: PageGroup[]): PageTarget[] {
  return groups.flatMap((g) => g.members.map((m) => ({ filing_id: m.filing?.id ?? null, proceeding_id: m.proceeding.id, file: g.file })));
}

/** A board's Writings, those of its sections that are live Writings: a Milestone with no Writing and a pre-filing proceeding have none. */
function writingsOf(group: PageGroup): { proceeding: ProceedingRow; filing: FilingRow }[] {
  return group.members.filter((m): m is { proceeding: ProceedingRow; filing: FilingRow } => m.filing !== null && !isJobOnlyBoard(m.filing));
}

/** A board's copy of one registered view page, across its Writings. */
export interface ViewTarget {
  page: ViewPage;
  group: PageGroup;
  writings: { proceeding: ProceedingRow; filing: FilingRow }[];
  file: string;
}

/** Every registered view page for each board holding a Writing, in page order (ADR 0033, 2026-10-07
 * amendment; ADR 0010): one set per board, beside its Milestone page. */
export function viewTargets(groups: PageGroup[], folders: ReadonlyMap<number, WritingFolder>): ViewTarget[] {
  return groups
    .map((group) => ({ group, writings: writingsOf(group) }))
    .filter(({ writings }) => writings.length > 0)
    .flatMap(({ group, writings }) => VIEW_PAGES.map((page) => ({ page, group, writings, file: viewPageFile(page, group.board, boardFolder(group.board, folders)) })));
}
