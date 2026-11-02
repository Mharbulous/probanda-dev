// A Writing's own folder in the matter's 0. DRAFT folder (spec 2026-10-22 §9, Brahm's decisions).
//
// Each Writing has one folder directly under 0. DRAFT, named after the document: its sanitized title,
// e.g. `0. DRAFT\Notice of Hearing of Application\`. It holds the Writing's mockups (one file each,
// the only copy), their `archive\` folder, its Work Board page and view pages, and the Word and PDF
// deliverables the publish and assemble skills write beside them. No folder or file name carries a
// type's code, a stock type's name or a filing id. The render manifests and the pages' state file are
// in the records folder (render-manifest.ts RECORDS_FOLDER).
//
// Which folder is a Writing's: the one its manifest records, while it exists. A retitle keeps it,
// since the practitioner may keep files of their own there and only file-manager moves those; a folder
// the practitioner renames is found again by its new name. With none recorded, the folder whose name
// is the title, with or without a leading `YYYY-MM-DD ` (a submission round's folder, ADR 0008), or an
// older build's `<code> <title>` folder. Two Writings never share a folder: a name another Writing
// holds gets ` (2)`, ` (3)` and so on after it, in filing order, never an id.
//
// An older build kept the mockups in `<case data>\mockups\Filing <id>\` and wrote a copy into
// `0. DRAFT\<code> <title>\`. moveCaseDataMockups moves that tree into 0. DRAFT once, on the next render
// or bootstrap, and leaves no mockups folder in case data. Everything it moves Probanda wrote.

import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmdirSync, statSync, unlinkSync } from "node:fs";
import { dirname, extname, join } from "node:path";

import { DataServerError } from "../errors.js";
import { submissionDataQuery } from "./backend.js";
import { isJobOnlyBoard } from "./forms/query.js";
import { WORKBOARD_DATA_FILE } from "./forms/render-work-board.js";
import { generalDocumentName } from "./forms/writing-label.js";

export { generalDocumentName };
import {
  draftDirOf,
  LEGACY_MANIFEST_FILE,
  readLegacyManifest,
  readManifest,
  RECORDS_FOLDER,
  recordsDir,
  writeManifest,
  type RenderManifest,
} from "./render-manifest.js";

/** The document type a general Writing's mockup is rendered under (forms.ts). */
export const GENERAL_DOCUMENT_TYPE = "General_writing";


/** The board files an older render wrote beside its mockups or presentation copies: the page under
 * both its names, the support files it was split into before 2026-09-15, and the Markdown board.
 * `Job Board.html` is the page's name before 2026-10-28. */
const OLD_BOARD_FILES = ["Job Board.html", "Work Board.html", "Work Board.html", "Work Board.md", "workboard.css", "workboard.js", WORKBOARD_DATA_FILE];

/** The folder the move puts anything of an older mockups tree that belongs to no Writing. */
const OLDER_MOCKUPS = "Older mockups";

export function sanitizeForPath(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, "_").trim();
}

export function readExistingRevision(filePath: string): number | undefined {
  if (!existsSync(filePath)) return undefined;
  const text = readFileSync(filePath, "utf-8");
  // [ \t]*, not \s* -- "Revision:\s" bundles to the literal substring "n:\s",
  // which the bundle-contract test's host-path scanner (HOST_PATH =
  // /[A-Za-z]:\\|.../) reads as a baked Windows drive path. Not a real path;
  // just avoid a backslash escape directly after "n:" in the source regex.
  // The Work Board carries no YAML frontmatter. Its revision is the first key of its data line, a
  // line of its own inside the page since 2026-09-15 (hence the m flag) and the whole of the sibling
  // workboard-data.js the day before; a board written before the 2026-09-14 local-only design
  // carried it in its header meta line instead, which still identifies an older board as this renderer's own.
  const match =
    text.match(/^Revision:[ \t]*(\d+)/m) ?? text.match(/^window\.WORKBOARD = \{"meta":\{"revision":(\d+)/m) ?? text.match(/data-k="Rev">(\d+)</);
  return match ? Number(match[1]) : undefined;
}


/** What a Writing's folder is named from: its title, its proceeding's style of cause for a folder made
 * while titles ended in it, and the code an older build put before the title, from its stored layout. */
interface FolderRow {
  id: number;
  title: string;
  kind: string;
  layout_snapshot: string | null;
  style_of_cause: string | null;
}

function folderRows(dbPath: string): FolderRow[] {
  return submissionDataQuery(
    dbPath,
    "SELECT f.id, f.title, f.kind, f.layout_snapshot, p.style_of_cause FROM filings f JOIN proceedings p ON p.id = f.proceeding_id ORDER BY f.id",
    []
  ).rows as unknown as FolderRow[];
}

function storedLayoutField(row: FolderRow, field: string): string | null {
  if (row.layout_snapshot === null) return null;
  try {
    const value = (JSON.parse(row.layout_snapshot) as { layout?: Record<string, unknown> }).layout?.[field];
    const bare = typeof value === "object" && value !== null ? (value as { value?: unknown }).value : value;
    return typeof bare === "string" ? bare : null;
  } catch {
    return null;
  }
}

/** The name a document type's file now has, for relabelling an older build's archived copies. */
function documentStem(row: FolderRow, documentType: string, fileName: string): string {
  if (documentType !== GENERAL_DOCUMENT_TYPE) return fileName.replace(/\.[^.]+$/, "");
  const layoutTitle = storedLayoutField(row, "title");
  return sanitizeForPath(layoutTitle === null ? row.title : generalDocumentName(layoutTitle, row.title));
}

const DATE_PREFIX = /^\d{4}-\d{2}-\d{2} /;

/** "own" when `name` is this Writing's folder name, "legacy" when it is an older build's with its
 * type's code, null when it is neither. A leading date is allowed either way. */
function matchOf(name: string, row: FolderRow): "own" | "legacy" | null {
  const rest = name.replace(DATE_PREFIX, "").toLowerCase();
  const titles = [row.title, ...(row.style_of_cause ? [`${row.title} - ${row.style_of_cause}`] : [])].map((t) => sanitizeForPath(t).toLowerCase());
  if (titles.includes(rest)) return "own";
  const code = storedLayoutField(row, "folder_code");
  return code !== null && titles.some((t) => rest === `${code.toLowerCase()} ${t}`) ? "legacy" : null;
}

export interface WritingFolder {
  /** The folder's name, directly under 0. DRAFT. */
  name: string;
  /** An older build's `<code> <title>` folder, kept as it is because it holds a file this renderer did not write. */
  legacy: boolean;
  /** Set when two or more folders could each be this Writing's and none is recorded: their names. */
  ambiguous?: string[];
}

function isDir(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Every Writing's folder in the matter's 0. DRAFT, read-only, by filing id (a Work Board with no Writing
 * has none). One rule for the render, the move and the page write, so they agree on each name.
 */
export function writingFolders(dbPath: string, draft: string = draftDirOf(dbPath)): Map<number, WritingFolder> {
  const rows = folderRows(dbPath).filter((r) => !isJobOnlyBoard(r));
  const taken = new Set<string>([RECORDS_FOLDER.toLowerCase()]);
  const result = new Map<number, WritingFolder>();
  const take = (row: FolderRow, folder: WritingFolder) => {
    result.set(row.id, folder);
    taken.add(folder.name.toLowerCase());
  };
  for (const row of rows) {
    const manifest = readManifest(dbPath, row.id);
    if (manifest !== null && isDir(join(draft, manifest.folder)) && !taken.has(manifest.folder.toLowerCase())) {
      take(row, { name: manifest.folder, legacy: matchOf(manifest.folder, row) === "legacy" });
    }
  }
  const dirs = readdirSync(draft, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
  for (const row of rows.filter((r) => !result.has(r.id))) {
    const candidates = dirs.filter((d) => !taken.has(d.toLowerCase()) && matchOf(d, row) !== null);
    if (candidates.length === 1) {
      take(row, { name: candidates[0], legacy: matchOf(candidates[0], row) === "legacy" });
      continue;
    }
    const base = sanitizeForPath(row.title);
    let name = base;
    for (let n = 2; taken.has(name.toLowerCase()); n++) name = `${base} (${n})`;
    take(row, { name, legacy: false, ...(candidates.length > 1 ? { ambiguous: candidates } : {}) });
  }
  return result;
}

/** A folder may be renamed only when it holds at least one file and only files this renderer writes:
 * a revision-stamped copy or an older board file. */
export function renameable(dir: string): boolean {
  const entries = readdirSync(dir, { withFileTypes: true });
  return entries.length > 0 && entries.every((e) => e.isFile() && (OLD_BOARD_FILES.includes(e.name) || readExistingRevision(join(dir, e.name)) !== undefined));
}

/** The name an older build's `<code> <title>` folder should have: the title, any leading date kept. */
function renamedLegacy(name: string, title: string): string {
  return `${DATE_PREFIX.exec(name)?.[0] ?? ""}${sanitizeForPath(title)}`;
}

/** An older build's `<code> <title>` folder renamed to `<title>` (any leading date kept) when it holds
 * only this renderer's files and the new name is free; otherwise kept as it is. Returns the name. */
function settled(draft: string, title: string, folder: WritingFolder): string {
  if (!folder.legacy) return folder.name;
  const target = renamedLegacy(folder.name, title);
  if (existsSync(join(draft, target)) || !renameable(join(draft, folder.name))) return folder.name;
  renameSync(join(draft, folder.name), join(draft, target));
  return target;
}

/** The Writing's folder a render writes into: its recorded or found folder, an older build's renamed
 * when it can be, else `rename` naming the folder kept and the name it should have. Throws when two
 * or more folders could be its own. */
export function writingFolderForRender(dbPath: string, filingId: number, title: string): { dir: string; rename?: MockupMove } {
  const draft = draftDirOf(dbPath);
  const folder = writingFolders(dbPath, draft).get(filingId);
  if (folder === undefined) throw new DataServerError(`Work Board ${filingId} has no Writing, so it has no folder`, "milestone_only");
  if (folder.ambiguous !== undefined) {
    throw new DataServerError(
      `${folder.ambiguous.length} folders in ${draft} could each be "${title}"'s: ${folder.ambiguous.map((n) => `"${join(draft, n)}"`).join(", ")}. ` +
        "Nothing was written. Choose which one is its folder, then render again naming it.",
      "presentation_dir_ambiguous"
    );
  }
  const name = settled(draft, title, folder);
  const dir = join(draft, name);
  return folder.legacy && name === folder.name ? { dir, rename: { from: dir, to: join(draft, renamedLegacy(name, title)) } } : { dir };
}

// ---------------------------------------------------------------------------------------------
// The move of an older build's case-data mockups tree into 0. DRAFT (spec 2026-10-22 §9).
// ---------------------------------------------------------------------------------------------

export interface MockupMove {
  from: string;
  to: string;
}

/** `name`, or `name (2)`, `(3)` and so on before its extension, whichever is free in `dir`. */
function freeName(dir: string, name: string): string {
  const ext = extname(name);
  const stem = name.slice(0, name.length - ext.length);
  let candidate = name;
  for (let n = 2; existsSync(join(dir, candidate)); n++) candidate = `${stem} (${n})${ext}`;
  return candidate;
}

function moveInto(src: string, dir: string, name: string): string {
  mkdirSync(dir, { recursive: true });
  const target = join(dir, freeName(dir, name));
  renameSync(src, target);
  return target;
}

/** An archived copy's name with an older build's document type label (`General_writing @rev3 ...`)
 * replaced by its document's current name. */
function relabelled(name: string, labels: Map<string, string>): string {
  for (const [type, stem] of labels) {
    if (name.startsWith(`${type} @rev`)) return `${stem}${name.slice(type.length)}`;
  }
  return name;
}

function nowLabel(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}-${pad(d.getMinutes())}`;
}

interface LegacyFolder {
  dir: string;
  manifest: Omit<RenderManifest, "folder"> | null;
}

/** Empties one older mockup folder into the Writing's folder `dir` and removes it. `current` moves its
 * listed files in as the Writing's mockups; otherwise they go to the archive. Its archive follows,
 * relabelled, an older board file is deleted, and any other file goes to the archive as it is named. */
function emptyLegacyFolder(legacy: LegacyFolder, dir: string, row: FolderRow, current: boolean): RenderManifest["files"] {
  const archive = join(dir, "archive");
  const labels = new Map((legacy.manifest?.files ?? []).map((f) => [f.document_type, documentStem(row, f.document_type, f.file_name)]));
  const files: RenderManifest["files"] = [];
  for (const f of legacy.manifest?.files ?? []) {
    const src = join(legacy.dir, f.file_name);
    if (!existsSync(src)) continue;
    const name = `${documentStem(row, f.document_type, f.file_name)}${extname(f.file_name)}`;
    if (!current) {
      moveInto(src, archive, `${labels.get(f.document_type)} @rev${legacy.manifest?.stamp.revision} ${nowLabel()}${extname(f.file_name)}`);
      continue;
    }
    // A presentation copy an older render wrote, under the old name or the new, gives way to the mockup.
    for (const copy of new Set([f.file_name, name])) {
      const path = join(dir, copy);
      if (existsSync(path) && readExistingRevision(path) !== undefined) unlinkSync(path);
    }
    if (existsSync(join(dir, name))) {
      // The practitioner's own file has the name: the mockup goes to the archive, and the next render refuses to overwrite theirs.
      moveInto(src, archive, `${labels.get(f.document_type)} @rev${legacy.manifest?.stamp.revision} ${nowLabel()}${extname(f.file_name)}`);
      continue;
    }
    moveInto(src, dir, name);
    // The strip label is dropped where the name changed, so the page shows the new name until the next render.
    files.push(name === f.file_name ? f : { document_type: f.document_type, file_name: name, sha256: f.sha256 });
  }
  const oldArchive = join(legacy.dir, "archive");
  if (isDir(oldArchive)) {
    for (const e of readdirSync(oldArchive)) moveInto(join(oldArchive, e), archive, relabelled(e, labels));
    rmdirSync(oldArchive);
  }
  for (const e of readdirSync(legacy.dir)) {
    const path = join(legacy.dir, e);
    if (e === LEGACY_MANIFEST_FILE || OLD_BOARD_FILES.includes(e)) unlinkSync(path);
    else moveInto(path, archive, e);
  }
  rmdirSync(legacy.dir);
  return files;
}

/** The later of two folders claiming one filing (#1317): the `Filing <id>` folder, else the higher
 * revision, then the later render. */
function later(a: LegacyFolder, b: LegacyFolder, id: number): boolean {
  const own = (f: LegacyFolder) => f.dir.endsWith(`Filing ${id}`);
  if (own(a) !== own(b)) return own(a);
  const ra = a.manifest?.stamp.revision ?? -1;
  const rb = b.manifest?.stamp.revision ?? -1;
  return ra !== rb ? ra > rb : (a.manifest?.rendered_at ?? "") > (b.manifest?.rendered_at ?? "");
}

/**
 * Moves an older build's `<case data>\mockups\` tree into the matter's 0. DRAFT and removes it (spec
 * 2026-10-22 §9). Each filing's mockups become the only copy in its Writing's folder, renamed where the
 * document's name changed, with their manifest in the records folder; any older folder for the same
 * filing goes to that folder's archive, as do the archived copies, relabelled. The pages' state file
 * goes to the records folder. A folder that belongs to no filing in the database goes whole to
 * `Drafting records\Older mockups\`, so nothing is left behind and nothing is deleted but an older
 * board file and the old manifests. Returns each folder moved. Nothing to move returns at once.
 * A move the sync client refuses throws; the next call resumes, since every step is idempotent.
 */
export function moveCaseDataMockups(dbPath: string): MockupMove[] {
  const root = join(dirname(dbPath), "mockups");
  if (!existsSync(root)) return [];
  const draft = draftDirOf(dbPath);
  const records = recordsDir(dbPath);
  mkdirSync(records, { recursive: true });
  const older = join(records, OLDER_MOCKUPS);
  const rows = new Map(folderRows(dbPath).filter((r) => !isJobOnlyBoard(r)).map((r) => [r.id, r]));
  const moves: MockupMove[] = [];
  const byFiling = new Map<number, LegacyFolder[]>();
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (!entry.isDirectory()) {
      if (entry.name === "matter-pages-state.json") moveInto(path, records, entry.name);
      else if (OLD_BOARD_FILES.includes(entry.name)) unlinkSync(path);
      else moveInto(path, older, entry.name);
      continue;
    }
    const manifest = readLegacyManifest(path);
    const id = manifest?.stamp.filing_id ?? Number(/^Filing (\d+)$/.exec(entry.name)?.[1] ?? NaN);
    if (!rows.has(id)) {
      moves.push({ from: path, to: moveInto(path, older, entry.name) });
      continue;
    }
    byFiling.set(id, [...(byFiling.get(id) ?? []), { dir: path, manifest }]);
  }
  const folders = writingFolders(dbPath, draft);
  for (const [id, found] of byFiling) {
    const row = rows.get(id) as FolderRow;
    const folder = settled(draft, row.title, folders.get(id) as WritingFolder);
    const dir = join(draft, folder);
    mkdirSync(dir, { recursive: true });
    const [current, ...rest] = [...found].sort((a, b) => (later(a, b, id) ? -1 : 1));
    // The others first: their files go to the archive, so the current folder's own are moved last.
    for (const other of rest) {
      emptyLegacyFolder(other, dir, row, false);
      moves.push({ from: other.dir, to: dir });
    }
    const manifest = current.manifest;
    const files = emptyLegacyFolder(current, dir, row, true);
    if (manifest !== null) writeManifest(dbPath, id, { ...manifest, files, folder });
    moves.push({ from: current.dir, to: dir });
  }
  if (readdirSync(root).length > 0) throw new DataServerError(`could not empty ${root}; call again to finish moving it`, "mockups_move_incomplete");
  rmdirSync(root);
  return moves;
}
