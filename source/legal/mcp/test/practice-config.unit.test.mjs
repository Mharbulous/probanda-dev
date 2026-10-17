import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const { config_set_root, config_status, DOCUMENTED_KEYS } = await import("../build/tools/practice/config.js");
const { resolveCaseDataRoot } = await import("../build/practice/backend.js");

const FULL = {
  version: 1,
  firm: { address: "1 Example Street", email: "", fax: "" },
  review: { scope: "full", comments: "at_end" },
  person: "pe",
  signature: "C:\\example\\signature.png",
  practice_quirks: "Mail is read through the iCloud copy.",
  briefing: { mailbox: "a@example.com", to: "b@example.com", greeting_name: "Pat" },
  accounting: { system: "UNITY", csv_mapping: { date_format: "YYYY-MM-DD" } },
  repo_root: "C:\\example\\repo",
  page_api_port: 47615,
};

// A scratch APPDATA and LOCALAPPDATA, as practice-paths.unit.test.mjs builds them, with a
// "0. CASE DATA" root that holds _practice\practice.db and an initialized matter pointing into it.
function fixture(t) {
  const scratch = mkdtempSync(join(tmpdir(), "coclerk-practice-config-"));
  t.after(() => rmSync(scratch, { recursive: true, force: true }));
  const appData = join(scratch, "appdata");
  const localAppData = join(scratch, "localappdata");
  mkdirSync(appData);
  mkdirSync(localAppData);
  const root = join(scratch, "library", "0. CASE DATA");
  mkdirSync(join(root, "_practice"), { recursive: true });
  writeFileSync(join(root, "_practice", "practice.db"), "");
  const matter = join(scratch, "library", "Example Matter");
  mkdirSync(matter);
  writeFileSync(
    join(matter, "coclerk.json"),
    JSON.stringify({ schema_version: 5, case_data_dir: join(root, "Example Matter") })
  );
  return {
    scratch,
    root,
    matter,
    env: { APPDATA: appData, LOCALAPPDATA: localAppData },
    configPath: join(appData, "Coclerk", "probanda.json"),
  };
}

function writeConfig(f, value) {
  mkdirSync(join(f.env.APPDATA, "Coclerk"), { recursive: true });
  writeFileSync(f.configPath, typeof value === "string" ? value : JSON.stringify(value, null, 2));
}

test("config_status reports a missing file and names the candidate root from a matter", async (t) => {
  const f = fixture(t);
  const status = await config_status({ matter_root: f.matter }, f.env);
  assert.equal(status.path, f.configPath);
  assert.equal(status.exists, false);
  assert.equal(status.override, false);
  assert.deepEqual(status.keys_missing, DOCUMENTED_KEYS);
  assert.equal(status.case_data_root, null);
  assert.equal(status.candidates.length, 1);
  assert.equal(status.candidates[0].source, "matter_root");
  assert.equal(status.candidates[0].practice_db_exists, true);
  assert.equal(status.candidates[0].root, realpathSync.native(f.root), "canonical, as the helper returns it");
  assert.deepEqual(status.redirected_copies, []);
  assert.equal(status.pending_writes, null, "with no root there is no practice.db to read");
  assert.equal(existsSync(f.configPath), false, "config_status never creates the file");
});

test("config_status reports a file without case_data_root and which keys are missing", async (t) => {
  const f = fixture(t);
  writeConfig(f, { version: 1, person: "pe" });
  const status = await config_status({}, f.env);
  assert.equal(status.exists, true);
  assert.deepEqual(status.keys_present, ["version", "person"]);
  assert.ok(status.keys_missing.includes("case_data_root"));
  assert.ok(!status.keys_missing.includes("person"));
  assert.equal(status.case_data_root, null);
  assert.deepEqual(status.candidates, []);
});

test("config_status reports a configured root and whether it holds practice.db", async (t) => {
  const f = fixture(t);
  writeConfig(f, { ...FULL, case_data_root: f.root });
  const ok = await config_status({}, f.env);
  assert.equal(ok.case_data_root, f.root);
  assert.equal(ok.root_exists, true);
  assert.equal(ok.practice_db_exists, true);
  assert.deepEqual(ok.keys_missing, []);
  assert.equal(ok.cloud_credential, "missing", "no commons credential in this machine's scratch LOCALAPPDATA");
  assert.equal(ok.pending_writes, 0, "an empty practice.db holds no pending write, and is not opened");
  assert.equal(readFileSync(join(f.root, "_practice", "practice.db"), "utf-8"), "");
  const keyed = await config_status({}, { ...f.env, LEGAL_COMMONS_SUPABASE_KEY: "sb_secret_X" });
  assert.equal(keyed.cloud_credential, "present");

  const empty = join(f.scratch, "empty root");
  mkdirSync(empty);
  writeConfig(f, { ...FULL, case_data_root: empty });
  const broken = await config_status({}, f.env);
  assert.equal(broken.root_exists, true);
  assert.equal(broken.practice_db_exists, false);
});

test("config_status reports invalid JSON and a matter that refuses", async (t) => {
  const f = fixture(t);
  writeConfig(f, "{ not json");
  const status = await config_status({ matter_root: join(f.scratch, "no such matter") }, f.env);
  assert.equal(status.exists, true);
  assert.match(status.parse_error, /JSON/);
  assert.deepEqual(status.candidates, []);
  assert.match(status.candidate_error, /matter_root not found/);
});

test("config_status lists redirected copies without reading them", async (t) => {
  const f = fixture(t);
  const redirected = join(f.env.LOCALAPPDATA, "Packages", "Example.App_abc", "LocalCache", "Roaming", "Coclerk");
  mkdirSync(redirected, { recursive: true });
  writeFileSync(join(redirected, "coclerk.json"), JSON.stringify({ case_data_root: f.root }));
  mkdirSync(join(f.env.LOCALAPPDATA, "Packages", "Other.App_def"));
  const status = await config_status({}, f.env);
  assert.deepEqual(status.redirected_copies, [join(redirected, "coclerk.json")]);
  assert.equal(status.exists, false);
  assert.equal(status.case_data_root, null);
});

test("a COCLERK_CONFIG_PATH naming a missing file is reported by status and refused by set_root", async (t) => {
  const f = fixture(t);
  const override = join(f.scratch, "scratch-coclerk.json");
  const env = { ...f.env, COCLERK_CONFIG_PATH: override };
  const status = await config_status({}, env);
  assert.equal(status.override, true);
  assert.equal(status.exists, false);
  assert.equal(status.path, override);
  assert.match(status.error, /COCLERK_CONFIG_PATH names .*does not exist/);

  await assert.rejects(() => config_set_root({ case_data_root: f.root }, env), /COCLERK_CONFIG_PATH names .*does not exist/);
  assert.equal(existsSync(override), false);
  assert.equal(existsSync(f.configPath), false, "never falls back to the live file");
});

test("config_set_root refuses a root without _practice\\practice.db and writes nothing", async (t) => {
  const f = fixture(t);
  const empty = join(f.scratch, "elsewhere", "0. CASE DATA");
  mkdirSync(empty, { recursive: true });
  await assert.rejects(() => config_set_root({ case_data_root: empty }, f.env), /practice\.db does not exist.*Nothing was written/);
  await assert.rejects(() => config_set_root({ case_data_root: "relative\\path" }, f.env), /absolute path/);
  assert.equal(existsSync(f.configPath), false);
  assert.equal(existsSync(join(empty, "_practice")), false, "never creates _practice");
});

test("config_set_root creates a missing file with only version and case_data_root", async (t) => {
  const f = fixture(t);
  const result = await config_set_root({ case_data_root: f.root }, f.env);
  assert.equal(result.created, true);
  assert.equal(result.previous_case_data_root, null);
  assert.deepEqual(JSON.parse(readFileSync(f.configPath, "utf-8")), { version: 1, case_data_root: f.root });
  assert.ok(result.keys_missing.includes("person"));
  assert.ok(!result.keys_missing.includes("case_data_root"));
  assert.equal(resolveCaseDataRoot(f.env), f.root, "the practice database now resolves");
});

test("config_set_root changes only case_data_root in a full file whose root is broken", async (t) => {
  const f = fixture(t);
  const moved = join(f.scratch, "moved", "0. CASE DATA");
  writeConfig(f, { ...FULL, case_data_root: moved });
  const result = await config_set_root({ case_data_root: f.root }, f.env);
  assert.equal(result.created, false);
  assert.equal(result.previous_case_data_root, moved);
  assert.deepEqual(result.keys_missing, []);
  const after = JSON.parse(readFileSync(f.configPath, "utf-8"));
  assert.equal(after.case_data_root, f.root);
  const { case_data_root: _, ...others } = after;
  assert.deepEqual(others, FULL);
  assert.deepEqual(Object.keys(after), [...Object.keys(FULL), "case_data_root"], "key order kept");
});

test("config_set_root never repoints a working root", async (t) => {
  const f = fixture(t);
  writeConfig(f, { ...FULL, case_data_root: f.root });
  const before = readFileSync(f.configPath, "utf-8");
  const other = join(f.scratch, "other", "0. CASE DATA");
  mkdirSync(join(other, "_practice"), { recursive: true });
  writeFileSync(join(other, "_practice", "practice.db"), "");
  await assert.rejects(
    () => config_set_root({ case_data_root: other }, f.env),
    (err) => err.code === "root_already_working" && /never repointed/.test(err.message)
  );
  assert.equal(readFileSync(f.configPath, "utf-8"), before);
});

test("config_set_root refuses a file that is not valid JSON", async (t) => {
  const f = fixture(t);
  writeConfig(f, "{ not json");
  await assert.rejects(() => config_set_root({ case_data_root: f.root }, f.env), /not valid JSON.*Nothing was written/);
  assert.equal(readFileSync(f.configPath, "utf-8"), "{ not json");
});

test("the path-resolution errors name their repair: /legal:probanda-setup for a missing file, config_status otherwise", (t) => {
  const f = fixture(t);
  assert.throws(() => resolveCaseDataRoot(f.env), /not found\..*\/legal:probanda-setup/);
  writeConfig(f, { version: 1 });
  assert.throws(() => resolveCaseDataRoot(f.env), /missing "case_data_root".*practice_data__config_status/);
});
