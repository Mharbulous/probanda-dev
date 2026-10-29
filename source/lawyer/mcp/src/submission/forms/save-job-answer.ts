// research_filing__save_answer given a job (schema v52). The answer file is saved exactly as
// files/research-filing.ts saves it, then recorded against the job in ticket_answers, by a write
// guarded on the job's lock being the saving session's, as every write on a held job is
// (jobs-run.md §5). The record lists the answer on the job's card and moves its last activity (job-activity.ts), so a
// job whose session is still saving answers does not read as idle. A pre-read refuses, before any
// file is written, a job that does not exist and a database held below v52. A record the guard
// refuses leaves the file saved and says so: the answer is never lost, and the job is no longer
// this session's to write. The job tables carry no revision triggers, so the revision does not move.

import { DataServerError, NotFoundError, ValidationError } from "../../errors.js";
import { saveAnswer } from "../../files/research-filing.js";
import { submissionDataQuery, submissionDataWrite } from "../backend.js";
import { jobIdentity, touchJob } from "./job-activity.js";
import { ticketAnswersHeld } from "./query.js";

const TOOL = "research_filing__save_answer";
const NOW = "strftime('%Y-%m-%dT%H:%M', 'now', 'localtime')";

export interface SaveAnswerArgs {
  destination_dir: string;
  filename: string;
  /** Exactly one of text and from_scratch. */
  text?: string;
  /** A file write_scratch wrote in the destination matter's scratchpad, copied byte for byte. */
  from_scratch?: string;
  /** The job's drafting database. With ticket_id and session_token, or none of the three. */
  db_path?: string;
  ticket_id?: number;
  /** This session's identity from open_session/bootstrap. */
  session_token?: string;
}

export interface SaveAnswerResult {
  path: string;
  filename: string;
  bytes: number;
  created_dir: boolean;
  sha256: string;
  /** Present when a job was named: whether the answer was recorded against it, and why not. */
  job?: { ticket_id: number; recorded: boolean; note: string };
  warning?: string;
}

interface HolderRow {
  locked_by: string | null;
  status: string;
  rejected_at: string | null;
}

/** A saved answer's path from its `6. LAW` segment on, with backslash separators: the matter-root
 * relative form `documents.file_path` is stored in. The save confines every path to a `6. LAW` tree. */
export function lawRelativePath(path: string): string {
  const segments = path.split(/[\\/]+/);
  return segments.slice(segments.findIndex((s) => s.toLowerCase() === "6. law")).join("\\");
}

export async function saveAnswerTool(args: SaveAnswerArgs, env: NodeJS.ProcessEnv = process.env): Promise<SaveAnswerResult> {
  const job = jobIdentity(TOOL, args);
  if (job === null) return saveAnswer(args.destination_dir, args.filename, args.text, args.from_scratch);
  const { dbPath, id, token } = job;
  if (submissionDataQuery(dbPath, "SELECT id FROM tickets WHERE id = ?", [id]).rows.length === 0) {
    throw new NotFoundError(`${TOOL}: no job ${id} in ${dbPath}; nothing was saved`, "not_found");
  }
  if (!ticketAnswersHeld(dbPath)) {
    throw new ValidationError(
      `${TOOL}: ${dbPath} is held below schema v52, so no answer can be recorded against job ${id}; nothing was saved. Save it without db_path, ticket_id and session_token.`,
      "schema_below_v52"
    );
  }

  const saved = saveAnswer(args.destination_dir, args.filename, args.text, args.from_scratch);
  let written: Awaited<ReturnType<typeof submissionDataWrite>>;
  try {
    written = await submissionDataWrite(
      dbPath,
      `INSERT INTO ticket_answers (ticket_id, file_path, saved_at) SELECT id, ?, ${NOW} FROM tickets WHERE id = ? AND locked_by = ?`,
      [lawRelativePath(saved.path), id, token],
      env
    );
  } catch (err) {
    throw new DataServerError(`The answer was saved at ${saved.path}, but recording it against job ${id} failed: ${(err as Error).message}. Do not save it again.`, "record_failed");
  }
  const warning = written.warning ? { warning: written.warning } : {};
  if (written.changes === 1) {
    await touchJob(dbPath, id, token, env);
    return { ...saved, job: { ticket_id: id, recorded: true, note: `Recorded against job ${id}: its card lists the answer.` }, ...warning };
  }
  const [row] = submissionDataQuery(dbPath, "SELECT locked_by, status, rejected_at FROM tickets WHERE id = ?", [id]).rows as unknown as HolderRow[];
  const holder = row.locked_by === null ? "no holder" : "another session's lock";
  return {
    ...saved,
    job: {
      ticket_id: id,
      recorded: false,
      note: `The answer was saved, but job ${id} is not this session's (status=${row.status}, ${holder}, rejected_at=${row.rejected_at ?? "NULL"}), so it was not recorded against the job. Report it and stop; dispatch nothing more for this job.`,
    },
    ...warning,
  };
}
