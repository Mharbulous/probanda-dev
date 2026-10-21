// The matter's pages (#1365, ADR 0033's 2026-10-05 amendment), at the top of its 0. DRAFT folder:
// one Litigation Strategy.html, and one Job Board page per board: a board's own section, or, on a
// merged board (docs/ADRs/0010), every section merged into it, the survivor's first. Each page is named by its database id, which a retitle never changes: a live Writing's is
// `Job Board <id>.html`, a pre-filing proceeding's `Job Board - proceeding <id>.html`. Every
// page is a human interface generated from the databases, and no session reads one: a session reads a
// section through a render's board_summary.
//
// The pages follow the Litigation Strategy's order of live filings, then the pre-filing proceedings. A retired
// filing has no page (D1), and nothing is written beside the database or in a presentation folder on
// the board's account. A proceeding-scoped job is on every filing's page in its proceeding.
//
// Every page write is a rename-replace through writeStatusFile, so no reader sees half a page and no
// in-place write is left for a sync client to fork into a numbered copy. A target that does not
// carry its page's marker is refused before any page is written, and no numbered copy is ever made.
// Old page files this generator wrote -- a retired filing's page, a proceeding's once it has a
// filing, a page under an older name, the old single Job Board.html, To Do List.html (the
// Litigation Strategy page's name before 2026-10-08), the `... - filing <id>.html` names used
// before 2026-10-09 -- are moved into the matter's TRASH (D3), never deleted.
//
// board_changed and board_moves compare against matter-pages-state.json beside the mockups, never
// against a page: the last section a foreground render reported for each filing or proceeding, kept
// also per session so a session compares against its own last report, and the last to-dos read. The
// background job cannot read practice data, so it is handed the to-dos from that file and the matter's dates from the closure it was started with. The dates are never
// persisted (ADR 0013, 2026-10-04 amendments): they reach the Job Board's HTML file and nothing else.
// A deadline linked to a filing reaches its section as a dateless Goal criterion.
//
// A session receives each page's path and never a link to it (practitioner's decision, 2026-10-03).
//
// The same write puts each live filing's view pages (view-pages.ts; ADR 0033, 2026-10-07 amendment)
// beside them, under the same marker guard, atomic write and TRASH sweep.

import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { buildStampStatus } from "../build-stamp.js";
import { DataServerError, ValidationError } from "../errors.js";
import { fileOpsTrash, type TrashResult } from "../file_ops/trash.js";
import { attachedDrafts } from "./board-attachments.js";
import { BoardIndex, boardKey, type BoardRef, sameBoard } from "./forms/board-members.js";
import type { WritingLabel } from "./forms/writing-label.js";
import { courtFileAffidavits, type CourtFileAffidavit } from "./court-file-affidavits.js";
import {
  buildContext,
  type ClientContext,
  nowStamp,
  type PhaseTimings,
  rankFilings,
  type Ranked,
  readExistingRevision,
  readSchemaVersion,
  resolveDraftDir,
  timed,
} from "./forms.js";
import { MATTER_BOARD_FILE, MATTER_BOARD_MARKER, renderMatterBoardHtml } from "./forms/matter-board-shell.js";
import {
  fetchAllFilingsForProceeding,
  fetchAllProceedings,
  fetchFiling,
  fetchPreFilingProceedings,
  fetchProceeding,
  fetchRevision,
  isJobOnlyBoard,
  type FilingRow,
  type ProceedingRow,
} from "./forms/query.js";
import { buildMatterBoardData } from "./forms/render-matter-board.js";
import {
  buildPreFilingBoardData,
  buildWorkBoardData,
  inRankOrder,
  localMinutes,
  RANK_GROUP_LABELS,
  seedOrigin,
  type AttachedDraft,
  type Category,
  type DispatchSkip,
  type GoalCriterion,
  type GoalState,
  type WorkBoardData,
  type WorkBoardEdge,
  type WorkBoardTicket,
} from "./forms/render-work-board.js";
import { renderWorkBoardHtml } from "./forms/workboard-shell.js";
import { deadlineCriteria, type MatterDates, pageDates } from "./matter-dates.js";
import type { MatterTodos } from "./matter-todos.js";
import { mockupDir, mockupsRoot, readManifest, type RenderManifest, sha256 } from "./render-manifest.js";
import { writeStatusFile } from "./render-job.js";
import { isViewPageFile, renderViewPageHtml, VIEW_PAGE_MARKER, VIEW_PAGES, viewPageFile, type ViewPage, type ViewPagePath } from "./view-pages.js";

/** On every Job Board page's root element: the overwrite guard recognises this server's own page by it. */
const JOB_BOARD_MARKER = "data-workboard-shell";

export const PAGES_STATE_FILE = "matter-pages-state.json";

/** What the Litigation Strategy draws when its caller read no to-dos: a direct call, never a tool entry point. */
export const TODOS_NOT_READ: MatterTodos = { note: "This matter's to-dos were not read." };

/** What the Job Board's header draws when its caller read no dates: a direct call, never a tool entry point. */
export const DATES_NOT_READ: MatterDates = { note: "This matter's dates were not read." };

export interface BoardMove {
  id: number;
  title: string;
  from: Category | null;
  to: Category | null;
}

/** A Job Board page: a live filing's (filing_id set) or a pre-filing proceeding's (filing_id null). */
export interface JobBoardPage {
  filing_id: number | null;
  proceeding_id: number;
  path: string;
}

export interface PagesWritten {
  /** Every Job Board page this write put at the draft folder's top, in page order. */
  job_board_paths: JobBoardPage[];
  matter_board_path: string;
  /** Every view page this write put at the draft folder's top (ADR 0033, 2026-10-07 amendment): each
   * live filing's, in page order, in registry order within a filing. */
  view_page_paths: ViewPagePath[];
  /** Old page files this generator wrote, moved into the matter's TRASH by this write (D3). */
  moved_to_trash?: { from: string; to: string }[];
  /** Old page files the move could not take, and why; left where they are. */
  trash_skipped?: { path: string; error: string }[];
}

/**
 * One filing's Job Board section, built as a render builds it, from the inventory its last render
 * saved in the manifest: a filing never rendered reads null, so its Goal card reads pending. No
 * appeal deadline on this path (bootstrap's rule), and no party is read, since the board reads none.
 * `dates` gives its linked deadlines' criteria, as a render's own section has them. `manifest` is that
 * manifest when the caller has already read it.
 */
export function filingBoardData(
  dbPath: string,
  filing: FilingRow,
  proceeding: ProceedingRow,
  client: ClientContext,
  now: string,
  revision: number,
  dates: MatterDates = DATES_NOT_READ,
  manifest: RenderManifest | null = isJobOnlyBoard(filing) ? null : readManifest(mockupDir(dbPath, filing.id))
): WorkBoardData {
  const ctx = buildContext(dbPath, proceeding, filing, [], revision, client, undefined, now);
  return buildWorkBoardData({ ...ctx, inventory: manifest?.inventory ?? null }, deadlineCriteria(dates, filing.id));
}

/** A section's Job Board page name, by the id a retitle never changes: a live filing's, or a
 * pre-filing proceeding's when `filing` is null (ADR 0033, 2026-10-05 amendments). */
export function jobBoardFile(proceeding: ProceedingRow, filing: FilingRow | null): string {
  return filing === null ? `Job Board - proceeding ${proceeding.id}.html` : `Job Board ${filing.id}.html`;
}

/** One board section's page: the section's own ids, and the file of the page it is drawn on. */
interface PageTarget {
  filing_id: number | null;
  proceeding_id: number;
  file: string;
}

/** A board section: a live filing's, or a pre-filing proceeding's (filing null). */
interface Member {
  proceeding: ProceedingRow;
  filing: FilingRow | null;
}

/** One page: its survivor board and every section drawn on it, the survivor's own first (ADR 0010). */
interface PageGroup {
  board: BoardRef;
  file: string;
  members: Member[];
}

/** A board's page name by its survivor's id. */
function boardFile(board: BoardRef): string {
  return board.filing_id === null ? `Job Board - proceeding ${board.proceeding_id}.html` : `Job Board ${board.filing_id}.html`;
}

/** The live filings, then the pre-filing proceedings, grouped by the board each is drawn on: one
 * page per survivor, in the order its first section comes, the survivor's own section first. A
 * survivor that is retired keeps its page while any section on it is live. */
function pageGroups(index: BoardIndex, live: { proceeding: ProceedingRow; filing: FilingRow }[], preFiling: ProceedingRow[]): PageGroup[] {
  const groups = new Map<string, PageGroup>();
  for (const m of [...live.map((l): Member => l), ...preFiling.map((p): Member => ({ proceeding: p, filing: null }))]) {
    const ref = { filing_id: m.filing?.id ?? null, proceeding_id: m.proceeding.id };
    const board = index.survivorOf(ref);
    const key = boardKey(board);
    const group = groups.get(key) ?? { board, file: boardFile(board), members: [] };
    if (sameBoard(ref, board)) group.members.unshift(m);
    else group.members.push(m);
    groups.set(key, group);
  }
  return [...groups.values()];
}

/** Each section's page, in page order. */
function pageTargets(groups: PageGroup[]): PageTarget[] {
  return groups.flatMap((g) => g.members.map((m) => ({ filing_id: m.filing?.id ?? null, proceeding_id: m.proceeding.id, file: g.file })));
}

/** A board's Writings, those of its sections that are live Writings: a Job Board with no Writing and a pre-filing proceeding have none. */
function writingsOf(group: PageGroup): { proceeding: ProceedingRow; filing: FilingRow }[] {
  return group.members.filter((m): m is { proceeding: ProceedingRow; filing: FilingRow } => m.filing !== null && !isJobOnlyBoard(m.filing));
}

/** A board's copy of one registered view page, across its Writings. */
interface ViewTarget {
  page: ViewPage;
  group: PageGroup;
  writings: { proceeding: ProceedingRow; filing: FilingRow }[];
  file: string;
}

/** Every registered view page for each board holding a Writing, in page order (ADR 0033, 2026-10-07
 * amendment; ADR 0010): one set per board, named by its survivor's id. */
function viewTargets(groups: PageGroup[]): ViewTarget[] {
  return groups
    .map((group) => ({ group, writings: writingsOf(group) }))
    .filter(({ writings }) => writings.length > 0)
    .flatMap(({ group, writings }) => VIEW_PAGES.map((page) => ({ page, group, writings, file: viewPageFile(page, group.board) })));
}

/** Refuses a page target that exists without its page's marker, every page's name read from the
 * database alone: what a render checks before it writes its presentation copies, ahead of the page
 * write itself. */
export function refuseForeignMatterPages(draftDir: string, dbPath: string): void {
  const proceedings = fetchAllProceedings(dbPath).map((proceeding) => ({ proceeding, filings: fetchAllFilingsForProceeding(dbPath, proceeding.id) }));
  const live = proceedings.flatMap(({ proceeding, filings }) => filings.filter((f) => !f.retired_on).map((filing) => ({ proceeding, filing })));
  const preFiling = proceedings.filter(({ filings }) => filings.length === 0).map(({ proceeding }) => proceeding);
  const groups = pageGroups(new BoardIndex(dbPath), live, preFiling);
  refuseForeignPages(draftDir, guardTargets(groups.map((g) => g.file), viewTargets(groups)));
}

/** The page written for the section with this filing id, or with this proceeding id when the filing
 * id is null; undefined when it has none, as a retired filing has none. */
export function pagePathFor(pages: PagesWritten, section: { filing_id: number | null; proceeding_id?: number }): string | undefined {
  const { filing_id, proceeding_id } = section;
  return pages.job_board_paths.find((p) => (filing_id !== null ? p.filing_id === filing_id : p.filing_id === null && p.proceeding_id === proceeding_id))?.path;
}

/** A page file at the draft folder's top, with the marker the overwrite guard checks it by and the page's name. */
interface GuardTarget {
  name: string;
  marker: string;
  page: string;
}

/** The Litigation Strategy, then the Job Board pages named in `names`, then the view pages in `views`. */
function guardTargets(names: string[], views: { page: ViewPage; file: string }[]): GuardTarget[] {
  return [
    { name: MATTER_BOARD_FILE, marker: MATTER_BOARD_MARKER, page: "Litigation Strategy" },
    ...names.map((name) => ({ name, marker: JOB_BOARD_MARKER, page: "Job Board" })),
    ...views.map((v) => ({ name: v.file, marker: VIEW_PAGE_MARKER, page: v.page.name })),
  ];
}

/** Refuses, before any page is written, a target that exists without its page's marker. */
function refuseForeignPages(draftDir: string, targets: GuardTarget[]): void {
  for (const { name, marker, page } of targets) {
    const file = join(draftDir, name);
    if (existsSync(file) && !readFileSync(file, "utf-8").includes(marker)) {
      throw new ValidationError(`refusing to overwrite ${file} -- it does not carry the ${page}'s marker, so this renderer did not write it`);
    }
  }
}

function writePage(file: string, html: string): void {
  const code = writeStatusFile(file, html);
  if (code !== null) throw new DataServerError(`could not write ${file}: ${code}`);
}

/** A file name without its extension: a Writings strip label from a manifest written before labels. */
function stem(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, "");
}

/** A page file's name in any layout or copy this generator ever wrote (D3), matched case-insensitively:
 * a view page's `<page name> - filing <id>.html` is its name before 2026-10-09, and
 * `Provable Facts - Job Board <id>.html` the Material Facts page's before 2026-10-20 (docs/ADRs/0011). */
const OLD_PAGE = /^(?:job board.*|to do list(?:-\d+)?|litigation strategy-\d+|work board.*|matter board.*|work_board @rev.*|loose ideas - filing \d+|(?:provable facts|raw research|arguments|loose threads) - filing \d+|provable facts - job board(?: - proceeding)? \d+)\.html$/i;

/** Whether this generator wrote the file: a page marker, or a revision the Job Board's older layouts carried. */
function generatorWrote(file: string): boolean {
  const text = readFileSync(file, "utf-8");
  return text.includes(JOB_BOARD_MARKER) || text.includes(MATTER_BOARD_MARKER) || text.includes(VIEW_PAGE_MARKER) || readExistingRevision(file) !== undefined;
}

/**
 * D3: moves every old page file this generator wrote in `draftDir` and its immediate subfolders
 * (never deeper, never an archive folder) into the matter's TRASH, through file_ops__trash's own
 * mover: an older page name, and a registered view page no live filing has now. The current targets
 * at the folder's top, `names` and the Litigation Strategy, stay. A file without a
 * marker is the practitioner's and is left. A file that cannot be moved -- locked, gone, or outside a
 * matter with a probanda.json -- is reported.
 */
function sweepOldPages(draftDir: string, names: string[]): Pick<PagesWritten, "moved_to_trash" | "trash_skipped"> {
  const moved: { from: string; to: string }[] = [];
  const skipped: { path: string; error: string }[] = [];
  const targets = [...names, MATTER_BOARD_FILE].map((name) => name.toLowerCase());
  const subfolders = readdirSync(draftDir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && e.name.toLowerCase() !== "archive")
    .map((e) => join(draftDir, e.name));
  for (const dir of [draftDir, ...subfolders]) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isFile() || !(OLD_PAGE.test(entry.name) || isViewPageFile(entry.name))) continue;
      if (dir === draftDir && targets.includes(entry.name.toLowerCase())) continue;
      const file = join(dir, entry.name);
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

/** One built page: its file name at the draft folder's top, its HTML, and the marker and page name
 * the overwrite guard checks an existing file by. */
export interface MatterPage {
  name: string;
  html: string;
  marker: string;
  page: string;
}

export interface MatterPagesBuilt {
  /** The pages a write puts at the draft folder's top, in write order: the Litigation Strategy, the
   * Job Board pages, then the view pages. */
  pages: MatterPage[];
  /** Every current Job Board and view page's file name, built by this call or not: what the sweep keeps. */
  keep: string[];
  /** Every current page's path, built by this call or not. */
  paths: Pick<PagesWritten, "job_board_paths" | "matter_board_path" | "view_page_paths">;
}

/**
 * Builds `<draftDir>\Litigation Strategy.html` and one Job Board page per live filing and per
 * pre-filing proceeding, each holding that one section (ADR 0033, 2026-10-05 amendment), and each live
 * filing's view pages (2026-10-07 amendment), from database state. Writes nothing: writeMatterPages
 * guards, sweeps and writes, and a preview renders the same pages without them.
 * `draftDir` is already confined (resolveDraftDir, or the parent of a confined presentation folder).
 * `reuse` hands over what the caller already built: bootstrap's ranked filings, and the section a
 * render just built for its own filing or proceeding, which then stands in for that section.
 * `reuse.only` names the one filing whose Job Board page and view pages are built, with the
 * Litigation Strategy: the background render job passes the filing it just rendered, and writes
 * every page once after its last, because building them all after every filing costs the square of
 * the filing count.
 */
export function buildMatterPages(
  dbPath: string,
  draftDir: string,
  client: ClientContext,
  now: string,
  revision: number,
  todos: MatterTodos,
  /** The matter's dates, for the Job Board pages' HTML files only: never a section, the state file or
   * the return value. A linked deadline reaches its filing's section as a dateless criterion. */
  dates: MatterDates,
  reuse: { ranked?: Ranked[]; section?: WorkBoardData; only?: number } = {}
): MatterPagesBuilt {
  const ranked = reuse.ranked ?? rankFilings(dbPath, client, now, { revision, schemaVersion: readSchemaVersion(dbPath), buildStamp: buildStampStatus().build_stamp }, []);
  const preFiling = fetchPreFilingProceedings(dbPath);
  const live = ranked.filter((r) => !r.filing.retired_on);
  const index = new BoardIndex(dbPath);
  const groups = pageGroups(index, live, preFiling);
  const targets = pageTargets(groups);
  const views = viewTargets(groups);
  const meta = {
    revision,
    matter: client.matterNo ?? "",
    client: client.clientName ?? ranked[0]?.proceeding.matter_reference ?? preFiling[0]?.matter_reference ?? "",
    rendered: now,
  };
  const own = reuse.section;
  // What this call builds: every page, or the page holding one filing.
  const { only } = reuse;
  const groupsWritten = only === undefined ? groups : groups.filter((g) => g.members.some((m) => m.filing?.id === only));
  const viewsWritten = views.filter((v) => groupsWritten.includes(v.group));
  const sectionOf = (m: Member): { section: WorkBoardData; writings: WritingLabel[] } => {
    if (m.filing === null) {
      const p = m.proceeding;
      return {
        section:
          own !== undefined && own.meta.filing_id === null && own.meta.proceeding_id === p.id
            ? own
            : buildPreFilingBoardData(dbPath, p, { revision, matter: meta.matter, client: client.clientName ?? p.matter_reference, rendered: now }),
        writings: [],
      };
    }
    // A Job Board with no Writing has no mockup folder, so none is looked up for it.
    const manifest = isJobOnlyBoard(m.filing) ? null : readManifest(mockupDir(dbPath, m.filing.id));
    return {
      section: own?.meta.filing_id === m.filing.id ? own : filingBoardData(dbPath, m.filing, m.proceeding, client, now, revision, dates, manifest),
      writings: (manifest?.files ?? []).map((f) => f.label ?? { short: stem(f.file_name), long: stem(f.file_name) }),
    };
  };
  const matterBoard = renderMatterBoardHtml(buildMatterBoardData(dbPath, ranked, meta, preFiling, todos));
  const jobBoards = groupsWritten.map((group) => {
    const built = group.members.map(sectionOf);
    const sections = distinctRows(built.map((b) => b.section));
    const { proceeding, filing } = group.members[0];
    // A page that is not its one section's own: merged, or named by a retired survivor.
    const named = group.members.length > 1 || !sameBoard(group.board, { filing_id: filing?.id ?? null, proceeding_id: proceeding.id });
    return renderWorkBoardHtml({
      meta: { ...meta, client_no: client.clientNo ?? "", forum: proceeding.forum ?? "", registry: proceeding.registry ?? "", file_number: proceeding.file_number ?? "", style_of_cause: proceeding.style_of_cause ?? "" },
      ...(named ? { board: group.board } : {}),
      sections,
      dates: pageDates(dates, sections),
      writings: built.flatMap((b) => b.writings),
      views: views.filter((v) => v.group === group).map((v) => ({ name: v.page.name, file: v.file })),
      attached: sections.flatMap((s) => attachedDrafts(draftDir, s)),
      court_file: sections.flatMap((s) =>
        s.meta.filing_id === null ? [] : courtFileAffidavits(dbPath, s.meta.filing_id, dirname(draftDir)).filter((a) => a.mismatch !== null)
      ),
    });
  });
  const viewPages = viewsWritten.map((v) => {
    const [first] = v.writings;
    return renderViewPageHtml(
      v.page,
      { filing: v.writings.map((w) => w.filing.title).join("; "), matter: meta.matter, client: meta.client, revision, rendered: now },
      v.page.data({ dbPath, filing: first.filing, proceeding: first.proceeding, writings: v.writings, now, revision })
    );
  });
  const html = [matterBoard, ...jobBoards, ...viewPages];
  return {
    pages: guardTargets(groupsWritten.map((g) => g.file), viewsWritten).map((t, i) => ({ ...t, html: html[i] })),
    keep: [...groups.map((g) => g.file), ...views.map((v) => v.file)],
    paths: {
      job_board_paths: targets.map((t) => ({ filing_id: t.filing_id, proceeding_id: t.proceeding_id, path: join(draftDir, t.file) })),
      matter_board_path: join(draftDir, MATTER_BOARD_FILE),
      view_page_paths: views.flatMap((v) => v.writings.map((w) => ({ name: v.page.name, filing_id: w.filing.id, path: join(draftDir, v.file) }))),
    },
  };
}

/** A merged page's sections with each job, deleted job and loose thread drawn once, in the first
 * section that has it: a proceeding-wide row is in every section of its proceeding. */
function distinctRows(sections: WorkBoardData[]): WorkBoardData[] {
  if (sections.length < 2) return sections;
  const seen = { tickets: new Set<number>(), seeds: new Set<number>(), deleted: new Set<number>(), discarded: new Set<number>() };
  const fresh = <T extends { id: number }>(rows: T[], ids: Set<number>): T[] =>
    rows.filter((r) => {
      if (ids.has(r.id)) return false;
      ids.add(r.id);
      return true;
    });
  return sections.map((s) => ({
    ...s,
    tickets: fresh(s.tickets, seen.tickets),
    seeds: fresh(s.seeds, seen.seeds),
    deleted: fresh(s.deleted, seen.deleted),
    discardedSeeds: fresh(s.discardedSeeds, seen.discarded),
  }));
}

/**
 * Writes the pages buildMatterPages builds (its arguments, with the same meaning), after refusing any
 * target that exists without its page's marker. A call for every page also moves old page files
 * into the matter's TRASH (D3); one filing's call leaves that to the job's last, full call.
 */
export function writeMatterPages(
  dbPath: string,
  draftDir: string,
  client: ClientContext,
  now: string,
  revision: number,
  todos: MatterTodos,
  dates: MatterDates,
  timings: PhaseTimings,
  reuse: { ranked?: Ranked[]; section?: WorkBoardData; only?: number } = {}
): PagesWritten {
  return timed(timings, "matter_pages", () => {
    const { pages, keep, paths } = buildMatterPages(dbPath, draftDir, client, now, revision, todos, dates, reuse);
    refuseForeignPages(draftDir, pages);
    const swept = reuse.only === undefined ? sweepOldPages(draftDir, keep) : {};
    for (const p of pages) writePage(join(draftDir, p.name), p.html);
    return { ...paths, ...swept };
  });
}

// ---------------------------------------------------------------------------------------------
// The state sidecar (R4): what board_changed and board_moves compare against, and the last to-dos.
// ---------------------------------------------------------------------------------------------

interface SectionState {
  key: string;
  tickets: Pick<WorkBoardTicket, "id" | "title" | "category">[];
}

interface PagesState {
  todos?: MatterTodos;
  sections: Record<string, SectionState>;
  /** Each session's own last-reported sections, by session token, in first-render order. */
  sessions?: Record<string, { sections: Record<string, SectionState> }>;
}

/** The most sessions the state file keeps a snapshot for; the one whose first render came earliest drops first. */
const MAX_SESSIONS = 20;

function statePath(dbPath: string): string {
  return join(mockupsRoot(dbPath), PAGES_STATE_FILE);
}

function isTodos(value: unknown): value is MatterTodos {
  if (typeof value !== "object" || value === null) return false;
  const todos = value as Record<string, unknown>;
  return Array.isArray(todos.rows) || typeof todos.note === "string";
}

function isSectionState(value: unknown): value is SectionState {
  if (typeof value !== "object" || value === null) return false;
  const section = value as Record<string, unknown>;
  return typeof section.key === "string" && Array.isArray(section.tickets);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The state file, or an empty one when it is missing or malformed: every section then reads as never
 * reported. A file without `sessions`, or with a malformed one, reads as having no session's snapshot. */
function readPagesState(dbPath: string): PagesState {
  try {
    const parsed = JSON.parse(readFileSync(statePath(dbPath), "utf-8")) as Record<string, unknown>;
    const sections = parsed.sections;
    if (!isRecord(sections)) return { sections: {} };
    return {
      ...(isTodos(parsed.todos) ? { todos: parsed.todos } : {}),
      sections: sections as Record<string, SectionState>,
      ...(isRecord(parsed.sessions) ? { sessions: parsed.sessions as PagesState["sessions"] } : {}),
    };
  } catch {
    return { sections: {} };
  }
}

/** One session's recorded sections, or none when it has no well-formed entry. */
function sessionSections(state: PagesState, token: string): Record<string, SectionState> {
  const entry = state.sessions?.[token] as unknown;
  return isRecord(entry) && isRecord(entry.sections) ? (entry.sections as Record<string, SectionState>) : {};
}

/** The to-dos the last call that read the registry recorded, for the background job's Litigation Strategy. */
export function persistedTodos(dbPath: string): MatterTodos {
  return readPagesState(dbPath).todos ?? TODOS_NOT_READ;
}

/** Board data compared without meta.rendered, the one field every render changes. */
function boardDataKey(data: unknown): string | undefined {
  if (data === undefined) return undefined;
  const { meta, ...rest } = JSON.parse(JSON.stringify(data)) as { meta?: Record<string, unknown> };
  const { rendered: _rendered, ...stable } = meta ?? {};
  return JSON.stringify({ ...rest, meta: stable });
}

/** #1035: the jobs that appeared, went, or changed column since the section last reported, in the
 * new board's order then the gone jobs', so a session names only a move the server compared. */
function boardMovesOf(prior: { tickets: Pick<WorkBoardTicket, "id" | "title" | "category">[] }, next: WorkBoardData): BoardMove[] {
  const before = new Map(prior.tickets.map((t) => [t.id, t]));
  const after = new Set(next.tickets.map((t) => t.id));
  const moves: BoardMove[] = [];
  for (const t of next.tickets) {
    const from = before.get(t.id)?.category ?? null;
    if (from !== t.category) moves.push({ id: t.id, title: t.title, from, to: t.category });
  }
  for (const t of before.values()) if (!after.has(t.id)) moves.push({ id: t.id, title: t.title, from: t.category, to: null });
  return moves;
}

/**
 * Records the to-dos a call read (never the not-read placeholder) and, for a foreground render that
 * wrote the pages, the section it rendered. Returns that section's board_changed -- true when no
 * section was recorded for it or the recorded one differs apart from meta.rendered -- and, when one
 * was recorded, board_moves against it. With a session token the comparison is against that
 * session's own last report of the section, or the shared one before its first, so another session's
 * render between two of this session's never hides a move from it.
 */
export function recordPagesState(
  dbPath: string,
  todos: MatterTodos,
  section?: WorkBoardData,
  sessionToken?: string
): { board_changed: boolean; board_moves?: BoardMove[] } | undefined {
  if (todos === TODOS_NOT_READ && section === undefined) return undefined;
  const state = readPagesState(dbPath);
  let change: { board_changed: boolean; board_moves?: BoardMove[] } | undefined;
  if (section !== undefined) {
    const id = section.meta.filing_id === null ? `proceeding:${section.meta.proceeding_id}` : `filing:${section.meta.filing_id}`;
    const own = sessionToken ? sessionSections(state, sessionToken) : {};
    const stored = isSectionState(own[id]) ? own[id] : isSectionState(state.sections[id]) ? state.sections[id] : undefined;
    const key = sha256(boardDataKey(section) as string);
    change = { board_changed: stored?.key !== key, ...(stored ? { board_moves: boardMovesOf(stored, section) } : {}) };
    const recorded = { key, tickets: section.tickets.map(({ id: ticketId, title, category }) => ({ id: ticketId, title, category })) };
    state.sections[id] = recorded;
    if (sessionToken) {
      const sessions = state.sessions ?? {};
      // An existing token keeps its place, so the order stays that of each session's first render.
      sessions[sessionToken] = { sections: { ...own, [id]: recorded } };
      const tokens = Object.keys(sessions);
      for (const token of tokens.slice(0, Math.max(0, tokens.length - MAX_SESSIONS))) delete sessions[token];
      state.sessions = sessions;
    }
  }
  const next: PagesState = {
    ...(todos !== TODOS_NOT_READ ? { todos } : state.todos ? { todos: state.todos } : {}),
    sections: state.sections,
    ...(state.sessions ? { sessions: state.sessions } : {}),
  };
  mkdirSync(mockupsRoot(dbPath), { recursive: true });
  const code = writeStatusFile(statePath(dbPath), JSON.stringify(next, null, 2) + "\n");
  if (code !== null) throw new DataServerError(`could not write ${statePath(dbPath)}: ${code}`);
  return change;
}

// ---------------------------------------------------------------------------------------------
// board_summary (R3) and board_card: one section as fixed-grammar text, the only board content a
// session reads. The summary is short: the matter, the client, the revision, the linked to-do, the
// statement of goals' description and status, and the unmet and met completion criteria. board_card prints the rest on request: its `live` lane
// each job as the page's collapsed card text, then a tag tail only the model sees, and its other
// lanes and jobs what a card holds when it is opened.
// ---------------------------------------------------------------------------------------------

const CRITERION_GLYPH: Record<GoalState, string> = { met: "✅", unmet: "❌", pending: "⏳" };

/** The page's chip labels (workboard-shell.ts CHIPS). The page's copy lives in inline JavaScript,
 * so this one is kept by hand; workboard-file-url.e2e's mirror test catches drift. */
const CHIP_LABELS: Record<Category, string> = {
  ready: "Ready",
  wip: "In Progress",
  bring_forward: "Bring Forward",
  waiting: "Blocked",
  superseded: "Superseded",
  completed: "Completed",
  rejected: "Shelved",
};

/** The lanes whose jobs board_card's `live` lane lists, in its order. Completed's and Shelved's
 * counts print before Superseded, and Loose Threads' and Proposed's counts after it. */
const LANES: [Category, string][] = [
  ["ready", "Ready"],
  ["wip", "In Progress"],
  ["bring_forward", "Bring Forward"],
  ["waiting", "Blocked"],
  ["superseded", "Superseded"],
];

const LIVE: ReadonlySet<Category> = new Set(["ready", "wip", "bring_forward", "waiting"]);

/** The idle report's threshold (draft/SKILL.md): a job that moved this recently gets no idle tag. */
const IDLE_AFTER_MINUTES = 15;

function counted(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}

function edgeText(edges: WorkBoardEdge[]): string {
  if (edges.length === 0) return "—";
  return edges
    .map((e) => `#${e.id} (${e.status === null ? "not in this proceeding" : e.rejected ? `${e.status}, shelved` : e.status})`)
    .join(", ");
}

type BoardProposal = WorkBoardData["proposals"][number];

/** What derives now for each key: the Proposals by key, or null on a pre-filing section, a
 * retired filing or a Job Board with no Writing, which derive none. */
function derivedOf(section: WorkBoardData): Map<string, BoardProposal> | null {
  const m = section.meta;
  return m.filing_id === null || m.state_label === "Retired" || m.job_only ? null : new Map(section.proposals.map((p) => [p.key, p]));
}

/** A held key with its stored item and, when `derived` is given, what derives for it now: the
 * Proposal's glyph and current item, or `dead` when no Proposal in any lane carries the key. */
function keyText(key: string, stored: string | undefined, derived: Map<string, BoardProposal> | null): string {
  const head = `${key} = ${JSON.stringify(stored)}`;
  if (derived === null) return head;
  const now = derived.get(key);
  return `${head} (now: ${now === undefined ? "dead" : `${now.marker} ${JSON.stringify(now.item)}`})`;
}

function skipText(s: DispatchSkip): string {
  if (s.reason === "practitioner_own") return "practitioner's own";
  if (s.reason === "either_or") return `either/or with #${s.job}`;
  if (s.reason === "before_gate") return "before the pre-filing gate";
  return `shared material with #${s.job}: ${s.material.join(", ")}`;
}

/** A job as the page draws its collapsed card: `- Job #<id> <title>`, then its subtitle, its lock
 * note and its chip, joined by ` · `, the chip followed by done/total when the job has steps. */
export function collapsedText(t: WorkBoardTicket): string {
  const done = t.steps.filter((s) => s.done_at !== null).length;
  const chip = t.steps.length > 0 ? `${CHIP_LABELS[t.category]} ${done}/${t.steps.length}` : CHIP_LABELS[t.category];
  return [`- Job #${t.id} ${t.title}`, ...(t.subtitle ? [t.subtitle] : []), ...(t.lock_note ? [t.lock_note] : []), chip].join(" · ");
}

/** Whole minutes as days, hours and minutes, dropping leading zero units only. */
function elapsedText(minutes: number): string {
  const d = Math.floor(minutes / 1440);
  const h = Math.floor((minutes % 1440) / 60);
  const m = minutes % 60;
  if (d > 0) return `${d} ${d === 1 ? "day" : "days"} ${h} h ${m} min`;
  return h > 0 ? `${h} h ${m} min` : `${m} min`;
}

/** An In progress job's idle tag, measured to the section's Rendered minute from its last activity:
 * the latest of its lock, its done steps, the loose threads captured from it, the answers saved for it
 * and the sources to get added to it or closed on it (`last_activity_at`). None within the threshold, and none with nothing to measure from. */
function idleTag(t: WorkBoardTicket, rendered: string): string | null {
  const now = localMinutes(rendered);
  const last = t.last_activity_at === null ? null : localMinutes(t.last_activity_at);
  if (now === null || last === null) return null;
  const elapsed = Math.max(0, now - last);
  if (elapsed <= IDLE_AFTER_MINUTES) return null;
  const done = t.steps.filter((s) => s.done_at !== null).length;
  return `idle ${elapsedText(elapsed)}, ${t.steps.length === 0 ? "no plan yet" : `about ${Math.floor((done / t.steps.length) * 100)}%`}`;
}

/** The tags only the model sees after a `live` lane job line: Dispatch's on a Ready job, the idle
 * report's on an In progress one, then its idle flag past the firm's threshold, and `BF <date>` on
 * a Bring Forward one: its start date as a plain date, never a deadline and never a day count. */
function tagTail(t: WorkBoardTicket, rendered: string): string {
  if (t.category === "ready") {
    const eligible = t.eligible ? "yes" : `no (${t.ineligible_reasons.join(", ")})`;
    const dispatch = t.dispatch_skips.length === 0 ? "ok" : `skip (${t.dispatch_skips.map(skipText).join("; ")})`;
    return ` · eligible: ${eligible} · dispatch: ${dispatch}`;
  }
  if (t.category === "bring_forward") return ` · BF ${t.bf_on}`;
  if (t.category !== "wip") return "";
  const idle = idleTag(t, rendered);
  return (idle === null ? "" : ` · ${idle}`) + (t.idle_flag ? ` · ${t.idle_flag}` : "");
}

/** A job's sources to get as its card prints them: the count got, then every source that is open
 * (☐) or closed not retrieved (☒, with its reason). A source got is counted and not listed. They are
 * the job's own record beside its steps, never part of its plan. */
function sourcesText(sources: WorkBoardTicket["sources"]): string {
  const got = sources.filter((s) => s.outcome === "got").length;
  const rest = sources
    .filter((s) => s.outcome !== "got")
    .map((s) => (s.outcome === null ? `☐ ${s.kind}: ${s.label}` : `☒ ${s.kind}: ${s.label} (not retrieved${s.reason === null ? "" : `: ${s.reason}`})`));
  return [`${got} of ${sources.length} got`, ...rest].join(" · ");
}

/** A job as board_card prints it. A live, completed or shelved job carries its detail, ending with
 * the open loose threads captured from it, the answers saved for it and its sources to get, then, on a completed or
 * shelved one, when it was completed or shelved; a superseded one its pointer and reason. `seeds`
 * are the section's open loose threads. */
function jobCardLines(t: WorkBoardTicket, derived: Map<string, BoardProposal> | null, seeds: WorkBoardData["seeds"]): string[] {
  const head = collapsedText(t);
  if (t.category === "superseded") {
    return [head, `  superseded by: ${t.superseded_by === null ? "—" : `#${t.superseded_by.id}`} · reason: ${t.superseded_reason ?? "—"}`];
  }
  // The holder tag's 8 matches assign-job.ts's substr(locked_by, -8). A wip job always has a holder.
  const holder = t.locked_by === null ? "" : ` · holder: ${t.locked_by.slice(-8)}`;
  const locked =
    t.category === "wip"
      ? ` · taken: ${t.locked_at ?? "(unknown time)"}${holder} · last activity: ${t.last_activity_at ?? "(unknown time)"}${t.active_at === null ? "" : ` · session active: ${t.active_at}`}`
      : "";
  const lines = [head, `  kind: ${t.kind} · priority: ${t.priority}${locked}`, `  intent: ${t.intent}`];
  if (t.proposal_keys.length > 0) lines.push(`  keys: ${t.proposal_keys.map((key) => keyText(key, t.proposal_items[key], derived)).join("; ")}`);
  lines.push(`  scope: ${t.scope.length === 0 ? "—" : t.scope.join(", ")} · waits on: ${edgeText(t.blocked_by)} · either-or: ${edgeText(t.conflicts)}`);
  if (t.steps.length > 0) {
    lines.push(`  steps: ${t.steps.map((s) => `${s.ordinal} ${s.done_at === null ? "☐" : "☑"} ${s.text}${s.done_at === null ? "" : ` (${s.done_at})`}`).join(" · ")}`);
  }
  const own = seeds.filter((s) => s.origin_ticket_id === t.id);
  if (own.length > 0) lines.push(`  loose threads: ${own.map((s) => `loose thread ${s.id}: ${JSON.stringify(s.idea)} (${s.created})`).join("; ")}`);
  if (t.answers.length > 0) lines.push(`  answers: ${t.answers.map((a) => `${a.file_path} (${a.saved_at})`).join("; ")}`);
  if (t.sources.length > 0) lines.push(`  sources to get: ${sourcesText(t.sources)}`);
  if (t.category === "bring_forward") lines.push(`  bring forward: ${t.bf_on}`);
  if (t.category === "completed") lines.push(`  completed: ${t.completed_at ?? "(unknown time)"}`);
  if (t.category === "rejected") lines.push(`  shelved: ${t.rejected_at ?? "(unknown time)"}`);
  return lines;
}

/** A Proposal's line and detail line, then, on a note-up of a statute, regulation or rule, one
 * `  step <n>:` line per provision the filing cites, or `  steps: none`. */
function proposalLines(p: BoardProposal): string[] {
  const lane = p.lane === "held" && p.holder !== null ? `held by #${p.holder.ticket_id}${p.holder.ticketed_on === null ? "" : ` on ${p.holder.ticketed_on}`}` : p.lane;
  const steps = p.steps === undefined ? [] : p.steps.length === 0 ? ["  steps: none"] : p.steps.map((s, i) => `  step ${i + 1}: ${s}`);
  return [`- ${p.marker} ${p.title}`, `  key: ${p.key} · item: ${p.item} · lane: ${lane}`, ...steps];
}

/** A criterion's counts. An inventory criterion is built from the markers still printed, so an item
 * the practitioner fixed has left it: `met` counts the items the practitioner shelved or suppressed,
 * and `total` the items still flagged, shelved or suppressed. The gate counts its open steps, or the open jobs while any is
 * open. Pending and every other criterion print no count. */
function countText(c: GoalCriterion): string {
  if (c.id === "gate") return c.outstanding > 0 ? ` (${c.outstanding} open)` : "";
  if (c.source !== "inventory" || c.state === "pending") return "";
  return ` (unmet ${c.outstanding}, met ${c.items.length - c.outstanding}, total ${c.items.length})`;
}

/** One criterion's line, with its ` — items` tail only on the card. A deadline criterion that
 * follows others in its anchor ends ` (after <their texts>)`, never a date. */
export function criterionLine(c: GoalCriterion, criteria: readonly GoalCriterion[], withItems: boolean): string {
  const items = !withItems || c.items.length === 0 ? "" : ` — ${c.items.join("; ")}`;
  const after = c.follows === undefined || c.follows.length === 0 ? "" : ` (after ${c.follows.map((id) => criteria.find((p) => p.id === id)?.text ?? id).join(", ")})`;
  return `- ${CRITERION_GLYPH[c.state]} ${c.id}: ${c.text}${after}${countText(c)}${items}`;
}

/** board_summary's Goal line: the statement of goals' description and its status, `none` when none is stored. */
function goalsHead(section: WorkBoardData): string {
  const merged = section.goals.merged ?? [];
  return `Goal: ${section.goals.description} (${section.goals.status ?? "none"})${merged.length === 0 ? "" : `, plus ${counted(merged.length, "merged statement")}`}`;
}

/** board_card's goals lane: `## Goal (<status>)`, the description, then the statement verbatim when
 * there is one, then each merged board's under `### Merged <n> (<status>)`, n being its merged_index. */
function goalsLines(section: WorkBoardData): string[] {
  const g = section.goals;
  return [
    `## Goal (${g.status ?? "none"})`,
    g.description,
    ...(g.statement === null ? [] : [g.statement]),
    ...(g.merged ?? []).flatMap((m, i) => [`### Merged ${i + 1} (${m.status})`, m.statement]),
  ];
}

/** board_card's criteria lane: the head line and one line per criterion in board order, with items. */
function goalLines(section: WorkBoardData): string[] {
  if (section.goal === undefined) return [];
  const criteria = section.criteria ?? [];
  return [`🎯 Completion criteria: ${section.goal.state}${section.goal.text === null ? "" : ` — ${section.goal.text}`}`, ...criteria.map((c) => criterionLine(c, criteria, true))];
}

function jobsIn(section: WorkBoardData, category: Category): WorkBoardTicket[] {
  return section.tickets.filter((t) => t.category === category);
}

/** As the page draws it: a Proposal held on this filing shows as its job's keys, not a line of its own. */
function proposedOf(section: WorkBoardData): BoardProposal[] {
  return section.proposals.filter((p) => p.lane === "proposed" || (p.lane === "held" && p.holder !== null && p.holder.ticketed_on !== null));
}

function shelvedProposalsOf(section: WorkBoardData): BoardProposal[] {
  return section.proposals.filter((p) => p.lane === "rejected");
}

function proposedHeading(section: WorkBoardData): string {
  return `## Proposed (${proposedOf(section).length})`;
}

function shelvedHeading(section: WorkBoardData): string {
  return `## Shelved (${counted(jobsIn(section, "rejected").length, "job")}, ${counted(shelvedProposalsOf(section).length, "proposal")})`;
}

/** A loose thread's lane line, ending ` · rank N · <group label>[ · job: "<job description>"] · <reason>` when ranked (schema v66;
 * the job description v70, absent on a loose thread ranked before it), ` · unranked` when not, then ` · deferred` when the
 * practitioner deferred it from the Loose Threads page (schema v68). The idea stays verbatim either way. */
function seedLine(s: WorkBoardData["seeds"][number]): string {
  const from = seedOrigin(s);
  const job = s.rank_job === null ? null : `job: ${JSON.stringify(s.rank_job)}`;
  const ranking = s.rank === null ? ["unranked"] : [`rank ${s.rank}`, s.rank_group === null ? null : RANK_GROUP_LABELS[s.rank_group], job, s.rank_reason];
  if (s.deferred_at !== null) ranking.push("deferred");
  return `- loose thread ${s.id}: ${JSON.stringify(s.idea)} (${[s.surfaced_by, ...(from === null ? [] : [from])].join("; ")})${ranking.map((part) => (part === null ? "" : ` · ${part}`)).join("")}`;
}

/** The To Do line: the description of the open to-do linked to this section's filing or proceeding,
 * `none linked`, or, when the to-dos were not read, why. */
function todoText(section: WorkBoardData, todos: MatterTodos): string {
  if ("note" in todos) return todos.note;
  const m = section.meta;
  const ref = m.filing_id === null ? `proceeding:${m.proceeding_id}` : `filing:${m.filing_id}`;
  return todos.rows.find((row) => row.filing_ref === ref)?.description ?? "none linked";
}

/**
 * The rendered section's summary, deterministic text with a fixed line grammar, unwrapped: the
 * header (matter number and description, client name and number, revision), `To Do:`,
 * `Goal: <description> (<status>)` (the statement of goals; `none` when none is stored), then
 * `Unmet completion criteria:` with one line per unmet or pending criterion in board order, as
 * board_card's criteria lane prints it without the items, and `Met completion criteria:` with the
 * met ids, or `none`. A section with no criteria to list (a pre-filing proceeding, a retired filing,
 * a type declaring none) prints `State: <state>` in place of both lists, with the card's text when
 * it has one. Everything else on the board is drafting_forms__board_card's.
 *
 * There a Proposal line is `- <glyph> <title>` with a detail line opening `  key:`, under
 * `## Proposed` or `## Shelved`. A job's
 * `  keys:` line prints each held key as `<key> = "<stored item>" (now: <glyph> "<current item>")`
 * when a Proposal in any lane carries that key, and `<key> = "<stored item>" (now: dead)` when none
 * does -- a Proposal held on this filing gets no line of its own, so that is where a session reads
 * whether the key still derives, its item now and its glyph. A pre-filing section or a retired
 * filing derives no Proposals at all, so there every key prints `<key> = "<stored item>"`.
 */
export function renderBoardSummary(section: WorkBoardData, client: ClientContext, todos: MatterTodos): string {
  const m = section.meta;
  const matter = [m.matter, client.matterDescription].filter((part) => part).join(" ");
  const header = [matter && `Matter ${matter}`, m.client && `Client ${m.client}${client.clientNo ? ` (${client.clientNo})` : ""}`, `Rev ${m.revision}`];
  const lines = [`# Job Board — ${header.filter((part) => part).join(" · ")}`, `To Do: ${todoText(section, todos)}`, goalsHead(section)];
  const criteria = section.criteria ?? [];
  if (section.goal === undefined || criteria.length === 0) {
    const state = m.state_since === null ? m.state_label : `${m.state_label} ${m.state_since}`;
    lines.push(`State: ${state}${section.goal?.text ? ` — ${section.goal.text}` : ""}`);
    return lines.join("\n");
  }
  const unmet = criteria.filter((c) => c.state !== "met");
  const met = criteria.filter((c) => c.state === "met").map((c) => c.id);
  lines.push(unmet.length === 0 ? "Unmet completion criteria: none" : "Unmet completion criteria:", ...unmet.map((c) => criterionLine(c, criteria, false)));
  lines.push(`Met completion criteria: ${met.length === 0 ? "none" : met.join(", ")}`);
  return lines.join("\n");
}

/**
 * board_card's `live` lane: every lane with its count, an empty one its heading alone. A job line is
 * the page's collapsed card text (collapsedText), then its tag tail: `eligible:` and `dispatch:` on a
 * Ready job, `idle` on an In progress job with no recorded activity for more than 15 minutes, measured
 * to the section's Rendered minute, then `idle past <N> h` past the firm's idle_flag_hours, and
 * `BF <date>` on a Bring Forward job, a lane printed between In Progress and Blocked. Ready
 * closes with `dispatch choice:`. Completed and Shelved print their counts alone between Blocked and
 * Superseded, Loose Threads and Proposed theirs after Superseded, a pre-filing section has no
 * Proposed, and `🧹 lapsed keys:` closes the lane when any.
 */
export function renderLiveLanes(section: WorkBoardData): string[] {
  const m = section.meta;
  const lines: string[] = [];
  for (const [category, heading] of LANES) {
    if (category === "superseded") lines.push(`## Completed (${jobsIn(section, "completed").length})`, shelvedHeading(section));
    const jobs = jobsIn(section, category);
    lines.push(`## ${heading} (${jobs.length})`);
    for (const t of jobs) lines.push(collapsedText(t) + tagTail(t, m.rendered));
    if (category === "ready") {
      const choice = jobs.find((t) => t.dispatch_skips.length === 0);
      lines.push(`dispatch choice: ${choice === undefined ? "none" : `#${choice.id} ${choice.title}`}`);
    }
  }
  lines.push(`## Loose Threads (${section.seeds.length})`);
  if (m.filing_id !== null && !m.job_only) lines.push(proposedHeading(section));
  if (section.lapsed_keys.length > 0) lines.push(`🧹 lapsed keys: ${section.lapsed_keys.join(", ")}`);
  return lines;
}

/** `goal` is the criteria lane's former name, still accepted for it; `goals` is the statement of goals. */
export type CardLane = "goals" | "criteria" | "live" | "goal" | "proposed" | "completed" | "rejected" | "loose_threads" | "attached" | "court_file";

/** board_card's lanes, in the order a card prints them. */
export const CARD_LANES: readonly CardLane[] = ["goals", "criteria", "live", "proposed", "completed", "rejected", "loose_threads", "attached", "court_file"];

const ATTACHMENT_KIND_LABELS: Record<AttachedDraft["kind"], string> = { client_letter: "client letter", reply: "reply" };

/** The attached lane (schema v67, ADR 0042): each draft attached to the board, in id order, as
 * `- attachment <id> · <kind> · <stored path> · attached <date>`, then ` · no Writing: shown on this
 * proceeding's lowest-id live Writing's board` on a row of the proceeding shown on a Writing's board,
 * then its state: ` · missing`, ` · not in the draft folder`, ` · unreadable (<code>)`, or on a client
 * letter ` · review: <status>` (each review draft's file named when there are several, `no review
 * draft` when there is none). */
function attachedLines(attached: AttachedDraft[]): string[] {
  return [
    `## Attached (${attached.length})`,
    ...attached.map((a) => {
      const parts = [`- attachment ${a.id}`, ATTACHMENT_KIND_LABELS[a.kind], a.path, `attached ${a.attached_on}`];
      if (a.proceeding_wide) parts.push("no Writing: shown on this proceeding's lowest-id live Writing's board");
      if (a.state === "missing") parts.push("missing");
      else if (a.state === "outside") parts.push("not in the draft folder");
      else if (a.state === "unreadable") parts.push(`unreadable (${a.error ?? "error"})`);
      else if (a.kind === "client_letter") {
        const review =
          a.review.length === 0 ? "no review draft" : a.review.length === 1 ? a.review[0].status : a.review.map((r) => `${r.status} (${r.file})`).join("; ");
        parts.push(`review: ${review}`);
      }
      return parts.join(" · ");
    }),
  ];
}

/** The court file lane: each affidavit the filing relies on, reconciled against the court-file folder's
 * names (court-file-affidavits.ts), as `- <label> · court file: <file name>` or `· court file: none found`
 * (with `(<note>)` when the folder could not be settled), then ` · mismatch: <text>` when the court file
 * and drafting data disagree. */
function courtFileLines(rows: CourtFileAffidavit[]): string[] {
  return [
    `## Court File (${rows.length})`,
    ...rows.map((a) => {
      const parts = [`- ${a.label}`, a.court_file === null ? `court file: none found${a.note ? ` (${a.note})` : ""}` : `court file: ${a.court_file.file_name}`];
      if (a.mismatch !== null) parts.push(`mismatch: ${a.mismatch}`);
      return parts.join(" · ");
    }),
  ];
}

/** The loose threads lane: every loose thread, or with `fromJobs` only those whose origin job is one of them,
 * the heading then giving the matching count of the lane's whole count and the jobs asked for. Both in
 * the shared rank order (inRankOrder). */
function ideasLines(section: WorkBoardData, fromJobs: number[] | undefined): string[] {
  const ordered = inRankOrder(section.seeds);
  if (fromJobs === undefined) return [`## Loose Threads (${section.seeds.length})`, ...ordered.map(seedLine)];
  const seeds = ordered.filter((s) => s.origin_ticket_id !== null && fromJobs.includes(s.origin_ticket_id));
  return [`## Loose Threads (${seeds.length} of ${section.seeds.length} from ${fromJobs.map((id) => `Job #${id}`).join(", ")})`, ...seeds.map(seedLine)];
}

/** The selected parts of a section in a fixed grammar: each job asked for in board order, then each
 * lane asked for in CARD_LANES order, then the key lookup. `attached` is the section's attachments
 * as found on disk, read only when the attached lane is asked for. */
function renderBoardCard(
  section: WorkBoardData,
  jobs: number[],
  lanes: CardLane[],
  key: string | undefined,
  seedsFromJobs: number[] | undefined,
  attached: AttachedDraft[] = [],
  courtFile: CourtFileAffidavit[] = []
): string {
  const derived = derivedOf(section);
  const lines: string[] = [];
  for (const t of section.tickets) if (jobs.includes(t.id)) lines.push(...jobCardLines(t, derived, section.seeds));
  for (const lane of CARD_LANES) {
    if (!lanes.includes(lane) && !(lane === "loose_threads" && seedsFromJobs !== undefined)) continue;
    // A Job Board with no Writing has no Proposals and no court file: those lanes print nothing, as its criteria lane does.
    if (section.meta.job_only && (lane === "proposed" || lane === "court_file")) continue;
    if (lane === "goals") lines.push(...goalsLines(section));
    if (lane === "criteria") lines.push(...goalLines(section));
    if (lane === "live") lines.push(...renderLiveLanes(section));
    if (lane === "proposed") lines.push(proposedHeading(section), ...proposedOf(section).flatMap(proposalLines));
    if (lane === "completed") lines.push(`## Completed (${jobsIn(section, "completed").length})`, ...jobsIn(section, "completed").map(collapsedText));
    if (lane === "rejected") lines.push(shelvedHeading(section), ...jobsIn(section, "rejected").map(collapsedText), ...shelvedProposalsOf(section).flatMap(proposalLines));
    if (lane === "loose_threads") lines.push(...ideasLines(section, seedsFromJobs));
    if (lane === "attached") lines.push(...attachedLines(attached));
    if (lane === "court_file") lines.push(...courtFileLines(courtFile));
  }
  if (key !== undefined) {
    const holder = section.tickets.find((t) => LIVE.has(t.category) && t.proposal_keys.includes(key));
    const proposal = section.proposals.find((p) => p.key === key);
    if (holder !== undefined) lines.push(...jobCardLines(holder, derived, section.seeds));
    else if (proposal === undefined) lines.push(`(no job or Proposal carries ${key})`);
    else lines.push(proposal.lane === "rejected" ? shelvedHeading(section) : proposedHeading(section), ...proposalLines(proposal));
  }
  return lines.join("\n");
}

export interface BoardCardArgs {
  db_path: string;
  filing_id?: number;
  proceeding_id?: number;
  jobs?: number[];
  lanes?: CardLane[];
  key?: string;
  loose_threads_from_jobs?: number[];
  /** The matter's `0. DRAFT*` folder, which the attached lane needs to find each attachment on disk,
   * and the court file lane needs for its parent, the matter folder. */
  draft_dir?: string;
}

export interface BoardCardResult {
  filing_id?: number;
  proceeding_id?: number;
  revision: number;
  rendered_at: string;
  card: string;
}

/**
 * drafting_forms__board_card: what one section's cards hold when opened, read-only. The section is
 * built as the matter pages build it -- a filing's from the inventory its last render saved, a
 * proceeding with no filing's from its jobs and loose threads -- so the card reads the inventory the
 * session's latest board_summary came from, with the current job and rejection rows, and `dates`'
 * linked deadlines as its criteria. Writes nothing, moves no revision and writes no page.
 */
export function submissionFormsBoardCard(
  args: BoardCardArgs,
  client: ClientContext = {},
  now: string = nowStamp(),
  dates: MatterDates = DATES_NOT_READ
): BoardCardResult {
  if ((args.filing_id === undefined) === (args.proceeding_id === undefined)) {
    throw new ValidationError("drafting_forms__board_card takes exactly one of filing_id and proceeding_id");
  }
  const jobs = args.jobs ?? [];
  const lanes = (args.lanes ?? []).map((lane) => (lane === "goal" ? "criteria" : lane));
  if (jobs.length === 0 && lanes.length === 0 && args.key === undefined && args.loose_threads_from_jobs === undefined) {
    throw new ValidationError("drafting_forms__board_card needs at least one of jobs, lanes, key and loose_threads_from_jobs");
  }
  if (args.loose_threads_from_jobs !== undefined && args.loose_threads_from_jobs.length === 0) {
    throw new ValidationError("drafting_forms__board_card.loose_threads_from_jobs: name at least one job id");
  }
  const unknownLanes = lanes.filter((lane) => !CARD_LANES.includes(lane));
  if (unknownLanes.length > 0) {
    throw new ValidationError(`drafting_forms__board_card.lanes: no lane ${unknownLanes.join(", ")} (lanes: ${CARD_LANES.join(", ")})`);
  }
  if (lanes.includes("attached") && args.draft_dir === undefined) {
    throw new ValidationError("drafting_forms__board_card: the attached lane needs draft_dir, the matter's 0. DRAFT folder session entry returned");
  }
  if (lanes.includes("court_file") && (args.draft_dir === undefined || args.filing_id === undefined)) {
    throw new ValidationError("drafting_forms__board_card: the court_file lane needs filing_id and draft_dir, the matter's 0. DRAFT folder session entry returned");
  }
  const draftDir = args.draft_dir === undefined ? undefined : resolveDraftDir(args.draft_dir, "drafting_forms__board_card.draft_dir");
  const revision = fetchRevision(args.db_path);
  let section: WorkBoardData;
  if (args.filing_id !== undefined) {
    const filing = fetchFiling(args.db_path, args.filing_id);
    section = filingBoardData(args.db_path, filing, fetchProceeding(args.db_path, filing.proceeding_id), client, now, revision, dates);
  } else {
    const proceeding = fetchProceeding(args.db_path, args.proceeding_id as number);
    if (fetchAllFilingsForProceeding(args.db_path, proceeding.id).length > 0) {
      throw new ValidationError(`Proceeding ${proceeding.id} has a filing, so its jobs are on each filing's Job Board -- read a card by filing_id instead`);
    }
    if (lanes.includes("criteria") || lanes.includes("proposed")) {
      throw new ValidationError(`drafting_forms__board_card: proceeding ${proceeding.id} has no filing, so its section has no completion criteria and no Proposed lane`);
    }
    section = buildPreFilingBoardData(args.db_path, proceeding, { revision, matter: client.matterNo ?? "", client: client.clientName ?? proceeding.matter_reference, rendered: now });
  }
  const missing = jobs.filter((id) => !section.tickets.some((t) => t.id === id));
  if (missing.length > 0) {
    throw new ValidationError(`drafting_forms__board_card.jobs: no ${missing.map((id) => `Job #${id}`).join(", ")} on this section`);
  }
  return {
    ...(args.filing_id !== undefined ? { filing_id: args.filing_id } : { proceeding_id: args.proceeding_id }),
    revision,
    rendered_at: now,
    card: renderBoardCard(
      section,
      jobs,
      lanes,
      args.key,
      args.loose_threads_from_jobs,
      lanes.includes("attached") && draftDir !== undefined ? attachedDrafts(draftDir, section) : [],
      lanes.includes("court_file") && draftDir !== undefined && args.filing_id !== undefined ? courtFileAffidavits(args.db_path, args.filing_id, dirname(draftDir)) : []
    ),
  };
}
