// Litigation Strategy data (ADR 0021; the Matter Board of #583 §2-§5, built by #585): one page for a matter,
// written by bootstrap into the top of the matter's 0. DRAFT folder before the filing picker, and
// rewritten by every render that writes presentation copies there. The matter's open to-dos lead
// it (D1), each with its BF date as a plain date (D2). Below them each filing and pre-filing
// proceeding is one line (D3); its jobs, steps and Proposals stay on its own Milestone.
//
// SQLite only for the filings (brief D1). Proposals are absent altogether: they are derived at each
// full render (#504), and a count carried from the last render goes stale when the revision moves
// (#583 §3).
//
// The filings arrive already in the order to present them in, and this page keeps that order and
// says nothing about what produced it (#583 §6): no hearing date, no time remaining, no reason. The
// lifecycle is derived with no appeal deadline, so every since-date it prints is already past. The
// to-dos arrive already stripped to what the page draws (matter-todos.ts), and are ordered by BF
// date alone.
//
// A sent letter that is not retired leaves the Writings lines and their count for the collapsed
// "Sent, awaiting response" lane, derived here at each write and stored nowhere. The lane lists; it
// tracks no response, and it changes nothing about retirement or the letter's Milestone (ADR 0042).

import type { MatterTodos } from "../matter-todos.js";
import { BoardIndex, boardKey, type BoardRef, sameBoard } from "./board-members.js";
import { LIFECYCLE_LABELS, type Lifecycle, type LifecycleState } from "./lifecycle.js";
import { fetchProse, isJobOnlyBoard, type FilingRow, type ProceedingRow } from "./query.js";
import { buildProceedingBoard, milestoneLabel, onFilingBoard, preFilingLabel, type ProceedingBoard, type WorkBoardTicket } from "./render-work-board.js";
import type { RenderState } from "../render-manifest.js";

/** One filing as the caller has already ranked it. */
export interface RankedFiling {
  proceeding: ProceedingRow;
  filing: FilingRow;
  lifecycle: Lifecycle;
  /** Null on a retired filing, which answers no render question. */
  render_state: RenderState | null;
}

/** One open registry row (ADR 0021 D1). */
export interface MatterBoardTodo {
  id: string;
  description: string;
  /** A start date, drawn as a plain date (D2). */
  bf_date: string | null;
  /** The filing its pointer names, present only when that filing is on this page (D5). */
  filing_id?: number;
  /** The pre-filing proceeding its pointer names, present only when that proceeding is on this page. */
  proceeding_id?: number;
}

/** One filing's line: name, lifecycle state, mockup status, jobs in progress (D3). */
export interface MatterBoardFiling {
  filing_id: number;
  title: string;
  state: LifecycleState;
  state_label: string;
  state_since: string | null;
  render_state: RenderState | null;
  /** Absent on a retired filing: it sits collapsed at the foot with its retirement only. */
  in_progress?: number;
  retired_on?: string;
  retirement_reason?: string;
  /** True only on a Milestone with no Writing: drawn under Milestones, never under Writings, its
   * state_label Open or Closed and its in_progress counting only its own jobs. */
  job_only?: true;
}

/** A row of the "Sent, awaiting response" lane: a sent letter not yet retired. */
export interface MatterBoardSentLetter {
  filing_id: number;
  /** The first line of the letter's addressee block; null when it has none. */
  addressee: string | null;
  /** The first line of its Re line, else the Writing's title. */
  subject: string;
  sent_on: string;
}

/** A proceeding with no filing (ADR 0018): a line of its own. */
export interface MatterBoardProceeding {
  proceeding_id: number;
  proceeding: { court_or_centre: string | null; file_number: string | null };
  state_label: string;
  in_progress: number;
}

export interface MatterBoardData {
  meta: {
    /** First key, as on the Milestone's data line. */
    revision: number;
    matter: string;
    client: string;
    rendered: string;
  };
  /** By BF date, undated last. Empty when there are none, or when they were not read. */
  todos: MatterBoardTodo[];
  /** Present only when the to-dos were not read: why. */
  todos_note?: string;
  /** In the order given, retired filings last. Holds no sent, unretired letter. */
  filings: MatterBoardFiling[];
  /** Sent, unretired letters, by sent date oldest first, then filing id. Absent when there are none. */
  awaiting_response?: MatterBoardSentLetter[];
  /** In proceeding id order. */
  pre_filing: MatterBoardProceeding[];
  /** Each merged Milestone (docs/ADRs/0010): its page's name and the live sections drawn on it, the
   * survivor's first. Those sections are drawn under it and not in their own lists. Absent when none is merged. */
  boards?: { name: string; filing_ids: number[]; proceeding_ids: number[] }[];
}

const inProgress = (tickets: WorkBoardTicket[]) => tickets.filter((t) => t.category === "wip").length;

function liveLine(entry: RankedFiling, board: ProceedingBoard): MatterBoardFiling {
  // A Milestone with no Writing holds only its own jobs: a proceeding-wide job is on the Writings' boards.
  const jobOnly = isJobOnlyBoard(entry.filing);
  const onBoard = (filingId: number | null) => (jobOnly ? filingId === entry.filing.id : onFilingBoard(filingId, entry.filing.id));
  return {
    filing_id: entry.filing.id,
    title: entry.filing.title,
    state: entry.lifecycle.state,
    state_label: jobOnly ? milestoneLabel(entry.filing) : LIFECYCLE_LABELS[entry.lifecycle.state],
    state_since: entry.lifecycle.since,
    render_state: entry.render_state,
    in_progress: inProgress(board.tickets.filter((t) => onBoard(t.filing_id)).map((t) => t.ticket)),
    ...(jobOnly ? { job_only: true as const } : {}),
  };
}

function retiredLine(entry: RankedFiling): MatterBoardFiling {
  const jobOnly = isJobOnlyBoard(entry.filing);
  return {
    filing_id: entry.filing.id,
    title: entry.filing.title,
    state: entry.lifecycle.state,
    state_label: jobOnly ? milestoneLabel(entry.filing) : LIFECYCLE_LABELS[entry.lifecycle.state],
    state_since: entry.lifecycle.since,
    render_state: null,
    retired_on: entry.filing.retired_on as string,
    ...(entry.filing.retirement_reason ? { retirement_reason: entry.filing.retirement_reason } : {}),
    ...(jobOnly ? { job_only: true as const } : {}),
  };
}

/** A kind is a letter when it names one: a venue's `letter`, or a `letter-to-*` kind. */
const LETTER_KIND = /(?:^|[^a-z])letter(?:[^a-z]|$)/i;

/** Sent (`filed_on` set), not retired, and a letter by its kind. */
function awaitingResponse(filing: FilingRow): boolean {
  return filing.filed_on !== null && !filing.retired_on && LETTER_KIND.test(filing.kind);
}

function firstLine(text: string | undefined): string | null {
  return text?.split(/\r?\n/).map((line) => line.trim()).find((line) => line !== "") ?? null;
}

function sentLetterLine(dbPath: string, filing: FilingRow): MatterBoardSentLetter {
  const prose = fetchProse(dbPath, filing.id);
  return {
    filing_id: filing.id,
    addressee: firstLine(prose.get("addressee")?.text),
    subject: firstLine(prose.get("re")?.text) ?? filing.title,
    sent_on: filing.filed_on as string,
  };
}

function preFilingLine(proceeding: ProceedingRow, board: ProceedingBoard): MatterBoardProceeding {
  return {
    proceeding_id: proceeding.id,
    proceeding: { court_or_centre: proceeding.court_or_centre, file_number: proceeding.file_number },
    state_label: preFilingLabel(proceeding),
    in_progress: inProgress(board.tickets.map((t) => t.ticket)),
  };
}

/** A pointer draws a line only when what it names is on this page; one that no longer resolves
 * draws nothing and fails nothing (ADR 0021 D5). */
function todoLines(todos: MatterTodos, filings: MatterBoardFiling[], awaiting: MatterBoardSentLetter[], preFiling: MatterBoardProceeding[]): MatterBoardTodo[] {
  if (!("rows" in todos)) return [];
  const filingIds = new Set([...filings, ...awaiting].map((f) => f.filing_id));
  const proceedingIds = new Set(preFiling.map((p) => p.proceeding_id));
  const byBfDate = (a: string | null, b: string | null) => (a === b ? 0 : a === null ? 1 : b === null ? -1 : a < b ? -1 : 1);
  return [...todos.rows]
    .sort((a, b) => byBfDate(a.bf_date, b.bf_date))
    .map((row) => {
      const [kind, id] = (row.filing_ref ?? "").split(":");
      const ref = Number(id);
      return {
        id: row.id,
        description: row.description,
        bf_date: row.bf_date,
        ...(kind === "filing" && filingIds.has(ref) ? { filing_id: ref } : {}),
        ...(kind === "proceeding" && proceedingIds.has(ref) ? { proceeding_id: ref } : {}),
      };
    });
}

export function buildMatterBoardData(
  dbPath: string,
  ranked: RankedFiling[],
  meta: MatterBoardData["meta"],
  preFiling: ProceedingRow[],
  todos: MatterTodos
): MatterBoardData {
  // One ticket read per proceeding, not per filing: proceeding-scoped rows count on every line in
  // their proceeding, so each proceeding's classification is shared by all of its lines.
  const boards = new Map<number, ProceedingBoard>();
  const boardFor = (proceedingId: number): ProceedingBoard => {
    let board = boards.get(proceedingId);
    if (board === undefined) {
      board = buildProceedingBoard(dbPath, proceedingId, meta.rendered);
      boards.set(proceedingId, board);
    }
    return board;
  };

  const live = ranked.filter((r) => !r.filing.retired_on && !awaitingResponse(r.filing)).map((r) => liveLine(r, boardFor(r.proceeding.id)));
  const retired = ranked.filter((r) => r.filing.retired_on).map(retiredLine);
  const filings = [...live, ...retired];
  const awaiting = ranked
    .filter((r) => awaitingResponse(r.filing))
    .map((r) => sentLetterLine(dbPath, r.filing))
    .sort((a, b) => (a.sent_on === b.sent_on ? a.filing_id - b.filing_id : a.sent_on < b.sent_on ? -1 : 1));
  const preFilingLines = preFiling.map((p) => preFilingLine(p, boardFor(p.id)));
  const merged = mergedBoards(new BoardIndex(dbPath), ranked, preFiling);
  return {
    meta,
    todos: todoLines(todos, filings, awaiting, preFilingLines),
    ...("note" in todos ? { todos_note: todos.note } : {}),
    filings,
    ...(awaiting.length > 0 ? { awaiting_response: awaiting } : {}),
    pre_filing: preFilingLines,
    ...(merged.length > 0 ? { boards: merged } : {}),
  };
}

/** The merged boards, each with every live section on it, the survivor's first, in the order of their first section. */
function mergedBoards(index: BoardIndex, ranked: RankedFiling[], preFiling: ProceedingRow[]): NonNullable<MatterBoardData["boards"]> {
  const groups = new Map<string, { name: string; members: BoardRef[] }>();
  const refs: BoardRef[] = [
    ...ranked.filter((r) => !r.filing.retired_on && !awaitingResponse(r.filing)).map((r) => ({ filing_id: r.filing.id, proceeding_id: r.proceeding.id })),
    ...preFiling.map((p) => ({ filing_id: null, proceeding_id: p.id })),
  ];
  for (const ref of refs) {
    const board = index.survivorOf(ref);
    const group = groups.get(boardKey(board)) ?? { name: board.filing_id === null ? `Milestone: Proceeding ${board.proceeding_id}` : `Milestone ${board.filing_id}`, members: [] };
    if (sameBoard(ref, board)) group.members.unshift(ref);
    else group.members.push(ref);
    groups.set(boardKey(board), group);
  }
  return [...groups.values()]
    .filter((g) => g.members.length > 1)
    .map((g) => ({
      name: g.name,
      filing_ids: g.members.filter((m) => m.filing_id !== null).map((m) => m.filing_id as number),
      proceeding_ids: g.members.filter((m) => m.filing_id === null).map((m) => m.proceeding_id),
    }));
}
