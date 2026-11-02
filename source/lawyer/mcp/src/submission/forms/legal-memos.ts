// The Legal Research page's Legal Memos tab (legal-research-page.ts; docs/Specs/2026-10-31_legal-memos-board.md):
// every legal memo linked to the board, its versions collapsed into one card.
// drafting_forms__board_card's `memos` lane prints the same list from the same reader
// and the same jobs, so a session answers "what memos do we have on X" without the page
// (shared/html-pages.md).
//
// A memo is a file under the matter's `6. LAW` folder, every saved version of it one memo: a research
// answer a job recorded (ticket_answers, schema v52), or a file named as one of three kinds:
//   research memo -- `.md` named `... ML re ...` or `... research-lawyer answer ...`;
//   note-up       -- `.md` named `... note-up ...`;
//   Westlaw       -- `.docx` not named after a neutral citation (a Deep Research report; decisions are `.doc`).
// Statutes, practice directions, decisions, case briefs and manifests are not memos. `<stem> vN<ext>` is version N
// of `<stem><ext>`, which is version 1 (research_filing__save_answer's naming), in the same folder.
//
// Linked to a board, the one rule every board applies:
//   1. a job drawn on the board (as its Milestone page draws it: its Writings' jobs, its proceeding's
//      General jobs, and on a merged board every member's) recorded any version of the memo; or
//   2. no live job drawn on any board that has a Legal Research page recorded any version of it: nothing
//      recorded ties it to such a board, so it is on every board, with status `no_job`, which the tab
//      lists under Loose Threads.
// A memo recorded only by jobs on other boards is not on this one. A General Job's memo is on every
// Writing's board in its proceeding. A memo whose only job sits on a board with no Legal Research page (a
// retired Writing's, or a Milestone with no Writing that no Writing's board absorbed) falls under rule 2.
//
// Everything shown is recorded: the issue is each recording job's question (its intent) verbatim,
// never a summary; the facts are the facts its scope names; the status is its jobs'. Nothing is read
// from a memo's text, which names nothing of the working matter. Only names and dates are read from disk.

import { existsSync, readdirSync, statSync, type Stats } from "node:fs";
import { join } from "node:path";

import { pageApiFileUrl } from "../../page-api/token.js";
import { liveMembers, pageGroups } from "../matter-page-groups.js";
import { rows } from "../query-rows.js";
import { BoardIndex } from "./board-members.js";
import { readTexts } from "./paragraph-map.js";
import { isJobOnlyBoard, isResearchWriting, liveTicketClause, ticketAnswersHeld } from "./query.js";
import type { WorkBoardTicket } from "./work-board-ticket.js";

/** The matter's law folder, beside its 0. DRAFT folder; ticket_answers paths start with it. */
export const LAW_FOLDER = "6. LAW";

export type MemoSource = "research_memo" | "westlaw" | "note_up";
export type MemoStatus = "in_progress" | "started" | "completed" | "shelved" | "no_job";

/** What the reader needs of a job on the board: the Milestone's own ticket shape. */
export type BoardJob = Pick<WorkBoardTicket, "id" | "title" | "intent" | "category" | "scope" | "answers">;

export interface LegalMemo {
  /** The current version's file name less its leading date, version and extension. */
  title: string;
  /** The folder below `6. LAW` holding it, `/`-separated; "" at its top. */
  folder: string;
  source: MemoSource;
  status: MemoStatus;
  /** Each recording job's question, its intent verbatim, in job order. Empty with no job. */
  issues: string[];
  /** The text of each fact the recording jobs' scope names, in fact order. */
  facts: string[];
  jobs: { id: number; title: string }[];
  /** The current version's date: from its name, else when its job last saved it, else its file's. */
  date: string | null;
  version: number;
  /** The other versions' numbers, ascending. */
  earlier: number[];
  /** The current version's path from `6. LAW`, as ticket_answers stores it. */
  file: string;
  /** The link that opens the current version (page-api/token.ts pageApiFileUrl), which the page shows. */
  url: string;
  /** The current version's full path, which the page shows for copying when the link cannot open it. */
  path: string;
  /** False when a job recorded the file but it is not in the law folder now. */
  on_disk: boolean;
}

export interface LegalMemosData {
  memos: LegalMemo[];
}

const NEUTRAL_CITATION = /^\d{4} [A-Z]{2,}[A-Za-z]* \d+\b/;
const VERSIONED = /^(.*?)(?: v(\d+))?(\.[^.\\/]+)$/i;
/** A file or folder that cannot be read now (locked by a sync client, permissions, gone): skipped. */
const UNREADABLE = new Set(["EPERM", "EBUSY", "EACCES", "ENOENT"]);
/** A case brief's name (shared/case-brief-template.md), which holds a decision's citation and is no memo's:
 * `[<date> ]case brief <the case>`. A filing or decision that only says "case brief" in its name opens otherwise. */
const CASE_BRIEF_OPENING = /^(?:\d{4}-\d{2}-\d{2}\s+)?case brief\s/i;

/** Whether a file name is a case brief's: only a `.md` is. */
export function isCaseBriefFile(name: string): boolean {
  return CASE_BRIEF_OPENING.test(name) && name.toLowerCase().endsWith(".md");
}

/** A memo's kind from its file name alone, or null when the name is no memo's. */
export function memoSourceOf(name: string): MemoSource | null {
  if (isCaseBriefFile(name)) return null;
  const lower = name.toLowerCase();
  if (lower.endsWith(".docx")) return NEUTRAL_CITATION.test(name) || CASE_BRIEF_OPENING.test(name) ? null : "westlaw";
  if (!lower.endsWith(".md")) return null;
  if (/(?:^|\s)note-up(?:\s|\.md$)/.test(lower)) return "note_up";
  if (/(?:^|\s)ml re(?:\s|\.md$)/.test(lower) || lower.includes("research-lawyer answer")) return "research_memo";
  return null;
}

/** A file's version, and the key every version of it shares: folder, stem and extension, case aside. */
export function versionOf(file: string): { key: string; version: number } {
  const m = VERSIONED.exec(file) as RegExpExecArray;
  return { key: `${m[1]}${m[3]}`.toLowerCase(), version: m[2] === undefined ? 1 : Number(m[2]) };
}

function localDate(stats: Stats): string {
  return new Date(stats.mtime.getTime() - stats.mtime.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

/** A file's modified date, or null when it cannot be read now. Throws on any other error. */
export function modified(path: string): string | null {
  try {
    return localDate(statSync(path));
  } catch (err) {
    if (UNREADABLE.has((err as NodeJS.ErrnoException).code ?? "")) return null;
    throw err;
  }
}

/** The matter's law folder, matched case-insensitively as research_filing matches it; `6. LAW` when there is none. */
export function lawDirOf(matterDir: string): string {
  try {
    const found = readdirSync(matterDir, { withFileTypes: true }).find((e) => e.isDirectory() && e.name.toLowerCase() === LAW_FOLDER.toLowerCase());
    return join(matterDir, found?.name ?? LAW_FOLDER);
  } catch (err) {
    if (UNREADABLE.has((err as NodeJS.ErrnoException).code ?? "")) return join(matterDir, LAW_FOLDER);
    throw err;
  }
}

export interface Found {
  /** From `6. LAW`, `\`-separated, the law folder's own name first. */
  file: string;
  mtime: string | null;
}

/** Every file under the law folder whose name `wanted` accepts, by its path from `6. LAW`. Names and
 * dates only; an unreadable folder or file is skipped. */
export function scanLawFolder(lawDir: string, wanted: (name: string) => boolean): Found[] {
  if (!existsSync(lawDir)) return [];
  const head = lawDir.split(/[\\/]/).pop() as string;
  const out: Found[] = [];
  const walk = (dir: string, rel: string[]) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch (err) {
      if (UNREADABLE.has((err as NodeJS.ErrnoException).code ?? "")) return;
      throw err;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) walk(join(dir, entry.name), [...rel, entry.name]);
      else if (entry.isFile() && wanted(entry.name)) out.push({ file: [head, ...rel, entry.name].join("\\"), mtime: modified(join(dir, entry.name)) });
    }
  };
  walk(lawDir, []);
  return out;
}

export const baseName = (file: string) => file.split(/[\\/]/).pop() as string;

export function titleOf(file: string): string {
  const m = VERSIONED.exec(baseName(file)) as RegExpExecArray;
  return m[1].replace(/^\d{4}-\d{2}-\d{2}\s+/, "");
}

export function dateOf(file: string, savedAt: string | null, mtime: string | null): string | null {
  const name = baseName(file);
  return /^(\d{4}-\d{2}-\d{2})\b/.exec(name)?.[1] ?? /\((\d{4}-\d{2}-\d{2})\)/.exec(name)?.[1] ?? savedAt?.slice(0, 10) ?? mtime;
}

/** In Progress when a saving job is held, Completed when one is completed, Shelved when every one is
 * shelved or superseded, else Started; No job with none. */
function statusOf(jobs: BoardJob[]): MemoStatus {
  if (jobs.length === 0) return "no_job";
  const open = jobs.filter((j) => j.category !== "rejected" && j.category !== "superseded");
  if (open.length === 0) return "shelved";
  if (open.some((j) => j.category === "wip")) return "in_progress";
  if (open.some((j) => j.category === "completed")) return "completed";
  return "started";
}

/** The version key of every answer a live job recorded where that job is drawn on a board that has a
 * Legal Research page: a page group holding a live Writing. A job with a filing is drawn on its filing's
 * group; a General job, or a job on a research Writing, which has no board, on each Writing's and
 * pre-filing proceeding's group in its proceeding. */
function recordedOnPagedBoards(dbPath: string): Set<string> {
  if (!ticketAnswersHeld(dbPath)) return new Set();
  const { live, preFiling } = liveMembers(dbPath);
  const paged = pageGroups(new BoardIndex(dbPath), live, preFiling, new Map()).filter((g) => g.members.some((m) => m.filing !== null && !isJobOnlyBoard(m.filing)));
  const filings = new Set(paged.flatMap((g) => g.members.flatMap((m) => (m.filing === null ? [] : [m.filing.id]))));
  const general = new Set(paged.flatMap((g) => g.members.filter((m) => m.filing === null || !isJobOnlyBoard(m.filing)).map((m) => m.proceeding.id)));
  return new Set(
    rows<{ filing_id: number | null; kind: string | null; proceeding_id: number; file_path: string }>(
      dbPath,
      `SELECT t.filing_id, f.kind, t.proceeding_id, ta.file_path FROM ticket_answers ta JOIN tickets t ON t.id = ta.ticket_id LEFT JOIN filings f ON f.id = t.filing_id WHERE 1 = 1${liveTicketClause(dbPath, "t")}`
    )
      .filter((r) => (r.filing_id === null || (r.kind !== null && isResearchWriting({ kind: r.kind })) ? general.has(r.proceeding_id) : filings.has(r.filing_id)))
      .map((r) => versionOf(r.file_path).key)
  );
}

/**
 * The memos linked to one board (the rule in this file's header), newest first. `jobs` are the
 * board's jobs as its Milestone page draws them; `matterDir` is the matter folder holding `6. LAW`.
 */
export function buildLegalMemosData(dbPath: string, jobs: BoardJob[], matterDir: string): LegalMemosData {
  const recorded = recordedOnPagedBoards(dbPath);
  const onDisk = new Map(scanLawFolder(lawDirOf(matterDir), (name) => memoSourceOf(name) !== null).map((f) => [f.file.toLowerCase(), f]));
  // The minute a path was last saved, across the board's jobs.
  const savedAt = new Map<string, string>();
  for (const j of jobs) {
    for (const a of j.answers) {
      const at = savedAt.get(a.file_path.toLowerCase());
      if (at === undefined || a.saved_at > at) savedAt.set(a.file_path.toLowerCase(), a.saved_at);
    }
  }

  // Each memo's versions, every recorded answer of the board's jobs included whether or not it is on disk now.
  const groups = new Map<string, Map<number, string>>();
  for (const file of [...onDisk.values()].map((f) => f.file).concat(jobs.flatMap((j) => j.answers.map((a) => a.file_path)))) {
    if (isCaseBriefFile(baseName(file))) continue;
    const { key, version } = versionOf(file);
    const versions = groups.get(key) ?? new Map<number, string>();
    if (!versions.has(version)) versions.set(version, file);
    groups.set(key, versions);
  }

  const memos: LegalMemo[] = [];
  for (const [key, versions] of groups) {
    const own = jobs.filter((j) => j.answers.some((a) => versionOf(a.file_path).key === key)).sort((a, b) => a.id - b.id);
    if (own.length === 0 && recorded.has(key)) continue;
    const numbers = [...versions.keys()].sort((a, b) => a - b);
    const version = numbers[numbers.length - 1];
    const file = versions.get(version) as string;
    const segments = file.split(/[\\/]/);
    const path = join(matterDir, ...segments);
    // A recorded answer whose name no kind matches is not in the scan: look for it by its own path.
    const found = onDisk.get(file.toLowerCase());
    const mtime = found !== undefined ? found.mtime : existsSync(path) ? modified(path) : undefined;
    const factIds = own.flatMap((j) => j.scope.filter((s) => s.startsWith("facts:")).map((s) => Number(s.slice("facts:".length))));
    const facts = readTexts(dbPath, "facts", factIds);
    memos.push({
      title: titleOf(file),
      folder: segments.slice(1, -1).join("/"),
      source: memoSourceOf(baseName(file)) ?? "research_memo",
      status: statusOf(own),
      issues: [...new Set(own.map((j) => j.intent.trim()).filter((i) => i !== ""))],
      facts: [...facts.keys()].sort((a, b) => a - b).map((id) => facts.get(id) as string),
      jobs: own.map((j) => ({ id: j.id, title: j.title })),
      date: dateOf(file, savedAt.get(file.toLowerCase()) ?? null, mtime ?? null),
      version,
      earlier: numbers.slice(0, -1),
      file,
      url: pageApiFileUrl(path),
      path,
      on_disk: mtime !== undefined,
    });
  }
  memos.sort((a, b) => (b.date ?? "").localeCompare(a.date ?? "") || a.title.localeCompare(b.title));
  return { memos };
}
