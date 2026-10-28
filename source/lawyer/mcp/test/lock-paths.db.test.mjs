// A lock's file name, record and refusal text must never change between bundles: a server on an
// older bundle and one on a newer bundle that took different lock files would both write at once
// (#185). The expected values below were recorded from the locks before they shared one acquire.
// A db-tier file: each refusal waits out its lock's full retry window, 10 s for submission.
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, win32 } from "node:path";
import test from "node:test";

const { acquireCaseLock } = await import("../build/case/case-lock.js");
const submission = await import("../build/submission/lock.js");
const timecamping = await import("../build/timecamping/lock.js");

const SITES = [
  {
    name: "case-lock",
    rootVar: "COCLERK_CASE_LOCK_ROOT",
    acquire: (env) => acquireCaseLock("C:\\Matter\\Fixed", env),
    file: "6f6a7e734918700b.lock",
    fields: ["pid", "ts", "matterRoot", "token"],
    refusal: /^could not acquire the matter-data write lock within 2s \(.*\); another session is writing to or migrating this matter$/s,
  },
  {
    name: "submission lock",
    rootVar: "COCLERK_SUBMISSION_LOCK_ROOT",
    acquire: (env) => submission.acquireDataLock("C:\\Data\\Fixed.sqlite", env),
    file: "ef65876ea72e88f9.lock",
    fields: ["pid", "ts", "dbPath", "token"],
    refusal: /^could not acquire the drafting-data write lock within 10s \(.*\); another session is writing to or migrating this database$/s,
  },
  {
    name: "timecamping lock",
    rootVar: "COCLERK_TIMECAMPING_LOCK_ROOT",
    acquire: (env) => timecamping.acquireDataLock("C:\\Data\\Fixed.sqlite", env),
    file: "ef65876ea72e88f9.lock",
    fields: ["pid", "ts", "dbPath", "token"],
    refusal: /^could not acquire the timecamping-data write lock within 2s \(.*\); another session is writing to or migrating this database$/s,
  },
];

for (const site of SITES) {
  test(`${site.name}: lock file name, record fields and refusal text are unchanged`, async () => {
    const dir = mkdtempSync(join(tmpdir(), "lock-paths-"));
    const env = { ...process.env, [site.rootVar]: dir };
    try {
      const held = await site.acquire(env);
      assert.deepEqual(readdirSync(dir), [site.file]);
      assert.deepEqual(Object.keys(JSON.parse(readFileSync(join(dir, site.file), "utf-8"))), site.fields);
      await assert.rejects(site.acquire(env), (err) => {
        assert.equal(err.code, "lock_unavailable");
        assert.match(err.message, site.refusal);
        return true;
      });
      held.release();
      assert.deepEqual(readdirSync(dir), []);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
}

test("submission hostLocalPath keeps its key and folder", () => {
  const dir = mkdtempSync(join(tmpdir(), "lock-paths-"));
  try {
    assert.equal(
      submission.hostLocalPath("C:\\Data\\Fixed.sqlite", "render-job.lock", { COCLERK_SUBMISSION_LOCK_ROOT: dir }),
      win32.join(dir, "ef65876ea72e88f9.render-job.lock")
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
