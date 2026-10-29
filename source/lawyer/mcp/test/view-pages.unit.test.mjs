// The five view pages (view-pages.ts, map #125): a sha256 pin of the page each renders for a fixture,
// taken before the move to templates, and each entry template's literal name against the registry's.
// The pins are checked by hash only; no test reads a page.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { assertSha256Pin } from "./helpers/sha256-pin.mjs";

const { renderViewPageHtml, VIEW_PAGES } = await import("../build/submission/view-pages.js");
const { LOOSE_THREADS_PAGE_NAME } = await import("../build/submission/forms/loose-ideas-page.js");

/** Each page's entry template, in VIEW_PAGES order. */
const ENTRIES = ["procedural-history.html", "material-facts.html", "raw-research.html", "arguments.html", "loose-threads.html"];

test("each entry template's title and heading equal its VIEW_PAGES name", () => {
  assert.equal(VIEW_PAGES.length, ENTRIES.length);
  ENTRIES.forEach((entry, i) => {
    const text = readFileSync(new URL(`../src/templates/view-pages/${entry}`, import.meta.url), "utf8");
    assert.equal(text.match(/<title>(.*)<\/title>/)[1], VIEW_PAGES[i].name, `${entry} <title>`);
    assert.equal(text.match(/<h1>(.*)<\/h1>/)[1], VIEW_PAGES[i].name, `${entry} <h1>`);
  });
  assert.equal(VIEW_PAGES[4].name, LOOSE_THREADS_PAGE_NAME);
});

const META = { filing: "Notice of <Application>", matter: "L200", client: "Acme Co", revision: 7, rendered: "2026-10-15 09:30" };

/** One fixture per page, in VIEW_PAGES order. Only the data line depends on it; each holds a `<`. */
const FIXTURES = {
  "Procedural History": { order: "date", evidence: "read", facts: [{ position: 1, date: "2026-03-04", text: "The <claim> was served", class: "provable", basis: null, links: [] }] },
  "Material Facts": { order: "filing", evidence: "read", facts: [{ position: 1, date: null, text: "The <deal> closed", class: "provable", basis: null, links: [] }] },
  "Raw Research": { counts: { in_use: 1, undecided: 0, not_relevant: 0 }, groups: [{ heading: "Not <linked>", note: null, cards: [] }] },
  Arguments: { submissions: [], counter_arguments: [{ key: "anticipated:1", kind: "anticipated", text: "No <duty>", source: null, linked: [] }] },
  "Loose Threads": {
    groups: [{ key: "research", label: "Research", colour: "#8E6620", count: 1 }],
    ideas: [
      { id: 1, rank: 1, idea: "Check <s. 3>", group: "research", group_label: "Research", reason: null, job: null, surfaced_by: "draft", origin: null, deferred_at: null },
      { id: 2, rank: null, idea: "Ask the client", group: null, group_label: null, reason: null, job: null, surfaced_by: "draft", origin: null, deferred_at: "2026-10-14" },
    ],
    resolved: [],
    api: { port: 4100, db_path: "drafting.db", proceeding_id: 3, token: "t" },
  },
};

/** sha256 of renderViewPageHtml(page, META, FIXTURES[page.name]), taken from the inline-string pages before the move to templates;
 * Procedural History's and Material Facts' at the split of Provable Facts (docs/ADRs/0011); Arguments' at its Killed section. */
const PINS = {
  "Procedural History": "464d015ca1fb3901ef7b40bca293d96908ba28f53f557ae500994f340316c215",
  "Material Facts": "955b762ab670b677d4aa3ec3fe42628559b53b6318a18a1ae67d76a899729fc6",
  "Raw Research": "f16317970c4b86a3a8fba7464ddfa14cd8af58ed82b2f2b5833d580f42fdc864",
  Arguments: "694bf7e9292c17302291226cb73142d9c057ccfe26b745c708d8d1336d0ca876",
  "Loose Threads": "721b86eeb0ee11326e5905eb01605b90ceaeba4623c47619d6a95d3c4295f7aa",
};

for (const page of VIEW_PAGES) {
  test(`the ${page.name} page is byte-identical to the pinned render`, () => {
    assertSha256Pin(renderViewPageHtml(page, META, FIXTURES[page.name]), PINS[page.name], page.name);
  });
}
