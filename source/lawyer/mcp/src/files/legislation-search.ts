// research_filing__legislation_search (planning/1. Design/2026-10-06_statute-first-research-route-spec.md
// §4.3): a read-only full-text search of one instrument's text in a matter, so the audit agent can
// put a recorded search behind a statement that an instrument has, or lacks, a provision.
//
// It returns text and never a conclusion. Every line of the text is searched; the section numbers it
// reads off the text only label the hits and report the range covered, so a wrong guess at a section
// boundary can mislabel a hit but never hide one. The file may sit anywhere in the matter outside a
// `privileged`/`disclosed` tree (Brahm's decision, 2026-10-06): a statute held by case data may be
// pages of a book of authorities filed outside `6. LAW`, and `pages` narrows a PDF to its range
// (PDF and .docx text awaits the in-server extractor: see FOLLOW-UP below).

import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { win32 as pathWin32 } from "node:path";

import { DataServerError } from "../errors.js";
import { htmlBlocks } from "../sources/fetch.js";
import { validateMatterRoot } from "./matter-root.js";
import { canonicalRoot } from "./scope.js";

const PROTECTED_SEGMENTS = new Set(["privileged", "disclosed"]);
const TEXT_EXTENSIONS = new Set([".md", ".txt"]);
const HTML_EXTENSIONS = new Set([".htm", ".html"]);
const EXTRACTED_EXTENSIONS = new Set([".pdf", ".docx"]);
// As research_filing__law_folder_text: a PDF with less text than this per page is taken as scanned.
const SCANNED_BYTES_PER_PAGE = 500;
const MAX_TERMS = 50;
// One hit's section text is cut here; statute sections are short, a schedule's table may not be.
const MAX_SECTION_CHARS = 6000;
// A section number on a line of its own text: `12`, `12.1`, `9-6`, then whitespace and more text.
// A table of contents glues the number to the title (`94Page limits`), so it never matches.
const SECTION_LINE = /^(\d+(?:-\d+)?(?:\.\d+)?)\s+\S/;
// A number further than this above the last section read is body text (a year, a sum), not a section.
const MAX_SECTION_JUMP = 50;
// A heading is a short line with no closing punctuation and no bracket at either end.
const MAX_HEADING_CHARS = 120;

export interface LegislationSearchSeams {
  /** One string per page of a `.pdf` (or one for a `.docx`); throws a DataServerError when unreadable. */
  extractPages?: (path: string) => string[];
}

// FOLLOW-UP: PDF and .docx text comes from `extractText` (src/files/text-extract.ts), the host-Python-free
// extractor `fix/law-folder-text-extraction` adds (planning/2. Plan/2026-10-06_merged-law-folder-text-and-
// memo-index-plan.md). It had not landed when this tool was built, and the pre-filing `extractDocuments`
// needs host pypdf, so it is deliberately not used. Once `extractText` is on main, make this the
// production default (it is async, so legislationSearch becomes async), map its reason codes onto
// `unreadable` / `ocr_unavailable` / `no_text`, and drop this refusal.
function noPageExtractor(path: string): string[] {
  throw new DataServerError(
    `PDF and .docx text is not read yet (it awaits the in-server extractor); search a .md, .txt or .html copy instead: ${path}`,
    "extractor_unavailable"
  );
}

interface Line {
  text: string;
  page: number | null;
}

interface Chunk {
  block: number;
  section: string | null;
  heading: string | null;
  lines: Line[];
}

export interface LegislationHit {
  block: number;
  section: string | null;
  heading: string | null;
  page: number | null;
  matched: string[];
  text: string;
  truncated?: true;
}

export interface SectionBlock {
  block: number;
  heading: string | null;
  first: string;
  last: string;
  count: number;
}

export interface LegislationSearchResult {
  path: string;
  sha256: string;
  source: "md" | "txt" | "html" | "pdf" | "docx";
  pages: { first: number; last: number } | null;
  terms: string[];
  regex: string | null;
  lines_searched: number;
  sections_searched: { count: number; blocks: SectionBlock[] };
  unsectioned_lines: number;
  hits: LegislationHit[];
}

/**
 * Search the text of the file at `path`, inside the matter at `matterRoot`, for any of `terms`
 * (literal, case-insensitive) and for `regex` (case-insensitive). At least one of the two is required.
 * Returns each section holding a match, whole, with the section numbers read and every line counted.
 */
export function legislationSearch(
  matterRoot: string,
  path: string,
  terms: unknown,
  regex: unknown,
  pages: unknown,
  seams: LegislationSearchSeams = {}
): LegislationSearchResult {
  const file = resolveMatterFile(matterRoot, path);
  const termList = checkTerms(terms);
  const pattern = checkRegex(regex);
  if (termList.length === 0 && pattern === null) {
    throw new DataServerError("give terms, a regex, or both", "invalid_argument");
  }
  const ext = pathWin32.extname(file).toLowerCase();
  const range = checkPages(pages, ext);
  const bytes = readFileSync(file);
  const { lines, source } = textLines(file, ext, bytes, range, seams);

  const chunks = sectionChunks(lines);
  const hits: LegislationHit[] = [];
  for (const chunk of chunks) {
    const body = chunk.lines.map((l) => l.text).join("\n");
    const lower = body.toLowerCase();
    const matched = termList.filter((t) => lower.includes(t.toLowerCase()));
    if (pattern !== null && pattern.test(body)) matched.push(`/${pattern.source}/`);
    if (matched.length === 0) continue;
    const hit: LegislationHit = {
      block: chunk.block,
      section: chunk.section,
      heading: chunk.heading,
      page: chunk.lines[0]?.page ?? null,
      matched,
      text: body.length > MAX_SECTION_CHARS ? body.slice(0, MAX_SECTION_CHARS) : body,
    };
    if (body.length > MAX_SECTION_CHARS) hit.truncated = true;
    hits.push(hit);
  }

  return {
    path: file,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    source,
    pages: range,
    terms: termList,
    regex: pattern === null ? null : pattern.source,
    lines_searched: lines.length,
    sections_searched: sectionBlocks(chunks),
    unsectioned_lines: chunks.filter((c) => c.section === null).reduce((n, c) => n + c.lines.length, 0),
    hits,
  };
}

function resolveMatterFile(matterRoot: string, path: string): string {
  const root = validateMatterRoot(matterRoot);
  if (typeof path !== "string" || !pathWin32.isAbsolute(path)) {
    throw new DataServerError(`path must be an absolute host path: ${path}`, "invalid_path");
  }
  const file = canonicalRoot(path, `file not found: ${path}`, "not_found");
  if (!statSync(file).isFile()) throw new DataServerError(`path is not a file: ${path}`, "not_found");
  if (!file.toLowerCase().startsWith(root.toLowerCase() + "\\")) {
    throw new DataServerError(`path is not in this matter: ${file}`, "not_in_matter");
  }
  if (file.split(/[\\/]+/).some((s) => PROTECTED_SEGMENTS.has(s.toLowerCase()))) {
    throw new DataServerError(`path is inside a privileged/disclosed tree: ${file}`, "protected");
  }
  return file;
}

function checkTerms(terms: unknown): string[] {
  if (terms === undefined) return [];
  const list = typeof terms === "string" ? [terms] : terms;
  if (!Array.isArray(list) || list.some((t) => typeof t !== "string" || t.trim() === "")) {
    throw new DataServerError("terms must be a non-empty string or an array of them", "invalid_argument");
  }
  if (list.length > MAX_TERMS) throw new DataServerError(`at most ${MAX_TERMS} terms`, "invalid_argument");
  return list as string[];
}

function checkRegex(regex: unknown): RegExp | null {
  if (regex === undefined) return null;
  if (typeof regex !== "string" || regex === "") {
    throw new DataServerError("regex must be a non-empty string", "invalid_argument");
  }
  try {
    return new RegExp(regex, "i");
  } catch (err) {
    throw new DataServerError(`regex does not compile: ${(err as Error).message}`, "invalid_argument");
  }
}

function checkPages(pages: unknown, ext: string): { first: number; last: number } | null {
  if (pages === undefined) return null;
  if (ext !== ".pdf") throw new DataServerError("pages applies only to a PDF", "invalid_argument");
  const m = typeof pages === "string" ? /^\s*(\d+)\s*(?:[-–]\s*(\d+))?\s*$/.exec(pages) : null;
  if (m === null) throw new DataServerError(`pages must read "X-Y" or "X": ${String(pages)}`, "invalid_argument");
  const first = Number(m[1]);
  const last = Number(m[2] ?? m[1]);
  if (first < 1 || last < first) throw new DataServerError(`pages is not a range: ${pages}`, "invalid_argument");
  return { first, last };
}

function textLines(
  file: string,
  ext: string,
  bytes: Buffer,
  range: { first: number; last: number } | null,
  seams: LegislationSearchSeams
): { lines: Line[]; source: LegislationSearchResult["source"] } {
  const split = (text: string, page: number | null): Line[] =>
    text
      .split(/\r?\n|\f/)
      .map((t) => t.trim())
      .filter((t) => t !== "")
      .map((t) => ({ text: t, page }));

  let lines: Line[];
  let source: LegislationSearchResult["source"];
  if (TEXT_EXTENSIONS.has(ext)) {
    source = ext === ".md" ? "md" : "txt";
    lines = split(stripFrontMatter(bytes.toString("utf-8")), null);
  } else if (HTML_EXTENSIONS.has(ext)) {
    source = "html";
    lines = split(htmlBlocks(bytes.toString("utf-8")).join("\n"), null);
  } else if (EXTRACTED_EXTENSIONS.has(ext)) {
    source = ext === ".pdf" ? "pdf" : "docx";
    let pageTexts = (seams.extractPages ?? noPageExtractor)(file).map((text, i) => ({ text, page: i + 1 }));
    if (range !== null) {
      if (range.last > pageTexts.length) {
        throw new DataServerError(`pages ${range.first}-${range.last} run past the file's ${pageTexts.length} pages`, "invalid_argument");
      }
      pageTexts = pageTexts.slice(range.first - 1, range.last);
    }
    const textBytes = Buffer.byteLength(pageTexts.map((p) => p.text).join("").trim(), "utf-8");
    if (source === "pdf" && textBytes < SCANNED_BYTES_PER_PAGE * Math.max(pageTexts.length, 1)) {
      throw new DataServerError(
        `${textBytes} bytes of text over ${pageTexts.length} page(s), under ${SCANNED_BYTES_PER_PAGE} per page, so likely scanned; no OCR runs`,
        "ocr_unavailable"
      );
    }
    lines = pageTexts.flatMap((p) => split(p.text, source === "pdf" ? p.page : null));
  } else {
    throw new DataServerError(`unsupported file type: ${ext || "no extension"}`, "unsupported_type");
  }
  if (lines.length === 0) throw new DataServerError("the file holds no text", "no_text");
  return { lines, source };
}

/** research_filing__file_fetched writes a `---` header above a filed page's text. */
function stripFrontMatter(text: string): string {
  const m = /^---\r?\n[\s\S]*?\r?\n---\r?\n/.exec(text);
  return m === null ? text : text.slice(m[0].length);
}

function sectionKey(num: string): number[] {
  return num.split(/[-.]/).map(Number);
}

function compareKeys(a: number[], b: number[]): number {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] ?? -1) - (b[i] ?? -1);
    if (d !== 0) return d;
  }
  return 0;
}

function isHeading(text: string): boolean {
  return (
    text.length <= MAX_HEADING_CHARS && !/[.;:,\]]$/.test(text) && !SECTION_LINE.test(text) && !/^[([]/.test(text)
  );
}

/**
 * Split the lines into chunks, one per section, with lines before a block's first section as an
 * unsectioned chunk. A number above the last one read (within MAX_SECTION_JUMP of its leading part)
 * opens the next section; a number that drops back to a block's first number (`1`, `1-1`) opens a
 * new block, as a schedule or form does; any other number is body text. The short line before a
 * section number is taken as that section's heading.
 */
function sectionChunks(lines: Line[]): Chunk[] {
  const chunks: Chunk[] = [];
  let block = 1;
  let last: number[] | null = null;
  let current: Chunk = { block, section: null, heading: null, lines: [] };
  const open = (section: string, line: Line): void => {
    let heading: string | null = null;
    const prev = current.lines[current.lines.length - 1];
    if (prev !== undefined && isHeading(prev.text) && (current.section !== null || current.lines.length > 1)) {
      heading = prev.text;
      current.lines.pop();
    }
    if (current.lines.length > 0) chunks.push(current);
    current = { block, section, heading, lines: [line] };
  };

  for (const line of lines) {
    const m = SECTION_LINE.exec(line.text);
    if (m === null) {
      current.lines.push(line);
      continue;
    }
    const key = sectionKey(m[1]);
    const restart = key.every((n) => n === 1) && !m[1].includes(".");
    if (last === null) {
      last = key;
      open(m[1], line);
    } else if (compareKeys(key, last) > 0 && key[0] - last[0] <= MAX_SECTION_JUMP) {
      last = key;
      open(m[1], line);
    } else if (restart && compareKeys(key, last) < 0) {
      block += 1;
      last = key;
      open(m[1], line);
    } else {
      current.lines.push(line);
    }
  }
  if (current.lines.length > 0) chunks.push(current);
  return chunks;
}

function sectionBlocks(chunks: Chunk[]): { count: number; blocks: SectionBlock[] } {
  const blocks: SectionBlock[] = [];
  for (const chunk of chunks) {
    if (chunk.section === null) continue;
    const open = blocks[blocks.length - 1];
    if (open !== undefined && open.block === chunk.block) {
      open.last = chunk.section;
      open.count += 1;
    } else {
      blocks.push({ block: chunk.block, heading: chunk.heading, first: chunk.section, last: chunk.section, count: 1 });
    }
  }
  return { count: blocks.reduce((n, b) => n + b.count, 0), blocks };
}
