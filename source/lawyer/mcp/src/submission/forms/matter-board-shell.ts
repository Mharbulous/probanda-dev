// The Litigation Strategy (ADR 0021; the Matter Board of #583, #585): Litigation Strategy.html, one self-contained
// file at the top of a matter's 0. DRAFT folder. Like the Job Board (workboard-shell.ts) its
// stylesheet, its data and its script are all inline, so it draws completely as a lone chat file
// card (#551, ADR 0015's 2026-09-15 amendment). The page's code is identical for every matter; only
// the data line differs.
//
// No model reads this file. Matter data enters only through renderMatterBoardHtml's one data line.
// A to-do's BF date draws as a plain date: no day count, no overdue marking, no reason for its
// position (ADR 0021 D2).
//
// Live status (#589, ADR 0015's 2026-09-15 amendment) is the page's one sibling file:
// workboard-status.js, written by the background render job beside this page. The page injects it
// with a ?t= cache-buster (#587) every 2 s while the job runs. The first failed load -- a lone copy
// in a chat file card, or a page no job has written beside -- stops polling for good and hides the
// indicator, so a copy is a snapshot. No status is ever inlined here: its updated_at would be stale
// on arrival and trip the stall guard.
//
// The page itself is the template set in src/templates/matter-board/ (map #125); this module adds
// only the data line.

import { type ComposedTemplate, composeTemplate, type TemplateSet } from "../../compose-template.js";
import boardCss from "../../templates/work-board/board.css.js";
import matterBoardCss from "../../templates/matter-board/matter-board.css.js";
import matterBoardHtml from "../../templates/matter-board/matter-board.html.js";
import matterBoardJs from "../../templates/matter-board/matter-board.js.js";
import type { MatterBoardData } from "./render-matter-board.js";

export const MATTER_BOARD_FILE = "Litigation Strategy.html";

/** On the page's root element. The overwrite guard recognises this server's own page by it. */
export const MATTER_BOARD_MARKER = "data-matter-board-shell";

export const LITIGATION_STRATEGY_TEMPLATE: TemplateSet = {
  entry: "matter-board.html",
  files: {
    "matter-board.html": matterBoardHtml,
    "board.css": boardCss,
    "matter-board.css": matterBoardCss,
    "matter-board.js": matterBoardJs,
  },
};

const PAGE = composeTemplate(LITIGATION_STRATEGY_TEMPLATE.entry, LITIGATION_STRATEGY_TEMPLATE.files);

/** The data line starts at column 0 with meta.revision as its first key, and every `<` is escaped
 * so no filing title or to-do description can close the script. `page` is the composed template, a
 * preview's own in place of the board's. */
export function renderMatterBoardHtml(data: MatterBoardData, page: ComposedTemplate = PAGE): string {
  return `${page.head}window.MATTER_BOARD = ${JSON.stringify(data).replace(/</g, "\\u003c")};\n${page.tail}`;
}
