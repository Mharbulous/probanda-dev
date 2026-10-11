// Pure unit tests for the capture predicates after the basis split (#502 excerpt,
// #511 pinpoint) -- excerptMarker/factExcerptMarker and the three pinpoint markers in
// markers.ts. One 💬 and one 📍 used to serve every domain; each glyph now has its own
// predicate whose parameters are exactly the cells work-markers.md's row reads.

import assert from "node:assert/strict";
import test from "node:test";

const {
  ALL_MARKER_GLYPHS,
  authorityPinpointMarker,
  clauseMarkers,
  dedupeLineMarkers,
  excerptMarker,
  exhibitPinpointMarker,
  factExcerptMarker,
  testimonyPinpointMarker,
} = await import("../build/submission/forms/markers.js");

test("excerptMarker -- an uncaptured passage renders the glyph of its basis", () => {
  assert.equal(excerptMarker("authority", null), "📜");
  assert.equal(excerptMarker("exhibit", null), "📑");
  assert.equal(excerptMarker("testimony", null), "💬");
});

test("excerptMarker -- an empty string counts as uncaptured, like a NULL column", () => {
  assert.equal(excerptMarker("authority", ""), "📜");
  assert.equal(excerptMarker("exhibit", ""), "📑");
  assert.equal(excerptMarker("testimony", ""), "💬");
});

test("excerptMarker -- a captured passage clears on every basis", () => {
  assert.equal(excerptMarker("authority", "the court held"), "");
  assert.equal(excerptMarker("exhibit", "clause 4.1"), "");
  assert.equal(excerptMarker("testimony", "I saw it"), "");
});

// work-markers.md row 💬: its predicate is `exhibit_id` ∅. An exhibit-backed statement of
// fact quotes the exhibit, so it owes 📑 on the exhibit's own passage and never 💬 -- an
// empty testimony excerpt on such a row is not work.
test("factExcerptMarker -- an exhibit-backed statement with the exhibit captured is clean, even with no testimony excerpt", () => {
  assert.equal(factExcerptMarker({ exhibit_id: 7, exhibit_excerpt: "clause 4.1", excerpt: null }), "");
});

test("factExcerptMarker -- an exhibit-backed statement with the exhibit uncaptured owes 📑, never 💬", () => {
  assert.equal(factExcerptMarker({ exhibit_id: 7, exhibit_excerpt: null, excerpt: "I saw it" }), "📑");
});

test("factExcerptMarker -- a statement with no exhibit falls to the witness's own words", () => {
  assert.equal(factExcerptMarker({ exhibit_id: null, exhibit_excerpt: null, excerpt: null }), "💬");
  assert.equal(factExcerptMarker({ exhibit_id: null, exhibit_excerpt: null, excerpt: "I saw it" }), "");
});

test("authorityPinpointMarker -- 📍 is law-only and needs no link to fire", () => {
  assert.equal(authorityPinpointMarker(null), "📍");
  assert.equal(authorityPinpointMarker(""), "📍");
  assert.equal(authorityPinpointMarker("para. 34"), "");
});

test("exhibitPinpointMarker -- 📌 fires on a linked exhibit with no locator", () => {
  assert.equal(exhibitPinpointMarker(1, null), "📌");
  assert.equal(exhibitPinpointMarker(1, ""), "📌");
  assert.equal(exhibitPinpointMarker(1, "s. 2.3"), "");
});

test("exhibitPinpointMarker -- no exhibit means nothing to locate", () => {
  assert.equal(exhibitPinpointMarker(null, null), "");
});

test("testimonyPinpointMarker -- 🧷 fires on a linked instrument with no locator", () => {
  assert.equal(testimonyPinpointMarker(3, null), "🧷");
  assert.equal(testimonyPinpointMarker(3, ""), "🧷");
  assert.equal(testimonyPinpointMarker(3, "para 3"), "");
});

test("testimonyPinpointMarker -- no instrument (✍️, oral) means nothing to locate", () => {
  assert.equal(testimonyPinpointMarker(null, null), "");
});

// work-markers.md §2: 📍 ⊕ 📌 ⊕ 🧷 per locator, ∨ per line -- an exhibit-backed statement of
// fact can owe both its exhibit's locator and its instrument's at once ("Affidavit #1 of
// A. Marlowe, para 3, Ex. A, s. 2.3").
test("a statement owing both locators renders 📌 🧷 on one line", () => {
  assert.equal(dedupeLineMarkers([exhibitPinpointMarker(1, null), testimonyPinpointMarker(3, null)]), "📌 🧷");
});

// Issue #322: the fact's line renders the pinpoint glyph once, not once per statement.
// The unit-level form of that invariant -- two instrument-linked statements on one fact,
// each owing 🧷, collapse to a single glyph. The renderer-level count in
// forms-render-bcsc.db.test.mjs no longer exercises it (after the #511 basis split only one
// of that fixture's two statements has an instrument at all).
test("issue #322 -- two statements each owing 🧷 collapse to one glyph on the fact's line", () => {
  assert.equal(dedupeLineMarkers([testimonyPinpointMarker(3, null), testimonyPinpointMarker(4, null)]), "🧷");
});

test("ALL_MARKER_GLYPHS carries every split glyph, so none leaks onto a filed face", () => {
  for (const glyph of ["📜", "📑", "📌", "🧷", "🔬"]) {
    assert.ok(ALL_MARKER_GLYPHS.includes(glyph), `ALL_MARKER_GLYPHS is missing ${glyph}`);
  }
});

// #1158: an express clause owes its source passage verbatim as well as its locator.
const expressClause = (pinpoint, excerpt) => ({
  basis: "express", document_id: 50, pinpoint, excerpt, excerpt_id: null,
  statement_pinpoint: null, verification: null, treatment: null, authority_killed_on: null,
});

test("clauseMarkers -- an express clause with its pinpoint and no excerpt renders 📑", () => {
  assert.equal(clauseMarkers(expressClause("p. 1", null)), "📑");
  assert.equal(clauseMarkers(expressClause("p. 1", "")), "📑");
});

test("clauseMarkers -- an express clause owing both renders 📑 📌, and one with both captured renders nothing", () => {
  assert.equal(clauseMarkers(expressClause(null, null)), "📑 📌");
  assert.equal(clauseMarkers(expressClause(null, "the passage")), "📌");
  assert.equal(clauseMarkers(expressClause("p. 1", "the passage")), "");
});
