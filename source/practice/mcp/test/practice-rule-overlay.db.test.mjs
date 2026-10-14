import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const { LocalPracticeAdmin } = await import("../build/practice/backend.js");
const { callTool } = await import("../build/dispatch.js");
const { practiceEntityFor } = await import("../build/practice-registry.js");

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

function tempAdmin(t, label) {
  const dbPath = join(tmpdir(), `coclerk-practice-${label}-${randomUUID()}.db`);
  t.after(() => rmSync(dbPath, { force: true }));
  return { dbPath, admin: new LocalPracticeAdmin({ ...process.env, COCLERK_DB_PATH: dbPath }) };
}

function runPython(script, dbPath) {
  const candidates = [process.env.COCLERK_PYTHON, "python", "python3"].filter(Boolean);
  let lastError;
  for (const python of candidates) {
    const result = spawnSync(python, ["-c", script, dbPath], { encoding: "utf-8" });
    if (result.error?.code === "ENOENT") {
      lastError = result.error;
      continue;
    }
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stderr);
    return result.stdout;
  }
  throw lastError ?? new Error("No Python interpreter found");
}

const upsert = (admin, rec) => callTool({ practiceDb: admin }, "practice_data__upsert_rule_overlay", { record: rec });
const read = (admin, args = {}) => callTool({ practiceDb: admin }, "practice_data__rule_overlay", args);

test("a valid record round-trips through both tools unchanged", async (t) => {
  const { admin } = tempAdmin(t, "overlay-roundtrip");
  assert.deepEqual(await upsert(admin, FIXTURE), FIXTURE);
  assert.deepEqual(await read(admin), { records: [FIXTURE] });

  const [row] = await admin.query(practiceEntityFor("practice_rule_overlay"), {}, { limit: 10 });
  assert.equal(row.id, FIXTURE.record_id);
  assert.equal(row.amending_reg, "B.C. Reg. 105/2026");
  assert.equal(row.effective_to, null);
  assert.equal("matter_id" in row, false, "the table has no matter column");
});

test("a record without record_id is assigned one", async (t) => {
  const { admin } = tempAdmin(t, "overlay-assign-id");
  const { record_id: _omitted, ...fresh } = FIXTURE;
  const stored = await upsert(admin, fresh);
  assert.match(stored.record_id, UUID);
  assert.notEqual(stored.record_id, FIXTURE.record_id);
  assert.equal(Object.keys(stored)[0], "record_id", "the assigned id leads the stored record");
  assert.deepEqual((await read(admin)).records, [stored]);
});

test("a write with an existing record_id replaces that record", async (t) => {
  const { admin } = tempAdmin(t, "overlay-replace");
  await upsert(admin, FIXTURE);
  const replaced = record({ status: "conflict", effective_to: "2026-12-31" });
  assert.deepEqual(await upsert(admin, replaced), replaced);
  const { records } = await read(admin);
  assert.equal(records.length, 1, "replacing never adds a row");
  assert.deepEqual(records[0], replaced);
});

test("a pulled record keeps its pool_id, stored last; a bad pool_id is refused", async (t) => {
  const { admin } = tempAdmin(t, "overlay-pool-id");
  const pulled = record({ status: "unverified", verified_by: null, verified_at: null, pool_id: randomUUID() });
  const stored = await upsert(admin, pulled);
  assert.deepEqual(stored, pulled);
  assert.equal(Object.keys(stored).at(-1), "pool_id");
  assert.deepEqual((await read(admin)).records, [pulled]);
  await assert.rejects(upsert(admin, record({ pool_id: "row-7" })), /record\.pool_id must be a UUID, null, or omitted/);
});

test("a repeal record (offset null) is accepted", async (t) => {
  const { admin } = tempAdmin(t, "overlay-repeal");
  const repeal = repealRecord();
  assert.deepEqual(await upsert(admin, repeal), repeal);
});

test("rule_overlay filters by deadline_type, amending_reg and status, sorted by deadline_type then effective_from", async (t) => {
  const { admin } = tempAdmin(t, "overlay-filters");
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

test("an existing practice.db gains the rule overlay table on first connection", async (t) => {
  const { dbPath, admin } = tempAdmin(t, "overlay-legacy");
  runPython(String.raw`
import sqlite3, sys
db = sqlite3.connect(sys.argv[1])
db.execute("CREATE TABLE practice_clients (id TEXT PRIMARY KEY, name TEXT, created_at TEXT, updated_at TEXT)")
db.commit()
db.close()
`, dbPath);
  assert.deepEqual(await read(admin), { records: [] });
  assert.deepEqual(await upsert(admin, FIXTURE), FIXTURE);
});

test("refuses a client matter code in any string, naming the field (acceptance test 6)", async (t) => {
  const { admin } = tempAdmin(t, "overlay-matter-code");
  const cases = [
    ["record.description", record({ description: `Served in ${MATTER_CODE}` })],
    ["record.enactment.name", record({ enactment: { ...FIXTURE.enactment, name: MATTER_CODE } })],
    ["record.open_questions[0]", record({ open_questions: [`raised on ${MATTER_CODE}`] })],
    ["record.source.url", record({ source: { ...FIXTURE.source, url: `https://example.org/${MATTER_CODE}` } })],
  ];
  for (const [field, rec] of cases) {
    await assert.rejects(upsert(admin, rec), (err) => {
      assert.equal(err.name, "ValidationError");
      assert.ok(err.message.startsWith(`${field} carries a client matter code`), err.message);
      assert.ok(!err.message.includes(MATTER_CODE), "the refusal never echoes the code");
      return true;
    });
  }
  assert.deepEqual(await read(admin), { records: [] }, "a refused record writes nothing");
});

test("refuses an unknown field at the top level and inside a nested object", async (t) => {
  const { admin } = tempAdmin(t, "overlay-unknown-field");
  await assert.rejects(upsert(admin, record({ matter: "test" })), /record has unknown field\(s\) matter/);
  await assert.rejects(
    upsert(admin, record({ offset: { ...FIXTURE.offset, matter: "test" } })),
    /record\.offset has unknown field\(s\) matter/
  );
  await assert.rejects(
    upsert(admin, record({ source: { ...FIXTURE.source, note: "x" } })),
    /record\.source has unknown field\(s\) note/
  );
});

test("refuses a bad enum, an unverified 'verified', a reversed period and a repeal record with counting set", async (t) => {
  const { admin } = tempAdmin(t, "overlay-field-rules");
  const refusals = [
    [record({ counting: "weekly" }), /record\.counting must be one of: calendar, forward_n_business_days/],
    [record({ offset: { ...FIXTURE.offset, unit: "weeks" } }), /record\.offset\.unit must be one of/],
    [record({ verified_by: null }), /record\.status "verified" requires verified_by "practitioner" and an ISO verified_at/],
    [record({ verified_at: null }), /record\.status "verified" requires verified_by/],
    [record({ effective_to: "2026-09-30" }), /record\.effective_to must be on or after record\.effective_from/],
    [repealRecord({ counting: "calendar" }), /record\.counting must be null in a repeal record \(offset null\)/],
    [record({ base: null }), /record\.base is required unless the record is a repeal record/],
  ];
  for (const [rec, pattern] of refusals) {
    await assert.rejects(upsert(admin, rec), pattern);
  }
  assert.deepEqual(await read(admin), { records: [] });
});
