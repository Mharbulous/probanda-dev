// The order bootstrap returns filings in (#584, carrying the first-board grilling's §5).
//
// Unit tests, not fixture tests: the rule is a pure function of a hearing date, an activity
// timestamp and the clock, so every band and every boundary is reachable directly. The rule
// itself is recorded in the design brief and its ADR and in no text a session loads -- that
// separation is the point, so these tests exercise the function, never a skill's wording.

import assert from "node:assert/strict";
import test from "node:test";

const { isImminent, orderByRecency, orderFilings } = await import("../build/submission/filing-order.js");

const NOW = "2026-09-15 10:00";

// A filing's activity is its own unless `own` says otherwise: `own: null` makes it General Job activity only.
function filing(id, { hearing = null, activity = null, own = activity, retired = false } = {}) {
  return { filing_id: id, hearing_date: hearing, latest_activity: activity, own_activity: own, retired };
}

const idsOf = (filings) => orderFilings(filings, NOW).map((f) => f.filing_id);

test("imminence: a hearing inside the next week counts, one beyond it does not", () => {
  assert.equal(isImminent("2026-09-15", NOW), true, "today's hearing");
  assert.equal(isImminent("2026-09-22", NOW), true, "exactly seven days away");
  assert.equal(isImminent("2026-09-23", NOW), false, "eight days away");
  assert.equal(isImminent(null, NOW), false, "no stored hearing date");
});

test("imminence: a hearing day stays imminent for twelve hours after it ends", () => {
  // Yesterday's hearing day ended at 23:59, ten hours before this clock reading.
  assert.equal(isImminent("2026-09-14", NOW), true, "last night's hearing is still imminent");
  // The day before that ended thirty-four hours ago.
  assert.equal(isImminent("2026-09-13", NOW), false, "a hearing two days past has dropped out");
  assert.equal(isImminent("2026-09-14", "2026-09-15 11:59"), true, "one minute inside the window");
  assert.equal(isImminent("2026-09-14", "2026-09-15 12:00"), false, "one minute outside it");
});

test("order: an imminent hearing outranks any amount of recent activity", () => {
  const busy = filing(1, { activity: "2026-09-15 09:59" });
  const heard = filing(2, { hearing: "2026-09-16", activity: "2020-01-01 00:00" });
  assert.deepEqual(idsOf([busy, heard]), [2, 1]);
});

test("order: imminent filings run earliest hearing first", () => {
  const later = filing(1, { hearing: "2026-09-20" });
  const sooner = filing(2, { hearing: "2026-09-16" });
  assert.deepEqual(idsOf([later, sooner]), [2, 1]);
});

test("order: everything else runs by latest activity, most recent first", () => {
  const old = filing(1, { activity: "2026-09-01 08:00" });
  const recent = filing(2, { activity: "2026-09-14 17:30" });
  const middle = filing(3, { activity: "2026-09-10 12:00" });
  assert.deepEqual(idsOf([old, recent, middle]), [2, 3, 1]);
});

test("order: a filing with no activity goes last among the live ones", () => {
  const quiet = filing(1);
  const active = filing(2, { activity: "2026-09-01 08:00" });
  assert.deepEqual(idsOf([quiet, active]), [2, 1]);
});

test("order: retired filings stay at the foot whatever their hearing or activity", () => {
  const retiredWithHearing = filing(1, { hearing: "2026-09-16", activity: "2026-09-15 09:00", retired: true });
  const quietLive = filing(2);
  assert.deepEqual(idsOf([retiredWithHearing, quietLive]), [2, 1]);
});

test("order: ties break on filing id, so the order is total", () => {
  const a = filing(7, { activity: "2026-09-10 12:00" });
  const b = filing(3, { activity: "2026-09-10 12:00" });
  assert.deepEqual(idsOf([a, b]), [3, 7]);

  const sameHearing = [filing(9, { hearing: "2026-09-16" }), filing(4, { hearing: "2026-09-16" })];
  assert.deepEqual(idsOf(sameHearing), [4, 9]);

  assert.deepEqual(idsOf([filing(5), filing(2)]), [2, 5], "two filings with nothing to rank on");
});

test("order: the input array is not mutated", () => {
  const input = [filing(1, { activity: "2026-09-01 08:00" }), filing(2, { activity: "2026-09-14 17:30" })];
  orderFilings(input, NOW);
  assert.deepEqual(input.map((f) => f.filing_id), [1, 2]);
});

// L4801 as the grilling described it: the BCCA response's hearing is past, Claimant Opening
// Submissions has no stored hearing, so activity decides and the submissions come first.
test("order: L4801's two filings rank by activity, the past hearing carrying no weight", () => {
  const bccaResponse = filing(1, { hearing: "2026-09-04", activity: "2026-09-04 16:00" });
  const openingSubmissions = filing(2, { activity: "2026-09-14 11:00" });
  assert.deepEqual(idsOf([bccaResponse, openingSubmissions]), [2, 1]);
});

// Bootstrap's list: recency alone, so an imminent hearing gains no place a session could read.
test("recency order: most recent live first, then untouched, then retired; a hearing moves nothing", () => {
  const imminentButOlder = filing(1, { hearing: "2026-09-16", activity: "2026-09-10 09:00" });
  const recent = filing(2, { activity: "2026-09-14 11:00" });
  const untouched = filing(3);
  const retired = filing(4, { activity: "2026-09-15 09:00", retired: true });
  const alsoUntouched = filing(5, { hearing: "2026-09-15" });
  assert.deepEqual(orderByRecency([retired, alsoUntouched, untouched, imminentButOlder, recent]).map((f) => f.filing_id), [2, 1, 3, 5, 4]);
});

// A General Job's activity counts for every filing in its proceeding, so it cannot pick one of them.
test("recency order: a filing's own activity outranks a newer General Job activity", () => {
  const shared = "2026-09-15 09:00";
  const sharedOnly = filing(1, { activity: shared, own: null });
  const ownOlder = filing(2, { activity: shared, own: "2026-09-10 09:00" });
  const ownNewer = filing(3, { activity: shared, own: "2026-09-12 09:00" });
  assert.deepEqual(orderByRecency([sharedOnly, ownOlder, ownNewer]).map((f) => f.filing_id), [3, 2, 1]);
});

test("recency order: among filings with no own activity, the most recent General Job activity leads, then filing id", () => {
  const older = filing(1, { activity: "2026-09-10 09:00", own: null });
  const newer = filing(2, { activity: "2026-09-14 09:00", own: null });
  const tiedA = filing(4, { activity: "2026-09-10 09:00", own: null });
  const untouched = filing(3);
  assert.deepEqual(orderByRecency([untouched, tiedA, older, newer]).map((f) => f.filing_id), [2, 1, 4, 3]);
});

// The ranking is silent. No text a session loads may describe what produces the order: a
// session that knew the rule could read a filing's hearing proximity off its position, which is
// exactly what `shared/deadline-isolation.md` exists to prevent. This guards the surface this
// ticket owns -- the tool description. The skill and reference text is the text ticket's to guard.
test("the ranking is silent: bootstrap's description names the order but never the rule", async () => {
  const { buildToolDefinitions } = await import("../build/schema-gen.js");
  const bootstrap = buildToolDefinitions().find((d) => d.name.endsWith("drafting_forms__bootstrap"));
  assert.ok(bootstrap, "expected a bootstrap tool definition");
  assert.match(bootstrap.description, /order to present them in/, "it must still say that an order exists");
  for (const word of ["hearing", "imminen", "deadline", "activity", "earliest", "most recent", "rank", "week"]) {
    assert.ok(!new RegExp(word, "i").test(bootstrap.description), `bootstrap's description must not mention "${word}"`);
  }
});
