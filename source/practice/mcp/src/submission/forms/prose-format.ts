// The prose format check (plan 2026-10-07, structured and unstructured Writings, step 5). A general
// Writing's filing_prose text holds only wording that will be printed, so each line of it is
// scanned at render for what is not: a template placeholder in brackets, a bare TBD, a note to the
// reader, an emoji the symbol table does not hold, and a blank underline. Each hit is flagged on the
// mockup by `🧩 <!-- format: <rules> -->` after the line (projections.ts) and counted by open-items.
// Every rule but `underscores` also refuses the filed render (forms.ts prose_format_gate_failed):
// a blank underline is the placeholder Brahm's rule asks for, and a court form may leave one for
// the registry.

import { isPlaceholder } from "../pre-filing/checks.js";
import { SYMBOLS } from "./symbol-table.js";

/** The rules a filed render refuses on; `underscores` is flagged only. */
export const REFUSED_FORMAT_RULES: ReadonlySet<string> = new Set(["bracket", "tbd", "note", "emoji"]);

/** A square-bracketed run, as pre-filing check C2 reads one. */
const BRACKET_RE = /\[[^[\]]{0,200}\]/g;
const TBD_RE = /\b(?:TBD|TODO|TBC)\b/;
const NOTE_RE = /^\s*(?:draft\s+)?note\s*:/i;
const UNDERSCORES_RE = /_{3,}/;
/** One emoji: a pictograph shown as an emoji, with its skin tone, variation selector and any
 * zero-width-joined pictographs. ©, ® and ™ show as text and are not matched. */
const EMOJI_RE = /(?:\p{Emoji_Presentation}|\p{Extended_Pictographic}️)(?:[\u{1F3FB}-\u{1F3FF}]|️|‍(?:\p{Emoji_Presentation}|\p{Extended_Pictographic}️?))*/gu;

const bare = (glyph: string): string => glyph.replace(/️/g, "");
const TABLE_GLYPHS = new Set(SYMBOLS.map((s) => bare(s.glyph)));

/** The format rules one line of prose breaks, in a fixed order; empty when it breaks none. */
export function proseFormatRules(line: string): string[] {
  const rules: string[] = [];
  const brackets = [...line.matchAll(BRACKET_RE)];
  if (brackets.some((m) => isPlaceholder(m[0].replace(/\s+/g, " "), line.slice(Math.max(0, (m.index ?? 0) - 1), m.index ?? 0)))) rules.push("bracket");
  if (TBD_RE.test(line)) rules.push("tbd");
  if (NOTE_RE.test(line)) rules.push("note");
  if ([...line.matchAll(EMOJI_RE)].some((m) => !TABLE_GLYPHS.has(bare(m[0])))) rules.push("emoji");
  if (UNDERSCORES_RE.test(line)) rules.push("underscores");
  return rules;
}

/** The mockup's flag after a line that breaks `rules`. */
export function formatFlag(rules: string[]): string {
  return ` 🧩 <!-- format: ${rules.join(", ")} -->`;
}
