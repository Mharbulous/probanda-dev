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
//
// Rule-level sections (docs/Specs/2026-10-22_legislation-search-rule-sections-spec.md): a court
// rules file opens a section at each `Rule N-N` heading line, a section longer than the cap comes
// back as its matching subsections, `pinpoint` resolves `Rule 4-2(6)` or `s 3(2)` directly, and
// text with no section headings is cut into fixed-size chunks with their line ranges.

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
// One hit's text is cut here; statute sections are short, a rule or a schedule's table may not be.
const MAX_SECTION_CHARS = 6000;
// A section number on a line of its own text: `12`, `12.1`, `9-6`, then whitespace and more text.
// A table of contents glues the number to the title (`94Page limits`), so it never matches.
const SECTION_LINE = /^(\d+(?:-\d+)?(?:\.\d+)?)\s+\S/;
// A court rule's heading line: `Rule 4-2 — Address for Service`.
const RULE_HEADING = /^Rule\s+(\d+-\d+)(?![\d(-])/i;
// A Part or Division heading line: `Part 4 — Documents`, `Division 2`.
const PART_HEADING = /^(Part|Division)\s+\d+(?:\.\d+)?(?!\d)/i;
// A subsection or subrule opens a line, after its section number on the section's first line.
const SUBSECTION_LINE = /^(?:\d+(?:-\d+)?(?:\.\d+)?\s+)?\((\d+(?:\.\d+)?)\)(?=\s|$)/;
const PINPOINT =
  /^\s*(?:(?:rule|r\.?)\s*(\d+-\d+)|(?:section|sec\.?|ss?\.?)\s*(\d+(?:\.\d+)?)|(\d+(?:-\d+)?(?:\.\d+)?))\s*(?:\(\s*(\d+(?:\.\d+)?)\s*\))?\s*$/i;
// A number further than this above the last section read is body text (a year, a sum), not a section.
const MAX_SECTION_JUMP = 50;
// A heading is a short line with no closing punctuation and no bracket at either end.
const MAX_HEADING_CHARS = 120;
// Text with no section heading is returned in chunks of this many lines.
const CHUNK_LINES = 40;

export interface LegislationSearchSeams {
  /** One string per page of a `.pdf` (or one for a `.docx`); throws a DataServerError when unreadable. */
  extractPages?: (path: string) => string[];
}

// FOLLOW-UP: PDF and .docx text comes from `extractText` (src/files/text-extract.ts), the host-Python-free
// extractor `fix/law-folder-text-extraction` adds (planning/2. Plan/2026-10-06_merged-law-folder-text-and-
// memo-index-plan.md). It had not landed when this tool was built, and the pre-filing `extractDocuments`
// needs host pypdf, so it is deliberately not used. Once `extractText` is on main, make this the
// production default (it is async, so legislationSearch becomes async), map its reason codes onto
// `unreadable` / `ocr_unavailable` / `no_text`, and drop this refusal. Until then no PDF text is read
// here, so no scanned or OCR'd page's text layer can reach a hit; once it is, extractText refuses a PDF
// with any scanned page as `ocr_unavailable` (classifyPdfPages, src/files/extract/page-images.ts).
function noPageExtractor(path: string): string[] {
  throw new DataServerError(
    `PDF and .docx text is not read yet (it awaits the in-server extractor); search a .md, .txt or .html copy instead: ${path}`,
    "extractor_unavailable"
  );
}

interface Line {
  text: string;
  /** The text without markdown heading marks and bold, for recognising headings and numbers only. */
  plain: string;
  page: number | null;
  line: number;
}

interface Chunk {
  block: number;
  section: string | null;
  heading: string | null;
  path: string[];
  lines: Line[];
}

interface Part {
  subsection: string | null;
  subheading: string | null;
  lines: Line[];
}

export interface LegislationHit {
  block: number;
  section: string | null;
  subsection: string | null;
  heading: string | null;
  heading_path: string[];
  page: number | null;
  line_range: { first: number; last: number };
  matched: string[];
  text: string;
  truncated: boolean;
  currency_marker: string | null;
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
  pinpoint: string | null;
  currency_marker: string | null;
  sectioning: "headings" | "fixed_chunks";
  lines_searched: number;
  sections_searched: { count: number; blocks: SectionBlock[] };
  unsectioned_lines: number;
  hits: LegislationHit[];
}

/**
 * Search the text of the file at `path`, inside the matter at `matterRoot`, for any of `terms`
 * (literal, case-insensitive) and for `regex` (case-insensitive), or resolve one `pinpoint`
 * (`Rule 4-2(6)`, `s 3(2)`). Terms and regex may be combined; a pinpoint stands alone.
 * Returns each section holding a match, whole up to the cap, with the section numbers read and
 * every line counted.
 */
export function legislationSearch(
  matterRoot: string,
  path: string,
  terms: unknown,
  regex: unknown,
  pages: unknown,
  seams: LegislationSearchSeams = {},
  pinpoint?: unknown
): LegislationSearchResult {
  const file = resolveMatterFile(matterRoot, path);
  const termList = checkTerms(terms);
  const pattern = checkRegex(regex);
  const pin = checkPinpoint(pinpoint);
  if (pin !== null && (termList.length > 0 || pattern !== null)) {
    throw new DataServerError("a pinpoint stands alone: give it without terms or a regex", "invalid_argument");
  }
  if (termList.length === 0 && pattern === null && pin === null) {
    throw new DataServerError("give terms, a regex, or both, or a pinpoint", "invalid_argument");
  }
  const ext = pathWin32.extname(file).toLowerCase();
  const range = checkPages(pages, ext);
  const bytes = readFileSync(file);
  const { lines, source, marker } = textLines(file, ext, bytes, range, seams);
  const currency = marker ?? lines.find((l) => /\bcurrent to\b/i.test(l.text))?.text ?? null;

  const chunks = fixedChunks(sectionChunks(lines));
  const hits: LegislationHit[] = [];
  const hit = (chunk: Chunk, part: Part | null, matched: string[]): void => {
    const partLines = part?.lines ?? chunk.lines;
    const body = partLines.map((l) => l.text).join("\n");
    const headingPath = [...chunk.path];
    if (chunk.heading !== null) headingPath.push(chunk.heading);
    if (part?.subheading) headingPath.push(part.subheading);
    hits.push({
      block: chunk.block,
      section: chunk.section,
      subsection: part?.subsection ?? null,
      heading: chunk.heading,
      heading_path: headingPath,
      page: partLines[0]?.page ?? null,
      line_range: { first: partLines[0].line, last: partLines[partLines.length - 1].line },
      matched,
      text: body.length > MAX_SECTION_CHARS ? body.slice(0, MAX_SECTION_CHARS) : body,
      truncated: body.length > MAX_SECTION_CHARS,
      currency_marker: currency,
    });
  };
  const matchesIn = (ls: Line[]): string[] => {
    const body = ls.map((l) => l.text).join("\n");
    const lower = body.toLowerCase();
    const matched = termList.filter((t) => lower.includes(t.toLowerCase()));
    if (pattern !== null && pattern.test(body)) matched.push(`/${pattern.source}/`);
    return matched;
  };

  for (const chunk of chunks) {
    if (pin !== null) {
      // A rule that is only its heading line is a table of contents entry, not the provision.
      const tocEntry = chunk.lines.length === 1 && chunk.lines[0].plain === chunk.heading;
      if (chunk.section !== pin.section || tocEntry) continue;
      if (pin.subsection === null) {
        hit(chunk, null, [pin.text]);
      } else {
        const part = subsectionParts(chunk).find((p) => p.subsection === pin.subsection);
        if (part !== undefined) hit(chunk, part, [pin.text]);
      }
      continue;
    }
    const matched = matchesIn(chunk.lines);
    if (matched.length === 0) continue;
    const long = chunk.lines.map((l) => l.text).join("\n").length > MAX_SECTION_CHARS;
    const parts = long ? subsectionParts(chunk) : [];
    const partHits = parts.length > 1 ? parts.map((p) => [p, matchesIn(p.lines)] as const).filter(([, m]) => m.length > 0) : [];
    if (partHits.length === 0) hit(chunk, null, matched);
    else for (const [p, m] of partHits) hit(chunk, p, m);
  }

  const sectioned = chunks.some((c) => c.section !== null);
  return {
    path: file,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    source,
    pages: range,
    terms: termList,
    regex: pattern === null ? null : pattern.source,
    pinpoint: pin === null ? null : pin.text,
    currency_marker: currency,
    sectioning: sectioned ? "headings" : "fixed_chunks",
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

function checkPinpoint(pinpoint: unknown): { text: string; section: string; subsection: string | null } | null {
  if (pinpoint === undefined) return null;
  const m = typeof pinpoint === "string" ? PINPOINT.exec(pinpoint) : null;
  if (m === null) {
    throw new DataServerError(
      `pinpoint must read like "Rule 4-2", "Rule 4-2(6)", "s 3" or "s 3(2)": ${String(pinpoint)}`,
      "invalid_argument"
    );
  }
  return { text: (pinpoint as string).trim(), section: m[1] ?? m[2] ?? m[3], subsection: m[4] ?? null };
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

/** Markdown heading marks and bold or underline markers off, for recognising a line's shape. */
function plainText(text: string): string {
  return text.replace(/^#{1,6}\s+/, "").replace(/\*\*|__/g, "").trim();
}

function textLines(
  file: string,
  ext: string,
  bytes: Buffer,
  range: { first: number; last: number } | null,
  seams: LegislationSearchSeams
): { lines: Line[]; source: LegislationSearchResult["source"]; marker: string | null } {
  // `base` is the number of lines above this text, so each line keeps its own line number.
  const split = (text: string, page: number | null, base: number): Line[] =>
    text
      .split(/\r?\n|\f/)
      .map((t, i) => ({ text: t.trim(), plain: plainText(t), page, line: base + i + 1 }))
      .filter((l) => l.text !== "");

  let lines: Line[];
  let marker: string | null = null;
  let source: LegislationSearchResult["source"];
  if (TEXT_EXTENSIONS.has(ext)) {
    source = ext === ".md" ? "md" : "txt";
    const front = frontMatter(bytes.toString("utf-8"));
    marker = front.marker;
    lines = split(front.body, null, front.lines);
  } else if (HTML_EXTENSIONS.has(ext)) {
    source = "html";
    lines = split(htmlBlocks(bytes.toString("utf-8")).join("\n"), null, 0);
  } else if (EXTRACTED_EXTENSIONS.has(ext)) {
    source = ext === ".pdf" ? "pdf" : "docx";
    let base = 0;
    let pageTexts = (seams.extractPages ?? noPageExtractor)(file).map((text, i) => {
      const page = { text, page: i + 1, base };
      base += text.split(/\r?\n|\f/).length;
      return page;
    });
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
    lines = pageTexts.flatMap((p) => split(p.text, source === "pdf" ? p.page : null, p.base));
  } else {
    throw new DataServerError(`unsupported file type: ${ext || "no extension"}`, "unsupported_type");
  }
  if (lines.length === 0) throw new DataServerError("the file holds no text", "no_text");
  return { lines, source, marker };
}

/**
 * research_filing__file_fetched writes a `---` header above a filed page's text. The header is not
 * searched; its `currency_marker` is returned with every result.
 */
function frontMatter(text: string): { body: string; lines: number; marker: string | null } {
  const m = /^---\r?\n[\s\S]*?\r?\n---\r?\n/.exec(text);
  if (m === null) return { body: text, lines: 0, marker: null };
  const raw = /^currency_marker:[ \t]*(.*?)\s*$/m.exec(m[0])?.[1] ?? "";
  let marker: string | null = raw === "" || raw === "null" ? null : raw;
  if (marker !== null && marker.startsWith('"')) {
    try {
      marker = JSON.parse(marker) as string;
    } catch {
      // Not JSON: the header's own text is the marker.
    }
  }
  return { body: text.slice(m[0].length), lines: m[0].split("\n").length - 1, marker };
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

function ruleHeading(line: Line): string | null {
  return isHeading(line.plain) ? (RULE_HEADING.exec(line.plain)?.[1] ?? null) : null;
}

function isPartHeading(line: Line): boolean {
  return isHeading(line.plain) && PART_HEADING.test(line.plain);
}

/**
 * Split the lines into chunks, one per section, with lines before a block's first section as an
 * unsectioned chunk. A section opens at a `Rule N-N` heading line or at a line that begins with a
 * section number; in a file with rule headings only an `N-N` number opens one. A number above the
 * last one read (within MAX_SECTION_JUMP of its leading part) opens the next section; a number that
 * drops back to a block's first number (`1`, `1-1`) opens a new block, as a schedule, form or table
 * of contents does; any other number is body text. The short line before a section number is taken
 * as that section's heading, and the Part and Division headings above it as its path; each of those
 * heading lines is an unsectioned chunk of its own.
 */
function sectionChunks(lines: Line[]): Chunk[] {
  const rules = lines.some((l) => ruleHeading(l) !== null);
  const chunks: Chunk[] = [];
  let block = 1;
  let last: number[] | null = null;
  let part: string | null = null;
  let division: string | null = null;
  let current: Chunk = { block, section: null, heading: null, path: [], lines: [] };
  const open = (section: string, line: Line, isRule: boolean): void => {
    let heading: string | null = isRule ? line.plain : null;
    const prev = current.lines[current.lines.length - 1];
    if (
      !isRule &&
      prev !== undefined &&
      isHeading(prev.plain) &&
      !isPartHeading(prev) &&
      (current.section !== null || current.lines.length > 1)
    ) {
      heading = prev.plain;
      current.lines.pop();
    }
    if (current.lines.length > 0) chunks.push(current);
    const path = [part, division].filter((p): p is string => p !== null);
    current = { block, section, heading, path, lines: [line] };
  };

  for (const line of lines) {
    if (isPartHeading(line)) {
      if (/^part/i.test(line.plain)) {
        part = line.plain;
        division = null;
      } else {
        division = line.plain;
      }
      // A Part or Division heading belongs to no section: it starts an unsectioned chunk.
      if (current.lines.length > 0) chunks.push(current);
      current = { block, section: null, heading: null, path: [], lines: [line] };
      continue;
    }
    const rule = ruleHeading(line);
    const m = rule === null ? SECTION_LINE.exec(line.plain) : null;
    const num = rule ?? (m !== null && (!rules || m[1].includes("-")) ? m[1] : null);
    if (num === null) {
      current.lines.push(line);
      continue;
    }
    const key = sectionKey(num);
    const restart = key.every((n) => n === 1) && !num.includes(".");
    if (last === null || (compareKeys(key, last) > 0 && key[0] - last[0] <= MAX_SECTION_JUMP)) {
      last = key;
      open(num, line, rule !== null);
    } else if (restart && compareKeys(key, last) < 0) {
      block += 1;
      last = key;
      open(num, line, rule !== null);
    } else {
      current.lines.push(line);
    }
  }
  if (current.lines.length > 0) chunks.push(current);
  return chunks;
}

/** Unsectioned text longer than CHUNK_LINES is cut into chunks of that many lines. */
function fixedChunks(chunks: Chunk[]): Chunk[] {
  return chunks.flatMap((c) => {
    if (c.section !== null || c.lines.length <= CHUNK_LINES) return [c];
    const out: Chunk[] = [];
    for (let i = 0; i < c.lines.length; i += CHUNK_LINES) out.push({ ...c, lines: c.lines.slice(i, i + CHUNK_LINES) });
    return out;
  });
}

/**
 * A section's lines split at each subsection, `(1)`, `(2)`, in rising order: the lines before the
 * first are a lead part. A heading line just above a subsection is that subsection's heading.
 */
function subsectionParts(chunk: Chunk): Part[] {
  const parts: Part[] = [{ subsection: null, subheading: null, lines: [] }];
  let last: number[] | null = null;
  for (const line of chunk.lines) {
    const m = SUBSECTION_LINE.exec(line.plain);
    const key = m === null ? null : sectionKey(m[1]);
    if (m === null || key === null || (last !== null && compareKeys(key, last) <= 0)) {
      parts[parts.length - 1].lines.push(line);
      continue;
    }
    last = key;
    const prev = parts[parts.length - 1];
    const tail = prev.lines[prev.lines.length - 1];
    const lines: Line[] = [];
    let subheading: string | null = null;
    if (tail !== undefined && prev.lines.length > 1 && isHeading(tail.plain)) {
      prev.lines.pop();
      lines.push(tail);
      subheading = tail.plain;
    }
    lines.push(line);
    parts.push({ subsection: m[1], subheading, lines });
  }
  return parts.filter((p) => p.lines.length > 0);
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
