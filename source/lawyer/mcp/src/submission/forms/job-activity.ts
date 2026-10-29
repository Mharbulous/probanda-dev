// A job's last activity: one stored stamp per job, the kv_store value `last_activity` / `tickets:<id>`
// (schema v80), holding the minute as a JSON string. Every server write made for a held job moves it
// through touchJob, and the holding session's turn end moves it through drafting_data__touch_job
// (jobs-run.md §6a). Each write is guarded on the job's lock being the caller's (jobs-run.md §5), so a
// write by any other session moves nothing. board_card's `last activity` and the idle tag read it.
// kv_store carries no revision triggers, so the revision does not move.

import { NotFoundError, ValidationError } from "../../errors.js";
import { submissionDataQuery, submissionDataWrite, submissionDataWriteAll } from "../backend.js";
import { hasColumn, hasTable } from "../schema-capabilities.js";

/** A held job's staleness, measured from its last activity (ticket-category.ts idleSince): live under
 * CHECK_AFTER_MINUTES; in the check window from there, still held, its take-over only on the
 * practitioner's instruction; from LAPSE_AFTER_MINUTES its lock has lapsed, so every board reads it as
 * released and assign_job takes it without a take-over (ADR 0015). Lock-lapse times, never countdowns. */
export const CHECK_AFTER_MINUTES = 30;
export const LAPSE_AFTER_MINUTES = 60;

const NOW = "strftime('%Y-%m-%dT%H:%M', 'now', 'localtime')";
const NAMESPACE = "last_activity";
const TOUCH =
  "INSERT INTO kv_store (namespace, key, value, updated_at) " +
  `SELECT '${NAMESPACE}', 'tickets:' || id, '"' || ${NOW} || '"', strftime('%Y-%m-%dT%H:%M:%fZ', 'now') FROM tickets WHERE id = ? AND locked_by = ? ` +
  "ON CONFLICT (namespace, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at";

/** Moves job `id`'s last activity to now when `token` holds its lock. False when it does not, and on
 * a database held below v80, which has no stamp. */
export async function touchJob(dbPath: string, id: number, token: string, env: NodeJS.ProcessEnv = process.env): Promise<boolean> {
  if (!hasTable(dbPath, "kv_store")) return false;
  return (await submissionDataWrite(dbPath, TOUCH, [id, token], env)).changes === 1;
}

/** Each job's last activity by id; empty on a database held below v80. */
export function fetchJobActivity(dbPath: string): Map<number, string> {
  if (!hasTable(dbPath, "kv_store")) return new Map();
  const found = submissionDataQuery(dbPath, "SELECT key, value FROM kv_store WHERE namespace = ?", [NAMESPACE]).rows as unknown as { key: string; value: string }[];
  return new Map(found.map((r) => [Number(r.key.slice("tickets:".length)), JSON.parse(r.value) as string]));
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
}

/** The job a call names, or null when it names none. Refuses, before anything is written, a call
 * naming only some of the three, or a bad id or token. */
export function jobIdentity(tool: string, args: JobIdentity): { dbPath: string; id: number; token: string } | null {
  const named = [args.db_path, args.ticket_id, args.session_token].filter((v) => v !== undefined).length;
  if (named === 0) return null;
  if (named < 3) throw new ValidationError(`${tool} takes db_path, ticket_id and session_token together, or none of them; nothing was written`, "invalid_job");
  if (!Number.isInteger(args.ticket_id) || (args.ticket_id as number) <= 0) throw new ValidationError(`${tool}.ticket_id must be a positive integer; nothing was written`, "invalid_ticket_id");
  if (typeof args.session_token !== "string" || args.session_token.trim() === "") {
    throw new ValidationError(`${tool}.session_token must be the session_token open_session or bootstrap returned; nothing was written`, "invalid_session_token");
  }
  return { dbPath: args.db_path as string, id: args.ticket_id as number, token: args.session_token };
}

/** Runs a research_filing write, then, when the call names a job, moves its last activity. */
export async function withJobActivity<T extends object>(tool: string, args: JobIdentity, run: () => T | Promise<T>): Promise<T | (T & { job: { ticket_id: number; recorded: boolean } })> {
  const job = jobIdentity(tool, args);
  const result = await run();
  return job === null ? result : { ...result, job: { ticket_id: job.id, recorded: await touchJob(job.dbPath, job.id, job.token) } };
}

export interface TouchJobArgs {
  db_path: string;
  ticket_id: number;
  /** This session's identity from open_session/bootstrap. Never minted here. */
  session_token: string;
}

/** drafting_data__touch_job: the holding session's turn end. Writes the job's session-active stamp
 * (`db_meta` `job_active:<id>`) and moves its last activity, both only while the lock is this session's. */
export async function submissionDataTouchJob(args: TouchJobArgs, env: NodeJS.ProcessEnv = process.env): Promise<{ ticket_id: number; recorded: boolean; note: string; warning?: string }> {
  const tool = "drafting_data__touch_job";
  const job = jobIdentity(tool, args);
  if (job === null) throw new ValidationError(`${tool} takes db_path, ticket_id and session_token; nothing was written`, "invalid_job");
  const { dbPath, id, token } = job;
  if (submissionDataQuery(dbPath, "SELECT id FROM tickets WHERE id = ?", [id]).rows.length === 0) throw new NotFoundError(`${tool}: no job ${id} in ${dbPath}`, "not_found");
  if (!hasTable(dbPath, "kv_store")) {
    throw new ValidationError(`${tool}: ${dbPath} is held below schema v80, so job ${id} has no last-activity stamp; nothing was written.`, "schema_below_v80");
  }
  const written = await submissionDataWriteAll(
    dbPath,
    [
      { sql: `INSERT OR REPLACE INTO db_meta (key, value) SELECT 'job_active:' || id, ${NOW} FROM tickets WHERE id = ? AND locked_by = ?`, params: [id, token] },
      { sql: TOUCH, params: [id, token] },
    ],
    env
  );
  const recorded = written.ok && written.results[1].changes === 1;
  const warning = written.warning ? { warning: written.warning } : {};
  return recorded
    ? { ticket_id: id, recorded, note: `Job ${id}'s session-active stamp and last activity are now.`, ...warning }
    : { ticket_id: id, recorded, note: `Nothing was written: job ${id} is not this session's (taken over, shelved or completed). Run the scope read and stop.`, ...warning };
}
