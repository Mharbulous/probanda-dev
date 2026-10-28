// The Milestone's SQL row shapes and its plain ticket and attachment reads.

import { boardAttachmentsHeld, deletedAtHeld, JOB_BOARD_KIND, liveTicketClause } from "./query.js";
import { rows } from "../query-rows.js";

export type TicketStatus = "queued" | "wip" | "completed" | "superseded";

export interface TicketRow {
  id: number;
  proceeding_id: number;
  filing_id: number | null;
  title: string;
  intent: string;
  status: TicketStatus;
  priority: number;
  kind: "work" | "charting";
  locked_by: string | null;
  locked_at: string | null;
  plan_approved_at: string | null;
  created: string;
  completed_at: string | null;
  superseded_by: number | null;
  rejected_at: string | null;
  superseded_marker_gone_at: string | null;
  /** Schema v54; absent on a database held below it. */
  deleted_at?: string | null;
  /** Schema v74; absent on a database held below it. */
  bf_on?: string | null;
}

/** A deleted job (schema v54, jobs-closeout.md §10a): drawn only as a struck line on the page. */
export interface DeletedTicket {
  id: number;
  title: string;
  filing_id: number | null;
}

export interface StepRow {
  ticket_id: number;
  ordinal: number;
  text: string;
  done_at: string | null;
  /** Schema v78; absent on a database held below it. */
  status?: string | null;
  wait_until?: string | null;
  status_note?: string | null;
}

export interface ScopeRow {
  ticket_id: number;
  entity: string;
  entity_id: number | null;
}

export interface BlockRow {
  blocker_id: number;
  blocked_id: number;
}

export interface ConflictRow {
  a_id: number;
  b_id: number;
}

export interface SeedCaptureRow {
  origin_ticket_id: number;
  created: string;
}

export interface AnswerRow {
  ticket_id: number;
  file_path: string;
  saved_at: string;
}

export interface SourceRow {
  ticket_id: number;
  kind: string;
  label: string;
  added_at: string;
  closed_at: string | null;
  outcome: string | null;
  reason: string | null;
}

export interface ProposalRow {
  ticket_id: number;
  proposal_key: string;
  item: string;
}

export interface RejectionRow {
  proposal_key: string;
  ticket_id: number | null;
  marker: string;
  item: string;
}

export interface FilingTitleRow {
  id: number;
  title: string;
}

export interface FilingRetiredRow {
  id: number;
  retired_on: string | null;
}

/** A draft that is not a Writing (schema v67, ADR 0042): a client letter's or a reply's file. */
export type AttachmentKind = "client_letter" | "reply";

/** One board_attachments row: the board and the path, nothing else. `path` is in documents.file_path's
 * stored form, relative to the matter root with backslash separators. `filing_id` is null on a row
 * naming its proceeding's own board. */
export interface WorkBoardAttachment {
  id: number;
  filing_id: number | null;
  path: string;
  kind: AttachmentKind;
  attached_on: string;
}

/** The proceeding's jobs that are not deleted: a deleted job counts toward nothing (jobs-closeout.md §10a). */
export function fetchProceedingTickets(dbPath: string, proceedingId: number): TicketRow[] {
  return rows<TicketRow>(dbPath, `SELECT * FROM tickets WHERE proceeding_id = ?${liveTicketClause(dbPath)} ORDER BY priority DESC, id`, [proceedingId]);
}

/** The proceeding's deleted jobs, in id order; none on a database held below v54. */
export function fetchDeletedTickets(dbPath: string, proceedingId: number): DeletedTicket[] {
  if (!deletedAtHeld(dbPath)) return [];
  return rows<DeletedTicket>(dbPath, "SELECT id, title, filing_id FROM tickets WHERE proceeding_id = ? AND deleted_at IS NOT NULL ORDER BY id", [proceedingId]);
}

/** The drafts on one board (ADR 0042), in id order; none on a database held below v67. A pre-filing
 * board (`filingId` null) holds every row of its proceeding. A Writing's board holds its own rows and,
 * only when it is the proceeding's lowest-id live Writing, the proceeding's rows with no Writing (rows
 * written by hand after the proceeding's first Writing, which create_writing does not re-point), so no
 * draft is ever on two boards. A Milestone with no Writing holds its own rows only and is never that Writing. */
export function fetchAttachments(dbPath: string, proceedingId: number, filingId: number | null): WorkBoardAttachment[] {
  if (!boardAttachmentsHeld(dbPath)) return [];
  return rows<WorkBoardAttachment>(
    dbPath,
    "SELECT id, filing_id, path, kind, attached_on FROM board_attachments WHERE proceeding_id = ? AND (? IS NULL OR filing_id = ? " +
      "OR (filing_id IS NULL AND ? = (SELECT MIN(id) FROM filings WHERE proceeding_id = ? AND retired_on IS NULL AND kind <> ?))) ORDER BY id",
    [proceedingId, filingId, filingId, filingId, proceedingId, JOB_BOARD_KIND]
  );
}
