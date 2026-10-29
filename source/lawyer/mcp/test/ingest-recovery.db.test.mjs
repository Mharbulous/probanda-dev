// The ingest run's recovery and refusal paths (ingest orchestrator spec §2.3, §2.4, §9 R4-R10): an
// exhibit that fails a constraint, a route that cannot be read, a file routed twice, an expired or
// stale staged result, a resume, a plugin update, the boundary scan, the procedural history entry,
// the reply cap and privileged wording left in staging. Every name is invented.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { drawImage, imagePdfBytes, pdfBytes } from "./helpers/synthetic-docs.mjs";

const { callTool } = await import("../build/dispatch.js");
const { writeCaseDataStores } = await import("./helpers/matter-data-fixture.mjs");

const SEED = `
INSERT INTO proceedings (proceeding_id, court, file_number, style_of_cause) VALUES (1, 'BCSC', 'S-000001', 'Quill v. Plum');
INSERT INTO parties (party_id, name) VALUES (1, 'Ada Quill'), (2, 'Plum Holdings Ltd.');
INSERT INTO proceeding_parties (proceeding_id, party_id, role) VALUES (1, 1, 'plaintiff'), (1, 2, 'defendant');
`;

function fixture(t) {
  const base = mkdtempSync(join(tmpdir(), "coclerk-ingest-recovery-"));
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
  mkdirSync(caseDataDir, { recursive: true });
  writeFileSync(
    join(matterRoot, "coclerk.json"),
    JSON.stringify({ schema_version: 5, matter_root: matterRoot, case_data_dir: caseDataDir, evidence_sql_path: "4. LAWYER BRIEF\\CoWork\\evidence.sql" }),
    "utf-8"
  );
  writeCaseDataStores(caseDataDir, SEED);
  return { matterRoot, caseDataDir, runRoot: join(base, "runs") };
}

const py = (args) => spawnSync(process.env.COCLERK_PYTHON || "python", args, { encoding: "utf-8" });

function file(matterRoot, name, bytes) {
  const stored = `5. COURT FILE\\${name}`;
  writeFileSync(join(matterRoot, stored), bytes);
  const hash = py(["-c", "import hashlib,sys; print(hashlib.sha256(open(sys.argv[1],'rb').read()).hexdigest())", join(matterRoot, stored)]).stdout.trim();
  return { file_path: stored, file_hash: hash };
}

function sql(caseDataDir, query, db = "main") {
  const res = py(["-c", "import json,sqlite3,sys; c=sqlite3.connect(sys.argv[1]); c.row_factory=sqlite3.Row; r=[dict(x) for x in c.execute(sys.argv[2])]; c.commit(); print(json.dumps(r))", join(caseDataDir, `${db}.sqlite`), query]);
  if (res.status !== 0) throw new Error(res.stderr);
  return JSON.parse(res.stdout);
}

const runDir = (runRoot) => join(runRoot, readdirSync(runRoot).find((n) => /^[0-9a-f]{16}$/.test(n)));
const run = (matterRoot, args) => callTool({}, "matter_data__ingest_run", { matter_root: matterRoot, ...args });
const stage = (result) => callTool({}, "matter_data__stage_result", { result });
const stagedPath = (id) => join(process.env.LOCALAPPDATA, "Coclerk", "extract-results", `${id}.json`);
const byRef = (matterRoot, run_id, ref, contract, result_ids, answers) =>
  callTool({}, "matter_data__ingest_result", { matter_root: matterRoot, run_id, document: { ref, store: "main" }, contract, result_ids, ...(answers ? { answers } : {}) });

const FACTS = (ref, extra = {}) => ({
  contract: "facts", contract_version: 1, ref, flags: [],
  document: { title: "Notice of Civil Claim", description: "The claim", category: "court", date: "2026-01-05", author_or_filing_party: "Ada Quill", proceeding_file_number: "S-000001" },
  facts: [{ fact_key: "new:1", source_locator: "para. 1", description: "Ada Quill lent Plum Holdings Ltd. $5,000.", category: "contract", date_of_fact: "2025-03-01", evidence: null }],
  fact_positions: [{ target_fact_key: "new:1", party_name: "Ada Quill", value: "claim", position_basis: null, qualification: null, source_locator: "para. 1" }],
  relief_items: [], relief_positions: [], source_references: [], unresolved_references: [],
  ...extra,
});

const BODY = (extra = {}) => ({
  contract: "affidavit_body", contract_version: 1, ref: "f1", flags: [],
  deponent: { name: "Ada Quill", role: "plaintiff", basis_statement: "I am the plaintiff." },
  sworn_date: "2026-03-01",
  body_facts: [{ source_locator: "para. 2", description: "Ada Quill met the director.", category: "background", date_of_fact: null, basis_of_knowledge: "personal", informant: null }],
  exhibit_inventory: [
    { letter: "A", description: "Loan agreement", referencing_locator: "para. 2", page_start: 3, page_end: 4 },
    { letter: "B", description: "Demand letter", referencing_locator: "para. 3", page_start: 5, page_end: 6 },
  ],
  body_page_count: 2, total_pages_read: 2, scanned: false,
  ...extra,
});

const EXHIBIT = (letter, description = `Exhibit ${letter} says so.`) => ({
  contract: "affidavit_exhibits", contract_version: 1, ref: `f1:${letter}`, flags: [],
  exhibit_letter: letter, title: `Document ${letter}`, description: "x", date: null, needs_human: false,
  facts: [{ source_locator: "p4", description, category: "contract", date_of_fact: null, evidence: null }],
});

const AFF_PAGES = ["Affidavit", "Body 2", "Exhibit A stamp", "A content", "Exhibit B stamp", "B content"];

test("an exhibit that breaks a constraint is recorded for review, not as written, and read again", async (t) => {
  const { matterRoot, caseDataDir } = fixture(t);
  // A trigger standing in for any constraint an exhibit can break.
  sql(caseDataDir, "CREATE TRIGGER boom BEFORE INSERT ON facts WHEN NEW.description = 'BOOM' BEGIN SELECT RAISE(ABORT, 'boom'); END");
  const doc = file(matterRoot, "2026-03-01 AFF Quill.pdf", pdfBytes(AFF_PAGES));
  const { run_id } = await run(matterRoot, { action: "begin", mode: "attended" });
  await run(matterRoot, { action: "next", run_id, routes: [{ ...doc, kind: "affidavit", execution: "affirmed" }] });
  const body = await stage(BODY());
  assert.equal((await byRef(matterRoot, run_id, "f1", "affidavit_body", [body.result_id])).outcome, "written");
  const exhibits = await run(matterRoot, { action: "next", run_id });
  assert.deepEqual(exhibits.dispatch.map((d) => d.ref), ["f1:A", "f1:B"]);

  const a = await stage(EXHIBIT("A"));
  const b = await stage(EXHIBIT("B", "BOOM"));
  const out = await byRef(matterRoot, run_id, "f1", "affidavit_exhibits", [a.result_id, b.result_id]);
  assert.equal(out.outcome, "written", JSON.stringify(out));
  assert.deepEqual(out.items.map((i) => i.ref), ["B"]);
  assert.ok(out.report.some((l) => /^Exhibit B could not be recorded/.test(l)), "a fixed line names the exhibit");
  assert.deepEqual(sql(caseDataDir, "SELECT title, verified, ingestion_status, notes FROM sources WHERE parent_source_id IS NOT NULL ORDER BY source_id"), [
    { title: "Exhibit A — Document A", verified: 0, ingestion_status: "complete", notes: null },
    { title: "Exhibit B", verified: 2, ingestion_status: "failed", notes: "UNCONFIRMED: the exhibit could not be read into the record." },
  ]);
  assert.equal(sql(caseDataDir, "SELECT ingestion_status FROM sources WHERE parent_source_id IS NULL")[0].ingestion_status, "partial", "the body is not closed over a failed exhibit");

  const again = await run(matterRoot, { action: "next", run_id });
  assert.deepEqual(again.dispatch.map((d) => d.ref), ["f1:B"], "the failed exhibit is read once more (R4)");
  assert.deepEqual([again.write, again.close], [[], []]);
  const b2 = await stage(EXHIBIT("B"));
  assert.equal((await byRef(matterRoot, run_id, "f1", "affidavit_exhibits", [b2.result_id])).outcome, "written");
  assert.deepEqual(sql(caseDataDir, "SELECT title, verified, ingestion_status FROM sources WHERE parent_source_id IS NOT NULL ORDER BY source_id")[1],
    { title: "Exhibit B — Document B", verified: 0, ingestion_status: "complete" }, "the failed row is reused and refreshed");
  assert.equal(sql(caseDataDir, "SELECT ingestion_status FROM sources WHERE parent_source_id IS NULL")[0].ingestion_status, "complete");
  const end = await run(matterRoot, { action: "next", run_id });
  assert.deepEqual([end.dispatch, end.write, end.close], [[], [], []]);
  assert.equal((await byRef(matterRoot, run_id, "f1", "affidavit_exhibits", [b2.result_id])).outcome, "already_written");
});

test("routes are checked whole, a file routed twice keeps its ref, and an unreadable file fails alone", async (t) => {
  const { matterRoot, runRoot } = fixture(t);
  const good = file(matterRoot, "good.pdf", pdfBytes(["Good"]));
  const broken = file(matterRoot, "broken.pdf", Buffer.from("this is not a PDF"));
  const { run_id } = await run(matterRoot, { action: "begin", mode: "attended" });
  await assert.rejects(run(matterRoot, { action: "next", run_id, routes: [{ ...good, kind: "facts" }, { ...good, file_hash: "0".repeat(64), kind: "facts" }] }), /hash/);
  await assert.rejects(run(matterRoot, { action: "next", run_id, routes: [{ file_path: "C:\\elsewhere\\x.pdf", file_hash: good.file_hash, kind: "facts" }] }), /inside the matter/);
  assert.equal(existsSync(join(runDir(runRoot), "journal.jsonl")) ? readFileSync(join(runDir(runRoot), "journal.jsonl"), "utf-8").includes("\"route\"") : false, false, "a refused list routes nothing");

  const first = await run(matterRoot, { action: "next", run_id, routes: [{ ...good, kind: "facts" }, { ...broken, kind: "facts" }, { ...good, kind: "facts" }] });
  assert.deepEqual(first.routed, ["f1", "f2", "f1"]);
  assert.deepEqual(first.dispatch.map((d) => d.ref), ["f1"], "the unreadable file does not stop the list");
  const again = await run(matterRoot, { action: "next", run_id, routes: [{ ...good, kind: "facts" }] });
  assert.deepEqual(again.routed, ["f1"], "a resent route keeps its ref");
  assert.deepEqual(again.dispatch, [], "and is not dispatched twice");
  assert.deepEqual((await run(matterRoot, { action: "next", run_id })).close, [{ ref: "f2", contract: "facts" }], "the unreadable file fails twice and is closed");
  await assert.rejects(run(matterRoot, { action: "staged", run_id, dispatch_id: "..\\..\\x", paths: [] }), /dispatch_id/);
});

test("an acknowledged result that expired, or was staged under another contract version, is read again", async (t) => {
  const { matterRoot } = fixture(t);
  const one = file(matterRoot, "one.pdf", pdfBytes(["One"]));
  const two = file(matterRoot, "two.pdf", pdfBytes(["Two"]));
  const { run_id } = await run(matterRoot, { action: "begin", mode: "attended" });
  await run(matterRoot, { action: "next", run_id, routes: [{ ...one, kind: "facts" }, { ...two, kind: "facts" }] });
  // Each result is acknowledged by a write that waits for an answer.
  const ask = (ref) => FACTS(ref, { fact_positions: [{ target_fact_key: "new:1", party_name: "Nobody Known", value: "claim", position_basis: null, qualification: null, source_locator: "para. 1" }] });
  const r1 = await stage(ask("f1"));
  const r2 = await stage(ask("f2"));
  assert.equal((await byRef(matterRoot, run_id, "f1", "facts", [r1.result_id])).refused, "needs_answer");
  assert.equal((await byRef(matterRoot, run_id, "f2", "facts", [r2.result_id])).refused, "needs_answer");
  unlinkSync(stagedPath(r1.result_id)); // R10: more than 7 days old
  const listed = await run(matterRoot, { action: "next", run_id });
  assert.deepEqual(listed.dispatch.map((d) => d.ref), ["f1"]);
  assert.deepEqual(listed.write, [{ ref: "f2", contract: "facts", result_ids: [r2.result_id] }]);

  // A resume keeps every acknowledged item whose result can still be written (spec §10.3 item 4).
  const resumed = await run(matterRoot, { action: "begin", mode: "attended", resume: run_id });
  assert.equal(resumed.resumed, true);
  assert.deepEqual(resumed.next, [{ ref: "f2", contract: "facts", result_ids: [r2.result_id] }]);
  writeFileSync(stagedPath(r2.result_id), JSON.stringify({ ...ask("f2"), contract_version: 0 })); // R7
  const after = await run(matterRoot, { action: "next", run_id: resumed.run_id });
  assert.deepEqual(after.dispatch.map((d) => d.ref).sort(), ["f1", "f2"], "the stale result is read again; the lost dispatch is re-sent");
  assert.deepEqual(after.write, []);
  assert.equal((await run(matterRoot, { action: "next", run_id })).refused, "lease_lost", "the displaced holder is stopped");
});

test("a plugin update mid-run refuses every call carrying the run, execute included", async (t) => {
  const { matterRoot, runRoot } = fixture(t);
  const { run_id } = await run(matterRoot, { action: "begin", mode: "attended" });
  const path = join(runDir(runRoot), "lease.json");
  writeFileSync(path, JSON.stringify({ ...JSON.parse(readFileSync(path, "utf-8")), build_stamp: "an older build" }));
  assert.equal((await run(matterRoot, { action: "status", run_id })).refused, "plugin_changed");
  assert.equal((await run(matterRoot, { action: "staged", run_id })).refused, "plugin_changed");
  assert.equal((await run(matterRoot, { action: "next", run_id })).refused, "plugin_changed");
  await assert.rejects(callTool({}, "matter_data__execute", { matter_root: matterRoot, run_id, sql_script: "SELECT 1;" }), (err) => err.code === "plugin_changed");
});

test("an empty exhibit inventory takes the boundary scan, whose letters are then dispatched", async (t) => {
  const { matterRoot } = fixture(t);
  const doc = file(matterRoot, "2026-03-01 AFF Quill.pdf", pdfBytes(AFF_PAGES));
  const { run_id } = await run(matterRoot, { action: "begin", mode: "attended" });
  await run(matterRoot, { action: "next", run_id, routes: [{ ...doc, kind: "affidavit" }] });
  const body = await stage(BODY({ exhibit_inventory: [] }));
  assert.equal((await byRef(matterRoot, run_id, "f1", "affidavit_body", [body.result_id])).outcome, "written");
  const scan = await run(matterRoot, { action: "next", run_id });
  assert.deepEqual(scan.dispatch.map((d) => [d.ref, d.contract]), [["f1:p2:1", null]]);
  const inputs = await callTool({}, "matter_data__dispatch_inputs", { dispatch_id: scan.dispatch[0].dispatch_id });
  assert.deepEqual([inputs.PASS, inputs.PAGE_RANGE], [2, [3, 6]]);
  const found = await stage({ contract: "boundaries", contract_version: 1, ref: "f1:p2:1", flags: [], boundaries: [
    { letter: "A", stamp_page: 3, content_start: 4, content_end: 4, ocr_uncertain: false },
    { letter: "B", stamp_page: 5, content_start: 6, content_end: 6, ocr_uncertain: true },
  ] });
  await run(matterRoot, { action: "status", run_id, ack: `ok f1:p2:1 ${found.result_id} 10` });
  const exhibits = await run(matterRoot, { action: "next", run_id });
  assert.deepEqual(exhibits.dispatch.map((d) => d.ref), ["f1:A", "f1:B"]);
});

test("the procedural history entry is written, and a repeat after a lost entry adds it back once", async (t) => {
  const { matterRoot } = fixture(t);
  const doc = file(matterRoot, "2026-01-05 NOCC.pdf", pdfBytes(["Notice of Civil Claim"]));
  const { run_id } = await run(matterRoot, { action: "begin", mode: "attended" });
  await run(matterRoot, { action: "next", run_id, routes: [{ ...doc, kind: "facts" }] });
  const { result_id } = await stage(FACTS("f1"));
  assert.equal((await byRef(matterRoot, run_id, "f1", "facts", [result_id])).outcome, "written");
  const history = join(matterRoot, "ProceduralHistory.md");
  assert.match(readFileSync(history, "utf-8"), /## 2026-01-05\n- Notice of Civil Claim `5\. COURT FILE\\2026-01-05 NOCC\.pdf`/);
  unlinkSync(history); // a crash between the write and the entry
  const repeat = await byRef(matterRoot, run_id, "f1", "facts", [result_id]);
  assert.equal(repeat.outcome, "already_written");
  assert.equal(readFileSync(history, "utf-8").match(/Notice of Civil Claim/g).length, 1);
  await byRef(matterRoot, run_id, "f1", "facts", [result_id]);
  assert.equal(readFileSync(history, "utf-8").match(/Notice of Civil Claim/g).length, 1, "never twice");
});

test("many questions keep the reply within its cap, counting what was left out", async (t) => {
  const { matterRoot } = fixture(t);
  const doc = file(matterRoot, "many.pdf", pdfBytes(["Many"]));
  const { run_id } = await run(matterRoot, { action: "begin", mode: "attended" });
  await run(matterRoot, { action: "next", run_id, routes: [{ ...doc, kind: "facts" }] });
  const facts = Array.from({ length: 15 }, (_, i) => ({ fact_key: `new:${i}`, source_locator: `para. ${i}`, description: `Fact ${i}.`, category: "contract", date_of_fact: null, evidence: null }));
  const positions = facts.map((f, i) => ({ target_fact_key: f.fact_key, party_name: `Unknown person number ${i} of the many`, value: "claim", position_basis: null, qualification: null, source_locator: f.source_locator }));
  const { result_id } = await stage(FACTS("f1", { facts, fact_positions: positions }));
  const out = await byRef(matterRoot, run_id, "f1", "facts", [result_id]);
  assert.equal(out.refused, "needs_answer");
  assert.ok(Buffer.byteLength(JSON.stringify(out)) <= 600, JSON.stringify(out).length);
  assert.ok(out.dropped > 0 && out.ask.length + out.dropped === 15);
});

test("a document that may be privileged is not written from its reading and is not listed again", async (t) => {
  const { matterRoot, caseDataDir } = fixture(t);
  const doc = file(matterRoot, "letter.pdf", pdfBytes(["Letter"]));
  const { run_id } = await run(matterRoot, { action: "begin", mode: "attended" });
  await run(matterRoot, { action: "next", run_id, routes: [{ ...doc, kind: "facts" }] });
  const { result_id } = await stage(FACTS("f1", { flags: [{ kind: "privilege_signal", ref: "f1" }] }));
  const out = await byRef(matterRoot, run_id, "f1", "facts", [result_id]);
  assert.deepEqual([out.refused, out.ask.map((a) => a.kind)], ["path_b", ["privilege"]]);
  assert.deepEqual(sql(caseDataDir, "SELECT * FROM sources"), []);
  const after = await run(matterRoot, { action: "next", run_id });
  assert.deepEqual([after.dispatch, after.write, after.close], [[], [], []]);
});

test("privileged wording leaves staging after a refusal, and stays while a question is open", async (t) => {
  const { matterRoot } = fixture(t);
  const { run_id } = await run(matterRoot, { action: "begin", mode: "attended" });
  const memo = { file_path: "3. CLIENT\\memo.pdf", file_hash: "c".repeat(64) };
  const write = (result_ids) => callTool({}, "matter_data__ingest_result", { matter_root: matterRoot, run_id, document: { ...memo, store: "privileged" }, contract: "privileged", result_ids, answers: { privilege: "yes" } });
  const bad = await stage({ contract: "privileged", contract_version: 1, ref: "memo", document: { title: "Memo", category: "not a category" }, facts: [] });
  assert.equal((await write([bad.result_id])).refused, "invalid");
  assert.equal(existsSync(stagedPath(bad.result_id)), false);
  const asking = await stage({ contract: "privileged", contract_version: 1, ref: "memo", document: { title: "Memo", category: "solicitor_client" }, facts: [],
    client_instructions: [{ party_name: "Someone Unknown", instructed_by: "Ada Quill", date: "2026-01-02", description: "Settle.", source_locator: "p1", status: "open" }] });
  assert.equal((await write([asking.result_id])).refused, "needs_answer");
  assert.equal(existsSync(stagedPath(asking.result_id)), true);
  await assert.rejects(write([asking.result_id, asking.result_id]), /repeat/);
  await assert.rejects(callTool({}, "matter_data__ingest_result", { matter_root: matterRoot, run_id, document: { ...memo, store: "main" }, contract: "privileged", result_ids: [asking.result_id], answers: { privilege: "yes" } }), /store/);
});

test("a wholly scanned document is named, never given a path (#71)", async (t) => {
  const { matterRoot } = fixture(t);
  const doc = file(matterRoot, "scan.pdf", imagePdfBytes({ pages: [{ content: drawImage(0, 0, 612, 792), mediaBox: [0, 0, 612, 792] }] }));
  const { run_id } = await run(matterRoot, { action: "begin", mode: "attended" });
  const { dispatch } = await run(matterRoot, { action: "next", run_id, routes: [{ ...doc, kind: "facts" }] });
  const inputs = await callTool({}, "matter_data__dispatch_inputs", { dispatch_id: dispatch[0].dispatch_id });
  assert.equal(inputs.DOCUMENT.name, "scan.pdf");
  assert.equal("path" in inputs.DOCUMENT, false);
  assert.ok(inputs.PAGE_MANIFEST.every((e) => "images" in e));
});
