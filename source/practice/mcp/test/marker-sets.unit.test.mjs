// The print step for a line's markers (symbol table plan, stage 2): printMarkerSets in markers.ts.
// Each token is one set, the markers one stored row raises: its glyphs fuse with no space, a set
// never repeats a glyph, identical sets print once, and different sets are one space apart, so a
// glyph may recur across sets. Only table glyphs fuse; any other token prints as it is.

import assert from "node:assert/strict";
import test from "node:test";

const { admissionRungMarker, dedupeLineMarkers, printMarkerSets } = await import("../build/submission/forms/markers.js");

test("a set's glyphs fuse with no space, in the order they were composed", () => {
  assert.equal(printMarkerSets(["⏰ 📑 🕹️"]), "⏰📑🕹️");
  assert.equal(printMarkerSets(["📜 📍 🏅 🔬 📇"]), "📜📍🏅🔬📇");
});

test("a deemed admission and the enter-it it routes print as one set, and an unrelated marker apart", () => {
  const admission = dedupeLineMarkers([admissionRungMarker({ state: "tender", base: "deemed" }), "📑"]);
  assert.equal(printMarkerSets([admission, "🚩"]), "⏰🕹️📑 🚩");
});

test("a set never repeats a glyph", () => {
  assert.equal(printMarkerSets(["📌 🧷 📌"]), "📌🧷");
  assert.equal(printMarkerSets([dedupeLineMarkers(["🔬 🥈🏅", "🏅"])]), "🔬🥈🏅");
});

test("identical sets on one line print once", () => {
  assert.equal(printMarkerSets(["🧷", "🧷"]), "🧷");
  assert.equal(printMarkerSets(["📑 📌", "🧐", "📑 📌"]), "📑📌 🧐");
});

test("different sets are separated by exactly one space", () => {
  assert.equal(printMarkerSets(["🏛️ 🦵", "🧵"]), "🏛️🦵 🧵");
  assert.equal(printMarkerSets(["👤 📌", "🗣️", "📑 🧷"]), "👤📌 🗣️ 📑🧷");
});

test("a glyph recurs in two different sets and is not dropped from the later one", () => {
  assert.equal(printMarkerSets(["📑 📌", "📑"]), "📑📌 📑");
  assert.equal(printMarkerSets(["📜 📍", "📜 📇"]), "📜📍 📜📇");
});

test("empty, blank and missing tokens print nothing", () => {
  assert.equal(printMarkerSets([]), "");
  assert.equal(printMarkerSets(["", null, undefined, " "]), "");
  assert.equal(printMarkerSets(["", "🧐", null]), "🧐");
});

test("a token that is not wholly table glyphs prints unchanged, unfused", () => {
  assert.equal(printMarkerSets(["(overruled: A v. B, 2019 BCCA 9)"]), "(overruled: A v. B, 2019 BCCA 9)");
  assert.equal(printMarkerSets(["🧩 no facts attributed to this witness"]), "🧩 no facts attributed to this witness");
  assert.equal(printMarkerSets(["📜 📍", "[unverified: x y]"]), "📜📍 [unverified: x y]");
});

test("the fused 🥈🏅 and 🥉🏅 print unchanged", () => {
  assert.equal(printMarkerSets(["🥈🏅"]), "🥈🏅");
  assert.equal(printMarkerSets(["🥉🏅"]), "🥉🏅");
  assert.equal(printMarkerSets(["🥈🏅", "🥉🏅"]), "🥈🏅 🥉🏅");
});
