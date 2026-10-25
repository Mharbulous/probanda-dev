// One job and one Proposal as fixed-grammar text, for board_summary and board_card (board-summary.ts,
// board-card-render.ts).

import { localMinutes, type Category, type DispatchSkip, type WorkBoardData, type WorkBoardEdge, type WorkBoardTicket } from "./forms/render-work-board.js";
import { stepGlyphText, stepView } from "./forms/step-state.js";

/** The page's chip labels (workboard-shell.ts CHIPS). The page's copy lives in inline JavaScript,
 * so this one is kept by hand; workboard-file-url.e2e's mirror test catches drift. */
const CHIP_LABELS: Record<Category, string> = {
  ready: "Ready",
  wip: "In Progress",
  bring_forward: "Bring Forward",
  waiting: "Blocked",
  superseded: "Superseded",
  completed: "Completed",
  rejected: "Shelved",
};

/** The idle report's threshold (draft/SKILL.md): a job that moved this recently gets no idle tag. */
const IDLE_AFTER_MINUTES = 15;

function edgeText(edges: WorkBoardEdge[]): string {
  if (edges.length === 0) return "—";
  return edges
    .map((e) => `#${e.id} (${e.status === null ? "not in this proceeding" : e.rejected ? `${e.status}, shelved` : e.status})`)
    .join(", ");
}

export type BoardProposal = WorkBoardData["proposals"][number];

/** What derives now for each key: the Proposals by key, or null on a pre-filing section, a
 * retired filing or a Job Board with no Writing, which derive none. */
export function derivedOf(section: WorkBoardData): Map<string, BoardProposal> | null {
  const m = section.meta;
  return m.filing_id === null || m.state_label === "Retired" || m.job_only ? null : new Map(section.proposals.map((p) => [p.key, p]));
}

/** A held key with its stored item and, when `derived` is given, what derives for it now: the
 * Proposal's glyph and current item, or `dead` when no Proposal in any lane carries the key. */
function keyText(key: string, stored: string | undefined, derived: Map<string, BoardProposal> | null): string {
  const head = `${key} = ${JSON.stringify(stored)}`;
  if (derived === null) return head;
  const now = derived.get(key);
  return `${head} (now: ${now === undefined ? "dead" : `${now.marker} ${JSON.stringify(now.item)}`})`;
}

function skipText(s: DispatchSkip): string {
  if (s.reason === "practitioner_own") return "practitioner's own";
  if (s.reason === "either_or") return `either/or with #${s.job}`;
  if (s.reason === "before_gate") return "before the pre-filing gate";
  return `shared material with #${s.job}: ${s.material.join(", ")}`;
}

/** A job as the page draws its collapsed card: `- Job #<id> <title>`, then, on a merged board, its
 * Writing, then its subtitle, its lock note and its chip, joined by ` · `, the chip followed by
 * done/total when the job has steps. */
export function collapsedText(t: WorkBoardTicket): string {
  const done = t.steps.filter((s) => s.done_at !== null).length;
  const chip = t.steps.length > 0 ? `${CHIP_LABELS[t.category]} ${done}/${t.steps.length}` : CHIP_LABELS[t.category];
  return [`- Job #${t.id} ${t.title}`, ...(t.writing ? [t.writing] : []), ...(t.subtitle ? [t.subtitle] : []), ...(t.lock_note ? [t.lock_note] : []), chip].join(" · ");
}

/** The tag that ends a General Job's line in every lane: one with no Writing, drawn on every
 * Writing's board in its proceeding, so its copy on a second board never reads as a duplicate. */
export function generalTail(t: WorkBoardTicket): string {
  return t.general ? " · general" : "";
}

/** Whole minutes as days, hours and minutes, dropping leading zero units only. */
function elapsedText(minutes: number): string {
  const d = Math.floor(minutes / 1440);
  const h = Math.floor((minutes % 1440) / 60);
  const m = minutes % 60;
  if (d > 0) return `${d} ${d === 1 ? "day" : "days"} ${h} h ${m} min`;
  return h > 0 ? `${h} h ${m} min` : `${m} min`;
}

/** An In progress job's idle tag, measured to the section's Rendered minute from its last activity:
 * the latest of its lock, its done steps, the loose threads captured from it, the answers saved for it
 * and the sources to get added to it or closed on it (`last_activity_at`). None within the threshold, and none with nothing to measure from. */
function idleTag(t: WorkBoardTicket, rendered: string): string | null {
  const now = localMinutes(rendered);
  const last = t.last_activity_at === null ? null : localMinutes(t.last_activity_at);
  if (now === null || last === null) return null;
  const elapsed = Math.max(0, now - last);
  if (elapsed <= IDLE_AFTER_MINUTES) return null;
  const done = t.steps.filter((s) => s.done_at !== null).length;
  return `idle ${elapsedText(elapsed)}, ${t.steps.length === 0 ? "no plan yet" : `about ${Math.floor((done / t.steps.length) * 100)}%`}`;
}

/** The tags only the model sees after a `live` lane job line: Dispatch's on a Ready job, the idle
 * report's on an In progress one, then its idle flag past the firm's threshold, and `BF <date>` on
 * a Bring Forward one: its start date as a plain date, never a deadline and never a day count. */
export function tagTail(t: WorkBoardTicket, rendered: string): string {
  if (t.category === "ready") {
    const eligible = t.eligible ? "yes" : `no (${t.ineligible_reasons.join(", ")})`;
    const dispatch = t.dispatch_skips.length === 0 ? "ok" : `skip (${t.dispatch_skips.map(skipText).join("; ")})`;
    return ` · eligible: ${eligible} · dispatch: ${dispatch}`;
  }
  if (t.category === "bring_forward") return ` · BF ${t.bf_on}`;
  if (t.category !== "wip") return "";
  const idle = idleTag(t, rendered);
  return (idle === null ? "" : ` · ${idle}`) + (t.idle_flag ? ` · ${t.idle_flag}` : "");
}

/** A job's sources to get as its card prints them: the count got, then every source that is open
 * (☐) or closed not retrieved (☒, with its reason). A source got is counted and not listed. They are
 * the job's own record beside its steps, never part of its plan. */
function sourcesText(sources: WorkBoardTicket["sources"]): string {
  const got = sources.filter((s) => s.outcome === "got").length;
  const rest = sources
    .filter((s) => s.outcome !== "got")
    .map((s) => (s.outcome === null ? `☐ ${s.kind}: ${s.label}` : `☒ ${s.kind}: ${s.label} (not retrieved${s.reason === null ? "" : `: ${s.reason}`})`));
  return [`${got} of ${sources.length} got`, ...rest].join(" · ");
}

/** A step as board_card prints it: its ordinal, its glyph (step-state.ts, at the section's Rendered
 * minute), its text, then on a done step its stamp and on a step dropped or put off the
 * practitioner's words. A waiting step's minute is the time it is next checked, never a deadline. */
function stepText(s: WorkBoardTicket["steps"][number], rendered: string): string {
  const view = stepView(s, rendered);
  const tail = view === "done" ? ` (${s.done_at})` : (view === "cancelled" || view === "deferred") && s.status_note ? ` (${JSON.stringify(s.status_note)})` : "";
  return `${s.ordinal} ${stepGlyphText(s, rendered)} ${s.text}${tail}`;
}

/** A job as board_card prints it. A live, completed or shelved job carries its detail, ending with
 * the open loose threads captured from it, the answers saved for it and its sources to get, then, on a completed or
 * shelved one, when it was completed or shelved; a superseded one its pointer and reason. `seeds`
 * are the section's open loose threads. */
export function jobCardLines(t: WorkBoardTicket, derived: Map<string, BoardProposal> | null, seeds: WorkBoardData["seeds"], rendered: string): string[] {
  const head = collapsedText(t) + generalTail(t);
  if (t.category === "superseded") {
    return [head, `  superseded by: ${t.superseded_by === null ? "—" : `#${t.superseded_by.id}`} · reason: ${t.superseded_reason ?? "—"}`];
  }
  // The holder tag's 8 matches assign-job.ts's substr(locked_by, -8). A wip job always has a holder.
  const holder = t.locked_by === null ? "" : ` · holder: ${t.locked_by.slice(-8)}`;
  const locked =
    t.category === "wip"
      ? ` · taken: ${t.locked_at ?? "(unknown time)"}${holder} · last activity: ${t.last_activity_at ?? "(unknown time)"}${t.active_at === null ? "" : ` · session active: ${t.active_at}`}`
      : "";
  const lines = [head, `  kind: ${t.kind} · priority: ${t.priority}${locked}`, `  intent: ${t.intent}`];
  if (t.proposal_keys.length > 0) lines.push(`  keys: ${t.proposal_keys.map((key) => keyText(key, t.proposal_items[key], derived)).join("; ")}`);
  lines.push(`  scope: ${t.scope.length === 0 ? "—" : t.scope.join(", ")} · waits on: ${edgeText(t.blocked_by)} · either-or: ${edgeText(t.conflicts)}`);
  if (t.steps.length > 0) {
    lines.push(`  steps: ${t.steps.map((s) => stepText(s, rendered)).join(" · ")}`);
  }
  const own = seeds.filter((s) => s.origin_ticket_id === t.id);
  if (own.length > 0) lines.push(`  loose threads: ${own.map((s) => `loose thread ${s.id}: ${JSON.stringify(s.idea)} (${s.created})`).join("; ")}`);
  if (t.answers.length > 0) lines.push(`  answers: ${t.answers.map((a) => `${a.file_path} (${a.saved_at})`).join("; ")}`);
  if (t.sources.length > 0) lines.push(`  sources to get: ${sourcesText(t.sources)}`);
  if (t.category === "bring_forward") lines.push(`  bring forward: ${t.bf_on}`);
  if (t.category === "completed") lines.push(`  completed: ${t.completed_at ?? "(unknown time)"}`);
  if (t.category === "rejected") lines.push(`  shelved: ${t.rejected_at ?? "(unknown time)"}`);
  return lines;
}

/** A Proposal's line and detail line, then, on a note-up of a statute, regulation or rule, one
 * `  step <n>:` line per provision the filing cites, or `  steps: none`. */
export function proposalLines(p: BoardProposal): string[] {
  const lane = p.lane === "held" && p.holder !== null ? `held by #${p.holder.ticket_id}${p.holder.ticketed_on === null ? "" : ` on ${p.holder.ticketed_on}`}` : p.lane;
  const steps = p.steps === undefined ? [] : p.steps.length === 0 ? ["  steps: none"] : p.steps.map((s, i) => `  step ${i + 1}: ${s}`);
  return [`- ${p.marker} ${p.title}`, `  key: ${p.key} · item: ${p.item} · lane: ${lane}`, ...steps];
}
