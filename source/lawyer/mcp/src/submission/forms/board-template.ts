// The board template: the design SSOT for every board page except the Job Board -- the Litigation
// Strategy page, every view page, and any board page added later (shared/html-pages.md, One design
// template). A new board page is built from it; an existing page moves onto it when next revised.
//
// The Job Board is its prototype and stays exempt: it keeps its own copy (WORKBOARD_CSS in
// workboard-assets.ts, plus the Job-Board-only block in workboard-shell.ts), and design changes are
// developed there first. Once a change has proved itself on the Job Board, it is promoted here by
// copying it in, in its own commit that names the change. The two copies differ between promotions
// by design. Extracted verbatim from WORKBOARD_CSS on 2026-10-14.
//
// The stylesheet itself is src/templates/work-board/board.css (map #125), which a template includes
// as board.css. Nothing in it carries matter data.

import boardCss from "../../templates/work-board/board.css.js";

/** board.css with its final newline, as the pages built on it have always carried it. */
export const BOARD_CSS = `${boardCss}\n`;
