import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const { fileOpsTrash } = await import("../build/file_ops/trash.js");

const NOW = new Date(2026, 8, 14, 9, 30, 5);
const SUFFIX = " (trashed 2026-09-14 093005)";

/** A throwaway matter folder with a coclerk.json, drafts, a firewall zone and a TRASH folder. */
function matterFixture() {
  const root = realpathSync.native(mkdtempSync(join(tmpdir(), "coclerk-trash-matter-")));
  const files = {
    "coclerk.json": "{}",
    "0. DRAFT/x.md": "draft body\n",
    "0. DRAFT/SUB folder/a.md": "a\n",
    "0. DRAFT/SUB folder/b.md": "b\n",
    "4. LAWYER BRIEF/CoWork/privileged/p.md": "p\n",
    "4. LAWYER BRIEF/CoWork/disclosed/d.md": "d\n",
    "0. CASE DATA/main.sqlite": "db\n",
    "TRASH/old.md": "old\n",
  };
  for (const [rel, body] of Object.entries(files)) {
    mkdirSync(join(root, rel, ".."), { recursive: true });
    writeFileSync(join(root, rel), body);
  }
  return {
    root,
    at: (rel) => join(root, ...rel.split("/")),
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

const sha = (p) => createHash("sha256").update(readFileSync(p)).digest("hex");

test("file_ops__trash refuses, touching nothing, with a stable code for each boundary", () => {
  const m = matterFixture();
  const repo = mkdtempSync(join(tmpdir(), "coclerk-trash-repo-"));
  const loose = mkdtempSync(join(tmpdir(), "coclerk-trash-loose-"));
  try {
    mkdirSync(join(repo, ".git"));
    writeFileSync(join(repo, "coclerk.json"), "{}");
    writeFileSync(join(repo, "tracked.md"), "t\n");
    writeFileSync(join(loose, "file.md"), "f\n");

    assert.equal(codeOf(() => fileOpsTrash("0. DRAFT/x.md")), "invalid_path");
    assert.equal(codeOf(() => fileOpsTrash(m.at("0. DRAFT/missing.md"))), "not_found");
    assert.equal(codeOf(() => fileOpsTrash(join(m.root, "no such dir", "x.md"))), "not_found");
    assert.equal(codeOf(() => fileOpsTrash(join(repo, "tracked.md"))), "git_worktree");
    assert.equal(codeOf(() => fileOpsTrash(join(loose, "file.md"))), "not_a_matter_file");
    for (const rel of [
      "",
      "coclerk.json",
      "TRASH",
      "TRASH/old.md",
      "0. CASE DATA",
      "0. CASE DATA/main.sqlite",
      "4. LAWYER BRIEF/CoWork/privileged",
      "4. LAWYER BRIEF/CoWork/privileged/p.md",
      "4. LAWYER BRIEF/CoWork/disclosed/d.md",
    ]) {
      assert.equal(codeOf(() => fileOpsTrash(rel ? m.at(rel) : m.root)), "protected", rel || "(root)");
    }

    assert.ok(existsSync(join(repo, "tracked.md")));
    assert.ok(existsSync(m.at("4. LAWYER BRIEF/CoWork/privileged/p.md")));
    assert.equal(existsSync(m.at("TRASH/.trash-log.jsonl")), false);
  } finally {
    m.cleanup();
    rmSync(repo, { recursive: true, force: true });
    rmSync(loose, { recursive: true, force: true });
  }
});

test("file_ops__trash dry_run returns the plan and moves nothing", () => {
  const m = matterFixture();
  try {
    const plan = fileOpsTrash(m.at("0. DRAFT/x.md"), true, NOW);
    assert.deepEqual(plan, {
      would_move_from: m.at("0. DRAFT/x.md"),
      would_move_to: m.at("TRASH/0. DRAFT/x.md"),
    });
    assert.ok(existsSync(m.at("0. DRAFT/x.md")));
    assert.equal(existsSync(m.at("TRASH/0. DRAFT")), false);
  } finally {
    m.cleanup();
  }
});

test("file_ops__trash moves a file byte-identical into TRASH and logs one line", () => {
  const m = matterFixture();
  try {
    const before = sha(m.at("0. DRAFT/x.md"));
    const result = fileOpsTrash(m.at("0. DRAFT/x.md"), false, NOW);

    assert.deepEqual(result, {
      moved_from: m.at("0. DRAFT/x.md"),
      moved_to: m.at("TRASH/0. DRAFT/x.md"),
      kind: "file",
      bytes: Buffer.byteLength("draft body\n"),
    });
    assert.equal(existsSync(m.at("0. DRAFT/x.md")), false);
    assert.equal(sha(m.at("TRASH/0. DRAFT/x.md")), before);

    const lines = readFileSync(m.at("TRASH/.trash-log.jsonl"), "utf-8").trim().split("\n");
    assert.equal(lines.length, 1);
    assert.deepEqual(JSON.parse(lines[0]), {
      when: NOW.toISOString(),
      from: m.at("0. DRAFT/x.md"),
      to: m.at("TRASH/0. DRAFT/x.md"),
    });
  } finally {
    m.cleanup();
  }
});

test("file_ops__trash moves a folder with its entries", () => {
  const m = matterFixture();
  try {
    const result = fileOpsTrash(m.at("0. DRAFT/SUB folder"), false, NOW);
    assert.equal(result.kind, "dir");
    assert.equal(result.entries, 2);
    assert.equal(existsSync(m.at("0. DRAFT/SUB folder")), false);
    assert.equal(readFileSync(m.at("TRASH/0. DRAFT/SUB folder/a.md"), "utf-8"), "a\n");
  } finally {
    m.cleanup();
  }
});

test("file_ops__trash suffixes a taken destination: before the extension for a file, at the end for a folder", () => {
  const m = matterFixture();
  try {
    mkdirSync(m.at("TRASH/0. DRAFT/SUB folder"), { recursive: true });
    writeFileSync(m.at("TRASH/0. DRAFT/x.md"), "earlier trash\n");

    const file = fileOpsTrash(m.at("0. DRAFT/x.md"), false, NOW);
    assert.equal(file.moved_to, m.at(`TRASH/0. DRAFT/x${SUFFIX}.md`));
    assert.equal(readFileSync(m.at("TRASH/0. DRAFT/x.md"), "utf-8"), "earlier trash\n");

    const dir = fileOpsTrash(m.at("0. DRAFT/SUB folder"), false, NOW);
    assert.equal(dir.moved_to, m.at(`TRASH/0. DRAFT/SUB folder${SUFFIX}`));

    writeFileSync(m.at("0. DRAFT/x.md"), "again\n");
    assert.equal(codeOf(() => fileOpsTrash(m.at("0. DRAFT/x.md"), false, NOW)), "dest_exists");
    assert.equal(readFileSync(m.at("0. DRAFT/x.md"), "utf-8"), "again\n");
  } finally {
    m.cleanup();
  }
});
