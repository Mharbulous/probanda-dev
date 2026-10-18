import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const { repoDocsRead } = await import("../build/files/repo-docs.js");
const { buildToolDefinitions } = await import("../build/schema-gen.js");

/** A throwaway repo root carrying a docs/ tree. */
function docsFixture() {
  const root = mkdtempSync(join(tmpdir(), "coclerk-docs-read-"));
  mkdirSync(join(root, "docs", "algorithm", "cycle-1"), { recursive: true });
  writeFileSync(join(root, "docs", "algorithm", "cycle-1", "ledger.json"), '{"rev": 3}\n');
  writeFileSync(join(root, "outside.md"), "SECRET\n");
  return {
    env: { COCLERK_REPO_ROOT: root },
    root,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

function codeOf(fn) {
  try {
    fn();
  } catch (err) {
    return err.code;
  }
  throw new Error("expected a throw, got none");
}

test("repo_docs__read returns a docs/ file's text and its docs-relative path", () => {
  const f = docsFixture();
  try {
    const result = repoDocsRead("algorithm/cycle-1/ledger.json", f.env);
    assert.deepEqual(result, { path: "algorithm/cycle-1/ledger.json", content: '{"rev": 3}\n' });

    // Backslash form is accepted and normalized like the write side.
    assert.equal(repoDocsRead("algorithm\\cycle-1\\ledger.json", f.env).path, "algorithm/cycle-1/ledger.json");
  } finally {
    f.cleanup();
  }
});

test("repo_docs__read refuses `..` escapes and absolute paths", () => {
  const f = docsFixture();
  try {
    assert.equal(codeOf(() => repoDocsRead("../outside.md", f.env)), "path_out_of_scope");
    assert.equal(codeOf(() => repoDocsRead("..\\outside.md", f.env)), "path_out_of_scope");
    assert.equal(codeOf(() => repoDocsRead("algorithm/../../outside.md", f.env)), "path_out_of_scope");
    assert.equal(codeOf(() => repoDocsRead(join(f.root, "outside.md"), f.env)), "path_out_of_scope");
    assert.equal(codeOf(() => repoDocsRead("C:\\evil.md", f.env)), "path_out_of_scope");
    assert.equal(codeOf(() => repoDocsRead("/rooted.md", f.env)), "path_out_of_scope");
    assert.equal(codeOf(() => repoDocsRead("\\\\unc\\share\\x.md", f.env)), "path_out_of_scope");
    assert.equal(codeOf(() => repoDocsRead("", f.env)), "path_out_of_scope");
  } finally {
    f.cleanup();
  }
});

test("repo_docs__read gives not_found for a missing file and invalid_path for a directory", () => {
  const f = docsFixture();
  try {
    assert.equal(codeOf(() => repoDocsRead("algorithm/cycle-1/missing.json", f.env)), "not_found");
    assert.equal(codeOf(() => repoDocsRead("algorithm", f.env)), "invalid_path");
  } finally {
    f.cleanup();
  }
});

test("repo_docs__read is registered as a read-only tool taking only `path`", () => {
  const tool = buildToolDefinitions().find((definition) => definition.name === "repo_docs__read");
  assert.ok(tool, "not in buildToolDefinitions()");
  assert.equal(tool.annotations.readOnlyHint, true);
  assert.deepEqual(tool.inputSchema.required, ["path"]);
  assert.deepEqual(Object.keys(tool.inputSchema.properties), ["path"]);
});
