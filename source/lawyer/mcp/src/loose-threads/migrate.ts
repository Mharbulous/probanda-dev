// The one move of a matter's loose threads out of the drafting database's `seeds` table into its own
// store (./backend.ts). open_session runs it, and each loose_threads__* tool first, so a session that
// entered by bootstrap never captures beside rows still waiting to move. It copies the database aside,
// copies every row under its own id, confirms each id is held, empties `seeds` and stamps a marker, in
// that order: a kill at any point leaves a state the next run finishes, and a thread already in the
// store is never overwritten. The emptied table stays, since dropping it means schema work.
//
// review_points.seed_id REFERENCES seeds(id) and writes run with foreign keys on, so the delete runs
// with them off for its one write. Each old link stays as the plain number it was, and thread ids are
// kept, so it names the same thread in the store. A new link cannot be written there, since the
// reference has no row to find: a thread from a review point carries `ref` instead (review.md).

import { copyFileSync } from "node:fs";

import { DataServerError } from "../errors.js";
import { timestampedBackups } from "../migrate-backups.js";
import { acquireDataLock } from "../submission/lock.js";
import { submissionDataQuery, submissionDataWriteAll } from "../submission/backend.js";
import { hasTable } from "../submission/schema-capabilities.js";
import { type LooseThread, readSeedsMoved, readThreads, stampSeedsMoved, writeThreads } from "./backend.js";

export interface SeedsMove {
  /** The rows moved by this call. */
  moved: number;
  /** The copy-aside taken first. */
  backup: string;
}

export interface SeedsLeft {
  /** Rows `seeds` holds after the one move, which nothing reads: an older copy of the plugin wrote them. */
  stray: number;
}

const value = <T>(row: Record<string, unknown>, column: string): T | null => (row[column] ?? null) as T | null;

function threadOf(row: Record<string, unknown>): LooseThread {
  return {
    id: row.id as number,
    kind: "idea",
    idea: row.idea as string,
    surfaced_by: row.surfaced_by as string,
    created: row.created as string,
    proceeding_id: row.proceeding_id as number,
    filing_id: value(row, "filing_id"),
    origin_job: value(row, "origin_ticket_id"),
    charted_into: value(row, "charted_into"),
    // Absent on a database held below the hop that added each.
    rank: value(row, "rank"),
    rank_group: value(row, "rank_group"),
    rank_reason: value(row, "rank_reason"),
    rank_job: value(row, "rank_job"),
    deferred_at: value(row, "deferred_at"),
    discarded_at: value(row, "discarded_at"),
    suggested_at: value(row, "suggested_at"),
  };
}

/** `submission.sqlite.bak-<UTC stamp>[-n]`, the migrate engines' own name (../migrate-backups.ts). */
function backupName(dbPath: string): string {
  const stamp = new Date().toISOString().replace(/[-:]|\.\d+/g, "");
  const held = timestampedBackups(dbPath);
  const base = `.bak-${stamp}`;
  const name = dbPath.split(/[\\/]/).pop() as string;
  let suffix = base;
  for (let n = 1; held.has(name + suffix); n += 1) suffix = `${base}-${n}`;
  return dbPath + suffix;
}

/** Moves the rows once. Null when `seeds` holds nothing, which costs one read and no Python start. */
export async function moveSeedsOnce(dbPath: string, env: NodeJS.ProcessEnv = process.env): Promise<SeedsMove | SeedsLeft | null> {
  if (!hasTable(dbPath, "seeds")) return null;
  const seeds = submissionDataQuery(dbPath, "SELECT * FROM seeds ORDER BY id").rows;
  if (seeds.length === 0) return null;
  if (readSeedsMoved(dbPath, env) !== null) return { stray: seeds.length };

  const backup = backupName(dbPath);
  const lock = await acquireDataLock(dbPath, env);
  try {
    copyFileSync(dbPath, backup);
  } finally {
    lock.release();
  }
  const held = new Set(readThreads(dbPath, env).map((t) => t.id));
  const fresh = seeds.map(threadOf).filter((t) => !held.has(t.id));
  if (fresh.length > 0) writeThreads(dbPath, fresh, env);
  const now = new Set(readThreads(dbPath, env).map((t) => t.id));
  const missing = seeds.filter((row) => !now.has(row.id as number)).length;
  if (missing > 0) throw new DataServerError(`${missing} of ${seeds.length} loose threads did not reach the store, so the drafting database was left as it was.`, "loose_threads_not_moved");
  const emptied = await submissionDataWriteAll(dbPath, [{ sql: "DELETE FROM seeds WHERE id <= ?", params: [seeds[seeds.length - 1].id] }], env, { foreignKeysOff: true });
  if (!emptied.ok) throw new DataServerError("The moved loose threads could not be removed from the drafting database.", "loose_threads_not_moved");
  stampSeedsMoved(dbPath, JSON.stringify({ moved: seeds.length, backup }), env);
  return { moved: seeds.length, backup };
}
