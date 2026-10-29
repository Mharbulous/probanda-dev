// The suggestion card (docs/Plans/2026-10-25_suggestion-design.md, decisions 2, 5 to 13 and 22 to 28;
// lifecycle plan Phase 4): `Suggestion-<id>.html` beside the suggestion store, a file Probanda creates
// (Commandment 7), shown to the practitioner only as a file card.
//
// A card is one record of kind "card" in the one suggestion store (store.ts; Commandment 5: one list,
// each record naming its kind). It holds what the card shows: the origin, the pain point, the items
// (each with whether it changes how something looks), the constraint and evidence lines, the raw
// observation, the comment, the environment facts and the mockup now on the card; and, per block,
// whether it holds words the practitioner did not use ("our guess, edit if wrong"). Building one
// (buildCard) runs the full decision 8 check over everything it would send and refuses while a match
// remains in text the practitioner reads (decision 22); a match in a part the tool generated is
// dropped and recorded as a defect, with no text (decision 28).
//
// The card's buttons post through the page API (../page-api/server.ts), which runs the functions here
// in whichever data server process holds the port. Every click is completed here alone, with no agent:
//   - Submit (submitCard) saves the practitioner's edits, runs the click-time check (decisions 8 and
//     28) and, when nothing is left to ask, saves the exact payload and sends it (send.ts). A record
//     token, email or path in readable text comes back as a prompt offering Remove only; a date or an
//     amount offers Remove and Send anyway (resolvePrompt). Remove deletes the text from the stored card
//     and puts its bracket in its place. A match in the environment facts, the raw observation or the
//     mockup is removed unasked and recorded as a defect.
//   - Dismiss (dismissCard) sends nothing, records a "dismissal" record (for decision 3's suppression),
//     and Restore Suggestion (restoreCard) takes it back (decision 9).
// An AI-noticed card (decisions 2 to 4) is built for one observation (observation.ts): its raw
// observation comes from that record, never from the session, its fingerprint is that record's, and
// it is built only while the daily cap and suppression allow it, in the same write that marks the
// observation shown.
//   - Show a mockup (requestMockup) only marks a request in the store. The agent's wait tool
//     (waitForCard), polling the store from its own process, takes it and returns; the agent writes the
//     mockup through attachMockup and waits again. While no agent is waiting, the page greys the link.
//   - "Not like this, because..." on the mockup's page (rejectMockup) becomes a constraint line, the
//     mockup's page is deleted, and the link comes back, up to three times (decision 24).
// Waiting is shared through the store: the wait tool keeps `waiter_until` a minute ahead while it
// polls, so every process reads the same answer to "is an agent waiting?".

import { randomUUID } from "node:crypto";
import { existsSync, unlinkSync } from "node:fs";
import { join } from "node:path";

import { NotFoundError, ValidationError } from "../errors.js";
import { writeTextAtomic } from "../knowledge/sidecar.js";
import { pageApiCardToken, pageApiPort } from "../page-api/token.js";
import { PracticeStore } from "../practice/store.js";
import { type CardPart, type CardText, type CrossCheckResult, type Hit, type HitKind, loadStopWords, runCrossCheck } from "./crosscheck.js";
import { cardUrl, renderCardHtml } from "./card-page.js";
import { checkMockup, loadPlaceholders, renderMockupPage } from "./mockup.js";
import { RECORD_SOURCES, type RecordSource, type RecordTexts, readRecordTexts } from "./records.js";
import { type SuggestionFields, pluginRelease, submitSuggestion } from "./send.js";
import { type Fingerprint, type ObservationSeams, claimObservation, observationForCard, pluginsOf, sessionIdOf } from "./observation.js";
import { type StoreRecord, type SuggestionStore, CARD_STATUS, cardStatus, isHeld, isSuggestion, loadStore, storeDir, withStore } from "./store.js";

export const CARD_KIND = "card";
export const DISMISSAL_KIND = "dismissal";

/** Decision 27's bracket categories, the only text a removed identifier leaves. */
export const BRACKETS = ["client", "matter", "person", "document", "file", "date", "amount"] as const;
export type Bracket = (typeof BRACKETS)[number];

/** After this many rejected mockups the link does not come back (decision 24: it comes back up to three times). */
export const MAX_MOCKUP_RETURNS = 3;
/** How long a wait tool's last poll counts as an agent waiting. */
export const WAITER_TTL_MS = 60_000;
/** A card left "sending" this long (its process died mid-send) reads as open again. */
const STALE_SENDING_MS = 10 * 60_000;

const MAX_ITEMS = 10;
const MAX_CONTEXT_LINES = 20;
const MAX_OBSERVATION_LINES = 50;
/** A block's length as the cloud takes it; an edit may run longer, and the send then refuses it. */
const MAX_TEXT = 2000;
const MAX_EDIT = 20_000;

export interface CardBlock {
  id: string;
  text: string;
  /** True when the block holds words the practitioner did not use: the card labels it "our guess, edit if wrong". */
  guess: boolean;
}
export interface CardItem extends CardBlock {
  /** Whether the item changes how something looks (layout, colour, typography or page structure). */
  visual: boolean;
}
export interface CardContextLine extends CardBlock {
  kind: "constraint" | "evidence";
}

/** A match found in generated text and removed unasked. It names where and what kind, never the text. */
export interface CardDefect {
  at: string;
  when: "build" | "click";
  part: CardPart;
  index?: number;
  field?: string;
  kind: HitKind;
  sources?: RecordSource[];
}

/** A date or an amount the practitioner chose to send anyway, by its block and its text. */
interface SendAnyway {
  part: ReadablePart;
  id: string | null;
  kind: "date" | "amount";
  text: string;
}

export type CardState = "open" | "sending" | "submitted" | "dismissed";

export interface CardRecord {
  kind: "card";
  record_id: string;
  created_at: string;
  state: CardState;
  state_since: string;
  origin: "practitioner" | "probanda";
  source: "user" | "assisted" | "llm";
  skill: string | null;
  pain_point: CardBlock;
  items: CardItem[];
  context_lines: CardContextLine[];
  raw_observation: string[];
  comment: string;
  environment_facts: Record<string, unknown>;
  /** The mockup now on the card: the only one that travels (decision 26). */
  mockup: { n: number; html: string } | null;
  mockups_made: number;
  mockups_rejected: number;
  mockup_request: { at: string; taken_at: string | null } | null;
  waiter_until: string | null;
  send_anyway: SendAnyway[];
  defects: CardDefect[];
  /** Each Submit whose check could not read every record source, with each source's state: the raw
   * cause, kept here only. Absent on a card that never had one. */
  check_failures?: Array<{ at: string; records: CrossCheckResult["records"] }>;
  /** The sent suggestion's record (store.ts), once Submit saved it. */
  suggestion_record_id: string | null;
  /** Whether a session was waiting on the card when Submit claimed it: only then is a technical
   * write-up written (specification.ts; decision 18). Absent on a card never submitted. */
  waited_at_submit?: boolean;
  next_line: number;
  /** An AI-noticed card's fingerprint, its observation and the session it was raised in; absent on any other card. */
  fingerprint?: Fingerprint;
  observation_id?: string;
  session_id?: string;
  /** True when it was left unanswered at the end of its session, which counts as dismissed (decision 3). */
  unanswered?: boolean;
}

export interface DismissalRecord {
  kind: "dismissal";
  record_id: string;
  created_at: string;
  card_id: string;
  origin: CardRecord["origin"];
  /** An AI-noticed card's fingerprint (observation.ts); null on any other card. */
  fingerprint: Record<string, unknown> | null;
  plugin_version: string | null;
  /** True when the card was left unanswered at the end of its session rather than dismissed by a click. */
  unanswered?: boolean;
}

export function isCard(record: StoreRecord): record is CardRecord & StoreRecord {
  return record.kind === CARD_KIND;
}

export function findCard(store: SuggestionStore, cardId: string): CardRecord {
  const record = store.records.find((r) => r.record_id === cardId);
  if (!record || !isCard(record)) throw new NotFoundError(`no suggestion card ${cardId} on this computer`, "not_found");
  return record as CardRecord;
}

export function cardPath(cardId: string, env: NodeJS.ProcessEnv = process.env): string {
  return join(storeDir(env), `Suggestion-${cardId}.html`);
}

export function mockupPagePath(cardId: string, n: number, env: NodeJS.ProcessEnv = process.env): string {
  return join(storeDir(env), `Suggestion-${cardId}-mockup-${n}.html`);
}

// ------------------------------------------------------------------ deps --

/** What a check needs: this computer's records and the stop lists; and, for sending, send.ts's seams. */
export interface CardDeps {
  env: NodeJS.ProcessEnv;
  records?: () => Promise<RecordTexts>;
  stopWords?: () => Set<string>;
  placeholders?: () => string[];
  seams?: ObservationSeams;
  now?: () => Date;
}

function nowOf(deps: Pick<CardDeps, "now">): Date {
  return deps.now ? deps.now() : new Date();
}

async function recordsOf(deps: CardDeps): Promise<{ records: RecordTexts; stopWords: Set<string> }> {
  // The lists first: a check that cannot run says so before any record is read.
  const stopWords = deps.stopWords ? deps.stopWords() : loadStopWords(deps.env);
  const records = deps.records ? await deps.records() : await readRecordTexts(new PracticeStore(deps.env), deps.env);
  return { records, stopWords };
}

// ------------------------------------------------------------ validation --

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function onlyKeys(label: string, value: Record<string, unknown>, keys: string[]): void {
  const extra = Object.keys(value).find((key) => !keys.includes(key));
  if (extra) throw new ValidationError(`${label} has an unknown field "${extra}"`);
}

function text(label: string, value: unknown, { empty = false, max = MAX_TEXT } = {}): string {
  if (typeof value !== "string") throw new ValidationError(`${label} must be text`);
  const trimmed = value.trim();
  if (!empty && !trimmed) throw new ValidationError(`${label} must not be empty`);
  if (trimmed.length > max) throw new ValidationError(`${label} is over ${max} characters`);
  return trimmed;
}

function flag(label: string, value: unknown): boolean {
  if (value === undefined) return false;
  if (typeof value !== "boolean") throw new ValidationError(`${label} must be true or false`);
  return value;
}

// A bracket in square brackets holds one of decision 27's categories and nothing else.
const ANY_BRACKET = /\[([A-Za-z][A-Za-z ]{0,30})\]/g;

function checkBrackets(label: string, value: string): void {
  for (const m of value.matchAll(ANY_BRACKET)) {
    if (!(BRACKETS as readonly string[]).includes(m[1])) {
      throw new ValidationError(`${label} holds the bracket [${m[1]}]; a removed identifier leaves only one of ${BRACKETS.map((b) => `[${b}]`).join(", ")}`);
    }
  }
}

export interface CardInput {
  origin: CardRecord["origin"];
  source: CardRecord["source"];
  skill: string | null;
  pain_point: { text: string; guess: boolean };
  items: Array<{ text: string; guess: boolean; visual: boolean }>;
  context_lines: Array<{ kind: "constraint" | "evidence"; text: string; guess: boolean }>;
  raw_observation: string[];
  tool_names: string[] | undefined;
  held_id: string | null;
  /** For an AI-noticed card: the observation it shows and the session the reminder named. */
  observation_id: string | null;
  session_id: string | null;
}

/** suggestion_card__build's arguments, checked. */
export function cardInput(args: Record<string, unknown>): CardInput {
  onlyKeys("the card", args, ["origin", "source", "skill", "pain_point", "items", "context_lines", "raw_observation", "tool_names", "held_id", "observation_id", "session_id"]);
  if (args.origin !== "practitioner" && args.origin !== "probanda") throw new ValidationError("origin must be practitioner or probanda");
  if (args.source !== "user" && args.source !== "assisted" && args.source !== "llm") throw new ValidationError("source must be user, assisted or llm");
  const skill = args.skill === undefined ? null : text("skill", args.skill);
  if (!isObject(args.pain_point)) throw new ValidationError("pain_point must be {text, guess}");
  onlyKeys("pain_point", args.pain_point, ["text", "guess"]);
  const pain = { text: text("pain_point.text", args.pain_point.text), guess: flag("pain_point.guess", args.pain_point.guess) };
  checkBrackets("pain_point.text", pain.text);
  if (!Array.isArray(args.items) || args.items.length < 1 || args.items.length > MAX_ITEMS) {
    throw new ValidationError(`items must be a list of 1 to ${MAX_ITEMS} items`);
  }
  const items = args.items.map((item, i) => {
    const label = `items[${i}]`;
    if (!isObject(item)) throw new ValidationError(`${label} must be {text, guess, visual}`);
    onlyKeys(label, item, ["text", "guess", "visual"]);
    const out = { text: text(`${label}.text`, item.text), guess: flag(`${label}.guess`, item.guess), visual: flag(`${label}.visual`, item.visual) };
    checkBrackets(`${label}.text`, out.text);
    return out;
  });
  const lines = args.context_lines ?? [];
  if (!Array.isArray(lines) || lines.length > MAX_CONTEXT_LINES) throw new ValidationError(`context_lines must be a list of at most ${MAX_CONTEXT_LINES} lines`);
  const contextLines = lines.map((line, i) => {
    const label = `context_lines[${i}]`;
    if (!isObject(line)) throw new ValidationError(`${label} must be {kind, text, guess}`);
    onlyKeys(label, line, ["kind", "text", "guess"]);
    if (line.kind !== "constraint" && line.kind !== "evidence") throw new ValidationError(`${label}.kind must be constraint or evidence`);
    const out = { kind: line.kind as "constraint" | "evidence", text: text(`${label}.text`, line.text), guess: flag(`${label}.guess`, line.guess) };
    checkBrackets(`${label}.text`, out.text);
    return out;
  });
  const observation = args.raw_observation ?? [];
  if (!Array.isArray(observation) || observation.length > MAX_OBSERVATION_LINES) {
    throw new ValidationError(`raw_observation must be a list of at most ${MAX_OBSERVATION_LINES} lines`);
  }
  const rawObservation = observation.map((line, i) => text(`raw_observation[${i}]`, line));
  let toolNames: string[] | undefined;
  if (args.tool_names !== undefined) {
    if (!Array.isArray(args.tool_names) || !args.tool_names.every((n) => typeof n === "string")) throw new ValidationError("tool_names must be a list of tool names");
    toolNames = args.tool_names as string[];
  }
  const heldId = args.held_id === undefined ? null : text("held_id", args.held_id);
  let observationId: string | null = null;
  let sessionId: string | null = null;
  if (args.observation_id !== undefined) {
    // An AI-noticed card: its raw observation and skill come from the observation's record alone.
    observationId = text("observation_id", args.observation_id);
    sessionId = sessionIdOf(args.session_id);
    if (args.origin !== "probanda" || args.source !== "llm") throw new ValidationError("a card for an observation has origin probanda and source llm");
    if (args.raw_observation !== undefined) throw new ValidationError("a card for an observation takes its raw observation from the observation, so raw_observation is not given");
    if (args.skill !== undefined) throw new ValidationError("a card for an observation takes its skill from the observation, so skill is not given");
    if (heldId !== null) throw new ValidationError("a card for an observation offers no held draft");
  } else if (args.session_id !== undefined) {
    throw new ValidationError("session_id goes only with observation_id");
  }
  return {
    origin: args.origin, source: args.source, skill, pain_point: pain, items, context_lines: contextLines, raw_observation: rawObservation,
    tool_names: toolNames, held_id: heldId, observation_id: observationId, session_id: sessionId,
  };
}

// ------------------------------------------------------------- the check --

const READABLE = ["pain_point", "items", "context_lines", "comment"] as const;
type ReadablePart = (typeof READABLE)[number];

/** Everything the card would send, as the cross-check reads it. */
export function cardText(card: CardRecord): CardText {
  return {
    pain_point: card.pain_point.text,
    items: card.items.map((i) => i.text),
    context_lines: card.context_lines.map((l) => l.text),
    ...(card.comment ? { comment: card.comment } : {}),
    ...(card.raw_observation.length ? { raw_observation: card.raw_observation } : {}),
    ...(card.mockup ? { mockup: card.mockup.html } : {}),
    environment_facts: card.environment_facts,
  };
}

/** One question the card asks about its own text (decision 8). */
export interface CardPrompt {
  part: ReadablePart;
  /** The item's or line's id; null for the pain point and the comment. */
  id: string | null;
  start: number;
  end: number;
  kind: HitKind;
  offer: "remove_only" | "remove_or_send_anyway";
  /** The matched text, shown on the card only. It never leaves this computer's page. */
  text: string;
}

function blockOf(card: CardRecord, part: ReadablePart, index: number | undefined): { id: string | null; text: string } {
  if (part === "pain_point") return { id: null, text: card.pain_point.text };
  if (part === "comment") return { id: null, text: card.comment };
  const block = (part === "items" ? card.items : card.context_lines)[index ?? -1];
  return { id: block.id, text: block.text };
}

function isReadable(part: CardPart): part is ReadablePart {
  return (READABLE as readonly string[]).includes(part);
}

/** The prompts the card's readable text still needs, less the dates and amounts sent anyway. */
function promptsOf(card: CardRecord, hits: Hit[]): CardPrompt[] {
  const prompts: CardPrompt[] = [];
  for (const hit of hits) {
    if (!isReadable(hit.part) || hit.offer === null) continue;
    const block = blockOf(card, hit.part, hit.index);
    const span = block.text.slice(hit.start, hit.end);
    const exempt = (hit.kind === "date" || hit.kind === "amount") &&
      card.send_anyway.some((s) => s.part === hit.part && s.id === block.id && s.kind === hit.kind && s.text === span);
    if (exempt) continue;
    prompts.push({ part: hit.part, id: block.id, start: hit.start, end: hit.end, kind: hit.kind, offer: hit.offer, text: span });
  }
  return prompts;
}

const DROPPED = Symbol("dropped");

/** Marks the environment fact at `field` (plugins[1].servers[0].visible[3]) for removal. */
function markFact(facts: Record<string, unknown>, field: string): void {
  const steps = [...field.matchAll(/([^.[\]]+)|\[(\d+)\]/g)].map((m) => (m[2] !== undefined ? Number(m[2]) : m[1]));
  let node: unknown = facts;
  for (let i = 0; i < steps.length - 1; i++) {
    node = (node as Record<string | number, unknown> | undefined)?.[steps[i] as never];
    if (node === undefined || node === null) return;
  }
  const last = steps[steps.length - 1];
  if (node !== null && typeof node === "object" && last !== undefined) (node as Record<string | number, unknown>)[last as never] = DROPPED;
}

function sweep(value: unknown): unknown {
  if (Array.isArray(value)) return value.filter((v) => v !== DROPPED).map(sweep);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== DROPPED).map(([k, v]) => [k, sweep(v)]));
  }
  return value;
}

/** Removes every generated part a hit falls in, unasked, and records each as a defect (decision 28). */
function dropGenerated(card: CardRecord, hits: Hit[], when: CardDefect["when"], at: string): void {
  const generated = hits.filter((h) => !isReadable(h.part));
  if (!generated.length) return;
  const lines = new Set<number>();
  for (const hit of generated) {
    card.defects.push({
      at, when, part: hit.part, kind: hit.kind,
      ...(hit.index !== undefined ? { index: hit.index } : {}),
      ...(hit.field !== undefined ? { field: hit.field } : {}),
      ...(hit.sources ? { sources: hit.sources } : {}),
    });
    if (hit.part === "raw_observation" && hit.index !== undefined) lines.add(hit.index);
    else if (hit.part === "mockup") card.mockup = null;
    else if (hit.part === "environment_facts" && hit.field) markFact(card.environment_facts, hit.field);
  }
  card.raw_observation = card.raw_observation.filter((_, i) => !lines.has(i));
  card.environment_facts = sweep(card.environment_facts) as Record<string, unknown>;
}

// ------------------------------------------------------------- building --

function newCard(input: CardInput, facts: Record<string, unknown>, at: string): CardRecord {
  return {
    kind: "card", record_id: randomUUID(), created_at: at, state: "open", state_since: at,
    origin: input.origin, source: input.source, skill: input.skill,
    pain_point: { id: "p", ...input.pain_point },
    items: input.items.map((item, i) => ({ id: `i${i + 1}`, ...item })),
    context_lines: input.context_lines.map((line, i) => ({ id: `c${i + 1}`, ...line })),
    raw_observation: input.raw_observation,
    comment: "",
    environment_facts: facts,
    mockup: null, mockups_made: 0, mockups_rejected: 0, mockup_request: null, waiter_until: null,
    send_anyway: [], defects: [], suggestion_record_id: null, next_line: input.context_lines.length + 1,
  };
}

/** Each record source by the plain category name a refusal may give, never a path or an error. */
export const SOURCE_CATEGORY: Record<RecordSource, string> = {
  client: "client",
  matter: "matter",
  contact: "contact",
  folder_name: "folder name",
  document_title: "document title",
  file_name: "file name",
};

/** The categories of the record sources a check could not read in full; empty when it read them all. */
export function unreadSources(states: CrossCheckResult["records"]): string[] {
  return RECORD_SOURCES.filter((s) => states[s] === "partial" || states[s] === "unavailable").map((s) => SOURCE_CATEGORY[s]);
}

export type BuildResult =
  | { built: true; card_id: string; card_path: string; card_url: string }
  | { built: false; hits: Array<Omit<CardPrompt, "text"> & { index?: number }> }
  | { built: false; reason: "records_unreadable"; unreadable: string[] }
  /** An AI-noticed card the daily cap or suppression does not allow now, or whose observation was already shown. */
  | { built: false; reason: "not_raised" };

/** Builds a card from the session's scrubbed draft. Refused, with nothing saved, when the full check
 * could not read every record source (decision 22: building is done only when the full check passes),
 * or while it finds a match in text the practitioner would read; a match in generated text is dropped
 * and recorded. A held draft named by held_id leaves the store in the same write, so it is offered once. */
export async function buildCard(input: CardInput, facts: Record<string, unknown>, deps: CardDeps): Promise<BuildResult> {
  const now = nowOf(deps);
  const at = now.toISOString();
  if (input.observation_id !== null) {
    const observation = await observationForCard(input.observation_id, deps.env);
    if (observation.displayed_at !== null) return { built: false, reason: "not_raised" };
    input = { ...input, raw_observation: [...observation.raw_observation], skill: observation.fingerprint.skill ?? null };
  }
  const card = newCard(input, structuredClone(facts), at);
  const { records, stopWords } = await recordsOf(deps);
  const check = runCrossCheck(cardText(card), records, stopWords);
  if (!check.complete) return { built: false, reason: "records_unreadable", unreadable: unreadSources(check.records) };
  const readable = check.hits.filter((h) => isReadable(h.part));
  if (readable.length) {
    // The session wrote this text: it is told where each match lies, never what it matched.
    return {
      built: false,
      hits: readable.map((h) => ({ part: h.part as ReadablePart, id: blockOf(card, h.part as ReadablePart, h.index).id, ...(h.index !== undefined ? { index: h.index } : {}), start: h.start, end: h.end, kind: h.kind, offer: h.offer as CardPrompt["offer"] })),
    };
  }
  dropGenerated(card, check.hits, "build", at);
  const plugins = input.observation_id !== null ? pluginsOf(deps.seams ?? {}) : [];
  const saved = await withStore(deps.env, (store) => {
    if (input.observation_id !== null) {
      // The cap and suppression are checked again here, in the write that marks the observation shown.
      const claim = claimObservation(store, input.observation_id, card.record_id, input.session_id as string, plugins, now);
      if (!claim.claimed) return false;
      card.fingerprint = claim.fingerprint;
      card.observation_id = input.observation_id;
      card.session_id = input.session_id as string;
    }
    if (input.held_id !== null) {
      const index = store.records.findIndex((r) => isHeld(r) && r.record_id === input.held_id);
      if (index < 0) throw new ValidationError(`no held suggestion ${input.held_id} on this computer`, "not_found");
      store.records.splice(index, 1);
    }
    store.records.push(card as unknown as StoreRecord);
    return true;
  });
  if (!saved) return { built: false, reason: "not_raised" };
  const path = writeCardPage(card, deps.env);
  return { built: true, card_id: card.record_id, card_path: path, card_url: cardUrl(pageApiPort(deps.env), card.record_id, pageApiCardToken(card.record_id, deps.env)) };
}

/** Writes the card's page from the record as it is and returns its path. */
export function writeCardPage(card: CardRecord, env: NodeJS.ProcessEnv): string {
  const path = cardPath(card.record_id, env);
  writeTextAtomic(path, renderCardHtml(card, pageApiPort(env), pageApiCardToken(card.record_id, env)));
  return path;
}

// ---------------------------------------------------------- page state --

function waiting(card: CardRecord, now: Date): boolean {
  return card.waiter_until !== null && Date.parse(card.waiter_until) > now.getTime();
}

function effectiveState(card: CardRecord, now: Date): CardState {
  if (card.state === "sending" && now.getTime() - Date.parse(card.state_since) > STALE_SENDING_MS) return "open";
  return card.state;
}

export type MockupLink = "hidden" | "available" | "requested" | "no_waiter";

export function mockupLink(card: CardRecord, now: Date): MockupLink {
  if (effectiveState(card, now) !== "open" || !card.items.some((i) => i.visual) || card.mockup !== null) return "hidden";
  if (card.mockups_rejected > MAX_MOCKUP_RETURNS) return "hidden";
  if (card.mockup_request !== null) return "requested";
  return waiting(card, now) ? "available" : "no_waiter";
}

function statusOf(card: CardRecord, store: SuggestionStore): string | null {
  if (card.state === "sending") return CARD_STATUS.sending;
  if (card.state !== "submitted") return null;
  const sent = store.records.find((r) => r.record_id === card.suggestion_record_id);
  return sent && isSuggestion(sent) ? cardStatus(sent) : CARD_STATUS.unsent;
}

export interface CardPageState {
  state: CardState;
  status: string | null;
  mockup_link: MockupLink;
  mockup: { n: number; html: string } | null;
  context_lines: CardContextLine[];
}

function pageState(card: CardRecord, store: SuggestionStore, now: Date): CardPageState {
  return {
    state: effectiveState(card, now),
    status: statusOf(card, store),
    mockup_link: mockupLink(card, now),
    mockup: card.mockup,
    context_lines: card.context_lines,
  };
}

/** What the card's page reads each few seconds. */
export async function readCardState(cardId: string, deps: CardDeps): Promise<CardPageState> {
  const store = await loadStore(deps.env);
  return pageState(findCard(store, cardId), store, nowOf(deps));
}

/** The card's page as the page API serves it, rendered from the record as it is. */
export async function readCardPage(cardId: string, env: NodeJS.ProcessEnv): Promise<string> {
  return renderCardHtml(findCard(await loadStore(env), cardId), pageApiPort(env), pageApiCardToken(cardId, env));
}

// ----------------------------------------------------------------- edits --

/** The card's editable text as the page holds it at a click (decision 7). */
export interface CardEdits {
  pain_point?: string;
  items?: Array<{ id: string; text: string }>;
  context_lines?: Array<{ id: string; text: string }>;
  /** Every line id the page has shown, so a line added since (a rejected mockup's reason) is kept. */
  lines_known?: string[];
  comment?: string;
}

function blockList(label: string, value: unknown): Array<{ id: string; text: string }> | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new ValidationError(`${label} must be a list`);
  return value.map((entry, i) => {
    if (!isObject(entry) || typeof entry.id !== "string") throw new ValidationError(`${label}[${i}] must be {id, text}`);
    return { id: entry.id, text: text(`${label}[${i}].text`, entry.text, { empty: true, max: MAX_EDIT }) };
  });
}

export function cardEdits(value: unknown): CardEdits {
  if (value === undefined || value === null) return {};
  if (!isObject(value)) throw new ValidationError("edits must be an object");
  onlyKeys("edits", value, ["pain_point", "items", "context_lines", "lines_known", "comment"]);
  const known = value.lines_known;
  if (known !== undefined && (!Array.isArray(known) || !known.every((id) => typeof id === "string"))) throw new ValidationError("lines_known must be a list of ids");
  return {
    ...(value.pain_point === undefined ? {} : { pain_point: text("pain_point", value.pain_point, { empty: true, max: MAX_EDIT }) }),
    ...(value.items === undefined ? {} : { items: blockList("items", value.items) }),
    ...(value.context_lines === undefined ? {} : { context_lines: blockList("context_lines", value.context_lines) }),
    ...(known === undefined ? {} : { lines_known: known as string[] }),
    ...(value.comment === undefined ? {} : { comment: text("comment", value.comment, { empty: true, max: MAX_EDIT }) }),
  };
}

function edited<T extends CardBlock>(block: T, value: string): T {
  return value === block.text ? block : { ...block, text: value, guess: false };
}

/** Puts the page's text into the card. An emptied item or line is removed (decision 7). */
function applyEdits(card: CardRecord, edits: CardEdits): void {
  if (edits.pain_point !== undefined && edits.pain_point !== "") card.pain_point = edited(card.pain_point, edits.pain_point);
  if (edits.items) {
    const byId = new Map(edits.items.map((e) => [e.id, e.text]));
    card.items = card.items.filter((i) => byId.has(i.id) && byId.get(i.id) !== "").map((i) => edited(i, byId.get(i.id) as string));
  }
  if (edits.context_lines) {
    const byId = new Map(edits.context_lines.map((e) => [e.id, e.text]));
    const known = new Set(edits.lines_known ?? edits.context_lines.map((e) => e.id));
    card.context_lines = card.context_lines
      .filter((l) => !known.has(l.id) || (byId.has(l.id) && byId.get(l.id) !== ""))
      .map((l) => (byId.has(l.id) ? edited(l, byId.get(l.id) as string) : l));
  }
  if (edits.comment !== undefined) card.comment = edits.comment;
}

// ---------------------------------------------------------------- submit --

export type SubmitOutcome =
  | { outcome: "check"; prompts: CardPrompt[]; blocks: CardBlocks }
  | { outcome: "sent" | "unsent"; status: string }
  | { outcome: "refused"; blocks: CardBlocks }
  /** The check could not read every record source: nothing was sent, and Submit can be tried again. */
  | { outcome: "unchecked"; blocks: CardBlocks }
  | { outcome: "empty" }
  | { outcome: "closed"; state: CardState; status: string | null };

/** The card's readable text as it is now stored, for the page to redraw after a removal. */
export interface CardBlocks {
  pain_point: string;
  items: Array<{ id: string; text: string }>;
  context_lines: Array<{ id: string; text: string }>;
  comment: string;
}

function blocksOf(card: CardRecord): CardBlocks {
  return {
    pain_point: card.pain_point.text,
    items: card.items.map(({ id, text: t }) => ({ id, text: t })),
    context_lines: card.context_lines.map(({ id, text: t }) => ({ id, text: t })),
    comment: card.comment,
  };
}

/** A title from the pain point's first words, so nothing is sent that the card did not show. */
export function titleFrom(pain: string): string {
  const sentence = pain.split(/(?<=[.!?])\s/)[0];
  const words = sentence.split(/\s+/).filter(Boolean);
  const title = words.slice(0, 8).join(" ");
  return title.length > 100 ? `${title.slice(0, 99)}…` : title;
}

/** The fields sent: exactly what the card shows, plus the environment facts and the mockup on it. */
export function cardFields(card: CardRecord): SuggestionFields {
  return {
    title: titleFrom(card.pain_point.text),
    pain_point: card.pain_point.text,
    source: card.source,
    ...(card.skill ? { skill: card.skill } : {}),
    ...(card.items.length ? { items: card.items.map((i) => i.text) } : {}),
    origin: card.origin,
    ...(card.fingerprint ? { fingerprint: { ...card.fingerprint } as unknown as Record<string, unknown> } : {}),
    ...(card.raw_observation.length ? { raw_observation: card.raw_observation.join("\n") } : {}),
    environment_facts: card.environment_facts,
    ...(card.comment ? { comment: card.comment } : {}),
    ...(card.context_lines.length ? { context_lines: card.context_lines.map((l) => ({ kind: l.kind, text: l.text })) } : {}),
    ...(card.mockup ? { mockup: card.mockup.html } : {}),
  };
}

type Claim = { prompts: CardPrompt[] } | { unchecked: true } | { fields: SuggestionFields };

/** Under the store's lock: the check over the card as it now is. Returns the prompts left, or the fields
 * to send. A check that could not read every record source sends nothing (decision 22): the card stays
 * open, and the raw cause, each source's state, is kept in this card's record only. */
function checkAndClaim(card: CardRecord, records: RecordTexts, stopWords: Set<string>, at: string): Claim {
  const check = runCrossCheck(cardText(card), records, stopWords);
  if (!check.complete) {
    card.check_failures = [...(card.check_failures ?? []), { at, records: check.records }];
    return { unchecked: true };
  }
  dropGenerated(card, check.hits, "click", at);
  const prompts = promptsOf(card, check.hits);
  if (prompts.length) return { prompts };
  card.waited_at_submit = waiting(card, new Date(at));
  card.state = "sending";
  card.state_since = at;
  card.mockup_request = null;
  return { fields: cardFields(card) };
}

function claimed(card: CardRecord, next: Claim): { done: SubmitOutcome } | { fields: SuggestionFields } {
  if ("fields" in next) return { fields: next.fields };
  if ("unchecked" in next) return { done: { outcome: "unchecked", blocks: blocksOf(card) } };
  return { done: { outcome: "check", prompts: next.prompts, blocks: blocksOf(card) } };
}

async function send(cardId: string, fields: SuggestionFields, deps: CardDeps): Promise<SubmitOutcome> {
  let result: Awaited<ReturnType<typeof submitSuggestion>>;
  try {
    result = await submitSuggestion(fields, deps.env, deps.seams ?? {});
  } catch (err) {
    const reopened = await withStore(deps.env, (store) => {
      const card = findCard(store, cardId);
      card.state = "open";
      card.state_since = nowOf(deps).toISOString();
      return blocksOf(card);
    });
    if (err instanceof ValidationError) return { outcome: "refused", blocks: reopened };
    throw err;
  }
  await withStore(deps.env, (store) => {
    const card = findCard(store, cardId);
    card.state = "submitted";
    card.state_since = nowOf(deps).toISOString();
    card.suggestion_record_id = result.record_id;
    card.waiter_until = null;
  });
  return { outcome: result.status === CARD_STATUS.sent ? "sent" : "unsent", status: result.status };
}

function closed(card: CardRecord, store: SuggestionStore, now: Date): SubmitOutcome | null {
  const state = effectiveState(card, now);
  return state === "open" ? null : { outcome: "closed", state, status: statusOf(card, store) };
}

/** Submit Suggestion: saves the edits, checks, then saves and sends, or asks about what the check found. */
export async function submitCard(cardId: string, edits: CardEdits, deps: CardDeps): Promise<SubmitOutcome> {
  const { records, stopWords } = await recordsOf(deps);
  const now = nowOf(deps);
  const step = await withStore(deps.env, (store) => {
    const card = findCard(store, cardId);
    const done = closed(card, store, now);
    if (done) return { done };
    applyEdits(card, edits);
    if (!card.pain_point.text.trim()) return { done: { outcome: "empty" } as SubmitOutcome };
    return claimed(card, checkAndClaim(card, records, stopWords, now.toISOString()));
  });
  if ("done" in step) return step.done as SubmitOutcome;
  return send(cardId, step.fields, deps);
}

/** Bracket a removed match leaves, by what it was (decision 27). */
function bracketFor(kind: HitKind, sources: RecordSource[] | undefined): Bracket {
  if (kind === "email") return "person";
  if (kind === "path") return "file";
  if (kind === "date" || kind === "amount") return kind;
  const source = sources?.[0];
  if (source === "client" || source === "matter") return source;
  if (source === "contact") return "person";
  if (source === "document_title") return "document";
  return "file";
}

/** The practitioner's answer to one prompt: Remove (any) or Send anyway (a date or an amount only).
 * Remove deletes the text from the stored card; then the submit carries on as the click began it. */
export async function resolvePrompt(
  cardId: string,
  answer: { part: unknown; id: unknown; start: unknown; end: unknown; action: unknown },
  deps: CardDeps
): Promise<SubmitOutcome | { outcome: "stale"; prompts: CardPrompt[]; blocks: CardBlocks }> {
  if (!isReadable(String(answer.part) as CardPart)) throw new ValidationError("part must be pain_point, items, context_lines or comment");
  if (answer.action !== "remove" && answer.action !== "send_anyway") throw new ValidationError("action must be remove or send_anyway");
  if (!Number.isInteger(answer.start) || !Number.isInteger(answer.end)) throw new ValidationError("start and end must be whole numbers");
  const part = answer.part as ReadablePart;
  const id = answer.id === null || answer.id === undefined ? null : String(answer.id);
  const { records, stopWords } = await recordsOf(deps);
  const now = nowOf(deps);
  const step = await withStore(deps.env, (store) => {
    const card = findCard(store, cardId);
    const done = closed(card, store, now);
    if (done) return { done };
    const check = runCrossCheck(cardText(card), records, stopWords);
    const hit = check.hits.find((h) => h.part === part && h.start === answer.start && h.end === answer.end &&
      isReadable(h.part) && blockOf(card, part, h.index).id === id);
    if (!hit || (answer.action === "send_anyway" && hit.kind !== "date" && hit.kind !== "amount")) {
      // The text changed since the prompt was shown: ask again from what is stored.
      return { done: { outcome: "stale", prompts: promptsOf(card, check.hits), blocks: blocksOf(card) } };
    }
    const block = blockOf(card, part, hit.index);
    const span = block.text.slice(hit.start, hit.end);
    if (answer.action === "send_anyway") {
      card.send_anyway.push({ part, id: block.id, kind: hit.kind as "date" | "amount", text: span });
    } else {
      const replaced = `${block.text.slice(0, hit.start)}[${bracketFor(hit.kind, hit.sources)}]${block.text.slice(hit.end)}`;
      if (part === "pain_point") card.pain_point = { ...card.pain_point, text: replaced };
      else if (part === "comment") card.comment = replaced;
      else {
        const list = part === "items" ? card.items : card.context_lines;
        const at = list.findIndex((b) => b.id === block.id);
        list[at] = { ...list[at], text: replaced };
      }
    }
    return claimed(card, checkAndClaim(card, records, stopWords, now.toISOString()));
  });
  if ("done" in step) return step.done as SubmitOutcome;
  return send(cardId, step.fields, deps);
}

// ------------------------------------------------------- dismiss, restore --

/** Dismiss: sends nothing and records the dismissal on this computer (decision 9). */
export async function dismissCard(cardId: string, deps: CardDeps): Promise<{ outcome: "dismissed" } | SubmitOutcome> {
  let release: string | null = null;
  try {
    release = pluginRelease(deps.seams?.installRoot);
  } catch {
    release = null;
  }
  const now = nowOf(deps);
  return withStore(deps.env, (store) => {
    const card = findCard(store, cardId);
    const done = closed(card, store, now);
    if (done) return done.outcome === "closed" && done.state === "dismissed" ? { outcome: "dismissed" as const } : done;
    card.state = "dismissed";
    card.state_since = now.toISOString();
    card.mockup_request = null;
    const dismissal: DismissalRecord = {
      kind: "dismissal", record_id: randomUUID(), created_at: now.toISOString(), card_id: cardId,
      origin: card.origin,
      fingerprint: card.fingerprint ? ({ ...card.fingerprint } as unknown as Record<string, unknown>) : null,
      plugin_version: card.fingerprint?.version ?? release,
    };
    store.records.push(dismissal as unknown as StoreRecord);
    return { outcome: "dismissed" as const };
  });
}

/** Restore Suggestion: takes a dismissal back, and the card is open again. */
export async function restoreCard(cardId: string, deps: CardDeps): Promise<{ outcome: "restored" } | SubmitOutcome> {
  const now = nowOf(deps);
  return withStore(deps.env, (store) => {
    const card = findCard(store, cardId);
    if (card.state !== "dismissed") return closed(card, store, now) ?? { outcome: "restored" as const };
    card.state = "open";
    card.state_since = now.toISOString();
    store.records = store.records.filter((r) => !(r.kind === DISMISSAL_KIND && (r as unknown as DismissalRecord).card_id === cardId));
    return { outcome: "restored" as const };
  });
}

// ---------------------------------------------------------------- mockup --

/** Show a mockup of this: saves the page's text, then asks the waiting agent for a mockup. */
export async function requestMockup(cardId: string, edits: CardEdits, deps: CardDeps): Promise<{ outcome: MockupLink | "closed" }> {
  const now = nowOf(deps);
  return withStore(deps.env, (store) => {
    const card = findCard(store, cardId);
    if (effectiveState(card, now) !== "open") return { outcome: "closed" as const };
    applyEdits(card, edits);
    const link = mockupLink(card, now);
    if (link !== "available") return { outcome: link };
    card.mockup_request = { at: now.toISOString(), taken_at: null };
    return { outcome: "requested" as const };
  });
}

/** The agent's mockup: checked (mockup.ts, then the record cross-check), put on the card, and its page written. */
export async function attachMockup(cardId: string, html: unknown, deps: CardDeps): Promise<{ card_id: string; mockup_path: string }> {
  const placeholders = deps.placeholders ? deps.placeholders() : loadPlaceholders(deps.env);
  const problem = checkMockup(html, placeholders);
  if (problem) throw new ValidationError(`mockup refused: ${problem.problem}. Build it again from the placeholder text alone, with inline styles.`);
  const { records, stopWords } = await recordsOf(deps);
  const check = runCrossCheck({ mockup: html as string }, records, stopWords);
  if (!check.complete) {
    throw new ValidationError(`mockup refused: it could not be checked against this computer's records (${unreadSources(check.records).join(", ")} records unreadable)`);
  }
  if (!check.passed) {
    throw new ValidationError("mockup refused: a word in it is found in this computer's records. Use other placeholder text or other style names.");
  }
  const now = nowOf(deps);
  const { n, items } = await withStore(deps.env, (store) => {
    const card = findCard(store, cardId);
    if (effectiveState(card, now) !== "open") throw new ValidationError("this suggestion was already submitted or dismissed, so no mockup is added");
    if (card.mockup_request === null) throw new ValidationError("no mockup was asked for on this card: wait for the practitioner's click");
    card.mockups_made += 1;
    card.mockup = { n: card.mockups_made, html: html as string };
    card.mockup_request = null;
    return { n: card.mockups_made, items: card.items.filter((i) => i.visual).map((i) => i.text) };
  });
  const path = mockupPagePath(cardId, n, deps.env);
  writeTextAtomic(path, renderMockupPage({ cardId, n, html: html as string, items, port: pageApiPort(deps.env), token: pageApiCardToken(cardId, deps.env) }));
  return { card_id: cardId, mockup_path: path };
}

/** "Not like this, because...": the reason becomes a constraint line, the mockup's page is deleted, and
 * the link comes back while fewer than MAX_MOCKUP_RETURNS + 1 mockups were rejected. */
export async function rejectMockup(cardId: string, n: unknown, reason: unknown, deps: CardDeps): Promise<{ outcome: "rejected"; mockup_available: boolean } | { outcome: "gone" }> {
  const why = text("reason", reason);
  const now = nowOf(deps);
  const result = await withStore(deps.env, (store) => {
    const card = findCard(store, cardId);
    if (effectiveState(card, now) !== "open" || card.mockup === null || card.mockup.n !== n) return { outcome: "gone" as const };
    card.context_lines.push({ id: `c${card.next_line}`, kind: "constraint", text: why, guess: false });
    card.next_line += 1;
    card.mockup = null;
    card.mockups_rejected += 1;
    return { outcome: "rejected" as const, mockup_available: card.mockups_rejected <= MAX_MOCKUP_RETURNS };
  });
  if (result.outcome === "rejected") {
    // The rejected mockup's page: a file this code wrote (mockupPagePath), never the practitioner's.
    const path = mockupPagePath(cardId, n as number, deps.env);
    if (existsSync(path)) unlinkSync(path);
  }
  return result;
}

// ------------------------------------------------------------------ wait --

export type WaitEvent =
  | { event: "mockup"; card_id: string; items: string[]; constraints: string[]; placeholders: string[] }
  /** write_up: true when this session was waiting at the click, so the technical write-up is its to start. */
  | { event: "submitted"; card_id: string; write_up: boolean }
  | { event: "dismissed"; card_id: string }
  | { event: "pending"; card_id: string };

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Blocks until the practitioner submits, dismisses or asks for a mockup, or until `timeoutMs` passes
 * (then pending: call again). While it waits, the card's mockup link is live. */
export async function waitForCard(
  cardId: string,
  deps: CardDeps & { timeoutMs?: number; pollMs?: number; heartbeatMs?: number }
): Promise<WaitEvent> {
  const timeoutMs = deps.timeoutMs ?? 45_000;
  const pollMs = deps.pollMs ?? 500;
  const heartbeatMs = deps.heartbeatMs ?? 10_000;
  const started = Date.now();
  let beat = -Infinity;
  findCard(await loadStore(deps.env), cardId);
  for (;;) {
    const now = nowOf(deps);
    const store = await loadStore(deps.env);
    const card = findCard(store, cardId);
    const state = effectiveState(card, now);
    const pendingMockup = card.mockup_request !== null && card.mockup_request.taken_at === null;
    if (state === "submitted" || state === "dismissed" || pendingMockup || Date.now() - beat >= heartbeatMs) {
      const event = await withStore(deps.env, (s): WaitEvent | null => {
        const c = findCard(s, cardId);
        const st = effectiveState(c, now);
        if (st === "submitted") {
          c.waiter_until = null;
          const record = s.records.find((r) => r.record_id === c.suggestion_record_id);
          const fresh = record !== undefined && isSuggestion(record) && record.write_up === undefined && record.payload !== null;
          return { event: st, card_id: cardId, write_up: c.waited_at_submit === true && fresh };
        }
        if (st === "dismissed") {
          c.waiter_until = null;
          return { event: st, card_id: cardId };
        }
        c.waiter_until = new Date(now.getTime() + WAITER_TTL_MS).toISOString();
        if (c.mockup_request !== null && c.mockup_request.taken_at === null) {
          c.mockup_request.taken_at = now.toISOString();
          return {
            event: "mockup", card_id: cardId,
            items: c.items.filter((i) => i.visual).map((i) => i.text),
            constraints: c.context_lines.filter((l) => l.kind === "constraint").map((l) => l.text),
            placeholders: deps.placeholders ? deps.placeholders() : loadPlaceholders(deps.env),
          };
        }
        return null;
      });
      beat = Date.now();
      if (event) return event;
    }
    if (Date.now() - started >= timeoutMs) return { event: "pending", card_id: cardId };
    await sleep(pollMs);
  }
}

// ------------------------------------------------------------------ list --

/** The cards this computer holds that are still open, for the session to show again. */
export async function openCards(env: NodeJS.ProcessEnv): Promise<Array<{ card_id: string; created_at: string; card_path: string }>> {
  const store = await loadStore(env);
  const now = new Date();
  return store.records.filter(isCard).map((r) => r as unknown as CardRecord)
    .filter((c) => effectiveState(c, now) === "open")
    .map((c) => ({ card_id: c.record_id, created_at: c.created_at, card_path: cardPath(c.record_id, env) }));
}
