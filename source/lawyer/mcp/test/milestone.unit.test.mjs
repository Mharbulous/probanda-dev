// The Work Board (workboard-shell.ts, map #125): a sha256 pin of the page it renders for the golden
// section and of the two asset constants, taken before the move to templates. The pins are checked by
// hash only; no test reads a page. The page and stylesheet pins were retaken on 2026-10-28 for the
// rename from "Job Board" (the page's title, heading and a stylesheet comment), and again on
// 2026-10-29, when the Work Board stopped drawing loose threads. The page pin was retaken again on
// 2026-10-31 for the idle-flag comment in milestone.js (inlined into the page) and the fixture's
// moved activity stamp (job staleness fixtures). It was retaken on 2026-11-04 for the Blocked lane's
// label in milestone.js, whose glyph changed from a work marker to a coloured circle, which also takes
// in the page changes since the last pin (944856d8, a14c68d4).
// It was retaken on 2026-11-07 for the lapsed-lock block and the hoisted localMinute() in
// milestone.js (358b034), and again that day for the fixture's lapse fields (358b034).

import { readFileSync } from "node:fs";
import test from "node:test";

import { assertSha256Pin } from "./helpers/sha256-pin.mjs";

const { renderWorkBoardHtml } = await import("../build/submission/forms/workboard-shell.js");
const { WORKBOARD_CSS, WORKBOARD_JS } = await import("../build/submission/forms/workboard-assets.js");

const SECTION = JSON.parse(readFileSync(new URL("./fixtures/work-board-data.json", import.meta.url), "utf-8"));
const DATA = { meta: { revision: 3, matter: "L200", client: "Acme <Co>", rendered: "2026-10-19 09:30" }, sections: [SECTION] };

test("the Work Board renders byte-identically to the pinned page", () => {
  assertSha256Pin(renderWorkBoardHtml(DATA), "666c6c3053be55dbf8e6245297a042f0d7ec4bbb0c53ce68a9eee90853bea53e", "Work Board");
});

test("WORKBOARD_CSS and WORKBOARD_JS are byte-identical to the pinned constants", () => {
  assertSha256Pin(WORKBOARD_CSS, "8499455b212790bc8abc7902085fb11728b51d832f1a12b10fe9d43665f13305", "WORKBOARD_CSS");
  assertSha256Pin(WORKBOARD_JS, "dd004682299de001f1727b8d989eac85bdfadc22e6a12b6a98fe6d772f568207", "WORKBOARD_JS");
});
