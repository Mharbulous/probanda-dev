// The Practice Board: Practice Board.html, one self-contained file beside practice.db, showing the open work
// of every matter in the practice (billable or not) in four panels: Overdue, Due today, Coming up,
// then Other open work. Written only by practice_data__render_practice_board, which joins the deadline
// lane, so no drafting session ever writes or presents it. Its internal name is practice_board, never
// practice_board (the Milestone's document type).
//
// No model reads this file (shared/html-pages.md). Practice data enters only through
// renderPracticeBoardHtml's one data line. The page draws stored dates only: it derives no deadline
// and prints no day count. A provisional alternative, a review-flagged deadline and a conflicted date
// draw flagged, as an unconfirmed date, never as a plain due date. A to-do's BF date draws as a plain
// label (ADR 0021 D2). Built from the board design template (board.css). The page itself is the
// template set in src/templates/work-board/ (map #125); this module adds only the data line.

import { type ComposedTemplate, composeTemplate, type TemplateSet } from "../../compose-template.js";
import boardCss from "../../templates/work-board/board.css.js";
import workBoardCss from "../../templates/work-board/work-board.css.js";
import workBoardHtml from "../../templates/work-board/work-board.html.js";
import workBoardJs from "../../templates/work-board/work-board.js.js";

export const PRACTICE_BOARD_FILE = "Practice Board.html";

/** On the page's root element. The overwrite guard recognises this server's own page by it. */
export const PRACTICE_BOARD_MARKER = "data-practice-board-shell";

/** One card: a deadline, an event (an anchor) or a to-do, with its matter. */
export interface PracticeBoardItem {
  kind: "deadline" | "event" | "todo";
  label: string;
  /** The stored date the item is placed by, or null for an undated to-do. */
  date: string | null;
  /** Set when the date is not a confirmed date: a provisional alternative, a review flag, a conflict. */
  flag: string | null;
  /** A to-do's BF date, a start date drawn as a plain label. */
  bf_date: string | null;
  matter: string;
  client: string;
  matter_status: string | null;
  billable: boolean;
}

export interface PracticeBoardData {
  meta: { rendered: string; today: string; horizon_days: number };
  panels: {
    overdue: PracticeBoardItem[];
    due_today: PracticeBoardItem[];
    coming_up: PracticeBoardItem[];
    other: PracticeBoardItem[];
  };
  /** Why a read failed; drawn above the panels. A failed read is never drawn as nothing due. */
  notes: string[];
  conflicted: number;
  excluded_test_matters: number;
}

export const practice_board_TEMPLATE: TemplateSet = {
  entry: "work-board.html",
  files: {
    "work-board.html": workBoardHtml,
    "board.css": boardCss,
    "work-board.css": workBoardCss,
    "work-board.js": workBoardJs,
  },
};

const PAGE = composeTemplate(practice_board_TEMPLATE.entry, practice_board_TEMPLATE.files);

/** The data line starts at column 0 and every `<` is escaped, so no recorded text can close the script.
 * `page` is the composed template, a preview's own in place of the board's. */
export function renderPracticeBoardHtml(data: PracticeBoardData, page: ComposedTemplate = PAGE): string {
  return `${page.head}window.PRACTICE_BOARD = ${JSON.stringify(data).replace(/</g, "\\u003c")};\n${page.tail}`;
}
