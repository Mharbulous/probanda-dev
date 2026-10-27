// drafting_data__repoint_documents end to end (/drafting-data references/document-paths.md, "Re-point after a
// move"): the tool finds the matter's drafting database from its pointer and runs the reference's own fenced
// statements, with the values bound, against a migrated submission database. The statements themselves are
// pinned by the skill's test_document_paths.py; this pins the tool surface. Every name is invented.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const { callTool } = await import("../build/dispatch.js");
const { buildToolDefinitions } = await import("../build/schema-gen.js");
const { freshSubmissionDb } = await import("./helpers/template-db.mjs");

const TOOL = "drafting_data__repoint_documents";
const OLD = "2026-01-05 affidavit.pdf";
const NEW = "5. COURT FILE#S-290001\\2026-01-05 AFF Smith #1.pdf";

function matterFixture(t) {
  const base = mkdtempSync(join(tmpdir(), "coclerk-repoint-documents-"));
  t.after(() => rmSync(base, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }));
  process.env.COCLERK_SUBMISSION_LOCK_ROOT = join(base, "locks");
  const matterRoot = join(base, "T9999 Scratch Matter");
  const caseDataDir = join(base, "0. CASE DATA", "T9999 Scratch Matter");
  mkdirSync(matterRoot, { recursive: true });
  mkdirSync(caseDataDir, { recursive: true });
  writeFileSync(
    join(matterRoot, "probanda.json"),
    JSON.stringify({ schema_version: 5, matter_root: matterRoot, case_data_dir: caseDataDir, evidence_sql_path: "4. LAWYER BRIEF\\CoWork\\evidence.sql" }),
    "utf-8"
  );
  return { matterRoot, dbPath: join(caseDataDir, "submission.sqlite") };
}

function sql(dbPath, script, read) {
  const res = spawnSync(
    process.env.COCLERK_PYTHON || "python",
    ["-c", "import json,sqlite3,sys; c=sqlite3.connect(sys.argv[1]); c.executescript(sys.argv[2]); c.commit(); print(json.dumps(dict(c.execute(sys.argv[3])) if sys.argv[3] else {}))", dbPath, script, read ?? ""],
    { encoding: "utf-8" }
  );
  if (res.status !== 0) throw new Error(res.stderr);
  return JSON.parse(res.stdout);
}

const paths = (dbPath) => sql(dbPath, "", "SELECT id, file_path FROM documents ORDER BY id");

const repoint = (matterRoot, args = {}) => callTool({}, TOOL, { matter_root: matterRoot, old_path: OLD, new_path: NEW, ...args });

test("the tool writes and takes the matter root and the two stored paths", () => {
  const def = buildToolDefinitions().find((d) => d.name === TOOL);
  assert.ok(def, `${TOOL} is defined`);
  assert.deepEqual(def.annotations, { destructiveHint: true, openWorldHint: false });
  assert.deepEqual(def.inputSchema.required, ["matter_root", "old_path", "new_path"]);
  assert.match(def.description, /document-paths\.md/);
});

test("a matter with no drafting database has nothing to re-point, and says so", async (t) => {
  const { matterRoot } = matterFixture(t);
  assert.deepEqual(await repoint(matterRoot), { database: false, repointed: [] });
});

test("rows naming the old place, stored or absolute, in any case, are re-pointed; others stay", async (t) => {
  const { matterRoot, dbPath } = matterFixture(t);
  await freshSubmissionDb(dbPath);
  sql(dbPath, [
    "INSERT INTO proceedings (id, matter_reference, forum) VALUES (1, 'T9999', 'CAN/BC/BCSC');",
    `INSERT INTO documents (id, proceeding_id, label, file_path) VALUES (1, 1, 'd', '${OLD.toUpperCase()}');`,
    `INSERT INTO documents (id, proceeding_id, label, file_path) VALUES (2, 1, 'd', '${(matterRoot + "\\" + OLD).replace(/'/g, "''")}');`,
    "INSERT INTO documents (id, proceeding_id, label, file_path) VALUES (3, 1, 'd', 'unrelated.pdf');",
  ].join("\n"));
  const out = await repoint(matterRoot);
  assert.deepEqual(out, { database: true, repointed: [1, 2] });
  assert.deepEqual(paths(dbPath), { 1: NEW, 2: NEW, 3: "unrelated.pdf" });
  assert.deepEqual(await repoint(matterRoot), { database: true, repointed: [] }, "a second run finds zero rows");
});

test("a path not in the stored form is refused", async (t) => {
  const { matterRoot } = matterFixture(t);
  await assert.rejects(repoint(matterRoot, { new_path: "5. COURT FILE/x.pdf" }), /stored form/);
  await assert.rejects(repoint(matterRoot, { old_path: join(matterRoot, OLD) }), /stored form/);
});
