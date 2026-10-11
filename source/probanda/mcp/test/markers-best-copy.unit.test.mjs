// Pure unit tests for the not-best-copy grouping predicate (issue #364) --
// notBestCopyMarkers in markers.ts. No database: label groups are literal
// row arrays, exactly so the grouping logic can be pinned without a golden
// fixture's byte-for-byte fragility (mirrors markers-admissions.unit.test.mjs's
// no-DB style).

import assert from "node:assert/strict";
import test from "node:test";

const { notBestCopyMarkers } = await import("../build/submission/forms/markers.js");

test("a label group with no marked row fires 🏆 on every member", () => {
  const result = notBestCopyMarkers([
    { id: 1, label: "Contract", is_best_copy: 0 },
    { id: 2, label: "Contract", is_best_copy: 0 },
  ]);
  assert.equal(result.get(1), "🏆");
  assert.equal(result.get(2), "🏆");
});

test("a label group with one marked row clears every member, including the marked row itself", () => {
  const result = notBestCopyMarkers([
    { id: 1, label: "Contract", is_best_copy: 0 },
    { id: 2, label: "Contract", is_best_copy: 1 },
    { id: 3, label: "Contract", is_best_copy: 0 },
  ]);
  assert.equal(result.get(1), "");
  assert.equal(result.get(2), "");
  assert.equal(result.get(3), "");
});

test("different labels are independent groups", () => {
  const result = notBestCopyMarkers([
    { id: 1, label: "Contract", is_best_copy: 1 },
    { id: 2, label: "Site Diary", is_best_copy: 0 },
  ]);
  assert.equal(result.get(1), "", "the marked group's own row is clean");
  assert.equal(result.get(2), "🏆", "an unrelated label with no marked row still fires");
});

test("a singleton unmarked group still fires -- no group-size gate", () => {
  const result = notBestCopyMarkers([{ id: 1, label: "Delivery Note", is_best_copy: 0 }]);
  assert.equal(result.get(1), "🏆");
});

test("empty input returns an empty map", () => {
  const result = notBestCopyMarkers([]);
  assert.equal(result.size, 0);
});
