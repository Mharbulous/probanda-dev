// The acquire loop shared by the three data write locks (case/case-lock.ts, submission/lock.ts,
// timecamping/lock.ts). Each site passes its own LockSite; everything that names a lock file -- the
// env var, folder, key and record -- must stay byte-identical across bundles, or a server on an
// older bundle and one on a newer bundle would take different locks and both write at once (#185).

import { createHash, randomUUID } from "node:crypto";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, statSync, unlinkSync, writeSync } from "node:fs";
import { homedir } from "node:os";
import { win32 as pathWin32 } from "node:path";

import { DataServerError } from "./errors.js";
import { orphanClaims, readLockKey, removeLockIfKey } from "./lock-claim.js";

const LOCK_RETRY_MS = 400;

// 15 minutes, not file-lock.ts's 60s: a migration on a large matter legitimately
// runs for minutes, and breaking a live holder's lock mid-chain would be far
// worse than waiting. An execute finishes in seconds but shares the threshold --
// it is set by the longest legitimate holder, not the shortest.
const LOCK_STALE_MS = 900_000;

export interface LockSite {
  /** Overrides LOCK_STALE_MS for a site whose longest holder is known to be shorter. */
  staleMs?: number;
  /** A lock whose recorded process has died is free at once. The lock file is host-local, so its pid means something here. */
  breakDead?: boolean;
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

export interface AcquireOptions {
  /** The wait after each failed attempt, in place of the site's attempts and the fixed retry. */
  waitsMs?: number[];
  /** Recorded on the lock, for a reader of the record (case-lock.ts exclusiveHeld). */
  scope?: "exclusive";
}

/** The 16-hex key of `target`'s normalised path, which names its host-local files. */
export function lockKey(target: string): string {
  return createHash("sha256")
    .update(pathWin32.normalize(target).toLowerCase())
    .digest("hex")
    .slice(0, 16);
}

/** The site's lock folder, created when missing. */
export function hostLocalDir(site: LockSite, env: NodeJS.ProcessEnv): string {
  const base = env[site.envVar] || pathWin32.join(env.LOCALAPPDATA || homedir(), "Coclerk", site.dirName);
  mkdirSync(base, { recursive: true });
  return base;
}

/** A host-local file for `target` in the site's lock folder, keyed on its normalised path. */
export function hostLocalFile(site: LockSite, target: string, suffix: string, env: NodeJS.ProcessEnv): string {
  return pathWin32.join(hostLocalDir(site, env), `${lockKey(target)}.${suffix}`);
}

/**
 * Take the site's write lock on `target`. Always release in a `finally` -- a lock
 * held in TS survives a crashed or killed Python child.
 */
export async function acquireLock(site: LockSite, target: string, env: NodeJS.ProcessEnv, options: AcquireOptions = {}): Promise<HeldLock> {
  const lock = hostLocalFile(site, target, "lock", env);
  let brokeStale = false;
  const attempts = options.waitsMs ? options.waitsMs.length + 1 : site.attempts;
  let waitedMs = 0;

  // A broken stale lock earns one extra attempt, so breaking it on the last attempt still takes it.
  for (let attempt = 0; attempt < attempts + (brokeStale ? 1 : 0); attempt++) {
    try {
      const token = randomUUID();
      const fd = openSync(lock, "wx");
      try {
        writeSync(fd, JSON.stringify({ pid: process.pid, ts: new Date().toISOString(), [site.recordField]: target, token, ...(options.scope ? { scope: options.scope } : {}) }));
      } catch (writeErr) {
        // The file is ours (created with "wx" above); left in place it would wedge the store.
        closeSync(fd);
        unlinkSync(lock);
        throw writeErr;
      }
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
      if (isStale(lock, site) && removeLockIfKey(lock, "token", key, () => isStale(lock, site))) {
        brokeStale = true;
        continue;
      }

      if (attempt < attempts - 1) {
        const wait = options.waitsMs?.[attempt] ?? LOCK_RETRY_MS;
        await sleep(wait);
        waitedMs += wait;
      }
    }
  }

  throw new DataServerError(
    `could not acquire the ${site.label} write lock within ${
      waitedMs / 1000
    }s (${lock}: ${holderOf(lock)}); another session is writing to or migrating this ${site.subject}`,
    "lock_unavailable"
  );
}

/** The record of a lock held now and not stale, or null. Takes nothing. */
export function liveLockRecord(site: LockSite, target: string, env: NodeJS.ProcessEnv): Record<string, unknown> | null {
  const lock = hostLocalFile(site, target, "lock", env);
  if (isStale(lock, site)) return null;
  try {
    return JSON.parse(readFileSync(lock, "utf-8")) as Record<string, unknown>;
  } catch {
    return null;
  }
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

function isStale(lock: string, site: LockSite): boolean {
  try {
    return Date.now() - statSync(lock).mtimeMs > (site.staleMs ?? LOCK_STALE_MS) || (site.breakDead === true && holderDied(lock));
  } catch {
    return false;
  }
}

function holderDied(lock: string): boolean {
  let pid: unknown;
  try {
    pid = JSON.parse(readFileSync(lock, "utf-8")).pid;
  } catch {
    return false; // being written, or a token-less lock: left to the age test
  }
  if (typeof pid !== "number") return false;
  try {
    process.kill(pid, 0);
    return false;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "ESRCH";
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
