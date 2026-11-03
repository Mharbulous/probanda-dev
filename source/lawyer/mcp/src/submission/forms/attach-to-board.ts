// drafting_data__attach_to_board (ADR 0042): one call puts a draft that is no Writing on one Work
// Board. With no proceeding in the matter it creates the forum-less proceeding (ADR 0018) in the same
// transaction; with one board it attaches there; with several it refuses, naming them, until the call
// names one. The row holds the board and the path, never a title, a status or any of the file's text.
// A file already attached stays where it is, so a retry never attaches it twice.

import { existsSync } from "node:fs";
import { basename, dirname, isAbsolute, relative, resolve } from "node:path";

import { DataServerError, ValidationError } from "../../errors.js";
import { type ClientContext } from "./render-context.js";
import { leavesDraftFolder } from "../board-attachments.js";
import { submissionDataQuery, submissionDataWriteAll } from "../backend.js";
import type { MatterDates } from "../matter-dates.js";
import type { MatterTodos } from "../matter-todos.js";
import { BoardIndex } from "./board-members.js";
import { rewritePages, type Pages } from "./complete-job.js";
import { boardAttachmentsHeld, fetchAllFilingsForProceeding, fetchAllProceedings, isResearchWriting } from "./query.js";
import { draftDirOfCaller } from "./render-dirs.js";

const TOOL = "drafting_data__attach_to_board";
const KINDS = ["client_letter", "reply", "opposing_filing"];

export interface AttachToBoardArgs {
  db_path: string;
  kind: string;
  /** The file: absolute, or relative to the matter folder. */
  path: string;
  /** The matter's 0. DRAFT folder from open_session, under which the board's page is rewritten. */
  draft_dir: string;
  /** This session's identity from open_session/bootstrap. Never minted here. */
  session_token: string;
  /** The board, when the matter has several: at most one of these. */
  filing_id?: number;
  proceeding_id?: number;
}

export type AttachToBoardResult = Pages & {
  attachment_id: number;
  proceeding_id: number;
  filing_id: number | null;
  /** The stored path. */
  path: string;
  /** Present when the file was on this board already: nothing was written. */
  already_attached?: true;
  /** Present when this call created the forum-less proceeding. */
  proceeding_created?: true;
  warning?: string;
};

/** A board a draft can be attached to. `attach_filing_id` is the filing_id the row writes: on a proceeding
 * holding only research Writings, a live one of them, since the guard refuses NULL there. */
interface Board {
  filing_id: number | null;
  proceeding_id: number;
  name: string;
  attach_filing_id: number | null;
}

/** Every board of the matter that can take a draft, with no board a merge absorbed. */
function boardsOf(dbPath: string): Board[] {
  const index = new BoardIndex(dbPath);
  const boards = fetchAllProceedings(dbPath).flatMap((p): Board[] => {
    const filings = fetchAllFilingsForProceeding(dbPath, p.id);
    const withBoard = filings.filter((f) => !isResearchWriting(f));
    if (withBoard.length > 0) {
      return withBoard.filter((f) => !f.retired_on).map((f) => ({ filing_id: f.id, proceeding_id: p.id, name: f.title, attach_filing_id: f.id }));
    }
    const research = filings.find((f) => !f.retired_on);
    if (filings.length > 0 && research === undefined) return [];
    const name = [p.forum ?? "No forum yet", p.file_number].filter(Boolean).join(" ");
    return [{ filing_id: null, proceeding_id: p.id, name, attach_filing_id: research?.id ?? null }];
  });
  return boards.filter((b) => !index.absorbed({ filing_id: b.filing_id, proceeding_id: b.proceeding_id }));
}

function named(boards: Board[]): string {
  return boards.map((b) => `"${b.name}" (${b.filing_id === null ? `proceeding_id ${b.proceeding_id}` : `filing_id ${b.filing_id}`})`).join(", ");
}

function chooseBoard(args: AttachToBoardArgs, boards: Board[]): Board {
  const refusal = (why: string, code: string) => new DataServerError(`${why}: ${named(boards)}. Ask the practitioner which, and call again naming it. Nothing was written.`, code, { boards });
  if (args.filing_id !== undefined || args.proceeding_id !== undefined) {
    const board = boards.find((b) => (args.filing_id !== undefined ? b.filing_id === args.filing_id : b.filing_id === null && b.proceeding_id === args.proceeding_id));
    if (board === undefined) throw refusal("That is not a Work Board this matter can attach to. Its boards are", "not_a_board");
    return board;
  }
  if (boards.length === 0) {
    throw new DataServerError("This matter has proceedings but no live Work Board: each one's Writings are retired. Recover a Writing or create a new one, then attach. Nothing was written.", "no_board");
  }
  if (boards.length > 1) throw refusal("This matter has several Work Boards", "several_boards");
  return boards[0];
}

/** drafting_data__attach_to_board. Every refusal writes nothing. */
export async function submissionDataAttachToBoard(
  args: AttachToBoardArgs,
  client: ClientContext = {},
  todos?: MatterTodos,
  dates?: MatterDates,
  env: NodeJS.ProcessEnv = process.env
): Promise<AttachToBoardResult> {
  if (!KINDS.includes(args.kind)) throw new ValidationError(`${TOOL}.kind must be one of ${KINDS.join(", ")}; nothing was written`, "invalid_kind");
  if (typeof args.session_token !== "string" || args.session_token.trim() === "") {
    throw new ValidationError(`${TOOL}.session_token must be the session_token open_session or bootstrap returned`, "invalid_session_token");
  }
  if (args.filing_id !== undefined && args.proceeding_id !== undefined) throw new ValidationError(`${TOOL} takes at most one of filing_id and proceeding_id; nothing was written`, "invalid_board");
  const draft = draftDirOfCaller(args.db_path, args.draft_dir, `${TOOL}.draft_dir`);
  if (!boardAttachmentsHeld(args.db_path)) {
    throw new ValidationError("This matter's drafting records predate board attachments, so nothing was written. Call drafting_forms__open_session to bring them up to date, then attach.", "schema_below_v67");
  }

  // The same confinement and stored form the board reads an attachment by (board-attachments.ts).
  const matterRoot = dirname(draft);
  const file = isAbsolute(args.path) ? resolve(args.path) : resolve(matterRoot, ...String(args.path).split(/[\\/]+/).filter((s) => s !== ""));
  if (leavesDraftFolder(relative(args.kind === "opposing_filing" ? matterRoot : draft, file))) {
    throw new ValidationError(`${TOOL}.path ${args.path} is outside the folder this kind is read from; nothing was written`, "path_outside");
  }
  if (!existsSync(file)) throw new ValidationError(`${TOOL}.path ${args.path}: no file there. Write the file first; nothing was written`, "path_missing");
  const stored = relative(matterRoot, file).replace(/\//g, "\\");

  const attachment = () => submissionDataQuery(args.db_path, "SELECT id, proceeding_id, filing_id FROM board_attachments WHERE path = ?", [stored]).rows[0] as unknown as { id: number; proceeding_id: number; filing_id: number | null } | undefined;
  const pagesOf = (row: { proceeding_id: number; filing_id: number | null }) => rewritePages({ ...args, draft_dir: draft }, row, client, todos, dates);

  const existing = attachment();
  if (existing !== undefined) {
    return { attachment_id: existing.id, proceeding_id: existing.proceeding_id, filing_id: existing.filing_id, path: stored, already_attached: true, ...pagesOf(existing) };
  }

  const noProceeding = fetchAllProceedings(args.db_path).length === 0;
  const board = noProceeding ? undefined : chooseBoard(args, boardsOf(args.db_path));
  const written = await submissionDataWriteAll(
    args.db_path,
    [
      // ADR 0018: a proceeding with no forum yet. The WHERE re-checks inside the transaction, so of two sessions attaching at once one creates it and both land on it.
      ...(noProceeding ? [{ sql: "INSERT INTO proceedings (matter_reference, forum) SELECT ?, NULL WHERE NOT EXISTS (SELECT 1 FROM proceedings)", params: [basename(matterRoot)] }] : []),
      {
        sql: "INSERT INTO board_attachments (proceeding_id, filing_id, path, kind, attached_on) VALUES (COALESCE(?, (SELECT MIN(id) FROM proceedings)), ?, ?, ?, date('now', 'localtime'))",
        params: [board?.proceeding_id ?? null, board?.attach_filing_id ?? null, stored, args.kind],
        expect_changes: 1,
      },
    ],
    env
  );
  if (!written.ok) throw new DataServerError(`${TOOL}: the write did not land (statement ${written.failed}); nothing was written`, "write_failed");

  const row = attachment();
  if (row === undefined) throw new DataServerError(`${TOOL}: the write reported success but no row holds ${stored}`, "write_failed");
  return {
    attachment_id: row.id,
    proceeding_id: row.proceeding_id,
    filing_id: row.filing_id,
    path: stored,
    ...(noProceeding ? { proceeding_created: true as const } : {}),
    ...pagesOf(row),
    ...(written.warning ? { warning: written.warning } : {}),
  };
}
