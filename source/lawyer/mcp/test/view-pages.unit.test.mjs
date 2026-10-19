// The four view pages (view-pages.ts, map #125): a sha256 pin of the page each renders for a fixture,
// taken before the move to templates, and each entry template's literal name against the registry's.
// The pins are checked by hash only; no test reads a page.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { assertSha256Pin } from "./helpers/sha256-pin.mjs";

const { renderViewPageHtml, VIEW_PAGES } = await import("../build/submission/view-pages.js");
const { LOOSE_THREADS_PAGE_NAME } = await import("../build/submission/forms/loose-ideas-page.js");

/** Each page's entry template, in VIEW_PAGES order. */
const ENTRIES = ["provable-facts.html", "raw-research.html", "arguments.html", "loose-threads.html"];

test("each entry template's title and heading equal its VIEW_PAGES name", () => {
  assert.equal(VIEW_PAGES.length, ENTRIES.length);
  ENTRIES.forEach((entry, i) => {
    const text = readFileSync(new URL(`../src/templates/view-pages/${entry}`, import.meta.url), "utf8");
    assert.equal(text.match(/<title>(.*)<\/title>/)[1], VIEW_PAGES[i].name, `${entry} <title>`);
    assert.equal(text.match(/<h1>(.*)<\/h1>/)[1], VIEW_PAGES[i].name, `${entry} <h1>`);
  });
  assert.equal(VIEW_PAGES[3].name, LOOSE_THREADS_PAGE_NAME);
});

const META = { filing: "Notice of <Application>", matter: "L200", client: "Acme Co", revision: 7, rendered: "2026-10-15 09:30" };

/** One fixture per page, in VIEW_PAGES order. Only the data line depends on it; each holds a `<`. */
const FIXTURES = {
  "Provable Facts": { evidence: "read", facts: [{ position: 1, text: "The <deal> closed", class: "provable", basis: null, links: [] }] },
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

/** sha256 of renderViewPageHtml(page, META, FIXTURES[page.name]), taken from the inline-string pages before the move to templates. */
const PINS = {
  "Provable Facts": "0a2c0c2fea36f3a85bc1e94990aa35ac0091b25185476be57b9fd4a9d275aacf",
  "Raw Research": "2fbcdabaf808ffbb6e5ba5af9cb88dd9b86ac6e16b2e7bd62125a1c60e9c7467",
  Arguments: "d59b25d2ddf076c2b6225eee2eb3b9b3b5400f6e892d058e619e731d6939825f",
  "Loose Threads": "e929662fda806198cb12d9164ee6f365027514716793813060eb76aadfc1aee8",
};

for (const page of VIEW_PAGES) {
  test(`the ${page.name} page is byte-identical to the pinned render`, () => {
    assertSha256Pin(renderViewPageHtml(page, META, FIXTURES[page.name]), PINS[page.name], page.name);
  });
}
