// Re-check on request (build plan slice 12, criterion 19): a fresh reviewer's blocks are saved as a
// day_recheck record, a stored block they disagree with is flagged, and no other stored record changes.
// Every fixture is synthetic.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const { reviewDateClaim, reviewDateJudge } = await import("../build/time-pipeline/review-date.js");
const { timePipelineGet, timePipelineList } = await import("../build/time-pipeline/backend.js");
const { timeReviewReadDay, timeReviewSaveEvidence, timeReviewStageDay } = await import("../build/time-review/tools.js");
const { timeReviewRecheckDay } = await import("../build/time-review/recheck.js");
const { applyAct } = await import("../build/time-review/act.js");
const { GATE_SOURCES } = await import("../build/time-review/sources.js");

const DAY = "2030-05-06";

function fixture(t) {
  const scratch = mkdtempSync(join(tmpdir(), "coclerk-recheck-"));
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
const entry = (n) => ({ source: "timecamp_time_entries", id: String(n), start: `0${n}:00`, end: `0${n}:30`, task: "T1", note: `Synthetic note ${n}` });
const blockFor = (n, extra = {}) => ({
  start: `0${n}:00`,
  end: `0${n}:30`,
  matter: "Synthetic Matter A",
  description: `Synthetic work ${n}`,
  matter_basis: "evidence_names_matter",
  bill_basis: [],
  evidence: [{ source: "timecamp_time_entries", ref: String(n) }],
  ...extra,
});

/** Five blocks, the day judged, all five approved by a click. */
function judgedDay(t) {
  const f = fixture(t);
  assert.equal(timeReviewSaveEvidence(DAY, sources, [1, 2, 3, 4, 5].map(entry), f.seams).status, "saved");
  const claim = reviewDateClaim(DAY, "test:recheck", f.seams);
  assert.equal(timeReviewStageDay(DAY, claim.token, [1, 2, 3, 4, 5].map((n) => blockFor(n)), f.seams).status, "staged");
  assert.equal(reviewDateJudge(DAY, claim.token, f.seams).status, "judged");
  for (let n = 1; n <= 5; n += 1) applyAct("approve", `${DAY}:00${n}`, {}, f.seams);
  return f;
}

/** Every record in namespace item, key to value, so a hash comparison covers all of them. */
const snapshot = (f) => Object.fromEntries(timePipelineList("item", "", f.env).items.map((i) => [i.key, i.sha256]));

test("one differing block flags one block and leaves every other stored record's hash unchanged", (t) => {
  const f = judgedDay(t);
  const before = snapshot(f);
  const storedBefore = timeReviewReadDay(DAY, f.seams).blocks.find((b) => b.id === `${DAY}:003`);
  const fresh = [1, 2, 3, 4, 5].map((n) => (n === 3 ? blockFor(n, { matter: "Synthetic Matter B" }) : blockFor(n, { description: `A different wording ${n}` })));
  const result = timeRecheck(f, fresh);
  assert.equal(result.status, "differs");
  assert.deepEqual(result.flagged, [`${DAY}:003`]);
  assert.deepEqual(result.differing, [{ block: `${DAY}:003`, reasons: ["matter_differs"] }]);
  assert.equal(result.clear, false);

  const after = snapshot(f);
  const changed = Object.keys(after).filter((k) => before[k] !== after[k]);
  assert.deepEqual(changed.sort(), [`block:${DAY}:003`, `day_recheck:${DAY}:001`]);
  assert.deepEqual(Object.keys(before).filter((k) => !(k in after)), []);

  // The flagged block keeps every judgment field; its approval moved to superseded_review.
  const storedAfter = timeReviewReadDay(DAY, f.seams).blocks.find((b) => b.id === `${DAY}:003`);
  for (const field of ["start", "end", "matter", "description", "matter_basis", "bill_basis", "evidence", "staged_at"]) {
    assert.deepEqual(storedAfter[field], storedBefore[field], field);
  }
  assert.equal(storedAfter.state, "flagged");
  assert.ok(storedAfter.flags.includes("recheck:matter_differs"));
  assert.deepEqual(storedAfter.superseded_review, storedBefore.review);
  assert.equal(storedAfter.review, undefined);
});

test("the fresh blocks are saved in the day_recheck record", (t) => {
  const f = judgedDay(t);
  timeRecheck(f, [1, 2, 3, 4, 5].map((n) => blockFor(n, { matter: n === 3 ? "Synthetic Matter B" : "Synthetic Matter A" })));
  const record = JSON.parse(timePipelineGet("item", `day_recheck:${DAY}:001`, f.env).value);
  assert.equal(record.kind, "day_recheck");
  assert.equal(record.blocks.length, 5);
  assert.equal(record.blocks[2].matter, "Synthetic Matter B");
  assert.deepEqual(record.differences, [{ block: `${DAY}:003`, reasons: ["matter_differs"] }]);
});

test("a fresh judgment that agrees flags nothing and changes no stored block", (t) => {
  const f = judgedDay(t);
  const before = snapshot(f);
  const result = timeRecheck(f, [1, 2, 3, 4, 5].map((n) => blockFor(n)));
  assert.equal(result.status, "agreed");
  assert.equal(result.clear, true);
  const after = snapshot(f);
  assert.deepEqual(Object.keys(after).filter((k) => before[k] !== after[k]), [`day_recheck:${DAY}:001`]);
});

test("a stored block with no fresh block of its times is flagged; a fresh block with no stored one is only recorded", (t) => {
  const f = judgedDay(t);
  const fresh = [1, 2, 3, 4].map((n) => blockFor(n)).concat([blockFor(6)]);
  const result = timeRecheck(f, fresh);
  assert.deepEqual(result.differing, [{ block: `${DAY}:005`, reasons: ["times_differ"] }]);
  assert.deepEqual(result.unmatched, [4]);
  assert.equal(timeReviewReadDay(DAY, f.seams).blocks.length, 5);
});

test("a second re-check is a new record; the first is kept", (t) => {
  const f = judgedDay(t);
  timeRecheck(f, [1, 2, 3, 4, 5].map((n) => blockFor(n)));
  const first = snapshot(f)[`day_recheck:${DAY}:001`];
  timeRecheck(f, [1, 2, 3, 4, 5].map((n) => blockFor(n)));
  const after = snapshot(f);
  assert.equal(after[`day_recheck:${DAY}:001`], first);
  assert.ok(`day_recheck:${DAY}:002` in after);
});

test("a day that is not judged, or has no evidence, is refused and nothing is written", (t) => {
  const f = fixture(t);
  assert.equal(timeRecheck(f, [blockFor(1)]).status, "not_judged");
  assert.deepEqual(snapshot(f), {});
});

test("a fresh block that passes its own state is refused: code sets flags and state", (t) => {
  const f = judgedDay(t);
  assert.throws(() => timeRecheck(f, [{ ...blockFor(1), state: "approved" }]), /code sets flags and state/);
});

function timeRecheck(f, blocks) {
  return timeReviewRecheckDay(DAY, blocks, f.seams);
}
