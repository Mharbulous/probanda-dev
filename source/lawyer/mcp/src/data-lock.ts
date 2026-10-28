// The acquire loop shared by the three data write locks (case/case-lock.ts, submission/lock.ts,
// timecamping/lock.ts). Each site passes its own LockSite; everything that names a lock file -- the
// env var, folder, key and record -- must stay byte-identical across bundles, or a server on an
// older bundle and one on a newer bundle would take different locks and both write at once (#185).

import { createHash, randomUUID } from "node:crypto";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, statSync, writeSync } from "node:fs";
import { homedir } from "node:os";
import { win32 as pathWin32 } from "node:path";

import { DataServerError } from "./errors.js";
import { orphanClaims, readLockKey, removeLockIfKey } from "./lock-claim.js";

const LOCK_RETRY_MS = 400;

// 15 minutes, not knowledge/sidecar.ts's 60s: a migration on a large matter legitimately
// runs for minutes, and breaking a live holder's lock mid-chain would be far
// worse than waiting. An execute finishes in seconds but shares the threshold --
// it is set by the longest legitimate holder, not the shortest.
const LOCK_STALE_MS = 900_000;

export interface LockSite {
  /** Env var that overrides the lock folder, e.g. COCLERK_CASE_LOCK_ROOT. */
  envVar: string;
  /** Folder under %LOCALAPPDATA%\Coclerk. */
  dirName: string;
  attempts: number;
  /** The lock record's field naming what is locked. */
  recordField: "matterRoot" | "dbPath";
  /** "<label> write lock" in the refusal. */
  label: string;
  /** "this <subject>" in the refusal. */
  subject: string;
}

export interface HeldLock {
  release(): void;
  brokeStale: boolean;
}

/** A host-local file for `target` in the site's lock folder, keyed on its normalised path. */
export function hostLocalFile(site: LockSite, target: string, suffix: string, env: NodeJS.ProcessEnv): string {
  const base = env[site.envVar] || pathWin32.join(env.LOCALAPPDATA || homedir(), "Coclerk", site.dirName);
  mkdirSync(base, { recursive: true });
  const key = createHash("sha256")
    .update(pathWin32.normalize(target).toLowerCase())
    .digest("hex")
    .slice(0, 16);
  return pathWin32.join(base, `${key}.${suffix}`);
}

/**
 * Take the site's write lock on `target`. Always release in a `finally` -- a lock
 * held in TS survives a crashed or killed Python child.
 */
export async function acquireLock(site: LockSite, target: string, env: NodeJS.ProcessEnv): Promise<HeldLock> {
  const lock = hostLocalFile(site, target, "lock", env);
  let brokeStale = false;

  for (let attempt = 0; attempt < site.attempts; attempt++) {
    try {
      const token = randomUUID();
      const fd = openSync(lock, "wx");
      writeSync(fd, JSON.stringify({ pid: process.pid, ts: new Date().toISOString(), [site.recordField]: target, token }));
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

      if (attempt < site.attempts - 1) await sleep(LOCK_RETRY_MS);
    }
  }

  throw new DataServerError(
    `could not acquire the ${site.label} write lock within ${
      (site.attempts * LOCK_RETRY_MS) / 1000
    }s (${lock}: ${holderOf(lock)}); another session is writing to or migrating this ${site.subject}`,
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
