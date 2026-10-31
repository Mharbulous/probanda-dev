// The Milestone (workboard-shell.ts, map #125): a sha256 pin of the page it renders for the golden
// section and of the two asset constants, taken before the move to templates. The pins are checked by
// hash only; no test reads a page. The page and stylesheet pins were retaken on 2026-10-28 for the
// rename from "Job Board" (the page's title, heading and a stylesheet comment), and again on
// 2026-10-29, when the Milestone stopped drawing loose threads. The page pin was retaken again on
// 2026-10-31 for the idle-flag comment in milestone.js (inlined into the page) and the fixture's
// moved activity stamp (job staleness fixtures).

import { readFileSync } from "node:fs";
import test from "node:test";

import { assertSha256Pin } from "./helpers/sha256-pin.mjs";

const { renderWorkBoardHtml } = await import("../build/submission/forms/workboard-shell.js");
const { WORKBOARD_CSS, WORKBOARD_JS } = await import("../build/submission/forms/workboard-assets.js");

const SECTION = JSON.parse(readFileSync(new URL("./fixtures/work-board-data.json", import.meta.url), "utf-8"));
const DATA = { meta: { revision: 3, matter: "L200", client: "Acme <Co>", rendered: "2026-10-19 09:30" }, sections: [SECTION] };

test("the Milestone renders byte-identically to the pinned page", () => {
  assertSha256Pin(renderWorkBoardHtml(DATA), "f60f7376d721512f345d1541b1a871d95380b6edd504efc4152acb4c25ec5c33", "Milestone");
});

test("WORKBOARD_CSS and WORKBOARD_JS are byte-identical to the pinned constants", () => {
  assertSha256Pin(WORKBOARD_CSS, "0e1619a4db186bc9cf790434487009f1caa72250cb87ef2e1c05aac73a0e4414", "WORKBOARD_CSS");
  assertSha256Pin(WORKBOARD_JS, "dd004682299de001f1727b8d989eac85bdfadc22e6a12b6a98fe6d772f568207", "WORKBOARD_JS");
});
