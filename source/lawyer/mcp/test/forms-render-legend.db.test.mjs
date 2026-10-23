// The legend on a rendered mockup (symbol table plan, stage 3). Every markdown mockup ends with a
// Legend of exactly the symbols printed on it; the filed face carries neither. The model's notes
// come back as symbol_notes beside the named document's text and are written to no file.

import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { seededDbFixture, seedVaniacProceeding, ASHBOURNE, draftFolder } from "./fixtures/forms-render-seeds.mjs";
const { freshSubmissionDb } = await import("./helpers/template-db.mjs");
const { assertFiledFaceClean, assertFiledFaceDocumentsClean } = await import("./helpers/filed-face-scan.mjs");
const { submissionFormsRender } = await import("../build/submission/forms.js");
const { toFiledFace } = await import("../build/submission/forms/filed-face.js");
const { buildLegend } = await import("../build/submission/forms/legend.js");
const { ALL_MARKER_GLYPHS } = await import("../build/submission/forms/markers.js");
const { COMBINATIONS, PLACEMENTS, SYMBOLS } = await import("../build/submission/forms/symbol-table.js");

const LEGEND = "\n## Legend\n";
const NOTES = [...SYMBOLS, ...PLACEMENTS, ...COMBINATIONS].filter((row) => row.modelNote).map((row) => row.modelNote);

/** The mockup's text above its legend. */
function bodyOf(mockup) {
  const at = mockup.lastIndexOf(LEGEND);
  return at === -1 ? mockup : mockup.slice(0, at);
}

function filesUnder(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? filesUnder(join(dir, e.name)) : [join(dir, e.name)]));
}

test("each rendered mockup ends with a legend of exactly the symbols on it, and the filed face holds no legend and no glyph", async () => {
  const f = seededDbFixture();
  try {
    await freshSubmissionDb(f.dbPath);
    await seedVaniacProceeding(f.dbPath);
    const result = submissionFormsRender(f.dbPath, 1, ASHBOURNE);

    let withLegend = 0;
    for (const doc of result.documents.filter((d) => d.document_type !== "Work_board")) {
      const mockup = readFileSync(doc.path, "utf-8");
      assert.equal(doc.markdown, mockup, `${doc.file_name}: the inline text is the file`);
      const visible = bodyOf(mockup).replace(/```[\s\S]*?```/g, "").replace(/<!--[\s\S]*?-->/g, "");
      const onIt = ALL_MARKER_GLYPHS.filter((g) => visible.includes(g));
      if (onIt.length === 0) {
        assert.ok(!mockup.includes(LEGEND), `${doc.file_name}: no symbol, so no legend`);
        continue;
      }
      withLegend++;
      const legend = mockup.slice(mockup.lastIndexOf(LEGEND) + LEGEND.length);
      assert.doesNotMatch(legend, /^#/m, `${doc.file_name}: the legend is the last section`);
      const listed = new Set(
        legend
          .split("\n")
          .filter((line) => line.startsWith("| ") && !line.startsWith("| Symbol "))
          .map((line) => line.split("|")[1].trim())
          .filter((cell) => ALL_MARKER_GLYPHS.includes(cell))
      );
      assert.deepEqual([...listed].sort(), [...onIt].sort(), `${doc.file_name}: the legend lists exactly the symbols on the mockup`);
      assertFiledFaceClean(toFiledFace(mockup), `the filed face of ${doc.file_name}'s written mockup`);
    }
    assert.ok(withLegend >= 3, "the seed prints symbols on several documents");

    const filed = submissionFormsRender(f.dbPath, 1, ASHBOURNE, "filed");
    assert.ok(filed.documents.some((d) => d.document_type === "Written_arguments"));
    assertFiledFaceDocumentsClean(filed.documents);
    for (const doc of filed.documents) {
      assert.ok(!doc.markdown.includes("## Legend") && !doc.markdown.includes("| Symbol | Name |"), `${doc.file_name}: no legend on the filed face`);
      assert.equal(doc.symbol_notes, undefined, `${doc.file_name}: no notes on a filed render`);
    }
  } finally {
    f.cleanup();
  }
});

test("the named document's response carries symbol_notes, on a fresh render and a reused one, and no written file holds a note", async () => {
  const f = seededDbFixture();
  try {
    await freshSubmissionDb(f.dbPath);
    await seedVaniacProceeding(f.dbPath);
    const { leaf } = draftFolder(f);
    const render = () => submissionFormsRender(f.dbPath, 1, ASHBOURNE, "mockup", ["Written_arguments"], undefined, leaf);

    const first = render();
    const named = first.documents.find((d) => d.document_type === "Written_arguments");
    assert.ok(named.markdown.includes(LEGEND), "the named document's text carries its legend");
    const scrutinize = SYMBOLS.find((s) => s.glyph === "🔬");
    assert.ok(named.symbol_notes.includes(`🔬: ${scrutinize.modelNote}`), "the seed prints 🔬, whose row has a note");
    assert.deepEqual(named.symbol_notes, buildLegend(bodyOf(named.markdown), "Written_arguments").notes);
    for (const doc of first.documents.filter((d) => d.document_type !== "Written_arguments")) {
      assert.equal(doc.symbol_notes, undefined, `${doc.document_type}: not named, so no notes`);
      assert.equal(doc.markdown, undefined, `${doc.document_type}: not named, so no text`);
    }

    const again = render();
    assert.ok(!again.timings.some((t) => t.phase.startsWith("render ")), "the second render reuses the files on disk");
    assert.deepEqual(again.documents.find((d) => d.document_type === "Written_arguments").symbol_notes, named.symbol_notes);

    const written = filesUnder(f.dir);
    const names = written.map((p) => p.slice(dirname(p).length + 1));
    for (const expected of ["Written Arguments.md", "render-manifest-1.json"]) {
      assert.ok(names.filter((n) => n === expected).length >= 1, `expected ${expected} among the written files`);
    }
    assert.equal(names.filter((n) => n === "Written Arguments.md").length, 1, "the mockup in the Writing's folder is the only copy");
    for (const path of written) {
      const text = readFileSync(path, "utf-8");
      for (const note of NOTES) assert.ok(!text.includes(note), `${path} holds a note written for the model`);
    }
  } finally {
    f.cleanup();
  }
});
