// A BCSC material line's date (spec 2026-10-09, material relied on write path): the Notice of
// Application's Part 4, the Application Response's Part 6 and the Form 32 and Form 33 emits all print
// ", dated <Month D, YYYY>", never the stored ISO date, and nothing when the label already names it.

import assert from "node:assert/strict";
import test from "node:test";

const { materialDateSuffix } = await import("../build/submission/forms/render-bcca-factum.js");

test("a dated document prints the long date after a comma", () => {
  assert.equal(materialDateSuffix("Order made at the case planning conference", "2026-07-08"), ", dated July 8, 2026");
});

test("an undated document prints no date", () => {
  assert.equal(materialDateSuffix("Inspection Report", null), "");
});

test("a label that already names the date, in either style, prints it once", () => {
  assert.equal(materialDateSuffix("Order made July 8, 2026", "2026-07-08"), "");
  assert.equal(materialDateSuffix("2026-07-08 order", "2026-07-08"), "");
});
