// drafting_data__merge_job_boards (docs/ADRs/0010-job-boards-organized-by-goals.md): joins two Job
// Boards whose goals the practitioner has confirmed overlap or cohere. The survivor is a Writing's
// board over a Job Board with no Writing over a pre-filing board, and within a kind the lower id
// (BoardIndex.rank). The absorbed board gets one membership row naming the survivor, every board it
// had absorbed is re-pointed to the survivor, and its statement of goals is appended, with its own
// status, to the survivor's `merged` list and its own row removed. No job, loose thread or Writing
// row is written: at the next render the survivor's page draws every board on it as one board
// (combined-board.ts).

import { DataServerError, NotFoundError, ValidationError } from "../../errors.js";
import { submissionDataQuery, submissionDataWriteAll } from "../backend.js";
import { type MergedGoal, readStored, survivorGoalsKey } from "./board-goals.js";
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
}

export interface MergeJobBoardsResult {
  survivor: BoardRef;
  absorbed: BoardRef;
  /** The survivor's statements of goals after the merge: its own, if any, then the merged ones. */
  goals: number;
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
  if (p === undefined) throw new NotFoundError(`${TOOL}: no proceeding ${id} in ${dbPath}`, "not_found");
  if (p.filings > 0) throw new ValidationError(`${TOOL}: proceeding ${id} has a Writing, so its own board is no longer drawn -- name a Writing's board by filing_id`, "proceeding_has_writing");
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

  // The survivor's goals row gains the absorbed board's own statement, when it has one, then its merged ones.
  const survivorKey = survivorGoalsKey(args.db_path, survivor, index);
  const absorbedKey = survivorGoalsKey(args.db_path, absorbed, index);
  const target = readStored(args.db_path, survivorKey);
  const taken = readStored(args.db_path, absorbedKey);
  const moved: MergedGoal[] = [
    ...(taken !== null && taken.statement !== null && taken.status !== null
      ? [{ from: absorbedKey, description: taken.description, statement: taken.statement, status: taken.status, approved_at: taken.approved_at, session_token: taken.session_token ?? args.session_token, updated_at: taken.updated_at }]
      : []),
    ...(taken?.merged ?? []),
  ];
  const merged = [...(target?.merged ?? []), ...moved];
  const goals = target === null && merged.length === 0
    ? null
    : { ...(target ?? { description: null, statement: null, status: null, approved_at: null, session_token: null, updated_at: null }), merged };
  const value = JSON.stringify({ filing_id: survivor.filing_id, proceeding_id: survivor.proceeding_id });

  const written = await submissionDataWriteAll(
    args.db_path,
    [
      { sql: "INSERT INTO db_meta (key, value) VALUES (?, ?)", params: [memberKey(absorbed), value], expect_changes: 1 },
      ...index.membersOf(absorbed).map((key) => ({ sql: "UPDATE db_meta SET value = ? WHERE key = ?", params: [value, key], expect_changes: 1 })),
      ...(goals === null
        ? []
        : [
            {
              // A survivor with no row of its own gets one stamped now, holding only the merged statements.
              sql: `INSERT OR REPLACE INTO db_meta (key, value) VALUES (?, ${target === null ? "json_set(json(?), '$.updated_at', strftime('%Y-%m-%dT%H:%M', 'now', 'localtime'))" : "json(?)"})`,
              params: [survivorKey, JSON.stringify(goals)],
              expect_changes: 1,
            },
          ]),
      ...(taken === null ? [] : [{ sql: "DELETE FROM db_meta WHERE key = ?", params: [absorbedKey], expect_changes: 1 }]),
    ],
    env
  );
  if (!written.ok) throw new DataServerError(`${TOOL}: the write did not land (statement ${written.failed}); nothing was written`, "write_failed");
  const count = (goals?.statement != null ? 1 : 0) + merged.length;
  return {
    survivor,
    absorbed,
    goals: count,
    note: `${label(absorbed)} is merged into ${label(survivor)}, which now holds ${count} statement${count === 1 ? "" : "s"} of goals. Re-render to draw the merged page.`,
    ...(written.warning ? { warning: written.warning } : {}),
  };
}
