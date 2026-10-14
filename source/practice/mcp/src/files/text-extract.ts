// The text of one host file, read inside this server with no host Python and no host package:
// the one entry point for any tool that needs a file's words (research_filing__law_folder_text
// today). Reads only the named file; never writes, never touches the network, runs no OCR.
//
//   extractText(path) -> { status: "ok", kind, method, text, pages }
//                      | { status: "unread", reason }
//
// `kind` is pdf | docx | doc | text. `method` is "text" for an extracted document and "copy" for a
// file already in text form. `pages` is a PDF's page count; null otherwise. PDF pages are joined
// with "\n\f\n". `reason` always opens with one of five codes, so a caller can branch on the prefix:
//   ocr_unavailable        a PDF under SCANNED_BYTES_PER_PAGE bytes of text per page: likely scanned
//   unsupported_type       an extension with no reader, or a Word 6/95 .doc
//   unreadable             the reader failed on this file (corrupt, password-protected, ...)
//   extractor_unavailable  the bundled PDF reader itself could not load
//   no_text                the file read cleanly and holds no text
// A caller reports an unread file as UNREAD with its reason, never as absent.
//
// The pre-filing gate keeps its own path (src/submission/pre-filing/extract.ts), which needs PDF
// page counts from pypdf and treats pypdf's absence as a hard stop.

import { readFileSync } from "node:fs";
import { win32 as pathWin32 } from "node:path";

import { docText, DocUnsupported } from "./extract/doc.js";
import { docxText } from "./extract/docx.js";
import { pdfPages, PdfExtractorUnavailable } from "./extract/pdf.js";

// A PDF with less text than this per page is taken as scanned (Brahm's decision, 2026-10-05). No OCR
// runs, so it is reported unread rather than as a near-empty decision.
export const SCANNED_BYTES_PER_PAGE = 500;
export const EXTRACTED_EXTENSIONS = new Set([".pdf", ".docx", ".doc"]);
export const COPIED_EXTENSIONS = new Set([".txt", ".md", ".json", ".htm", ".html"]);

export type TextExtraction =
  | { status: "ok"; kind: "pdf" | "docx" | "doc" | "text"; method: "text" | "copy"; text: string; pages: number | null }
  | { status: "unread"; reason: string };

const unread = (reason: string): TextExtraction => ({ status: "unread", reason });

export async function extractText(path: string): Promise<TextExtraction> {
  const ext = pathWin32.extname(path).toLowerCase();
  let result: TextExtraction;
  try {
    if (COPIED_EXTENSIONS.has(ext)) {
      result = { status: "ok", kind: "text", method: "copy", text: readFileSync(path, "utf-8"), pages: null };
    } else if (ext === ".pdf") {
      const pages = await pdfPages(path);
      const text = pages.join("\n\f\n");
      const bytes = Buffer.byteLength(text.trim(), "utf-8");
      if (bytes < SCANNED_BYTES_PER_PAGE * Math.max(pages.length, 1)) {
        return unread(
          `ocr_unavailable: ${bytes} bytes of text over ${pages.length} page(s), under ${SCANNED_BYTES_PER_PAGE} per page, so likely scanned`
        );
      }
      result = { status: "ok", kind: "pdf", method: "text", text, pages: pages.length };
    } else if (ext === ".docx") {
      result = { status: "ok", kind: "docx", method: "text", text: docxText(path), pages: null };
    } else if (ext === ".doc") {
      result = { status: "ok", kind: "doc", method: "text", text: docText(path), pages: null };
    } else {
      return unread(`unsupported_type: ${ext || "no extension"}`);
    }
  } catch (err) {
    if (err instanceof PdfExtractorUnavailable) return unread(`extractor_unavailable: ${err.message}`);
    if (err instanceof DocUnsupported) return unread(`unsupported_type: ${err.message}`);
    return unread(`unreadable: ${(err as Error).message}`);
  }
  if (result.text.trim() === "") return unread("no_text: the file holds no text");
  return result;
}
