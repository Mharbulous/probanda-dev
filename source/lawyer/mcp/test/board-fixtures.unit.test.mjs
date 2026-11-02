// The boards' placeholder fixtures (map #125, #141): each renders through its board's own render
// function with its data line intact, and none holds a machine path (#140). tsc checks each fixture's
// shape against the board's data type. No test reads a page: each checks the data line it put there.

import assert from "node:assert/strict";
import test from "node:test";

const { renderPracticeBoardHtml } = await import("../build/submission/forms/practice-board-shell.js");
const { renderMatterBoardHtml } = await import("../build/submission/forms/matter-board-shell.js");
const { renderWorkBoardHtml } = await import("../build/submission/forms/workboard-shell.js");
const { VIEW_PAGES, renderViewPageHtml } = await import("../build/submission/view-pages.js");
const { LOOSE_IDEAS_PAGE } = await import("../build/submission/forms/loose-ideas-page.js");
const { renderApprovalPage } = await import("../build/housekeeping/page.js");
const { PRACTICE_BOARD_FIXTURE } = await import("../build/board-fixtures/practice-board.js");
const { LITIGATION_STRATEGY_FIXTURE } = await import("../build/board-fixtures/litigation-strategy.js");
const { MILESTONE_FIXTURE } = await import("../build/board-fixtures/milestone.js");
const { PROCEDURAL_HISTORY_FIXTURE } = await import("../build/board-fixtures/procedural-history.js");
const { MATERIAL_FACTS_FIXTURE } = await import("../build/board-fixtures/material-facts.js");
const { LEGAL_RESEARCH_FIXTURE } = await import("../build/board-fixtures/legal-research.js");
const { ARGUMENTS_FIXTURE } = await import("../build/board-fixtures/arguments.js");
const { LOOSE_THREADS_FIXTURE } = await import("../build/board-fixtures/loose-threads.js");
const { HOUSEKEEPING_FIXTURE } = await import("../build/housekeeping/fixture.js");

const line = (value) => JSON.stringify(value).replace(/</g, "\\u003c");
const page = (name) => [...VIEW_PAGES, LOOSE_IDEAS_PAGE].find((p) => p.name === name);

const VIEWS = [
  ["Procedural History", PROCEDURAL_HISTORY_FIXTURE],
  ["Material Facts", MATERIAL_FACTS_FIXTURE],
  ["Legal Research", LEGAL_RESEARCH_FIXTURE],
  ["Arguments", ARGUMENTS_FIXTURE],
  ["Loose Threads", LOOSE_THREADS_FIXTURE],
];

const ALL = [PRACTICE_BOARD_FIXTURE, LITIGATION_STRATEGY_FIXTURE, MILESTONE_FIXTURE, ...VIEWS.map(([, f]) => f), HOUSEKEEPING_FIXTURE];

test("each board renders its fixture with the fixture's data line", () => {
  assert.ok(renderPracticeBoardHtml(PRACTICE_BOARD_FIXTURE).includes(`window.PRACTICE_BOARD = ${line(PRACTICE_BOARD_FIXTURE)};\n`));
  assert.ok(renderMatterBoardHtml(LITIGATION_STRATEGY_FIXTURE).includes(`window.MATTER_BOARD = ${line(LITIGATION_STRATEGY_FIXTURE)};\n`));
  assert.ok(renderWorkBoardHtml(MILESTONE_FIXTURE).includes(`window.WORKBOARD = ${line(MILESTONE_FIXTURE)};\n`));
  for (const [name, fixture] of VIEWS) {
    assert.ok(page(name), `${name} is a view page`);
    assert.ok(renderViewPageHtml(page(name), fixture.meta, fixture.data).includes(`"data":${line(fixture.data)}`), name);
  }
  const { proposal, approval } = HOUSEKEEPING_FIXTURE;
  for (const a of [null, approval]) assert.ok(renderApprovalPage(proposal, a).includes(`"proposal":${line(proposal)}`));
});

test("no fixture holds a machine path", () => {
  for (const fixture of ALL) {
    const text = JSON.stringify(fixture);
    assert.doesNotMatch(text, /[A-Za-z]:\\\\|\/Users\/|\/home\/|OneDrive/i);
  }
});

test("the Loose Threads fixture's buttons cannot reach the listener", () => {
  assert.deepEqual(LOOSE_THREADS_FIXTURE.data.api, { port: 0, db_path: "", proceeding_id: 1, token: "" });
});
