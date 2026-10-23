import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { codeOf, matterFixture } from "./helpers/housekeeping-fixture.mjs";

const { fileOpsMoveFromDownloads } = await import("../build/file_ops/move-from-downloads.js");

const RECEIPT = "Receipt 12345.pdf";

/** A matter beside a throwaway Downloads folder holding `downloads`. */
function fixture(downloads = { [RECEIPT]: "receipt" }) {
  const m = matterFixture({
    "3. CORRESPONDENCE/taken.pdf": "already here",
    "4. LAWYER BRIEF/CoWork/privileged/p.pdf": "p",
  });
  const dl = join(m.base, "Downloads");
  mkdirSync(dl);
  for (const [name, body] of Object.entries(downloads)) writeFileSync(join(dl, name), body);
  return { m, dl, env: { ...process.env, COCLERK_DOWNLOADS_DIR: dl } };
}

const logLines = (m) => {
  const path = join(m.caseData, "file-manager", "move-log.jsonl");
  return existsSync(path) ? readFileSync(path, "utf-8").trim().split("\n").map((l) => JSON.parse(l)) : [];
};

test("file_ops__move_from_downloads moves the file: it leaves Downloads and is logged", () => {
  const { m, dl, env } = fixture();
  try {
    const dest = m.at("3. CORRESPONDENCE/2026-10-23 Registry Receipt.pdf");
    const result = fileOpsMoveFromDownloads(m.root, RECEIPT, dest, env);
    assert.equal(result.moved_from, join(dl, RECEIPT));
    assert.equal(result.moved_to, dest);
    assert.equal(result.versioned, false);
    assert.equal(result.log_error, undefined);
    assert.equal(existsSync(join(dl, RECEIPT)), false, "no copy is left in Downloads");
    assert.equal(readFileSync(dest, "utf-8"), "receipt");
    const log = logLines(m);
    assert.equal(log.length, 1);
    assert.equal(log[0].from, join(dl, RECEIPT));
    assert.equal(log[0].to, dest);
  } finally {
    m.cleanup();
  }
});

test("a taken name gets the next vN and nothing is overwritten", () => {
  const { m, dl, env } = fixture({ "a.pdf": "first", "b.pdf": "second" });
  try {
    const taken = m.at("3. CORRESPONDENCE/taken.pdf");
    const v2 = fileOpsMoveFromDownloads(m.root, "a.pdf", taken, env);
    assert.equal(v2.moved_to, m.at("3. CORRESPONDENCE/taken v2.pdf"));
    assert.equal(v2.versioned, true);
    const v3 = fileOpsMoveFromDownloads(m.root, "b.pdf", taken, env);
    assert.equal(v3.moved_to, m.at("3. CORRESPONDENCE/taken v3.pdf"));
    assert.equal(readFileSync(taken, "utf-8"), "already here");
    assert.equal(readFileSync(v2.moved_to, "utf-8"), "first");
    assert.equal(readFileSync(v3.moved_to, "utf-8"), "second");
    assert.deepEqual(readdirSync(dl), []);
  } finally {
    m.cleanup();
  }
});

test("every refusal touches nothing", () => {
  const { m, dl, env } = fixture({ [RECEIPT]: "receipt", "x.pdf.crdownload": "partial" });
  const outside = mkdtempSync(join(tmpdir(), "coclerk-mfd-outside-"));
  try {
    const name = "2026-10-23 Registry Receipt.pdf";
    const cases = [
      [() => fileOpsMoveFromDownloads(m.root, "..\\x.pdf", m.at("3. CORRESPONDENCE/" + name), env), "invalid_filename"],
      [() => fileOpsMoveFromDownloads(m.root, "missing.pdf", m.at("3. CORRESPONDENCE/" + name), env), "not_found"],
      [() => fileOpsMoveFromDownloads(m.root, "x.pdf.crdownload", m.at("3. CORRESPONDENCE/" + name), env), "in_progress"],
      [() => fileOpsMoveFromDownloads(m.root, RECEIPT, "3. CORRESPONDENCE\\" + name, env), "invalid_path"],
      [() => fileOpsMoveFromDownloads(m.root, RECEIPT, m.at("3. CORRESPONDENCE/a:b.pdf"), env), "invalid_filename"],
      [() => fileOpsMoveFromDownloads(m.root, RECEIPT, m.at("9. DISBURSEMENTS/" + name), env), "not_found"],
      [() => fileOpsMoveFromDownloads(m.root, RECEIPT, join(outside, name), env), "path_out_of_scope"],
      [() => fileOpsMoveFromDownloads(m.root, RECEIPT, m.at(name), env), "protected"],
      [() => fileOpsMoveFromDownloads(m.root, RECEIPT, m.at("0. DRAFT/" + name), env), "protected"],
      [() => fileOpsMoveFromDownloads(m.root, RECEIPT, m.at("TRASH/" + name), env), "protected"],
      [() => fileOpsMoveFromDownloads(m.root, RECEIPT, m.at("4. LAWYER BRIEF/CoWork/privileged/" + name), env), "protected"],
    ];
    for (const [fn, code] of cases) assert.equal(codeOf(fn), code, fn.toString());
    assert.equal(readFileSync(join(dl, RECEIPT), "utf-8"), "receipt");
    assert.equal(existsSync(m.at("9. DISBURSEMENTS")), false);
    assert.deepEqual(readdirSync(outside), []);
    assert.deepEqual(logLines(m), []);
  } finally {
    m.cleanup();
    rmSync(outside, { recursive: true, force: true });
  }
});

test("a move across drives is refused before anything changes", () => {
  const { m, dl, env } = fixture();
  try {
    const dest = m.at("3. CORRESPONDENCE/" + RECEIPT);
    const seams = { dev: (path) => (path.startsWith(dl) ? 1 : 2) };
    assert.equal(codeOf(() => fileOpsMoveFromDownloads(m.root, RECEIPT, dest, env, seams)), "cross_device");
    assert.equal(readFileSync(join(dl, RECEIPT), "utf-8"), "receipt");
    assert.equal(existsSync(dest), false, "no placeholder is left");
    assert.deepEqual(logLines(m), []);
  } finally {
    m.cleanup();
  }
});
