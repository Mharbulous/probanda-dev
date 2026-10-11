// Exclusive cross-process lock for case-data writes -- both `case_data__execute`
// and `case_data__migrate` take it, so a write and a migration on one matter can
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
// BEFORE pointer resolution, which itself rewrites coclerk.json and may move
// binaries out of the legacy `9. AI` folder.

import { createHash, randomUUID } from "node:crypto";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, statSync, writeSync } from "node:fs";
import { homedir } from "node:os";
import { win32 as pathWin32 } from "node:path";

import { DataServerError } from "../errors.js";
import { orphanClaims, readLockKey, removeLockIfKey } from "../lock-claim.js";

const LOCK_ATTEMPTS = 5;
const LOCK_RETRY_MS = 400;

// 15 minutes, not knowledge/sidecar.ts's 60s: a migration on a large matter legitimately
// runs for minutes, and breaking a live holder's lock mid-chain would be far
// worse than waiting. An execute finishes in seconds but shares the threshold --
// it is set by the longest legitimate holder, not the shortest.
const LOCK_STALE_MS = 900_000;

export interface CaseLock {
  release(): void;
  brokeStale: boolean;
}

function lockDir(env: NodeJS.ProcessEnv): string {
  const base = env.COCLERK_CASE_LOCK_ROOT
    || pathWin32.join(env.LOCALAPPDATA || homedir(), "Coclerk", "case-locks");
  mkdirSync(base, { recursive: true });
  return base;
}

function lockPath(matterRoot: string, env: NodeJS.ProcessEnv): string {
  const key = createHash("sha256")
    .update(pathWin32.normalize(matterRoot).toLowerCase())
    .digest("hex")
    .slice(0, 16);
  return pathWin32.join(lockDir(env), `${key}.lock`);
}

/**
 * Take the write lock for one matter. Always release in a `finally` -- a lock
 * held in TS survives a crashed or killed Python child, which is why it lives
 * here rather than inside migrate_engine.py or the backend helper.
 */
export async function acquireCaseLock(
  matterRoot: string,
  env: NodeJS.ProcessEnv = process.env
): Promise<CaseLock> {
  const lock = lockPath(matterRoot, env);
  let brokeStale = false;

  for (let attempt = 0; attempt < LOCK_ATTEMPTS; attempt++) {
    try {
      const token = randomUUID();
      const fd = openSync(lock, "wx");
      writeSync(fd, JSON.stringify({ pid: process.pid, ts: new Date().toISOString(), matterRoot, token }));
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
    `could not acquire the case-data write lock within ${
      (LOCK_ATTEMPTS * LOCK_RETRY_MS) / 1000
    }s (${lock}: ${holderOf(lock)}); another session is writing to or migrating this matter`,
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
