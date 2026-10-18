// Text extraction for the pre-filing consistency gate (issue #615). The only
// document-parsing path in this runtime: one host Python call per tool call,
// following backend.ts's sqlite3 shell-out precedent. PDF text and page counts
// come from pypdf -- a host package, not vendored here, and its absence is a
// hard error (never a silent pass). DOCX text comes from the standard library
// (zipfile + word/document.xml). Nothing here writes to any file it reads.

import { join } from "node:path";

import { ValidationError } from "../../errors.js";
import { pythonDriverFile } from "../../python-driver.js";
import { runPythonDriver } from "../../python-spawn.js";
import { pythonTimeoutMs, READ_TIMEOUT_MS } from "../backend.js";

export type ExtractedKind = "pdf" | "docx" | "other";

export interface ExtractedDocument {
  path: string;
  file_name: string;
  kind: ExtractedKind;
  /** PDF page count; 1 for a readable DOCX; null when unreadable or not a document. */
  pages: number | null;
  /** One entry per page (PDF) or one entry for the whole body (DOCX); null when unreadable. */
  text_by_page: string[] | null;
  /** Set when the file could not be read; the check that needs it reports the error verbatim. */
  error?: string;
}

const PY_HELPER = String.raw`
import json, os, re, sys, zipfile

def docx_text(path):
    with zipfile.ZipFile(path) as z:
        xml = z.read("word/document.xml").decode("utf-8", "replace")
    xml = re.sub(r"<w:tab/>", "\t", xml)
    xml = re.sub(r"</w:p>", "\n", xml)
    xml = re.sub(r"<w:br[^>]*/>", "\n", xml)
    text = re.sub(r"<[^>]+>", "", xml)
    text = text.replace("&amp;", "&").replace("&lt;", "<").replace("&gt;", ">").replace("&quot;", '"').replace("&apos;", "'")
    return text

def main():
    req = json.loads(sys.stdin.read())
    out = []
    reader_cls = None
    for path in req["paths"]:
        name = os.path.basename(path)
        ext = os.path.splitext(name)[1].lower()
        entry = {"path": path, "file_name": name, "kind": "other", "pages": None, "text_by_page": None}
        try:
            if ext == ".pdf":
                entry["kind"] = "pdf"
                if reader_cls is None:
                    if os.environ.get("COCLERK_PREFILING_FORCE_NO_PYPDF") == "1":
                        raise ImportError("forced by COCLERK_PREFILING_FORCE_NO_PYPDF")
                    from pypdf import PdfReader
                    reader_cls = PdfReader
                if os.path.getsize(path) == 0:
                    raise ValueError("file is empty (0 bytes)")
                reader = reader_cls(path)
                pages = [(p.extract_text() or "") for p in reader.pages]
                entry["pages"] = len(pages)
                entry["text_by_page"] = pages
            elif ext == ".docx":
                entry["kind"] = "docx"
                entry["pages"] = 1
                entry["text_by_page"] = [docx_text(path)]
        except ImportError as e:
            print(json.dumps({"fatal": "pypdf is not installed for " + sys.executable + " (" + str(e) + "): pip install pypdf"}))
            return
        except Exception as e:
            entry["error"] = type(e).__name__ + ": " + str(e)
        out.append(entry)
    print(json.dumps({"documents": out}))

main()
`.trim();

function helperFile(): string {
  return pythonDriverFile("prefiling-extract", PY_HELPER);
}

/** Extracts text and page counts for every path, in the order given. One interpreter start per call. */
export function extractDocuments(paths: string[]): ExtractedDocument[] {
  if (paths.length === 0) return [];
  const payload = JSON.stringify({ paths });
  const out = runPythonDriver({
    label: "pre-filing text extraction",
    driver: helperFile(),
    payload,
    env: process.env,
    timeoutMs: pythonTimeoutMs(process.env, READ_TIMEOUT_MS),
  }) as { fatal?: string; documents?: ExtractedDocument[] };
  if (out.fatal) throw new ValidationError(out.fatal);
  return out.documents ?? [];
}
