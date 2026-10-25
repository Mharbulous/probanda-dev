// The practice tools over practice.db's items, with an in-memory store and a fake Probanda's
// Cloud (test/helpers/fake-cloud.mjs). The write rules themselves (anchors, supersession, one
// open to-do per filing, the lifecycle policies) are the cloud's and are tested in
// cloud/items/tests/; these tests cover what stays on this machine: the reads and their
// defaults (L2), matter references (L4), the interface checks, and what each write sends.

import assert from "node:assert/strict";
import test from "node:test";

import { memoryKv, seedBoth, seedItems, startFakeCloud } from "./helpers/fake-cloud.mjs";

const index = await import("../build/index.js");
const { PracticeStore } = await import("../build/practice/store.js");
const practiceIndex = await import("../build/tools/practice/index.js");
const shared = await import("../build/tools/practice/shared.js");
const reads = await import("../build/tools/practice/reads.js");
const writes = await import("../build/tools/practice/writes.js");
const invoices = await import("../build/tools/practice/invoices.js");
const schemaGen = await import("../build/schema-gen.js");

async function setup(t) {
  const cloud = await startFakeCloud(t);
  const kv = memoryKv();
  return { cloud, kv, store: new PracticeStore({ ...cloud.env }, kv) };
}

const ofKind = (kv, kind) => [...(kv.namespaces.get("item")?.entries() ?? [])]
  .map(([id, value]) => ({ id, ...JSON.parse(value) }))
  .filter((item) => item.kind === kind);

async function seedMatter(store, extra = {}) {
  return writes.upsert_client_matter(store, {
    client_num: "C-1",
    name: "Acme Co",
    matt_num: ".L100",
    file_number: "F-100",
    description: "Contract dispute",
    regular_trust: -500,
    ...extra,
  });
}

const PRACTICE_TOOL_NAMES = [
  "practice_data__matter_lookup",
  "practice_data__trust_summary",
  "practice_data__wip_hours",
  "practice_data__open_tasks",
  "practice_data__active_deadlines",
  "practice_data__ar_data",
  "practice_data__read_signals",
  "practice_data__time_entries_query",
  "practice_data__upsert_client_matter",
  "practice_data__link_matter",
  "practice_data__insert_time_entry",
  "practice_data__set_time_entries_billable",
  "practice_data__upsert_task",
  "practice_data__complete_task",
  "practice_data__record_retainer_notice",
  "practice_data__upsert_anchor",
  "practice_data__delete_anchor",
  "practice_data__upsert_deadline",
  "practice_data__manage_payment_in_flight",
  "practice_data__upsert_signal",
  "practice_data__set_status",
  "practice_data__ingest_court_calendar_year",
  "practice_data__court_calendar_coverage",
  "practice_data__court_calendar_days",
  "practice_data__import_invoices",
  "practice_data__invoices_query",
  "practice_data__upsert_rule_overlay",
  "practice_data__rule_overlay",
  "practice_data__upsert_contact",
  "practice_data__upsert_affiliation",
  "practice_data__upsert_matter_role",
  "practice_data__contact_lookup",
  "practice_data__contact_checks",
  "practice_data__merge_contact",
];

test("upsert_anchor schema exposes amend (#194)", () => {
  const definition = schemaGen.practiceToolDefinitions().find((tool) => tool.name === "practice_data__upsert_anchor");
  assert.deepEqual(definition.inputSchema.properties.amend, { type: "boolean" });
  assert.match(definition.description, /Pass amend=true/);
});

test("every practice tool name routes (no unknown-tool error)", async (t) => {
  const { store } = await setup(t);
  for (const name of PRACTICE_TOOL_NAMES) {
    const args = name === "practice_data__import_invoices" ? { rows: [] } : {};
    try {
      await practiceIndex.callPracticeTool(store, name, args);
    } catch (err) {
      assert.doesNotMatch(String(err.message), /Unknown practice tool/, name);
    }
  }
});

test("a practice write goes through Probanda's Cloud and lands in the local store", async (t) => {
  const { cloud, kv, store } = await setup(t);
  const result = await index.callTool({ practiceDb: store }, "practice_data__upsert_task", { task_type: "admin", description: "x" });
  assert.ok(result && result.id, "practice tool returned a created task");
  assert.equal(ofKind(kv, "task").length, 1, "wrote to the local store");
  assert.deepEqual(cloud.writes().map((w) => w.tool), ["upsert_task"]);
  assert.equal(result.status, "open", "the state the cloud returned reads back as status");
  assert.equal("owner_id" in result, false);
});

test("read_signals returns the matter's signals and status, and no policies", async (t) => {
  const { store } = await setup(t);
  await seedMatter(store, { status: "intake" });
  await writes.upsert_signal(store, { matt_num: "L100", signal_key: "conflict_check_completed", state: "confirmed" });
  const result = await reads.read_signals(store, { matt_num: "L100" });
  assert.deepEqual(Object.keys(result).sort(), ["matter_id", "signals", "status"]);
  assert.equal(result.status, "intake");
  assert.equal(result.signals.length, 1);
  assert.equal(result.signals[0].signal_key, "conflict_check_completed");
  assert.equal(result.signals[0].state, "confirmed");
});

test("set_status sends the status as the matter's state under the tool name set_status", async (t) => {
  const { cloud, store } = await setup(t);
  const seeded = await seedMatter(store, { status: "intake" });
  const result = await writes.set_status(store, { matt_num: "L100", status_label: "active" });
  assert.deepEqual(result, { matter_id: seeded.matter_id, old_status: "intake", new_status: "active" });
  const write = cloud.writes().at(-1);
  assert.equal(write.tool, "set_status");
  assert.deepEqual(write.ops, [{ op: "update", id: seeded.matter_id, kind: "matter", state: "active", hashes: {} }]);
});

test("delete_anchor sends one delete and counts what practice.db held; the cloud's tombstones remove the rest (#190)", async (t) => {
  const { cloud, kv, store } = await setup(t);
  await seedMatter(store);
  const created = await writes.upsert_anchor(store, {
    matt_num: ".L100", anchor_type: "trial_date", anchor_date: "2026-09-01", source_document: "Notice of Trial", stated_date: "2026-09-01",
  });
  const anchorId = String(created.anchor.id);
  await writes.upsert_deadline(store, {
    matt_num: ".L100", anchor_id: anchorId, deadline_type: "trial_management_conference", deadline_date: "2026-08-04",
    rule_ref: "R. 12-2(1)", rule_description: "TMC 28 days before trial", source_type: "bc_rules", status: "active",
  });

  const result = await writes.delete_anchor(store, { anchor_id: anchorId });
  assert.deepEqual(result, { deleted_anchor: anchorId, deleted_sources: 1, deleted_deadlines: 1 });
  assert.deepEqual(cloud.writes().at(-1).ops, [{ op: "delete", id: anchorId, kind: "anchor", hashes: {} }]);
  for (const kind of ["anchor", "anchor_source", "deadline"]) assert.equal(ofKind(kv, kind).length, 0, kind);

  await assert.rejects(() => writes.delete_anchor(store, { anchor_id: anchorId }), /No anchor/);
});

test("upsert_anchor: resolve, amend and occurred are mutually exclusive, refused before anything is sent", async (t) => {
  const { cloud, store } = await setup(t);
  await seedMatter(store);
  const sent = cloud.requests.length;
  await assert.rejects(
    writes.upsert_anchor(store, {
      matt_num: "L100", anchor_type: "application_hearing_date", anchor_date: "2026-07-17",
      source_document: "Practitioner confirmation", stated_date: "July 17, 2026", occurred: true, amend: true,
    }),
    /mutually exclusive/
  );
  assert.equal(cloud.requests.length, sent);
});

test("upsert_deadline: an update by id sends only what it names, and keeps the labels it does not name", async (t) => {
  const { cloud, store } = await setup(t);
  await seedMatter(store);
  const row = await writes.upsert_deadline(store, {
    matt_num: "L100", deadline_type: "application_response", deadline_date: "2030-03-01", rule_ref: "R. 8-1(9)",
    rule_description: "Response", source_type: "bc_rules", review_flag: "practitioner_choice", review_note: "Which date?",
    scenario_label: "Extension valid", party_label: "Defendant A", proceeding_label: "Court action",
  });
  await writes.upsert_deadline(store, { id: row.id, status: "dismissed" });
  assert.deepEqual(cloud.writes().at(-1).ops[0].hashes, {}, "a status change sends no field");
  const dismissed = (await reads.active_deadlines(store, { include_dismissed: true })).deadlines.find((r) => r.id === row.id);
  assert.equal(dismissed.status, "dismissed");
  assert.equal(dismissed.party_label, "Defendant A");
  assert.equal(dismissed.proceeding_label, "Court action");
  assert.equal(dismissed.scenario_label, "Extension valid");

  await writes.upsert_deadline(store, { id: row.id, party_label: null });
  assert.deepEqual(cloud.writes().at(-1).ops[0].hashes, { party_label: null });
  const cleared = (await reads.active_deadlines(store, { include_dismissed: true })).deadlines.find((r) => r.id === row.id);
  assert.equal(cleared.party_label, null, "an explicit null clears a label");
});

test("import_invoices: negative skip, no-matter skip, one write per matter, and the cloud's NULL dedup applied locally", async (t) => {
  const { cloud, kv, store } = await setup(t);
  await seedMatter(store);

  const first = await invoices.import_invoices(store, {
    rows: [
      { matt_num: ".L100", invoice_number: "INV-1", amount: 100, status: "Outstanding" },
      { matt_num: ".L100", amount: -5 },
      { matt_num: "NOPE", amount: 10 },
      { matt_num: ".L100", invoice_number: null, amount: 50 },
    ],
  });
  assert.deepEqual(first, { imported: 2, skipped_no_matter: 1, skipped_negative: 1, not_saved: 0, questions: [] });
  const write = cloud.writes().at(-1);
  assert.equal(write.tool, "import_invoices");
  assert.equal(write.ops.length, 2, "one write carries the matter's rows");
  assert.ok(write.ops.every((op) => op.op === "upsert" && op.kind === "invoice"));
  assert.equal(write.ops[1].hashes.invoice_number, null);

  const inv1Id = ofKind(kv, "invoice").find((row) => row.data.invoice_number === "INV-1").id;
  const second = await invoices.import_invoices(store, {
    rows: [
      { matt_num: ".L100", invoice_number: "INV-1", amount: 175, status: "Partial" },
      { matt_num: ".L100", invoice_number: null, amount: 60 },
    ],
  });
  assert.equal(second.imported, 2);
  const { rows } = await invoices.invoices_query(store, { matt_num: "L100" });
  const inv1 = rows.filter((row) => row.invoice_number === "INV-1");
  assert.equal(inv1.length, 1, "INV-1 not duplicated");
  assert.equal(inv1[0].id, inv1Id, "INV-1 keeps the item the cloud matched");
  assert.equal(inv1[0].amount, 175);
  assert.equal(inv1[0].status, "partial");
  const nullRows = rows.filter((row) => row.invoice_number === null);
  assert.equal(nullRows.length, 1, "the cloud's purge of NULL-number rows reaches practice.db");
  assert.equal(nullRows[0].amount, 60);
});

test("import_invoices: a matter the cloud refuses counts its rows as not_saved with the question; the others are saved", async (t) => {
  const { cloud, store } = await setup(t);
  const own = await seedMatter(store, { billable: false });
  await seedMatter(store, { client_num: "C-2", name: "Beta Co", matt_num: ".L200", file_number: "F-200" });
  cloud.refuse = (write) => write.tool === "import_invoices" && write.ops[0].links.matter === own.matter_id
    ? `Should {{item:${own.matter_id}}}, which is recorded as not billable, take this invoice?`
    : undefined;
  const result = await invoices.import_invoices(store, {
    rows: [
      { matt_num: "L100", invoice_number: "INV-1", amount: 100 },
      { matt_num: "L100", invoice_number: "INV-2", amount: 50 },
      { matt_num: "L200", invoice_number: "INV-9", amount: 10 },
    ],
  });
  assert.equal(result.imported, 1);
  assert.equal(result.not_saved, 2);
  assert.deepEqual(result.questions, [`Should ${own.matter_id} "Contract dispute", which is recorded as not billable, take this invoice?`]);
  assert.equal("skipped_non_billable" in result, false);
  assert.deepEqual((await invoices.invoices_query(store, {})).rows.map((r) => r.invoice_number), ["INV-9"]);
});

test("time_entries_query filters by date range and enriches with matter/client context", async (t) => {
  const { store } = await setup(t);
  await seedMatter(store);
  for (const [entry_date, hours, description] of [
    ["2026-01-10", 1.5, "Early entry"],
    ["2026-03-15", 2.0, "Mid entry"],
    ["2026-06-20", 0.5, "Late entry"],
  ]) {
    await writes.insert_time_entry(store, { matt_num: ".L100", entry_date, hours, description });
  }

  const all = await reads.time_entries_query(store, { matt_num: ".L100" });
  assert.equal(all.rows.length, 3);
  assert.equal(all.rows[0].matt_num, "L100");
  assert.equal(all.rows[0].client_name, "Acme Co");
  assert.equal(all.rows[0].client_num, "C-1");
  assert.equal(all.rows[0].billable, true, "the entry took its matter's billable flag");
  assert.ok(all.rows.some((row) => row.description === "Mid entry"));

  const windowed = await reads.time_entries_query(store, { matt_num: ".L100", from_date: "2026-02-01", to_date: "2026-05-01" });
  assert.equal(windowed.rows.length, 1);
  assert.equal(windowed.rows[0].description, "Mid entry");

  await assert.rejects(() => reads.time_entries_query(store, { matt_num: ".L999" }), /No matter matched/);
});

test("ingest_court_calendar_year: one write upserts the year, deletes its prior days and creates the new ones", async (t) => {
  const { cloud, kv, store } = await setup(t);
  const first = await writes.ingest_court_calendar_year(store, {
    year: 2026,
    status: "confirmed",
    source_document: "CourtCalendar2026.pdf",
    days: [
      { calendar_date: "2026-01-01", status_category: "full_closure", status_label: "New Year's Day" },
      { calendar_date: "2026-03-16", status_category: "limited", status_label: "Reading Break" },
    ],
  });
  assert.equal(first.coverage.status, "confirmed");
  assert.equal(first.coverage.year, 2026);
  assert.equal(first.days_count, 2);
  const firstWrite = cloud.writes().at(-1);
  assert.deepEqual(firstWrite.ops.map((op) => `${op.op} ${op.kind}`), ["upsert calendar_year", "create calendar_day", "create calendar_day"]);
  assert.ok(firstWrite.ops.slice(1).every((op) => op.links.calendar_year === firstWrite.ops[0].id));
  assert.equal(ofKind(kv, "calendar_day").length, 2);

  const second = await writes.ingest_court_calendar_year(store, {
    year: 2026, status: "confirmed", source_document: "CourtCalendar2026.pdf",
    days: [{ calendar_date: "2026-01-01", status_category: "full_closure", status_label: "New Year's Day" }],
  });
  assert.equal(second.days_count, 1);
  assert.deepEqual(cloud.writes().at(-1).ops.map((op) => `${op.op} ${op.kind}`), ["upsert calendar_year", "delete calendar_day", "delete calendar_day", "create calendar_day"]);
  assert.equal(ofKind(kv, "calendar_year").length, 1, "coverage id stays stable across re-ingest");
  assert.equal(ofKind(kv, "calendar_day").length, 1);

  await writes.ingest_court_calendar_year(store, { year: 2027, status: "unavailable" });
  const coverage = await reads.court_calendar_coverage(store, {});
  assert.equal(coverage.rows.length, 2);
  assert.equal(coverage.rows.find((row) => row.year === 2027).status, "unavailable");
  assert.equal(ofKind(kv, "calendar_day").length, 1, "2027 ingest with no days does not touch 2026's rows");
});

test("ingest_court_calendar_year refuses a day outside the given year before anything is sent", async (t) => {
  const { cloud, store } = await setup(t);
  await assert.rejects(
    () => writes.ingest_court_calendar_year(store, {
      year: 2026, status: "confirmed",
      days: [{ calendar_date: "2027-01-01", status_category: "full_closure", status_label: "New Year's Day" }],
    }),
    /does not fall within year/
  );
  await assert.rejects(() => writes.ingest_court_calendar_year(store, {
    year: 2026, status: "confirmed", days: [{ calendar_date: "2026-03-16", status_category: "limited" }],
  }), /status_label is required/);
  assert.equal(cloud.requests.length, 0);
});

test("court_calendar_days filters by date range; absent dates are ordinary open days", async (t) => {
  const { store } = await setup(t);
  await writes.ingest_court_calendar_year(store, {
    year: 2026, status: "confirmed",
    days: [
      { calendar_date: "2026-01-01", status_category: "full_closure", status_label: "New Year's Day" },
      { calendar_date: "2026-12-25", status_category: "full_closure", status_label: "Christmas Day" },
    ],
  });
  assert.equal((await reads.court_calendar_days(store, {})).rows.length, 2);
  const ranged = await reads.court_calendar_days(store, { from_date: "2026-02-01", to_date: "2026-12-31" });
  assert.deepEqual(ranged.rows.map((row) => row.calendar_date), ["2026-12-25"]);
  assert.equal(ranged.rows[0].status_category, "full_closure");
});

test("matter_lookup by matt_num returns the client-joined matter; unknown returns empty", async (t) => {
  const { store } = await setup(t);
  await seedMatter(store);
  const found = await practiceIndex.callPracticeTool(store, "practice_data__matter_lookup", { matt_num: ".L100" });
  assert.equal(found.rows.length, 1);
  assert.equal(found.rows[0].matt_num, "L100");
  assert.equal(found.rows[0].client_name, "Acme Co");
  assert.equal(found.rows[0].client_num, "C-1");
  assert.equal(found.rows[0].regular_trust, -500);
  assert.equal(found.rows[0].billable, true);
  const missing = await practiceIndex.callPracticeTool(store, "practice_data__matter_lookup", { matt_num: ".L999" });
  assert.deepEqual(missing.rows, []);
});

test("matt_num: the {client}.{matter} separator is stripped on write and either spelling resolves", async (t) => {
  const { kv, store } = await setup(t);
  await seedMatter(store);
  const stored = ofKind(kv, "matter");
  assert.equal(stored.length, 1);
  assert.equal(stored[0].data.matt_num, "L100");

  for (const spelling of [".L100", "L100", "8575.L100"]) {
    assert.equal((await reads.matter_lookup(store, { matt_num: spelling })).rows.length, 1, `matter_lookup missed ${spelling}`);
    assert.equal((await reads.trust_summary(store, { matt_num: spelling })).rows.length, 1, `trust_summary missed ${spelling}`);
    assert.equal(shared.resolveMatter(store.items(), { matt_num: spelling }).id, stored[0].id, `resolveMatter missed ${spelling}`);
  }

  // Re-importing the dotted spelling on the matt_num key path lands on the same matter.
  await seedMatter(store, { file_number: undefined, regular_trust: -750 });
  const after = ofKind(kv, "matter");
  assert.equal(after.length, 1);
  assert.equal(after[0].data.matt_num, "L100");
  assert.equal(after[0].data.regular_trust, -750);
  assert.equal(after[0].data.file_number, "F-100", "a field the re-import leaves out stays as it was");
});

test("matter_lookup by matter_id round-trips the id active_deadlines returns", async (t) => {
  const { store } = await setup(t);
  await seedMatter(store);
  await writes.upsert_anchor(store, {
    matt_num: "L100", anchor_type: "application_hearing_date", anchor_date: "2026-07-17",
    source_document: "Notice of Application", stated_date: "July 17, 2026",
  });
  const sweep = await reads.active_deadlines(store, {});
  assert.equal(sweep.anchors.length, 1);
  const found = await reads.matter_lookup(store, { matter_id: String(sweep.anchors[0].matter_id) });
  assert.equal(found.rows.length, 1);
  assert.equal(found.rows[0].matt_num, "L100");
  assert.equal(found.rows[0].client_name, "Acme Co");
  assert.deepEqual((await reads.matter_lookup(store, { matter_id: "no-such-id" })).rows, []);
});

test("active_deadlines rows carry matter identity on both anchors and deadlines", async (t) => {
  const { store } = await setup(t);
  const seeded = await seedMatter(store);
  await writes.upsert_anchor(store, {
    matt_num: "L100", anchor_type: "trial_date", anchor_date: "2026-09-01", source_document: "Notice of Trial", stated_date: "September 1, 2026",
  });
  await writes.upsert_deadline(store, {
    matter_id: seeded.matter_id, deadline_type: "trial_brief", deadline_date: "2026-08-04", rule_ref: "R. 12-1",
    rule_description: "Trial brief", source_type: "bc_rules", status: "active",
  });

  const sweep = await reads.active_deadlines(store, {});
  assert.equal(sweep.anchors.length, 1);
  assert.equal(sweep.anchors[0].matt_num, "L100");
  assert.equal(sweep.anchors[0].file_number, "F-100");
  assert.equal(sweep.anchors[0].matter_description, "Contract dispute");
  assert.equal(sweep.anchors[0].client_name, "Acme Co");
  assert.equal(sweep.anchors[0].client_num, "C-1");
  assert.equal(sweep.anchors[0].anchor_type, "trial_date");
  assert.equal(sweep.anchors[0].anchor_date, "2026-09-01");
  assert.equal(sweep.anchors[0].sources.length, 1);
  assert.equal(sweep.anchors[0].sources[0].status, "confirmed");
  assert.equal(sweep.deadlines.length, 1);
  assert.equal(sweep.deadlines[0].matt_num, "L100");
  assert.equal(sweep.deadlines[0].matter_description, "Contract dispute");
  assert.equal(sweep.deadlines[0].client_name, "Acme Co");
  assert.equal(sweep.deadlines[0].deadline_type, "trial_brief");
  assert.equal(sweep.deadlines[0].source_type, "bc_rules");
});

test("an occurred anchor drops from sweeps unless asked for", async (t) => {
  const kv = memoryKv();
  const store = new PracticeStore({}, kv);
  seedItems(kv, [
    { id: "m1", kind: "matter", data: { matt_num: "L100" }, tags: { billable: true }, state: null },
    { id: "a1", kind: "anchor", data: { anchor_date: "2026-07-17" }, tags: { anchor_type: "application_hearing_date" }, state: "occurred", links: { matter: "m1" } },
    { id: "a2", kind: "anchor", data: { anchor_date: "2026-08-17" }, tags: { anchor_type: "trial_date" }, state: "superseded", links: { matter: "m1" } },
    { id: "s1", kind: "anchor_source", data: { source_document: "Practitioner confirmation", source_excerpt: "Hearing held, not adjourned" }, state: "confirmed", links: { anchor: "a1" } },
  ]);
  assert.deepEqual((await reads.active_deadlines(store, {})).anchors, [], "occurred and superseded anchors are excluded by default");
  const withOccurred = await reads.active_deadlines(store, { include_occurred: true });
  assert.deepEqual(withOccurred.anchors.map((a) => a.id), ["a1"], "a superseded anchor never returns");
  assert.equal(withOccurred.anchors[0].status, "occurred");
  assert.match(String(withOccurred.anchors[0].sources[0].source_excerpt), /not adjourned/);
});

test("deadline defaults: not_applicable until notified, dismissed and met only on request, stale and superseded never", async (t) => {
  const kv = memoryKv();
  const store = new PracticeStore({}, kv);
  const deadline = (id, state, data = {}) => ({ id, kind: "deadline", data: { deadline_date: "2026-07-01", expiry_notified_at: null, ...data }, tags: { deadline_type: id, source_type: "bc_rules" }, state, links: { matter: "m1" } });
  seedItems(kv, [
    { id: "m1", kind: "matter", data: { matt_num: "L100" }, tags: { billable: true } },
    deadline("active_one", "active"),
    deadline("other_side", "not_applicable"),
    deadline("other_side_notified", "not_applicable", { expiry_notified_at: "2026-07-02T09:00:00.000Z" }),
    deadline("dismissed_one", "dismissed"),
    deadline("met_one", "met"),
    deadline("stale_one", "stale"),
    deadline("superseded_one", "superseded"),
  ]);
  const ids = async (args) => (await reads.active_deadlines(store, args)).deadlines.map((d) => d.id).sort();
  assert.deepEqual(await ids({}), ["active_one", "other_side"]);
  assert.deepEqual(await ids({ include_notified: true }), ["active_one", "other_side", "other_side_notified"]);
  assert.deepEqual(await ids({ include_dismissed: true }), ["active_one", "dismissed_one", "other_side"]);
  assert.deepEqual(await ids({ include_met: true, matt_num: "L100" }), ["active_one", "met_one", "other_side"]);

  const tools = schemaGen.practiceToolDefinitions();
  assert.ok(tools.find((tool) => tool.name === "practice_data__upsert_deadline").inputSchema.properties.status.enum.includes("met"));
  assert.deepEqual(tools.find((tool) => tool.name === "practice_data__active_deadlines").inputSchema.properties.include_met, { type: "boolean" });
});

test("upsert_anchor filing_ref: a filing only, refused before sending; linked, kept when omitted, cleared by null", async (t) => {
  const { cloud, store } = await setup(t);
  await seedMatter(store);
  const base = { matt_num: "L100", anchor_type: "application_hearing_date", anchor_date: "2026-07-17", source_document: "Notice of Hearing", stated_date: "July 17, 2026" };
  const sent = cloud.requests.length;
  for (const bad of ["proceeding:2", "filing:0", "filing:x", "2", ""]) {
    await assert.rejects(writes.upsert_anchor(store, { ...base, filing_ref: bad }), /filing_ref must be "filing:<id>"/, JSON.stringify(bad));
  }
  assert.equal(cloud.requests.length, sent, "a refused filing_ref sends nothing");

  const created = await writes.upsert_anchor(store, { ...base, filing_ref: "filing:3" });
  assert.equal(created.anchor.filing_ref, "filing:3");
  const kept = await writes.upsert_anchor(store, { ...base, source_document: "Practitioner confirmation" });
  assert.equal(kept.anchor.filing_ref, "filing:3", "an upsert that omits filing_ref leaves it");
  assert.equal("filing" in cloud.writes().at(-1).ops[0].links, false);
  assert.equal((await reads.active_deadlines(store, { matt_num: "L100" })).anchors[0].filing_ref, "filing:3");

  const cleared = await writes.upsert_anchor(store, { ...base, source_document: "Practitioner confirmation", filing_ref: null });
  assert.equal(cloud.writes().at(-1).ops[0].links.filing, null);
  assert.equal(cleared.anchor.filing_ref ?? null, null);
  assert.deepEqual(schemaGen.practiceToolDefinitions().find((tool) => tool.name === "practice_data__upsert_anchor").inputSchema.properties.filing_ref, { type: "string" });
});

test("set_time_entries_billable flips entries by id", async (t) => {
  const { store } = await setup(t);
  await seedMatter(store);
  const a = await writes.insert_time_entry(store, { matt_num: ".L100", entry_date: "2026-08-01", hours: 1, description: "A" });
  const b = await writes.insert_time_entry(store, { matt_num: ".L100", entry_date: "2026-08-02", hours: 2, description: "B" });

  const result = await writes.set_time_entries_billable(store, { entry_ids: [a.id], billable: false });
  assert.deepEqual(result, { updated: 1, ids: [a.id] });

  const { rows } = await reads.time_entries_query(store, { matt_num: ".L100" });
  const byId = new Map(rows.map((row) => [row.id, row]));
  assert.equal(byId.get(a.id).billable, false);
  assert.equal(byId.get(b.id).billable, true, "the other entry is untouched");
});

test("set_time_entries_billable resolves a batch_tag to ids here, and the tag never leaves the machine", async (t) => {
  const { cloud, store } = await setup(t);
  await seedMatter(store);
  for (const description of ["Note-up 1", "Note-up 2"]) {
    await writes.insert_time_entry(store, { matt_num: ".L100", entry_date: "2026-08-01", hours: 0.5, description, billable: false, batch_tag: "retire:7:2026-08-01" });
  }
  const untagged = await writes.insert_time_entry(store, { matt_num: ".L100", entry_date: "2026-08-01", hours: 1, description: "Ordinary" });

  const result = await writes.set_time_entries_billable(store, { batch_tag: "retire:7:2026-08-01", billable: true });
  assert.equal(result.updated, 2);
  const write = cloud.writes().at(-1);
  assert.deepEqual(write.ops.map((op) => [op.op, op.kind, op.tags]), [["update", "time_entry", { billable: true }], ["update", "time_entry", { billable: true }]]);
  assert.equal(JSON.stringify(cloud.requests.map((r) => r.raw)).includes("retire:7"), false);

  const { rows } = await reads.time_entries_query(store, { matt_num: ".L100" });
  assert.ok(rows.filter((row) => row.batch_tag === "retire:7:2026-08-01").every((row) => row.billable === true));
  assert.equal(rows.find((row) => row.id === untagged.id).billable, true);
});

test("set_time_entries_billable refuses both selectors and neither, and a batch_tag matching nothing", async (t) => {
  const { cloud, store } = await setup(t);
  await seedMatter(store);
  const sent = cloud.requests.length;
  await assert.rejects(() => writes.set_time_entries_billable(store, { entry_ids: ["x"], batch_tag: "t", billable: false }), /not both/);
  await assert.rejects(() => writes.set_time_entries_billable(store, { billable: false }), /requires entry_ids or batch_tag/);
  await assert.rejects(() => writes.set_time_entries_billable(store, { batch_tag: "retire:99:2026-08-01", billable: false }), /No time entries carry batch_tag/);
  assert.equal(cloud.requests.length, sent);
});

test("set_time_entries_billable narrows a batch_tag sweep to the given matter", async (t) => {
  const { store } = await setup(t);
  await seedMatter(store);
  await seedMatter(store, { matt_num: ".L200", file_number: "F-200", client_num: "C-2", name: "Beta Co" });
  const mine = await writes.insert_time_entry(store, { matt_num: ".L100", entry_date: "2026-08-01", hours: 1, description: "Mine", billable: false, batch_tag: "shared-tag" });
  const theirs = await writes.insert_time_entry(store, { matt_num: ".L200", entry_date: "2026-08-01", hours: 1, description: "Theirs", billable: false, batch_tag: "shared-tag" });

  const result = await writes.set_time_entries_billable(store, { batch_tag: "shared-tag", billable: true, matt_num: ".L100" });
  assert.deepEqual(result.ids, [mine.id]);
  const other = await reads.time_entries_query(store, { matt_num: ".L200" });
  assert.equal(other.rows.find((row) => row.id === theirs.id).billable, false, "the other matter's entry is untouched");
});

test("set_time_entries_billable flips every entry in a batch_tag sweep larger than 1000", async (t) => {
  const { cloud, kv, store } = await setup(t);
  seedBoth(kv, cloud, [
    { id: "00000000-0000-4000-8000-ffffffffffff", kind: "matter", data: { matt_num: "L100" }, tags: { billable: true } },
    ...Array.from({ length: 1001 }, (_, i) => ({
      id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`, kind: "time_entry",
      data: { entry_date: "2026-08-01", hours: 0.1, description: `Entry ${i}`, batch_tag: "big-batch" },
      tags: { billable: false }, links: { matter: "00000000-0000-4000-8000-ffffffffffff" },
    })),
  ]);
  const result = await writes.set_time_entries_billable(store, { batch_tag: "big-batch", billable: true });
  assert.equal(result.updated, 1001);
  const stored = ofKind(kv, "time_entry").filter((row) => row.data.batch_tag === "big-batch");
  assert.equal(stored.length, 1001);
  assert.ok(stored.every((row) => row.tags.billable === true), "no entry past the 1000th is left unflipped");
});

test("today() is the local date, not the UTC date, in a Vancouver evening", async (t) => {
  const { today } = await import("../build/tools/practice/contacts.js");
  const tz = process.env.TZ;
  process.env.TZ = "America/Vancouver";
  t.after(() => {
    if (tz === undefined) delete process.env.TZ;
    else process.env.TZ = tz;
  });
  // 20:30 on 2026-10-24 in Vancouver is already 2026-10-25 in UTC.
  t.mock.timers.enable({ apis: ["Date"], now: Date.parse("2026-10-25T03:30:00Z") });
  assert.equal(today(), "2026-10-24");
});
