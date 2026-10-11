// Litigation Strategy data (ADR 0021; the Matter Board of #583 §2-§5, built by #585): one page for a matter,
// written by bootstrap into the top of the matter's 0. DRAFT folder before the filing picker, and
// rewritten by every render that writes presentation copies there. The matter's open to-dos lead
// it (D1), each with its BF date as a plain date (D2). Below them each filing and pre-filing
// proceeding is one line (D3); its jobs, steps and Proposals stay on its own Job Board.
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

import type { MatterTodos } from "../matter-todos.js";
import { LIFECYCLE_LABELS, type Lifecycle, type LifecycleState } from "./lifecycle.js";
import type { FilingRow, ProceedingRow } from "./query.js";
import { buildProceedingBoard, onFilingBoard, preFilingLabel, type ProceedingBoard, type WorkBoardTicket } from "./render-work-board.js";
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
    /** First key, as on the Job Board's data line. */
    revision: number;
    matter: string;
    client: string;
    rendered: string;
  };
  /** By BF date, undated last. Empty when there are none, or when they were not read. */
  todos: MatterBoardTodo[];
  /** Present only when the to-dos were not read: why. */
  todos_note?: string;
  /** In the order given, retired filings last. */
  filings: MatterBoardFiling[];
  /** In proceeding id order. */
  pre_filing: MatterBoardProceeding[];
}

const inProgress = (tickets: WorkBoardTicket[]) => tickets.filter((t) => t.category === "wip").length;

function liveLine(entry: RankedFiling, board: ProceedingBoard): MatterBoardFiling {
  return {
    filing_id: entry.filing.id,
    title: entry.filing.title,
    state: entry.lifecycle.state,
    state_label: LIFECYCLE_LABELS[entry.lifecycle.state],
    state_since: entry.lifecycle.since,
    render_state: entry.render_state,
    in_progress: inProgress(board.tickets.filter((t) => onFilingBoard(t.filing_id, entry.filing.id)).map((t) => t.ticket)),
  };
}

function retiredLine(entry: RankedFiling): MatterBoardFiling {
  return {
    filing_id: entry.filing.id,
    title: entry.filing.title,
    state: entry.lifecycle.state,
    state_label: LIFECYCLE_LABELS[entry.lifecycle.state],
    state_since: entry.lifecycle.since,
    render_state: null,
    retired_on: entry.filing.retired_on as string,
    ...(entry.filing.retirement_reason ? { retirement_reason: entry.filing.retirement_reason } : {}),
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
function todoLines(todos: MatterTodos, filings: MatterBoardFiling[], preFiling: MatterBoardProceeding[]): MatterBoardTodo[] {
  if (!("rows" in todos)) return [];
  const filingIds = new Set(filings.map((f) => f.filing_id));
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
      board = buildProceedingBoard(dbPath, proceedingId);
      boards.set(proceedingId, board);
    }
    return board;
  };

  const live = ranked.filter((r) => !r.filing.retired_on).map((r) => liveLine(r, boardFor(r.proceeding.id)));
  const retired = ranked.filter((r) => r.filing.retired_on).map(retiredLine);
  const filings = [...live, ...retired];
  const preFilingLines = preFiling.map((p) => preFilingLine(p, boardFor(p.id)));
  return {
    meta,
    todos: todoLines(todos, filings, preFilingLines),
    ...("note" in todos ? { todos_note: todos.note } : {}),
    filings,
    pre_filing: preFilingLines,
  };
}
