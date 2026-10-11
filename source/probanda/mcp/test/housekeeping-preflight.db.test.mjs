import assert from "node:assert/strict";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { matterFixture } from "./helpers/housekeeping-fixture.mjs";

const { preflight } = await import("../build/housekeeping/preflight.js");

/** A matter whose v5 pointer names a case-data folder beside it, created unless `absent`. */
function setUp({ absent = false } = {}) {
  const m = matterFixture();
  const caseData = join(m.base, "case-data");
  if (!absent) {
    mkdirSync(caseData);
    writeFileSync(join(caseData, "main.sqlite"), "");
  }
  writeFileSync(join(m.root, "coclerk.json"), JSON.stringify({ schema_version: 5, matter_root: m.root, case_data_dir: caseData }));
  return { m, caseData };
}

test("no half-commit folder: an empty list, the case-data folder found, and the pointer untouched", () => {
  const { m } = setUp();
  try {
    const pointer = readFileSync(join(m.root, "coclerk.json"), "utf-8");
    assert.deepEqual(preflight(m.root, false, m.env), { half_commit: [], case_data_found: true });
    assert.equal(readFileSync(join(m.root, "coclerk.json"), "utf-8"), pointer);
  } finally {
    m.cleanup();
  }
});

test("one half-commit folder is named by its absolute path", () => {
  const { m, caseData } = setUp();
  try {
    mkdirSync(join(caseData, ".coclerk_execute_ab12cd"));
    assert.deepEqual(preflight(m.root, false, m.env).half_commit, [join(caseData, ".coclerk_execute_ab12cd")]);
  } finally {
    m.cleanup();
  }
});

test("several half-commit folders are all named, and nothing else in the folder is", () => {
  const { m, caseData } = setUp();
  try {
    for (const name of [".coclerk_execute_b", ".coclerk_execute_a", ".coclerk_execute_c", "coclerk_execute_x", ".coclerk_other"]) {
      mkdirSync(join(caseData, name));
    }
    assert.deepEqual(
      preflight(m.root, false, m.env).half_commit,
      [".coclerk_execute_a", ".coclerk_execute_b", ".coclerk_execute_c"].map((n) => join(caseData, n))
    );
  } finally {
    m.cleanup();
  }
});

test("a missing case-data folder is reported, not an error", () => {
  const { m } = setUp({ absent: true });
  try {
    assert.deepEqual(preflight(m.root, false, m.env), { half_commit: [], case_data_found: false });
  } finally {
    m.cleanup();
  }
});

test("a folder without coclerk.json, or with only a legacy pointer, has no case data to check: not an error", () => {
  const m = matterFixture();
  try {
    rmSync(join(m.root, "coclerk.json"));
    assert.deepEqual(preflight(m.root, false, m.env), { half_commit: [], case_data_found: false });
    mkdirSync(join(m.root, "9. AI"));
    writeFileSync(join(m.root, "9. AI", "coclerk.json"), JSON.stringify({ schema_version: 5 }));
    assert.deepEqual(preflight(m.root, false, m.env), { half_commit: [], case_data_found: false });
    assert.equal(preflight(m.root, true, m.env).template_folders.length, 10);
    // Anything that is not a directory still fails.
    assert.throws(() => preflight(join(m.root, "9. AI", "coclerk.json"), false, m.env), (err) => err.code === "invalid_root");
    assert.throws(() => preflight(join(m.root, "no such folder"), false, m.env), (err) => err.code === "invalid_root");
  } finally {
    m.cleanup();
  }
});

test("include_template lists every template folder, every level, template-relative", () => {
  const { m } = setUp();
  try {
    assert.deepEqual(preflight(m.root, true, m.env).template_folders, [
      "0. DRAFT",
      "2. SOLICITOR CLIENT",
      "3. CORRESPONDENCE",
      "4. LAWYER BRIEF",
      "5. COURT FILE#",
      "6. LAW",
      "7. DISCOVERY",
      "7. DISCOVERY\\LOD Plaintiff",
      "7. DISCOVERY\\LOD Plaintiff\\Party #1",
      "9. DISBURSEMENTS",
    ]);
  } finally {
    m.cleanup();
  }
});

test("include_template fails template_missing when the template root is not there", () => {
  const { m } = setUp();
  try {
    rmSync(m.template, { recursive: true });
    assert.throws(() => preflight(m.root, true, m.env), (err) => err.code === "template_missing");
    assert.deepEqual(preflight(m.root, false, m.env), { half_commit: [], case_data_found: true });
  } finally {
    m.cleanup();
  }
});
