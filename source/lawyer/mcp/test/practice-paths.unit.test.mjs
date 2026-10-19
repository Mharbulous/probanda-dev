import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const { resolvePracticeDbPath } = await import("../build/practice/backend.js");

function fixture(t) {
  const scratch = mkdtempSync(join(tmpdir(), "coclerk-practice-path-"));
  t.after(() => rmSync(scratch, { recursive: true, force: true }));
  const appData = join(scratch, "appdata");
  const configDir = join(appData, "Probanda");
  mkdirSync(configDir, { recursive: true });
  return { scratch, appData, configPath: join(configDir, "probanda.json") };
}

test("configured practice case_data_root must already exist and creates no _practice directory", (t) => {
  const f = fixture(t);
  const missingRoot = join(f.scratch, "moved", "0. CASE DATA");
  writeFileSync(f.configPath, JSON.stringify({ case_data_root: missingRoot }));

  assert.throws(
    () => resolvePracticeDbPath({ APPDATA: f.appData }),
    /case_data_root.*does not exist.*Probanda\\probanda\.json/i,
  );
  assert.equal(existsSync(join(missingRoot, "_practice")), false);
});

test("an existing configured root and COCLERK_DB_PATH override retain their behavior", (t) => {
  const f = fixture(t);
  const root = join(f.scratch, "0. CASE DATA");
  mkdirSync(root);
  writeFileSync(f.configPath, JSON.stringify({ case_data_root: root }));

  assert.equal(
    resolvePracticeDbPath({ APPDATA: f.appData, COCLERK_DB_NAME: "firm.sqlite" }),
    join(root, "_practice", "firm.sqlite"),
  );
  assert.equal(
    resolvePracticeDbPath({ APPDATA: f.appData, COCLERK_DB_PATH: "X:\\test\\practice.db" }),
    "X:\\test\\practice.db",
  );
});
