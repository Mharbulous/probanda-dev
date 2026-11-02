// The Loose Threads page's Defer write: the page API (../../page-api/server.ts) sets or clears one open
// loose thread's deferred_at in the store, under the data lock. The guard is the page's own set: the
// thread's proceeding, open by the same test fetchOpenSeeds reads with (isOpenThread), and not already
// in the state asked for. One read, one write, never a retry. Sessions write the same field through
// loose_threads__update.

import { isOpenThread, readThreads, threadStamp, writeThreads } from "../../loose-threads/backend.js";
import { acquireDataLock } from "../lock.js";
import { fetchDeletedTickets } from "./render-work-board.js";

export interface SeedDeferralArgs {
  db_path: string;
  proceeding_id: number;
  seed_id: number;
  action: "defer" | "undefer";
}

export interface SeedDeferralResult {
  seed_id: number;
  outcome: "deferred" | "undeferred" | "not_found" | "wrong_proceeding" | "not_open" | "already";
  /** The deferred_at after this call; null when there is no such loose thread. */
  deferred_at: string | null;
}

/** Defers or undefers one open loose thread. Every outcome but deferred and undeferred writes nothing. */
export async function setSeedDeferral(args: SeedDeferralArgs, env: NodeJS.ProcessEnv = process.env): Promise<SeedDeferralResult> {
  const lock = await acquireDataLock(args.db_path, env);
  try {
    const thread = readThreads(args.db_path, env).find((t) => t.id === args.seed_id);
    const done = (outcome: SeedDeferralResult["outcome"], deferredAt: string | null): SeedDeferralResult => ({ seed_id: args.seed_id, outcome, deferred_at: deferredAt });
    if (thread === undefined) return done("not_found", null);
    if (thread.proceeding_id !== args.proceeding_id) return done("wrong_proceeding", thread.deferred_at);
    const deletedIds = new Set(fetchDeletedTickets(args.db_path, args.proceeding_id).map((d) => d.id));
    if (!isOpenThread(thread, deletedIds)) return done("not_open", thread.deferred_at);
    if ((thread.deferred_at !== null) === (args.action === "defer")) return done("already", thread.deferred_at);
    const deferredAt = args.action === "defer" ? threadStamp() : null;
    writeThreads(args.db_path, [{ ...thread, deferred_at: deferredAt }], env);
    return done(args.action === "defer" ? "deferred" : "undeferred", deferredAt);
  } finally {
    lock.release();
  }
}
