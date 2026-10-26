// The technical write-up that follows a sent suggestion (docs/Plans/2026-10-25_suggestion-design.md,
// decisions 18, 19 and 22; lifecycle plan Phase 6). The lawyer plugin's technical-writer agent writes
// it, its spec-backstop agent checks it, and this module holds every step that code can decide:
//
//   1. writeUpBrief: what the writer is given, and all it is given: the card's lines exactly as sent
//      (the stored payload, store.ts), each with a line id, and the environment facts as sent, each
//      leaf with its key. It is offered only for a card a session was waiting on when it was
//      submitted (card.ts records `waited_at_submit`), only once per suggestion. A card submitted after
//      its session stopped waiting gets no write-up.
//   2. checkWriteUp: the writer's specification is a list of sentences, each citing what it rests on:
//      a card line id, an environment-fact key, or a shipped plugin file's path (as the plugin's own
//      file read serves it, from an install only), each with a short span quoted from that source.
//      verifyCitations checks that each sentence cites something, that each cited line, key and file
//      exists, and that each quoted span appears verbatim (whitespace runs read as one space) in the
//      cited source; a fact's quote must be its whole value. A specification that fails stands alone
//      at once. One that passes is held, and the backstop agent's input is returned: each sentence
//      with its cited spans and, for a card line or a fact, the whole line or value.
//   3. sendWriteUp: the backstop agent judges only whether each sentence is supported by what it
//      cites. The combined result (citations and judgement) passes only when both pass. Then the
//      decision 8 check runs over every sentence and every quoted span (crosscheck.ts), against this
//      computer's records; a sentence holding a match is removed with no prompt, and the removal is
//      logged in the local record by sentence number, kind and record source, never the text. The
//      specification is incoherent, and stands alone, when a match lies inside a quoted span (a
//      removal would cut what a sentence rests on), or when more than a quarter of its sentences are
//      removed (REMOVED_SHARE_LIMIT), or when the check could not read every record source. What is
//      left is stored in the local record with the combined backstop result and posted through
//      suggestion-attach-specification (send.ts attachWriteUp); a suggestion not yet sent carries its
//      write-up when it is.
//
// When the write-up stands alone, nothing is sent after the suggestion, and the local record says why
// (write_up.reason). Nothing here returns a record's text or a matched span.

import { ValidationError } from "../errors.js";
import { skillSourceRead } from "../files/skill-source.js";
import { PracticeStore } from "../practice/store.js";
import { findCard } from "./card.js";
import { loadStopWords, runCrossCheck, type HitKind } from "./crosscheck.js";
import { type RecordSource, type RecordTexts, readRecordTexts } from "./records.js";
import { type SendSeams, attachWriteUp } from "./send.js";
import { type SuggestionRecord, type SuggestionStore, type WriteUp, findSuggestion, loadStore, withStore } from "./store.js";

export const SPEC_FORMAT = "probanda-spec/1";
export const BACKSTOP_FORMAT = "probanda-backstop/1";

export const MAX_SENTENCES = 80;
export const MAX_SENTENCE = 600;
export const MAX_CITES = 4;
export const MAX_QUOTE = 300;
/** A quote from a card line or a file is at least this long, or the whole line. */
export const MIN_QUOTE = 8;
/** The specification is incoherent when removals take out more than this share of its sentences. */
export const REMOVED_SHARE_LIMIT = 0.25;

// ------------------------------------------------------------------ shapes --

export interface CardLine {
  id: string;
  /** What the line is on the card: pain point, item, constraint, evidence, observation, comment, skill. */
  kind: string;
  text: string;
}

export interface FactEntry {
  key: string;
  value: string;
}

export interface WriteUpBrief {
  card_lines: CardLine[];
  environment_facts: FactEntry[];
}

export interface Citation {
  card?: string;
  fact?: string;
  file?: string;
  quote: string;
}

export interface Sentence {
  n: number;
  text: string;
  /** The card item the sentence is about, by its number on the card. */
  item?: number;
  cites: Citation[];
}

export interface Specification {
  format: typeof SPEC_FORMAT;
  sentences: Sentence[];
}

export type CitationProblem =
  | "not_a_specification"
  | "no_citation"
  | "citation_shape"
  | "unknown_card_line"
  | "unknown_fact"
  | "unknown_file"
  | "quote_too_short"
  | "quote_not_found";

export interface CitationFailure {
  sentence: number | null;
  cite?: number;
  problem: CitationProblem;
}

export interface CitationResult {
  passed: boolean;
  failures: CitationFailure[];
}

/** One removal the record check made, logged in the local record: where and what kind, never the text. */
export interface Removal {
  sentence: number;
  in: "sentence" | "quote";
  cite?: number;
  kind: HitKind;
  sources?: RecordSource[];
}

// ------------------------------------------------------------------ brief --

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function payloadOf(record: SuggestionRecord): Record<string, unknown> {
  if (record.payload === null) throw new ValidationError("this suggestion was sent before this computer kept a copy, so it gets no technical write-up");
  const value = JSON.parse(record.payload) as unknown;
  if (!isObject(value)) throw new ValidationError("this suggestion's stored copy is not readable");
  return value;
}

/** The card's lines as sent, each with its id: p, i1.., c1.., o1.., comment, skill. */
export function cardLines(payload: Record<string, unknown>): CardLine[] {
  const lines: CardLine[] = [];
  const pain = payload.pain_point ?? payload.body;
  if (typeof pain === "string" && pain.trim()) lines.push({ id: "p", kind: "pain point", text: pain });
  if (Array.isArray(payload.items)) {
    payload.items.forEach((item, i) => {
      if (typeof item === "string") lines.push({ id: `i${i + 1}`, kind: "item", text: item });
    });
  }
  if (Array.isArray(payload.context_lines)) {
    payload.context_lines.filter(isObject).forEach((line, i) => {
      if (typeof line.text === "string") lines.push({ id: `c${i + 1}`, kind: line.kind === "constraint" ? "constraint" : "evidence", text: line.text });
    });
  }
  if (typeof payload.raw_observation === "string") {
    payload.raw_observation.split("\n").forEach((line, i) => {
      if (line.trim()) lines.push({ id: `o${i + 1}`, kind: "observation", text: line });
    });
  }
  if (typeof payload.comment === "string" && payload.comment.trim()) lines.push({ id: "comment", kind: "comment", text: payload.comment });
  if (typeof payload.skill === "string" && payload.skill.trim()) lines.push({ id: "skill", kind: "skill", text: payload.skill });
  return lines;
}

/** Every leaf of the environment facts, keyed as the card's check keys them (plugins[1].servers[0].visible[3]). */
export function factEntries(facts: unknown, path = "", into: FactEntry[] = []): FactEntry[] {
  if (typeof facts === "string" || typeof facts === "boolean" || (typeof facts === "number" && Number.isFinite(facts))) {
    into.push({ key: path, value: String(facts) });
  } else if (Array.isArray(facts)) {
    facts.forEach((item, i) => factEntries(item, `${path}[${i}]`, into));
  } else if (isObject(facts)) {
    for (const [key, item] of Object.entries(facts)) factEntries(item, path ? `${path}.${key}` : key, into);
  }
  return into;
}

export function briefOf(record: SuggestionRecord): WriteUpBrief {
  const payload = payloadOf(record);
  return { card_lines: cardLines(payload), environment_facts: factEntries(payload.environment_facts) };
}

// ------------------------------------------------------- the specification --

function bad(): never {
  throw new ValidationError("not_a_specification");
}

/** The writer's output, as an object or its JSON text, checked for shape only. Throws on any other shape. */
export function parseSpecification(raw: unknown): Specification {
  let value = raw;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      bad();
    }
  }
  if (!isObject(value) || !Array.isArray(value.sentences)) bad();
  const list = value.sentences as unknown[];
  if (list.length < 1 || list.length > MAX_SENTENCES) bad();
  const sentences = list.map((entry, i): Sentence => {
    if (!isObject(entry) || typeof entry.text !== "string" || !entry.text.trim() || entry.text.length > MAX_SENTENCE) bad();
    if (entry.item !== undefined && !(Number.isInteger(entry.item) && (entry.item as number) >= 1)) bad();
    const cites = entry.cites ?? [];
    if (!Array.isArray(cites) || cites.length > MAX_CITES) bad();
    return {
      n: i + 1,
      text: (entry.text as string).trim(),
      ...(entry.item !== undefined ? { item: entry.item as number } : {}),
      cites: cites.map((c) => {
        if (!isObject(c)) return { quote: "" } as Citation;
        const out: Citation = { quote: typeof c.quote === "string" ? c.quote : "" };
        for (const k of ["card", "fact", "file"] as const) if (typeof c[k] === "string") out[k] = c[k] as string;
        return out;
      }),
    };
  });
  return { format: SPEC_FORMAT, sentences };
}

const norm = (text: string) => text.replace(/\s+/g, " ").trim();

/** A shipped plugin file's text by its path in the skills tree, or null when it is not one. */
export type ShippedReader = (path: string) => string | null;

export function shippedReader(env: NodeJS.ProcessEnv, installRoot?: string): ShippedReader {
  return (path) => {
    try {
      const read = skillSourceRead(path, env, undefined, undefined, installRoot);
      // Only an installed plugin's own files count: never a checkout of the source.
      return read.shipped_from === "install" ? read.content : null;
    } catch {
      return null;
    }
  };
}

/** The deterministic half of the backstop: every sentence cites something, and every citation is real. */
export function verifyCitations(spec: Specification, brief: WriteUpBrief, readShipped: ShippedReader): CitationResult {
  const lines = new Map(brief.card_lines.map((l) => [l.id, l.text]));
  const facts = new Map(brief.environment_facts.map((f) => [f.key, f.value]));
  const files = new Map<string, string | null>();
  const failures: CitationFailure[] = [];
  for (const sentence of spec.sentences) {
    if (sentence.cites.length === 0) {
      failures.push({ sentence: sentence.n, problem: "no_citation" });
      continue;
    }
    sentence.cites.forEach((cite, i) => {
      const fail = (problem: CitationProblem) => failures.push({ sentence: sentence.n, cite: i + 1, problem });
      const named = (["card", "fact", "file"] as const).filter((k) => cite[k] !== undefined);
      const quote = norm(cite.quote);
      if (named.length !== 1 || !quote || cite.quote.length > MAX_QUOTE) return fail("citation_shape");
      if (cite.fact !== undefined) {
        const value = facts.get(cite.fact);
        if (value === undefined) return fail("unknown_fact");
        if (norm(value) !== quote) return fail("quote_not_found");
        return;
      }
      let source: string | null | undefined;
      if (cite.card !== undefined) {
        source = lines.get(cite.card);
        if (source === undefined) return fail("unknown_card_line");
      } else {
        const path = cite.file as string;
        if (!files.has(path)) files.set(path, readShipped(path));
        source = files.get(path);
        if (source === null || source === undefined) return fail("unknown_file");
      }
      const whole = norm(source);
      if (quote.length < MIN_QUOTE && quote !== whole) return fail("quote_too_short");
      if (!whole.includes(quote)) return fail("quote_not_found");
    });
  }
  return { passed: failures.length === 0, failures };
}

/** What the backstop agent is given: each sentence with what it cites, and for a card line or a fact, the whole of it. */
export function backstopInput(spec: Specification, brief: WriteUpBrief): Record<string, unknown> {
  const lines = new Map(brief.card_lines.map((l) => [l.id, l]));
  const facts = new Map(brief.environment_facts.map((f) => [f.key, f.value]));
  return {
    sentences: spec.sentences.map((s) => ({
      n: s.n,
      text: s.text,
      cites: s.cites.map((c) =>
        c.card !== undefined
          ? { card: c.card, line_kind: lines.get(c.card)?.kind, line: lines.get(c.card)?.text, quote: c.quote }
          : c.fact !== undefined
            ? { fact: c.fact, value: facts.get(c.fact), quote: c.quote }
            : { file: c.file, quote: c.quote }
      ),
    })),
  };
}

// --------------------------------------------------------- the judgement --

export interface Judgement {
  passed: boolean;
  unsupported: number[];
}

/** The backstop agent's judgement, {sentences: [{n, supported}]}: it passes only when every sentence is named and supported. */
export function readJudgement(raw: unknown, spec: Specification): Judgement {
  let value = raw;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      value = null;
    }
  }
  const said = new Map<number, boolean>();
  if (isObject(value) && Array.isArray(value.sentences)) {
    for (const entry of value.sentences) {
      if (isObject(entry) && Number.isInteger(entry.n) && typeof entry.supported === "boolean" && !said.has(entry.n as number)) {
        said.set(entry.n as number, entry.supported);
      }
    }
  }
  const unsupported = spec.sentences.filter((s) => said.get(s.n) !== true).map((s) => s.n);
  return { passed: unsupported.length === 0, unsupported };
}

// ----------------------------------------------------- the record check --

export type Incoherence = "removal_in_cited_span" | "too_much_removed" | "records_unreadable";

export interface RemovalResult {
  spec: Specification;
  removals: Removal[];
  incoherent: Incoherence | null;
}

/** Decision 8's check over every sentence and every quoted span, removing each sentence a match lies in. */
export function removeMatches(spec: Specification, records: RecordTexts, stopWords: Set<string>): RemovalResult {
  const texts = spec.sentences.map((s) => s.text);
  const quotes: Array<{ sentence: number; cite: number }> = [];
  const quoteTexts: string[] = [];
  for (const s of spec.sentences) {
    s.cites.forEach((c, i) => {
      quotes.push({ sentence: s.n, cite: i + 1 });
      quoteTexts.push(c.quote);
    });
  }
  const inText = runCrossCheck({ raw_observation: texts }, records, stopWords);
  const inQuotes = runCrossCheck({ raw_observation: quoteTexts }, records, stopWords);
  if (!inText.complete || !inQuotes.complete) return { spec, removals: [], incoherent: "records_unreadable" };
  const removals: Removal[] = [];
  for (const hit of inText.hits) {
    removals.push({ sentence: spec.sentences[hit.index as number].n, in: "sentence", kind: hit.kind, ...(hit.sources ? { sources: hit.sources } : {}) });
  }
  for (const hit of inQuotes.hits) {
    const at = quotes[hit.index as number];
    removals.push({ sentence: at.sentence, in: "quote", cite: at.cite, kind: hit.kind, ...(hit.sources ? { sources: hit.sources } : {}) });
  }
  const removed = new Set(removals.map((r) => r.sentence));
  const kept = { format: SPEC_FORMAT, sentences: spec.sentences.filter((s) => !removed.has(s.n)) } as Specification;
  let incoherent: Incoherence | null = null;
  if (removals.some((r) => r.in === "quote")) incoherent = "removal_in_cited_span";
  else if (removed.size > spec.sentences.length * REMOVED_SHARE_LIMIT) incoherent = "too_much_removed";
  return { spec: kept, removals, incoherent };
}

// ------------------------------------------------------------- the steps --

export interface WriteUpDeps {
  env: NodeJS.ProcessEnv;
  records?: () => Promise<RecordTexts>;
  stopWords?: () => Set<string>;
  readShipped?: ShippedReader;
  seams?: SendSeams;
  now?: () => Date;
}

const nowIso = (deps: WriteUpDeps) => (deps.now ? deps.now() : new Date()).toISOString();

/** The suggestion record a submitted card sent, or null when the card has none (it was never submitted). */
function sentRecord(store: SuggestionStore, cardId: string): { record: SuggestionRecord; waited: boolean } | null {
  const card = findCard(store, cardId);
  if (card.state !== "submitted" || card.suggestion_record_id === null) return null;
  return { record: findSuggestion(store, card.suggestion_record_id), waited: card.waited_at_submit === true };
}

function standAlone(w: WriteUp, reason: NonNullable<WriteUp["reason"]>, at: string): void {
  w.state = "stands_alone";
  w.reason = reason;
  w.updated_at = at;
  delete w.draft;
}

export type BriefResult =
  | { write: true; card_id: string; brief: WriteUpBrief }
  | { write: false; reason: "not_submitted" | "not_waited_on" | "already_written" | "no_copy" };

/** Step 1: the writer's whole input, offered once per suggestion and only for a card a session was waiting on. */
export async function writeUpBrief(cardId: string, deps: WriteUpDeps): Promise<BriefResult> {
  const at = nowIso(deps);
  return withStore(deps.env, (store): BriefResult => {
    const sent = sentRecord(store, cardId);
    if (sent === null) return { write: false, reason: "not_submitted" };
    if (!sent.waited) return { write: false, reason: "not_waited_on" };
    if (sent.record.write_up) return { write: false, reason: "already_written" };
    if (sent.record.payload === null) return { write: false, reason: "no_copy" };
    const brief = briefOf(sent.record);
    sent.record.write_up = { state: "writing", started_at: at, updated_at: at, reason: null, removals: [] };
    return { write: true, card_id: cardId, brief };
  });
}

function writeUpOf(record: SuggestionRecord, want: WriteUp["state"]): WriteUp {
  const w = record.write_up;
  if (!w || w.state !== want) {
    throw new ValidationError(`this suggestion's technical write-up is not at that step (${w ? w.state : "not started"}); nothing was changed`);
  }
  return w;
}

export type CheckResult =
  | { verified: true; card_id: string; backstop_input: Record<string, unknown> }
  | { verified: false; card_id: string };

/** Step 2: verify the writer's citations. A failure stands alone; a pass is held for the backstop. */
export async function checkWriteUp(cardId: string, raw: unknown, deps: WriteUpDeps): Promise<CheckResult> {
  const store = await loadStore(deps.env);
  const sent = sentRecord(store, cardId);
  if (sent === null) throw new ValidationError("this card was not submitted, so it has no technical write-up");
  writeUpOf(sent.record, "writing");
  const brief = briefOf(sent.record);
  let spec: Specification | null = null;
  try {
    spec = parseSpecification(raw);
  } catch {
    spec = null;
  }
  const reader = deps.readShipped ?? shippedReader(deps.env, deps.seams?.installRoot);
  const citations: CitationResult = spec === null
    ? { passed: false, failures: [{ sentence: null, problem: "not_a_specification" }] }
    : verifyCitations(spec, brief, reader);
  const at = nowIso(deps);
  await withStore(deps.env, (s) => {
    const record = findSuggestion(s, sent.record.record_id);
    const w = writeUpOf(record, "writing");
    w.citations = citations;
    if (!citations.passed || spec === null) {
      record.backstop_result = combined(spec?.sentences.length ?? 0, citations, null, null);
      standAlone(w, "backstop_failed", at);
      return;
    }
    w.state = "checked";
    w.updated_at = at;
    w.draft = spec;
  });
  if (!citations.passed || spec === null) return { verified: false, card_id: cardId };
  return { verified: true, card_id: cardId, backstop_input: backstopInput(spec, brief) };
}

/** The combined backstop result: what is stored, and sent when it passes. It holds no text. */
export function combined(sentences: number, citations: CitationResult, judgement: Judgement | null, check: RemovalResult | null): Record<string, unknown> {
  const passed = citations.passed && judgement !== null && judgement.passed && check !== null && check.incoherent === null;
  return {
    format: BACKSTOP_FORMAT,
    passed,
    sentences,
    citations,
    judgement: judgement === null ? { judged: false } : { judged: true, ...judgement },
    record_check: check === null
      ? { ran: false }
      : { ran: true, removed: [...new Set(check.removals.map((r) => r.sentence))], incoherent: check.incoherent },
  };
}

export type SendWriteUpResult = { card_id: string; outcome: "sent" | "waiting" | "stands_alone" };

/** Step 3: take the backstop's judgement, run the record check with removal, store, and send. */
export async function sendWriteUp(cardId: string, rawJudgement: unknown, deps: WriteUpDeps): Promise<SendWriteUpResult> {
  const store = await loadStore(deps.env);
  const sent = sentRecord(store, cardId);
  if (sent === null) throw new ValidationError("this card was not submitted, so it has no technical write-up");
  const w0 = writeUpOf(sent.record, "checked");
  const spec = w0.draft as Specification;
  const judgement = readJudgement(rawJudgement, spec);
  let check: RemovalResult | null = null;
  if (judgement.passed) {
    const stopWords = deps.stopWords ? deps.stopWords() : loadStopWords(deps.env);
    const records = deps.records ? await deps.records() : await readRecordTexts(new PracticeStore(deps.env), deps.env);
    check = removeMatches(spec, records, stopWords);
  }
  const at = nowIso(deps);
  const recordId = sent.record.record_id;
  const outcome = await withStore(deps.env, (s): "send" | "stands_alone" => {
    const record = findSuggestion(s, recordId);
    const w = writeUpOf(record, "checked");
    const result = combined(spec.sentences.length, w.citations as CitationResult, judgement, check);
    record.backstop_result = result;
    if (check) w.removals = check.removals;
    if (!judgement.passed) {
      standAlone(w, "backstop_failed", at);
      return "stands_alone";
    }
    if (check === null || check.incoherent !== null) {
      standAlone(w, check?.incoherent === "records_unreadable" ? "records_unreadable" : "incoherent", at);
      return "stands_alone";
    }
    if (record.withdrawn_at !== null) {
      standAlone(w, "withdrawn", at);
      return "stands_alone";
    }
    record.specification = JSON.stringify(check.spec);
    w.state = "waiting_to_send";
    w.updated_at = at;
    delete w.draft;
    return "send";
  });
  if (outcome === "stands_alone") return { card_id: cardId, outcome };
  const posted = await attachWriteUp(recordId, deps.env, deps.seams ?? {});
  return { card_id: cardId, outcome: posted === "sent" ? "sent" : posted === "stands_alone" ? "stands_alone" : "waiting" };
}
