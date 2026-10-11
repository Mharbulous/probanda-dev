// PDF text-layer extraction inside the server, with no host Python package: pdf.js (pdfjs-dist,
// Apache-2.0), its minified legacy build, inlined into the bundle by esbuild. The worker module is
// imported too, which registers it on globalThis so pdf.js runs its worker in this thread; nothing
// is read from disk but the PDF itself, and nothing touches the network. No OCR: a scanned page
// comes back with little or no text, and the caller decides what that means.
//
// stdout carries this server's MCP JSON-RPC stream, and pdf.js prints its warnings with
// console.log (a burst of them on first load, about the absent optional canvas package). Every
// pdf.js call therefore runs with console.log pointed at stderr, and loads lazily, on the first PDF.

import { readFileSync } from "node:fs";

type PdfJs = typeof import("pdfjs-dist/legacy/build/pdf.min.mjs");

let pdfjs: Promise<PdfJs> | undefined;
let quietDepth = 0;
let savedLog: typeof console.log = console.log;

async function quietStdout<T>(fn: () => Promise<T>): Promise<T> {
  if (quietDepth++ === 0) {
    savedLog = console.log;
    console.log = console.error;
  }
  try {
    return await fn();
  } finally {
    if (--quietDepth === 0) console.log = savedLog;
  }
}

// pdf.js's display layer builds a DOMMatrix at load for canvas rendering, which Node lacks and this
// server never does. Text comes from the worker module, which never touches DOMMatrix, so an empty
// placeholder stands in for the load only and is removed after it.
function loadPdfJs(): Promise<PdfJs> {
  pdfjs ??= (async () => {
    const g = globalThis as { DOMMatrix?: unknown };
    const stubbed = g.DOMMatrix === undefined;
    if (stubbed) g.DOMMatrix = class {};
    try {
      await import("pdfjs-dist/legacy/build/pdf.worker.min.mjs");
      return await import("pdfjs-dist/legacy/build/pdf.min.mjs");
    } finally {
      if (stubbed) delete g.DOMMatrix;
    }
  })();
  return pdfjs;
}

/** Thrown when pdf.js itself cannot load; the caller reports `extractor_unavailable`. */
export class PdfExtractorUnavailable extends Error {}

/** The text of each page of the PDF at `path`, in page order. Throws on an unreadable file. */
export async function pdfPages(path: string): Promise<string[]> {
  const data = new Uint8Array(readFileSync(path));
  if (data.length === 0) throw new Error("file is empty (0 bytes)");
  return quietStdout(async () => {
    let lib: PdfJs;
    try {
      lib = await loadPdfJs();
    } catch (err) {
      throw new PdfExtractorUnavailable(`pdf.js did not load: ${(err as Error).message}`);
    }
    let doc;
    try {
      doc = await lib.getDocument({
        data,
        verbosity: lib.VerbosityLevel.ERRORS,
        isEvalSupported: false,
        disableFontFace: true,
        useSystemFonts: false,
        stopAtErrors: false,
      }).promise;
    } catch (err) {
      if ((err as Error).name === "PasswordException") throw new Error("password-protected");
      throw err;
    }
    try {
      const pages: string[] = [];
      for (let n = 1; n <= doc.numPages; n++) {
        const page = await doc.getPage(n);
        const content = await page.getTextContent();
        let text = "";
        for (const item of content.items) {
          if (!("str" in item)) continue;
          text += item.str;
          if (item.hasEOL) text += "\n";
        }
        pages.push(text);
        page.cleanup();
      }
      return pages;
    } finally {
      await doc.destroy();
    }
  });
}
