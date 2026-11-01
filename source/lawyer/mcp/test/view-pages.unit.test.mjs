// The four view pages (view-pages.ts, map #125) and the Loose Threads page: a sha256 pin of the page each renders for a fixture,
// taken before the move to templates, and each entry template's literal name against the registry's.
// The pins are checked by hash only; no test reads a page.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { assertSha256Pin } from "./helpers/sha256-pin.mjs";

const { renderViewPageHtml, VIEW_PAGES } = await import("../build/submission/view-pages.js");
const { LOOSE_IDEAS_PAGE } = await import("../build/submission/forms/loose-ideas-page.js");
const PAGES = [...VIEW_PAGES, LOOSE_IDEAS_PAGE];

/** Each page's entry template, in PAGES order. */
const ENTRIES = ["procedural-history.html", "material-facts.html", "legal-memos.html", "arguments.html", "loose-threads.html"];

test("each entry template's title and heading equal its page's name", () => {
  assert.equal(PAGES.length, ENTRIES.length);
  ENTRIES.forEach((entry, i) => {
    const text = readFileSync(new URL(`../src/templates/view-pages/${entry}`, import.meta.url), "utf8");
    assert.equal(text.match(/<title>(.*)<\/title>/)[1], PAGES[i].name, `${entry} <title>`);
    assert.equal(text.match(/<h1>(.*)<\/h1>/)[1], PAGES[i].name, `${entry} <h1>`);
  });
});

const META = { filing: "Notice of <Application>", matter: "L200", client: "Acme Co", revision: 7, rendered: "2026-10-15 09:30" };

/** One fixture per page, in PAGES order. Only the data line depends on it; each holds a `<`. */
const FIXTURES = {
  "Procedural History": { order: "date", evidence: "read", facts: [{ position: 1, date: "2026-03-04", text: "The <claim> was served", class: "provable", basis: null, links: [] }] },
  "Material Facts": { order: "filing", evidence: "read", facts: [{ position: 1, date: null, text: "The <deal> closed", class: "provable", basis: null, links: [] }] },
  "Legal Memos": {
    memos: [
      { title: "ML re <set-off>", folder: "Set off", source: "research_memo", status: "completed", issues: ["Is <set-off> available?"], facts: [], jobs: [{ id: 1, title: "Research" }], date: "2026-10-01", version: 2, earlier: [1], file: "6. LAW\\Set off\\2026-10-01 ML re set-off v2.md", url: "file:///m/6.%20LAW/Set%20off/x.md", on_disk: true },
    ],
  },
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
 * Procedural History's and Material Facts' at the split of Provable Facts (docs/ADRs/0011); Arguments' at its badge filter;
 * the rest retaken on 2026-10-29 for 8be771b7, which renamed board.css's first comment ("Job Board" to "Milestone");
 * Arguments' retaken again on 2026-10-31 for e0065be, which added the session focus pointer to arguments.js;
 * Legal Memos' taken on 2026-10-31, when it replaced Raw Research. */
const PINS = {
  "Procedural History": "f8a29d4c7953ff408bd6323af74b2333a71966afb6ee5b550d550f6de594f912",
  "Material Facts": "3fb4f9f60ff8cc4ac8af3957423a83bacd8c38ba7d63194038a93376db4b0480",
  "Legal Memos": "a950cb0ef70ad75cd3f0bcffd57aa8e810052533fcf6d79d2ec21c9a33a9f2de",
  Arguments: "ec2b611a4cd2fee78b152f97703713149c874d9a3c4ad21bbf503375cb29e5f7",
  "Loose Threads": "e9295aefed42761418487103bc2d8e8ddd7908fccb10780c6da8c04b149904f7",
};

for (const page of PAGES) {
  test(`the ${page.name} page is byte-identical to the pinned render`, () => {
    assertSha256Pin(renderViewPageHtml(page, META, FIXTURES[page.name]), PINS[page.name], page.name);
  });
}
