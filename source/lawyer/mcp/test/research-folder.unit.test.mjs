// research_filing__research_folder: what researcher:research-agent and researcher:memo-reviewer read,
// confined to a matter's 6. LAW tree and the research scratchpad. The reader itself is proved by
// matter-folder.unit.test.mjs. Every fixture is invented and built in a temp folder. Run after tsc.

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { docxBytes, scannedPdfBytes } from "./helpers/synthetic-docs.mjs";

const { dispatchTool } = await import("../build/dispatch.js");
const { buildToolDefinitions } = await import("../build/schema-gen.js");

const TOOL = "research_filing__research_folder";
const SCRATCH = join("0. DRAFT v2", "AI Scratchpad", "research-agent");

function matter(t) {
  const base = mkdtempSync(join(tmpdir(), "probanda-research-folder-"));
  t.after(() => rmSync(base, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }));
  const made = join(base, "L0000 Invented Matter");
  for (const dir of [
    join("6. LAW", "Invented issue"),
    join("6. LAW", "privileged"),
    join(SCRATCH, "law-text", "Invented issue"),
    join("0. DRAFT v2", "AI Scratchpad", "other-agent"),
    "1. RAW",
    "privileged",
    "disclosed",
    "TRASH",
    "0. CASE DATA",
  ]) {
    mkdirSync(join(made, dir), { recursive: true });
  }
  const root = realpathSync.native(made);
  const files = {
    "probanda.json": "{}\n",
    [join("6. LAW", "Invented issue", "decision.txt")]: "Invented decision.\n",
    [join("6. LAW", "privileged", "advice.txt")]: "Invented advice in the law tree.\n",
    [join(SCRATCH, "2026-01-01 ML re invented memo.md")]: "---\nInvented memo.\n",
    [join(SCRATCH, "law-text", "Invented issue", "decision.doc.txt")]: "Invented extracted text.\n",
    [join("0. DRAFT v2", "draft.txt")]: "Invented draft.\n",
    [join("0. DRAFT v2", "AI Scratchpad", "other.txt")]: "Invented other scratch.\n",
    [join("0. DRAFT v2", "AI Scratchpad", "other-agent", "notes.txt")]: "Invented other agent's notes.\n",
    [join("1. RAW", "raw.txt")]: "Invented raw document.\n",
    [join("privileged", "advice.txt")]: "Invented privileged advice.\n",
    [join("disclosed", "produced.txt")]: "Invented produced document.\n",
    [join("TRASH", "gone.txt")]: "Invented trashed note.\n",
    [join("0. CASE DATA", "stored.txt")]: "Invented stored note.\n",
  };
  for (const [path, body] of Object.entries(files)) writeFileSync(join(root, path), body);
  const outside = join(base, "Outside");
  mkdirSync(outside);
  writeFileSync(join(outside, "secret.txt"), "Invented file outside the matter.\n");
  return { root, outside: realpathSync.native(outside) };
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

test("a text_path, a scratch memo and a 6. LAW file are read, absolute or relative", async (t) => {
  const { root } = matter(t);
  const textPath = join(root, SCRATCH, "law-text", "Invented issue", "decision.doc.txt");
  const read = await ok({ matter_root: root, path: textPath });
  assert.match(read.body.text, /Invented extracted text/);
  assert.equal(read.body.path, join(SCRATCH, "law-text", "Invented issue", "decision.doc.txt"));
  assert.equal(read.body.content_source, "research folder file");

  const memo = await ok({ matter_root: root, path: join(root, SCRATCH, "2026-01-01 ML re invented memo.md") });
  assert.equal(memo.body.text, "---\nInvented memo.\n");
  const law = await ok({ matter_root: root, path: join("6. LAW", "Invented issue", "decision.txt") });
  assert.match(law.body.text, /Invented decision/);
});

test("a listing's paths can be read back, and the tree's own folders list", async (t) => {
  const { root } = matter(t);
  const listed = await ok({ matter_root: root, path: join("6. LAW", "Invented issue") });
  assert.deepEqual(listed.body.entries.map((e) => e.path), [join("6. LAW", "Invented issue", "decision.txt")]);
  await ok({ matter_root: root, path: listed.body.entries[0].path });

  const scratch = await ok({ matter_root: root, path: join(root, SCRATCH) });
  assert.deepEqual(scratch.body.entries.map((e) => e.type).sort(), ["file", "folder"]);
  const law = await ok({ matter_root: root, path: "6. LAW" });
  assert.deepEqual(law.body.skipped.map((s) => s.path), [join("6. LAW", "privileged")]);
});

test("a scanned page comes back only as an image, and a Word file as its text", async (t) => {
  const { root } = matter(t);
  writeFileSync(join(root, "6. LAW", "Invented issue", "scan.pdf"), scannedPdfBytes());
  writeFileSync(join(root, "6. LAW", "Invented issue", "memo.docx"), docxBytes("Invented heading\nInvented body."));
  const { reply, body } = await ok({ matter_root: root, path: join("6. LAW", "Invented issue", "scan.pdf") });
  assert.equal(body.pages[0].kind, "scanned");
  assert.equal(body.pages[0].text, undefined);
  assert.equal(reply.content[1].type, "image");
  // The invisible OCR layer on page 1 reads "Placeholder text layer", with no comma after it.
  assert.doesNotMatch(reply.content[0].text, /Placeholder text layer(?!,)/);
  const memo = await ok({ matter_root: root, path: join("6. LAW", "Invented issue", "memo.docx") });
  assert.match(memo.body.text, /Invented body/);
});

test("everything else in the matter is refused: other folders, the rest of the draft folder, the matter itself", async (t) => {
  const { root } = matter(t);
  for (const path of [
    join("1. RAW", "raw.txt"),
    join(root, "1. RAW"),
    join("0. DRAFT v2", "draft.txt"),
    "0. DRAFT v2",
    join("0. DRAFT v2", "AI Scratchpad"),
    join("0. DRAFT v2", "AI Scratchpad", "other.txt"),
    join("0. DRAFT v2", "AI Scratchpad", "other-agent", "notes.txt"),
    "probanda.json",
    root,
  ]) {
    assert.equal(await refusal({ matter_root: root, path }), "path_out_of_scope", path);
  }
  assert.equal((await dispatchTool({}, TOOL, { matter_root: root })).isError, true);
});

test("privileged, disclosed, TRASH and case data paths are protected, in the tree and out of it", async (t) => {
  const { root } = matter(t);
  for (const path of [
    join("privileged", "advice.txt"),
    join(root, "disclosed", "produced.txt"),
    join("TRASH", "gone.txt"),
    join("0. CASE DATA", "stored.txt"),
    join("6. LAW", "privileged", "advice.txt"),
    join(root, "6. LAW", "privileged"),
  ]) {
    assert.equal(await refusal({ matter_root: root, path }), "protected", path);
  }
});

test("a path outside the matter is refused, however it is written", async (t) => {
  const { root, outside } = matter(t);
  assert.equal(await refusal({ matter_root: root, path: join(outside, "secret.txt") }), "path_out_of_scope");
  assert.equal(await refusal({ matter_root: root, path: "6. LAW\\..\\1. RAW\\raw.txt" }), "path_out_of_scope");
  assert.equal(await refusal({ matter_root: root, path: "..\\Outside\\secret.txt" }), "path_out_of_scope");
  assert.equal(await refusal({ matter_root: root, path: "C:\\Windows\\win.ini" }), "path_out_of_scope");
});

test("a link out of the trees is refused on its real path, and left out of a listing", async (t) => {
  const { root, outside } = matter(t);
  const law = join(root, "6. LAW", "Invented issue");
  symlinkSync(outside, join(law, "out of matter"), "junction");
  symlinkSync(join(root, "1. RAW"), join(law, "rest of matter"), "junction");
  symlinkSync(join(root, "privileged"), join(root, SCRATCH, "law-text", "firewall"), "junction");

  assert.equal(await refusal({ matter_root: root, path: join(law, "out of matter", "secret.txt") }), "path_out_of_scope");
  assert.equal(await refusal({ matter_root: root, path: join(law, "rest of matter", "raw.txt") }), "path_out_of_scope");
  assert.equal(await refusal({ matter_root: root, path: join(root, SCRATCH, "law-text", "firewall", "advice.txt") }), "protected");

  const { body } = await ok({ matter_root: root, path: law });
  assert.deepEqual(body.entries.map((e) => e.path), [join(law.slice(root.length + 1), "decision.txt")]);
  assert.deepEqual(body.skipped.map((s) => s.path).sort(), [
    join("6. LAW", "Invented issue", "out of matter"),
    join("6. LAW", "Invented issue", "rest of matter"),
  ]);
  const scratch = await ok({ matter_root: root, path: join(root, SCRATCH, "law-text") });
  assert.deepEqual(scratch.body.skipped.map((s) => s.path), [join(SCRATCH, "law-text", "firewall")]);
});

test("a link from one tree into the other opens only by the other's own path", async (t) => {
  const { root } = matter(t);
  symlinkSync(join(root, "6. LAW", "Invented issue"), join(root, SCRATCH, "law-link"), "junction");
  const { body } = await ok({ matter_root: root, path: join(root, SCRATCH, "law-link", "decision.txt") });
  assert.match(body.text, /Invented decision/);
  const listed = await ok({ matter_root: root, path: join(root, SCRATCH) });
  assert.ok(listed.body.skipped.some((s) => s.path === join(SCRATCH, "law-link")));
});

test("a junction at either tree's own place opens nothing", async (t) => {
  const { root } = matter(t);
  rmSync(join(root, "6. LAW"), { recursive: true });
  symlinkSync(join(root, "1. RAW"), join(root, "6. LAW"), "junction");
  assert.equal(await refusal({ matter_root: root, path: join("6. LAW", "raw.txt") }), "path_out_of_scope");

  rmSync(join(root, SCRATCH), { recursive: true });
  symlinkSync(join(root, "1. RAW"), join(root, SCRATCH), "junction");
  assert.equal(await refusal({ matter_root: root, path: join(root, SCRATCH, "raw.txt") }), "path_out_of_scope");
});

test("a matter with no 6. LAW folder still reads its scratchpad, and one with neither refuses", async (t) => {
  const { root } = matter(t);
  rmSync(join(root, "6. LAW"), { recursive: true });
  await ok({ matter_root: root, path: join(root, SCRATCH, "2026-01-01 ML re invented memo.md") });
  rmSync(join(root, "0. DRAFT v2"), { recursive: true });
  assert.equal(await refusal({ matter_root: root, path: "1. RAW" }), "path_out_of_scope");
});

test("it writes nothing, and its schema takes no write input and no name search", async (t) => {
  const { root } = matter(t);
  const snapshot = () => readdirSync(root, { recursive: true }).sort().map((name) => {
    const stat = statSync(join(root, name));
    return `${name}|${stat.size}|${stat.mtimeMs}`;
  });
  writeFileSync(join(root, "6. LAW", "Invented issue", "scan.pdf"), scannedPdfBytes());
  const before = snapshot();
  await ok({ matter_root: root, path: "6. LAW" });
  await ok({ matter_root: root, path: join("6. LAW", "Invented issue", "scan.pdf") });
  await ok({ matter_root: root, path: join(root, SCRATCH, "2026-01-01 ML re invented memo.md") });
  assert.deepEqual(snapshot(), before);

  const tool = buildToolDefinitions().find((definition) => definition.name === TOOL);
  assert.equal(tool.annotations.readOnlyHint, true);
  assert.deepEqual(Object.keys(tool.inputSchema.properties).sort(), ["matter_root", "offset", "pages", "path"]);
  for (const extra of [{ content: "x" }, { name: "decision" }, { destination_dir: root }]) {
    const reply = await dispatchTool({}, TOOL, { matter_root: root, path: "6. LAW", ...extra });
    assert.equal(reply.isError, true, JSON.stringify(extra));
  }
});

test("an HTML file in the tree is refused", async (t) => {
  const { root } = matter(t);
  writeFileSync(join(root, "6. LAW", "page.html"), "<html></html>");
  assert.equal(await refusal({ matter_root: root, path: join("6. LAW", "page.html") }), "html_page");
});
