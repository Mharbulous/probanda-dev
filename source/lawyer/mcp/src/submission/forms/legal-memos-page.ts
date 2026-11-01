// The Legal Memos view page (docs/Specs/2026-10-31_legal-memos-board.md), which replaced Raw Research
// on 2026-10-31: one `Legal Memos.html` per board holding a live Writing, written by the view-page
// registry (../view-pages.ts), listing every legal memo linked to the board, its versions collapsed
// into one card. drafting_forms__board_card's `memos` lane prints the same list from the same reader,
// so a session answers "what memos do we have on X" without the page (shared/html-pages.md).
//
// A memo is a file under the matter's `6. LAW` folder, every saved version of it one memo: a research
// answer a job recorded (ticket_answers, schema v52), or a file named as one of three kinds:
//   research memo -- `.md` named `... ML re ...` or `... research-lawyer answer ...`;
//   note-up       -- `.md` named `... note-up ...`;
//   Westlaw       -- `.docx` not named after a neutral citation (a Deep Research report; decisions are `.doc`).
// Statutes, practice directions, decisions and manifests are not memos. `<stem> vN<ext>` is version N
// of `<stem><ext>`, which is version 1 (research_filing__save_answer's naming), in the same folder.
//
// Linked to a board, the one rule every board applies:
//   1. a job drawn on the board (its Writings' jobs and its proceeding's General jobs, onFilingBoard)
//      recorded any version of the memo; or
//   2. no live job in the matter recorded any version of it: nothing recorded ties it to one board,
//      so it is on every board, under No job.
// A memo recorded only by jobs on other boards is not on this one. A General Job's memo is on every
// Writing's board in its proceeding.
//
// Everything shown is recorded: the issue is each recording job's question (its intent) verbatim,
// never a summary; the facts are the facts its scope names; the status is its jobs'. Nothing is read
// from a memo's text, which names nothing of the working matter. Only file names are read from disk.

import { existsSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

import { templated } from "../../compose-template.js";
import boardCss from "../../templates/work-board/board.css.js";
import legalMemosCss from "../../templates/view-pages/legal-memos.css.js";
import legalMemosHtml from "../../templates/view-pages/legal-memos.html.js";
import legalMemosJs from "../../templates/view-pages/legal-memos.js.js";
import sharedJs from "../../templates/view-pages/shared.js.js";
import viewHeadHtml from "../../templates/view-pages/view-head.html.js";
import { rows } from "../query-rows.js";
import type { ViewPage } from "../view-pages.js";
import { buildProceedingBoard, onFilingBoard } from "./build-proceeding-board.js";
import { readTexts } from "./paragraph-map.js";
import { type FilingRow, liveTicketClause, ticketAnswersHeld } from "./query.js";
import type { WorkBoardTicket } from "./work-board-ticket.js";

/** The matter's law folder, beside its 0. DRAFT folder; ticket_answers paths start with it. */
export const LAW_FOLDER = "6. LAW";

export type MemoSource = "research_memo" | "westlaw" | "note_up";
export type MemoStatus = "in_progress" | "started" | "completed" | "no_job";

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
  /** The current version's date: from its name, else when its job saved it, else its file's. */
  date: string | null;
  version: number;
  /** The other versions' numbers, ascending. */
  earlier: number[];
  /** The current version's path from `6. LAW`, as ticket_answers stores it. */
  file: string;
  /** The current version's file URL, which the page links to. */
  url: string;
  /** False when a job recorded the file but it is not in the law folder now. */
  on_disk: boolean;
}

export interface LegalMemosData {
  memos: LegalMemo[];
}

const NEUTRAL_CITATION = /^\d{4} [A-Z]{2,}[A-Za-z]* \d+\b/;
const VERSIONED = /^(.*?)(?: v(\d+))?(\.[^.\\/]+)$/i;

/** A memo's kind from its file name alone, or null when the name is no memo's. */
export function memoSourceOf(name: string): MemoSource | null {
  const lower = name.toLowerCase();
  if (lower.endsWith(".docx")) return NEUTRAL_CITATION.test(name) ? null : "westlaw";
  if (!lower.endsWith(".md")) return null;
  if (/(?:^|\s)note-up\s/.test(lower)) return "note_up";
  if (/(?:^|\s)ml re\s/.test(lower) || lower.includes("research-lawyer answer")) return "research_memo";
  return null;
}

/** A file's version, and the key every version of it shares: folder, stem and extension, case aside. */
export function versionOf(file: string): { key: string; version: number } {
  const m = VERSIONED.exec(file) as RegExpExecArray;
  return { key: `${m[1]}${m[3]}`.toLowerCase(), version: m[2] === undefined ? 1 : Number(m[2]) };
}

interface Found {
  /** From `6. LAW`, `\`-separated. */
  file: string;
  mtime: string | null;
}

/** Every memo-named file under the law folder, by its path from `6. LAW`. Names and dates only. */
function scanLawFolder(lawDir: string): Found[] {
  if (!existsSync(lawDir)) return [];
  const out: Found[] = [];
  const walk = (dir: string, rel: string[]) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) walk(join(dir, entry.name), [...rel, entry.name]);
      else if (entry.isFile() && memoSourceOf(entry.name) !== null) {
        const mtime = statSync(join(dir, entry.name)).mtime;
        const local = new Date(mtime.getTime() - mtime.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
        out.push({ file: [LAW_FOLDER, ...rel, entry.name].join("\\"), mtime: local });
      }
    }
  };
  walk(lawDir, []);
  return out;
}

const baseName = (file: string) => file.split(/[\\/]/).pop() as string;

function titleOf(file: string): string {
  const m = VERSIONED.exec(baseName(file)) as RegExpExecArray;
  return m[1].replace(/^\d{4}-\d{2}-\d{2}\s+/, "");
}

function dateOf(file: string, savedAt: string | null, mtime: string | null): string | null {
  const name = baseName(file);
  return /^(\d{4}-\d{2}-\d{2})\b/.exec(name)?.[1] ?? /\((\d{4}-\d{2}-\d{2})\)/.exec(name)?.[1] ?? savedAt?.slice(0, 10) ?? mtime;
}

function statusOf(jobs: BoardJob[]): MemoStatus {
  if (jobs.length === 0) return "no_job";
  if (jobs.some((j) => j.category === "wip")) return "in_progress";
  if (jobs.some((j) => j.category === "completed")) return "completed";
  return "started";
}

/** Every answer path a live job in the matter recorded, lowercased. */
function recordedInMatter(dbPath: string): Set<string> {
  if (!ticketAnswersHeld(dbPath)) return new Set();
  return new Set(
    rows<{ file_path: string }>(dbPath, `SELECT ta.file_path FROM ticket_answers ta JOIN tickets t ON t.id = ta.ticket_id WHERE 1 = 1${liveTicketClause(dbPath, "t")}`).map((r) =>
      r.file_path.toLowerCase()
    )
  );
}

/**
 * The memos linked to one board (the rule in this file's header), newest first. `jobs` are the
 * board's jobs as the Milestone draws them; `lawDir` is the matter's `6. LAW` folder, which may not exist.
 */
export function buildLegalMemosData(dbPath: string, jobs: BoardJob[], lawDir: string): LegalMemosData {
  const matterDir = dirname(lawDir);
  const recorded = recordedInMatter(dbPath);
  const onDisk = new Map(scanLawFolder(lawDir).map((f) => [f.file.toLowerCase(), f]));
  const savedAt = new Map<string, string>();
  for (const j of jobs) for (const a of j.answers) savedAt.set(a.file_path.toLowerCase(), a.saved_at);

  // Each memo's versions, every recorded answer included whether or not it is on disk now.
  const groups = new Map<string, Map<number, string>>();
  for (const file of [...onDisk.values()].map((f) => f.file).concat(jobs.flatMap((j) => j.answers.map((a) => a.file_path)))) {
    const { key, version } = versionOf(file);
    const versions = groups.get(key) ?? new Map<number, string>();
    if (!versions.has(version)) versions.set(version, file);
    groups.set(key, versions);
  }

  const memos: LegalMemo[] = [];
  for (const versions of groups.values()) {
    const files = [...versions.values()].map((f) => f.toLowerCase());
    const own = jobs.filter((j) => j.answers.some((a) => files.includes(a.file_path.toLowerCase()))).sort((a, b) => a.id - b.id);
    if (own.length === 0 && files.some((f) => recorded.has(f))) continue;
    const numbers = [...versions.keys()].sort((a, b) => a - b);
    const version = numbers[numbers.length - 1];
    const file = versions.get(version) as string;
    const found = onDisk.get(file.toLowerCase());
    const segments = file.split(/[\\/]/);
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
      date: dateOf(file, savedAt.get(file.toLowerCase()) ?? null, found?.mtime ?? null),
      version,
      earlier: numbers.slice(0, -1),
      file,
      url: pathToFileURL(join(matterDir, ...segments)).href,
      on_disk: found !== undefined,
    });
  }
  memos.sort((a, b) => (b.date ?? "").localeCompare(a.date ?? "") || a.title.localeCompare(b.title));
  return { memos };
}

/** A board's jobs as its Milestone page draws them, from its live Writings: each Writing's own jobs
 * and its proceeding's General jobs, each once. */
export function boardJobs(dbPath: string, writings: { filing: FilingRow }[], rendered: string): BoardJob[] {
  const out = new Map<number, BoardJob>();
  for (const proceedingId of new Set(writings.map((w) => w.filing.proceeding_id))) {
    const ids = writings.filter((w) => w.filing.proceeding_id === proceedingId).map((w) => w.filing.id);
    for (const { filing_id, ticket } of buildProceedingBoard(dbPath, proceedingId, rendered).tickets) {
      if (ids.some((id) => onFilingBoard(filing_id, id))) out.set(ticket.id, ticket);
    }
  }
  return [...out.values()];
}

// The page's script (legal-memos.js) draws window.VIEW_PAGE.data into .board: the status lanes, and a
// folder filter, a source filter and a search in the header.
/** The page's view-page registry entry (../view-pages.ts VIEW_PAGES). */
export const LEGAL_MEMOS_PAGE: ViewPage = {
  name: "Legal Memos",
  ...templated({
    entry: "legal-memos.html",
    files: {
      "legal-memos.html": legalMemosHtml,
      "view-head.html": viewHeadHtml,
      "board.css": boardCss,
      "legal-memos.css": legalMemosCss,
      "shared.js": sharedJs,
      "legal-memos.js": legalMemosJs,
    },
  }),
  data: (ctx) => buildLegalMemosData(ctx.dbPath, boardJobs(ctx.dbPath, ctx.writings, ctx.now), join(dirname(ctx.draftDir), LAW_FOLDER)),
};
