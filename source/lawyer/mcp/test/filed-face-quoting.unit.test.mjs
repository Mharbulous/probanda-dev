// The quoting tag (schema v61) never reaches the filed face, wherever the statement's markers
// and id comment sit on its citation line (statementBlock puts them on that same line).

import assert from "node:assert/strict";
import test from "node:test";

const { toFiledFace } = await import("../build/submission/forms/filed-face.js");

const CITATION = "   > *Older Case v. Example*, 2011 BCCA 1, para 12";

test("the quoting tag is stripped when a marker follows it on the citation line", () => {
  const face = toFiledFace(`1. A proposition.\n\n${CITATION} (quoting A Judge in An Earlier Case) 🕰️ <!-- statement_of_law_id 1 -->\n`);
  assert.ok(face.includes(CITATION), face);
  assert.doesNotMatch(face, /quoting|🕰/, face);
});

test("the quoting tag is stripped when only the id comment follows it", () => {
  const face = toFiledFace(`1. A proposition.\n\n${CITATION} (quoting A Judge in An Earlier Case) <!-- statement_of_law_id 1 -->\n`);
  assert.doesNotMatch(face, /quoting/, face);
});

test("the quoting tag is stripped when a later tag and a marker follow it", () => {
  const face = toFiledFace(`1. A proposition.\n\n${CITATION} (quoting A Judge in An Earlier Case) (killed 2026-01-02) 🕰️ <!-- statement_of_law_id 1 -->\n`);
  assert.doesNotMatch(face, /quoting|killed|🕰/, face);
});
