// Coverage meta-test for the court-ready emitters' goldens (issue #816). The
// sibling of filed-face-coverage.db.test.mjs, for the other half of the class.
//
// #805 pinned every document submissionFormsRender returns in renderMode
// 'filed'. The four court-ready emitters build their own documents and never
// pass through toFiledFace, so nothing there reached them -- and per #795 they
// are the path that actually ends at a court registry
// (drafting_forms__emit_form32 -> render-form32-filed-face.ts -> asm32 ->
// .docx), while the filed markdown #805 pinned has no documented exposure.
//
// The gap was real, and measured rather than assumed. With a plain-prose
// annotation of the #795 kind pushed into each emitter, in a position that is
// legal under that emitter's own grammar, the suite ran 582 passed / 1 failed:
//
//   * form-33's extra Part 6 list item      -- shipped green
//   * bcca-factum's OPENING STATEMENT line  -- shipped green
//   * bcca-book's contacts[1].counsel_firm  -- shipped green
//   * form-32's extra Part 4 list item      -- caught, but only by an
//     incidental strictEqual in exhibit-numbering.db.test.mjs, in that one
//     position
//
// Two facts that came out of that and that the goldens exist because of:
//
//   1. The Python acceptance oracles (validate32, validate33, fill_factum.py
//      --validate, the bcca-book checker) guard line SHAPE, not content. An
//      annotation on its own unnumbered line mid-Part is rejected ("paragraph
//      numbering must be continuous"); the same annotation written as a legal
//      list item, a free-prose line, or a suffix inside a numbered paragraph
//      is accepted by all four.
//   2. Every assertion in the emitter tests is a presence check (assert.match
//      / a deepEqual of one parsed key). None of them asks whether the face
//      contains anything ELSE. A golden is the only instrument that does.
//
// This file asserts only that each emitter has a declared golden and that it
// exists. The byte-for-byte comparison stays with the test that owns each
// fixture, which is where a regeneration gets reviewed by eye.
//
// It reads the emitter roster off the built module rather than trusting a list
// in test code, so adding a fifth submissionFormsEmit* export turns this red
// until its face is declared and pinned.

import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import test from "node:test";
import { goldenPath } from "./fixtures/forms-render-seeds.mjs";

const forms = await import("../build/submission/forms.js");

// Emitter -> the goldens pinning every face it can emit. A single emitter can
// deliver more than one face: submissionFormsEmitBccaBook serves two filing
// kinds and drops the four response_book_* keys as a group for a factum, so
// its two shapes are separate delivered faces and get a golden each.
const DECLARED = {
  submissionFormsEmitForm32: ["form-32-emitted"],
  submissionFormsEmitForm33: ["form-33-emitted"],
  submissionFormsEmitBccaFactum: ["bcca-factum-emitted"],
  submissionFormsEmitBccaBook: ["bcca-book-stay-response-emitted", "bcca-book-factum-emitted"],
  submissionFormsEmitAffidavit: ["affidavit-emitted"],
};

test("every court-ready emitter is declared here, and nothing stale is", () => {
  const exported = Object.keys(forms)
    .filter((name) => name.startsWith("submissionFormsEmit") && typeof forms[name] === "function")
    .sort();
  assert.deepEqual(
    exported,
    Object.keys(DECLARED).sort(),
    "the court-ready emitters exported by build/submission/forms.js have changed. A new submissionFormsEmit* " +
      "export reaches a court registry (#795) and nothing in the filed-face goldens (#805) covers it, because it " +
      "never passes through toFiledFace. Declare its face(s) in DECLARED above and pin each with a golden, " +
      "asserted from the test that seeds it. Removing an emitter means deleting its entry and its golden."
  );
});

test("every declared emitter face has a filed golden on disk", () => {
  for (const [emitter, goldens] of Object.entries(DECLARED)) {
    assert.ok(goldens.length > 0, `${emitter} declares no golden`);
    for (const name of goldens) {
      const path = goldenPath(name);
      assert.ok(
        existsSync(path),
        `${emitter}'s "${name}" face has no golden at ${path}. Review the emitted face by eye, then regenerate ` +
          `with COCLERK_REGENERATE_GOLDEN=1.`
      );
    }
  }
});
