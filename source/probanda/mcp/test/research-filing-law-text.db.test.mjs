// research_filing__law_folder_text: the text of a `6. LAW` folder written to the research agent's
// scratchpad, with any file it cannot read reported unread. Every fixture is synthetic
// (test/helpers/synthetic-docs.mjs), placeholder text only, built and read with no host Python.
// The extractor itself is covered file type by file type in text-extract.unit.test.mjs. Run after tsc.

import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { docBytes, docxBytes, pdfBytes } from "./helpers/synthetic-docs.mjs";

const { lawFolderText } = await import("../build/files/research-filing.js");

// Forty lines of 40 characters: about 1,600 bytes on one page, well over the scanned threshold.
const LINES = Array.from({ length: 40 }, (_, i) => `Placeholder line ${String(i).padStart(2, "0")} of the text layer.`).join("\n");

/** An initialized matter with a 0. DRAFT folder and one 6. LAW issue folder of mixed files. */
function fixture() {
  const matter = mkdtempSync(join(tmpdir(), "coclerk-lawtext-matter-"));
  writeFileSync(join(matter, "coclerk.json"), "{}\n");
  mkdirSync(join(matter, "0. DRAFT"));
  const law = join(matter, "6. LAW", "Issue");
  mkdirSync(join(law, "nested"), { recursive: true });
  writeFileSync(join(law, "decision.pdf"), pdfBytes([LINES, LINES]));
  // The spec's low-text fixture: a page whose text layer is a few bytes, as a scanned decision's is.
  writeFileSync(join(law, "scanned.pdf"), pdfBytes(["Page 1"]));
  writeFileSync(join(law, "memo.docx"), docxBytes("Placeholder memo heading\nPlaceholder memo body."));
  writeFileSync(join(law, "older.doc"), docBytes([{ text: "Placeholder older decision\rPlaceholder reasons.\r", unicode: false }]));
  writeFileSync(join(law, "notes.txt"), "Placeholder notes.\n");
  writeFileSync(join(law, "broken.doc"), "not a zip");
  writeFileSync(join(law, "empty.md"), "  \n");
  writeFileSync(join(law, "nested", "inner.txt"), "not listed\n");
  return { matter, law, cleanup: () => rmSync(matter, { recursive: true, force: true }) };
}

async function codeOf(fn) {
  try {
    await fn();
  } catch (err) {
    return err.code;
  }
  throw new Error("expected a throw, got none");
}

const TEXT_FILES = ["decision.pdf.txt", "memo.docx.txt", "notes.txt.txt", "older.doc.txt"];

test("law_folder_text writes each readable file's text to the scratchpad and flags the rest unread", async () => {
  const f = fixture();
  try {
    const before = readdirSync(f.law).sort();
    const result = await lawFolderText(f.matter, f.law);
    const outDir = join(f.matter, "0. DRAFT", "AI Scratchpad", "research-agent", "law-text", "Issue");
    assert.equal(result.out_dir.toLowerCase(), outDir.toLowerCase());
    const rows = Object.fromEntries(result.files.map((row) => [row.file, row]));
    assert.deepEqual(Object.keys(rows), [
      "broken.doc",
      "decision.pdf",
      "empty.md",
      "memo.docx",
      "notes.txt",
      "older.doc",
      "scanned.pdf",
    ]);

    assert.equal(rows["decision.pdf"].status, "ok");
    assert.equal(rows["decision.pdf"].method, "text");
    const decision = readFileSync(rows["decision.pdf"].text_path, "utf-8");
    assert.match(decision, /Placeholder line 39 of the text layer/);
    assert.equal(rows["decision.pdf"].bytes, Buffer.byteLength(decision, "utf-8"));
    assert.equal(rows["memo.docx"].method, "text");
    assert.match(readFileSync(rows["memo.docx"].text_path, "utf-8"), /Placeholder memo body/);
    assert.equal(rows["older.doc"].method, "text");
    assert.equal(readFileSync(rows["older.doc"].text_path, "utf-8"), "Placeholder older decision\nPlaceholder reasons.\n");
    assert.equal(rows["notes.txt"].method, "copy");
    assert.equal(readFileSync(rows["notes.txt"].text_path, "utf-8"), "Placeholder notes.\n");

    // A scanned PDF is never a few-byte ok, and gets no text file an agent could mistake for it.
    assert.equal(rows["scanned.pdf"].status, "unread");
    assert.equal(rows["scanned.pdf"].text_path, null);
    assert.match(rows["scanned.pdf"].reason, /^ocr_unavailable: \d+ bytes of text over 1 page/);
    assert.match(rows["broken.doc"].reason, /^unreadable: not a Word 97-2003 file/);
    assert.match(rows["empty.md"].reason, /^no_text/);
    assert.deepEqual(readdirSync(outDir).sort(), TEXT_FILES);

    // The 6. LAW folder is only read.
    assert.deepEqual(readdirSync(f.law).sort(), before);

    // A second call replaces its own text files rather than versioning them.
    await lawFolderText(f.matter, f.law);
    assert.deepEqual(readdirSync(outDir).sort(), TEXT_FILES);
  } finally {
    f.cleanup();
  }
});

test("law_folder_text reads PDF, .docx and .doc with no host Python at all", async () => {
  const f = fixture();
  const saved = process.env.COCLERK_PYTHON;
  process.env.COCLERK_PYTHON = join(f.matter, "no-such-python.exe");
  process.env.COCLERK_PREFILING_FORCE_NO_PYPDF = "1";
  try {
    const rows = Object.fromEntries((await lawFolderText(f.matter, f.law)).files.map((row) => [row.file, row]));
    for (const file of ["decision.pdf", "memo.docx", "older.doc"]) assert.equal(rows[file].status, "ok", rows[file].reason);
    assert.match(rows["scanned.pdf"].reason, /^ocr_unavailable: /);
  } finally {
    if (saved === undefined) delete process.env.COCLERK_PYTHON;
    else process.env.COCLERK_PYTHON = saved;
    delete process.env.COCLERK_PREFILING_FORCE_NO_PYPDF;
    f.cleanup();
  }
});

test("law_folder_text refuses, writing nothing, outside the matter's 6. LAW tree", async () => {
  const f = fixture();
  const other = fixture();
  try {
    assert.equal(await codeOf(() => lawFolderText(f.matter, other.law)), "not_in_matter");
    assert.equal(await codeOf(() => lawFolderText(f.matter, join(f.matter, "0. DRAFT"))), "not_law_folder");
    assert.equal(await codeOf(() => lawFolderText(f.matter, "6. LAW/Issue")), "invalid_path");
    assert.equal(await codeOf(() => lawFolderText(f.law, f.law)), "invalid_root");
    rmSync(join(f.matter, "0. DRAFT"), { recursive: true });
    assert.equal(await codeOf(() => lawFolderText(f.matter, f.law)), "draft_dir_missing");
    assert.equal(existsSync(join(other.matter, "0. DRAFT", "AI Scratchpad")), false);
  } finally {
    f.cleanup();
    other.cleanup();
  }
});
