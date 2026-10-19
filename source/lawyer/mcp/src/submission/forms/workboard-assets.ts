// The Job Board's stylesheet and its open-one-card / centring behaviour (design doc
// docs/design/2026-09-03 work-board-html-engine-design.md §4). Their text is the template files
// workboard.css and workboard.js in src/templates/job-board/ (map #125), which the Job Board's entry
// template includes; these constants hold the same text for the tests, which run the script in
// node:vm. Since 2026-09-15 workboard-shell.ts inlines both into every Job Board.html; neither is
// written to disk as its own file any more (local-only design, amended).
//
// Nothing here is templated, and neither string carries matter data.
//
// WORKBOARD_CSS is the Job Board's own copy and the prototype for board-template.ts, which the other
// board pages use. A proven change here is promoted there (shared/html-pages.md, One design template).

import workboardCss from "../../templates/job-board/workboard.css.js";
import workboardJs from "../../templates/job-board/workboard.js.js";

export const WORKBOARD_CSS = workboardCss + "\n";

export const WORKBOARD_JS = workboardJs + "\n";
