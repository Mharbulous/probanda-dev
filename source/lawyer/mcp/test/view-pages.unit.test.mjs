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
const ENTRIES = ["procedural-history.html", "material-facts.html", "legal-research.html", "arguments.html", "loose-threads.html"];

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
  "Legal Research": {
    propositions: { counts: { in_use: 0, undecided: 1, not_relevant: 0 }, groups: [{ heading: "Not linked", note: null, propositions: [{ law_assertion_id: 1, text: "A <rule>", dead_end: false, killed_on: null, class: "undecided", linked_to: [], statements: [] }] }] },
    briefs: { cases: [{ title: "A v <B>", citation: "2019 BCSC 1", status: "not_briefed", relied_on: true, jobs: [], brief: null }] },
    memos: {
      memos: [
        { title: "ML re <set-off>", folder: "Set off", source: "research_memo", status: "completed", issues: ["Is <set-off> available?"], facts: [], jobs: [{ id: 1, title: "Research" }], date: "2026-10-01", version: 2, earlier: [1], file: "6. LAW\\Set off\\2026-10-01 ML re set-off v2.md", url: "file:///m/6.%20LAW/Set%20off/x.md", on_disk: true },
      ],
    },
  },
  Arguments: { submissions: [], counter_arguments: [{ key: "anticipated:1", kind: "anticipated", text: "No <duty>", source: null, linked: [] }] },
  "Loose Threads": {
    groups: [{ key: "research", label: "Research", colour: "#8E6620", count: 1 }],
    ideas: [
      { id: 1, tab: "ideas", ref: null, rank: 1, idea: "Check <s. 3>", group: "research", group_label: "Research", reason: null, job: null, surfaced_by: "draft", origin: null, deferred_at: null },
      { id: 2, tab: "ideas", ref: null, rank: null, idea: "Ask the client", group: null, group_label: null, reason: null, job: null, surfaced_by: "draft", origin: null, deferred_at: "2026-10-14" },
    ],
    resolved: [],
    in_place: [{ tab: "jobs", record: "Job #4", title: "Shelved <job>", status: "Shelved", date: "2026-10-14", url: null, path: null }],
    api: { port: 4100, db_path: "drafting.db", proceeding_id: 3, token: "t" },
  },
};

/** sha256 of renderViewPageHtml(page, META, FIXTURES[page.name]), taken from the inline-string pages before the move to templates;
 * Procedural History's and Material Facts' at the split of Provable Facts (docs/ADRs/0011); Arguments' at its badge filter;
 * the rest retaken on 2026-10-29 for 8be771b7, which renamed board.css's first comment ("Job Board" to "Work Board");
 * Arguments' retaken again on 2026-10-31 for e0065be, which added the session focus pointer to arguments.js;
 * Legal Research's taken on 2026-11-01, when it replaced Legal Memos, and retaken that day when Case Briefs listed each earlier file,
 * and again for the four tabs, the noting-up badges and the Legal Memos sections, and for the file link through the page API;
 * Loose Threads' retaken on 2026-11-02 for its tabs by kind of work and its status filter. */
const PINS = {
  "Procedural History": "ac5b979ecc31f5442ad6d0e67c59f293346502cff179d0037c4f67a363ac0187",
  "Material Facts": "1970c261e8ad20d7300056baf5bcc5fe678269cd82941263d06da76ad68bf00d",
  "Legal Research": "0faafa93119733be4235e97467b87256076b340176c29ba40ccf124d41036b4b",
  Arguments: "2b96c96b31a4815468b2f9a04efd9e05b4138150c587d002e7f0a7132e1c3d4e",
  "Loose Threads": "2cd6a6bdc56e1be7921b96a1a19520fdce33936e89f0d53c07993ab4d4f657ce",
};

for (const page of PAGES) {
  test(`the ${page.name} page is byte-identical to the pinned render`, () => {
    assertSha256Pin(renderViewPageHtml(page, META, FIXTURES[page.name]), PINS[page.name], page.name);
  });
}
