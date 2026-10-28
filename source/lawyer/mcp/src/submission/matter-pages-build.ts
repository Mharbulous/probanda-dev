// Builds every matter page's HTML without writing it (matter-pages.ts has the whole picture).

import { dirname, join } from "node:path";

import { buildStampStatus } from "../build-stamp.js";
import type { ComposedTemplate } from "../compose-template.js";
import { attachedDrafts, withCodes } from "./board-attachments.js";
import { BoardIndex, sameBoard } from "./forms/board-members.js";
import { docItemKey, orderStrip, readViewed, viewItemKey } from "./forms/board-viewed.js";
import { combineSections } from "./forms/combined-board.js";
import { courtFileAffidavits } from "./court-file-affidavits.js";
import { type ClientContext, rankFilings, type Ranked, readSchemaVersion } from "./forms.js";
import { MATTER_BOARD_FILE, renderMatterBoardHtml } from "./forms/matter-board-shell.js";
import { fetchPreFilingProceedings, isJobOnlyBoard } from "./forms/query.js";
import { buildMatterBoardData } from "./forms/render-matter-board.js";
import { buildPreFilingBoardData, type StripItem, type WorkBoardData } from "./forms/render-work-board.js";
import { renderWorkBoardHtml } from "./forms/workboard-shell.js";
import { combinedPageDates, filingBoardData } from "./matter-board-section.js";
import type { MatterDates } from "./matter-dates.js";
import { guardTargets, type PagesWritten } from "./matter-page-files.js";
import { type Member, pageGroups, pageTargets, viewTargets } from "./matter-page-groups.js";
import type { MatterTodos } from "./matter-todos.js";
import { readManifest } from "./render-manifest.js";
import { renderViewPageHtml, type ViewPage } from "./view-pages.js";
import { writingFolders } from "./writing-folder.js";

/** A file name without its extension: a Writings strip label from a manifest written before labels. */
function stem(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, "");
}

/** One built page: its file relative to the draft folder, its HTML, and the marker and page name
 * the overwrite guard checks an existing file by. */
export interface MatterPage {
  name: string;
  html: string;
  marker: string;
  page: string;
}

export interface MatterPagesBuilt {
  /** The pages a write puts in the draft folder, in write order: the Litigation Strategy, the
   * Milestone pages, then the view pages. */
  pages: MatterPage[];
  /** Every current Milestone and view page's file name, built by this call or not: what the sweep keeps. */
  keep: string[];
  /** Every current page's path, built by this call or not. */
  paths: Pick<PagesWritten, "milestone_paths" | "matter_board_path" | "view_page_paths">;
}

/**
 * Builds `<draftDir>\Litigation Strategy.html` and one Milestone page per live filing and per
 * pre-filing proceeding, each holding that one section (ADR 0033, 2026-10-05 amendment), and each live
 * filing's view pages (2026-10-07 amendment), from database state. Writes nothing: writeMatterPages
 * guards, sweeps and writes, and a preview renders the same pages without them.
 * `draftDir` is already confined (resolveDraftDir, or the parent of a confined Writing folder).
 * `reuse` hands over what the caller already built: bootstrap's ranked filings, and the section a
 * render just built for its own filing or proceeding, which then stands in for that section.
 * `reuse.only` names the one filing whose Milestone page and view pages are built, with the
 * Litigation Strategy: the background render job passes the filing it just rendered, and writes
 * every page once after its last, because building them all after every filing costs the square of
 * the filing count.
 */
export function buildMatterPages(
  dbPath: string,
  draftDir: string,
  client: ClientContext,
  now: string,
  revision: number,
  todos: MatterTodos,
  /** The matter's dates, for the Milestone pages' HTML files only: never a section, the state file or
   * the return value. A linked deadline reaches its filing's section as a dateless criterion. */
  dates: MatterDates,
  reuse: { ranked?: Ranked[]; section?: WorkBoardData; only?: number } = {},
  /** A preview's pages in place of the boards' own (src/pages/preview.ts): the composed Litigation
   * Strategy and Milestone templates, and whole view pages by name. Omitted, every page is the board's. */
  templates: { matterBoard?: ComposedTemplate; milestone?: ComposedTemplate; views?: Readonly<Record<string, ViewPage>> } = {}
): MatterPagesBuilt {
  const ranked = reuse.ranked ?? rankFilings(dbPath, client, now, { revision, schemaVersion: readSchemaVersion(dbPath), buildStamp: buildStampStatus().build_stamp }, []);
  const preFiling = fetchPreFilingProceedings(dbPath);
  const live = ranked.filter((r) => !r.filing.retired_on);
  const index = new BoardIndex(dbPath);
  const folders = writingFolders(dbPath, draftDir);
  const groups = pageGroups(index, live, preFiling, folders);
  const targets = pageTargets(groups);
  const views = viewTargets(groups, folders);
  const meta = {
    revision,
    matter: client.matterNo ?? "",
    client: client.clientName ?? ranked[0]?.proceeding.matter_reference ?? preFiling[0]?.matter_reference ?? "",
    rendered: now,
  };
  const own = reuse.section;
  // What this call builds: every page, or the page holding one filing.
  const { only } = reuse;
  const groupsWritten = only === undefined ? groups : groups.filter((g) => g.members.some((m) => m.filing?.id === only));
  const viewsWritten = views.filter((v) => groupsWritten.includes(v.group));
  const sectionOf = (m: Member): { section: WorkBoardData; writings: StripItem[] } => {
    if (m.filing === null) {
      const p = m.proceeding;
      return {
        section:
          own !== undefined && own.meta.filing_id === null && own.meta.proceeding_id === p.id
            ? own
            : buildPreFilingBoardData(dbPath, p, { revision, matter: meta.matter, client: client.clientName ?? p.matter_reference, rendered: now }),
        writings: [],
      };
    }
    // A Milestone with no Writing has no mockup folder, so none is looked up for it.
    const manifest = isJobOnlyBoard(m.filing) ? null : readManifest(dbPath, m.filing.id);
    const filingId = m.filing.id;
    return {
      section: own?.meta.filing_id === m.filing.id ? own : filingBoardData(dbPath, m.filing, m.proceeding, client, now, revision, dates, manifest),
      writings: (manifest?.files ?? []).map((f) => ({
        kind: "writing" as const,
        key: docItemKey(filingId, f.file_name),
        viewed: false,
        ...(f.label ?? { short: stem(f.file_name), long: stem(f.file_name) }),
      })),
    };
  };
  const matterBoard = renderMatterBoardHtml(buildMatterBoardData(dbPath, ranked, meta, preFiling, todos), templates.matterBoard);
  const milestones = groupsWritten.map((group) => {
    const built = group.members.map(sectionOf);
    const raw = built.map((b) => b.section);
    // A merged board is drawn as one board, its Completion Criteria card naming no Writing (docs/ADRs/0010, 2026-10-21 and 2026-10-22 amendments).
    const board = combineSections(dbPath, raw, true);
    const sections = [board];
    const { proceeding, filing } = group.members[0];
    // A page that is not its one section's own: merged, or named by a retired survivor.
    const named = group.members.length > 1 || !sameBoard(group.board, { filing_id: filing?.id ?? null, proceeding_id: proceeding.id });
    return renderWorkBoardHtml({
      meta: { ...meta, client_no: client.clientNo ?? "", forum: proceeding.forum ?? "", registry: proceeding.registry ?? "", file_number: proceeding.file_number ?? "", style_of_cause: proceeding.style_of_cause ?? "" },
      ...(named ? { board: group.board } : {}),
      sections,
      dates: combinedPageDates(dates, raw, board),
      // The viewed thumbnails first, most recently viewed first, then the rest in their own order.
      strip: orderStrip(
        [
          ...built.flatMap((b) => b.writings),
          ...views.filter((v) => v.group === group).map((v): StripItem => ({ kind: "view", key: viewItemKey(v.page.name), viewed: false, name: v.page.name, file: v.file })),
        ],
        readViewed(dbPath, group.board)
      ),
      attached: withCodes(sections.flatMap((s) => attachedDrafts(dbPath, draftDir, s))),
      court_file: raw.flatMap((s) =>
        s.meta.filing_id === null ? [] : courtFileAffidavits(dbPath, s.meta.filing_id, dirname(draftDir)).filter((a) => a.mismatch !== null)
      ),
    }, templates.milestone);
  });
  const viewPages = viewsWritten.map((v) => {
    const [first] = v.writings;
    const page = templates.views?.[v.page.name] ?? v.page;
    return renderViewPageHtml(
      page,
      { filing: v.writings.map((w) => w.filing.title).join("; "), matter: meta.matter, client: meta.client, revision, rendered: now },
      page.data({ dbPath, filing: first.filing, proceeding: first.proceeding, writings: v.writings, now, revision })
    );
  });
  const html = [matterBoard, ...milestones, ...viewPages];
  return {
    pages: guardTargets(groupsWritten.map((g) => g.file), viewsWritten).map((t, i) => ({ ...t, html: html[i] })),
    keep: [...groups.map((g) => g.file), ...views.map((v) => v.file)],
    paths: {
      milestone_paths: targets.map((t) => ({ filing_id: t.filing_id, proceeding_id: t.proceeding_id, path: join(draftDir, t.file) })),
      matter_board_path: join(draftDir, MATTER_BOARD_FILE),
      view_page_paths: views.flatMap((v) => v.writings.map((w) => ({ name: v.page.name, filing_id: w.filing.id, path: join(draftDir, v.file) }))),
    },
  };
}
