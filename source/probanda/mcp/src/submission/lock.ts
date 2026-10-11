// Exclusive cross-process lock for drafting-data writes -- both
// `drafting_data__execute` and `drafting_data__migrate` take it, so a
// write and a migration on one matter's database can never interleave.
// Mirrors plugins/litigation/mcp/src/case/case-lock.ts, keyed on the database
// file path instead of a matter root (this schema has one database file per
// matter, not a resolved case_data_dir -- issue 291 §1).
//
// A server process must never assume it is the only writer. How many
// instances of this server a host spawns is a host implementation detail and
// is not load-bearing anywhere: Claude Code desktop spawns one per session,
// Cowork's Electron main process spawns one and shares it across every
// session on the machine (#586), and more than one host or app run can be
// live at once. An in-process mutex would therefore be theatre: two writers
// interleaving a write's stage -> mutate -> copy-back would silently lose one
// of them, both staging from the same starting bytes and the second copy-back
// winning with no error. The cross-process lock below is what holds.
//
// This comment used to read "every Cowork/CC session spawns its own instance
// of this server," and forms.ts's session token cited it as the reason a
// per-process id was per-session. That premise is false under Cowork (#609).
// It never weakened the conclusion here -- a host-local cross-process lock is
// more necessary now, not less, since the hosts disagree about how many
// processes exist.
//
// The lock file is HOST-LOCAL, not in the matter directory, for the same
// reason case-lock.ts gives: a lockfile inside a synced tree is replicated
// with sync latency, so it is neither a reliable mutex nor promptly released.

import { createHash, randomUUID } from "node:crypto";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, statSync, writeSync } from "node:fs";
import { homedir } from "node:os";
import { win32 as pathWin32 } from "node:path";

import { DataServerError } from "../errors.js";
import { orphanClaims, readLockKey, removeLockIfKey } from "../lock-claim.js";

const LOCK_ATTEMPTS = 5;
const LOCK_RETRY_MS = 400;

// 15 minutes, mirroring case-lock.ts: set by the longest legitimate holder
// (a migration), not the shortest (an execute).
const LOCK_STALE_MS = 900_000;

export interface DataLock {
  release(): void;
  brokeStale: boolean;
}

function lockDir(env: NodeJS.ProcessEnv): string {
  const base = env.COCLERK_SUBMISSION_LOCK_ROOT
    || pathWin32.join(env.LOCALAPPDATA || homedir(), "Coclerk", "submission-locks");
  mkdirSync(base, { recursive: true });
  return base;
}

/** A host-local file for one submission database, keyed like the write lock. The background render
 * job (render-job.ts, #588 §3) keeps its own lock and status mirror here under their own suffixes. */
export function hostLocalPath(dbPath: string, suffix: string, env: NodeJS.ProcessEnv = process.env): string {
  const key = createHash("sha256")
    .update(pathWin32.normalize(dbPath).toLowerCase())
    .digest("hex")
    .slice(0, 16);
  return pathWin32.join(lockDir(env), `${key}.${suffix}`);
}

function lockPath(dbPath: string, env: NodeJS.ProcessEnv): string {
  return hostLocalPath(dbPath, "lock", env);
}

/**
 * Take the write lock for one submission database. Always release in a
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
    `could not acquire the drafting-data write lock within ${
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
