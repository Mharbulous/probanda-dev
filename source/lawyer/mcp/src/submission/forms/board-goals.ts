// The statement of goals (2026-10-14 Work Board goal card spec, as amended): one per Work Board, held
// as one db_meta row and never a table of its own. Key `board_goal:filing:<id>` for a Writing's board
// or a Work Board with no Writing, `board_goal:proceeding:<id>` for a pre-filing proceeding's board.
// Value: JSON {description, statement, status, approved_at, session_token, updated_at}. It is job
// process state: db_meta carries no revision trigger, so a write here moves no revision and archives
// no mockup. drafting_data__set_board_goal writes it. Every Work Board section reads it
// (render-work-board.ts), and the page's Goal card, board_summary's Goal line and board_card's goals
// lane print it. A key whose board no longer exists is never read, since no section is built for it,
// and the next write removes it.
//
// A merged board (docs/ADRs/0010-milestones-organized-by-goals.md, 2026-10-22 goals amendment) holds
// one goal, in the fields above. Each earlier statement, the survivor's own and each absorbed board's,
// is kept under `merged`, with its own status and the key it came from, as history only: it is never
// drawn once the board holds one goal. A merge given the practitioner's combined goal writes it as
// confirmed and stamps `consolidated_at`; a merge without one leaves status `needs_consolidation` and
// no statement, and the next own write of set_board_goal stamps `consolidated_at`. A row with `merged`
// and no `consolidated_at`, written by a merge before this change, needs consolidation too. A section
// of an absorbed board reads its survivor's row.

import { DataServerError, NotFoundError, ValidationError } from "../../errors.js";
import { submissionDataQuery, submissionDataWriteAll } from "../backend.js";
import { BoardIndex, type BoardRef } from "./board-members.js";
import { fetchBoardFilings, isResearchWriting, RESEARCH_WRITING_KINDS_SQL } from "./query.js";

const TOOL = "drafting_data__set_board_goal";
const NOW = "strftime('%Y-%m-%dT%H:%M', 'now', 'localtime')";
const FILING_PREFIX = "board_goal:filing:";
const PROCEEDING_PREFIX = "board_goal:proceeding:";

export type BoardGoalsStatus = "confirmed" | "inferred" | "declined";
const STATUSES: readonly BoardGoalsStatus[] = ["confirmed", "inferred", "declined"];
/** A merged board's status until it holds one goal: the merge was given none, or predates this rule. */
export const NEEDS_CONSOLIDATION = "needs_consolidation";

/** A section's statement of goals as its page, board_summary and board_card read it: one goal.
 * `status` null: none is stored. `description` is the stored one, else the board's default. */
export interface BoardGoals {
  description: string;
  statement: string | null;
  status: BoardGoalsStatus | typeof NEEDS_CONSOLIDATION | null;
  /** Only while status is needs_consolidation: the merged board's earlier statements, in `merged`
   * order (set_board_goal's merged_index), for the session to propose one combined goal from. The page
   * never draws them. */
  to_combine?: { statement: string; status: BoardGoalsStatus }[];
}

/** One absorbed board's statement as a merge stored it: `from` is the goal key it was read from. */
export interface MergedGoal {
  from: string;
  description: string | null;
  statement: string;
  status: BoardGoalsStatus;
  approved_at: string | null;
  session_token: string;
  updated_at: string;
}

export interface StoredGoals {
  description: string | null;
  statement: string | null;
  /** Null only on a survivor with no statement of its own, written by a merge before 2026-10-22 to hold `merged`. */
  status: BoardGoalsStatus | typeof NEEDS_CONSOLIDATION | null;
  approved_at: string | null;
  session_token: string | null;
  updated_at: string;
  merged?: MergedGoal[];
  /** When the board's one goal replaced its merged statements. */
  consolidated_at?: string;
}

/** Whether a stored row needs one combined goal: a merge left it so, or wrote `merged` before 2026-10-22. */
export function needsConsolidation(stored: StoredGoals): boolean {
  return stored.status === NEEDS_CONSOLIDATION || ((stored.merged ?? []).length > 0 && stored.consolidated_at == null);
}

/** The db_meta key of a board: a filing's (a Writing or a Work Board with no Writing), or a pre-filing proceeding's. */
export function boardGoalsKey(board: { filing_id: number | null; proceeding_id: number }): string {
  return board.filing_id === null ? `${PROCEEDING_PREFIX}${board.proceeding_id}` : `${FILING_PREFIX}${board.filing_id}`;
}

export function readStored(dbPath: string, key: string): StoredGoals | null {
  const [row] = submissionDataQuery(dbPath, "SELECT value FROM db_meta WHERE key = ?", [key]).rows as unknown as { value: string }[];
  if (row === undefined) return null;
  let parsed: StoredGoals;
  try {
    parsed = JSON.parse(row.value) as StoredGoals;
  } catch {
    throw new DataServerError("A board's saved statement of goals is damaged, so it cannot be read", "invalid_board_goal");
  }
  const own = parsed.status === NEEDS_CONSOLIDATION || (parsed.status === null && (parsed.merged ?? []).length > 0) ? [] : [parsed.status];
  if (![...own, ...(parsed.merged ?? []).map((m) => m.status)].every((s) => STATUSES.includes(s as BoardGoalsStatus))) {
    throw new DataServerError("A board's saved statement of goals has a status Probanda does not know", "invalid_board_goal");
  }
  return parsed;
}

/** The key a board's statement of goals is read from: its survivor's. A pre-filing survivor's row
 * outlives its proceeding's first Writing, whose board then reads it until that Writing has its own. */
export function survivorGoalsKey(dbPath: string, board: BoardRef, index: BoardIndex = new BoardIndex(dbPath)): string {
  const survivor = index.survivorOf(board);
  const key = boardGoalsKey(survivor);
  if (!index.inheritsProceeding(survivor) || readStored(dbPath, key) !== null) return key;
  return boardGoalsKey({ filing_id: null, proceeding_id: survivor.proceeding_id });
}

/** The description a board with no statement of goals shows: never a step such as drafting. */
export const NO_GOAL_DESCRIPTION = "Goal not set";

/** The board's one statement of goals, read from its survivor's row. With no statement stored its
 * description is NO_GOAL_DESCRIPTION; with one but no stored description, `title`. A merged board's
 * earlier statements are read only while it needs consolidation, as `to_combine`. */
export function fetchBoardGoals(dbPath: string, board: BoardRef, title: string): BoardGoals {
  const stored = readStored(dbPath, survivorGoalsKey(dbPath, board));
  if (stored === null) return { description: NO_GOAL_DESCRIPTION, statement: null, status: null };
  const goals = { description: stored.description ?? (stored.statement === null ? NO_GOAL_DESCRIPTION : title), statement: stored.statement };
  if (!needsConsolidation(stored)) return { ...goals, status: stored.status };
  return { ...goals, status: NEEDS_CONSOLIDATION, to_combine: (stored.merged ?? []).map((m) => ({ statement: m.statement, status: m.status })) };
}

/** A soft warning, never a refusal: the goal names a drafting step, or its description joins more than one goal. */
export function framingWarning(statement: string | null, description: string | undefined): string | null {
  const step = [statement, description].some((t) => t != null && /\bdraft/i.test(t));
  // Writing titles joined as a merged board's page joins them ("; "), or with " + " or " & ".
  const several = description !== undefined && /;|\s[+&]\s/.test(description);
  if (!step && !several) return null;
  return (
    `${step ? "This goal names a drafting step" : "This description reads as more than one goal"}. A goal is one outcome ` +
    "(an order obtained, a settlement reached, a claim defended), not a document or a step. It is recorded as written; " +
    "tell the practitioner once and let them decide."
  );
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
  /** On a merged board: the 1-based position of the absorbed statement to write, as board_card lists
   * it. Omitted: the board's own statement. */
  merged_index?: number;
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
    const [f] = submissionDataQuery(args.db_path, "SELECT kind FROM filings WHERE id = ?", [id]).rows as unknown as { kind: string }[];
    if (f === undefined) throw new NotFoundError(`${TOOL}: no Writing or Work Board ${id} in ${args.db_path}`, "not_found");
    if (isResearchWriting(f)) throw new ValidationError(`${TOOL}: Writing ${id} is a research result, which has no board and so no goal -- set the goal on its proceeding's board`, "research_writing");
  } else {
    if (submissionDataQuery(args.db_path, "SELECT 1 FROM proceedings WHERE id = ?", [id]).rows.length === 0) {
      throw new NotFoundError("That proceeding is not in this matter's drafting records", "not_found");
    }
    if (fetchBoardFilings(args.db_path, id).length > 0) {
      throw new ValidationError("That proceeding has a Writing, so its own board is no longer drawn -- set the goal on a Writing's Work Board", "proceeding_has_writing");
    }
  }
  const index = new BoardIndex(args.db_path);
  const board: BoardRef = onFiling
    ? { filing_id: id, proceeding_id: index.filings.find((f) => f.id === id)?.proceeding_id ?? 0 }
    : { filing_id: null, proceeding_id: id };
  if (index.absorbed(board)) {
    const s = index.survivorOf(board);
    throw new ValidationError(
      `${TOOL}: ${onFiling ? `Work Board ${id}` : `proceeding ${id}'s board`} is merged into ${s.filing_id === null ? `proceeding ${s.proceeding_id}'s board` : `Work Board ${s.filing_id}`}; set the goal there`,
      "board_merged"
    );
  }
  const key = survivorGoalsKey(args.db_path, board, index);
  const prior = readStored(args.db_path, key);
  const merged = prior?.merged ?? [];
  const at = args.merged_index;
  if (at !== undefined && (!Number.isInteger(at) || at < 1 || at > merged.length)) {
    throw new ValidationError(`${TOOL}.merged_index must be between 1 and ${merged.length}, the board's merged statements`, "invalid_merged_index");
  }
  if (at !== undefined && status === "declined") {
    throw new ValidationError(`${TOOL}: a merged statement is confirmed or inferred, never declined`, "invalid_status");
  }
  const description = args.description ?? (at === undefined ? prior?.description : merged[at - 1].description) ?? null;

  // A filing key stands while its filings row does; a proceeding key while the proceeding has no
  // Writing but research Writings, or while a merge names the proceeding's board as survivor.
  const stale = (
    submissionDataQuery(
      args.db_path,
      `SELECT key FROM db_meta
        WHERE (key GLOB '${FILING_PREFIX}*' AND CAST(substr(key, ${FILING_PREFIX.length + 1}) AS INTEGER) NOT IN (SELECT id FROM filings))
           OR (key GLOB '${PROCEEDING_PREFIX}*' AND CAST(substr(key, ${PROCEEDING_PREFIX.length + 1}) AS INTEGER) NOT IN
                 (SELECT id FROM proceedings p WHERE NOT EXISTS (SELECT 1 FROM filings f WHERE f.proceeding_id = p.id AND f.kind NOT IN (${RESEARCH_WRITING_KINDS_SQL}))))
        ORDER BY key`
    ).rows as unknown as { key: string }[]
  )
    .map((r) => r.key)
    .filter((k) => k !== key && !(k.startsWith(PROCEEDING_PREFIX) && index.proceedingSurvives(Number(k.slice(PROCEEDING_PREFIX.length)))));

  // The board's own statement, keeping any merged ones as history and so holding one goal, or one
  // merged statement in its place.
  const entry =
    `json_object('description', ?, 'statement', ?, 'status', ?, ` +
    `'approved_at', CASE WHEN ? = 'confirmed' THEN ${NOW} END, 'session_token', ?, 'updated_at', ${NOW})`;
  const entryParams = [description, statement, status, status, args.session_token];
  const write =
    at !== undefined
      ? { sql: `json_set(json(?), '$.merged[${at - 1}]', json_set(${entry}, '$.from', ?))`, params: [JSON.stringify(prior), ...entryParams, merged[at - 1].from] }
      : merged.length > 0
        ? { sql: `json_set(${entry}, '$.merged', json(?), '$.consolidated_at', ${NOW})`, params: [...entryParams, JSON.stringify(merged)] }
        : { sql: entry, params: entryParams };
  const written = await submissionDataWriteAll(
    args.db_path,
    [
      { sql: `INSERT OR REPLACE INTO db_meta (key, value) VALUES (?, ${write.sql})`, params: [key, ...write.params], expect_changes: 1 },
      ...(stale.length > 0 ? [{ sql: "DELETE FROM db_meta WHERE key IN (SELECT value FROM json_each(?))", params: [JSON.stringify(stale)] }] : []),
    ],
    env
  );
  if (!written.ok) throw new DataServerError(`${TOOL}: the write did not land (statement ${written.failed}); nothing was written`, "write_failed");
  const whole = readStored(args.db_path, key);
  if (whole === null) throw new DataServerError(`${TOOL}: ${key} is missing after the write`, "write_failed");
  const stored = at === undefined ? whole : (whole.merged as MergedGoal[])[at - 1];

  const label = `${onFiling ? `Work Board ${id}` : `proceeding ${id}'s board`}${at === undefined ? "" : ` (merged statement ${at})`}`;
  const note =
    status === "confirmed"
      ? `The statement of goals on ${label} is recorded as confirmed (approved_at ${stored.approved_at}). Re-render to show it.`
      : status === "inferred"
        ? `The statement of goals on ${label} is recorded as inferred: the session's wording, not confirmed. Re-render to show it.`
        : `The practitioner's decline is recorded on ${label}: no statement is stored. Re-render to show it.`;
  const framing = framingWarning(statement, args.description);
  return {
    key,
    ...(onFiling ? { filing_id: id } : { proceeding_id: id }),
    description: stored.description,
    statement: stored.statement,
    status: status,
    approved_at: stored.approved_at,
    updated_at: stored.updated_at,
    session_wording: status === "inferred",
    stale_keys_removed: stale,
    note: framing === null ? note : `${note} ${framing}`,
    ...(written.warning ? { warning: written.warning } : {}),
  };
}
