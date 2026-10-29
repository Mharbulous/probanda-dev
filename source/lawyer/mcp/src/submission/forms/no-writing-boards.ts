// The board sections with no Writing: a Milestone of MILESTONE_KIND and a pre-filing proceeding's.

import { idleFlagHours } from "../../tools/practice/firm-profile.js";
import { fetchBoardGoals } from "./board-goals.js";
import type { FilingRow, ProceedingRow } from "./query.js";
import { fetchAttachments } from "./work-board-reads.js";
import type { WorkBoardContext, WorkBoardData } from "./work-board-data.js";
import { withIdleFlag } from "./ticket-category.js";
import { buildProceedingBoard } from "./build-proceeding-board.js";

/** The State row of a proceeding with no filing (ADR 0018), shared with its Matter Board card. */
export function preFilingLabel(proceeding: ProceedingRow): string {
  return proceeding.forum === null ? "Forum not yet chosen" : "No filing yet";
}

/** The State row of a Milestone with no Writing, shared with its Litigation Strategy line. */
export function milestoneLabel(filing: Pick<FilingRow, "retired_on">): string {
  return filing.retired_on ? "Closed" : "Open";
}

/** A Milestone with no Writing (MILESTONE_KIND): only the jobs, deleted jobs, open loose threads and
 * attachments whose filing_id is its own, so a proceeding-wide row (filing_id NULL) stays on the
 * Writings' boards. No stored layout is read: it has no lifecycle, Goal card, criteria, Proposals or
 * ingest inputs. */
export function buildJobOnlyBoardData(ctx: WorkBoardContext): WorkBoardData {
  const board = buildProceedingBoard(ctx.dbPath, ctx.proceeding.id, ctx.rendered.slice(0, 10));
  const idleHours = idleFlagHours(process.env);
  const own = ctx.filing.id;
  return {
    meta: {
      revision: ctx.revision,
      matter: ctx.matterNo,
      client: ctx.clientName,
      file: ctx.proceeding.file_number ?? "",
      filing: ctx.filing.title,
      filing_id: own,
      proceeding_id: ctx.proceeding.id,
      rendered: ctx.rendered,
      state: null,
      state_label: milestoneLabel(ctx.filing),
      state_since: ctx.filing.retired_on,
      ready_to_retire: false,
      job_only: true,
    },
    tickets: board.tickets.filter((t) => t.filing_id === own).map((t) => withIdleFlag(t.ticket, ctx.rendered, idleHours)),
    seeds: board.seeds.filter((s) => s.filing_id === own),
    deleted: board.deleted.filter((d) => d.filing_id === own).map((d) => ({ id: d.id, title: d.title })),
    attachments: fetchAttachments(ctx.dbPath, ctx.proceeding.id, own),
    proposals: [],
    lapsed_keys: [],
    goals: fetchBoardGoals(ctx.dbPath, { filing_id: own, proceeding_id: ctx.proceeding.id }, ctx.filing.title),
  };
}

/** A proceeding with no filing (ADR 0018): every ticket and open loose thread in it. No filing, so no
 * lifecycle, and no Proposals, which a filing's render derives. */
export function buildPreFilingBoardData(
  dbPath: string,
  proceeding: ProceedingRow,
  meta: { revision: number; matter: string; client: string; rendered: string }
): WorkBoardData {
  const board = buildProceedingBoard(dbPath, proceeding.id, meta.rendered.slice(0, 10));
  const idleHours = idleFlagHours(process.env);
  return {
    meta: {
      revision: meta.revision,
      matter: meta.matter,
      client: meta.client,
      file: proceeding.file_number ?? "",
      filing: "",
      filing_id: null,
      proceeding_id: proceeding.id,
      rendered: meta.rendered,
      state: null,
      state_label: preFilingLabel(proceeding),
      state_since: null,
      ready_to_retire: false,
    },
    tickets: board.tickets.map((t) => withIdleFlag(t.ticket, meta.rendered, idleHours)),
    seeds: board.seeds,
    deleted: board.deleted.map((d) => ({ id: d.id, title: d.title })),
    attachments: fetchAttachments(dbPath, proceeding.id, null),
    proposals: [],
    lapsed_keys: [],
    goals: fetchBoardGoals(dbPath, { filing_id: null, proceeding_id: proceeding.id }, `Proceeding ${proceeding.id}`),
  };
}
