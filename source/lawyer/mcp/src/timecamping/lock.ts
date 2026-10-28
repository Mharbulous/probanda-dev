// Exclusive cross-process lock for timecamping-data writes -- both
// `timecamping_data__execute` and `timecamping_data__migrate` take it, so a
// write and a migration on the timecamping database can never interleave.
// Mirrors plugins/litigation/mcp/src/submission/lock.ts, keyed on the resolved db
// path (a single fixed per-practitioner file, so in steady state this is
// effectively one lock -- keyed on the path rather than a bare constant
// anyway so a COCLERK_TIMECAMPING_DB_PATH test override still gets its own
// lock, matching every other backend in this runtime).
//
// A server process must never assume it is the only writer. How many
// instances of this server a host spawns is a host implementation detail and
// is not load-bearing anywhere: Claude Code desktop spawns one per session,
// Cowork's Electron main process spawns one and shares it across every
// session on the machine (#586), and more than one host or app run can be
// live at once. An in-process mutex would therefore be theatre: two writers
// interleaving a write's stage -> mutate -> copy-back would silently lose one
// of them, both staging from the same starting bytes and the second copy-back
// winning with no error. (The premise corrected here is #609's; the
// conclusion is unchanged.)
//
// The lock file is HOST-LOCAL, not in the synced `0. CASE DATA` tree, for the
// same reason case-lock.ts and drafting-data's lock.ts give: a lockfile
// inside a synced tree is replicated with sync latency, so it is neither a
// reliable mutex nor promptly released.

import { acquireLock, type HeldLock, type LockSite } from "../data-lock.js";

const SITE: LockSite = {
  envVar: "COCLERK_TIMECAMPING_LOCK_ROOT",
  dirName: "timecamping-locks",
  attempts: 5,
  recordField: "dbPath",
  label: "timecamping-data",
  subject: "database",
};

export type DataLock = HeldLock;

/**
 * Take the write lock for the timecamping database. Always release in a
 * `finally` -- a lock held in TS survives a crashed or killed Python child.
 */
export function acquireDataLock(dbPath: string, env: NodeJS.ProcessEnv = process.env): Promise<DataLock> {
  return acquireLock(SITE, dbPath, env);
}
