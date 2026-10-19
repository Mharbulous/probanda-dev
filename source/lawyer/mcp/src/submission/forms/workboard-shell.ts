// The Job Board (docs/design/2026-09-14 work-board-local-only-design.md, amended 2026-09-15; one
// page per board section since ADR 0033's 2026-10-05 amendment): `Job Board <id>.html`
// per live Writing and `Job Board - proceeding <id>.html` per pre-filing proceeding, at the top of the
// matter's 0. DRAFT folder, each holding that one section. Its stylesheet, its data and both scripts
// are inline, so the file draws completely wherever it is opened. The page's code is identical for
// every matter; only the data line differs. The page itself is the template set in
// src/templates/job-board/ (map #125); this module adds only the data line.
//
// No model reads this file: sessions orient from the render response's board_summary. Matter data
// enters only through renderWorkBoardHtml's one data line, never through the code around it.

import { composeTemplate } from "../../compose-template.js";
import jobBoardCss from "../../templates/job-board/job-board.css.js";
import jobBoardHtml from "../../templates/job-board/job-board.html.js";
import jobBoardJs from "../../templates/job-board/job-board.js.js";
import workboardCss from "../../templates/job-board/workboard.css.js";
import workboardJs from "../../templates/job-board/workboard.js.js";
import type { MatterJobBoardData } from "./render-work-board.js";

const { head: HEAD, tail: TAIL } = composeTemplate("job-board.html", {
  "job-board.html": jobBoardHtml,
  "job-board.css": jobBoardCss,
  "job-board.js": jobBoardJs,
  "workboard.css": workboardCss,
  "workboard.js": workboardJs,
});

/** The data line starts at column 0 with meta.revision as its first key, so readExistingRevision
 * recognises the page as this renderer's own. Every `<` is escaped so no ticket text can close the script. */
export function renderWorkBoardHtml(data: MatterJobBoardData): string {
  return `${HEAD}window.WORKBOARD = ${JSON.stringify(data).replace(/</g, "\\u003c")};\n${TAIL}`;
}
