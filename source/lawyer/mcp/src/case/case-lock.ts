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

import { acquireLock, type HeldLock, type LockSite } from "../data-lock.js";

const SITE: LockSite = {
  envVar: "COCLERK_CASE_LOCK_ROOT",
  dirName: "case-locks",
  attempts: 5,
  recordField: "matterRoot",
  label: "matter-data",
  subject: "matter",
};

export type CaseLock = HeldLock;

/**
 * Take the write lock for one matter. Always release in a `finally` -- a lock
 * held in TS survives a crashed or killed Python child, which is why it lives
 * here rather than inside migrate_engine.py or the backend helper.
 */
export function acquireCaseLock(matterRoot: string, env: NodeJS.ProcessEnv = process.env): Promise<CaseLock> {
  return acquireLock(SITE, matterRoot, env);
}
