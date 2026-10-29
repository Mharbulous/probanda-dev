// matter_data__ingest_run (ingest orchestrator spec §2.4, stage D1): one ingest per matter at a time.
// A host-local lease and journal per matter; matter_data__execute checks an optional run_id against the
// lease and behaves as before without one. Every name is invented.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs, { appendFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const { callTool } = await import("../build/dispatch.js");
const { buildToolDefinitions } = await import("../build/schema-gen.js");
const { writeCaseDataStores } = await import("./helpers/matter-data-fixture.mjs");

const TOOL = "matter_data__ingest_run";
const MINUTE = 60_000;

function matterFixture(t) {
  const base = mkdtempSync(join(tmpdir(), "coclerk-ingest-run-"));
  t.after(() => rmSync(base, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }));
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
  writeCaseDataStores(caseDataDir, "");
  return { matterRoot, caseDataDir, runRoot: join(base, "runs") };
}

const run = (matterRoot, args) => callTool({}, TOOL, { matter_root: matterRoot, ...args });
const begin = (matterRoot, extra = {}) => run(matterRoot, { action: "begin", mode: "attended", ...extra });

function runDir(runRoot) {
  const dirs = readdirSync(runRoot, { withFileTypes: true }).filter((d) => d.isDirectory());
  assert.equal(dirs.length, 1, "one run folder per matter");
  assert.match(dirs[0].name, /^[0-9a-f]{16}$/);
  return join(runRoot, dirs[0].name);
}

const lease = (runRoot) => JSON.parse(readFileSync(join(runDir(runRoot), "lease.json"), "utf-8"));
const journal = (runRoot) =>
  readFileSync(join(runDir(runRoot), "journal.jsonl"), "utf-8").trim().split("\n").map((l) => JSON.parse(l));

function ageHeartbeat(runRoot, minutes) {
  const path = join(runDir(runRoot), "lease.json");
  const l = JSON.parse(readFileSync(path, "utf-8"));
  l.heartbeat = new Date(Date.now() - minutes * MINUTE).toISOString();
  writeFileSync(path, JSON.stringify(l), "utf-8");
}

function sourceTitles(caseDataDir) {
  const res = spawnSync(
    process.env.COCLERK_PYTHON || "python",
    ["-c", "import json,sqlite3,sys; c=sqlite3.connect(sys.argv[1]); print(json.dumps([r[0] for r in c.execute('SELECT title FROM sources ORDER BY source_id')]))", join(caseDataDir, "main.sqlite")],
    { encoding: "utf-8" }
  );
  if (res.status !== 0) throw new Error(res.stderr);
  return JSON.parse(res.stdout);
}

const insert = (title) => `INSERT INTO sources (category, title) VALUES ('correspondence', '${title}');`;

// Spec §9 G5: what the practitioner may see names no tool, field or internal word.
const DENY = /matter_data|ingest_run|run_id|lease|journal|refused|run_active|lease_lost|unknown_run|\w+__\w+/i;

test("the tool is defined with its actions, and execute takes an optional run_id", () => {
  const defs = buildToolDefinitions();
  const def = defs.find((d) => d.name === TOOL);
  assert.ok(def, `${TOOL} is defined`);
  assert.deepEqual(def.inputSchema.properties.action.enum, ["begin", "next", "staged", "status", "end"]);
  assert.deepEqual(def.inputSchema.required, ["matter_root", "action"]);
  const execute = defs.find((d) => d.name === "matter_data__execute");
  assert.ok(execute.inputSchema.properties.run_id, "execute takes run_id");
  assert.deepEqual(execute.inputSchema.required, ["matter_root"], "sql_script or a generator (D3)");
});

test("a second begin is refused run_active, naming the live run; the first holds the lease", async (t) => {
  const { matterRoot, runRoot } = matterFixture(t);
  const first = await begin(matterRoot);
  assert.equal(first.ok, true);
  assert.match(first.run_id, /^[0-9a-f-]{36}$/);
  assert.deepEqual(first.next, []);

  const second = await begin(matterRoot);
  assert.equal(second.ok, false);
  assert.equal(second.refused, "run_active");
  assert.equal(second.run_id, first.run_id);
  assert.doesNotMatch(second.say, DENY);

  const l = lease(runRoot);
  assert.equal(l.run_id, first.run_id);
  assert.equal(l.mode, "attended");
  assert.equal(l.ended, null);
  assert.ok("build_stamp" in l && "started" in l && "heartbeat" in l);
});

test("begin with resume takes the lease over at once; the displaced holder is refused lease_lost", async (t) => {
  const { matterRoot, runRoot } = matterFixture(t);
  const first = await begin(matterRoot);
  const resumed = await begin(matterRoot, { resume: first.run_id });
  assert.equal(resumed.ok, true);
  assert.equal(resumed.resumed, true);
  assert.notEqual(resumed.run_id, first.run_id, "the resuming session gets its own id, so the displaced one is shut out");
  assert.deepEqual(resumed.next, []);
  assert.deepEqual(journal(runRoot).map((e) => e.event), ["begin", "takeover"]);
  assert.equal(journal(runRoot)[1].displaced, first.run_id);

  const lost = await run(matterRoot, { action: "status", run_id: first.run_id });
  assert.equal(lost.refused, "lease_lost");
  assert.equal((await run(matterRoot, { action: "status", run_id: resumed.run_id })).active, true);

  const unknown = await begin(matterRoot, { resume: "00000000-0000-4000-8000-000000000000" });
  assert.equal(unknown.ok, false);
  assert.equal(unknown.refused, "unknown_run");
  assert.doesNotMatch(unknown.say, DENY);
});

test("after 60 minutes without a heartbeat a plain begin takes over, and the old holder gets lease_lost", async (t) => {
  const { matterRoot, runRoot } = matterFixture(t);
  const first = await begin(matterRoot);
  ageHeartbeat(runRoot, 59);
  assert.equal((await begin(matterRoot)).refused, "run_active", "59 minutes is still live");

  ageHeartbeat(runRoot, 61);
  const second = await begin(matterRoot, { mode: "unattended" });
  assert.equal(second.ok, true);
  assert.notEqual(second.run_id, first.run_id);
  assert.equal(lease(runRoot).mode, "unattended");

  for (const action of ["status", "next", "staged", "end"]) {
    const out = await run(matterRoot, { action, run_id: first.run_id });
    assert.equal(out.ok, false, action);
    assert.equal(out.refused, "lease_lost", action);
    assert.doesNotMatch(out.say, DENY);
  }
  const takeover = journal(runRoot).find((e) => e.event === "takeover");
  assert.equal(takeover.run_id, second.run_id);
  assert.equal(takeover.displaced, first.run_id);
});

test("next and staged return empty lists, status reports the live run, end releases it", async (t) => {
  const { matterRoot, runRoot } = matterFixture(t);
  const { run_id } = await begin(matterRoot);
  assert.deepEqual(await run(matterRoot, { action: "next", run_id }), { ok: true, dispatch: [], write: [], close: [], running: 0 });
  assert.deepEqual(await run(matterRoot, { action: "staged", run_id }), { ok: true, items: [] });

  const status = await run(matterRoot, { action: "status" });
  assert.equal(status.active, true);
  assert.equal(status.run_id, run_id);
  assert.deepEqual(status.next, []);

  assert.equal((await run(matterRoot, { action: "end", run_id })).ok, true);
  assert.notEqual(lease(runRoot).ended, null);
  assert.equal((await run(matterRoot, { action: "status" })).active, false);
  assert.equal((await begin(matterRoot)).ok, true, "a finished run blocks nothing");
  assert.deepEqual(journal(runRoot).map((e) => e.event), ["begin", "end", "begin"]);
  assert.ok(journal(runRoot).every((e) => typeof e.ts === "string" && typeof e.run_id === "string"));
});

test("execute with a wrong run_id is refused lease_lost and writes nothing", async (t) => {
  const { matterRoot, caseDataDir } = matterFixture(t);
  await begin(matterRoot);
  await assert.rejects(
    callTool({}, "matter_data__execute", { matter_root: matterRoot, sql_script: insert("wrong"), run_id: "00000000-0000-4000-8000-000000000000" }),
    (err) => {
      assert.equal(err.code, "lease_lost");
      assert.doesNotMatch(err.message, DENY);
      return true;
    }
  );
  assert.deepEqual(sourceTitles(caseDataDir), []);
});

test("execute with the live run_id writes and renews the heartbeat; without one it writes as before", async (t) => {
  const { matterRoot, caseDataDir, runRoot } = matterFixture(t);
  const { run_id } = await begin(matterRoot);
  ageHeartbeat(runRoot, 30);
  const before = lease(runRoot).heartbeat;
  await callTool({}, "matter_data__execute", { matter_root: matterRoot, sql_script: insert("live"), run_id });
  assert.ok(Date.parse(lease(runRoot).heartbeat) > Date.parse(before), "heartbeat renewed");

  const out = await callTool({}, "matter_data__execute", { matter_root: matterRoot, sql_script: insert("plain") });
  assert.equal(out.ok, true);
  assert.deepEqual(sourceTitles(caseDataDir), ["live", "plain"]);
});

test("a run folder ended more than 30 days ago is deleted at the next begin", async (t) => {
  const { matterRoot, runRoot } = matterFixture(t);
  const old = join(runRoot, "0123456789abcdef");
  mkdirSync(old, { recursive: true });
  const ended = new Date(Date.now() - 31 * 24 * 60 * MINUTE).toISOString();
  writeFileSync(join(old, "lease.json"), JSON.stringify({ run_id: "x", started: ended, heartbeat: ended, build_stamp: null, mode: "attended", ended }));
  const recent = join(runRoot, "fedcba9876543210");
  mkdirSync(recent, { recursive: true });
  const now = new Date().toISOString();
  writeFileSync(join(recent, "lease.json"), JSON.stringify({ run_id: "y", started: now, heartbeat: now, build_stamp: null, mode: "attended", ended: now }));

  await begin(matterRoot);
  const names = readdirSync(runRoot);
  assert.ok(!names.includes("0123456789abcdef"), "old run folder deleted");
  assert.ok(names.includes("fedcba9876543210"), "recent run folder kept");
});

// ---------------------------------------------------------------- fifth review (1, 2, 11)

/** A crash mid-append: the journal's last line is cut short. */
const tearJournal = (runRoot) => appendFileSync(join(runDir(runRoot), "journal.jsonl"), '{"ts":"2026-10-29T00:00:00.000Z","event":"wri', "utf-8");

for (const orchestrator of [false, true]) {
  test(`a lease.json that cannot be read is taken over by ${orchestrator ? "an orchestrator" : "a single-document"} begin, which says so (round 5, 1)`, async (t) => {
    const { matterRoot, runRoot } = matterFixture(t);
    await begin(matterRoot);
    writeFileSync(join(runDir(runRoot), "lease.json"), '{"run_id": "x", "sta');
    const out = await begin(matterRoot, { orchestrator });
    assert.equal(out.ok, true, JSON.stringify(out));
    assert.equal(out.report?.length, 1, JSON.stringify(out));
    assert.doesNotMatch(out.report[0], DENY);
    assert.equal(lease(runRoot).run_id, out.run_id);
    assert.equal((await callTool({}, "matter_data__execute", { matter_root: matterRoot, sql_script: insert("after"), run_id: out.run_id })).ok, true);
  });

  test(`a journal whose last line a crash cut short is read without it by ${orchestrator ? "an orchestrator" : "a single-document"} begin, which says so (round 5, 1)`, async (t) => {
    const { matterRoot, runRoot } = matterFixture(t);
    const first = await begin(matterRoot);
    tearJournal(runRoot);
    ageHeartbeat(runRoot, 61);
    const out = await begin(matterRoot, { orchestrator });
    assert.equal(out.ok, true, JSON.stringify(out));
    assert.equal(out.report?.length, 1, JSON.stringify(out));
    assert.doesNotMatch(out.report[0], DENY);
    assert.deepEqual(journal(runRoot).map((e) => [e.event, e.run_id]), [["begin", first.run_id], ["takeover", out.run_id], ["begin", out.run_id]],
      "the cut-short line is gone and every later line is whole");
  });
}

test("end ends a run whose journal's last line a crash cut short (round 5, 11)", async (t) => {
  const { matterRoot, runRoot } = matterFixture(t);
  const { run_id } = await begin(matterRoot);
  tearJournal(runRoot);
  const ended = await run(matterRoot, { action: "end", run_id });
  assert.equal(ended.ok, true, JSON.stringify(ended));
  assert.equal((await run(matterRoot, { action: "status" })).active, false);
  assert.deepEqual(journal(runRoot).map((e) => e.event), ["begin", "end"]);
});

/** renameSync onto lease.json fails `code` for the first `times` calls (every call when Infinity). Returns the undo. */
function leaseHeld(code, times) {
  const saved = fs.renameSync;
  let seen = 0;
  fs.renameSync = (from, to, ...rest) => {
    if (String(to).endsWith("lease.json") && seen++ < times) throw Object.assign(new Error(`${code}: made by the test`), { code });
    return saved(from, to, ...rest);
  };
  syncBuiltinESMExports();
  return () => {
    fs.renameSync = saved;
    syncBuiltinESMExports();
  };
}

test("a lease write another program holds up for a moment is tried again; one held for good fails (round 5, 2)", async (t) => {
  const { matterRoot, caseDataDir, runRoot } = matterFixture(t);
  const { run_id } = await begin(matterRoot);
  for (const code of ["EPERM", "EACCES", "EBUSY"]) {
    const undo = leaseHeld(code, 2);
    try {
      await callTool({}, "matter_data__execute", { matter_root: matterRoot, sql_script: insert(code), run_id });
    } finally {
      undo();
    }
  }
  assert.deepEqual(sourceTitles(caseDataDir), ["EPERM", "EACCES", "EBUSY"]);
  const undo = leaseHeld("EPERM", Infinity);
  try {
    await assert.rejects(run(matterRoot, { action: "end", run_id }), (err) => err.code === "EPERM");
  } finally {
    undo();
  }
  assert.equal((await run(matterRoot, { action: "end", run_id })).ok, true);
  assert.equal(lease(runRoot).ended !== null, true);
});

test("a plain begin that cannot write its lease journals no takeover (round 5, 2)", async (t) => {
  const { matterRoot, runRoot } = matterFixture(t);
  await begin(matterRoot);
  ageHeartbeat(runRoot, 61);
  const undo = leaseHeld("EPERM", Infinity);
  try {
    await assert.rejects(begin(matterRoot), (err) => err.code === "EPERM");
  } finally {
    undo();
  }
  assert.deepEqual(journal(runRoot).map((e) => e.event), ["begin"]);
});
