// The on-mockup legend (symbol table plan, stage 3): buildLegend in forms/legend.ts. It lists each
// symbol printed on a mockup, the placement rows for this document directly under their symbol,
// and each combination whose glyphs share one printed set, in the table's order. The model's notes
// come back beside it and never print in it.

import assert from "node:assert/strict";
import test from "node:test";

const { buildLegend, legendNotes, withLegend } = await import("../build/submission/forms/legend.js");
const { COMBINATIONS, PLACEMENTS, SYMBOLS } = await import("../build/submission/forms/symbol-table.js");
const { toFiledFace } = await import("../build/submission/forms/filed-face.js");

/** Each table row's first cell, in print order. */
function firstCells(text) {
  return text
    .split("\n")
    .filter((line) => line.startsWith("| ") && !line.startsWith("| Symbol "))
    .map((line) => line.split("|")[1].trim());
}

const symbol = (glyph) => SYMBOLS.find((s) => s.glyph === glyph);

test("a symbol on the mockup is listed with its name, meaning and work by its actor; one not on it is not", () => {
  const { text } = buildLegend("1. A fact. 📑\n2. Another fact. 🧷\n", "Written_arguments");
  assert.deepEqual(firstCells(text), ["📑", "🧷"], "table order, and nothing absent");
  for (const glyph of ["📑", "🧷"]) {
    const s = symbol(glyph);
    assert.ok(text.includes(`| ${glyph} | ${s.name} | ${s.meaning} | ${s.work} (${s.actor}) |`), `expected ${glyph}'s full row`);
  }
  assert.ok(text.startsWith("## Legend\n\n| Symbol | Name | Meaning | Work |\n|---|---|---|---|\n"));
});

test("a symbol with no actor prints its work without parentheses", () => {
  const s = symbol("⚠️");
  assert.equal(s.actor, "");
  assert.ok(buildLegend("An authority. ⚠️", "Written_arguments").text.includes(`| ⚠️ | ${s.name} | ${s.meaning} | ${s.work} |`));
});

test("a combination is listed only when its glyphs sit in one printed set, after every single symbol", () => {
  const fused = firstCells(buildLegend("A fact. ⏰🕹️ 🧐", "Written_arguments").text);
  assert.deepEqual(fused, ["🕹️", "🧐", "⏰", "⏰🕹️"]);
  const row = COMBINATIONS.find((c) => c.key === "⏰🕹️");
  assert.ok(buildLegend("A fact. ⏰🕹️", "Written_arguments").text.includes(`| ⏰🕹️ | | ${row.meaning} | ${row.work} |`));

  assert.deepEqual(firstCells(buildLegend("A fact. ⏰ 🕹️", "Written_arguments").text), ["🕹️", "⏰"], "two sets on one line are not a combination");
  assert.deepEqual(firstCells(buildLegend("A fact. ⏰📑 🕹️", "Written_arguments").text), ["📑", "🕹️", "⏰", "⏰📑"], "only the pair inside the set");
});

test("a document-scoped placement row prints under its symbol only on its own document type", () => {
  const placement = PLACEMENTS.find((p) => p.glyph === "⬜" && p.documents?.includes("Requisition"));
  const onRequisition = buildLegend("Affidavit of service ⬜\n", "Requisition").text;
  assert.deepEqual(firstCells(onRequisition), ["⬜", "⬜"]);
  assert.ok(onRequisition.includes(`| ⬜ | | ${placement.text} | |`), "a document-only row has an empty Name cell");
  assert.deepEqual(firstCells(buildLegend("Affidavit of service ⬜\n", "Written_arguments").text), ["⬜"]);
});

test("a placement row with only a line kind applies on any document, under its symbol, in the table's order", () => {
  const lines = PLACEMENTS.filter((p) => p.glyph === "🔬").map((p) => p.line);
  const text = buildLegend("A proposition. 🔬 📇", "General_writing").text;
  assert.deepEqual(firstCells(text), ["🔬", ...lines.map(() => "🔬"), "📇"], "🔬 precedes 📇 in the table");
  const rows = text.split("\n").filter((l) => l.startsWith("| 🔬 |"));
  assert.equal(rows[0], `| 🔬 | ${symbol("🔬").name} | ${symbol("🔬").meaning} | ${symbol("🔬").work} (${symbol("🔬").actor}) |`);
  assert.deepEqual(rows.slice(1).map((r) => r.split("|")[2].trim()), lines);
});

test("glyphs inside a fenced excerpt or an HTML comment are not on the mockup", () => {
  const markdown = "Quoted below.\n   ```\n   the passage 🧩 as written\n   ```\nA line. <!-- 🎾 trace -->\n";
  assert.deepEqual(buildLegend(markdown, "Written_arguments"), { text: "", notes: [] });
  assert.deepEqual(firstCells(buildLegend("A fact. ⏰<!-- fact_id 1 -->🕹️", "Written_arguments").text), ["🕹️", "⏰"], "a comment between two glyphs does not fuse them");
});

test("a symbol that sits only in the header's optional list fields is listed (plan 2026-10-07 step 3)", () => {
  const markdown = "---\nRevision: 1\nAuthorities cited:\n  - > *Example v. Authority*, 2020 BCSC 1 📌 <!-- statement_of_law_id 1 -->\n---\n\n# Letter\n\nPlain prose.\n";
  assert.deepEqual(firstCells(buildLegend(markdown, "General_writing").text), ["📌"]);
});

test("no symbol on the mockup gives no legend, and withLegend leaves the text as it is", () => {
  assert.deepEqual(buildLegend("# Title\n\nPlain prose.\n", "Written_arguments"), { text: "", notes: [] });
  assert.deepEqual(withLegend("# Title\n\nPlain prose.\n", "Written_arguments"), { markdown: "# Title\n\nPlain prose.\n", symbolNotes: [] });
});

test("withLegend replaces a legend already at the end, so a hand-written definition never survives and none is duplicated", () => {
  const body = "# Memo\n\nAn authority. 📇\n";
  const stale = `${body}\n## Legend\n\n| 📇 | noted up, but not read and classified |\n`;
  const { markdown } = withLegend(stale, "");
  assert.equal(markdown, withLegend(body, "").markdown);
  assert.equal(markdown.split("## Legend").length, 2, "one legend");
  assert.ok(markdown.includes(`| 📇 | ${symbol("📇").name} | ${symbol("📇").meaning} |`));
  assert.equal(withLegend(markdown, "").markdown, markdown, "a second run changes nothing");
});

test("the notes of the selected rows come back beside the legend and never print in it", () => {
  const legend = buildLegend("A statement. 🔬 🏅\nA fact. 👤\nAn authority. 📇\n", "Written_arguments");
  assert.deepEqual(legend.notes, ["🔬", "👤", "🏅"].map((g) => `${g}: ${symbol(g).modelNote}`), "table order, noted rows only");
  for (const row of [...SYMBOLS, ...PLACEMENTS, ...COMBINATIONS].filter((r) => r.modelNote)) {
    assert.ok(!legend.text.includes(row.modelNote), "no note text in the legend");
  }
});

test("withLegend appends the legend as the last section; legendNotes reads the same notes back off the written text; the filed face drops it", () => {
  const body = "---\nRevision: 1\n---\n\n# Written Arguments\n\n1. A statement. 🔬\n";
  const { markdown, symbolNotes } = withLegend(body, "Written_arguments");
  assert.equal(markdown, `${body.trimEnd()}\n\n${buildLegend(body, "Written_arguments").text}`);
  assert.ok(markdown.endsWith("|\n"));
  assert.deepEqual(legendNotes(markdown, "Written_arguments"), symbolNotes);
  assert.deepEqual(symbolNotes, [`🔬: ${symbol("🔬").modelNote}`]);
  assert.equal(toFiledFace(markdown), toFiledFace(body), "the filed face of the mockup with its legend is the filed face without it");
});
