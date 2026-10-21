// pdfPageImages (src/files/extract/page-images.ts): pdf_pages__images classifies each page and renders
// the scanned ones to PNG with the bundled PDFium. Every fixture is synthetic
// (test/helpers/synthetic-docs.mjs), placeholder text only. Run after tsc: build/ has no pdfium.wasm
// beside it, so the package's own copy is passed in.

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test, { after } from "node:test";

import { pdfBytes, scannedPdfBytes } from "./helpers/synthetic-docs.mjs";

const { pdfPageImages } = await import("../build/files/extract/page-images.js");

const WASM = pathToFileURL(join(dirname(fileURLToPath(import.meta.url)), "..", "node_modules", "@embedpdf", "pdfium", "dist", "pdfium.wasm"));
const DIR = mkdtempSync(join(tmpdir(), "coclerk-page-images-"));
const renderDirs = [];
after(() => {
  for (const dir of [DIR, ...renderDirs]) rmSync(dir, { recursive: true, force: true });
});

function file(name, bytes) {
  const path = join(DIR, name);
  writeFileSync(path, bytes);
  return path;
}

async function render(args) {
  const result = await pdfPageImages(args, WASM);
  renderDirs.push(result.render_dir);
  return result;
}

/** A PNG's signature check and its IHDR width and height. */
function pngSize(path) {
  const bytes = readFileSync(path);
  assert.deepEqual([...bytes.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  assert.equal(bytes.toString("latin1", 12, 16), "IHDR");
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

const SCANNED = file("scanned.pdf", scannedPdfBytes({ form: true }));

test("an OCR'd scan, also one inside a form XObject, is scanned; visible text or text alone is born_digital", async () => {
  const got = await render({ path: SCANNED });
  assert.equal(got.page_count, 4);
  assert.deepEqual(got.pages.map((p) => p.kind), ["scanned", "born_digital", "born_digital", "scanned"]);
  assert.equal(got.pages[1].images, undefined);
  assert.equal(got.source_sha256, createHash("sha256").update(readFileSync(SCANNED)).digest("hex"));
  assert.match(got.render_dir, /probanda-pages-/);
});

test("a scanned letter page renders to one 150 dpi PNG whose hash and size the result states", async () => {
  const [page] = (await render({ path: SCANNED, pages: "1" })).pages;
  assert.equal(page.images.length, 1);
  const [image] = page.images;
  assert.equal(image.tile, undefined);
  assert.deepEqual(pngSize(image.path), { width: 1275, height: 1650 });
  assert.equal(image.width, 1275);
  assert.equal(image.height, 1650);
  assert.equal(image.sha256, createHash("sha256").update(readFileSync(image.path)).digest("hex"));
});

test("two calls render the same page to the same bytes, in different folders", async () => {
  const a = await render({ path: SCANNED, pages: "1" });
  const b = await render({ path: SCANNED, pages: "1" });
  assert.notEqual(a.render_dir, b.render_dir);
  assert.equal(a.pages[0].images[0].sha256, b.pages[0].images[0].sha256);
});

test("tiles renders each scanned page as two half-page tiles at 200 dpi", async () => {
  const [page] = (await render({ path: SCANNED, pages: "1", tiles: true })).pages;
  assert.deepEqual(page.images.map((i) => [i.tile, i.width, i.height]), [[1, 1700, 1100], [2, 1700, 1100]]);
  for (const image of page.images) assert.deepEqual(pngSize(image.path), { width: 1700, height: 1100 });
});

test("a page over 3,000,000 pixels at 150 dpi is cut into tiles under it", async () => {
  const path = file("tabloid.pdf", scannedPdfBytes({ mediaBox: [1224, 1584] }));
  const [page] = (await render({ path, pages: "1" })).pages;
  assert.deepEqual(page.images.map((i) => [i.tile, i.width, i.height]), [[1, 2550, 1100], [2, 2550, 1100], [3, 2550, 1100]]);
  for (const image of page.images) assert.ok(image.width * image.height <= 3_000_000);
});

test("pages limits the call to a range", async () => {
  const got = await render({ path: SCANNED, pages: "2-4" });
  assert.equal(got.page_count, 4);
  assert.deepEqual(got.pages.map((p) => p.page), [2, 3, 4]);
});

test("each refusal has its code", async () => {
  const refused = (code) => (err) => err.code === code;
  await assert.rejects(render({ path: join(DIR, "missing.pdf") }), refused("not_found"));
  await assert.rejects(render({ path: file("notes.txt", "placeholder") }), refused("not_pdf"));
  await assert.rejects(render({ path: file("garbage.pdf", "not a pdf at all") }), refused("not_pdf"));
  await assert.rejects(render({ path: file("locked.pdf", scannedPdfBytes({ encrypted: true })) }), refused("password_protected"));
  for (const pages of ["0", "3-2", "5", "1-5", "one"]) {
    await assert.rejects(render({ path: SCANNED, pages }), refused("bad_pages"), pages);
  }
  const text = file("text.pdf", pdfBytes(["Placeholder"]));
  await assert.rejects(pdfPageImages({ path: text }, pathToFileURL(join(DIR, "no-such.wasm"))), refused("renderer_unavailable"));
});
