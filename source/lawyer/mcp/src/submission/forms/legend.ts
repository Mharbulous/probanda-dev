// The on-mockup legend (symbol table and on-mockup legend plan, stage 3). Every markdown mockup
// ends with a Legend section explaining exactly the symbols printed on it, from symbol-table.ts, so
// the practitioner and the model read the same surface. Rendered for the human, withheld from the
// forum: the heading is in filed-face.ts's MOCKUP_ONLY_HEADINGS. A row's model note never goes into
// the legend or any file; forms.ts returns the notes in the render response as symbol_notes.

import { COMBINATIONS, PLACEMENTS, SYMBOLS, splitGlyphs } from "./symbol-table.js";

export const LEGEND_HEADING = "## Legend";

/** One maximal run of table glyphs with nothing between them, longest glyph first at each step. */
const GLYPH_ALTERNATIVES = SYMBOLS.map((s) => s.glyph)
  .sort((a, b) => b.length - a.length)
  .map((g) => g.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
const RUN_RE = new RegExp(`(?:${GLYPH_ALTERNATIVES.join("|")})+`, "g");

/** The text the scan reads: fenced excerpt blocks dropped, and each HTML comment blanked to a
 * space so the glyphs either side of one never read as one set. */
function scannedText(markdown: string): string {
  let inFence = false;
  const kept = markdown.split("\n").filter((line) => {
    if (line.trim().startsWith("```")) {
      inFence = !inFence;
      return false;
    }
    return !inFence;
  });
  return kept.join("\n").replace(/<!--[\s\S]*?-->/g, " ");
}

function row(cells: string[]): string {
  return `|${cells.map((cell) => (cell ? ` ${cell} ` : " ")).join("|")}|`;
}

export interface Legend {
  /** The section, heading included, or "" when no table glyph prints on the mockup. */
  text: string;
  /** "<glyph or key>: <note>" for each selected row that has a model note; a placement row's is
   * "<glyph> (<where>): <note>". */
  notes: string[];
}

/**
 * The legend for one finished mockup of `documentType`: each symbol printed on it with its
 * placement rows that apply to this document directly under it, then each combination whose
 * glyphs all sit in one printed set, all in the table's order.
 */
export function buildLegend(markdown: string, documentType: string): Legend {
  const sets = [...scannedText(markdown).matchAll(RUN_RE)].map((m) => splitGlyphs(m[0]));
  const present = new Set(sets.flat());
  const rows: string[] = [];
  const notes: string[] = [];
  for (const symbol of SYMBOLS) {
    if (!present.has(symbol.glyph)) continue;
    const work = symbol.work && symbol.actor ? `${symbol.work} (${symbol.actor})` : symbol.work;
    rows.push(row([symbol.glyph, symbol.name, symbol.meaning, work]));
    if (symbol.modelNote) notes.push(`${symbol.glyph}: ${symbol.modelNote}`);
    for (const placement of PLACEMENTS) {
      if (placement.glyph !== symbol.glyph || !(placement.documents?.includes(documentType) ?? true)) continue;
      rows.push(row([placement.glyph, placement.line ?? "", placement.text, ""]));
      if (placement.modelNote) notes.push(`${placement.glyph} (${placement.line ?? documentType}): ${placement.modelNote}`);
    }
  }
  for (const combination of COMBINATIONS) {
    const glyphs = splitGlyphs(combination.key);
    if (!sets.some((set) => glyphs.every((g) => set.includes(g)))) continue;
    rows.push(row([combination.key, "", combination.meaning, combination.work]));
    if (combination.modelNote) notes.push(`${combination.key}: ${combination.modelNote}`);
  }
  if (rows.length === 0) return { text: "", notes: [] };
  return { text: [LEGEND_HEADING, "", row(["Symbol", "Name", "Meaning", "Work"]), "|---|---|---|---|", ...rows].join("\n") + "\n", notes };
}

/** The mockup with its legend appended as the last section, and the legend's model notes. */
export function withLegend(markdown: string, documentType: string): { markdown: string; symbolNotes: string[] } {
  const legend = buildLegend(markdown, documentType);
  return { markdown: legend.text ? `${markdown.trimEnd()}\n\n${legend.text}` : markdown, symbolNotes: legend.notes };
}

/** The model notes for a mockup read back from disk: the scan reads it with its legend cut off,
 * as the render that wrote it did. */
export function legendNotes(mockup: string, documentType: string): string[] {
  const at = mockup.lastIndexOf(`\n${LEGEND_HEADING}\n`);
  return buildLegend(at === -1 ? mockup : mockup.slice(0, at), documentType).notes;
}
