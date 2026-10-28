// The symbol table (symbol table and on-mockup legend plan, stage 1). This test pins the table's
// glyphs against ALL_MARKER_GLYPHS and WORK_MARKER_GLYPHS, the GLYPH_SLUGS and WORK_NAMES derived
// from it (stage 4) against a literal snapshot of the constants they replaced, and its document
// types against the ones the renderer names. Pure: no database, no render.

import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";

const { ALL_MARKER_GLYPHS, WORK_MARKER_GLYPHS } = await import("../build/submission/forms/markers.js");
const { GLYPH_SLUGS, WORK_NAMES } = await import("../build/submission/forms/proposal-inventory.js");
const { SYMBOLS, COMBINATIONS, PLACEMENTS, splitGlyphs } = await import("../build/submission/forms/symbol-table.js");

const TABLE_GLYPHS = new Set(SYMBOLS.map((s) => s.glyph));

/** Every documentType the renderer names, read off its source where a document is rendered or stamped. */
function rendererDocumentTypes() {
  const dir = new URL("../src/submission/", import.meta.url);
  // writing-folder.ts holds GENERAL_DOCUMENT_TYPE, the general renderer's document type.
  const files = [new URL("forms.ts", dir), new URL("writing-folder.ts", dir), ...readdirSync(new URL("forms/", dir)).filter((f) => f.endsWith(".ts")).map((f) => new URL(`forms/${f}`, dir))];
  const types = new Set();
  const site = /(?:\.document\(|documentType: |frontmatterFor\((?:ctx, )?|renderDocument\(\s*ctx,\s*timings,\s*|document_type: |_DOCUMENT_TYPE = )"([A-Z][A-Za-z_]*)"/g;
  for (const file of files) for (const m of readFileSync(file, "utf-8").matchAll(site)) types.add(m[1]);
  return types;
}

/** The italic terms of terms-and-symbols.md's "Banned terms" paragraph. */
function bannedTerms() {
  const text = readFileSync(new URL("../../../../.claude/skills/drafting-data/references/terms-and-symbols.md", import.meta.url), "utf-8");
  const paragraph = text.split("**Banned terms**")[1].split(". Where")[0];
  return [...paragraph.matchAll(/\*([^*]+)\*/g)].map((m) => m[1].toLowerCase());
}

test("the table has one row per glyph in ALL_MARKER_GLYPHS, and no duplicates", () => {
  const glyphs = SYMBOLS.map((s) => s.glyph);
  assert.equal(new Set(glyphs).size, glyphs.length, "a glyph has two rows");
  assert.deepEqual([...glyphs].sort(), [...ALL_MARKER_GLYPHS].sort());
});

test("the work rows are WORK_MARKER_GLYPHS, and the groups count 31 work, 14 event, 3 hold", () => {
  const of = (group) => SYMBOLS.filter((s) => s.group === group).map((s) => s.glyph);
  assert.deepEqual([...of("work")].sort(), [...WORK_MARKER_GLYPHS].sort());
  assert.deepEqual([of("work").length, of("event").length, of("hold").length], [31, 14, 3]);
});

test("WORK_NAMES and GLYPH_SLUGS, derived from the table, equal the hand-written constants they replaced", () => {
  // Literal copies of proposal-inventory.ts's WORK_NAMES and GLYPH_SLUGS as they stood before stage 4
  // derived them, in their key order: WORK_NAMES's key order is the Milestone's card order.
  const workNames = [
    ["doctrinal-basis", "Find doctrinal authority"],
    ["primary-authority", "Find primary authority"],
    ["jurisdictional-basis", "Find jurisdictional basis"],
    ["authority-excerpt", "Quote the authority"],
    ["authority-pinpoint", "Locate the authority pinpoint"],
    ["scrutinize", "Scrutinize"],
    ["note-up", "Note up"],
    ["authority-rating", "Rate the authority"],
    ["exhibit-excerpt", "Quote the exhibit"],
    ["testimony-excerpt", "Quote the testimony"],
    ["exhibit-pinpoint", "Locate the exhibit pinpoint"],
    ["testimony-pinpoint", "Locate the testimony pinpoint"],
    ["interview", "Interview"],
    ["draft-it", "Draft the statement"],
    ["sign-it", "Get it signed"],
    ["swear-it", "Get it sworn"],
    ["serve-it", "Serve"],
    ["enter-it", "Enter the admission; pleading route: Requisition default judgment"],
    ["factual-basis", "Link or draft the factual basis"],
    ["proposition", "Link or draft the proposition it requires"],
    ["unserved-petitum", "Draft a submission for the order"],
    ["loose-thread", "Reconcile the loose thread"],
    ["not-recorded", "Record label, date or description"],
    ["unchosen", "Attach the missing order or affidavit"],
    ["choose-template", "Choose the order template"],
  ];
  const glyphSlugs = [
    ["📖", "doctrinal-basis"],
    ["🥉", "primary-authority"],
    ["🥈", "primary-authority"],
    ["🏛️", "jurisdictional-basis"],
    ["📜", "authority-excerpt"],
    ["📍", "authority-pinpoint"],
    ["🔬", "scrutinize"],
    ["📇", "note-up"],
    ["🏅", "authority-rating"],
    ["📑", "exhibit-excerpt"],
    ["💬", "testimony-excerpt"],
    ["📌", "exhibit-pinpoint"],
    ["🧷", "testimony-pinpoint"],
    ["🗣️", "interview"],
    ["✍️", "draft-it"],
    ["🖋️", "sign-it"],
    ["✒️", "swear-it"],
    ["🎾", "serve-it"],
    ["🕹️", "enter-it"],
    ["🧾", "factual-basis"],
    ["📚", "proposition"],
    ["🦵", "unserved-petitum"],
    ["🧵", "loose-thread"],
    ["🏷️", "not-recorded"],
    ["⬜", "unchosen"],
  ];
  assert.deepEqual(Object.entries(WORK_NAMES), workNames);
  assert.deepEqual([...GLYPH_SLUGS], glyphSlugs);
});

test("every combination key is fused and splits into two or more table glyphs", () => {
  for (const { key } of COMBINATIONS) {
    assert.doesNotMatch(key, /\s/, `${key} holds whitespace`);
    assert.ok(splitGlyphs(key).length >= 2, `${key} is one glyph`);
  }
});

test("splitGlyphs matches the longest glyph and refuses leftover text", () => {
  assert.deepEqual(splitGlyphs("🙅🏻‍♂️👤"), ["🙅🏻‍♂️", "👤"]);
  assert.deepEqual(splitGlyphs(""), []);
  assert.throws(() => splitGlyphs("⏰ 🕹️"), /" 🕹️" in "⏰ 🕹️" is not a table glyph/);
  assert.throws(() => splitGlyphs("⏰x"), /"x"/);
});

test("every placement names a table glyph, a place, and only document types the renderer uses", () => {
  const known = rendererDocumentTypes();
  for (const row of PLACEMENTS) {
    assert.ok(TABLE_GLYPHS.has(row.glyph), `${row.glyph} is not a table glyph`);
    assert.ok(row.documents?.length || row.line, `${row.glyph} placement names no place`);
    for (const doc of row.documents ?? []) assert.ok(known.has(doc), `${row.glyph}: ${doc} is not a document type the renderer uses`);
  }
});

test("every symbol row carries its condition, and every work and event row its history", () => {
  for (const s of SYMBOLS) {
    assert.ok(s.condition.trim(), `${s.glyph}: no condition`);
    if (s.group !== "hold") assert.ok(s.history.trim(), `${s.glyph}: no history`);
  }
});

test("no lawyer-facing text holds a backtick or a banned term", () => {
  const banned = bannedTerms();
  assert.ok(banned.length > 0, "no banned terms parsed from terms-and-symbols.md");
  const texts = [
    ...SYMBOLS.flatMap((s) => [s.name, s.meaning, s.work, s.actor, s.title ?? ""].map((t) => [s.glyph, t])),
    ...COMBINATIONS.flatMap((c) => [c.meaning, c.work].map((t) => [c.key, t])),
    ...PLACEMENTS.map((p) => [p.glyph, `${p.line ?? ""} ${p.text}`]),
  ];
  for (const [glyph, text] of texts) {
    assert.ok(!text.includes("`"), `${glyph}: backtick in "${text}"`);
    for (const term of banned) assert.ok(!text.toLowerCase().includes(term), `${glyph}: banned term "${term}" in "${text}"`);
  }
});
