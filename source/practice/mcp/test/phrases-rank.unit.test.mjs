// src/phrases/rank.ts: normalization, code-point length and order, duplicate removal.

import assert from "node:assert/strict";
import test from "node:test";

const { compareCodePoints, normalize, rank } = await import("../build/phrases/rank.js");

test("normalize: NFC, trim, whitespace runs to one space, one trailing period", () => {
  assert.equal(normalize("  the\tparty  must\n\nfile. "), "the party must file");
  assert.equal(normalize("ends with two.."), "ends with two.", "only one trailing period is stripped");
  assert.equal(normalize("a. b"), "a. b", "an inner period stays");
  assert.equal(normalize("é"), "é", "NFC composes a combining accent");
  assert.equal(normalize("x y"), "x y", "a no-break space is whitespace");
});

test("rank sorts by length, then code-point order; capitals before lower case, space before letters", () => {
  const ranked = rank(["bb", "a", "Ba", "ba", "b a", "aaa"]);
  assert.deepEqual(ranked.map((r) => r.text), ["a", "Ba", "ba", "bb", "aaa", "b a"]);
  assert.deepEqual(rank(["abc", "a b"]).map((r) => r.text), ["a b", "abc"]);
  assert.deepEqual(ranked.map((r) => r.length), [1, 2, 2, 2, 3, 3]);
});

test("rank counts and compares by code point, not UTF-16 unit", () => {
  // U+FF21 (fullwidth A) is one BMP unit; U+1F600 is two UTF-16 units but one code point,
  // and it sorts after U+FF21 by code point while its lead surrogate (D83D) would sort before.
  assert.ok(compareCodePoints("\u{1F600}", "Ａ") > 0);
  assert.deepEqual(rank(["\u{1F600}", "Ａ"]), [
    { text: "Ａ", length: 1 },
    { text: "\u{1F600}", length: 1 },
  ]);
  assert.equal(rank(["\u{1F600} ok"])[0].length, 4, "a non-BMP character is one code point");
});

test("rank drops duplicates, including those that only coincide after normalization", () => {
  assert.deepEqual(rank(["must file", "must  file.", " must file ", "may file"]), [
    { text: "may file", length: 8 },
    { text: "must file", length: 9 },
  ]);
});
