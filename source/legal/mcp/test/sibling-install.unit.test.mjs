// Coverage for the sibling lookup (four-plugin split, decision 1): a packaged install
// also serves a skill folder held by a `researcher`, `litigator` or `solicitor` plugin
// installed beside it. src/repo-root.ts's siblingInstalls() finds those plugins, and
// resolveShippedRoot() consults them after the own install and before the checkout chain.
//
// Every fixture sits at least two folders below its own temp dir, so a scan (the
// folders beside the install root, and two levels up) never leaves that temp dir.
// "No checkout" is as in skill-source-install.unit.test.mjs.

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import test from "node:test";

const { skillSourceRead, skillSourceList } = await import("../build/files/skill-source.js");
const { resolveShippedRoot, siblingInstalls } = await import("../build/repo-root.js");

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

function tempDir(t) {
  const dir = mkdtempSync(join(tmpdir(), "probanda-siblings-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** One installed plugin at `dir`: its manifest, `skills/shared/` unless told otherwise, and a SKILL.md per folder. */
function plugin(dir, name, version, folders = [], { shared = true } = {}) {
  write(join(dir, ".claude-plugin", "plugin.json"), JSON.stringify({ name, version }));
  if (shared) write(join(dir, "skills", "shared", "conventions.md"), `${name} conventions\n`);
  for (const folder of folders) {
    write(join(dir, "skills", folder, "SKILL.md"), `# ${folder} (${name} ${version} in ${basename(dir)})\n`);
  }
  return dir;
}

/** A store holding the own install, `practice` 1.0.0 with `case-data`, in a folder named `practice`. */
function store(t) {
  const dir = join(tempDir(t), "store");
  return { dir, own: plugin(join(dir, "practice"), "practice", "1.0.0", ["case-data"]) };
}

function checkout(t, folders) {
  const root = tempDir(t);
  for (const folder of folders) write(join(root, ".claude", "skills", folder, "SKILL.md"), `# ${folder} (checkout)\n`);
  return { root, env: { COCLERK_REPO_ROOT: root } };
}

const served = (own, path, env = NO_CHECKOUT) => resolveShippedRoot(path, env, { installRoot: own });

test("a sibling in a folder named after it serves the folder it holds", (t) => {
  const s = store(t);
  const researcher = plugin(join(s.dir, "researcher"), "researcher", "0.2.0", ["verify-law"]);
  assert.deepEqual(served(s.own, "verify-law/SKILL.md"), {
    root: join(researcher, "skills"),
    shipped_from: "install",
    plugin: "researcher",
    plugin_version: "0.2.0",
  });
});

test("of several copies of one sibling, the version wins, then the ~g<N> suffix, then the newest change time", (t) => {
  const s = store(t);
  plugin(join(s.dir, "researcher"), "researcher", "0.2.0", ["verify-law"]);
  const newer = plugin(join(s.dir, "researcher~g3"), "researcher", "0.2.0", ["verify-law"]);
  assert.equal(served(s.own, "verify-law/SKILL.md").root, join(newer, "skills"));

  // A higher version outranks a higher generation.
  plugin(join(s.dir, "litigator~g5"), "litigator", "0.2.0", ["draft"]);
  const higher = plugin(join(s.dir, "litigator"), "litigator", "0.3.0", ["draft"]);
  assert.equal(served(s.own, "draft/SKILL.md").root, join(higher, "skills"));

  // Same version, no suffix: the folder changed last wins.
  const stale = plugin(join(s.dir, "solicitor-a"), "solicitor", "0.2.0", ["wills"]);
  const fresh = plugin(join(s.dir, "solicitor-b"), "solicitor", "0.2.0", ["wills"]);
  utimesSync(stale, new Date("2026-01-01T00:00:00Z"), new Date("2026-01-01T00:00:00Z"));
  utimesSync(fresh, new Date("2026-06-01T00:00:00Z"), new Date("2026-06-01T00:00:00Z"));
  assert.equal(served(s.own, "wills/SKILL.md").root, join(fresh, "skills"));

  assert.deepEqual(siblingInstalls(s.own).map((sibling) => [sibling.name, basename(sibling.installRoot)]), [
    ["researcher", "researcher~g3"],
    ["litigator", "litigator"],
    ["solicitor", "solicitor-b"],
  ]);
});

test("an id-named sibling is recognised by the name in its manifest", (t) => {
  const dir = join(tempDir(t), "rpm");
  const own = plugin(join(dir, "plugin_01abc"), "practice", "1.0.0", ["case-data"]);
  const researcher = plugin(join(dir, "plugin_02def"), "researcher", "0.2.0", ["verify-law"]);
  const root = served(own, "verify-law/SKILL.md");
  assert.equal(root.root, join(researcher, "skills"));
  assert.equal(root.plugin, "researcher");
});

test("the <marketplace>/<plugin>/<version>/ layout is scanned two levels up, and the higher version wins", (t) => {
  const marketplace = join(tempDir(t), "marketplace");
  const own = plugin(join(marketplace, "practice", "1.0.0"), "practice", "1.0.0", ["case-data"]);
  plugin(join(marketplace, "researcher", "0.2.0"), "researcher", "0.2.0", ["verify-law"]);
  const higher = plugin(join(marketplace, "researcher", "0.10.0"), "researcher", "0.10.0", ["verify-law"]);
  assert.deepEqual(served(own, "verify-law/SKILL.md"), {
    root: join(higher, "skills"),
    shipped_from: "install",
    plugin: "researcher",
    plugin_version: "0.10.0",
  });
});

test("two levels up is not scanned when the install folder is not named after its version", (t) => {
  const s = store(t);
  plugin(join(dirname(s.dir), "other-account", "researcher"), "researcher", "0.2.0", ["verify-law"]);
  assert.deepEqual(siblingInstalls(s.own), []);
});

test("a .staging folder is ignored, beside the install and two levels up", (t) => {
  const s = store(t);
  plugin(join(s.dir, ".staging"), "researcher", "0.2.0", ["verify-law"]);
  plugin(join(dirname(s.dir), ".staging", "researcher"), "researcher", "0.2.0", ["verify-law"]);
  plugin(join(s.dir, ".staging", "researcher"), "researcher", "0.2.0", ["verify-law"]);
  assert.deepEqual(siblingInstalls(s.own), []);
  assert.equal(errorOf(() => served(s.own, "verify-law/SKILL.md")).code, "skills_root_missing");
});

test("a folder named and manifested probanda is ignored", (t) => {
  const s = store(t);
  plugin(join(s.dir, "probanda"), "probanda", "0.1.9", ["verify-law"]);
  assert.deepEqual(siblingInstalls(s.own), []);
  const err = errorOf(() => served(s.own, "verify-law/SKILL.md"));
  assert.equal(err.code, "skills_root_missing");
  assert.match(err.message, /No other Probanda plugin \(legal, researcher, litigator, solicitor, file-manager or timekeeper\) was found installed beside this one/);
});

test("a sibling with no skills/shared/ is ignored", (t) => {
  const s = store(t);
  plugin(join(s.dir, "researcher"), "researcher", "0.2.0", ["verify-law"], { shared: false });
  assert.deepEqual(siblingInstalls(s.own), []);
  assert.equal(errorOf(() => served(s.own, "verify-law/SKILL.md")).code, "skills_root_missing");
});

test("a sibling that holds the folder wins over a checkout that also holds it", (t) => {
  const s = store(t);
  plugin(join(s.dir, "researcher"), "researcher", "0.2.0", ["verify-law"]);
  const co = checkout(t, ["verify-law", "devtool"]);
  const result = skillSourceRead("verify-law/SKILL.md", co.env, undefined, undefined, s.own);
  assert.equal(result.content, "# verify-law (researcher 0.2.0 in researcher)\n");
  assert.equal(result.shipped_from, "install");
  // A folder no install holds still falls through to the checkout.
  assert.equal(served(s.own, "devtool/SKILL.md", co.env).shipped_from, "checkout");
});

test("the own install wins over a sibling that holds the same folder", (t) => {
  const s = store(t);
  plugin(join(s.dir, "researcher"), "researcher", "0.2.0", ["case-data"]);
  assert.deepEqual(served(s.own, "case-data/SKILL.md"), {
    root: join(s.own, "skills"),
    shipped_from: "install",
    plugin: "practice",
    plugin_version: "1.0.0",
  });
  // `shared/`, which every plugin ships, is the own install's too.
  assert.equal(served(s.own, "shared/conventions.md").plugin, "practice");
});

test("when no root holds the folder, the error names it and lists the siblings found", (t) => {
  const s = store(t);
  plugin(join(s.dir, "researcher"), "researcher", "0.2.0", ["verify-law"]);
  plugin(join(s.dir, "litigator"), "litigator", "0.3.1", ["draft"]);
  const err = errorOf(() => skillSourceRead("devtool/SKILL.md", NO_CHECKOUT, undefined, undefined, s.own));
  assert.equal(err.code, "skills_root_missing");
  assert.match(err.message, /Tried, in order/);
  assert.match(err.message, /Plugins found installed beside this one: researcher 0\.2\.0, litigator 0\.3\.1\. None of them holds "devtool" either\./);
  assert.match(err.message, /The plugin that holds "devtool" is not installed on this PC's copy of the plugins \(in Cowork, that copy is the desktop app's store\)/);
  assert.match(err.message, /Check for updates in the desktop app, then restart it\./);
});

test("skill_source__read and __list results name the sibling plugin and its version", (t) => {
  const s = store(t);
  plugin(join(s.dir, "researcher"), "researcher", "0.2.0", ["verify-law"]);
  const co = checkout(t, ["devtool"]);

  const read = skillSourceRead("verify-law/SKILL.md", NO_CHECKOUT, undefined, undefined, s.own);
  assert.deepEqual([read.shipped_from, read.plugin, read.plugin_version], ["install", "researcher", "0.2.0"]);
  const own = skillSourceRead("case-data/SKILL.md", NO_CHECKOUT, undefined, undefined, s.own);
  assert.deepEqual([own.shipped_from, own.plugin, own.plugin_version], ["install", "practice", "1.0.0"]);
  // A checkout belongs to no plugin, and keeps reporting the running plugin's version.
  const dev = skillSourceRead("devtool/SKILL.md", co.env, undefined, undefined, s.own);
  assert.deepEqual([dev.shipped_from, dev.plugin, dev.plugin_version], ["checkout", null, "1.0.0"]);

  const missing = errorOf(() => skillSourceRead("verify-law/missing.md", co.env, undefined, undefined, s.own));
  assert.equal(missing.code, "not_found");
  assert.match(missing.message, /served from the installed plugin "researcher" 0\.2\.0's bundled skill source/);

  const below = skillSourceList("verify-law", false, NO_CHECKOUT, s.own);
  assert.deepEqual([below.shipped_from, below.plugin, below.plugin_version], ["install", "researcher", "0.2.0"]);
  assert.deepEqual(below.entries.map((e) => [e.path, e.plugin]), [["verify-law/SKILL.md", "researcher"]]);

  // The tree root merges the own install, then the siblings, then the checkout.
  const root = skillSourceList("", false, co.env, s.own);
  assert.deepEqual(
    root.entries.map((e) => [e.path, e.shipped_from, e.plugin]),
    [
      ["case-data", "install", "practice"],
      ["devtool", "checkout", null],
      ["shared", "install", "practice"],
      ["verify-law", "install", "researcher"],
    ],
  );
  assert.equal(root.shipped_from, undefined);
  assert.equal(root.plugin, undefined);
  assert.equal(root.plugin_version, "1.0.0");
});

test("nothing is scanned when the own root is not a packaged install", (t) => {
  const dir = join(tempDir(t), "store");
  // No skills/shared/: a checkout's source folder, or a stale stub layout.
  const own = plugin(join(dir, "practice"), "practice", "1.0.0", ["case-data"], { shared: false });
  plugin(join(dir, "researcher"), "researcher", "0.2.0", ["verify-law"]);
  assert.deepEqual(siblingInstalls(own), []);
  const co = checkout(t, ["verify-law"]);
  assert.deepEqual(served(own, "verify-law/SKILL.md", co.env), {
    root: join(co.root, ".claude", "skills"),
    shipped_from: "checkout",
    plugin: null,
    plugin_version: null,
  });
  assert.equal(errorOf(() => served(own, "verify-law/SKILL.md")).code, "skills_root_missing");
});
