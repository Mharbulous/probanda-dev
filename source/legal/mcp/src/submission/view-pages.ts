// View pages (ADR 0033, 2026-10-07 amendment): read-only HTML views of one live filing's data,
// written at the top of the matter's 0. DRAFT folder beside the Litigation Strategy and the Job Board pages,
// by the same page write (matter-pages.ts), at the same times and in the same way: atomically, only
// over a file carrying VIEW_PAGE_MARKER, and a retired filing's page moved to the matter's TRASH.
//
// A view page is `<name> - Job Board <id>.html`, named by the Writing's id so a retitle never moves it
// (2026-10-09; before then `<name> - filing <id>.html`, which the page write's old-page sweep trashes).
// The html-pages gate knows each view page by its name in the hook's VIEW_NAMES, refuses every read
// of it and lets a remote-device-only host stage it, so a page added here also adds its lowercased
// name there (.claude/skills/drafting-data/hooks/html-pages-gate.py).
//
// Like the other pages, a view page draws as a lone file card: its stylesheet, its data and its
// script are all inline, and only the data line differs from filing to filing. No session reads one
// (shared/html-pages.md): a session reads the same data through /drafting-data and the mockups.

import { ARGUMENTS_PAGE } from "./forms/arguments-page.js";
import { LOOSE_IDEAS_PAGE } from "./forms/loose-ideas-page.js";
import { PROVABLE_FACTS } from "./forms/provable-facts-page.js";
import type { FilingRow, ProceedingRow } from "./forms/query.js";
import { RAW_RESEARCH_PAGE } from "./forms/raw-research-page.js";
import { BOARD_CSS } from "./forms/board-template.js";

/** On every view page's root element: the overwrite guard and the old-page sweep recognise this
 * server's own view page by it. */
export const VIEW_PAGE_MARKER = "data-view-page";

/** What a view page's data reader is given: one live filing, read from the database at each write. */
export interface ViewPageContext {
  dbPath: string;
  filing: FilingRow;
  proceeding: ProceedingRow;
  /** The write's one clock reading, the page's Rendered stamp. */
  now: string;
  /** The database's revision the write read, the page's Rev. */
  revision: number;
}

export interface ViewPage {
  /** The page's title, and its file `<name> - Job Board <id>.html`. Renaming it moves every copy. */
  name: string;
  /** The page's own stylesheet, after the shared one. */
  css: string;
  /** The page's script, the same for every filing: it draws `window.VIEW_PAGE.data` into `.board`. */
  script: string;
  /** The page's data, JSON-serialisable, read from the databases at each write. */
  data: (ctx: ViewPageContext) => unknown;
  /** Extra keys for the header's meta row, from the page's data, printed before Rendered. */
  metaExtra?: (data: never) => [string, string][];
}

/** Every view page, one line each, in the order each filing's pages are listed in view_page_paths. */
export const VIEW_PAGES: readonly ViewPage[] = [
  PROVABLE_FACTS,
  RAW_RESEARCH_PAGE,
  ARGUMENTS_PAGE,
  LOOSE_IDEAS_PAGE,
];

/** A written view page, as open_session and render return it. */
export interface ViewPagePath {
  name: string;
  filing_id: number;
  path: string;
}

/** A view page's file name for one filing. */
export function viewPageFile(page: ViewPage, filingId: number): string {
  return `${page.name} - Job Board ${filingId}.html`;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Whether a file name is a registered view page's, for any filing, case aside. */
export function isViewPageFile(fileName: string): boolean {
  return VIEW_PAGES.some((page) => new RegExp(`^${escapeRegExp(page.name)} - Job Board \\d+\\.html$`, "i").test(fileName));
}

/** The header every view page prints: the page, the filing, the matter, the revision and the render stamp. */
export interface ViewPageMeta {
  filing: string;
  matter: string;
  client: string;
  revision: number;
  rendered: string;
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

const SHARED_SCRIPT = String.raw`(function () {
  "use strict";
  var view = window.VIEW_PAGE;
  if (!view) return;
  var meta = view.meta;
  if (meta.filing !== "") document.title = view.name + " — " + meta.filing;
  var row = document.querySelector("header .meta");
  [
    ["Writing", meta.filing],
    ["Matter", meta.matter],
    ["Client", meta.client],
    ["Rev", String(meta.revision)]
  ].concat(view.extra || [], [["Rendered", meta.rendered]]).forEach(function (pair) {
    if (pair[1] === "") return;
    var span = document.createElement("span");
    span.textContent = pair[1];
    span.setAttribute("data-k", pair[0]);
    row.appendChild(span);
  });
})();
`;

/** One view page's whole file. The data line starts at column 0 and every `<` in it is escaped, so
 * no recorded text can close the script. */
export function renderViewPageHtml(page: ViewPage, meta: ViewPageMeta, data: unknown): string {
  const name = escapeHtml(page.name);
  const extra = page.metaExtra ? page.metaExtra(data as never) : undefined;
  const line = JSON.stringify({ name: page.name, meta, extra, data }).replace(/</g, "\\u003c");
  return `<!doctype html>
<html lang="en" ${VIEW_PAGE_MARKER}>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${name}</title>
<style>
${BOARD_CSS}${page.css}</style>
</head>
<body>
<main>
  <header>
    <h1>${name}</h1>
    <div class="meta"></div>
  </header>
  <div class="board"></div>
</main>
<script>
window.VIEW_PAGE = ${line};
</script>
<script>
${SHARED_SCRIPT}</script>
<script>
${page.script}</script>
</body>
</html>
`;
}
