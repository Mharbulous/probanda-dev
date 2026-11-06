// drafting_data__release_job: a /draft session returns a wip job to Ready in one call, the guarded
// releasing write followed by its confirm-read, as the /drafting-data gatekeeper documents them in
// jobs-run.md §10. By default the guard is the caller's own token. With expected_holder (the
// `holder:` tag off the job's card, run only on the practitioner's "Return it to Ready" on the
// take-over form, CoClerk ADR 0037) the write lands only while that holder is still on the row. Only the
// status and the lock change: the plan, its approval, the steps and their stamps, scope and
// proposals stay. One write, one read, never a retry. The job tables carry no revision triggers,
// so the revision does not move.

import { NotFoundError, ValidationError } from "../../errors.js";
import { submissionDataQuery, submissionDataWriteAll } from "../backend.js";
import { RELEASE_SET, checkClaim, heldBy } from "./job-activity.js";

const TOOL = "drafting_data__release_job";

export interface ReleaseJobArgs {
  db_path: string;
  ticket_id: number;
  /** This session's identity from open_session/bootstrap. Never minted here. */
  session_token: string;
  /** The `holder:` tag off the job's card (the last 8 characters of its locked_by), for another session's job. */
  expected_holder?: string;
  /** The claim_no this session's drafting_data__assign_job returned for the job. */
  claim_no?: number;
}

export interface ReleaseJobResult {
  ticket_id: number;
  outcome: "released" | "taken_over" | "shelved" | "completed" | "no_match";
  /** Rows the UPDATE changed: 1 when this call released the job, 0 otherwise. */
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
}

/** drafting_data__release_job. Every refusal writes nothing. */
export async function submissionDataReleaseJob(args: ReleaseJobArgs, env: NodeJS.ProcessEnv = process.env): Promise<ReleaseJobResult> {
  if (!Number.isInteger(args.ticket_id) || args.ticket_id <= 0) throw new ValidationError(`${TOOL}.ticket_id must be a positive integer`, "invalid_ticket_id");
  if (typeof args.session_token !== "string" || args.session_token.trim() === "") {
    throw new ValidationError(`${TOOL}.session_token must be the session_token open_session or bootstrap returned`, "invalid_session_token");
  }
  if (args.expected_holder !== undefined && (typeof args.expected_holder !== "string" || args.expected_holder.trim().length !== 8)) {
    throw new ValidationError(`${TOOL}.expected_holder must be the 8-character holder: tag off the job's card`, "invalid_expected_holder");
  }
  const holder = args.expected_holder === undefined ? null : args.expected_holder.trim();
  // Another session's job, released on the practitioner's word, is guarded on the card's holder; this session's own on its claim.
  const guard = holder === null ? heldBy(args.db_path, args.session_token, checkClaim(TOOL, args.db_path, args.ticket_id, args.session_token, args.claim_no)) : { sql: "substr(locked_by, -8) = ? AND rejected_at IS NULL", params: [holder] };
  const written = await submissionDataWriteAll(
    args.db_path,
    [{ sql: `UPDATE tickets SET ${RELEASE_SET} WHERE id = ? AND status = 'wip' AND ${guard.sql}`, params: [args.ticket_id, ...guard.params] }],
    env
  );
  const changes = written.ok ? written.results[0].changes : written.changes;
  const [read] = submissionDataQuery(args.db_path, "SELECT locked_by, locked_at, status, rejected_at FROM tickets WHERE id = ?", [args.ticket_id]).rows as unknown as ConfirmRow[];
  if (read === undefined) throw new NotFoundError(`${TOOL}: no job ${args.ticket_id} in ${args.db_path}`, "not_found");
  const id = args.ticket_id;
  const stillExpected = read.locked_by !== null && (holder === null ? read.locked_by === args.session_token : read.locked_by.endsWith(holder));
  let outcome: ReleaseJobResult["outcome"];
  let note: string;
  if (changes === 1) {
    outcome = "released";
    note = `Job ${id} is back in Ready, unlocked, with its plan, its steps and their stamps, its scope and its proposals kept. Re-render.`;
  } else if (read.locked_by !== null && !stillExpected) {
    outcome = "taken_over";
    note =
      holder === null
        ? `Job ${id} was not released: another session holds it (locked at ${read.locked_at ?? "(unknown time)"}), so nothing was written. Re-render and say so; never re-run.`
        : `Job ${id} was not released: its holder changed since the card was read (locked at ${read.locked_at ?? "(unknown time)"}), so nothing was written. Re-render, show the take-over form again on the fresh card, and never re-run to win.`;
  } else if (read.locked_by === null && read.rejected_at !== null) {
    outcome = "shelved";
    note = `Job ${id} was not released: it is shelved (rejected_at ${read.rejected_at}), so nothing was written. Re-render and say so.`;
  } else if (read.status === "completed") {
    outcome = "completed";
    note = `Job ${id} was not released: it is completed, so nothing was written. Re-render and say so.`;
  } else {
    outcome = "no_match";
    note = `Job ${id} was not released: its row is status=${read.status}, locked_by=${read.locked_by === null ? "NULL" : "set"}, rejected_at=${read.rejected_at ?? "NULL"}, so the guards matched nothing. Re-render and say so; never re-run.`;
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
