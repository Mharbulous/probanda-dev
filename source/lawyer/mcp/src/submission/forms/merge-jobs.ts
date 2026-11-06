// drafting_data__merge_jobs: a /draft session merges a duplicate job into the job that survives, on
// the practitioner's yes, in one call, as the /drafting-data gatekeeper documents it in
// jobs-closeout.md §9c. The absorbed job's undone steps are appended after the survivor's, so every
// step the survivor already did keeps its row, ordinal and done_at. Its scope and Proposal keys are
// copied to the survivor, jobs waiting on it wait on the survivor instead, the survivor's plan approval
// is cleared because its steps changed, and the absorbed job is superseded by the survivor: never
// deleted, so the board names where its work went. Every statement carries the same guard, so either
// all of them write or none does. The two rows are read first, and a merge the guard would refuse
// writes nothing and names which job refused it. The job tables carry no revision triggers, so the
// revision does not move.

import { NotFoundError, ValidationError } from "../../errors.js";
import { submissionDataQuery, submissionDataWriteAll } from "../backend.js";
import { deletedAtHeld, stepStatusHeld } from "./query.js";
import { checkClaim, heldBy } from "./job-activity.js";

const TOOL = "drafting_data__merge_jobs";

export interface MergeJobsArgs {
  db_path: string;
  survivor_id: number;
  absorbed_id: number;
  /** This session's identity from open_session/bootstrap. Never minted here. */
  session_token: string;
  /** The claim_no this session's drafting_data__assign_job returned for the survivor, when it holds the survivor. */
  claim_no?: number;
}

type Refusal =
  | "held_elsewhere"
  | "held_here"
  | "completed"
  | "superseded"
  | "shelved"
  | "deleted"
  | "different_writing"
  | "different_proceeding"
  | "either_or"
  | "blocked";

export interface MergeJobsResult {
  survivor_id: number;
  absorbed_id: number;
  outcome: "merged" | Refusal | "no_match";
  /** On a refusal, the job that refused it. */
  refused_job?: "survivor" | "absorbed";
  steps_added: number;
  scope_added: number;
  keys_added: number;
  /** Jobs that waited on the absorbed job and now wait on the survivor. */
  blocks_moved: number;
  /** The confirm-read of the absorbed job. */
  absorbed_status: string;
  superseded_by: number | null;
  note: string;
  warning?: string;
}

interface JobRow {
  id: number;
  proceeding_id: number;
  filing_id: number | null;
  status: string;
  locked_by: string | null;
  rejected_at: string | null;
  superseded_by: number | null;
  deleted_at?: string | null;
}

/** A wait on a job that is not completed, finished by the caller's condition on `b`. */
const WAITS_OUTSIDE = "SELECT 1 FROM ticket_blocks b JOIN tickets bt ON bt.id = b.blocker_id WHERE bt.status <> 'completed' AND";

/** The guard every statement carries, on params [absorbed, survivor, ...held.params]: both jobs live and
 * on one Writing (or both General Jobs) of one proceeding, the survivor Ready or held by this session
 * (`held`, heldBy on alias s), the absorbed job Ready with no either/or partner, and neither waiting on
 * a job outside the pair that is not completed. */
function guard(dbPath: string, held: string): string {
  const live = deletedAtHeld(dbPath) ? " AND s.deleted_at IS NULL AND a.deleted_at IS NULL" : "";
  return (
    "EXISTS (SELECT 1 FROM tickets s JOIN tickets a ON a.id = ? WHERE s.id = ?" +
    " AND s.proceeding_id = a.proceeding_id AND s.filing_id IS a.filing_id" +
    ` AND s.rejected_at IS NULL AND a.rejected_at IS NULL${live}` +
    ` AND ((s.status = 'queued' AND s.locked_by IS NULL) OR (s.status = 'wip' AND ${held}))` +
    " AND a.status = 'queued' AND a.locked_by IS NULL" +
    " AND NOT EXISTS (SELECT 1 FROM ticket_conflicts c WHERE c.a_id = a.id OR c.b_id = a.id)" +
    ` AND NOT EXISTS (${WAITS_OUTSIDE} b.blocked_id IN (s.id, a.id) AND b.blocker_id NOT IN (s.id, a.id)))`
  );
}

/** Why one job refuses the merge, read off its row, or null. */
function jobRefusal(row: JobRow, role: "survivor" | "absorbed", token: string): Refusal | null {
  if (row.deleted_at != null) return "deleted";
  if (row.status === "completed") return "completed";
  if (row.status === "superseded") return "superseded";
  if (row.rejected_at !== null) return "shelved";
  if (row.status === "wip" && row.locked_by !== token) return "held_elsewhere";
  if (role === "absorbed" && row.status === "wip") return "held_here";
  return null;
}

const NOTES: Record<Refusal, (job: string) => string> = {
  held_elsewhere: (job) => `Job ${job} is in progress in another session, so nothing was merged and nothing was written. Name it in one line; never re-run.`,
  held_here: (job) => `Job ${job} is this session's own job, so it cannot be absorbed and nothing was written. Make it the survivor instead.`,
  completed: (job) => `Job ${job} is completed, and a completed job is merged only once reopened (jobs-closeout.md §10e), so nothing was written.`,
  superseded: (job) => `Job ${job} is already superseded, so nothing was merged and nothing was written.`,
  shelved: (job) => `Job ${job} is shelved, so nothing was merged and nothing was written.`,
  deleted: (job) => `Job ${job} is deleted, so nothing was merged and nothing was written.`,
  different_writing: (job) => `Job ${job} is on a different Writing from the survivor (or one is a General Job), so nothing was merged and nothing was written.`,
  different_proceeding: (job) => `Job ${job} is in a different proceeding from the survivor, so nothing was merged and nothing was written.`,
  either_or: (job) => `Job ${job} has an either/or partner, and which side runs is the practitioner's call, so nothing was merged and nothing was written.`,
  blocked: (job) => `Job ${job} waits on a job that is not completed, so nothing was merged and nothing was written.`,
};

/** drafting_data__merge_jobs. Every refusal writes nothing. */
export async function submissionDataMergeJobs(args: MergeJobsArgs, env: NodeJS.ProcessEnv = process.env): Promise<MergeJobsResult> {
  const s = args.survivor_id;
  const a = args.absorbed_id;
  if (![s, a].every((id) => Number.isInteger(id) && id > 0)) {
    throw new ValidationError(`${TOOL}.survivor_id and absorbed_id must be positive integers`, "invalid_ticket_id");
  }
  if (s === a) throw new ValidationError(`${TOOL}: survivor_id and absorbed_id name the same job`, "same_job");
  const token = args.session_token;
  if (typeof token !== "string" || token.trim() === "") {
    throw new ValidationError(`${TOOL}.session_token must be the session_token open_session or bootstrap returned`, "invalid_session_token");
  }
  const read = (id: number) => submissionDataQuery(args.db_path, "SELECT * FROM tickets WHERE id = ?", [id]).rows[0] as unknown as JobRow | undefined;
  const survivor = read(s);
  const absorbed = read(a);
  if (survivor === undefined || absorbed === undefined) {
    throw new NotFoundError(`${TOOL}: no job ${survivor === undefined ? s : a} in ${args.db_path}`, "not_found");
  }

  const empty = { survivor_id: s, absorbed_id: a, steps_added: 0, scope_added: 0, keys_added: 0, blocks_moved: 0 };
  const refuse = (outcome: Refusal, role: "survivor" | "absorbed"): MergeJobsResult => ({
    ...empty,
    outcome,
    refused_job: role,
    absorbed_status: absorbed.status,
    superseded_by: absorbed.superseded_by,
    note: NOTES[outcome](`${role === "survivor" ? s : a}`),
  });
  const exists = (sql: string, params: unknown[]) => submissionDataQuery(args.db_path, `SELECT EXISTS (${sql}) AS hit`, params).rows[0].hit === 1;

  const own = jobRefusal(absorbed, "absorbed", token);
  if (own !== null) return refuse(own, "absorbed");
  const theirs = jobRefusal(survivor, "survivor", token);
  if (theirs !== null) return refuse(theirs, "survivor");
  if (absorbed.proceeding_id !== survivor.proceeding_id) return refuse("different_proceeding", "absorbed");
  if (absorbed.filing_id !== survivor.filing_id) return refuse("different_writing", "absorbed");
  if (exists("SELECT 1 FROM ticket_conflicts WHERE a_id = ? OR b_id = ?", [a, a])) return refuse("either_or", "absorbed");
  for (const [id, role] of [[a, "absorbed"], [s, "survivor"]] as const) {
    if (exists(`${WAITS_OUTSIDE} b.blocked_id = ? AND b.blocker_id NOT IN (?, ?)`, [id, s, a])) return refuse("blocked", role);
  }

  const held = heldBy(args.db_path, token, checkClaim(TOOL, args.db_path, s, token, args.claim_no), "s");
  const g = guard(args.db_path, held.sql);
  const gp = [a, s, ...held.params];
  const undone = `done_at IS NULL${stepStatusHeld(args.db_path) ? " AND (status IS NULL OR status NOT IN ('cancelled', 'deferred'))" : ""}`;
  const written = await submissionDataWriteAll(
    args.db_path,
    [
      {
        sql:
          "INSERT INTO ticket_steps (ticket_id, ordinal, text) " +
          "SELECT ?, (SELECT COALESCE(MAX(ordinal), 0) FROM ticket_steps WHERE ticket_id = ?) + ROW_NUMBER() OVER (ORDER BY x.ordinal), x.text " +
          `FROM ticket_steps x WHERE x.ticket_id = ? AND x.${undone} AND ${g}`,
        params: [s, s, a, ...gp],
      },
      {
        sql:
          "INSERT INTO ticket_scope (ticket_id, entity, entity_id) SELECT DISTINCT ?, x.entity, x.entity_id FROM ticket_scope x " +
          "WHERE x.ticket_id = ? AND NOT EXISTS (SELECT 1 FROM ticket_scope y WHERE y.ticket_id = ? AND y.entity = x.entity AND y.entity_id IS x.entity_id) " +
          `AND ${g}`,
        params: [s, a, s, ...gp],
      },
      {
        sql:
          "INSERT INTO ticket_proposals (ticket_id, proposal_key, item) SELECT ?, x.proposal_key, x.item FROM ticket_proposals x " +
          "WHERE x.ticket_id = ? AND NOT EXISTS (SELECT 1 FROM ticket_proposals y WHERE y.ticket_id = ? AND y.proposal_key = x.proposal_key) " +
          `AND ${g}`,
        params: [s, a, s, ...gp],
      },
      {
        sql:
          "INSERT INTO ticket_blocks (blocker_id, blocked_id) SELECT ?, x.blocked_id FROM ticket_blocks x " +
          "WHERE x.blocker_id = ? AND x.blocked_id <> ? AND NOT EXISTS (SELECT 1 FROM ticket_blocks y WHERE y.blocker_id = ? AND y.blocked_id = x.blocked_id) " +
          `AND ${g}`,
        params: [s, a, s, s, ...gp],
      },
      { sql: `DELETE FROM ticket_blocks WHERE blocker_id = ? AND ${g}`, params: [a, ...gp] },
      {
        sql: `UPDATE tickets SET plan_approved_at = NULL WHERE id = ? AND EXISTS (SELECT 1 FROM ticket_steps WHERE ticket_id = ? AND ${undone}) AND ${g}`,
        params: [s, a, ...gp],
      },
      { sql: `UPDATE tickets SET status = 'superseded', superseded_by = ? WHERE id = ? AND ${g}`, params: [s, a, ...gp] },
    ],
    env
  );
  const changes = (i: number) => (written.ok ? written.results[i].changes : 0);
  const [confirm] = submissionDataQuery(args.db_path, "SELECT status, superseded_by FROM tickets WHERE id = ?", [a]).rows as unknown as {
    status: string;
    superseded_by: number | null;
  }[];
  const merged = confirm.status === "superseded" && confirm.superseded_by === s && changes(6) === 1;
  const counts = merged ? { steps_added: changes(0), scope_added: changes(1), keys_added: changes(2), blocks_moved: changes(3) } : {};
  return {
    ...empty,
    ...counts,
    outcome: merged ? "merged" : "no_match",
    absorbed_status: confirm.status,
    superseded_by: confirm.superseded_by,
    note: merged
      ? `Job ${a} is merged into Job ${s} and superseded by it: ${changes(0)} steps appended after Job ${s}'s own, whose done steps keep their stamps. ` +
        `Job ${s}'s plan approval is cleared when steps were added. Re-render.`
      : `Nothing was merged and nothing was written: a job changed between the read and the write (Job ${a} is now ${confirm.status}). Re-render and read both cards again; never re-run blind.`,
    ...(written.warning ? { warning: written.warning } : {}),
  };
}
