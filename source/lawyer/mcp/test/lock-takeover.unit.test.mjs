// Stale-lock takeover must remove only the lock it judged stale. Two takers both judge one stale
// lock; the first removes it and takes a fresh lock; the second's removal, arriving late, must leave
// that fresh lock alone. The interleaving is driven by hand: phase one is each taker reading the
// stale lock's key, phase two is removeLockIfKey, the call every lock site makes to remove.
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const { acquireCaseLock } = await import("../build/case/case-lock.js");
const submission = await import("../build/submission/lock.js");
const timecamping = await import("../build/timecamping/lock.js");
const { readLockKey, removeLockIfKey } = await import("../build/lock-claim.js");

const STALE_TOKEN = "00000000-0000-4000-8000-000000000000";

function plantStale(lock, record) {
  writeFileSync(lock, JSON.stringify(record));
  const past = new Date(Date.now() - 3_600_000);
  utimesSync(lock, past, past);
}

function scratch() {
  const dir = mkdtempSync(join(tmpdir(), "lock-takeover-"));
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

const SITES = [
  ["case-lock", "COCLERK_CASE_LOCK_ROOT", (env) => acquireCaseLock("C:\\matter-race", env)],
  ["submission lock", "COCLERK_SUBMISSION_LOCK_ROOT", (env) => submission.acquireDataLock("C:\\race.sqlite", env)],
  ["timecamping lock", "COCLERK_TIMECAMPING_LOCK_ROOT", (env) => timecamping.acquireDataLock("C:\\race.sqlite", env)],
];

for (const [name, rootVar, acquire] of SITES) {
  test(`${name}: a second taker's late removal leaves the first taker's fresh lock in place`, async () => {
    const s = scratch();
    const env = { ...process.env, [rootVar]: s.dir };
    try {
      // Learn the lock path, then replace the lock with a stale one.
      const held = await acquire(env);
      const lockFile = join(s.dir, readdirSync(s.dir)[0]);
      held.release();
      plantStale(lockFile, { pid: 1, ts: new Date(0).toISOString(), token: STALE_TOKEN });

      // Phase one: both takers judge the lock stale and read its key.
      const keyA = readLockKey(lockFile, "token");
      const keyB = readLockKey(lockFile, "token");
      assert.equal(keyA, STALE_TOKEN);
      assert.equal(keyB, STALE_TOKEN);

      // A breaks it and takes a fresh lock.
      const a = await acquire(env);
      assert.equal(a.brokeStale, true);
      const fresh = readFileSync(lockFile, "utf-8");
      assert.notEqual(JSON.parse(fresh).token, STALE_TOKEN);

      // Phase two for B, arriving late. Before the claim this was a bare unlink of A's lock.
      assert.equal(removeLockIfKey(lockFile, "token", keyB), false);
      assert.equal(readFileSync(lockFile, "utf-8"), fresh, "A's fresh lock survives");
      assert.equal(readdirSync(s.dir).length, 1, "no removal claim left behind");

      a.release();
      assert.deepEqual(readdirSync(s.dir), []);
    } finally {
      s.cleanup();
    }
  });
}

test("a removal whose key's claim is held removes nothing, and a waiting release still gives up", () => {
  const s = scratch();
  try {
    const lock = join(s.dir, "held.lock");
    plantStale(lock, { token: STALE_TOKEN });
    writeFileSync(`${lock}.${STALE_TOKEN}.break`, "{}");

    assert.equal(removeLockIfKey(lock, "token", STALE_TOKEN), false);
    assert.equal(removeLockIfKey(lock, "token", STALE_TOKEN, undefined, 100), false);
    assert.equal(readLockKey(lock, "token"), STALE_TOKEN, "the lock is still there");

    rmSync(`${lock}.${STALE_TOKEN}.break`);
    assert.equal(removeLockIfKey(lock, "token", STALE_TOKEN), true);
    assert.deepEqual(readdirSync(s.dir), []);
  } finally {
    s.cleanup();
  }
});

test("a lock without a UUID key reads as 'none' and is removed only while the recheck says stale", () => {
  const s = scratch();
  try {
    const lock = join(s.dir, "legacy.lock");
    plantStale(lock, { token: "../escape" });
    assert.equal(readLockKey(lock, "token"), "none");

    // A creator between open and write: an empty file, not stale.
    writeFileSync(lock, "");
    assert.equal(readLockKey(lock, "token"), "none");
    assert.equal(removeLockIfKey(lock, "token", "none", () => false), false);
    assert.equal(readLockKey(lock, "token"), "none", "a fresh empty lock is left alone");

    assert.equal(removeLockIfKey(lock, "token", "none"), true);
    assert.equal(readLockKey(lock, "token"), null);
    assert.deepEqual(readdirSync(s.dir), []);
  } finally {
    s.cleanup();
  }
});

test("a lock_unavailable message names a removal claim left behind", async () => {
  const s = scratch();
  const env = { ...process.env, COCLERK_TIMECAMPING_LOCK_ROOT: s.dir };
  try {
    const held = await timecamping.acquireDataLock("C:\\wedged.sqlite", env);
    const lockFile = join(s.dir, readdirSync(s.dir)[0]);
    held.release();
    plantStale(lockFile, { token: STALE_TOKEN });
    writeFileSync(`${lockFile}.${STALE_TOKEN}.break`, "{}");

    await assert.rejects(timecamping.acquireDataLock("C:\\wedged.sqlite", env), (err) => {
      assert.equal(err.code, "lock_unavailable");
      assert.match(err.message, /removal claim left behind/);
      return true;
    });
  } finally {
    s.cleanup();
  }
});
