// pdf_pages__images: renders a PDF's scanned pages to PNG files, so a scanned or OCR'd page is read
// from its image and never from its text layer (an OCR layer is often garbled, and an invisible one
// can carry text no human sees). Born-digital pages are classified and left alone.
//
// The renderer is PDFium (Apache-2.0) as WebAssembly, from @embedpdf/pdfium (MIT): its JS glue is
// inlined by esbuild and scripts/bundle.mjs copies pdfium.wasm next to the bundle, so nothing is
// installed at run time and no host renderer is needed. The PNG encoder is the few lines below, on
// node:zlib, so the same page always gives the same bytes. Imported only by the data server's
// dispatch, which keeps the renderer out of the contacts and files bundles.

import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { extname, isAbsolute, join } from "node:path";
import { deflateSync } from "node:zlib";
import { init, type WrappedPdfiumModule } from "@embedpdf/pdfium";

import { DataServerError, ValidationError } from "../../errors.js";

// Above about 3,000,000 pixels (about 4,000 image tokens at w*h/750) Claude Code shrinks an image,
// so a larger page is cut into horizontal tiles that each stay under it.
const MAX_PIXELS = 3_000_000;
const DPI = 150;
const TILE_DPI = 200;
// FPDF_PAGEOBJ_* and FPDF_TEXTRENDERMODE_INVISIBLE (fpdf_edit.h), FPDF_ERR_PASSWORD (fpdfview.h),
// FPDFBitmap_BGR (3 bytes a pixel, blue first).
const OBJ_TEXT = 1;
const OBJ_IMAGE = 3;
const OBJ_FORM = 5;
const TEXT_INVISIBLE = 3;
const ERR_PASSWORD = 4;
const BITMAP_BGR = 2;

const DEFAULT_WASM = new URL("./pdfium.wasm", import.meta.url);

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
  render_dir: string;
  pages: Array<{ page: number; kind: "scanned" | "born_digital"; images?: PageImage[] }>;
}

// One PDFium instance per wasm file, loaded on first use and kept for the life of the process.
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

export async function pdfPageImages(
  args: { path: string; pages?: string; tiles?: boolean },
  wasm: URL = DEFAULT_WASM
): Promise<PageImagesResult> {
  const { path } = args;
  if (!isAbsolute(path)) throw new ValidationError(`path must be absolute: ${path}`);
  if (!existsSync(path) || !statSync(path).isFile()) throw new DataServerError(`no file at ${path}`, "not_found");
  if (extname(path).toLowerCase() !== ".pdf") throw new DataServerError(`not a .pdf: ${path}`, "not_pdf");
  const data = readFileSync(path);

  let lib: WrappedPdfiumModule;
  try {
    lib = await loadPdfium(wasm);
  } catch (err) {
    throw new DataServerError(`the PDF renderer did not load: ${(err as Error).message}`, "renderer_unavailable");
  }
  const m = lib.pdfium;
  const { malloc, free } = m.wasmExports;

  // PDFium reads the document from this buffer for as long as it is open.
  const dataPtr = malloc(data.length);
  heapU8(lib).set(data, dataPtr);
  const doc = lib.FPDF_LoadMemDocument(dataPtr, data.length, "");
  if (!doc) {
    const code = lib.FPDF_GetLastError();
    free(dataPtr);
    if (code === ERR_PASSWORD) throw new DataServerError(`the PDF is password-protected: ${path}`, "password_protected");
    throw new DataServerError(`PDFium cannot open ${path} as a PDF (error ${code})`, "not_pdf");
  }
  try {
    const pageCount = lib.FPDF_GetPageCount(doc);
    const [first, last] = pageRange(args.pages, pageCount);
    const renderDir = mkdtempSync(join(tmpdir(), "probanda-pages-"));
    const pages: PageImagesResult["pages"] = [];
    for (let n = first; n <= last; n++) {
      const page = lib.FPDF_LoadPage(doc, n - 1);
      try {
        if (!isScanned(lib, page)) {
          pages.push({ page: n, kind: "born_digital" });
          continue;
        }
        const dpi = args.tiles ? TILE_DPI : DPI;
        const width = Math.round((lib.FPDF_GetPageWidthF(page) * dpi) / 72);
        const height = Math.round((lib.FPDF_GetPageHeightF(page) * dpi) / 72);
        const tiles = tileRows(width, height, args.tiles ? 2 : undefined);
        const images = tiles.map(([top, rows], i) => {
          const png = renderPng(lib, page, width, height, top, rows);
          const name = tiles.length === 1 ? pageName(n) : `${pageName(n)}-tile-${i + 1}`;
          const file = join(renderDir, `${name}.png`);
          writeFileSync(file, png);
          const image: PageImage = { path: file, sha256: createHash("sha256").update(png).digest("hex"), width, height: rows };
          if (tiles.length > 1) image.tile = i + 1;
          return image;
        });
        pages.push({ page: n, kind: "scanned", images });
      } finally {
        lib.FPDF_ClosePage(page);
      }
    }
    return {
      source_sha256: createHash("sha256").update(data).digest("hex"),
      page_count: pageCount,
      render_dir: renderDir,
      pages,
    };
  } finally {
    lib.FPDF_CloseDocument(doc);
    free(dataPtr);
  }
}

function pageName(n: number): string {
  return `page-${String(n).padStart(4, "0")}`;
}

function pageRange(pages: string | undefined, pageCount: number): [number, number] {
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

/** [top row, row count] of each tile: `count` equal tiles, or as few as keep each under MAX_PIXELS. */
function tileRows(width: number, height: number, count?: number): Array<[number, number]> {
  let n = count ?? Math.max(1, Math.ceil((width * height) / MAX_PIXELS));
  while (count === undefined && width * Math.ceil(height / n) > MAX_PIXELS) n++;
  const rows = Math.ceil(height / n);
  const tiles: Array<[number, number]> = [];
  for (let top = 0; top < height; top += rows) tiles.push([top, Math.min(rows, height - top)]);
  return tiles;
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

/** Scanned: images cover at least half the page box (on a 100x100 grid), and no text object on the
 * page is visible. Form XObjects are walked, since scanners sometimes wrap the page image in one. */
function isScanned(lib: WrappedPdfiumModule, page: number): boolean {
  const m = lib.pdfium;
  const floats = m.wasmExports.malloc(24);
  const read = (count: number) => Array.from({ length: count }, (_, i) => m.getValue(floats + 4 * i, "float"));
  const images: Rect[] = [];
  let visibleText = false;
  let box: number[];
  try {
    lib.FPDF_GetPageBoundingBox(page, floats);
    box = read(4); // left, top, right, bottom
    const walk = (count: number, objectAt: (i: number) => number, matrix: Matrix): void => {
      for (let i = 0; i < count && !visibleText; i++) {
        const obj = objectAt(i);
        const type = lib.FPDFPageObj_GetType(obj);
        if (type === OBJ_TEXT) {
          if (lib.FPDFTextObj_GetTextRenderMode(obj) !== TEXT_INVISIBLE) visibleText = true;
        } else if (type === OBJ_IMAGE) {
          lib.FPDFPageObj_GetBounds(obj, floats, floats + 4, floats + 8, floats + 12);
          images.push(transform(matrix, read(4) as Rect));
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
  if (visibleText || images.length === 0) return false;

  const [left, top, right, bottom] = box;
  const width = right - left;
  const height = top - bottom;
  if (width <= 0 || height <= 0) return false;
  const N = 100;
  const grid = new Uint8Array(N * N);
  const cell = (v: number) => Math.min(N, Math.max(0, v));
  for (const [l, b, r, t] of images) {
    const x0 = cell(Math.floor(((l - left) / width) * N));
    const x1 = cell(Math.ceil(((r - left) / width) * N));
    const y0 = cell(Math.floor(((b - bottom) / height) * N));
    const y1 = cell(Math.ceil(((t - bottom) / height) * N));
    for (let y = y0; y < y1; y++) grid.fill(1, y * N + x0, y * N + x1);
  }
  return grid.reduce((sum, v) => sum + v, 0) * 2 >= N * N;
}

/** Rows [top, top + rows) of the page drawn at width x height pixels, as an RGB PNG on white, with
 * no annotations. */
function renderPng(lib: WrappedPdfiumModule, page: number, width: number, height: number, top: number, rows: number): Buffer {
  const bitmap = lib.FPDFBitmap_CreateEx(width, rows, BITMAP_BGR, 0, 0);
  if (!bitmap) throw new DataServerError(`PDFium could not allocate a ${width}x${rows} bitmap`, "renderer_unavailable");
  try {
    lib.FPDFBitmap_FillRect(bitmap, 0, 0, width, rows, 0xffffffff);
    lib.FPDF_RenderPageBitmap(bitmap, page, 0, -top, width, height, 0, 0);
    const buffer = lib.FPDFBitmap_GetBuffer(bitmap);
    const stride = lib.FPDFBitmap_GetStride(bitmap);
    const heap = heapU8(lib);
    const line = width * 3 + 1;
    const raw = Buffer.alloc(line * rows); // each row: filter byte 0, then R G B per pixel
    for (let y = 0; y < rows; y++) {
      const src = buffer + y * stride;
      const dst = y * line + 1;
      for (let x = 0; x < width; x++) {
        raw[dst + 3 * x] = heap[src + 3 * x + 2];
        raw[dst + 3 * x + 1] = heap[src + 3 * x + 1];
        raw[dst + 3 * x + 2] = heap[src + 3 * x];
      }
    }
    const header = Buffer.alloc(13);
    header.writeUInt32BE(width, 0);
    header.writeUInt32BE(rows, 4);
    header[8] = 8; // bit depth
    header[9] = 2; // colour type RGB
    return Buffer.concat([PNG_SIGNATURE, chunk("IHDR", header), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
  } finally {
    lib.FPDFBitmap_Destroy(bitmap);
  }
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
