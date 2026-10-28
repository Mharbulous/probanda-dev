// The Milestone (workboard-shell.ts, map #125): a sha256 pin of the page it renders for the golden
// section and of the two asset constants, taken before the move to templates, and the Loose Threads
// name the page's script compares against. The pins are checked by hash only; no test reads a page.
// The page and stylesheet pins were retaken on 2026-10-28 for the rename from "Job Board" (the page's
// title, heading and a stylesheet comment).

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { assertSha256Pin } from "./helpers/sha256-pin.mjs";

const { renderWorkBoardHtml } = await import("../build/submission/forms/workboard-shell.js");
const { WORKBOARD_CSS, WORKBOARD_JS } = await import("../build/submission/forms/workboard-assets.js");
const { LOOSE_THREADS_PAGE_NAME } = await import("../build/submission/forms/loose-ideas-page.js");

const SECTION = JSON.parse(readFileSync(new URL("./fixtures/work-board-data.json", import.meta.url), "utf-8"));
const DATA = { meta: { revision: 3, matter: "L200", client: "Acme <Co>", rendered: "2026-10-19 09:30" }, sections: [SECTION] };

test("the Milestone renders byte-identically to the pinned page", () => {
  assertSha256Pin(renderWorkBoardHtml(DATA), "f6bcb4133219406bbd81c6d58b1e90ccb18888201ac0563ac88af5ad889d8dc2", "Milestone");
});

test("WORKBOARD_CSS and WORKBOARD_JS are byte-identical to the pinned constants", () => {
  assertSha256Pin(WORKBOARD_CSS, "ebe71c5f0d81fbac0884bff679027c827ee19afbd439db78ec81b32f4c5e4135", "WORKBOARD_CSS");
  assertSha256Pin(WORKBOARD_JS, "dd004682299de001f1727b8d989eac85bdfadc22e6a12b6a98fe6d772f568207", "WORKBOARD_JS");
});

test("the Loose Threads name in the Milestone's script equals LOOSE_THREADS_PAGE_NAME", () => {
  const text = readFileSync(new URL("../src/templates/milestone/milestone.js", import.meta.url), "utf8");
  assert.equal(text.match(/v\.name === "([^"]*)"/)[1], LOOSE_THREADS_PAGE_NAME);
});
