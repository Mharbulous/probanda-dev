// Each ticket's board category, and the fields derived per ticket beside it.
//
// The category rules live here and only here. The board page draws the category it is given, or, once
// its clock passes a held job's given lapse minute, the after-lapse category it is also given. It never
// derives one, so a session and the practitioner always see the same sort.

import { LAPSE_AFTER_MINUTES } from "./job-activity.js";
import { type StepStateFields, stepResolved } from "./step-state.js";
import type { TicketRow, TicketStatus } from "./work-board-reads.js";
import type { Category, WorkBoardEdge, WorkBoardTicket } from "./work-board-ticket.js";

/** Detects a blocker cycle reachable from `startId` by walking ticket_blocks upward
 * (blocked -> blocker -> its own blocker -> ...), independent of ticket status --
 * a cycle is a charting defect regardless of which side happens to be queued right
 * now. Bounded by construction: each ticket id is visited at most once. */
export function reachesItself(startId: number, blockersOf: Map<number, number[]>): boolean {
  const stack = [...(blockersOf.get(startId) ?? [])];
  const seen = new Set<number>();
  while (stack.length > 0) {
    const cur = stack.pop() as number;
    if (cur === startId) return true;
    if (seen.has(cur)) continue;
    seen.add(cur);
    for (const next of blockersOf.get(cur) ?? []) stack.push(next);
  }
  return false;
}

/** A job whose plan ran to the end: at least one step, every step done, or dropped or put off on the
 * practitioner's words (step-state.ts). */
const allStepsDone = (steps: readonly StepStateFields[]): boolean => steps.length > 0 && steps.every(stepResolved);

/** A job that holds its scope's material: in progress by status, not category, so a shelved job with
 * open steps still holds it under its lock. A job with every step done holds none. */
export const holdsMaterial = (t: { status: TicketStatus; steps: readonly StepStateFields[] }): boolean => t.status === "wip" && !allStepsDone(t.steps);

/** A job's session-active stamp, kept only while it is In progress and no earlier than its lock. */
export function activeAt(ticket: TicketRow, stamp: string | undefined): string | null {
  if (ticket.status !== "wip" || stamp === undefined || ticket.locked_at === null) return null;
  return stamp.replace(" ", "T") >= ticket.locked_at.replace(" ", "T") ? stamp : null;
}

/** An edge outside this proceeding (status null) is treated as an unresolved, non-superseded
 * blocker -- it can never silently read as "completed" or "no blocker at all" the way
 * filtering it out of the list would. A wip job is In Progress whether or not its steps are all
 * stamped, so Dispatch never claims a job another session still holds. A queued job whose blocker
 * was superseded or shelved is Blocked until it is outlined afresh. A queued job whose bring-forward
 * date (bf_on) is later than `today`, the local date, is in Bring Forward whatever its blockers;
 * from that date on it reads as Blocked or Ready, with no write. */
export function classify(ticket: TicketRow, blockers: WorkBoardEdge[], conflictPartners: WorkBoardEdge[], today: string): Category {
  if (ticket.rejected_at !== null) return "rejected";
  if (ticket.status === "completed") return "completed";
  if (ticket.status === "superseded") return "superseded";
  if (ticket.status === "wip") return "wip";
  // queued
  if (ticket.bf_on != null && ticket.bf_on > today) return "bring_forward";
  if (blockers.some((b) => b.status !== "completed")) return "waiting";
  if (conflictPartners.some((p) => p.status === "wip")) return "waiting";
  return "ready";
}

/** A superseded ticket's reason (Goal card design §4.7). A `superseded_by` pointer wins whatever
 * the filing's state: the pointer row says it. Then the dead-marker closure's stamp, then the
 * retirement of the ticket's own filing, which supersedes only that filing's queued jobs (jobs.md
 * §9a). A stale gate job not yet linked to its replacement (jobs.md §14) matches none. */
export function supersededReason(ticket: TicketRow, retiredOn: ReadonlyMap<number, string | null>): string | null {
  if (ticket.status !== "superseded" || ticket.superseded_by !== null) return null;
  if (ticket.superseded_marker_gone_at !== null) return `Superseded: its marker no longer shows (${ticket.superseded_marker_gone_at.slice(0, 10)})`;
  const retired = ticket.filing_id === null ? null : retiredOn.get(ticket.filing_id) ?? null;
  return retired === null ? null : `Superseded by: retirement of this Writing (${retired})`;
}

/** Whether two scope entries name common material: equal strings do, and a bare `entity` names
 * every `entity:<id>` of that table, in either direction. */
export const scopesShare = (a: string, b: string): boolean => a === b || a.split(":")[0] === b || b.split(":")[0] === a;

/** A minute-precision local stamp (`2026-09-02T10:05`, `2026-10-02 09:00`) in whole minutes, or
 * null when it does not read as one. */
export function localMinutes(stamp: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/.exec(stamp);
  return m === null ? null : Math.round(new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]).getTime() / 60_000);
}

/** The minute a job's idle time runs from: its last activity, or a later wake-up minute of a ⏳ step
 * not yet done, which counts as activity until it passes. Null with nothing to measure from. */
export function idleSince(t: Pick<WorkBoardTicket, "last_activity_at" | "steps">): number | null {
  const waits = t.steps.filter((s) => s.done_at === null && s.status === "waiting").map((s) => s.wait_until ?? null);
  const minutes = [t.last_activity_at, ...waits].map((s) => (s == null ? null : localMinutes(s))).filter((m): m is number => m !== null);
  return minutes.length === 0 ? null : Math.max(...minutes);
}

/** Whole minutes from a job's idle start to `rendered`, or null with nothing to measure. */
function idleMinutes(t: Pick<WorkBoardTicket, "last_activity_at" | "steps">, rendered: string): number | null {
  const now = localMinutes(rendered);
  const last = idleSince(t);
  return now === null || last === null ? null : now - last;
}

/** Whether a held, unshelved job's lock has lapsed at `rendered` (job-activity.ts, ADR 0015): every
 * board reads such a job as released. assign_job's lapsedClause is the same test in SQL. */
export function lockLapsed(t: Pick<WorkBoardTicket, "status" | "locked_by" | "rejected_at" | "last_activity_at" | "steps">, rendered: string): boolean {
  if (t.status !== "wip" || t.locked_by === null || t.rejected_at !== null) return false;
  const idle = idleMinutes(t, rendered);
  return idle !== null && idle >= LAPSE_AFTER_MINUTES;
}

/** The local minute (`YYYY-MM-DDTHH:MM`) a held, unshelved job's lock will lapse, when it has not
 * lapsed at `rendered`; null otherwise. The page draws the job's after-lapse category from then. */
export function lapsesAt(t: Pick<WorkBoardTicket, "status" | "locked_by" | "rejected_at" | "last_activity_at" | "steps">, rendered: string): string | null {
  if (t.status !== "wip" || t.locked_by === null || t.rejected_at !== null || lockLapsed(t, rendered)) return null;
  const since = idleSince(t);
  if (since === null) return null;
  const d = new Date((since + LAPSE_AFTER_MINUTES) * 60_000);
  const two = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}T${two(d.getHours())}:${two(d.getMinutes())}`;
}
