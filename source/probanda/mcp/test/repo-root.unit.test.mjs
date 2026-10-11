// Coverage for src/repo-root.ts's four-step resolution chain: env override,
// marker walk-up, per-device coclerk.json, and the conventional-location
// probe. See src/repo-root.ts's header for the statement-vs-guess rationale
// that this file pins down with assertions.
//
// IMPORTANT: this suite runs on a real dev machine where the repo genuinely
// sits at the conventional %USERPROFILE%\Git\Coclerk location, and the
// default `startDir` (this module's own build/ dir) walks up to the real
// repo too. Every test exercising steps 3 or 4 must therefore ALSO pass an
// isolated `startDir` so step 2 genuinely misses -- otherwise step 2 wins
// before step 3/4 ever run, and the assertion would pass for the wrong
// reason (or fail outright). `isolatedEnv()` below returns both pieces
// together so this can't be forgotten one at a time.

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const { resolveRepoRoot } = await import("../build/repo-root.js");

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..", "..", "..", "..");

const SUBJECT = { code: "skills_root_missing", subject: "the skills tree" };

function codeOf(fn) {
  try {
    fn();
  } catch (err) {
    return err.code;
  }
  throw new Error("expected a throw, got none");
}

function scratchDir(t, prefix) {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** Populates `dir` so it satisfies the marker predicate. */
function makeMarked(dir) {
  mkdirSync(join(dir, ".claude", "skills"), { recursive: true });
  mkdirSync(join(dir, "source", "probanda", "mcp"), { recursive: true });
  return dir;
}

/**
 * Fully isolated resolution inputs: a marker-free `startDir` to walk up from,
 * scratch `appData` (no Coclerk/coclerk.json under it), and scratch
 * `userProfile` (no Git/Coclerk under it) -- so steps 2, 3 and 4 all
 * genuinely miss unless the test deliberately populates one of them.
 *
 * Returns `req`, pre-merged with `startDir`, so every call site automatically
 * gets the isolated walk-up start and can't forget it.
 */
function isolatedEnv(t, { env: envExtra = {}, req: reqExtra = SUBJECT } = {}) {
  const startDir = scratchDir(t, "coclerk-reporoot-start-");
  const appData = scratchDir(t, "coclerk-reporoot-appdata-");
  const userProfile = scratchDir(t, "coclerk-reporoot-home-");
  return {
    startDir,
    appData,
    userProfile,
    env: { APPDATA: appData, USERPROFILE: userProfile, HOME: userProfile, ...envExtra },
    req: { ...reqExtra, startDir },
  };
}

// ------------------------------------------------------------- step 1: env --

test("COCLERK_REPO_ROOT wins over everything and is returned verbatim", () => {
  const result = resolveRepoRoot(
    { COCLERK_REPO_ROOT: "C:\\definitely-does-not-exist-12345" },
    SUBJECT,
  );
  assert.equal(result, "C:\\definitely-does-not-exist-12345");
});

test("step 1 is honoured even when it would fail every marker check", (t) => {
  const { env, req } = isolatedEnv(t, { env: { COCLERK_REPO_ROOT: "C:\\nope\\not-a-repo" } });
  assert.equal(resolveRepoRoot(env, req), "C:\\nope\\not-a-repo");
});

// --------------------------------------------------------- step 2: walk-up --

test("with no override, walk-up finds this checkout from its own build/ dir", () => {
  assert.equal(resolveRepoRoot({}, SUBJECT), REPO_ROOT);
});

test("walk-up requires BOTH markers", (t) => {
  const { env, req, startDir } = isolatedEnv(t);
  mkdirSync(join(startDir, ".claude", "skills"), { recursive: true }); // one marker only
  assert.equal(codeOf(() => resolveRepoRoot(env, req)), "skills_root_missing");
});

test("walk-up also accepts a CoClerk checkout: .claude/skills with plugins/dev-tools", (t) => {
  const { env, req, startDir } = isolatedEnv(t);
  mkdirSync(join(startDir, ".claude", "skills"), { recursive: true });
  mkdirSync(join(startDir, "plugins", "dev-tools"), { recursive: true });
  assert.equal(resolveRepoRoot(env, req), startDir);
});

test("walk-up does not false-positive on the shape of an extracted .plugin install", (t) => {
  // Verified shape of a real installed plugin: .claude-plugin/, mcp/, skills/,
  // agents/ -- but neither .claude/skills nor source/probanda/mcp nor plugins/dev-tools.
  const { env, startDir } = isolatedEnv(t);
  mkdirSync(join(startDir, ".claude-plugin"), { recursive: true });
  mkdirSync(join(startDir, "mcp", "dist"), { recursive: true });
  mkdirSync(join(startDir, "skills"), { recursive: true });
  mkdirSync(join(startDir, "agents"), { recursive: true });
  assert.equal(
    codeOf(() => resolveRepoRoot(env, { ...SUBJECT, startDir: join(startDir, "mcp", "dist") })),
    "skills_root_missing",
  );
});

// ------------------------------------------------------- step 3: coclerk.json --

test("coclerk.json's repo_root is honoured verbatim, even if it does not exist", (t) => {
  const { env, req, appData } = isolatedEnv(t);
  mkdirSync(join(appData, "Coclerk"), { recursive: true });
  writeFileSync(
    join(appData, "Coclerk", "coclerk.json"),
    JSON.stringify({ repo_root: "C:\\from-coclerk-json-12345" }),
  );
  assert.equal(resolveRepoRoot(env, req), "C:\\from-coclerk-json-12345");
});

test("coclerk.json falls through on a missing file", (t) => {
  const { env, req } = isolatedEnv(t); // scratch APPDATA with no Coclerk/ subdir at all
  assert.equal(codeOf(() => resolveRepoRoot(env, req)), "skills_root_missing");
});

test("coclerk.json falls through on malformed JSON", (t) => {
  const { env, req, appData } = isolatedEnv(t);
  mkdirSync(join(appData, "Coclerk"), { recursive: true });
  writeFileSync(join(appData, "Coclerk", "coclerk.json"), "{ not json");
  assert.equal(codeOf(() => resolveRepoRoot(env, req)), "skills_root_missing");
});

test("coclerk.json falls through when the repo_root key is absent", (t) => {
  const { env, req, appData } = isolatedEnv(t);
  mkdirSync(join(appData, "Coclerk"), { recursive: true });
  writeFileSync(join(appData, "Coclerk", "coclerk.json"), JSON.stringify({ case_data_root: "x" }));
  assert.equal(codeOf(() => resolveRepoRoot(env, req)), "skills_root_missing");
});

test("coclerk.json falls through when the repo_root key is empty", (t) => {
  const { env, req, appData } = isolatedEnv(t);
  mkdirSync(join(appData, "Coclerk"), { recursive: true });
  writeFileSync(join(appData, "Coclerk", "coclerk.json"), JSON.stringify({ repo_root: "" }));
  assert.equal(codeOf(() => resolveRepoRoot(env, req)), "skills_root_missing");
});

// ---------------------------------------------------- step 4: conventional --

test("step 4 marker-validates %USERPROFILE%\\Git\\Coclerk", (t) => {
  const { env, req, userProfile } = isolatedEnv(t);
  const half = join(userProfile, "Git", "Coclerk");

  // Not there yet.
  assert.equal(codeOf(() => resolveRepoRoot(env, req)), "skills_root_missing");

  // Only one marker -- still misses.
  mkdirSync(join(half, ".claude", "skills"), { recursive: true });
  assert.equal(codeOf(() => resolveRepoRoot(env, req)), "skills_root_missing");

  // Both markers -- resolves.
  mkdirSync(join(half, "source", "probanda", "mcp"), { recursive: true });
  assert.equal(resolveRepoRoot(env, req), half);
});

test("step 4 falls back to HOME when USERPROFILE is unset", (t) => {
  const { env, req, userProfile } = isolatedEnv(t);
  delete env.USERPROFILE; // HOME (set by isolatedEnv to the same scratch dir) should still be tried
  makeMarked(join(userProfile, "Git", "Coclerk"));
  assert.equal(resolveRepoRoot(env, req), join(userProfile, "Git", "Coclerk"));
});

// --------------------------------------------------------------- ordering --

test("ordering: walk-up (2) beats coclerk.json (3) beats the probe (4)", (t) => {
  const { env, req, startDir, appData, userProfile } = isolatedEnv(t);
  makeMarked(startDir);
  mkdirSync(join(appData, "Coclerk"), { recursive: true });
  writeFileSync(
    join(appData, "Coclerk", "coclerk.json"),
    JSON.stringify({ repo_root: "C:\\should-not-be-reached-via-step-3" }),
  );
  makeMarked(join(userProfile, "Git", "Coclerk")); // a valid step-4 candidate too

  assert.equal(resolveRepoRoot(env, req), startDir);
});

test("ordering: coclerk.json (3) beats the probe (4)", (t) => {
  const { env, req, appData, userProfile } = isolatedEnv(t);
  mkdirSync(join(appData, "Coclerk"), { recursive: true });
  writeFileSync(
    join(appData, "Coclerk", "coclerk.json"),
    JSON.stringify({ repo_root: "C:\\step-3-wins" }),
  );
  makeMarked(join(userProfile, "Git", "Coclerk")); // a valid step-4 candidate too

  assert.equal(resolveRepoRoot(env, req), "C:\\step-3-wins");
});

// -------------------------------------------------------------- the knob --

test("COCLERK_REPO_ROOT_AUTODETECT=0 disables steps 2-4 but not step 1", () => {
  // With detection on, {} resolves this real checkout.
  assert.equal(resolveRepoRoot({}, SUBJECT), REPO_ROOT);
  // With detection off, the same call throws -- this is what keeps the
  // no-configuration tests in file-tools.unit.test.mjs and case-migrate.db.test.mjs
  // meaningful rather than accidentally vacuous.
  assert.equal(
    codeOf(() => resolveRepoRoot({ COCLERK_REPO_ROOT_AUTODETECT: "0" }, SUBJECT)),
    "skills_root_missing",
  );
  // Step 1 is unaffected by the knob.
  assert.equal(
    resolveRepoRoot({ COCLERK_REPO_ROOT: "C:\\x", COCLERK_REPO_ROOT_AUTODETECT: "0" }, SUBJECT),
    "C:\\x",
  );
});

// -------------------------------------------------------------- messages --

test("the three surfaces keep their own error codes, and the message names both fixes", (t) => {
  const cases = [
    { code: "skills_root_missing", subject: "the skills tree" },
    { code: "docs_root_missing", subject: "the docs tree" },
    { code: "repo_root_missing", subject: "the application-state/application-engine scripts" },
  ];
  for (const c of cases) {
    const { env, req } = isolatedEnv(t, { env: { COCLERK_REPO_ROOT_AUTODETECT: "0" }, req: c });
    try {
      resolveRepoRoot(env, req);
      assert.fail("expected a throw");
    } catch (err) {
      assert.equal(err.code, c.code);
      assert.match(err.message, /COCLERK_REPO_ROOT/);
      assert.match(err.message, /repo_root/);
      assert.match(err.message, /coclerk\.json/);
    }
  }
});
