// Deterministic clause-text normalization and ordering. The code does every
// count, sort and comparison, so none rests on a model's inference. Nothing
// imports this module yet, so it is not in the bundle.
//
// normalize: Unicode NFC; trim; every run of whitespace to one space; one
// trailing period stripped (clauses are stored without one).
// order: length ascending in Unicode code points after normalization, spaces
// and punctuation counted, then code-point order ascending -- Python's default
// `str` comparison, so a capital sorts before lower case and a space before a
// letter. Never locale-aware, never UTF-16 units. The first entry is the
// shortest, with the alphabetical tiebreak.

export interface RankedPhrase {
  text: string;
  length: number;
}

export function normalize(phrase: string): string {
  const collapsed = phrase.normalize("NFC").trim().replace(/\s+/g, " ");
  return collapsed.endsWith(".") ? collapsed.slice(0, -1) : collapsed;
}

function codePoints(text: string): number {
  return Array.from(text).length;
}

/** Code-point order of two strings: negative, zero or positive as `a` sorts before, with or after `b`. */
export function compareCodePoints(a: string, b: string): number {
  const ai = a[Symbol.iterator]();
  const bi = b[Symbol.iterator]();
  for (;;) {
    const x = ai.next();
    const y = bi.next();
    if (x.done) return y.done ? 0 : -1;
    if (y.done) return 1;
    const cx = x.value.codePointAt(0)!;
    const cy = y.value.codePointAt(0)!;
    if (cx !== cy) return cx - cy;
  }
}

/** Normalize, drop duplicates, sort by (length, code-point order), each with its length. */
export function rank(phrases: string[]): RankedPhrase[] {
  const unique = [...new Set(phrases.map(normalize))];
  return unique
    .sort((a, b) => codePoints(a) - codePoints(b) || compareCodePoints(a, b))
    .map((text) => ({ text, length: codePoints(text) }));
}
