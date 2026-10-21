// pdfPageImages and classifyPdfPages (src/files/extract/page-images.ts): pdf_pages__images classifies
// each page and renders the scanned ones to PNG with the bundled PDFium; this file covers the
// classification, the pixels of a render and the refusals, page-images-tiles.unit.test.mjs the sizes
// and tiles. Every fixture is synthetic (test/helpers/synthetic-docs.mjs), placeholder text only.

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

import { BLUE, classifyPdfPages, decodePng, DIR, file, GREEN, pdfPageImages, pixel, RED, render } from "./helpers/page-images.mjs";
import { drawImage, drawText, imagePdfBytes, pdfBytes, scannedPdfBytes, textBlock } from "./helpers/synthetic-docs.mjs";

/** The kind of each page of a PDF of `pages` (imagePdfBytes' argument). */
async function kinds(spec) {
  return (await render({ path: file("kinds.pdf", imagePdfBytes(spec)) })).pages.map((p) => p.kind);
}

const SCANNED = file("scanned.pdf", scannedPdfBytes({ form: true }));

test("an OCR'd scan, also one in a translated form XObject, is scanned; a page of visible text, or text alone, is born_digital", async () => {
  const got = await render({ path: SCANNED });
  assert.equal(got.page_count, 4);
  assert.deepEqual(got.pages.map((p) => p.kind), ["scanned", "born_digital", "born_digital", "scanned"]);
  assert.equal(got.pages[1].images, undefined);
  assert.equal(got.source_sha256, createHash("sha256").update(readFileSync(SCANNED)).digest("hex"));
  assert.match(got.render_dir, /probanda-pages-/);
});

test("classifyPdfPages gives the same kinds and renders nothing", async () => {
  assert.deepEqual(await classifyPdfPages(SCANNED), ["scanned", "born_digital", "born_digital", "scanned"]);
});

test("a form's /Matrix is applied once: not at all, or twice, would move the image off the page", async () => {
  const form = (matrix) => ({ Fm1: { bbox: [-612, 0, 0, 792], matrix, content: drawImage(-612, 0, 612, 792) } });
  assert.deepEqual(await kinds({ pages: [{ content: "/Fm1 Do" }], forms: form([1, 0, 0, 1, 612, 0]) }), ["scanned"]);
  assert.deepEqual(await kinds({ pages: [{ content: "/Fm1 Do" }], forms: form([1, 0, 0, 1, 0, 0]) }), ["born_digital"]);
});

test("a scanned letter page renders to one 150 dpi PNG with the image's colours where they belong", async () => {
  const [page] = (await render({ path: SCANNED, pages: "1" })).pages;
  assert.equal(page.images.length, 1);
  const [image] = page.images;
  assert.equal(image.tile, undefined);
  assert.deepEqual([image.width, image.height], [1275, 1650]);
  assert.equal(image.sha256, createHash("sha256").update(readFileSync(image.path)).digest("hex"));
  const png = decodePng(image.path);
  assert.deepEqual([png.width, png.height], [1275, 1650]);
  assert.deepEqual(pixel(png, 80, 80), GREEN);
  assert.deepEqual(pixel(png, 400, 825), RED);
  assert.deepEqual(pixel(png, 1000, 825), BLUE);
  assert.deepEqual(pixel(png, 1000, 80), BLUE);
});

test("two calls render the same page to the same bytes, in different folders", async () => {
  const a = await render({ path: SCANNED, pages: "1" });
  const b = await render({ path: SCANNED, pages: "1" });
  assert.notEqual(a.render_dir, b.render_dir);
  assert.equal(a.pages[0].images[0].sha256, b.pages[0].images[0].sha256);
});

test("with no scanned page no folder is made, and render_dir is null", async () => {
  const got = await render({ path: SCANNED, pages: "2-3" });
  assert.equal(got.render_dir, null);
});

test("a /Rotate 90 page renders turned, its image's top-left corner at the top right", async () => {
  const path = file("rotated.pdf", imagePdfBytes({ pages: [{ rotate: 90, content: drawImage(0, 0, 612, 792) }] }));
  const [page] = (await render({ path })).pages;
  assert.equal(page.kind, "scanned");
  const png = decodePng(page.images[0].path);
  assert.deepEqual([png.width, png.height], [1650, 1275]);
  assert.deepEqual(pixel(png, 1650 - 80, 80), GREEN);
  assert.deepEqual(pixel(png, 825, 400), RED);
  assert.deepEqual(pixel(png, 825, 1000), BLUE);
});

test("a CropBox offset from the MediaBox: coverage and the render are of the crop box", async () => {
  const cropBox = [306, 0, 612, 792];
  const path = file("cropped.pdf", imagePdfBytes({
    pages: [
      { cropBox, content: drawImage(306, 0, 306, 792) },
      { cropBox, content: drawImage(0, 0, 306, 792) },
    ],
  }));
  const got = await render({ path });
  assert.deepEqual(got.pages.map((p) => p.kind), ["scanned", "born_digital"]);
  const png = decodePng(got.pages[0].images[0].path);
  assert.deepEqual([png.width, png.height], [638, 1650]);
  assert.deepEqual(pixel(png, 40, 80), GREEN);
  assert.deepEqual(pixel(png, 200, 825), RED);
  assert.deepEqual(pixel(png, 500, 825), BLUE);
});

test("images must cover half the page: 49% is born_digital, 51% scanned, off the grid lines too", async () => {
  // Offset by 3 pt, half a grid cell: a grid that counted every cell an edge touched would count 50%.
  assert.deepEqual(
    await kinds({ pages: [{ content: drawImage(3, 0, 0.49 * 612, 792) }, { content: drawImage(3, 0, 0.51 * 612, 792) }] }),
    ["born_digital", "scanned"]
  );
});

test("invisible text (mode 3 or 7) makes an image page scanned; visible text over 5% makes it born_digital, in a form too", async () => {
  const full = drawImage(0, 0, 612, 792);
  const forms = {
    Text: { bbox: [0, 0, 612, 792], content: `${full} ${textBlock()}` },
    Stamp: { bbox: [0, 0, 612, 792], content: `${full} ${drawText(0, 400, 20, 8)}` },
  };
  assert.deepEqual(
    await kinds({
      forms,
      pages: [
        { content: `${full} ${drawText(7, 72, 720)}` },
        { content: `${full} ${textBlock()} ${drawText(3, 72, 720)}` },
        { content: `${full} ${textBlock()}` },
        { content: "/Text Do" },
        { content: "/Stamp Do" },
      ],
    }),
    ["scanned", "scanned", "born_digital", "born_digital", "scanned"]
  );
});

test("a Bates-stamped exhibit (image, invisible OCR text, a small visible stamp) is scanned", async () => {
  const content = `${drawImage(0, 0, 612, 792)} ${drawText(3, 72, 720)} ${drawText(0, 450, 20, 8)} ${drawText(0, 40, 770, 8)}`;
  assert.deepEqual(await kinds({ pages: [{ content }] }), ["scanned"]);
});

test("each refusal has its code", async () => {
  const refused = (code) => (err) => err.code === code;
  await assert.rejects(render({ path: "scanned.pdf" }), refused("data_error"));
  await assert.rejects(render({ path: join(DIR, "missing.pdf") }), refused("not_found"));
  await assert.rejects(render({ path: file("notes.txt", "placeholder") }), refused("not_pdf"));
  await assert.rejects(render({ path: file("garbage.pdf", "not a pdf at all") }), refused("not_pdf"));
  await assert.rejects(render({ path: file("locked.pdf", scannedPdfBytes({ encrypted: true })) }), refused("password_protected"));
  for (const pages of ["0", "3-2", "5", "1-5", "one"]) {
    await assert.rejects(render({ path: SCANNED, pages }), refused("bad_pages"), pages);
  }
  // The page tree claims two pages and holds one.
  const short = imagePdfBytes({ pages: [{ content: drawImage(0, 0, 612, 792) }] }).toString("latin1").replace("/Count 1", "/Count 2");
  const shortPath = file("short.pdf", Buffer.from(short, "latin1"));
  await assert.rejects(render({ path: shortPath }), (err) => err.code === "bad_pages" && /page 2/.test(err.message));
  await assert.rejects(classifyPdfPages(shortPath), refused("bad_pages"));
  const huge = file("huge.pdf", imagePdfBytes({ pages: [{ mediaBox: [0, 0, 20000, 792], content: drawImage(0, 0, 20000, 792) }] }));
  await assert.rejects(render({ path: huge }), refused("page_too_large"));
  const text = file("text.pdf", pdfBytes(["Placeholder"]));
  await assert.rejects(pdfPageImages({ path: text }, pathToFileURL(join(DIR, "no-such.wasm"))), refused("renderer_unavailable"));
});
