// A data lock's refusal names its whole retry window (attempts x 400 ms), as it did before the three
// locks shared one acquire (#236): 2s for case-lock and timecamping, 10s for submission. Runs on any
// platform: the lock folder is "." inside a temporary working directory, so the win32 join of the
// folder and the key is a plain file name there.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const { acquireCaseLock } = await import("../build/case/case-lock.js");
const submission = await import("../build/submission/lock.js");
const timecamping = await import("../build/timecamping/lock.js");

const SITES = [
  { name: "case-lock", rootVar: "COCLERK_CASE_LOCK_ROOT", acquire: (env) => acquireCaseLock("C:\\Matter\\Invented", env), window: "2s" },
  { name: "submission lock", rootVar: "COCLERK_SUBMISSION_LOCK_ROOT", acquire: (env) => submission.acquireDataLock("C:\\Data\\Invented.sqlite", env), window: "10s" },
  { name: "timecamping lock", rootVar: "COCLERK_TIMECAMPING_LOCK_ROOT", acquire: (env) => timecamping.acquireDataLock("C:\\Data\\Invented.sqlite", env), window: "2s" },
];

for (const site of SITES) {
  test(`${site.name}: the refusal names the whole retry window, ${site.window}`, async () => {
    const dir = mkdtempSync(join(tmpdir(), "lock-window-"));
    const cwd = process.cwd();
    process.chdir(dir);
    const env = { ...process.env, [site.rootVar]: "." };
    try {
      const held = await site.acquire(env);
      try {
        await assert.rejects(site.acquire(env), (err) => {
          assert.equal(err.code, "lock_unavailable");
          assert.match(err.message, new RegExp(`write lock within ${site.window.replace(".", "\\.")} \\(`));
          return true;
        });
      } finally {
        held.release();
      }
    } finally {
      process.chdir(cwd);
      rmSync(dir, { recursive: true, force: true });
    }
  });
}
