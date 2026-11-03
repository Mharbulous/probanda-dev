// timecamping_data__calls: a matter's calls matched through practice contacts on phone digits,
// the contacts it could not search, the dates no archive covers, and the no-matter mode.

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { startFakeCloud } from "./helpers/fake-cloud.mjs";

const { PracticeStore } = await import("../build/practice/store.js");
const writes = await import("../build/tools/practice/writes.js");
const contacts = await import("../build/tools/practice/contacts.js");
const { timecampingDataBulkUpsert } = await import("../build/timecamping/backend.js");
const { timecampingCalls } = await import("../build/timecamping/calls.js");
const { timecampingDataMigrate } = await import("../build/timecamping/migrate.js");

function call(nativeId, date, number, extra = {}) {
  return {
    table: "telus_calls",
    key: ["native_id"],
    row: {
      native_id: nativeId, start_ts: `${date}T20:00:00Z`, end_ts: `${date}T20:12:18Z`, local_date: date,
      phone_number: number, contact_name: "", action: "VoIP Call", action_result: "Call connected",
      result_description: "", duration_seconds: 738, raw_type: "phone_call", is_internal: 0,
      raw_payload: JSON.stringify({ direction: "Outgoing" }), fetched_at: "2026-11-03T00:00:00Z", ...extra,
    },
  };
}

function covered(date, status = "fetched") {
  return {
    table: "source_fetch_log",
    key: ["source_name", "local_date"],
    row: { source_name: "telus_calls", local_date: date, status, row_count: 0, error_detail: null, fetched_at: "2026-11-03T00:00:00Z" },
  };
}

async function setup(t) {
  const dir = mkdtempSync(join(tmpdir(), "coclerk-timecamping-calls-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const appData = join(dir, "appdata");
  mkdirSync(join(appData, "Coclerk"), { recursive: true });
  const root = join(dir, "0. CASE DATA");
  mkdirSync(join(root, "_practice"), { recursive: true });
  writeFileSync(join(appData, "Coclerk", "coclerk.json"), JSON.stringify({ case_data_root: root }));
  const cloud = await startFakeCloud(t);
  const env = { ...process.env, ...cloud.env, APPDATA: appData, COCLERK_DB_PATH: join(dir, `${randomUUID()}.db`) };
  await timecampingDataMigrate(env);
  const store = new PracticeStore(env);

  await writes.upsert_client_matter(store, { client_num: "C-1", name: "Client One", matt_num: "L101", file_number: "F-1" });
  await writes.upsert_client_matter(store, { client_num: "C-2", name: "Client Two", matt_num: "L102", file_number: "F-2" });
  const client = await contacts.upsert_contact(store, { entity: "person", name: "Dana Client", phones: ["604.555.0101"] });
  const counsel = await contacts.upsert_contact(store, { entity: "person", name: "Robin Counsel", phones: ["(604) 555-0102", "1-604-555-0103"] });
  const nophone = await contacts.upsert_contact(store, { entity: "person", name: "Sam Nophone" });
  const stranger = await contacts.upsert_contact(store, { entity: "person", name: "Other Matter", phones: ["604-555-0104"] });
  await contacts.upsert_matter_role(store, { matt_num: "L101", contact_id: client.contact_id, role: "client" });
  await contacts.upsert_matter_role(store, { matt_num: "L101", contact_id: counsel.contact_id, role: "opposing_counsel" });
  await contacts.upsert_matter_role(store, { matt_num: "L101", contact_id: nophone.contact_id, role: "witness" });
  await contacts.upsert_matter_role(store, { matt_num: "L102", contact_id: stranger.contact_id, role: "client" });

  const ingest = join(dir, "calls.jsonl");
  const lines = [
    call("c2026-05-28T13:08+16045550101", "2026-05-28", "+16045550101"),
    call("c2026-05-28T13:09+16045550101", "2026-05-28", "+16045550101", {
      action_result: "Missed", duration_seconds: 0, raw_payload: JSON.stringify({ direction: "Incoming" }),
    }),
    call("c2026-05-28T14:00+16045550103", "2026-05-28", "+16045550103", { contact_name: "R Counsel" }),
    call("c2026-05-29T10:00+16045550104", "2026-05-29", "+16045550104"),
    call("c2026-05-29T11:00+16045550105", "2026-05-29", "+16045550105", { raw_payload: "{}" }),
    call("c2026-05-29T12:00anonymous", "2026-05-29", "anonymous"),
    call("c2026-05-29T12:30+10", "2026-05-29", "10", { is_internal: 1 }),
    covered("2026-05-28"),
    covered("2026-05-29", "empty"),
    covered("2026-05-30", "skipped"),
  ];
  writeFileSync(ingest, lines.map((l) => JSON.stringify(l)).join("\n") + "\n", "utf-8");
  await timecampingDataBulkUpsert(ingest, env);
  return { store, env, client, counsel, nophone, stranger };
}

test("a matter's calls match its contacts' numbers across formats, with every outcome", async (t) => {
  const { store, env, client, counsel, nophone } = await setup(t);
  const result = await timecampingCalls({ from: "2026-05-28", to: "2026-05-29", matter: "L101" }, store, env);
  assert.deepEqual(result.calls.map((c) => [c.date, c.time, c.direction, c.duration_seconds, c.action_result, c.number]), [
    ["2026-05-28", "13:08", "Outgoing", 738, "Call connected", "+16045550101"],
    ["2026-05-28", "13:09", "Incoming", 0, "Missed", "+16045550101"],
    ["2026-05-28", "14:00", "Outgoing", 738, "Call connected", "+16045550103"],
  ]);
  assert.deepEqual(result.calls[0].contacts, [{ contact_id: client.contact_id, name: "Dana Client", role: "client", matt_num: "L101" }]);
  assert.equal(result.calls[2].contact_name, "R Counsel");
  assert.equal(result.calls[2].contacts[0].contact_id, counsel.contact_id);
  assert.deepEqual(result.contacts_without_phone, [{ contact_id: nophone.contact_id, name: "Sam Nophone", role: "witness" }]);
  assert.deepEqual([...result.numbers_searched].sort(), ["6045550101", "6045550102", "6045550103"]);
  assert.deepEqual(result.uncovered_dates, []);
});

test("numbers from an intake form are searched alongside the matter's contacts", async (t) => {
  const { store, env } = await setup(t);
  const result = await timecampingCalls({ from: "2026-05-29", to: "2026-05-29", matter: "L101", numbers: ["604 555 0105"] }, store, env);
  assert.deepEqual(result.calls.map((c) => [c.number, c.direction, c.contacts]), [["+16045550105", null, []]]);
  assert.ok(result.numbers_searched.includes("6045550105"));
});

test("a date no archive read is uncovered, and a skipped date is not covered", async (t) => {
  const { store, env } = await setup(t);
  const result = await timecampingCalls({ from: "2026-05-28", to: "2026-06-01", matter: "L101" }, store, env);
  assert.deepEqual(result.uncovered_dates, ["2026-05-30", "2026-05-31", "2026-06-01"]);
});

test("without a matter every call returns, each with its contacts and their matters", async (t) => {
  const { store, env, stranger } = await setup(t);
  const result = await timecampingCalls({ from: "2026-05-29", to: "2026-05-29" }, store, env);
  assert.deepEqual(result.calls.map((c) => c.number), ["+16045550104", "+16045550105", "anonymous", "10"]);
  assert.deepEqual(result.calls[0].contacts, [{ contact_id: stranger.contact_id, name: "Other Matter", role: "client", matt_num: "L102" }]);
  assert.deepEqual(result.calls[3].contacts, [], "an extension never matches a contact");
  assert.deepEqual(result.contacts_without_phone, []);
});

test("without a matter, numbers narrow the result", async (t) => {
  const { store, env } = await setup(t);
  const result = await timecampingCalls({ from: "2026-05-28", to: "2026-05-29", numbers: ["6045550105"] }, store, env);
  assert.deepEqual(result.calls.map((c) => c.number), ["+16045550105"]);
});

test("a bad range and an unknown matter are refused", async (t) => {
  const { store, env } = await setup(t);
  await assert.rejects(timecampingCalls({ from: "2026-06-01", to: "2026-05-01" }, store, env), /from and to/);
  await assert.rejects(timecampingCalls({ from: "May 1", to: "2026-05-01" }, store, env), /from and to/);
  await assert.rejects(timecampingCalls({ from: "2026-05-01", to: "2026-05-02", matter: "L999" }, store, env), /No matter matched/);
});
