// The Loose Threads view page: one `Loose Threads - Milestone <id>.html` per live Writing, written by the
// view-page registry (../view-pages.ts), listing the open loose threads of the filing's proceeding --
// the same set board_card's loose_threads lane prints, read by the same loader (fetchOpenSeeds), in
// the same order (inRankOrder):
//   ranked   -- by rank, ties by id, each with its group and the one-line reason the ranking gave it
//               (schema v66).
//   unranked -- by id: the loose threads captured since the last ranking, and every one on a database
//               held below v66. The page calls them Unranked.
// A ranked card shows the job description the ranking restated it as (schema v70), ending in its
// rank tag and its group's tag under the group's short name; opened, it shows the loose thought
// verbatim, then the reason, the loose thread's id, who surfaced it and where it came from, as the
// lane's line does. An unranked card, and one ranked before v70, shows the idea verbatim instead,
// ending in its tags (a "?" while unranked). The controls are folder tabs, an
// All groups switch with a chip per group over the ranked, and, on each card, a status button
// reading Ranked, Unranked or Deferred that defers the thread or brings it back (schema v68).
// Ranking never drops a loose thread, so the page lists every open one. A deferred one shows only
// under the Deferred tab (and All), never under Ranked or Unranked.
//
// A fifth tab, Resolved, lists the threads that are not open (fetchResolvedSeeds), newest first, one
// line each saying how it left the board and when: discarded (schema v75), a red struck line with a
// Restore link that copies an instruction and writes nothing; suggested to Probanda (v75); or outlined
// into a job that is not deleted, named by number and title and dated by the job's creation. Each line
// ends in an inert Resolved label. The All tab shows them only while its "Show/Hide Resolved Threads"
// checkbox is on, and it starts off.
//
// The status button writes through the data server's localhost listener (../../page-api/server.ts):
// the page posts the db_path, proceeding and token embedded here, and the listener writes only
// with a token a render made. The page checks the listener on load and disables the buttons, with
// one line saying why, when it does not answer.
//
// A human interface generated from the database (ADR 0033): no session reads, greps, parses or
// screenshots it. Sessions read the ranks and the deferrals through board_card's loose_threads lane,
// which keeps the long group labels (RANK_GROUP_LABELS).
//
// The page itself is the template set in src/templates/view-pages/ (map #125). loose-threads.css
// includes view-folder.css itself, because the folder look sits between its header rules and the rest.

import { templated } from "../../compose-template.js";
import { pageApiPort, pageApiToken } from "../../page-api/token.js";
import boardCss from "../../templates/work-board/board.css.js";
import looseThreadsCss from "../../templates/view-pages/loose-threads.css.js";
import looseThreadsHtml from "../../templates/view-pages/loose-threads.html.js";
import looseThreadsJs from "../../templates/view-pages/loose-threads.js.js";
import sharedJs from "../../templates/view-pages/shared.js.js";
import viewFolderCss from "../../templates/view-pages/view-folder.css.js";
import viewHeadHtml from "../../templates/view-pages/view-head.html.js";
import type { ViewPage } from "../view-pages.js";
import type { FilingRow } from "./query.js";
import { fetchOpenSeeds, fetchResolvedSeeds, inRankOrder, seedOrigin, withFromFiling, type RankGroup, type ResolvedSeed } from "./render-work-board.js";

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
export type ResolvedIdea = ResolvedSeed;

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
  api: LooseIdeasApi;
}

/** The page's data for one filing, from the drafting database, with the listener's port and this
 * page's token read from this device's probanda.json and page-api.secret. */
export function buildLooseIdeasData(dbPath: string, filing: Pick<FilingRow, "id" | "proceeding_id"> | Pick<FilingRow, "id" | "proceeding_id">[], env: NodeJS.ProcessEnv = process.env): LooseIdeasData {
  // A merged board's page (ADR 0010): every proceeding on the board, each thread posting its own proceeding's token.
  const filings = Array.isArray(filing) ? filing : [filing];
  const proceedings = [...new Set(filings.map((f) => f.proceeding_id))];
  const merged = proceedings.length > 1;
  const seeds = inRankOrder(
    proceedings.flatMap((p) => {
      const own = filings.filter((f) => f.proceeding_id === p).map((f) => f.id);
      // A thread captured on one of the board's own Writings names no other filing.
      return withFromFiling(dbPath, p, own[0], fetchOpenSeeds(dbPath, p)).map((s) => ({ ...s, from_filing: s.filing_id !== null && own.includes(s.filing_id) ? null : s.from_filing, proceeding_id: p }));
    })
  );
  const ideas = seeds.map(
    (s): LooseIdea => ({
      ...(merged ? { proceeding_id: s.proceeding_id } : {}),
      id: s.id,
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
  const resolved = proceedings.flatMap((p) => fetchResolvedSeeds(dbPath, p));
  return { groups, ideas, resolved: merged ? resolved.sort((a, b) => (a.at === b.at ? a.id - b.id : a.at < b.at ? 1 : -1)) : resolved, api };
}

/** The header's counts: every open loose thread, the ranked, the unranked and the deferred (which
 * add up to it), then the resolved. A deferred thread counts as Deferred only. */
function looseIdeasMeta(data: LooseIdeasData): [string, string][] {
  const deferred = data.ideas.filter((i) => i.deferred_at !== null).length;
  const ranked = data.ideas.filter((i) => i.deferred_at === null && i.rank !== null).length;
  return [
    ["Threads", String(data.ideas.length)],
    ["Ranked", String(ranked)],
    ["Unranked", String(data.ideas.length - ranked - deferred)],
    ["Deferred", String(deferred)],
    ["Resolved", String(data.resolved.length)],
  ];
}

/** The page's name. A filing's Milestone names it, in plain text, in its Loose Threads section (workboard-shell.ts).
 * Before 2026-10-08 it was "Loose Ideas"; the page write moves an old file to TRASH (matter-page-files.ts OLD_PAGE). */
export const LOOSE_THREADS_PAGE_NAME = "Loose Threads";

// The page's script (loose-threads.js) draws window.VIEW_PAGE.data into .board as folder tabs (All, Ranked, Unranked, Deferred, Resolved)
// over one panel holding four sections, ranked, unranked, deferred, then resolved; a deferred thread
// sits under Deferred only. Several cards may be open; each section's first card starts open. The
// Ranked heading carries the All groups switch: on, every group shows; off, a chip per group shows that group when pressed, every chip pressed at first and the selection kept
// across toggles. Turning it off breaks the chips out of a cluster behind the switch; turning it on
// plays the same motion in reverse, then hides them. Each card carries a status button reading
// Ranked, Unranked or Deferred, enabled once the listener answers /health within 2 s; a click posts
// the page's api block to /defer, or to /undefer on a deferred card, and, on 200, moves the card to
// its new section and relabels it. The header's counts keep the render's. A failure shows on the card.
// The Resolved section holds one line per resolved thread, saying how it left the board and when, a
// discarded one struck with a Restore link that copies "restore loose thread #N". It shows under its
// own tab, and under All only while the "Show/Hide Resolved Threads" checkbox is on. The checkbox
// starts off ("☐", "☑" when on) and shows on the All tab alone: on the Ranked heading, left of the All
// groups switch, or at the right of the tab row when nothing is ranked. It is not drawn when no
// thread is resolved.
// Everything drawn at load uses only element creation, attributes, classList.add and plain
// properties; measuring and animating happen on a click.
/** The page's view-page registry entry (../view-pages.ts VIEW_PAGES). */
export const LOOSE_IDEAS_PAGE: ViewPage = {
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
  data: (ctx) => buildLooseIdeasData(ctx.dbPath, ctx.writings.map((w) => w.filing)),
  metaExtra: looseIdeasMeta,
};
