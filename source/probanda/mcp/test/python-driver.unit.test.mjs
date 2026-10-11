// Embedded Python drivers used to be written once per process under a pid-named file and never
// removed, so every server start and test process left files in %TEMP%. One file per source now.

import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, rmSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const { pythonDriverFile } = await import("../build/python-driver.js");
const { withTempDir } = await import("./helpers/temp-dir.mjs");

test("a driver source maps to one shared file, rewritten if the temp dir was cleaned", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "coclerk-python-driver-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  await withTempDir(dir, () => {
    const p = pythonDriverFile("probe", "print(1)");
    assert.equal(pythonDriverFile("probe", "print(1)"), p);
    assert.notEqual(pythonDriverFile("probe", "print(2)"), p);
    unlinkSync(p);
    assert.equal(pythonDriverFile("probe", "print(1)"), p);
    assert.equal(readFileSync(p, "utf-8"), "print(1)");
    assert.deepEqual(readdirSync(dir).filter((f) => f.endsWith(".tmp")), []);
  });
});
