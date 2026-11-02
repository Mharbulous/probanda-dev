// Several ingests of one matter at once (group locking spec section 12, its acceptance tests, and F7,
// F10). Extractors are stood in for by staged results. Every name is invented.

import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { pdfBytes } from "./helpers/synthetic-docs.mjs";

const { callTool } = await import("../build/dispatch.js");
const { withExclusive } = await import("../build/case/case-lock.js");
const { writeCaseDataStores } = await import("./helpers/matter-data-fixture.mjs");

const SEED = `
INSERT INTO proceedings (proceeding_id, court, file_number, style_of_cause) VALUES (1, 'BCSC', 'S-000001', 'Quill v. Plum');
INSERT INTO parties (party_id, name) VALUES (1, 'Ada Quill'), (2, 'Plum Holdings Ltd.');
INSERT INTO proceeding_parties (proceeding_id, party_id, role) VALUES (1, 1, 'plaintiff'), (1, 2, 'defendant');
`;

function fixture(t) {
  const base = mkdtempSync(join(tmpdir(), "coclerk-ingest-concurrency-"));
  const saved = { ...process.env };
  t.after(() => {
    process.env = saved;
    rmSync(base, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  });
  process.env.LOCALAPPDATA = join(base, "AppData");
  process.env.COCLERK_CASE_LOCK_ROOT = join(base, "locks");
  process.env.COCLERK_INGEST_RUN_ROOT = join(base, "runs");
  const matterRoot = join(base, "T9999 Scratch Matter");
  const caseDataDir = join(base, "0. CASE DATA", "T9999 Scratch Matter");
  mkdirSync(join(matterRoot, "5. COURT FILE"), { recursive: true });
  mkdirSync(join(matterRoot, "1. CORRESPONDENCE"), { recursive: true });
  mkdirSync(caseDataDir, { recursive: true });
  writeFileSync(
    join(matterRoot, "coclerk.json"),
    JSON.stringify({ schema_version: 5, matter_root: matterRoot, case_data_dir: caseDataDir, evidence_sql_path: "4. LAWYER BRIEF\\CoWork\\evidence.sql" }),
    "utf-8"
  );
  writeCaseDataStores(caseDataDir, SEED);
  return { matterRoot, caseDataDir, runRoot: join(base, "runs"), lockRoot: join(base, "locks") };
}

const py = (args) => spawnSync(process.env.COCLERK_PYTHON || "python", args, { encoding: "utf-8" });

function file(matterRoot, name, folder = "1. CORRESPONDENCE", text = name) {
  const stored = `${folder}\\${name}`;
  writeFileSync(join(matterRoot, stored), pdfBytes([text]));
  const hash = py(["-c", "import hashlib,sys; print(hashlib.sha256(open(sys.argv[1],'rb').read()).hexdigest())", join(matterRoot, stored)]).stdout.trim();
  return { file_path: stored, file_hash: hash };
}

function sql(caseDataDir, query) {
  const res = py(["-c", "import json,sqlite3,sys; c=sqlite3.connect(sys.argv[1]); c.row_factory=sqlite3.Row; print(json.dumps([dict(x) for x in c.execute(sys.argv[2])]))", join(caseDataDir, "main.sqlite"), query]);
  if (res.status !== 0) throw new Error(res.stderr);
  return JSON.parse(res.stdout);
}

const run = (matterRoot, args) => callTool({}, "matter_data__ingest_run", { matter_root: matterRoot, ...args });
const begin = (matterRoot, extra = {}) => run(matterRoot, { action: "begin", mode: "attended", ...extra });
const route = (matterRoot, run_id, docs, extra = {}) => run(matterRoot, { action: "next", run_id, routes: docs.map((d) => ({ ...d, kind: "facts", ...extra })) });
const end = (matterRoot, run_id) => run(matterRoot, { action: "end", run_id });
const stage = (result) => callTool({}, "matter_data__stage_result", { result });
const write = (matterRoot, run_id, ref, result_ids, answers) =>
  callTool({}, "matter_data__ingest_result", { matter_root: matterRoot, run_id, document: { ref, store: "main" }, contract: "facts", result_ids, ...(answers ? { answers } : {}) });

const FACTS = (ref, extra = {}) => ({
  contract: "facts", contract_version: 2, ref, flags: [],
  document: { title: "A letter", description: "A letter", category: "correspondence", date: "2026-01-05", author_or_filing_party: "Ada Quill" },
  facts: [{ fact_key: "new:1", source_locator: "para. 1", description: "Ada Quill lent Plum Holdings Ltd. $5,000.", category: "contract", date_of_fact: "2025-03-01", evidence: null }],
  fact_positions: [], relief_items: [], relief_positions: [], source_references: [], unresolved_references: [],
  ...extra,
});

/** A result naming a person who is no party yet, which asks the practitioner who it is. */
const ZED = { fact_positions: [{ target_fact_key: "new:1", party_name: "Zed Newman", value: "claim", position_basis: null, qualification: null, source_locator: "para. 1" }] };

const staged = async (ref, extra) => (await stage(FACTS(ref, extra))).result_id;

function runFolder(runRoot, runId) {
  const key = join(runRoot, readdirSync(runRoot).find((n) => /^[0-9a-f]{16}$/.test(n)));
  return join(key, readdirSync(key).find((name) => {
    try {
      return JSON.parse(readFileSync(join(key, name, "lease.json"), "utf-8")).run_id === runId;
    } catch {
      return false;
    }
  }));
}

function makeStale(runRoot, runId) {
  const path = join(runFolder(runRoot, runId), "lease.json");
  writeFileSync(path, JSON.stringify({ ...JSON.parse(readFileSync(path, "utf-8")), heartbeat: new Date(Date.now() - 61 * 60_000).toISOString() }));
}

test("1. two runs with no files in common both finish, each file written once", async (t) => {
  const { matterRoot, caseDataDir } = fixture(t);
  const [a, b] = [file(matterRoot, "a.pdf"), file(matterRoot, "b.pdf")];
  const one = await begin(matterRoot);
  const two = await begin(matterRoot);
  assert.deepEqual((await route(matterRoot, one.run_id, [a])).dispatch.map((d) => d.ref), ["f1"]);
  assert.deepEqual((await route(matterRoot, two.run_id, [b])).dispatch.map((d) => d.ref), ["f1"]);
  assert.equal((await write(matterRoot, two.run_id, "f1", [await staged("f1")])).outcome, "written");
  assert.equal((await write(matterRoot, one.run_id, "f1", [await staged("f1")])).outcome, "written");
  assert.equal((await end(matterRoot, one.run_id)).ok, true);
  assert.equal((await end(matterRoot, two.run_id)).ok, true);
  assert.equal(sql(caseDataDir, "SELECT count(*) AS n FROM sources")[0].n, 2);
});

test("2. the same files in two runs: read once, and the later run says which it left out", async (t) => {
  const { matterRoot, caseDataDir } = fixture(t);
  const [a, b, c] = [file(matterRoot, "a.pdf"), file(matterRoot, "b.pdf"), file(matterRoot, "c.pdf")];
  const one = await begin(matterRoot);
  const two = await begin(matterRoot);
  const first = await route(matterRoot, one.run_id, [a, b]);
  assert.deepEqual(first.routed, ["f1", "f2"]);
  const second = await route(matterRoot, two.run_id, [a, b, c]);
  assert.deepEqual(second.routed, ["f1"], "only the file nobody holds");
  assert.deepEqual(second.left_out, [a.file_path, b.file_path]);
  assert.ok(second.report.some((l) => l.startsWith("a.pdf is being ingested in another session")), JSON.stringify(second.report));
  assert.ok(second.report.some((l) => l.startsWith("b.pdf is being ingested in another session")));
  // The claim outlasts the reading: a third run is kept out while the first waits to write.
  const three = await begin(matterRoot);
  await write(matterRoot, one.run_id, "f1", [await staged("f1")]);
  const third = await route(matterRoot, three.run_id, [a, b]);
  assert.deepEqual(third.left_out, [a.file_path, b.file_path], "one just written, one still held");
  assert.match(third.report.join(), /a\.pdf has just been added/);
  await write(matterRoot, one.run_id, "f2", [await staged("f2")]);
  await write(matterRoot, two.run_id, "f1", [await staged("f1")]);
  assert.equal(sql(caseDataDir, "SELECT count(*) AS n FROM sources")[0].n, 3);
});

test("3. a party recorded after reading is found at write time, and no question is asked", async (t) => {
  const { matterRoot, caseDataDir } = fixture(t);
  const [a, b] = [file(matterRoot, "a.pdf"), file(matterRoot, "b.pdf")];
  const one = await begin(matterRoot);
  const two = await begin(matterRoot);
  await route(matterRoot, one.run_id, [a]);
  await route(matterRoot, two.run_id, [b]);
  const named = (ref) => staged(ref, ZED);
  const asked = await write(matterRoot, one.run_id, "f1", [await named("f1")]);
  assert.equal(asked.refused, "needs_answer");
  await callTool({}, "matter_data__execute", { matter_root: matterRoot, sql_script: "INSERT INTO parties (party_id, name) VALUES (3, 'Zed Newman');" });
  assert.equal((await write(matterRoot, two.run_id, "f1", [await named("f1")])).outcome, "written", "the second run's look-up finds the new party");
  assert.equal(sql(caseDataDir, "SELECT count(*) AS n FROM parties WHERE name = 'Zed Newman'")[0].n, 1);
});

test("4. a draft and the filed copy: the second writer is held back for the usual choice, then settled", async (t) => {
  const { matterRoot, caseDataDir } = fixture(t);
  const filed = file(matterRoot, "2026-01-05 NOCC Quill Filed.pdf", "5. COURT FILE", "filed");
  const draft = file(matterRoot, "2026-01-05 NOCC Quill Draft.pdf", "5. COURT FILE", "draft");
  const court = { document: { title: "Notice of Civil Claim", description: "The claim", category: "court", date: "2026-01-05", author_or_filing_party: "Ada Quill", proceeding_file_number: "S-000001" } };
  const one = await begin(matterRoot);
  const two = await begin(matterRoot);
  await route(matterRoot, one.run_id, [filed]);
  await route(matterRoot, two.run_id, [draft]);
  assert.equal((await write(matterRoot, one.run_id, "f1", [await staged("f1", court)])).outcome, "written");
  const id = await staged("f1", court);
  const held = await write(matterRoot, two.run_id, "f1", [id]);
  assert.equal(held.refused, "needs_answer");
  assert.equal(held.ask[0].kind, "other_version");
  assert.equal(sql(caseDataDir, "SELECT count(*) AS n FROM sources")[0].n, 1, "nothing written");
  assert.deepEqual((await run(matterRoot, { action: "next", run_id: two.run_id })).asked.map((l) => l.ref), ["f1"]);
  const settled = await write(matterRoot, two.run_id, "f1", [id], { other_version: "superseded" });
  assert.equal(settled.outcome, "already_written");
  const after = await run(matterRoot, { action: "next", run_id: two.run_id });
  assert.deepEqual([after.write, after.asked], [[], undefined], "the file is settled");
});

test("4b. a pair the choice finds is not a version is written", async (t) => {
  const { matterRoot, caseDataDir } = fixture(t);
  const filed = file(matterRoot, "2026-01-05 NOCC Quill Filed.pdf", "5. COURT FILE", "filed");
  const draft = file(matterRoot, "2026-01-05 NOCC Quill Draft.pdf", "5. COURT FILE", "draft");
  const court = { document: { title: "Notice of Civil Claim", description: "The claim", category: "court", date: "2026-01-05", author_or_filing_party: "Ada Quill", proceeding_file_number: "S-000001" } };
  const one = await begin(matterRoot);
  const two = await begin(matterRoot);
  await route(matterRoot, one.run_id, [filed]);
  await route(matterRoot, two.run_id, [draft]);
  await write(matterRoot, one.run_id, "f1", [await staged("f1", court)]);
  const id = await staged("f1", court);
  assert.equal((await write(matterRoot, two.run_id, "f1", [id])).ask[0].kind, "other_version");
  assert.equal((await write(matterRoot, two.run_id, "f1", [id], { other_version: "not_version" })).outcome, "written");
  assert.equal(sql(caseDataDir, "SELECT count(*) AS n FROM sources")[0].n, 2);
});

test("5. a lock left by a dead process is free at once, an aged one after 5 minutes, and a fresh one waits", async (t) => {
  const { matterRoot, lockRoot } = fixture(t);
  const one = await begin(matterRoot);
  const a = file(matterRoot, "a.pdf");
  await route(matterRoot, one.run_id, [a]);
  await callTool({}, "matter_data__execute", { matter_root: matterRoot, sql_script: "SELECT 1;" });
  const id = await staged("f1");
  const dead = spawnSync(process.execPath, ["-e", ""]).pid;
  const record = (pid) => JSON.stringify({ pid, ts: new Date().toISOString(), matterRoot, token: "00000000-0000-4000-8000-000000000001" });
  // The lock's name is the revision file's, which the write above left behind.
  const key = readdirSync(lockRoot).find((n) => n.endsWith(".revision")).replace(".revision", "");
  const lock = join(lockRoot, `${key}.lock`);

  writeFileSync(lock, record(process.pid));
  const fresh = await write(matterRoot, one.run_id, "f1", [id]);
  assert.equal(fresh.refused, "waiting", "a live holder keeps it");

  const past = new Date(Date.now() - 6 * 60_000);
  utimesSync(lock, past, past);
  assert.equal((await run(matterRoot, { action: "status", run_id: one.run_id })).ok, true);
  const b = file(matterRoot, "b.pdf");
  await route(matterRoot, one.run_id, [b]);
  assert.equal((await write(matterRoot, one.run_id, "f2", [await staged("f2")])).outcome, "written", "an aged lock is broken");

  writeFileSync(lock, record(dead));
  assert.equal((await write(matterRoot, one.run_id, "f1", [id])).outcome, "written", "a dead holder's lock is free at once");
  assert.equal(readdirSync(lockRoot).includes(`${key}.lock`), false);
});

test("6. a run killed while reading: its files go to another run, and resuming it reads none of them again", async (t) => {
  const { matterRoot, caseDataDir, runRoot } = fixture(t);
  const a = file(matterRoot, "a.pdf");
  const killed = await begin(matterRoot);
  await route(matterRoot, killed.run_id, [a]);
  makeStale(runRoot, killed.run_id);
  const other = await begin(matterRoot, { orchestrator: true });
  assert.equal(other.ok, true, JSON.stringify(other));
  const picked = await route(matterRoot, other.run_id, [a]);
  assert.deepEqual(picked.dispatch.map((d) => d.ref), ["f1"]);
  assert.ok(picked.report.some((l) => l.includes("stopped without finishing") && l.includes("a.pdf")), JSON.stringify(picked.report));

  const resumed = await begin(matterRoot, { resume: killed.run_id });
  assert.ok(resumed.report.some((l) => l.startsWith("a.pdf was taken")), JSON.stringify(resumed.report));
  const again = await run(matterRoot, { action: "next", run_id: resumed.run_id });
  assert.deepEqual(again.dispatch, [], "nothing to read again");
  assert.equal((await write(matterRoot, other.run_id, "f1", [await staged("f1")])).outcome, "written");
  assert.equal(sql(caseDataDir, "SELECT count(*) AS n FROM sources")[0].n, 1);
});

test("6b. a stale run that nobody took from gets its claims back when resumed", async (t) => {
  const { matterRoot, runRoot } = fixture(t);
  const a = file(matterRoot, "a.pdf");
  const killed = await begin(matterRoot);
  await route(matterRoot, killed.run_id, [a]);
  makeStale(runRoot, killed.run_id);
  const resumed = await begin(matterRoot, { resume: killed.run_id });
  const other = await begin(matterRoot);
  assert.deepEqual((await route(matterRoot, other.run_id, [a])).left_out, [a.file_path]);
  assert.equal((await write(matterRoot, resumed.run_id, "f1", [await staged("f1")])).outcome, "written");
});

test("7. an answer naming a party since merged away is not used: the question is asked again", async (t) => {
  const { matterRoot, caseDataDir } = fixture(t);
  const a = file(matterRoot, "a.pdf");
  await callTool({}, "matter_data__execute", { matter_root: matterRoot, sql_script: "INSERT INTO parties (party_id, name) VALUES (3, 'Old Name Ltd.');" });
  const one = await begin(matterRoot);
  await route(matterRoot, one.run_id, [a]);
  const id = await staged("f1", ZED);
  assert.equal((await write(matterRoot, one.run_id, "f1", [id])).refused, "needs_answer");
  await callTool({}, "matter_data__execute", { matter_root: matterRoot, sql_script: "DELETE FROM parties WHERE party_id = 3;" });
  const again = await write(matterRoot, one.run_id, "f1", [id], { participants: { "Zed Newman": 3 } });
  assert.equal(again.refused, "needs_answer");
  assert.equal(again.ask[0].ref, "Zed Newman");
  assert.match(again.report.join(), /^Since you answered/);
  assert.equal(sql(caseDataDir, "SELECT count(*) AS n FROM sources")[0].n, 0, "nothing written under the old answer");
});

test("7b. an answer the matter has not moved past is used", async (t) => {
  const { matterRoot, caseDataDir } = fixture(t);
  const a = file(matterRoot, "a.pdf");
  const one = await begin(matterRoot);
  await route(matterRoot, one.run_id, [a]);
  const id = await staged("f1", ZED);
  await write(matterRoot, one.run_id, "f1", [id]);
  assert.equal((await write(matterRoot, one.run_id, "f1", [id], { participants: { "Zed Newman": 1 } })).outcome, "written");
  assert.equal(sql(caseDataDir, "SELECT count(*) AS n FROM sources")[0].n, 1);
});

test("8. a matter-wide change: no new run or claim, writes wait, and both ingests finish after", async (t) => {
  const { matterRoot, caseDataDir } = fixture(t);
  const [a, b, c] = [file(matterRoot, "a.pdf"), file(matterRoot, "b.pdf"), file(matterRoot, "c.pdf")];
  const one = await begin(matterRoot);
  const two = await begin(matterRoot);
  await route(matterRoot, one.run_id, [a]);
  await route(matterRoot, two.run_id, [b]);
  const [ida, idb] = [await staged("f1"), await staged("f1")];
  await withExclusive(matterRoot, process.env, async () => {
    const busy = await begin(matterRoot);
    assert.equal(busy.refused, "matter_busy");
    assert.doesNotMatch(busy.say, /matter_|exclusive|lock/i);
    assert.equal((await route(matterRoot, one.run_id, [c])).refused, "matter_busy");
    assert.equal((await write(matterRoot, one.run_id, "f1", [ida])).refused, "waiting");
    assert.deepEqual((await run(matterRoot, { action: "next", run_id: one.run_id })).write.map((l) => l.ref), ["f1"], "reading carries on, and the write stays queued");
  });
  assert.equal((await write(matterRoot, one.run_id, "f1", [ida])).outcome, "written");
  assert.equal((await write(matterRoot, two.run_id, "f1", [idb])).outcome, "written");
  assert.equal(sql(caseDataDir, "SELECT count(*) AS n FROM sources")[0].n, 2);
});

test("9. ten writes from three sessions at once: all landed, none twice", async (t) => {
  const { matterRoot, caseDataDir } = fixture(t);
  const docs = Array.from({ length: 10 }, (_, i) => file(matterRoot, `letter ${i}.pdf`));
  const child = join(dirname(fileURLToPath(import.meta.url)), "helpers", "ingest-concurrency-child.mjs");
  const session = (list) => new Promise((resolve, reject) => {
    const p = spawn(process.execPath, [child, matterRoot, ...list.map((d) => JSON.stringify(d))], { env: process.env, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    p.stdout.on("data", (d) => { out += d; });
    p.stderr.on("data", (d) => { err += d; });
    p.on("close", (code) => (code === 0 ? resolve(JSON.parse(out)) : reject(new Error(err))));
  });
  const results = await Promise.all([session(docs.slice(0, 4)), session(docs.slice(4, 7)), session(docs.slice(7))]);
  assert.deepEqual(results.flat(), Array(10).fill("written"));
  assert.equal(sql(caseDataDir, "SELECT count(DISTINCT file_hash) AS n FROM sources")[0].n, 10);
  assert.equal(sql(caseDataDir, "SELECT count(*) AS n FROM sources")[0].n, 10);
});

test("10. two runs on one computer never have more than 10 readers", async (t) => {
  const { matterRoot } = fixture(t);
  const docs = Array.from({ length: 16 }, (_, i) => file(matterRoot, `letter ${i}.pdf`));
  const one = await begin(matterRoot);
  const two = await begin(matterRoot);
  const first = await route(matterRoot, one.run_id, docs.slice(0, 8));
  assert.equal(first.dispatch.length, 8);
  const second = await route(matterRoot, two.run_id, docs.slice(8));
  assert.equal(second.dispatch.length, 2, "the limit is shared");
  const third = await run(matterRoot, { action: "next", run_id: two.run_id });
  assert.deepEqual([third.dispatch, third.running, third.waiting_for_slot], [[], 2, true], "not finished: files wait for a reader");
});

test("F7. an answer after another run took the file while its run was stale writes nothing", async (t) => {
  const { matterRoot, caseDataDir, runRoot } = fixture(t);
  const a = file(matterRoot, "a.pdf");
  const one = await begin(matterRoot);
  await route(matterRoot, one.run_id, [a]);
  const id = await staged("f1", ZED);
  assert.equal((await write(matterRoot, one.run_id, "f1", [id])).refused, "needs_answer");
  makeStale(runRoot, one.run_id);
  const other = await begin(matterRoot);
  assert.deepEqual((await route(matterRoot, other.run_id, [a])).routed, ["f1"]);
  const late = await write(matterRoot, one.run_id, "f1", [id], { participants: { "Zed Newman": 1 } });
  assert.equal(late.refused, "taken");
  assert.match(late.report.join(), /^a\.pdf was taken/);
  assert.equal(sql(caseDataDir, "SELECT count(*) AS n FROM sources")[0].n, 0);
});

test("F10. an email's claim covers its attachment, all or none", async (t) => {
  const { matterRoot } = fixture(t);
  const [email, attachment, other] = [file(matterRoot, "email.pdf"), file(matterRoot, "attachment.pdf"), file(matterRoot, "other.pdf")];
  const one = await begin(matterRoot);
  const two = await begin(matterRoot);
  await run(matterRoot, { action: "next", run_id: one.run_id, routes: [{ ...email, kind: "facts", attachment_hashes: [attachment.file_hash] }] });
  const claim = await run(matterRoot, { action: "claim", run_id: two.run_id, files: [attachment, other] });
  assert.deepEqual(claim.claimed, [other.file_path]);
  assert.deepEqual(claim.left_out, [attachment.file_path]);
  assert.match(claim.report.join(), /attachment\.pdf is being ingested in another session/);
  const three = await begin(matterRoot);
  assert.deepEqual((await run(matterRoot, { action: "claim", run_id: three.run_id, files: [{ ...other, attachment_hashes: [] }] })).left_out, [other.file_path], "a claim lasts until its run ends");
  await end(matterRoot, two.run_id);
  assert.deepEqual((await run(matterRoot, { action: "claim", run_id: three.run_id, files: [other] })).claimed, [other.file_path]);
});

test("a stale run with nothing left open ends at another run's end", async (t) => {
  const { matterRoot, runRoot } = fixture(t);
  const a = file(matterRoot, "a.pdf");
  const stale = await begin(matterRoot);
  await route(matterRoot, stale.run_id, [a]);
  await write(matterRoot, stale.run_id, "f1", [await staged("f1")]);
  makeStale(runRoot, stale.run_id);
  const other = await begin(matterRoot);
  assert.equal((await run(matterRoot, { action: "status" })).runs.length, 2);
  await end(matterRoot, other.run_id);
  assert.deepEqual((await run(matterRoot, { action: "status" })).runs, []);
});

test("execute with expected_revision writes nothing once the matter has moved", async (t) => {
  const { matterRoot, caseDataDir } = fixture(t);
  const { revision } = await run(matterRoot, { action: "status" });
  await callTool({}, "matter_data__execute", { matter_root: matterRoot, sql_script: "INSERT INTO parties (party_id, name) VALUES (3, 'One');", expected_revision: revision });
  await assert.rejects(
    callTool({}, "matter_data__execute", { matter_root: matterRoot, sql_script: "INSERT INTO parties (party_id, name) VALUES (4, 'Two');", expected_revision: revision }),
    (err) => err.code === "stale_revision"
  );
  assert.equal(sql(caseDataDir, "SELECT count(*) AS n FROM parties WHERE party_id >= 3")[0].n, 1);
});
