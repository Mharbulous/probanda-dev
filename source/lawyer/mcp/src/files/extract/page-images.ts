// pdf_pages__images: renders a PDF's scanned pages to PNG files, so a scanned or OCR'd page is read
// from its image and never from its text layer (an OCR layer is often garbled, and an invisible one
// can carry text no human sees). Born-digital pages are classified and left alone. classifyPdfPages
// gives the same classification and renders nothing, for the tools that read a PDF's text layer.
//
// The renderer is PDFium (BSD-3/Apache-2.0) as WebAssembly, from @embedpdf/pdfium (MIT): its JS glue
// is inlined by esbuild and scripts/bundle.mjs copies pdfium.wasm, with THIRD-PARTY-NOTICES.txt, next
// to the bundle, so nothing is installed at run time and no host renderer is needed. The PNG encoder
// is the few lines below, on node:zlib, so the same page gives the same bytes with the same server
// build. Imported only by the data server's dispatch, text and page-compare tools and the files
// server's file_ops__comment_pdf, which keeps the renderer out of the contacts and timecamp bundles.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { extname, isAbsolute, join } from "node:path";
import { deflateSync } from "node:zlib";
import { init, type WrappedPdfiumModule } from "@embedpdf/pdfium";

import { DataServerError, ValidationError } from "../../errors.js";

// The Claude API refuses an image over 2000 px on a side once a request holds more than 20 images,
// and Claude Code shrinks one over about 3,000,000 pixels (about 4,000 image tokens at w*h/750). So
// a page is drawn at most MAX_SIDE wide (its dpi lowered if need be) and cut into horizontal tiles
// that each keep within both limits.
const MAX_PIXELS = 3_000_000;
const MAX_SIDE = 2000;
export const DPI = 150;
const TILE_DPI = 200;
// The two `tiles` halves overlap by this share of the page height, so a stamp at mid-height is whole
// in at least one of them.
const TILE_OVERLAP = 0.1;
// The PDF limit on a page side, in points (ISO 32000-1, Annex C).
const MAX_PAGE_POINTS = 14_400;
// Scanned: images cover at least MIN_IMAGE_COVER of the page, and either some text is invisible or
// the visible text covers under MAX_TEXT_COVER of it.
const MIN_IMAGE_COVER = 0.5;
const MAX_TEXT_COVER = 0.05;
// FPDF_PAGEOBJ_* and FPDF_TEXTRENDERMODE_INVISIBLE / _CLIP (fpdf_edit.h), FPDF_ERR_PASSWORD
// (fpdfview.h), FPDFBitmap_BGR (3 bytes a pixel, blue first).
const OBJ_TEXT = 1;
export const OBJ_IMAGE = 3;
export const OBJ_FORM = 5;
const INVISIBLE_TEXT_MODES = new Set([3, 7]);
const ERR_PASSWORD = 4;
const BITMAP_BGR = 2;

export const DEFAULT_WASM = new URL("./pdfium.wasm", import.meta.url);

export type PageKind = "scanned" | "born_digital";

export interface PageImage {
  path: string;
  sha256: string;
  width: number;
  height: number;
  tile?: number;
}

export interface PageImagesResult {
  source_sha256: string;
  page_count: number;
  render_dir: string | null;
  pages: Array<{ page: number; kind: PageKind; images?: PageImage[] }>;
}

// One PDFium instance per wasm file, loaded on first use and kept for the life of the process, or
// until it traps.
const loaded = new Map<string, Promise<WrappedPdfiumModule>>();

function loadPdfium(wasm: URL): Promise<WrappedPdfiumModule> {
  let lib = loaded.get(wasm.href);
  if (!lib) {
    lib = (async () => {
      // print/printErr: stdout carries the MCP JSON-RPC stream.
      const module = await init({ wasmBinary: readFileSync(wasm), print: console.error, printErr: console.error });
      module.PDFiumExt_Init();
      return module;
    })();
    loaded.set(wasm.href, lib);
    lib.catch(() => loaded.delete(wasm.href));
  }
  return lib;
}

/** The wasm heap as bytes. Emscripten sets HEAPU8 on the module, and replaces it when memory grows,
 * so it is read after each allocation; the package's types leave it out. */
function heapU8(lib: WrappedPdfiumModule): Uint8Array {
  return (lib.pdfium as unknown as { HEAPU8: Uint8Array }).HEAPU8;
}

function malloc(lib: WrappedPdfiumModule, bytes: number): number {
  const ptr = lib.pdfium.wasmExports.malloc(Math.max(bytes, 1));
  if (!ptr) throw new DataServerError(`the PDF renderer could not allocate ${bytes} bytes`, "renderer_unavailable");
  return ptr;
}

/** Opens the PDF at `path` and runs `work` on it. `work` yields between pages and tiles, so each
 * page's open, use and close stays within one turn of the event loop; the document stays open across turns, which
 * PDFium allows. A trap (WebAssembly.RuntimeError) drops the cached instance, so the next call loads a
 * fresh one. */
export async function withPdf<T>(
  path: string,
  wasm: URL,
  work: (lib: WrappedPdfiumModule, doc: number, data: Buffer) => Promise<T>
): Promise<T> {
  if (!isAbsolute(path)) throw new ValidationError(`path must be absolute: ${path}`);
  if (!existsSync(path) || !statSync(path).isFile()) throw new DataServerError(`no file at ${path}`, "not_found");
  if (extname(path).toLowerCase() !== ".pdf") throw new DataServerError(`not a .pdf: ${path}`, "not_pdf");
  const data = readFileSync(path);

  const pending = loadPdfium(wasm);
  let lib: WrappedPdfiumModule;
  try {
    lib = await pending;
  } catch (err) {
    throw new DataServerError(`the PDF renderer did not load: ${(err as Error).message}`, "renderer_unavailable");
  }
  try {
    // PDFium reads the document from this buffer for as long as it is open.
    const dataPtr = malloc(lib, data.length);
    heapU8(lib).set(data, dataPtr);
    const doc = lib.FPDF_LoadMemDocument(dataPtr, data.length, "");
    if (!doc) {
      const code = lib.FPDF_GetLastError();
      lib.pdfium.wasmExports.free(dataPtr);
      if (code === ERR_PASSWORD) throw new DataServerError(`the PDF is password-protected: ${path}`, "password_protected");
      throw new DataServerError(`PDFium cannot open ${path} as a PDF (error ${code})`, "not_pdf");
    }
    try {
      return await work(lib, doc, data);
    } finally {
      lib.FPDF_CloseDocument(doc);
      lib.pdfium.wasmExports.free(dataPtr);
    }
  } catch (err) {
    // Only this call's instance: a concurrent call may already have loaded a fresh one.
    if (err instanceof WebAssembly.RuntimeError && loaded.get(wasm.href) === pending) loaded.delete(wasm.href);
    throw err;
  }
}

/** Loads page `n` (from 1), runs `use` on it and closes it, all in this turn of the event loop. */
export function withPage<T>(lib: WrappedPdfiumModule, doc: number, n: number, use: (page: number) => T): T {
  const page = lib.FPDF_LoadPage(doc, n - 1);
  if (!page) throw new DataServerError(`PDFium cannot load page ${n} of this PDF`, "bad_pages");
  try {
    return use(page);
  } finally {
    lib.FPDF_ClosePage(page);
  }
}

export const nextTurn = () => new Promise((resolve) => setImmediate(resolve));

/** The kind of every page of the PDF at `path`, renders nothing. */
export async function classifyPdfPages(path: string, wasm: URL = DEFAULT_WASM): Promise<PageKind[]> {
  return withPdf(path, wasm, async (lib, doc) => {
    const kinds: PageKind[] = [];
    const pageCount = lib.FPDF_GetPageCount(doc);
    for (let n = 1; n <= pageCount; n++) {
      if (n > 1) await nextTurn();
      kinds.push(withPage(lib, doc, n, (page) => classify(lib, page, n)));
    }
    return kinds;
  });
}

export async function pdfPageImages(
  args: { path: string; pages?: string; tiles?: boolean; destination_dir?: string },
  wasm: URL = DEFAULT_WASM
): Promise<PageImagesResult> {
  if (args.destination_dir !== undefined && !isAbsolute(args.destination_dir)) {
    throw new ValidationError(`destination_dir must be absolute: ${args.destination_dir}`);
  }
  return withPdf(args.path, wasm, async (lib, doc, data) => {
    const sourceSha256 = createHash("sha256").update(data).digest("hex");
    const pageCount = lib.FPDF_GetPageCount(doc);
    const [first, last] = pageRange(args.pages, pageCount);
    let renderDir: string | null = null;
    const pages: PageImagesResult["pages"] = [];
    for (let n = first; n <= last; n++) {
      if (n > first) await nextTurn();
      const plan = withPage(lib, doc, n, (page) => {
        if (classify(lib, page, n) === "born_digital") return null;
        const { width, height } = pageSize(lib, page, n, args.tiles ? TILE_DPI : DPI);
        return { width, height, tiles: args.tiles ? overlappingHalves(width, height) : tileRows(width, 0, height) };
      });
      if (!plan) {
        pages.push({ page: n, kind: "born_digital" });
        continue;
      }
      const { width, height, tiles } = plan;
      // In destination_dir, one folder per PDF, so a re-render overwrites the same bytes.
      if (renderDir === null) {
        if (args.destination_dir === undefined) renderDir = mkdtempSync(join(tmpdir(), "probanda-pages-"));
        else {
          renderDir = join(args.destination_dir, sourceSha256.slice(0, 16));
          mkdirSync(renderDir, { recursive: true });
        }
      }
      const images: PageImage[] = [];
      for (const [i, [top, rows]] of tiles.entries()) {
        // Each tile loads the page again, so its render, encoding and free stay within one turn.
        await nextTurn();
        const png = withPage(lib, doc, n, (page) => renderPng(lib, page, n, width, height, top, rows));
        const name = tiles.length === 1 ? pageName(n) : `${pageName(n)}-tile-${i + 1}`;
        const file = join(renderDir, `${name}.png`);
        writeFileSync(file, png);
        const image: PageImage = { path: file, sha256: createHash("sha256").update(png).digest("hex"), width, height: rows };
        if (tiles.length > 1) image.tile = i + 1;
        images.push(image);
      }
      pages.push({ page: n, kind: "scanned", images });
    }
    return {
      source_sha256: sourceSha256,
      page_count: pageCount,
      render_dir: renderDir,
      pages,
    };
  });
}

export function pageName(n: number): string {
  return `page-${String(n).padStart(4, "0")}`;
}

export function pageRange(pages: string | undefined, pageCount: number): [number, number] {
  if (pages === undefined) return [1, pageCount];
  const m = /^\s*(\d+)\s*(?:[-–]\s*(\d+))?\s*$/.exec(pages);
  if (!m) throw new DataServerError(`pages must read "X" or "X-Y": ${pages}`, "bad_pages");
  const first = Number(m[1]);
  const last = m[2] === undefined ? first : Number(m[2]);
  if (first < 1 || last < first || last > pageCount) {
    throw new DataServerError(`pages ${pages} is not a range within the file's ${pageCount} pages`, "bad_pages");
  }
  return [first, last];
}

/** The page's pixel size at `dpi`, with the dpi lowered so the width is at most MAX_SIDE, and each
 * side at least 1 px. */
export function pageSize(lib: WrappedPdfiumModule, page: number, n: number, dpi: number): { width: number; height: number } {
  const wPt = lib.FPDF_GetPageWidthF(page);
  const hPt = lib.FPDF_GetPageHeightF(page);
  if (!(wPt <= MAX_PAGE_POINTS && hPt <= MAX_PAGE_POINTS)) {
    throw new DataServerError(`page ${n} is ${wPt} x ${hPt} pt, over the PDF limit of ${MAX_PAGE_POINTS} pt a side`, "page_too_large");
  }
  const scale = Math.min(dpi, (MAX_SIDE * 72) / wPt) / 72;
  return {
    width: Math.min(MAX_SIDE, Math.max(1, Math.round(wPt * scale))),
    height: Math.max(1, Math.round(hPt * scale)),
  };
}

/** [top row, row count] of each tile of rows [top, top + rows): as few equal tiles as keep each at
 * most MAX_SIDE tall and MAX_PIXELS in all. `width` is at most MAX_SIDE, so a tile holds at least
 * 1,500 rows. */
export function tileRows(width: number, top: number, rows: number): Array<[number, number]> {
  const maxRows = Math.min(MAX_SIDE, Math.floor(MAX_PIXELS / width));
  const each = Math.ceil(rows / Math.ceil(rows / maxRows));
  const tiles: Array<[number, number]> = [];
  for (let t = top; t < top + rows; t += each) tiles.push([t, Math.min(each, top + rows - t)]);
  return tiles;
}

/** The top and bottom halves of the page, overlapping by TILE_OVERLAP of its height, each cut
 * further if it is over the limits; top to bottom. */
function overlappingHalves(width: number, height: number): Array<[number, number]> {
  const half = Math.ceil((height + Math.round(height * TILE_OVERLAP)) / 2);
  return [...tileRows(width, 0, half), ...tileRows(width, height - half, half)].sort((a, b) => a[0] - b[0]);
}

// A matrix [a b c d e f] maps (x, y) to (a x + c y + e, b x + d y + f).
type Matrix = [number, number, number, number, number, number];
type Rect = [number, number, number, number]; // left, bottom, right, top

/** `inner` applied first, then `outer`. */
function compose(inner: Matrix, outer: Matrix): Matrix {
  const [a, b, c, d, e, f] = inner;
  const [A, B, C, D, E, F] = outer;
  return [a * A + b * C, a * B + b * D, c * A + d * C, c * B + d * D, e * A + f * C + E, e * B + f * D + F];
}

function transform([a, b, c, d, e, f]: Matrix, [l, bo, r, t]: Rect): Rect {
  const xs = [l, r].flatMap((x) => [bo, t].map((y) => a * x + c * y + e));
  const ys = [l, r].flatMap((x) => [bo, t].map((y) => b * x + d * y + f));
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

/** Scanned: the union of image bounds covers at least half the page box, and either some text object
 * has an invisible render mode (3, or 7 its clip variant) or the union of the visible text objects'
 * bounds covers under 5% of it (no text at all included). Form XObjects are walked, since scanners
 * sometimes wrap the page image in one, and Acrobat puts Bates and header stamps in one. */
function classify(lib: WrappedPdfiumModule, page: number, n: number): PageKind {
  const m = lib.pdfium;
  const floats = malloc(lib, 24);
  const read = (count: number) => Array.from({ length: count }, (_, i) => m.getValue(floats + 4 * i, "float"));
  const images: Rect[] = [];
  const texts: Rect[] = [];
  let invisibleText = false;
  let box: number[];
  try {
    if (!lib.FPDF_GetPageBoundingBox(page, floats)) {
      throw new DataServerError(`PDFium cannot read the page box of page ${n} of this PDF`, "bad_pages");
    }
    box = read(4); // left, top, right, bottom
    const bounds = (obj: number, matrix: Matrix): Rect | null =>
      lib.FPDFPageObj_GetBounds(obj, floats, floats + 4, floats + 8, floats + 12) ? transform(matrix, read(4) as Rect) : null;
    const walk = (count: number, objectAt: (i: number) => number, matrix: Matrix): void => {
      for (let i = 0; i < count; i++) {
        const obj = objectAt(i);
        const type = lib.FPDFPageObj_GetType(obj);
        if (type === OBJ_TEXT) {
          if (INVISIBLE_TEXT_MODES.has(lib.FPDFTextObj_GetTextRenderMode(obj))) invisibleText = true;
          else {
            const rect = bounds(obj, matrix);
            if (rect) texts.push(rect);
          }
        } else if (type === OBJ_IMAGE) {
          const rect = bounds(obj, matrix);
          if (rect) images.push(rect);
        } else if (type === OBJ_FORM) {
          lib.FPDFPageObj_GetMatrix(obj, floats);
          const inner = compose(read(6) as Matrix, matrix);
          walk(lib.FPDFFormObj_CountObjects(obj), (j) => lib.FPDFFormObj_GetObject(obj, j), inner);
        }
      }
    };
    walk(lib.FPDFPage_CountObjects(page), (i) => lib.FPDFPage_GetObject(page, i), [1, 0, 0, 1, 0, 0]);
  } finally {
    m.wasmExports.free(floats);
  }
  if (images.length === 0) return "born_digital";
  const [left, top, right, bottom] = box;
  const pageBox: Rect = [left, bottom, right, top];
  if (right - left <= 0 || top - bottom <= 0) return "born_digital";
  const scanned = coverage(images, pageBox) >= MIN_IMAGE_COVER && (invisibleText || coverage(texts, pageBox) < MAX_TEXT_COVER);
  return scanned ? "scanned" : "born_digital";
}

/** The share of `box` the union of `rects` covers, clipped to it, on a 100x100 grid: a cell counts
 * when its centre is inside a rect. */
function coverage(rects: Rect[], [left, bottom, right, top]: Rect): number {
  const N = 100;
  const grid = new Uint8Array(N * N);
  const cell = (v: number, lo: number, span: number) => Math.min(N, Math.max(0, Math.ceil(((v - lo) / span) * N - 0.5)));
  for (const [l, b, r, t] of rects) {
    const x0 = cell(l, left, right - left);
    const x1 = cell(r, left, right - left);
    const y0 = cell(b, bottom, top - bottom);
    const y1 = cell(t, bottom, top - bottom);
    for (let y = y0; y < y1; y++) if (x0 < x1) grid.fill(1, y * N + x0, y * N + x1);
  }
  return grid.reduce((sum, v) => sum + v, 0) / (N * N);
}

/** Rows [top, top + rows) of page `n` drawn at width x height pixels, as an RGB PNG on white, with no
 * annotations. */
function renderPng(lib: WrappedPdfiumModule, page: number, n: number, width: number, height: number, top: number, rows: number): Buffer {
  return encodePng(renderRgb(lib, page, n, width, height, top, rows), width, rows);
}

/** Rows [top, top + rows) of page `n` drawn at width x height pixels on white, as RGB bytes row by
 * row. `flags` go to FPDF_RenderPageBitmap (0: no annotations); with a form-fill handle `form`, the
 * page's form fields are drawn over it with the same flags. */
export function renderRgb(
  lib: WrappedPdfiumModule,
  page: number,
  n: number,
  width: number,
  height: number,
  top: number,
  rows: number,
  flags = 0,
  form = 0
): Buffer {
  const bitmap = lib.FPDFBitmap_CreateEx(width, rows, BITMAP_BGR, 0, 0);
  if (!bitmap) throw new DataServerError(`PDFium could not allocate a ${width}x${rows} bitmap for page ${n}`, "page_too_large");
  try {
    lib.FPDFBitmap_FillRect(bitmap, 0, 0, width, rows, 0xffffffff);
    lib.FPDF_RenderPageBitmap(bitmap, page, 0, -top, width, height, 0, flags);
    if (form) lib.FPDF_FFLDraw(form, bitmap, page, 0, -top, width, height, 0, flags);
    const buffer = lib.FPDFBitmap_GetBuffer(bitmap);
    const stride = lib.FPDFBitmap_GetStride(bitmap);
    const heap = heapU8(lib);
    const rgb = Buffer.alloc(width * 3 * rows);
    for (let y = 0; y < rows; y++) {
      const src = buffer + y * stride;
      const dst = y * width * 3;
      for (let x = 0; x < width; x++) {
        rgb[dst + 3 * x] = heap[src + 3 * x + 2];
        rgb[dst + 3 * x + 1] = heap[src + 3 * x + 1];
        rgb[dst + 3 * x + 2] = heap[src + 3 * x];
      }
    }
    return rgb;
  } finally {
    lib.FPDFBitmap_Destroy(bitmap);
  }
}

/** `rgb` (width x rows, from renderRgb) as a PNG. */
export function encodePng(rgb: Buffer, width: number, rows: number): Buffer {
  const line = width * 3 + 1;
  const raw = Buffer.alloc(line * rows); // each row: filter byte 0, then R G B per pixel
  for (let y = 0; y < rows; y++) rgb.copy(raw, y * line + 1, y * width * 3, (y + 1) * width * 3);
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(rows, 4);
  header[8] = 8; // bit depth
  header[9] = 2; // colour type RGB
  return Buffer.concat([PNG_SIGNATURE, chunk("IHDR", header), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(bytes: Buffer): number {
  let c = 0xffffffff;
  for (const byte of bytes) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "latin1");
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}
