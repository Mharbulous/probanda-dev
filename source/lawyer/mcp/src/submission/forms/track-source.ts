// drafting_data__track_source: the session holding a job records each source to get (a decision, an
// enactment or a file its work has named and is about to retrieve or read) in ticket_sources (schema
// v76), and closes each one as got or not retrieved. The rows are the job's own record beside its
// steps, as ticket_answers is: the steps stay the practitioner's approved plan and are never written
// here. Every statement is guarded on the job's lock being this session's (jobs-run.md §5), so a call
// that writes nothing is still the lock read before a dispatch. Adding an item already on the job
// leaves an open one alone and reopens a closed one, so a retry can be closed as got. The job tables
// carry no revision triggers, so the revision does not move.

import { NotFoundError, ValidationError } from "../../errors.js";
import { submissionDataQuery, submissionDataWriteAll, type WriteStatement } from "../backend.js";

const TOOL = "drafting_data__track_source";
const NOW = "strftime('%Y-%m-%dT%H:%M', 'now', 'localtime')";
const KINDS = ["decision", "legislation", "file"];
const OUTCOMES = ["got", "not_retrieved"];
const LABEL_MAX = 200;
const REASON_MAX = 60;

export interface TrackSourceArgs {
  db_path: string;
  ticket_id: number;
  /** This session's identity from open_session/bootstrap. Never minted here. */
  session_token: string;
  add?: { kind: string; label: string }[];
  close?: { kind: string; label: string; outcome: string; reason?: string }[];
}

export interface SourceRow {
  id: number;
  kind: string;
  label: string;
  added_at: string;
  closed_at: string | null;
  outcome: string | null;
  reason: string | null;
}

export interface TrackSourceResult {
  ticket_id: number;
  outcome: "recorded" | "not_held" | "shelved" | "completed" | "no_match";
  /** Every source to get on the job, open and closed, in the order added. */
  sources: SourceRow[];
  open: number;
  /** Each `close` item that names no source on the job, as `<kind>: <label>`. */
  unknown: string[];
  locked_by: string | null;
  status: string;
  rejected_at: string | null;
  note: string;
  warning?: string;
}

interface HolderRow {
  status: string;
  rejected_at: string | null;
  locked_by: string | null;
}

/** Databases known to hold `ticket_sources` (schema v76). Only a present table is remembered. */
const ticketSourcesHeldDbs = new Set<string>();

/** Whether the database holds `ticket_sources` (schema v76). A database held below v76 has no source
 * to get on any job, so a job's card lists none there. */
export function ticketSourcesHeld(dbPath: string): boolean {
  if (ticketSourcesHeldDbs.has(dbPath)) return true;
  const [{ n }] = submissionDataQuery(dbPath, "SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name = 'ticket_sources'").rows as unknown as { n: number }[];
  if (n > 0) ticketSourcesHeldDbs.add(dbPath);
  return n > 0;
}

function oneLine(value: unknown, field: string, max: number): string {
  if (typeof value !== "string" || value.trim() === "" || /[\r\n]/.test(value) || value.trim().length > max) {
    throw new ValidationError(`${TOOL}.${field} must be one line of 1 to ${max} characters; nothing was written`, "invalid_item");
  }
  return value.trim();
}

function oneOf(value: unknown, field: string, allowed: string[]): string {
  if (typeof value !== "string" || !allowed.includes(value)) {
    throw new ValidationError(`${TOOL}.${field} must be one of ${allowed.join(", ")}; nothing was written`, "invalid_item");
  }
  return value;
}

/** drafting_data__track_source. Every refusal writes nothing. */
export async function submissionDataTrackSource(args: TrackSourceArgs, env: NodeJS.ProcessEnv = process.env): Promise<TrackSourceResult> {
  if (!Number.isInteger(args.ticket_id) || args.ticket_id <= 0) throw new ValidationError(`${TOOL}.ticket_id must be a positive integer`, "invalid_ticket_id");
  if (typeof args.session_token !== "string" || args.session_token.trim() === "") {
    throw new ValidationError(`${TOOL}.session_token must be the session_token open_session or bootstrap returned`, "invalid_session_token");
  }
  const id = args.ticket_id;
  const token = args.session_token;
  const add = (args.add ?? []).map((a) => ({ kind: oneOf(a.kind, "add.kind", KINDS), label: oneLine(a.label, "add.label", LABEL_MAX) }));
  const close = (args.close ?? []).map((c) => ({
    kind: oneOf(c.kind, "close.kind", KINDS),
    label: oneLine(c.label, "close.label", LABEL_MAX),
    outcome: oneOf(c.outcome, "close.outcome", OUTCOMES),
    reason: c.reason === undefined ? null : oneLine(c.reason, "close.reason", REASON_MAX),
  }));
  if (submissionDataQuery(args.db_path, "SELECT id FROM tickets WHERE id = ?", [id]).rows.length === 0) {
    throw new NotFoundError(`${TOOL}: no job ${id} in ${args.db_path}`, "not_found");
  }
  if (!ticketSourcesHeld(args.db_path)) {
    throw new ValidationError(
      `${TOOL}: ${args.db_path} is held below schema v76, so no source to get can be recorded on job ${id}; nothing was written. Say once that the matter's database needs the v76 migration, and carry on with the work.`,
      "schema_below_v76"
    );
  }

  const held = "EXISTS (SELECT 1 FROM tickets WHERE id = ? AND locked_by = ?)";
  const statements: WriteStatement[] = [
    ...add.flatMap((a) => [
      {
        sql: `UPDATE ticket_sources SET closed_at = NULL, outcome = NULL, reason = NULL WHERE ticket_id = ? AND kind = ? AND label = ? AND closed_at IS NOT NULL AND ${held}`,
        params: [id, a.kind, a.label, id, token],
      },
      {
        sql: `INSERT OR IGNORE INTO ticket_sources (ticket_id, kind, label, added_at) SELECT id, ?, ?, ${NOW} FROM tickets WHERE id = ? AND locked_by = ?`,
        params: [a.kind, a.label, id, token],
      },
    ]),
    ...close.map((c) => ({
      sql: `UPDATE ticket_sources SET closed_at = ${NOW}, outcome = ?, reason = ? WHERE ticket_id = ? AND kind = ? AND label = ? AND ${held}`,
      params: [c.outcome, c.reason, id, c.kind, c.label, id, token],
    })),
  ];
  const written = statements.length === 0 ? null : await submissionDataWriteAll(args.db_path, statements, env);

  const [read] = submissionDataQuery(args.db_path, "SELECT status, rejected_at, locked_by FROM tickets WHERE id = ?", [id]).rows as unknown as HolderRow[];
  if (read === undefined) throw new NotFoundError(`${TOOL}: no job ${id} in ${args.db_path}`, "not_found");
  const sources = submissionDataQuery(args.db_path, "SELECT id, kind, label, added_at, closed_at, outcome, reason FROM ticket_sources WHERE ticket_id = ? ORDER BY id", [id])
    .rows as unknown as SourceRow[];
  const open = sources.filter((s) => s.closed_at === null).length;
  const on = new Set(sources.map((s) => `${s.kind}: ${s.label}`));
  let outcome: TrackSourceResult["outcome"];
  let note: string;
  let unknown: string[] = [];
  if (read.locked_by === token) {
    outcome = "recorded";
    unknown = close.map((c) => `${c.kind}: ${c.label}`).filter((k) => !on.has(k));
    note = `Job ${id} is this session's: ${sources.length} source${sources.length === 1 ? "" : "s"} to get on it, ${open} open.${unknown.length > 0 ? ` ${unknown.length} close item${unknown.length === 1 ? " names" : "s name"} no source on the job and closed nothing.` : ""}`;
  } else if (read.locked_by !== null) {
    outcome = "not_held";
    note = `Nothing was written: another session holds job ${id} (taken over). Dispatch nothing for this job; report it and stop.`;
  } else if (read.rejected_at !== null) {
    outcome = "shelved";
    note = `Nothing was written: job ${id} is shelved (rejected_at ${read.rejected_at}). Dispatch nothing for this job; report it and stop.`;
  } else if (read.status === "completed") {
    outcome = "completed";
    note = `Nothing was written: job ${id} is completed. Dispatch nothing for this job; report it and stop.`;
  } else {
    outcome = "no_match";
    note = `Nothing was written: job ${id} is status=${read.status} with no holder, so the guards matched nothing. Dispatch nothing for this job; report it and stop.`;
  }
  return {
    ticket_id: id,
    outcome,
    sources,
    open,
    unknown,
    locked_by: read.locked_by,
    status: read.status,
    rejected_at: read.rejected_at,
    note,
    ...(written?.warning ? { warning: written.warning } : {}),
  };
}
