// COCLERK_CONFIG_PATH: a per-session override for the per-device coclerk.json (#1230).
// Two env objects in one process stand for two sessions: one on the live file, one on scratch.

import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const { configPath } = await import("../build/config-path.js");
const { resolveCaseDataRoot } = await import("../build/practice/backend.js");
const { resolveRepoRoot } = await import("../build/repo-root.js");
const { readFirmProfile } = await import("../build/tools/practice/firm-profile.js");
const { overlayFirmHosts } = await import("../build/sources/hosts.js");

function fixture(t) {
  const scratch = mkdtempSync(join(tmpdir(), "coclerk-config-path-"));
  t.after(() => rmSync(scratch, { recursive: true, force: true }));
  const appData = join(scratch, "appdata");
  mkdirSync(join(appData, "Coclerk"), { recursive: true });
  const liveRoot = join(scratch, "live", "0. CASE DATA");
  const scratchRoot = join(scratch, "scratch", "0. CASE DATA");
  mkdirSync(liveRoot, { recursive: true });
  mkdirSync(scratchRoot, { recursive: true });
  writeFileSync(join(appData, "Coclerk", "coclerk.json"), JSON.stringify({ case_data_root: liveRoot }));
  const overrideFile = join(scratch, "scratch", "coclerk.json");
  writeFileSync(overrideFile, JSON.stringify({ case_data_root: scratchRoot, person: "staff-1" }));
  return { scratch, appData, liveRoot, scratchRoot, overrideFile };
}

test("unset or empty, the override is ignored and the first read migrates Coclerk into Probanda", (t) => {
  const f = fixture(t);
  const legacy = join(f.appData, "Coclerk", "coclerk.json");
  const legacyText = readFileSync(legacy, "utf-8");
  writeFileSync(join(f.appData, "Coclerk", "preferences.json"), "{}");
  const live = join(f.appData, "Probanda", "probanda.json");
  assert.equal(configPath({ APPDATA: f.appData }), live);
  assert.equal(readFileSync(live, "utf-8"), legacyText, "the settings are copied as they were");
  assert.equal(readFileSync(join(f.appData, "Probanda", "preferences.json"), "utf-8"), "{}", "the folder's other files come too");
  assert.equal(readFileSync(legacy, "utf-8"), legacyText, "nothing in Coclerk is changed");
  assert.equal(configPath({ APPDATA: f.appData, COCLERK_CONFIG_PATH: "" }), live);
});

test("once Probanda holds probanda.json, Coclerk is never read again", (t) => {
  const f = fixture(t);
  mkdirSync(join(f.appData, "Probanda"));
  const live = join(f.appData, "Probanda", "probanda.json");
  writeFileSync(live, JSON.stringify({ case_data_root: f.scratchRoot }));
  assert.equal(configPath({ APPDATA: f.appData }), live);
  assert.equal(resolveCaseDataRoot({ APPDATA: f.appData }), f.scratchRoot);
});

test("an override never migrates", (t) => {
  const f = fixture(t);
  assert.equal(configPath({ APPDATA: f.appData, COCLERK_CONFIG_PATH: f.overrideFile }), f.overrideFile);
  assert.equal(existsSync(join(f.appData, "Probanda")), false);
});

test("one session reads scratch while another reads live", (t) => {
  const f = fixture(t);
  const live = { APPDATA: f.appData };
  const scratchSession = { APPDATA: f.appData, COCLERK_CONFIG_PATH: f.overrideFile };
  assert.equal(resolveCaseDataRoot(live), f.liveRoot);
  assert.equal(resolveCaseDataRoot(scratchSession), f.scratchRoot);
  assert.equal(resolveCaseDataRoot(live), f.liveRoot);
});

test("person comes from the override file too", (t) => {
  const f = fixture(t);
  for (const root of [f.liveRoot, f.scratchRoot]) {
    mkdirSync(join(root, "_practice", "firm"), { recursive: true });
    writeFileSync(join(root, "_practice", "firm", "firm.json"), JSON.stringify({ firm_name: "Test LLP", roster: [{ key: "staff-1" }] }));
  }
  const live = readFirmProfile({ APPDATA: f.appData });
  const scratchSession = readFirmProfile({ APPDATA: f.appData, COCLERK_CONFIG_PATH: f.overrideFile });
  assert.equal(live.person, null);
  assert.equal(scratchSession.person, "staff-1");
});

test("an override naming a missing file fails hard and never reads the live file", (t) => {
  const f = fixture(t);
  const env = { APPDATA: f.appData, COCLERK_CONFIG_PATH: join(f.scratch, "nope.json") };
  const named = /COCLERK_CONFIG_PATH names .*nope\.json, which does not exist/;
  assert.throws(() => configPath(env), named);
  assert.throws(() => resolveCaseDataRoot(env), named);
  assert.throws(() => overlayFirmHosts(env), named);
});

test("repo-root does not serve one env's cached repo_root to another differing only in the override", (t) => {
  const f = fixture(t);
  writeFileSync(join(f.appData, "Coclerk", "coclerk.json"), JSON.stringify({ repo_root: "C:\\live-repo" }));
  writeFileSync(f.overrideFile, JSON.stringify({ repo_root: "C:\\scratch-repo" }));
  const startDir = join(f.scratch, "no-markers");
  mkdirSync(startDir);
  const req = { code: "skills_root_missing", subject: "the skills tree", startDir };
  const base = { APPDATA: f.appData, USERPROFILE: f.scratch, HOME: f.scratch };
  assert.equal(resolveRepoRoot(base, req), "C:\\live-repo");
  assert.equal(resolveRepoRoot({ ...base, COCLERK_CONFIG_PATH: f.overrideFile }, req), "C:\\scratch-repo");
});
