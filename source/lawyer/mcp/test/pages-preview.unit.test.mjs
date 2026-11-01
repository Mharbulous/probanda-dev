// The preview tools (map #125; contract #138, built #142) with placeholder data: pages__template
// serves each page's inlined template files, and pages__preview and housekeeping__preview write a
// fixture preview into the fixture preview folder under the page's preview name, ending in the
// fixture marker. Each preview is checked against the board's own render of its fixture, with the
// overrides composed in, by sha256: no test here parses a page.

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import test, { after } from "node:test";

// The fixture preview folder is in the OS temp folder: point it at a throwaway one.
const TEMP = mkdtempSync(join(tmpdir(), "coclerk-pages-preview-"));
process.env.TEMP = process.env.TMP = process.env.TMPDIR = TEMP;
after(() => rmSync(TEMP, { recursive: true, force: true }));

const { composeTemplate } = await import("../build/compose-template.js");
const { PAGE_TEMPLATES, pagesPreview, pagesTemplate } = await import("../build/pages/preview.js");
const { FIXTURE_PREVIEW_MARKER, fixturePreviewDir } = await import("../build/pages/preview-file.js");
const { housekeepingPreview } = await import("../build/housekeeping/preview.js");
const { buildToolDefinitions, buildFileManagerToolDefinitions } = await import("../build/schema-gen.js");
const { renderPracticeBoardHtml } = await import("../build/submission/forms/practice-board-shell.js");
const { renderMatterBoardHtml } = await import("../build/submission/forms/matter-board-shell.js");
const { renderWorkBoardHtml } = await import("../build/submission/forms/workboard-shell.js");
const { VIEW_PAGES, renderViewPageHtml } = await import("../build/submission/view-pages.js");
const { LOOSE_IDEAS_PAGE } = await import("../build/submission/forms/loose-ideas-page.js");
const { renderApprovalPage } = await import("../build/housekeeping/page.js");
const { WORK_BOARD_FIXTURE } = await import("../build/board-fixtures/work-board.js");
const { LITIGATION_STRATEGY_FIXTURE } = await import("../build/board-fixtures/litigation-strategy.js");
const { MILESTONE_FIXTURE } = await import("../build/board-fixtures/milestone.js");
const { PROCEDURAL_HISTORY_FIXTURE } = await import("../build/board-fixtures/procedural-history.js");
const { MATERIAL_FACTS_FIXTURE } = await import("../build/board-fixtures/material-facts.js");
const { LEGAL_MEMOS_FIXTURE } = await import("../build/board-fixtures/legal-memos.js");
const { ARGUMENTS_FIXTURE } = await import("../build/board-fixtures/arguments.js");
const { LOOSE_THREADS_FIXTURE } = await import("../build/board-fixtures/loose-threads.js");
const { HOUSEKEEPING_FIXTURE } = await import("../build/housekeeping/fixture.js");

const sha = (text) => createHash("sha256").update(text).digest("hex");
const fixtureFile = (html) => `${html}${html.endsWith("\n") ? "" : "\n"}${FIXTURE_PREVIEW_MARKER}\n`;
const viewPage = (name) => [...VIEW_PAGES, LOOSE_IDEAS_PAGE].find((p) => p.name === name);

/** Each lawyer page: its preview name for the fixtures' Writing 1, and its render of its fixture with `page` composed. */
const PAGES = [
  ["Work Board", "Work Board", (page) => renderPracticeBoardHtml(WORK_BOARD_FIXTURE, page)],
  ["Litigation Strategy", "Litigation Strategy", (page) => renderMatterBoardHtml(LITIGATION_STRATEGY_FIXTURE, page)],
  ["Milestone", "Milestone 1", (page) => renderWorkBoardHtml(MILESTONE_FIXTURE, page)],
  ...[
    ["Procedural History", PROCEDURAL_HISTORY_FIXTURE],
    ["Material Facts", MATERIAL_FACTS_FIXTURE],
    ["Legal Memos", LEGAL_MEMOS_FIXTURE],
    ["Arguments", ARGUMENTS_FIXTURE],
  ].map(([name, f]) => [name, `${name} - Milestone 1`, (page) => renderViewPageHtml({ ...viewPage(name), ...page }, f.meta, f.data)]),
  ["Loose Threads", "Loose Threads", (page) => renderViewPageHtml({ ...viewPage("Loose Threads"), ...page }, LOOSE_THREADS_FIXTURE.meta, LOOSE_THREADS_FIXTURE.data)],
];

/** The page's template set with the first .css file's text marked, so an override is visible. */
function cssOverride(name) {
  const { files } = pagesTemplate(name);
  const file = Object.keys(files).find((f) => f.endsWith(".css"));
  return { [file]: `${files[file]}\n/* preview override */` };
}

test("pages__template returns each page's inlined files, which compose to the page the board writes", () => {
  const schema = buildToolDefinitions().find((t) => t.name === "pages__template");
  assert.deepEqual(schema.inputSchema.properties.page.enum, Object.keys(PAGE_TEMPLATES), "the schema names every page the registry holds");
  for (const name of Object.keys(PAGE_TEMPLATES)) {
    const { page, entry, files } = pagesTemplate(name);
    assert.equal(page, name);
    assert.ok(entry in files, `${name}: the entry is one of its files`);
  }
  for (const [name, , render] of PAGES) {
    const { entry, files } = pagesTemplate(name);
    assert.equal(sha(render(composeTemplate(entry, files))), sha(render(undefined)), `${name}: the served files are the board's own`);
  }
  assert.throws(() => pagesTemplate("Nothing"), /no page is named "Nothing"/);
});

test("a fixture preview of each page is written under its preview name, with its overrides, ending in the fixture marker", async () => {
  for (const [name, base, render] of PAGES) {
    const overrides = cssOverride(name);
    const { path } = await pagesPreview({ page: name, data: "fixture", overrides }, undefined);
    assert.equal(dirname(path), fixturePreviewDir());
    assert.equal(basename(path), `${base} preview 1.html`);
    const { entry, files } = pagesTemplate(name);
    const expected = fixtureFile(render(composeTemplate(entry, { ...files, ...overrides })));
    assert.equal(sha(readFileSync(path, "utf-8")), sha(expected), `${name}: the board's render of its fixture, overridden, then the marker`);
    assert.ok(expected.includes("/* preview override */"), `${name}: the override reached the page`);
  }
  const again = await pagesPreview({ page: "Work Board", data: "fixture" }, undefined);
  assert.equal(basename(again.path), "Work Board preview 2.html", "a second preview takes the next number and overwrites none");
  assert.equal(sha(readFileSync(again.path, "utf-8")), sha(fixtureFile(renderPracticeBoardHtml(WORK_BOARD_FIXTURE))), "no override: the page as the board draws it");
});

test("the housekeeping preview draws the fixture before or after approval, with its overrides", () => {
  const { files } = pagesTemplate("Housekeeping approval");
  const overrides = { "approval.css": `${files["approval.css"]}\n/* preview override */` };
  const composed = composeTemplate("approval.html", { ...files, ...overrides });
  const { proposal, approval } = HOUSEKEEPING_FIXTURE;
  const before = housekeepingPreview({ data: "fixture", overrides });
  const afterApproval = housekeepingPreview({ data: "fixture", overrides, approved: true });
  assert.deepEqual([before.path, afterApproval.path].map((p) => basename(p)), ["Housekeeping approval preview 1.html", "Housekeeping approval preview 2.html"]);
  assert.equal(dirname(before.path), fixturePreviewDir());
  assert.equal(sha(readFileSync(before.path, "utf-8")), sha(fixtureFile(renderApprovalPage(proposal, null, composed))));
  assert.equal(sha(readFileSync(afterApproval.path, "utf-8")), sha(fixtureFile(renderApprovalPage(proposal, approval, composed))));
  const schema = buildFileManagerToolDefinitions().find((t) => t.name === "housekeeping__preview");
  assert.ok(schema, "the files server serves housekeeping__preview");
  assert.equal(buildFileManagerToolDefinitions().some((t) => t.name.startsWith("pages__")), false, "and no lawyer page tool");
});

test("a preview refuses an override naming no file, a non-text override, and inputs its data does not take", async () => {
  await assert.rejects(pagesPreview({ page: "Milestone", data: "fixture", overrides: { "nope.css": "" } }, undefined), /overrides name no template file of this page: nope\.css/);
  await assert.rejects(pagesPreview({ page: "Milestone", data: "fixture", overrides: { "milestone.css": 1 } }, undefined), /milestone\.css is not/);
  await assert.rejects(pagesPreview({ page: "Milestone", data: "fixture", filing_id: 1 }, undefined), /fixture data takes no matter_root, filing_id or proceeding_id/);
  await assert.rejects(pagesPreview({ page: "Housekeeping approval", data: "fixture" }, undefined), /housekeeping__preview/);
  await assert.rejects(pagesPreview({ page: "Milestone", data: "real", matter_root: TEMP }, undefined), /exactly one of filing_id or proceeding_id/);
  await assert.rejects(pagesPreview({ page: "Arguments", data: "real", matter_root: TEMP, proceeding_id: 1 }, undefined), /needs filing_id and takes no proceeding_id/);
  await assert.rejects(pagesPreview({ page: "Loose Threads", data: "real", matter_root: TEMP, filing_id: 1 }, undefined), /Loose Threads covers the whole matter/);
  await assert.rejects(pagesPreview({ page: "Litigation Strategy", data: "real" }, undefined), /needs matter_root/);
  assert.throws(() => housekeepingPreview({ data: "fixture", run_id: "x" }), /fixture data takes no matter_root or run_id/);
  assert.throws(() => housekeepingPreview({ data: "real" }), /real data needs matter_root and run_id/);
  assert.throws(() => housekeepingPreview({ data: "fixture", overrides: { "approval.html": "<html>@@data@@</html>" } }), /no <\/title>/);
  assert.deepEqual(readdirSync(fixturePreviewDir()).filter((f) => f.startsWith("Milestone") || f.startsWith("Arguments - ")).length, 2, "a refused preview writes nothing");
});
