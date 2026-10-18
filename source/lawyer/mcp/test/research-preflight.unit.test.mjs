// research__preflight: one test per row state, with the host extractor replaced by a seam so no
// Python runs. The knowledge tree is knowledge-fixture.mjs's install plus a temporary APPDATA.
// research-preflight.db.test.mjs probes the real extractor.

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { knowledgeFixture } from "./helpers/knowledge-fixture.mjs";

const { researchPreflight } = await import("../build/research/preflight.js");

const PYPDF_FATAL = "pypdf is not installed for C:\\Python\\python.exe (No module named 'pypdf'): pip install pypdf";

/** An extractor that reads nothing: each probe path comes back unreadable, as a working one reports it. */
const workingExtract = (paths) => paths.map((path) => ({ path, file_name: "probe", kind: "other", pages: null, text_by_page: null, error: "No such file" }));

test("every row ok: no issues, chrome not checked", (t) => {
  const f = knowledgeFixture(t);
  const result = researchPreflight({ ...f.seams, extract: workingExtract });
  assert.deepEqual(result, {
    extractor: { pdf: "ok", docx: "ok" },
    knowledge_tree: "ok",
    chrome: "not_checked",
    issues: [],
  });
});

test("pypdf missing: the pdf row is missing with the install step, docx stays ok", (t) => {
  const f = knowledgeFixture(t);
  const extract = (paths) => {
    if (paths.some((p) => p.endsWith(".pdf"))) throw new Error(PYPDF_FATAL);
    return workingExtract(paths);
  };
  const result = researchPreflight({ ...f.seams, extract });
  assert.deepEqual(result.extractor, { pdf: "missing", docx: "ok" });
  assert.equal(result.issues.length, 1);
  const [issue] = result.issues;
  assert.equal(issue.row, "extractor.pdf");
  assert.equal(issue.detail, PYPDF_FATAL);
  assert.match(issue.caps, /PDF in 6\. LAW comes back UNREAD/);
  assert.match(issue.fix, /pip install pypdf/);
});

test("no Python at all: both extractor rows missing, pointing at Python, not pypdf", (t) => {
  const f = knowledgeFixture(t);
  const extract = () => {
    throw new Error("pre-filing text extraction: no Python interpreter found. Install Python 3 or set COCLERK_PYTHON.");
  };
  const result = researchPreflight({ ...f.seams, extract });
  assert.deepEqual(result.extractor, { pdf: "missing", docx: "missing" });
  assert.deepEqual(result.issues.map((i) => i.row), ["extractor.pdf", "extractor.docx"]);
  for (const issue of result.issues) assert.match(issue.fix, /Install Python 3/);
});

test("per-user coclerk.json absent: the knowledge_tree row carries the runtime's own message", (t) => {
  const f = knowledgeFixture(t);
  const emptyAppData = mkdtempSync(join(tmpdir(), "coclerk-preflight-appdata-"));
  t.after(() => rmSync(emptyAppData, { recursive: true, force: true }));
  const result = researchPreflight({ ...f.seams, env: { ...f.seams.env, APPDATA: emptyAppData }, extract: workingExtract });
  assert.equal(result.knowledge_tree, "error");
  assert.deepEqual(result.extractor, { pdf: "ok", docx: "ok" });
  assert.equal(result.issues.length, 1);
  const [issue] = result.issues;
  assert.equal(issue.row, "knowledge_tree");
  assert.match(issue.detail, /Cannot locate the practice database: .*probanda\.json not found/);
  assert.match(issue.detail, /run \/lawyer:probanda-setup/);
  assert.match(issue.caps, /publisher map/);
});

test("COCLERK_CONFIG_PATH naming a missing file is reported, never a fall back to the live file", (t) => {
  const f = knowledgeFixture(t);
  const missing = join(f.scratch, "no-such-coclerk.json");
  const result = researchPreflight({ ...f.seams, env: { ...f.seams.env, COCLERK_CONFIG_PATH: missing }, extract: workingExtract });
  assert.equal(result.knowledge_tree, "error");
  assert.match(result.issues[0].detail, /COCLERK_CONFIG_PATH names .*no-such-coclerk\.json/);
});
