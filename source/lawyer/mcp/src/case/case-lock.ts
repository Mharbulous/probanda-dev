// Exclusive cross-process lock for matter-data writes -- both `matter_data__execute`
// and `matter_data__migrate` take it, so a write and a migration on one matter can
// never interleave.
//
// A server process must never assume it is the only writer. How many
// instances of this server a host spawns is a host implementation detail and
// is not load-bearing anywhere: Claude Code desktop spawns one per session,
// Cowork's Electron main process spawns one and shares it across every
// session on the machine (#586), and more than one host or app run can be
// live at once. An in-process mutex would therefore be theatre. Two writers interleaving a
// migrate's stage → chain → replace, or an execute's stage → mutate →
// copy-back, would silently lose one of them: both stage from the same
// starting binaries and the second copy-back wins, with no error. (The
// premise corrected here is #609's; the conclusion is unchanged.)
//
// The lock file is HOST-LOCAL, not in the matter directory. A lockfile inside
// the SharePoint-synced tree is replicated with sync latency, so it is neither
// a reliable mutex nor promptly released, and it would surface as a mystery
// file in a client document library. What this defends against is concurrent
// server instances on one host, which a host-local lock covers exactly;
// cross-machine concurrency on synced storage is not solvable by any lockfile
// and is caught instead by the plan-token freshness check.
//
// Keyed on matter_root rather than case_data_dir so the lock can be taken
// BEFORE pointer resolution, which itself rewrites probanda.json and may move
// binaries out of the legacy `9. AI` folder.

import { readFileSync, writeFileSync } from "node:fs";

import { acquireLock, hostLocalFile, liveLockRecord, type HeldLock, type LockSite } from "../data-lock.js";

const SITE: LockSite = {
  envVar: "COCLERK_CASE_LOCK_ROOT",
  dirName: "case-locks",
  attempts: 5,
  recordField: "matterRoot",
  label: "matter-data",
  subject: "matter",
  // Longer than the longest holder (WRITE_TIMEOUT_MS, 2 minutes), and never renewed: a session that
  // hangs while alive cannot keep the lock (group locking spec 6.2).
  staleMs: 5 * 60_000,
  breakDead: true,
};

/** One ingest write's wait for the lock: 15 seconds, so the call stays under the bridge's 60. The
 *  write then stays queued (group locking spec 6.3). */
const WRITE_WAITS_MS = [1000, 2000, 4000, 8000];

export type CaseLock = HeldLock;

/**
 * Take the write lock for one matter. Always release in a `finally` -- a lock
 * held in TS survives a crashed or killed Python child, which is why it lives
 * here rather than inside migrate_engine.py or the backend helper.
 */
export function acquireCaseLock(matterRoot: string, env: NodeJS.ProcessEnv = process.env): Promise<CaseLock> {
  return acquireLock(SITE, matterRoot, env);
}

/** The write lock as an ingest takes it: a longer wait, because another run may be writing now. */
export function acquireIngestWriteLock(matterRoot: string, env: NodeJS.ProcessEnv = process.env): Promise<CaseLock> {
  return acquireLock(SITE, matterRoot, env, { waitsMs: WRITE_WAITS_MS });
}

/** Runs a matter-wide change under the lock, marked so that no run starts or claims a file meanwhile
 *  (group locking spec section 9). Readers carry on; their writes wait for the lock as usual. */
export async function withExclusive<T>(matterRoot: string, env: NodeJS.ProcessEnv, op: (lock: CaseLock) => T | Promise<T>): Promise<T> {
  const lock = await acquireLock(SITE, matterRoot, env, { waitsMs: WRITE_WAITS_MS, scope: "exclusive" });
  try {
    advanceRevision(matterRoot, env);
    return await op(lock);
  } finally {
    lock.release();
  }
}

export function exclusiveHeld(matterRoot: string, env: NodeJS.ProcessEnv = process.env): boolean {
  return liveLockRecord(SITE, matterRoot, env)?.scope === "exclusive";
}

/** The matter revision (group locking spec 7.1): a count on this computer of the writes to this
 *  matter. Unreadable counts as 0, which can only cause an extra re-check. */
export function matterRevision(matterRoot: string, env: NodeJS.ProcessEnv = process.env): number {
  try {
    return Number(readFileSync(hostLocalFile(SITE, matterRoot, "revision", env), "utf-8")) || 0;
  } catch {
    return 0;
  }
}

/** Called under the lock, just before a write: a crash can then cause an extra re-check, never a missed one. */
export function advanceRevision(matterRoot: string, env: NodeJS.ProcessEnv = process.env): void {
  writeFileSync(hostLocalFile(SITE, matterRoot, "revision", env), String(matterRevision(matterRoot, env) + 1), "utf-8");
}
