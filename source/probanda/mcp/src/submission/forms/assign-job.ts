// drafting_data__assign_job: a /draft session assigns a job (a tickets row) to itself in one call,
// the guarded assigning write followed by its confirm-read, as the /drafting-data gatekeeper
// documents them in jobs.md §4 and §2. A take-over names the holder it saw on the job's card and
// writes only while that holder is still on the row. The outcome is read off the confirm-read
// exactly as a session reads the hand-run SELECT: its own token is assigned, another token is a
// lost race (a changed holder on a take-over), no token means the guards matched nothing. A session
// that created any job (tickets.created_by, schema v72) is assigned only a job it created. One
// write, one read, never a retry. The job tables carry no revision triggers, so the revision does
// not move.

import { NotFoundError, ValidationError } from "../../errors.js";
import { submissionDataQuery, submissionDataWriteAll } from "../backend.js";
import { createdByHeld, deletedAtHeld, liveTicketClause } from "./query.js";

const TOOL = "drafting_data__assign_job";
const NOW = "strftime('%Y-%m-%dT%H:%M', 'now', 'localtime')";

export interface AssignJobArgs {
  db_path: string;
  ticket_id: number;
  /** This session's identity from open_session/bootstrap. Never minted here. */
  session_token: string;
  /** Only after the practitioner's explicit yes to the take-over prompt. */
  takeover?: boolean;
  /** The `holder:` tag off the job's card (the last 8 characters of its locked_by). Required with takeover. */
  expected_holder?: string;
}

export interface AssignJobResult {
  ticket_id: number;
  outcome: "assigned" | "lost_race" | "holder_changed" | "not_created_here" | "no_match";
  /** Rows the UPDATE changed: 1 when this call assigned the job, 0 otherwise. */
  changes: number;
  /** The confirm-read, as the hand-run SELECT returned it. */
  locked_by: string | null;
  locked_at: string | null;
  status: string;
  rejected_at: string | null;
  note: string;
  warning?: string;
}

interface ConfirmRow {
  locked_by: string | null;
  locked_at: string | null;
  status: string;
  rejected_at: string | null;
  /** Read only on a database at schema v54 or later. */
  deleted_at?: string | null;
  /** Read only on a database at schema v72 or later. */
  created_by?: string | null;
}

/** drafting_data__assign_job. Every refusal writes nothing. */
export async function submissionDataAssignJob(args: AssignJobArgs, env: NodeJS.ProcessEnv = process.env): Promise<AssignJobResult> {
  if (!Number.isInteger(args.ticket_id) || args.ticket_id <= 0) throw new ValidationError(`${TOOL}.ticket_id must be a positive integer`, "invalid_ticket_id");
  if (typeof args.session_token !== "string" || args.session_token.trim() === "") {
    throw new ValidationError(`${TOOL}.session_token must be the session_token open_session or bootstrap returned`, "invalid_session_token");
  }
  if (args.takeover === true && (typeof args.expected_holder !== "string" || args.expected_holder.trim().length !== 8)) {
    throw new ValidationError(`${TOOL}.expected_holder must be the 8-character holder: tag off the job's card`, "invalid_expected_holder");
  }
  if (args.takeover !== true && args.expected_holder !== undefined) {
    throw new ValidationError(`${TOOL}.expected_holder is passed only with takeover: true`, "invalid_expected_holder");
  }
  const takeover = args.takeover === true;
  // A deleted job (jobs-closeout.md §10a) is never assigned, by take-over or otherwise.
  const live = liveTicketClause(args.db_path);
  // A session that created any job is assigned only a job it created (jobs-run.md §4).
  const creatorHeld = createdByHeld(args.db_path);
  const creator = creatorHeld ? " AND (created_by = ? OR NOT EXISTS (SELECT 1 FROM tickets c WHERE c.created_by = ?))" : "";
  const guard = (takeover ? `status IN ('queued', 'wip') AND rejected_at IS NULL${live} AND substr(locked_by, -8) = ?` : `status = 'queued' AND locked_by IS NULL AND rejected_at IS NULL${live}`) + creator;
  const params = [args.session_token, args.ticket_id, ...(takeover ? [(args.expected_holder as string).trim()] : []), ...(creatorHeld ? [args.session_token, args.session_token] : [])];
  const written = await submissionDataWriteAll(args.db_path, [{ sql: `UPDATE tickets SET status = 'wip', locked_by = ?, locked_at = ${NOW} WHERE id = ? AND ${guard}`, params }], env);
  const changes = written.ok ? written.results[0].changes : written.changes;
  const columns = `locked_by, locked_at, status, rejected_at${deletedAtHeld(args.db_path) ? ", deleted_at" : ""}${creatorHeld ? ", created_by" : ""}`;
  const [read] = submissionDataQuery(args.db_path, `SELECT ${columns} FROM tickets WHERE id = ?`, [args.ticket_id]).rows as unknown as ConfirmRow[];
  if (read === undefined) throw new NotFoundError(`${TOOL}: no job ${args.ticket_id} in ${args.db_path}`, "not_found");
  const id = args.ticket_id;
  let outcome: AssignJobResult["outcome"];
  let note: string;
  // The creator guard alone refused it: every other guard would have matched the row.
  const otherwiseEligible = read.rejected_at === null && !read.deleted_at
    && (takeover ? (read.status === "queued" || read.status === "wip") && read.locked_by !== null && read.locked_by.slice(-8) === (args.expected_holder as string).trim() : read.status === "queued" && read.locked_by === null);
  if (read.locked_by === args.session_token) {
    outcome = "assigned";
    note = changes === 1 ? `Job ${id} is assigned to this session.` : `Job ${id} already carried this session's token; nothing was written.`;
  } else if (changes === 0 && creatorHeld && otherwiseEligible && read.created_by !== args.session_token && createdAny(args.db_path, args.session_token)) {
    outcome = "not_created_here";
    note = `Job ${id} was not assigned: this session created jobs, and may be assigned only one of those. Nothing was written; never re-run to win.`;
  } else if (read.locked_by !== null && takeover) {
    outcome = "holder_changed";
    note = `Job ${id} was not assigned: its holder changed since the card was read (locked at ${read.locked_at ?? "(unknown time)"}), so nothing was written. Re-render, show the take-over form again, and never re-run to win.`;
  } else if (read.locked_by !== null) {
    outcome = "lost_race";
    note = `Job ${id} was not assigned: another session holds it. Re-render and say so; never re-run to win.`;
  } else if (read.deleted_at) {
    outcome = "no_match";
    note = `Job ${id} was not assigned: it is deleted (deleted_at=${read.deleted_at}), so the guards matched nothing. Re-render; never re-run to win.`;
  } else {
    outcome = "no_match";
    note = `Job ${id} was not assigned: its row is status=${read.status}, rejected_at=${read.rejected_at ?? "NULL"}, so the guards matched nothing. Re-render; never re-run to win.`;
  }
  return {
    ticket_id: id,
    outcome,
    changes,
    locked_by: read.locked_by,
    locked_at: read.locked_at,
    status: read.status,
    rejected_at: read.rejected_at,
    note,
    ...(written.warning ? { warning: written.warning } : {}),
  };
}

/** Whether any job records this session as its creator (tickets.created_by, schema v72). */
function createdAny(dbPath: string, sessionToken: string): boolean {
  return submissionDataQuery(dbPath, "SELECT 1 FROM tickets WHERE created_by = ? LIMIT 1", [sessionToken]).rows.length > 0;
}
