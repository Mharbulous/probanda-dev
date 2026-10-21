// Shared by the page-images unit test files: a scratch folder, a render call that cleans up after
// itself, a PNG decoder (node:zlib only) and a reference render through a separate PDFium instance.
// Run after `npm run build`, which puts pdfium.wasm beside build/files/extract/page-images.js.

import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inflateSync } from "node:zlib";
import { after } from "node:test";

import { init } from "@embedpdf/pdfium";

export const { classifyPdfPages, pdfPageImages } = await import("../../build/files/extract/page-images.js");

export const DIR = mkdtempSync(join(tmpdir(), "coclerk-page-images-"));
const renderDirs = [];
after(() => {
  for (const dir of [DIR, ...renderDirs]) rmSync(dir, { recursive: true, force: true });
});

let count = 0;
/** `bytes` written to a new file in DIR, named after `name`. */
export function file(name, bytes) {
  const path = join(DIR, `${count++}-${name}`);
  writeFileSync(path, bytes);
  return path;
}

/** pdfPageImages(args), its render folder removed after the file's tests. */
export async function render(args) {
  const result = await pdfPageImages(args);
  if (result.render_dir) renderDirs.push(result.render_dir);
  return result;
}

/** A PNG decoded to {width, height, rgb}, checking its signature and filter bytes. */
export function decodePng(path) {
  const bytes = readFileSync(path);
  assert.deepEqual([...bytes.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  let width;
  let height;
  const idat = [];
  for (let off = 8; off < bytes.length; ) {
    const len = bytes.readUInt32BE(off);
    const type = bytes.toString("latin1", off + 4, off + 8);
    const data = bytes.subarray(off + 8, off + 8 + len);
    if (type === "IHDR") [width, height] = [data.readUInt32BE(0), data.readUInt32BE(4)];
    if (type === "IDAT") idat.push(data);
    off += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const line = width * 3 + 1;
  assert.equal(raw.length, line * height);
  const rgb = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y++) {
    assert.equal(raw[y * line], 0);
    raw.copy(rgb, y * width * 3, y * line + 1, (y + 1) * line);
  }
  return { width, height, rgb };
}

export const pixel = ({ width, rgb }, x, y) => [...rgb.subarray((y * width + x) * 3, (y * width + x) * 3 + 3)];
export const RED = [255, 0, 0];
export const BLUE = [0, 0, 255];
export const GREEN = [0, 255, 0];

let reference;
/** Page 1 of `bytes` drawn whole at width x height by a separate PDFium instance, as RGB. */
async function directRender(bytes, width, height) {
  reference ??= init({ wasmBinary: readFileSync(new URL("../../node_modules/@embedpdf/pdfium/dist/pdfium.wasm", import.meta.url)) }).then((lib) => {
    lib.PDFiumExt_Init();
    return lib;
  });
  const lib = await reference;
  const m = lib.pdfium;
  const ptr = m.wasmExports.malloc(bytes.length);
  m.HEAPU8.set(bytes, ptr);
  const doc = lib.FPDF_LoadMemDocument(ptr, bytes.length, "");
  const page = lib.FPDF_LoadPage(doc, 0);
  const bitmap = lib.FPDFBitmap_CreateEx(width, height, 2, 0, 0);
  lib.FPDFBitmap_FillRect(bitmap, 0, 0, width, height, 0xffffffff);
  lib.FPDF_RenderPageBitmap(bitmap, page, 0, 0, width, height, 0, 0);
  const buffer = lib.FPDFBitmap_GetBuffer(bitmap);
  const stride = lib.FPDFBitmap_GetStride(bitmap);
  const bgr = m.HEAPU8.subarray(buffer, buffer + stride * height);
  const rgb = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y++) {
    for (let x = 0, s = y * stride, d = y * width * 3; x < width; x++, s += 3, d += 3) {
      rgb[d] = bgr[s + 2];
      rgb[d + 1] = bgr[s + 1];
      rgb[d + 2] = bgr[s];
    }
  }
  lib.FPDFBitmap_Destroy(bitmap);
  lib.FPDF_ClosePage(page);
  lib.FPDF_CloseDocument(doc);
  m.wasmExports.free(ptr);
  return rgb;
}

/** Asserts each tile holds exactly the rows of a single width x height render of page 1 of `bytes`
 * that it claims, tile i starting at row `tops[i]`. */
export async function assertTilesMatch(bytes, images, tops, width, height) {
  const whole = await directRender(bytes, width, height);
  images.forEach((image, i) => {
    const tile = decodePng(image.path);
    assert.deepEqual([tile.width, tile.height], [image.width, image.height]);
    const rows = whole.subarray(tops[i] * width * 3, (tops[i] + tile.height) * width * 3);
    assert.ok(tile.rgb.equals(rows), `tile ${i + 1} differs from rows ${tops[i]}-${tops[i] + tile.height} of a single render`);
  });
}

/** Asserts every image is at least 1 px and at most 2000 px a side and 3,000,000 pixels. */
export function assertWithinCaps(images) {
  for (const { width, height } of images) {
    assert.ok(width >= 1 && height >= 1 && width <= 2000 && height <= 2000 && width * height <= 3_000_000, `${width}x${height}`);
  }
}
