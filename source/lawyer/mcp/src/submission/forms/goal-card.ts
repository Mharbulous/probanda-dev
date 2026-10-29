// The Completion Criteria card: its head and its rows.

import { storedLayout } from "./layout-snapshot.js";
import { SERVED_KINDS } from "./lifecycle.js";
import { fetchHearingDate, type FilingRow } from "./query.js";
import type { WorkBoardTicket } from "./work-board-ticket.js";
import type { Goal, GoalCriterion, GoalState, WorkBoardContext } from "./work-board-data.js";
import { declaredCriteria, inventoryCriterion, NEVER_DELIVERED_DOCS } from "./goal-criteria.js";
import { openJobs, PRE_FILING, PRE_SEND, readGate, type GateReading } from "./goal-gate.js";
import { holdsBeforeSend, readPreSendGate } from "./pre-send-hold.js";

/** The hearing-date criterion (shared/declared-layout.md section 6): met once the filing's
 * hearing_details row records a hearing date. It records a fact only, and is not a drafting
 * criterion, so it prints after the gate and holds nothing. */
function hearingDateCriterion(dbPath: string, filing: FilingRow): GoalCriterion {
  const met = fetchHearingDate(dbPath, filing.id) !== null;
  return { id: "hearing-date", text: "The hearing date is recorded", state: met ? "met" : "unmet", outstanding: 0, items: [], source: "sqlite" };
}

/** Design §2.9's gate and drafting rows, or null where none applies. The drafting criteria are the
 * rows above the Gate. While a counted job is open none applies. With every other row met, an unmet
 * `hearing-date` gives its own string, and an unmet deadline says only the drafting conditions hold.
 * `send` gives the "to send" variant, for a Writing the Sent write holds. `serve` gives the "to serve"
 * variant, for a Writing amended Rule 8-1 serves before filing: its hearing date comes at set-down,
 * after service, so an unmet `hearing-date` holds nothing and reads as an unmet deadline does. */
function cardText(
  drafting: readonly GoalCriterion[],
  gate: GateReading,
  hearing: GoalCriterion | null,
  deadlines: readonly GoalCriterion[],
  send: boolean,
  serve: boolean
): string | null {
  if (gate.jobs > 0) return null;
  if (drafting.every((c) => c.state === "met")) {
    if (gate.criterion.state === "met") {
      if (hearing?.state === "unmet" && !serve) return "Only the hearing date remains to be recorded.";
      const partial = deadlines.some((c) => c.state !== "met") || hearing?.state === "unmet";
      return `Every ${partial ? "drafting " : ""}condition holds. Awaiting your approval to ${send ? "send" : serve ? "serve" : "file"}.`;
    }
    if (gate.present && gate.open === 0) return `Drafting conditions hold. ${(send ? PRE_SEND : PRE_FILING).stale}`;
    if (gate.current) return `Drafting conditions hold. ${send ? "Pre-send" : "Pre-filing"} checks: ${gate.open} open.`;
    return send
      ? "Every drafting condition holds. Recording it as sent runs the pre-send checks again."
      : "Every drafting condition holds. The next session assembles the package and runs the pre-filing checks.";
  }
  return reviewOnly(drafting) ? REVIEW_ONLY_TEXT : null;
}

const REVIEW_ONLY_TEXT = "Only your review remains. Every other drafting condition holds.";
const reviewOnly = (drafting: readonly GoalCriterion[]): boolean => drafting.every((c) => c.state === "met" || (c.id === "counsel-review" && c.state === "unmet"));

/** Whether the Writing was created on `_NoVenue`'s `unstructured-internal`, for counsel only and never
 * sent or filed (jobs-stock.md §3b): its card has no `gate` row, and a `Deliver` an earlier save left
 * on it is never dispatched. Read off the stored type file, as render-general.ts reads a stock type. */
export function isInternalWriting(filing: FilingRow): boolean {
  return filing.layout_snapshot !== null && /\/Documents\/unstructured-internal\.md$/.test(storedLayout(filing).type_file ?? "");
}

/** An internal Writing's card string (isInternalWriting). It has no gate row and nothing to send, so
 * its drafting rows are its whole completion. Null while a counted job is open, as in cardText. */
function internalCardText(drafting: readonly GoalCriterion[], jobs: number): string | null {
  if (jobs > 0) return null;
  if (drafting.every((c) => c.state === "met")) return "Every drafting condition holds. This Writing is internal and is never sent.";
  return reviewOnly(drafting) ? REVIEW_ONLY_TEXT : null;
}

/** The card string of a type that declares no goal criteria (spec §5 "Milestone"). It never fires
 * the filing-ready declaration: its goal stays pending. */
const NO_CRITERIA_TEXT = "No completion criteria are declared for this type of Writing.";

/** The goal and its criteria (design §2.3). Retired, then filed or sent, then the gate and drafting
 * rows give the card string. The goal is met only when every criterion is, the linked deadlines
 * included, and pending where the type declares none or there is no inventory. */
export function goalFor(
  ctx: WorkBoardContext,
  tickets: readonly WorkBoardTicket[],
  shelved: ReadonlySet<string>,
  current: ReadonlySet<string>,
  deadlines: readonly GoalCriterion[]
): { goal: Goal; criteria: GoalCriterion[] } {
  const sentence = "Completion Criteria";
  if (ctx.lifecycle.state === "retired") {
    const reason = ctx.filing.retirement_reason;
    return { goal: { sentence, state: "pending", text: `Retired on ${ctx.lifecycle.since}` + (reason ? ` — ${reason.replace(/_/g, " ")}` : "") }, criteria: [] };
  }
  const send = holdsBeforeSend(ctx.filing);
  const serve = SERVED_KINDS.has(ctx.filing.kind);
  // The label follows the lifecycle, which a venue's letter keeps as Filed. A served kind with a
  // served copy was recorded by record_served; one without was filed under the old rule.
  const verb = ctx.filing.needs_forum_parts === 0 ? "Sent" : serve && ctx.filing.sent_copy_id !== null ? "Served" : "Filed";
  const filed = ctx.filing.filed_on === null ? null : `${verb} on ${ctx.filing.filed_on}`;
  const declared = declaredCriteria(ctx.filing);
  // No gate row here, so no currency reading either: this goal stays pending and never reads ready to send.
  if (declared.length === 0) return { goal: { sentence, state: "pending", text: filed ?? NO_CRITERIA_TEXT }, criteria: [] };

  const forum = ctx.inventory === null ? null : ctx.inventory.filter((e) => !NEVER_DELIVERED_DOCS.has(e.doc));
  const drafting = declared.map((c) => inventoryCriterion(c, forum, shelved, current));
  const jobs = openJobs(tickets);
  // An internal Writing is never sent or filed, so it has no gate row: its drafting rows are its completion.
  const gate =
    isInternalWriting(ctx.filing)
      ? null
      : send
        ? readPreSendGate(ctx, tickets, filed !== null, drafting, jobs)
        : readGate(tickets, ctx.revision, filed !== null, PRE_FILING, jobs);
  // A non-empty `declared` means a stored layout whose goal_criteria declaredCriteria has already checked.
  const hearing = (storedLayout(ctx.filing).layout.goal_criteria as string[]).includes("hearing-date") ? hearingDateCriterion(ctx.dbPath, ctx.filing) : null;
  const criteria = [...drafting, ...(gate === null ? [] : [gate.criterion]), ...(hearing === null ? [] : [hearing]), ...deadlines];
  const state: GoalState = forum === null ? "pending" : criteria.every((c) => c.state === "met") ? "met" : "unmet";
  const text = gate === null ? internalCardText(drafting, jobs.length) : cardText(drafting, gate, hearing, deadlines, send, serve);
  return { goal: { sentence, state, text: filed ?? text }, criteria };
}
