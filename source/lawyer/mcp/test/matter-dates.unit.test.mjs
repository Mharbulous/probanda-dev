// The Job Board's handling of provisional alternative dates
// (planning/1. Design/2026-10-06_provisional-alternative-dates-spec.md, §11 answer 3): of a
// deadline's unresolved alternatives, the Goal card carries one condition, dated by the earliest and
// flagged; every other alternative goes to the date row under its scenario label.

import assert from "node:assert/strict";
import test from "node:test";

const { deadlineCriteria, pageDates } = await import("../build/submission/matter-dates.js");

const deadline = (deadline_type, deadline_date, extra = {}) => ({
  deadline_type, deadline_date, party_label: null, status: "active", review_flag: null, scenario_label: null, ...extra,
});
const alternative = (deadline_date, scenario_label) =>
  deadline("application_response", deadline_date, { review_flag: "practitioner_choice", scenario_label });

const dates = {
  anchors: [{
    anchor_type: "application_hearing_date",
    anchor_date: "2031-03-17",
    party_label: null,
    proceeding_label: null,
    status: "active",
    filing_ref: "filing:1",
    deadlines: [
      deadline("notice_of_application_service", "2031-02-24"),
      alternative("2031-03-05", "Short notice"),
      alternative("2031-03-09", "Ordinary notice"),
      deadline("application_record", "2031-03-10"),
    ],
  }],
};

test("a deadline's alternatives make one Goal criterion, ordered by the earliest", () => {
  const criteria = deadlineCriteria(dates, 1);
  assert.deepEqual(criteria.map((c) => c.id), [
    "deadline:notice_of_application_service",
    "deadline:application_response",
    "deadline:application_record",
  ]);
  assert.deepEqual(criteria[2].follows, ["deadline:application_response"], "the next criterion follows the one condition, not each alternative");
});

test("the page dates the Goal criterion by the earliest alternative, flagged, and puts the others on the date row by scenario", () => {
  const section = { meta: { filing_id: 1 }, criteria: deadlineCriteria(dates, 1) };
  const page = pageDates(dates, [section]);
  assert.deepEqual(page.criteria["1"]["deadline:application_response"], { date: "2031-03-05", flag: "Practitioner choice" });
  assert.deepEqual(page.writing, [
    { label: "Application hearing date", date: "2031-03-17", flag: null },
    { label: "Application response — Ordinary notice", date: "2031-03-09", flag: "Practitioner choice" },
  ]);
});

test("an unlinked anchor's alternatives each go to the header row under their scenario", () => {
  const unlinked = { anchors: [{ ...dates.anchors[0], filing_ref: null, deadlines: [alternative("2031-03-05", "Short notice"), alternative("2031-03-09", "Ordinary notice")] }] };
  const page = pageDates(unlinked, []);
  assert.deepEqual(page.header.slice(1).map((d) => [d.label, d.date, d.flag]), [
    ["Application response — Short notice", "2031-03-05", "Practitioner choice"],
    ["Application response — Ordinary notice", "2031-03-09", "Practitioner choice"],
  ]);
});
