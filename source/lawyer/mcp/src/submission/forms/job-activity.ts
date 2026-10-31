// A job's last activity: one stored stamp per job, the kv_store value `last_activity` / `tickets:<id>`
// (schema v80), holding the minute as a JSON string, beside its session-active stamp, `db_meta`
// `job_active:<id>`. Every job tool that names a held job writes both, the drafting_data tools in the
// same transaction as their own write (touchStatements), and a turn that worked the job through no
// such tool writes them through drafting_data__touch_job (jobs-run.md §6a). Each write is guarded on
// the job's lock being the caller's under its claim (heldBy), so a write by any other session, or under
// an earlier claim, moves nothing.
// board_card's `last activity`, `session active` and the idle tag read them. Neither table carries
// revision triggers, so the revision does not move.

import { DataServerError, NotFoundError, ValidationError } from "../../errors.js";
import { submissionDataQuery, submissionDataWriteAll, type WriteStatement } from "../backend.js";
import { hasColumn, hasTable } from "../schema-capabilities.js";

/** A held job's staleness, measured from its last activity (ticket-category.ts idleSince): live under
 * CHECK_AFTER_MINUTES; in the check window from there, still held, its take-over only on the
 * practitioner's instruction; from LAPSE_AFTER_MINUTES its lock has lapsed, so every board reads it as
 * released and assign_job takes it without a take-over (ADR 0015). Lock-lapse times, never countdowns. */
export const CHECK_AFTER_MINUTES = 30;
export const LAPSE_AFTER_MINUTES = 60;

const NOW = "strftime('%Y-%m-%dT%H:%M', 'now', 'localtime')";
const NAMESPACE = "last_activity";
const touch = (held: string): string =>
  "INSERT INTO kv_store (namespace, key, value, updated_at) " +
  `SELECT '${NAMESPACE}', 'tickets:' || id, '"' || ${NOW} || '"', strftime('%Y-%m-%dT%H:%M:%fZ', 'now') FROM tickets WHERE id = ? AND ${held} ` +
  "ON CONFLICT (namespace, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at";

/** SQL for the claim number of the `tickets` row in scope (alias `t`): the kv_store value `claim_no` /
 * `tickets:<id>`, which assign_job raises by one on every claim of the job, a take-over and a re-take
 * after a release or a lapse included. NULL for a job never claimed since claims were numbered. */
export const claimSql = (t = "tickets"): string => `(SELECT CAST(value AS INTEGER) FROM kv_store WHERE namespace = 'claim_no' AND key = 'tickets:' || ${t}.id)`;

/** The statement that raises the job's claim number, under the assigning write's guard, so it lands
 * exactly when that write claims the job. Runs before that write, while its guard still matches. */
export function nextClaimSql(guard: string): string {
  return (
    "INSERT INTO kv_store (namespace, key, value, updated_at) " +
    `SELECT 'claim_no', 'tickets:' || id, COALESCE(${claimSql()}, 0) + 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now') FROM tickets WHERE id = ? AND ${guard} ` +
    "ON CONFLICT (namespace, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at"
  );
}

/** A holder guard: SQL true of the `tickets` row in scope (alias `t`) while `token` holds its lock under
 * claim `claim`, the claim_no assign_job returned (none for a job claimed before claims were
 * numbered). Every holder-guarded write carries it. The token alone on a database held below v80. */
export function heldBy(dbPath: string, token: string, claim: number | null, t = "tickets"): { sql: string; params: unknown[] } {
  return hasTable(dbPath, "kv_store") ? { sql: `${t}.locked_by = ? AND ${claimSql(t)} IS ?`, params: [token, claim] } : { sql: `${t}.locked_by = ?`, params: [token] };
}

/** The claim_no a holder-guarded tool was given, or null for none. Refuses, before anything is written,
 * a malformed one and, while `token` still holds job `id`, one that is not the job's current claim:
 * the call is work begun under an earlier claim of this session's, before a release or a lapse. */
export function checkClaim(tool: string, dbPath: string, id: number, token: string, claim: unknown): number | null {
  if (claim !== undefined && claim !== null && (!Number.isInteger(claim) || (claim as number) <= 0)) {
    throw new ValidationError(`${tool}.claim_no must be the claim_no drafting_data__assign_job returned; nothing was written`, "invalid_claim_no");
  }
  const given = (claim as number | null | undefined) ?? null;
  if (!hasTable(dbPath, "kv_store")) return given;
  const [row] = submissionDataQuery(dbPath, `SELECT locked_by, ${claimSql()} AS claim_no FROM tickets WHERE id = ?`, [id]).rows as unknown as { locked_by: string | null; claim_no: number | null }[];
  if (row !== undefined && row.locked_by === token && row.claim_no !== given) {
    throw new DataServerError(
      `${tool}: nothing was written. ${given === null ? "This call passed no claim_no" : `claim_no ${given} is not job ${id}'s current claim`}, so it is work begun under another claim of the job. ` +
        "Pass the claim_no of this session's latest drafting_data__assign_job for the job; with none, report it and stop. Never re-run to win.",
      "stale_claim"
    );
  }
  return given;
}

/** The statements that move job `id`'s session-active stamp and last activity to now, each landing
 * only under `held` (heldBy). Appended to a tool's own write, they run in its transaction and see its
 * result. None on a database held below v80, which has no last-activity stamp. */
export function touchStatements(dbPath: string, id: number, held: { sql: string; params: unknown[] }): WriteStatement[] {
  if (!hasTable(dbPath, "kv_store")) return [];
  return [
    { sql: `INSERT OR REPLACE INTO db_meta (key, value) SELECT 'job_active:' || id, ${NOW} FROM tickets WHERE id = ? AND ${held.sql}`, params: [id, ...held.params] },
    { sql: touch(held.sql), params: [id, ...held.params] },
  ];
}

/** Moves job `id`'s session-active stamp and last activity to now, on their own, when `token` holds its
 * lock under `claim`. False when it does not, and on a database held below v80. */
export async function touchJob(dbPath: string, id: number, token: string, claim: number | null, env: NodeJS.ProcessEnv = process.env): Promise<{ recorded: boolean; warning?: string }> {
  const statements = touchStatements(dbPath, id, heldBy(dbPath, token, claim));
  if (statements.length === 0) return { recorded: false };
  const written = await submissionDataWriteAll(dbPath, statements, env);
  return { recorded: written.ok && written.results[1].changes === 1, ...(written.warning ? { warning: written.warning } : {}) };
}

/** Each job's last activity by id; empty on a database held below v80. */
export function fetchJobActivity(dbPath: string): Map<number, string> {
  if (!hasTable(dbPath, "kv_store")) return new Map();
  const found = submissionDataQuery(dbPath, "SELECT key, value FROM kv_store WHERE namespace = ?", [NAMESPACE]).rows as unknown as { key: string; value: string }[];
  return new Map(found.map((r) => [Number(r.key.slice("tickets:".length)), JSON.parse(r.value) as string]));
}

/** SQL for the `tickets` row in scope's last activity exactly as its card prints it: the stamp, else its lock. */
export function lastActivitySql(dbPath: string): string {
  return hasTable(dbPath, "kv_store")
    ? `COALESCE((SELECT trim(value, '"') FROM kv_store WHERE namespace = '${NAMESPACE}' AND key = 'tickets:' || tickets.id), tickets.locked_at)`
    : "tickets.locked_at";
}

/** SQL true of the `tickets` row in scope when it has been idle for `minutes` or more by SQLite's
 * local clock, measured as idleSince measures it; false with nothing to measure from. */
export function idleClause(dbPath: string, minutes: number): string {
  const stamp = "replace(substr(tickets.locked_at, 1, 16), ' ', 'T')";
  const last = hasTable(dbPath, "kv_store")
    ? `COALESCE((SELECT trim(value, '"') FROM kv_store WHERE namespace = '${NAMESPACE}' AND key = 'tickets:' || tickets.id), ${stamp})`
    : stamp;
  const wait = hasColumn(dbPath, "ticket_steps", "wait_until")
    ? ", COALESCE((SELECT max(wait_until) FROM ticket_steps s WHERE s.ticket_id = tickets.id AND s.done_at IS NULL AND s.status = 'waiting'), '')"
    : "";
  return `COALESCE(max(${last}${wait}, '') <= strftime('%Y-%m-%dT%H:%M', 'now', 'localtime', '-${minutes} minutes'), 0)`;
}

/** SQL true of the `tickets` row in scope when its lock has lapsed: held, not shelved, and idle for
 * LAPSE_AFTER_MINUTES or more. ticket-category.ts lockLapsed is the same test for the board. */
export function lapsedClause(dbPath: string): string {
  return `(tickets.status = 'wip' AND tickets.locked_by IS NOT NULL AND tickets.rejected_at IS NULL AND ${idleClause(dbPath, LAPSE_AFTER_MINUTES)})`;
}

/** The statement that records a lapse in the job's history, the kv_store value `lock_lapsed` /
 * `tickets:<id>`: the minute it was taken and the holder tag it was taken from. Its guard is the
 * assigning write's, so it lands exactly when that write takes a lapsed lock. */
export function recordLapseSql(guard: string): string {
  return (
    "INSERT INTO kv_store (namespace, key, value, updated_at) " +
    `SELECT 'lock_lapsed', 'tickets:' || id, '{"at":"' || ${NOW} || '","from":"' || substr(locked_by, -8) || '"}', strftime('%Y-%m-%dT%H:%M:%fZ', 'now') ` +
    `FROM tickets WHERE id = ? AND status = 'wip' AND ${guard} ` +
    "ON CONFLICT (namespace, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at"
  );
}

export interface JobIdentity {
  db_path?: string;
  ticket_id?: number;
  session_token?: string;
  /** The claim_no the holder's drafting_data__assign_job returned. */
  claim_no?: number;
}

/** The job a call names, or null when it names none. Refuses, before anything is written, a call
 * naming only some of the three, a bad id or token, and a claim_no checkClaim refuses. */
export function jobIdentity(tool: string, args: JobIdentity): { dbPath: string; id: number; token: string; claim: number | null } | null {
  const named = [args.db_path, args.ticket_id, args.session_token].filter((v) => v !== undefined).length;
  if (named === 0 && args.claim_no === undefined) return null;
  if (named < 3) throw new ValidationError(`${tool} takes db_path, ticket_id and session_token together, or none of them; nothing was written`, "invalid_job");
  if (!Number.isInteger(args.ticket_id) || (args.ticket_id as number) <= 0) throw new ValidationError(`${tool}.ticket_id must be a positive integer; nothing was written`, "invalid_ticket_id");
  if (typeof args.session_token !== "string" || args.session_token.trim() === "") {
    throw new ValidationError(`${tool}.session_token must be the session_token open_session or bootstrap returned; nothing was written`, "invalid_session_token");
  }
  const [dbPath, id, token] = [args.db_path as string, args.ticket_id as number, args.session_token];
  return { dbPath, id, token, claim: checkClaim(tool, dbPath, id, token, args.claim_no) };
}

/** Runs a research_filing write, then, when the call names a job, moves its last activity. */
export async function withJobActivity<T extends object>(tool: string, args: JobIdentity, run: () => T | Promise<T>): Promise<T | (T & { job: { ticket_id: number; recorded: boolean } })> {
  const job = jobIdentity(tool, args);
  const result = await run();
  return job === null ? result : { ...result, job: { ticket_id: job.id, recorded: (await touchJob(job.dbPath, job.id, job.token, job.claim)).recorded } };
}

export interface TouchJobArgs {
  db_path: string;
  ticket_id: number;
  /** This session's identity from open_session/bootstrap. Never minted here. */
  session_token: string;
  claim_no?: number;
}

/** drafting_data__touch_job: a turn that worked the held job through no job tool. Writes the job's
 * session-active stamp and moves its last activity, both only while the lock is this session's. */
export async function submissionDataTouchJob(args: TouchJobArgs, env: NodeJS.ProcessEnv = process.env): Promise<{ ticket_id: number; recorded: boolean; note: string; warning?: string }> {
  const tool = "drafting_data__touch_job";
  const job = jobIdentity(tool, args);
  if (job === null) throw new ValidationError(`${tool} takes db_path, ticket_id and session_token; nothing was written`, "invalid_job");
  const { dbPath, id, token, claim } = job;
  if (submissionDataQuery(dbPath, "SELECT id FROM tickets WHERE id = ?", [id]).rows.length === 0) throw new NotFoundError(`${tool}: no job ${id} in ${dbPath}`, "not_found");
  if (!hasTable(dbPath, "kv_store")) {
    throw new ValidationError(`${tool}: ${dbPath} is held below schema v80, so job ${id} has no last-activity stamp; nothing was written.`, "schema_below_v80");
  }
  const { recorded, warning } = await touchJob(dbPath, id, token, claim, env);
  const warned = warning ? { warning } : {};
  return recorded
    ? { ticket_id: id, recorded, note: `Job ${id}'s session-active stamp and last activity are now.`, ...warned }
    : { ticket_id: id, recorded, note: `Nothing was written: job ${id} is not this session's (taken over, shelved or completed). Run the scope read and stop.`, ...warned };
}
