// drafting_data__rewrite_job: rewrite a job's title and steps in one guarded transaction, then
// confirm-read them (jobs-run.md §5). A legal research job's title and intent are set together and
// checked against the form (research-job.ts). Three modes, one guard each, riding every statement:
// - ready (the pickup rewrite): a queued job with no lock, not shelved or deleted, no plan approved
//   and no step done. The step list is replaced whole and the title set when given. No approval is
//   stamped: drafting_data__approve_plan stamps once the plan is announced.
// - held (held: true; the partial replace and the held-job title cleanup): a job holding this
//   session's token. Only the steps not done are deleted (none with append: true), and each new step
//   goes after the highest ordinal left, so a done step keeps its row, ordinal, words and stamp. An
//   approval already on the job is re-stamped with new steps; a title alone touches no stamp. The
//   job's session-active stamp and last activity move in the same transaction.
// - migrate (migrate: true; jobs-stock.md §3m): a research job's title and intent only, on a queued job
//   with no lock, not shelved or deleted, whatever its steps' state, or with held: true on this
//   session's job. Every step, stamp, approval and saved answer stays.
// Every text is written verbatim. Each insert and the title update expect one row, so a guard that
// matches nothing rolls the whole script back. The job tables carry no revision triggers.

import { NotFoundError, ValidationError } from "../../errors.js";
import { submissionDataQuery, submissionDataWriteAll, type WriteStatement } from "../backend.js";
import { checkClaim, heldBy, touchStatements } from "./job-activity.js";
import { deletedAtHeld } from "./query.js";
import { isResearchTitle, JOB_TEXT_MAX as TEXT_MAX, RESEARCH_JOB_PREFIX, researchFormProblems } from "./research-job.js";
import { nowMinuteSql } from "./timings.js";

const TOOL = "drafting_data__rewrite_job";

export interface RewriteJobArgs {
  db_path: string;
  ticket_id: number;
  /** The new title, verbatim. Omit to keep the title. */
  title?: string;
  /** A research title's intent, verbatim: taken with that title and only then. */
  intent?: string;
  /** Migrate a research job: title and intent only, whatever its steps' state. */
  migrate?: boolean;
  /** The new steps, verbatim, in order. Omit to keep the steps. */
  steps?: string[];
  /** The job is this session's: the partial replace or the title cleanup, not the pickup rewrite. */
  held?: boolean;
  /** held only, and required there: this session's identity from open_session/bootstrap. */
  session_token?: string;
  /** held only: the claim_no this session's drafting_data__assign_job returned for the job. */
  claim_no?: number;
  /** held only: delete no step, only append. */
  append?: boolean;
}

export interface RewriteJobResult {
  ticket_id: number;
  outcome: "rewritten" | "not_held" | "locked" | "shelved" | "approved" | "step_done" | "not_ready";
  title: string;
  intent: string;
  steps: { ordinal: number; text: string; done_at: string | null }[];
  status: string;
  locked_by: string | null;
  rejected_at: string | null;
  plan_approved_at: string | null;
  note: string;
  warning?: string;
}

interface JobRow {
  title: string;
  intent: string;
  status: string;
  locked_by: string | null;
  rejected_at: string | null;
  plan_approved_at: string | null;
  deleted_at: string | null;
}

const isText = (v: unknown): v is string => typeof v === "string" && v.trim() !== "" && v.length <= TEXT_MAX && !/[\r\n]/.test(v);

/** The refusal for a title or intent outside a research job's form. */
function checkResearchForm(args: RewriteJobArgs, storedTitle: string): void {
  const refuse = (why: string): never => {
    throw new ValidationError(`${TOOL}: ${why}. Nothing was written.`, "research_form");
  };
  if (args.title === undefined) return;
  if (!isResearchTitle(args.title)) {
    if (isResearchTitle(storedTitle)) refuse(`a research job's title keeps its "${RESEARCH_JOB_PREFIX}" prefix`);
    return;
  }
  if (args.intent === undefined) refuse("a research job's title and intent are set together");
  const problems = researchFormProblems(args.title, args.intent as string);
  if (problems.length > 0) refuse(`this research job is not in the form: ${problems.join("; ")}`);
}

/** drafting_data__rewrite_job. Every refusal writes nothing. */
export async function submissionDataRewriteJob(args: RewriteJobArgs, env: NodeJS.ProcessEnv = process.env): Promise<RewriteJobResult> {
  if (!Number.isInteger(args.ticket_id) || args.ticket_id <= 0) throw new ValidationError(`${TOOL}.ticket_id must be a positive integer; nothing was written`, "invalid_ticket_id");
  const held = args.held === true;
  if (held !== (args.session_token !== undefined) || (held && (typeof args.session_token !== "string" || args.session_token.trim() === ""))) {
    throw new ValidationError(`${TOOL}.session_token, the one open_session or bootstrap returned, is taken with held: true and only then; nothing was written`, "invalid_session_token");
  }
  if (args.append !== undefined && !(held && args.append === true && args.steps !== undefined)) {
    throw new ValidationError(`${TOOL}.append is taken only as true, with held: true and steps; nothing was written`, "invalid_append");
  }
  const migrate = args.migrate === true;
  if (args.migrate !== undefined && !(migrate && args.title !== undefined && isResearchTitle(args.title) && args.steps === undefined)) {
    throw new ValidationError(`${TOOL}.migrate is taken only as true, with a "${RESEARCH_JOB_PREFIX}" title and its intent and no steps; nothing was written`, "invalid_migrate");
  }
  if (args.intent !== undefined && !(typeof args.title === "string" && isResearchTitle(args.title))) {
    throw new ValidationError(`${TOOL}.intent is taken only with a "${RESEARCH_JOB_PREFIX}" title; nothing was written`, "invalid_intent");
  }
  if (args.title === undefined && args.steps === undefined) throw new ValidationError(`${TOOL} takes a title, steps or both; nothing was written`, "nothing_to_write");
  if (args.title !== undefined && !isText(args.title)) throw new ValidationError(`${TOOL}.title must be one line of 1 to ${TEXT_MAX} characters; nothing was written`, "invalid_title");
  if (args.steps !== undefined && (!Array.isArray(args.steps) || args.steps.length === 0 || !args.steps.every(isText))) {
    throw new ValidationError(`${TOOL}.steps must be a list of at least one step, each one line of 1 to ${TEXT_MAX} characters; nothing was written`, "invalid_steps");
  }
  const id = args.ticket_id;
  const token = args.session_token as string;
  const deleted = deletedAtHeld(args.db_path);
  const [stored] = submissionDataQuery(args.db_path, "SELECT title FROM tickets WHERE id = ?", [id]).rows as unknown as { title: string }[];
  if (stored === undefined) throw new NotFoundError(`${TOOL}: no job ${id} in ${args.db_path}`, "not_found");
  checkResearchForm(args, stored.title);

  const unlocked = "status = 'queued' AND locked_by IS NULL AND rejected_at IS NULL" + (deleted ? " AND deleted_at IS NULL" : "");
  const ready = `${unlocked} AND plan_approved_at IS NULL AND NOT EXISTS (SELECT 1 FROM ticket_steps WHERE ticket_id = tickets.id AND done_at IS NOT NULL)`;
  const holds = held ? heldBy(args.db_path, token, checkClaim(TOOL, args.db_path, id, token, args.claim_no)) : { sql: migrate ? unlocked : ready, params: [] };
  const guard = holds.sql;
  const guardParams = holds.params;
  const onJob = `EXISTS (SELECT 1 FROM tickets WHERE id = ? AND ${guard})`;
  const statements: WriteStatement[] = [];
  if (args.steps !== undefined) {
    if (!(held && args.append)) {
      statements.push({ sql: `DELETE FROM ticket_steps WHERE ticket_id = ?${held ? " AND done_at IS NULL" : ""} AND ${onJob}`, params: [id, id, ...guardParams] });
    }
    for (const text of args.steps) {
      statements.push({
        sql: `INSERT INTO ticket_steps (ticket_id, ordinal, text) SELECT id, (SELECT COALESCE(MAX(ordinal), 0) + 1 FROM ticket_steps WHERE ticket_id = ?), ? FROM tickets WHERE id = ? AND ${guard}`,
        params: [id, text, id, ...guardParams],
        expect_changes: 1,
      });
    }
    if (held) statements.push({ sql: `UPDATE tickets SET plan_approved_at = ${nowMinuteSql()} WHERE id = ? AND ${guard} AND plan_approved_at IS NOT NULL`, params: [id, ...guardParams] });
  }
  if (args.title !== undefined) {
    const intent = args.intent === undefined ? { sql: "", params: [] } : { sql: ", intent = ?", params: [args.intent] };
    statements.push({ sql: `UPDATE tickets SET title = ?${intent.sql} WHERE id = ? AND ${guard}`, params: [args.title, ...intent.params, id, ...guardParams], expect_changes: 1 });
  }
  if (held) statements.push(...touchStatements(args.db_path, id, holds));
  const written = await submissionDataWriteAll(args.db_path, statements, env);

  const [job] = submissionDataQuery(
    args.db_path,
    `SELECT title, intent, status, locked_by, rejected_at, plan_approved_at, ${deleted ? "deleted_at" : "NULL AS deleted_at"} FROM tickets WHERE id = ?`,
    [id]
  ).rows as unknown as JobRow[];
  const steps = submissionDataQuery(args.db_path, "SELECT ordinal, text, done_at FROM ticket_steps WHERE ticket_id = ? ORDER BY ordinal", [id]).rows as unknown as RewriteJobResult["steps"];
  const anyDone = steps.some((s) => s.done_at !== null);
  let outcome: RewriteJobResult["outcome"];
  let note: string;
  if (written.ok) {
    outcome = "rewritten";
    note = `Job ${id} now reads as written${held ? "; every done step kept its row, words and stamp" : ""}. Read the card again before announcing it.`;
  } else if (held) {
    outcome = "not_held";
    note = `Nothing was written: job ${id} is not this session's (taken over, shelved or completed). Run the scope read and stop; never re-run.`;
  } else if (job.locked_by !== null) {
    outcome = "locked";
    note = `Nothing was written: job ${id} is held by a session, so it is not Ready. Re-render and never re-run.`;
  } else if (job.rejected_at !== null) {
    outcome = "shelved";
    note = `Nothing was written: job ${id} is shelved.${migrate ? " A shelved job is migrated when it is restored." : ""} Re-render and never re-run.`;
  } else if (!migrate && job.plan_approved_at !== null) {
    outcome = "approved";
    note = `Nothing was written: job ${id}'s plan is already approved, so it is rewritten only once held. Re-render and never re-run.`;
  } else if (!migrate && anyDone) {
    outcome = "step_done";
    note = `Nothing was written: job ${id} has a step done, so it is rewritten only once held. Re-render and never re-run.`;
  } else {
    outcome = "not_ready";
    note = `Nothing was written: job ${id} is status=${job.status}${job.deleted_at ? ", deleted" : ""}, not Ready. Re-render and never re-run.`;
  }
  return {
    ticket_id: id,
    outcome,
    title: job.title,
    intent: job.intent,
    steps,
    status: job.status,
    locked_by: job.locked_by,
    rejected_at: job.rejected_at,
    plan_approved_at: job.plan_approved_at,
    note,
    ...(written.warning ? { warning: written.warning } : {}),
  };
}
