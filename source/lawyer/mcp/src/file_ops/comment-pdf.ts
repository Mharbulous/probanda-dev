// Host-side comment on a matter PDF, for matter-data's supersede-draft §6b: two copies of one court
// document that differ in meaning are both kept, and each gets a sticky note on every page where it
// differs from the other.
//
// The file must still hold the bytes the caller registered (`expect_sha256`), so a note never lands
// on a file whose stored hash no longer names it. The notes are added by an incremental save: the
// original bytes stay as they were, with the new objects appended, so a signature over them still
// verifies. The result is written beside the file and renamed over it, so a failure leaves the file
// unchanged. The caller re-points the stored hash to `new_sha256`.

import { createHash } from "node:crypto";
import { existsSync, realpathSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { win32 as pathWin32 } from "node:path";
import type { WrappedPdfiumModule } from "@embedpdf/pdfium";

import { DataServerError, ValidationError } from "../errors.js";
import { DEFAULT_WASM, withPage, withPdf } from "../files/extract/page-images.js";
import { validateMatterRoot } from "../files/matter-root.js";
import { zoneProblem } from "../files/zones.js";
import { relativeInside } from "./move.js";

// FPDF_ANNOT_TEXT (fpdf_annot.h) and FPDF_INCREMENTAL (fpdf_save.h).
const ANNOT_TEXT = 1;
const INCREMENTAL = 1;
// Each note's icon, in points: NOTE square, MARGIN from the page's top-left, the next one STEP lower.
const NOTE = 20;
const MARGIN = 10;
const STEP = 24;

export interface CommentPdfResult {
  path: string;
  old_sha256: string;
  new_sha256: string;
  comments: number;
}

export async function fileOpsCommentPdf(
  matterRoot: string,
  path: string,
  expectSha256: string,
  comments: Array<{ page: number; text: string }>,
  wasm: URL = DEFAULT_WASM
): Promise<CommentPdfResult> {
  const root = validateMatterRoot(matterRoot);
  if (typeof path !== "string" || !pathWin32.isAbsolute(path)) {
    throw new DataServerError(`path must be an absolute host path: ${path}`, "invalid_path");
  }
  if (!/^[0-9a-f]{64}$/.test(expectSha256)) throw new ValidationError("expect_sha256 must be a lowercase SHA-256");
  if (!Array.isArray(comments) || comments.length === 0) throw new ValidationError("comments must name at least one comment");
  for (const c of comments) {
    if (!Number.isInteger(c?.page) || c.page < 1 || typeof c.text !== "string" || !c.text.trim()) {
      throw new ValidationError("each comment is {page: a page number from 1, text: non-empty}");
    }
  }
  if (!existsSync(path)) throw new DataServerError(`no file at ${path}`, "not_found");
  const file = realpathSync.native(path);
  relativeInside(root, file, "path");
  if (zoneProblem("move-from", file, root)) {
    throw new DataServerError(`path is protected (the matter pointer, TRASH, 0. CASE DATA, or a privileged/disclosed tree): ${file}`, "protected");
  }

  const bytes = await withPdf(file, wasm, async (lib, doc, data) => {
    const oldSha = sha256(data);
    if (oldSha !== expectSha256) {
      throw new DataServerError(`the file's SHA-256 is ${oldSha}, not ${expectSha256}; nothing was written: ${file}`, "hash_mismatch");
    }
    const pageCount = lib.FPDF_GetPageCount(doc);
    const late = comments.find((c) => c.page > pageCount);
    if (late) throw new DataServerError(`page ${late.page} is past the file's ${pageCount} pages`, "bad_pages");
    const onPage = new Map<number, number>();
    for (const { page: n, text } of comments) {
      const slot = onPage.get(n) ?? 0;
      onPage.set(n, slot + 1);
      withPage(lib, doc, n, (page) => addNote(lib, page, n, slot, text));
    }
    return save(lib, doc);
  });

  const temp = pathWin32.join(pathWin32.dirname(file), `.${pathWin32.basename(file)}.comment-tmp`);
  writeFileSync(temp, bytes, { flag: "wx" });
  try {
    renameSync(temp, file);
  } catch (err) {
    unlinkSync(temp);
    throw err;
  }
  return { path: file, old_sha256: expectSha256, new_sha256: sha256(bytes), comments: comments.length };
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function heapU8(lib: WrappedPdfiumModule): Uint8Array {
  return (lib.pdfium as unknown as { HEAPU8: Uint8Array }).HEAPU8;
}

/** A Text annotation (a sticky note) holding `text`, the `slot`th on page `n`, down from its top-left. */
function addNote(lib: WrappedPdfiumModule, page: number, n: number, slot: number, text: string): void {
  const m = lib.pdfium;
  const annot = lib.FPDFPage_CreateAnnot(page, ANNOT_TEXT);
  if (!annot) throw new DataServerError(`PDFium cannot add a comment to page ${n}`, "bad_pages");
  const top = lib.FPDF_GetPageHeightF(page) - MARGIN - slot * STEP;
  // FS_RECTF: left, top, right, bottom. The text is a UTF-16LE FPDF_WIDESTRING.
  const rect = m.wasmExports.malloc(16);
  const wide = Buffer.from(`${text}\0`, "utf16le");
  const str = m.wasmExports.malloc(wide.length);
  try {
    [MARGIN, top, MARGIN + NOTE, top - NOTE].forEach((v, i) => m.setValue(rect + 4 * i, v, "float"));
    heapU8(lib).set(wide, str);
    if (!lib.FPDFAnnot_SetRect(annot, rect) || !lib.FPDFAnnot_SetStringValue(annot, "Contents", str)) {
      throw new DataServerError(`PDFium cannot write the comment on page ${n}`, "bad_pages");
    }
  } finally {
    m.wasmExports.free(rect);
    m.wasmExports.free(str);
    lib.FPDFPage_CloseAnnot(annot);
  }
}

/** The document saved incrementally: its original bytes, then the changed objects. */
function save(lib: WrappedPdfiumModule, doc: number): Buffer {
  const writer = lib.PDFiumExt_OpenFileWriter();
  try {
    if (!lib.FPDF_SaveAsCopy(doc, writer, INCREMENTAL)) throw new DataServerError("PDFium could not save the commented PDF", "save_failed");
    const size = lib.PDFiumExt_GetFileWriterSize(writer);
    const out = lib.pdfium.wasmExports.malloc(size);
    try {
      lib.PDFiumExt_GetFileWriterData(writer, out, size);
      return Buffer.from(heapU8(lib).slice(out, out + size));
    } finally {
      lib.pdfium.wasmExports.free(out);
    }
  } finally {
    lib.PDFiumExt_CloseFileWriter(writer);
  }
}
