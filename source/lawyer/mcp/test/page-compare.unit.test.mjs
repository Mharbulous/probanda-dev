// pdfPagesCompare and reviewGroups (src/files/extract/page-compare.ts): pdf_pages__compare pairs two
// PDFs' pages by number, clears each page whose every check matches, writes PNGs of the pages that
// differ to the eye, and splits those pages into review groups. Every fixture is synthetic
// (test/helpers/synthetic-docs.mjs), placeholder text only.

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { after } from "node:test";
import test from "node:test";

import { decodePng, DIR, file } from "./helpers/page-images.mjs";
import { drawImage, drawText, imagePdfBytes, textBlock } from "./helpers/synthetic-docs.mjs";

const { pdfPagesCompare, reviewGroups } = await import("../build/files/extract/page-compare.js");

const workDirs = [];
after(() => {
  for (const dir of workDirs) rmSync(dir, { recursive: true, force: true });
});

const DEST = join(DIR, "Page images");

/** pdfPagesCompare(args), into DEST unless args name another destination_dir, its work folder
 * removed after the file's tests. */
async function compare(args) {
  const result = await pdfPagesCompare({ destination_dir: DEST, ...args });
  if (result.work_dir) workDirs.push(result.work_dir);
  return result;
}

const SCAN = `${drawImage(0, 0, 612, 792)} ${drawText(3, 72, 720)}`;
const MARK = "q 0 0 0 rg 300 300 40 40 re f Q";
const BOX = "0 0 0 rg 0 0 200 30 re f";
// An OCR'd scan, a born-digital text page and an image page under visible text.
const PAGES = [{ content: SCAN }, { content: textBlock() }, { content: `${drawImage(0, 0, 612, 396)} ${textBlock()}` }];
const ORIGINAL = file("original.pdf", imagePdfBytes({ pages: PAGES }));
const withPage = (i, page) => PAGES.map((p, j) => (j === i ? { ...p, ...page } : p));

test("an identical pair, scanned and born-digital pages alike, is cleared whole: nothing flagged, no group, no folder", async () => {
  const copy = file("copy.pdf", imagePdfBytes({ pages: PAGES }));
  assert.deepEqual(await compare({ a: ORIGINAL, b: copy }), {
    pages_a: 3,
    pages_b: 3,
    cleared: ["1-3"],
    flagged: [],
    review_groups: [],
    work_dir: null,
  });
});

test("a page turned by /Rotate is flagged for rotation and render, not size, with both drawings written", async () => {
  const copy = file("rotated.pdf", imagePdfBytes({ pages: withPage(0, { rotate: 180 }) }));
  const got = await compare({ a: ORIGINAL, b: copy });
  assert.deepEqual(got.cleared, ["2-3"]);
  assert.equal(got.flagged.length, 1);
  const [page] = got.flagged;
  assert.equal(page.page, 1);
  assert.deepEqual(page.reasons, ["rotation", "render"]);
  assert.ok(page.changed_share > 0.5, `${page.changed_share}`);
  assert.deepEqual(got.review_groups, [[1]]);
  for (const [side, path] of [["a", page.a[0]], ["b", page.b[0]]]) {
    assert.equal(dirname(path), join(got.work_dir, side));
    assert.deepEqual([decodePng(path).width, decodePng(path).height], [1275, 1650]);
  }
});

test("a mark added to a born-digital page is a render difference, with the share of pixels it changed", async () => {
  const copy = file("marked.pdf", imagePdfBytes({ pages: withPage(1, { content: `${textBlock()} ${MARK}` }) }));
  const got = await compare({ a: ORIGINAL, b: copy });
  assert.deepEqual(got.cleared, ["1", "3"]);
  const [page] = got.flagged;
  assert.deepEqual([page.page, page.reasons], [2, ["render"]]);
  // 40 x 40 pt at 150 dpi is about 83 x 83 px of 1275 x 1650.
  assert.ok(page.changed_share > 0.002 && page.changed_share < 0.01, `${page.changed_share}`);
  assert.deepEqual(got.review_groups, [[2]]);
});

test("a page removed: the counts differ, the pages after it differ, and the last is only in the original", async () => {
  const copy = file("short.pdf", imagePdfBytes({ pages: [PAGES[0], PAGES[2]] }));
  const got = await compare({ a: ORIGINAL, b: copy });
  assert.deepEqual([got.pages_a, got.pages_b, got.cleared], [3, 2, ["1"]]);
  assert.deepEqual(got.flagged.map((f) => f.page), [2, 3]);
  assert.ok(got.flagged[0].reasons.includes("render"));
  const last = got.flagged[1];
  assert.deepEqual(last.reasons, ["only_in_a"]);
  assert.equal(last.b, undefined);
  assert.ok(existsSync(last.a[0]));
  assert.deepEqual(got.review_groups, [[2, 3]]);
});

test("a change to the invisible text layer alone is flagged for text, with no drawing and no group", async () => {
  const other = `${drawImage(0, 0, 612, 792)} BT 3 Tr /F1 12 Tf 72 720 Td (Another placeholder line) Tj ET`;
  const copy = file("retexted.pdf", imagePdfBytes({ pages: withPage(0, { content: other }) }));
  const got = await compare({ a: ORIGINAL, b: copy });
  assert.deepEqual(got.flagged, [{ page: 1, reasons: ["text"] }]);
  assert.deepEqual(got.review_groups, []);
  assert.equal(got.work_dir, null);
});

test("annotations and form fields are drawn: one dropped from the copy is a render difference", async () => {
  const annotated = [{ content: textBlock(), annots: [{ rect: [100, 100, 300, 130], ap: BOX }, { rect: [100, 600, 300, 630], ap: BOX, widget: true }] }];
  const original = file("annotated.pdf", imagePdfBytes({ pages: annotated }));
  const noSquare = file("no-square.pdf", imagePdfBytes({ pages: [{ ...annotated[0], annots: [annotated[0].annots[1]] }] }));
  const noField = file("no-field.pdf", imagePdfBytes({ pages: [{ ...annotated[0], annots: [annotated[0].annots[0]] }] }));
  for (const copy of [noSquare, noField]) {
    const got = await compare({ a: original, b: copy });
    assert.deepEqual(got.flagged.map((f) => [f.page, f.reasons]), [[1, ["render"]]], copy);
  }
});

test("a field flattened into the page content draws the same: the page is cleared", async () => {
  const field = [{ content: textBlock(), annots: [{ rect: [100, 600, 300, 630], ap: BOX, widget: true }] }];
  const original = file("field.pdf", imagePdfBytes({ pages: field }));
  const flattened = file("flattened.pdf", imagePdfBytes({ pages: [{ content: `${textBlock()} q 1 0 0 1 100 600 cm ${BOX} Q` }] }));
  assert.deepEqual((await compare({ a: original, b: flattened })).cleared, ["1"]);
});

test("the drawings go in destination_dir's subfolder named for the pair's hashes, the same on each compare; the inputs' folder is left as it was", async () => {
  const dir = join(DIR, "inputs");
  mkdirSync(dir);
  const a = join(dir, "a.pdf");
  const b = join(dir, "b.pdf");
  writeFileSync(a, imagePdfBytes({ pages: PAGES }));
  writeFileSync(b, imagePdfBytes({ pages: withPage(1, { content: `${textBlock()} ${MARK}` }) }));
  const dest = join(DIR, "Compare images");
  const got = await compare({ a, b, destination_dir: dest });
  const sha = (path) => createHash("sha256").update(readFileSync(path)).digest("hex").slice(0, 16);
  assert.equal(got.work_dir, join(dest, `compare-${sha(a)}-${sha(b)}`));
  assert.equal(dirname(got.flagged[0].a[0]), join(got.work_dir, "a"));
  assert.equal((await compare({ a, b, destination_dir: dest })).work_dir, got.work_dir);
  assert.deepEqual(readdirSync(dir).sort(), ["a.pdf", "b.pdf"]);
});

test("destination_dir is required and absolute, and one that cannot be made is refused, never swapped for a temp folder", async () => {
  const copy = file("marked-3.pdf", imagePdfBytes({ pages: withPage(1, { content: `${textBlock()} ${MARK}` }) }));
  await assert.rejects(pdfPagesCompare({ a: ORIGINAL, b: copy }), (err) => err.code === "data_error" && /destination_dir/.test(err.message));
  await assert.rejects(compare({ a: ORIGINAL, b: copy, destination_dir: "Page images" }), /destination_dir must be absolute/);
  // A file where the folder should be: the folder cannot be made.
  const blocked = file("blocked", "placeholder");
  await assert.rejects(compare({ a: ORIGINAL, b: copy, destination_dir: blocked }), /ENOTDIR|EEXIST/);
});

test("pages limits the compare, and each refusal has pdf_pages__images' code", async () => {
  const copy = file("marked-2.pdf", imagePdfBytes({ pages: withPage(1, { content: `${textBlock()} ${MARK}` }) }));
  assert.deepEqual((await compare({ a: ORIGINAL, b: copy, pages: "3" })).cleared, ["3"]);
  const refused = (code) => (err) => err.code === code;
  await assert.rejects(compare({ a: "original.pdf", b: copy }), refused("data_error"));
  await assert.rejects(compare({ a: ORIGINAL, b: join(DIR, "missing.pdf") }), refused("not_found"));
  await assert.rejects(compare({ a: ORIGINAL, b: file("notes.txt", "placeholder") }), refused("not_pdf"));
  await assert.rejects(compare({ a: ORIGINAL, b: copy, pages: "4" }), refused("bad_pages"));
});

test("review groups: the fewest groups of at most 5, sizes differing by at most one", () => {
  const pages = (n) => Array.from({ length: n }, (_, i) => i + 1);
  const sizes = (n) => reviewGroups(pages(n)).map((g) => g.length);
  assert.deepEqual(sizes(16), [4, 4, 4, 4]);
  assert.deepEqual(sizes(74), [...Array(14).fill(5), 4]);
  assert.deepEqual(sizes(5), [5]);
  assert.deepEqual(reviewGroups([]), []);
  assert.deepEqual(reviewGroups(pages(6)), [[1, 2, 3], [4, 5, 6]]);
});
