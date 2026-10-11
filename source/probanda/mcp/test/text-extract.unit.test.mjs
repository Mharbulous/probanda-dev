// extractText (src/files/text-extract.ts): one file's text, read in the server with no host Python.
// Every fixture is synthetic (test/helpers/synthetic-docs.mjs), placeholder text only. Run after tsc.

import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";

import { docBytes, docxBytes, pdfBytes } from "./helpers/synthetic-docs.mjs";

const { extractText } = await import("../build/files/text-extract.js");

const DIR = mkdtempSync(join(tmpdir(), "coclerk-text-extract-"));
after(() => rmSync(DIR, { recursive: true, force: true }));

function file(name, bytes) {
  const path = join(DIR, name);
  writeFileSync(path, bytes);
  return path;
}

const LINES = Array.from({ length: 40 }, (_, i) => `Placeholder line ${String(i).padStart(2, "0")} of the text layer.`).join("\n");

test("a text-layer PDF reads page by page, with no host Python", async () => {
  const saved = process.env.COCLERK_PYTHON;
  process.env.COCLERK_PYTHON = join(DIR, "no-such-python.exe");
  try {
    const got = await extractText(file("plain.pdf", pdfBytes([LINES, LINES])));
    assert.equal(got.status, "ok");
    assert.equal(got.kind, "pdf");
    assert.equal(got.method, "text");
    assert.equal(got.pages, 2);
    const [first, second] = got.text.split("\n\f\n");
    assert.match(first, /^Placeholder line 00 of the text layer\.\nPlaceholder line 01/);
    assert.match(second, /Placeholder line 39 of the text layer\./);
  } finally {
    if (saved === undefined) delete process.env.COCLERK_PYTHON;
    else process.env.COCLERK_PYTHON = saved;
  }
});

test("a PDF with compressed content streams reads the same", async () => {
  const got = await extractText(file("deflated.pdf", pdfBytes([LINES], { compress: true })));
  assert.equal(got.status, "ok");
  assert.match(got.text, /Placeholder line 20 of the text layer\./);
});

test("a PDF with almost no text is ocr_unavailable", async () => {
  const got = await extractText(file("scanned.pdf", pdfBytes(["Page 1"])));
  assert.equal(got.status, "unread");
  assert.match(got.reason, /^ocr_unavailable: \d+ bytes of text over 1 page\(s\), under 500 per page/);
});

test("a corrupt or empty PDF is unreadable", async () => {
  assert.match((await extractText(file("garbage.pdf", "not a pdf at all"))).reason, /^unreadable: /);
  assert.match((await extractText(file("empty.pdf", ""))).reason, /^unreadable: file is empty/);
});

test("a .docx reads one line per paragraph", async () => {
  const got = await extractText(file("memo.docx", docxBytes("Placeholder memo heading\nPlaceholder & body <one>.")));
  assert.deepEqual(got, {
    status: "ok",
    kind: "docx",
    method: "text",
    text: "Placeholder memo heading\nPlaceholder & body <one>.\n",
    pages: null,
  });
  assert.match((await extractText(file("broken.docx", "not a zip"))).reason, /^unreadable: not a zip file/);
});

test("a Word 97-2003 .doc reads cp1252 and UTF-16 pieces, dropping field codes", async () => {
  const doc = docBytes(
    [
      { text: "Placeholder heading\rPlaceholder \x93quoted\x94 body\r", unicode: false },
      { text: "Café — \x13 HYPERLINK \"x\" \x14link text\x15 end\x07cell\x07\r", unicode: true },
      { text: "Placeholder footnote\r", unicode: false },
    ],
    { ccpFtn: "Placeholder footnote\r".length }
  );
  const got = await extractText(file("decision.doc", doc));
  assert.equal(got.status, "ok", got.reason);
  assert.equal(got.kind, "doc");
  assert.equal(
    got.text,
    "Placeholder heading\nPlaceholder “quoted” body\nCafé — link text end\tcell\t\n\nPlaceholder footnote\n"
  );
});

test("a .doc it cannot read is unread with a named reason", async () => {
  const word6 = await extractText(file("old.doc", docBytes([{ text: "Placeholder\r", unicode: false }], { nFib: 0x65 })));
  assert.equal(word6.reason, "unsupported_type: .doc (Word 6/95 format, nFib 101)");
  const locked = await extractText(file("locked.doc", docBytes([{ text: "Placeholder\r", unicode: false }], { encrypted: true })));
  assert.equal(locked.reason, "unreadable: password-protected");
  const junk = await extractText(file("junk.doc", "not a zip"));
  assert.match(junk.reason, /^unreadable: not a Word 97-2003 file/);
});

test("text types are copied, other types unsupported, blank files no_text", async () => {
  assert.deepEqual(await extractText(file("notes.txt", "Placeholder notes.\n")), {
    status: "ok",
    kind: "text",
    method: "copy",
    text: "Placeholder notes.\n",
    pages: null,
  });
  assert.equal((await extractText(file("brief.rtf", "{\\rtf1 x}"))).reason, "unsupported_type: .rtf");
  assert.equal((await extractText(file("README", "x"))).reason, "unsupported_type: no extension");
  assert.equal((await extractText(file("blank.md", "  \n"))).reason, "no_text: the file holds no text");
});
