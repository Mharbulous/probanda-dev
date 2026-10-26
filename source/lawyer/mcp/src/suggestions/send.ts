// Sending a suggestion to Probanda's Cloud, reading back its badge, and withdrawing it
// (docs/Plans/2026-10-25_suggestion-design.md, decisions 13, 14, 16 and 17; lifecycle plan Phase 2 and
// open decision 5 (a): this server posts to suggestion-submit itself).
//
// A suggestion is screened (findSuggestionHits, refused before anything is saved or sent), then its
// exact JSON text is saved in the local store (store.ts) and only then posted, with the key loadCloudKey
// names, as practice/cloud.ts and key-request/tools.ts post. The plugin and its version come from this
// plugin's own plugin.json, never from the model. A failed post leaves the record "Not sent, will
// retry" with the raw cause stored locally; each server start retries every unsent record in the
// background (retryUnsent, started by index.ts), and after MAX_FAILED_SESSIONS starts whose retry
// failed the record reads "Not sent; Probanda could not be reached" and is not retried again. A start
// with no key configured is not a failure to reach Probanda and does not count.
//
// Nothing here is done under the store's lock while a request is out: a record is claimed (state
// "sending") under the lock, posted, then updated under the lock again.

import type { CloudKeyStore } from "../../../../mcp-shared/commons-key.js";
import { loadCloudKey } from "../cloud-key.js";
import { ValidationError } from "../errors.js";
import { findSuggestionHits } from "../preferences/redact.js";
import { INSTALL_ROOT, pluginManifest } from "../repo-root.js";
import {
  type CloudItem,
  type SuggestionRecord,
  MAX_FAILED_SESSIONS,
  STALE_SENDING_MS,
  cardStatus,
  findSuggestion,
  isSuggestion,
  loadStore,
  newSuggestionRecord,
  withStore,
} from "./store.js";

// Every function path this module calls, written out whole (check_plugin.py's bundle-purity check).
const PATHS = {
  submit: "functions/v1/suggestion-submit",
  status: "functions/v1/suggestion-status",
  withdraw: "functions/v1/suggestion-withdraw",
} as const;

const TIMEOUT_MS = 60_000;
const MAX_STATUS_IDS = 50;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Test seams: the install root whose plugin.json names the plugin and version, the key store, the clock. */
export interface SendSeams {
  installRoot?: string;
  keyStore?: CloudKeyStore;
  now?: () => Date;
}

const nowIso = (seams: SendSeams) => (seams.now ? seams.now() : new Date()).toISOString();

/** `<plugin> <version>` from this plugin's own plugin.json; a manifest that names neither refuses the send. */
export function pluginRelease(installRoot: string = INSTALL_ROOT): string {
  const { name, version } = pluginManifest(installRoot);
  if (!name || !version) {
    throw new ValidationError("the lawyer plugin's plugin.json could not be read for its name and version, so nothing was saved or sent");
  }
  return `${name} ${version}`;
}

// ------------------------------------------------------------------ the post --

type Posted = { ok: true; status: number; json: Record<string, unknown> } | { ok: false; status: number | null; cause: string };

/** One POST of `body` (already JSON text) to a suggestion function. Never throws: a failure carries its raw cause. */
async function post(supabaseUrl: string, staticKey: string, path: string, body: string): Promise<Posted> {
  let res: Response;
  try {
    res = await fetch(`${supabaseUrl.replace(/\/+$/, "")}/${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: staticKey },
      body,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    const cause = (err as { cause?: { code?: string; message?: string } }).cause;
    return { ok: false, status: null, cause: [(err as Error).message, cause?.code ?? cause?.message].filter(Boolean).join(": ") };
  }
  let text = "";
  try {
    text = await res.text();
  } catch (err) {
    return { ok: false, status: res.status, cause: `HTTP ${res.status}, reply cut off: ${(err as Error).message}` };
  }
  let json: unknown;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = null;
  }
  const obj = json !== null && typeof json === "object" && !Array.isArray(json) ? (json as Record<string, unknown>) : null;
  if (!res.ok) {
    const error = typeof obj?.error === "string" ? obj.error : text.slice(0, 500);
    return { ok: false, status: res.status, cause: `HTTP ${res.status}: ${error}` };
  }
  if (!obj) return { ok: false, status: res.status, cause: `HTTP ${res.status}: a reply that is not a JSON object` };
  return { ok: true, status: res.status, json: obj };
}

// --------------------------------------------------------------- the payload --

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The fields a suggestion carries besides plugin_version, which this server adds: the card's fields
 * (card.ts cardFields), which suggestion-submit checks the shape of. previews are only ever on a record
 * an earlier version sent, which the Past suggestions page still shows. */
export interface SuggestionFields {
  title: string;
  body?: string;
  pain_point?: string;
  source: string;
  skill?: string;
  items?: unknown[];
  previews?: Array<{ label: string; chosen: boolean; reason?: string; html: string }>;
  origin?: string;
  fingerprint?: Record<string, unknown>;
  raw_observation?: string;
  environment_facts?: Record<string, unknown>;
  comment?: string;
  context_lines?: Array<{ kind: string; text: string }>;
  mockup?: string;
}

/** The screen over every field; throws naming the kinds hit, never the text. */
function screen(fields: SuggestionFields): void {
  const { previews, mockup, ...rest } = fields;
  const previewText = (previews ?? []).map(({ html: _html, ...other }) => other);
  const hits = findSuggestionHits({
    text: [rest, previewText],
    items: fields.items,
    previews: (previews ?? []).map((p) => p.html),
    ...(mockup === undefined ? {} : { mockup }),
  });
  if (hits.length > 0) {
    throw new ValidationError(`submit refused: ${hits.join(", ")}; rewrite the suggestion generically and resubmit. Nothing was saved or sent.`);
  }
}

// --------------------------------------------------------------- submitting --

export interface SendResult {
  record_id: string;
  /** Decision 13's card status: "Submitted ✓" or "Not sent, will retry". */
  status: string;
  suggestion_id: string | null;
  items_saved?: boolean;
  previews_saved?: boolean;
  mockup_saved?: boolean;
  /** Why it was not sent, in plain words, never the raw cause (which stays in the store). */
  not_sent_because?: "no_key" | "not_reached";
}

/** Saves `fields` as the exact payload, then sends it. Refused by the screen before anything is saved. */
export async function submitSuggestion(fields: SuggestionFields, env: NodeJS.ProcessEnv = process.env, seams: SendSeams = {}): Promise<SendResult> {
  screen(fields);
  const payload = JSON.stringify({ ...fields, plugin_version: pluginRelease(seams.installRoot) });
  const record = newSuggestionRecord(payload, fields.title, nowIso(seams));
  await withStore(env, (store) => {
    store.records.push(record);
  });
  return sendRecord(record.record_id, "click", env, seams);
}

/** Posts one claimed record (state "sending") and records the outcome. */
async function sendRecord(recordId: string, trigger: "click" | "start", env: NodeJS.ProcessEnv, seams: SendSeams): Promise<SendResult> {
  const key = await loadCloudKey(env, seams.keyStore);
  const store = await loadStore(env);
  const payload = findSuggestion(store, recordId).payload as string;
  if (!key.configured) {
    const record = await withStore(env, (s) => {
      const r = findSuggestion(s, recordId);
      r.state = "unsent";
      r.sending_since = null;
      r.attempts.push({ at: nowIso(seams), outcome: "no_key", trigger });
      return r;
    });
    return { record_id: recordId, status: cardStatus(record), suggestion_id: null, not_sent_because: "no_key" };
  }
  const posted = await post(key.supabaseUrl, key.staticKey, PATHS.submit, payload);
  const id = posted.ok && typeof posted.json.suggestion_id === "string" ? posted.json.suggestion_id : null;
  const record = await withStore(env, (s) => {
    const r = findSuggestion(s, recordId);
    r.sending_since = null;
    if (posted.ok && id) {
      r.state = "sent";
      r.suggestion_id = id;
      r.reply = {
        items_saved: posted.json.items_saved === true,
        previews_saved: posted.json.previews_saved === true,
        mockup_saved: posted.json.mockup_saved === true,
      };
      // The card showed "Submitted ✓", so Submitted is the badge already shown.
      r.badge = "Submitted";
      r.shown_badge = "Submitted";
      r.last_error = null;
      r.attempts.push({ at: nowIso(seams), outcome: "sent", trigger });
      return r;
    }
    const cause = posted.ok ? `HTTP ${posted.status}: a reply with no suggestion_id` : posted.cause;
    r.last_error = cause;
    r.attempts.push({ at: nowIso(seams), outcome: "failed", trigger, cause });
    if (trigger === "start") r.failed_sessions += 1;
    r.state = r.failed_sessions >= MAX_FAILED_SESSIONS ? "unreachable" : "unsent";
    return r;
  });
  return {
    record_id: recordId,
    status: cardStatus(record),
    suggestion_id: record.suggestion_id,
    ...(record.reply ?? {}),
    ...(record.state === "sent" ? {} : { not_sent_because: "not_reached" as const }),
  };
}

function retryable(record: SuggestionRecord, now: number): boolean {
  if (record.payload === null || record.withdrawn_at !== null) return false;
  if (record.state === "unsent") return true;
  return record.state === "sending" && (record.sending_since === null || now - Date.parse(record.sending_since) > STALE_SENDING_MS);
}

/** At a server start: retries every unsent record once, in order. Returns what happened to each. */
export async function retryUnsent(env: NodeJS.ProcessEnv = process.env, seams: SendSeams = {}): Promise<SendResult[]> {
  const now = (seams.now ? seams.now() : new Date()).getTime();
  const candidates = (await loadStore(env)).records.filter(isSuggestion).filter((r) => retryable(r, now)).map((r) => r.record_id);
  const results: SendResult[] = [];
  for (const recordId of candidates) {
    // Claimed under the lock, so two servers starting at once never both send one record.
    const claimed = await withStore(env, (s) => {
      const r = findSuggestion(s, recordId);
      if (!retryable(r, now)) return false;
      r.state = "sending";
      r.sending_since = nowIso(seams);
      return true;
    });
    if (claimed) results.push(await sendRecord(recordId, "start", env, seams));
  }
  return results;
}

// ----------------------------------------------------------------- statuses --

const NOT_CONFIGURED =
  "this computer has no Probanda key, so no status can be read: call cloud_key__configure_credential once " +
  "and have the practitioner paste the key on the page it serves, or, if they have none, call key_request__submit";

function cloudItems(value: unknown): CloudItem[] | null {
  if (!Array.isArray(value)) return null;
  const text = (v: unknown) => (typeof v === "string" ? v : null);
  return value.filter(isObject).map((row) => ({
    item: typeof row.item === "number" ? row.item : 0,
    status: text(row.status), reason: text(row.reason), category: text(row.category), implemented_in: text(row.implemented_in),
  }));
}

export interface StatusResult {
  suggestions: Array<{ suggestion_id: string; title: string; badge: string | null; shown_badge: string | null }>;
  /** The suggestion ids whose badge differs from the one last shown. */
  changed: string[];
}

/** Asks Probanda's Cloud for the badge of every sent suggestion this computer holds that is not
 * withdrawn (or of those named), and stores what comes back. A withdrawn suggestion is never asked about. */
export async function readStatuses(ids: string[] | undefined, env: NodeJS.ProcessEnv = process.env, seams: SendSeams = {}): Promise<StatusResult> {
  if (ids !== undefined && (ids.length > MAX_STATUS_IDS || !ids.every((id) => typeof id === "string" && UUID.test(id)))) {
    throw new ValidationError(`status's suggestion_ids, when given, must be 1 to ${MAX_STATUS_IDS} suggestion ids that submit returned`);
  }
  const wanted = ids === undefined ? null : new Set(ids.map((id) => id.toLowerCase()));
  const eligible = (await loadStore(env)).records.filter(isSuggestion)
    .filter((r) => r.suggestion_id !== null && r.withdrawn_at === null && r.state === "sent")
    .filter((r) => wanted === null || wanted.has((r.suggestion_id as string).toLowerCase()));
  if (eligible.length === 0) return { suggestions: [], changed: [] };
  const key = await loadCloudKey(env, seams.keyStore);
  if (!key.configured) throw new ValidationError(NOT_CONFIGURED);
  const asked = eligible.map((r) => (r.suggestion_id as string).toLowerCase());
  const rows = new Map<string, Record<string, unknown>>();
  for (let i = 0; i < asked.length; i += MAX_STATUS_IDS) {
    const posted = await post(key.supabaseUrl, key.staticKey, PATHS.status, JSON.stringify({ suggestion_ids: asked.slice(i, i + MAX_STATUS_IDS) }));
    if (!posted.ok || !Array.isArray(posted.json.statuses)) {
      throw new ValidationError(`Probanda's Cloud did not return the statuses (${posted.ok ? "no statuses in its reply" : posted.cause})`);
    }
    for (const row of posted.json.statuses) {
      if (isObject(row) && typeof row.suggestion_id === "string" && asked.includes(row.suggestion_id.toLowerCase())) {
        rows.set(row.suggestion_id.toLowerCase(), row);
      }
    }
  }
  const at = nowIso(seams);
  return withStore(env, (s) => {
    const records = s.records.filter(isSuggestion).filter((r) => r.suggestion_id !== null && asked.includes(r.suggestion_id.toLowerCase()));
    for (const r of records) {
      const row = rows.get((r.suggestion_id as string).toLowerCase());
      if (!row || r.withdrawn_at !== null) continue;
      if (typeof row.badge === "string") r.badge = row.badge;
      r.items = cloudItems(row.items) ?? r.items;
      r.checked_at = at;
    }
    return {
      suggestions: records.map((r) => ({ suggestion_id: r.suggestion_id as string, title: r.title, badge: r.badge, shown_badge: r.shown_badge })),
      changed: records.filter((r) => r.badge !== r.shown_badge).map((r) => r.suggestion_id as string),
    };
  });
}

// --------------------------------------------------------------- withdrawal --

export type WithdrawOutcome = "withdrawn" | "refused" | "unreachable" | "no_key" | "busy";

function markWithdrawn(r: SuggestionRecord, at: string): void {
  r.withdrawn_at = at;
  r.badge = "Withdrawn";
  r.shown_badge = "Withdrawn";
  r.withdraw_error = null;
}

/** Withdraws one suggestion this computer sent (decision 16). A suggestion never sent is withdrawn here
 * alone. A 409 may mean an earlier try already withdrew it, since the tombstone no longer names this
 * computer: then suggestion-status decides, and an id it no longer returns is withdrawn. */
export async function withdrawSuggestion(recordId: string, env: NodeJS.ProcessEnv = process.env, seams: SendSeams = {}): Promise<{ outcome: WithdrawOutcome; badge: string | null }> {
  const record = findSuggestion(await loadStore(env), recordId);
  if (record.withdrawn_at !== null) return { outcome: "withdrawn", badge: record.badge };
  const finish = (outcome: WithdrawOutcome, error: string | null) =>
    withStore(env, (s) => {
      const r = findSuggestion(s, recordId);
      if (outcome === "withdrawn") markWithdrawn(r, nowIso(seams));
      else r.withdraw_error = error;
      return { outcome, badge: r.badge };
    });
  if (record.suggestion_id === null) {
    if (record.state === "sending" && record.sending_since !== null && Date.now() - Date.parse(record.sending_since) <= STALE_SENDING_MS) {
      return { outcome: "busy", badge: record.badge };
    }
    return finish("withdrawn", null);
  }
  const key = await loadCloudKey(env, seams.keyStore);
  if (!key.configured) return finish("no_key", "no key configured");
  const id = record.suggestion_id;
  const posted = await post(key.supabaseUrl, key.staticKey, PATHS.withdraw, JSON.stringify({ suggestion_id: id }));
  if (posted.ok && posted.json.withdrawn === true) return finish("withdrawn", null);
  if (!posted.ok && posted.status === 409) {
    const status = await post(key.supabaseUrl, key.staticKey, PATHS.status, JSON.stringify({ suggestion_ids: [id] }));
    if (!status.ok || !Array.isArray(status.json.statuses)) {
      return finish("unreachable", `${posted.cause}; then suggestion-status: ${status.ok ? "no statuses in its reply" : status.cause}`);
    }
    const held = status.json.statuses.some((row) => isObject(row) && typeof row.suggestion_id === "string" && row.suggestion_id.toLowerCase() === id.toLowerCase());
    return held ? finish("refused", posted.cause) : finish("withdrawn", null);
  }
  const cause = posted.ok ? `HTTP ${posted.status}: a reply that does not say it was withdrawn` : posted.cause;
  const refused = !posted.ok && posted.status !== null && posted.status >= 400 && posted.status < 500 && posted.status !== 408 && posted.status !== 429;
  return finish(refused ? "refused" : "unreachable", cause);
}
