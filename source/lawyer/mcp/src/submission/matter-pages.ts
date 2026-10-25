// The matter's pages (#1365, ADR 0033's 2026-10-05 amendment) in its 0. DRAFT folder: one Litigation
// Strategy.html at the top, and one Job Board page per board: a board's own section, or, on a
// merged board (docs/ADRs/0010), every section merged into it pooled into one board (combined-board.ts).
// A board whose survivor is a Writing has its page in that Writing's own folder as `Job Board.html`
// (spec 2026-10-22 §9; writing-folder.ts), its view pages beside it. A pre-filing proceeding's page,
// and a Job Board with no Writing's, is at the top, named by its id: `Job Board - proceeding <id>.html`,
// `Job Board <id>.html`. Every
// page is a human interface generated from the databases, and no session reads one: a session reads a
// section through a render's board_summary.
//
// The pages follow the Litigation Strategy's order of live filings, then the pre-filing proceedings. A retired
// filing has no page (D1), and nothing is written beside the database on the board's account. A proceeding-scoped job is on every filing's page in its proceeding.
//
// Every page write is a rename-replace through writeStatusFile, so no reader sees half a page and no
// in-place write is left for a sync client to fork into a numbered copy. A target that does not
// carry its page's marker is refused before any page is written, and no numbered copy is ever made.
// Old page files this generator wrote -- a retired filing's page, a proceeding's once it has a
// filing, a page under an older name, the old single Job Board.html, To Do List.html (the
// Litigation Strategy page's name before 2026-10-08), the `... - filing <id>.html` names used
// before 2026-10-09 -- are moved into the matter's TRASH (D3), never deleted.
//
// board_changed and board_moves compare against matter-pages-state.json in the records folder, never
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
//
// The work is split by responsibility, and this module re-exports each part's public names so every
// importer keeps importing matter-pages: matter-page-groups.ts (which board each section is drawn on,
// and each page's file), matter-board-section.ts (one section's data and the merged board),
// matter-page-files.ts (the page files on disk: marker guard, atomic write, TRASH sweep),
// matter-pages-build.ts (every page's HTML), matter-pages-state.ts (the state sidecar),
// board-job-text.ts, board-summary.ts and board-card-render.ts (a section as text) and board-card.ts
// (the drafting_forms__board_card entry point).

import { join } from "node:path";

import { type ClientContext, type PhaseTimings, type Ranked, timed } from "./forms.js";
import type { WorkBoardData } from "./forms/render-work-board.js";
import type { MatterDates } from "./matter-dates.js";
import { refuseForeignPages, sweepOldPages, writePage, type PagesWritten } from "./matter-page-files.js";
import { buildMatterPages } from "./matter-pages-build.js";
import type { MatterTodos } from "./matter-todos.js";

export { PAGES_STATE_FILE, TODOS_NOT_READ, persistedTodos, recordPagesState } from "./matter-pages-state.js";
export type { BoardMove } from "./matter-pages-state.js";
export { DATES_NOT_READ, filingBoardData, boardSectionOf } from "./matter-board-section.js";
export { WRITING_JOB_BOARD_FILE } from "./matter-page-groups.js";
export { refuseForeignMatterPages, pagePathFor } from "./matter-page-files.js";
export type { JobBoardPage, PagesWritten } from "./matter-page-files.js";
export { buildMatterPages } from "./matter-pages-build.js";
export type { MatterPage, MatterPagesBuilt } from "./matter-pages-build.js";
export { collapsedText } from "./board-job-text.js";
export { criterionLine, renderBoardSummary, renderLiveLanes } from "./board-summary.js";
export { CARD_LANES } from "./board-card-render.js";
export type { CardLane } from "./board-card-render.js";
export { submissionFormsBoardCard } from "./board-card.js";
export type { BoardCardArgs, BoardCardResult } from "./board-card.js";

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
