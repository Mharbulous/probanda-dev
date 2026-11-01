// Host-side filing of downloaded case law (planning/research-paralegal-tool-narrowing.md).
//
// Chrome writes to the OS Downloads folder; research-paralegal must get each file into an
// existing `6. LAW\<issue>\` folder of a matter. Four of these tools do that on the host, so the
// agent needs no shell and no Downloads folder grant. Names and metadata only -- nothing here
// reads a downloaded file's content, and `fileDownload` is structurally not a generic mover:
// the source is a bare filename inside Downloads, the destination a realpath-resolved folder
// carrying a `6. LAW` segment. The fifth, `saveAnswer` (#1406), writes caller-supplied text, or the
// bytes of a file in the same matter's research-agent scratchpad, with the generated Legend, as a
// new `.md` file in such a folder and never overwrites. The sixth, `fileFetched`, files the bytes
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
  constants,
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { win32 as pathWin32 } from "node:path";

import { DataServerError } from "../errors.js";
import { checkCoverageLine } from "./coverage-line.js";
import { downloadsDir, IN_PROGRESS_EXTENSIONS } from "./downloads.js";
import { htmlBlocks, sourcesFetcher, type SourceFetcher } from "../sources/fetch.js";
import { GAP_LINE_RE, MOCKUP_ONLY_LINE_RE, toFiledFace } from "../submission/forms/filed-face.js";
import { withLegend } from "../submission/forms/legend.js";
import { MOCKUP_ONLY_TAG } from "../submission/forms/markers.js";
import { findDraftDir, validateMatterRoot } from "./matter-root.js";
import { canonicalRoot } from "./scope.js";
import { extractText } from "./text-extract.js";
import { nextVersionName } from "./version-name.js";
import { zoneProblem } from "./zones.js";

// Belt-and-braces: a `6. LAW` folder never sits under a firewall zone, so the segment rule
// already excludes those. Keep the zones check anyway -- do not delete the segment rule believing
// the zones check covers it; it does not (it says nothing about where the folder is).
const LAW_SEGMENT = "6. law";
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

  // A copy, never a move: the download stays in Downloads, because Probanda only reads or
  // copies a file it did not create (the file-manager plugin holds every move).
  const bytes = statSync(source).size;
  copyFileSync(source, dest, constants.COPYFILE_EXCL);
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
 * Save `text` byte-for-byte as a new file named `filename` in a `6. LAW` folder, its legend at the end
 * replaced by the one legend.ts generates for the symbols it prints (none when it prints none). If that name is
 * taken, the file is `<stem> vN.md`, N one above the highest version present (the bare name counts
 * as v1). The exclusive create (`wx`) is what makes this race-safe: a name another session took
 * between the scan and the write fails EEXIST and the next attempt re-scans. A missing destination
 * is created when its parent is already in a `6. LAW` tree -- the final folder only.
 *
 * Exactly one of `text`, `fromScratch` and `fromRender` is given. `fromScratch` is a file `writeScratch`
 * wrote: its real path must sit directly in the research-agent scratchpad of the matter that owns the
 * destination's `6. LAW` tree, and its bytes are copied as `text` is. The scratch file is kept.
 * `fromRender` is a mockup drafting_forms__render wrote in that matter's 0. DRAFT folder (a research
 * memo's or case brief's Writing): its bytes are copied without the mockup's own header, the first
 * `---` block, which names the matter, and without the title line after it. A case brief's copy is
 * presented to the practitioner as it stands, so it also loses its markers, trace comments and Legend
 * (caseBriefCopy), and a mockup with a gap line is refused `brief_incomplete`, since that copy would
 * hide the gap. A memo's keeps them: a proposition-level note-up names a paragraph's stored item by the
 * `statement_of_law_id` its line ends with (shared/legal-research.md). It loses only the mockup-only
 * lines, which would sit before its header, and the review marker on that header's closing `---`. Those
 * lines come back as `mockup_only_lines`, because a memo is on no board and nothing else would show them.
 */
export function saveAnswer(
  destinationDir: string,
  filename: string,
  text?: string,
  fromScratch?: string,
  fromRender?: string
): { path: string; filename: string; bytes: number; created_dir: boolean; sha256: string; mockup_only_lines?: string[] } {
  assertBareFilename(filename, "filename");
  const ext = pathWin32.extname(filename);
  if (ext.toLowerCase() !== ".md") {
    throw new DataServerError(`filename must end in .md: ${filename}`, "invalid_filename");
  }
  if ([text, fromScratch, fromRender].filter((v) => v !== undefined).length !== 1) {
    throw new DataServerError("pass exactly one of text, from_scratch and from_render", "invalid_argument");
  }
  let body: Buffer;
  let mockupOnly: string[] = [];
  if (fromRender !== undefined) {
    ({ body, mockupOnly } = renderBytes(destinationDir, fromRender));
  } else {
    let source: Buffer;
    if (fromScratch !== undefined) {
      source = scratchBytes(destinationDir, fromScratch);
    } else {
      if (typeof text !== "string" || text.length === 0) {
        throw new DataServerError("text must be a non-empty string", "invalid_argument");
      }
      source = Buffer.from(text, "utf-8");
    }
    body = Buffer.from(withLegend(source.toString("utf-8"), "").markdown, "utf-8");
  }
  const { dir, created } = resolveOrCreateLawDir(destinationDir);
  const saved = writeNewVersion(dir, filename, body);
  const sha256 = createHash("sha256").update(body).digest("hex");
  return { path: saved.path, filename: saved.filename, bytes: body.length, created_dir: created, sha256, ...(mockupOnly.length > 0 ? { mockup_only_lines: mockupOnly } : {}) };
}

/** The bytes of `fromScratch`, refused unless its real path is a non-empty file directly in the
 * research-agent scratchpad of the matter owning `destinationDir`'s `6. LAW` tree. Creates nothing. */
function scratchBytes(destinationDir: string, fromScratch: string): Buffer {
  if (typeof fromScratch !== "string" || !pathWin32.isAbsolute(fromScratch)) {
    throw new DataServerError(`from_scratch must be the absolute path write_scratch returned: ${fromScratch}`, "invalid_path");
  }
  const draft = destinationDraftDir(destinationDir);
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

/** The 0. DRAFT folder of the matter owning `destinationDir`'s `6. LAW` tree. The destination may be a
 * final folder still to be created; its parent then anchors the matter. Creates nothing. */
function destinationDraftDir(destinationDir: string): string {
  let law = existsSync(destinationDir) ? resolveLawDir(destinationDir) : resolveLawDir(pathWin32.dirname(destinationDir));
  while (pathWin32.basename(law).toLowerCase() !== LAW_SEGMENT) law = pathWin32.dirname(law);
  const root = validateMatterRoot(pathWin32.dirname(law));
  const draft = findDraftDir(root);
  if (draft === undefined) {
    throw new DataServerError(`${root} has no 0. DRAFT folder, so it has no scratchpad or mockups`, "draft_dir_missing");
  }
  return draft;
}

/** A mockup's own header, its first `---` block, and the `# <title>` line after it, so the copy opens
 * with the memo's own `---` header as a memo file always has. */
const MOCKUP_HEADER = /^\uFEFF?---\r?\n[\s\S]*?\r?\n---\r?\n(?:[ \t]*\r?\n)*(?:# [^\r\n]*\r?\n(?:[ \t]*\r?\n)*)?/;

/** The Document Type line of a case brief's mockup header: the type file's title (case-brief.md). */
const CASE_BRIEF_HEADER = /^\uFEFF?---\r?\n(?:(?!---\r?\n)[^\n]*\n)*?Document Type: Case Brief\r?\n/;

/**
 * A case brief's copy for the practitioner: the mockup's filed face (filed-face.ts), less its title. Each
 * verbatim line stays as written, because the face's whitespace tidy and tag strips would change a quote:
 * in an item's block quote (projections.ts itemLines), every line but the last, its citation line. The
 * tag strips reach only that citation line: a tag is only ever printed there, and text of its shape in
 * the brief's own sentences is wording the reviewer approved, so its opening " (" or " [" is held.
 * Refused when the mockup holds a gap line: the face deletes those, and the file would hide a slot not
 * written or an item of law short of its passage or pinpoint (projections.ts). The verbatim lines go back
 * last, so restoring a held opening cannot change a passage that holds its placeholder character.
 */
function caseBriefCopy(mockup: string, source: string): string {
  const gaps = [...mockup.matchAll(GAP_LINE_RE)].map((m) => m[1]);
  if (gaps.length > 0) throw new DataServerError(`this brief is not complete, so it was not saved: ${gaps.join("; ")}: ${source}`, "brief_incomplete");
  const verbatim: string[] = [];
  const held = mockup.split("\n").map((line, i, lines) => {
    if (!line.startsWith(">")) return line.replace(/ \(/g, "\uE002").replace(/ \[/g, "\uE003");
    if (!lines[i + 1]?.startsWith(">")) return line;
    verbatim.push(line);
    return `\uE000${verbatim.length - 1}\uE001`;
  });
  return toFiledFace(held.join("\n"))
    .replace(/^\s*# [^\n]*\n\s*/, "")
    .replace(/\uE002/g, " (")
    .replace(/\uE003/g, " [")
    .replace(/\uE000(\d+)\uE001/g, (_, n) => verbatim[Number(n)]);
}

/** A memo's copy: the mockup less its mockup-only lines, its header and title (MOCKUP_HEADER), with its own
 * header's closing `---` bare. The render prints a prose slot's review marker after the slot's last line,
 * which in the `memo-header` slot is that `---`. `mockupOnly` is the lines it left out, without their tag. */
function memoCopy(mockup: string): { copy: string; mockupOnly: string[] } {
  return {
    copy: withLegend(mockup.replace(MOCKUP_ONLY_LINE_RE, "").replace(MOCKUP_HEADER, "").replace(/^---[ \t]+\uD83E\uDDD0[ \t]*$/gm, "---"), "").markdown,
    mockupOnly: [...mockup.matchAll(MOCKUP_ONLY_LINE_RE)].map((m) => m[0].replace(MOCKUP_ONLY_TAG, "").trim()),
  };
}

/** A rendered mockup's saved bytes (saveAnswer's `fromRender`), refused unless its real path is a non-empty
 * `.md` file inside the 0. DRAFT folder of the matter owning `destinationDir`'s `6. LAW` tree. */
function renderBytes(destinationDir: string, fromRender: string): { body: Buffer; mockupOnly: string[] } {
  if (typeof fromRender !== "string" || !pathWin32.isAbsolute(fromRender) || pathWin32.extname(fromRender).toLowerCase() !== ".md") {
    throw new DataServerError(`from_render must be the absolute path of the .md mockup drafting_forms__render returned: ${fromRender}`, "invalid_path");
  }
  const draft = canonicalRoot(destinationDraftDir(destinationDir), "the 0. DRAFT folder does not resolve", "draft_dir_missing");
  assertUnprotected(draft);
  const source = canonicalRoot(fromRender, `from_render not found: ${fromRender}`, "not_found");
  if (!source.toLowerCase().startsWith(draft.toLowerCase() + "\\") || !statSync(source).isFile()) {
    throw new DataServerError(`from_render is not a mockup in this matter's ${draft}: ${source}`, "not_render");
  }
  const mockup = readFileSync(source, "utf-8");
  const { copy, mockupOnly } = CASE_BRIEF_HEADER.test(mockup) ? { copy: caseBriefCopy(mockup, source), mockupOnly: [] } : memoCopy(mockup);
  if (copy.trim() === "") throw new DataServerError(`from_render is empty: ${source}`, "invalid_argument");
  return { body: Buffer.from(copy, "utf-8"), mockupOnly };
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

export interface LawTextMatch {
  file: string;
  first: number;
  last: number;
  matched: number[];
  text: string;
}

export interface LawTextSearched {
  file: string;
  status: "ok" | "unread";
  reason?: string;
  head?: string[];
  manifest_marker?: string | null;
}

export interface LawTextOptions {
  file?: unknown;
  pattern?: unknown;
  context?: unknown;
  max_matches?: unknown;
}

const HTML_EXTENSIONS = new Set([".htm", ".html"]);
// Extensions a filed HTML page's text sibling may carry: fileFetched writes a page as `.md`.
const TEXT_SIBLING_EXTENSIONS = [".md", ".txt"];
const DEFAULT_CONTEXT = 3;
const DEFAULT_MAX_MATCHES = 50;
const HEAD_LINES = 5;
// extractText's results by real path, size and mtime, so a file unchanged since it was last read is
// not extracted again. Held in this process only; nothing is written.
const EXTRACT_CACHE = new Map<string, { key: string; read: Awaited<ReturnType<typeof extractText>> }>();
const EXTRACT_CACHE_LIMIT = 64;

async function cachedExtract(path: string): Promise<Awaited<ReturnType<typeof extractText>>> {
  const stat = statSync(path);
  const key = `${stat.size}:${stat.mtimeMs}`;
  const hit = EXTRACT_CACHE.get(path);
  if (hit !== undefined && hit.key === key) return hit.read;
  const read = await extractText(path);
  // A reader that failed to load may load next time, so that result is never kept.
  if (read.status === "ok" || !read.reason.startsWith("extractor_unavailable")) {
    EXTRACT_CACHE.delete(path);
    EXTRACT_CACHE.set(path, { key, read });
    if (EXTRACT_CACHE.size > EXTRACT_CACHE_LIMIT) EXTRACT_CACHE.delete(EXTRACT_CACHE.keys().next().value as string);
  }
  return read;
}

/**
 * The one file in `files` that `wanted` names: an exact name (case aside) first, else the only name
 * holding it as a substring. An HTML page is never matched directly: its text sibling (same stem,
 * `.md` or `.txt`) stands in for it, and with no sibling the call is refused `html_page`.
 */
function pickLawFile(files: string[], wanted: string): string {
  const lower = wanted.toLowerCase();
  const exact = files.filter((name) => name.toLowerCase() === lower);
  const named = exact.length > 0 ? exact : files.filter((name) => name.toLowerCase().includes(lower));
  if (named.length === 0) {
    throw new DataServerError(`no file in this folder matches ${JSON.stringify(wanted)}`, "not_found");
  }
  const picked = new Set<string>();
  const htmlOnly: string[] = [];
  for (const name of named) {
    if (!HTML_EXTENSIONS.has(pathWin32.extname(name).toLowerCase())) {
      picked.add(name);
      continue;
    }
    const stem = name.slice(0, -pathWin32.extname(name).length).toLowerCase();
    const sibling = files.find((other) =>
      TEXT_SIBLING_EXTENSIONS.some((ext) => other.toLowerCase() === stem + ext)
    );
    if (sibling === undefined) htmlOnly.push(name);
    else picked.add(sibling);
  }
  if (picked.size === 0) {
    throw new DataServerError(
      `an HTML page is never read, and ${htmlOnly.join(", ")} has no .md or .txt text sibling in this folder`,
      "html_page"
    );
  }
  if (picked.size > 1) {
    throw new DataServerError(
      `${JSON.stringify(wanted)} matches ${picked.size} files; name one: ${[...picked].sort().join(", ")}`,
      "ambiguous_file"
    );
  }
  return [...picked][0];
}

function nonNegativeInt(value: unknown, label: string, fallback: number, min: number): number {
  if (value === undefined) return fallback;
  if (typeof value !== "number" || !Number.isInteger(value) || value < min) {
    throw new DataServerError(`${label} must be an integer of at least ${min}: ${JSON.stringify(value)}`, "invalid_argument");
  }
  return value;
}

/** The currency marker of `file`'s latest line in the folder's manifest, or null when none names it. */
function manifestMarker(law: string, file: string): string | null {
  const path = pathWin32.join(law, MANIFEST);
  if (!existsSync(path)) return null;
  let marker: string | null = null;
  for (const line of readFileSync(path, "utf-8").split("\n")) {
    if (line.trim() === "") continue;
    let record: unknown;
    try {
      record = JSON.parse(line);
    } catch {
      continue;
    }
    const r = record as { filename?: unknown; currency_marker?: unknown };
    if (r.filename === file && typeof r.currency_marker === "string") marker = r.currency_marker;
  }
  return marker;
}

/** Lines of `text` matching `regex`, each with `context` lines either side; overlapping blocks merge. */
function matchBlocks(file: string, text: string, regex: RegExp, context: number, budget: number): {
  blocks: LawTextMatch[];
  count: number;
  truncated: boolean;
} {
  const lines = text.split(/\r?\n/);
  const hits: number[] = [];
  let truncated = false;
  for (let i = 0; i < lines.length; i++) {
    if (!regex.test(lines[i])) continue;
    if (hits.length === budget) {
      truncated = true;
      break;
    }
    hits.push(i);
  }
  // Spans as 0-based [first, last] line indexes; a span touching the one before it joins it.
  const spans: Array<{ first: number; last: number; matched: number[] }> = [];
  for (const i of hits) {
    const first = Math.max(0, i - context);
    const last = Math.min(lines.length - 1, i + context);
    const prev = spans[spans.length - 1];
    if (prev !== undefined && first <= prev.last + 1) {
      prev.last = last;
      prev.matched.push(i + 1);
    } else {
      spans.push({ first, last, matched: [i + 1] });
    }
  }
  const blocks = spans.map((s) => ({
    file,
    first: s.first + 1,
    last: s.last + 1,
    matched: s.matched,
    text: lines.slice(s.first, s.last + 1).join("\n"),
  }));
  return { blocks, count: hits.length, truncated };
}

/**
 * Write the text of every file in an existing `6. LAW` folder of `matterRoot` as `<file>.txt` under
 * the research agent's scratchpad, in `law-text\<the folder's path below 6. LAW>\`, replacing what an
 * earlier call wrote there. The `6. LAW` folder is only read. Each file goes through extractText
 * (./text-extract.ts), in the server with no host Python, one file at a time, so one broken file
 * cannot sink the rest. A file that yields no usable text is `unread` with extractText's reason and
 * gets no text file.
 *
 * `file` narrows the call to the one file it names (pickLawFile). `pattern` (a case-insensitive
 * regex) returns the matching lines inline, with `context` lines either side, up to `max_matches`
 * matched lines, and writes nothing: no scratch copy and no scratch folder. Without `file`, a pattern
 * searches every file in the folder but its HTML pages.
 */
export async function lawFolderText(
  matterRoot: string,
  destinationDir: string,
  options: LawTextOptions = {}
): Promise<
  | { out_dir: string; files: LawTextRow[] }
  | { pattern: string; searched: LawTextSearched[]; matches: LawTextMatch[]; match_count: number; truncated: boolean }
> {
  const root = validateMatterRoot(matterRoot);
  const law = resolveLawDir(destinationDir);
  if (!law.toLowerCase().startsWith(root.toLowerCase() + "\\")) {
    throw new DataServerError(`destination_dir is not in this matter: ${law}`, "not_in_matter");
  }
  if (options.file !== undefined && (typeof options.file !== "string" || options.file.trim() === "")) {
    throw new DataServerError("file must be a non-empty string", "invalid_argument");
  }
  if (options.pattern !== undefined && (typeof options.pattern !== "string" || options.pattern === "")) {
    throw new DataServerError("pattern must be a non-empty string", "invalid_argument");
  }
  if (options.pattern === undefined && (options.context !== undefined || options.max_matches !== undefined)) {
    throw new DataServerError("context and max_matches need a pattern", "invalid_argument");
  }
  const listed = readdirSync(law)
    .filter((name) => statSync(pathWin32.join(law, name)).isFile())
    .sort();
  const files = options.file === undefined ? listed : [pickLawFile(listed, options.file as string)];

  if (options.pattern !== undefined) {
    const context = nonNegativeInt(options.context, "context", DEFAULT_CONTEXT, 0);
    const maxMatches = nonNegativeInt(options.max_matches, "max_matches", DEFAULT_MAX_MATCHES, 1);
    let regex: RegExp;
    try {
      regex = new RegExp(options.pattern as string, "i");
    } catch (err) {
      throw new DataServerError(`pattern is not a valid regex: ${(err as Error).message}`, "invalid_argument");
    }
    const searched: LawTextSearched[] = [];
    const matches: LawTextMatch[] = [];
    let matchCount = 0;
    let truncated = false;
    for (const file of files) {
      if (truncated) break;
      if (HTML_EXTENSIONS.has(pathWin32.extname(file).toLowerCase())) {
        searched.push({ file, status: "unread", reason: "html_page: an HTML page is never read; search its text sibling" });
        continue;
      }
      if (file === MANIFEST) continue;
      const read = await cachedExtract(pathWin32.join(law, file));
      if (read.status === "unread") {
        searched.push({ file, status: "unread", reason: read.reason });
        continue;
      }
      const head = read.text.split(/\r?\n/).filter((l) => l.trim() !== "").slice(0, HEAD_LINES);
      searched.push({ file, status: "ok", head, manifest_marker: manifestMarker(law, file) });
      const found = matchBlocks(file, read.text, regex, context, maxMatches - matchCount);
      matches.push(...found.blocks);
      matchCount += found.count;
      truncated = found.truncated;
    }
    return { pattern: options.pattern as string, searched, matches, match_count: matchCount, truncated };
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

  const rows: LawTextRow[] = [];
  for (const file of files) {
    const read = await cachedExtract(pathWin32.join(law, file));
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
  if (zoneProblem("write", realDir)) {
    throw new DataServerError(`the scratchpad would be inside a privileged/disclosed tree, TRASH or 0. CASE DATA: ${realDir}`, "protected");
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
    source: fields.kind === "secondary" ? "secondary" : "official-publisher",
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

function resolveOrCreateLawDir(destinationDir: string): { dir: string; created: boolean } {
  try {
    return { dir: resolveLawDir(destinationDir), created: false };
  } catch (err) {
    if ((err as DataServerError).code !== "not_found" || existsSync(destinationDir)) throw err;
  }
  const parent = resolveLawDir(pathWin32.dirname(destinationDir));
  if (zoneProblem("write", pathWin32.join(parent, pathWin32.basename(destinationDir)))) {
    throw new DataServerError(`destination_dir is inside a privileged/disclosed tree, TRASH or 0. CASE DATA: ${destinationDir}`, "protected");
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
  if (zoneProblem("write", dir)) {
    throw new DataServerError(`destination_dir is inside a privileged/disclosed tree, TRASH or 0. CASE DATA: ${dir}`, "protected");
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
  // Windows refuses each of these, except that a colon quietly writes to a hidden stream of a shorter name.
  if (/[<>:"|?*\x00-\x1f]/.test(name)) {
    throw new DataServerError(`${label} holds a character a Windows file name cannot have (one of < > : " | ? *, or a control character); replace each with "-": ${name}`, "invalid_filename");
  }
}
