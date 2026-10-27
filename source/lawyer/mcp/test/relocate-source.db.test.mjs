// matter_data__relocate_source end to end (/matter-data operations/relocate-source.md, design-decisions.md #75):
// the tool runs the operation's own probe and relocate_plan against real case data built from the canonical
// schema, writes through matter_data__execute's path and confirms the write. The plan's rules themselves are
// pinned by the skill's test_relocate_source.py; this pins the tool surface. Every name is invented.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const { callTool } = await import("../build/dispatch.js");
const { buildToolDefinitions } = await import("../build/schema-gen.js");
const { writeCaseDataStores } = await import("./helpers/matter-data-fixture.mjs");

const TOOL = "matter_data__relocate_source";
const OLD = "2026-01-05 letter.pdf";
const NEW = "3. CORRESPONDENCE\\2026-01-05 LTR Smith re costs.pdf";
const BYTES = "letter";
const HASH = createHash("sha256").update(BYTES).digest("hex");

const lit = (v) => `'${v.replace(/'/g, "''")}'`;

function matterFixture(t, sources) {
  const base = mkdtempSync(join(tmpdir(), "coclerk-relocate-source-"));
  t.after(() => rmSync(base, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }));
  process.env.COCLERK_CASE_LOCK_ROOT = join(base, "locks");
  const matterRoot = join(base, "T9999 Scratch Matter");
  const caseDataDir = join(base, "0. CASE DATA", "T9999 Scratch Matter");
  mkdirSync(matterRoot, { recursive: true });
  mkdirSync(caseDataDir, { recursive: true });
  writeFileSync(
    join(matterRoot, "coclerk.json"),
    JSON.stringify({ schema_version: 5, matter_root: matterRoot, case_data_dir: caseDataDir, evidence_sql_path: "4. LAWYER BRIEF\\CoWork\\evidence.sql" }),
    "utf-8"
  );
  const seed = sources
    .map(([id, path, hash = HASH]) =>
      "INSERT INTO sources (source_id, category, title, file_path, file_hash) " +
      `VALUES (${id}, 'correspondence', 't', ${lit(path)}, ${lit(hash)});`)
    .join("\n");
  writeCaseDataStores(caseDataDir, seed);
  return { matterRoot, caseDataDir };
}

function place(matterRoot, stored) {
  const path = join(matterRoot, ...stored.split("\\"));
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, BYTES);
}

function storedPaths(caseDataDir) {
  const res = spawnSync(
    process.env.COCLERK_PYTHON || "python",
    ["-c", "import json,sqlite3,sys; c=sqlite3.connect(sys.argv[1]); print(json.dumps(dict(c.execute('SELECT source_id, file_path FROM sources'))))", join(caseDataDir, "main.sqlite")],
    { encoding: "utf-8" }
  );
  if (res.status !== 0) throw new Error(res.stderr);
  return JSON.parse(res.stdout);
}

const relocate = (matterRoot, args = {}) =>
  callTool({}, TOOL, { matter_root: matterRoot, hash: HASH, store: "main", old_path: OLD, new_path: NEW, ...args });

test("the tool writes and takes the operation's inputs, with the host folder as the matter folder", () => {
  const def = buildToolDefinitions().find((d) => d.name === TOOL);
  assert.ok(def, `${TOOL} is defined`);
  assert.deepEqual(def.annotations, { destructiveHint: true, openWorldHint: false });
  assert.deepEqual(def.inputSchema.required, ["matter_root", "hash", "store", "old_path", "new_path"]);
  assert.deepEqual(def.inputSchema.properties.store.enum, ["main", "privileged", "law"]);
  assert.match(def.description, /operations\/relocate-source\.md/);
});

test("a moved file is re-pointed, confirmed and dumped; a second call is already current", async (t) => {
  const { matterRoot, caseDataDir } = matterFixture(t, [[1, OLD], [2, "unrelated.pdf", "f".repeat(64)]]);
  place(matterRoot, NEW);
  const out = await relocate(matterRoot);
  assert.equal(out.outcome, "relocated");
  assert.equal(out.stored_path, NEW);
  assert.deepEqual(out.rows, [{ store: "main", id: 1, was: OLD, action: "moved" }]);
  assert.equal(out.reason, null);
  assert.deepEqual(storedPaths(caseDataDir), { 1: NEW, 2: "unrelated.pdf" });
  assert.ok(existsSync(out.evidence_sql), "evidence.sql is regenerated");

  const again = await relocate(matterRoot);
  assert.equal(again.outcome, "already_current");
  assert.deepEqual(again.rows, [{ store: "main", id: 1, was: NEW, action: "already" }]);
});

test("a store with no record of the hash fails no_rows and writes nothing", async (t) => {
  const { matterRoot, caseDataDir } = matterFixture(t, [[1, OLD]]);
  const out = await relocate(matterRoot, { store: "privileged" });
  assert.equal(out.outcome, "failed");
  assert.equal(out.reason, "no_rows");
  assert.deepEqual(storedPaths(caseDataDir), { 1: OLD });
});

test("a record naming a twin still on disk is left, and the call fails twin_at_stored_path", async (t) => {
  const twin = "5. COURT FILE\\copy.pdf";
  const { matterRoot, caseDataDir } = matterFixture(t, [[1, twin]]);
  place(matterRoot, twin);
  place(matterRoot, NEW);
  const out = await relocate(matterRoot);
  assert.equal(out.outcome, "failed");
  assert.equal(out.reason, "twin_at_stored_path");
  assert.deepEqual(out.rows, [{ store: "main", id: 1, was: twin, action: "left" }]);
  assert.deepEqual(storedPaths(caseDataDir), { 1: twin });
});

test("a hash that is not lowercase hex SHA-256 is refused before anything is read", async (t) => {
  const { matterRoot } = matterFixture(t, [[1, OLD]]);
  await assert.rejects(relocate(matterRoot, { hash: HASH.toUpperCase() }), /hash/);
});
