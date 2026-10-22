// drafting_data__complete_job: a /draft session completes the job it holds in one call -- the
// supersession of the job's queued conflict partners, then the completion, both under this
// session's token, then the confirm-read, as the /drafting-data gatekeeper documents them in
// jobs-run.md §9. When this call's completion landed, the matter's pages are rewritten by the
// render a session would run itself with draft_dir, because a job write moves no revision and
// starts no background render, so nothing else would refresh the Job Board pages. A job with no
// filing_id (a scrutiny review job) shows on every filing's page in its proceeding, so when its
// proceeding has a filing, that filing's render is used: any render rewrites every page, and
// job_board_path is the rendered filing's page. Only a proceeding with no filing at all goes through
// the proceeding's render, and job_board_path is then the proceeding's page.
//
// Before either statement, a job this session holds is read for its steps: while any step is open,
// waiting or to be retried (step-state.ts, schema v78) nothing is written and the outcome is
// steps_open, naming each one. A step the practitioner dropped or put off (drafting_data__set_step
// with their words) is resolved. On a database held below v78 every unstamped step is open.

import { DataServerError, NotFoundError, ValidationError } from "../../errors.js";
import { submissionDataQuery, submissionDataWriteAll } from "../backend.js";
import { type ClientContext, type RenderedDocument, submissionFormsRender, submissionFormsRenderProceedingBoard } from "../forms.js";
import { fetchAllFilingsForProceeding, isJobOnlyBoard, liveTicketClause, stepStatusHeld } from "./query.js";
import { type StepStateFields, stepResolved } from "./step-state.js";
import type { BoardMove } from "../matter-pages.js";
import type { MatterDates } from "../matter-dates.js";
import type { MatterTodos } from "../matter-todos.js";

const TOOL = "drafting_data__complete_job";
const NOW = "strftime('%Y-%m-%dT%H:%M', 'now', 'localtime')";

export interface CompleteJobArgs {
  db_path: string;
  ticket_id: number;
  /** This session's identity from open_session/bootstrap. Never minted here. */
  session_token: string;
  /** The matter's 0. DRAFT folder from open_session, under which the pages are rewritten. */
  draft_dir: string;
}

export interface CompleteJobResult {
  ticket_id: number;
  outcome: "completed" | "not_held" | "shelved" | "no_match" | "steps_open";
  /** Queued conflict partners this call superseded. */
  superseded: number;
  /** Rows the completion changed: 1 when this call completed the job, 0 otherwise. */
  changes: number;
  /** The confirm-read. */
  status: string;
  completed_at: string | null;
  locked_by: string | null;
  rejected_at: string | null;
  /** True when this call rewrote the matter's pages. */
  pages_written: boolean;
  job_board_path?: string;
  board_changed?: boolean;
  board_moves?: BoardMove[];
  /** On steps_open: each step not yet resolved, in plan order. Nothing was written. */
  open_steps?: { ordinal: number; text: string; state: string }[];
  /** Present when the page rewrite refused: the Job Board is stale. The completion stands. */
  pages_refused?: { code: string; message: string };
  note: string;
  warning?: string;
}

interface ConfirmRow {
  status: string;
  completed_at: string | null;
  locked_by: string | null;
  rejected_at: string | null;
  proceeding_id: number;
  filing_id: number | null;
}

type Pages = Pick<CompleteJobResult, "pages_written" | "job_board_path" | "board_changed" | "board_moves" | "pages_refused">;

/** The render a session runs with draft_dir, as open_session's openBoard runs it. */
function rewritePages(args: CompleteJobArgs, read: ConfirmRow, client: ClientContext, todos: MatterTodos | undefined, dates: MatterDates | undefined): Pages {
  try {
    let filingId = read.filing_id;
    if (filingId === null) {
      // The proceeding's first filing by id that is not retired, else its first filing. This picks by
      // id, not by bootstrap's ranked order, so it can differ from open_session's openBoard. Never a
      // Job Board with no Writing, which shows no job without a filing_id.
      const filings = fetchAllFilingsForProceeding(args.db_path, read.proceeding_id).filter((f) => !isJobOnlyBoard(f));
      filingId = (filings.find((f) => f.retired_on === null) ?? filings[0])?.id ?? null;
    }
    if (filingId !== null) {
      const rendered = submissionFormsRender(args.db_path, filingId, client, "mockup", ["Work_board"], undefined, undefined, undefined, args.session_token, args.draft_dir, todos, dates);
      const board = rendered.documents.find((d) => d.document_type === "Work_board") as RenderedDocument | undefined;
      if (board === undefined) {
        return { pages_written: false, pages_refused: { code: "render_refused", message: rendered.note ?? `the render of filing ${filingId} returned no Job Board` } };
      }
      return {
        pages_written: board.pages_written === true,
        ...(board.path !== undefined ? { job_board_path: board.path } : {}),
        ...(board.board_changed !== undefined ? { board_changed: board.board_changed } : {}),
        ...(board.board_moves !== undefined ? { board_moves: board.board_moves } : {}),
      };
    }
    const rendered = submissionFormsRenderProceedingBoard(args.db_path, read.proceeding_id, client, undefined, args.session_token, args.draft_dir, todos, dates);
    return {
      pages_written: rendered.pages_written,
      ...(rendered.job_board_path !== undefined ? { job_board_path: rendered.job_board_path } : {}),
      ...(rendered.board_changed !== undefined ? { board_changed: rendered.board_changed } : {}),
      ...(rendered.board_moves !== undefined ? { board_moves: rendered.board_moves } : {}),
    };
  } catch (err) {
    if (!(err instanceof DataServerError)) throw err;
    return { pages_written: false, pages_refused: { code: err.code, message: err.message } };
  }
}

interface OpenStepRow extends StepStateFields {
  ordinal: number;
  text: string;
}

/** The steps_open refusal for a job this session holds with any step not resolved; null otherwise,
 * and for a job it does not hold, whose outcome the guarded statements then report. */
function openSteps(dbPath: string, id: number, token: string): CompleteJobResult | null {
  const [job] = submissionDataQuery(dbPath, "SELECT status, locked_by, rejected_at FROM tickets WHERE id = ?", [id]).rows as unknown as { status: string; locked_by: string | null; rejected_at: string | null }[];
  if (job === undefined || job.locked_by !== token) return null;
  const columns = stepStatusHeld(dbPath) ? "ordinal, text, done_at, status, wait_until" : "ordinal, text, done_at";
  const steps = submissionDataQuery(dbPath, `SELECT ${columns} FROM ticket_steps WHERE ticket_id = ? ORDER BY ordinal`, [id]).rows as unknown as OpenStepRow[];
  const open = steps.filter((s) => !stepResolved(s)).map((s) => ({ ordinal: s.ordinal, text: s.text, state: s.status === "retry" ? "retry" : s.status === "waiting" ? "waiting" : "open" }));
  if (open.length === 0) return null;
  return {
    ticket_id: id,
    outcome: "steps_open",
    superseded: 0,
    changes: 0,
    status: job.status,
    completed_at: null,
    locked_by: job.locked_by,
    rejected_at: job.rejected_at,
    pages_written: false,
    open_steps: open,
    note:
      `Job ${id} was not completed and nothing was written: ${open.length === 1 ? "step" : "steps"} ` +
      `${open.map((s) => `${s.ordinal} "${s.text}" (${s.state})`).join(", ")} ${open.length === 1 ? "is" : "are"} not done. ` +
      "Finish each one, or, on the practitioner's own words, set it cancelled or deferred with drafting_data__set_step, then complete.",
  };
}

/** drafting_data__complete_job. Every validation refusal writes nothing; a page refusal is reported, never thrown. */
export async function submissionDataCompleteJob(
  args: CompleteJobArgs,
  client: ClientContext = {},
  todos?: MatterTodos,
  dates?: MatterDates,
  env: NodeJS.ProcessEnv = process.env
): Promise<CompleteJobResult> {
  if (!Number.isInteger(args.ticket_id) || args.ticket_id <= 0) throw new ValidationError(`${TOOL}.ticket_id must be a positive integer`, "invalid_ticket_id");
  if (typeof args.session_token !== "string" || args.session_token.trim() === "") {
    throw new ValidationError(`${TOOL}.session_token must be the session_token open_session or bootstrap returned`, "invalid_session_token");
  }
  const id = args.ticket_id;
  const token = args.session_token;
  const open = openSteps(args.db_path, id, token);
  if (open !== null) return open;
  const written = await submissionDataWriteAll(
    args.db_path,
    [
      {
        // A deleted partner is left as it is, so a restore brings it back exactly (jobs-closeout.md §10a).
        sql:
          `UPDATE tickets SET status = 'superseded', superseded_by = ? WHERE status = 'queued'${liveTicketClause(args.db_path)} AND id IN ` +
          "(SELECT b_id FROM ticket_conflicts WHERE a_id = ? UNION SELECT a_id FROM ticket_conflicts WHERE b_id = ?) " +
          "AND EXISTS (SELECT 1 FROM tickets WHERE id = ? AND locked_by = ?)",
        params: [id, id, id, id, token],
      },
      {
        sql: `UPDATE tickets SET status = 'completed', completed_at = ${NOW}, locked_by = NULL, locked_at = NULL WHERE id = ? AND locked_by = ?`,
        params: [id, token],
      },
    ],
    env
  );
  const superseded = written.ok ? written.results[0].changes : 0;
  const changes = written.ok ? written.results[1].changes : 0;
  const [read] = submissionDataQuery(
    args.db_path,
    "SELECT status, completed_at, locked_by, rejected_at, proceeding_id, filing_id FROM tickets WHERE id = ?",
    [id]
  ).rows as unknown as ConfirmRow[];
  if (read === undefined) throw new NotFoundError(`${TOOL}: no job ${id} in ${args.db_path}`, "not_found");

  let outcome: CompleteJobResult["outcome"];
  let note: string;
  if (read.status === "completed" && read.locked_by === null) {
    outcome = "completed";
    note =
      changes === 1
        ? `Job ${id} is completed by this call.`
        : `Job ${id} is completed, but not by this call: another session finished it, so this call rewrote no page.`;
  } else if (read.locked_by !== null && read.locked_by !== token) {
    outcome = "not_held";
    note = `Job ${id} was not completed: another session holds it (taken over). Report it and stop.`;
  } else if (read.locked_by === null && read.rejected_at !== null) {
    outcome = "shelved";
    note = `Job ${id} was not completed: it was shelved in another session. Report it and stop.`;
  } else {
    outcome = "no_match";
    note = `Job ${id} was not completed: its row is status=${read.status}, locked_by=${read.locked_by ?? "NULL"}, so the guards matched nothing. Report it and stop.`;
  }

  const pages: Pages = changes === 1 ? rewritePages(args, read, client, todos, dates) : { pages_written: false };
  return {
    ticket_id: id,
    outcome,
    superseded,
    changes,
    status: read.status,
    completed_at: read.completed_at,
    locked_by: read.locked_by,
    rejected_at: read.rejected_at,
    ...pages,
    note,
    ...(written.warning ? { warning: written.warning } : {}),
  };
}
