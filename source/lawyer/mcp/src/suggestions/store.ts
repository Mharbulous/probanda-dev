// The local suggestion store (docs/Plans/2026-10-25_suggestion-design.md, decision 14): one JSON file,
// `suggestions/suggestions.json` beside probanda.json, holding every suggestion this device sent or
// tried to send, every suggestion an earlier version held unposted, every suggestion card (kind
// "card", card.ts), every dismissal of one (kind "dismissal") and every observation (kind
// "observation", observation.ts). Its `ai_noticed` field holds the last answer observation.ts reached
// about raising an AI-noticed card, which the lawyer plugin's Stop hook reads.
//
// One store, one list of records, each record naming its `kind` (Commandment 5: no table, column or
// file per kind). A kind this code does not know is kept as it is, so a later version's records
// survive an older version's write. It is not one of the legacy stores of COMMANDMENTS.md's Exception.
//
// A sent suggestion keeps `payload`, the exact JSON text posted to suggestion-submit, with the mockup
// embedded in it as sent, never re-serialised; its local state and send attempts; the raw cause of the
// last failure (decision 13); the last badge Probanda's Cloud returned and the last one shown; and its
// withdrawal (decision 16). Suggestion ids are Account Information (Commandment 2): the store stays on
// this device and never goes under 0. CASE DATA. Probanda creates the store and every file beside it
// (Commandment 7).
//
// The suggestion log that came before it, `suggestions.local.json` beside probanda.json, is read once
// on the first load that finds it, and every entry in it is copied in: each posted suggestion as a
// sent record whose payload was never kept (payload null), and each held draft as a held record. The
// old file is left as it was; `migrated_log` records that it was read, so it is never read again.
//
// Every write is under a lock file beside the store and by temp file plus rename.

import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { configPath } from "../config-path.js";
import { DataServerError } from "../errors.js";
import { withFileLock, writeTextAtomic } from "../file-lock.js";

export const STORE_FOLDER = "suggestions";
export const STORE_FILE = "suggestions.json";
export const LEGACY_LOG_FILE = "suggestions.local.json";

/** After this many server starts whose retry failed, retries stop (decision 14). */
export const MAX_FAILED_SESSIONS = 7;

/** A send the process claimed but never finished (it died mid-send) is retried after this long. */
export const STALE_SENDING_MS = 10 * 60_000;

/** Decision 13's card status strings, and decision 14's final one, by local state. */
export const CARD_STATUS = {
  sending: "Sending...",
  sent: "Submitted ✓",
  unsent: "Not sent, will retry",
  unreachable: "Not sent; Probanda could not be reached",
} as const;

export type SendState = keyof typeof CARD_STATUS;

export interface SendAttempt {
  at: string;
  /** `sent`; `failed` (the raw cause beside it); or `no_key`, which is not a failure to reach Probanda. */
  outcome: "sent" | "failed" | "no_key";
  /** `click` when the practitioner's submit sent it, `start` when a server start retried it. */
  trigger: "click" | "start";
  cause?: string;
}

export interface CloudItem {
  item: number;
  status: string | null;
  reason: string | null;
  category: string | null;
  implemented_in: string | null;
}

export interface SuggestionRecord {
  kind: "suggestion";
  /** This device's id for the record, set before anything is sent. */
  record_id: string;
  created_at: string;
  /** The exact JSON text posted; null only for a suggestion migrated from the old log, which kept none. */
  payload: string | null;
  title: string;
  state: SendState;
  sending_since: string | null;
  attempts: SendAttempt[];
  /** Server starts whose retry failed (decision 14). A start with no key configured does not count. */
  failed_sessions: number;
  /** The raw cause of the last failed send, kept here only (decision 13). */
  last_error: string | null;
  /** What Probanda's Cloud said it saved: {items_saved, previews_saved, mockup_saved}. */
  reply: Record<string, boolean> | null;
  suggestion_id: string | null;
  /** The last badge Probanda's Cloud returned (decision 17), and the last one shown to the practitioner. */
  badge: string | null;
  shown_badge: string | null;
  items: CloudItem[] | null;
  checked_at: string | null;
  withdrawn_at: string | null;
  /** The raw cause of the last refused or failed withdrawal, kept here only. */
  withdraw_error: string | null;
  /** technical-writer's specification as stored after the record check, and the combined backstop
   * result (specification.ts); null until then. The specification stays null when the write-up stood alone. */
  specification: string | null;
  backstop_result: Record<string, unknown> | null;
  /** The technical write-up's progress and, when it stood alone, why (specification.ts). Absent when
   * none was written: the card was submitted with no session waiting on it, or before Phase 6. */
  write_up?: WriteUp;
}

/** Where a suggestion's technical write-up stands. */
export interface WriteUp {
  /** writing: the writer has its brief; checked: its citations passed and the backstop is judging;
   * waiting_to_send: stored, to be sent once the suggestion is (or once Probanda is reached);
   * sent: Probanda's Cloud saved it; stands_alone: nothing is sent after the suggestion. */
  state: "writing" | "checked" | "waiting_to_send" | "sent" | "stands_alone";
  started_at: string;
  updated_at: string;
  /** Why it stands alone: the backstop failed; the record check's removal left it incoherent; the check
   * could not read every record source; Probanda's Cloud refused it; the suggestion was withdrawn. */
  reason: "backstop_failed" | "incoherent" | "records_unreadable" | "refused" | "withdrawn" | null;
  /** The citation check's result, held between the check and the backstop's judgement. */
  citations?: unknown;
  /** The specification between the citation check and the backstop's judgement; removed after. */
  draft?: unknown;
  /** Each removal the record check made: sentence number, kind and record source, never the text. */
  removals: unknown[];
  /** The raw cause of the last failed post, kept here only. */
  last_error?: string | null;
  attempts?: number;
}

/** A suggestion drafted while this device had no Probanda key, kept to be shown again and posted once it has one. */
export interface HeldRecord {
  kind: "held";
  record_id: string;
  created_at: string;
  draft: Record<string, unknown>;
}

export type StoreRecord = SuggestionRecord | HeldRecord | ({ kind: string; record_id: string } & Record<string, unknown>);

export interface SuggestionStore {
  version: 1;
  migrated_log: { from: string; on: string } | null;
  records: StoreRecord[];
  /** observation.ts's last answer about raising an AI-noticed card (its AiNoticedAnswer); absent until one was reached. */
  ai_noticed?: {
    checked_at: string;
    session_id: string;
    next: string | null;
    latest_observation: string | null;
    recheck_at: string | null;
  };
}

/** The folder the store, its lock and the Past suggestions page live in: `suggestions` beside probanda.json. */
export function storeDir(env: NodeJS.ProcessEnv = process.env): string {
  return join(dirname(configPath(env)), STORE_FOLDER);
}

export function storePath(env: NodeJS.ProcessEnv = process.env): string {
  return join(storeDir(env), STORE_FILE);
}

/** The old suggestion log: `suggestions.local.json` in the folder that holds probanda.json (or the COCLERK_CONFIG_PATH file). */
export function legacyLogPath(env: NodeJS.ProcessEnv = process.env): string {
  return join(dirname(configPath(env)), LEGACY_LOG_FILE);
}

export function cardStatus(record: Pick<SuggestionRecord, "state">): string {
  return CARD_STATUS[record.state];
}

export function isSuggestion(record: StoreRecord): record is SuggestionRecord {
  return record.kind === "suggestion";
}

export function isHeld(record: StoreRecord): record is HeldRecord {
  return record.kind === "held";
}

export function newSuggestionRecord(payload: string, title: string, now: string): SuggestionRecord {
  return {
    kind: "suggestion", record_id: randomUUID(), created_at: now, payload, title,
    state: "sending", sending_since: now, attempts: [], failed_sessions: 0, last_error: null, reply: null,
    suggestion_id: null, badge: null, shown_badge: null, items: null, checked_at: null,
    withdrawn_at: null, withdraw_error: null, specification: null, backstop_result: null,
  };
}

function readJson(file: string): Record<string, unknown> {
  try {
    const value = JSON.parse(readFileSync(file, "utf-8"));
    if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("not a JSON object");
    return value as Record<string, unknown>;
  } catch (err) {
    throw new DataServerError(`${file} is not valid JSON: ${(err as Error).message}`, "invalid_file");
  }
}

function readStoreFile(file: string): SuggestionStore {
  if (!existsSync(file)) return { version: 1, migrated_log: null, records: [] };
  const raw = readJson(file);
  if (!Array.isArray(raw.records)) throw new DataServerError(`${file} has no "records" list`, "invalid_file");
  return {
    version: 1,
    migrated_log: (raw.migrated_log as SuggestionStore["migrated_log"]) ?? null,
    records: raw.records as StoreRecord[],
    ...(raw.ai_noticed && typeof raw.ai_noticed === "object" ? { ai_noticed: raw.ai_noticed as SuggestionStore["ai_noticed"] } : {}),
  };
}

// The old log's statuses as decision 17's badges. "approved in part" is no longer a status: the
// cloud migrated it to an approved item, which reads Approved.
const LEGACY_BADGE: Record<string, string> = {
  new: "Submitted",
  approved: "Approved",
  "approved in part": "Approved",
  rejected: "Declined",
};

function legacyBadge(status: unknown): string | null {
  return typeof status === "string" ? (LEGACY_BADGE[status] ?? status) : null;
}

function dateTime(day: unknown, fallback: string): string {
  return typeof day === "string" && /^\d{4}-\d{2}-\d{2}/.test(day) ? (day.length === 10 ? `${day}T00:00:00.000Z` : day) : fallback;
}

/** Copies every entry of the old log into `store`, skipping one already there by suggestion id or held id. */
function migrateLog(store: SuggestionStore, file: string, now: string): void {
  const raw = readJson(file);
  const { suggestions, held = [] } = raw;
  if (!Array.isArray(suggestions)) throw new DataServerError(`${file} has no "suggestions" list`, "invalid_file");
  if (!Array.isArray(held)) throw new DataServerError(`${file} has a "held" entry that is not a list`, "invalid_file");
  const ids = new Set(store.records.filter(isSuggestion).map((r) => r.suggestion_id));
  const heldIds = new Set(store.records.map((r) => r.record_id));
  for (const entry of suggestions as Record<string, unknown>[]) {
    const id = typeof entry?.suggestion_id === "string" ? entry.suggestion_id : null;
    if (id === null) throw new DataServerError(`${file} holds a suggestion with no suggestion_id`, "invalid_file");
    if (ids.has(id)) continue;
    ids.add(id);
    store.records.push({
      ...newSuggestionRecord("", typeof entry.title === "string" ? entry.title : "", dateTime(entry.posted_on, now)),
      payload: null,
      state: "sent",
      sending_since: null,
      suggestion_id: id,
      badge: legacyBadge(entry.last_status),
      shown_badge: legacyBadge(entry.last_shown_status),
    });
  }
  for (const entry of held as Record<string, unknown>[]) {
    const id = typeof entry?.held_id === "string" ? entry.held_id : randomUUID();
    if (heldIds.has(id)) continue;
    heldIds.add(id);
    store.records.push({ kind: "held", record_id: id, created_at: dateTime(entry.held_on, now), draft: (entry.draft ?? {}) as Record<string, unknown> });
  }
  store.migrated_log = { from: LEGACY_LOG_FILE, on: now };
}

function needsMigration(store: SuggestionStore, env: NodeJS.ProcessEnv): string | null {
  if (store.migrated_log) return null;
  const legacy = legacyLogPath(env);
  return existsSync(legacy) ? legacy : null;
}

function writeStore(file: string, store: SuggestionStore): void {
  writeTextAtomic(file, `${JSON.stringify(store, null, 2)}\n`);
}

/** Runs `fn` on the store under its lock and writes what `fn` leaves, migrating the old log first if it is unread. */
export async function withStore<T>(env: NodeJS.ProcessEnv, fn: (store: SuggestionStore) => T | Promise<T>): Promise<T> {
  const file = storePath(env);
  return withFileLock(file, async () => {
    const store = readStoreFile(file);
    const legacy = needsMigration(store, env);
    if (legacy) migrateLog(store, legacy, new Date().toISOString());
    const result = await fn(store);
    writeStore(file, store);
    return result;
  });
}

/** The store as it is now. The first read that finds the old log unread migrates it, under the lock. */
export async function loadStore(env: NodeJS.ProcessEnv = process.env): Promise<SuggestionStore> {
  const file = storePath(env);
  const store = readStoreFile(file);
  if (!needsMigration(store, env)) return store;
  return withStore(env, (locked) => structuredClone(locked));
}

/** One suggestion record by its record id, or a not_found error. */
export function findSuggestion(store: SuggestionStore, recordId: string): SuggestionRecord {
  const record = store.records.find((r) => r.record_id === recordId);
  if (!record || !isSuggestion(record)) throw new DataServerError(`no suggestion ${recordId} on this computer`, "not_found");
  return record;
}
