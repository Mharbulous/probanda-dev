// Host-side filing of downloaded case law (planning/research-paralegal-tool-narrowing.md).
//
// Chrome writes to the OS Downloads folder; research-paralegal must get each file into an
// existing `6. LAW\<issue>\` folder of a matter. Four of these tools do that on the host, so the
// agent needs no shell and no Downloads folder grant. Names and metadata only -- nothing here
// reads a downloaded file's content, and `fileDownload` is structurally not a generic mover:
// the source is a bare filename inside Downloads, the destination a realpath-resolved folder
// carrying a `6. LAW` segment. The fifth, `saveAnswer` (#1406), writes caller-supplied text, or the
// bytes of a file in the same matter's research-agent scratchpad, as a new `.md` file in such a
// folder and never overwrites. The sixth, `fileFetched`, files the bytes
// of a page `sources__fetch` already fetched (read back from the fetch memo, never re-requested)
// into such a folder, never overwriting, and appends its manifest record in the same call. The
// seventh, `writeScratch`, writes the research agent's internal notes as a new `.md` file in the
// matter's `0. DRAFT*\AI Scratchpad\research-agent\` folder, never overwriting. The eighth,
// `lawFolderText`, writes the text of each file in a `6. LAW` folder into that scratchpad, so an
// audit agent that cannot open the folder, a PDF, a `.docx` or a `.doc` still reads it; the folder
// itself is only read.

import { createHash } from "node:crypto";
import {
  appendFileSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { win32 as pathWin32 } from "node:path";

import { DataServerError } from "../errors.js";
import { checkCoverageLine } from "./coverage-line.js";
import { htmlBlocks, sourcesFetcher, type SourceFetcher } from "../sources/fetch.js";
import { findDraftDir, validateMatterRoot } from "./matter-root.js";
import { canonicalRoot } from "./scope.js";
import { extractText } from "./text-extract.js";

const LAW_SEGMENT = "6. law";
// Belt-and-braces: a `6. LAW` folder never sits under a firewall zone, so the segment rule above
// already excludes these. Keep this check anyway -- do not delete the segment rule believing
// this one covers it; it does not (it says nothing about where the folder is).
const PROTECTED_SEGMENTS = new Set(["privileged", "disclosed"]);
const IN_PROGRESS_EXTENSIONS = new Set([".crdownload", ".tmp", ".partial"]);
const MANIFEST = "case-download-manifest.json";
// The research agent's scratchpad, under the matter's 0. DRAFT folder (practitioner's decision, 2026-10-05).
const SCRATCH_SUBFOLDERS = ["AI Scratchpad", "research-agent"];
// Each attempt re-scans the folder, so this bound is only reached when something keeps creating
// the very name we picked; fail loudly then rather than loop.
const MAX_SAVE_ATTEMPTS = 100;
// lawFolderText's folder under the scratchpad. It must never be named `6. LAW`, or the filing tools
// would accept it as a law folder.
const LAW_TEXT_SUBFOLDER = "law-text";

export interface DownloadEntry {
  filename: string;
  mtime: string;
  bytes: number;
  in_progress: boolean;
}

export function downloadsDir(env: NodeJS.ProcessEnv = process.env): string {
  const probe = env.COCLERK_DOWNLOADS_DIR || pathWin32.join(homedir(), "Downloads");
  const dir = canonicalRoot(probe, `Downloads folder not found at ${probe}`, "downloads_missing");
  if (!statSync(dir).isDirectory()) {
    throw new DataServerError(`Downloads path is not a folder: ${probe}`, "downloads_missing");
  }
  return dir;
}

export function listDownloads(
  sinceMtime?: string,
  filename?: string,
  env: NodeJS.ProcessEnv = process.env,
  now = new Date()
): { now: string; downloads_dir: string; entries: DownloadEntry[] } {
  const dir = downloadsDir(env);
  const since = sinceMtime === undefined ? undefined : Date.parse(sinceMtime);
  if (since !== undefined && Number.isNaN(since)) {
    throw new DataServerError(`since_mtime is not an ISO timestamp: ${sinceMtime}`, "invalid_argument");
  }
  const entries: DownloadEntry[] = [];
  for (const name of readdirSync(dir)) {
    if (filename !== undefined && name !== filename) continue;
    const stat = statSync(pathWin32.join(dir, name));
    if (!stat.isFile()) continue;
    if (since !== undefined && stat.mtimeMs < since) continue;
    entries.push({
      filename: name,
      mtime: stat.mtime.toISOString(),
      bytes: stat.size,
      in_progress: IN_PROGRESS_EXTENSIONS.has(pathWin32.extname(name).toLowerCase()),
    });
  }
  entries.sort((a, b) => (a.mtime < b.mtime ? 1 : a.mtime > b.mtime ? -1 : 0));
  return { now: now.toISOString(), downloads_dir: dir, entries };
}

export function listLawFolder(destinationDir: string): { entries: Array<{ filename: string; bytes: number }> } {
  const dir = resolveLawDir(destinationDir);
  const entries = readdirSync(dir)
    .map((name) => ({ name, stat: statSync(pathWin32.join(dir, name)) }))
    .filter(({ stat }) => stat.isFile())
    .map(({ name, stat }) => ({ filename: name, bytes: stat.size }));
  return { entries };
}

export function fileDownload(
  destinationDir: string,
  sourceFilename: string,
  destinationFilename?: string,
  env: NodeJS.ProcessEnv = process.env
): { path: string; bytes: number } {
  const dir = resolveLawDir(destinationDir);
  assertBareFilename(sourceFilename, "source_filename");
  const destName = destinationFilename ?? sourceFilename;
  assertBareFilename(destName, "destination_filename");

  const source = pathWin32.join(downloadsDir(env), sourceFilename);
  if (!existsSync(source) || !statSync(source).isFile()) {
    throw new DataServerError(`no such file in Downloads: ${sourceFilename}`, "not_found");
  }
  if (IN_PROGRESS_EXTENSIONS.has(pathWin32.extname(sourceFilename).toLowerCase())) {
    throw new DataServerError(`download still in progress: ${sourceFilename}`, "in_progress");
  }
  const dest = pathWin32.join(dir, destName);
  if (existsSync(dest)) {
    throw new DataServerError(`destination filename collision: ${dest}`, "dest_exists");
  }

  const bytes = statSync(source).size;
  try {
    renameSync(source, dest);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "EXDEV") throw err;
    copyFileSync(source, dest);
    unlinkSync(source);
  }
  return { path: dest, bytes };
}

export function appendManifest(destinationDir: string, record: unknown): { path: string; records: number } {
  const dir = resolveLawDir(destinationDir);
  if (record === null || typeof record !== "object" || Array.isArray(record)) {
    throw new DataServerError("record must be a JSON object", "invalid_argument");
  }
  const path = pathWin32.join(dir, MANIFEST);
  appendFileSync(path, JSON.stringify(record) + "\n", "utf-8");
  const records = readFileSync(path, "utf-8").split("\n").filter((line) => line.trim() !== "").length;
  return { path, records };
}

/**
 * Save `text` byte-for-byte as a new file named `filename` in a `6. LAW` folder. If that name is
 * taken, the file is `<stem> vN.md`, N one above the highest version present (the bare name counts
 * as v1). The exclusive create (`wx`) is what makes this race-safe: a name another session took
 * between the scan and the write fails EEXIST and the next attempt re-scans. A missing destination
 * is created when its parent is already in a `6. LAW` tree -- the final folder only.
 *
 * Exactly one of `text` and `fromScratch` is given. `fromScratch` is a file `writeScratch` wrote: its
 * real path must sit directly in the research-agent scratchpad of the matter that owns the
 * destination's `6. LAW` tree, and its bytes are copied unchanged. The scratch file is kept.
 */
export function saveAnswer(
  destinationDir: string,
  filename: string,
  text?: string,
  fromScratch?: string
): { path: string; filename: string; bytes: number; created_dir: boolean; sha256: string } {
  assertBareFilename(filename, "filename");
  const ext = pathWin32.extname(filename);
  if (ext.toLowerCase() !== ".md") {
    throw new DataServerError(`filename must end in .md: ${filename}`, "invalid_filename");
  }
  if ((text === undefined) === (fromScratch === undefined)) {
    throw new DataServerError("pass exactly one of text and from_scratch", "invalid_argument");
  }
  let body: Buffer;
  if (fromScratch !== undefined) {
    body = scratchBytes(destinationDir, fromScratch);
  } else {
    if (typeof text !== "string" || text.length === 0) {
      throw new DataServerError("text must be a non-empty string", "invalid_argument");
    }
    body = Buffer.from(text, "utf-8");
  }
  const { dir, created } = resolveOrCreateLawDir(destinationDir);
  const saved = writeNewVersion(dir, filename, body);
  const sha256 = createHash("sha256").update(body).digest("hex");
  return { path: saved.path, filename: saved.filename, bytes: body.length, created_dir: created, sha256 };
}

/** The bytes of `fromScratch`, refused unless its real path is a non-empty file directly in the
 * research-agent scratchpad of the matter owning `destinationDir`'s `6. LAW` tree. Creates nothing. */
function scratchBytes(destinationDir: string, fromScratch: string): Buffer {
  if (typeof fromScratch !== "string" || !pathWin32.isAbsolute(fromScratch)) {
    throw new DataServerError(`from_scratch must be the absolute path write_scratch returned: ${fromScratch}`, "invalid_path");
  }
  // The destination may be a final folder still to be created; its parent then anchors the matter.
  let law = existsSync(destinationDir) ? resolveLawDir(destinationDir) : resolveLawDir(pathWin32.dirname(destinationDir));
  while (pathWin32.basename(law).toLowerCase() !== LAW_SEGMENT) law = pathWin32.dirname(law);
  const root = validateMatterRoot(pathWin32.dirname(law));
  const draft = findDraftDir(root);
  if (draft === undefined) {
    throw new DataServerError(`${root} has no 0. DRAFT folder, so it has no scratchpad`, "draft_dir_missing");
  }
  const scratchDir = pathWin32.join(draft, ...SCRATCH_SUBFOLDERS);
  const realScratchDir = canonicalRoot(scratchDir, `the matter has no scratchpad folder: ${scratchDir}`, "not_scratch");
  assertUnprotected(realScratchDir);
  const source = canonicalRoot(fromScratch, `from_scratch not found: ${fromScratch}`, "not_found");
  if (pathWin32.dirname(source).toLowerCase() !== realScratchDir.toLowerCase()) {
    throw new DataServerError(`from_scratch is not in this matter's scratchpad ${realScratchDir}: ${source}`, "not_scratch");
  }
  if (!statSync(source).isFile()) {
    throw new DataServerError(`from_scratch is not a file: ${source}`, "not_found");
  }
  const body = readFileSync(source);
  if (body.length === 0) {
    throw new DataServerError(`from_scratch is empty: ${source}`, "invalid_argument");
  }
  return body;
}

/**
 * Save `text` byte-for-byte as a new `.md` file in `<matter root>\<its one 0. DRAFT* folder>\AI
 * Scratchpad\research-agent\`, the research agent's internal notes. `AI Scratchpad` and
 * `research-agent` are created when absent; the 0. DRAFT folder never is. A draft folder whose real
 * path is in a privileged or disclosed tree is refused, the test resolveDraftDir makes. Never
 * overwrites: a taken name gets the next " vN", as saveAnswer does. With `kind` "research-notes" the
 * notes' coverage line must match its fixed shape (checkCoverageLine), or nothing is written.
 */
export function writeScratch(
  matterRoot: string,
  filename: string,
  text: string,
  kind?: string
): { path: string; filename: string; bytes: number; created_dir: boolean } {
  assertBareFilename(filename, "filename");
  if (pathWin32.extname(filename).toLowerCase() !== ".md") {
    throw new DataServerError(`filename must end in .md: ${filename}`, "invalid_filename");
  }
  if (typeof text !== "string" || text.length === 0) {
    throw new DataServerError("text must be a non-empty string", "invalid_argument");
  }
  if (kind !== undefined && kind !== "research-notes") {
    throw new DataServerError(`kind must be "research-notes" when given: ${kind}`, "invalid_argument");
  }
  if (kind === "research-notes") checkCoverageLine(text);
  const { dir, created } = researchScratchDir(validateMatterRoot(matterRoot));
  const body = Buffer.from(text, "utf-8");
  const saved = writeNewVersion(dir, filename, body);
  return { path: saved.path, filename: saved.filename, bytes: body.length, created_dir: created };
}

/** `<root>\<its one 0. DRAFT* folder>\AI Scratchpad\research-agent\`, creating the last two folders. */
function researchScratchDir(root: string): { dir: string; created: boolean } {
  const found = findDraftDir(root);
  if (found === undefined) {
    throw new DataServerError(`${root} has no 0. DRAFT folder; the scratchpad lives in it`, "draft_dir_missing");
  }
  const draft = canonicalRoot(found, `the 0. DRAFT folder does not resolve: ${found}`, "draft_dir_missing");
  assertUnprotected(draft);
  let dir = draft;
  let created = false;
  for (const name of SCRATCH_SUBFOLDERS) {
    dir = pathWin32.join(dir, name);
    try {
      mkdirSync(dir);
      created = true;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
    }
    // A subfolder that already existed may be a junction: its real path is held to the same test
    // before anything is created or written beneath it.
    assertUnprotected(canonicalRoot(dir, `scratchpad folder does not resolve: ${dir}`, "not_found"));
  }
  return { dir, created };
}

export interface LawTextRow {
  file: string;
  text_path: string | null;
  bytes: number;
  method?: "text" | "copy";
  status: "ok" | "unread";
  reason?: string;
}

/**
 * Write the text of every file in an existing `6. LAW` folder of `matterRoot` as `<file>.txt` under
 * the research agent's scratchpad, in `law-text\<the folder's path below 6. LAW>\`, replacing what an
 * earlier call wrote there. The `6. LAW` folder is only read. Each file goes through extractText
 * (./text-extract.ts), in the server with no host Python, one file at a time, so one broken file
 * cannot sink the rest. A file that yields no usable text is `unread` with extractText's reason and
 * gets no text file.
 */
export async function lawFolderText(
  matterRoot: string,
  destinationDir: string
): Promise<{ out_dir: string; files: LawTextRow[] }> {
  const root = validateMatterRoot(matterRoot);
  const law = resolveLawDir(destinationDir);
  if (!law.toLowerCase().startsWith(root.toLowerCase() + "\\")) {
    throw new DataServerError(`destination_dir is not in this matter: ${law}`, "not_in_matter");
  }
  const segments = law.split(/[\\/]+/);
  const below = segments.slice(segments.findIndex((s) => s.toLowerCase() === LAW_SEGMENT) + 1);
  let outDir = researchScratchDir(root).dir;
  for (const name of [LAW_TEXT_SUBFOLDER, ...below]) {
    outDir = pathWin32.join(outDir, name);
    mkdirSync(outDir, { recursive: true });
    // As in researchScratchDir: an existing folder may be a junction, so its real path is tested
    // before anything is created beneath it.
    assertUnprotected(canonicalRoot(outDir, `law-text folder does not resolve: ${outDir}`, "not_found"));
  }

  const files = readdirSync(law)
    .filter((name) => statSync(pathWin32.join(law, name)).isFile())
    .sort();
  const rows: LawTextRow[] = [];
  for (const file of files) {
    const read = await extractText(pathWin32.join(law, file));
    if (read.status === "unread") {
      rows.push({ file, text_path: null, bytes: 0, status: "unread", reason: read.reason });
      continue;
    }
    const textPath = pathWin32.join(outDir, `${file}.txt`);
    const body = Buffer.from(read.text, "utf-8");
    writeFileSync(textPath, body);
    rows.push({ file, text_path: textPath, bytes: body.length, method: read.method, status: "ok" });
  }
  return { out_dir: outDir, files: rows };
}

function assertUnprotected(realDir: string): void {
  if (realDir.split(/[\\/]+/).some((s) => PROTECTED_SEGMENTS.has(s.toLowerCase()))) {
    throw new DataServerError(`the scratchpad would be inside a privileged/disclosed tree: ${realDir}`, "protected");
  }
}

// The fields a fileFetched caller supplies; the runtime fills every other manifest field.
const FETCHED_RECORD_FIELDS = ["citation", "title", "kind", "jurisdiction", "official", "currency_marker"];

export interface FileFetchedSeams {
  /** Tests only. Production always reads the memo of the runtime's one fetcher. */
  fetcher?: SourceFetcher;
}

/**
 * File a page `sources__fetch` already fetched into an existing `6. LAW` folder and append its
 * manifest record, in one call so the two cannot drift apart. The bytes are the fetch memo's for
 * `url` (the string passed to `sources__fetch`): the host guard has always run, and nothing is
 * requested again. No memo, or one past its 24 hours, is refused `not_fetched`. An HTML page is
 * written as `.md`, a front matter header and then the page text one block per line, the whole
 * page (the 200 KB cut applies only to what `sources__fetch` returns). A PDF is written as its own
 * bytes. `filename` must end in the extension of what was fetched. Never overwrites: a taken name
 * gets the next " vN", as saveAnswer does.
 */
export function fileFetched(
  url: string,
  destinationDir: string,
  filename: string,
  record: unknown,
  seams: FileFetchedSeams = {},
  now = new Date()
): {
  path: string;
  filename: string;
  bytes: number;
  record: Record<string, unknown>;
  manifest: { path: string; records: number };
} {
  if (typeof url !== "string" || url === "") {
    throw new DataServerError("url must be the non-empty URL passed to sources__fetch", "invalid_argument");
  }
  assertBareFilename(filename, "filename");
  const fields = fetchedRecordFields(record);
  const dir = resolveLawDir(destinationDir);
  const fetched = (seams.fetcher ?? sourcesFetcher).memoized(url);
  if (fetched === null || fetched === "expired") {
    const why = fetched === null ? "was never fetched in this server process" : "was fetched more than 24 hours ago";
    throw new DataServerError(`${url} ${why}; fetch it with sources__fetch first`, "not_fetched");
  }
  const pdf = fetched.bytes.subarray(0, 5).toString("latin1") === "%PDF-";
  const ext = pdf ? ".pdf" : ".md";
  if (pathWin32.extname(filename).toLowerCase() !== ext) {
    throw new DataServerError(
      `filename must end in ${ext}, because ${fetched.final_url} returned ${pdf ? "a PDF" : "an HTML page"}: ${filename}`,
      "invalid_filename"
    );
  }

  const fetchedAt = now.toISOString();
  let body = fetched.bytes;
  if (!pdf) {
    const header = [
      "---",
      `url: ${JSON.stringify(fetched.url)}`,
      `final_url: ${JSON.stringify(fetched.final_url)}`,
      `sha256: ${JSON.stringify(fetched.sha256)}`,
      `fetched_at: ${JSON.stringify(fetchedAt)}`,
      `currency_marker: ${JSON.stringify(fields.currency_marker)}`,
      "---",
      "",
    ].join("\n");
    body = Buffer.from(header + htmlBlocks(fetched.bytes.toString("utf-8")).join("\n") + "\n", "utf-8");
  }
  const saved = writeNewVersion(dir, filename, body);
  const manifestRecord = {
    citation: fields.citation,
    title: fields.title,
    kind: fields.kind,
    jurisdiction: fields.jurisdiction,
    status: "downloaded",
    source: "official-publisher",
    official: fields.official,
    publisher_host: new URL(fetched.final_url).hostname,
    url: fetched.url,
    final_url: fetched.final_url,
    sha256: fetched.sha256,
    filename: saved.filename,
    path: saved.path,
    fetched_at: fetchedAt,
    currency_marker: fields.currency_marker,
  };
  const manifest = appendManifest(dir, manifestRecord);
  return { path: saved.path, filename: saved.filename, bytes: body.length, record: manifestRecord, manifest };
}

function fetchedRecordFields(record: unknown): {
  citation: string | null;
  title: string;
  kind: string;
  jurisdiction: string;
  official: boolean;
  currency_marker: string;
} {
  if (record === null || typeof record !== "object" || Array.isArray(record)) {
    throw new DataServerError("record must be a JSON object", "invalid_argument");
  }
  const r = record as Record<string, unknown>;
  const extra = Object.keys(r).filter((key) => !FETCHED_RECORD_FIELDS.includes(key));
  if (extra.length > 0) {
    throw new DataServerError(
      `record may carry only ${FETCHED_RECORD_FIELDS.join(", ")}; the runtime fills the rest. Refused: ${extra.join(", ")}`,
      "invalid_argument"
    );
  }
  for (const key of ["title", "kind", "jurisdiction", "currency_marker"]) {
    if (!filledString(r[key])) throw new DataServerError(`record.${key} must be a non-empty string`, "invalid_argument");
  }
  if (r.citation !== undefined && r.citation !== null && !filledString(r.citation)) {
    throw new DataServerError("record.citation must be a non-empty string when given", "invalid_argument");
  }
  if (typeof r.official !== "boolean") {
    throw new DataServerError("record.official must be true or false", "invalid_argument");
  }
  return {
    citation: (r.citation as string | undefined) ?? null,
    title: r.title as string,
    kind: r.kind as string,
    jurisdiction: r.jurisdiction as string,
    official: r.official,
    currency_marker: r.currency_marker as string,
  };
}

function filledString(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

/**
 * Write `body` as a new file named `filename` in `dir`. If that name is taken, the file is
 * `<stem> vN<ext>`, N one above the highest version present (the bare name counts as v1). The
 * exclusive create (`wx`) is what makes this race-safe: a name another session took between the
 * scan and the write fails EEXIST and the next attempt re-scans.
 */
function writeNewVersion(dir: string, filename: string, body: Buffer): { path: string; filename: string } {
  const ext = pathWin32.extname(filename);
  const stem = filename.slice(0, -ext.length);
  for (let attempt = 0; attempt < MAX_SAVE_ATTEMPTS; attempt++) {
    const name = nextVersionName(dir, stem, ext);
    const path = pathWin32.join(dir, name);
    try {
      writeFileSync(path, body, { flag: "wx" });
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "EEXIST") continue;
      throw err;
    }
    return { path, filename: name };
  }
  throw new DataServerError(
    `no free version of ${filename} in ${dir} after ${MAX_SAVE_ATTEMPTS} attempts`,
    "dest_exists"
  );
}

function nextVersionName(dir: string, stem: string, ext: string): string {
  const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const version = new RegExp(`^${escape(stem)}(?: v(\\d+))?${escape(ext)}$`, "i");
  let highest = 0;
  for (const name of readdirSync(dir)) {
    const match = version.exec(name);
    if (match) highest = Math.max(highest, match[1] === undefined ? 1 : Number(match[1]));
  }
  return highest === 0 ? `${stem}${ext}` : `${stem} v${highest + 1}${ext}`;
}

function resolveOrCreateLawDir(destinationDir: string): { dir: string; created: boolean } {
  try {
    return { dir: resolveLawDir(destinationDir), created: false };
  } catch (err) {
    if ((err as DataServerError).code !== "not_found" || existsSync(destinationDir)) throw err;
  }
  const parent = resolveLawDir(pathWin32.dirname(destinationDir));
  if (PROTECTED_SEGMENTS.has(pathWin32.basename(destinationDir).toLowerCase())) {
    throw new DataServerError(`destination_dir is inside a privileged/disclosed tree: ${destinationDir}`, "protected");
  }
  let created = true;
  try {
    mkdirSync(pathWin32.join(parent, pathWin32.basename(destinationDir)));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
    created = false;
  }
  return { dir: resolveLawDir(destinationDir), created };
}

/**
 * The confinement invariant. The destination is caller-supplied and absolute; realpath makes it
 * exist and collapses `..`, junctions and 8.3 names; then the canonical path must carry a segment
 * exactly `6. LAW` (segment equality, never a substring -- `6. LAW junk` fails, and a junction *at*
 * `6. LAW` loses the segment under realpath).
 */
export function resolveLawDir(destinationDir: string): string {
  if (typeof destinationDir !== "string" || !pathWin32.isAbsolute(destinationDir)) {
    throw new DataServerError(`destination_dir must be an absolute host path: ${destinationDir}`, "invalid_path");
  }
  const dir = canonicalRoot(destinationDir, `destination folder not found: ${destinationDir}`, "not_found");
  if (!statSync(dir).isDirectory()) {
    throw new DataServerError(`destination is not a folder: ${destinationDir}`, "not_found");
  }
  const segments = dir.split(/[\\/]+/).map((s) => s.toLowerCase());
  if (!segments.includes(LAW_SEGMENT)) {
    throw new DataServerError(`destination_dir is not inside a matter's 6. LAW tree: ${dir}`, "not_law_folder");
  }
  if (segments.some((s) => PROTECTED_SEGMENTS.has(s))) {
    throw new DataServerError(`destination_dir is inside a privileged/disclosed tree: ${dir}`, "protected");
  }
  return dir;
}

function assertBareFilename(name: string, label: string): void {
  if (
    typeof name !== "string" ||
    name.length === 0 ||
    name.includes("\0") ||
    /[\\/]/.test(name) ||
    /^[A-Za-z]:/.test(name) ||
    name === "." ||
    name === ".."
  ) {
    throw new DataServerError(`${label} must be a bare filename: ${name}`, "invalid_filename");
  }
}
