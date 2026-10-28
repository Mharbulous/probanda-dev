// pages__template and pages__preview (map #125; contract #138, built #142): a board's template files
// as text, and a board rendered with a session's overrides in place of them, against the board's
// placeholder fixture or the practitioner's real data. Neither reads a template file or a page: the
// templates are the inlined copies the boards themselves compose (scripts/templates.mjs), and a
// preview is composed by composeWithOverrides and drawn by the board's own render function.
//
// A fixture preview goes in the fixture preview folder (preview-file.ts), named as the fixture's own
// page (its Writing is id 1). A real-data preview goes beside the page it previews: the Work Board's
// beside practice.db, a matter page's in the matter's draft folder, where the page write's sweep
// leaves it (matter-page-files.ts PREVIEW_FILE). The real data is built exactly as the page write builds
// it, and nothing is written but the preview. A real Loose Threads preview's buttons carry port 0 and
// no token, so the page's "Buttons need the Claude desktop app running" line shows and no click can
// reach the listener.
//
// The housekeeping approval page's template is served here too; its preview is housekeeping__preview
// in file-manager's files server (src/housekeeping/preview.ts).

import { basename, dirname, join, relative } from "node:path";

import type { TemplateSet } from "../compose-template.js";
import { ValidationError } from "../errors.js";
import { findDraftDir, resolveDbPath, validateMatterRoot } from "../files/matter-root.js";
import { APPROVAL_TEMPLATE } from "../housekeeping/page.js";
import { resolvePracticeDbPath } from "../practice/backend.js";
import type { PracticeStore } from "../practice/store.js";
import { buildPracticeBoardData } from "../tools/practice/practice-board.js";
import { MILESTONE_FIXTURE } from "../board-fixtures/milestone.js";
import { LITIGATION_STRATEGY_FIXTURE } from "../board-fixtures/litigation-strategy.js";
import { WORK_BOARD_FIXTURE } from "../board-fixtures/work-board.js";
import { ARGUMENTS_FIXTURE } from "../board-fixtures/arguments.js";
import { LOOSE_THREADS_FIXTURE } from "../board-fixtures/loose-threads.js";
import { MATERIAL_FACTS_FIXTURE } from "../board-fixtures/material-facts.js";
import { PROCEDURAL_HISTORY_FIXTURE } from "../board-fixtures/procedural-history.js";
import { RAW_RESEARCH_FIXTURE } from "../board-fixtures/raw-research.js";
import { nowStamp, resolveDraftDir } from "../submission/forms.js";
import { LOOSE_THREADS_PAGE_NAME, type LooseIdeasData } from "../submission/forms/loose-ideas-page.js";
import { LITIGATION_STRATEGY_TEMPLATE, MATTER_BOARD_FILE, renderMatterBoardHtml } from "../submission/forms/matter-board-shell.js";
import { PRACTICE_BOARD_FILE, renderPracticeBoardHtml, WORK_BOARD_TEMPLATE } from "../submission/forms/practice-board-shell.js";
import { fetchRevision } from "../submission/forms/query.js";
import { MILESTONE_TEMPLATE, renderWorkBoardHtml } from "../submission/forms/workboard-shell.js";
import { readMatterDates } from "../submission/matter-dates.js";
import { buildMatterPages } from "../submission/matter-pages.js";
import { readMatterTodos } from "../submission/matter-todos.js";
import { lookUpMatter, matterToken } from "../submission/open-session.js";
import { renderViewPageHtml, VIEW_PAGES, type ViewPage, type ViewPageMeta, viewPageFile } from "../submission/view-pages.js";
import { composeWithOverrides, fixturePreviewDir, writePreview } from "./preview-file.js";

export const HOUSEKEEPING_PAGE = "Housekeeping approval";

/** Every page's template set, by the page name the tools take. */
export const PAGE_TEMPLATES: Readonly<Record<string, TemplateSet>> = {
  "Work Board": WORK_BOARD_TEMPLATE,
  "Litigation Strategy": LITIGATION_STRATEGY_TEMPLATE,
  "Milestone": MILESTONE_TEMPLATE,
  ...Object.fromEntries(VIEW_PAGES.map((p) => [p.name, p.template])),
  [HOUSEKEEPING_PAGE]: APPROVAL_TEMPLATE,
};

/** The view pages' fixtures, by page name. */
const VIEW_FIXTURES: Readonly<Record<string, { meta: ViewPageMeta; data: unknown }>> = {
  "Procedural History": PROCEDURAL_HISTORY_FIXTURE,
  "Material Facts": MATERIAL_FACTS_FIXTURE,
  "Raw Research": RAW_RESEARCH_FIXTURE,
  Arguments: ARGUMENTS_FIXTURE,
  "Loose Threads": LOOSE_THREADS_FIXTURE,
};

/** The fixtures' Writing and proceeding: a fixture preview is named as their page. */
const FIXTURE_BOARD = { filing_id: 1, proceeding_id: 1 };

export function pagesTemplate(page: string): { page: string; entry: string; files: Readonly<Record<string, string>> } {
  const set = PAGE_TEMPLATES[page];
  if (set === undefined) throw new ValidationError(`no page is named "${page}"`);
  return { page, entry: set.entry, files: set.files };
}

export interface PreviewArgs {
  page: string;
  overrides?: Record<string, string>;
  data: "fixture" | "real";
  matter_root?: string;
  filing_id?: number;
  proceeding_id?: number;
}

const stem = (fileName: string) => fileName.replace(/\.html$/i, "");

export async function pagesPreview(args: PreviewArgs, store: PracticeStore): Promise<{ path: string }> {
  const { page, data } = args;
  if (page === HOUSEKEEPING_PAGE) throw new ValidationError(`the ${HOUSEKEEPING_PAGE} page is previewed by housekeeping__preview, in the file-manager plugin`);
  const set = PAGE_TEMPLATES[page];
  if (set === undefined) throw new ValidationError(`no page is named "${page}"`);
  const composed = composeWithOverrides(set, args.overrides);
  const view = VIEW_PAGES.find((p) => p.name === page);
  const viewPage: ViewPage | undefined = view && { ...view, ...composed };
  const ids = { filing_id: args.filing_id, proceeding_id: args.proceeding_id };

  if (data === "fixture") {
    if (args.matter_root !== undefined || ids.filing_id !== undefined || ids.proceeding_id !== undefined) {
      throw new ValidationError("fixture data takes no matter_root, filing_id or proceeding_id");
    }
    const dir = fixturePreviewDir();
    if (viewPage) {
      const { meta, data: fixture } = VIEW_FIXTURES[page];
      return { path: writePreview(dir, stem(viewPageFile(viewPage, FIXTURE_BOARD)), renderViewPageHtml(viewPage, meta, fixture), true) };
    }
    if (page === "Work Board") return { path: writePreview(dir, stem(PRACTICE_BOARD_FILE), renderPracticeBoardHtml(WORK_BOARD_FIXTURE, composed), true) };
    if (page === "Litigation Strategy") return { path: writePreview(dir, stem(MATTER_BOARD_FILE), renderMatterBoardHtml(LITIGATION_STRATEGY_FIXTURE, composed), true) };
    return { path: writePreview(dir, `Milestone ${FIXTURE_BOARD.filing_id}`, renderWorkBoardHtml(MILESTONE_FIXTURE, composed), true) };
  }

  if (page === "Work Board") {
    if (args.matter_root !== undefined || ids.filing_id !== undefined || ids.proceeding_id !== undefined) {
      throw new ValidationError("the Work Board covers the whole practice: it takes no matter_root, filing_id or proceeding_id");
    }
    const html = renderPracticeBoardHtml(await buildPracticeBoardData(store, new Date()), composed);
    return { path: writePreview(dirname(resolvePracticeDbPath(store.env)), stem(PRACTICE_BOARD_FILE), html, false) };
  }

  if (args.matter_root === undefined) throw new ValidationError(`real data for the ${page} page needs matter_root`);
  if (page === "Litigation Strategy" && (ids.filing_id !== undefined || ids.proceeding_id !== undefined)) {
    throw new ValidationError("the Litigation Strategy covers the whole matter: it takes no filing_id or proceeding_id");
  }
  if (page === "Milestone" && (ids.filing_id === undefined) === (ids.proceeding_id === undefined)) {
    throw new ValidationError("the Milestone needs exactly one of filing_id or proceeding_id");
  }
  if (viewPage && (ids.filing_id === undefined || ids.proceeding_id !== undefined)) {
    throw new ValidationError(`the ${page} page needs filing_id and takes no proceeding_id`);
  }

  const root = validateMatterRoot(args.matter_root);
  const dbPath = resolveDbPath(root);
  const found = findDraftDir(root);
  if (found === undefined) throw new ValidationError(`${root} has no 0. DRAFT folder, so it has no ${page} page to preview`);
  const draftDir = resolveDraftDir(found, "pages__preview.matter_root");
  // The matter is looked up, and its to-dos and dates read, as session entry reads them.
  const client = (await lookUpMatter(root, store, {})).client;
  const matterNo = client.matterNo ?? matterToken(root) ?? undefined;
  const built = buildMatterPages(
    dbPath,
    draftDir,
    client,
    nowStamp(),
    fetchRevision(dbPath),
    await readMatterTodos(store, matterNo),
    await readMatterDates(store, matterNo),
    ids.filing_id === undefined ? {} : { only: ids.filing_id },
    viewPage ? { views: { [page]: page === LOOSE_THREADS_PAGE_NAME ? withoutListener(viewPage) : viewPage } } : page === "Milestone" ? { milestone: composed } : { matterBoard: composed }
  );
  const target =
    page === "Litigation Strategy"
      ? join(draftDir, MATTER_BOARD_FILE)
      : page === "Milestone"
        ? built.paths.milestone_paths.find((t) => (ids.filing_id !== undefined ? t.filing_id === ids.filing_id : t.filing_id === null && t.proceeding_id === ids.proceeding_id))?.path
        : built.paths.view_page_paths.find((v) => v.name === page && v.filing_id === ids.filing_id)?.path;
  const pageFile = target === undefined ? undefined : relative(draftDir, target);
  const html = built.pages.find((p) => p.name === pageFile)?.html;
  if (target === undefined || html === undefined) {
    const which = ids.filing_id !== undefined ? `Milestone ${ids.filing_id}` : "that proceeding's board";
    throw new ValidationError(`this matter has no ${page} page for ${which}: it is retired, merged into a board with no such page, or not in this matter`);
  }
  return { path: writePreview(dirname(target), stem(basename(target)), html, false) };
}

/** The Loose Threads page with its buttons cut off from the listener: port 0, no token (#138). */
function withoutListener(page: ViewPage): ViewPage {
  return {
    ...page,
    data: (ctx) => {
      const data = page.data(ctx) as LooseIdeasData;
      const { tokens: _tokens, ...api } = data.api;
      return { ...data, api: { ...api, port: 0, token: "" } };
    },
  };
}
