// Merged Work Boards (docs/ADRs/0010-milestones-organized-by-goals.md): which board each board's
// section is drawn on. A merge writes one db_meta row per absorbed board, never a table of its own:
// key `board_member:filing:<id>` or `board_member:proceeding:<id>`, value JSON {filing_id,
// proceeding_id} naming the survivor (filing_id null for a pre-filing proceeding's board). Jobs keep
// their own filing_id, so nothing else is rewritten. A board with no row is its own survivor.
//
// A pre-filing board is its proceeding's until the proceeding gets a Writing (ADR 0018). Then the
// proceeding's first Writing takes its place: a row absorbing the proceeding absorbs that Writing,
// and a row naming the proceeding as survivor names that Writing.
//
// A research Writing (query.ts isResearchWriting) is never a board, so here it is never a proceeding's
// first Writing, and a membership row naming one, written before merge_milestones refused it, is read as
// no row: the other board stands alone.

import { isJobOnlyBoard, isResearchWriting, type FilingRow } from "./query.js";
import { rows } from "../query-rows.js";

/** A board: a filing's (a Writing or a Work Board with no Writing), or a pre-filing proceeding's (filing_id null). */
export interface BoardRef {
  filing_id: number | null;
  proceeding_id: number;
}

const PREFIX = "board_member:";

/** The db_meta key of an absorbed board's membership row. */
export function memberKey(board: BoardRef): string {
  return board.filing_id === null ? `${PREFIX}proceeding:${board.proceeding_id}` : `${PREFIX}filing:${board.filing_id}`;
}

export function sameBoard(a: BoardRef, b: BoardRef): boolean {
  return a.filing_id === b.filing_id && (a.filing_id !== null || a.proceeding_id === b.proceeding_id);
}

/** The page key of a board, the same for every board drawn on one page. */
export function boardKey(board: BoardRef): string {
  return board.filing_id === null ? `proceeding:${board.proceeding_id}` : `filing:${board.filing_id}`;
}

/** Every board's survivor, read once: the membership rows and every filing's id, proceeding and kind. */
export class BoardIndex {
  private readonly rows = new Map<string, BoardRef>();
  private readonly firstFiling = new Map<number, Pick<FilingRow, "id" | "proceeding_id" | "kind">>();
  readonly filings: Pick<FilingRow, "id" | "proceeding_id" | "kind">[];

  constructor(dbPath: string) {
    this.filings = rows<Pick<FilingRow, "id" | "proceeding_id" | "kind">>(dbPath, "SELECT id, proceeding_id, kind FROM filings ORDER BY id");
    for (const f of this.filings) if (!isResearchWriting(f) && !this.firstFiling.has(f.proceeding_id)) this.firstFiling.set(f.proceeding_id, f);
    const research = this.filings.filter(isResearchWriting);
    const absorbedResearch = new Set(research.map((f) => memberKey({ filing_id: f.id, proceeding_id: f.proceeding_id })));
    for (const r of rows<{ key: string; value: string }>(dbPath, `SELECT key, value FROM db_meta WHERE key GLOB '${PREFIX}*'`)) {
      const v = JSON.parse(r.value) as BoardRef;
      if (absorbedResearch.has(r.key) || research.some((f) => f.id === v.filing_id)) continue;
      this.rows.set(r.key, { filing_id: v.filing_id ?? null, proceeding_id: v.proceeding_id });
    }
  }

  /** A pre-filing board whose proceeding now has a Writing is that first Writing's board. */
  private current(board: BoardRef): BoardRef {
    if (board.filing_id !== null) return board;
    const first = this.firstFiling.get(board.proceeding_id);
    return first === undefined ? board : { filing_id: first.id, proceeding_id: first.proceeding_id };
  }

  /** The row that absorbed this board: its own, or, for a proceeding's first Writing, the proceeding's. */
  private rowOf(board: BoardRef): BoardRef | undefined {
    const own = this.rows.get(memberKey(board));
    if (own !== undefined || board.filing_id === null) return own;
    return this.firstFiling.get(board.proceeding_id)?.id === board.filing_id
      ? this.rows.get(memberKey({ filing_id: null, proceeding_id: board.proceeding_id }))
      : undefined;
  }

  /** The board this one's section is drawn on: itself unless a merge absorbed it. */
  survivorOf(board: BoardRef): BoardRef {
    const target = this.rowOf(this.current(board));
    return target === undefined ? this.current(board) : this.current(target);
  }

  /** Whether a merge absorbed this board. */
  absorbed(board: BoardRef): boolean {
    return this.rowOf(this.current(board)) !== undefined;
  }

  /** Every membership row whose survivor is `board`, by key. */
  membersOf(board: BoardRef): string[] {
    return [...this.rows.entries()].filter(([, target]) => sameBoard(this.current(target), this.current(board))).map(([key]) => key);
  }

  /** Whether some row names this proceeding's own board as survivor: its statement of goals then outlives the proceeding's first Writing. */
  proceedingSurvives(proceedingId: number): boolean {
    return [...this.rows.values()].some((t) => t.filing_id === null && t.proceeding_id === proceedingId);
  }

  /** Whether this filing's board took over a surviving pre-filing board: it is its proceeding's first filing, and some row names that proceeding as survivor. */
  inheritsProceeding(board: BoardRef): boolean {
    return board.filing_id !== null && this.firstFiling.get(board.proceeding_id)?.id === board.filing_id && this.proceedingSurvives(board.proceeding_id);
  }

  /** The survivor rank of a board (ADR 0010): a Writing's board first, then a Work Board with no
   * Writing, then a pre-filing board; within a kind, the lower id. */
  rank(board: BoardRef): [number, number] {
    const b = this.current(board);
    if (b.filing_id === null) return [2, b.proceeding_id];
    const f = this.filings.find((x) => x.id === b.filing_id);
    return [f !== undefined && isJobOnlyBoard(f) ? 1 : 0, b.filing_id];
  }
}
