// The ingest run's recovery and refusal paths (ingest orchestrator spec §2.3, §2.4, §9 R4-R10): an
// exhibit that fails a constraint, a route that cannot be read, a file routed twice, an expired or
// stale staged result, a resume, a plugin update, the boundary scan, the procedural history entry,
// the reply cap and privileged wording left in staging. Every name is invented.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs, { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
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

/** The newest run folder of the matter's folder. */
const runDir = (runRoot) => {
  const key = join(runRoot, readdirSync(runRoot).find((n) => /^[0-9a-f]{16}$/.test(n)));
  const started = (name) => {
    try {
      return Date.parse(JSON.parse(readFileSync(join(key, name, "lease.json"), "utf-8")).started);
    } catch {
      return -1;
    }
  };
  return join(key, readdirSync(key).sort((a, b) => started(b) - started(a))[0]);
};
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

/** Exhibit `letter` held already as listed and recorded failed: a reading that carries a privilege
 *  signal would hold it pending, which the sources check refuses for a listed row, so its statement
 *  group rolls back alone. */
const holdListed = (caseDataDir, letter) => sql(caseDataDir, `INSERT INTO sources (category, title, parent_source_id, ingestion_status, listed)
  SELECT category, 'Exhibit ${letter}', source_id, 'failed', 1 FROM sources WHERE parent_source_id IS NULL`);
const SIGNALLED = (letter) => ({ ...EXHIBIT(letter), flags: [{ kind: "privilege_signal", ref: `f1:${letter}` }] });
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

  holdListed(caseDataDir, "B");
  const a = await stage(EXHIBIT("A"));
  const b = await stage(SIGNALLED("B"));
  await run(matterRoot, { action: "status", run_id, ack: `ok f1:A ${a.result_id} 10` });
  await run(matterRoot, { action: "status", run_id, ack: `ok f1:B ${b.result_id} 10` });
  const out = await byRef(matterRoot, run_id, "f1", "affidavit_exhibits", [a.result_id, b.result_id]);
  assert.equal(out.outcome, "written", JSON.stringify(out));
  assert.deepEqual(out.items.map((i) => i.ref), ["B"]);
  assert.equal(existsSync(stagedPath(b.result_id)), false, "a rolled-back reading that signalled privilege leaves staging (round 5, 3)");
  assert.ok(out.report.some((l) => /^Exhibit B could not be recorded/.test(l)), "a fixed line names the exhibit");
  assert.deepEqual(sql(caseDataDir, "SELECT count(*) AS n FROM facts WHERE description = 'Exhibit B says so.'"), [{ n: 0 }], "B's group left nothing");
  assert.deepEqual(sql(caseDataDir, "SELECT title, ingestion_status FROM sources WHERE parent_source_id IS NOT NULL ORDER BY source_id")[1],
    { title: "Exhibit A — Document A", ingestion_status: "complete" });

  const again = await run(matterRoot, { action: "next", run_id });
  assert.deepEqual(again.dispatch.map((d) => d.ref), ["f1:B"], "the failed exhibit is read once more (R4)");
  assert.deepEqual([again.write, again.close], [[], []]);
  sql(caseDataDir, "UPDATE sources SET listed = 0 WHERE title = 'Exhibit B'"); // the practitioner fixes the row
  const b2 = await stage(PROVING("B"));
  assert.equal((await byRef(matterRoot, run_id, "f1:B", "affidavit_exhibits", [b2.result_id])).outcome, "written");
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
  assert.deepEqual(status.runs.map((r) => r.run_id), [run_id], "status names the unfinished run");
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
  holdListed(caseDataDir, "A");
  const a = await byRef(matterRoot, run_id, "f1:A", "affidavit_exhibits", [(await stage(SIGNALLED("A"))).result_id]);
  assert.equal(a.outcome, "written", "an exhibit recorded for review is a write");
  assert.match(a.report.at(-1), /will be read again/);
  await run(matterRoot, { action: "next", run_id });
  const again = await byRef(matterRoot, run_id, "f1:A", "affidavit_exhibits", [(await stage(SIGNALLED("A"))).result_id]);
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

test("page images of a stale run stay while it can be resumed, and go when its folder is swept (N13)", async (t) => {
  const { matterRoot, runRoot } = fixture(t);
  const doc = file(matterRoot, "one.pdf", pdfBytes(["One"]));
  const first = await run(matterRoot, { action: "begin", mode: "attended" });
  const { dispatch } = await run(matterRoot, { action: "next", run_id: first.run_id, routes: [{ ...doc, kind: "facts" }] });
  const images = join(matterRoot, "0. CASE DATA", "Page images", `ingest-${dispatch[0].dispatch_id}`);
  mkdirSync(images, { recursive: true });
  const lease = join(runDir(runRoot), "lease.json");
  const stale = (ms) => writeFileSync(lease, JSON.stringify({ ...JSON.parse(readFileSync(lease, "utf-8")), heartbeat: new Date(Date.now() - ms).toISOString() }));
  stale(61 * 60_000); // stale, and its reader never came back: it can still be resumed
  const second = await run(matterRoot, { action: "begin", mode: "attended" });
  await run(matterRoot, { action: "end", run_id: second.run_id });
  assert.equal(existsSync(images), true, "the stale run still holds its file");

  const third = await run(matterRoot, { action: "begin", mode: "attended" });
  const later = await run(matterRoot, { action: "next", run_id: third.run_id });
  assert.deepEqual(later.dispatch, []);
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

// ---------------------------------------------------------------- third review (N-1 to N-13)

/** Every delete under a matter's Page images folder fails as a sync client holding the files makes
 *  it fail. Returns the undo. */
function busyImages() {
  const saved = { rmSync: fs.rmSync, rmdirSync: fs.rmdirSync, unlinkSync: fs.unlinkSync };
  for (const [name, real] of Object.entries(saved)) {
    fs[name] = (path, ...rest) => {
      if (String(path).includes("Page images")) throw Object.assign(new Error("resource busy or locked"), { code: "EBUSY" });
      return real(path, ...rest);
    };
  }
  syncBuiltinESMExports();
  return () => {
    Object.assign(fs, saved);
    syncBuiltinESMExports();
  };
}

const SCAN = () => imagePdfBytes({ pages: [{ content: drawImage(0, 0, 612, 792), mediaBox: [0, 0, 612, 792] }] });

test("a dispatch whose inputs meet a fault of this computer is void, never left running (N-1)", async (t) => {
  const { matterRoot } = fixture(t);
  const doc = file(matterRoot, "scan.pdf", SCAN());
  // The bridged page images cannot be written: their folder's place is taken by a file.
  mkdirSync(join(matterRoot, "0. CASE DATA"), { recursive: true });
  writeFileSync(join(matterRoot, "0. CASE DATA", "Page images"), "not a folder");
  const { run_id } = await run(matterRoot, { action: "begin", mode: "attended" });
  await assert.rejects(run(matterRoot, { action: "next", run_id, bridged: true, routes: [{ ...doc, kind: "facts" }] }));
  unlinkSync(join(matterRoot, "0. CASE DATA", "Page images"));
  const again = await run(matterRoot, { action: "next", run_id });
  assert.deepEqual(again.dispatch.map((d) => d.ref), ["f1"], "the item is dispatched again, not counted as running");
  assert.equal(again.running, 1);
});

test("the firm's name is read only for a letter the firm may have sent, and a bad profile fails no write (N-2)", async (t) => {
  const { matterRoot, caseDataDir } = fixture(t);
  const config = join(caseDataDir, "..", "..", "probanda.json");
  writeFileSync(config, JSON.stringify({ version: 1 })); // no case_data_root
  process.env.COCLERK_CONFIG_PATH = config;
  const aff = file(matterRoot, "2026-03-01 AFF Quill.pdf", pdfBytes(AFF_PAGES));
  const letter = file(matterRoot, "2026-03-02 letter.pdf", pdfBytes(["Letter"]));
  const { run_id } = await run(matterRoot, { action: "begin", mode: "attended" });
  await run(matterRoot, { action: "next", run_id, routes: [{ ...aff, kind: "affidavit" }, { ...letter, kind: "facts", category: "correspondence" }] });
  const body = await byRef(matterRoot, run_id, "f1", "affidavit_body", [(await stage(BODY())).result_id]);
  assert.equal(body.outcome, "written", JSON.stringify(body));
  const sent = await stage(FACTS("f2", { flags: [{ kind: "outgoing_letter", ref: "f2", detail: "Quill Law LLP" }],
    document: { ...FACTS("f2").document, category: "correspondence" } }));
  const out = await byRef(matterRoot, run_id, "f2", "facts", [sent.result_id]);
  assert.equal(out.outcome, "written", JSON.stringify(out));
  assert.ok(out.report.some((l) => /was not checked/.test(l)), JSON.stringify(out.report));
});

test("privileged wording stays staged after a call error or a lost lease, so the call can be made again (N-3)", async (t) => {
  const { matterRoot } = fixture(t);
  const { run_id } = await run(matterRoot, { action: "begin", mode: "attended" });
  const memo = { file_path: "3. CLIENT\\memo.pdf", file_hash: "e".repeat(64) };
  const { result_id } = await stage({ contract: "privileged", contract_version: 2, ref: "memo", document: { title: "Memo", category: "solicitor_client" },
    facts: [{ source_locator: "p1", description: "The client asked.", category: null, date_of_fact: null }] });
  const write = (store, id = run_id) => callTool({}, "matter_data__ingest_result", { matter_root: matterRoot, run_id: id, document: { ...memo, store }, contract: "privileged", result_ids: [result_id], answers: { privilege: "yes" } });
  await assert.rejects(write("main"), /store/);
  assert.equal(existsSync(stagedPath(result_id)), true, "a call the session corrects keeps it");
  assert.equal((await write("privileged", randomUUID())).refused, "lease_lost");
  assert.equal(existsSync(stagedPath(result_id)), true, "a lost lease keeps it for the run that resumes");
  assert.equal((await write("privileged")).outcome, "written");
  assert.equal(existsSync(stagedPath(result_id)), false);
});

/** An affidavit whose body is written and whose exhibits A and B are dispatched. */
async function exhibitsDispatched(matterRoot) {
  const doc = file(matterRoot, "2026-03-01 AFF Quill.pdf", pdfBytes(AFF_PAGES));
  const { run_id } = await run(matterRoot, { action: "begin", mode: "attended" });
  await run(matterRoot, { action: "next", run_id, routes: [{ ...doc, kind: "affidavit" }] });
  await byRef(matterRoot, run_id, "f1", "affidavit_body", [(await stage(BODY())).result_id]);
  assert.deepEqual((await run(matterRoot, { action: "next", run_id })).dispatch.map((d) => d.ref), ["f1:A", "f1:B"]);
  return run_id;
}

test("a staged ref that is not the reply's is refused under the reply's item (N-4)", async (t) => {
  const { matterRoot, caseDataDir } = fixture(t);
  const run_id = await exhibitsDispatched(matterRoot);
  // B's extractor staged its result as the body's: the body must not be sent back to be read again.
  const wrong = await stage({ ...EXHIBIT("B"), ref: "f1" });
  assert.equal((await byRef(matterRoot, run_id, "f1:B", "affidavit_exhibits", [wrong.result_id])).refused, "contract_mismatch");
  // A's extractor staged it under a letter it was not given.
  const lower = await stage({ ...EXHIBIT("A"), ref: "f1:a" });
  assert.equal((await byRef(matterRoot, run_id, "f1:A", "affidavit_exhibits", [lower.result_id])).refused, "contract_mismatch");
  const again = await run(matterRoot, { action: "next", run_id });
  assert.deepEqual(again.dispatch.map((d) => d.ref).sort(), ["f1:A", "f1:B"], "each is read once more; the body is not");
  assert.equal(sql(caseDataDir, "SELECT count(*) AS n FROM sources WHERE parent_source_id IS NOT NULL")[0].n, 0);
});

test("a sweep that cannot delete page images in use leaves them for later, and begin goes on (N-5)", async (t) => {
  const { matterRoot, runRoot } = fixture(t);
  const doc = file(matterRoot, "one.pdf", pdfBytes(["One"]));
  const first = await run(matterRoot, { action: "begin", mode: "attended" });
  const { dispatch } = await run(matterRoot, { action: "next", run_id: first.run_id, routes: [{ ...doc, kind: "facts" }] });
  const images = join(matterRoot, "0. CASE DATA", "Page images", `ingest-${dispatch[0].dispatch_id}`);
  mkdirSync(images, { recursive: true });
  const lease = join(runDir(runRoot), "lease.json");
  writeFileSync(lease, JSON.stringify({ ...JSON.parse(readFileSync(lease, "utf-8")), heartbeat: new Date(Date.now() - 31 * 24 * 60 * 60_000).toISOString() }));
  const undo = busyImages();
  let second;
  try {
    second = await run(matterRoot, { action: "begin", mode: "attended" });
  } finally {
    undo();
  }
  assert.equal(second.ok, true, JSON.stringify(second));
  assert.equal(second.report.length, 1);
  assert.equal(existsSync(images), true);
  await run(matterRoot, { action: "begin", mode: "attended" });
  assert.equal(existsSync(images), false, "the next sweep removes them once they are free");
});

test("one bad result in a call fails only its own item (N-9)", async (t) => {
  const { matterRoot } = fixture(t);
  const run_id = await exhibitsDispatched(matterRoot);
  const a = await stage(EXHIBIT("A"));
  const b = await stage({ ...EXHIBIT("B"), ref: "f1:x" }); // staged under an item it was not given
  await run(matterRoot, { action: "status", run_id, ack: `ok f1:A ${a.result_id} 10` });
  await run(matterRoot, { action: "status", run_id, ack: `ok f1:B ${b.result_id} 10` });
  const listed = await run(matterRoot, { action: "next", run_id });
  assert.deepEqual(listed.write, [{ ref: "f1", contract: "affidavit_exhibits", result_ids: [a.result_id, b.result_id] }]);
  assert.equal((await byRef(matterRoot, run_id, "f1", "affidavit_exhibits", [a.result_id, b.result_id])).refused, "contract_mismatch");
  const after = await run(matterRoot, { action: "next", run_id });
  assert.deepEqual(after.dispatch.map((d) => d.ref), ["f1:B"]);
  assert.deepEqual(after.write, [{ ref: "f1", contract: "affidavit_exhibits", result_ids: [a.result_id] }]);
});

test("a Path B document is journaled and listed until it is written, a resume included (N-10, N-11)", async (t) => {
  const { matterRoot } = fixture(t);
  const memo = file(matterRoot, "memo.docx", Buffer.from("a client memo"));
  const { run_id } = await run(matterRoot, { action: "begin", mode: "attended", orchestrator: true });
  const first = await run(matterRoot, { action: "next", run_id, routes: [{ ...memo, kind: "path_b" }] });
  assert.deepEqual([first.routed, first.dispatch, first.path_b], [["f1"], [], [{ ref: "f1", file_path: memo.file_path }]]);
  const resumed = await run(matterRoot, { action: "begin", mode: "attended", resume: run_id });
  assert.deepEqual(resumed.path_b, [{ ref: "f1", file_path: memo.file_path }], "nothing depends on this session's memory");
  const { result_id } = await stage({ contract: "privileged", contract_version: 2, ref: "f1", document: { title: "Memo", category: "solicitor_client" },
    facts: [{ source_locator: "p1", description: "The client asked.", category: null, date_of_fact: null }] });
  const write = () => callTool({}, "matter_data__ingest_result", { matter_root: matterRoot, run_id: resumed.run_id, document: { ref: "f1", store: "privileged" },
    contract: "privileged", result_ids: [result_id], answers: { privilege: "yes" } });
  assert.equal((await write()).outcome, "written");
  assert.equal(existsSync(stagedPath(result_id)), false);
  assert.equal((await write()).outcome, "already_written", "a repeat after a lost reply finds the write (R6)");
  assert.equal((await run(matterRoot, { action: "next", run_id: resumed.run_id })).path_b, undefined);
});

test("end removes only the page images it rendered, and a file in use leaves the run ended with a report (N-12, N-13)", async (t) => {
  const { matterRoot } = fixture(t);
  const doc = file(matterRoot, "one.pdf", pdfBytes(["One"]));
  const first = await run(matterRoot, { action: "begin", mode: "attended" });
  const { dispatch } = await run(matterRoot, { action: "next", run_id: first.run_id, routes: [{ ...doc, kind: "facts" }] });
  const images = join(matterRoot, "0. CASE DATA", "Page images", `ingest-${dispatch[0].dispatch_id}`);
  const pdfDir = join(images, "0123456789abcdef");
  mkdirSync(pdfDir, { recursive: true });
  writeFileSync(join(pdfDir, "page-0001.png"), "png");
  writeFileSync(join(images, "my notes.txt"), "the practitioner's own file");
  const undo = busyImages();
  let ended;
  try {
    ended = await run(matterRoot, { action: "end", run_id: first.run_id });
  } finally {
    undo();
  }
  assert.equal(ended.ok, true, JSON.stringify(ended));
  assert.equal(ended.report.length, 1);
  assert.equal((await run(matterRoot, { action: "status" })).active, false, "the run ended");
  const second = await run(matterRoot, { action: "begin", mode: "attended" });
  await run(matterRoot, { action: "end", run_id: second.run_id });
  assert.equal(existsSync(join(pdfDir, "page-0001.png")), false, "the left images go at the next end");
  assert.equal(existsSync(join(images, "my notes.txt")), true, "a file Probanda did not write stays");
});

// ---------------------------------------------------------------- fourth review (M-1, m-1 to m-7, nits)

/** Makes each of `names` throw `code` for a path `match` accepts, from the `from`th such call on.
 *  Returns the undo. */
function failing(names, match, code, from = 1) {
  const saved = Object.fromEntries(names.map((n) => [n, fs[n]]));
  let seen = 0;
  for (const name of names) {
    fs[name] = (path, ...rest) => {
      if (match(String(path)) && ++seen >= from) throw Object.assign(new Error(`${code}: made by the test`), { code });
      return saved[name](path, ...rest);
    };
  }
  syncBuiltinESMExports();
  return () => {
    Object.assign(fs, saved);
    syncBuiltinESMExports();
  };
}

const DAYS_31 = 31 * 24 * 60 * 60_000;
const age = (lease, ms) => writeFileSync(lease, JSON.stringify({ ...JSON.parse(readFileSync(lease, "utf-8")), heartbeat: new Date(Date.now() - ms).toISOString() }));
const journalOf = (runRoot) => readFileSync(join(runDir(runRoot), "journal.jsonl"), "utf-8").trim().split("\n").map((l) => JSON.parse(l));

test("a sweep error of any kind, a cut-short lease included, leaves that folder for later, said once, and begin goes on (M-1)", async (t) => {
  const { matterRoot, runRoot } = fixture(t);
  const doc = file(matterRoot, "one.pdf", pdfBytes(["One"]));
  const first = await run(matterRoot, { action: "begin", mode: "attended" });
  const { dispatch } = await run(matterRoot, { action: "next", run_id: first.run_id, routes: [{ ...doc, kind: "facts" }] });
  const pdfDir = join(matterRoot, "0. CASE DATA", "Page images", `ingest-${dispatch[0].dispatch_id}`, "0123456789abcdef");
  mkdirSync(pdfDir, { recursive: true });
  writeFileSync(join(pdfDir, "page-0001.png"), "png");
  age(join(runDir(runRoot), "lease.json"), DAYS_31);
  // Another matter's run folder, whose lease.json was cut short.
  mkdirSync(join(runRoot, "fedcba9876543210"));
  writeFileSync(join(runRoot, "fedcba9876543210", "lease.json"), '{"run_id": "x", "sta');
  const undo = failing(["unlinkSync"], (p) => p.includes("Page images"), "EIO");
  let second;
  try {
    second = await run(matterRoot, { action: "begin", mode: "attended" });
  } finally {
    undo();
  }
  assert.equal(second.ok, true, JSON.stringify(second));
  assert.equal(second.report.length, 2, JSON.stringify(second.report));
  assert.equal(existsSync(join(pdfDir, "page-0001.png")), true, "left for a later sweep");
  const third = await run(matterRoot, { action: "begin", mode: "attended", orchestrator: true });
  assert.equal(third.ok, true, JSON.stringify(third));
  assert.equal(third.report, undefined, "each folder left is said once");
});

test("a privileged call's shape is checked first, keeping its wording (m-1)", async (t) => {
  const { matterRoot, caseDataDir } = fixture(t);
  const { run_id } = await run(matterRoot, { action: "begin", mode: "attended" });
  const memo = { file_path: "3. CLIENT\\memo.pdf", file_hash: "f".repeat(64) };
  const object = () => stage({ contract: "privileged", contract_version: 2, ref: "memo", document: { title: "Memo", category: "solicitor_client" },
    facts: [{ source_locator: "p1", description: "The client asked.", category: null, date_of_fact: null }] });
  const one = await object();
  const two = await object();
  const write = (result_ids, privilege, store) => callTool({}, "matter_data__ingest_result", { matter_root: matterRoot, run_id, document: { ...memo, store },
    contract: "privileged", result_ids, answers: { privilege } });
  await assert.rejects(write([one.result_id], "maybe", "main"), /must be one of: yes, no, unclear/);
  await assert.rejects(write([one.result_id, two.result_id], "yes", "privileged"), /one result/);
  assert.deepEqual([existsSync(stagedPath(one.result_id)), existsSync(stagedPath(two.result_id))], [true, true], "the wording is kept for the corrected call");
  assert.equal((await write([one.result_id], "yes", "privileged")).outcome, "written");
  assert.equal(sql(caseDataDir, "SELECT count(*) AS n FROM privileged_sources", "privileged")[0].n, 1);
});

test("a result is written only under the item its reply or its dispatch line names (m-2)", async (t) => {
  const { matterRoot } = fixture(t);
  const run_id = await exhibitsDispatched(matterRoot);
  const a = await stage(EXHIBIT("A"));
  const b = await stage(EXHIBIT("B"));
  await assert.rejects(byRef(matterRoot, run_id, "f1", "affidavit_exhibits", [a.result_id, b.result_id]), /acknowledged/);
  await assert.rejects(byRef(matterRoot, run_id, "f1", "affidavit_exhibits", [a.result_id]), /dispatch line/);
  await assert.rejects(run(matterRoot, { action: "status", run_id, ack: `ok f1:C ${a.result_id} 10` }), /dispatched/);
  assert.equal((await byRef(matterRoot, run_id, "f1:A", "affidavit_exhibits", [a.result_id])).outcome, "written");
  await run(matterRoot, { action: "status", run_id, ack: `ok f1:B ${b.result_id} 10` });
  assert.equal((await byRef(matterRoot, run_id, "f1", "affidavit_exhibits", [b.result_id])).outcome, "written");
});

test("a document the renderer cannot hold fails alone, and the run goes on (m-3)", async (t) => {
  const { matterRoot, runRoot } = fixture(t);
  const big = file(matterRoot, "big.pdf", pdfBytes(["Big"]));
  const good = file(matterRoot, "good.pdf", pdfBytes(["Good"]));
  const { run_id } = await run(matterRoot, { action: "begin", mode: "attended" });
  // The route check reads big.pdf once; every later read is too large for the renderer's memory.
  let reads = 0;
  const saved = fs.readFileSync;
  fs.readFileSync = (path, ...rest) => (String(path).endsWith("big.pdf") && ++reads > 1 ? { length: 0xfffffff0 } : saved(path, ...rest));
  syncBuiltinESMExports();
  let out;
  try {
    out = await run(matterRoot, { action: "next", run_id, routes: [{ ...big, kind: "facts" }, { ...good, kind: "facts" }] });
  } finally {
    fs.readFileSync = saved;
    syncBuiltinESMExports();
  }
  assert.deepEqual(out.dispatch.map((d) => d.ref), ["f2"], JSON.stringify(out));
  assert.deepEqual(journalOf(runRoot).filter((e) => e.event === "ack").map((e) => [e.ref, e.ok]), [["f1", false]]);
});

test("a Path B document refused for good leaves the path_b list (m-4)", async (t) => {
  const { matterRoot, caseDataDir } = fixture(t);
  const memo = file(matterRoot, "memo.docx", Buffer.from("a client memo"));
  const { run_id } = await run(matterRoot, { action: "begin", mode: "attended", orchestrator: true });
  await run(matterRoot, { action: "next", run_id, routes: [{ ...memo, kind: "path_b" }] });
  sql(caseDataDir, `INSERT INTO sources (category, title, file_hash) VALUES ('work_product', 'Memo', '${memo.file_hash}')`);
  const { result_id } = await stage({ contract: "privileged", contract_version: 2, ref: "f1", document: { title: "Memo", category: "solicitor_client" },
    facts: [{ source_locator: "p1", description: "The client asked.", category: null, date_of_fact: null }] });
  const out = await callTool({}, "matter_data__ingest_result", { matter_root: matterRoot, run_id, document: { ref: "f1", store: "privileged" },
    contract: "privileged", result_ids: [result_id], answers: { privilege: "yes" } });
  assert.equal(out.refused, "store_change", JSON.stringify(out));
  assert.equal(out.report.length, 1, "the practitioner is told it is set aside");
  assert.equal((await run(matterRoot, { action: "next", run_id })).path_b, undefined);
});

test("end ends the run whatever stops its cleanup, says so, and a later end removes a five-digit page (m-5, N-13)", async (t) => {
  const { matterRoot } = fixture(t);
  const doc = file(matterRoot, "one.pdf", pdfBytes(["One"]));
  const first = await run(matterRoot, { action: "begin", mode: "attended" });
  const { dispatch } = await run(matterRoot, { action: "next", run_id: first.run_id, routes: [{ ...doc, kind: "facts" }] });
  const pdfDir = join(matterRoot, "0. CASE DATA", "Page images", `ingest-${dispatch[0].dispatch_id}`, "0123456789abcdef");
  mkdirSync(pdfDir, { recursive: true });
  writeFileSync(join(pdfDir, "page-10000.png"), "png");
  const undo = failing(["unlinkSync", "rmSync"], (p) => p.includes("Page images") || p.endsWith("dispatches"), "EIO");
  let ended;
  try {
    ended = await run(matterRoot, { action: "end", run_id: first.run_id });
  } finally {
    undo();
  }
  assert.equal(ended.ok, true, JSON.stringify(ended));
  assert.ok(ended.report.length >= 1);
  assert.equal((await run(matterRoot, { action: "status" })).active, false, "the run ended");
  const second = await run(matterRoot, { action: "begin", mode: "attended" });
  await run(matterRoot, { action: "end", run_id: second.run_id });
  assert.equal(existsSync(join(pdfDir, "page-10000.png")), false);
});

test("a plain begin never drops an unfinished run silently: the orchestrator is offered it, a single-document ingest is told (m-6, n-2)", async (t) => {
  const { matterRoot, runRoot } = fixture(t);
  const doc = file(matterRoot, "one.pdf", pdfBytes(["One"]));
  const d1 = await run(matterRoot, { action: "begin", mode: "attended" });
  await run(matterRoot, { action: "next", run_id: d1.run_id, routes: [{ ...doc, kind: "facts" }] });
  const { result_id } = await stage(FACTS("f1"));
  await run(matterRoot, { action: "status", run_id: d1.run_id, ack: `ok f1 ${result_id} 100` });
  const lease = join(runDir(runRoot), "lease.json");
  age(lease, 61 * 60_000);
  const orch = await run(matterRoot, { action: "begin", mode: "attended", orchestrator: true });
  assert.deepEqual([orch.ok, orch.refused, orch.run_id], [false, "run_unfinished", d1.run_id]);
  const resumed = await run(matterRoot, { action: "begin", mode: "attended", resume: d1.run_id, orchestrator: true });
  assert.deepEqual(resumed.next, [{ ref: "f1", contract: "facts", result_ids: [result_id] }]);
  assert.equal(JSON.parse(readFileSync(lease, "utf-8")).orchestrator, true, "the orchestrator's resume makes it its run (n-2)");
  age(lease, 61 * 60_000);
  const single = await run(matterRoot, { action: "begin", mode: "attended" });
  assert.equal(single.ok, true, JSON.stringify(single));
  assert.equal(single.report.length, 1, "a single-document ingest goes on, and is told");
});

test("page images left in use are said once, not at every begin (n-4)", async (t) => {
  const { matterRoot, runRoot } = fixture(t);
  const doc = file(matterRoot, "one.pdf", pdfBytes(["One"]));
  const first = await run(matterRoot, { action: "begin", mode: "attended" });
  const { dispatch } = await run(matterRoot, { action: "next", run_id: first.run_id, routes: [{ ...doc, kind: "facts" }] });
  const pdfDir = join(matterRoot, "0. CASE DATA", "Page images", `ingest-${dispatch[0].dispatch_id}`, "0123456789abcdef");
  mkdirSync(pdfDir, { recursive: true });
  writeFileSync(join(pdfDir, "page-0001.png"), "png");
  const { result_id } = await stage(FACTS("f1"));
  await run(matterRoot, { action: "status", run_id: first.run_id, ack: `ok f1 ${result_id} 100` });
  age(join(runDir(runRoot), "lease.json"), DAYS_31);
  const undo = busyImages();
  let one, two;
  try {
    one = await run(matterRoot, { action: "begin", mode: "attended", orchestrator: true });
    two = await run(matterRoot, { action: "begin", mode: "attended", orchestrator: true });
  } finally {
    undo();
  }
  assert.deepEqual([one.refused, one.report?.length], ["run_unfinished", 1]);
  assert.deepEqual([two.refused, two.report], ["run_unfinished", undefined]);
});

test("each bad result in a call is failed with its own reason (N-9)", async (t) => {
  const { matterRoot, runRoot } = fixture(t);
  const run_id = await exhibitsDispatched(matterRoot);
  const gone = randomUUID();
  const b = await stage({ ...EXHIBIT("B"), ref: "f1:x" });
  await run(matterRoot, { action: "status", run_id, ack: `ok f1:A ${gone} 10` });
  await run(matterRoot, { action: "status", run_id, ack: `ok f1:B ${b.result_id} 10` });
  assert.equal((await byRef(matterRoot, run_id, "f1", "affidavit_exhibits", [gone, b.result_id])).refused, "unknown_result");
  assert.deepEqual(journalOf(runRoot).filter((e) => e.event === "ack" && e.ok === false).map((e) => [e.ref, e.reason]),
    [["f1:A", "unknown_result"], ["f1:B", "contract_mismatch"]]);
});

test("a firm profile this computer cannot open fails no write (N-2)", async (t) => {
  const { matterRoot, caseDataDir } = fixture(t);
  const root = join(caseDataDir, "..");
  mkdirSync(join(root, "_practice", "firm"), { recursive: true });
  writeFileSync(join(root, "_practice", "firm", "firm.json"), JSON.stringify({ firm_name: "Quill Law LLP" }));
  const config = join(root, "..", "probanda.json");
  writeFileSync(config, JSON.stringify({ version: 1, case_data_root: root }));
  process.env.COCLERK_CONFIG_PATH = config;
  const letter = file(matterRoot, "2026-03-02 letter.pdf", pdfBytes(["Letter"]));
  const { run_id } = await run(matterRoot, { action: "begin", mode: "attended" });
  await run(matterRoot, { action: "next", run_id, routes: [{ ...letter, kind: "facts", category: "correspondence" }] });
  const sent = await stage(FACTS("f1", { flags: [{ kind: "outgoing_letter", ref: "f1", detail: "Quill Law LLP" }],
    document: { ...FACTS("f1").document, category: "correspondence" } }));
  const undo = failing(["readFileSync"], (p) => p.endsWith("firm.json"), "EACCES");
  let out;
  try {
    out = await byRef(matterRoot, run_id, "f1", "facts", [sent.result_id]);
  } finally {
    undo();
  }
  assert.equal(out.outcome, "written", JSON.stringify(out));
  assert.ok(out.report.some((l) => /was not checked/.test(l)), JSON.stringify(out.report));
});

test("a fault in next is kept when its dispatches cannot be recorded as void (n-5)", async (t) => {
  const { matterRoot } = fixture(t);
  const doc = file(matterRoot, "scan.pdf", SCAN());
  mkdirSync(join(matterRoot, "0. CASE DATA"), { recursive: true });
  writeFileSync(join(matterRoot, "0. CASE DATA", "Page images"), "not a folder");
  const { run_id } = await run(matterRoot, { action: "begin", mode: "attended" });
  // The route and the dispatch are journaled; the void record that follows the fault is not.
  const undo = failing(["appendFileSync"], (p) => p.endsWith("journal.jsonl"), "EIO", 3);
  try {
    await assert.rejects(run(matterRoot, { action: "next", run_id, bridged: true, routes: [{ ...doc, kind: "facts" }] }),
      (err) => err.code !== "EIO" && /could not be recorded/.test(err.message));
  } finally {
    undo();
  }
});

test("a failed exhibit already held pending is handled as pending when read again without a signal (m-7)", async (t) => {
  const { matterRoot, caseDataDir } = fixture(t);
  const run_id = await exhibitsDispatched(matterRoot);
  sql(caseDataDir, `INSERT INTO sources (category, title, parent_source_id, ingestion_status, verified, privilege_status)
    SELECT category, 'Exhibit A', source_id, 'failed', 2, 'pending' FROM sources WHERE parent_source_id IS NULL`);
  const a = await stage(PROVING("A"));
  const out = await byRef(matterRoot, run_id, "f1:A", "affidavit_exhibits", [a.result_id]);
  assert.equal(out.outcome, "written", JSON.stringify(out));
  assert.deepEqual(out.ask.map((x) => [x.kind, x.ref]), [["privilege", "A"]]);
  assert.equal(existsSync(stagedPath(a.result_id)), false, "its wording waits for no 7-day window");
  assert.equal(sql(caseDataDir, "SELECT count(*) AS n FROM evidence_links")[0].n, 0);
});

// ---------------------------------------------------------------- fifth review (3, 4, 6, 7)

test("a signalled re-reading of an exhibit on file with no privilege hold says its privilege was not decided again (round 5, 4)", async (t) => {
  const { matterRoot, caseDataDir } = fixture(t);
  const run_id = await exhibitsDispatched(matterRoot);
  sql(caseDataDir, `INSERT INTO sources (category, title, parent_source_id, ingestion_status, verified)
    SELECT category, 'Exhibit A', source_id, 'complete', 0 FROM sources WHERE parent_source_id IS NULL`);
  const out = await byRef(matterRoot, run_id, "f1:A", "affidavit_exhibits", [(await stage(SIGNALLED("A"))).result_id]);
  assert.equal(out.outcome, "written", JSON.stringify(out));
  assert.deepEqual(out.ask, []);
  assert.ok(out.report.some((l) => /^Exhibit A may be privileged/.test(l) && /not decided again/.test(l)), JSON.stringify(out.report));
});

test("privilege questions the reply's cap left out are asked when the write is repeated (round 5, 6)", async (t) => {
  const { matterRoot } = fixture(t);
  const pages = ["Affidavit", "Body 2", ...["A", "B", "C", "D"].flatMap((x) => [`Exhibit ${x} stamp`, `${x} content`])];
  const doc = file(matterRoot, "2026-03-01 AFF Quill.pdf", pdfBytes(pages));
  const { run_id } = await run(matterRoot, { action: "begin", mode: "attended" });
  await run(matterRoot, { action: "next", run_id, routes: [{ ...doc, kind: "affidavit" }] });
  const inventory = ["A", "B", "C", "D"].map((letter, i) => ({ letter, description: letter, referencing_locator: "para. 2", page_start: 3 + 2 * i, page_end: 4 + 2 * i }));
  await byRef(matterRoot, run_id, "f1", "affidavit_body", [(await stage(BODY({ exhibit_inventory: inventory }))).result_id]);
  assert.deepEqual((await run(matterRoot, { action: "next", run_id })).dispatch.map((d) => d.ref), ["f1:A", "f1:B", "f1:C", "f1:D"]);
  const ids = [];
  for (const letter of ["A", "B", "C", "D"]) {
    const { result_id } = await stage(SIGNALLED(letter));
    await run(matterRoot, { action: "status", run_id, ack: `ok f1:${letter} ${result_id} 10` });
    ids.push(result_id);
  }
  const first = await byRef(matterRoot, run_id, "f1", "affidavit_exhibits", ids);
  assert.equal(first.outcome, "written", JSON.stringify(first));
  assert.ok(first.dropped > 0, JSON.stringify(first));
  const repeat = await byRef(matterRoot, run_id, "f1", "affidavit_exhibits", ids);
  assert.deepEqual([...first.ask, ...repeat.ask].map((a) => [a.kind, a.ref]), ["A", "B", "C", "D"].map((x) => ["privilege", x]), JSON.stringify(repeat));
  assert.deepEqual(ids.map((id) => existsSync(stagedPath(id))), [false, false, false, false], "each reading leaves once its question is asked");
});

test("end deletes the privileged wording staged for a question still open, and says so (round 5, 7)", async (t) => {
  const { matterRoot } = fixture(t);
  const { run_id } = await run(matterRoot, { action: "begin", mode: "attended", orchestrator: true });
  const memo = { file_path: "3. CLIENT\\memo.pdf", file_hash: "d".repeat(64) };
  const asking = await stage({ contract: "privileged", contract_version: 2, ref: "memo", document: { title: "Memo", category: "solicitor_client" }, facts: [],
    client_instructions: [{ party_name: "Someone Unknown", instructed_by: "Ada Quill", date: "2026-01-02", description: "Settle.", source_locator: "p1", status: "open" }] });
  const out = await callTool({}, "matter_data__ingest_result", { matter_root: matterRoot, run_id, document: { ...memo, store: "privileged" }, contract: "privileged",
    result_ids: [asking.result_id], answers: { privilege: "yes" } });
  assert.equal(out.refused, "needs_answer");
  assert.equal(existsSync(stagedPath(asking.result_id)), true);
  const ended = await run(matterRoot, { action: "end", run_id });
  assert.equal(ended.ok, true, JSON.stringify(ended));
  assert.equal(existsSync(stagedPath(asking.result_id)), false, "no privileged wording waits out the 7-day window");
  assert.equal(ended.report?.length, 1, JSON.stringify(ended));
});

// ---------------------------------------------------------------- sixth review (N1, N2, N3)

const failedAcks = (runRoot, ref) => journalOf(runRoot).filter((e) => e.event === "ack" && e.ref === ref && e.ok === false).length;

for (const [label, make, signalled] of [["rolled back with a privilege signal", SIGNALLED, true], ["failing its contract", (letter) => ({ ...EXHIBIT(letter), exhibit_letter: "C" }), false]]) {
  test(`a repeated exhibit call settles an exhibit that failed in it, ${label}, rather than fail it again (round 6, N1)`, async (t) => {
    const { matterRoot, caseDataDir, runRoot } = fixture(t);
    const run_id = await exhibitsDispatched(matterRoot);
    if (signalled) holdListed(caseDataDir, "B");
    const a = await stage(EXHIBIT("A"));
    const b = await stage(make("B"));
    await run(matterRoot, { action: "status", run_id, ack: `ok f1:A ${a.result_id} 10` });
    await run(matterRoot, { action: "status", run_id, ack: `ok f1:B ${b.result_id} 10` });
    const ids = [a.result_id, b.result_id];
    const first = await byRef(matterRoot, run_id, "f1", "affidavit_exhibits", ids);
    assert.equal(first.outcome, "written", JSON.stringify(first));
    assert.equal(existsSync(stagedPath(b.result_id)), !signalled);
    const repeat = await byRef(matterRoot, run_id, "f1", "affidavit_exhibits", ids);
    assert.notEqual(repeat.outcome, "refused", JSON.stringify(repeat));
    assert.equal(failedAcks(runRoot, "f1:B"), 1, "one extraction, one failure");
    const next = await run(matterRoot, { action: "next", run_id });
    assert.deepEqual([next.dispatch.map((d) => d.ref), next.close], [["f1:B"], []], "read once more, not closed");
    const alone = await byRef(matterRoot, run_id, "f1", "affidavit_exhibits", [b.result_id]);
    assert.deepEqual([alone.outcome, alone.report], ["refused", []], "a call of nothing but settled results writes nothing and says nothing again");
    assert.equal(failedAcks(runRoot, "f1:B"), 1);
  });
}

/** An affidavit with exhibits A to D dispatched, each read by `make` and acknowledged. Returns the run and the ids. */
async function fourExhibits(matterRoot, make) {
  const pages = ["Affidavit", "Body 2", ...["A", "B", "C", "D"].flatMap((x) => [`Exhibit ${x} stamp`, `${x} content`])];
  const doc = file(matterRoot, "2026-03-01 AFF Quill.pdf", pdfBytes(pages));
  const { run_id } = await run(matterRoot, { action: "begin", mode: "attended" });
  await run(matterRoot, { action: "next", run_id, routes: [{ ...doc, kind: "affidavit" }] });
  const inventory = ["A", "B", "C", "D"].map((letter, i) => ({ letter, description: letter, referencing_locator: "para. 2", page_start: 3 + 2 * i, page_end: 4 + 2 * i }));
  await byRef(matterRoot, run_id, "f1", "affidavit_body", [(await stage(BODY({ exhibit_inventory: inventory }))).result_id]);
  assert.deepEqual((await run(matterRoot, { action: "next", run_id })).dispatch.map((d) => d.ref), ["f1:A", "f1:B", "f1:C", "f1:D"]);
  const ids = [];
  for (const letter of ["A", "B", "C", "D"]) {
    const { result_id } = await stage(make(letter));
    await run(matterRoot, { action: "status", run_id, ack: `ok f1:${letter} ${result_id} 10` });
    ids.push(result_id);
  }
  return { run_id, ids };
}

test("end deletes an exhibit reading the reply's cap held back with its question (round 6, N2)", async (t) => {
  const { matterRoot } = fixture(t);
  const { run_id, ids } = await fourExhibits(matterRoot, SIGNALLED);
  const first = await byRef(matterRoot, run_id, "f1", "affidavit_exhibits", ids);
  assert.ok(first.dropped > 0, JSON.stringify(first));
  assert.ok(ids.some((id) => existsSync(stagedPath(id))), "the cap held a reading back");
  assert.equal((await run(matterRoot, { action: "end", run_id })).ok, true);
  assert.deepEqual(ids.map((id) => existsSync(stagedPath(id))), [false, false, false, false]);
});

test("report lines the reply's cap left out are counted, and each result alone shows its own (round 6, N3)", async (t) => {
  const { matterRoot, caseDataDir } = fixture(t);
  const { run_id, ids } = await fourExhibits(matterRoot, SIGNALLED);
  // Each exhibit already on file with no privilege hold: each signalled reading gets a report line, not an ask.
  for (const letter of ["A", "B", "C", "D"]) {
    sql(caseDataDir, `INSERT INTO sources (category, title, parent_source_id, ingestion_status, verified)
      SELECT category, 'Exhibit ${letter}', source_id, 'complete', 0 FROM sources WHERE parent_source_id IS NULL AND title NOT LIKE 'Exhibit %'`);
  }
  const first = await byRef(matterRoot, run_id, "f1", "affidavit_exhibits", ids);
  assert.equal(first.outcome, "written", JSON.stringify(first));
  assert.deepEqual(first.ask, []);
  assert.ok(Buffer.byteLength(JSON.stringify(first)) <= 600);
  assert.ok(first.dropped > 0 && first.report.length + first.dropped === 4, JSON.stringify(first));
  const lines = [];
  for (const id of ids) lines.push(...(await byRef(matterRoot, run_id, "f1", "affidavit_exhibits", [id])).report);
  assert.deepEqual(lines.map((l) => /^Exhibit (\w) may be privileged/.exec(l)?.[1]), ["A", "B", "C", "D"], JSON.stringify(lines));
});

const CASE = (ref) => ({
  contract: "caselaw", contract_version: 2, ref, flags: [],
  authority: { title: "Invented v. Case", citation: "2026 BCCA 999", authority_type: "case_law", jurisdiction: "BC" },
  concepts: [{ name: "Invented test", jurisdiction: "BC", concept_kind: "legal test", authority_role: "establishes", authority_proposition: "A rule.", criteria: [] }],
});

test("an authority whose extraction fails twice is closed, records nothing, and is not listed again (R4)", async (t) => {
  const { matterRoot, caseDataDir } = fixture(t);
  const doc = file(matterRoot, "2026 BCCA 999.pdf", pdfBytes(["Reasons"]));
  const { run_id } = await run(matterRoot, { action: "begin", mode: "unattended", orchestrator: true });
  await run(matterRoot, { action: "next", run_id, routes: [{ ...doc, kind: "caselaw" }] });
  await run(matterRoot, { action: "status", run_id, ack: "failed f1 unreadable" });
  assert.equal((await run(matterRoot, { action: "next", run_id })).dispatch.length, 1, "read once more");
  await run(matterRoot, { action: "status", run_id, ack: "failed f1 unreadable" });
  const closing = await run(matterRoot, { action: "next", run_id });
  assert.deepEqual([closing.dispatch, closing.close], [[], [{ ref: "f1", contract: "caselaw" }]]);
  const out = await byRef(matterRoot, run_id, "f1", "caselaw", []);
  assert.equal(out.outcome, "written", JSON.stringify(out));
  assert.match(out.report[0], /nothing was recorded/);
  assert.deepEqual(sql(caseDataDir, "SELECT * FROM authorities", "law"), []);
  assert.deepEqual((await run(matterRoot, { action: "next", run_id })).close, []);
});

test("an authority's result read but unwritten, and an attachment not yet read, survive a takeover (R9)", async (t) => {
  const { matterRoot, caseDataDir } = fixture(t);
  const authority = file(matterRoot, "2026 BCCA 999.pdf", pdfBytes(["Reasons"]));
  const email = file(matterRoot, "mail.pdf", pdfBytes(["An email"]));
  const attached = file(matterRoot, "Invoice.pdf", pdfBytes(["An invoice"]));
  const { run_id } = await run(matterRoot, { action: "begin", mode: "unattended", orchestrator: true });
  await run(matterRoot, { action: "next", run_id, routes: [{ ...authority, kind: "caselaw" }, { ...email, kind: "facts", attachments: [{ name: "Invoice.pdf", file_hash: attached.file_hash, path: join(matterRoot, attached.file_path) }] }] });
  const staged = await stage(CASE("f1"));
  const size = Buffer.byteLength(JSON.stringify(CASE("f1")));
  await run(matterRoot, { action: "status", run_id, ack: `ok f1 ${staged.result_id} ${size}` });
  const parent = await stage(FACTS("f2"));
  assert.equal((await byRef(matterRoot, run_id, "f2", "facts", [parent.result_id])).outcome, "written");

  const resumed = await run(matterRoot, { action: "begin", mode: "unattended", orchestrator: true, resume: run_id });
  assert.deepEqual(resumed.next, [{ ref: "f1", contract: "caselaw", result_ids: [staged.result_id] }]);
  assert.equal((await byRef(matterRoot, resumed.run_id, "f1", "caselaw", [staged.result_id])).outcome, "written");
  assert.equal(sql(caseDataDir, "SELECT count(*) AS n FROM authorities", "law")[0].n, 1);
  const next = await run(matterRoot, { action: "next", run_id: resumed.run_id });
  assert.deepEqual(next.dispatch.map((d) => [d.ref, d.contract]), [["f2:a1", "attachment"]]);
});

test("an attachment whose extraction fails twice is registered failed under its email (R4, #54)", async (t) => {
  const { matterRoot, caseDataDir } = fixture(t);
  const email = file(matterRoot, "mail.pdf", pdfBytes(["An email"]));
  const attached = file(matterRoot, "Invoice.pdf", pdfBytes(["An invoice"]));
  const { run_id } = await run(matterRoot, { action: "begin", mode: "unattended", orchestrator: true });
  await run(matterRoot, { action: "next", run_id, routes: [{ ...email, kind: "facts", category: "correspondence", attachments: [{ name: "Invoice.pdf", file_hash: attached.file_hash, path: join(matterRoot, attached.file_path) }] }] });
  const parent = await stage(FACTS("f1"));
  await byRef(matterRoot, run_id, "f1", "facts", [parent.result_id]);
  for (let i = 0; i < 2; i++) {
    assert.deepEqual((await run(matterRoot, { action: "next", run_id })).dispatch.map((d) => d.ref), ["f1:a1"]);
    await run(matterRoot, { action: "status", run_id, ack: "failed f1:a1 unreadable" });
  }
  const closing = await run(matterRoot, { action: "next", run_id });
  assert.deepEqual([closing.dispatch, closing.close], [[], [{ ref: "f1:a1", contract: "attachment" }]]);
  const out = await byRef(matterRoot, run_id, "f1:a1", "attachment", []);
  assert.equal(out.outcome, "written", JSON.stringify(out));
  assert.match(out.report[0], /Attachment Invoice\.pdf could not be read/);
  assert.deepEqual(sql(caseDataDir, "SELECT title, ingestion_status FROM sources WHERE parent_source_id = 1"), [{ title: "Invoice.pdf", ingestion_status: "failed" }]);
  assert.deepEqual((await run(matterRoot, { action: "next", run_id })).close, []);
  assert.equal(sql(caseDataDir, "SELECT ingestion_status FROM sources WHERE parent_source_id IS NULL")[0].ingestion_status, "complete", "the email stands");
});
