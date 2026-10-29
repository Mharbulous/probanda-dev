// A Writing's board section.

import { DataServerError } from "../../errors.js";
import { idleFlagHours } from "../../tools/practice/firm-profile.js";
import { fetchBoardGoals } from "./board-goals.js";
import { storedLayout } from "./layout-snapshot.js";
import { LIFECYCLE_LABELS } from "./lifecycle.js";
import { proposalKey } from "./proposal-inventory.js";
import { isJobOnlyBoard, type FilingRow } from "./query.js";
import { fetchAttachments } from "./work-board-reads.js";
import type { DispatchSkip, WorkBoardTicket } from "./work-board-ticket.js";
import type { GoalCriterion, WorkBoardContext, WorkBoardData } from "./work-board-data.js";
import { holdsMaterial, withIdleFlag } from "./ticket-category.js";
import { allKeysDead, deadKeySubtitle, ineligibleReasons } from "./unattended-eligibility.js";
import { buildProceedingBoard, onFilingBoard } from "./build-proceeding-board.js";
import { proposalsFor } from "./board-proposals.js";
import { afterGateJobs, waitsOnGate } from "./goal-gate.js";
import { goalFor, isInternalWriting } from "./goal-card.js";
import { buildJobOnlyBoardData } from "./no-writing-boards.js";

/** The document types the Writing's jobs read: its stored layout's `ingest_inputs`
 * (shared/declared-layout.md section 5). Undefined on a row with no stored layout and on a type
 * declaring none. A value that is not an array of names fails hard, naming the filing. */
function declaredIngestInputs(filing: FilingRow): string[] | undefined {
  if (filing.layout_snapshot === null) return undefined;
  const raw = storedLayout(filing).layout.ingest_inputs;
  if (raw === undefined) return undefined;
  if (!Array.isArray(raw) || !raw.every((name) => typeof name === "string")) {
    throw new DataServerError(`"${filing.title}": its stored list of document types to read is not a list of names`, "invalid_layout_snapshot");
  }
  return raw as string[];
}

/** `deadlines` are the dateless Goal criteria of the anchors linked to this filing in practice data
 * (matter-dates.ts deadlineCriteria); they print after `gate` and `hearing-date`. */
export function buildWorkBoardData(ctx: WorkBoardContext, deadlines: readonly GoalCriterion[] = []): WorkBoardData {
  if (isJobOnlyBoard(ctx.filing)) return buildJobOnlyBoardData(ctx);
  const board = buildProceedingBoard(ctx.dbPath, ctx.proceeding.id, ctx.rendered.slice(0, 10));
  const idleHours = idleFlagHours(process.env);
  const printed = ctx.inventory === null ? null : new Set(ctx.inventory.flatMap((e) => (e.generating ? [proposalKey(e)] : [])));
  const { proposals, lapsed_keys, shelved, current } = proposalsFor(ctx, board);
  const titles = new Map(proposals.map((p) => [p.key, p.title]));
  const filed = ctx.filing.filed_on !== null;
  // Read before the filing filter: a job in progress on a sibling filing holds proceeding material too.
  const inProgress = board.tickets.map((t) => t.ticket).filter(holdsMaterial);
  const tickets = board.tickets
    .filter((t) => onFilingBoard(t.filing_id, ctx.filing.id))
    .map((t) => {
      const ineligible_reasons = ineligibleReasons(t.ticket, filed, printed, titles, inProgress);
      const eligible = ineligible_reasons.length === 0;
      return withIdleFlag({ ...t.ticket, eligible, ineligible_reasons, subtitle: eligible ? "can be picked up with nobody present" : deadKeySubtitle(t.ticket, printed), ...(t.filing_id === null ? { general: true } : {}) }, ctx.rendered, idleHours);
    });
  const { goal, criteria } = goalFor(ctx, tickets, shelved, current, deadlines, afterGateJobs(board.tickets, ctx.filing.id));
  // Section 14 Dispatch's last skip reasons, read off this render's inventory, this filing's type file and its
  // `recipients` and gate rows: a new array, since dispatch_skips is shared with the proceeding board's ticket.
  const unmet = (id: string): boolean => criteria.some((c) => c.id === id && c.state !== "met");
  const lateSkips = (t: WorkBoardTicket): DispatchSkip[] => [
    ...(allKeysDead(t, printed) ? [{ reason: "all_keys_dead" } as const] : []),
    ...(t.title === "Deliver" && isInternalWriting(ctx.filing) ? [{ reason: "internal" } as const] : []),
    ...(t.title === "Deliver" && unmet("recipients") ? [{ reason: "before_recipients" } as const] : []),
    ...(waitsOnGate(t.title) && unmet("gate") ? [{ reason: "before_gate" } as const] : []),
  ];
  const gated = tickets.map((t): WorkBoardTicket => {
    const skips = t.category === "ready" ? lateSkips(t) : [];
    return skips.length === 0 ? t : { ...t, dispatch_skips: [...t.dispatch_skips, ...skips] };
  });
  const inputTypes = declaredIngestInputs(ctx.filing);
  // This filing's own Ready jobs: a proceeding-wide job has no filing, so no declared inputs.
  const readyJobs = board.tickets.filter((t) => t.filing_id === ctx.filing.id && t.ticket.category === "ready").map((t) => t.ticket.id);

  return {
    meta: {
      revision: ctx.revision,
      matter: ctx.matterNo,
      client: ctx.clientName,
      file: ctx.proceeding.file_number ?? "",
      filing: ctx.filing.title,
      filing_id: ctx.filing.id,
      proceeding_id: ctx.proceeding.id,
      rendered: ctx.rendered,
      state: ctx.lifecycle.state,
      state_label: LIFECYCLE_LABELS[ctx.lifecycle.state],
      state_since: ctx.lifecycle.since,
      ready_to_retire: ctx.lifecycle.readyToRetire,
      ...(inputTypes !== undefined ? { ingest_inputs: { types: inputTypes, ready_jobs: readyJobs } } : {}),
    },
    tickets: gated,
    seeds: board.seeds,
    deleted: board.deleted.filter((d) => onFilingBoard(d.filing_id, ctx.filing.id)).map((d) => ({ id: d.id, title: d.title })),
    attachments: fetchAttachments(ctx.dbPath, ctx.proceeding.id, ctx.filing.id),
    proposals,
    lapsed_keys,
    goals: fetchBoardGoals(ctx.dbPath, { filing_id: ctx.filing.id, proceeding_id: ctx.proceeding.id }, ctx.filing.title),
    goal,
    criteria,
  };
}
