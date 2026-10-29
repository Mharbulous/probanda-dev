// matter_data__execute's generator and inline cap (ingest orchestrator spec §2.5, stage D3): the server
// runs an allowlisted SQL-emitting script itself, so the SQL never reaches the model, and an inline
// script over 8 KB is refused only inside a run the orchestrator began. Every name is invented.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const { callTool } = await import("../build/dispatch.js");
const { buildToolDefinitions } = await import("../build/schema-gen.js");
const { writeCaseDataStores } = await import("./helpers/matter-data-fixture.mjs");

const H = (c) => c.repeat(64);
const SEED = `
INSERT INTO sources (source_id, category, title, file_path, file_hash, ingestion_status, execution_status)
  VALUES (1, 'court', 'Notice of Civil Claim', '5. COURT FILE\\NOCC draft.pdf', '${H("a")}', 'complete', 'draft');
INSERT INTO facts (fact_id, description, source_id, source_locator) VALUES (1, 'A loan was made.', 1, 'para. 1');
INSERT INTO sources (source_id, category, title, file_path, file_hash, ingestion_status, execution_status)
  VALUES (2, 'court', 'Response', '5. COURT FILE\\RCC filed.pdf', '${H("b")}', 'complete', 'filed');
`;

function fixture(t) {
  const base = mkdtempSync(join(tmpdir(), "coclerk-generator-"));
  const saved = { ...process.env };
  t.after(() => {
    process.env = saved;
    rmSync(base, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  });
  process.env.COCLERK_CASE_LOCK_ROOT = join(base, "locks");
  process.env.COCLERK_INGEST_RUN_ROOT = join(base, "runs");
  const matterRoot = join(base, "T9999 Scratch Matter");
  const caseDataDir = join(base, "0. CASE DATA", "T9999 Scratch Matter");
  mkdirSync(matterRoot, { recursive: true });
  mkdirSync(caseDataDir, { recursive: true });
  writeFileSync(
    join(matterRoot, "coclerk.json"),
    JSON.stringify({ schema_version: 5, matter_root: matterRoot, case_data_dir: caseDataDir, evidence_sql_path: "4. LAWYER BRIEF\\CoWork\\evidence.sql" }),
    "utf-8"
  );
  writeCaseDataStores(caseDataDir, SEED);
  return { matterRoot, caseDataDir };
}

function sql(caseDataDir, query) {
  const res = spawnSync(
    process.env.COCLERK_PYTHON || "python",
    ["-c", "import json,sqlite3,sys; c=sqlite3.connect(sys.argv[1]); c.row_factory=sqlite3.Row; print(json.dumps([dict(r) for r in c.execute(sys.argv[2])]))", join(caseDataDir, "main.sqlite"), query],
    { encoding: "utf-8" }
  );
  if (res.status !== 0) throw new Error(res.stderr);
  return JSON.parse(res.stdout);
}

const execute = (matterRoot, args) => callTool({}, "matter_data__execute", { matter_root: matterRoot, ...args });
const emit = (args) => ({ script: "supersede_draft.py", args: { command: "emit-sql", approver: "rule", ...args } });

test("execute takes sql_script or a generator, and states the cap", () => {
  const def = buildToolDefinitions().find((d) => d.name === "matter_data__execute");
  assert.deepEqual(def.inputSchema.required, ["matter_root"]);
  assert.ok(def.inputSchema.properties.generator);
  assert.match(def.description, /8 KB/);
});

test("a kept copy with no row takes the registered copy's place, with its facts, and the SQL never leaves the server", async (t) => {
  const { matterRoot, caseDataDir } = fixture(t);
  const out = await execute(matterRoot, { generator: emit({ superseded: 1, kept: { file_path: "5. COURT FILE\\NOCC filed.pdf", file_hash: H("c") }, execution_status: { kept: "filed" } }) });
  assert.equal(out.ok, true, JSON.stringify(out));
  assert.ok(!("sql_script" in out) && !JSON.stringify(out).includes("INSERT"), "the reply carries no SQL");
  const [kept] = sql(caseDataDir, `SELECT source_id, file_path, execution_status, ingestion_status FROM sources WHERE file_hash = '${H("c")}'`);
  assert.deepEqual([kept.file_path, kept.execution_status, kept.ingestion_status], ["5. COURT FILE\\NOCC filed.pdf", "filed", "complete"]);
  assert.match(sql(caseDataDir, "SELECT notes FROM sources WHERE source_id = 1")[0].notes, new RegExp(`^\\[SUPERSEDED-BY:#${kept.source_id} \\d{4}-\\d{2}-\\d{2} rule\\]`));
  assert.equal(sql(caseDataDir, "SELECT source_id FROM facts WHERE fact_id = 1")[0].source_id, kept.source_id);
});

test("a superseded copy with no row is inserted marker-only against the kept row", async (t) => {
  const { matterRoot, caseDataDir } = fixture(t);
  const out = await execute(matterRoot, { generator: emit({ superseded: { file_path: "5. COURT FILE\\RCC draft.pdf", file_hash: H("d") }, kept: 2 }) });
  assert.equal(out.ok, true, JSON.stringify(out));
  const [row] = sql(caseDataDir, `SELECT notes FROM sources WHERE file_hash = '${H("d")}'`);
  assert.match(row.notes, /^\[SUPERSEDED-BY:#2 /);
});

test("the generator refuses a pair of two registered rows, another script and another command", async (t) => {
  const { matterRoot, caseDataDir } = fixture(t);
  await assert.rejects(execute(matterRoot, { generator: emit({ superseded: 1, kept: 2 }) }), /one side of the pair has no row/);
  await assert.rejects(execute(matterRoot, { generator: { script: "merge_authorities.py", args: { command: "emit-sql" } } }), /allowlisted/);
  await assert.rejects(execute(matterRoot, { generator: { script: "supersede_draft.py", args: { command: "candidates" } } }), /allowlisted/);
  await assert.rejects(execute(matterRoot, { sql_script: "SELECT 1", generator: emit({ superseded: 1, kept: 2 }) }), /sql_script or generator/);
  await assert.rejects(execute(matterRoot, {}), /sql_script or generator/, "neither is refused too");
  await assert.rejects(execute(matterRoot, { generator: { script: "constructor", args: { command: "emit-sql" } } }), /allowlisted/, "a name on Object's prototype is not on the list");
  assert.equal(sql(caseDataDir, "SELECT count(*) AS n FROM sources")[0].n, 2);
});

test("a generator on a run's call checks the lease, and an inline script of exactly 8 KB passes", async (t) => {
  const { matterRoot, caseDataDir } = fixture(t);
  const { run_id } = await callTool({}, "matter_data__ingest_run", { matter_root: matterRoot, action: "begin", mode: "attended", orchestrator: true });
  const pair = { superseded: { file_path: "5. COURT FILE\\RCC draft.pdf", file_hash: H("d") }, kept: 2 };
  await assert.rejects(execute(matterRoot, { generator: emit(pair), run_id: "00000000-0000-4000-8000-000000000000" }), (err) => err.code === "lease_lost");
  assert.equal((await execute(matterRoot, { generator: emit(pair), run_id })).ok, true);
  const head = "INSERT INTO sources (category, title) VALUES ('court', 'edge'); -- ";
  const exact = head + "x".repeat(8192 - Buffer.byteLength(head));
  assert.equal(Buffer.byteLength(exact), 8192);
  assert.equal((await execute(matterRoot, { sql_script: exact, run_id })).ok, true, "the cap refuses only what is over 8 KB");
  assert.equal(sql(caseDataDir, "SELECT count(*) AS n FROM sources WHERE title = 'edge'")[0].n, 1);
});

test("rehash-sql re-points the file's records to its new hash", async (t) => {
  const { matterRoot, caseDataDir } = fixture(t);
  const out = await execute(matterRoot, { generator: { script: "supersede_draft.py", args: { command: "rehash-sql", old: H("b"), new: H("e"), file_path: "5. COURT FILE\\RCC filed.pdf" } } });
  assert.equal(out.ok, true);
  assert.equal(sql(caseDataDir, "SELECT file_hash FROM sources WHERE source_id = 2")[0].file_hash, H("e"));
});

test("an inline script over 8 KB is refused in an orchestrator run, and unchanged elsewhere", async (t) => {
  const { matterRoot, caseDataDir } = fixture(t);
  const begin = (extra) => callTool({}, "matter_data__ingest_run", { matter_root: matterRoot, action: "begin", mode: "attended", ...extra });
  const single = await begin({});
  const long = `INSERT INTO sources (category, title) VALUES ('court', 'long'); -- ${"x".repeat(8300)}`;
  assert.equal((await execute(matterRoot, { sql_script: long, run_id: single.run_id })).ok, true, "a single-document ingest's run is unaffected (N3)");
  await callTool({}, "matter_data__ingest_run", { matter_root: matterRoot, action: "end", run_id: single.run_id });
  const { run_id } = await begin({ orchestrator: true });
  await assert.rejects(execute(matterRoot, { sql_script: long, run_id }), (err) => {
    assert.equal(err.message, "too long to send inline: use a generator or ingest_result");
    return true;
  });
  assert.equal(sql(caseDataDir, "SELECT count(*) AS n FROM sources WHERE title = 'long'")[0].n, 1, "only the first run's write");
  assert.equal((await execute(matterRoot, { sql_script: long })).ok, true, "a caller without a run_id is unaffected");
  const short = "INSERT INTO sources (category, title) VALUES ('court', 'short');";
  assert.equal((await execute(matterRoot, { sql_script: short, run_id })).ok, true);
});
