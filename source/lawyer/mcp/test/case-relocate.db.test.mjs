// Adapter-level tests for matter_data__relocate (ADR 0013).
//
// The copy, the checks and the pointer rewrite are covered by
// .claude/skills/matter-data/tests/test_relocate_case_data.py. These prove the wiring:
// tool registration, dispatch routing, PYTHONPATH resolution to the skills tree, the
// refusal round trip into a DataServerError, and lock release.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const { caseDataRelocate } = await import("../build/case/relocate.js");
const { buildToolDefinitions } = await import("../build/schema-gen.js");

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const PYTHON = process.env.COCLERK_PYTHON || "python";

function fixture(t) {
  const scratch = mkdtempSync(join(tmpdir(), "coclerk-relocate-"));
  t.after(() => rmSync(scratch, { recursive: true, force: true }));
  const library = join(scratch, "Litigation - Documents");
  const matterRoot = join(library, "T9999 Scratch Matter");
  const old = join(library, "0. CASE DATA", "T9999 Scratch Matter");
  mkdirSync(matterRoot, { recursive: true });
  mkdirSync(old, { recursive: true });
  const made = spawnSync(PYTHON, ["-c", "import sqlite3,sys; c=sqlite3.connect(sys.argv[1]); c.execute('PRAGMA user_version = 90'); c.close()", join(old, "main.sqlite")], { encoding: "utf-8" });
  if (made.status !== 0) throw new Error(`fixture Python failed: ${made.stderr}`);
  writeFileSync(join(matterRoot, "probanda.json"), JSON.stringify({ schema_version: 5, matter_root: matterRoot, case_data_dir: old }));
  const env = {
    ...process.env,
    COCLERK_REPO_ROOT: REPO_ROOT,
    COCLERK_CASE_LOCK_ROOT: join(scratch, "locks"),
    COCLERK_SUBMISSION_LOCK_ROOT: join(scratch, "submission-locks"),
  };
  delete env.COCLERK_CASE_DATA_ROOT;
  return { matterRoot, old, env, pointer: () => readFileSync(join(matterRoot, "probanda.json")) };
}

test("matter_data__relocate is registered with matter_root and mode", () => {
  const tool = buildToolDefinitions().find((t) => t.name === "matter_data__relocate");
  assert.ok(tool);
  assert.deepEqual(tool.inputSchema.required, ["matter_root", "mode"]);
});

test("plan names the old folder and the target and writes nothing", async (t) => {
  const f = fixture(t);
  const before = f.pointer();
  const result = await caseDataRelocate(f.matterRoot, "plan", f.env);
  assert.equal(result.old_folder.toLowerCase(), f.old.toLowerCase());
  assert.equal(result.target.toLowerCase(), join(f.matterRoot, "0. CASE DATA").toLowerCase());
  assert.deepEqual(result.files.map((file) => file.path), ["main.sqlite"]);
  assert.deepEqual(f.pointer(), before);
  assert.ok(!existsSync(join(f.matterRoot, "0. CASE DATA")));
});

test("a refusal comes back as relocate_refused and the locks are released", async (t) => {
  const f = fixture(t);
  mkdirSync(join(f.matterRoot, "0. CASE DATA"));
  writeFileSync(join(f.matterRoot, "0. CASE DATA", "stray.txt"), "x");
  await assert.rejects(caseDataRelocate(f.matterRoot, "apply", f.env), (err) => err.code === "relocate_refused" && /not empty/.test(err.message));
  // A second call gets the locks at once: the first released them.
  await assert.rejects(caseDataRelocate(f.matterRoot, "plan", f.env), /not empty/);
});
