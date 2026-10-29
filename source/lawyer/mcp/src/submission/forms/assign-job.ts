// drafting_data__assign_job: a /draft session assigns a job (a tickets row) to itself in one call,
// the guarded assigning write followed by its confirm-read, as the /drafting-data gatekeeper
// documents them in jobs.md §4 and §2. A take-over names the holder it saw on the job's card and
// writes only while that holder is still on the row. The outcome is read off the confirm-read
// exactly as a session reads the hand-run SELECT: its own token is assigned, another token is a
// lost race (a changed holder on a take-over), no token means the guards matched nothing. A session
// that created any job (tickets.created_by, schema v72) is assigned only a job it created. A job is
// not assigned before its bring-forward date (tickets.bf_on, schema v74), a start date the
// practitioner alone sets, changes and clears; a take-over, which matches only a wip job, does not
// read it. A take-over never lands on a job active in the last CHECK_AFTER_MINUTES. Without a take-over, a wip job whose lock has lapsed (job-activity.ts lapsedClause, ADR 0015)
// is assigned as a released one is, and the same transaction records the lapse in the job's history.
// One write, one read, never a retry. The job tables carry no revision triggers, so the revision does
// not move.

import { NotFoundError, ValidationError } from "../../errors.js";
import { submissionDataQuery, submissionDataWriteAll } from "../backend.js";
import { CHECK_AFTER_MINUTES, LAPSE_AFTER_MINUTES, idleClause, lapsedClause, recordLapseSql, touchJob } from "./job-activity.js";
import { hasTable } from "../schema-capabilities.js";
import { bfOnHeld, createdByHeld, deletedAtHeld, liveTicketClause } from "./query.js";

const TOOL = "drafting_data__assign_job";
const NOW = "strftime('%Y-%m-%dT%H:%M', 'now', 'localtime')";
/** True of a job with no bring-forward date, or one whose date is the local date or earlier. */
const ARRIVED = "(bf_on IS NULL OR bf_on <= date('now', 'localtime'))";

export interface AssignJobArgs {
  db_path: string;
  ticket_id: number;
  /** This session's identity from open_session/bootstrap. Never minted here. */
  session_token: string;
  /** Only after the practitioner's explicit yes to the take-over prompt. Never needed for a lapsed lock. */
  takeover?: boolean;
  /** The `holder:` tag off the job's card (the last 8 characters of its locked_by). Required with takeover. */
  expected_holder?: string;
}

export interface AssignJobResult {
  ticket_id: number;
  outcome: "assigned" | "lost_race" | "holder_changed" | "recently_active" | "not_created_here" | "before_bf" | "no_match";
  /** Rows the UPDATE changed: 1 when this call assigned the job, 0 otherwise. */
  changes: number;
  /** The confirm-read, as the hand-run SELECT returned it. */
  locked_by: string | null;
  locked_at: string | null;
  status: string;
  rejected_at: string | null;
  /** The job's bring-forward date, a start date; null when none is set or the database is below v74. */
  bf_on: string | null;
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
  /** Read only on a database at schema v74 or later. */
  bf_on?: string | null;
  /** Whether bf_on is later than the local date, by the same SQLite clock as the guard. */
  before_bf?: number;
  /** Whether the job's lock has lapsed, and whether it has been idle long enough to take over, by the
   * same SQLite clock as the guard. */
  lapsed: number;
  takeable: number;
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
  // A job is not assigned before its bring-forward date (jobs-run.md §4). A take-over holds a wip job, which the date does not move.
  const bfHeld = bfOnHeld(args.db_path);
  const notBefore = bfHeld && !takeover ? ` AND ${ARRIVED}` : "";
  // A lapsed lock reads as released (ADR 0015).
  const lapsed = lapsedClause(args.db_path);
  // A job active in the last CHECK_AFTER_MINUTES is never taken over (ADR 0015).
  const takeable = idleClause(args.db_path, CHECK_AFTER_MINUTES);
  const guard = (takeover ? `status IN ('queued', 'wip') AND rejected_at IS NULL${live} AND substr(locked_by, -8) = ? AND ${takeable}` : `(status = 'queued' AND locked_by IS NULL OR ${lapsed}) AND rejected_at IS NULL${live}${notBefore}`) + creator;
  const guardParams = [...(takeover ? [(args.expected_holder as string).trim()] : []), ...(creatorHeld ? [args.session_token, args.session_token] : [])];
  const record = !takeover && hasTable(args.db_path, "kv_store") ? [{ sql: recordLapseSql(guard), params: [args.ticket_id, ...guardParams] }] : [];
  const written = await submissionDataWriteAll(
    args.db_path,
    [...record, { sql: `UPDATE tickets SET status = 'wip', locked_by = ?, locked_at = ${NOW} WHERE id = ? AND ${guard}`, params: [args.session_token, args.ticket_id, ...guardParams] }],
    env
  );
  const changes = written.ok ? written.results[record.length].changes : written.changes;
  const tookLapsed = written.ok && record.length === 1 && written.results[0].changes === 1;
  const columns = `locked_by, locked_at, status, rejected_at, ${lapsed} AS lapsed, ${takeable} AS takeable${deletedAtHeld(args.db_path) ? ", deleted_at" : ""}${creatorHeld ? ", created_by" : ""}${bfHeld ? `, bf_on, NOT ${ARRIVED} AS before_bf` : ""}`;
  const [read] = submissionDataQuery(args.db_path, `SELECT ${columns} FROM tickets WHERE id = ?`, [args.ticket_id]).rows as unknown as ConfirmRow[];
  if (read === undefined) throw new NotFoundError(`${TOOL}: no job ${args.ticket_id} in ${args.db_path}`, "not_found");
  const id = args.ticket_id;
  let outcome: AssignJobResult["outcome"];
  let note: string;
  // The date guard refused it, whatever the creator guard would have said.
  const beforeBf = !takeover && read.before_bf === 1;
  // The creator guard alone refused it: every other guard would have matched the row.
  const otherwiseEligible = read.rejected_at === null && !read.deleted_at && !beforeBf
    && (takeover ? (read.status === "queued" || read.status === "wip") && read.locked_by !== null && read.locked_by.slice(-8) === (args.expected_holder as string).trim() && read.takeable === 1 : (read.status === "queued" && read.locked_by === null) || read.lapsed === 1);
  if (read.locked_by === args.session_token) {
    outcome = "assigned";
    if (changes === 1) await touchJob(args.db_path, id, args.session_token, env);
    note =
      changes !== 1
        ? `Job ${id} already carried this session's token; nothing was written.`
        : tookLapsed
          ? `Job ${id} is assigned to this session. Its lock had lapsed (no activity for ${LAPSE_AFTER_MINUTES} minutes), so it was taken as a released job, with its plan and done steps kept; the lapse is recorded in its history.`
          : `Job ${id} is assigned to this session.`;
  } else if (changes === 0 && creatorHeld && otherwiseEligible && read.created_by !== args.session_token && createdAny(args.db_path, args.session_token)) {
    outcome = "not_created_here";
    note = `Job ${id} was not assigned: this session created jobs, and may be assigned only one of those. Nothing was written; never re-run to win.`;
  } else if (takeover && read.rejected_at === null && !read.deleted_at && read.status === "wip" && read.locked_by?.slice(-8) === (args.expected_holder as string).trim() && read.takeable !== 1) {
    outcome = "recently_active";
    note = `Job ${id} was not taken over: it was active in the last ${CHECK_AFTER_MINUTES} minutes, and such a job is never taken over, so nothing was written. Say so in one line; never re-run to win.`;
  } else if (read.locked_by !== null && takeover) {
    outcome = "holder_changed";
    note = `Job ${id} was not assigned: its holder changed since the card was read (locked at ${read.locked_at ?? "(unknown time)"}), so nothing was written. Re-render, show the take-over form again, and never re-run to win.`;
  } else if (read.locked_by !== null && read.lapsed !== 1) {
    outcome = "lost_race";
    note = `Job ${id} was not assigned: another session holds it. Re-render and say so; never re-run to win.`;
  } else if (read.deleted_at) {
    outcome = "no_match";
    note = `Job ${id} was not assigned: it is deleted (deleted_at=${read.deleted_at}), so the guards matched nothing. Re-render; never re-run to win.`;
  } else if (beforeBf && (read.status === "queued" || read.lapsed === 1) && read.rejected_at === null) {
    outcome = "before_bf";
    note = `Job ${id} was not assigned: it is held until its bring-forward date (bf_on=${read.bf_on}), so nothing was written. Say so in one line. Only the practitioner changes or clears that date; never propose it, and never re-run to win.`;
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
    bf_on: read.bf_on ?? null,
    note,
    ...(written.warning ? { warning: written.warning } : {}),
  };
}

/** Whether any job records this session as its creator (tickets.created_by, schema v72). */
function createdAny(dbPath: string, sessionToken: string): boolean {
  return submissionDataQuery(dbPath, "SELECT 1 FROM tickets WHERE created_by = ? LIMIT 1", [sessionToken]).rows.length > 0;
}
