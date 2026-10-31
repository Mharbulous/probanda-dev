// drafting_data__approve_plan: a /draft session stamps the approval of the plan of the job it holds
// in one call, the guarded stamp followed by its confirm-read, as the /drafting-data gatekeeper
// documents them in jobs-run.md §5. Stamp-only: the steps on the job are the plan approved, and a
// change to them stays the Change path's SQL in §5. A job already approved is left alone, so a
// re-approval confirmed unaltered writes nothing but the job's session-active stamp and last activity,
// which move in the same transaction. One write, one read, never a retry. The job tables
// carry no revision triggers, so the revision does not move.

import { DataServerError, NotFoundError, ValidationError } from "../../errors.js";
import { submissionDataQuery, submissionDataWriteAll } from "../backend.js";
import { checkClaim, heldBy, touchStatements } from "./job-activity.js";

const TOOL = "drafting_data__approve_plan";
const NOW = "strftime('%Y-%m-%dT%H:%M', 'now', 'localtime')";
/** The fixed step a job with no plan yet carries (jobs-create.md §3, "The plan marker"). */
const PLAN_MARKER = "Create a plan for how to complete this job.";

export interface ApprovePlanArgs {
  db_path: string;
  ticket_id: number;
  /** This session's identity from open_session/bootstrap. Never minted here. */
  session_token: string;
  /** The claim_no this session's drafting_data__assign_job returned for the job. */
  claim_no?: number;
}

export interface ApprovePlanResult {
  ticket_id: number;
  outcome: "approved" | "already_approved" | "not_held" | "shelved" | "completed" | "no_match";
  /** Rows the UPDATE changed: 1 when this call stamped the approval, 0 otherwise. */
  changes: number;
  /** The confirm-read, as the hand-run SELECT returned it. */
  plan_approved_at: string | null;
  locked_by: string | null;
  status: string;
  rejected_at: string | null;
  note: string;
  warning?: string;
}

interface ConfirmRow {
  status: string;
  rejected_at: string | null;
  locked_by: string | null;
  plan_approved_at: string | null;
}

/** drafting_data__approve_plan. Every refusal writes nothing. */
export async function submissionDataApprovePlan(args: ApprovePlanArgs, env: NodeJS.ProcessEnv = process.env): Promise<ApprovePlanResult> {
  if (!Number.isInteger(args.ticket_id) || args.ticket_id <= 0) throw new ValidationError(`${TOOL}.ticket_id must be a positive integer`, "invalid_ticket_id");
  if (typeof args.session_token !== "string" || args.session_token.trim() === "") {
    throw new ValidationError(`${TOOL}.session_token must be the session_token open_session or bootstrap returned`, "invalid_session_token");
  }
  const id = args.ticket_id;
  const [job] = submissionDataQuery(
    args.db_path,
    "SELECT (SELECT COUNT(*) FROM ticket_steps WHERE ticket_id = tickets.id) AS steps, (SELECT COUNT(*) FROM ticket_steps WHERE ticket_id = tickets.id AND text = ?) AS markers FROM tickets WHERE id = ?",
    [PLAN_MARKER, id]
  ).rows as unknown as { steps: number; markers: number }[];
  if (job === undefined) throw new NotFoundError(`${TOOL}: no job ${id} in ${args.db_path}`, "not_found");
  // The steps are the plan, so a job with none has nothing to approve.
  if (job.steps === 0) throw new DataServerError(`${TOOL}: job ${id} has no steps, so there is no plan to approve; nothing was written`, "no_steps");
  // A job whose only step is the plan marker has no plan yet. A guiding question, never a rule (Commandment 6).
  if (job.steps === 1 && job.markers === 1) {
    throw new DataServerError(`${TOOL}: job ${id}'s only step is "${PLAN_MARKER}" and nothing was written. What steps will complete this job?`, "plan_marker_only");
  }

  const held = heldBy(args.db_path, args.session_token, checkClaim(TOOL, args.db_path, id, args.session_token, args.claim_no));
  const written = await submissionDataWriteAll(
    args.db_path,
    [
      { sql: `UPDATE tickets SET plan_approved_at = ${NOW} WHERE id = ? AND ${held.sql} AND plan_approved_at IS NULL`, params: [id, ...held.params] },
      ...touchStatements(args.db_path, id, held),
    ],
    env
  );
  const changes = written.ok ? written.results[0].changes : written.changes;
  const [read] = submissionDataQuery(args.db_path, "SELECT id, status, rejected_at, locked_by, plan_approved_at FROM tickets WHERE id = ?", [id]).rows as unknown as ConfirmRow[];
  if (read === undefined) throw new NotFoundError(`${TOOL}: no job ${id} in ${args.db_path}`, "not_found");
  let outcome: ApprovePlanResult["outcome"];
  let note: string;
  if (changes === 1) {
    outcome = "approved";
    note = `Job ${id}'s plan is approved as its steps stand (plan_approved_at ${read.plan_approved_at}).`;
  } else if (read.locked_by === args.session_token && read.plan_approved_at !== null) {
    outcome = "already_approved";
    note = `Job ${id}'s plan was already approved at ${read.plan_approved_at}; nothing was written, and its steps and their stamps stand.`;
  } else if (read.locked_by !== null && read.locked_by !== args.session_token) {
    outcome = "not_held";
    note = `Job ${id}'s plan was not approved: another session holds it (taken over), so nothing was written. Report it and stop; never re-run.`;
  } else if (read.locked_by === null && read.rejected_at !== null) {
    outcome = "shelved";
    note = `Job ${id}'s plan was not approved: it is shelved (rejected_at ${read.rejected_at}), so nothing was written. Report it and stop.`;
  } else if (read.status === "completed") {
    outcome = "completed";
    note = `Job ${id}'s plan was not approved: it is completed, so nothing was written. Report it and stop.`;
  } else {
    outcome = "no_match";
    note = `Job ${id}'s plan was not approved: its row is status=${read.status}, locked_by=${read.locked_by === null ? "NULL" : "set"}, rejected_at=${read.rejected_at ?? "NULL"}, so the guards matched nothing. Report it and stop; never re-run.`;
  }
  return {
    ticket_id: id,
    outcome,
    changes,
    plan_approved_at: read.plan_approved_at,
    locked_by: read.locked_by,
    status: read.status,
    rejected_at: read.rejected_at,
    note,
    ...(written.warning ? { warning: written.warning } : {}),
  };
}
