// Structural scan of a filed face (issue #805). toFiledFace
// (src/submission/forms/filed-face.ts) strips a fixed set of syntactic
// mechanisms out of a mockup; this asserts none of them survived onto a
// delivered face. Promoted out of the inline loop that lived in
// forms-render-vaniac.db.test.mjs, so every filed-mode render in the test tree
// runs the same scan instead of one kind's render running it alone.
//
// What this does NOT catch, by construction: a mockup annotation written as
// plain prose carries none of these mechanisms and passes straight through
// (issue #795's "Power to make" note). The filed golden fixtures are the guard
// for that class; this scan is the guard for the mechanisms.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const { ALL_MARKER_GLYPHS } = await import("../../build/submission/forms/markers.js");

// A copy of MOCKUP_ONLY_HEADINGS in src/submission/forms/filed-face.ts, which does not export it
// -- exporting it would be a production source change, out of bounds for #805. filed-face.ts is
// the source of truth, and assertHeadingListInStep below reads that file and fails if this copy
// has drifted, so a heading added there cannot go silently unscanned here.
const MOCKUP_ONLY_HEADINGS = [
  "Source trace",
  "Facts attributed to this witness, not yet in this statement",
  "Opposing points",
  "Positions not yet taken",
  "Points not yet answered",
  "Court rules not in this appendix",
  "Page budget",
  "Legend",
];

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Fails if the copy above has drifted from filed-face.ts's own MOCKUP_ONLY_HEADINGS. Reads the
 * source as text rather than importing it, because the constant is deliberately not exported.
 * Call this from one test; it needs no database and no render.
 */
export function assertHeadingListInStep() {
  const source = readFileSync(
    fileURLToPath(new URL("../../src/submission/forms/filed-face.ts", import.meta.url)),
    "utf-8"
  );
  const match = /const MOCKUP_ONLY_HEADINGS\s*=\s*\[([\s\S]*?)\]/.exec(source);
  assert.ok(match, "could not find MOCKUP_ONLY_HEADINGS in src/submission/forms/filed-face.ts");
  // Strip // comments first. The array's own comments quote heading fragments across line breaks
  // ("### Part 2: / Issues"), which a bare string match would read as an eighth entry.
  const entries = match[1].replace(/\/\/[^\n]*/g, "");
  const fromSource = [...entries.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((m) => m[1]);
  assert.deepEqual(
    fromSource,
    MOCKUP_ONLY_HEADINGS,
    "MOCKUP_ONLY_HEADINGS in test/helpers/filed-face-scan.mjs has drifted from filed-face.ts. " +
      "Copy the source list across -- a heading missing here is a mockup-only section no filed-face scan checks for."
  );
}

/**
 * One filed-face markdown string carries none of the mechanisms toFiledFace strips: the
 * frontmatter block, HTML comments, a mockup-only section at any heading level 2-6 (the BCCA
 * renderers nest theirs as ####), crossed-out strikethrough markup, and every glyph in
 * ALL_MARKER_GLYPHS. `label` names the document in the failure message.
 */
export function assertFiledFaceClean(markdown, label) {
  assert.doesNotMatch(markdown, /<!--/, `expected no HTML comment left in ${label}`);
  assert.doesNotMatch(markdown, /^---$/m, `expected no frontmatter block left in ${label}`);
  for (const heading of MOCKUP_ONLY_HEADINGS) {
    assert.doesNotMatch(
      markdown,
      new RegExp(`^#{2,6} ${escapeRegExp(heading)}$`, "m"),
      `expected no mockup-only "${heading}" section left in ${label}`
    );
  }
  assert.doesNotMatch(markdown, /~~/, `expected no crossed-out strikethrough markup left in ${label}`);
  // Pictograph-leak scan: every glyph ALL_MARKER_GLYPHS knows about must be gone. This does not
  // prove no *other* glyph survives (see filed-face.ts's own residual-risk note) --
  // filed-face.db.test.mjs's synthetic cases cover that ground instead.
  for (const glyph of ALL_MARKER_GLYPHS) {
    assert.doesNotMatch(markdown, new RegExp(glyph), `expected marker glyph ${glyph} stripped from ${label}`);
  }
}

/**
 * Every document of a filed-mode render: filed mode writes nothing to disk, so each document
 * carries a file_name and no path, and each one's markdown passes assertFiledFaceClean.
 */
export function assertFiledFaceDocumentsClean(documents) {
  for (const doc of documents) {
    assert.equal(doc.path, undefined, `expected no path on a filed-mode document (${doc.document_type})`);
    assert.ok(doc.file_name, `expected file_name on a filed-mode document (${doc.document_type})`);
    assertFiledFaceClean(doc.markdown, doc.file_name);
  }
}
