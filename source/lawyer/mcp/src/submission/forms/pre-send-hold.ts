// The Sent write's hold (jobs.md §14a): which Writings it holds and the checks it reads.

import { storedLayout } from "./layout-snapshot.js";
import { currencyLabel, currencyWithheldClauses, type LayoutPart } from "./projections.js";
import type { MarkerInventory } from "./proposal-inventory.js";
import { liveTicketClause, type FilingRow } from "./query.js";
import { authorityUnconfirmed } from "./render-general.js";
import { rows } from "./work-board-reads.js";
import type { WorkBoardTicket } from "./work-board-ticket.js";
import type { CriterionId, GoalCriterion, GoalState, WorkBoardContext } from "./work-board-data.js";
import { buildProceedingBoard } from "./build-proceeding-board.js";
import { proposalsFor } from "./board-proposals.js";
import { declaredCriteria, inventoryCriterion, NEVER_DELIVERED_DOCS } from "./goal-criteria.js";
import { POSITION_CONFLICT_TITLE, PRE_SEND, PRE_SEND_TITLE, readGate, type GateReading } from "./goal-gate.js";

/** The criteria the pre-send hold reads (#951 note; `recipients`, #1234). Counsel's review never
 * holds sending. */
const HELD_CRITERIA: readonly CriterionId[] = ["primary-authority", "excerpts", "noting-up", "recipients"];

/** Whether the Sent write holds this Writing before it is sent (jobs.md §14a): a Writing that needs
 * no forum parts, and any general-renderer Writing, a venue's `letter` included (#1236). Those are
 * the Writings `record_sent` records. A row with no stored layout is a seeded test row. */
export function holdsBeforeSend(filing: FilingRow): boolean {
  return filing.needs_forum_parts === 0 || (filing.layout_snapshot !== null && storedLayout(filing).layout.renderer === "general");
}

/** A Writing the Sent write holds: its `gate` row reads the Pre-send gate job as readGate
 * reads the pre-filing gate job. The Sent write creates that job only when a held criterion or the
 * currency check is unmet, so with no job the row reads those itself: met when none is unmet,
 * pending with no inventory. While a counted job is open it is unmet and names the open jobs, as
 * readGate's row does. */
export function readPreSendGate(
  ctx: WorkBoardContext,
  tickets: readonly WorkBoardTicket[],
  filed: boolean,
  drafting: readonly GoalCriterion[],
  jobs: readonly WorkBoardTicket[]
): GateReading {
  if (tickets.some((t) => t.title === PRE_SEND_TITLE && t.status !== "superseded")) return readGate(tickets, ctx.revision, filed, PRE_SEND, jobs);
  const held = drafting.filter((c) => HELD_CRITERIA.includes(c.id));
  const currency = unmetCurrencyCriterion(ctx.dbPath, ctx.filing);
  const confirmed = unmetAuthorityConfirmedCriterion(ctx.filing);
  const conflict = unmetPositionConflictCriterion(ctx.dbPath, ctx.filing);
  const unmet = [
    ...held.filter((c) => c.state === "unmet"),
    ...(currency === null ? [] : [currency]),
    ...(confirmed === null ? [] : [confirmed]),
    ...(conflict === null ? [] : [conflict]),
  ];
  const state: GoalState = held.some((c) => c.state === "pending") ? "pending" : unmet.length > 0 ? "unmet" : "met";
  return {
    criterion:
      jobs.length > 0
        ? { id: "gate", text: PRE_SEND.text, state: "unmet", outstanding: jobs.length, items: jobs.map((t) => t.title), source: "sqlite" }
        : { id: "gate", text: PRE_SEND.text, state, outstanding: unmet.length, items: unmet.map((c) => c.text), source: "inventory" },
    present: false,
    open: 0,
    current: false,
    jobs: jobs.length,
  };
}

/** The declared held criteria (HELD_CRITERIA) that `inventory` leaves unmet on this Writing,
 * derived exactly as its Job Board derives them from the same inventory: the Sent write's hold
 * (#951 note). */
export function unmetHeldCriteria(dbPath: string, filing: FilingRow, inventory: MarkerInventory): GoalCriterion[] {
  const board = buildProceedingBoard(dbPath, filing.proceeding_id);
  const { shelved, current } = proposalsFor({ dbPath, proceeding: { id: filing.proceeding_id }, filing, inventory }, board);
  const forum = inventory.filter((e) => !NEVER_DELIVERED_DOCS.has(e.doc));
  return declaredCriteria(filing)
    .filter((c) => HELD_CRITERIA.includes(c.id))
    .map((c) => inventoryCriterion(c, forum, shelved, current))
    .filter((c) => c.state === "unmet");
}

/** The pre-send hold's universal currency check (jobs.md §14a), read live from the database: unmet
 * while an implied clause this Writing prints names an enactment whose stored statute-currency
 * result is not `current`; null when none does. */
export function unmetCurrencyCriterion(dbPath: string, filing: FilingRow): GoalCriterion | null {
  const withheld = currencyWithheldClauses(dbPath, filing.id, storedLayout(filing).layout.parts as LayoutPart[]);
  if (withheld.length === 0) return null;
  return {
    id: "currency",
    text: "No implied clause names an enactment whose statute-currency result is not current",
    state: "unmet",
    outstanding: withheld.length,
    items: withheld.map((c) => `clause_id ${c.clause_id} [currency: ${currencyLabel(c)}]`),
    source: "sqlite",
  };
}

/** The pre-send hold's authority-confirmed check (jobs.md §14a, after `currency`), read live from the
 * Writing's row: unmet while `authority_confirmed_on` is NULL on a Writing `authorityUnconfirmed`
 * names, cleared by setting it. Nothing parses the Writing's prose. */
export function unmetAuthorityConfirmedCriterion(filing: FilingRow): GoalCriterion | null {
  if (filing.layout_snapshot === null || !authorityUnconfirmed(filing, storedLayout(filing).layout)) return null;
  return {
    id: "authority-confirmed",
    text: "The Writing records that its cited authority is linked, or that it cites none",
    state: "unmet",
    outstanding: 1,
    items: ["link each authority the text cites, or record that it cites none"],
    source: "sqlite",
  };
}

/** The pre-send hold's position-conflict check (jobs-stock.md §3g; letter-passes spec §12 decision
 * 1), read live from the database: unmet while a queued or wip, unshelved Pass 2 finding job is on
 * the Writing, met once each is closed. Null when none is open. */
export function unmetPositionConflictCriterion(dbPath: string, filing: FilingRow): GoalCriterion | null {
  const open = rows<{ id: number }>(
    dbPath,
    `SELECT id FROM tickets WHERE filing_id = ? AND title = ? AND status IN ('queued', 'wip') AND rejected_at IS NULL${liveTicketClause(dbPath)} ORDER BY id`,
    [filing.id, POSITION_CONFLICT_TITLE]
  );
  if (open.length === 0) return null;
  return {
    id: "position-conflict",
    text: "Counsel has decided every position the firm's own correspondence contradicts",
    state: "unmet",
    outstanding: open.length,
    items: open.map((r) => `decide Job #${r.id}`),
    source: "sqlite",
  };
}
