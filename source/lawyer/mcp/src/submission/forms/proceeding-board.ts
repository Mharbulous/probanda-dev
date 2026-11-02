// drafting_forms__render with proceeding_id: a proceeding's Work Board.

import { fetchBoardFilings, fetchProceeding, fetchRevision } from "./query.js";
import { type MatterDates } from "../matter-dates.js";
import type { MatterTodos } from "../matter-todos.js";
import {
  boardSectionOf,
  DATES_NOT_READ,
  pagePathFor,
  recordPagesState,
  renderBoardSummary,
  TODOS_NOT_READ,
  writeMatterPages,
  type BoardMove,
  type PagesWritten,
} from "../matter-pages.js";
import { buildPreFilingBoardData } from "./render-work-board.js";
import { ValidationError } from "../../errors.js";
import { type ClientContext } from "./render-context.js";
import { draftDirOfCaller } from "./render-dirs.js";
import { type PhaseTimings, timed, withTotal, nowStamp } from "./timings.js";

export interface ProceedingBoardResult {
  proceeding_id: number;
  revision: number;
  /** The proceeding's section of the Work Board as fixed-grammar text, as on a filing's render. */
  board_summary: string;
  /** Present only with draft_dir, which rewrites the matter's pages: this proceeding's Work Board page,
   * every Work Board page in page order, and the Litigation Strategy. */
  milestone_path?: string;
  milestone_paths?: PagesWritten["milestone_paths"];
  matter_board_path?: string;
  loose_threads_path?: string;
  /** With draft_dir, every view page written: each live filing's (ADR 0033, 2026-10-07 amendment). */
  view_page_paths?: PagesWritten["view_page_paths"];
  moved_to_trash?: PagesWritten["moved_to_trash"];
  trash_skipped?: PagesWritten["trash_skipped"];
  /** True when this call wrote the matter's pages (draft_dir given). */
  pages_written: boolean;
  /** With draft_dir, as on a filing's Work Board document. */
  board_changed?: boolean;
  board_moves?: BoardMove[];
  session_token?: string;
  rendered_at: string;
  timings: PhaseTimings;
}

/**
 * drafting_forms__render with proceeding_id (ADR 0018): the Work Board section of a proceeding with
 * no filing, whose tickets and loose threads no filing's section can show. Nothing is written beside the
 * database; given draft_dir, the matter's pages are rewritten, this proceeding's section on a Work Board
 * page of its own (#1365, ADR 0033's 2026-10-05 amendment). A proceeding that has a filing is
 * refused: its tickets are on each filing's section.
 */
export function submissionFormsRenderProceedingBoard(
  dbPath: string,
  proceedingId: number,
  client: ClientContext = {},
  /** Test-only clock pin, as on submissionFormsRender. */
  now: string = nowStamp(),
  sessionToken?: string,
  draftDir?: string,
  /** The matter's open to-dos, for the Litigation Strategy a render under draft_dir rewrites. */
  todos: MatterTodos = TODOS_NOT_READ,
  /** The matter's hearing dates, for the Work Board page alone (ADR 0013, 2026-10-04 amendment). */
  dates: MatterDates = DATES_NOT_READ,
  /** false at session entry, which leaves the view pages to the background job. */
  views?: false
): ProceedingBoardResult {
  const timings: PhaseTimings = [];
  const started = performance.now();
  const draft = draftDir === undefined ? undefined : draftDirOfCaller(dbPath, draftDir);
  const proceeding = fetchProceeding(dbPath, proceedingId);
  if (fetchBoardFilings(dbPath, proceedingId).length > 0) {
    throw new ValidationError(
      "This proceeding has a Writing, so its jobs are on each Writing's Work Board -- render a Writing instead"
    );
  }
  const revision = fetchRevision(dbPath);
  const section = timed(timings, "board_section", () =>
    buildPreFilingBoardData(dbPath, proceeding, {
      revision,
      matter: client.matterNo ?? "",
      client: client.clientName ?? proceeding.matter_reference,
      rendered: now,
    })
  );
  let pages: PagesWritten | undefined;
  let change: ReturnType<typeof recordPagesState>;
  if (draft !== undefined) {
    pages = writeMatterPages(dbPath, draft, client, now, revision, todos, dates, timings, { section, views });
    change = recordPagesState(dbPath, todos, section, sessionToken);
  }
  return {
    proceeding_id: proceedingId,
    revision,
    board_summary: renderBoardSummary(boardSectionOf(dbPath, section, client, now, revision, dates), client, todos),
    ...(pages ?? {}),
    ...(pages !== undefined ? { milestone_path: pagePathFor(pages, section.meta) } : {}),
    pages_written: pages !== undefined,
    ...(change ?? {}),
    ...(sessionToken ? { session_token: sessionToken } : {}),
    rendered_at: now,
    timings: withTotal(timings, started),
  };
}
