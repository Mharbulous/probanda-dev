// Pure unit tests for the best-source-rung predicate (issues #365, #597) --
// sourceRungMarker and statementSourceMarker in markers.ts. No database:
// source-value arrays are literal, exactly so the truth table can be pinned
// without a golden fixture's byte-for-byte fragility (mirrors
// markers-best-copy.unit.test.mjs's no-DB style).
//
// #597 changed the unrated case. #365 routed a NULL source to 🥉 as a
// fail-visible default, which asserted a falsehood: a proposition resting on
// an unrated SCC decision, or on the governing statute itself, was told to go
// find primary or secondary authority. NULL now fires its own marker, 🏅
// unrated -- a marker on the *blank*, never a fourth value on the axis, and
// meaning the rung is undeterminable rather than a lower rank. 🥉 accordingly
// narrowed to require an actual 'tertiary', mirroring 🥈's form.

import assert from "node:assert/strict";
import test from "node:test";

const { sourceRungMarker, statementSourceMarker } = await import("../build/submission/forms/markers.js");

test("empty input renders nothing -- that's 📖's state, not this predicate's", () => {
  assert.equal(sourceRungMarker([]), "");
});

test("a lone unrated (NULL) statement fires 🏅 alone, never 🥉 (#597)", () => {
  assert.equal(sourceRungMarker([null]), "🏅");
});

test("all-NULL statements fire 🏅 -- the rung is undeterminable, not tertiary", () => {
  assert.equal(sourceRungMarker([null, null]), "🏅");
});

test("a lone tertiary statement fires 🥉", () => {
  assert.equal(sourceRungMarker(["tertiary"]), "🥉");
});

test("tertiary mixed with unrated co-renders 🥉🏅 -- both pieces of work show", () => {
  assert.equal(sourceRungMarker(["tertiary", null]), "🥉🏅");
});

test("all-tertiary statements fire 🥉 with no 🏅", () => {
  assert.equal(sourceRungMarker(["tertiary", "tertiary"]), "🥉");
});

test("a lone secondary statement fires 🥈", () => {
  assert.equal(sourceRungMarker(["secondary"]), "🥈");
});

test("secondary beats tertiary regardless of order", () => {
  assert.equal(sourceRungMarker(["tertiary", "secondary"]), "🥈");
});

test("secondary alongside an unrated sibling co-renders 🥈🏅", () => {
  assert.equal(sourceRungMarker(["secondary", null]), "🥈🏅");
});

test("a lone primary statement clears the rung entirely", () => {
  assert.equal(sourceRungMarker(["primary"]), "");
});

test("primary clears the rung wherever it sits in the set", () => {
  assert.equal(sourceRungMarker(["tertiary", "primary"]), "");
});

test("primary clears the rung even alongside secondary and tertiary siblings", () => {
  assert.equal(sourceRungMarker(["primary", "secondary", "tertiary"]), "");
});

test("primary clears the proposition line even with an unrated sibling -- 🏅 does not survive a 🥇", () => {
  assert.equal(sourceRungMarker(["primary", null]), "");
});

test("primary clears 🥉 and 🏅 together", () => {
  assert.equal(sourceRungMarker(["primary", "tertiary", null]), "");
});

// Statement-line instance: reads one row's own rating, regardless of siblings.

test("an unrated statement carries 🏅 on its own line", () => {
  assert.equal(statementSourceMarker(null), "🏅");
});

test("an empty-string source is unrated too", () => {
  assert.equal(statementSourceMarker(""), "🏅");
});

test("a rated statement carries no source marker on its own line", () => {
  for (const rated of ["primary", "secondary", "tertiary"]) {
    assert.equal(statementSourceMarker(rated), "", `${rated} should render clean`);
  }
});
