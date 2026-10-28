// drafting_data__create_job_board: a Milestone with no Writing, for work on a proceeding that is no
// Writing's. It is stored as a `filings` row of the reserved kind JOB_BOARD_KIND with no stored
// layout, so the jobs on it carry its id as their filing_id and show on no other board. Only this
// tool writes that kind: drafting_data__create_writing refuses it. A proceeding with no Writing
// keeps its own board (ADR 0018), so this write is refused there.

import { DataServerError, ValidationError } from "../../errors.js";
import { submissionDataWriteAll } from "../backend.js";
import { fetchProceeding, JOB_BOARD_KIND } from "./query.js";

const TOOL = "drafting_data__create_job_board";

export interface CreateJobBoardArgs {
  db_path: string;
  proceeding_id: number;
  /** The board's name, in the practitioner's own words. */
  title: string;
}

export interface CreateJobBoardResult {
  filing_id: number;
  proceeding_id: number;
  title: string;
  warning?: string;
}

/** drafting_data__create_job_board. Every refusal writes nothing. */
export async function submissionDataCreateJobBoard(args: CreateJobBoardArgs, env: NodeJS.ProcessEnv = process.env): Promise<CreateJobBoardResult> {
  if (typeof args.title !== "string" || args.title.trim() === "") {
    throw new ValidationError(`${TOOL}.title must name the Milestone`, "invalid_title");
  }
  const title = args.title.trim();
  const proceeding = fetchProceeding(args.db_path, args.proceeding_id);
  const written = await submissionDataWriteAll(
    args.db_path,
    [
      {
        // The WHERE re-checks, inside the INSERT's own transaction, that the proceeding has a Writing.
        sql:
          "INSERT INTO filings (proceeding_id, kind, title, needs_forum_parts) " +
          "SELECT ?, ?, ?, 0 WHERE EXISTS (SELECT 1 FROM filings WHERE proceeding_id = ? AND kind <> ?)",
        params: [proceeding.id, JOB_BOARD_KIND, title, proceeding.id, JOB_BOARD_KIND],
        expect_changes: 1,
      },
    ],
    env
  );
  if (!written.ok) {
    throw new DataServerError(
      `${TOOL}: proceeding ${proceeding.id} has no Writing, so its own Milestone already holds jobs with no Writing; nothing was written. ` +
        "Outline the work on that board (render it by proceeding_id)",
      "no_writing"
    );
  }
  return {
    filing_id: written.results[0].rowid,
    proceeding_id: proceeding.id,
    title,
    ...(written.warning ? { warning: written.warning } : {}),
  };
}
