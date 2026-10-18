import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { startFakeCloud } from "./helpers/fake-cloud.mjs";

const { PracticeStore } = await import("../build/practice/store.js");
const { callTool } = await import("../build/dispatch.js");

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
// A synthetic code of the client matter-code shape, built at runtime so this file holds
// no matter-code literal.
const MATTER_CODE = ["L", "0000"].join("");

const FIXTURE = JSON.parse(
  readFileSync(new URL("./fixtures/rule-overlay/rule-8-1-14-5-a.json", import.meta.url), "utf-8")
);

function record(changes = {}) {
  return { ...structuredClone(FIXTURE), ...changes };
}

// The repealed Rule 8-1(8) floor: no successor row, so offset, counting, semantics and base are null.
function repealRecord(changes = {}) {
  return record({
    record_id: randomUUID(),
    deadline_type: "application_hearing_earliest",
    base: null,
    rule_ref: "Rule 8-1(8)",
    offset: null,
    counting: null,
    semantics: null,
    description: "No earliest-hearing floor after service: the hearing date turns on set-down and notice of hearing.",
    verbatim: "by repealing subrules (5), (6), (7) and (8)",
    supersedes: ["shipped:application_hearing_earliest"],
    open_questions: [],
    ...changes,
  });
}

// A practice store over a fresh practice.db, writing through a fake Probanda's Cloud. The record's
// contract (R9) is the cloud's: these tests cover what stays here, the record_id, the matter-code
// guard, what is sent and how the stored records read back.
async function tempAdmin(t, label) {
  const dbPath = join(tmpdir(), `coclerk-practice-${label}-${randomUUID()}.db`);
  t.after(() => rmSync(dbPath, { force: true }));
  const cloud = await startFakeCloud(t);
  const env = { ...process.env, ...cloud.env, COCLERK_DB_PATH: dbPath };
  return { dbPath, cloud, admin: new PracticeStore(env) };
}

const upsert = (admin, rec) => callTool({ practiceDb: admin }, "practice_data__upsert_rule_overlay", { record: rec });
const read = (admin, args = {}) => callTool({ practiceDb: admin }, "practice_data__rule_overlay", args);

test("a valid record round-trips through both tools unchanged, sent as the op's cross record", async (t) => {
  const { admin, cloud } = await tempAdmin(t, "overlay-roundtrip");
  assert.deepEqual(await upsert(admin, FIXTURE), FIXTURE);
  assert.deepEqual(await read(admin), { records: [FIXTURE] });

  const [op] = cloud.writes().at(-1).ops;
  assert.deepEqual(op.cross, FIXTURE, "the plugin-made record travels as it is");
  assert.equal(op.op, "upsert");
  assert.equal(op.id, FIXTURE.record_id);
  assert.equal(op.kind, "rule_overlay");
  assert.equal(op.state, FIXTURE.status);
  assert.deepEqual(op.tags, { deadline_type: FIXTURE.deadline_type, amending_reg: "B.C. Reg. 105/2026" });
  assert.equal(op.links, undefined, "an overlay record has no matter link");

  const [row] = admin.rows("rule_overlay");
  assert.equal(row.id, FIXTURE.record_id);
  assert.equal(row.amending_reg, "B.C. Reg. 105/2026");
  assert.equal("matter_id" in row, false, "the item has no matter link");
});

test("a record without record_id is assigned one", async (t) => {
  const { admin } = await tempAdmin(t, "overlay-assign-id");
  const { record_id: _omitted, ...fresh } = FIXTURE;
  const stored = await upsert(admin, fresh);
  assert.match(stored.record_id, UUID);
  assert.notEqual(stored.record_id, FIXTURE.record_id);
  assert.equal(Object.keys(stored)[0], "record_id", "the assigned id leads the stored record");
  assert.deepEqual((await read(admin)).records, [stored]);
});

test("a write with an existing record_id replaces that record", async (t) => {
  const { admin } = await tempAdmin(t, "overlay-replace");
  await upsert(admin, FIXTURE);
  const replaced = record({ status: "conflict", effective_to: "2026-12-31" });
  assert.deepEqual(await upsert(admin, replaced), replaced);
  const { records } = await read(admin);
  assert.equal(records.length, 1, "replacing never adds a row");
  assert.deepEqual(records[0], replaced);
});

test("a pulled record keeps its pool_id, stored last", async (t) => {
  const { admin } = await tempAdmin(t, "overlay-pool-id");
  const pulled = record({ status: "unverified", verified_by: null, verified_at: null, pool_id: randomUUID() });
  const stored = await upsert(admin, pulled);
  assert.deepEqual(stored, pulled);
  assert.equal(Object.keys(stored).at(-1), "pool_id");
  assert.deepEqual((await read(admin)).records, [pulled]);
});

test("rule_overlay filters by deadline_type, amending_reg and status, sorted by deadline_type then effective_from", async (t) => {
  const { admin } = await tempAdmin(t, "overlay-filters");
  const later = record({ record_id: randomUUID(), effective_from: "2027-01-01", status: "unverified", verified_by: null, verified_at: null });
  const other = repealRecord({ amending_instrument: { reg: "B.C. Reg. 1/2027", oic: null, commencement: "2027-01-01" }, effective_from: "2027-01-01" });
  for (const rec of [later, other, FIXTURE]) await upsert(admin, rec);

  const ids = (result) => result.records.map((rec) => rec.record_id);
  assert.deepEqual(ids(await read(admin)), [other.record_id, FIXTURE.record_id, later.record_id]);
  assert.deepEqual(ids(await read(admin, { deadline_type: "notice_of_hearing_service" })), [FIXTURE.record_id, later.record_id]);
  assert.deepEqual(ids(await read(admin, { amending_reg: "B.C. Reg. 1/2027" })), [other.record_id]);
  assert.deepEqual(ids(await read(admin, { status: "unverified" })), [later.record_id]);
  assert.deepEqual(await read(admin, { deadline_type: "no_such_type" }), { records: [] });
});

test("refuses a client matter code in any string, naming the field (acceptance test 6)", async (t) => {
  const { admin, cloud } = await tempAdmin(t, "overlay-matter-code");
  const cases = [
    ["record.description", record({ description: `Served in ${MATTER_CODE}` })],
    ["record.enactment.name", record({ enactment: { ...FIXTURE.enactment, name: MATTER_CODE } })],
    ["record.open_questions[0]", record({ open_questions: [`raised on ${MATTER_CODE}`] })],
    ["record.source.url", record({ source: { ...FIXTURE.source, url: `https://example.org/${MATTER_CODE}` } })],
  ];
  for (const [field, rec] of cases) {
    await assert.rejects(upsert(admin, rec), (err) => {
      assert.equal(err.name, "ValidationError");
      assert.ok(err.message.includes(`: ${field} carries a client matter code`), err.message);
      assert.ok(!err.message.includes(MATTER_CODE), "the refusal never echoes the code");
      return true;
    });
  }
  assert.deepEqual(await read(admin), { records: [] }, "a refused record writes nothing");
  assert.equal(cloud.requests.length, 0, "and sends nothing");
});

