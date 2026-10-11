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

import { createHash, randomUUID } from "node:crypto";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, statSync, writeSync } from "node:fs";
import { homedir } from "node:os";
import { win32 as pathWin32 } from "node:path";

import { DataServerError } from "../errors.js";
import { orphanClaims, readLockKey, removeLockIfKey } from "../lock-claim.js";

const LOCK_ATTEMPTS = 5;
const LOCK_RETRY_MS = 400;

// 15 minutes, mirroring drafting-data's lock.ts: set by the longest
// legitimate holder (a migration), not the shortest (an execute).
const LOCK_STALE_MS = 900_000;

export interface DataLock {
  release(): void;
  brokeStale: boolean;
}

function lockDir(env: NodeJS.ProcessEnv): string {
  const base = env.COCLERK_TIMECAMPING_LOCK_ROOT
    || pathWin32.join(env.LOCALAPPDATA || homedir(), "Coclerk", "timecamping-locks");
  mkdirSync(base, { recursive: true });
  return base;
}

function lockPath(dbPath: string, env: NodeJS.ProcessEnv): string {
  const key = createHash("sha256")
    .update(pathWin32.normalize(dbPath).toLowerCase())
    .digest("hex")
    .slice(0, 16);
  return pathWin32.join(lockDir(env), `${key}.lock`);
}

/**
 * Take the write lock for the timecamping database. Always release in a
 * `finally` -- a lock held in TS survives a crashed or killed Python child.
 */
export async function acquireDataLock(
  dbPath: string,
  env: NodeJS.ProcessEnv = process.env
): Promise<DataLock> {
  const lock = lockPath(dbPath, env);
  let brokeStale = false;

  for (let attempt = 0; attempt < LOCK_ATTEMPTS; attempt++) {
    try {
      const token = randomUUID();
      const fd = openSync(lock, "wx");
      writeSync(fd, JSON.stringify({ pid: process.pid, ts: new Date().toISOString(), dbPath, token }));
      closeSync(fd);
      return {
        brokeStale,
        release() {
          releaseIfOurs(lock, token);
        },
      };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;

      const key = readLockKey(lock, "token");
      if (key === null) continue; // vanished — retry immediately
      if (isStale(lock) && removeLockIfKey(lock, "token", key, () => isStale(lock))) {
        brokeStale = true;
        continue;
      }

      if (attempt < LOCK_ATTEMPTS - 1) await sleep(LOCK_RETRY_MS);
    }
  }

  throw new DataServerError(
    `could not acquire the timecamping-data write lock within ${
      (LOCK_ATTEMPTS * LOCK_RETRY_MS) / 1000
    }s (${lock}: ${holderOf(lock)}); another session is writing to or migrating this database`,
    "lock_unavailable"
  );
}

// Unlink only while the file still carries this holder's token: after a stale
// takeover it is another holder's lock.
function releaseIfOurs(lock: string, token: string): void {
  try {
    removeLockIfKey(lock, "token", token, undefined, 500);
  } catch {
    // Nothing to undo; a leaked lock surfaces as lock_unavailable once it ages.
  }
}

function isStale(lock: string): boolean {
  try {
    return Date.now() - statSync(lock).mtimeMs > LOCK_STALE_MS;
  } catch {
    return false;
  }
}

function holderOf(lock: string): string {
  try {
    return (existsSync(lock) ? readFileSync(lock, "utf-8").trim() : "released") + orphanClaims(lock);
  } catch {
    return "unreadable";
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
