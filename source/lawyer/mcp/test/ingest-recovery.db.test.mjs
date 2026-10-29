// The ingest run's recovery and refusal paths (ingest orchestrator spec §2.3, §2.4, §9 R4-R10): an
// exhibit that fails a constraint, a route that cannot be read, a file routed twice, an expired or
// stale staged result, a resume, a plugin update, the boundary scan, the procedural history entry,
// the reply cap and privileged wording left in staging. Every name is invented.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
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
  contract: "facts", contract_version: 2, ref, flags: [],
  document: { title: "Notice of Civil Claim", description: "The claim", category: "court", date: "2026-01-05", author_or_filing_party: "Ada Quill", proceeding_file_number: "S-000001" },
  facts: [{ fact_key: "new:1", source_locator: "para. 1", description: "Ada Quill lent Plum Holdings Ltd. $5,000.", category: "contract", date_of_fact: "2025-03-01", evidence: null }],
  fact_positions: [{ target_fact_key: "new:1", party_name: "Ada Quill", value: "claim", position_basis: null, qualification: null, source_locator: "para. 1" }],
  relief_items: [], relief_positions: [], source_references: [], unresolved_references: [],
  ...extra,
});

const BODY = (extra = {}) => ({
  contract: "affidavit_body", contract_version: 2, ref: "f1", flags: [],
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
  contract: "affidavit_exhibits", contract_version: 2, ref: `f1:${letter}`, flags: [],
  exhibit_letter: letter, title: `Document ${letter}`, description: "x", date: null, needs_human: false,
  facts: [{ source_locator: "p4", description, category: "contract", date_of_fact: null, evidence: null }],
});

const AFF_PAGES = ["Affidavit", "Body 2", "Exhibit A stamp", "A content", "Exhibit B stamp", "B content"];

/** Exhibit `letter` held already, pending a privilege decision: a reading that cites it as proof breaks
 *  the pending-privilege guard (#49), so its statement group rolls back alone. */
const holdPending = (caseDataDir, letter) => sql(caseDataDir, `INSERT INTO sources (category, title, parent_source_id, ingestion_status, privilege_status)
  SELECT category, 'Exhibit ${letter}', source_id, 'complete', 'pending' FROM sources WHERE parent_source_id IS NULL`);
const PROOF = { is_proof_source: true, strength: 1, notes: null };
const PROVING = (letter) => ({ ...EXHIBIT(letter), facts: [{ ...EXHIBIT(letter).facts[0], evidence: PROOF }] });

test("an exhibit that breaks a constraint is recorded for review, not as written, and read again", async (t) => {
  const { matterRoot, caseDataDir } = fixture(t);
  const doc = file(matterRoot, "2026-03-01 AFF Quill.pdf", pdfBytes(AFF_PAGES));
  const { run_id } = await run(matterRoot, { action: "begin", mode: "attended" });
  await run(matterRoot, { action: "next", run_id, routes: [{ ...doc, kind: "affidavit", execution: "affirmed" }] });
  const body = await stage(BODY());
  assert.equal((await byRef(matterRoot, run_id, "f1", "affidavit_body", [body.result_id])).outcome, "written");
  const exhibits = await run(matterRoot, { action: "next", run_id });
  assert.deepEqual(exhibits.dispatch.map((d) => d.ref), ["f1:A", "f1:B"]);

  holdPending(caseDataDir, "B");
  const a = await stage(EXHIBIT("A"));
  const b = await stage(PROVING("B"));
  const out = await byRef(matterRoot, run_id, "f1", "affidavit_exhibits", [a.result_id, b.result_id]);
  assert.equal(out.outcome, "written", JSON.stringify(out));
  assert.deepEqual(out.items.map((i) => i.ref), ["B"]);
  assert.ok(out.report.some((l) => /^Exhibit B could not be recorded/.test(l)), "a fixed line names the exhibit");
  assert.deepEqual(sql(caseDataDir, "SELECT count(*) AS n FROM facts WHERE description = 'Exhibit B says so.'"), [{ n: 0 }], "B's group left nothing");
  assert.deepEqual(sql(caseDataDir, "SELECT title, ingestion_status FROM sources WHERE parent_source_id IS NOT NULL ORDER BY source_id")[1],
    { title: "Exhibit A — Document A", ingestion_status: "complete" });

  const again = await run(matterRoot, { action: "next", run_id });
  assert.deepEqual(again.dispatch.map((d) => d.ref), ["f1:B"], "the failed exhibit is read once more (R4)");
  assert.deepEqual([again.write, again.close], [[], []]);
  sql(caseDataDir, "UPDATE sources SET privilege_status = 'cleared' WHERE title = 'Exhibit B'"); // the practitioner decides it
  const b2 = await stage(PROVING("B"));
  assert.equal((await byRef(matterRoot, run_id, "f1", "affidavit_exhibits", [b2.result_id])).outcome, "written");
  assert.deepEqual(sql(caseDataDir, "SELECT count(*) AS n FROM evidence_links"), [{ n: 1 }]);
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
  await assert.rejects(run(matterRoot, { action: "staged", run_id, dispatch_id: "..\\..\\x", paths: [] }), /dispatch_id must be the id from the dispatch line/);
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
  assert.deepEqual(listed.write, [], "a write waiting on an answer is not a write to repeat (N10)");
  assert.deepEqual(listed.asked, [{ ref: "f2", contract: "facts", result_ids: [r2.result_id] }]);

  // A resume keeps every acknowledged item whose result can still be written (spec §10.3 item 4).
  const resumed = await run(matterRoot, { action: "begin", mode: "attended", resume: run_id });
  assert.equal(resumed.resumed, true);
  assert.deepEqual([resumed.next, resumed.asked], [[], [{ ref: "f2", contract: "facts", result_ids: [r2.result_id] }]]);
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
  const found = await stage({ contract: "boundaries", contract_version: 2, ref: "f1:p2:1", flags: [], boundaries: [
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
  const bad = await stage({ contract: "privileged", contract_version: 2, ref: "memo", document: { title: "Memo", category: "not a category" }, facts: [] });
  assert.equal((await write([bad.result_id])).refused, "invalid");
  assert.equal(existsSync(stagedPath(bad.result_id)), false);
  const asking = await stage({ contract: "privileged", contract_version: 2, ref: "memo", document: { title: "Memo", category: "solicitor_client" }, facts: [],
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

// ---------------------------------------------------------------- second review (N1-N15, S-M4, K-M3)

const NOA = (ref) => FACTS(ref, { document: { ...FACTS(ref).document, title: "Notice of Application" } });

test("a refused first write after an ok reply re-dispatches the item rather than leave it running (S-M4)", async (t) => {
  const { matterRoot } = fixture(t);
  const one = file(matterRoot, "one.pdf", pdfBytes(["One"]));
  const two = file(matterRoot, "two.pdf", pdfBytes(["Two"]));
  const { run_id } = await run(matterRoot, { action: "begin", mode: "attended" });
  await run(matterRoot, { action: "next", run_id, routes: [{ ...one, kind: "facts" }, { ...two, kind: "facts" }] });
  // f1's extractor staged the wrong contract; f2's reply names a result that is gone.
  const wrong = await stage({ ...FACTS("f1"), contract: "sought_orders" });
  assert.equal((await byRef(matterRoot, run_id, "f1", "facts", [wrong.result_id])).refused, "contract_mismatch");
  assert.equal((await byRef(matterRoot, run_id, "f2", "facts", [randomUUID()])).refused, "unknown_result");
  const again = await run(matterRoot, { action: "next", run_id });
  assert.deepEqual(again.dispatch.map((d) => d.ref).sort(), ["f1", "f2"], "both are read once more (R4)");
  assert.equal(again.running, 2, "only the new dispatches are running");
});

test("a routed document sent to Path B is written through Path B, and its reading leaves staging (N1, N18)", async (t) => {
  const { matterRoot, caseDataDir } = fixture(t);
  const doc = file(matterRoot, "letter.pdf", pdfBytes(["Letter"]));
  const { run_id } = await run(matterRoot, { action: "begin", mode: "attended" });
  await run(matterRoot, { action: "next", run_id, routes: [{ ...doc, kind: "facts" }] });
  const reading = await stage(FACTS("f1", { flags: [{ kind: "privilege_signal", ref: "f1" }] }));
  assert.equal((await byRef(matterRoot, run_id, "f1", "facts", [reading.result_id])).refused, "path_b");
  assert.equal(existsSync(stagedPath(reading.result_id)), false, "the extractor's reading is not kept 7 days");

  const memo = await stage({ contract: "privileged", contract_version: 2, ref: "letter.pdf",
    document: { title: "Letter", category: "solicitor_client", date: "2026-01-02" },
    facts: [{ source_locator: "p1", description: "The client asked for advice.", category: null, date_of_fact: null }] });
  const out = await callTool({}, "matter_data__ingest_result", { matter_root: matterRoot, run_id, document: { ...doc, store: "privileged" },
    contract: "privileged", result_ids: [memo.result_id], answers: { privilege: "yes" } });
  assert.equal(out.outcome, "written", JSON.stringify(out));
  assert.equal(sql(caseDataDir, "SELECT count(*) AS n FROM privileged_sources", "privileged")[0].n, 1);
  assert.equal(existsSync(stagedPath(memo.result_id)), false);
  const after = await run(matterRoot, { action: "next", run_id });
  assert.deepEqual([after.dispatch, after.write, after.close, after.asked], [[], [], [], undefined]);
});

test("a Notice of Application's orders that failed twice are closed once, not listed again (N2)", async (t) => {
  const { matterRoot, caseDataDir } = fixture(t);
  const doc = file(matterRoot, "2026-02-01 NOA.pdf", pdfBytes(["Notice of Application"]));
  const { run_id } = await run(matterRoot, { action: "begin", mode: "attended" });
  const first = await run(matterRoot, { action: "next", run_id, routes: [{ ...doc, kind: "notice_of_application" }] });
  assert.deepEqual(first.dispatch.map((d) => d.ref), ["f1", "f1:so"]);
  const facts = await stage(NOA("f1"));
  assert.equal((await byRef(matterRoot, run_id, "f1", "facts", [facts.result_id])).outcome, "written");
  await run(matterRoot, { action: "status", run_id, ack: "failed f1:so unreadable" });
  assert.deepEqual((await run(matterRoot, { action: "next", run_id })).dispatch.map((d) => d.ref), ["f1:so"]);
  await run(matterRoot, { action: "status", run_id, ack: "failed f1:so unreadable" });
  const closing = await run(matterRoot, { action: "next", run_id });
  assert.deepEqual(closing.close, [{ ref: "f1:so", contract: "sought_orders" }]);
  const out = await byRef(matterRoot, run_id, "f1:so", "sought_orders", []);
  assert.match(out.report[0], /orders sought .* could not be read/);
  const done = await run(matterRoot, { action: "next", run_id });
  assert.deepEqual([done.dispatch, done.write, done.close], [[], [], []], "the close is not listed again");
  assert.equal(sql(caseDataDir, "SELECT count(*) AS n FROM sought_orders")[0].n, 0);
});

test("the inline cap binds only a run the orchestrator began (N3)", async (t) => {
  const { matterRoot } = fixture(t);
  const long = `SELECT 1;\n${"-- padding\n".repeat(900)}`;
  const d1 = await run(matterRoot, { action: "begin", mode: "attended" });
  const ok = await callTool({}, "matter_data__execute", { matter_root: matterRoot, run_id: d1.run_id, sql_script: long });
  assert.equal(ok.ok, true, "a single-document ingest's run_id call is unchanged");
  await run(matterRoot, { action: "end", run_id: d1.run_id });
  const orch = await run(matterRoot, { action: "begin", mode: "attended", orchestrator: true });
  await assert.rejects(callTool({}, "matter_data__execute", { matter_root: matterRoot, run_id: orch.run_id, sql_script: long }), (err) => err.code === "too_long");
});

test("after a plugin update the run is left open, and a resume writes what was acknowledged (N4)", async (t) => {
  const { matterRoot, runRoot } = fixture(t);
  const doc = file(matterRoot, "one.pdf", pdfBytes(["One"]));
  const { run_id } = await run(matterRoot, { action: "begin", mode: "attended", orchestrator: true });
  await run(matterRoot, { action: "next", run_id, routes: [{ ...doc, kind: "facts" }] });
  const { result_id } = await stage(FACTS("f1"));
  await run(matterRoot, { action: "status", run_id, ack: `ok f1 ${result_id} 100` });
  const path = join(runDir(runRoot), "lease.json");
  writeFileSync(path, JSON.stringify({ ...JSON.parse(readFileSync(path, "utf-8")), build_stamp: "an older build" }));
  assert.equal((await run(matterRoot, { action: "next", run_id })).refused, "plugin_changed");
  const status = await run(matterRoot, { action: "status" });
  assert.equal(status.run_id, run_id, "status names the unfinished run");
  const resumed = await run(matterRoot, { action: "begin", mode: "attended", resume: run_id });
  assert.deepEqual(resumed.next, [{ ref: "f1", contract: "facts", result_ids: [result_id] }]);
  assert.equal((await byRef(matterRoot, resumed.run_id, "f1", "facts", [result_id])).outcome, "written");
  assert.equal(JSON.parse(readFileSync(path, "utf-8")).orchestrator, true, "the resumed run keeps its kind");
});

test("privileged wording is kept after an error, so the call can be repeated, and leaves once written (N5)", async (t) => {
  const { matterRoot } = fixture(t);
  const { run_id } = await run(matterRoot, { action: "begin", mode: "attended" });
  const memo = { file_path: "3. CLIENT\\memo.pdf", file_hash: "d".repeat(64) };
  const { result_id } = await stage({ contract: "privileged", contract_version: 2, ref: "memo", document: { title: "Memo", category: "solicitor_client" },
    facts: [{ source_locator: "p1", description: "The client asked.", category: null, date_of_fact: null }] });
  const write = () => callTool({}, "matter_data__ingest_result", { matter_root: matterRoot, run_id, document: { ...memo, store: "privileged" }, contract: "privileged", result_ids: [result_id], answers: { privilege: "yes" } });
  process.env.COCLERK_CASE_PYTHON_TIMEOUT_MS = "1"; // the converter times out
  await assert.rejects(write());
  delete process.env.COCLERK_CASE_PYTHON_TIMEOUT_MS;
  assert.equal(existsSync(stagedPath(result_id)), true, "kept for the repeat (R6)");
  assert.equal((await write()).outcome, "written");
  assert.equal(existsSync(stagedPath(result_id)), false);
});

test("the exhibits are planned from the journal, so a lost Pass 1 result is not read again (N9)", async (t) => {
  const { matterRoot } = fixture(t);
  const doc = file(matterRoot, "2026-03-01 AFF Quill.pdf", pdfBytes(AFF_PAGES));
  const { run_id } = await run(matterRoot, { action: "begin", mode: "attended" });
  await run(matterRoot, { action: "next", run_id, routes: [{ ...doc, kind: "affidavit" }] });
  const body = await stage(BODY());
  assert.equal((await byRef(matterRoot, run_id, "f1", "affidavit_body", [body.result_id])).outcome, "written");
  unlinkSync(stagedPath(body.result_id)); // expired (R10)
  const exhibits = await run(matterRoot, { action: "next", run_id });
  assert.deepEqual(exhibits.dispatch.map((d) => d.ref), ["f1:A", "f1:B"], "the body is not read and written again");
});

test("a run whose items wait on answers reaches its end, and a failed close's question waits too (N10)", async (t) => {
  const { matterRoot } = fixture(t);
  const doc = file(matterRoot, "one.pdf", pdfBytes(["One"]));
  const { run_id } = await run(matterRoot, { action: "begin", mode: "unattended" });
  await run(matterRoot, { action: "next", run_id, routes: [{ ...doc, kind: "facts" }] });
  await run(matterRoot, { action: "status", run_id, ack: "failed f1 unreadable" });
  await run(matterRoot, { action: "next", run_id });
  await run(matterRoot, { action: "status", run_id, ack: "failed f1 unreadable" });
  assert.deepEqual((await run(matterRoot, { action: "next", run_id })).close, [{ ref: "f1", contract: "facts" }]);
  const out = await byRef(matterRoot, run_id, "f1", "facts", []);
  assert.deepEqual([out.refused, out.ask.map((a) => a.kind)], ["needs_answer", ["category"]]);
  const end = await run(matterRoot, { action: "next", run_id });
  assert.deepEqual([end.dispatch, end.write, end.close, end.running], [[], [], [], 0], "nothing left to do but answer");
  assert.deepEqual(end.asked, [{ ref: "f1", contract: "facts", result_ids: [] }]);
  assert.equal((await byRef(matterRoot, run_id, "f1", "facts", [], { category: "court" })).outcome, "written");
  assert.equal((await run(matterRoot, { action: "next", run_id })).asked, undefined);
});

test("an exhibit that fails twice says so, and a call whose every exhibit rolled back is a write (N12)", async (t) => {
  const { matterRoot, caseDataDir } = fixture(t);
  const doc = file(matterRoot, "2026-03-01 AFF Quill.pdf", pdfBytes(AFF_PAGES));
  const { run_id } = await run(matterRoot, { action: "begin", mode: "attended" });
  await run(matterRoot, { action: "next", run_id, routes: [{ ...doc, kind: "affidavit" }] });
  await byRef(matterRoot, run_id, "f1", "affidavit_body", [(await stage(BODY())).result_id]);
  await run(matterRoot, { action: "next", run_id });
  holdPending(caseDataDir, "A");
  const a = await byRef(matterRoot, run_id, "f1", "affidavit_exhibits", [(await stage(PROVING("A"))).result_id]);
  assert.equal(a.outcome, "written", "an exhibit recorded for review is a write");
  assert.match(a.report.at(-1), /will be read again/);
  await run(matterRoot, { action: "next", run_id });
  const again = await byRef(matterRoot, run_id, "f1", "affidavit_exhibits", [(await stage(PROVING("A"))).result_id]);
  assert.equal(again.outcome, "written", JSON.stringify(again));
  assert.match(again.report.at(-1), /^Exhibit A could not be read after two attempts/);
});

test("a privileged informant's answer naming no privileged document is asked again; 0 means none on file (K-M3)", async (t) => {
  const { matterRoot, caseDataDir } = fixture(t);
  const doc = file(matterRoot, "2026-03-01 AFF Quill.pdf", pdfBytes(AFF_PAGES));
  const { run_id } = await run(matterRoot, { action: "begin", mode: "attended" });
  await run(matterRoot, { action: "next", run_id, routes: [{ ...doc, kind: "affidavit" }] });
  const body = await stage(BODY({ body_facts: [{ source_locator: "para. 3", description: "The loan was not repaid.", category: "breach", date_of_fact: null,
    basis_of_knowledge: "information_and_belief", informant: "Her lawyer", informant_privileged: true }] }));
  const first = await byRef(matterRoot, run_id, "f1", "affidavit_body", [body.result_id]);
  assert.deepEqual(first.ask.map((a) => [a.kind, a.ref]), [["privileged_informant", "para. 3"]]);
  const wrong = await byRef(matterRoot, run_id, "f1", "affidavit_body", [body.result_id], { informants: { "para. 3": 999 } });
  assert.deepEqual(wrong.ask.map((a) => [a.kind, a.ref]), [["privileged_informant", "para. 3"]], JSON.stringify(wrong));
  const none = await byRef(matterRoot, run_id, "f1", "affidavit_body", [body.result_id], { informants: { "para. 3": 0 } });
  assert.deepEqual(none.ask, []);
  sql(caseDataDir, "INSERT INTO privileged_sources (source_id, category, title) VALUES (5, 'solicitor_client', 'Call note')", "privileged");
  const right = await byRef(matterRoot, run_id, "f1", "affidavit_body", [body.result_id], { informants: { "para. 3": 5 } });
  assert.deepEqual(right.ask, []);
  assert.deepEqual(sql(caseDataDir, "SELECT source_id, source_note FROM fact_provenance", "privileged"), [{ source_id: 5, source_note: "INFORMANT: Her lawyer" }]);
  assert.deepEqual(sql(caseDataDir, "SELECT informant FROM facts"), [{ informant: null }]);
});

test("an unattended other copy that matches no title is reported, not dropped (K-M13)", async (t) => {
  const { matterRoot } = fixture(t);
  const doc = file(matterRoot, "nocc.pdf", pdfBytes(["Claim"]));
  const { run_id } = await run(matterRoot, { action: "begin", mode: "unattended" });
  await run(matterRoot, { action: "next", run_id, routes: [{ ...doc, kind: "facts" }] });
  const { result_id } = await stage(FACTS("f1", { flags: [{ kind: "other_copy", ref: "f1", detail: "A Title Not On File" }] }));
  const out = await byRef(matterRoot, run_id, "f1", "facts", [result_id]);
  assert.equal(out.outcome, "written");
  assert.ok(out.report.some((l) => l.includes('another copy of "A Title Not On File"')), JSON.stringify(out.report));
});

test("page images of a displaced run are removed at the next run's end, and a swept run's with it (N13)", async (t) => {
  const { matterRoot, runRoot } = fixture(t);
  const doc = file(matterRoot, "one.pdf", pdfBytes(["One"]));
  const first = await run(matterRoot, { action: "begin", mode: "attended" });
  const { dispatch } = await run(matterRoot, { action: "next", run_id: first.run_id, routes: [{ ...doc, kind: "facts" }] });
  const images = join(matterRoot, "0. CASE DATA", "Page images", `ingest-${dispatch[0].dispatch_id}`);
  mkdirSync(images, { recursive: true });
  const lease = join(runDir(runRoot), "lease.json");
  const stale = (ms) => writeFileSync(lease, JSON.stringify({ ...JSON.parse(readFileSync(lease, "utf-8")), heartbeat: new Date(Date.now() - ms).toISOString() }));
  stale(61 * 60_000); // abandoned: a plain begin takes it over
  const second = await run(matterRoot, { action: "begin", mode: "attended" });
  assert.equal(existsSync(images), true);
  await run(matterRoot, { action: "end", run_id: second.run_id });
  assert.equal(existsSync(images), false, "the displaced run's images went with the run that ended");

  const third = await run(matterRoot, { action: "begin", mode: "attended" });
  const later = await run(matterRoot, { action: "next", run_id: third.run_id });
  assert.deepEqual(later.dispatch, []);
  mkdirSync(images, { recursive: true });
  stale(31 * 24 * 60 * 60_000); // never ended, silent for over 30 days
  await run(matterRoot, { action: "begin", mode: "attended" });
  assert.equal(existsSync(images), false, "the sweep removes a run's images with its folder");
});

test("a second file with the same bytes is read once, and the practitioner is told (N15)", async (t) => {
  const { matterRoot } = fixture(t);
  const one = file(matterRoot, "one.pdf", pdfBytes(["Same"]));
  const copy = file(matterRoot, "copy of one.pdf", pdfBytes(["Same"]));
  const { run_id } = await run(matterRoot, { action: "begin", mode: "attended" });
  const out = await run(matterRoot, { action: "next", run_id, routes: [{ ...one, kind: "facts" }, { ...copy, kind: "facts" }] });
  assert.deepEqual(out.routed, ["f1", "f1"]);
  assert.deepEqual(out.report, ["copy of one.pdf is the same file as one.pdf, so it is read once."]);
});
