// ---------------------------------------------------------------------------------------------
// board_summary (R3) and board_card: one section as fixed-grammar text, the only board content a
// session reads. The summary is short: the matter, the client, the revision, the linked to-do, the
// statement of goals' description and status, and the unmet and met completion criteria. board_card prints the rest on request: its `live` lane
// each job as the page's collapsed card text, then a tag tail only the model sees, and its other
// lanes and jobs what a card holds when it is opened.
// ---------------------------------------------------------------------------------------------

import { collapsedText, generalTail, tagTail, type BoardProposal } from "./board-job-text.js";
import type { ClientContext } from "./forms.js";
import type { Category, GoalCriterion, GoalState, WorkBoardData, WorkBoardTicket } from "./forms/render-work-board.js";
import type { MatterTodos } from "./matter-todos.js";

const CRITERION_GLYPH: Record<GoalState, string> = { met: "✅", unmet: "❌", pending: "⏳" };

/** The lanes whose jobs board_card's `live` lane lists, in its order. Completed's and Shelved's
 * counts print before Superseded, and Loose Threads' and Proposed's counts after it. */
const LANES: [Category, string][] = [
  ["ready", "Ready"],
  ["wip", "In Progress"],
  ["bring_forward", "Bring Forward"],
  ["waiting", "Blocked"],
  ["superseded", "Superseded"],
];

function counted(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}

/** A criterion's counts. An inventory criterion is built from the markers still printed, so an item
 * the practitioner fixed has left it: `met` counts the items the practitioner shelved or suppressed,
 * and `total` the items still flagged, shelved or suppressed. The gate counts its open steps, or the open jobs while any is
 * open. Pending and every other criterion print no count. */
function countText(c: GoalCriterion): string {
  if (c.id === "gate") return c.outstanding > 0 ? ` (${c.outstanding} open)` : "";
  if (c.source !== "inventory" || c.state === "pending") return "";
  return ` (unmet ${c.outstanding}, met ${c.items.length - c.outstanding}, total ${c.items.length})`;
}

/** A criterion's items as the card prints them, in order. Items with the same text print once, where
 * the first stands, as `<item> ×<n>`, then ` (at <locator>, ...)` naming the row of each when the
 * criterion carries locators. The counts still count every item. */
function itemsText(c: GoalCriterion): string {
  const groups = new Map<string, (string | null)[]>();
  c.items.forEach((item, i) => {
    const locators = groups.get(item) ?? [];
    locators.push(c.locators?.[i] ?? null);
    groups.set(item, locators);
  });
  return [...groups]
    .map(([item, locators]) => {
      if (locators.length === 1) return item;
      const known = locators.filter((l) => l !== null);
      return `${item} ×${locators.length}${known.length === 0 ? "" : ` (at ${known.join(", ")})`}`;
    })
    .join("; ");
}

/** One criterion's line, with its ` — items` tail only on the card. A deadline criterion that
 * follows others in its anchor ends ` (after <their texts>)`, never a date. */
export function criterionLine(c: GoalCriterion, criteria: readonly GoalCriterion[], withItems: boolean): string {
  const items = !withItems || c.items.length === 0 ? "" : ` — ${itemsText(c)}`;
  const after = c.follows === undefined || c.follows.length === 0 ? "" : ` (after ${c.follows.map((id) => criteria.find((p) => p.id === id)?.text ?? id).join(", ")})`;
  return `- ${CRITERION_GLYPH[c.state]} ${c.id}: ${c.text}${after}${countText(c)}${items}`;
}

/** board_summary's Goal line: the board's one goal's description and its status, `none` when none is
 * stored; while it needs consolidation, the count of earlier statements to combine. */
function goalsHead(section: WorkBoardData): string {
  const toCombine = section.goals.to_combine;
  return `Goal: ${section.goals.description} (${section.goals.status ?? "none"})${toCombine === undefined ? "" : `, ${counted(toCombine.length, "statement")} to combine`}`;
}

export function jobsIn(section: WorkBoardData, category: Category): WorkBoardTicket[] {
  return section.tickets.filter((t) => t.category === category);
}

/** As the page draws it: a Proposal held on this filing shows as its job's keys, not a line of its own. */
export function proposedOf(section: WorkBoardData): BoardProposal[] {
  return section.proposals.filter((p) => p.lane === "proposed" || (p.lane === "held" && p.holder !== null && p.holder.ticketed_on !== null));
}

export function shelvedProposalsOf(section: WorkBoardData): BoardProposal[] {
  return section.proposals.filter((p) => p.lane === "rejected");
}

export function proposedHeading(section: WorkBoardData): string {
  return `## Proposed (${proposedOf(section).length})`;
}

export function shelvedHeading(section: WorkBoardData): string {
  return `## Shelved (${counted(jobsIn(section, "rejected").length, "job")}, ${counted(shelvedProposalsOf(section).length, "proposal")})`;
}

/** The To Do line: the description of the open to-do linked to this section's filing or proceeding,
 * `none linked`, or, when the to-dos were not read, why. */
function todoText(section: WorkBoardData, todos: MatterTodos): string {
  if ("note" in todos) return todos.note;
  const m = section.meta;
  const ref = m.filing_id === null ? `proceeding:${m.proceeding_id}` : `filing:${m.filing_id}`;
  return todos.rows.find((row) => row.filing_ref === ref)?.description ?? "none linked";
}

/**
 * The rendered section's summary, deterministic text with a fixed line grammar, unwrapped: the
 * header (matter number and description, client name and number, revision), `To Do:`,
 * `Goal: <description> (<status>)` (the statement of goals; `none` when none is stored), then
 * `Unmet completion criteria:` with one line per unmet or pending criterion in board order, as
 * board_card's criteria lane prints it without the items, and `Met completion criteria:` with the
 * met ids, or `none`. A section with no criteria to list (a pre-filing proceeding, a retired filing,
 * a type declaring none) prints `State: <state>` in place of both lists, with the card's text when
 * it has one. Everything else on the board is drafting_forms__board_card's.
 *
 * There a Proposal line is `- <glyph> <title>` with a detail line opening `  key:`, under
 * `## Proposed` or `## Shelved`. A job's
 * `  keys:` line prints each held key as `<key> = "<stored item>" (now: <glyph> "<current item>")`
 * when a Proposal in any lane carries that key, and `<key> = "<stored item>" (now: dead)` when none
 * does -- a Proposal held on this filing gets no line of its own, so that is where a session reads
 * whether the key still derives, its item now and its glyph. A pre-filing section or a retired
 * filing derives no Proposals at all, so there every key prints `<key> = "<stored item>"`.
 */
export function renderBoardSummary(section: WorkBoardData, client: ClientContext, todos: MatterTodos): string {
  const m = section.meta;
  const matter = [m.matter, client.matterDescription].filter((part) => part).join(" ");
  const header = [matter && `Matter ${matter}`, m.client && `Client ${m.client}${client.clientNo ? ` (${client.clientNo})` : ""}`, `Rev ${m.revision}`];
  const lines = [`# Milestone — ${header.filter((part) => part).join(" · ")}`, `To Do: ${todoText(section, todos)}`, goalsHead(section)];
  const criteria = section.criteria ?? [];
  if (section.goal === undefined || criteria.length === 0) {
    const state = m.state_since === null ? m.state_label : `${m.state_label} ${m.state_since}`;
    lines.push(`State: ${state}${section.goal?.text ? ` — ${section.goal.text}` : ""}`);
    return lines.join("\n");
  }
  const unmet = criteria.filter((c) => c.state !== "met");
  const met = criteria.filter((c) => c.state === "met").map((c) => c.id);
  lines.push(unmet.length === 0 ? "Unmet completion criteria: none" : "Unmet completion criteria:", ...unmet.map((c) => criterionLine(c, criteria, false)));
  lines.push(`Met completion criteria: ${met.length === 0 ? "none" : met.join(", ")}`);
  return lines.join("\n");
}

/**
 * board_card's `live` lane: every lane with its count, an empty one its heading alone. A job line is
 * the page's collapsed card text (collapsedText), then its tag tail: `eligible:` and `dispatch:` on a
 * Ready job, `idle` on an In progress job with no recorded activity for more than 15 minutes, measured
 * to the section's Rendered minute, then `idle past <N> h` past the firm's idle_flag_hours, and
 * `BF <date>` on a Bring Forward job, a lane printed between In Progress and Blocked. Ready
 * closes with `dispatch choice:`. Completed and Shelved print their counts alone between Blocked and
 * Superseded, Loose Threads and Proposed theirs after Superseded, a pre-filing section has no
 * Proposed, and `🧹 lapsed keys:` closes the lane when any.
 */
export function renderLiveLanes(section: WorkBoardData): string[] {
  const m = section.meta;
  const lines: string[] = [];
  for (const [category, heading] of LANES) {
    if (category === "superseded") lines.push(`## Completed (${jobsIn(section, "completed").length})`, shelvedHeading(section));
    const jobs = jobsIn(section, category);
    lines.push(`## ${heading} (${jobs.length})`);
    for (const t of jobs) lines.push(collapsedText(t) + tagTail(t, m.rendered) + generalTail(t));
    if (category === "ready") {
      const choice = jobs.find((t) => t.dispatch_skips.length === 0);
      lines.push(`dispatch choice: ${choice === undefined ? "none" : `#${choice.id} ${choice.title}`}`);
    }
  }
  lines.push(`## Loose Threads (${section.seeds.length})`);
  if (m.filing_id !== null && !m.job_only) lines.push(proposedHeading(section));
  if (section.lapsed_keys.length > 0) lines.push(`🧹 lapsed keys: ${section.lapsed_keys.join(", ")}`);
  return lines;
}
