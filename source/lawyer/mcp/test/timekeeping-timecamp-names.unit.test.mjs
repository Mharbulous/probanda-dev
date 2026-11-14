// Issue 283: billing's core dependency is its `timekeeping` server, and TimeCamp is one optional
// source of time evidence (source/billing/VISION.md). The TimeCamp names that server still carries
// are known debt. These lists freeze them exactly: a new mention fails, and a removal fails until
// the list here shrinks with it. Run after `npm run build`.

import assert from "node:assert/strict";
import test from "node:test";

const { buildTimekeepingToolDefinitions } = await import("../build/schema-gen.js");
const { GATE_SOURCES } = await import("../build/time-review/sources.js");

const RULE = "source/billing/VISION.md (issue 283) forbids a new TimeCamp name in the timekeeping server";
const namesTimeCamp = (text) => /timecamp/i.test(text);
const definitions = buildTimekeepingToolDefinitions();

test("only the known tool names in the timekeeping server name TimeCamp", () => {
  const found = definitions.map((d) => d.name).filter(namesTimeCamp).sort();
  assert.deepEqual(found, ["time_review__record_timecamp"], RULE);
});

test("only the known assembly-gate sources name TimeCamp", () => {
  const found = GATE_SOURCES.filter(namesTimeCamp).sort();
  assert.deepEqual(found, ["timecamp_computer_activities", "timecamp_time_entries"], RULE);
});

test("only the known tool definitions in the timekeeping server mention TimeCamp", () => {
  const found = definitions.filter((d) => namesTimeCamp(JSON.stringify(d))).map((d) => d.name).sort();
  assert.deepEqual(
    found,
    [
      "review_date__claim",
      "time_review__compare_day",
      "time_review__recheck_day",
      "time_review__record_timecamp",
      "time_review__redraft",
      "time_review__save_evidence",
      "time_review__stage_day",
      "time_review__wait_click",
    ],
    RULE
  );
});
