// Which of a Milestone's thumbnails the practitioner has seen, most recently first: one db_meta row per
// board, never a table of its own. Key `board_viewed:filing:<id>` or `board_viewed:proceeding:<id>`,
// by the board's survivor (board-members.ts). Value: a JSON array of strip item keys, most recently
// viewed first: `view:<page name>` for a view page, `doc:<filing id>:<file name>` for one of a Writing's
// documents, by its render manifest's file name. It holds an order and no time. A view is a session
// presenting the view page or the mockup as a file card, which drafting_data__record_viewed records.
// db_meta carries no revision trigger, so a write here moves no revision. The Milestone page draws the
// viewed items first, in this order, then the rest in their own order (matter-pages.ts).
//
// A retitle that renames a document's file drops its key, so its tile reverts to never viewed. On a
// merged board (docs/ADRs/0010) the survivor's row applies; the absorbed board's row is ignored.

import { basename, dirname, join, resolve } from "node:path";

import { DataServerError, ValidationError } from "../../errors.js";
import { submissionDataQuery, submissionDataWriteAll } from "../backend.js";
import { draftDirOf, manifestDir, readManifest } from "../render-manifest.js";
import { VIEW_PAGES, viewPageFile } from "../view-pages.js";
import { writingFolders } from "../writing-folder.js";
import { BoardIndex, boardKey, type BoardRef } from "./board-members.js";
import { isJobOnlyBoard, type FilingRow } from "./query.js";

const TOOL = "drafting_data__record_viewed";

/** The db_meta key of a board's viewed order. */
export function viewedKey(board: BoardRef): string {
  return `board_viewed:${boardKey(board)}`;
}

/** A view page's strip item key. */
export function viewItemKey(pageName: string): string {
  return `view:${pageName}`;
}

/** A Writing document's strip item key. */
export function docItemKey(filingId: number, fileName: string): string {
  return `doc:${filingId}:${fileName}`;
}

/** The board's viewed item keys, most recently viewed first; none when no row is stored. `board` is a survivor. */
export function readViewed(dbPath: string, board: BoardRef): string[] {
  const key = viewedKey(board);
  const [row] = submissionDataQuery(dbPath, "SELECT value FROM db_meta WHERE key = ?", [key]).rows as unknown as { value: string }[];
  if (row === undefined) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(row.value);
  } catch {
    parsed = undefined;
  }
  if (!Array.isArray(parsed) || !parsed.every((k) => typeof k === "string")) {
    throw new DataServerError("A board's saved viewing order is damaged, so it cannot be read", "invalid_board_viewed");
  }
  return parsed as string[];
}

/** The strip in its drawn order: the viewed items by their place in `viewed`, then the never-viewed
 * ones in the order given, each marked whether it was ever viewed. */
export function orderStrip<T extends { key: string }>(items: T[], viewed: string[]): (T & { viewed: boolean })[] {
  const at = (item: T) => viewed.indexOf(item.key);
  return [
    ...items.filter((i) => at(i) >= 0).sort((a, b) => at(a) - at(b)).map((i) => ({ ...i, viewed: true })),
    ...items.filter((i) => at(i) < 0).map((i) => ({ ...i, viewed: false })),
  ];
}

/** One thumbnail on a board's strip: its board (a survivor), item key, file name and the folder the
 * file is written to: a Writing's own folder, or the draft folder's top for a board with no Writing. */
interface StripTarget {
  board: BoardRef;
  key: string;
  file: string;
  dir: string;
}

/** Whether `path` sits in the target's folder. */
function inFolderOf(t: StripTarget, path: string): boolean {
  return resolve(t.dir).toLowerCase() === resolve(dirname(path)).toLowerCase();
}

/** Every thumbnail on every board's strip, as the pages draw them: each live Writing's documents from
 * its manifest, and each board holding a live Writing's view pages. */
function stripTargets(dbPath: string): StripTarget[] {
  const index = new BoardIndex(dbPath);
  const filings = submissionDataQuery(dbPath, "SELECT id, proceeding_id, kind, title, retired_on FROM filings ORDER BY id").rows as unknown as Pick<
    FilingRow,
    "id" | "proceeding_id" | "kind" | "title" | "retired_on"
  >[];
  const targets: StripTarget[] = [];
  const boards = new Map<string, BoardRef>();
  for (const f of filings.filter((x) => !x.retired_on && !isJobOnlyBoard(x))) {
    const board = index.survivorOf({ filing_id: f.id, proceeding_id: f.proceeding_id });
    boards.set(boardKey(board), board);
    const manifest = readManifest(dbPath, f.id);
    if (manifest === null) continue;
    const dir = manifestDir(dbPath, manifest);
    for (const doc of manifest.files) targets.push({ board, key: docItemKey(f.id, doc.file_name), file: doc.file_name, dir });
  }
  const draft = draftDirOf(dbPath);
  const folders = writingFolders(dbPath, draft);
  for (const board of boards.values()) {
    const folder = board.filing_id === null ? undefined : folders.get(board.filing_id)?.name;
    for (const page of VIEW_PAGES) {
      const file = join(draft, viewPageFile(page, board, folder));
      targets.push({ board, key: viewItemKey(page.name), file: basename(file), dir: dirname(file) });
    }
  }
  return targets;
}

export interface RecordViewedArgs {
  db_path: string;
  /** The paths just presented as file cards, in the order presented. */
  paths: string[];
}

export interface RecordViewedResult {
  /** The db_meta keys written, one per board. */
  keys: string[];
  note: string;
  warning?: string;
}

/** drafting_data__record_viewed. Matches each path by its file name to a thumbnail, by its folder too
 * when several Writings' documents share the name, and moves it to the front of its board's order, so
 * the last path ends up first. Every refusal writes nothing. */
export async function submissionDataRecordViewed(args: RecordViewedArgs, env: NodeJS.ProcessEnv = process.env): Promise<RecordViewedResult> {
  if (!Array.isArray(args.paths) || args.paths.length === 0 || !args.paths.every((p) => typeof p === "string" && p.trim() !== "")) {
    throw new ValidationError(`${TOOL}.paths must list the presented paths, none blank`, "invalid_paths");
  }
  const targets = stripTargets(args.db_path);
  const matched = args.paths.map((path) => {
    const name = (path.split(/[\\/]/).pop() as string).toLowerCase();
    let hits = targets.filter((t) => t.file.toLowerCase() === name);
    if (hits.length > 1) hits = hits.filter((t) => inFolderOf(t, path));
    if (hits.length !== 1 && targets.some((t) => t.file.toLowerCase() === name)) {
      throw new ValidationError(`${TOOL}: several thumbnails are named ${name} and its folder holds none of them; pass the path in its Writing's own folder. Nothing was written.`, "ambiguous_path");
    }
    if (hits.length === 0) {
      throw new ValidationError(`${TOOL}: ${path} is no thumbnail on a Milestone: neither a view page nor a Writing's mockup. Nothing was written.`, "not_a_strip_item");
    }
    return hits[0];
  });

  const lists = new Map<string, { board: BoardRef; keys: string[] }>();
  for (const t of matched) {
    const entry = lists.get(boardKey(t.board)) ?? { board: t.board, keys: readViewed(args.db_path, t.board) };
    entry.keys = [t.key, ...entry.keys.filter((k) => k !== t.key)];
    lists.set(boardKey(t.board), entry);
  }
  // A key no longer on its board's strip (a renamed document, a retired Writing) is dropped.
  const rows = [...lists.values()].map(({ board, keys }) => {
    const current = new Set(targets.filter((t) => boardKey(t.board) === boardKey(board)).map((t) => t.key));
    return { key: viewedKey(board), value: JSON.stringify(keys.filter((k) => current.has(k))) };
  });
  const written = await submissionDataWriteAll(
    args.db_path,
    rows.map((r) => ({ sql: "INSERT OR REPLACE INTO db_meta (key, value) VALUES (?, ?)", params: [r.key, r.value], expect_changes: 1 })),
    env
  );
  if (!written.ok) throw new DataServerError(`${TOOL}: the write did not land (statement ${written.failed}); nothing was written`, "write_failed");
  return {
    keys: rows.map((r) => r.key),
    note: "Recorded. The Milestone shows the new order the next time its page is written; this call does not rewrite it.",
    ...(written.warning ? { warning: written.warning } : {}),
  };
}
