// The practice write sequence against a fake Probanda's Cloud
// (docs/Plans/2026-10-14_practice-db-conversion.md, step 5): the ops sent, that no clear data
// value and no hash_key leaves the machine, that a refusal or an unreachable cloud writes
// nothing locally, that a write saved but not applied, or reset on the way, is replayed, and
// that reads never call the cloud.

import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { fakeCloudKeyStore } from "./helpers/fake-cloud-key-store.mjs";
import { memoryKv, seedItems, startFakeCloud } from "./helpers/fake-cloud.mjs";

// The no-credential test reads Credential Manager; a fake keeps it off the practitioner's real entry.
const { setCloudKeyStore } = await import("../../../mcp-shared/commons-key.js");
setCloudKeyStore(fakeCloudKeyStore());

const { PracticeStore } = await import("../build/practice/store.js");
const { callPracticeTool } = await import("../build/tools/practice/index.js");
const writes = await import("../build/tools/practice/writes.js");
const reads = await import("../build/tools/practice/reads.js");
const ruleOverlay = await import("../build/tools/practice/rule-overlay.js");

const UNREACHABLE = /^Probanda's Cloud did not answer \((.+)\)\. Nothing was saved, in the cloud or in practice\.db\. If this persists, check whether the Supabase project is paused\.$/;
const HEX64 = /^[0-9a-f]{64}$/;

async function setup(t) {
  const cloud = await startFakeCloud(t);
  const kv = memoryKv();
  const store = new PracticeStore({ ...cloud.env }, kv);
  return { cloud, kv, store };
}

const entries = (kv, ns) => [...(kv.namespaces.get(ns)?.entries() ?? [])];
const meta = (kv, key) => JSON.parse(kv.namespaces.get("meta").get(key));
const items = (kv) => new Map(entries(kv, "item").map(([id, v]) => [id, JSON.parse(v)]));

async function seedMatter(store) {
  return writes.upsert_client_matter(store, {
    client_num: "C-1", name: "Acme Co", matt_num: ".L100", file_number: "F-100", description: "Contract dispute", regular_trust: -500,
  });
}

test("a write sends ids, kind, tags, state and links raw, and every data field as a keyed hash", async (t) => {
  const { cloud, kv, store } = await setup(t);
  await writes.upsert_client_matter(store, {
    client_num: "C-1", name: "Acme Co", matt_num: ".L100", file_number: "F-100", description: "Contract dispute", status: "active", billable: false,
  });
  const [write] = cloud.writes();
  assert.equal(write.store, "practice");
  assert.equal(write.tool, "upsert_client_matter");
  assert.deepEqual(write.intent, {});
  assert.equal(write.tenant, meta(kv, "tenant"));
  const [client, matter] = write.ops;
  assert.deepEqual(Object.keys(client).sort(), ["hashes", "id", "kind", "op"]);
  assert.equal(client.op, "upsert");
  assert.equal(client.kind, "client");
  assert.deepEqual(Object.keys(client.hashes).sort(), ["client_num", "name"], "only the fields given are sent");
  assert.equal(matter.kind, "matter");
  assert.equal(matter.state, "active");
  assert.deepEqual(matter.tags, { billable: false });
  assert.deepEqual(matter.links, { client: client.id });
  for (const op of write.ops) for (const value of Object.values(op.hashes)) assert.match(value, HEX64);

  // HMAC-SHA256 of the value's JSON under the stored hash_key; the field name is not hashed.
  const key = Buffer.from(meta(kv, "hash_key"), "base64");
  assert.equal(key.length, 32);
  const hmac = (value) => createHmac("sha256", key).update(JSON.stringify(value)).digest("hex");
  assert.equal(client.hashes.client_num, hmac("C-1"));
  assert.equal(matter.hashes.matt_num, hmac("L100"), "the matter reference is normalized before it is hashed");
});

test("no clear data value and no hash_key appears in any request body", async (t) => {
  const { cloud, kv, store } = await setup(t);
  const seeded = await seedMatter(store);
  await writes.insert_time_entry(store, { matt_num: "L100", entry_date: "2026-08-01", hours: 1.5, description: "Drafted the reply to Acme", batch_tag: "retire:7:2026-08-01" });
  await writes.upsert_task(store, { matt_num: "L100", task_type: "client", description: "Settle the opening submissions", deadline_date: "2026-09-30" });
  await writes.upsert_anchor(store, { matt_num: "L100", anchor_type: "trial_date", anchor_date: "2026-09-01", source_document: "Notice of Trial", stated_date: "September 1, 2026", source_excerpt: "Trial set for ten days", party_label: "Plaintiff Acme" });
  await writes.upsert_deadline(store, { matter_id: seeded.matter_id, deadline_type: "trial_brief", deadline_date: "2026-08-04", rule_ref: "R. 12-1", rule_description: "Trial brief due", source_type: "bc_rules", review_note: "Check the trial management order" });
  await writes.upsert_signal(store, { matt_num: "L100", signal_key: "conflict_check_completed", state: "confirmed", note: "Cleared against Beta Corp" });
  await writes.manage_payment_in_flight(store, { action: "record", matt_num: "L100", amount: 1234.56, notes: "Cheque from Acme" });
  await writes.record_retainer_notice(store, { matt_num: "L100", sent_at: "2026-08-02T10:00:00.000Z" });

  const clear = [
    "Acme Co", "C-1", "L100", "F-100", "Contract dispute", "Drafted the reply to Acme", "retire:7:2026-08-01", "2026-08-01",
    "Settle the opening submissions", "2026-09-30", "2026-09-01", "Notice of Trial", "September 1, 2026", "Trial set for ten days",
    "Plaintiff Acme", "2026-08-04", "R. 12-1", "Trial brief due", "Check the trial management order", "Cleared against Beta Corp",
    "1234.56", "Cheque from Acme", "2026-08-02T10:00:00.000Z",
  ];
  const hashKey = meta(kv, "hash_key");
  const hashKeyHex = Buffer.from(hashKey, "base64").toString("hex");
  assert.ok(cloud.requests.length >= 16);
  for (const { raw, path } of cloud.requests) {
    for (const value of clear) assert.equal(raw.includes(value), false, `${path} carries "${value}"`);
    assert.equal(raw.includes(hashKey), false, `${path} carries the hash_key`);
    assert.equal(raw.includes(hashKeyHex), false, `${path} carries the hash_key as hex`);
  }
  // The data stays on this machine, under the item the cloud named.
  const entry = [...items(kv).values()].find((item) => item.kind === "time_entry");
  assert.equal(entry.data.description, "Drafted the reply to Acme");
  assert.equal(entry.data.batch_tag, "retire:7:2026-08-01");
});

test("a retainer notice keeps its amount and copy on this machine, and a notice without them stays valid", async (t) => {
  const { cloud, kv, store } = await setup(t);
  const { matter_id } = await seedMatter(store);
  await writes.upsert_task(store, { matt_num: "L100", task_type: "client", description: "Check for reply to the invented letter" });
  await writes.record_retainer_notice(store, { matt_num: "L100", sent_at: "2026-08-01" });
  const { id } = await writes.record_retainer_notice(store, {
    matt_num: "L100", sent_at: "2026-08-02", amount_requested: 4321.09, source_path: "Correspondence/invented letter.pdf",
  });

  const [op] = cloud.writes().at(-1).ops;
  assert.equal(op.kind, "retainer_notice");
  assert.deepEqual(op.links, { matter: matter_id });
  assert.deepEqual(Object.keys(op.hashes).sort(), ["amount_requested", "sent_at", "source_path"]);
  for (const value of Object.values(op.hashes)) assert.match(value, HEX64);
  assert.deepEqual(items(kv).get(id).data, { sent_at: "2026-08-02", amount_requested: 4321.09, source_path: "Correspondence/invented letter.pdf" });
  for (const { raw, path } of cloud.requests) {
    for (const value of ["4321.09", "invented letter.pdf", "2026-08-02"]) assert.equal(raw.includes(value), false, `${path} carries "${value}"`);
  }

  const bare = cloud.writes().at(-2).ops[0];
  assert.deepEqual(Object.keys(bare.hashes), ["sent_at"], "only the fields given are sent");
  const { rows } = await reads.open_tasks(store, { matt_num: "L100" });
  assert.equal(rows[0].last_retainer_notice_at, "2026-08-02");
  assert.equal(rows[0].description, "Check for reply to the invented letter", "a to-do needs no filing_ref");
});

test("a null field is sent as null, an empty label as null, and equal values hash equally across fields", async (t) => {
  const { cloud, store } = await setup(t);
  await seedMatter(store);
  await writes.upsert_anchor(store, { matt_num: "L100", anchor_type: "trial_date", anchor_date: "2026-09-01", source_document: "Notice of Trial", stated_date: "2026-09-01", party_label: "" });
  const write = cloud.writes().at(-1);
  assert.deepEqual(write.intent, { resolve: false, amend: false, occurred: false });
  const [anchor, source] = write.ops;
  assert.equal(anchor.op, "upsert");
  assert.equal("state" in anchor, false, "an anchor's state is the cloud's");
  assert.equal(anchor.hashes.party_label, null, "an empty label is sent as null, not as the hash of \"\"");
  assert.equal(anchor.hashes.proceeding_label, null);
  assert.equal(source.op, "create");
  assert.equal(source.kind, "anchor_source");
  assert.deepEqual(source.links, { anchor: anchor.id });
  assert.equal(source.hashes.source_excerpt, null);
  assert.equal(source.hashes.asserted_date, anchor.hashes.anchor_date, "the value is hashed, not the field name");
  assert.equal(source.hashes.stated_date, anchor.hashes.anchor_date);
});

test("a refused write writes nothing locally and returns the question with its item described", async (t) => {
  const { cloud, kv, store } = await setup(t);
  await seedMatter(store);
  const first = await writes.upsert_task(store, { matt_num: "L100", task_type: "client", description: "Settle the opening submissions", filing_ref: "filing:1" });
  const before = JSON.stringify(entries(kv, "item"));
  cloud.refuse = (write) => write.tool === "upsert_task"
    ? `Is this work part of the open to-do {{item:${first.id}}}, which already covers this filing?`
    : undefined;

  await assert.rejects(
    writes.upsert_task(store, { matt_num: "L100", task_type: "client", description: "Draft the reply", filing_ref: "filing:1" }),
    (err) => {
      assert.equal(err.code, "refused");
      assert.equal(err.message, `Is this work part of the open to-do ${first.id} "Settle the opening submissions", which already covers this filing?`);
      return true;
    }
  );
  assert.equal(JSON.stringify(entries(kv, "item")), before, "no item changed");
  assert.deepEqual(entries(kv, "pending"), [], "the pending entry is removed");
});

for (const [mode, detail] of [["refused", /ECONNREFUSED/], ["html", /not JSON/], ["http500", /^HTTP 500$/], ["nosaved", /no saved field/]]) {
  test(`a cloud that ${{ refused: "refuses the connection", html: "answers with HTML", http500: "answers HTTP 500", nosaved: "answers without saved" }[mode]} writes nothing, says so and is not retried`, async (t) => {
    const { cloud, kv, store } = await setup(t);
    await seedMatter(store);
    const before = JSON.stringify(entries(kv, "item"));
    const sent = cloud.writes().length;
    let target = store;
    if (mode === "refused") {
      const closed = createServer();
      await new Promise((resolve) => closed.listen(0, "127.0.0.1", resolve));
      const { port } = closed.address();
      await new Promise((resolve) => closed.close(resolve));
      target = new PracticeStore({ ...cloud.env, SUPABASE_URL: `http://127.0.0.1:${port}` }, kv);
    } else {
      cloud.mode = mode;
    }
    await assert.rejects(writes.upsert_task(target, { matt_num: "L100", task_type: "admin", description: "File the report" }), (err) => {
      assert.match(err.message, UNREACHABLE);
      assert.match(err.message.match(UNREACHABLE)[1], detail);
      assert.equal(err.code, "cloud_unreachable");
      return true;
    });
    assert.equal(cloud.writes().length, sent + (mode === "refused" ? 0 : 1), "sent once at most, never retried");
    assert.equal(JSON.stringify(entries(kv, "item")), before);
    assert.deepEqual(entries(kv, "pending"), [], "nothing reached the cloud, so nothing is kept");
  });
}

const tasks = (kv) => [...items(kv).values()].filter((item) => item.kind === "task");
const cloudTasks = (cloud, kv) => [...cloud.ledger(meta(kv, "tenant")).items.values()].filter((item) => item.kind === "task" && !item.deleted);

for (const [mode, saved] of [["down", "before the cloud saved it"], ["lost-reply", "after the cloud saved it"], ["cut-reply", "part-way through the cloud's reply"]]) {
  test(`a connection reset ${saved} keeps the write pending, and the next practice tool call applies it once (#162)`, async (t) => {
    const { cloud, kv, store } = await setup(t);
    await seedMatter(store);
    cloud.mode = mode;
    await assert.rejects(writes.upsert_task(store, { matt_num: "L100", task_type: "client", description: "Settle the opening submissions" }), (err) => {
      assert.equal(err.code, "write_pending");
      assert.match(err.message, /^Probanda's Cloud may have saved this write: the connection was reset before its answer arrived \(.*(ECONNRESET|UND_ERR_SOCKET|terminated).*\)\. It is kept as pending write [0-9a-f-]+, and the next practice tool call sends it again with the same write_id: the cloud saves it once, or answers with a question\. Do not repeat this call\.$/);
      return true;
    });
    const [[writeId]] = entries(kv, "pending");
    assert.deepEqual(tasks(kv), [], "nothing applied yet");

    cloud.mode = "ok";
    const result = await callPracticeTool(store, "practice_data__open_tasks", {});
    assert.deepEqual(result.replayed_writes, [{ write_id: writeId, tool: "upsert_task", saved: true }]);
    assert.equal(result.rows.length, 1);
    assert.equal(result.rows[0].description, "Settle the opening submissions");
    assert.equal(tasks(kv).length, 1, "applied once in practice.db");
    assert.equal(cloudTasks(cloud, kv).length, 1, "saved once in the cloud");
    assert.equal(store.pendingCount(), 0);
  });
}

test("a timed-out request keeps the write pending, never reports it unsaved: the cloud may have it", async (t) => {
  const { store } = await setup(t);
  await seedMatter(store);
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
  };
  t.after(() => {
    globalThis.fetch = realFetch;
  });
  await assert.rejects(writes.upsert_task(store, { matt_num: "L100", task_type: "client", description: "Settle it" }), { code: "write_pending" });
  assert.equal(store.pendingCount(), 1);
});

test("a reset write the cloud refuses on replay returns its question in replayed_writes, with the item described (#162)", async (t) => {
  const { cloud, kv, store } = await setup(t);
  await seedMatter(store);
  cloud.mode = "down";
  await assert.rejects(writes.upsert_task(store, { matt_num: "L100", task_type: "client", description: "Settle it" }), { code: "write_pending" });
  const [[writeId]] = entries(kv, "pending");

  cloud.mode = "ok";
  cloud.refuse = (write) => (write.tool === "upsert_task" ? `Is {{item:${write.ops[0].id}}} still wanted?` : undefined);
  const result = await callPracticeTool(store, "practice_data__open_tasks", {});
  assert.equal(result.replayed_writes.length, 1);
  const [replay] = result.replayed_writes;
  assert.deepEqual({ ...replay, question: undefined }, { write_id: writeId, tool: "upsert_task", saved: false, question: undefined });
  assert.match(replay.question, /^Is .+ still wanted\?$/);
  assert.doesNotMatch(replay.question, /\{\{item:/);
  assert.deepEqual(result.rows, []);
  assert.equal(store.pendingCount(), 0);
});

test("a refused replay's question reaches the caller when the tool that replayed it then fails (#162)", async (t) => {
  const { cloud, kv, store } = await setup(t);
  await seedMatter(store);
  cloud.mode = "down";
  await assert.rejects(writes.upsert_task(store, { matt_num: "L100", task_type: "client", description: "Settle it" }), { code: "write_pending" });
  const [[writeId]] = entries(kv, "pending");

  cloud.mode = "ok";
  cloud.refuse = (write) => (write.tool === "upsert_task" ? "Is this task still wanted?" : undefined);
  await assert.rejects(
    callPracticeTool(store, "practice_data__upsert_task", { matt_num: "L100", task_type: "admin", description: "File the report" }),
    (err) => {
      assert.equal(err.code, "refused");
      assert.ok(err.message.endsWith(` Before this call, Probanda's Cloud refused pending write ${writeId} (upsert_task): Is this task still wanted?`), err.message);
      return true;
    }
  );
  assert.equal(store.pendingCount(), 0);
});

test("a wrong key gets the unreachable message with its status", async (t) => {
  const { cloud, kv } = await setup(t);
  const store = new PracticeStore({ ...cloud.env, LEGAL_COMMONS_SUPABASE_KEY: "sb_secret_wrong" }, kv);
  await assert.rejects(writes.upsert_task(store, { task_type: "admin", description: "File the report" }), (err) => {
    assert.match(err.message, UNREACHABLE);
    assert.equal(err.message.match(UNREACHABLE)[1], "HTTP 401");
    return true;
  });
  assert.deepEqual(entries(kv, "item"), []);
});

test("no credential: the write fails naming cloud_key__configure_credential, and nothing is sent or stored", async (t) => {
  const cloud = await startFakeCloud(t);
  const localAppData = mkdtempSync(join(tmpdir(), "coclerk-practice-nokey-"));
  t.after(() => rmSync(localAppData, { recursive: true, force: true }));
  const kv = memoryKv();
  const store = new PracticeStore({ SUPABASE_URL: cloud.env.SUPABASE_URL, LOCALAPPDATA: localAppData }, kv);
  await assert.rejects(writes.upsert_task(store, { task_type: "admin", description: "File the report" }), (err) => {
    assert.equal(err.code, "cloud_not_configured");
    assert.match(err.message, /^Probanda's Cloud is not configured: no credential is configured; set it with cloud_key__configure_credential, or ask Probanda for a key with key_request__submit\. Nothing was saved\.$/);
    return true;
  });
  assert.equal(cloud.requests.length, 0);
  assert.deepEqual(entries(kv, "pending"), []);
  assert.deepEqual(entries(kv, "item"), []);
});

test("reads never call the cloud, even when it cannot be reached", async (t) => {
  const { cloud, kv, store } = await setup(t);
  await seedMatter(store);
  cloud.mode = "down";
  const sent = cloud.requests.length;
  const reads = [
    ["practice_data__matter_lookup", { matt_num: "L100" }],
    ["practice_data__trust_summary", {}],
    ["practice_data__wip_hours", {}],
    ["practice_data__open_tasks", {}],
    ["practice_data__active_deadlines", {}],
    ["practice_data__ar_data", {}],
    ["practice_data__read_signals", { matt_num: "L100" }],
    ["practice_data__time_entries_query", {}],
    ["practice_data__court_calendar_coverage", {}],
    ["practice_data__court_calendar_days", {}],
    ["practice_data__invoices_query", {}],
    ["practice_data__rule_overlay", {}],
    ["practice_data__manage_payment_in_flight", { action: "query" }],
  ];
  for (const [name, args] of reads) await callPracticeTool(store, name, args);
  assert.equal(cloud.requests.length, sent);
  assert.equal((await callPracticeTool(store, "practice_data__matter_lookup", { matt_num: "L100" })).rows[0].client_name, "Acme Co");
  assert.ok(kv.namespaces.get("item").size > 0);
});

test("a write the cloud saved but practice.db did not apply stays pending and is replayed with its write_id", async (t) => {
  const { cloud, kv, store } = await setup(t);
  await seedMatter(store);
  cloud.mode = "sync-down";
  await assert.rejects(writes.upsert_task(store, { matt_num: "L100", task_type: "client", description: "Settle the opening submissions" }), (err) => {
    assert.equal(err.code, "write_pending");
    assert.match(err.message, /saved this write, but it could not be applied to practice\.db/);
    return true;
  });
  const [[writeId]] = entries(kv, "pending");
  assert.equal(store.pendingCount(), 1);
  assert.equal([...items(kv).values()].some((item) => item.kind === "task"), false, "nothing applied yet");

  // A read whose replay cannot reach the cloud still answers, the write kept.
  cloud.mode = "down";
  const offline = await callPracticeTool(store, "practice_data__open_tasks", {});
  assert.deepEqual(offline.rows, []);
  assert.equal(store.pendingCount(), 1);

  cloud.mode = "ok";
  const result = await callPracticeTool(store, "practice_data__open_tasks", {});
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].description, "Settle the opening submissions");
  assert.deepEqual(result.replayed_writes, [{ write_id: writeId, tool: "upsert_task", saved: true }]);
  const sentIds = cloud.writes().filter((w) => w.tool === "upsert_task").map((w) => w.write_id);
  assert.ok(sentIds.length >= 2 && sentIds.every((id) => id === writeId), "every replay carries the original write_id");
  assert.equal(store.pendingCount(), 0);
});

test("the guard refuses a raw value that is not a vocabulary value, naming the field, and sends nothing", async (t) => {
  const { cloud, kv, store } = await setup(t);
  await seedMatter(store);
  const sent = cloud.requests.length;
  await assert.rejects(
    writes.upsert_signal(store, { matt_num: "L100", signal_key: "Conflict check for Acme", state: "confirmed" }),
    /Refused before anything was sent to Probanda's Cloud: tag signal_key of op signal [0-9a-f-]+ is not a vocabulary value/
  );
  await assert.rejects(
    writes.set_status(store, { matt_num: "L100", status_label: "Active L8443" }),
    /the state of op matter [0-9a-f-]+ is not a vocabulary value/
  );
  assert.equal(cloud.requests.length, sent);
  assert.deepEqual(entries(kv, "pending"), []);
});

test("a rule overlay record carrying a matter code is refused, naming the field, and sends nothing", async (t) => {
  const { cloud, store } = await setup(t);
  const record = { deadline_type: "x", amending_instrument: { reg: "B.C. Reg. 1/2027" }, description: "Applies to L8443 only", status: "unverified" };
  await assert.rejects(ruleOverlay.upsert_rule_overlay(store, { record }), /record\.description carries a client matter code/);
  await assert.rejects(
    ruleOverlay.upsert_rule_overlay(store, { record: { ...record, description: "ok", amending_instrument: { reg: "B.C. Reg. L8443" } } }),
    /tag amending_reg of op rule_overlay [0-9a-f-]+ carries a client matter code/
  );
  assert.equal(cloud.requests.length, 0);
});

test("an op the cloud matched without saving its data leaves that item's data as it was", async (t) => {
  const { kv, store } = await setup(t);
  await seedMatter(store);
  const base = { matt_num: "L100", anchor_type: "trial_date" };
  const first = await writes.upsert_anchor(store, { ...base, anchor_date: "2026-09-01", source_document: "Notice of Trial", stated_date: "2026-09-01" });
  const second = await writes.upsert_anchor(store, { ...base, anchor_date: "2026-10-15", source_document: "TMC Order", stated_date: "2026-10-15" });
  assert.equal(second.conflict, true);
  assert.equal(second.anchor.id, first.anchor.id);
  assert.equal(second.anchor.anchor_date, "2026-09-01", "the anchor op was not saved, so its date is not written");
  const sources = [...items(kv).values()].filter((item) => item.kind === "anchor_source");
  assert.deepEqual(sources.map((s) => s.data.asserted_date).sort(), ["2026-09-01", "2026-10-15"]);
  assert.ok(sources.every((s) => s.links.anchor === first.anchor.id), "the sources hang under the anchor the cloud named");
});

test("seeded items read back as the old rows: tags, state under its old name, links as <role>_id and filing_ref", async (t) => {
  const kv = memoryKv();
  const store = new PracticeStore({}, kv);
  seedItems(kv, [
    { id: "m1", kind: "matter", data: { matt_num: "L1" }, tags: { billable: true }, state: "active", links: { client: "c1" } },
    { id: "p1", kind: "payment", data: { amount: 5 }, state: "false", links: { matter: "m1" } },
    { id: "s1", kind: "signal", tags: { signal_key: "deposit_received" }, state: "confirmed", links: { matter: "m1" } },
    { id: "t1", kind: "task", data: { description: "x" }, tags: { task_type: "client" }, state: "open", links: { matter: "m1", filing: "filing:2" } },
  ]);
  const [matter] = store.rows("matter");
  assert.deepEqual({ ...matter, created_at: undefined, updated_at: undefined }, { id: "m1", matt_num: "L1", billable: true, status: "active", client_id: "c1", created_at: undefined, updated_at: undefined });
  assert.equal("owner_id" in matter, false);
  assert.equal(store.rows("payment")[0].cleared, false);
  assert.equal(store.rows("signal")[0].state, "confirmed");
  assert.equal(store.rows("task")[0].filing_ref, "filing:2");
  assert.equal(store.rows("task")[0].matter_id, "m1");
});

test("a write after the event loop was blocked past the fake's old 5 s keep-alive timeout still reaches the cloud (#154)", async (t) => {
  const { cloud, store } = await setup(t);
  await seedMatter(store);
  // Blocks the loop as SqlitePracticeKv's synchronous Python does on a loaded runner.
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 6000);
  await writes.upsert_task(store, { matt_num: ".L100", task_type: "client", description: "Settle it" });
  assert.equal(cloud.writes().length, 2);
});

test("a write after the cloud closed its idle socket during a long block is never reported as unsaved, and is applied once (#162)", async (t) => {
  // Node's 5 s default keep-alive and a 6 s block reproduce the reset of #154 against the store.
  const cloud = await startFakeCloud(t, { keepAliveTimeout: 5000 });
  const kv = memoryKv();
  const store = new PracticeStore({ ...cloud.env }, kv);
  await seedMatter(store);
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 6000);
  try {
    await writes.upsert_task(store, { matt_num: ".L100", task_type: "client", description: "Settle it" });
  } catch (err) {
    assert.equal(err.code, "write_pending", "a reset keeps the write: never cloud_unreachable");
    assert.equal(store.pendingCount(), 1);
    await callPracticeTool(store, "practice_data__open_tasks", {});
  }
  assert.equal(tasks(kv).length, 1);
  assert.equal(store.pendingCount(), 0);
});
