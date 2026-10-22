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

// The `file` and `pattern` inputs: one filed file searched inline, nothing written.

/** A 6. LAW folder of synthetic rules files, with a manifest line naming one of them. */
function rulesFixture() {
  const f = fixture();
  const rules = Array.from({ length: 30 }, (_, i) => `Rule ${i + 1} placeholder text.`);
  rules[11] = "Rule 12 placeholder subrule (3) on fixture service.";
  rules[13] = "Rule 14 placeholder text on fixture service.";
  writeFileSync(join(f.law, "Fixture Rules.md"), ["Fixture Rules", "Current to 2026-09-30", ...rules].join("\n") + "\n");
  writeFileSync(join(f.law, "Fixture Rules Schedule.txt"), "Schedule placeholder.\n");
  writeFileSync(join(f.law, "Fixture Act.html"), "<html><body>Fixture Act page</body></html>");
  writeFileSync(join(f.law, "Paged Act.html"), "<html><body>Paged Act page</body></html>");
  writeFileSync(join(f.law, "Paged Act.md"), "Paged Act\nSection 1 placeholder fixture service.\n");
  writeFileSync(
    join(f.law, "case-download-manifest.json"),
    JSON.stringify({ filename: "Fixture Rules.md", currency_marker: "current to September 30, 2026" }) + "\n"
  );
  return f;
}

const scratchOf = (matter) => join(matter, "0. DRAFT", "AI Scratchpad");

test("law_folder_text with file and pattern returns matching lines with context inline and writes nothing", async () => {
  const f = rulesFixture();
  try {
    const result = await lawFolderText(f.matter, f.law, { file: "Fixture Rules.md", pattern: "fixture service", context: 1 });
    assert.equal(result.out_dir, undefined);
    assert.deepEqual(result.searched, [
      {
        file: "Fixture Rules.md",
        status: "ok",
        head: ["Fixture Rules", "Current to 2026-09-30", "Rule 1 placeholder text.", "Rule 2 placeholder text.", "Rule 3 placeholder text."],
        manifest_marker: "current to September 30, 2026",
      },
    ]);
    // Rule 12 is line 14 and Rule 14 line 16: their one-line contexts touch, so they merge.
    assert.deepEqual(result.matches, [
      {
        file: "Fixture Rules.md",
        first: 13,
        last: 17,
        matched: [14, 16],
        text: [
          "Rule 11 placeholder text.",
          "Rule 12 placeholder subrule (3) on fixture service.",
          "Rule 13 placeholder text.",
          "Rule 14 placeholder text on fixture service.",
          "Rule 15 placeholder text.",
        ].join("\n"),
      },
    ]);
    assert.equal(result.match_count, 2);
    assert.equal(result.truncated, false);
    assert.equal(existsSync(scratchOf(f.matter)), false);

    // Default context is 3; max_matches caps the matched lines and says so.
    const capped = await lawFolderText(f.matter, f.law, { file: "Rules.md", pattern: "FIXTURE SERVICE", max_matches: 1 });
    assert.deepEqual(capped.matches.map((m) => [m.first, m.last, m.matched]), [[11, 17, [14]]]);
    assert.equal(capped.truncated, true);
    assert.equal(existsSync(scratchOf(f.matter)), false);
  } finally {
    f.cleanup();
  }
});

test("law_folder_text with a pattern that matches nothing returns no matches, still showing the file's head", async () => {
  const f = rulesFixture();
  try {
    const result = await lawFolderText(f.matter, f.law, { file: "Fixture Rules.md", pattern: "no such words" });
    assert.deepEqual(result.matches, []);
    assert.equal(result.match_count, 0);
    assert.equal(result.searched[0].head[1], "Current to 2026-09-30");
    assert.equal(existsSync(scratchOf(f.matter)), false);
  } finally {
    f.cleanup();
  }
});

test("law_folder_text refuses a file that matches no file, or several, listing the candidates", async () => {
  const f = rulesFixture();
  try {
    assert.equal(await codeOf(() => lawFolderText(f.matter, f.law, { file: "absent.pdf", pattern: "x" })), "not_found");
    let message;
    try {
      await lawFolderText(f.matter, f.law, { file: "fixture rules", pattern: "x" });
    } catch (err) {
      assert.equal(err.code, "ambiguous_file");
      message = err.message;
    }
    assert.match(message, /Fixture Rules Schedule\.txt/);
    assert.match(message, /Fixture Rules\.md/);
    assert.equal(await codeOf(() => lawFolderText(f.matter, f.law, { context: 2 })), "invalid_argument");
    assert.equal(await codeOf(() => lawFolderText(f.matter, f.law, { pattern: "(" })), "invalid_argument");
    assert.equal(existsSync(scratchOf(f.matter)), false);
  } finally {
    f.cleanup();
  }
});

test("law_folder_text never matches an HTML page: its text sibling stands in, or the call refuses", async () => {
  const f = rulesFixture();
  try {
    assert.equal(await codeOf(() => lawFolderText(f.matter, f.law, { file: "Fixture Act.html", pattern: "page" })), "html_page");
    const sibling = await lawFolderText(f.matter, f.law, { file: "Paged Act.html", pattern: "fixture service" });
    assert.deepEqual(sibling.searched.map((s) => s.file), ["Paged Act.md"]);
    assert.deepEqual(sibling.matches.map((m) => m.matched), [[2]]);

    // Without `file`, a pattern searches the folder but reports each HTML page unread.
    const folder = await lawFolderText(f.matter, f.law, { pattern: "fixture service" });
    const rows = Object.fromEntries(folder.searched.map((s) => [s.file, s]));
    assert.match(rows["Fixture Act.html"].reason, /^html_page/);
    assert.equal(rows["case-download-manifest.json"], undefined);
    assert.deepEqual([...new Set(folder.matches.map((m) => m.file))], ["Fixture Rules.md", "Paged Act.md"]);
    assert.ok(folder.matches.every((m) => !m.file.endsWith(".html")));
  } finally {
    f.cleanup();
  }
});

test("law_folder_text with file alone writes that one file's text, and no options keeps the whole-folder output", async () => {
  const f = fixture();
  try {
    const whole = await lawFolderText(f.matter, f.law);
    const same = await lawFolderText(f.matter, f.law, {});
    assert.deepEqual(same, whole);
    assert.deepEqual(Object.keys(whole).sort(), ["files", "out_dir"]);

    const one = await lawFolderText(f.matter, f.law, { file: "memo" });
    assert.deepEqual(one.files.map((row) => row.file), ["memo.docx"]);
    assert.match(readFileSync(one.files[0].text_path, "utf-8"), /Placeholder memo body/);
  } finally {
    f.cleanup();
  }
});

test("law_folder_text reads a file again once its size or mtime changes", async () => {
  const f = fixture();
  try {
    const first = await lawFolderText(f.matter, f.law, { file: "notes.txt", pattern: "notes" });
    assert.equal(first.match_count, 1);
    writeFileSync(join(f.law, "notes.txt"), "Placeholder replaced text, longer than before.\n");
    const second = await lawFolderText(f.matter, f.law, { file: "notes.txt", pattern: "replaced" });
    assert.equal(second.match_count, 1);
  } finally {
    f.cleanup();
  }
});

test("law_folder_text's schema documents file, pattern, context and max_matches as optional", async () => {
  const { buildToolDefinitions } = await import("../build/schema-gen.js");
  const tool = buildToolDefinitions().find((definition) => definition.name === "research_filing__law_folder_text");
  assert.deepEqual(tool.inputSchema.required, ["matter_root", "destination_dir"]);
  for (const key of ["file", "pattern", "context", "max_matches"]) {
    assert.ok(tool.inputSchema.properties[key].description, key);
    assert.match(tool.description, new RegExp("`" + key + "`"));
  }
});
