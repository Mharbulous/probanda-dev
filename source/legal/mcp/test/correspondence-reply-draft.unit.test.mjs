// drafting_forms__reply_draft: the reply route's plain markdown draft and its Outlook-paste .docx.
// Never overwrites; temp directories only, never a live matter.

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { inflateRawSync } from "node:zlib";

const { replyDraft } = await import("../build/correspondence/reply-draft.js");
const { crc32 } = await import("../build/correspondence/zip.js");
const { callTool } = await import("../build/dispatch.js");

const NAME = "2026-10-06 ET ExampleA re hearing length";
const TEXT = [
  "Dear Arbitrator Example,",
  "",
  "**Hearing length.** We expect two days, as *Smith v Jones*, 2020 BCSC 1 at para 5 suggests:",
  "",
  "> the hearing should not exceed",
  "> the time reasonably required.",
  "",
  "- first witness",
  "- second witness",
  "",
  "Yours truly,  ",
  "Counsel One",
].join("\n");

function matter(t) {
  const base = mkdtempSync(join(tmpdir(), "coclerk-reply-draft-"));
  t.after(() => rmSync(base, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }));
  const root = join(base, "L0000 Matter");
  mkdirSync(join(root, "0. DRAFT"), { recursive: true });
  writeFileSync(join(root, "coclerk.json"), JSON.stringify({ schema_version: 5, case_data_dir: join(base, "case data") }));
  const outside = join(base, "Elsewhere");
  mkdirSync(outside);
  const canon = realpathSync.native(root);
  return { root: canon, draft: join(canon, "0. DRAFT"), outside: realpathSync.native(outside) };
}

/** A zip's parts as UTF-8 text, read from its central directory, with each part's CRC checked. */
function unzip(buf) {
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const count = buf.readUInt16LE(eocd + 10);
  let at = buf.readUInt32LE(eocd + 16);
  const parts = {};
  for (let i = 0; i < count; i += 1) {
    const crc = buf.readUInt32LE(at + 16);
    const packedSize = buf.readUInt32LE(at + 20);
    const nameLength = buf.readUInt16LE(at + 28);
    const local = buf.readUInt32LE(at + 42);
    const name = buf.toString("utf-8", at + 46, at + 46 + nameLength);
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const data = inflateRawSync(buf.subarray(start, start + packedSize));
    assert.equal(data.length, buf.readUInt32LE(at + 24), `${name} size`);
    assert.equal(crc32(data), crc, `${name} crc`);
    parts[name] = data.toString("utf-8");
    at += 46 + nameLength;
  }
  return parts;
}

test("reply_draft: save writes the next free \" vN\" and never overwrites", async (t) => {
  const f = matter(t);
  const first = await callTool({}, "drafting_forms__reply_draft", { step: "save", matter_root: f.root, name: NAME, text: TEXT });
  assert.deepEqual(first, { success: true, path: join(f.draft, `${NAME}.md`), version: 1 });
  const second = replyDraft({ step: "save", matter_root: f.root, name: NAME, text: "revised" });
  assert.equal(second.path, join(f.draft, `${NAME} v2.md`));
  assert.equal(second.version, 2);
  assert.equal(readFileSync(first.path, "utf-8"), TEXT);
  assert.equal(readFileSync(second.path, "utf-8"), "revised");
  assert.equal(replyDraft({ step: "save", matter_root: f.root, name: NAME, text: "third" }).version, 3);
});

test("reply_draft: save refuses a name outside the grammar, a path, an extension or a version", (t) => {
  const f = matter(t);
  const save = (name) => () => replyDraft({ step: "save", matter_root: f.root, name, text: "x" });
  assert.throws(save("..\\escape"), (err) => err.code === "path_out_of_scope");
  assert.throws(save("2026-10-06 ET ExampleA re x\\y"), (err) => err.code === "path_out_of_scope");
  assert.throws(save(`${NAME}.md`), /without an extension/);
  assert.throws(save(`${NAME} v2`), /without " vN"/);
  assert.throws(save("reply to the arbitrator"), /firm's grammar/);
  assert.throws(() => replyDraft({ step: "save", matter_root: f.root, name: NAME, text: "  " }), /text is required/);
  assert.throws(() => replyDraft({ step: "send", matter_root: f.root }), /step must be one of: save, export_docx/);
  assert.deepEqual(readdirSync(f.draft), []);
});

test("reply_draft: export_docx writes Outlook-paste formatting beside the draft, then a \" vN\" copy", (t) => {
  const f = matter(t);
  const saved = replyDraft({ step: "save", matter_root: f.root, name: NAME, text: TEXT });
  const out = replyDraft({ step: "export_docx", matter_root: f.root, path: `${NAME}.md` });
  assert.equal(out.path, join(f.draft, `${NAME}.docx`));
  assert.equal(out.source, saved.path);
  assert.equal(out.versioned_from, undefined);

  const parts = unzip(readFileSync(out.path));
  assert.deepEqual(Object.keys(parts).sort(), ["[Content_Types].xml", "_rels/.rels", "word/_rels/document.xml.rels", "word/document.xml", "word/styles.xml"]);
  assert.match(parts["word/styles.xml"], /<w:rFonts w:ascii="Calibri"[^>]*\/><w:sz w:val="22"\/>/);
  const doc = parts["word/document.xml"];
  assert.match(doc, /<w:r><w:rPr><w:b\/><\/w:rPr><w:t xml:space="preserve">Hearing length\.<\/w:t><\/w:r>/);
  assert.match(doc, /<w:rPr><w:i\/><\/w:rPr><w:t xml:space="preserve">Smith v Jones<\/w:t>/);
  assert.match(doc, /<w:ind w:left="720" w:right="720"\/><\/w:pPr><w:r><w:t xml:space="preserve">the hearing should not exceed<\/w:t><\/w:r><w:r><w:br\/><\/w:r>/);
  assert.equal((doc.match(/<w:t xml:space="preserve">•<\/w:t>/g) ?? []).length, 2);
  // Only the first of the two items sits tight; the last keeps the gap before the sign-off.
  assert.equal((doc.match(/<w:spacing w:after="0"\/>/g) ?? []).length, 1);
  assert.doesNotMatch(doc, /\*\*|&gt; /);

  const again = replyDraft({ step: "export_docx", matter_root: f.root, path: saved.path });
  assert.equal(again.path, join(f.draft, `${NAME} v2.docx`));
  assert.equal(again.versioned_from, out.path);
});

test("reply_draft: export_docx reads only a .md at the top of the draft folder", (t) => {
  const f = matter(t);
  writeFileSync(join(f.outside, "x.md"), "outside");
  mkdirSync(join(f.draft, "Sub"));
  writeFileSync(join(f.draft, "Sub", "y.md"), "nested");
  writeFileSync(join(f.draft, "z.txt"), "text");
  const exp = (path) => () => replyDraft({ step: "export_docx", matter_root: f.root, path });
  assert.throws(exp(join(f.outside, "x.md")), (err) => err.code === "path_out_of_scope");
  assert.throws(exp("Sub\\y.md"), (err) => err.code === "path_out_of_scope");
  assert.throws(exp(join(f.draft, "Sub", "y.md")), (err) => err.code === "path_out_of_scope");
  assert.throws(exp("z.txt"), /saved \.md draft/);
  assert.throws(exp("missing.md"), (err) => err.code === "not_found");
});

test("reply_draft: no 0. DRAFT folder is refused, and the folder is never created", (t) => {
  const f = matter(t);
  rmSync(f.draft, { recursive: true });
  assert.throws(() => replyDraft({ step: "save", matter_root: f.root, name: NAME, text: TEXT }), (err) => err.code === "draft_dir_missing");
  assert.deepEqual(readdirSync(f.root), ["coclerk.json"]);
});
