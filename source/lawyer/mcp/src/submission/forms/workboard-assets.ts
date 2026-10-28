// The Milestone's stylesheet and its open-one-card / centring behaviour (design doc
// docs/design/2026-09-03 work-board-html-engine-design.md §4). Their text is the template files
// workboard.css and workboard.js in src/templates/milestone/ (map #125), which the Milestone's entry
// template includes; these constants hold the same text for the tests, which run the script in
// node:vm. Since 2026-09-15 workboard-shell.ts inlines both into every Milestone.html; neither is
// written to disk as its own file any more (local-only design, amended).
//
// Nothing here is templated, and neither string carries matter data.
//
// WORKBOARD_CSS is the Milestone's own copy and the prototype for templates/work-board/board.css,
// which the other board pages use. A proven change here is promoted there (shared/html-pages.md, One design template).

import workboardCss from "../../templates/milestone/workboard.css.js";
import workboardJs from "../../templates/milestone/workboard.js.js";

export const WORKBOARD_CSS = workboardCss + "\n";

export const WORKBOARD_JS = workboardJs + "\n";
