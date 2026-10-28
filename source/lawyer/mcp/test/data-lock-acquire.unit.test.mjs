// acquireLock's two edge faults (#198): a stale lock broken on the last attempt must still be taken,
// and a record write that fails must leave no lock behind.
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { createRequire, syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const { acquireLock, hostLocalFile } = await import("../build/data-lock.js");
const fs = createRequire(import.meta.url)("node:fs");

const site = (attempts) => ({
  envVar: "TEST_DATA_LOCK_ROOT",
  dirName: "test-locks",
  attempts,
  recordField: "dbPath",
  label: "test",
  subject: "store",
});

function scratch() {
  const dir = mkdtempSync(join(tmpdir(), "data-lock-"));
  return { env: { ...process.env, TEST_DATA_LOCK_ROOT: dir }, dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

test("a stale lock broken on the last attempt is taken, not refused", async () => {
  const s = scratch();
  try {
    const lock = hostLocalFile(site(1), "C:\\store.sqlite", "lock", s.env);
    writeFileSync(lock, JSON.stringify({ pid: 1, token: "00000000-0000-4000-8000-000000000000" }));
    const past = new Date(Date.now() - 3_600_000);
    utimesSync(lock, past, past);

    let held;
    await assert.doesNotReject(async () => {
      held = await acquireLock(site(1), "C:\\store.sqlite", s.env);
    }, "the stale lock it just broke is no reason to refuse");
    assert.equal(held.brokeStale, true);
    held.release();
  } finally {
    s.cleanup();
  }
});

test("a failed record write leaves no lock behind", async () => {
  const s = scratch();
  const lock = hostLocalFile(site(1), "C:\\store.sqlite", "lock", s.env);
  const realWrite = fs.writeSync;
  fs.writeSync = () => {
    throw Object.assign(new Error("no space"), { code: "ENOSPC" });
  };
  syncBuiltinESMExports();
  try {
    await assert.rejects(acquireLock(site(1), "C:\\store.sqlite", s.env), /no space/);
  } finally {
    fs.writeSync = realWrite;
    syncBuiltinESMExports();
  }
  try {
    assert.equal(existsSync(lock), false, "no lock file left behind");
  } finally {
    rmSync(lock, { force: true });
    s.cleanup();
  }
});
