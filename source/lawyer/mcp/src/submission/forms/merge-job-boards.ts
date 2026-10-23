// drafting_data__merge_job_boards (docs/ADRs/0010-job-boards-organized-by-goals.md): joins two Job
// Boards whose goals the practitioner has confirmed overlap or cohere. The survivor is a Writing's
// board over a Job Board with no Writing over a pre-filing board, and within a kind the lower id
// (BoardIndex.rank). The absorbed board gets one membership row naming the survivor, and every board
// it had absorbed is re-pointed to the survivor. The merged board holds one goal (ADR 0010, 2026-10-22
// goals amendment): the practitioner's combined goal_statement, written as confirmed, or with none,
// status needs_consolidation. Each earlier statement, the survivor's own and the absorbed board's, with
// its own merged ones, is kept under `merged` as history only, and the absorbed board's row removed.
// No job, loose thread or Writing row is written: at the next render the survivor's page draws every
// board on it as one board (combined-board.ts).

import { DataServerError, NotFoundError, ValidationError } from "../../errors.js";
import { submissionDataQuery, submissionDataWriteAll } from "../backend.js";
import { framingWarning, type MergedGoal, NEEDS_CONSOLIDATION, readStored, type StoredGoals, survivorGoalsKey } from "./board-goals.js";
import { BoardIndex, type BoardRef, memberKey, sameBoard } from "./board-members.js";

const TOOL = "drafting_data__merge_job_boards";

export interface MergeJobBoardsArgs {
  db_path: string;
  /** The two boards, each by exactly one of filing_id and proceeding_id. */
  boards: { filing_id?: number; proceeding_id?: number }[];
  /** True only once the practitioner, shown both boards' statements of goals, confirmed that they overlap or cohere. */
  confirmed: boolean;
  /** This session's identity from open_session/bootstrap. Never minted here. */
  session_token: string;
  /** The merged board's one goal, the practitioner's words or the proposal they approved with the same
   * bare yes as the merge. Omitted: the board is left needs_consolidation. */
  goal_statement?: string;
  /** The line the closed Goal card shows; only with goal_statement. Omitted: the board's default. */
  goal_description?: string;
}

export interface MergeJobBoardsResult {
  survivor: BoardRef;
  absorbed: BoardRef;
  /** The merged board's goal: confirmed when goal_statement was given, else needs_consolidation. */
  goal_status: "confirmed" | typeof NEEDS_CONSOLIDATION;
  note: string;
  warning?: string;
}

function label(b: BoardRef): string {
  return b.filing_id === null ? `proceeding ${b.proceeding_id}'s board` : `Job Board ${b.filing_id}`;
}

/** One named board, refused when it is not live: a filing that is retired, or a proceeding that has a Writing. */
function resolve(dbPath: string, arg: { filing_id?: number; proceeding_id?: number }, i: number): BoardRef {
  if ((arg?.filing_id === undefined) === (arg?.proceeding_id === undefined)) {
    throw new ValidationError(`${TOOL}.boards[${i}] takes exactly one of filing_id and proceeding_id`, "invalid_board");
  }
  const id = (arg.filing_id ?? arg.proceeding_id) as number;
  if (!Number.isInteger(id) || id <= 0) throw new ValidationError(`${TOOL}.boards[${i}]: the board id must be a positive integer`, "invalid_board");
  if (arg.filing_id !== undefined) {
    const [f] = submissionDataQuery(dbPath, "SELECT proceeding_id, retired_on FROM filings WHERE id = ?", [id]).rows as unknown as { proceeding_id: number; retired_on: string | null }[];
    if (f === undefined) throw new NotFoundError(`${TOOL}: no Writing or Job Board ${id} in ${dbPath}`, "not_found");
    if (f.retired_on !== null) throw new ValidationError(`${TOOL}: Job Board ${id} is retired or closed, so it has no board to merge`, "board_retired");
    return { filing_id: id, proceeding_id: f.proceeding_id };
  }
  const [p] = submissionDataQuery(dbPath, "SELECT (SELECT COUNT(*) FROM filings WHERE proceeding_id = proceedings.id) AS filings FROM proceedings WHERE id = ?", [id])
    .rows as unknown as { filings: number }[];
  if (p === undefined) throw new NotFoundError("That proceeding is not in this matter's drafting records", "not_found");
  if (p.filings > 0) throw new ValidationError("That proceeding has a Writing, so its own board is no longer drawn -- name a Writing's Job Board", "proceeding_has_writing");
  return { filing_id: null, proceeding_id: id };
}

/** drafting_data__merge_job_boards. Every refusal writes nothing. */
export async function submissionDataMergeJobBoards(args: MergeJobBoardsArgs, env: NodeJS.ProcessEnv = process.env): Promise<MergeJobBoardsResult> {
  if (!Array.isArray(args.boards) || args.boards.length !== 2) throw new ValidationError(`${TOOL}.boards must name exactly two boards`, "invalid_boards");
  if (args.confirmed !== true) {
    throw new ValidationError(
      `${TOOL}: show the practitioner both boards' statements of goals and ask whether they overlap or cohere; pass confirmed: true only on their yes. Nothing was written`,
      "not_confirmed"
    );
  }
  if (typeof args.session_token !== "string" || args.session_token.trim() === "") {
    throw new ValidationError(`${TOOL}.session_token must be the session_token open_session or bootstrap returned`, "invalid_session_token");
  }
  const statement = args.goal_statement;
  if (statement !== undefined && (typeof statement !== "string" || statement.trim() === "")) {
    throw new ValidationError(`${TOOL}.goal_statement must be the merged board's one goal, not blank; omit it to leave the board needing one`, "invalid_statement");
  }
  if (args.goal_description !== undefined && (statement === undefined || typeof args.goal_description !== "string" || args.goal_description.trim() === "")) {
    throw new ValidationError(`${TOOL}.goal_description must not be blank, and is given only with goal_statement`, "invalid_description");
  }
  const [a, b] = args.boards.map((arg, i) => resolve(args.db_path, arg, i));
  const index = new BoardIndex(args.db_path);
  for (const x of [a, b]) {
    if (index.absorbed(x)) throw new ValidationError(`${TOOL}: ${label(x)} is already merged into ${label(index.survivorOf(x))}; name that board instead`, "board_merged");
  }
  if (sameBoard(index.survivorOf(a), index.survivorOf(b))) throw new ValidationError(`${TOOL}: ${label(a)} and ${label(b)} are already one board`, "same_board");

  const [ra, rb] = [index.rank(a), index.rank(b)];
  const aWins = ra[0] !== rb[0] ? ra[0] < rb[0] : ra[1] < rb[1];
  const survivor = index.survivorOf(aWins ? a : b);
  const absorbed = aWins ? b : a;

  // The survivor's row holds the one goal; every earlier statement of both boards becomes history.
  const survivorKey = survivorGoalsKey(args.db_path, survivor, index);
  const absorbedKey = survivorGoalsKey(args.db_path, absorbed, index);
  const history = (key: string, row: StoredGoals | null): MergedGoal[] => [
    ...(row !== null && row.statement !== null && (row.status === "confirmed" || row.status === "inferred")
      ? [{ from: key, description: row.description, statement: row.statement, status: row.status, approved_at: row.approved_at, session_token: row.session_token ?? args.session_token, updated_at: row.updated_at }]
      : []),
    ...(row?.merged ?? []),
  ];
  const taken = readStored(args.db_path, absorbedKey);
  const merged = [...history(survivorKey, readStored(args.db_path, survivorKey)), ...history(absorbedKey, taken)];
  const goalStatus = statement === undefined ? NEEDS_CONSOLIDATION : "confirmed";
  const goals = { description: args.goal_description ?? null, statement: statement ?? null, status: goalStatus, session_token: args.session_token, merged };
  // Stamped in SQL: approved_at and consolidated_at only with a goal.
  const now = "strftime('%Y-%m-%dT%H:%M', 'now', 'localtime')";
  const stamps =
    statement === undefined
      ? `json_set(json(?), '$.approved_at', json('null'), '$.updated_at', ${now})`
      : `json_set(json(?), '$.approved_at', ${now}, '$.updated_at', ${now}, '$.consolidated_at', ${now})`;
  const value = JSON.stringify({ filing_id: survivor.filing_id, proceeding_id: survivor.proceeding_id });

  const written = await submissionDataWriteAll(
    args.db_path,
    [
      { sql: "INSERT INTO db_meta (key, value) VALUES (?, ?)", params: [memberKey(absorbed), value], expect_changes: 1 },
      ...index.membersOf(absorbed).map((key) => ({ sql: "UPDATE db_meta SET value = ? WHERE key = ?", params: [value, key], expect_changes: 1 })),
      { sql: `INSERT OR REPLACE INTO db_meta (key, value) VALUES (?, ${stamps})`, params: [survivorKey, JSON.stringify(goals)], expect_changes: 1 },
      ...(taken === null ? [] : [{ sql: "DELETE FROM db_meta WHERE key = ?", params: [absorbedKey], expect_changes: 1 }]),
    ],
    env
  );
  if (!written.ok) throw new DataServerError(`${TOOL}: the write did not land (statement ${written.failed}); nothing was written`, "write_failed");
  const framing = statement === undefined ? null : framingWarning(statement, args.goal_description);
  const goalNote =
    statement === undefined
      ? `It has no goal yet (${NEEDS_CONSOLIDATION}): at its next /draft opening, ask the practitioner once for one combined goal.`
      : "Its one goal is recorded as confirmed.";
  return {
    survivor,
    absorbed,
    goal_status: goalStatus,
    note: `${label(absorbed)} is merged into ${label(survivor)}. ${goalNote} Re-render to draw the merged page.${framing === null ? "" : ` ${framing}`}`,
    ...(written.warning ? { warning: written.warning } : {}),
  };
}
