// pdfPageImages (src/files/extract/page-images.ts): the size of each rendered page and its tiles. A page
// is drawn at most 2000 px wide and cut into tiles of at most 2000 px tall and 3,000,000 pixels, and
// the tiles join into exactly a single render of the page. Every fixture is synthetic
// (test/helpers/synthetic-docs.mjs), placeholder text only.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { assertTilesMatch, assertWithinCaps, file, render } from "./helpers/page-images.mjs";
import { drawImage, imagePdfBytes, scannedPdfBytes } from "./helpers/synthetic-docs.mjs";

const SCANNED = file("scanned.pdf", scannedPdfBytes());

test("tiles renders a top and a bottom tile at 200 dpi, overlapping by 10% of the page, that join into a single render", async () => {
  const [page] = (await render({ path: SCANNED, pages: "1", tiles: true })).pages;
  assert.deepEqual(page.images.map((i) => [i.tile, i.width, i.height]), [[1, 1700, 1210], [2, 1700, 1210]]);
  await assertTilesMatch(readFileSync(SCANNED), page.images, [0, 2200 - 1210], 1700, 2200);
});

test("a page wider than 2000 px at 150 dpi is drawn 2000 px wide, cut into equal tiles that join into a single render", async () => {
  const bytes = imagePdfBytes({ pages: [{ mediaBox: [0, 0, 1224, 1584], content: drawImage(0, 0, 1224, 1584) }] });
  const [page] = (await render({ path: file("tabloid.pdf", bytes) })).pages;
  assert.deepEqual(page.images.map((i) => [i.tile, i.width, i.height]), [[1, 2000, 1294], [2, 2000, 1294]]);
  assertWithinCaps(page.images);
  await assertTilesMatch(bytes, page.images, [0, 1294], 2000, 2588);
});

test("a page as wide as the PDF allows finishes, within the caps, with and without tiles", async () => {
  const path = file("wide.pdf", imagePdfBytes({ pages: [{ mediaBox: [0, 0, 14400, 14400], content: drawImage(0, 0, 14400, 14400) }] }));
  const plain = (await render({ path })).pages[0].images;
  assert.deepEqual(plain.map((i) => [i.width, i.height]), [[2000, 1000], [2000, 1000]]);
  const tiled = (await render({ path, tiles: true })).pages[0].images;
  assert.deepEqual(tiled.map((i) => [i.tile, i.width, i.height]), [[1, 2000, 1100], [2, 2000, 1100]]);
  const strip = file("strip.pdf", imagePdfBytes({ pages: [{ mediaBox: [0, 0, 14400, 100], content: drawImage(0, 0, 14400, 100) }] }));
  assert.deepEqual((await render({ path: strip })).pages[0].images.map((i) => [i.width, i.height]), [[2000, 14]]);
});

test("tiles on a very tall page cuts each half further, every tile within the caps", async () => {
  const path = file("tall.pdf", imagePdfBytes({ pages: [{ mediaBox: [0, 0, 100, 14400], content: drawImage(0, 0, 100, 14400) }] }));
  const images = (await render({ path, tiles: true })).pages[0].images;
  assertWithinCaps(images);
  assert.deepEqual(images.map((i) => i.tile), images.map((_, i) => i + 1));
  // 40,000 rows at 200 dpi, each half 22,000 rows in 11 tiles of 2,000.
  assert.equal(images.length, 22);
  assert.equal(images.reduce((sum, i) => sum + i.height, 0), 44_000);
});

test("a page of a fraction of a point still gives one image of at least 1 x 1 px", async () => {
  const path = file("tiny.pdf", imagePdfBytes({ pages: [{ mediaBox: [0, 0, 0.2, 0.2], content: drawImage(0, 0, 0.2, 0.2) }] }));
  const [page] = (await render({ path })).pages;
  assert.equal(page.kind, "scanned");
  assert.deepEqual(page.images.map((i) => [i.width, i.height]), [[1, 1]]);
});
