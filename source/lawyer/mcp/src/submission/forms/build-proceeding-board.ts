// One proceeding's tickets, each classified, with its open loose threads and its Proposal holders.

import { today as localToday } from "../../knowledge/common.js";
import { rows } from "../query-rows.js";
import { ticketAnswersHeld } from "./query.js";
import { ticketSourcesHeld } from "./track-source.js";
import {
  fetchDeletedTickets,
  fetchProceedingTickets,
  type AnswerRow,
  type BlockRow,
  type ConflictRow,
  type DeletedTicket,
  type FilingRetiredRow,
  type ProposalRow,
  type ScopeRow,
  type SourceRow,
  type StepRow,
} from "./work-board-reads.js";
import type { WorkBoardEdge, WorkBoardTicket } from "./work-board-ticket.js";
import { fetchOpenSeeds, type WorkBoardSeed } from "./work-board-seeds.js";
import { fetchJobActivity } from "./job-activity.js";
import { activeAt, classify, holdsMaterial, reachesItself, scopesShare, supersededReason } from "./ticket-category.js";
import { UNATTENDED_TOKEN_PREFIX } from "./unattended-eligibility.js";

function groupBy<T>(items: T[], key: (item: T) => number): Map<number, T[]> {
  const map = new Map<number, T[]>();
  for (const item of items) {
    const list = map.get(key(item)) ?? [];
    list.push(item);
    map.set(key(item), list);
  }
  return map;
}

/** Every ticket and open loose thread in one proceeding, each ticket already classified. The per-filing
 * Milestone and the Matter Board both draw from this, so the category rules run in one place. */
export interface ProceedingBoard {
  /** In board order (priority, then id), each with the filing it belongs to -- null when proceeding-scoped. */
  tickets: { filing_id: number | null; ticket: WorkBoardTicket }[];
  /** In id order, every open loose thread in the proceeding whatever its filing (ADR 0024 D11). */
  seeds: Omit<WorkBoardSeed, "from_filing">[];
  /** Proposal key -> the live (queued or wip, unrejected) ticket holding it, and the filing that
   * ticket sits on. First ticket by id wins a duplicated key (plan A4). */
  holders: Map<string, { ticket_id: number; filing_id: number | null }>;
  /** The proceeding's deleted jobs, in id order. They are on no card, in no count and in no summary. */
  deleted: DeletedTicket[];
}

/** `today` is the local date the Bring Forward lane reads against: a section builder passes its
 * Rendered minute's date, so the lane agrees with the stamp the section prints. */
export function buildProceedingBoard(dbPath: string, proceedingId: number, today: string = localToday()): ProceedingBoard {
  const proceedingTickets = fetchProceedingTickets(dbPath, proceedingId);
  const ticketById = new Map(proceedingTickets.map((t) => [t.id, t]));
  const proceedingIds = proceedingTickets.map((t) => t.id);
  const idList = proceedingIds.map(() => "?").join(",");
  // A deleted job's rows all stay (jobs-closeout.md §10a) and are read as if it were gone: an edge
  // touching it is dropped, so a job that waited on it no longer does and its either/or partner is
  // no longer held back, and no edge names a job the page has no card for.
  const deleted = fetchDeletedTickets(dbPath, proceedingId);
  const deletedIds = new Set(deleted.map((d) => d.id));

  const blocks = (
    proceedingIds.length === 0
      ? []
      : rows<BlockRow>(dbPath, `SELECT * FROM ticket_blocks WHERE blocker_id IN (${idList}) OR blocked_id IN (${idList})`, [...proceedingIds, ...proceedingIds])
  ).filter((b) => !deletedIds.has(b.blocker_id) && !deletedIds.has(b.blocked_id));
  const conflicts = (
    proceedingIds.length === 0
      ? []
      : rows<ConflictRow>(dbPath, `SELECT * FROM ticket_conflicts WHERE a_id IN (${idList}) OR b_id IN (${idList})`, [...proceedingIds, ...proceedingIds])
  ).filter((c) => !deletedIds.has(c.a_id) && !deletedIds.has(c.b_id));
  const steps = proceedingIds.length === 0 ? [] : rows<StepRow>(dbPath, `SELECT * FROM ticket_steps WHERE ticket_id IN (${idList})`, proceedingIds);
  const scopeRows = proceedingIds.length === 0 ? [] : rows<ScopeRow>(dbPath, `SELECT * FROM ticket_scope WHERE ticket_id IN (${idList})`, proceedingIds);
  const proposalRows =
    proceedingIds.length === 0 ? [] : rows<ProposalRow>(dbPath, `SELECT ticket_id, proposal_key, item FROM ticket_proposals WHERE ticket_id IN (${idList})`, proceedingIds);
  // A job's own records beyond its steps, which its card lists: every answer saved for it and every source to get.
  const answerRows =
    proceedingIds.length === 0 || !ticketAnswersHeld(dbPath)
      ? []
      : rows<AnswerRow>(dbPath, `SELECT ticket_id, file_path, saved_at FROM ticket_answers WHERE ticket_id IN (${idList}) ORDER BY id`, proceedingIds);
  const sourceRows =
    proceedingIds.length === 0 || !ticketSourcesHeld(dbPath)
      ? []
      : rows<SourceRow>(dbPath, `SELECT ticket_id, kind, label, outcome, reason FROM ticket_sources WHERE ticket_id IN (${idList}) ORDER BY id`, proceedingIds);

  const blockersOf = new Map<number, number[]>(); // blocked_id -> [blocker_id]
  for (const b of blocks) blockersOf.set(b.blocked_id, [...(blockersOf.get(b.blocked_id) ?? []), b.blocker_id]);
  const conflictsOf = new Map<number, number[]>();
  for (const c of conflicts) {
    conflictsOf.set(c.a_id, [...(conflictsOf.get(c.a_id) ?? []), c.b_id]);
    conflictsOf.set(c.b_id, [...(conflictsOf.get(c.b_id) ?? []), c.a_id]);
  }
  const stepsByTicket = groupBy(steps, (s) => s.ticket_id);
  const scopeByTicket = groupBy(scopeRows, (s) => s.ticket_id);
  const proposalsByTicket = groupBy(proposalRows, (p) => p.ticket_id);
  const answersByTicket = groupBy(answerRows, (a) => a.ticket_id);
  const sourcesByTicket = groupBy(sourceRows, (s) => s.ticket_id);
  const activityById = fetchJobActivity(dbPath);
  const activeById = new Map(
    rows<{ key: string; value: string }>(dbPath, "SELECT key, value FROM db_meta WHERE key LIKE 'job_active:%'").map((r) => [Number(r.key.slice("job_active:".length)), r.value]),
  );
  const retiredOn = new Map(rows<FilingRetiredRow>(dbPath, "SELECT id, retired_on FROM filings WHERE proceeding_id = ?", [proceedingId]).map((f) => [f.id, f.retired_on]));
  const edge = (id: number): WorkBoardEdge => {
    const other = ticketById.get(id);
    return { id, status: other?.status ?? null, rejected: other !== undefined && other.status === "queued" && other.rejected_at !== null };
  };

  // A rejected ticket holds nothing: its angle is off the board, so the Proposal it was outlined
  // from is derived afresh rather than shown as already taken.
  const holders = new Map<string, { ticket_id: number; filing_id: number | null }>();
  for (const t of [...proceedingTickets].sort((a, b) => a.id - b.id)) {
    if (t.rejected_at !== null || (t.status !== "queued" && t.status !== "wip")) continue;
    for (const p of proposalsByTicket.get(t.id) ?? []) {
      if (!holders.has(p.proposal_key)) holders.set(p.proposal_key, { ticket_id: t.id, filing_id: t.filing_id });
    }
  }

  const tickets = proceedingTickets.map((t) => {
    const blockedBy = (blockersOf.get(t.id) ?? []).map(edge);
    const conflictPartners = (conflictsOf.get(t.id) ?? []).map(edge);
    const category = classify(t, blockedBy, conflictPartners, today);
    const ticket: WorkBoardTicket = {
      id: t.id,
      title: t.title,
      intent: t.intent,
      kind: t.kind,
      priority: t.priority,
      status: t.status,
      category,
      locked_by: t.locked_by,
      locked_at: t.locked_at,
      completed_at: t.completed_at,
      rejected_at: t.rejected_at,
      bf_on: t.bf_on ?? null,
      // A stale gate job pointed at a deleted replacement reads as superseded with no pointer.
      superseded_by: t.superseded_by === null || deletedIds.has(t.superseded_by) ? null : edge(t.superseded_by),
      scope: (scopeByTicket.get(t.id) ?? []).map((s) => (s.entity_id === null ? s.entity : `${s.entity}:${s.entity_id}`)),
      blocked_by: blockedBy,
      conflicts: conflictPartners,
      circular: category === "waiting" && reachesItself(t.id, blockersOf),
      steps: [...(stepsByTicket.get(t.id) ?? [])].sort((a, b) => a.ordinal - b.ordinal).map((s) => ({
        ordinal: s.ordinal,
        text: s.text,
        done_at: s.done_at,
        status: s.status ?? null,
        wait_until: s.wait_until ?? null,
        status_note: s.status_note ?? null,
      })),
      proposal_keys: (proposalsByTicket.get(t.id) ?? []).map((p) => p.proposal_key),
      proposal_items: Object.fromEntries((proposalsByTicket.get(t.id) ?? []).map((p) => [p.proposal_key, p.item])),
      superseded_reason: supersededReason(t, retiredOn),
      // Set by a filing's board, which holds the inventory the dead keys are read against.
      subtitle: null,
      eligible: false,
      // A board with no filing has no inventory; a filing's board replaces this.
      ineligible_reasons: ["no_inventory"],
      dispatch_skips: [],
      lock_note: category === "wip" && t.locked_by?.startsWith(UNATTENDED_TOKEN_PREFIX) ? "In progress with nobody present" : null,
      answers: (answersByTicket.get(t.id) ?? []).map((a) => ({ file_path: a.file_path, saved_at: a.saved_at })),
      sources: (sourcesByTicket.get(t.id) ?? []).map((s) => ({ kind: s.kind, label: s.label, outcome: s.outcome, reason: s.reason })),
      // A job locked before its database held the stamp has none yet: its lock is its last activity.
      last_activity_at: activityById.get(t.id) ?? t.locked_at,
      active_at: activeAt(t, activeById.get(t.id)),
    };
    return { filing_id: t.filing_id, ticket };
  });

  // Section 14 Dispatch's skip reasons, over every filing in the proceeding: substance tables are proceeding-scoped.
  const holding = tickets.map((t) => t.ticket).filter(holdsMaterial);
  for (const { ticket } of tickets) {
    if (ticket.category !== "ready") continue;
    // A `Deliver` is the practitioner's too: its first step, sending, is their own act (jobs-stock.md §3b).
    if (ticket.title.startsWith("Counsel's review of ") || ticket.title === "Deliver") ticket.dispatch_skips.push({ reason: "practitioner_own" });
    for (const p of ticket.conflicts) if (p.status === "queued" && !p.rejected) ticket.dispatch_skips.push({ reason: "either_or", job: p.id });
    for (const held of holding) {
      if (held.id === ticket.id) continue;
      const material = ticket.scope.filter((s) => held.scope.some((h) => scopesShare(h, s)));
      if (material.length > 0) ticket.dispatch_skips.push({ reason: "shared_material", job: held.id, material });
    }
  }

  return { tickets, seeds: fetchOpenSeeds(dbPath, proceedingId, deletedIds), holders, deleted };
}

/** True when a ticket belongs on `filingId`'s board (loose threads are proceeding-wide, ADR 0024 D11): its own tickets, plus proceeding-scoped ones
 * (filing_id IS NULL) -- design §5.1. A proceeding-scoped row appears identically on every
 * filing's board in its proceeding, by design. */
export function onFilingBoard(rowFilingId: number | null, filingId: number): boolean {
  return rowFilingId === filingId || rowFilingId === null;
}
