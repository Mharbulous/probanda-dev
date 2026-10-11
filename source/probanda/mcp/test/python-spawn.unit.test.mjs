// Eight backends each carried their own copy of the host-Python spawn loop, and the copies drifted:
// an unguarded JSON.parse, a missing staging cleanup, a 1 MB output cap. These pin the one module.

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const { removeKilledStaging, runPythonDriver } = await import("../build/python-spawn.js");
const { withTempDir } = await import("./helpers/temp-dir.mjs");

const PYTHON = process.env.COCLERK_PYTHON || "python";

function scratch(t) {
  const dir = mkdtempSync(join(tmpdir(), "coclerk-python-spawn-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function driver(dir, name, source) {
  const p = join(dir, `${name}.py`);
  writeFileSync(p, source);
  return p;
}

function run(driverPath, overrides = {}) {
  return runPythonDriver({
    label: "probe helper",
    driver: driverPath,
    payload: "{}",
    env: { ...process.env, COCLERK_PYTHON: PYTHON },
    timeoutMs: 30_000,
    ...overrides,
  });
}

test("stdout that is not JSON fails naming the label and the output", (t) => {
  const d = driver(scratch(t), "garbage", "print('not json at all')");
  assert.throws(() => run(d), (err) => {
    assert.equal(err.code, "data_error");
    assert.match(err.message, /probe helper/);
    assert.match(err.message, /unparseable/);
    assert.match(err.message, /not json at all/);
    return true;
  });
});

test("a nonzero exit fails carrying the driver's stderr", (t) => {
  const d = driver(scratch(t), "exit", "import sys\nsys.stderr.write('boom-on-stderr')\nsys.exit(3)");
  assert.throws(() => run(d), (err) => {
    assert.match(err.message, /^probe helper \(.*\) exited 3: boom-on-stderr$/);
    return true;
  });
});

test("with no interpreter on the path it says so and names what it tried", (t) => {
  const dir = scratch(t);
  const d = driver(dir, "never", "print('{}')");
  const missing = join(dir, "no-such-python.exe");
  assert.throws(() => run(d, { env: { COCLERK_PYTHON: missing, PATH: dir } }), (err) => {
    assert.match(err.message, /^No Python interpreter found for the probe helper \(tried /);
    assert.ok(err.message.includes(missing));
    assert.match(err.message, /Install Python 3 or set COCLERK_PYTHON/);
    return true;
  });
});

test("output past spawnSync's 1 MB default still arrives whole", (t) => {
  const d = driver(scratch(t), "big", "import json\nprint(json.dumps({'s': 'x' * 2000000}))");
  assert.equal(run(d).s.length, 2_000_000);
});

test("a helper killed on timeout fails with the advice appended and its staging folder removed", async (t) => {
  const dir = scratch(t);
  // Makes a staging folder the way the real helpers name theirs, leaves a sentinel outside the
  // pattern to prove it got that far, then hangs.
  const d = driver(dir, "hang", [
    "import json, os, sys, tempfile, time",
    "out = json.load(sys.stdin)['out']",
    "os.mkdir(os.path.join(tempfile.gettempdir(), 'coclerk_probe_%s_x' % os.environ['COCLERK_STAGING_TAG']))",
    "open(os.path.join(out, 'sentinel'), 'w').close()",
    "time.sleep(60)",
  ].join("\n"));
  const temp = join(dir, "temp");
  mkdirSync(temp);
  // Another call's staging folder, which the cleanup must leave alone (#1043).
  mkdirSync(join(temp, "coclerk_probe_0123456789abcdef_y"));
  await withTempDir(temp, () =>
    assert.throws(
      () => run(d, { payload: JSON.stringify({ out: dir }), timeoutMs: 2_500, timeoutAdvice: "Check before retrying." }),
      (err) => {
        assert.equal(err.name, "PythonTimeoutError");
        assert.equal(err.code, "python_timeout");
        assert.match(err.message, /^probe helper \(.*\) did not finish within 2500ms and was killed\. Check before retrying\.$/);
        return true;
      }
    )
  );
  assert.ok(existsSync(join(dir, "sentinel")), "the driver never reached its staging folder; raise timeoutMs");
  assert.deepEqual(readdirSync(temp).filter((name) => name.startsWith("coclerk_")), ["coclerk_probe_0123456789abcdef_y"]);
});

// #1348: the binder's tagged folder holds converted PDFs, not a database, so the caller names it.
test("a staging folder that cannot be removed is named by the caller's description", { skip: process.platform !== "win32" && "relies on Windows refusing to delete an open file" }, async (t) => {
  const temp = mkdtempSync(join(tmpdir(), "coclerk-python-spawn-"));
  const tag = "fedcba9876543210";
  const folder = join(temp, `coclerk_probe_${tag}_x`);
  mkdirSync(folder);
  // Python opens files without FILE_SHARE_DELETE, so while it holds this one the folder cannot go.
  const holder = spawn(PYTHON, ["-c", "import sys, time; f = open(sys.argv[1], 'w'); print('open', flush=True); time.sleep(60)", join(folder, "held")]);
  t.after(async () => {
    if (holder.exitCode === null) {
      holder.kill();
      await once(holder, "exit");
    }
    rmSync(temp, { recursive: true, force: true });
  });
  await once(holder.stdout, "data");
  const generic = await withTempDir(temp, () => removeKilledStaging(tag));
  const described = await withTempDir(temp, () => removeKilledStaging(tag, "temporary folder of converted PDFs"));
  assert.match(generic, /^ Its staging copy of the database could not be removed; delete it by hand: /);
  assert.match(described, /^ Its temporary folder of converted PDFs could not be removed; delete it by hand: /);
  assert.ok(described.includes(folder));
});
