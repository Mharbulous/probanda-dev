// Coverage for install-first skill source (#1002): the litigation .plugin ships each
// roster skill's full source tree under `skills/` plus `skills/shared/` (native trees,
// #1266), and src/repo-root.ts's resolveShippedRoot() picks, from a path's FIRST
// SEGMENT alone, whether that path is served from the install or from a Coclerk
// checkout. `skills/shared/` is the install marker: a `skills/` dir without it is a
// checkout layout.
//
// Every test passes an explicit install root (the test seam). The default -- two
// levels above the running module's dir -- is source/practice/ in this repo,
// which has no skills/shared/, so the rest of the suite still reads the checkout.
//
// "No checkout" means COCLERK_REPO_ROOT unset and COCLERK_REPO_ROOT_AUTODETECT=0:
// without the flag, the walk-up from build/ would find this very repo.

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const { skillSourceRead, skillSourceList } = await import("../build/files/skill-source.js");
const {
  resolveShippedRoot,
  bundledSkillFolders,
  pluginVersion,
  caseDataMigrateScriptsDir,
  timecampingDataMigrateScriptsDir,
  submissionDataMigrateScriptsDir,
} = await import("../build/repo-root.js");

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..", "..", "..", "..");

const NO_CHECKOUT = Object.freeze({ COCLERK_REPO_ROOT_AUTODETECT: "0" });

function write(path, text) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}

function errorOf(fn) {
  try {
    fn();
  } catch (err) {
    return err;
  }
  throw new Error("expected a throw, got none");
}

/** An extracted .plugin install: manifest, the bundled skills/ trees, and a
 * file beside skills/ that no served path may reach. It sits two folders below its
 * own temp dir, so the sibling scan (the folders beside the install and two levels
 * up) reads this fixture alone and never the machine's whole temp dir. */
function installFixture(t) {
  const base = mkdtempSync(join(tmpdir(), "coclerk-install-"));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const root = join(base, "store", "install");
  write(join(root, ".claude-plugin", "plugin.json"), JSON.stringify({ name: "litigation", version: "9.9.9" }));
  const src = join(root, "skills");
  write(join(src, "matter-data", "SKILL.md"), "# matter-data (install)\nsee references/notes.md\n");
  write(join(src, "matter-data", "references", "notes.md"), "install notes\n");
  write(join(src, "shared", "conventions.md"), "install conventions\n");
  for (const skill of ["matter-data", "timecamping-data", "drafting-data"]) {
    write(join(src, skill, "references", "scripts", "migrate_engine.py"), "# engine\n");
  }
  write(join(root, "secret.md"), "SECRET\n");
  return { root, src };
}

/** A Coclerk checkout holding a bundled folder with DIFFERENT bytes, a file the
 * install lacks, and a non-roster folder the install does not bundle at all. */
function checkoutFixture(t) {
  const root = mkdtempSync(join(tmpdir(), "coclerk-checkout-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const skills = join(root, ".claude", "skills");
  write(join(skills, "matter-data", "SKILL.md"), "# matter-data (checkout)\n");
  write(join(skills, "matter-data", "only-in-checkout.md"), "checkout only\n");
  write(join(skills, "devtool", "SKILL.md"), "# devtool (checkout)\n");
  write(join(skills, "AGENTS.md"), "agents\n");
  return { root, skills, env: { COCLERK_REPO_ROOT: root } };
}

// ------------------------------------------------------------------ read --

test("an install-served read needs no checkout and reports its provenance", (t) => {
  const inst = installFixture(t);
  const result = skillSourceRead("matter-data/SKILL.md", NO_CHECKOUT, undefined, undefined, inst.root);
  assert.equal(result.path, "matter-data/SKILL.md");
  assert.equal(result.dir, "matter-data");
  assert.equal(result.content, "# matter-data (install)\nsee references/notes.md\n");
  assert.equal(result.sha256, createHash("sha256").update(result.content).digest("hex"));
  assert.equal(result.shipped_from, "install");
  assert.equal(result.plugin_version, "9.9.9");
  // The tsc build/ is unbundled, so esbuild never stamped it.
  assert.equal(result.build_stamp, null);

  const sliced = skillSourceRead("matter-data/SKILL.md", NO_CHECKOUT, undefined, "references", inst.root);
  assert.equal(sliced.shipped_from, "install");
  assert.equal(sliced.plugin_version, "9.9.9");
});

test("a bundled folder is served from the install even when COCLERK_REPO_ROOT names a checkout", (t) => {
  const inst = installFixture(t);
  const co = checkoutFixture(t);
  const result = skillSourceRead("matter-data/SKILL.md", co.env, undefined, undefined, inst.root);
  assert.equal(result.content, "# matter-data (install)\nsee references/notes.md\n");
  assert.equal(result.shipped_from, "install");
});

test("a file missing inside a bundled folder is not_found naming the install, never a checkout fallback", (t) => {
  const inst = installFixture(t);
  const co = checkoutFixture(t);
  const err = errorOf(() =>
    skillSourceRead("matter-data/only-in-checkout.md", co.env, undefined, undefined, inst.root),
  );
  assert.equal(err.code, "not_found");
  assert.ok(err.message.includes(join(inst.root, "skills")), `message should name the install: ${err.message}`);
  assert.ok(!err.message.includes(co.root), `message must not point at the checkout: ${err.message}`);
});

test("a non-bundled folder with no checkout is skills_root_missing naming the install roster", (t) => {
  const inst = installFixture(t);
  const err = errorOf(() => skillSourceRead("devtool/SKILL.md", NO_CHECKOUT, undefined, undefined, inst.root));
  assert.equal(err.code, "skills_root_missing");
  assert.match(err.message, /Tried, in order/);
  assert.match(err.message, /drafting-data, matter-data, shared, timecamping-data/);
  assert.match(err.message, /"devtool"/);
  assert.match(err.message, /The plugin that holds "devtool" is not installed on this PC's copy/);
});

test("a non-bundled folder is read from the checkout when one resolves", (t) => {
  const inst = installFixture(t);
  const co = checkoutFixture(t);
  const result = skillSourceRead("devtool/SKILL.md", co.env, undefined, undefined, inst.root);
  assert.equal(result.content, "# devtool (checkout)\n");
  assert.equal(result.shipped_from, "checkout");
  assert.equal(result.plugin_version, "9.9.9");
});

test("`from` anchoring probes the root each candidate's first segment picks", (t) => {
  const inst = installFixture(t);
  const co = checkoutFixture(t);
  // Containing dir of an install-served file.
  const notes = skillSourceRead("references/notes.md", NO_CHECKOUT, "matter-data/SKILL.md", undefined, inst.root);
  assert.equal(notes.path, "matter-data/references/notes.md");
  assert.equal(notes.shipped_from, "install");
  // Tree root, from a checkout-served file: `shared/` is bundled, so the install serves it.
  const shared = skillSourceRead("shared/conventions.md", co.env, "devtool/SKILL.md", undefined, inst.root);
  assert.equal(shared.path, "shared/conventions.md");
  assert.equal(shared.content, "install conventions\n");
  assert.equal(shared.shipped_from, "install");
  // `..` convention from inside a bundled folder.
  assert.equal(
    skillSourceRead("../../shared/conventions.md", NO_CHECKOUT, "matter-data/references/notes.md", undefined, inst.root).path,
    "shared/conventions.md",
  );
});

test("the install side refuses every escape", (t) => {
  const inst = installFixture(t);
  for (const bad of [
    "matter-data/../../secret.md",
    "../secret.md",
    ".claude\\skills\\..\\..\\secret.md",
    "C:\\Windows\\win.ini",
  ]) {
    assert.equal(
      errorOf(() => skillSourceRead(bad, NO_CHECKOUT, undefined, undefined, inst.root)).code,
      "path_out_of_scope",
      bad,
    );
  }
  assert.equal(
    errorOf(() => skillSourceRead("../../../secret.md", NO_CHECKOUT, "matter-data/references/notes.md", undefined, inst.root)).code,
    "path_out_of_scope",
  );
  assert.equal(errorOf(() => skillSourceList("matter-data/../..", false, NO_CHECKOUT, inst.root)).code, "path_out_of_scope");
});

// ------------------------------------------------------------------ list --

test("a root list merges the install's folders with the checkout's non-bundled ones", (t) => {
  const inst = installFixture(t);
  const co = checkoutFixture(t);
  const listing = skillSourceList("", false, co.env, inst.root);
  assert.deepEqual(
    listing.entries.map((e) => [e.path, e.shipped_from]),
    [
      ["AGENTS.md", "checkout"],
      ["devtool", "checkout"],
      ["drafting-data", "install"],
      ["matter-data", "install"],
      ["shared", "install"],
      ["timecamping-data", "install"],
    ],
  );
  assert.equal(listing.shipped_from, undefined);
  assert.equal(listing.plugin_version, "9.9.9");
  assert.equal(listing.build_stamp, null);

  // Recursive: the checkout's copy of a bundled folder never leaks in.
  const deep = skillSourceList("", true, co.env, inst.root);
  assert.ok(!deep.entries.some((e) => e.path === "matter-data/only-in-checkout.md"));
  assert.ok(deep.entries.some((e) => e.path === "matter-data/references/notes.md" && e.shipped_from === "install"));
});

test("a root list with no checkout lists the install alone, without an error", (t) => {
  const inst = installFixture(t);
  const listing = skillSourceList("", false, NO_CHECKOUT, inst.root);
  assert.deepEqual(listing.entries.map((e) => e.path), ["drafting-data", "matter-data", "shared", "timecamping-data"]);
  assert.ok(listing.entries.every((e) => e.shipped_from === "install"));
});

test("a list below the root is served whole from the root its first segment picks", (t) => {
  const inst = installFixture(t);
  const co = checkoutFixture(t);
  const listing = skillSourceList("matter-data", true, co.env, inst.root);
  assert.equal(listing.shipped_from, "install");
  assert.deepEqual(listing.entries.map((e) => e.path), [
    "matter-data/SKILL.md",
    "matter-data/references",
    "matter-data/references/notes.md",
    "matter-data/references/scripts",
    "matter-data/references/scripts/migrate_engine.py",
  ]);
  const dev = skillSourceList("devtool", false, co.env, inst.root);
  assert.equal(dev.shipped_from, "checkout");
  assert.equal(errorOf(() => skillSourceList("devtool", false, NO_CHECKOUT, inst.root)).code, "skills_root_missing");
});

// --------------------------------------------------- migrate-scripts dirs --

test("each migrate-scripts resolver finds migrate_engine.py in the install with no checkout", (t) => {
  const inst = installFixture(t);
  for (const [skill, resolver] of [
    ["matter-data", caseDataMigrateScriptsDir],
    ["timecamping-data", timecampingDataMigrateScriptsDir],
    ["drafting-data", submissionDataMigrateScriptsDir],
  ]) {
    const dir = resolver(NO_CHECKOUT, inst.root);
    assert.equal(dir.toLowerCase(), join(inst.src, skill, "references", "scripts").toLowerCase(), skill);
    assert.equal(readFileSync(join(dir, "migrate_engine.py"), "utf-8"), "# engine\n");
  }
});

// ----------------------------------------------------- resolveShippedRoot --

test("the deciding test is the first segment's folder, never the file", (t) => {
  const inst = installFixture(t);
  const co = checkoutFixture(t);
  const bundled = resolveShippedRoot("matter-data/does-not-exist.md", co.env, { installRoot: inst.root });
  assert.deepEqual(bundled, { root: join(inst.root, "skills"), shipped_from: "install", plugin: "litigation", plugin_version: "9.9.9" });
  const other = resolveShippedRoot("devtool/SKILL.md", co.env, { installRoot: inst.root });
  assert.deepEqual(other, { root: join(co.root, ".claude", "skills"), shipped_from: "checkout", plugin: null, plugin_version: null });
  // `..` and `.` never count as a bundled folder, even though both name real directories.
  assert.equal(resolveShippedRoot("..\\x.md", co.env, { installRoot: inst.root }).shipped_from, "checkout");
  assert.equal(resolveShippedRoot(".", co.env, { installRoot: inst.root }).shipped_from, "checkout");
});

test("in this repo the default install root is source/practice, which bundles nothing", () => {
  // source/practice keeps its manifest as plugin.json, not .claude-plugin/plugin.json,
  // so the default install root reports no plugin version.
  assert.equal(pluginVersion(), null);
  assert.equal(
    resolveShippedRoot("matter-data/SKILL.md", { COCLERK_REPO_ROOT: REPO_ROOT }).shipped_from,
    "checkout",
  );
  assert.equal(skillSourceRead("matter-data/SKILL.md", { COCLERK_REPO_ROOT: REPO_ROOT }).shipped_from, "checkout");
  assert.deepEqual(bundledSkillFolders(), []);
});

test("a `skills/` dir without `shared/` is a checkout layout, not an install", (t) => {
  const root = mkdtempSync(join(tmpdir(), "coclerk-stub-layout-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  write(join(root, ".claude-plugin", "plugin.json"), JSON.stringify({ name: "litigation", version: "9.9.9" }));
  write(join(root, "skills", "matter-data", "SKILL.md"), "---\nname: matter-data\n---\nstub wrapper\n");
  const co = checkoutFixture(t);
  const result = skillSourceRead("matter-data/SKILL.md", co.env, undefined, undefined, root);
  assert.equal(result.content, "# matter-data (checkout)\n");
  assert.equal(result.shipped_from, "checkout");
  const err = errorOf(() => skillSourceRead("matter-data/SKILL.md", NO_CHECKOUT, undefined, undefined, root));
  assert.equal(err.code, "skills_root_missing");
  assert.match(err.message, /skills[\\/]shared/);
});

test("plugin_version is null when the install carries no readable manifest", (t) => {
  const bare = mkdtempSync(join(tmpdir(), "coclerk-install-bare-"));
  t.after(() => rmSync(bare, { recursive: true, force: true }));
  assert.equal(pluginVersion(bare), null);
  write(join(bare, ".claude-plugin", "plugin.json"), "{ not json");
  assert.equal(pluginVersion(bare), null);
});
