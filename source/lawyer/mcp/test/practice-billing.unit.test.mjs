import assert from "node:assert/strict";
import test from "node:test";

import { memoryKv, startFakeCloud } from "./helpers/fake-cloud.mjs";

const writes = await import("../build/tools/practice/writes.js");
const billing = await import("../build/tools/practice/billing.js");
const invoicesTool = await import("../build/tools/practice/invoices.js");
const { PracticeStore } = await import("../build/practice/store.js");

const MATTER = { matt_num: "L100" };

async function setup(t) {
  const cloud = await startFakeCloud(t);
  const store = new PracticeStore({ ...cloud.env }, memoryKv());
  await writes.upsert_client_matter(store, { client_num: "C-1", name: "Pat Example", matt_num: "L100", file_number: "F-100", description: "Invented" });
  return { cloud, store };
}

const entry = (source_key, extra = {}) => ({
  source_key, entry_date: "2030-01-10", timekeeper: "Pat Example", description: "Drafting a letter",
  billed_seconds: 1800, tracked_seconds: 1800, provenance: "tracker", tracker_ids: [source_key], ...extra,
});

const issue = (extra = {}) => ({
  ...MATTER, invoice_number: "101", issue_date: "2030-02-01", date_to: "2030-01-31", amount: 50,
  signed_copy_path: "signed.pdf", signed_copy_hash: "a".repeat(64), snapshot_path: "audit.json", snapshot_hash: "b".repeat(64),
  lines: [{
    line_key: "2030-01-10|Pat Example", line_kind: "fee", description: "Drafting a letter", amount: 50, hours: 0.5, rate: 100,
    rate_source: "Retainer", provenance: "tracker", entry_source_keys: ["tc:1"],
  }],
  ...extra,
});

test("upsert_time_entries: vetting again updates the entry and adds none", async (t) => {
  const { store } = await setup(t);
  await billing.upsert_time_entries(store, { ...MATTER, entries: [entry("tc:1")] });
  await billing.upsert_time_entries(store, { ...MATTER, entries: [entry("tc:1", { billed_seconds: 900, description: "Corrected wording" })] });
  const rows = [...store.items().values()].filter((item) => item.kind === "time_entry");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].data.billed_seconds, 900);
  assert.equal(rows[0].data.hours, 0.25);
  assert.equal(rows[0].state, "open");
});

test("upsert_time_entries: nothing but hashes and vocabulary leaves the machine", async (t) => {
  const { cloud, store } = await setup(t);
  await billing.upsert_time_entries(store, { ...MATTER, entries: [entry("tc:1")] });
  const sent = JSON.stringify(cloud.writes().at(-1));
  assert.ok(!sent.includes("Drafting"));
  assert.ok(!sent.includes("Pat Example"));
  assert.ok(!sent.includes("tc:1"));
});

test("upsert_time_entries: an estimate keeps its provenance and basis", async (t) => {
  const { store } = await setup(t);
  const estimate = { basis: ["evidence:filing:9"], method: "document creation to save", reason: "No tracker entry", approved_by: "Pat", approved_at: "2030-01-12" };
  await billing.upsert_time_entries(store, { ...MATTER, entries: [entry("est:1", { provenance: "estimate", estimate, tracker_ids: [] })] });
  const row = [...store.items().values()].find((item) => item.kind === "time_entry");
  assert.equal(row.data.provenance, "estimate");
  assert.deepEqual(row.data.estimate, estimate);
});

test("upsert_time_entries: refuses an unknown provenance", async (t) => {
  const { store } = await setup(t);
  await assert.rejects(billing.upsert_time_entries(store, { ...MATTER, entries: [entry("x", { provenance: "guess" })] }), /provenance/);
});

test("issue_invoice: one write saves the invoice and lines and locks the entries", async (t) => {
  const { cloud, store } = await setup(t);
  await billing.upsert_time_entries(store, { ...MATTER, entries: [entry("tc:1"), entry("tc:2")] });
  const before = cloud.writes().length;
  const adjustment = { kind: "write_off", reason: "Own software work", marker: "evidence:marker:1", seconds: 300, decided_by: "Pat", decided_at: "2030-01-12", entry_source_key: "tc:2" };
  const result = await billing.issue_invoice(store, issue({ adjustments: [adjustment] }));
  assert.equal(cloud.writes().length, before + 1);
  assert.deepEqual(result, { invoice_number: "101", lines: 1, locked_entries: 2 });

  const read = await billing.invoice_lines_query(store, { ...MATTER, invoice_number: "101" });
  assert.equal(read.invoice.issue_state, "issued");
  assert.equal(read.lines[0].entries[0].source_key, "tc:1");
  assert.equal(read.lines[0].entries[0].status, "locked");
  assert.equal(read.invoice.snapshot_hash, "b".repeat(64));
});

test("issue_invoice: a fee line with no entries and a disbursement with no receipt are refused", async (t) => {
  const { store } = await setup(t);
  const bare = issue();
  bare.lines[0].entry_source_keys = [];
  await assert.rejects(billing.issue_invoice(store, bare), /names no time entries/);
  await assert.rejects(billing.issue_invoice(store, issue({ lines: [{ line_key: "d", line_kind: "disbursement", description: "Filing fee", amount: 10 }] })), /names no receipt/);
});

test("issue_invoice: an entry that is not recorded is refused, and issuing twice is refused", async (t) => {
  const { store } = await setup(t);
  await assert.rejects(billing.issue_invoice(store, issue()), /not recorded/);
  await billing.upsert_time_entries(store, { ...MATTER, entries: [entry("tc:1")] });
  await billing.issue_invoice(store, issue());
  await assert.rejects(billing.issue_invoice(store, issue()), /already issued/);
});

test("upsert_time_entries: a locked entry is left alone and named", async (t) => {
  const { cloud, store } = await setup(t);
  await billing.upsert_time_entries(store, { ...MATTER, entries: [entry("tc:1")] });
  await billing.issue_invoice(store, issue());
  const before = cloud.writes().length;
  const result = await billing.upsert_time_entries(store, { ...MATTER, entries: [entry("tc:1", { billed_seconds: 9 })] });
  assert.deepEqual(result, { saved: 0, locked_unchanged: ["tc:1"] });
  assert.equal(cloud.writes().length, before);
});

test("a cloud refusal of an edit reaches the caller as the cloud's question", async (t) => {
  const { cloud, store } = await setup(t);
  await billing.upsert_time_entries(store, { ...MATTER, entries: [entry("tc:1")] });
  await billing.issue_invoice(store, issue());
  const id = [...store.items().entries()].find(([, item]) => item.kind === "time_entry")[0];
  cloud.refuse = () => "What correction should be recorded against this entry?";
  await assert.rejects(writes.set_time_entries_billable(store, { entry_ids: [id], billable: false }), /What correction/);
});

test("record_adjustment: the same key saves once", async (t) => {
  const { store } = await setup(t);
  await billing.upsert_time_entries(store, { ...MATTER, entries: [entry("tc:1")] });
  await billing.issue_invoice(store, issue());
  const args = { ...MATTER, adjustment_key: "credit-1", kind: "credit", amount: 10, reason: "Goodwill", decided_by: "Pat", decided_at: "2030-03-01", entry_source_key: "tc:1" };
  assert.deepEqual(await billing.record_adjustment(store, args), { saved: true });
  assert.deepEqual(await billing.record_adjustment(store, args), { saved: false });
  const read = await billing.invoice_lines_query(store, { ...MATTER, invoice_number: "101" });
  assert.equal(read.adjustments.length, 1);
  assert.equal(read.adjustments[0].adjustment_kind, "credit");
});

test("import_invoices: an issued invoice keeps its record and takes payment, and its payment status still reads", async (t) => {
  const { cloud, store } = await setup(t);
  await billing.upsert_time_entries(store, { ...MATTER, entries: [entry("tc:1")] });
  await billing.issue_invoice(store, issue());
  await invoicesTool.import_invoices(store, { rows: [{ ...MATTER, invoice_number: "101", amount: 999, amount_paid: 50, status: "PAID", issue_date: "2031-01-01" }] });
  const ops = cloud.writes().at(-1).ops;
  assert.equal(ops[0].op, "update");
  assert.deepEqual(Object.keys(ops[0].hashes).sort(), ["amount_paid", "last_import_at", "status"]);
  const [row] = (await invoicesTool.invoices_query(store, MATTER)).rows;
  assert.equal(row.amount, 50);
  assert.equal(row.status, "paid");
  assert.equal(row.issue_state, "issued");
});

test("rates: one row per timekeeper and date, each with its source", async (t) => {
  const { store } = await setup(t);
  const rate = { ...MATTER, timekeeper: "Pat Example", effective_date: "2030-01-01", rate: 100, source_document: "Retainer" };
  await billing.upsert_rate(store, rate);
  await billing.upsert_rate(store, { ...rate, rate: 120 });
  await billing.upsert_rate(store, { ...rate, effective_date: "2030-06-01", rate: 130, source_document: "Rate notice" });
  const { rows } = await billing.rates_query(store, MATTER);
  assert.deepEqual(rows.map((row) => [row.effective_date, row.rate, row.source_document]),
    [["2030-01-01", 120, "Retainer"], ["2030-06-01", 130, "Rate notice"]]);
});

test("record_invoice_sent: adds the sent date to an issued invoice", async (t) => {
  const { store } = await setup(t);
  await billing.upsert_time_entries(store, { ...MATTER, entries: [entry("tc:1")] });
  await billing.issue_invoice(store, issue());
  await billing.record_invoice_sent(store, { ...MATTER, invoice_number: "101", sent_date: "2030-02-02", sent_copy_path: "sent.pdf" });
  const read = await billing.invoice_lines_query(store, { ...MATTER, invoice_number: "101" });
  assert.equal(read.invoice.sent_date, "2030-02-02");
});
