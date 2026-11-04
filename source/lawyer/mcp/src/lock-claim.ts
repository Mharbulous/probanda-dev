import { closeSync, openSync, readdirSync, readFileSync, unlinkSync, writeSync } from "node:fs";
import { win32 as pathWin32 } from "node:path";

// Removal of a lock file -- a stale takeover or the owner's own release -- is shared by every
// cross-process lock in this runtime (case/case-lock.ts, submission/lock.ts, timecamping/lock.ts,
// file-lock.ts, submission/render-job.ts). A bare read-then-unlink is not enough: takers A
// and B both judge one stale lock, A removes it and creates a fresh one, and B's unlink then
// removes A's fresh lock, so both hold.
//
// So every removal happens under a claim: a file named for the key the remover read, created with
// "wx". While a claimant holds claim-K and has just read K at the lock path, nobody else can remove
// that file (they would need claim-K) and nobody can create one (the path is occupied), so its
// unlink removes exactly the K lock. Keys are UUIDs minted once, so a later claimant of a departed K
// reads another key and removes nothing. The one shared key, "none" (an empty file from a creator
// that died between open and write, or a legacy token-less lock), is safe because `stillStale` is
// re-checked under the claim and a freshly opened file is not stale.
//
// A process that dies inside the claim window (a few sync calls) leaves `<lock>.<key>.break`
// behind, and that lock then cannot be removed until a human deletes it; holderOf reports it. The
// guarantee holds only among processes running this code: a server still on an older bundle
// unlinks bare.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The lock file's key: its `field` when that is a UUID, "none" otherwise, null when the file is gone. */
export function readLockKey(lock: string, field: string): string | null {
  let text: string;
  try {
    text = readFileSync(lock, "utf-8");
  } catch {
    return null;
  }
  try {
    const key = JSON.parse(text)[field];
    return typeof key === "string" && UUID.test(key) ? key : "none";
  } catch {
    return "none";
  }
}

/**
 * Removes `lock` only while it still carries `key` and `stillStale()` holds, under claim-K (above).
 * False when another remover holds the claim, the key changed, or the unlink failed: a taker
 * retries, a release gives up. `waitMs` spins on a held claim, which a release uses so a breaker
 * that decides not to break does not leave a finished holder's lock behind.
 */
export function removeLockIfKey(
  lock: string,
  field: string,
  key: string,
  stillStale: () => boolean = () => true,
  waitMs = 0
): boolean {
  const claim = `${lock}.${key}.break`;
  for (let waited = 0; ; waited += 50) {
    try {
      const fd = openSync(claim, "wx");
      try {
        writeSync(fd, JSON.stringify({ pid: process.pid, ts: new Date().toISOString() }));
      } finally {
        closeSync(fd);
      }
      break;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
      if (waited >= waitMs) return false;
      sleepSync(50);
    }
  }
  try {
    if (readLockKey(lock, field) !== key || !stillStale()) return false;
    unlinkSync(lock);
    return true;
  } catch {
    return false;
  } finally {
    unlinkClaim(claim);
  }
}

// A sync client or scanner can hold a just-created file briefly (#583); an orphan claim wedges its lock.
function unlinkClaim(claim: string): void {
  let code = "UNKNOWN";
  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      unlinkSync(claim);
      return;
    } catch (err) {
      code = (err as NodeJS.ErrnoException).code ?? "UNKNOWN";
      if (code === "ENOENT") return;
      sleepSync(50);
    }
  }
  console.error(`[lock] could not remove the removal claim ${claim}: ${code}`);
}

/** Names any removal claim left beside the lock, for a lock_unavailable/lock_timeout message. */
export function orphanClaims(lock: string): string {
  const dir = pathWin32.dirname(lock);
  const prefix = `${pathWin32.basename(lock)}.`;
  try {
    const found = readdirSync(dir).filter((name) => name.startsWith(prefix) && name.endsWith(".break"));
    return found.length ? `; removal claim left behind (delete it if no process is mid-takeover): ${found.join(", ")}` : "";
  } catch {
    return "";
  }
}

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}
