// The statement of goals (2026-10-14 Job Board goal card spec, as amended): one per Job Board, held
// as one db_meta row and never a table of its own. Key `board_goal:filing:<id>` for a Writing's board
// or a Job Board with no Writing, `board_goal:proceeding:<id>` for a pre-filing proceeding's board.
// Value: JSON {description, statement, status, approved_at, session_token, updated_at}. It is job
// process state: db_meta carries no revision trigger, so a write here moves no revision and archives
// no mockup. drafting_data__set_board_goal writes it. Every Job Board section reads it
// (render-work-board.ts), and the page's Goal card, board_summary's Goal line and board_card's goals
// lane print it. A key whose board no longer exists is never read, since no section is built for it,
// and the next write removes it.

import { DataServerError, NotFoundError, ValidationError } from "../../errors.js";
import { submissionDataQuery, submissionDataWriteAll } from "../backend.js";

const TOOL = "drafting_data__set_board_goal";
const NOW = "strftime('%Y-%m-%dT%H:%M', 'now', 'localtime')";
const FILING_PREFIX = "board_goal:filing:";
const PROCEEDING_PREFIX = "board_goal:proceeding:";

export type BoardGoalsStatus = "confirmed" | "inferred" | "declined";
const STATUSES: readonly BoardGoalsStatus[] = ["confirmed", "inferred", "declined"];

/** A section's statement of goals as its page, board_summary and board_card read it. `status` null:
 * none is stored. `description` is the stored one, else the board's default. */
export interface BoardGoals {
  description: string;
  statement: string | null;
  status: BoardGoalsStatus | null;
}

interface StoredGoals {
  description: string | null;
  statement: string | null;
  status: BoardGoalsStatus;
  approved_at: string | null;
  session_token: string;
  updated_at: string;
}

/** The db_meta key of a board: a filing's (a Writing or a Job Board with no Writing), or a pre-filing proceeding's. */
export function boardGoalsKey(board: { filing_id: number | null; proceeding_id: number }): string {
  return board.filing_id === null ? `${PROCEEDING_PREFIX}${board.proceeding_id}` : `${FILING_PREFIX}${board.filing_id}`;
}

function readStored(dbPath: string, key: string): StoredGoals | null {
  const [row] = submissionDataQuery(dbPath, "SELECT value FROM db_meta WHERE key = ?", [key]).rows as unknown as { value: string }[];
  if (row === undefined) return null;
  let parsed: StoredGoals;
  try {
    parsed = JSON.parse(row.value) as StoredGoals;
  } catch {
    throw new DataServerError(`db_meta ${key} is not JSON, so its statement of goals cannot be read`, "invalid_board_goal");
  }
  if (!STATUSES.includes(parsed.status)) {
    throw new DataServerError(`db_meta ${key} has status ${JSON.stringify(parsed.status)}, not confirmed, inferred or declined`, "invalid_board_goal");
  }
  return parsed;
}

/** The board's statement of goals, its description defaulting to `fallback`. */
export function fetchBoardGoals(dbPath: string, board: { filing_id: number | null; proceeding_id: number }, fallback: string): BoardGoals {
  const stored = readStored(dbPath, boardGoalsKey(board));
  if (stored === null) return { description: fallback, statement: null, status: null };
  return { description: stored.description ?? fallback, statement: stored.statement, status: stored.status };
}

export interface SetBoardGoalArgs {
  db_path: string;
  filing_id?: number;
  proceeding_id?: number;
  /** The collapsed line. Omitted: the stored one stays, else the board's default. */
  description?: string;
  statement?: string | null;
  status: string;
  /** This session's identity from open_session/bootstrap. Never minted here. */
  session_token: string;
}

export interface SetBoardGoalResult {
  key: string;
  filing_id?: number;
  proceeding_id?: number;
  /** As stored: null means the board's default description. */
  description: string | null;
  statement: string | null;
  status: BoardGoalsStatus;
  approved_at: string | null;
  updated_at: string;
  /** True on an inferred statement: the session's wording, never the practitioner's. */
  session_wording: boolean;
  /** Keys of boards that no longer exist, removed by this write. */
  stale_keys_removed: string[];
  note: string;
  warning?: string;
}

/** drafting_data__set_board_goal. Every refusal writes nothing. */
export async function submissionDataSetBoardGoal(args: SetBoardGoalArgs, env: NodeJS.ProcessEnv = process.env): Promise<SetBoardGoalResult> {
  if ((args.filing_id === undefined) === (args.proceeding_id === undefined)) {
    throw new ValidationError(`${TOOL} takes exactly one of filing_id and proceeding_id`, "invalid_board");
  }
  const id = (args.filing_id ?? args.proceeding_id) as number;
  if (!Number.isInteger(id) || id <= 0) throw new ValidationError(`${TOOL}: the board id must be a positive integer`, "invalid_board");
  if (typeof args.session_token !== "string" || args.session_token.trim() === "") {
    throw new ValidationError(`${TOOL}.session_token must be the session_token open_session or bootstrap returned`, "invalid_session_token");
  }
  const status = args.status as BoardGoalsStatus;
  if (!STATUSES.includes(status)) throw new ValidationError(`${TOOL}.status must be confirmed, inferred or declined`, "invalid_status");
  const statement = args.statement ?? null;
  if (status === "declined" ? statement !== null : typeof statement !== "string" || statement.trim() === "") {
    throw new ValidationError(
      status === "declined" ? `${TOOL}: a declined statement of goals carries no statement` : `${TOOL}.statement must be the statement of goals, not blank`,
      "invalid_statement"
    );
  }
  if (args.description !== undefined && (typeof args.description !== "string" || args.description.trim() === "")) {
    throw new ValidationError(`${TOOL}.description must not be blank; omit it to keep the stored or default description`, "invalid_description");
  }

  const onFiling = args.filing_id !== undefined;
  if (onFiling) {
    if (submissionDataQuery(args.db_path, "SELECT 1 FROM filings WHERE id = ?", [id]).rows.length === 0) {
      throw new NotFoundError(`${TOOL}: no Writing or Job Board ${id} in ${args.db_path}`, "not_found");
    }
  } else {
    const [p] = submissionDataQuery(args.db_path, "SELECT (SELECT COUNT(*) FROM filings WHERE proceeding_id = proceedings.id) AS filings FROM proceedings WHERE id = ?", [id])
      .rows as unknown as { filings: number }[];
    if (p === undefined) throw new NotFoundError(`${TOOL}: no proceeding ${id} in ${args.db_path}`, "not_found");
    if (p.filings > 0) {
      throw new ValidationError(`${TOOL}: proceeding ${id} has a Writing, so its own board is no longer drawn -- set the goal on a Writing's board by filing_id`, "proceeding_has_writing");
    }
  }
  const key = onFiling ? `${FILING_PREFIX}${id}` : `${PROCEEDING_PREFIX}${id}`;
  const description = args.description ?? readStored(args.db_path, key)?.description ?? null;

  // A filing key stands while its filings row does; a proceeding key while the proceeding has no Writing.
  const stale = (
    submissionDataQuery(
      args.db_path,
      `SELECT key FROM db_meta
        WHERE (key GLOB '${FILING_PREFIX}*' AND CAST(substr(key, ${FILING_PREFIX.length + 1}) AS INTEGER) NOT IN (SELECT id FROM filings))
           OR (key GLOB '${PROCEEDING_PREFIX}*' AND CAST(substr(key, ${PROCEEDING_PREFIX.length + 1}) AS INTEGER) NOT IN
                 (SELECT id FROM proceedings p WHERE NOT EXISTS (SELECT 1 FROM filings f WHERE f.proceeding_id = p.id)))
        ORDER BY key`
    ).rows as unknown as { key: string }[]
  ).map((r) => r.key);

  const written = await submissionDataWriteAll(
    args.db_path,
    [
      {
        sql:
          "INSERT OR REPLACE INTO db_meta (key, value) VALUES (?, json_object('description', ?, 'statement', ?, 'status', ?, " +
          `'approved_at', CASE WHEN ? = 'confirmed' THEN ${NOW} END, 'session_token', ?, 'updated_at', ${NOW}))`,
        params: [key, description, statement, status, status, args.session_token],
        expect_changes: 1,
      },
      ...(stale.length > 0 ? [{ sql: "DELETE FROM db_meta WHERE key IN (SELECT value FROM json_each(?))", params: [JSON.stringify(stale)] }] : []),
    ],
    env
  );
  if (!written.ok) throw new DataServerError(`${TOOL}: the write did not land (statement ${written.failed}); nothing was written`, "write_failed");
  const stored = readStored(args.db_path, key);
  if (stored === null) throw new DataServerError(`${TOOL}: ${key} is missing after the write`, "write_failed");

  const label = onFiling ? `Job Board ${id}` : `proceeding ${id}'s board`;
  const note =
    status === "confirmed"
      ? `The statement of goals on ${label} is recorded as confirmed (approved_at ${stored.approved_at}). Re-render to show it.`
      : status === "inferred"
        ? `The statement of goals on ${label} is recorded as inferred: the session's wording, not confirmed. Re-render to show it.`
        : `The practitioner's decline is recorded on ${label}: no statement is stored. Re-render to show it.`;
  return {
    key,
    ...(onFiling ? { filing_id: id } : { proceeding_id: id }),
    description: stored.description,
    statement: stored.statement,
    status: stored.status,
    approved_at: stored.approved_at,
    updated_at: stored.updated_at,
    session_wording: stored.status === "inferred",
    stale_keys_removed: stale,
    note,
    ...(written.warning ? { warning: written.warning } : {}),
  };
}
