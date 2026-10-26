// The click-time cross-check of a suggestion card (docs/Plans/2026-10-25_suggestion-design.md,
// decisions 8 and 28). It finds, in every part of the card that would be sent:
//
//   - a record token: a word of three or more letters, or a number of four or more digits, found in
//     this computer's client, matter, contact, folder-name, document-title or file-name records
//     (records.ts), less the shipped stop lists and the firm's own name. Whole word, any case;
//   - an email address or a path;
//   - a date or an amount.
//
// Each hit names its part, its place in that part and its kind, and never the text it matched, so a
// hit can be logged or recorded as a defect without carrying client information. A record token,
// an email or a path offers Remove only; a date or an amount offers Remove or Send anyway (decision
// 8). That offer is a prompt only for text the practitioner reads on the card (the pain point, the
// items, the context lines and the comment). In a part the tool generated (the raw observation, the
// environment facts, the mockup) the hit removes its line, or the whole mockup, with no prompt, and
// is recorded as a defect (decision 28). The prompt and the removal are the card's (Phase 4).

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { DataServerError, ValidationError } from "../errors.js";
import { resolveShippedRoot } from "../repo-root.js";
import { RECORD_SOURCES, type RecordSource, type RecordTexts, type SourceState } from "./records.js";

// ---- tokens ----

/** The shipped stop lists, under the suggestion skill's tree. */
export const STOP_WORDS_DIR = "suggestion/references/stop-words";
export const STOP_WORD_FILES = ["legal-and-folder.txt", "common-english.txt"] as const;

// A word is a run of letters, with an apostrophe allowed between letters (O'Brien, don't); a number
// is a run of digits. Anything else separates them, so a match is always a whole word.
const TOKEN = /(\p{L}+(?:['\u2019]\p{L}+)*)|(\p{Nd}+)/gu;

export interface Token {
  key: string;
  start: number;
  end: number;
}

function keyOf(word: string): string {
  return word.replace(/\u2019/g, "'").toLowerCase();
}

/** The words of three or more letters and the numbers of four or more digits in `text`, with their places. */
export function tokens(text: string): Token[] {
  const out: Token[] = [];
  for (const m of text.matchAll(TOKEN)) {
    const start = m.index ?? 0;
    if (m[1] !== undefined) {
      if (m[1].replace(/['\u2019]/g, "").length >= 3) out.push({ key: keyOf(m[1]), start, end: start + m[1].length });
    } else if (m[2].length >= 4) {
      out.push({ key: m[2], start, end: start + m[2].length });
    }
  }
  return out;
}

/** The words of one stop list file: one per line, `#` starting a comment line. */
export function parseStopWords(text: string): string[] {
  return text.split(/\r?\n/).map((line) => line.trim()).filter((line) => line !== "" && !line.startsWith("#")).map(keyOf);
}

/** Every shipped stop word. Refused when a list is missing: a check without them would prompt on ordinary words. */
export function loadStopWords(env: NodeJS.ProcessEnv = process.env, installRoot?: string): Set<string> {
  const root = resolveShippedRoot(STOP_WORDS_DIR, env, { subject: "the suggestion word lists", plugin: "lawyer", installRoot }).root;
  const words = new Set<string>();
  for (const file of STOP_WORD_FILES) {
    const path = join(root, ...STOP_WORDS_DIR.split("/"), file);
    if (!existsSync(path)) throw new DataServerError("The suggestion check is missing its word lists. Update the lawyer plugin.", "stop_words_missing");
    for (const word of parseStopWords(readFileSync(path, "utf-8"))) words.add(word);
  }
  return words;
}

/** Each record token, with the sources it came from. */
export type TokenIndex = Map<string, Set<RecordSource>>;

export function buildTokenIndex(records: RecordTexts, stopWords: Set<string>): TokenIndex {
  const stop = new Set(stopWords);
  if (records.firmName) for (const t of tokens(records.firmName)) stop.add(t.key);
  const index: TokenIndex = new Map();
  for (const source of RECORD_SOURCES) {
    for (const text of records.texts[source]) {
      for (const t of tokens(text)) {
        if (stop.has(t.key)) continue;
        const held = index.get(t.key) ?? new Set<RecordSource>();
        held.add(source);
        index.set(t.key, held);
      }
    }
  }
  return index;
}

// ---- patterns ----

export type PatternKind = "email" | "path" | "date" | "amount";

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
// Addresses that identify nobody: SSH remotes and no-reply senders (as preferences/redact.ts).
const SERVICE_LOCAL_PARTS = new Set(["git", "noreply", "no-reply"]);

const PATH_CHARS = String.raw`[^\s"'<>|*?]`;
const PATHS: RegExp[] = [
  // A drive path: a drive letter, a colon, then a slash or a backslash.
  new RegExp(String.raw`(?<![A-Za-z0-9])[A-Za-z]:[\\/]${PATH_CHARS}*`, "g"),
  // A UNC path: \\server\share...
  new RegExp(String.raw`\\\\[\w.$-]+\\${PATH_CHARS}*`, "g"),
  // An environment-variable or home root: %USERPROFILE%\..., $HOME/..., ${VAR}/..., ~/...
  new RegExp(String.raw`(?:%\w+%|\$\{?\w+\}?|~)[\\/]${PATH_CHARS}*`, "g"),
  // An absolute POSIX path of two or more segments, not part of a URL, a closing tag or a word.
  new RegExp(String.raw`(?<![\w:/.<>~%}])/[\w.-]+(?:/[\w.-]+)+/?`, "g"),
  // A relative path with a backslash: Folder\Sub, Folder\file.pdf.
  new RegExp(String.raw`(?<![\w\\])[\w.-]+(?:\\[\w.-]+)+`, "g"),
  // A relative forward-slash path of three or more segments, or of two ending in a file extension.
  new RegExp(String.raw`(?<![\w/:.<])[\w.-]+(?:/[\w.-]+){2,}`, "g"),
  new RegExp(String.raw`(?<![\w/:.<])[\w.-]+/[\w-]+\.[A-Za-z][A-Za-z0-9]{0,4}\b`, "g"),
];

const MONTH = String.raw`(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|June?|July?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\.?`;
const DAY = String.raw`\d{1,2}(?:st|nd|rd|th)?`;
const DATES: RegExp[] = [
  /(?<![\d.])\d{4}[-/.]\d{1,2}[-/.]\d{1,2}(?![\d.])/g,
  /(?<![\d.])\d{1,2}([-/])\d{1,2}\1(?:\d{4}|\d{2})(?![\d.])/g,
  // With dots only a four-digit year: 0.9.14 is a version, not a date.
  /(?<![\d.])\d{1,2}\.\d{1,2}\.\d{4}(?![\d.])/g,
  new RegExp(String.raw`\b${MONTH}\s+${DAY}(?:,?\s+\d{4})?\b`, "g"),
  new RegExp(String.raw`\b${DAY}\s+(?:of\s+)?${MONTH}(?:,?\s+\d{4})?\b`, "g"),
  new RegExp(String.raw`\b${MONTH}\s+\d{4}\b`, "g"),
];

const NUMBER = String.raw`\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?`;
const SCALE = String.raw`(?:\s?(?:k|m|million|thousand|billion)\b)?`;
const AMOUNTS: RegExp[] = [
  // A currency sign or code before the number: $1,200, CAD 300, US$ 45.10.
  new RegExp(String.raw`(?:[A-Z]{0,3}\$|[€£¥]|\b(?:CAD|USD|EUR|GBP)\s?)\s?(?:${NUMBER})${SCALE}`, "g"),
  // A currency word or code after the number: 300 dollars, 1,200.00 CAD.
  new RegExp(String.raw`(?<![\d.,])(?:${NUMBER})${SCALE}\s?(?:dollars?|cents?|CAD|USD|EUR|GBP)\b`, "gi"),
  // A number with thousands separators: 12,500 or 12,500.00.
  /(?<![\d.,])\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?(?![\d,])/g,
];

export interface PatternHit {
  kind: PatternKind;
  start: number;
  end: number;
}

function matchAll(text: string, patterns: RegExp[], kind: PatternKind, keep: (match: string) => boolean = () => true): PatternHit[] {
  const hits: PatternHit[] = [];
  for (const pattern of patterns) {
    for (const m of text.matchAll(pattern)) {
      let value = m[0];
      // A path or a date never ends with sentence punctuation.
      if (kind === "path") value = value.replace(/[.,;:)\]]+$/, "");
      if (value === "" || !keep(value)) continue;
      const start = m.index ?? 0;
      hits.push({ kind, start, end: start + value.length });
    }
  }
  return hits;
}

/** Emails, paths, dates and amounts in `text`. A span matched by two path forms counts once. */
export function findPatterns(text: string): PatternHit[] {
  const emails = matchAll(text, [EMAIL], "email", (value) => !SERVICE_LOCAL_PARTS.has(value.split("@")[0].toLowerCase()));
  const within = (hit: PatternHit, others: PatternHit[]) => others.some((o) => o !== hit && o.start <= hit.start && hit.end <= o.end && (o.end - o.start) > (hit.end - hit.start));
  // A path holds a letter; an all-number one (2026/10/25) is a date.
  const paths = matchAll(text, PATHS, "path", (value) => /\p{L}/u.test(value)).filter((hit) => !emails.some((e) => e.start <= hit.start && hit.end <= e.end));
  const dates = matchAll(text, DATES, "date");
  const amounts = matchAll(text, AMOUNTS, "amount");
  const all = [...emails, ...paths, ...dates, ...amounts];
  const seen = new Set<string>();
  return all
    .filter((hit) => !within(hit, all.filter((o) => o.kind === hit.kind)))
    .filter((hit) => {
      const key = `${hit.kind}:${hit.start}:${hit.end}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => a.start - b.start || a.end - b.end);
}

// ---- the check ----

export const READABLE_PARTS = ["pain_point", "items", "context_lines", "comment"] as const;
export const GENERATED_PARTS = ["raw_observation", "environment_facts", "mockup"] as const;
export type CardPart = (typeof READABLE_PARTS)[number] | (typeof GENERATED_PARTS)[number];

export interface CardText {
  pain_point?: string;
  items?: string[];
  /** The constraint and evidence lines the practitioner reads on the card. */
  context_lines?: string[];
  comment?: string;
  raw_observation?: string[];
  /** The mockup's HTML, checked whole. */
  mockup?: string;
  /** The environment facts as the environment-facts tool returned them. */
  environment_facts?: unknown;
}

export type HitKind = "record" | PatternKind;

export interface Hit {
  part: CardPart;
  /** The item, context line or raw-observation line, counted from 0; absent for a part that is one text. */
  index?: number;
  /** The environment fact, as a path into the facts object (plugins[1].version). */
  field?: string;
  /** Where the match lies in that text, in UTF-16 code units, end exclusive. */
  start: number;
  end: number;
  kind: HitKind;
  /** For a record token, the sources it was found in. */
  sources?: RecordSource[];
  /** readable: text the practitioner reads on the card; generated: text the tool wrote. */
  text: "readable" | "generated";
  /** For readable text, the one-line prompt's offer: Remove only, or Remove and Send anyway. */
  offer: "remove_only" | "remove_or_send_anyway" | null;
  /** prompt: ask the practitioner; remove_line: drop that line unasked; remove_mockup: drop the whole mockup unasked. */
  action: "prompt" | "remove_line" | "remove_mockup";
  /** True when the hit is a defect to record in the local record (a match in generated text). */
  defect: boolean;
}

interface Located {
  part: CardPart;
  index?: number;
  field?: string;
  text: string;
}

function factLeaves(value: unknown, path: string, into: Located[]): void {
  if (typeof value === "string" || (typeof value === "number" && Number.isFinite(value))) {
    into.push({ part: "environment_facts", field: path || "(facts)", text: String(value) });
  } else if (Array.isArray(value)) {
    value.forEach((item, i) => factLeaves(item, `${path}[${i}]`, into));
  } else if (value !== null && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) factLeaves(item, path ? `${path}.${key}` : key, into);
  }
}

function locate(card: CardText): Located[] {
  const out: Located[] = [];
  const one = (part: CardPart, text: unknown) => {
    if (text === undefined || text === null) return;
    if (typeof text !== "string") throw new ValidationError(`${part} must be a string`);
    out.push({ part, text });
  };
  const many = (part: CardPart, list: unknown) => {
    if (list === undefined || list === null) return;
    if (!Array.isArray(list) || !list.every((entry) => typeof entry === "string")) throw new ValidationError(`${part} must be a list of strings`);
    list.forEach((text, index) => out.push({ part, index, text }));
  };
  one("pain_point", card.pain_point);
  many("items", card.items);
  many("context_lines", card.context_lines);
  one("comment", card.comment);
  many("raw_observation", card.raw_observation);
  one("mockup", card.mockup);
  if (card.environment_facts !== undefined) factLeaves(card.environment_facts, "", out);
  return out;
}

const OFFER: Record<HitKind, "remove_only" | "remove_or_send_anyway"> = {
  record: "remove_only",
  email: "remove_only",
  path: "remove_only",
  date: "remove_or_send_anyway",
  amount: "remove_or_send_anyway",
};

/** Every hit in the card, in the order its parts are sent, each in text order. */
export function crossCheck(card: CardText, index: TokenIndex): Hit[] {
  const hits: Hit[] = [];
  for (const where of locate(card)) {
    const readable = (READABLE_PARTS as readonly string[]).includes(where.part);
    const found: { kind: HitKind; start: number; end: number; sources?: RecordSource[] }[] = [];
    for (const t of tokens(where.text)) {
      const sources = index.get(t.key);
      if (sources) found.push({ kind: "record", start: t.start, end: t.end, sources: RECORD_SOURCES.filter((s) => sources.has(s)) });
    }
    found.push(...findPatterns(where.text));
    found.sort((a, b) => a.start - b.start || a.end - b.end);
    for (const f of found) {
      hits.push({
        part: where.part,
        ...(where.index !== undefined ? { index: where.index } : {}),
        ...(where.field !== undefined ? { field: where.field } : {}),
        start: f.start,
        end: f.end,
        kind: f.kind,
        ...(f.sources ? { sources: f.sources } : {}),
        text: readable ? "readable" : "generated",
        offer: readable ? OFFER[f.kind] : null,
        action: readable ? "prompt" : where.part === "mockup" ? "remove_mockup" : "remove_line",
        defect: !readable,
      });
    }
  }
  return hits;
}

export interface CrossCheckResult {
  passed: boolean;
  hits: Hit[];
  /** How each record source was read; the check is complete only when none is partial or unavailable. */
  records: Record<RecordSource, SourceState>;
  complete: boolean;
}

/** The whole check: tokens from `records`, less the stop words, over every part of `card`. */
export function runCrossCheck(card: CardText, records: RecordTexts, stopWords: Set<string>): CrossCheckResult {
  const hits = crossCheck(card, buildTokenIndex(records, stopWords));
  const complete = RECORD_SOURCES.every((s) => records.states[s] === "read" || records.states[s] === "none");
  return { passed: hits.length === 0, hits, records: records.states, complete };
}
