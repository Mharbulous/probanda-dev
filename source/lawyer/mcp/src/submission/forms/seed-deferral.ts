// The Loose Threads page's Defer write (schema v68): the page API (../../page-api/server.ts) sets or
// clears one open loose thread's deferred_at, the guarded write followed by its confirm-read, as
// release-job.ts does for a job. The guard is the page's own set: the thread's proceeding, open by
// the same condition fetchOpenSeeds reads with (openSeedCondition), and not already in the state
// asked for. One write, one read, never a retry. seeds carries no revision triggers (ADR 0009), so
// the revision does not move. Sessions write the same column by the raw idiom in jobs-run.md §8.

import { submissionDataQuery, submissionDataWriteAll } from "../backend.js";
import { seedClosedColumns } from "./query.js";
import { fetchDeletedTickets, openSeedCondition } from "./render-work-board.js";

export interface SeedDeferralArgs {
  db_path: string;
  proceeding_id: number;
  seed_id: number;
  action: "defer" | "undefer";
}

export interface SeedDeferralResult {
  seed_id: number;
  outcome: "deferred" | "undeferred" | "not_found" | "wrong_proceeding" | "not_open" | "already";
  /** The confirm-read's deferred_at; null when there is no such loose thread. */
  deferred_at: string | null;
  warning?: string;
}

interface ConfirmRow {
  proceeding_id: number;
  charted_into: number | null;
  deferred_at: string | null;
  /** Read only where the database holds them (schema v75). */
  discarded_at?: string | null;
  suggested_at?: string | null;
}

/** Defers or undefers one open loose thread. Every outcome but deferred and undeferred writes nothing. */
export async function setSeedDeferral(args: SeedDeferralArgs, env: NodeJS.ProcessEnv = process.env): Promise<SeedDeferralResult> {
  const deletedIds = new Set(fetchDeletedTickets(args.db_path, args.proceeding_id).map((d) => d.id));
  const open = openSeedCondition(args.db_path, deletedIds);
  const sql =
    args.action === "defer"
      ? `UPDATE seeds SET deferred_at = strftime('%Y-%m-%dT%H:%M', 'now', 'localtime') WHERE id = ? AND proceeding_id = ? AND ${open.sql} AND deferred_at IS NULL`
      : `UPDATE seeds SET deferred_at = NULL WHERE id = ? AND proceeding_id = ? AND ${open.sql} AND deferred_at IS NOT NULL`;
  const written = await submissionDataWriteAll(args.db_path, [{ sql, params: [args.seed_id, args.proceeding_id, ...open.params], expect_changes: 1 }], env);
  const changes = written.ok ? written.results[0].changes : written.changes;
  const [read] = submissionDataQuery(args.db_path, `SELECT proceeding_id, charted_into, deferred_at${seedClosedColumns(args.db_path).map((c) => `, ${c}`).join("")} FROM seeds WHERE id = ?`, [args.seed_id]).rows as unknown as ConfirmRow[];
  let outcome: SeedDeferralResult["outcome"];
  if (read === undefined) outcome = "not_found";
  else if (changes === 1) outcome = args.action === "defer" ? "deferred" : "undeferred";
  else if (read.proceeding_id !== args.proceeding_id) outcome = "wrong_proceeding";
  else if ((read.charted_into !== null && !deletedIds.has(read.charted_into)) || read.discarded_at != null || read.suggested_at != null) outcome = "not_open";
  else outcome = "already";
  return {
    seed_id: args.seed_id,
    outcome,
    deferred_at: read?.deferred_at ?? null,
    ...(written.warning ? { warning: written.warning } : {}),
  };
}
