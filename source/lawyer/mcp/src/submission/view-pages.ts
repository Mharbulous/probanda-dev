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
//
// Each page is one entry template in src/templates/view-pages/ (map #125), with its name written
// literally, sharing view-head.html and shared.js; its page file composes it.
//
// Provable Facts became Procedural History and Material Facts on 2026-10-20 (docs/ADRs/0011). A
// `Provable Facts - Job Board <id>.html` left from before is an old page file (matter-pages.ts OLD_PAGE).

import type { TemplateSet } from "../compose-template.js";
import { ARGUMENTS_PAGE } from "./forms/arguments-page.js";
import { MATERIAL_FACTS, PROCEDURAL_HISTORY } from "./forms/facts-pages.js";
import { LOOSE_IDEAS_PAGE } from "./forms/loose-ideas-page.js";
import type { FilingRow, ProceedingRow } from "./forms/query.js";
import { RAW_RESEARCH_PAGE } from "./forms/raw-research-page.js";

/** On every view page's root element: the overwrite guard and the old-page sweep recognise this
 * server's own view page by it. */
export const VIEW_PAGE_MARKER = "data-view-page";

/** What a view page's data reader is given: one board's live Writings, read from the database at
 * each write. `filing` and `proceeding` are the first of `writings`, the survivor's when it is live. */
export interface ViewPageContext {
  dbPath: string;
  filing: FilingRow;
  proceeding: ProceedingRow;
  /** Every live Writing on the board (ADR 0010), the survivor's first: one, unless boards were merged. */
  writings: { filing: FilingRow; proceeding: ProceedingRow }[];
  /** The write's one clock reading, the page's Rendered stamp. */
  now: string;
  /** The database's revision the write read, the page's Rev. */
  revision: number;
}

export interface ViewPage {
  /** The page's title, and its file `<name> - Job Board <id>.html`. Renaming it moves every copy.
   * Its entry template writes the same name literally. */
  name: string;
  /** The page's template files, which `head` and `tail` are composed from; a preview recomposes them. */
  template: TemplateSet;
  /** The composed page before its data line, the same for every filing. */
  head: string;
  /** The composed page after its data line: its scripts draw `window.VIEW_PAGE.data` into `.board`. */
  tail: string;
  /** The page's data, JSON-serialisable, read from the databases at each write. */
  data: (ctx: ViewPageContext) => unknown;
  /** Extra keys for the header's meta row, from the page's data, printed before Rendered. */
  metaExtra?: (data: never) => [string, string][];
}

/** Every view page, one line each, in the order each filing's pages are listed in view_page_paths. */
export const VIEW_PAGES: readonly ViewPage[] = [
  PROCEDURAL_HISTORY,
  MATERIAL_FACTS,
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

/** A view page's file name for one board, by its survivor's id: a filing's, or a pre-filing
 * proceeding's that holds a Writing through a merge (ADR 0010). */
export function viewPageFile(page: ViewPage, board: { filing_id: number | null; proceeding_id: number }): string {
  return board.filing_id === null ? `${page.name} - Job Board - proceeding ${board.proceeding_id}.html` : `${page.name} - Job Board ${board.filing_id}.html`;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Whether a file name is a registered view page's, for any board, case aside. */
export function isViewPageFile(fileName: string): boolean {
  return VIEW_PAGES.some((page) => new RegExp(`^${escapeRegExp(page.name)} - Job Board (?:- proceeding )?\\d+\\.html$`, "i").test(fileName));
}

/** The header every view page prints: the page, the filing, the matter, the revision and the render stamp. */
export interface ViewPageMeta {
  filing: string;
  matter: string;
  client: string;
  revision: number;
  rendered: string;
}

/** One view page's whole file. The data line starts at column 0 and every `<` in it is escaped, so
 * no recorded text can close the script. */
export function renderViewPageHtml(page: ViewPage, meta: ViewPageMeta, data: unknown): string {
  const extra = page.metaExtra ? page.metaExtra(data as never) : undefined;
  const line = JSON.stringify({ name: page.name, meta, extra, data }).replace(/</g, "\\u003c");
  return `${page.head}window.VIEW_PAGE = ${line};\n${page.tail}`;
}
