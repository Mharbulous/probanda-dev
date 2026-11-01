// A Milestone ticket's public shape, and the codes for why an unattended run may not take it.

import type { TicketRow, TicketStatus } from "./work-board-reads.js";

export type Category = "ready" | "wip" | "bring_forward" | "waiting" | "superseded" | "completed" | "rejected";

/** An edge to another ticket (blocker, conflict partner, superseding ticket). `status` is null when
 * that ticket is outside this proceeding's own fetch -- discipline forbids such an edge
 * (jobs.md §11) but the schema doesn't, so the edge is reported rather than silently dropped.
 * `rejected` is that ticket's own rejection, so a reader sees why its blocked side needs a fresh
 * outline; false for an edge outside the proceeding, whose rejection state is unreadable. */
export interface WorkBoardEdge {
  id: number;
  status: TicketStatus | null;
  rejected: boolean;
}

export type DispatchSkip =
  | { reason: "practitioner_own" }
  | { reason: "either_or"; job: number }
  | { reason: "shared_material"; job: number; material: string[] }
  | { reason: "all_keys_dead" }
  | { reason: "internal" }
  | { reason: "before_recipients" }
  | { reason: "before_gate" };

export interface WorkBoardTicket {
  id: number;
  title: string;
  intent: string;
  kind: TicketRow["kind"];
  priority: number;
  /** SQLite's own status. */
  status: TicketStatus;
  /** The board column, derived from status, blockers and conflict partners. */
  category: Category;
  /** The opaque session token holding the ticket, exactly as stored -- never a display identity. */
  locked_by: string | null;
  locked_at: string | null;
  completed_at: string | null;
  /** When the practitioner rejected the angle this ticket was outlined from; null on a live ticket. */
  rejected_at: string | null;
  /** The job's bring-forward date (`YYYY-MM-DD`, schema v74): the first day it may be worked, a
   * start date and never a deadline. Null when none is set, and on a database held below v74. */
  bf_on: string | null;
  superseded_by: WorkBoardEdge | null;
  /** `entity` for a whole-table grant, `entity:id` for a row. Stale the instant it renders; a write gate reads live. */
  scope: string[];
  blocked_by: WorkBoardEdge[];
  conflicts: WorkBoardEdge[];
  /** True only on a waiting ticket whose blockers lead back to itself -- a charting defect the board labels. */
  circular: boolean;
  /** status, wait_until and status_note are null on a step with none, and on a database held below
   * v78 (step-state.ts reads them; a board fixture may leave them out). wait_until is the minute to
   * check a process, never a deadline. */
  steps: { ordinal: number; text: string; done_at: string | null; status?: string | null; wait_until?: string | null; status_note?: string | null }[];
  /** The Proposal keys this ticket holds, so the board can say which work is already outlined. */
  proposal_keys: string[];
  /** Each held key's item as its ticket_proposals row stored it, keyed as in `proposal_keys` -- the
   * stored side of the changed-item check (Goal card design §4.6, §4.8); `proposals[].item` is the
   * current side. A key whose Proposal no longer derives still carries it; `{}` when no keys. */
  proposal_items: Record<string, string>;
  /** Why a superseded ticket is superseded, finished for the board (Goal card design §4.7); null
   * when another ticket superseded it, which the `superseded_by` pointer says, and on a live ticket. */
  superseded_reason: string | null;
  /** The card's subtitle: how many of a live ticket's keys the inventory no longer prints (design
   * §4.7), or on an eligible ticket that it can run unattended (design §5.7). Null when neither
   * holds, and on a board with no inventory. The lane is unchanged by it. */
  subtitle: string | null;
  /** Whether an unattended run may take this ticket (design §5.3). Re-derived at every render,
   * never stored; false on a board with no inventory. Always equals `ineligible_reasons` being empty. */
  eligible: boolean;
  /** Each §5.3 condition this ticket fails, and #1051's shared material, in `INELIGIBLE_REASONS` order, so an unattended run
   * reports why it passed a job over without working it out. Re-derived at every render, never stored. */
  ineligible_reasons: IneligibleReason[];
  /** Section 14 Dispatch's skip reasons for a Ready job, in that section's order; empty for the job the walk may choose, and on any job not in Ready. */
  dispatch_skips: DispatchSkip[];
  /** The In progress card's note when an unattended run holds the lock, read off the token's class
   * (design §5.4); null for any other holder. */
  lock_note: string | null;
  /** The answers saved for this job by `research_filing__save_answer` (schema v52), in the order they
   * were saved: each file's path from its `6. LAW` segment, and the minute it was saved. Empty on a
   * database held below v52. */
  answers: { file_path: string; saved_at: string }[];
  /** The sources to get recorded on this job by `drafting_data__track_source` (schema v76), in the
   * order they were added: the job's own record beside its steps, never part of its plan. `outcome`
   * is null while a source is open. Empty on a database held below v76. */
  sources: { kind: string; label: string; outcome: string | null; reason: string | null }[];
  /** The job's stored last-activity stamp (job-activity.ts), else its lock. Null when it has neither.
   * The idle tag measures from it. */
  last_activity_at: string | null;
  /** The minute the holding session last worked this job: its `db_meta` row `job_active:<id>`
   * (jobs-run.md §6a), written with `last_activity_at` by every job tool given the holder's token.
   * Null unless the job is In progress and the stamp is no earlier than its lock, so an earlier
   * holder's stamp never shows. */
  active_at: string | null;
  /** `check window: idle past 30 min` on an In progress job in the check window (ticket-category.ts
   * withIdleFlag), set by the section builders; absent, which reads as null, under it or with nothing
   * to measure. */
  idle_flag?: string | null;
  /** A merged board only (combined-board.ts): the Writing the job serves, its filing's title, or
   * `Proceeding <id>` for a job with no filing. Absent on a board holding one section. */
  writing?: string;
  /** A General Job: one with no Writing (`filing_id` NULL), drawn on every Writing's board in its
   * proceeding. The page tags its card General and board_card ends its line ` · general`. True only
   * on a Writing's board, where General and Writing Jobs mix; absent everywhere else, so a Writing
   * Job's data is unchanged and a pre-filing board, whose every job has no Writing, tags none. */
  general?: boolean;
  /** A job on a research Writing, which has no board: that Writing's id. The job is drawn as a General
   * Job is, and is that Writing's work only, so no other Writing's gate or criterion reads it, and take_job
   * checks it for overlap only against that Writing's jobs. Absent on every other job. */
  research_writing?: number;
}

/** The codes for design §5.3's conditions, plus #1051's shared material, in the fixed order a
 * ticket's reasons are listed. */
export const INELIGIBLE_REASONS = [
  "not_ready",
  "filing_filed",
  "no_inventory",
  "not_one_step",
  "no_proposal_keys",
  "dead_key",
  "reworded",
  "marker_not_eligible",
  "live_partner",
  "shared_material",
] as const;
export type IneligibleReason = (typeof INELIGIBLE_REASONS)[number];
