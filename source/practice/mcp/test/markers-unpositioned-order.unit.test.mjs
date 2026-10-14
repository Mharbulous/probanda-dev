// Pure unit test for unpositionedOrderMarker in markers.ts (issue #386): the
// third derived instance of ⬜ (work-markers.md reading rule 3, "only ⬜
// means nothing started, nothing decided" -- Fable-reviewed, no new glyph).

import assert from "node:assert/strict";
import test from "node:test";

const { unpositionedOrderMarker, ALL_MARKER_GLYPHS } = await import("../build/submission/forms/markers.js");

test("renders the existing ⬜ glyph, not a new one", () => {
  assert.equal(unpositionedOrderMarker(), "⬜");
  assert.ok(ALL_MARKER_GLYPHS.includes("⬜"), "⬜ must already be in the filed-face strip list");
});
