// drafting_data__delete_job: a /draft session deletes one or several mistaken jobs in one call, the
// guarded stamping writes followed by their confirm-reads, as the /drafting-data gatekeeper documents
// them in jobs-closeout.md §10a. A job is deleted when it is queued (shelved or not), or wip and held
// by the caller's own token; the own-wip path returns it to queued and clears the lock in the same
// write, so a restore gives an unlocked Ready job. The holder check and the stamp are one statement,
// so no session can claim the job between them. All statements run in one transaction. A delete is a
// soft deleted_at stamp only. The job tables carry no revision triggers, so the revision does not move.

import { ValidationError } from "../../errors.js";
import { submissionDataQuery, submissionDataWriteAll } from "../backend.js";
import { checkClaim, heldBy } from "./job-activity.js";

const TOOL = "drafting_data__delete_job";

export interface DeleteJobArgs {
  db_path: string;
  ticket_ids: number[];
  /** This session's identity from open_session/bootstrap. Never minted here. */
  session_token: string;
  /** The claim_no this session's drafting_data__assign_job returned for the job it holds among ticket_ids. */
  claim_no?: number;
}

export interface DeleteJobOutcome {
  ticket_id: number;
  outcome: "deleted" | "held_elsewhere" | "refused_status" | "already_deleted" | "not_found";
  /** Rows the UPDATE changed: 1 when this call deleted the job, 0 otherwise. */
  changes: number;
  /** The confirm-read, NULLs when the job does not exist. */
  status: string | null;
  locked_at: string | null;
  rejected_at: string | null;
  deleted_at: string | null;
  note: string;
}

export interface DeleteJobResult {
  jobs: DeleteJobOutcome[];
  warning?: string;
}

interface ConfirmRow {
  status: string;
  locked_by: string | null;
  locked_at: string | null;
  rejected_at: string | null;
  deleted_at: string | null;
}

const STAMP =
  "UPDATE tickets SET deleted_at = strftime('%Y-%m-%dT%H:%M', 'now', 'localtime'), status = 'queued', locked_by = NULL, locked_at = NULL " +
  "WHERE id = ? AND deleted_at IS NULL AND (status = 'queued' OR (status = 'wip' AND ";

/** drafting_data__delete_job. Every refusal writes nothing. */
export async function submissionDataDeleteJob(args: DeleteJobArgs, env: NodeJS.ProcessEnv = process.env): Promise<DeleteJobResult> {
  const ids = args.ticket_ids;
  if (!Array.isArray(ids) || ids.length === 0 || !ids.every((id) => Number.isInteger(id) && id > 0) || new Set(ids).size !== ids.length) {
    throw new ValidationError(`${TOOL}.ticket_ids must be a non-empty list of distinct positive integers`, "invalid_ticket_ids");
  }
  if (typeof args.session_token !== "string" || args.session_token.trim() === "") {
    throw new ValidationError(`${TOOL}.session_token must be the session_token open_session or bootstrap returned`, "invalid_session_token");
  }
  const claims = ids.map((id) => checkClaim(TOOL, args.db_path, id, args.session_token, args.claim_no));
  const held = heldBy(args.db_path, args.session_token, claims[0]);
  const written = await submissionDataWriteAll(
    args.db_path,
    ids.map((id) => ({ sql: `${STAMP}${held.sql}))`, params: [id, ...held.params] })),
    env
  );
  const jobs = ids.map((id, i): DeleteJobOutcome => {
    const changes = written.ok ? written.results[i].changes : 0;
    const [read] = submissionDataQuery(args.db_path, "SELECT status, locked_by, locked_at, rejected_at, deleted_at FROM tickets WHERE id = ?", [id])
      .rows as unknown as ConfirmRow[];
    if (read === undefined) {
      return { ticket_id: id, outcome: "not_found", changes, status: null, locked_at: null, rejected_at: null, deleted_at: null, note: `No job ${id} in this database, so nothing was written for it.` };
    }
    let outcome: DeleteJobOutcome["outcome"];
    let note: string;
    if (changes === 1) {
      outcome = "deleted";
      note = `Job ${id} is deleted: it shows only as a struck line in the Milestone's Completed list, and restore job #${id} returns it as a Ready job with no lock.`;
    } else if (read.deleted_at !== null) {
      outcome = "already_deleted";
      note = `Job ${id} was deleted earlier (deleted_at ${read.deleted_at}), so nothing was written.`;
    } else if (read.status === "wip" && read.locked_by !== args.session_token) {
      outcome = "held_elsewhere";
      note = `Job ${id} is in progress in another session (locked at ${read.locked_at ?? "(unknown time)"}), so it was not deleted and nothing was written. Say so in one line; never re-run.`;
    } else {
      outcome = "refused_status";
      note = `Job ${id} is ${read.status}, and a ${read.status} job cannot be deleted, so nothing was written.`;
    }
    return { ticket_id: id, outcome, changes, status: read.status, locked_at: read.locked_at, rejected_at: read.rejected_at, deleted_at: read.deleted_at, note };
  });
  return { jobs, ...(written.warning ? { warning: written.warning } : {}) };
}
