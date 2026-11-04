// The Milestone page's lane labels for an attached document's pending jobs print on every page that
// lists one, whatever the data, so none may reuse a work-marker glyph: a marker means one thing
// on the legend, and a scan of a rendered page for markers (skill-population.db.test.mjs) must
// find only what a recorder put there.

import assert from "node:assert/strict";
import test from "node:test";

const { default: script } = await import("../build/templates/milestone/milestone.js.js");
const { SYMBOLS } = await import("../build/submission/forms/symbol-table.js");

test("the pending-job lane labels on the Milestone page carry no glyph from the symbol table", () => {
  const labels = /var PENDING_EMOJI = (\{[^}]*\});/.exec(script);
  assert.ok(labels, "the pending-job label map is in the Milestone script");
  const found = SYMBOLS.map((s) => s.glyph).filter((g) => labels[1].includes(g));
  assert.deepEqual(found, []);
});
