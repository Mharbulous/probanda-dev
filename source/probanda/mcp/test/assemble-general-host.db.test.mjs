// drafting_forms__assemble_general (#1321, ADR 0027): assemble-general's binder runs host-side for
// a Cowork session. The confinement refusals need no Python; the binder's own refusals need PyMuPDF;
// the one real bind also needs Word or LibreOffice, and is skipped, with the reason, on a host
// without them. Temp directories only; never a live matter.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { codeOf } from "./helpers/housekeeping-fixture.mjs";

const { assembleGeneral } = await import("../build/submission/assemble-tools.js");
const { buildToolDefinitions } = await import("../build/schema-gen.js");
const { callTool } = await import("../build/dispatch.js");

const PYTHON = process.env.COCLERK_PYTHON || "python";
const DOCX = "2026-10-01 LT Bert re invoice.docx";
const UNSIGNED = "2026-10-01 LT Bert re invoice UNSIGNED.pdf";

/** A matter folder with one 0. DRAFT folder, and a case-data folder outside it holding the database. */
function matter(t) {
  const base = mkdtempSync(join(tmpdir(), "coclerk-assemble-"));
  t.after(() => rmSync(base, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }));
  const root = join(base, "L0000 Matter");
  mkdirSync(join(root, "0. DRAFT"), { recursive: true });
  const caseData = join(base, "0. CASE DATA", "L0000");
  mkdirSync(caseData, { recursive: true });
  writeFileSync(join(caseData, "main.sqlite"), "");
  const dbPath = join(caseData, "submission.sqlite");
  writeFileSync(dbPath, "");
  writeFileSync(join(root, "coclerk.json"), JSON.stringify({ schema_version: 5, matter_root: root, case_data_dir: caseData }));
  const outside = join(base, "Elsewhere");
  mkdirSync(outside);
  const m = { root: realpathSync.native(root), caseData: realpathSync.native(caseData), dbPath, outside: realpathSync.native(outside) };
  const args = { matter_root: m.root, docx_name: DOCX, enclosures: [] };
  return {
    ...m,
    args,
    draft: join(m.root, "0. DRAFT"),
    subfolder: join(m.caseData, "assemble-general"),
    run: (extra = {}, env = process.env) => assembleGeneral({ ...args, ...extra }, env),
  };
}

/** Runs a Python snippet with argv; fails the test on any error. */
function python(code, ...argv) {
  const res = spawnSync(PYTHON, ["-c", code, ...argv], { encoding: "utf-8" });
  assert.equal(res.status, 0, res.stderr);
  return res.stdout.trim();
}

const PDF = `import sys, pymupdf
doc = pymupdf.open()
for n in range(1, int(sys.argv[2]) + 1):
    doc.new_page().insert_text((72, 400), f"PAGE-{n}")
doc.save(sys.argv[1])`;

const pdfFacts = (path) => JSON.parse(python("import sys, json, pymupdf\nd = pymupdf.open(sys.argv[1])\nprint(json.dumps([d.page_count, len(d.get_toc())]))", path));

test("assemble_general: registered, taking the brief's arguments and no case-data or database path", async (t) => {
  const tool = buildToolDefinitions().find((d) => d.name === "drafting_forms__assemble_general");
  assert.ok(tool, "not in buildToolDefinitions()");
  assert.deepEqual(Object.keys(tool.inputSchema.properties), ["matter_root", "docx_name", "pdf_name", "enclosures"]);
  assert.deepEqual(tool.inputSchema.required, ["matter_root", "docx_name", "enclosures"]);
  const f = matter(t);
  await assert.rejects(callTool({}, "drafting_forms__assemble_general", { ...f.args, case_data_folder: f.caseData }), /unknown field "case_data_folder"/);
  await assert.rejects(callTool({}, "drafting_forms__assemble_general", { ...f.args, db_path: f.dbPath }), /unknown field "db_path"/);
});

test("assemble_general: a bind never opens the drafting database, so one behind the schema is left as it was (#1427)", (t) => {
  const f = matter(t);
  // A database at schema v24, the version a live matter was migrated from when a bind still went through open_session.
  python("import sqlite3, sys\nc = sqlite3.connect(sys.argv[1])\nc.execute('PRAGMA user_version = 24')\nc.execute('CREATE TABLE t (x)')\nc.execute('INSERT INTO t VALUES (1)')\nc.commit()\nc.close()", f.dbPath);
  const before = readFileSync(f.dbPath);
  const files = () => readdirSync(f.caseData).filter((name) => name !== "assemble-general").sort();
  const listed = files();
  writeFileSync(join(f.draft, DOCX), "stand-in");

  f.run({ enclosures: [{ label: "Missing", path: join(f.outside, "missing.pdf") }] });

  assert.ok(existsSync(join(f.subfolder, "enclosures.json")), "the bind did not run");
  assert.deepEqual(readFileSync(f.dbPath), before);
  assert.deepEqual(files(), listed);
  assert.deepEqual(readdirSync(f.draft), [DOCX]);
});

test("assemble_general: refuses a docx_name or pdf_name that is a path, or of the wrong kind, before writing anything", (t) => {
  const f = matter(t);
  for (const value of ["..", ".", "a\\b.docx", "a/b.docx", "C:x.docx", "..\\x.docx"]) {
    assert.equal(codeOf(() => f.run({ docx_name: value })), "path_out_of_scope", value);
    assert.equal(codeOf(() => f.run({ pdf_name: value.replace(".docx", ".pdf") })), "path_out_of_scope", value);
  }
  assert.throws(() => f.run({ docx_name: "Letter.pdf" }), /docx_name must be a file name ending \.docx/);
  assert.throws(() => f.run({ pdf_name: "Letter.docx" }), /pdf_name must be a file name ending \.pdf/);
  assert.throws(() => f.run({ enclosures: [{ label: "A", path: 4 }] }), /enclosures must be a list/);
  assert.deepEqual(readdirSync(f.draft), []);
  assert.equal(existsSync(f.subfolder), false);
});

test("assemble_general: refuses a matter_root without coclerk.json, and a matter whose case-data folder does not exist", (t) => {
  const f = matter(t);
  assert.equal(codeOf(() => f.run({ matter_root: f.outside })), "invalid_root");
  rmSync(f.caseData, { recursive: true });
  assert.equal(codeOf(() => f.run()), "case_data_missing");
  assert.equal(existsSync(f.subfolder), false);
});

test("assemble_general: refuses an assemble-general folder, docx_name, pdf_name or 0. DRAFT folder that is a link elsewhere, writing nothing", (t) => {
  const f = matter(t);
  symlinkSync(f.outside, f.subfolder, "junction");
  assert.equal(codeOf(() => f.run()), "path_out_of_scope");
  assert.deepEqual(readdirSync(f.outside), []);
  rmSync(f.subfolder);

  // A junction stands in for a file link, which Windows grants only with a privilege.
  for (const [key, name] of [["docx_name", "Linked.docx"], ["pdf_name", "Linked.pdf"]]) {
    symlinkSync(f.outside, join(f.draft, name), "junction");
    assert.equal(codeOf(() => f.run({ [key]: name })), "path_out_of_scope", key);
    rmSync(join(f.draft, name));
  }
  assert.equal(existsSync(f.subfolder), false);

  rmSync(f.draft, { recursive: true });
  symlinkSync(f.outside, f.draft, "junction");
  assert.equal(codeOf(() => f.run()), "path_out_of_scope");
  assert.deepEqual(readdirSync(f.outside), []);
  assert.equal(existsSync(f.subfolder), false);
});

test("assemble_general: refuses a matter with no 0. DRAFT folder, or with two, creating none", (t) => {
  const f = matter(t);
  mkdirSync(join(f.root, "0. DRAFT old"));
  assert.equal(codeOf(() => f.run()), "draft_dir_ambiguous");
  rmSync(join(f.root, "0. DRAFT old"), { recursive: true });
  rmSync(f.draft, { recursive: true });
  assert.equal(codeOf(() => f.run()), "draft_dir_missing");
  assert.deepEqual(readdirSync(f.root).filter((name) => /^0\. DRAFT/i.test(name)), []);
  assert.equal(existsSync(f.subfolder), false);
});

test("assemble_general: an enclosure may come from any path; the binder names every unresolved one, unchanged", (t) => {
  const f = matter(t);
  writeFileSync(join(f.draft, DOCX), "stand-in");
  const away = join(f.outside, "Precedent from another matter.pdf");
  const result = f.run({
    enclosures: [
      { label: "Precedent", path: away },
      { label: "Prior letter", path: "3. CORRESPONDENCE\\prior.pdf", pages: "4" },
    ],
  });
  assert.equal(result.success, false);
  assert.equal(result.error, "enclosure_unresolved");
  assert.deepEqual(result.detail.map((d) => d.enclosure), ["Precedent", "Prior letter"]);
  assert.match(result.detail[0].reason, /Precedent from another matter\.pdf/);

  const manifest = JSON.parse(readFileSync(join(f.subfolder, "enclosures.json"), "utf-8"));
  assert.deepEqual(manifest, {
    docx: join(f.draft, DOCX),
    output: null,
    enclosures: [
      { label: "Precedent", path: away },
      { label: "Prior letter", path: join(f.root, "3. CORRESPONDENCE", "prior.pdf"), pages: "4" },
    ],
  });
  assert.deepEqual(readdirSync(f.draft), [DOCX]);
});

test("assemble_general: docx_missing and output_exists come back unchanged, and the taken PDF is untouched", (t) => {
  const f = matter(t);
  assert.equal(f.run().error, "docx_missing");
  writeFileSync(join(f.draft, DOCX), "stand-in");
  writeFileSync(join(f.draft, UNSIGNED), "KEEP");
  const taken = f.run();
  assert.equal(taken.error, "output_exists");
  assert.equal(readFileSync(join(f.draft, UNSIGNED), "utf-8"), "KEEP");
});

test("assemble_general: a bind killed by the time budget leaves no PDF and says how to proceed", (t) => {
  const f = matter(t);
  writeFileSync(join(f.draft, DOCX), "stand-in");
  let err;
  try {
    f.run({}, { ...process.env, COCLERK_ASSEMBLE_BIND_TIMEOUT_MS: "1" });
  } catch (e) {
    err = e;
  }
  assert.equal(err?.code, "python_timeout");
  assert.match(err.message, /call this tool again/);
  assert.match(err.message, /Claude Code \(PC\) session/);
  assert.equal(existsSync(join(f.draft, UNSIGNED)), false);
});

/** Why the real bind cannot run here, or null when it can. */
function realBindUnavailable() {
  const modules = spawnSync(PYTHON, ["-c", "import pymupdf, lxml, docx"], { encoding: "utf-8" });
  if (modules.status !== 0) return "the host Python lacks pymupdf, lxml or python-docx";
  const word = process.platform === "win32" && spawnSync("reg", ["query", "HKCR\\Word.Application"]).status === 0;
  const soffice = spawnSync("soffice", ["--version"]).status === 0;
  return word || soffice ? null : "neither Word nor LibreOffice is installed";
}

test("assemble_general: binds a .docx and a page range of a PDF into one PDF at the top of 0. DRAFT", { skip: realBindUnavailable() ?? false }, (t) => {
  const f = matter(t);
  const docx = join(f.draft, DOCX);
  python("import sys\nfrom docx import Document\nd = Document()\nd.add_paragraph('Dear Bert,')\nd.save(sys.argv[1])", docx);
  const prior = join(f.outside, "prior letter.pdf");
  python(PDF, prior, "5");

  const result = f.run({ pdf_name: "Letter v2 UNSIGNED.pdf", enclosures: [{ label: "Pages 2 to 3", path: prior, pages: "2-3" }] });

  const out = join(f.draft, "Letter v2 UNSIGNED.pdf");
  assert.deepEqual(result, { success: true, output: out, page_count: 3, bookmarks: 2 });
  assert.deepEqual(pdfFacts(out), [3, 2]);
  assert.deepEqual(readdirSync(f.draft).sort(), [DOCX, "Letter v2 UNSIGNED.pdf"].sort());
});
