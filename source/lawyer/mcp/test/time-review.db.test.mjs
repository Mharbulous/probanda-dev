// The time_review__* tools on billing's `timekeeping` server (build plan slice 5): the day_evidence
// record, the flag rules that code (not the reviewer) applies to each staged block, and the
// refusals. Every fixture is synthetic: no real matter, client or date of work.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const { reviewDateClaim, reviewDateJudge, reviewDateRelease } = await import("../build/time-pipeline/review-date.js");
const { timeReviewSaveEvidence, timeReviewStageDay, timeReviewReadDay } = await import("../build/time-review/tools.js");
const { GATE_SOURCES } = await import("../build/time-review/sources.js");
const { BILL_BASIS, MATTER_BASIS } = await import("../build/time-review/flags.js");
const { callTimekeepingTool } = await import("../build/timekeeping-dispatch.js");

const DAY = "2030-01-02";
const HERE = dirname(fileURLToPath(import.meta.url));

/** A scratch store, as review-date.db.test.mjs builds one. */
function fixture(t) {
  const scratch = mkdtempSync(join(tmpdir(), "coclerk-time-review-"));
  t.after(() => rmSync(scratch, { recursive: true, force: true }));
  const appData = join(scratch, "appdata");
  mkdirSync(join(appData, "Coclerk"), { recursive: true });
  const root = join(scratch, "0. CASE DATA");
  mkdirSync(root, { recursive: true });
  writeFileSync(join(appData, "Coclerk", "coclerk.json"), JSON.stringify({ case_data_root: root }));
  const env = { APPDATA: appData, LOCALAPPDATA: process.env.LOCALAPPDATA, COCLERK_PYTHON: process.env.COCLERK_PYTHON };
  return { seams: { env }, env };
}

const allSources = (status = "fetched") => GATE_SOURCES.map((source) => ({ source, status }));
const rows = [
  { source: "gcal_events", id: "e1", summary: "Synthetic call" },
  { source: "sent_mail", id: "m1", summary: "Synthetic letter" },
];

function block(overrides = {}) {
  return {
    start: "09:00",
    end: "09:30",
    matter: "Synthetic Matter A",
    description: "Synthetic work",
    matter_basis: "evidence_names_matter",
    bill_basis: [],
    evidence: [{ source: "gcal_events", ref: "e1" }],
    ...overrides,
  };
}

/** Evidence saved with every source, and a claim: ready to stage. */
function ready(t, date = DAY) {
  const f = fixture(t);
  const saved = timeReviewSaveEvidence(date, allSources(), rows, f.seams);
  assert.equal(saved.status, "saved");
  const claim = reviewDateClaim(date, "test:bill-1", f.seams);
  assert.equal(claim.status, "claimed");
  return { ...f, token: claim.token };
}

test("the gate's sources here are the expected_sources of splice.sql, in order", () => {
  const sql = readFileSync(join(HERE, "..", "..", "..", "skills", "timecamping-data", "references", "splice.sql"), "utf-8");
  const list = /expected_sources\(source_name, alias\) AS \(\s*VALUES([\s\S]*?)\n\)\s*,/.exec(sql);
  assert.ok(list, "expected_sources list found");
  const names = [...list[1].matchAll(/\('([a-z_]+)'/g)].map((m) => m[1]);
  assert.deepEqual(names, [...GATE_SOURCES]);
});

test("save_evidence records which sources were gathered, and says what is short", (t) => {
  const f = fixture(t);
  const partial = allSources().slice(0, 5).concat([{ source: "icloud_events", status: "failed" }]);
  const saved = timeReviewSaveEvidence(DAY, partial, rows.slice(0, 1), f.seams);
  assert.equal(saved.status, "saved");
  assert.equal(saved.complete, false);
  assert.deepEqual(saved.short, ["icloud_events", "sent_mail"]);
  const day = timeReviewReadDay(DAY, f.seams);
  assert.equal(day.evidence.kind, "day_evidence");
  assert.equal(day.evidence.rows.length, 1);
  assert.deepEqual(day.blocks, []);
  // A later save replaces the earlier one.
  const again = timeReviewSaveEvidence(DAY, allSources("empty"), [], f.seams);
  assert.equal(again.complete, true);
  assert.deepEqual(timeReviewReadDay(DAY, f.seams).evidence.rows, []);
});

test("save_evidence refuses a row whose source is unknown or not listed, and a judged day", (t) => {
  const f = fixture(t);
  assert.throws(() => timeReviewSaveEvidence(DAY, allSources(), [{ source: "carrier_pigeon" }], f.seams), /source must be one of/);
  assert.throws(
    () => timeReviewSaveEvidence(DAY, [{ source: "sent_mail", status: "fetched" }], [{ source: "gcal_events" }], f.seams),
    /not listed in sources/
  );
  timeReviewSaveEvidence(DAY, allSources(), rows, f.seams);
  const { token } = reviewDateClaim(DAY, "test:bill-1", f.seams);
  reviewDateJudge(DAY, token, f.seams);
  const refused = timeReviewSaveEvidence(DAY, allSources("empty"), [], f.seams);
  assert.equal(refused.status, "judged");
  assert.equal(timeReviewReadDay(DAY, f.seams).evidence.rows.length, 2);
});

for (const [value, flagged] of Object.entries(MATTER_BASIS)) {
  test(`matter_basis ${value} ${flagged ? "flags the block" : "leaves it unflagged"}`, (t) => {
    const f = ready(t);
    const result = timeReviewStageDay(DAY, f.token, [block({ matter_basis: value })], f.seams);
    assert.equal(result.status, "staged");
    assert.deepEqual(result.blocks[0].flags, flagged ? [`matter:${value}`] : []);
    assert.equal(result.blocks[0].state, flagged ? "flagged" : "auto_assigned");
    const stored = timeReviewReadDay(DAY, f.seams).blocks[0];
    assert.equal(stored.state, result.blocks[0].state);
  });
}

for (const value of BILL_BASIS) {
  test(`bill_basis ${value} flags the block even when the matter is certain`, (t) => {
    const f = ready(t);
    const result = timeReviewStageDay(DAY, f.token, [block({ bill_basis: [value] })], f.seams);
    assert.deepEqual(result.blocks[0].flags, [`bill:${value}`]);
    assert.equal(result.blocks[0].state, "flagged");
  });
}

test("evidence that names the matter and an empty bill_basis stage as auto_assigned with no flag", (t) => {
  const f = ready(t);
  const result = timeReviewStageDay(DAY, f.token, [block()], f.seams);
  assert.deepEqual(result.blocks, [{ id: `${DAY}:001`, state: "auto_assigned", flags: [] }]);
  const stored = timeReviewReadDay(DAY, f.seams).blocks[0];
  assert.equal(stored.kind, "block");
  assert.deepEqual(stored.links, []);
  assert.deepEqual(stored.flags, []);
});

test("every doubtful value from both fields is listed, matter first, with no repeats", (t) => {
  const f = ready(t);
  const result = timeReviewStageDay(
    DAY,
    f.token,
    [block({ matter_basis: "indirect_only", bill_basis: ["estimate", "no_evidence", "estimate"] })],
    f.seams
  );
  assert.deepEqual(result.blocks[0].flags, ["matter:indirect_only", "bill:estimate", "bill:no_evidence"]);
});

test("a reviewer cannot pass flags, state or links, and cannot name a value outside the lists", (t) => {
  const f = ready(t);
  for (const extra of [{ flags: [] }, { state: "auto_assigned" }, { links: [] }, { id: "x" }]) {
    assert.throws(() => timeReviewStageDay(DAY, f.token, [block(extra)], f.seams), /allowed: start, end/);
  }
  assert.throws(() => timeReviewStageDay(DAY, f.token, [block({ matter_basis: "sure_thing" })], f.seams), /matter_basis must be one of/);
  assert.throws(() => timeReviewStageDay(DAY, f.token, [block({ matter_basis: undefined })], f.seams), /matter_basis must be one of/);
  assert.throws(() => timeReviewStageDay(DAY, f.token, [block({ bill_basis: ["hunch"] })], f.seams), /bill_basis values must be among/);
  assert.throws(() => timeReviewStageDay(DAY, f.token, [block({ bill_basis: undefined })], f.seams), /bill_basis must be a list/);
  assert.deepEqual(timeReviewReadDay(DAY, f.seams).blocks, []);
});

test("the tool's schema also refuses flags, state and an unknown basis before the code runs", async (t) => {
  const f = ready(t);
  const call = (b) => callTimekeepingTool("time_review__stage_day", { date: DAY, token: f.token, blocks: [b] });
  const saved = { ...process.env };
  Object.assign(process.env, f.env);
  t.after(() => { for (const k of Object.keys(f.env)) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } });
  await assert.rejects(() => call(block({ flags: [] })), /unknown field "flags"/);
  await assert.rejects(() => call(block({ matter_basis: "sure_thing" })), /matter_basis must be one of/);
  const ok = await call(block({ matter_basis: "no_evidence" }));
  assert.equal(ok.status, "staged");
  assert.deepEqual(ok.blocks[0].flags, ["matter:no_evidence"]);
});

test("a second stage of a judged day is refused and the blocks stay as judged", (t) => {
  const f = ready(t);
  assert.equal(timeReviewStageDay(DAY, f.token, [block()], f.seams).status, "staged");
  assert.equal(reviewDateJudge(DAY, f.token, f.seams).status, "judged");
  const second = timeReviewStageDay(DAY, f.token, [block({ matter_basis: "no_evidence" })], f.seams);
  assert.equal(second.status, "judged");
  assert.equal(second.judged_by, "test:bill-1");
  const stored = timeReviewReadDay(DAY, f.seams).blocks;
  assert.equal(stored.length, 1);
  assert.equal(stored[0].state, "auto_assigned");
});

test("a stage for a day with no saved evidence is refused", (t) => {
  const f = fixture(t);
  const { token } = reviewDateClaim(DAY, "test:bill-1", f.seams);
  assert.deepEqual(timeReviewStageDay(DAY, token, [block()], f.seams), { status: "evidence_missing", date: DAY });
  assert.deepEqual(timeReviewReadDay(DAY, f.seams).blocks, []);
});

test("a stage with a source short of the gate is refused, naming the source", (t) => {
  const f = fixture(t);
  const sources = allSources().filter((s) => s.source !== "telus_calls");
  timeReviewSaveEvidence(DAY, [...sources, { source: "telus_calls", status: "pending" }], rows, f.seams);
  const { token } = reviewDateClaim(DAY, "test:bill-1", f.seams);
  assert.deepEqual(timeReviewStageDay(DAY, token, [block()], f.seams), { status: "evidence_short", date: DAY, short: ["telus_calls"] });
  // A source never listed is short too.
  timeReviewSaveEvidence(DAY, sources, rows, f.seams);
  assert.deepEqual(timeReviewStageDay(DAY, token, [block()], f.seams).short, ["telus_calls"]);
  assert.deepEqual(timeReviewReadDay(DAY, f.seams).blocks, []);
});

test("a stage for a day another holder has claimed is refused", (t) => {
  const f = ready(t);
  const result = timeReviewStageDay(DAY, "a-token-that-is-not-the-claims", [block()], f.seams);
  assert.equal(result.status, "held");
  assert.equal(result.holder, "test:bill-1");
  assert.deepEqual(timeReviewReadDay(DAY, f.seams).blocks, []);
});

test("a run that holds no claim on the day is refused", (t) => {
  const f = fixture(t);
  timeReviewSaveEvidence(DAY, allSources(), rows, f.seams);
  assert.deepEqual(timeReviewStageDay(DAY, "no-claim", [block()], f.seams), { status: "claim_lost", date: DAY });
  const { token } = reviewDateClaim(DAY, "test:bill-1", f.seams);
  reviewDateRelease(DAY, token, f.seams);
  assert.equal(timeReviewStageDay(DAY, token, [block()], f.seams).status, "claim_lost");
});

test("staging again before the day is judged replaces its blocks, with no leftovers", (t) => {
  const f = ready(t);
  timeReviewStageDay(DAY, f.token, [block(), block({ start: "10:00", end: "10:30" }), block({ start: "11:00", end: "11:30" })], f.seams);
  assert.equal(timeReviewReadDay(DAY, f.seams).blocks.length, 3);
  timeReviewStageDay(DAY, f.token, [block({ matter_basis: "conflict_uncovered" })], f.seams);
  const blocks = timeReviewReadDay(DAY, f.seams).blocks;
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].state, "flagged");
});

test("blocks of one day are not read as another day's", (t) => {
  const f = ready(t);
  const other = "2030-01-20";
  timeReviewSaveEvidence(other, allSources(), rows, f.seams);
  const { token } = reviewDateClaim(other, "test:bill-2", f.seams);
  timeReviewStageDay(DAY, f.token, [block()], f.seams);
  timeReviewStageDay(other, token, [block(), block()], f.seams);
  assert.equal(timeReviewReadDay(DAY, f.seams).blocks.length, 1);
  assert.equal(timeReviewReadDay(other, f.seams).blocks.length, 2);
});

test("the generic store tools cannot write a block or day_evidence record", async (t) => {
  const f = ready(t);
  const saved = { ...process.env };
  Object.assign(process.env, f.env);
  t.after(() => { for (const k of Object.keys(f.env)) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } });
  for (const key of [`block:${DAY}:001`, `day_evidence:${DAY}`]) {
    await assert.rejects(
      () => callTimekeepingTool("time_pipeline__set", { namespace: "item", key, value: "{}", expect_absent: true }),
      /only the time_review__\* tools write/
    );
  }
});
