import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const { skillSourceRead, skillSourceList } = await import("../build/files/skill-source.js");
const { repoDocsWrite } = await import("../build/files/repo-docs.js");
const { assertContained } = await import("../build/files/scope.js");

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..", "..", "..", "..");

// ---------------------------------------------------------------- fixtures --

/** A throwaway repo root carrying both authoritative skills trees. */
function skillsFixture() {
  const root = mkdtempSync(join(tmpdir(), "coclerk-skills-"));
  const skills = join(root, "source", "skills");
  const claudeSkills = join(root, "source", "skills");
  mkdirSync(join(skills, "demo", "stages"), { recursive: true });
  mkdirSync(join(skills, "shared"), { recursive: true });
  mkdirSync(join(claudeSkills, "matter-data", "operations"), { recursive: true });
  writeFileSync(join(skills, "demo", "SKILL.md"), "# demo\nsee shared/conventions.md\n");
  writeFileSync(join(skills, "demo", "stages", "01-intake.md"), "intake\n");
  writeFileSync(join(skills, "shared", "conventions.md"), "conventions\n");
  writeFileSync(
    join(claudeSkills, "matter-data", "SKILL.md"),
    "# matter-data\nsee operations/ingest.md\n",
  );
  writeFileSync(join(claudeSkills, "matter-data", "operations", "ingest.md"), "ingest\n");
  writeFileSync(join(root, "outside.md"), "SECRET\n");
  return {
    env: { COCLERK_REPO_ROOT: root },
    root,
    skills,
    claudeSkills,
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

// ------------------------------------------------------- skill_source__read --

test("skill_source__read returns content, size, sha256, and the containing dir", () => {
  const f = skillsFixture();
  try {
    const root = skillSourceRead("demo/SKILL.md", f.env);
    assert.equal(root.path, "demo/SKILL.md");
    assert.equal(root.dir, "demo");
    assert.equal(root.content, "# demo\nsee shared/conventions.md\n");
    assert.equal(root.size, Buffer.byteLength(root.content));
    assert.equal(root.sha256, createHash("sha256").update(root.content).digest("hex"));

    const nested = skillSourceRead("demo/stages/01-intake.md", f.env);
    assert.equal(nested.dir, "demo/stages");

    // Backslashes are accepted and normalized.
    assert.equal(skillSourceRead("demo\\stages\\01-intake.md", f.env).path, "demo/stages/01-intake.md");
  } finally {
    f.cleanup();
  }
});

test("skill_source__read round-trips a real repo file byte-for-byte", () => {
  const env = { COCLERK_REPO_ROOT: REPO_ROOT };
  const result = skillSourceRead("matter-data/references/scripts/compute_hash.py", env);
  const onDisk = readFileSync(join(REPO_ROOT, "source", "skills", "matter-data", "references", "scripts", "compute_hash.py"));
  assert.equal(result.content, onDisk.toString("utf-8"));
  assert.equal(result.size, onDisk.byteLength);
  assert.equal(result.sha256, createHash("sha256").update(onDisk).digest("hex"));
  assert.equal(result.dir, "matter-data/references/scripts");
});

// A `match` read is a slice, so it earns its place only if the slice is whole.
// The acceptance test is the one #752 names: the complete `filings` contract out
// of a 670-line sqlite_master dump, with no offset known in advance.
test("skill_source__read `match` returns a table's complete contract from schema.sql", () => {
  const env = { COCLERK_REPO_ROOT: REPO_ROOT };
  const path = "drafting-data/references/schema.sql";
  const whole = skillSourceRead(path, env);
  const sliced = skillSourceRead(path, env, undefined, "filings");

  // Whole-file identity travels with the slice, so the caller can tell what it
  // was cut from -- and that it was cut.
  assert.equal(sliced.size, whole.size);
  assert.equal(sliced.sha256, whole.sha256);
  assert.ok(sliced.blocks_matched > 0);
  assert.ok(sliced.blocks_matched < sliced.blocks_total);
  assert.ok(sliced.content.length < whole.content.length / 2);

  // The CREATE TABLE block entire. None of these column lines contains the word
  // "filings", so a line match would drop every one of them.
  assert.match(sliced.content, /CREATE TABLE "filings" \(/);
  for (const column of [
    "proceeding_id", "kind", "subkind", "round", "title",
    "filed_on", "decided_on", "retired_on", "retirement_reason", "entered_on",
  ]) {
    assert.ok(sliced.content.includes(column), `slice is missing column ${column}`);
  }

  // The revision triggers, and the guard further on that aborts the insert
  // outright when a needs-forum Writing's proceeding has no forum (schema v30).
  assert.match(sliced.content, /CREATE TRIGGER rev_filings_ins/);
  assert.match(sliced.content, /CREATE TRIGGER guard_filings_need_forum_ins/);
  assert.match(sliced.content, /a Writing that needs forum parts needs its proceeding''s forum chosen first/);
});

test("skill_source__read without `match` is unchanged", () => {
  const env = { COCLERK_REPO_ROOT: REPO_ROOT };
  const result = skillSourceRead("drafting-data/references/schema.sql", env);
  assert.equal(result.blocks_matched, undefined);
  assert.equal(result.blocks_total, undefined);
  assert.equal(result.size, Buffer.byteLength(result.content, "utf-8"));
});

test("skill_source__read `match` ORs several terms and hard-fails on a miss", () => {
  const f = skillsFixture();
  try {
    writeFileSync(
      join(f.skills, "demo", "blocks.md"),
      "alpha one\nalpha two\n\nbeta one\n\ngamma one\n",
    );
    const one = skillSourceRead("demo/blocks.md", f.env, undefined, "alpha");
    assert.equal(one.content, "alpha one\nalpha two");
    assert.equal(one.blocks_matched, 1);
    assert.equal(one.blocks_total, 3);

    const two = skillSourceRead("demo/blocks.md", f.env, undefined, ["alpha", "gamma"]);
    assert.equal(two.content, "alpha one\nalpha two\n\ngamma one");
    assert.equal(two.blocks_matched, 2);

    // Case-insensitive, literal -- no regex surface.
    assert.equal(skillSourceRead("demo/blocks.md", f.env, undefined, "BETA").blocks_matched, 1);
    assert.equal(codeOf(() => skillSourceRead("demo/blocks.md", f.env, undefined, "be.a")), "no_match");

    // A term the file words differently must never read as an empty success.
    assert.equal(codeOf(() => skillSourceRead("demo/blocks.md", f.env, undefined, "delta")), "no_match");
    assert.equal(codeOf(() => skillSourceRead("demo/blocks.md", f.env, undefined, "")), "invalid_match");
    assert.equal(codeOf(() => skillSourceRead("demo/blocks.md", f.env, undefined, [])), "invalid_match");
  } finally {
    f.cleanup();
  }
});

test("skill_source__read serves skills rooted at source/skills", () => {
  const f = skillsFixture();
  try {
    const root = skillSourceRead("matter-data/SKILL.md", f.env);
    assert.equal(root.path, "matter-data/SKILL.md");
    assert.equal(root.dir, "matter-data");
    assert.equal(root.content, "# matter-data\nsee operations/ingest.md\n");

    const child = skillSourceRead(
      "operations/ingest.md",
      f.env,
      root.path,
    );
    assert.equal(child.path, "matter-data/operations/ingest.md");
    assert.equal(child.content, "ingest\n");
    assert.equal(
      skillSourceRead("../../shared/conventions.md", f.env, child.path).path,
      "shared/conventions.md",
    );

    assert.equal(
      skillSourceRead("matter-data/SKILL.md", f.env).path,
      "matter-data/SKILL.md",
    );
    assert.deepEqual(
      skillSourceList("matter-data", true, f.env).entries.map((e) => e.path),
      [
        "matter-data/SKILL.md",
        "matter-data/operations",
        "matter-data/operations/ingest.md",
      ],
    );
  } finally {
    f.cleanup();
  }
});

test("skill_source__read accepts a reference in every form skill text uses", () => {
  const f = skillsFixture();
  try {
    // The agent passes references through verbatim; only file-relative ones get
    // joined to the returned `dir` first. Every form below names the same file.
    for (const form of [
      "shared/conventions.md",
      "shared\\conventions.md",
      "shared/conventions.md",
      ".claude\\skills\\shared\\conventions.md",
      "source/skills/shared/conventions.md",
      join(f.root, "source", "skills", "shared", "conventions.md"),
      "demo/../shared/conventions.md",
      "demo/stages/../../shared/conventions.md",
    ]) {
      const result = skillSourceRead(form, f.env);
      assert.equal(result.path, "shared/conventions.md", form);
      assert.equal(result.dir, "shared", form);
    }

    // ...and the same forms work for list.
    assert.deepEqual(
      skillSourceList("demo/stages", false, f.env).entries.map((e) => e.path),
      ["demo/stages/01-intake.md"],
    );
    assert.deepEqual(
      skillSourceList("demo/stages/..", false, f.env).entries.map((e) => e.path),
      ["demo/SKILL.md", "demo/stages"],
    );
  } finally {
    f.cleanup();
  }
});

test("skill_source__read resolves a reference against `from` by either convention", () => {
  const f = skillsFixture();
  try {
    // The exact ambiguity a real skill once hit (responding-to-applications,
    // retired 2026-08-27 #374): one stage file cited `../shared/conventions.md`
    // on one line and `shared/conventions.md` on another, meaning one file.
    // Both must resolve, passed verbatim.
    const anchor = "demo/stages/01-intake.md";
    for (const ref of ["../../shared/conventions.md", "shared/conventions.md"]) {
      assert.equal(skillSourceRead(ref, f.env, anchor).path, "shared/conventions.md", ref);
    }

    // Containing dir wins over skill root, and the returned path says which.
    assert.equal(skillSourceRead("01-intake.md", f.env, anchor).path, "demo/stages/01-intake.md");
    // Skill root, from a file one level down.
    assert.equal(skillSourceRead("SKILL.md", f.env, anchor).path, "demo/SKILL.md");
    // Tree root still reachable when neither of the above has it.
    assert.equal(skillSourceRead("demo/SKILL.md", f.env, anchor).path, "demo/SKILL.md");

    // An explicit source/skills/ prefix is tree-rooted as written; `from` is
    // not consulted, so it must not be mis-resolved under the anchor's dir.
    assert.equal(
      skillSourceRead("shared/conventions.md", f.env, anchor).path,
      "shared/conventions.md",
    );

    // `from` never widens scope: an escape is still refused, and a genuinely
    // missing file still fails rather than silently resolving elsewhere.
    assert.equal(codeOf(() => skillSourceRead("../../../outside.md", f.env, anchor)), "path_out_of_scope");
    assert.equal(codeOf(() => skillSourceRead("nope.md", f.env, anchor)), "not_found");

    // Omitting `from` keeps the pre-existing contract exactly.
    assert.equal(skillSourceRead("demo/SKILL.md", f.env).path, "demo/SKILL.md");
    assert.equal(codeOf(() => skillSourceRead("SKILL.md", f.env)), "not_found");
  } finally {
    f.cleanup();
  }
});

test("skill_source__read refuses everything outside the skills tree", () => {
  const f = skillsFixture();
  try {
    for (const bad of [
      "../outside.md",
      "demo/../../outside.md",
      // Escaping `..` survives normalization, so the prefix-stripping and
      // `..`-collapsing above buy an escape attempt nothing.
      "../../outside.md",
      ".claude\\skills\\..\\..\\outside.md",
      "C:\\Windows\\win.ini",
      "\\\\server\\share\\x.md",
      "//server/share/x.md",
      "/etc/passwd",
      "\\demo\\SKILL.md",
    ]) {
      assert.equal(codeOf(() => skillSourceRead(bad, f.env)), "path_out_of_scope", bad);
    }
    assert.equal(codeOf(() => skillSourceRead("demo/nope.md", f.env)), "not_found");
    assert.equal(codeOf(() => skillSourceRead("demo", f.env)), "not_found");
  } finally {
    f.cleanup();
  }
});

test("containment is case-insensitive and not fooled by a sibling prefix", () => {
  const f = skillsFixture();
  try {
    // A case-variant root still resolves to the same canonical tree.
    const upper = { COCLERK_REPO_ROOT: f.root.toUpperCase() };
    assert.equal(skillSourceRead("demo/SKILL.md", upper).path, "demo/SKILL.md");

    // Containment itself: case-folded, and separator-anchored so a directory
    // whose name merely starts with the root's name cannot pass.
    assert.doesNotThrow(() => assertContained("C:\\repo", "C:\\REPO\\a\\b.md", "path", "a/b.md"));
    assert.doesNotThrow(() => assertContained("C:\\repo", "C:\\repo", "path", ""));
    assert.equal(
      codeOf(() => assertContained("C:\\repo", "C:\\repo-evil\\b.md", "path", "b.md")),
      "path_out_of_scope",
    );
  } finally {
    f.cleanup();
  }
});

test("skill_source__read resolves junctions and refuses one that escapes", (t) => {
  const f = skillsFixture();
  const outside = mkdtempSync(join(tmpdir(), "coclerk-outside-"));
  writeFileSync(join(outside, "secret.md"), "SECRET\n");
  const link = join(f.skills, "escape");
  const made = spawnSync("cmd", ["/c", "mklink", "/J", link, outside], { encoding: "utf-8" });
  try {
    if (made.status !== 0) {
      t.skip(`could not create a junction: ${made.stderr || made.stdout}`);
      return;
    }
    assert.equal(codeOf(() => skillSourceRead("escape/secret.md", f.env)), "path_out_of_scope");
  } finally {
    rmSync(link, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
    f.cleanup();
  }
});

test("a missing skills tree fails per call, not at startup", () => {
  const env = { COCLERK_REPO_ROOT: join(tmpdir(), "coclerk-does-not-exist-12345") };
  assert.equal(codeOf(() => skillSourceRead("demo/SKILL.md", env)), "skills_root_missing");
  // Auto-detection off: this asserts the no-configuration failure. Without the
  // flag, the walk-up candidate would find this checkout's own repo (the suite
  // runs from inside it) and the call would wrongly succeed.
  assert.equal(
    codeOf(() => skillSourceRead("demo/SKILL.md", { COCLERK_REPO_ROOT_AUTODETECT: "0" })),
    "skills_root_missing",
  );
});

// ------------------------------------------------------- skill_source__list --

test("skill_source__list lists a directory, and recurses on request", () => {
  const f = skillsFixture();
  try {
    const root = skillSourceList("", false, f.env);
    assert.deepEqual(root.entries.map((e) => e.path), ["demo", "matter-data", "shared"]);
    assert.deepEqual(root.entries.map((e) => e.type), ["dir", "dir", "dir"]);

    const deep = skillSourceList("demo", true, f.env);
    assert.deepEqual(deep.entries.map((e) => e.path), [
      "demo/SKILL.md",
      "demo/stages",
      "demo/stages/01-intake.md",
    ]);
    assert.equal(
      deep.entries.find((e) => e.path === "demo/SKILL.md").size,
      readFileSync(join(f.skills, "demo", "SKILL.md")).byteLength,
    );
    assert.equal(deep.entries.find((e) => e.path === "demo/stages").size, null);

    assert.equal(codeOf(() => skillSourceList("../", false, f.env)), "path_out_of_scope");
    assert.equal(codeOf(() => skillSourceList("demo/SKILL.md", false, f.env)), "not_found");
  } finally {
    f.cleanup();
  }
});

// --------------------------------------------------------- repo_docs__write --

/** A throwaway repo root carrying a docs/ tree. */
function docsFixture() {
  const root = mkdtempSync(join(tmpdir(), "coclerk-docs-"));
  mkdirSync(join(root, "docs", "E2E-tests"), { recursive: true });
  writeFileSync(join(root, "docs", "existing.md"), "original\n");
  writeFileSync(join(root, "outside.md"), "SECRET\n");
  return {
    env: { COCLERK_REPO_ROOT: root },
    root,
    docs: join(root, "docs"),
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

test("repo_docs__write creates a file, making intermediate directories inside docs/", () => {
  const f = docsFixture();
  try {
    const result = repoDocsWrite("E2E-tests/sub/2026-07-19 demo-e2e-test.md", "# report\n", false, f.env);
    assert.equal(result.path, "E2E-tests/sub/2026-07-19 demo-e2e-test.md");
    assert.equal(result.created, true);
    assert.equal(result.bytes, Buffer.byteLength("# report\n"));
    assert.equal(
      readFileSync(join(f.docs, "E2E-tests", "sub", "2026-07-19 demo-e2e-test.md"), "utf-8"),
      "# report\n"
    );

    // Backslash form is accepted and normalized like the skill-source surface.
    const back = repoDocsWrite("E2E-tests\\sub2\\x.md", "x\n", false, f.env);
    assert.equal(back.path, "E2E-tests/sub2/x.md");
  } finally {
    f.cleanup();
  }
});

test("repo_docs__write refuses an existing file without overwrite, replaces with it", () => {
  const f = docsFixture();
  try {
    assert.equal(codeOf(() => repoDocsWrite("existing.md", "new\n", false, f.env)), "exists");
    assert.equal(readFileSync(join(f.docs, "existing.md"), "utf-8"), "original\n");

    const result = repoDocsWrite("existing.md", "new\n", true, f.env);
    assert.equal(result.created, false);
    assert.equal(readFileSync(join(f.docs, "existing.md"), "utf-8"), "new\n");
  } finally {
    f.cleanup();
  }
});

test("repo_docs__write rejects every path form that leaves docs/", () => {
  const f = docsFixture();
  try {
    assert.equal(codeOf(() => repoDocsWrite("../outside.md", "x", false, f.env)), "path_out_of_scope");
    assert.equal(codeOf(() => repoDocsWrite("..\\outside.md", "x", false, f.env)), "path_out_of_scope");
    assert.equal(codeOf(() => repoDocsWrite("C:\\evil.md", "x", false, f.env)), "path_out_of_scope");
    assert.equal(codeOf(() => repoDocsWrite("/rooted.md", "x", false, f.env)), "path_out_of_scope");
    assert.equal(codeOf(() => repoDocsWrite("\\\\unc\\share\\x.md", "x", false, f.env)), "path_out_of_scope");
    assert.equal(codeOf(() => repoDocsWrite("a/../../outside.md", "x", false, f.env)), "path_out_of_scope");
    assert.equal(codeOf(() => repoDocsWrite("", "x", false, f.env)), "path_out_of_scope");
    // Nothing escaped onto disk.
    assert.equal(readFileSync(join(f.root, "outside.md"), "utf-8"), "SECRET\n");
  } finally {
    f.cleanup();
  }
});

test("repo_docs__write refuses a directory target and a missing docs tree", () => {
  const f = docsFixture();
  try {
    assert.equal(codeOf(() => repoDocsWrite("E2E-tests", "x", true, f.env)), "invalid_path");
  } finally {
    f.cleanup();
  }

  const bare = mkdtempSync(join(tmpdir(), "coclerk-nodocs-"));
  try {
    assert.equal(
      codeOf(() => repoDocsWrite("x.md", "x", false, { COCLERK_REPO_ROOT: bare })),
      "docs_root_missing"
    );
    // Auto-detection off: without this flag the walk-up candidate would find
    // this checkout's own repo (the suite runs from inside it), and this call
    // would actually write x.md into the real docs/ tree instead of throwing.
    assert.equal(
      codeOf(() => repoDocsWrite("x.md", "x", false, { COCLERK_REPO_ROOT_AUTODETECT: "0" })),
      "docs_root_missing",
    );
  } finally {
    rmSync(bare, { recursive: true, force: true });
  }
});
