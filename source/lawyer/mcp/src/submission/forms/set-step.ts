// drafting_data__set_step: the session holding a job sets one step's status (schema v78), the
// guarded write followed by its confirm-read. retry is a step blocked by a missing credential or an
// unreachable source, never stamped done. cancelled and deferred are a step the practitioner chose to
// drop or put off, only on their words, which are stored as the step's status_note. waiting is a step
// waiting on an external process: wait_until is set in SQL to now plus wait_minutes, the minute the
// session checks the process again, never a deadline and never time remaining. open clears all
// three. done_at stays the only meaning of done, so a stamped step is frozen and takes no status.
// The write matches only a job holding this session's token (jobs-run.md §5). The job tables carry
// no revision triggers, so the revision does not move.

import { NotFoundError, ValidationError } from "../../errors.js";
import { submissionDataQuery, submissionDataWriteAll } from "../backend.js";
import { stepStatusHeld } from "./query.js";

const TOOL = "drafting_data__set_step";
const STATUSES = ["open", "retry", "cancelled", "deferred", "waiting"];
const DEFAULT_WAIT_MINUTES = 5;
const WAIT_MINUTES_MAX = 1440;
const WORDS_MAX = 500;

export interface SetStepArgs {
  db_path: string;
  ticket_id: number;
  ordinal: number;
  /** This session's identity from open_session/bootstrap. Never minted here. */
  session_token: string;
  status: string;
  /** waiting only: minutes from now to the next check. Default 5. */
  wait_minutes?: number;
  /** cancelled and deferred only, and required there: the practitioner's own words. */
  practitioner_words?: string;
}

export interface SetStepResult {
  ticket_id: number;
  ordinal: number;
  outcome: "set" | "not_held" | "done" | "no_match";
  /** Rows the UPDATE changed: 1 when this call set the step, 0 otherwise. */
  changes: number;
  /** The confirm-read of the step. */
  done_at: string | null;
  status: string | null;
  wait_until: string | null;
  status_note: string | null;
  locked_by: string | null;
  note: string;
  warning?: string;
}

interface StepRow {
  done_at: string | null;
  status: string | null;
  wait_until: string | null;
  status_note: string | null;
}

/** drafting_data__set_step. Every refusal writes nothing. */
export async function submissionDataSetStep(args: SetStepArgs, env: NodeJS.ProcessEnv = process.env): Promise<SetStepResult> {
  if (!Number.isInteger(args.ticket_id) || args.ticket_id <= 0) throw new ValidationError(`${TOOL}.ticket_id must be a positive integer`, "invalid_ticket_id");
  if (!Number.isInteger(args.ordinal) || args.ordinal <= 0) throw new ValidationError(`${TOOL}.ordinal must be a positive integer`, "invalid_ordinal");
  if (typeof args.session_token !== "string" || args.session_token.trim() === "") {
    throw new ValidationError(`${TOOL}.session_token must be the session_token open_session or bootstrap returned`, "invalid_session_token");
  }
  if (typeof args.status !== "string" || !STATUSES.includes(args.status)) {
    throw new ValidationError(`${TOOL}.status must be one of ${STATUSES.join(", ")}; nothing was written`, "invalid_status");
  }
  const status = args.status;
  if (args.wait_minutes !== undefined && (status !== "waiting" || !Number.isInteger(args.wait_minutes) || args.wait_minutes < 1 || args.wait_minutes > WAIT_MINUTES_MAX)) {
    throw new ValidationError(`${TOOL}.wait_minutes is a whole number of minutes from 1 to ${WAIT_MINUTES_MAX}, and only with status waiting; nothing was written`, "invalid_wait_minutes");
  }
  const owesWords = status === "cancelled" || status === "deferred";
  const words = typeof args.practitioner_words === "string" ? args.practitioner_words.trim() : "";
  if (owesWords && (words === "" || words.length > WORDS_MAX)) {
    throw new ValidationError(
      `${TOOL}: a step is set ${status} only on the practitioner's own words, passed verbatim as practitioner_words (1 to ${WORDS_MAX} characters); nothing was written`,
      "practitioner_words_required"
    );
  }
  if (!owesWords && args.practitioner_words !== undefined) {
    throw new ValidationError(`${TOOL}.practitioner_words is taken only with status cancelled or deferred; nothing was written`, "invalid_practitioner_words");
  }
  const id = args.ticket_id;
  const ordinal = args.ordinal;
  const token = args.session_token;
  if (submissionDataQuery(args.db_path, "SELECT id FROM tickets WHERE id = ?", [id]).rows.length === 0) {
    throw new NotFoundError(`${TOOL}: no job ${id} in ${args.db_path}`, "not_found");
  }
  if (!stepStatusHeld(args.db_path)) {
    throw new ValidationError(
      `${TOOL}: ${args.db_path} is held below schema v78, so no step of job ${id} can take a status; nothing was written. Say once that the matter's database needs the v78 migration, and leave the step open.`,
      "schema_below_v78"
    );
  }
  const minutes = status === "waiting" ? (args.wait_minutes ?? DEFAULT_WAIT_MINUTES) : null;
  const written = await submissionDataWriteAll(
    args.db_path,
    [
      {
        sql:
          "UPDATE ticket_steps SET status = ?, " +
          `wait_until = ${minutes === null ? "NULL" : `strftime('%Y-%m-%dT%H:%M', 'now', 'localtime', '+${minutes} minutes')`}, status_note = ? ` +
          "WHERE ticket_id = ? AND ordinal = ? AND done_at IS NULL AND EXISTS (SELECT 1 FROM tickets WHERE id = ? AND locked_by = ?)",
        params: [status === "open" ? null : status, owesWords ? words : null, id, ordinal, id, token],
      },
    ],
    env
  );
  const changes = written.ok ? written.results[0].changes : written.changes;
  const [step] = submissionDataQuery(args.db_path, "SELECT done_at, status, wait_until, status_note FROM ticket_steps WHERE ticket_id = ? AND ordinal = ?", [id, ordinal])
    .rows as unknown as StepRow[];
  const [job] = submissionDataQuery(args.db_path, "SELECT locked_by FROM tickets WHERE id = ?", [id]).rows as unknown as { locked_by: string | null }[];
  let outcome: SetStepResult["outcome"];
  let note: string;
  if (step === undefined) {
    outcome = "no_match";
    note = `Nothing was written: job ${id} has no step ${ordinal}. Read the job's steps off its card and never re-run against a guess.`;
  } else if (job.locked_by !== token) {
    outcome = "not_held";
    note = `Nothing was written: job ${id} is not held by this session (taken over, shelved or completed). Report it and stop.`;
  } else if (step.done_at !== null) {
    outcome = "done";
    note = `Nothing was written: step ${ordinal} of job ${id} is done (${step.done_at}), and a done step stays as it is.`;
  } else if (changes === 1) {
    outcome = "set";
    note =
      status === "waiting"
        ? `setting timer for ${minutes} minutes: step ${ordinal} of job ${id} waits until ${(step.wait_until ?? "").slice(11)}. Then check whether the process has finished; this is never a deadline.`
        : `Step ${ordinal} of job ${id} is ${status}.`;
  } else {
    outcome = "no_match";
    note = `Nothing was written: the guards on step ${ordinal} of job ${id} matched nothing. Report it and stop; never re-run.`;
  }
  return {
    ticket_id: id,
    ordinal,
    outcome,
    changes,
    done_at: step?.done_at ?? null,
    status: step?.status ?? null,
    wait_until: step?.wait_until ?? null,
    status_note: step?.status_note ?? null,
    locked_by: job.locked_by,
    note,
    ...(written.warning ? { warning: written.warning } : {}),
  };
}
