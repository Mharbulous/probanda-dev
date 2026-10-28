// The Milestone (docs/design/2026-09-14 work-board-local-only-design.md, amended 2026-09-15; one
// page per board section since ADR 0033's 2026-10-05 amendment): `Milestone <id>.html`
// per live Writing and `Milestone - proceeding <id>.html` per pre-filing proceeding, at the top of the
// matter's 0. DRAFT folder, each holding that one section. Its stylesheet, its data and both scripts
// are inline, so the file draws completely wherever it is opened. The page's code is identical for
// every matter; only the data line differs. The page itself is the template set in
// src/templates/milestone/ (map #125); this module adds only the data line.
//
// No model reads this file: sessions orient from the render response's board_summary. Matter data
// enters only through renderWorkBoardHtml's one data line, never through the code around it.

import { type ComposedTemplate, composeTemplate, type TemplateSet } from "../../compose-template.js";
import milestoneCss from "../../templates/milestone/milestone.css.js";
import milestoneHtml from "../../templates/milestone/milestone.html.js";
import milestoneJs from "../../templates/milestone/milestone.js.js";
import workboardCss from "../../templates/milestone/workboard.css.js";
import workboardJs from "../../templates/milestone/workboard.js.js";
import type { MatterMilestoneData } from "./render-work-board.js";

export const MILESTONE_TEMPLATE: TemplateSet = {
  entry: "milestone.html",
  files: {
    "milestone.html": milestoneHtml,
    "milestone.css": milestoneCss,
    "milestone.js": milestoneJs,
    "workboard.css": workboardCss,
    "workboard.js": workboardJs,
  },
};

const PAGE = composeTemplate(MILESTONE_TEMPLATE.entry, MILESTONE_TEMPLATE.files);

/** The data line starts at column 0 with meta.revision as its first key, so readExistingRevision
 * recognises the page as this renderer's own. Every `<` is escaped so no ticket text can close the
 * script. `page` is the composed template, a preview's own in place of the board's. */
export function renderWorkBoardHtml(data: MatterMilestoneData, page: ComposedTemplate = PAGE): string {
  return `${page.head}window.WORKBOARD = ${JSON.stringify(data).replace(/</g, "\\u003c")};\n${page.tail}`;
}
