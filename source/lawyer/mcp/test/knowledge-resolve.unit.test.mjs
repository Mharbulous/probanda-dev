// Resolve (shared/knowledge-tree.md section 5, plan Phase 7): normalize, then three
// named candidate rules -- jurisdiction affix (venues only), acronym, token containment
// -- and never edit distance. `ambiguous` with `alias_split` when one name sits on two
// codes; under _NoVenue the caller's recipient decides, and is required.

import assert from "node:assert/strict";
import test from "node:test";

import { errorOf, knowledgeFixture } from "./helpers/knowledge-fixture.mjs";

const { knowledgeList } = await import("../build/knowledge/tools.js");

const VENUES = {
  jurisdiction: "BC",
  name: "British Columbia",
  venues: [
    { code: "BCSC", name: "Supreme Court of British Columbia", aliases: [{ name: "BC Supreme Court" }, { name: "Law Courts" }] },
    { code: "BCCA", name: "Court of Appeal for British Columbia", aliases: [{ name: "Law Courts" }] },
    { code: "BCPC", name: "Provincial Court of British Columbia", aliases: [] },
    { code: "BCCRT", name: "Civil Resolution Tribunal", aliases: [] },
    { code: "BCXYZ", name: "Example Tribunal", aliases: [] },
    { code: "Vancouver International Arbitration Centre", name: "Vancouver International Arbitration Centre", aliases: [{ name: "VanIAC" }] },
  ],
  not_venues: [
    { name: "Ministry of Attorney General", aliases: [{ name: "MAG" }], resolves_to: "_NoVenue", source: "practitioner", ref: "L8443", recorded: "2026-09-01" },
  ],
};

function fixture(t) {
  const f = knowledgeFixture(t);
  f.shipped("draft/CAN/BC/venues.json", VENUES);
  f.shipped("draft/CAN/BC/BCSC/Documents/kinds.json", {
    kinds: [
      { file: "notice-of-application", name: "Notice of Application", aliases: [{ name: "notice_of_application" }] },
      { file: "application-response", name: "Application Response", aliases: [{ name: "application_response" }] },
    ],
  });
  f.shipped("draft/CAN/BC/_NoVenue/Documents/kinds.json", {
    kinds: [
      { file: "letter-to-opposing-counsel", name: "Letter to opposing counsel", aliases: [{ name: "demand letter" }], recipient: "opposing-counsel" },
      { file: "letter-to-opposing-party", name: "Letter to opposing party", aliases: [{ name: "demand letter" }], recipient: "opposing-party" },
    ],
  });
  const venue = (name) => knowledgeList({ dir: "draft/CAN/BC", resolve: name }, f.seams);
  const kind = (dir, name, recipient) => knowledgeList({ dir, resolve: name, recipient }, f.seams);
  return { f, venue, kind };
}

const RULES = new Set(["jurisdiction_affix", "acronym", "token_containment"]);

test("equality after normalization resolves by code, official name, alias or not-venue ruling", (t) => {
  const { venue } = fixture(t);
  let r = venue("bcsc");
  assert.deepEqual([r.result, r.code, r.via], ["resolved", "BCSC", "code"]);
  r = venue("The Supreme Court of British Columbia");
  assert.deepEqual([r.result, r.code, r.via], ["resolved", "BCSC", "name"], "a leading 'the' is dropped");
  r = venue("B.C. Supreme Court");
  assert.deepEqual([r.result, r.code, r.via], ["resolved", "BCSC", "alias"], "only letters and digits count");
  r = venue("ｖａｎＩＡＣ");
  assert.deepEqual([r.result, r.code], ["resolved", "Vancouver International Arbitration Centre"], "NFKC folds full-width letters");

  r = venue("MAG");
  assert.equal(r.result, "resolved");
  assert.equal(r.code, "_NoVenue");
  assert.equal(r.via, "not_venue");
  assert.equal(r.not_venue.name, "Ministry of Attorney General");
  assert.equal(r.row.reserved, true);
  assert.equal(r.shipped_from, "install");
  assert.equal(r.plugin_version, "9.9.9");
});

test("the jurisdiction-affix rule fires alone, by name", (t) => {
  const { venue } = fixture(t);
  const r = venue("XYZ");
  assert.equal(r.result, "near_miss");
  assert.deepEqual(r.candidates, [{ code: "BCXYZ", name: "Example Tribunal", rule: "jurisdiction_affix" }]);
});

test("the acronym rule fires alone, by name", (t) => {
  const { venue } = fixture(t);
  const r = venue("ET");
  assert.equal(r.result, "near_miss");
  assert.deepEqual(r.candidates, [{ code: "BCXYZ", name: "Example Tribunal", rule: "acronym" }]);
});

test("the token-containment rule fires alone, by name, with the venue stopwords removed", (t) => {
  const { venue } = fixture(t);
  const r = venue("Example");
  assert.equal(r.result, "near_miss");
  assert.deepEqual(r.candidates, [{ code: "BCXYZ", name: "Example Tribunal", rule: "token_containment" }]);
  // "court", "of" and "british columbia" are stopwords, so the Supreme Court is contained in this name.
  const supreme = venue("Supreme Court BC Registry");
  assert.deepEqual(supreme.candidates, [{ code: "BCSC", name: "Supreme Court of British Columbia", rule: "token_containment" }]);
});

test("CRT against BCCRT is found by the affix and by the acronym, each named", (t) => {
  const { venue } = fixture(t);
  const r = venue("CRT");
  assert.equal(r.result, "near_miss");
  assert.deepEqual(r.candidates, [
    { code: "BCCRT", name: "Civil Resolution Tribunal", rule: "jurisdiction_affix" },
    { code: "BCCRT", name: "Civil Resolution Tribunal", rule: "acronym" },
  ]);
});

test("edit distance never fires: one character off a code finds nothing", (t) => {
  const { venue } = fixture(t);
  for (const name of ["BCSB", "BCSD", "BCCB", "BCPA", "VanIAD"]) {
    const r = venue(name);
    assert.equal(r.result, "not_found", `${name} must not reach a venue one character away: ${JSON.stringify(r)}`);
  }
  for (const name of ["XYZ", "ET", "Example", "CRT", "SC"]) {
    for (const candidate of venue(name).candidates) assert.ok(RULES.has(candidate.rule), `${name}: unnamed rule ${candidate.rule}`);
  }
});

test("one alias on two codes is ambiguous, reported as alias_split", (t) => {
  const { venue } = fixture(t);
  const r = venue("law courts");
  assert.equal(r.result, "ambiguous");
  assert.deepEqual(r.alias_split, [
    { code: "BCSC", name: "Supreme Court of British Columbia", via: "alias" },
    { code: "BCCA", name: "Court of Appeal for British Columbia", via: "alias" },
  ]);
});

test("kinds resolve with the kind stopwords, and a venue's kinds take no recipient", (t) => {
  const { kind } = fixture(t);
  const dir = "draft/CAN/BC/BCSC/Documents";
  let r = kind(dir, "notice_of_application");
  assert.deepEqual([r.result, r.code, r.index], ["resolved", "notice-of-application", "kinds"]);
  r = kind(dir, "Application Notice Form");
  assert.equal(r.result, "near_miss");
  assert.deepEqual(r.candidates, [{ code: "notice-of-application", name: "Notice of Application", rule: "token_containment" }]);
  assert.equal(errorOf(() => kind(dir, "notice of application", "witness")).name, "ValidationError");
});

test("a _NoVenue resolve is refused without recipient; with one, the recipient decides a shared alias", (t) => {
  const { kind } = fixture(t);
  const dir = "draft/CAN/BC/_NoVenue/Documents";
  const err = errorOf(() => kind(dir, "demand letter"));
  assert.equal(err.name, "ValidationError");
  assert.match(err.message, /recipient/);
  const r = kind(dir, "demand letter", "opposing-party");
  assert.deepEqual([r.result, r.code, r.recipient], ["resolved", "letter-to-opposing-party", "opposing-party"]);
  assert.equal(kind(dir, "demand letter", "opposing-counsel").code, "letter-to-opposing-counsel");
  assert.equal(kind(dir, "demand letter", "witness").result, "not_found");
});

test("resolve needs a jurisdiction or Documents folder", (t) => {
  const { f } = fixture(t);
  assert.equal(errorOf(() => knowledgeList({ dir: "draft/CAN", resolve: "BCSC" }, f.seams)).name, "ValidationError");
  assert.equal(errorOf(() => knowledgeList({ dir: "draft/CAN/BC/BCSC", resolve: "BCSC" }, f.seams)).name, "ValidationError");
  assert.equal(errorOf(() => knowledgeList({ dir: "draft/CAN/ON", resolve: "BCSC" }, f.seams)).code, "index_missing");
});
