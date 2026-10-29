// Statement groups in the matter-data execute helper (ingest orchestrator spec §2.1): each group runs
// under its own savepoint, so a failing group is rolled back alone, recorded with its reason, and the
// next group goes on; a failing statement outside any group still rolls back the whole call. Every
// name is invented.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const { caseDataExecuteStatements } = await import("../build/case/backend.js");
const { writeCaseDataStores } = await import("./helpers/matter-data-fixture.mjs");

function fixture(t) {
  const base = mkdtempSync(join(tmpdir(), "coclerk-groups-"));
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
  writeCaseDataStores(caseDataDir, "");
  return { matterRoot, caseDataDir };
}

function titles(caseDataDir) {
  const res = spawnSync(
    process.env.COCLERK_PYTHON || "python",
    ["-c", "import json,sqlite3,sys; c=sqlite3.connect(sys.argv[1]); print(json.dumps([r[0] for r in c.execute('SELECT title FROM sources ORDER BY source_id')]))", join(caseDataDir, "main.sqlite")],
    { encoding: "utf-8" }
  );
  if (res.status !== 0) throw new Error(res.stderr);
  return JSON.parse(res.stdout);
}

const insert = (title) => ({ sql: `INSERT INTO sources (category, title) VALUES ('court', '${title}')` });
const bad = { sql: "INSERT INTO sources (category, title) VALUES ('no such category', 'x')" };

test("a good group commits, a failing group rolls back alone with its reason, and the next group goes on", async (t) => {
  const { matterRoot, caseDataDir } = fixture(t);
  const out = await caseDataExecuteStatements(
    matterRoot,
    [
      insert("outside"),
      { ref: "A", statements: [insert("A1"), insert("A2")] },
      { ref: "B", statements: [insert("B1"), bad] },
      { ref: "C", statements: [insert("C1"), { sql: "SELECT 'C is refused'", refuse: true }] },
      { ref: "D", params: { title: "D1" }, statements: [{ sql: "INSERT INTO sources (category, title) VALUES ('court', :title)" }] },
    ],
    {}
  );
  assert.equal(out.ok, true, JSON.stringify(out));
  assert.deepEqual(titles(caseDataDir), ["outside", "A1", "A2", "D1"]);
  assert.deepEqual(out.failed.map((f) => f.ref), ["B", "C"]);
  assert.match(out.failed[0].reason, /CHECK constraint/);
  assert.equal(out.failed[1].reason, "C is refused");
  assert.equal(out.results.length, 8, "one result per statement, a rolled-back group's included");
  assert.deepEqual(out.results.slice(3, 7), Array(4).fill({ rowcount: 0, rows: [] }), "a rolled-back group's results read zero");
});

test("a failing statement outside any group rolls back everything", async (t) => {
  const { matterRoot, caseDataDir } = fixture(t);
  await assert.rejects(
    caseDataExecuteStatements(matterRoot, [{ ref: "A", statements: [insert("A1")] }, bad], {}),
    /CHECK constraint/
  );
  assert.deepEqual(titles(caseDataDir), []);
});
