// research_filing__matter_folder: the read-only view of a matter folder that lawyer:scrivener and
// litigator:source-tracer use on the PC. Every fixture is invented and built in a temp folder.
// Run after tsc.

import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { docxBytes, pdfBytes, scannedPdfBytes } from "./helpers/synthetic-docs.mjs";

const { dispatchTool } = await import("../build/dispatch.js");
const { buildToolDefinitions } = await import("../build/schema-gen.js");

const TOOL = "research_filing__matter_folder";
const PNG_SIGNATURE = "89504e470d0a1a0a";

function matter(t) {
  const base = mkdtempSync(join(tmpdir(), "probanda-matter-folder-"));
  t.after(() => rmSync(base, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }));
  const root = join(base, "L0000 Invented Matter");
  for (const dir of ["0. DRAFT", "0. CASE DATA", "1. RAW\\Emails", "7. DISCOVERY\\Inner", "privileged", "disclosed", "TRASH"]) {
    mkdirSync(join(root, ...dir.split("\\")), { recursive: true });
  }
  writeFileSync(join(root, "probanda.json"), "{}\n");
  writeFileSync(join(root, "7. DISCOVERY", "list.txt"), "Invented list of documents.\n");
  writeFileSync(join(root, "7. DISCOVERY", "Inner", "inner note.txt"), "Invented inner note.\n");
  writeFileSync(join(root, "0. DRAFT", "draft note.txt"), "Invented draft note.\n");
  writeFileSync(join(root, "privileged", "advice.txt"), "Invented privileged advice.\n");
  writeFileSync(join(root, "disclosed", "produced.txt"), "Invented produced document.\n");
  writeFileSync(join(root, "TRASH", "gone.txt"), "Invented trashed note.\n");
  writeFileSync(join(root, "0. CASE DATA", "stored.txt"), "Invented stored note.\n");
  const outside = join(base, "Outside");
  mkdirSync(outside);
  writeFileSync(join(outside, "secret.txt"), "Invented file outside the matter.\n");
  return { base, root: realpathSync.native(root), outside: realpathSync.native(outside) };
}

async function ok(args) {
  const reply = await dispatchTool({}, TOOL, args);
  assert.equal(reply.isError, undefined, reply.content[0].text);
  return { reply, body: JSON.parse(reply.content[0].text) };
}

async function refusal(args) {
  const reply = await dispatchTool({}, TOOL, args);
  assert.equal(reply.isError, true, reply.content[0].text);
  return JSON.parse(reply.content[0].text).error.code;
}

/** Every path under `dir`, with its size and mtime, so a test can prove nothing changed. */
function snapshot(dir) {
  return readdirSync(dir, { recursive: true }).sort().map((name) => {
    const stat = statSync(join(dir, name));
    return `${name}|${stat.size}|${stat.mtimeMs}`;
  });
}

/** An invented multi-part message of at least `size` bytes: alternative text and HTML, and a binary attachment. */
function largeEml(size, bodyText = "Invented body: the parties met on the invented date.\r\n") {
  const b64 = (buffer) => buffer.toString("base64").replace(/(.{76})/g, "$1\r\n");
  const attachment = randomBytes(Math.ceil((size * 3) / 4));
  return Buffer.from(
    [
      "From: =?utf-8?B?SW52ZW50ZWQgU2VuZGVy?= <sender@example.test>",
      "To: One Reader <one@example.test>, two@example.test",
      "Cc: three@example.test",
      "Subject: =?utf-8?Q?Invented_subject_caf=C3=A9?=",
      "Date: Mon, 05 Oct 2026 09:30:00 -0700",
      "MIME-Version: 1.0",
      'Content-Type: multipart/mixed; boundary="outer"',
      "",
      "--outer",
      'Content-Type: multipart/alternative; boundary="inner"',
      "",
      "--inner",
      'Content-Type: text/plain; charset="utf-8"',
      "Content-Transfer-Encoding: base64",
      "",
      b64(Buffer.from(bodyText, "utf-8")),
      "--inner",
      'Content-Type: text/html; charset="utf-8"',
      "",
      "<html><body><p>Invented HTML twin.</p></body></html>",
      "--inner--",
      "--outer",
      'Content-Type: application/pdf; name="Invented Exhibit.pdf"',
      'Content-Disposition: attachment; filename="Invented Exhibit.pdf"',
      "Content-Transfer-Encoding: base64",
      "",
      b64(attachment),
      "--outer",
      "Content-Type: text/plain; charset=utf-8",
      'Content-Disposition: attachment; filename="=?utf-8?Q?Second_note.txt?="',
      "",
      "Invented second attachment.",
      "--outer--",
      "",
    ].join("\r\n"),
    "utf-8"
  );
}

test("a 500 KB multi-part .eml comes back decoded, with its text and attachment names, not raw", async (t) => {
  const { root } = matter(t);
  const file = join(root, "1. RAW", "Emails", "2026-10-05 Invented sender.eml");
  writeFileSync(file, largeEml(500_000));
  assert.ok(statSync(file).size >= 500_000);

  const { reply, body } = await ok({ matter_root: root, path: "1. RAW\\Emails\\2026-10-05 Invented sender.eml" });
  assert.equal(body.type, "message");
  assert.equal(body.from, "Invented Sender <sender@example.test>");
  assert.deepEqual(body.to, ["One Reader <one@example.test>", "two@example.test"]);
  assert.deepEqual(body.cc, ["three@example.test"]);
  assert.equal(body.subject, "Invented subject café");
  assert.equal(body.sent, "2026-10-05T16:30:00.000Z");
  assert.match(body.text, /the parties met on the invented date/);
  assert.equal(body.next_offset, null);
  assert.deepEqual(body.attachments.map((a) => a.name), ["Invented Exhibit.pdf", "Second note.txt"]);
  assert.ok(body.attachments[0].size >= 370_000);
  assert.equal(body.highlights, undefined);
  // The attachment's bytes and the raw MIME stay out: the reply is a small share of the file.
  assert.ok(reply.content[0].text.length < 5_000, `reply is ${reply.content[0].text.length} characters`);
  assert.doesNotMatch(reply.content[0].text, /--outer|base64/);
  assert.equal(reply.content.length, 1);
  assert.equal(body.content_source, "matter folder file");
});

test("a body past the window comes in pieces, whole, even past the read_message limit", async (t) => {
  const { root } = matter(t);
  const text = Array.from({ length: 4000 }, (_, i) => `Invented line ${i} of a long quoted chain of messages.`).join("\n");
  assert.ok(text.length > 100_000);
  writeFileSync(join(root, "long.eml"), largeEml(10, text));
  let joined = "";
  let offset = 0;
  while (offset !== null) {
    const { body } = await ok({ matter_root: root, path: "long.eml", offset });
    assert.ok(body.text.length <= 40_000);
    assert.equal(body.total_chars, text.length);
    joined += body.text;
    offset = body.next_offset;
  }
  assert.equal(joined, text);
});

test("name search finds exported mail by words of its name, in any case and order, through subfolders", async (t) => {
  const { root } = matter(t);
  for (const name of ["2026-10-05 Invented sender.eml", "2026-10-06 Other person.eml", "2026-10-05 Invented sender.pdf"]) {
    writeFileSync(join(root, "1. RAW", "Emails", name), "x");
  }
  const { body } = await ok({ matter_root: root, name: "SENDER .eml 2026-10" });
  assert.deepEqual(body.matches.map((m) => m.path), ["1. RAW\\Emails\\2026-10-05 Invented sender.eml"]);
  assert.equal(body.matches[0].type, "file");
  assert.equal(body.match_count, 1);
  assert.equal(body.truncated, false);

  const narrowed = await ok({ matter_root: root, path: "7. DISCOVERY", name: "inner" });
  assert.deepEqual(narrowed.body.matches.map((m) => [m.path, m.type]), [
    ["7. DISCOVERY\\Inner", "folder"],
    ["7. DISCOVERY\\Inner\\inner note.txt", "file"],
  ]);
});

test("a name search passes over the draft folder and every barred tree, saying so, unless the draft folder is named", async (t) => {
  const { root } = matter(t);
  const { body } = await ok({ matter_root: root, name: "note" });
  assert.deepEqual(body.matches.map((m) => m.path), ["7. DISCOVERY\\Inner\\inner note.txt"]);
  const skipped = body.skipped.map((s) => s.path).sort();
  assert.deepEqual(skipped, ["0. CASE DATA", "0. DRAFT", "TRASH", "disclosed", "privileged"]);

  const inDraft = await ok({ matter_root: root, path: "0. DRAFT", name: "note" });
  assert.deepEqual(inDraft.body.matches.map((m) => m.path), ["0. DRAFT\\draft note.txt"]);

  for (const word of ["advice", "produced", "gone", "stored"]) {
    assert.deepEqual((await ok({ matter_root: root, name: word })).body.matches, [], word);
  }
  assert.equal(await refusal({ matter_root: root, name: "   " }), "invalid_argument");
});

test("list shows a folder's direct children with sizes and leaves barred trees out, naming them", async (t) => {
  const { root } = matter(t);
  const { body } = await ok({ matter_root: root, path: "7. DISCOVERY" });
  assert.equal(body.path, "7. DISCOVERY");
  assert.deepEqual(body.entries.map((e) => [e.path, e.type, e.bytes]), [
    ["7. DISCOVERY\\Inner", "folder", undefined],
    ["7. DISCOVERY\\list.txt", "file", 28],
  ]);
  const top = await ok({ matter_root: root });
  assert.equal(top.body.path, ".");
  assert.deepEqual(top.body.entries.map((e) => e.path), ["0. DRAFT", "1. RAW", "7. DISCOVERY", "probanda.json"]);
  assert.deepEqual(top.body.skipped.map((s) => s.path).sort(), ["0. CASE DATA", "TRASH", "disclosed", "privileged"]);
});

test("privileged and disclosed trees refuse every act, however they are named", async (t) => {
  const { root } = matter(t);
  for (const tree of ["privileged", "disclosed", "PRIVILEGED", "Disclosed"]) {
    assert.equal(await refusal({ matter_root: root, path: tree }), "protected", tree);
    assert.equal(await refusal({ matter_root: root, path: join(root, tree) }), "protected", tree);
    assert.equal(await refusal({ matter_root: root, path: tree, name: "advice" }), "protected", tree);
  }
  assert.equal(await refusal({ matter_root: root, path: "privileged\\advice.txt" }), "protected");
  assert.equal(await refusal({ matter_root: root, path: join(root, "disclosed", "produced.txt") }), "protected");
  assert.equal(await refusal({ matter_root: root, path: "TRASH\\gone.txt" }), "protected");
  assert.equal(await refusal({ matter_root: root, path: "0. CASE DATA\\stored.txt" }), "protected");
});

test("a path outside the matter is refused: dot-dot, absolute, a sibling that shares the prefix, a junction", async (t) => {
  const { root, outside } = matter(t);
  assert.equal(await refusal({ matter_root: root, path: "..\\Outside\\secret.txt" }), "path_out_of_scope");
  assert.equal(await refusal({ matter_root: root, path: "7. DISCOVERY\\..\\..\\Outside\\secret.txt" }), "path_out_of_scope");
  assert.equal(await refusal({ matter_root: root, path: "7. DISCOVERY\\..\\7. DISCOVERY\\list.txt" }), "path_out_of_scope");
  assert.equal(await refusal({ matter_root: root, path: join(outside, "secret.txt") }), "path_out_of_scope");
  assert.equal(await refusal({ matter_root: root, path: join(root, "..", "Outside", "secret.txt") }), "path_out_of_scope");
  assert.equal(await refusal({ matter_root: root, path: "C:\\Windows\\win.ini" }), "path_out_of_scope");
  assert.equal(await refusal({ matter_root: root, path: "C:Windows" }), "path_out_of_scope");

  const sibling = `${root}-evil`;
  mkdirSync(sibling);
  writeFileSync(join(sibling, "x.txt"), "Invented.\n");
  t.after(() => rmSync(sibling, { recursive: true, force: true }));
  assert.equal(await refusal({ matter_root: root, path: join(sibling, "x.txt") }), "path_out_of_scope");

  symlinkSync(outside, join(root, "7. DISCOVERY", "escape"), "junction");
  assert.equal(await refusal({ matter_root: root, path: "7. DISCOVERY\\escape\\secret.txt" }), "path_out_of_scope");
  assert.equal(await refusal({ matter_root: root, path: "7. DISCOVERY\\escape" }), "path_out_of_scope");
  assert.equal(await refusal({ matter_root: root, path: join(root, "7. DISCOVERY", "escape", "secret.txt") }), "path_out_of_scope");

  // In a list or a search the link is left out and named, and nothing beyond it is walked.
  const listed = await ok({ matter_root: root, path: "7. DISCOVERY" });
  assert.deepEqual(listed.body.entries.map((e) => e.path), ["7. DISCOVERY\\Inner", "7. DISCOVERY\\list.txt"]);
  assert.deepEqual(listed.body.skipped.map((s) => s.path), ["7. DISCOVERY\\escape"]);
  const found = await ok({ matter_root: root, name: "secret" });
  assert.deepEqual(found.body.matches, []);
});

test("a junction into a barred tree is refused on its real path, and a junction loop ends", async (t) => {
  const { root } = matter(t);
  symlinkSync(join(root, "privileged"), join(root, "7. DISCOVERY", "looks ordinary"), "junction");
  assert.equal(await refusal({ matter_root: root, path: "7. DISCOVERY\\looks ordinary\\advice.txt" }), "protected");
  const found = await ok({ matter_root: root, name: "advice" });
  assert.deepEqual(found.body.matches, []);

  symlinkSync(join(root, "7. DISCOVERY"), join(root, "7. DISCOVERY", "Inner", "back up"), "junction");
  const looped = await ok({ matter_root: root, path: "7. DISCOVERY", name: "list" });
  assert.deepEqual(looped.body.matches.map((m) => m.path), ["7. DISCOVERY\\list.txt"]);
});

test("a scanned page comes back as an image and never from its text layer; a born-digital page as text", async (t) => {
  const { root } = matter(t);
  const pdf = join(root, "7. DISCOVERY", "scan.pdf");
  // Page 1: a full-page image under invisible OCR text. Pages 2 and 3: visible text.
  writeFileSync(pdf, scannedPdfBytes());
  const { reply, body } = await ok({ matter_root: root, path: pdf });
  assert.equal(body.type, "pdf");
  assert.equal(body.page_count, 3);
  assert.equal(body.next_page, null);
  const [scanned, ...digital] = body.pages;
  assert.equal(scanned.kind, "scanned");
  assert.equal(scanned.text, undefined);
  assert.deepEqual(digital.map((p) => p.kind), ["born_digital", "born_digital"]);
  assert.match(digital[0].text, /Placeholder text layer, visible on the page/);
  // The OCR layer's words, "Placeholder text layer" with no comma, are on page 1 only, and page 1 returns none.
  assert.doesNotMatch(reply.content[0].text, /Placeholder text layer(?!,)/);

  assert.equal(reply.content.length, 2);
  assert.equal(reply.content[1].type, "image");
  assert.equal(reply.content[1].mimeType, "image/png");
  assert.equal(Buffer.from(reply.content[1].data, "base64").subarray(0, 8).toString("hex"), PNG_SIGNATURE);
  assert.equal(scanned.images[0].image, 1);
  assert.equal(scanned.images[0].width, 1275);

  const one = await ok({ matter_root: root, path: pdf, pages: "2" });
  assert.deepEqual(one.body.pages.map((p) => p.page), [2]);
  assert.equal(one.reply.content.length, 1);
  assert.equal(await refusal({ matter_root: root, path: pdf, pages: "9" }), "bad_pages");
});

test("pdf_pages__images still writes its PNGs and result, the same bytes as the image in this tool's reply", async (t) => {
  const { base, root } = matter(t);
  const pdf = join(root, "scan.pdf");
  writeFileSync(pdf, scannedPdfBytes());
  const destination = join(base, "Page images");
  const reply = await dispatchTool({}, "pdf_pages__images", { path: pdf, destination_dir: destination });
  assert.equal(reply.isError, undefined, reply.content[0].text);
  const written = JSON.parse(reply.content[0].text);
  assert.equal(written.page_count, 3);
  assert.equal(written.render_dir, join(destination, written.source_sha256.slice(0, 16)));
  assert.deepEqual(written.pages.map((p) => p.kind), ["scanned", "born_digital", "born_digital"]);
  const [image] = written.pages[0].images;
  assert.deepEqual(Object.keys(image), ["path", "sha256", "width", "height"]);
  assert.equal(image.path, join(written.render_dir, "page-0001.png"));
  const inline = await ok({ matter_root: root, path: "scan.pdf", pages: "1" });
  assert.equal(inline.reply.content[1].data, readFileSync(image.path).toString("base64"));
  assert.equal(createHash("sha256").update(readFileSync(image.path)).digest("hex"), image.sha256);
});

test("a long PDF resumes at next_page, by the scanned-page limit and the text limit", async (t) => {
  const { root } = matter(t);
  const scans = join(root, "scans.pdf");
  const { imagePdfBytes, drawImage, drawText } = await import("./helpers/synthetic-docs.mjs");
  writeFileSync(scans, imagePdfBytes({ pages: Array.from({ length: 7 }, () => ({ content: `${drawImage(0, 0, 612, 792)} ${drawText(3, 72, 720)}` })) }));
  const first = await ok({ matter_root: root, path: scans });
  assert.deepEqual(first.body.pages.map((p) => p.page), [1, 2, 3, 4, 5]);
  assert.equal(first.body.next_page, 6);
  assert.equal(first.reply.content.filter((c) => c.type === "image").length, 5);
  const rest = await ok({ matter_root: root, path: scans, pages: "6-7" });
  assert.deepEqual(rest.body.pages.map((p) => p.page), [6, 7]);
  assert.equal(rest.body.next_page, null);

  const page = Array.from({ length: 45 }, (_, i) => `Invented line ${i} ${"of placeholder words ".repeat(4)}`).join("\n");
  const long = join(root, "long.pdf");
  writeFileSync(long, pdfBytes(Array.from({ length: 30 }, () => page)));
  const text = await ok({ matter_root: root, path: long });
  assert.ok(text.body.next_page > 1 && text.body.next_page <= 30);
  assert.ok(text.body.pages.reduce((sum, p) => sum + p.text.length, 0) <= 40_000);
});

test("the tool writes nothing, in the matter or in the temp folder, whatever it reads", async (t) => {
  const { base, root } = matter(t);
  writeFileSync(join(root, "7. DISCOVERY", "scan.pdf"), scannedPdfBytes());
  writeFileSync(join(root, "1. RAW", "Emails", "m.eml"), largeEml(1000));
  writeFileSync(join(root, "7. DISCOVERY", "memo.docx"), docxBytes("Invented memo heading\nInvented memo body."));
  const before = snapshot(root);
  const emptyTemp = join(base, "temp");
  mkdirSync(emptyTemp);
  const saved = { TEMP: process.env.TEMP, TMP: process.env.TMP, TMPDIR: process.env.TMPDIR };
  Object.assign(process.env, { TEMP: emptyTemp, TMP: emptyTemp, TMPDIR: emptyTemp });
  t.after(() => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  await ok({ matter_root: root });
  await ok({ matter_root: root, name: "memo" });
  await ok({ matter_root: root, path: "7. DISCOVERY\\scan.pdf" });
  await ok({ matter_root: root, path: "1. RAW\\Emails\\m.eml" });
  const memo = await ok({ matter_root: root, path: "7. DISCOVERY\\memo.docx" });
  assert.match(memo.body.text, /Invented memo body/);
  assert.equal(memo.body.type, "docx");
  assert.deepEqual(snapshot(root), before);
  assert.deepEqual(readdirSync(emptyTemp), []);
});

test("the schema declares read-only inputs and refuses anything that would write", async (t) => {
  const { root } = matter(t);
  const tool = buildToolDefinitions().find((definition) => definition.name === TOOL);
  assert.equal(tool.annotations.readOnlyHint, true);
  assert.deepEqual(Object.keys(tool.inputSchema.properties).sort(), ["matter_root", "name", "offset", "pages", "path"]);
  assert.equal(tool.inputSchema.additionalProperties, false);
  for (const extra of [{ content: "x" }, { text: "x" }, { destination_dir: root }]) {
    const reply = await dispatchTool({}, TOOL, { matter_root: root, ...extra });
    assert.equal(reply.isError, true, JSON.stringify(extra));
  }
});

test("what cannot be read is refused by name: HTML pages, an unknown type, a matter with no pointer, misplaced options", async (t) => {
  const { root, outside } = matter(t);
  writeFileSync(join(root, "Work Board 1.html"), "<html></html>");
  writeFileSync(join(root, "old.rtf"), "{\\rtf1 x}");
  writeFileSync(join(root, "empty.txt"), "  \n");
  writeFileSync(join(root, "bad.eml"), Buffer.alloc(0));
  assert.equal(await refusal({ matter_root: root, path: "Work Board 1.html" }), "html_page");
  assert.equal(await refusal({ matter_root: root, path: "old.rtf" }), "unsupported_type");
  assert.equal(await refusal({ matter_root: root, path: "empty.txt" }), "no_text");
  assert.equal(await refusal({ matter_root: root, path: "absent.txt" }), "not_found");
  assert.equal(await refusal({ matter_root: outside, path: "secret.txt" }), "invalid_root");
  assert.equal(await refusal({ matter_root: root, path: "7. DISCOVERY", pages: "1" }), "invalid_argument");
  assert.equal(await refusal({ matter_root: root, path: "7. DISCOVERY\\list.txt", name: "x" }), "invalid_argument");
  assert.equal(await refusal({ matter_root: root, path: "7. DISCOVERY\\list.txt", pages: "1" }), "invalid_argument");
  writeFileSync(join(root, "p.pdf"), pdfBytes(["Invented."]));
  assert.equal(await refusal({ matter_root: root, path: "p.pdf", offset: 1 }), "invalid_argument");
});
