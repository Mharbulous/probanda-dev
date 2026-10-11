// sources__check (spec §3.3, #972 sections 1-3): the per-file source check, with
// two resolvers. `skill_source` reads the skills tree as skill_source__read does.
// `knowledge` reads a knowledge path (src/knowledge/tree.ts): the shipped copy
// wins, and a path in both layers also reports its shadowed overlay copy,
// checked separately. Each knowledge result is memoized for the session, and
// knowledge__read consults that memo for effective status (shared/knowledge-tree.md
// section 10) without touching the network itself.
//
// A file names its sources one of two ways (#972 section 4, spec §2.7): a
// source record carries the per-source fields in its own front matter
// (`page_url` and the rest), and a dependent carries `sources:`, a list of
// source-record paths relative to itself. Everything is read here, on the
// host, and the result is facts only: never a passage, so no rule text (and
// no period sentence inside one) reaches the calling session.
//
// Read-only: nothing is written. An unreachable or refused source is a `gap`,
// a fact the caller reads as "freshness not verified", never an error. A file
// that names no sources, or a malformed source record, is an error.

import { DataServerError, ValidationError } from "../errors.js";
import { skillSourceRead } from "../files/skill-source.js";
import { identicalText, joinRelative, parseKnowledgePath, readServed, type Layer } from "../knowledge/tree.js";
import type { ShippedFrom } from "../repo-root.js";
import {
  decodeEntities,
  htmlBlocks,
  passagePresent,
  sourcesFetcher,
  type FetchOutcome,
  type SourceFetcher,
} from "./fetch.js";

// ------------------------------------------------------------ front matter --
//
// The YAML subset a source record or dependent may use in its front matter:
// `key: scalar`; `key:` then a block list of scalars or of one-level maps; and
// the block scalars `|`, `|-`, `>` and `>-`. A scalar is plain, "double-quoted"
// (JSON escapes) or 'single-quoted'; `null`, `~` and empty read as null. Flow
// collections, nested maps, anchors, tags and inline comments are refused with
// the line number, never guessed at.

type Scalar = string | null;
type FrontValue = Scalar | Array<Scalar | Record<string, Scalar>>;
export type FrontMatter = Record<string, FrontValue>;

const KEY_LINE = /^([A-Za-z_][A-Za-z0-9_-]*):(?:[ \t]+(.*))?[ \t]*$/;

function indentOf(line: string): number {
  return line.length - line.trimStart().length;
}

function isBlank(line: string): boolean {
  return line.trim() === "" || line.trimStart().startsWith("#");
}

export function readFrontMatter(content: string, where: string): FrontMatter | null {
  const lines = (content.startsWith("\uFEFF") ? content.slice(1) : content).split(/\r?\n/);
  if (lines[0]?.trimEnd() !== "---") return null;
  const end = lines.findIndex((line, i) => i > 0 && (line.trimEnd() === "---" || line.trimEnd() === "..."));
  if (end === -1) throw new DataServerError(`${where}: front matter opened on line 1 is never closed`, "invalid_front_matter");
  const body = lines.slice(1, end);
  const fail = (index: number, why: string): never => {
    throw new DataServerError(`${where}, front matter line ${index + 2}: ${why}`, "invalid_front_matter");
  };

  const scalar = (text: string, index: number): Scalar => {
    const value = text.trim();
    if (value === "" || value === "null" || value === "~") return null;
    if (value.startsWith('"')) {
      if (!value.endsWith('"') || value.length < 2) fail(index, "unterminated double-quoted value");
      try {
        return JSON.parse(value) as string;
      } catch {
        return fail(index, "unsupported escape in a double-quoted value");
      }
    }
    if (value.startsWith("'")) {
      if (!value.endsWith("'") || value.length < 2) fail(index, "unterminated single-quoted value");
      return value.slice(1, -1).replace(/''/g, "'");
    }
    if (/^[[{]/.test(value)) fail(index, "flow collections are not supported; use a block list");
    if (/^[&*!|>]/.test(value)) fail(index, `unsupported value syntax ${JSON.stringify(value.slice(0, 12))}`);
    // `text` always follows whitespace (after `key:` or `- `), so a leading `#` is one too.
    if (/(?:^|\s)#/.test(value)) fail(index, "inline comments are not supported; quote a value that contains ` #`");
    return value;
  };

  // A block scalar's lines: every following line that is blank or indented past `parent`.
  const blockScalar = (header: string, start: number, parent: number): [string, number] => {
    if (!/^[|>]-?$/.test(header)) fail(start - 1, `unsupported block scalar header ${JSON.stringify(header)}`);
    let i = start;
    const raw: string[] = [];
    while (i < body.length && (body[i].trim() === "" || indentOf(body[i]) > parent)) raw.push(body[i++]);
    while (raw.length && raw[raw.length - 1].trim() === "") raw.pop();
    if (raw.length === 0) return ["", i];
    const depth = Math.min(...raw.filter((line) => line.trim() !== "").map(indentOf));
    const content = raw.map((line) => line.slice(Math.min(depth, indentOf(line))));
    let text: string;
    if (header[0] === "|") {
      text = content.join("\n");
    } else {
      text = content.reduce((acc, line) => {
        if (line === "") return `${acc}\n`;
        return acc === "" || acc.endsWith("\n") ? acc + line : `${acc} ${line}`;
      }, "");
    }
    return [header.endsWith("-") ? text : `${text}\n`, i];
  };

  const value = (rest: string | undefined, index: number, parent: number): [Scalar, number] => {
    const text = (rest ?? "").trim();
    if (text.startsWith("|") || text.startsWith(">")) return blockScalar(text, index + 1, parent);
    return [scalar(text, index), index + 1];
  };

  const out: FrontMatter = {};
  let i = 0;
  while (i < body.length) {
    const line = body[i];
    if (isBlank(line)) {
      i++;
      continue;
    }
    if (indentOf(line) > 0) fail(i, "unexpected indentation");
    const m = KEY_LINE.exec(line);
    if (!m) fail(i, "expected `key: value`");
    const key = m![1];
    if (Object.hasOwn(out, key)) fail(i, `duplicate key ${key}`);
    if ((m![2] ?? "").trim() !== "") {
      [out[key], i] = value(m![2], i, 0);
      continue;
    }
    // `key:` alone: null, or a block list beneath it.
    let next = i + 1;
    while (next < body.length && isBlank(body[next])) next++;
    if (next >= body.length || indentOf(body[next]) === 0) {
      out[key] = null;
      i = next;
      continue;
    }
    const dash = indentOf(body[next]);
    if (!/^-(?:[ \t]|$)/.test(body[next].trimStart())) fail(next, "nested maps are not supported; only a block list may sit under a key");
    const list: Array<Scalar | Record<string, Scalar>> = [];
    i = next;
    while (i < body.length) {
      if (isBlank(body[i])) {
        i++;
        continue;
      }
      const indent = indentOf(body[i]);
      if (indent < dash) break;
      if (indent > dash || !/^-(?:[ \t]|$)/.test(body[i].trimStart())) fail(i, "expected a list item");
      const afterDash = body[i].slice(dash + 1);
      const item = afterDash.trimStart();
      const itemCol = dash + 1 + (afterDash.length - item.length);
      const km = KEY_LINE.exec(item);
      if (!km) {
        list.push(scalar(item, i));
        i++;
        continue;
      }
      // A one-level map: its first key sits on the dash line, the rest at the same column.
      const map: Record<string, Scalar> = {};
      let k: RegExpExecArray | null = km;
      for (;;) {
        if (Object.hasOwn(map, k![1])) fail(i, `duplicate key ${k![1]}`);
        if ((k![2] ?? "").trim() === "" && i + 1 < body.length && !isBlank(body[i + 1]) && indentOf(body[i + 1]) > itemCol) {
          fail(i + 1, "nested values inside a list item are not supported");
        }
        [map[k![1]], i] = value(k![2], i, itemCol);
        while (i < body.length && isBlank(body[i])) i++;
        if (i >= body.length || indentOf(body[i]) !== itemCol) break;
        k = KEY_LINE.exec(body[i].slice(itemCol));
        if (!k) fail(i, "expected `key: value` in a list item");
      }
      list.push(map);
    }
    out[key] = list;
  }
  return out;
}

// ------------------------------------------------------------ source records --

export interface RecordItem {
  rule_ref: string;
  passage: string;
  /** Transcribed from a PDF or a practitioner-saved copy: not machine-checkable against the page. */
  fromFile: boolean;
  /** The item's source reference, as recorded. */
  source: string | null;
  /** A PDF item's page number. */
  page: string | null;
}

interface SourceRecord {
  path: string;
  page_url: string;
  pdf_url: string | null;
  pdf_sha256: string | null;
  marker_pattern: RegExp | null;
  marker: string | null;
  items: RecordItem[];
}

function optionalString(front: FrontMatter, key: string, where: string): string | null {
  const value = front[key];
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") {
    throw new DataServerError(`${where}: \`${key}\` must be a single value`, "invalid_source_record");
  }
  return value;
}

function toSourceRecord(path: string, front: FrontMatter): SourceRecord {
  const bad = (why: string): never => {
    throw new DataServerError(`${path}: ${why}`, "invalid_source_record");
  };
  const page_url = optionalString(front, "page_url", path);
  if (!page_url) bad("`page_url` is empty");
  const pdf_url = optionalString(front, "pdf_url", path);
  const pdf_sha256 = optionalString(front, "pdf_sha256", path);
  if (pdf_url && !pdf_sha256) bad("`pdf_url` needs the PDF's `pdf_sha256`");
  const pattern = optionalString(front, "currency_marker_pattern", path);
  const marker = optionalString(front, "currency_marker", path);
  if ((pattern === null) !== (marker === null)) bad("`currency_marker_pattern` and `currency_marker` come together");
  let marker_pattern: RegExp | null = null;
  if (pattern !== null) {
    try {
      marker_pattern = new RegExp(pattern, "g");
    } catch (err) {
      bad(`\`currency_marker_pattern\` is not a valid regular expression: ${(err as Error).message}`);
    }
  }

  return { path, page_url: page_url!, pdf_url, pdf_sha256, marker_pattern, marker, items: parseItems(front, path) };
}

/** The `items:` list of a front matter: each a map with a unique `rule_ref` and a `passage`. */
export function parseItems(front: FrontMatter, path: string): RecordItem[] {
  const bad = (why: string): never => {
    throw new DataServerError(`${path}: ${why}`, "invalid_source_record");
  };
  const rawItems = front.items ?? [];
  if (!Array.isArray(rawItems)) bad("`items` must be a list");
  const items: RecordItem[] = [];
  for (const [n, raw] of (rawItems as unknown[]).entries()) {
    if (typeof raw !== "object" || raw === null) bad(`items[${n}] must be a map with \`rule_ref\` and \`passage\``);
    const item = raw as Record<string, Scalar>;
    if (!item.rule_ref) bad(`items[${n}] has no \`rule_ref\``);
    if (items.some((seen) => seen.rule_ref === item.rule_ref)) bad(`rule_ref ${JSON.stringify(item.rule_ref)} appears twice`);
    if (!item.passage) bad(`items[${n}] (${item.rule_ref}) has no \`passage\``);
    const checkedBy = item.checked_by ?? null;
    if (checkedBy !== null && checkedBy !== "file_sha256") bad(`items[${n}] (${item.rule_ref}): unknown \`checked_by\` ${JSON.stringify(checkedBy)}`);
    items.push({
      rule_ref: item.rule_ref!,
      passage: item.passage!,
      fromFile: checkedBy === "file_sha256",
      source: item.source ?? null,
      page: item.page ?? null,
    });
  }
  return items;
}

/** A front matter's `sources:` list, validated: paths relative to the file. Empty when absent. */
export function sourcesListOf(front: FrontMatter | null, path: string): string[] {
  if (!front || front.sources === undefined) return [];
  const listed = front.sources;
  if (!Array.isArray(listed) || listed.some((entry) => typeof entry !== "string" || entry === "")) {
    throw new DataServerError(`${path}: "sources:" must be a list of paths relative to the file`, "invalid_front_matter");
  }
  return listed as string[];
}

interface CheckEnv {
  env?: NodeJS.ProcessEnv;
  installRoot?: string;
}

/** A file as either resolver serves it: tree-relative `path`, its folder `dir`, and its text. */
interface TreeFile {
  path: string;
  dir: string;
  content: string;
}

/** Reads a tree-relative path (already joined to the naming file's folder) from the same tree. */
type ReadInTree = (path: string) => TreeFile;

function readSkillFile(path: string, where: CheckEnv): TreeFile {
  return skillSourceRead(path, where.env, undefined, undefined, where.installRoot);
}

function sourceRecordsOf(file: TreeFile, readInTree: ReadInTree): SourceRecord[] {
  const front = readFrontMatter(file.content, file.path);
  const records: SourceRecord[] = [];
  if (front && front.page_url !== undefined) records.push(toSourceRecord(file.path, front));
  for (const relative of sourcesListOf(front, file.path)) {
    const record = readInTree(file.dir ? `${file.dir}/${relative}` : relative);
    const recordFront = readFrontMatter(record.content, record.path);
    if (!recordFront || recordFront.page_url === undefined) {
      throw new DataServerError(
        `${record.path}, named in ${file.path}'s "sources:" list, is not a source record (its front matter has no \`page_url\`)`,
        "invalid_source_record"
      );
    }
    records.push(toSourceRecord(record.path, recordFront));
  }
  if (records.length === 0) {
    throw new DataServerError(
      `${file.path} names no sources: its front matter carries neither \`page_url\` nor a "sources:" list`,
      "no_sources"
    );
  }
  return records;
}

// ------------------------------------------------------------ the check --

export interface SourceGap {
  reason: "host_not_allowed" | "fetch_failed";
  host: string;
  url: string;
  redirect_from?: string;
  detail?: string;
  status?: number;
}

export interface SourceFacts {
  record: string;
  page_url: string;
  page_status?: number;
  marker_recorded?: string | null;
  marker_found?: string[];
  marker_matches?: boolean;
  pdf_linked_from_page?: boolean;
  pdf_status?: number;
  pdf_sha256?: string;
  pdf_matches?: boolean;
  items?: Array<{ rule_ref: string; present: boolean | null }>;
  hosts_fetched: string[];
  gap?: SourceGap;
}

export interface SkillSourceFileCheck {
  tree: "skill_source";
  path: string;
  shipped_from: ShippedFrom;
  sources: SourceFacts[];
}

export interface KnowledgeFileCheck {
  tree: "knowledge";
  path: string;
  /** The layer whose copy was checked: the shipped copy wins. */
  layer: Layer;
  /** The root the skill's shipped layer resolved to. */
  shipped_from: ShippedFrom | null;
  sources: SourceFacts[];
  /** For a path in both layers: the overlay copy the shipped one shadows, checked separately. */
  shadowed_local?: { path: string; identical: boolean; sources: SourceFacts[] };
  /** Source records named by `sources:` that the overlay also holds: the shipped copy was checked. */
  shadowed_sources?: Array<{ path: string; identical: boolean }>;
}

export type FileCheck = SkillSourceFileCheck | KnowledgeFileCheck;

/**
 * The session's latest knowledge check per knowledge path, consulted by knowledge__read.
 * Keyed case-folded: knowledge paths are case-insensitive, as the filesystem is.
 */
const knowledgeChecks = new Map<string, KnowledgeFileCheck>();

/** The memoized sources__check result for a knowledge path, or undefined when none ran this session. */
export function memoizedKnowledgeCheck(path: string): KnowledgeFileCheck | undefined {
  return knowledgeChecks.get(path.toLowerCase());
}

function gapOf(outcome: Exclude<FetchOutcome, { ok: true }>): SourceGap {
  const { ok: _ok, hosts: _hosts, ...gap } = outcome;
  return gap;
}

function markersFound(text: string, pattern: RegExp): string[] {
  const found = new Set<string>();
  for (const match of text.matchAll(new RegExp(pattern.source, pattern.flags))) {
    found.add(match.length > 1 ? (match[1] ?? "") : match[0]);
  }
  return [...found].sort();
}

const ANCHOR_HREF = /<a\b[^>]*?\shref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/gi;

function resolveUrl(href: string, base?: string): string | null {
  try {
    return new URL(href.trim(), base).href;
  } catch {
    return null;
  }
}

/** Whether an anchor on the page links the PDF, its href entity-decoded and resolved against the page's final URL. */
function pdfLinkedFromPage(html: string, finalUrl: string, pdfUrl: string): boolean {
  const target = resolveUrl(pdfUrl);
  if (target === null) return false;
  for (const m of html.matchAll(ANCHOR_HREF)) {
    if (resolveUrl(decodeEntities(m[1] ?? m[2] ?? m[3]), finalUrl) === target) return true;
  }
  return false;
}

async function checkRecord(record: SourceRecord, fetcher: SourceFetcher): Promise<SourceFacts> {
  const facts: Omit<SourceFacts, "hosts_fetched" | "gap"> = { record: record.path, page_url: record.page_url };
  const hosts = new Set<string>();
  const done = (gap?: SourceGap): SourceFacts => ({ ...facts, hosts_fetched: [...hosts], ...(gap ? { gap } : {}) });

  const page = await fetcher.fetchSource(record.page_url);
  page.hosts.forEach((host) => hosts.add(host));
  if (!page.ok) {
    if (page.reason === "fetch_failed" && page.status !== undefined) facts.page_status = page.status;
    return done(gapOf(page));
  }
  facts.page_status = page.status;
  const html = page.bytes.toString("utf-8");
  const joined = htmlBlocks(html).join(" ");
  if (joined === "") {
    return done({ reason: "fetch_failed", host: new URL(page.final_url).hostname, url: page.final_url, detail: "empty_text" });
  }

  if (record.marker_pattern) {
    const found = markersFound(joined, record.marker_pattern);
    facts.marker_recorded = record.marker;
    facts.marker_found = found;
    facts.marker_matches = found.length === 1 && found[0] === record.marker;
  }

  let pdfGap: SourceGap | undefined;
  if (record.pdf_url) {
    facts.pdf_linked_from_page = pdfLinkedFromPage(html, page.final_url, record.pdf_url);
    const pdf = await fetcher.fetchSource(record.pdf_url);
    pdf.hosts.forEach((host) => hosts.add(host));
    if (pdf.ok) {
      facts.pdf_status = pdf.status;
      facts.pdf_sha256 = pdf.sha256;
      facts.pdf_matches = pdf.sha256 === record.pdf_sha256;
    } else {
      if (pdf.reason === "fetch_failed" && pdf.status !== undefined) facts.pdf_status = pdf.status;
      pdfGap = gapOf(pdf);
    }
  }

  facts.items = record.items.map((item) => ({
    rule_ref: item.rule_ref,
    present: item.fromFile ? null : passagePresent(joined, item.passage),
  }));
  return done(pdfGap);
}

export interface CheckSeams extends CheckEnv {
  /** Tests only. Production always uses the runtime's one fetcher. */
  fetcher?: SourceFetcher;
}

export async function checkSources(files: unknown, seams: CheckSeams = {}): Promise<{ files: FileCheck[] }> {
  if (!Array.isArray(files) || files.length === 0) {
    throw new ValidationError("sources__check.files must be a non-empty array of {tree, path}");
  }
  const fetcher = seams.fetcher ?? sourcesFetcher;
  const results: FileCheck[] = [];
  for (const [n, entry] of files.entries()) {
    if (typeof entry !== "object" || entry === null || typeof entry.path !== "string" || entry.path === "") {
      throw new ValidationError(`sources__check.files[${n}] must be {tree, path} with a non-empty path`);
    }
    if (entry.tree === "knowledge") {
      results.push(await checkKnowledgeFile(entry.path, `sources__check.files[${n}].path`, seams, fetcher));
      continue;
    }
    if (entry.tree !== "skill_source") {
      throw new ValidationError(`sources__check.files[${n}].tree must be "skill_source" or "knowledge"`);
    }
    const file = skillSourceRead(entry.path, seams.env, undefined, undefined, seams.installRoot);
    const sources = await checkAll(sourceRecordsOf(file, (path) => readSkillFile(path, seams)), fetcher);
    results.push({ tree: "skill_source", path: file.path, shipped_from: file.shipped_from, sources });
  }
  return { files: results };
}

async function checkAll(records: SourceRecord[], fetcher: SourceFetcher): Promise<SourceFacts[]> {
  const sources: SourceFacts[] = [];
  for (const record of records) sources.push(await checkRecord(record, fetcher));
  return sources;
}

/** A knowledge file as its served copy (shipped wins), with `path` and `dir` as knowledge paths. */
function knowledgeTreeFile(path: string, text: string): TreeFile {
  const slash = path.lastIndexOf("/");
  return { path, dir: slash === -1 ? "" : path.slice(0, slash), content: text };
}

/**
 * The `knowledge` resolver. The served copy is checked; a path in both layers also has
 * its overlay copy checked and reported as `shadowed_local`. Source records named by
 * `sources:` are read the way knowledge__read serves them (so each keeps the folder
 * grammar), and one in both layers is reported in `shadowed_sources`.
 */
async function checkKnowledgeFile(path: string, label: string, seams: CheckSeams, fetcher: SourceFetcher): Promise<KnowledgeFileCheck> {
  const kp = parseKnowledgePath(path, label);
  if (!kp.skill) throw new ValidationError(`${label}: "${kp.head}" is an overlay reserved entry, which names no sources`);
  const served = readServed(kp, seams, label);
  const shadowedSources = new Map<string, { path: string; identical: boolean }>();
  const readInTree = (joined: string): TreeFile => {
    const record = readServed(parseKnowledgePath(joinRelative("", joined), label), seams, label);
    if (record.shadowed) {
      shadowedSources.set(record.shadowed.abs, { path: record.shadowed.abs, identical: identicalText(record.served.text, record.shadowed.text) });
    }
    return knowledgeTreeFile(record.kp.path, record.served.text);
  };
  const result: KnowledgeFileCheck = {
    tree: "knowledge",
    path: kp.path,
    layer: served.served.layer,
    shipped_from: served.shipped_from,
    sources: await checkAll(sourceRecordsOf(knowledgeTreeFile(kp.path, served.served.text), readInTree), fetcher),
  };
  if (served.shadowed) {
    result.shadowed_local = {
      path: served.shadowed.abs,
      identical: identicalText(served.served.text, served.shadowed.text),
      sources: await checkAll(sourceRecordsOf(knowledgeTreeFile(kp.path, served.shadowed.text), readInTree), fetcher),
    };
  }
  if (shadowedSources.size) result.shadowed_sources = [...shadowedSources.values()];
  knowledgeChecks.set(kp.path.toLowerCase(), result);
  return result;
}
