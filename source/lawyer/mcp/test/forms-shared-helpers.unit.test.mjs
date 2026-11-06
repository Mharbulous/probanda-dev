// The helpers the BCSC and BCCA filing renderers share (#182): one definition each, with the
// Form 32 filed face's `>> ` citation prefix kept as a parameter.

import assert from "node:assert/strict";
import test from "node:test";

const { formatTimeEstimate, pushExcerptBlockquote } = await import("../build/submission/forms/components.js");
const { factStatementCitationLine, statementBlock } = await import("../build/submission/forms/statement-lines.js");
const { printedPinpoint } = await import("../build/submission/forms/law-statement-line.js");
const { fenceStep } = await import("../build/submission/forms/fence.js");
const { factsPart } = await import("../build/submission/forms/filing-facts.js");

test("formatTimeEstimate prints hours and minutes as asm32 parses them", () => {
  assert.equal(formatTimeEstimate(0), "0 minutes");
  assert.equal(formatTimeEstimate(1), "1 minute");
  assert.equal(formatTimeEstimate(45), "45 minutes");
  assert.equal(formatTimeEstimate(60), "1 hour");
  assert.equal(formatTimeEstimate(90), "1 hour 30 minutes");
  assert.equal(formatTimeEstimate(121), "2 hours 1 minute");
});

test("pushExcerptBlockquote quotes each non-blank line, then the citation line", () => {
  const lines = [];
  pushExcerptBlockquote(lines, "first\n\n  \nsecond", ">> Affidavit #1, para 2");
  assert.deepEqual(lines, ["> first", "> second", ">> Affidavit #1, para 2"]);
  const none = [];
  pushExcerptBlockquote(none, null, "> citation");
  pushExcerptBlockquote(none, "", "> citation");
  assert.deepEqual(none, []);
  const noCitation = [];
  pushExcerptBlockquote(noCitation, "only", null);
  assert.deepEqual(noCitation, ["> only"]);
});

test("factStatementCitationLine prints `> ` by default and the prefix it is given", () => {
  const labels = new Map([[7, "Affidavit #2 of A. Witness"], [9, "Invoice"]]);
  const exhibits = new Map([[9, 3]]);
  const stmt = { instrument_id: 7, pinpoint: "para 4", exhibit_id: 9, exhibit_pinpoint: "p. 2" };
  assert.equal(factStatementCitationLine(exhibits, labels, stmt), "> Affidavit #2 of A. Witness, para 4, Ex. 3, p. 2");
  assert.equal(factStatementCitationLine(exhibits, labels, stmt, ">> "), ">> Affidavit #2 of A. Witness, para 4, Ex. 3, p. 2");
  assert.equal(factStatementCitationLine(exhibits, labels, { instrument_id: null, pinpoint: null, exhibit_id: null, exhibit_pinpoint: null }, ">> "), null);
});

test("printedPinpoint prints a pinpoint once, whether the pinpoint repeats the citation or the citation ends with it", () => {
  assert.equal(printedPinpoint("B.C. Reg. 168/2009, r. 22-8(1)", "r. 22-8(1)"), null);
  assert.equal(printedPinpoint("2023 BCCA 182", "2023 BCCA 182, para. 34"), "para. 34");
  assert.equal(printedPinpoint("2023 BCCA 182", "2"), "2", "a short pinpoint matching the citation's tail is still printed");
  assert.equal(printedPinpoint(null, "para. 5"), "para. 5");
});

test("statementBlock fences the excerpt byte for byte, longer than any backtick run in it, then the citation, markers and id on one line", () => {
  const excerpt = "  ``` opens a line\n\nand a ```` run";
  const block = statementBlock(excerpt, "> *A v B*, 2020 BCCA 1, para. 5", "🔬 📇", "statement_of_law_id", 7, "");
  assert.deepEqual(block, ["`````", "  ``` opens a line", "", "and a ```` run", "`````", "", "> *A v B*, 2020 BCCA 1, para. 5 🔬 📇 <!-- statement_of_law_id 7 -->"]);
  assert.equal(block.slice(1, -3).join("\n"), excerpt);
  assert.deepEqual(statementBlock(null, null, "", "rhetorical_paragraph_record_id", 2, "   "), ["   <!-- rhetorical_paragraph_record_id 2 -->"]);
  // A reader keeps the excerpt's own ``` line inside the fence.
  let open = "";
  const inside = block.map((line) => {
    const was = open;
    open = fenceStep(open, line).open;
    return was !== "" && open !== "";
  });
  assert.deepEqual(inside, [false, true, true, true, false, false, false]);
});

test("each filing kind's facts Part comes from one table", () => {
  assert.equal(factsPart("notice_of_application"), "part2");
  assert.equal(factsPart("application_response"), "part4");
  assert.equal(factsPart("bcca_stay_response"), "part2");
  assert.equal(factsPart("bcca_factum"), "part2");
  assert.throws(() => factsPart("requisition_consent"), /No facts Part is registered for kind requisition_consent/);
});
