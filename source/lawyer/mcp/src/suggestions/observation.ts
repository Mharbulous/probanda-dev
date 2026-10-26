// AI-noticed suggestions (docs/Plans/2026-10-25_suggestion-design.md, decisions 2, 3, 4, 9 and 12;
// lifecycle plan Phase 5 and open decision 1 (b)): what Probanda noticed about its own work, recorded
// as an observation in the one suggestion store (store.ts), and the daily cap and suppression that
// decide when one is raised as a card.
//
// An observation is one record of kind "observation". It holds a structured observation, never free
// text: a kind from a fixed list, a Probanda tool name checked against the tools Probanda ships, an
// error class or code matching a strict pattern, whole-number counts under fixed names, and a key into
// the plugin's own fixed texts (references/observations/observation-texts.txt in the suggestion skill). Its raw
// observation lines are written here from that structure, in fixed words, so they hold only
// Probanda's own output (decision 3): never an argument value, an error message's body, a client
// document or the practitioner's words. Its fingerprint (plugin, version, skill, kind) takes the
// plugin and version from the manifest of the installed plugin that ships the skill (or the tool),
// never from the caller. Each observation stays its own record: merging by fingerprint is a triage
// view in Probanda's Cloud (decision 3).
//
// The cap and suppression live here and only here; the card build (card.ts) and the Stop hook
// (source/lawyer/hooks/ai-noticed-card.py) both follow this code's answer:
//   - at most one AI-noticed card per local day, across sessions;
//   - never for a fingerprint (plugin, skill, kind) whose AI-noticed card was dismissed, sent or left
//     unanswered within the last 30 days, or at any time while the plugin's installed version is the
//     one that card was built under;
//   - an AI-noticed card still open from another session, with no session waiting on it, was left
//     unanswered when that session ended, and counts as dismissed: at the next check it is marked
//     dismissed and a dismissal record is written. No hook needs to run at session end.
// nextObservation writes the answer it reached into the store's `ai_noticed` field: the session it
// checked for, the observation it would raise (or null), the newest observation it saw, and when the
// answer can next change by time alone. The hook reads only that field and the observation records,
// so it never decides eligibility itself: it asks again only when the answer is stale.

import { randomUUID } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { DataServerError, ValidationError } from "../errors.js";
import { INSTALL_ROOT, bundledSkillFolders, pluginManifest, resolveShippedRoot, siblingInstalls } from "../repo-root.js";
import type { CardRecord, DismissalRecord } from "./card.js";
import { PROBANDA_PLUGINS, SERVERS, expectedTools, type ProbandaPlugin } from "./environment.js";
import type { SendSeams } from "./send.js";
import { type StoreRecord, type SuggestionStore, loadStore, withStore } from "./store.js";

export const OBSERVATION_KIND = "observation";

/** The fixed texts' file, under the suggestion skill's tree. */
export const OBSERVATION_TEXTS_PATH = "suggestion/references/observations/observation-texts.txt";

/** How long a dismissed, sent or unanswered AI-noticed card keeps its fingerprint from being raised again. */
export const SUPPRESSION_MS = 30 * 24 * 60 * 60_000;

/** The kinds of observation, each with the fixed words its first raw line says, and what it needs. */
export const OBSERVATION_KINDS = {
  tool_error: { line: "A Probanda tool returned an error.", needsTool: true },
  tool_refused: { line: "A Probanda tool refused the request it was given.", needsTool: true },
  tool_missing: { line: "A Probanda tool the work needed was not available.", needsTool: true },
  repeated_calls: { line: "A Probanda tool was called again and again for one result.", needsTool: true },
  token_use: { line: "One step used many tokens.", needsTool: false },
} as const;
export type ObservationKind = keyof typeof OBSERVATION_KINDS;

/** The counts an observation may carry, each a whole number, with the words its raw line says. */
export const COUNT_LABELS = {
  calls: "Calls",
  retries: "Retries",
  failures: "Failures",
  turns: "Turns",
  input_tokens: "Input tokens",
  output_tokens: "Output tokens",
} as const;
export type CountName = keyof typeof COUNT_LABELS;
const MAX_COUNT = 1_000_000_000;

/** A single-word error code Probanda's tools give, besides the snake_case and class forms the pattern takes. */
const ERROR_WORDS = new Set(["timeout", "refused", "unavailable", "forbidden", "unauthorized", "conflict", "invalid", "aborted"]);
// snake_case codes (not_found, records_unreadable), error classes (ValidationError, TypeError),
// system codes (ECONNREFUSED, ENOENT) and HTTP statuses (HTTP 500). Nothing else.
const ERROR_CODE = /^(?:[a-z][a-z0-9]*(?:_[a-z0-9]+){1,5}|[A-Z][A-Za-z]{1,40}(?:Error|Exception)|E[A-Z0-9]{2,20}|HTTP [1-5][0-9]{2})$/;
const SKILL_NAME = /^[a-z][a-z0-9-]{1,48}$/;
const TOOL_PART = /^[a-z][a-z0-9_]{0,100}$/;
const TEXT_KEY = /^[a-z][a-z0-9_]{1,48}$/;

export interface StructuredObservation {
  kind: ObservationKind;
  /** The normalised tool name, plugin_<plugin>_<server>__<tool>. */
  tool?: string;
  error_code?: string;
  counts?: Partial<Record<CountName, number>>;
  text_key?: string;
}

export interface Fingerprint {
  plugin: string;
  version: string;
  skill?: string;
  kind: ObservationKind;
}

export interface ObservationRecord {
  kind: "observation";
  record_id: string;
  created_at: string;
  fingerprint: Fingerprint;
  observation: StructuredObservation;
  /** The lines the card shows as its raw observation, written by this code from `observation`. */
  raw_observation: string[];
  /** When its card was built; null while it has not been shown. */
  displayed_at: string | null;
  card_id: string | null;
}

/** The answer the last check reached, which the Stop hook reads (see the header). */
export interface AiNoticedAnswer {
  checked_at: string;
  session_id: string;
  /** The observation that check would raise; null when none may be raised. */
  next: string | null;
  /** The newest observation record the check saw, so a later one makes the answer stale. */
  latest_observation: string | null;
  /** When the answer may change by time alone (the next local midnight); null while `next` is set. */
  recheck_at: string | null;
}

/** An installed Probanda plugin: its manifest's name and version, and the skill folders it ships. */
export interface PluginInstall {
  plugin: string;
  version: string | null;
  skills: string[];
}

/** Test seams beyond send.ts's: the installed plugins, and the fixed texts. */
export interface ObservationSeams extends SendSeams {
  plugins?: () => PluginInstall[];
  texts?: () => Map<string, string>;
}

export function isObservation(record: StoreRecord): record is ObservationRecord & StoreRecord {
  return record.kind === OBSERVATION_KIND;
}

const nowOf = (seams: ObservationSeams) => (seams.now ? seams.now() : new Date());

// ------------------------------------------------------------ installs --

function folders(dir: string): string[] {
  try {
    return readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory() && e.name !== "shared").map((e) => e.name);
  } catch {
    return [];
  }
}

/** This plugin and every Probanda plugin installed beside it, read from their manifests now. */
export function installedPlugins(installRoot: string = INSTALL_ROOT): PluginInstall[] {
  const out: PluginInstall[] = [];
  const own = pluginManifest(installRoot);
  if (own.name) out.push({ plugin: own.name, version: own.version, skills: bundledSkillFolders(installRoot).filter((s) => s !== "shared") });
  for (const sibling of siblingInstalls(installRoot, PROBANDA_PLUGINS)) {
    if (!out.some((p) => p.plugin === sibling.name)) out.push({ plugin: sibling.name, version: sibling.version, skills: folders(sibling.skills) });
  }
  return out;
}

function pluginsOf(seams: ObservationSeams): PluginInstall[] {
  return seams.plugins ? seams.plugins() : installedPlugins(seams.installRoot);
}

/** The installed version of `plugin`, or null when it is not installed or names no version. */
function currentVersion(plugins: PluginInstall[], plugin: string): string | null {
  return plugins.find((p) => p.plugin === plugin)?.version ?? null;
}

// ---------------------------------------------------------- fixed texts --

/** The plugin's own fixed texts: one `key = text` per line, `#` starting a comment line. */
export function parseObservationTexts(text: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const at = line.indexOf("=");
    if (at < 0) continue;
    const key = line.slice(0, at).trim();
    const value = line.slice(at + 1).trim();
    if (TEXT_KEY.test(key) && value) out.set(key, value);
  }
  return out;
}

export function loadObservationTexts(env: NodeJS.ProcessEnv = process.env, installRoot?: string): Map<string, string> {
  const root = resolveShippedRoot(OBSERVATION_TEXTS_PATH, env, { subject: "the suggestion observation texts", plugin: "lawyer", installRoot }).root;
  const path = join(root, ...OBSERVATION_TEXTS_PATH.split("/"));
  if (!existsSync(path)) throw new DataServerError("The suggestion observation texts are missing. Update the lawyer plugin.", "observation_texts_missing");
  return parseObservationTexts(readFileSync(path, "utf-8"));
}

// ---------------------------------------------------------- validation --

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The server key of each plugin's servers, as plugin_<plugin>_<server> is written in a tool name, longest first. */
const SERVER_PREFIXES: Array<{ plugin: ProbandaPlugin; server: string; prefix: string }> = PROBANDA_PLUGINS
  .flatMap((plugin) => SERVERS[plugin].map((server) => ({ plugin, server, prefix: `plugin_${plugin}_${server}__` })))
  .sort((a, b) => b.prefix.length - a.prefix.length);

// A tool name as a session sees it: mcp__plugin_<plugin>_<server>__<tool> in Claude Code, with a
// bridge segment before plugin_ in Cowork, or the bare <tool> as this server lists it.
const SESSION_PREFIX = /^mcp__(?:[A-Za-z0-9-]{1,64}__)?(?=plugin_)/;

/** The tool, checked against the tools Probanda ships, as plugin_<plugin>_<server>__<tool>; refused otherwise. */
export function probandaTool(raw: unknown): { name: string; plugin: ProbandaPlugin } {
  if (typeof raw !== "string" || raw.length > 300) throw new ValidationError("tool must be one Probanda tool's name");
  const name = raw.trim();
  const prefixed = name.replace(SESSION_PREFIX, "");
  for (const { plugin, server, prefix } of SERVER_PREFIXES) {
    if (!prefixed.startsWith(prefix)) continue;
    const tool = prefixed.slice(prefix.length);
    const known = expectedTools(plugin, server);
    if (!TOOL_PART.test(tool) || (known !== null && !known.includes(tool))) break;
    return { name: `${prefix}${tool}`, plugin };
  }
  if (TOOL_PART.test(name)) {
    for (const { plugin, server, prefix } of SERVER_PREFIXES) {
      if (expectedTools(plugin, server)?.includes(name)) return { name: `${prefix}${name}`, plugin };
    }
  }
  throw new ValidationError("tool must be one Probanda tool's name, exactly as the session sees it, with nothing else in it");
}

function errorCode(raw: unknown): string {
  if (typeof raw !== "string" || raw.length > 64 || !(ERROR_CODE.test(raw) || ERROR_WORDS.has(raw))) {
    throw new ValidationError("error_code must be the error's class or code only (not_found, ValidationError, ECONNREFUSED, HTTP 500), never its message");
  }
  return raw;
}

function counts(raw: unknown): Partial<Record<CountName, number>> {
  if (!isObject(raw)) throw new ValidationError("counts must be an object of whole numbers");
  const out: Partial<Record<CountName, number>> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (!(key in COUNT_LABELS)) throw new ValidationError(`counts has an unknown count "${key}"; the counts are ${Object.keys(COUNT_LABELS).join(", ")}`);
    if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > MAX_COUNT) throw new ValidationError(`counts.${key} must be a whole number`);
    out[key as CountName] = value;
  }
  if (!Object.keys(out).length) throw new ValidationError("counts must hold at least one count");
  return out;
}

const OBSERVATION_FIELDS = ["kind", "skill", "tool", "error_code", "counts", "text_key"];

export interface ObservationInput {
  observation: StructuredObservation;
  skill: string | null;
  toolPlugin: ProbandaPlugin | null;
}

/** suggestion_observation__record's arguments, checked. Free text of any kind is refused. */
export function observationInput(args: Record<string, unknown>, texts: Map<string, string>): ObservationInput {
  const extra = Object.keys(args).find((key) => !OBSERVATION_FIELDS.includes(key));
  if (extra) throw new ValidationError(`an observation has no field "${extra}": it holds only ${OBSERVATION_FIELDS.join(", ")}, never free text`);
  const kind = args.kind;
  if (typeof kind !== "string" || !(kind in OBSERVATION_KINDS)) throw new ValidationError(`kind must be one of ${Object.keys(OBSERVATION_KINDS).join(", ")}`);
  const spec = OBSERVATION_KINDS[kind as ObservationKind];
  const observation: StructuredObservation = { kind: kind as ObservationKind };
  let toolPlugin: ProbandaPlugin | null = null;
  if (args.tool !== undefined) {
    const tool = probandaTool(args.tool);
    observation.tool = tool.name;
    toolPlugin = tool.plugin;
  } else if (spec.needsTool) {
    throw new ValidationError(`a ${kind} observation names the tool`);
  }
  if (args.error_code !== undefined) observation.error_code = errorCode(args.error_code);
  if (args.counts !== undefined) observation.counts = counts(args.counts);
  if (kind === "repeated_calls" && observation.counts?.calls === undefined) throw new ValidationError("a repeated_calls observation gives counts.calls");
  if (kind === "token_use" && observation.counts?.input_tokens === undefined && observation.counts?.output_tokens === undefined) {
    throw new ValidationError("a token_use observation gives counts.input_tokens or counts.output_tokens");
  }
  if (args.text_key !== undefined) {
    if (typeof args.text_key !== "string" || !texts.has(args.text_key)) {
      throw new ValidationError(`text_key must be one of the plugin's fixed texts: ${[...texts.keys()].join(", ")}`);
    }
    observation.text_key = args.text_key;
  }
  let skill: string | null = null;
  if (args.skill !== undefined) {
    if (typeof args.skill !== "string" || !SKILL_NAME.test(args.skill)) throw new ValidationError("skill must be one Probanda skill's name, such as draft");
    skill = args.skill;
  }
  return { observation, skill, toolPlugin };
}

/** The raw observation lines, in fixed words, from the structure alone. */
export function rawObservationLines(observation: StructuredObservation, texts: Map<string, string>): string[] {
  const lines: string[] = [OBSERVATION_KINDS[observation.kind].line];
  if (observation.tool) lines.push(`Tool: ${observation.tool}`);
  if (observation.error_code) lines.push(`Error code: ${observation.error_code}`);
  for (const name of Object.keys(COUNT_LABELS) as CountName[]) {
    const value = observation.counts?.[name];
    if (value !== undefined) lines.push(`${COUNT_LABELS[name]}: ${value}`);
  }
  if (observation.text_key) lines.push(texts.get(observation.text_key) as string);
  return lines;
}

/** The fingerprint: the plugin that ships the skill (or else the tool, or else this plugin), at its installed version. */
function fingerprintOf(input: ObservationInput, plugins: PluginInstall[], installRoot: string | undefined): Fingerprint {
  let owner: PluginInstall | undefined;
  if (input.skill !== null) {
    owner = plugins.find((p) => p.skills.includes(input.skill as string));
    if (!owner) throw new ValidationError(`skill must be one Probanda skill installed on this computer; ${input.skill} is not`);
  } else if (input.toolPlugin !== null) {
    owner = plugins.find((p) => p.plugin === input.toolPlugin);
    if (!owner) throw new ValidationError("the tool's plugin is not installed on this computer");
  } else {
    const own = pluginManifest(installRoot ?? INSTALL_ROOT).name;
    owner = plugins.find((p) => p.plugin === own);
  }
  if (!owner || !owner.version) {
    throw new ValidationError("the plugin's manifest could not be read for its name and version, so nothing was recorded");
  }
  return { plugin: owner.plugin, version: owner.version, ...(input.skill !== null ? { skill: input.skill } : {}), kind: input.observation.kind };
}

// -------------------------------------------------------------- record --

function sameFingerprint(a: Fingerprint, b: Fingerprint): boolean {
  return a.plugin === b.plugin && (a.skill ?? null) === (b.skill ?? null) && a.kind === b.kind;
}

export type RecordResult =
  | { recorded: true; observation_id: string }
  | { recorded: false; reason: "already_held"; observation_id: string };

/** Records one observation. One identical to an observation already held under the same version, shown or not,
 * is not added again: the same thing noticed again (a loose thread triaged in a later session) is one record. */
export async function recordObservation(args: Record<string, unknown>, env: NodeJS.ProcessEnv, seams: ObservationSeams = {}): Promise<RecordResult> {
  const texts = seams.texts ? seams.texts() : loadObservationTexts(env, seams.installRoot);
  const input = observationInput(args, texts);
  const fingerprint = fingerprintOf(input, pluginsOf(seams), seams.installRoot);
  const raw = rawObservationLines(input.observation, texts);
  const at = nowOf(seams).toISOString();
  return withStore(env, (store): RecordResult => {
    const held = store.records.filter(isObservation).find((r) =>
      sameFingerprint(r.fingerprint, fingerprint) && r.fingerprint.version === fingerprint.version &&
      JSON.stringify(r.raw_observation) === JSON.stringify(raw));
    if (held) return { recorded: false, reason: "already_held", observation_id: held.record_id };
    const record: ObservationRecord = {
      kind: "observation", record_id: randomUUID(), created_at: at, fingerprint, observation: input.observation,
      raw_observation: raw, displayed_at: null, card_id: null,
    };
    store.records.push(record as unknown as StoreRecord);
    return { recorded: true, observation_id: record.record_id };
  });
}

// ------------------------------------------------- cap and suppression --

function localDay(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function nextMidnight(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);
}

function aiCards(store: SuggestionStore): CardRecord[] {
  return store.records.filter((r) => r.kind === "card").map((r) => r as unknown as CardRecord).filter((c) => c.fingerprint);
}

function waitedOn(card: CardRecord, now: Date): boolean {
  return card.waiter_until !== null && Date.parse(card.waiter_until) > now.getTime();
}

/** An AI-noticed card still open from another session, with no session waiting on it, was left
 * unanswered when that session ended: it is marked dismissed and a dismissal record is written
 * (decision 3). Its time stays the time it was last open. */
export function dismissUnanswered(store: SuggestionStore, sessionId: string, now: Date): void {
  for (const card of aiCards(store)) {
    if (card.state !== "open" || card.session_id === sessionId || waitedOn(card, now)) continue;
    card.state = "dismissed";
    card.unanswered = true;
    card.mockup_request = null;
    const dismissal: DismissalRecord = {
      kind: "dismissal", record_id: randomUUID(), created_at: now.toISOString(), card_id: card.record_id,
      origin: card.origin, fingerprint: card.fingerprint as unknown as Record<string, unknown>,
      plugin_version: card.fingerprint?.version ?? null, unanswered: true,
    };
    store.records.push(dismissal as unknown as StoreRecord);
  }
}

/** Why an observation may not be raised now, or null when it may. */
export function blockedBecause(store: SuggestionStore, observation: ObservationRecord, plugins: PluginInstall[], now: Date): "shown" | "daily_cap" | "version_gone" | "suppressed" | null {
  if (observation.displayed_at !== null) return "shown";
  const today = localDay(now);
  const cards = aiCards(store);
  if (cards.some((c) => localDay(new Date(c.created_at)) === today)) return "daily_cap";
  const installed = currentVersion(plugins, observation.fingerprint.plugin);
  // Noticed under a version no longer installed: the update may have changed what was noticed.
  if (installed !== observation.fingerprint.version) return "version_gone";
  for (const card of cards) {
    const fp = card.fingerprint as Fingerprint;
    if (!sameFingerprint(fp, observation.fingerprint)) continue;
    // Dismissed, sent or unanswered: the time it was last open. Still open: suppressed all the same.
    const at = Date.parse(card.state === "open" ? card.created_at : card.state_since);
    if (now.getTime() - at < SUPPRESSION_MS || fp.version === installed) return "suppressed";
  }
  return null;
}

function latestObservation(store: SuggestionStore): string | null {
  const all = store.records.filter(isObservation);
  return all.length ? all[all.length - 1].record_id : null;
}

/** Under the store's lock: the unanswered cards marked, then the first observation that may be raised, and the answer written. */
function decide(store: SuggestionStore, sessionId: string, plugins: PluginInstall[], now: Date): ObservationRecord | null {
  dismissUnanswered(store, sessionId, now);
  const next = store.records.filter(isObservation).find((o) => blockedBecause(store, o, plugins, now) === null) ?? null;
  store.ai_noticed = {
    checked_at: now.toISOString(),
    session_id: sessionId,
    next: next ? next.record_id : null,
    latest_observation: latestObservation(store),
    recheck_at: next ? null : nextMidnight(now).toISOString(),
  };
  return next;
}

function sessionIdOf(raw: unknown): string {
  if (typeof raw !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(raw)) throw new ValidationError("session_id must be the session id the reminder named");
  return raw;
}

export type NextResult =
  | { observation: { observation_id: string; fingerprint: Fingerprint; raw_observation: string[] } }
  | { observation: null };

/** The observation to raise as this session's AI-noticed card now, or null when the cap or suppression allows none. */
export async function nextObservation(args: Record<string, unknown>, env: NodeJS.ProcessEnv, seams: ObservationSeams = {}): Promise<NextResult> {
  const sessionId = sessionIdOf(args.session_id);
  const plugins = pluginsOf(seams);
  const now = nowOf(seams);
  return withStore(env, (store): NextResult => {
    const next = decide(store, sessionId, plugins, now);
    return next
      ? { observation: { observation_id: next.record_id, fingerprint: next.fingerprint, raw_observation: next.raw_observation } }
      : { observation: null };
  });
}

/** For the card build: the observation the card is for, checked readable before anything is built. */
export async function observationForCard(observationId: string, env: NodeJS.ProcessEnv): Promise<ObservationRecord> {
  const store = await loadStore(env);
  const record = store.records.find((r) => r.record_id === observationId);
  if (!record || !isObservation(record)) throw new ValidationError(`no observation ${observationId} on this computer`, "not_found");
  return record;
}

/** For the card build, under the store's lock: whether `observation` may be raised for `sessionId` now. When it may,
 * it is marked shown, by the card built for it, and the answer the hook reads says nothing is left to raise today. */
export function claimObservation(
  store: SuggestionStore, observationId: string, cardId: string, sessionId: string, plugins: PluginInstall[], now: Date
): { claimed: true; fingerprint: Fingerprint } | { claimed: false; reason: string } {
  dismissUnanswered(store, sessionId, now);
  const record = store.records.find((r) => r.record_id === observationId);
  if (!record || !isObservation(record)) return { claimed: false, reason: "not_found" };
  const blocked = blockedBecause(store, record, plugins, now);
  if (blocked !== null) {
    decide(store, sessionId, plugins, now);
    return { claimed: false, reason: blocked };
  }
  record.displayed_at = now.toISOString();
  record.card_id = cardId;
  store.ai_noticed = {
    checked_at: now.toISOString(), session_id: sessionId, next: null,
    latest_observation: latestObservation(store), recheck_at: nextMidnight(now).toISOString(),
  };
  return { claimed: true, fingerprint: record.fingerprint };
}

export { pluginsOf, sessionIdOf };
