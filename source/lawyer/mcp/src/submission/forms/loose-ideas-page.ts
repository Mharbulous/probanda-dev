// The Loose Threads page: the matter's one `Loose Threads.html` at the top of its 0. DRAFT folder,
// written with the Litigation Strategy (../matter-pages-build.ts), listing every proceeding's open
// loose threads from their store (fetchOpenThreads; no Work Board draws them) by kind of work, under the
// folder tabs All, Jobs, Ideas, Propositions, Legal Memos, Correspondence, Arguments and Work Boards.
// Snipped work that keeps a record or file of its own stays there and shows as a read-only card
// (loose-thread-in-place.ts). Inside a tab a status filter picks Ranked, Unranked, Deferred or Resolved;
// ranking applies to ideas only, so a thread of another kind reads Open and those two do not offer.
// The ideas, in the shared order (inRankOrder):
//   ranked   -- by rank, ties by id, each with its group and the one-line reason the ranking gave it
//               (schema v66).
//   unranked -- by id: the loose threads captured since the last ranking, and every one on a database
//               held below v66. The page calls them Unranked.
// A ranked card shows the job description the ranking restated it as (schema v70), ending in its
// rank tag and its group's tag under the group's short name; opened, it shows the loose thought
// verbatim, then the reason, the loose thread's id, who surfaced it and where it came from, as the
// lane's line does. An unranked card, and one ranked before v70, shows the idea verbatim instead,
// ending in its tags (a "?" while unranked). The controls are the tabs, the status filter, an
// All groups switch with a chip per group over the ranked, and, on each card, a status button
// reading Ranked, Unranked or Deferred that defers the thread or brings it back (schema v68).
// Ranking never drops a loose thread, so the page lists every open one. A deferred one shows only
// under Deferred (and with no status picked), never under Ranked or Unranked.
//
// The Resolved status lists the threads that are not open (fetchResolvedSeeds), newest first, one
// line each saying how it left the board and when: discarded (schema v75), a red struck line with a
// Restore link that copies an instruction and writes nothing; suggested to Probanda (v75); or outlined
// into a job that is not deleted, named by number and title and dated by the job's creation. Each line
// ends in an inert Resolved label. With no status picked they show only while the "Show/Hide Resolved
// Threads" checkbox is on, and it starts off.
//
// The status button writes through the data server's localhost listener (../../page-api/server.ts):
// the page posts the db_path, proceeding and token embedded here, and the listener writes only
// with a token a render made. The page checks the listener on load and disables the buttons, with
// one line saying why, when it does not answer.
//
// A human interface generated from the database (ADR 0033): no session reads, greps, parses or
// screenshots it. Sessions read the ranks and the deferrals through loose_threads__read.
//
// The page itself is the template set in src/templates/view-pages/ (map #125). loose-threads.css
// includes view-folder.css itself, because the folder look sits between its header rules and the rest.

import { templated } from "../../compose-template.js";
import { pageApiPort, pageApiToken } from "../../page-api/token.js";
import boardCss from "../../templates/practice-board/board.css.js";
import looseThreadsCss from "../../templates/view-pages/loose-threads.css.js";
import looseThreadsHtml from "../../templates/view-pages/loose-threads.html.js";
import looseThreadsJs from "../../templates/view-pages/loose-threads.js.js";
import sharedJs from "../../templates/view-pages/shared.js.js";
import viewFolderCss from "../../templates/view-pages/view-folder.css.js";
import viewHeadHtml from "../../templates/view-pages/view-head.html.js";
import type { ThreadKind } from "../../loose-threads/backend.js";
import type { ViewPage } from "../view-pages.js";
import { type BoardPage, inPlaceCards, type InPlaceCard, type PageTab } from "./loose-thread-in-place.js";
import { fetchAllProceedings } from "./query.js";
import { fetchDeletedTickets, fetchOpenThreads, fetchResolvedSeeds, inRankOrder, seedOrigin, withFromFiling, type RankGroup, type ResolvedSeed } from "./render-work-board.js";

/** Which tab a thread of each kind shows under. */
const KIND_TAB: Readonly<Record<ThreadKind, PageTab>> = { idea: "ideas", proposition: "propositions", correspondence: "correspondence", argument: "arguments", work_board: "work_boards" };

/** What the page's data reader is given: with no draft folder, no memo and no link. */
export interface LooseThreadsContext {
  dbPath: string;
  draftDir?: string;
  boards?: BoardPage[];
}

/** Each group's short name and colour on this page, in triage's group order. */
const GROUP_STYLE: Readonly<Record<RankGroup, { label: string; colour: string }>> = {
  decision: { label: "Practitioner decisions", colour: "#6E4F8E" },
  tooling: { label: "Tooling", colour: "#3F6197" },
  housekeeping: { label: "Housekeeping", colour: "#2F7466" },
  research: { label: "Research", colour: "#8E6620" },
  authority: { label: "Authority mismatch", colour: "#984A43" },
  evidence: { label: "Evidence mismatch", colour: "#85587A" },
  other: { label: "Miscellaneous", colour: "#636B72" },
};

export interface LooseIdea {
  id: number;
  /** The tab it shows under, from its kind. */
  tab: PageTab;
  /** The file path or record id it left off at, when it names one. */
  ref: string | null;
  /** A page spanning several proceedings only: the thread's proceeding, whose token its button posts. */
  proceeding_id?: number;
  /** Null while unranked. */
  rank: number | null;
  idea: string;
  group: RankGroup | null;
  /** The group's short name on this page (GROUP_STYLE). */
  group_label: string | null;
  reason: string | null;
  /** The job description the ranking wrote (schema v70); null while unranked and on a loose thread ranked before v70. */
  job: string | null;
  surfaced_by: string;
  /** `from Job #N[ on <filing>]` or `from <filing>`, as the lane's line prints it; null for neither. */
  origin: string | null;
  /** When the practitioner deferred it (schema v68); null when not deferred. */
  deferred_at: string | null;
}

/** A resolved loose thread, as the page's Resolved section draws it. */
export type ResolvedIdea = Omit<ResolvedSeed, "kind"> & { tab: PageTab };

/** What the page's status button posts to the listener: its port, and the body it sends. */
export interface LooseIdeasApi {
  port: number;
  db_path: string;
  proceeding_id: number;
  token: string;
  /** A page spanning several proceedings only: each proceeding's token, by its id. */
  tokens?: Record<string, string>;
}

export interface LooseIdeasData {
  /** The groups the ranked loose threads fall in, in triage's group order: one chip each, with its
   * count of ranked loose threads. */
  groups: { key: RankGroup; label: string; colour: string; count: number }[];
  /** Every open loose thread in the shared order: the ranked first, then the unranked. */
  ideas: LooseIdea[];
  /** The proceeding's resolved loose threads, newest first: discarded, suggested, or outlined into a
   * job that is not deleted. */
  resolved: ResolvedIdea[];
  /** Snipped work that stays where it is, each card naming and linking it. */
  in_place: InPlaceCard[];
  api: LooseIdeasApi;
}

/** The page's data for these proceedings, from the drafting database, with the listener's port and
 * each proceeding's token read from this device's probanda.json and page-api.secret. */
export function buildLooseIdeasData(dbPath: string, proceedings: number[], env: NodeJS.ProcessEnv = process.env, draftDir?: string, boards?: BoardPage[]): LooseIdeasData {
  // Over several proceedings each thread posts its own proceeding's token.
  const merged = proceedings.length > 1;
  const seeds = inRankOrder(
    proceedings.flatMap((p) => {
      const deletedIds = new Set(fetchDeletedTickets(dbPath, p).map((d) => d.id));
      return withFromFiling(
        dbPath,
        p,
        fetchOpenThreads(dbPath, p, deletedIds).map(({ origin_job, ...t }) => ({ ...t, origin_ticket_id: origin_job !== null && deletedIds.has(origin_job) ? null : origin_job }))
      ).map((s) => ({ ...s, ref: s.ref ?? null, proceeding_id: p }));
    })
  );
  const ideas = seeds.map(
    (s): LooseIdea => ({
      ...(merged ? { proceeding_id: s.proceeding_id } : {}),
      id: s.id,
      tab: KIND_TAB[s.kind],
      ref: s.ref,
      rank: s.rank,
      idea: s.idea,
      group: s.rank === null ? null : s.rank_group,
      group_label: s.rank === null || s.rank_group === null ? null : GROUP_STYLE[s.rank_group].label,
      reason: s.rank === null ? null : s.rank_reason,
      job: s.rank === null ? null : s.rank_job,
      surfaced_by: s.surfaced_by,
      origin: seedOrigin(s),
      deferred_at: s.deferred_at,
    })
  );
  const groups = (Object.keys(GROUP_STYLE) as RankGroup[])
    .map((key) => ({ key, ...GROUP_STYLE[key], count: ideas.filter((i) => i.group === key).length }))
    .filter((g) => g.count > 0);
  const first = proceedings[0];
  const api: LooseIdeasApi = {
    port: pageApiPort(env),
    db_path: dbPath,
    proceeding_id: first,
    token: pageApiToken(dbPath, first, env),
    ...(merged ? { tokens: Object.fromEntries(proceedings.map((p) => [String(p), pageApiToken(dbPath, p, env)])) } : {}),
  };
  const resolved = proceedings.flatMap((p) => fetchResolvedSeeds(dbPath, p)).map(({ kind, ...r }): ResolvedIdea => ({ ...r, tab: KIND_TAB[kind] }));
  return { groups, ideas, resolved: merged ? resolved.sort((a, b) => (a.at === b.at ? a.id - b.id : a.at < b.at ? 1 : -1)) : resolved, in_place: inPlaceCards(dbPath, proceedings, draftDir, boards), api };
}

/** The header's counts: every open loose thread, the ranked, the unranked and the deferred (which
 * add up to it), then the resolved. A deferred thread counts as Deferred only. */
function looseIdeasMeta(data: LooseIdeasData): [string, string][] {
  const deferred = data.ideas.filter((i) => i.deferred_at !== null).length;
  const ranked = data.ideas.filter((i) => i.deferred_at === null && i.rank !== null).length;
  const other = data.ideas.filter((i) => i.deferred_at === null && i.tab !== "ideas").length;
  return [
    ["Threads", String(data.ideas.length)],
    ["Ranked", String(ranked)],
    ["Unranked", String(data.ideas.length - ranked - deferred - other)],
    ...(other > 0 ? ([["Other open", String(other)]] as [string, string][]) : []),
    ["Deferred", String(deferred)],
    ["Resolved", String(data.resolved.length)],
  ];
}

/** The page's name. Before 2026-10-08 it was "Loose Ideas", and before 2026-10-29 each Writing had a copy;
 * the page write moves an old file to TRASH (matter-page-files.ts OLD_PAGE). */
export const LOOSE_THREADS_PAGE_NAME = "Loose Threads";
export const LOOSE_THREADS_FILE = `${LOOSE_THREADS_PAGE_NAME}.html`;

// The page's script (loose-threads.js) draws window.VIEW_PAGE.data into .board as the folder tabs over one
// panel holding the status filter and six sections, ranked, unranked, open (a thread that is no idea),
// deferred, resolved, then in place; a deferred thread sits under Deferred only. Several cards may be open; each section's first card starts open. The
// Ranked heading carries the All groups switch: on, every group shows; off, a chip per group shows that group when pressed, every chip pressed at first and the selection kept
// across toggles. Turning it off breaks the chips out of a cluster behind the switch; turning it on
// plays the same motion in reverse, then hides them. Each card carries a status button reading
// Ranked, Unranked or Deferred, enabled once the listener answers /health within 2 s; a click posts
// the page's api block to /defer, or to /undefer on a deferred card, and, on 200, moves the card to
// its new section and relabels it. The header's counts keep the render's. A failure shows on the card.
// The Resolved section holds one line per resolved thread, saying how it left the board and when, a
// discarded one struck with a Restore link that copies "restore loose thread #N". It shows under the
// Resolved status, and with no status picked only while the "Show/Hide Resolved Threads" checkbox is on.
// The checkbox starts off ("☐", "☑" when on) and shows while no status is picked: on the Ranked heading,
// left of the All groups switch, or at the right of the tab row when nothing is ranked. It is not drawn
// when no thread is resolved. The in-place section shows only while no status is picked.
// Everything drawn at load uses only element creation, attributes, classList.add and plain
// properties; measuring and animating happen on a click.
/** The page, over every proceeding in the database. */
export const LOOSE_IDEAS_PAGE: ViewPage<LooseThreadsContext> = {
  name: LOOSE_THREADS_PAGE_NAME,
  ...templated({
    entry: "loose-threads.html",
    files: {
      "loose-threads.html": looseThreadsHtml,
      "view-head.html": viewHeadHtml,
      "board.css": boardCss,
      "loose-threads.css": looseThreadsCss,
      "view-folder.css": viewFolderCss,
      "shared.js": sharedJs,
      "loose-threads.js": looseThreadsJs,
    },
  }),
  data: (ctx) => buildLooseIdeasData(ctx.dbPath, fetchAllProceedings(ctx.dbPath).map((p) => p.id), process.env, ctx.draftDir, ctx.boards),
  metaExtra: looseIdeasMeta,
};
