// A cross-process lock file beside a target, and atomic text and byte writes. Knowledge overlay
// files, preference files, the suggestion store and other small stores write through these.

import { randomUUID } from "node:crypto";
import { closeSync, mkdirSync, openSync, statSync, writeSync } from "node:fs";
import { win32 as pathWin32 } from "node:path";

import { DataServerError } from "./errors.js";
import { orphanClaims, readLockKey, removeLockIfKey } from "./lock-claim.js";
import { writeStatusFile } from "./status-file.js";

const LOCK_ATTEMPTS = 5;
const LOCK_RETRY_MS = 400;
const LOCK_STALE_MS = 60_000;

function lockIsStale(lock: string): boolean {
  try {
    return Date.now() - statSync(lock).mtimeMs > LOCK_STALE_MS;
  } catch {
    return false;
  }
}

async function acquireLock(lock: string): Promise<string> {
  for (let attempt = 0; attempt < LOCK_ATTEMPTS; attempt++) {
    try {
      const token = randomUUID();
      const fd = openSync(lock, "wx");
      writeSync(fd, JSON.stringify({ pid: process.pid, ts: new Date().toISOString(), token }));
      closeSync(fd);
      return token;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
      // A crashed writer leaves an orphan lock; break it rather than wedging.
      const key = readLockKey(lock, "token");
      if (key === null) continue;
      if (lockIsStale(lock) && removeLockIfKey(lock, "token", key, () => lockIsStale(lock))) continue;
      if (attempt < LOCK_ATTEMPTS - 1) await new Promise((resolve) => setTimeout(resolve, LOCK_RETRY_MS));
    }
  }
  throw new DataServerError(
    `could not acquire the knowledge write lock within ${(LOCK_ATTEMPTS * LOCK_RETRY_MS) / 1000}s (${lock}${orphanClaims(lock)}); another session is writing`,
    "lock_timeout"
  );
}

/**
 * Run `fn` holding the cross-process lock file `<target>.lock`, beside the target. Every
 * knowledge__write and knowledge__retire change to one overlay file happens under its lock.
 */
export async function withFileLock<T>(target: string, fn: () => T | Promise<T>): Promise<T> {
  mkdirSync(pathWin32.dirname(target), { recursive: true });
  const lock = `${target}.lock`;
  const token = await acquireLock(lock);
  try {
    return await fn();
  } finally {
    // Unlink only while the file still carries our token: after a stale takeover it is another writer's lock.
    try {
      removeLockIfKey(lock, "token", token, undefined, 500);
    } catch {
      /* nothing to release */
    }
  }
}

/** Write text by temp file plus rename (retrying a rename a sync client briefly blocks), failing hard. */
export function writeTextAtomic(target: string, text: string): void {
  const code = writeStatusFile(target, text);
  if (code) throw new DataServerError(`could not write ${target}: ${code}`, "write_failed");
}

/** writeTextAtomic for bytes (a fetched PDF). writeFileSync writes a Buffer verbatim, whatever encoding it is given. */
export function writeBytesAtomic(target: string, bytes: Buffer): void {
  writeTextAtomic(target, bytes as unknown as string);
}
