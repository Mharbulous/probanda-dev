// The fingerprint of a judged day (build plan slice 10, criterion 17): judge saves it on the
// review_date record; time_review__compare_day flags only what changed. Every fixture is synthetic.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const { reviewDateClaim, reviewDateImportFile, reviewDateJudge } = await import("../build/time-pipeline/review-date.js");
const { timePipelineGet } = await import("../build/time-pipeline/backend.js");
const { timeReviewReadDay, timeReviewSaveEvidence, timeReviewStageDay, timeReviewRecordTimecamp } = await import("../build/time-review/tools.js");
const { timeReviewCompareDay } = await import("../build/time-review/fingerprint.js");
const { applyAct } = await import("../build/time-review/act.js");
const { GATE_SOURCES } = await import("../build/time-review/sources.js");

const DAY = "2030-05-06";

function fixture(t) {
  const scratch = mkdtempSync(join(tmpdir(), "coclerk-fingerprint-"));
  t.after(() => rmSync(scratch, { recursive: true, force: true }));
  const appData = join(scratch, "appdata");
  mkdirSync(join(appData, "Coclerk"), { recursive: true });
  const root = join(scratch, "0. CASE DATA");
  mkdirSync(root, { recursive: true });
  writeFileSync(join(appData, "Coclerk", "coclerk.json"), JSON.stringify({ case_data_root: root }));
  const env = { APPDATA: appData, LOCALAPPDATA: process.env.LOCALAPPDATA, COCLERK_PYTHON: process.env.COCLERK_PYTHON };
  return { seams: { env }, env };
}

const sources = GATE_SOURCES.map((source) => ({ source, status: "fetched" }));
const entry = (n, extra = {}) => ({ id: String(n), start: `0${n}:00`, end: `0${n}:30`, task: "T1", note: `Synthetic note ${n}`, ...extra });
const rows = (entries) => entries.map((e) => ({ source: "timecamp_time_entries", ...e }));
const blockFor = (n) => ({
  start: `0${n}:00`,
  end: `0${n}:30`,
  matter: "Synthetic Matter A",
  description: `Synthetic work ${n}`,
  matter_basis: "evidence_names_matter",
  bill_basis: [],
  evidence: [{ source: "timecamp_time_entries", ref: String(n) }],
});

/** Five entries, five blocks, the day judged, all five blocks approved by a click. */
function judgedDay(t) {
  const f = fixture(t);
  const entries = [1, 2, 3, 4, 5].map((n) => entry(n));
  assert.equal(timeReviewSaveEvidence(DAY, sources, rows(entries), f.seams).status, "saved");
  const claim = reviewDateClaim(DAY, "test:fingerprint", f.seams);
  assert.equal(timeReviewStageDay(DAY, claim.token, entries.map((_, i) => blockFor(i + 1)), f.seams).status, "staged");
  assert.equal(reviewDateJudge(DAY, claim.token, f.seams).status, "judged");
  for (let n = 1; n <= 5; n += 1) applyAct("approve", `${DAY}:00${n}`, {}, f.seams);
  return { ...f, entries };
}

const states = (f) => Object.fromEntries(timeReviewReadDay(DAY, f.seams).blocks.map((b) => [b.id, b.state]));

test("judge saves the fingerprint of the day's TimeCamp entries on the review_date record", (t) => {
  const f = judgedDay(t);
  const record = JSON.parse(timePipelineGet("item", `review_date:${DAY}`, f.env).value);
  assert.equal(record.kind, "review_date");
  assert.equal(record.fingerprint.entries.length, 5);
  assert.deepEqual(Object.keys(record.fingerprint.entries[0]).sort(), ["end", "id", "note", "start", "task"]);
});

test("a day with no change reports unchanged and writes nothing", (t) => {
  const f = judgedDay(t);
  const before = timePipelineGet("item", `review_date:${DAY}`, f.env).sha256;
  assert.equal(timeReviewCompareDay(DAY, f.entries, f.seams).status, "unchanged");
  assert.equal(timePipelineGet("item", `review_date:${DAY}`, f.env).sha256, before);
  assert.equal(timeReviewReadDay(DAY, f.seams).clear, true);
});

test("one changed entry among five flags one block and keeps four approvals", (t) => {
  const f = judgedDay(t);
  assert.equal(timeReviewReadDay(DAY, f.seams).clear, true);
  const now = f.entries.map((e) => (e.id === "3" ? { ...e, note: "Synthetic note changed" } : e));
  const result = timeReviewCompareDay(DAY, now, f.seams);
  assert.equal(result.status, "changed");
  assert.deepEqual(result.changed, ["3"]);
  assert.deepEqual(result.flagged, [`${DAY}:003`]);
  assert.deepEqual(states(f), {
    [`${DAY}:001`]: "approved",
    [`${DAY}:002`]: "approved",
    [`${DAY}:003`]: "flagged",
    [`${DAY}:004`]: "approved",
    [`${DAY}:005`]: "approved",
  });
  const day = timeReviewReadDay(DAY, f.seams);
  assert.equal(day.clear, false);
  const flagged = day.blocks.find((b) => b.state === "flagged");
  assert.ok(flagged.flags.includes("recheck:entry_changed"));
  assert.equal(flagged.superseded_review.act, "approved");
  assert.equal(flagged.review, undefined);
  // The new entries are now the fingerprint: a second compare reports nothing.
  assert.equal(timeReviewCompareDay(DAY, now, f.seams).status, "unchanged");
});

test("an added entry adds a flagged block; a removed entry flags its block", (t) => {
  const f = judgedDay(t);
  const now = [...f.entries.filter((e) => e.id !== "2"), entry(6)];
  const result = timeReviewCompareDay(DAY, now, f.seams);
  assert.deepEqual([result.added, result.removed], [["6"], ["2"]]);
  assert.deepEqual(result.new_blocks, [`${DAY}:006`]);
  const s = states(f);
  assert.equal(s[`${DAY}:002`], "flagged");
  assert.equal(s[`${DAY}:006`], "flagged");
  assert.equal(Object.values(s).filter((v) => v === "approved").length, 4);
  assert.equal(timeReviewReadDay(DAY, f.seams).clear, false);
});

test("a correction the session wrote and read back is accepted, not reported", (t) => {
  const f = judgedDay(t);
  const corrected = { ...f.entries[0], note: "Synthetic corrected note" };
  timeReviewRecordTimecamp(`${DAY}:001`, "saved", undefined, f.seams, corrected);
  const now = f.entries.map((e) => (e.id === "1" ? corrected : e));
  assert.equal(timeReviewCompareDay(DAY, now, f.seams).status, "unchanged");
});

test("a day judged before fingerprints, or not judged, is not compared", (t) => {
  const f = fixture(t);
  assert.equal(timeReviewCompareDay(DAY, [], f.seams).status, "not_judged");
  // A mark imported from a judged-dates file is a judged record with no fingerprint, as an older copy wrote it.
  const marks = join(f.env.APPDATA, "judged-dates.jsonl");
  writeFileSync(marks, JSON.stringify({ date: DAY, judged_at: "2030-05-07T00:00:00.000Z" }) + "\n");
  assert.deepEqual(reviewDateImportFile(marks, "test", false, f.seams).added, [DAY]);
  const stored = timePipelineGet("item", `review_date:${DAY}`, f.env);
  assert.equal(timeReviewCompareDay(DAY, [entry(1)], f.seams).status, "no_fingerprint");
  assert.equal(timePipelineGet("item", `review_date:${DAY}`, f.env).sha256, stored.sha256);
});

test("an entry without an id is refused", (t) => {
  const f = judgedDay(t);
  assert.throws(() => timeReviewCompareDay(DAY, [{ note: "x" }], f.seams), /needs an id/);
});
