// pdf_pages__compare: compares two PDFs page by page (an original and a flattened, converted or
// returned copy) and clears each page whose every check matches, so only the pages that differ need
// a person's or a model's eye. Pages are paired by number. Each page of both files is drawn at the
// same dpi as pdf_pages__images, with its annotations and form fields (a flattened copy carries them
// in its page content, so drawing them is what makes the two comparable, and a field value lost in
// flattening shows), and its raw pixels are hashed. PNGs are written only for pages that differ to
// the eye, in the caller's destination_dir (the folder the session uses for pdf_pages__images), in its
// subfolder named for the two PDFs' hashes, never beside either PDF and never in the OS temp directory.

import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import type { WrappedPdfiumModule } from "@embedpdf/pdfium";

import { DataServerError, ValidationError } from "../../errors.js";

import {
  DEFAULT_WASM,
  DPI,
  OBJ_FORM,
  OBJ_IMAGE,
  encodePng,
  nextTurn,
  pageName,
  pageRange,
  pageSize,
  renderRgb,
  tileRows,
  withPage,
  withPdf,
} from "./page-images.js";

// FPDF_ANNOT (fpdfview.h): draw annotations' appearance streams.
const FPDF_ANNOT = 0x01;
// The most pages one review group holds.
const GROUP_MAX = 5;

/** A difference a person could see on the page; the rest (`text`, `images`) only a reader of the
 * file's internals could. */
const VISUAL = new Set(["only_in_a", "only_in_b", "size", "rotation", "render"]);

export type Reason = "only_in_a" | "only_in_b" | "size" | "rotation" | "render" | "text" | "images";

export interface FlaggedPage {
  page: number;
  reasons: Reason[];
  changed_share?: number;
  a?: string[];
  b?: string[];
}

export interface CompareResult {
  pages_a: number;
  pages_b: number;
  cleared: string[];
  flagged: FlaggedPage[];
  review_groups: number[][];
  work_dir: string | null;
}

interface PageFacts {
  // Width and height in points as the page lies before /Rotate, rounded to 0.01.
  size: string;
  rotation: number;
  width: number;
  height: number;
  rgb: Buffer;
  render: string;
  text: string;
  images: string;
}

const sha256 = (data: Buffer | string) => createHash("sha256").update(data).digest("hex");

export async function pdfPagesCompare(
  args: { a: string; b: string; pages?: string; destination_dir: string },
  wasm: URL = DEFAULT_WASM
): Promise<CompareResult> {
  if (typeof args.destination_dir !== "string" || !isAbsolute(args.destination_dir)) {
    throw new ValidationError(`destination_dir must be absolute: ${args.destination_dir}`);
  }
  return withPdf(args.a, wasm, (lib, docA, dataA) =>
    withPdf(args.b, wasm, async (_, docB, dataB) => {
      const formA = openForm(lib, docA);
      let formB: FormEnv;
      try {
        formB = openForm(lib, docB);
      } catch (err) {
        closeForm(lib, formA);
        throw err;
      }
      try {
        const pagesA = lib.FPDF_GetPageCount(docA);
        const pagesB = lib.FPDF_GetPageCount(docB);
        const [first, last] = pageRange(args.pages, Math.max(pagesA, pagesB));
        const clearedPages: number[] = [];
        const flagged: FlaggedPage[] = [];
        let workDir: string | null = null;
        const write = (side: "a" | "b", n: number, facts: PageFacts): string[] => {
          // One folder per pair, so a second compare overwrites the same bytes.
          workDir ??= join(args.destination_dir, `compare-${sha256(dataA).slice(0, 16)}-${sha256(dataB).slice(0, 16)}`);
          const dir = join(workDir, side);
          mkdirSync(dir, { recursive: true });
          const tiles = tileRows(facts.width, 0, facts.height);
          return tiles.map(([top, rows], i) => {
            const name = tiles.length === 1 ? pageName(n) : `${pageName(n)}-tile-${i + 1}`;
            const file = join(dir, `${name}.png`);
            const rgb = facts.rgb.subarray(top * facts.width * 3, (top + rows) * facts.width * 3);
            writeFileSync(file, encodePng(rgb, facts.width, rows));
            return file;
          });
        };
        for (let n = first; n <= last; n++) {
          if (n > first) await nextTurn();
          const a = n <= pagesA ? withPage(lib, docA, n, (page) => pageFacts(lib, page, n, formA.handle)) : null;
          if (a) await nextTurn();
          const b = n <= pagesB ? withPage(lib, docB, n, (page) => pageFacts(lib, page, n, formB.handle)) : null;
          const entry: FlaggedPage = { page: n, reasons: differences(a, b) };
          if (entry.reasons.length === 0) {
            clearedPages.push(n);
            continue;
          }
          if (a && b && a.width === b.width && a.height === b.height && a.render !== b.render) {
            entry.changed_share = changedShare(a.rgb, b.rgb);
          }
          if (entry.reasons.some((r) => VISUAL.has(r))) {
            if (a) entry.a = write("a", n, a);
            if (b) entry.b = write("b", n, b);
          }
          flagged.push(entry);
        }
        const visual = flagged.filter((f) => f.reasons.some((r) => VISUAL.has(r))).map((f) => f.page);
        return {
          pages_a: pagesA,
          pages_b: pagesB,
          cleared: ranges(clearedPages),
          flagged,
          review_groups: reviewGroups(visual),
          work_dir: workDir,
        };
      } finally {
        closeForm(lib, formB);
        closeForm(lib, formA);
      }
    })
  );
}

/** `pages` split over as few groups of at most `max` as hold them all, in order, with sizes that
 * differ by at most one: 16 pages make four groups of 4, not 5, 5, 5 and 1. */
export function reviewGroups(pages: number[], max = GROUP_MAX): number[][] {
  const count = Math.ceil(pages.length / max);
  const groups: number[][] = [];
  for (let g = 0, at = 0; g < count; g++) {
    const size = Math.floor(pages.length / count) + (g < pages.length % count ? 1 : 0);
    groups.push(pages.slice(at, (at += size)));
  }
  return groups;
}

/** Ascending page numbers as runs: [1, 2, 3, 5] is ["1-3", "5"]. */
function ranges(pages: number[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < pages.length; ) {
    let j = i;
    while (j + 1 < pages.length && pages[j + 1] === pages[j] + 1) j++;
    out.push(i === j ? `${pages[i]}` : `${pages[i]}-${pages[j]}`);
    i = j + 1;
  }
  return out;
}

function differences(a: PageFacts | null, b: PageFacts | null): Reason[] {
  if (!a) return ["only_in_b"];
  if (!b) return ["only_in_a"];
  const reasons: Reason[] = [];
  if (a.size !== b.size) reasons.push("size");
  if (a.rotation !== b.rotation) reasons.push("rotation");
  if (a.render !== b.render) reasons.push("render");
  if (a.text !== b.text) reasons.push("text");
  if (a.images !== b.images) reasons.push("images");
  return reasons;
}

/** The share of pixels whose colour differs between two renders of the same size, to 4 places. */
function changedShare(a: Buffer, b: Buffer): number {
  let changed = 0;
  for (let i = 0; i < a.length; i += 3) {
    if (a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2]) changed++;
  }
  return Math.round((changed / (a.length / 3)) * 10_000) / 10_000;
}

function pageFacts(lib: WrappedPdfiumModule, page: number, n: number, form: number): PageFacts {
  const rotation = lib.FPDFPage_GetRotation(page) * 90;
  const [w, h] = [lib.FPDF_GetPageWidthF(page), lib.FPDF_GetPageHeightF(page)];
  const [uw, uh] = rotation % 180 ? [h, w] : [w, h];
  const { width, height } = pageSize(lib, page, n, DPI);
  lib.FORM_OnAfterLoadPage(page, form);
  try {
    const rgb = renderRgb(lib, page, n, width, height, 0, height, FPDF_ANNOT, form);
    return {
      size: `${uw.toFixed(2)}x${uh.toFixed(2)}`,
      rotation,
      width,
      height,
      rgb,
      render: sha256(rgb),
      text: sha256(pageText(lib, page)),
      images: sha256(imageHashes(lib, page).join(",")),
    };
  } finally {
    lib.FORM_OnBeforeClosePage(page, form);
  }
}

/** The page's text layer, invisible text included, as PDFium extracts it. */
function pageText(lib: WrappedPdfiumModule, page: number): string {
  const textPage = lib.FPDFText_LoadPage(page);
  if (!textPage) return "";
  try {
    const count = lib.FPDFText_CountChars(textPage);
    if (count <= 0) return "";
    const bytes = (count + 1) * 2;
    const ptr = lib.pdfium.wasmExports.malloc(bytes);
    try {
      const written = lib.FPDFText_GetText(textPage, 0, count, ptr);
      const heap = (lib.pdfium as unknown as { HEAPU8: Uint8Array }).HEAPU8;
      // UTF-16LE, `written` code units including the terminating NUL.
      return Buffer.from(heap.subarray(ptr, ptr + Math.max(0, written - 1) * 2)).toString("utf16le");
    } finally {
      lib.pdfium.wasmExports.free(ptr);
    }
  } finally {
    lib.FPDFText_ClosePage(textPage);
  }
}

/** A hash of each image object's stored data, in drawing order, form XObjects walked. */
function imageHashes(lib: WrappedPdfiumModule, page: number): string[] {
  const hashes: string[] = [];
  const walk = (count: number, objectAt: (i: number) => number): void => {
    for (let i = 0; i < count; i++) {
      const obj = objectAt(i);
      const type = lib.FPDFPageObj_GetType(obj);
      if (type === OBJ_IMAGE) {
        const length = lib.FPDFImageObj_GetImageDataRaw(obj, 0, 0);
        const ptr = lib.pdfium.wasmExports.malloc(Math.max(length, 1));
        try {
          lib.FPDFImageObj_GetImageDataRaw(obj, ptr, length);
          const heap = (lib.pdfium as unknown as { HEAPU8: Uint8Array }).HEAPU8;
          hashes.push(sha256(Buffer.from(heap.subarray(ptr, ptr + length))));
        } finally {
          lib.pdfium.wasmExports.free(ptr);
        }
      } else if (type === OBJ_FORM) {
        walk(lib.FPDFFormObj_CountObjects(obj), (j) => lib.FPDFFormObj_GetObject(obj, j));
      }
    }
  };
  walk(lib.FPDFPage_CountObjects(page), (i) => lib.FPDFPage_GetObject(page, i));
  return hashes;
}

interface FormEnv {
  info: number;
  handle: number;
}

/** A form-fill environment for `doc`, so its form fields are drawn. Refused when PDFium gives none,
 * since a compare without them would clear a page whose field values were lost. */
function openForm(lib: WrappedPdfiumModule, doc: number): FormEnv {
  const info = lib.PDFiumExt_OpenFormFillInfo();
  const handle = info ? lib.PDFiumExt_InitFormFillEnvironment(doc, info) : 0;
  if (!handle) {
    if (info) lib.PDFiumExt_CloseFormFillInfo(info);
    throw new DataServerError("the PDF renderer could not draw this PDF's form fields", "renderer_unavailable");
  }
  return { info, handle };
}

function closeForm(lib: WrappedPdfiumModule, { info, handle }: FormEnv): void {
  lib.PDFiumExt_ExitFormFillEnvironment(handle);
  lib.PDFiumExt_CloseFormFillInfo(info);
}
