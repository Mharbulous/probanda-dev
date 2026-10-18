// The unattended run's eligible list (Goal card design §5.2; plan Phase 8, step 4). The list is a
// named constant in the renderer, not a reading of the symbol table, so this test pins the two
// together: a work row of the symbol table the constant does not classify fails here, and so does any
// widening of the eligible set beyond its three instances.

import assert from "node:assert/strict";
import test from "node:test";

const { UNATTENDED_ELIGIBLE } = await import("../build/submission/forms/render-work-board.js");
const { SYMBOLS } = await import("../build/submission/forms/symbol-table.js");

/** The glyph of every work row of symbol-table.ts (work-markers.md table 1a's rows, moved there). */
function workGlyphs() {
  return SYMBOLS.filter((s) => s.group === "work").map((s) => s.glyph);
}

test("every work marker of the symbol table is classified by the eligible list", () => {
  const glyphs = workGlyphs();
  assert.equal(glyphs.length, 31, "the symbol table holds 31 work glyphs");
  const unclassified = glyphs.filter((g) => !UNATTENDED_ELIGIBLE.has(g));
  assert.deepEqual(unclassified, [], "a work row the eligible list does not classify");
});

test("the eligible set is exactly the three instances, and 🧐 and the court-record 📌 are out", () => {
  const eligible = [...UNATTENDED_ELIGIBLE].filter(([, tables]) => tables.length > 0);
  assert.deepEqual(eligible, [
    ["📌", ["statements_of_fact", "admissions"]],
    ["🧷", ["statements_of_fact", "admissions"]],
    ["🏷️", ["documents"]],
  ]);
  assert.deepEqual(UNATTENDED_ELIGIBLE.get("🧐"), []);
  assert.equal(UNATTENDED_ELIGIBLE.get("📌").includes("facts"), false);
});
