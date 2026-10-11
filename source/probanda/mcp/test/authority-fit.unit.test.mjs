// The authority-fit checks (schema v61, planning/1. Design/2026-10-06_authority-fit-checks-spec.md):
// the citation year, the linked-provisions column, the 🕰️ predicate and the quoting tag on a statement
// line. Pure: no database, no render.

import assert from "node:assert/strict";
import test from "node:test";

const { citationYear, parseLinkedProvisions, predatedProvision, PROVISION_FIELD_SEP, PROVISION_RECORD_SEP } = await import("../build/submission/forms/authority-fit.js");
const { lawStatementCitationLine, lawStatementMarkers } = await import("../build/submission/forms/law-statement-line.js");

const column = (...records) => records.map(([inForce, citation]) => `${inForce}${PROVISION_FIELD_SEP}${citation}`).join(PROVISION_RECORD_SEP);
const caseRow = (citation) => ({ authority_kind: "case", authority_citation: citation });

test("the citation year is the first four-digit year of a neutral, reporter or enactment citation", () => {
  assert.equal(citationYear("2011 BCCA 1"), 2011);
  assert.equal(citationYear("[1981] AC 909 (HL)"), 1981);
  assert.equal(citationYear("(1999), 12 BCLR (3d) 45 (CA)"), 1999);
  assert.equal(citationYear("SBC 2020, c 1"), 2020);
  assert.equal(citationYear("RSBC 1996, c 1"), 1996);
  assert.equal(citationYear("BC Reg 168/2009"), 2009);
  assert.equal(citationYear("2020-07-01"), 2020);
  assert.equal(citationYear("Example Act, c 12345"), null, "five digits are not a year");
  assert.equal(citationYear("no year here"), null);
  assert.equal(citationYear(null), null);
});

test("the linked-provisions column parses into citation and in-force pairs", () => {
  assert.deepEqual(parseLinkedProvisions(null), []);
  assert.deepEqual(parseLinkedProvisions(""), []);
  assert.deepEqual(parseLinkedProvisions(column(["", "SBC 2020, c 1"], ["2015-03-01", "RSBC 1996, c 1"])), [
    { citation: "SBC 2020, c 1", in_force_on: null },
    { citation: "RSBC 1996, c 1", in_force_on: "2015-03-01" },
  ]);
});

test("a case decided before a linked provision's year is flagged, naming that provision", () => {
  const provisions = parseLinkedProvisions(column(["", "RSBC 1996, c 1"], ["", "SBC 2020, c 1"]));
  assert.deepEqual(predatedProvision(caseRow("2011 BCCA 1"), provisions), { citation: "SBC 2020, c 1", in_force_on: null });
});

test("a recorded in-force date overrides the provision's citation year, both ways", () => {
  const amendedLater = parseLinkedProvisions(column(["2015-03-01", "RSBC 1996, c 1"]));
  assert.notEqual(predatedProvision(caseRow("2011 BCCA 1"), amendedLater), null, "a section brought into force in 2015 postdates a 2011 case");
  const inForceEarly = parseLinkedProvisions(column(["2005-01-01", "SBC 2020, c 1"]));
  assert.equal(predatedProvision(caseRow("2011 BCCA 1"), inForceEarly), null);
});

test("the same year, an unknown year, or a non-case statement raises nothing", () => {
  assert.equal(predatedProvision(caseRow("2020 BCCA 1"), parseLinkedProvisions(column(["", "SBC 2020, c 1"]))), null);
  assert.equal(predatedProvision(caseRow("Unreported, no year"), parseLinkedProvisions(column(["", "SBC 2020, c 1"]))), null);
  assert.equal(predatedProvision(caseRow("2011 BCCA 1"), parseLinkedProvisions(column(["", "Example Act"]))), null);
  assert.equal(predatedProvision({ authority_kind: "statute", authority_citation: "SBC 2011, c 1" }, parseLinkedProvisions(column(["", "SBC 2020, c 1"]))), null);
  assert.equal(predatedProvision(caseRow("2011 BCCA 1"), []), null);
});

const line = (over = {}) => ({
  pinpoint: "para 12", excerpt: "e", doubt: null, source: "primary", verification: "verified", treatment: "good_law",
  authority_kind: "case", currency_status: null, treatment_note: null, authority_title: "Older Case v. Example",
  authority_citation: "2011 BCCA 1", authority_killed_on: null, settled_on: null, excerpt_speaker: null, linked_provisions: null,
  ...over,
});

test("the statement line carries 🕰️ beside its other markers, and no 🕰️ when killed or overruled", () => {
  const linked = column(["", "SBC 2020, c 1"]);
  assert.equal(lawStatementMarkers(line({ linked_provisions: linked })), "🕰️");
  assert.equal(lawStatementMarkers(line()), "");
  assert.equal(lawStatementMarkers(line({ linked_provisions: linked, authority_killed_on: "2026-10-01" })), "");
  assert.ok(!lawStatementMarkers(line({ linked_provisions: linked, treatment: "overruled" })).includes("🕰️"));
});

test("a recorded speaker prints a quoting tag right after the pinpoint, before the other tags", () => {
  assert.equal(
    lawStatementCitationLine(line({ excerpt_speaker: "Lord  Example in\nAn Earlier Case", treatment_note: "followed" })),
    "> *Older Case v. Example*, 2011 BCCA 1, para 12 (quoting Lord Example in An Earlier Case) (note-up: followed)",
  );
  assert.equal(lawStatementCitationLine(line()), "> *Older Case v. Example*, 2011 BCCA 1, para 12");
});
