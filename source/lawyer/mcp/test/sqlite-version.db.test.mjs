// Spec 2026-11-17 drafting-records sync safety, section 3.7 and criterion 1: the drafting schema needs
// SQLite 3.47.0, so every Python entry point that opens a drafting database refuses an older SQLite
// with sqlite_too_old, before it reads or writes anything.
//
// An older SQLite is simulated, not installed: a usercustomize.py in a throwaway PYTHONUSERBASE makes
// sqlite3.sqlite_version_info read 3.46.0 while a flag file exists. The flag is read on every access,
// so the long-lived query sidecar started before the flag sees the change too, and the fixtures are
// built with the real SQLite.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const base = mkdtempSync(join(tmpdir(), "coclerk-sqlite-version-"));
process.env.COCLERK_SUBMISSION_LOCK_ROOT = join(base, "locks");
process.env.PYTHONUSERBASE = join(base, "userbase");
const FLAG = join(base, "simulate-sqlite-3.46");
process.env.COCLERK_TEST_OLD_SQLITE_FLAG = FLAG;

const python = process.env.COCLERK_PYTHON || "python";
const userSite = spawnSync(python, ["-c", "import site; print(site.getusersitepackages())"], { encoding: "utf-8", env: process.env }).stdout.trim();
mkdirSync(userSite, { recursive: true });
writeFileSync(
  join(userSite, "usercustomize.py"),
  `import os, sqlite3, types

_real = sqlite3.sqlite_version_info


class _Simulated(types.ModuleType):
    @property
    def sqlite_version_info(self):
        return (3, 46, 0) if os.path.exists(os.environ.get("COCLERK_TEST_OLD_SQLITE_FLAG", "")) else _real

    @property
    def sqlite_version(self):
        return ".".join(map(str, self.sqlite_version_info))


sqlite3.__class__ = _Simulated
`,
  "utf-8"
);

const { callTool } = await import("../build/index.js");
const { freshSubmissionDb } = await import("./helpers/template-db.mjs");

test.after(() => rmSync(base, { recursive: true, force: true }));

async function rejection(promise) {
  try {
    await promise;
  } catch (err) {
    return err;
  }
  throw new Error("expected a rejection, got none");
}

function assertTooOld(err) {
  assert.equal(err.code, "sqlite_too_old", err.message);
  assert.match(err.message, /3\.46\.0/, "names the version found");
  assert.match(err.message, /3\.47\.0/, "names the version needed");
  assert.match(err.message, /not damaged/, "says the matter's file is not damaged");
}

const snapshot = (path) => ({ bytes: readFileSync(path), mtimeMs: statSync(path).mtimeMs });

/** A matter whose submission.sqlite was split into two copies, built with the real SQLite. */
async function matterWithDb() {
  const parent = mkdtempSync(join(base, "matter-"));
  const matterRoot = join(parent, "L9999 Test Matter");
  const caseData = join(matterRoot, "0. CASE DATA");
  mkdirSync(caseData, { recursive: true });
  mkdirSync(join(parent, "0. CASE DATA"));
  writeFileSync(join(matterRoot, "coclerk.json"), JSON.stringify({ schema_version: 5, matter_root: matterRoot, case_data_dir: "0. CASE DATA" }), "utf-8");
  const dbPath = join(caseData, "submission.sqlite");
  await freshSubmissionDb(dbPath);
  return { matterRoot, caseData, dbPath };
}

test("query, execute, migrate and split-merge refuse SQLite 3.46 with sqlite_too_old and change no file", async (t) => {
  const m = await matterWithDb();
  const split = await matterWithDb();
  const copies = ["submission-DEV_A.sqlite", "submission-DEV_B.sqlite"].map((name) => join(split.caseData, name));
  copyFileSync(split.dbPath, copies[0]);
  copyFileSync(split.dbPath, copies[1]);
  rmSync(split.dbPath);
  const missing = join(mkdtempSync(join(base, "fresh-")), "submission.sqlite");

  // The sidecar starts on the real SQLite, so the refusal must be judged per query, not per start.
  await callTool({}, "drafting_data__query", { db_path: m.dbPath, sql: "SELECT 1 AS one" });
  const before = snapshot(m.dbPath);
  const copiesBefore = copies.map(snapshot);

  writeFileSync(FLAG, "");
  t.after(() => rmSync(FLAG, { force: true }));

  const queried = await rejection(callTool({}, "drafting_data__query", { db_path: m.dbPath, sql: "SELECT 1 AS one" }));
  assertTooOld(queried);
  const refusals = [
    await rejection(callTool({}, "drafting_data__execute", { db_path: m.dbPath, sql_script: "UPDATE db_meta SET value = value WHERE key = 'schema_version';" })),
    await rejection(callTool({}, "drafting_data__migrate", { db_path: m.dbPath })),
    await rejection(callTool({}, "drafting_data__migrate", { db_path: missing })),
    await rejection(callTool({}, "drafting_data__split_merge", { matter_root: split.matterRoot, op: "diff" })),
  ];
  for (const err of refusals) {
    assertTooOld(err);
    // The data server's helper and the skill's scripts each state the check: their words must not drift.
    assert.equal(err.message, queried.message);
  }

  assert.deepEqual(snapshot(m.dbPath), before, "the matter's file is unchanged");
  assert.deepEqual(copies.map(snapshot), copiesBefore, "both split copies are unchanged");
  assert.equal(existsSync(missing), false, "migrate created no database");
  assert.equal(existsSync(join(split.caseData, "submission-merged.sqlite")), false);

  rmSync(FLAG);
  const [row] = (await callTool({}, "drafting_data__query", { db_path: m.dbPath, sql: "SELECT 1 AS one" })).rows;
  assert.equal(row.one, 1, "the real SQLite is served again once the simulation ends");
});
