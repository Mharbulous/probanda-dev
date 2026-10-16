// research__preflight against the real host extractor: the probe must agree with what
// research_filing__law_folder_text would meet. Needs pypdf for the host python, as
// research-filing-law-text.db.test.mjs does.

import assert from "node:assert/strict";
import test from "node:test";

import { knowledgeFixture } from "./helpers/knowledge-fixture.mjs";

const { researchPreflight } = await import("../build/research/preflight.js");

test("the host extractor probes ok when pypdf is installed", (t) => {
  const f = knowledgeFixture(t);
  const result = researchPreflight(f.seams);
  assert.deepEqual(result.extractor, { pdf: "ok", docx: "ok" });
  assert.deepEqual(result.issues, []);
});

test("the host extractor without pypdf: pdf missing with the extractor's own message, docx ok", (t) => {
  const f = knowledgeFixture(t);
  process.env.COCLERK_PREFILING_FORCE_NO_PYPDF = "1";
  try {
    const result = researchPreflight(f.seams);
    assert.deepEqual(result.extractor, { pdf: "missing", docx: "ok" });
    assert.equal(result.issues.length, 1);
    assert.match(result.issues[0].detail, /pypdf is not installed .* pip install pypdf/);
    assert.match(result.issues[0].fix, /pip install pypdf/);
  } finally {
    delete process.env.COCLERK_PREFILING_FORCE_NO_PYPDF;
  }
});
