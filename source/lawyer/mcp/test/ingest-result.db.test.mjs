// matter_data__ingest_result, matter_data__dispatch_inputs and ingest_run next (ingest orchestrator
// spec §2.1-2.3, §6, stage D2): the orchestrator routes files, `next` stores each dispatch's inputs and
// lists the acknowledged results still to write, and ingest_result writes a document from its staged
// results with no extraction output or SQL in the main session. Every name is invented.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { pdfBytes } from "./helpers/synthetic-docs.mjs";

const { callTool } = await import("../build/dispatch.js");
const { buildToolDefinitions } = await import("../build/schema-gen.js");
const { writeCaseDataStores } = await import("./helpers/matter-data-fixture.mjs");

const SEED = `
INSERT INTO proceedings (proceeding_id, court, file_number, style_of_cause) VALUES (1, 'BCSC', 'S-000001', 'Quill v. Plum');
INSERT INTO parties (party_id, name) VALUES (1, 'Ada Quill'), (2, 'Plum Holdings Ltd.');
INSERT INTO proceeding_parties (proceeding_id, party_id, role) VALUES (1, 1, 'plaintiff'), (1, 2, 'defendant');
`;

// Spec §9 G5: what the practitioner may see names no tool, table, field or internal word.
const DENY = /matter_data|ingest_|result_id|SAVEPOINT|verified|lease|run_id|contract|\bsources\b|\bfacts\b\.|source_id|fact_id|\w+__\w+/i;

function fixture(t) {
  const base = mkdtempSync(join(tmpdir(), "coclerk-ingest-result-"));
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
  return { matterRoot, caseDataDir };
}

function pdf(matterRoot, name, pages) {
  const stored = `5. COURT FILE\\${name}`;
  const bytes = pdfBytes(pages);
  writeFileSync(join(matterRoot, stored), bytes);
  const hash = spawnSync(process.env.COCLERK_PYTHON || "python", ["-c", "import hashlib,sys; print(hashlib.sha256(open(sys.argv[1],'rb').read()).hexdigest())", join(matterRoot, stored)], { encoding: "utf-8" }).stdout.trim();
  return { file_path: stored, file_hash: hash };
}

function sql(caseDataDir, query, db = "main") {
  const res = spawnSync(
    process.env.COCLERK_PYTHON || "python",
    ["-c", "import json,sqlite3,sys; c=sqlite3.connect(sys.argv[1]); c.row_factory=sqlite3.Row; print(json.dumps([dict(r) for r in c.execute(sys.argv[2])]))", join(caseDataDir, `${db}.sqlite`), query],
    { encoding: "utf-8" }
  );
  if (res.status !== 0) throw new Error(res.stderr);
  return JSON.parse(res.stdout);
}

const run = (matterRoot, args) => callTool({}, "matter_data__ingest_run", { matter_root: matterRoot, ...args });
const stage = (result) => callTool({}, "matter_data__stage_result", { result });
const write = (matterRoot, run_id, doc, contract, result_ids, answers) =>
  callTool({}, "matter_data__ingest_result", { matter_root: matterRoot, run_id, document: { ...doc, store: "main" }, contract, result_ids, ...(answers ? { answers } : {}) });

const FACTS = (ref, extra = {}) => ({
  contract: "facts",
  contract_version: 2,
  ref,
  flags: [],
  document: { title: "Notice of Civil Claim", description: "The claim", category: "court", date: "2026-01-05", author_or_filing_party: "Ada Quill", proceeding_file_number: "S-000001" },
  facts: [
    { fact_key: "new:1", source_locator: "para. 1", description: "Ada Quill lent Plum Holdings Ltd. $5,000.", category: "contract", date_of_fact: "2025-03-01", evidence: null },
    { fact_key: "new:2", source_locator: "para. 2", description: "Plum Holdings Ltd. did not repay the loan.", category: "breach", date_of_fact: null, evidence: null },
  ],
  fact_positions: [
    { target_fact_key: "new:1", party_name: "Ada Quill", value: "claim", position_basis: null, qualification: null, source_locator: "para. 1" },
    { target_fact_key: "new:2", party_name: "Ada Quill", value: "claim", position_basis: null, qualification: null, source_locator: "para. 2" },
  ],
  relief_items: [{ relief_key: "new-relief:1", seeking_party_name: "Ada Quill", against_party_name: "Plum Holdings Ltd.", description: "Judgment for $5,000.", source_locator: "Part 2 para. 1" }],
  relief_positions: [{ target_relief_key: "new-relief:1", party_name: "Ada Quill", value: "seek", qualification: null, source_locator: "Part 2 para. 1" }],
  source_references: [],
  unresolved_references: [],
  ...extra,
});

test("the tools are defined: ingest_result's input, dispatch_inputs by id alone", () => {
  const defs = buildToolDefinitions();
  const result = defs.find((d) => d.name === "matter_data__ingest_result");
  assert.deepEqual(result.inputSchema.required, ["matter_root", "run_id", "document", "contract", "result_ids"]);
  assert.deepEqual(result.inputSchema.properties.contract.enum,
    ["facts", "affidavit_body", "affidavit_exhibits", "sought_orders", "caselaw", "provision", "efiling_statement", "register_only", "privileged"]);
  assert.match(result.description, /600 bytes/, "the schema states the cap (§1.5)");
  const inputs = defs.find((d) => d.name === "matter_data__dispatch_inputs");
  assert.deepEqual(Object.keys(inputs.inputSchema.properties), ["dispatch_id"]);
  assert.match(defs.find((d) => d.name === "matter_data__ingest_run").description, /200 bytes/);
});

test("a routed pleading is dispatched by id, its inputs served, and its staged result written once", async (t) => {
  const { matterRoot, caseDataDir } = fixture(t);
  const doc = pdf(matterRoot, "2026-01-05 NOCC.pdf", ["Notice of Civil Claim", "Part 1", "Part 2"]);
  const { run_id } = await run(matterRoot, { action: "begin", mode: "attended" });

  const first = await run(matterRoot, { action: "next", run_id, routes: [{ ...doc, kind: "facts", execution: "filed" }] });
  assert.deepEqual(first.routed, ["f1"]);
  assert.equal(first.dispatch.length, 1);
  const [d] = first.dispatch;
  assert.deepEqual({ agent: d.agent, model: d.model, effort: d.effort, ref: d.ref, contract: d.contract },
    { agent: "lawyer:extract-facts", model: "opus", effort: "high", ref: "f1", contract: "facts" });
  assert.ok(Buffer.byteLength(JSON.stringify(d)) <= 200, "a dispatch line is at most 200 bytes");

  const inputs = await callTool({}, "matter_data__dispatch_inputs", { dispatch_id: d.dispatch_id });
  assert.equal(inputs.DOCUMENT.path, join(matterRoot, doc.file_path));
  assert.deepEqual(inputs.PAGE_MANIFEST, [{ pages: "1-3", pdf: join(matterRoot, doc.file_path) }]);
  assert.deepEqual(inputs.MATTER_CONTEXT.parties.map((p) => p.name), ["Ada Quill", "Plum Holdings Ltd."]);
  assert.deepEqual(inputs.CONTRACT, { id: "facts", version: 2 });
  assert.deepEqual(inputs.ANSWERED_FACTS, []);

  const again = await run(matterRoot, { action: "next", run_id });
  assert.deepEqual(again.dispatch, [], "a running extractor is not dispatched twice");
  assert.equal(again.running, 1);

  const { result_id } = await stage(FACTS("f1"));
  const out = await write(matterRoot, run_id, { ref: "f1" }, "facts", [result_id]);
  assert.equal(out.outcome, "written", JSON.stringify(out));
  assert.deepEqual(out.counts, { facts: 2, positions: 2, relief: 1, links: 0, exhibits: 0 });
  assert.ok(Buffer.byteLength(JSON.stringify(out)) <= 600, "the reply keeps its cap");
  for (const line of [...out.report, ...out.ask.map((a) => a.say)]) assert.doesNotMatch(line, DENY);
  assert.deepEqual(out.post.map((p) => p.pass), ["linkage", "name_check"]);

  const [source] = sql(caseDataDir, "SELECT source_id, category, ingestion_status, execution_status, file_path, proceeding_id, filed_by_party_id FROM sources");
  assert.deepEqual(source, { source_id: out.source_id, category: "court", ingestion_status: "complete", execution_status: "filed", file_path: doc.file_path, proceeding_id: 1, filed_by_party_id: 1 });
  assert.equal(sql(caseDataDir, "SELECT count(*) AS n FROM facts WHERE verified = 0 AND created_date IS NOT NULL")[0].n, 2);
  assert.equal(sql(caseDataDir, "SELECT count(*) AS n FROM relief_positions WHERE position = 'seek'")[0].n, 1);

  const repeat = await write(matterRoot, run_id, doc, "facts", [result_id]);
  assert.equal(repeat.outcome, "already_written");
  assert.equal(sql(caseDataDir, "SELECT count(*) AS n FROM facts")[0].n, 2);
  const after = await run(matterRoot, { action: "next", run_id });
  assert.deepEqual([after.dispatch, after.write, after.close], [[], [], []]);
});

test("a party name that does not resolve is asked, never guessed, and the answer writes it", async (t) => {
  const { matterRoot, caseDataDir } = fixture(t);
  const doc = pdf(matterRoot, "2026-02-01 RCC.pdf", ["Response"]);
  const { run_id } = await run(matterRoot, { action: "begin", mode: "attended" });
  await run(matterRoot, { action: "next", run_id, routes: [{ ...doc, kind: "facts" }] });
  const result = FACTS("f1");
  result.fact_positions[0].party_name = "Plum Holdings";
  const { result_id } = await stage(result);
  const asked = await write(matterRoot, run_id, { ref: "f1" }, "facts", [result_id]);
  assert.equal(asked.outcome, "refused");
  assert.equal(asked.refused, "needs_answer");
  assert.deepEqual(asked.ask.map((a) => [a.kind, a.ref]), [["participant", "Plum Holdings"]]);
  assert.deepEqual(sql(caseDataDir, "SELECT * FROM sources"), [], "nothing is written before the answer");
  assert.deepEqual((await run(matterRoot, { action: "next", run_id })).asked, [{ ref: "f1", contract: "facts", result_ids: [result_id] }], "it waits for the answer (N10)");

  const out = await write(matterRoot, run_id, doc, "facts", [result_id], { participants: { "Plum Holdings": 2 } });
  assert.equal(out.outcome, "written", JSON.stringify(out));
  assert.equal(sql(caseDataDir, "SELECT party_id FROM positions WHERE source_locator = 'para. 1'")[0].party_id, 2);
});

test("refusals: an unknown result, another contract, another file's result and a lost lease write nothing", async (t) => {
  const { matterRoot, caseDataDir } = fixture(t);
  const doc = pdf(matterRoot, "a.pdf", ["A"]);
  const other = pdf(matterRoot, "b.pdf", ["B"]);
  const { run_id } = await run(matterRoot, { action: "begin", mode: "attended" });
  await run(matterRoot, { action: "next", run_id, routes: [{ ...doc, kind: "facts" }, { ...other, kind: "facts" }] });
  const { result_id } = await stage(FACTS("f1"));
  const unknown = await write(matterRoot, run_id, { ref: "f1" }, "facts", ["00000000-0000-4000-8000-000000000000"]);
  assert.equal(unknown.refused, "unknown_result");
  assert.equal(unknown.report.length, 1, "an unknown result is said in plain words (round 6, N1)");
  assert.doesNotMatch(unknown.report[0], DENY);
  const body = await stage({ ...FACTS("f1"), contract: "affidavit_body" });
  assert.equal((await write(matterRoot, run_id, { ref: "f1" }, "facts", [body.result_id])).refused, "contract_mismatch");
  assert.equal((await write(matterRoot, run_id, { ref: "f2" }, "facts", [result_id])).refused, "contract_mismatch");
  assert.equal((await write(matterRoot, "00000000-0000-4000-8000-000000000000", doc, "facts", [result_id])).refused, "lease_lost");
  const old = await stage({ ...FACTS("f1"), contract_version: 0 });
  assert.equal((await write(matterRoot, run_id, { ref: "f1" }, "facts", [old.result_id])).refused, "contract_version");
  assert.deepEqual(sql(caseDataDir, "SELECT * FROM sources"), []);
});

test("an invalid result counts as a failed extraction; a second failure closes the document as failed", async (t) => {
  const { matterRoot, caseDataDir } = fixture(t);
  const doc = pdf(matterRoot, "c.pdf", ["C"]);
  const { run_id } = await run(matterRoot, { action: "begin", mode: "attended" });
  await run(matterRoot, { action: "next", run_id, routes: [{ ...doc, kind: "facts", category: "correspondence" }] });
  const bad = await stage(FACTS("f1", { fact_positions: [{ target_fact_key: "new:9", party_name: "Ada Quill", value: "claim", position_basis: null, qualification: null, source_locator: "para. 9" }] }));
  const out = await write(matterRoot, run_id, { ref: "f1" }, "facts", [bad.result_id]);
  assert.equal(out.refused, "invalid");
  const retry = await run(matterRoot, { action: "next", run_id });
  assert.equal(retry.dispatch.length, 1, "re-dispatched once (R4, R5)");
  await run(matterRoot, { action: "status", run_id, ack: "failed f1 unreadable" });
  const closing = await run(matterRoot, { action: "next", run_id });
  assert.deepEqual([closing.dispatch, closing.close], [[], [{ ref: "f1", contract: "facts" }]]);
  const closed = await write(matterRoot, run_id, doc, "facts", []);
  assert.equal(closed.outcome, "written");
  assert.deepEqual(sql(caseDataDir, "SELECT category, ingestion_status FROM sources"), [{ category: "correspondence", ingestion_status: "failed" }]);
  assert.deepEqual((await run(matterRoot, { action: "next", run_id })).close, []);
});

test("an affidavit: Pass 1 writes the body partial, its exhibits are dispatched, and the last exhibit write completes it", async (t) => {
  const { matterRoot, caseDataDir } = fixture(t);
  const doc = pdf(matterRoot, "2026-03-01 AFF Quill.pdf", ["Affidavit", "Body 2", "Exhibit A stamp", "A content", "Exhibit B stamp", "B content"]);
  const { run_id } = await run(matterRoot, { action: "begin", mode: "attended" });
  const first = await run(matterRoot, { action: "next", run_id, routes: [{ ...doc, kind: "affidavit", execution: "affirmed" }] });
  assert.deepEqual(first.dispatch.map((d) => [d.agent, d.ref, d.contract]), [["lawyer:extract-affidavit", "f1", "affidavit_body"]]);
  const pass1Inputs = await callTool({}, "matter_data__dispatch_inputs", { dispatch_id: first.dispatch[0].dispatch_id });
  assert.equal(pass1Inputs.PASS, 1);

  const body = await stage({
    contract: "affidavit_body", contract_version: 2, ref: "f1",
    flags: [],
    deponent: { name: "Ada Quill", role: "plaintiff", basis_statement: "I am the plaintiff." },
    sworn_date: "2026-03-01",
    body_facts: [
      { source_locator: "para. 2", description: "Ada Quill met the director on 1 March 2025.", category: "background", date_of_fact: "2025-03-01", basis_of_knowledge: "personal", informant: null },
      { source_locator: "para. 3", description: "The loan was never repaid.", category: "breach", date_of_fact: null, basis_of_knowledge: "information_and_belief", informant: "Her lawyer", informant_privileged: true },
    ],
    exhibit_inventory: [
      { letter: "A", description: "Loan agreement", referencing_locator: "para. 2", page_start: 3, page_end: 4 },
      { letter: "B", description: "Demand letter", referencing_locator: "para. 3", page_start: 5, page_end: 6 },
    ],
    body_page_count: 2, total_pages_read: 2, scanned: false,
  });
  const bodyOut = await write(matterRoot, run_id, { ref: "f1" }, "affidavit_body", [body.result_id]);
  assert.equal(bodyOut.outcome, "written", JSON.stringify(bodyOut));
  assert.deepEqual(bodyOut.ask.map((a) => a.kind), ["privileged_informant"]);
  assert.deepEqual(sql(caseDataDir, "SELECT ingestion_status, execution_status FROM sources"), [{ ingestion_status: "partial", execution_status: "affirmed" }]);
  assert.deepEqual(sql(caseDataDir, "SELECT source_locator, informant FROM facts ORDER BY fact_id"),
    [{ source_locator: "para. 2", informant: null }, { source_locator: "para. 3", informant: null }], "a privileged informant never lands in main");
  assert.deepEqual(sql(caseDataDir, "SELECT name, witness_type FROM witnesses"), [{ name: "Ada Quill", witness_type: "fact" }]);

  const exhibitsNext = await run(matterRoot, { action: "next", run_id });
  assert.deepEqual(exhibitsNext.dispatch.map((d) => d.ref), ["f1:A", "f1:B"]);
  const bInputs = await callTool({}, "matter_data__dispatch_inputs", { dispatch_id: exhibitsNext.dispatch[1].dispatch_id });
  assert.deepEqual([bInputs.PASS, bInputs.PAGE_RANGE, bInputs.EXHIBIT_LETTER], [3, [5, 6], "B"]);

  const exhibit = (letter, extra = {}) => stage({
    contract: "affidavit_exhibits", contract_version: 2, ref: `f1:${letter}`, flags: [],
    exhibit_letter: letter, title: `Document ${letter}`, description: "x", date: null, needs_human: false,
    facts: [{ source_locator: `p${letter === "A" ? 4 : 6}`, description: `Exhibit ${letter} says so.`, category: "contract", date_of_fact: null, evidence: { is_proof_source: true, strength: 1, notes: null } }],
    ...extra,
  });
  const a = await exhibit("A");
  const partial = await write(matterRoot, run_id, { ref: "f1:A" }, "affidavit_exhibits", [a.result_id]);
  assert.deepEqual(partial.counts, { facts: 1, positions: 0, relief: 0, links: 1, exhibits: 1 });
  assert.equal(sql(caseDataDir, "SELECT ingestion_status FROM sources WHERE parent_source_id IS NULL")[0].ingestion_status, "partial");

  const b = await exhibit("B", { needs_human: true });
  const done = await write(matterRoot, run_id, { ref: "f1:B" }, "affidavit_exhibits", [b.result_id]);
  assert.equal(done.outcome, "written");
  assert.deepEqual(sql(caseDataDir, "SELECT title, verified, file_hash FROM sources WHERE parent_source_id IS NOT NULL ORDER BY source_id"),
    [{ title: "Exhibit A — Document A", verified: 0, file_hash: doc.file_hash }, { title: "Exhibit B — Document B", verified: 2, file_hash: doc.file_hash }]);
  assert.equal(sql(caseDataDir, "SELECT ingestion_status FROM sources WHERE parent_source_id IS NULL")[0].ingestion_status, "complete");
  const end = await run(matterRoot, { action: "next", run_id });
  assert.deepEqual([end.dispatch, end.write, end.close], [[], [], []]);
});

test("sought orders wait for their document, then write with the unnumbered marker", async (t) => {
  const { matterRoot, caseDataDir } = fixture(t);
  const doc = pdf(matterRoot, "2026-04-01 NOA.pdf", ["NOTICE OF APPLICATION", "PART 1"]);
  const { run_id } = await run(matterRoot, { action: "begin", mode: "attended" });
  const first = await run(matterRoot, { action: "next", run_id, routes: [{ ...doc, kind: "notice_of_application" }] });
  assert.deepEqual(first.dispatch.map((d) => [d.agent, d.ref, d.contract]),
    [["lawyer:extract-facts", "f1", "facts"], ["lawyer:extract-sought-orders", "f1:so", "sought_orders"]]);
  const so = await stage({ contract: "sought_orders", contract_version: 2, ref: "f1:so", flags: [], numbering_absent: true, not_a_notice_of_application: false,
    sought_orders: [{ order_number: "1", order_text: "An order for production.", ocr_uncertain: false }] });
  const early = await write(matterRoot, run_id, { ref: "f1:so" }, "sought_orders", [so.result_id]);
  assert.equal(early.refused, "waiting");
  const facts = await stage(FACTS("f1"));
  assert.equal((await write(matterRoot, run_id, { ref: "f1" }, "facts", [facts.result_id])).outcome, "written");
  assert.deepEqual((await run(matterRoot, { action: "next", run_id })).write, [{ ref: "f1:so", contract: "sought_orders", result_ids: [so.result_id] }]);
  assert.equal((await write(matterRoot, run_id, doc, "sought_orders", [so.result_id])).outcome, "written");
  assert.deepEqual(sql(caseDataDir, "SELECT order_number, verified, notes FROM sought_orders"),
    [{ order_number: "1", verified: 2, notes: "UNCONFIRMED: Part 1 unnumbered; ordinal assigned positionally" }]);
});

test("an unattended run writes the pending markers in place of the attended passes", async (t) => {
  const { matterRoot, caseDataDir } = fixture(t);
  const doc = pdf(matterRoot, "2026-05-01 ORDR.pdf", ["THIS COURT ORDERS"]);
  const { run_id } = await run(matterRoot, { action: "begin", mode: "unattended" });
  await run(matterRoot, { action: "next", run_id, routes: [{ ...doc, kind: "facts" }] });
  const { result_id } = await stage(FACTS("f1", { document: { title: "Order made after application", description: "An order", category: "court", date: "2026-05-01", author_or_filing_party: null, proceeding_file_number: "S-000001" }, flags: [{ kind: "date_setting", ref: "f1", detail: "trial on 2026-09-01" }] }));
  const out = await write(matterRoot, run_id, { ref: "f1" }, "facts", [result_id]);
  assert.equal(out.outcome, "written", JSON.stringify(out));
  assert.deepEqual(out.post.map((p) => p.pass), ["name_check"]);
  assert.equal(sql(caseDataDir, "SELECT notes FROM sources")[0].notes,
    "LINKAGE-PENDING: proceeding linkage check not yet run\nORDER-EFFECTS-PENDING: order-effects pass not yet run\nDATE-ANCHOR-PENDING: date not yet recorded as an anchor");
});

test("Path B: privileged writes bare rows with their statements on the privileged side, and drops the staged file", async (t) => {
  const { matterRoot, caseDataDir } = fixture(t);
  const memo = { file_path: "3. CLIENT\\memo.pdf", file_hash: "c".repeat(64) };
  const { run_id } = await run(matterRoot, { action: "begin", mode: "attended" });
  const staged = await stage({
    contract: "privileged", contract_version: 2, ref: "memo",
    document: { title: "Client memo", description: null, category: "solicitor_client", author: "Ada Quill", recipient: "the firm", date: "2026-01-02" },
    facts: [{ source_locator: "p1", description: "The client says the loan was oral.", category: "contract", date_of_fact: null }],
    client_instructions: [{ party_name: "Ada Quill", instructed_by: "Ada Quill", date: "2026-01-02", description: "Settle above $4,000.", source_locator: "p1", status: "open", proceeding_file_number: "S-000001" }],
  });
  const out = await callTool({}, "matter_data__ingest_result", { matter_root: matterRoot, run_id, document: { ...memo, store: "privileged" }, contract: "privileged", result_ids: [staged.result_id], answers: { privilege: "yes" } });
  assert.equal(out.outcome, "written", JSON.stringify(out));
  assert.deepEqual(sql(caseDataDir, "SELECT description, created_date, source_id FROM facts"), [{ description: "", created_date: null, source_id: null }]);
  const [prov] = sql(caseDataDir, "SELECT source_note FROM fact_provenance", "privileged");
  assert.equal(prov.source_note, "STATEMENT: The client says the loan was oral.\nCATEGORY: contract\nLOCATOR: p1");
  assert.equal(sql(caseDataDir, "SELECT count(*) AS n FROM client_instructions WHERE party_id = 1 AND proceeding_id = 1", "privileged")[0].n, 1);
  assert.equal(existsSync(join(process.env.LOCALAPPDATA, "Coclerk", "extract-results", `${staged.result_id}.json`)), false);

  const note = { file_path: "3. CLIENT\\note.pdf", file_hash: "d".repeat(64) };
  const unclear = await stage({ contract: "privileged", contract_version: 2, ref: "note", document: { title: "File note" }, facts: [{ source_locator: "p1", description: "A call took place.", category: "background", date_of_fact: null }] });
  const out2 = await callTool({}, "matter_data__ingest_result", { matter_root: matterRoot, run_id, document: { ...note, store: "main" }, contract: "privileged", result_ids: [unclear.result_id], answers: { privilege: "unclear" } });
  assert.equal(out2.outcome, "written", JSON.stringify(out2));
  assert.deepEqual(sql(caseDataDir, "SELECT category, listed, privilege_status, ingestion_status FROM sources"),
    [{ category: "work_product", listed: 0, privilege_status: "pending", ingestion_status: "complete" }]);
});

test("a bridged run lists the files to stage, and dispatch_inputs serves the session's copies", async (t) => {
  const { matterRoot } = fixture(t);
  const doc = pdf(matterRoot, "e.pdf", ["E"]);
  const { run_id } = await run(matterRoot, { action: "begin", mode: "attended" });
  const out = await run(matterRoot, { action: "next", run_id, bridged: true, routes: [{ ...doc, kind: "facts" }] });
  const [d] = out.dispatch;
  assert.deepEqual(d.stage, [join(matterRoot, doc.file_path)]);
  assert.equal((await run(matterRoot, { action: "staged", run_id, dispatch_id: d.dispatch_id, paths: ["/sessions/x/e.pdf"] })).ok, true);
  const inputs = await callTool({}, "matter_data__dispatch_inputs", { dispatch_id: d.dispatch_id });
  assert.equal(inputs.DOCUMENT.path, "/sessions/x/e.pdf");
  assert.deepEqual(inputs.PAGE_MANIFEST, [{ pages: "1-1", pdf: "/sessions/x/e.pdf" }]);
});
