// The Goal card's gate row, read off the board's gate job, and the job titles it counts or leaves out.

import type { GoalCriterion, GoalState } from "./work-board-data.js";
import type { WorkBoardTicket } from "./work-board-ticket.js";

const GATE_TITLE = "Pre-filing consistency gate";
/** A Pass 2 finding job's fixed title (jobs-stock.md §3g): a position the firm's own prior
 * correspondence contradicts. While one is open the pre-send hold reads `position-conflict` unmet. */
export const POSITION_CONFLICT_TITLE = "Decide a position our own correspondence contradicts";
/** The job the Sent write's pre-send hold creates (jobs.md "Pre-send gate"). */
export const PRE_SEND_TITLE = "Pre-send gate";
/** The stock jobs' fixed titles (jobs-stock.md §3b, the one list), which are not drafting work. The
 * service and set-down jobs follow amended Rule 8-1 (B.C. Reg. 105/2026); `File and serve` stays for
 * a notice filed under the old rule. */
export const STOCK_TITLES: ReadonlySet<string> = new Set([
  "Availability letter",
  "File and serve",
  "Serve the application",
  "Serve the response",
  "Set down for hearing",
  "Reply affidavits",
  "File the served response",
  "Application book",
  "Reset for hearing",
  "Draft the letter",
  "Draft the Writing",
  "Deliver",
]);
/** Jobs identified by fixed title that the gate row's open-job reading leaves out (design §2.4): the
 * two gate jobs (jobs.md §14 and "Pre-send gate") and the stock jobs (plan decision 3; jobs.md §3b). */
const UNCOUNTED_TITLES: ReadonlySet<string> = new Set([GATE_TITLE, PRE_SEND_TITLE, ...STOCK_TITLES]);
/** The title prefixes of service and filing work, which waits on the gate: hand-outlined work under
 * one of these titles is stock work too (jobs-stock.md §3b). */
const BEFORE_GATE_PREFIXES = ["File and serve", "Serve the application", "Serve the response"];
export const waitsOnGate = (title: string): boolean => BEFORE_GATE_PREFIXES.some((p) => title.startsWith(p));

/** Every counted job this board shows still to do, rejected jobs left out (design §2.4). Loose threads
 * are not jobs. While any is open the gate row is unmet and names them. Hand-outlined filing or service
 * work is stock work too, or it would hold the gate it waits on. */
export function openJobs(tickets: readonly WorkBoardTicket[]): WorkBoardTicket[] {
  return tickets.filter(
    (t) => (t.status === "queued" || t.status === "wip") && t.rejected_at === null && !UNCOUNTED_TITLES.has(t.title) && !waitsOnGate(t.title)
  );
}

const WAIVER = " — WAIVED: ";

/** The revision a gate step's check ran against: the ` [rev N]` token ending its text before any
 * waiver (plan, "Names this plan fixes"), so a waiver reason carrying the pattern is never read. */
function recordedRevision(text: string): number | null {
  const m = text.split(WAIVER)[0].match(/\[rev (\d+)\]$/);
  return m ? Number(m[1]) : null;
}

export interface GateReading {
  criterion: GoalCriterion;
  present: boolean;
  open: number;
  /** Some step records a check run at the current revision (design §2.5). */
  current: boolean;
  /** How many counted jobs are open (openJobs). While any is, the row is unmet and names them. */
  jobs: number;
}

/** Which gate a Writing's `gate` row reads: the Pre-send gate job for a Writing the Sent write
 * holds (holdsBeforeSend), the pre-filing gate job for any other. */
export interface GateKind {
  title: string;
  text: string;
  stale: string;
}
export const PRE_FILING: GateKind = {
  title: GATE_TITLE,
  text: "The pre-filing checks are passed or waived",
  stale: "The pre-filing checks ran before the latest changes.",
};
export const PRE_SEND: GateKind = {
  title: PRE_SEND_TITLE,
  text: "The pre-send checks are passed or waived",
  stale: "The pre-send checks ran before the latest changes.",
};

/** The Gate criterion, read off the board's gate job (design §2.4, §2.5). Unmet when the job is
 * absent, a step is open, or the gate is stale: no step records a check run at the current revision.
 * Setting filed_on moves the revision, so a filed filing's gate is never stale. Met or stale, it
 * names the date the checks ran, and met, each waived step, whose text carries the practitioner's
 * verbatim line. While a counted job is open it is unmet whatever the gate job reads, and names the
 * open jobs instead. */
export function readGate(tickets: readonly WorkBoardTicket[], revision: number, filed: boolean, kind: GateKind, jobs: readonly WorkBoardTicket[]): GateReading {
  const criterion = (state: GoalState, outstanding: number, items: string[]): GoalCriterion =>
    jobs.length > 0
      ? { id: "gate", text: kind.text, state: "unmet", outstanding: jobs.length, items: jobs.map((t) => t.title), source: "sqlite" }
      : { id: "gate", text: kind.text, state, outstanding, items, source: "sqlite" };
  const gate = tickets.find((t) => t.title === kind.title && t.status !== "superseded");
  if (gate === undefined) return { criterion: criterion("unmet", 0, []), present: false, open: 0, current: false, jobs: jobs.length };
  const open = gate.steps.filter((s) => s.done_at === null);
  const revisions = gate.steps.map((s) => recordedRevision(s.text)).filter((n): n is number => n !== null);
  const current = revisions.length > 0 && Math.max(...revisions) >= revision;
  const reading = { present: true, open: open.length, current, jobs: jobs.length };
  if (open.length > 0) return { ...reading, criterion: criterion("unmet", open.length, open.map((s) => s.text)) };
  // A waived step's done_at is the waiver's; the run's own date is a step the run closed. With none,
  // the date is left out rather than read off a waiver.
  const ranOn = gate.steps
    .filter((s) => !s.text.includes(WAIVER) && s.done_at !== null)
    .map((s) => s.done_at as string)
    .sort()
    .at(-1);
  const ran = ranOn === undefined ? [] : [`checks run on ${ranOn.slice(0, 10)}`];
  if (!current && !filed) return { ...reading, criterion: criterion("unmet", 0, [kind.stale, ...ran]) };
  const waived = gate.steps.filter((s) => s.text.includes(WAIVER)).map((s) => s.text);
  return { ...reading, criterion: criterion("met", 0, [...ran, ...waived]) };
}
