// The helpers the BCSC and BCCA filing renderers share (#182): one definition each, with the
// Form 32 filed face's `>> ` citation prefix kept as a parameter.

import assert from "node:assert/strict";
import test from "node:test";

const { formatTimeEstimate, pushExcerptBlockquote } = await import("../build/submission/forms/components.js");
const { factStatementCitationLine } = await import("../build/submission/forms/statement-lines.js");
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

test("each filing kind's facts Part comes from one table", () => {
  assert.equal(factsPart("notice_of_application"), "part2");
  assert.equal(factsPart("application_response"), "part4");
  assert.equal(factsPart("bcca_stay_response"), "part2");
  assert.equal(factsPart("bcca_factum"), "part2");
  assert.throws(() => factsPart("requisition_consent"), /No facts Part is registered for kind requisition_consent/);
});
