// Adapter-level tests for case_data__migrate.
//
// The engine's own behaviour (chain building, token, backup, restore) is
// covered by .claude/skills/case-data/tests/test_migrate_engine.py. What these
// prove is the wiring the Python suite cannot see: tool registration, dispatch
// routing, repo-root/PYTHONPATH resolution to the skills tree, the MigrateError
// round trip into a DataServerError, and lock release.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const { caseDataMigrate } = await import("../build/case/migrate.js");
const { buildToolDefinitions } = await import("../build/schema-gen.js");
const { callTool } = await import("../build/dispatch.js");

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const SCHEMA = join(REPO_ROOT, ".claude", "skills", "case-data", "references", "schema.sql");
const PYTHON = process.env.COCLERK_PYTHON || "python";

// Isolate every run from %LOCALAPPDATA% so a test never touches real backups.
function isolatedEnv(extra = {}) {
  const scratch = mkdtempSync(join(tmpdir(), "coclerk-migrate-env-"));
  return {
    env: {
      ...process.env,
      COCLERK_REPO_ROOT: REPO_ROOT,
      COCLERK_CASE_BACKUP_ROOT: join(scratch, "backups"),
      COCLERK_CASE_LOCK_ROOT: join(scratch, "locks"),
      ...extra,
    },
    cleanup: () => rmSync(scratch, { recursive: true, force: true }),
  };
}

const BUILD_FIXTURE = `
import re, sqlite3, sys
schema_path, case_data_dir, version = sys.argv[1], sys.argv[2], int(sys.argv[3])
text = open(schema_path, encoding='utf-8').read()
marks = list(re.finditer(r'^-- ===== v6 BEGIN (\\w+) =====$', text, re.M))
for i, m in enumerate(marks):
    end = marks[i + 1].start() if i + 1 < len(marks) else len(text)
    body = re.sub(r'^-- ===== v6 END \\w+ =====$', '', text[m.end():end], flags=re.M)
    con = sqlite3.connect(case_data_dir + '/' + m.group(1) + '.sqlite')
    con.executescript(body)
    if m.group(1) == 'main':
        con.executescript('DROP INDEX IF EXISTS idx_housekeeping_reviews_hash;'
                          'DROP TABLE IF EXISTS housekeeping_reviews;')
        if version < 79:
            # Pre-v7.9 fixtures lack execution_status, so the 78 -> 79
            # ALTER genuinely fires instead of colliding.
            con.execute('ALTER TABLE sources DROP COLUMN execution_status')
        if version < 80:
            # Pre-v8.0 fixtures lack the corrected-row quarantine marker.
            con.execute('ALTER TABLE facts DROP COLUMN pending_reverification')
            con.execute('ALTER TABLE positions DROP COLUMN pending_reverification')
        if version < 82:
            # Pre-v8.2 fixtures lack the address-for-service provenance columns.
            con.execute('ALTER TABLE parties DROP COLUMN service_address_filed_date')
            con.execute('ALTER TABLE parties DROP COLUMN replaced_representative')
        # No un-upgrade is needed for the 82 -> 83 hop: it widens
        # proceeding_parties.role via a table rebuild, which copies rows
        # across regardless of whether the source CHECK already has 'appellant'.
        if version < 84:
            # Pre-v8.4 fixtures lack sought_orders, so the 83 -> 84 CREATE
            # genuinely fires instead of short-circuiting on IF NOT EXISTS.
            con.execute('DROP TABLE IF EXISTS sought_orders')
        if version < 87:
            # Pre-v8.7 fixtures lack privilege_status, so the 86 -> 87 ALTER
            # genuinely fires instead of colliding on a duplicate column.
            con.execute('ALTER TABLE sources DROP COLUMN privilege_status')
        if version < 89:
            # Pre-v8.9 fixtures lack the counsel contact columns and the
            # per-proceeding overrides, so the 88 -> 89 ALTERs genuinely fire.
            for column in ('lawyer_email', 'lawyer_phone'):
                con.execute('ALTER TABLE parties DROP COLUMN ' + column)
            for column in ('lawyer_name', 'lawyer_firm', 'lawyer_email',
                           'lawyer_phone', 'address', 'service_address_filed_date'):
                con.execute('ALTER TABLE proceeding_parties DROP COLUMN ' + column)
        if version < 90:
            # Pre-v9.0 fixtures lack the participant tables, so the 89 -> 90
            # CREATEs genuinely fire instead of short-circuiting on IF NOT EXISTS.
            con.execute('DROP TABLE IF EXISTS participant_aliases')
            con.execute('DROP TABLE IF EXISTS tribunal_members')
    if m.group(1) == 'law' and version < 85:
        # Pre-v8.5 fixtures lack the capture columns, so the 84 -> 85 rebuild
        # genuinely adds them. The three CHECK widenings in the same hop need
        # no un-upgrade: a table rebuild copies rows across regardless of what
        # the source CHECK already allowed.
        con.execute('ALTER TABLE concept_authorities DROP COLUMN pinpoint')
        con.execute('ALTER TABLE concept_authorities DROP COLUMN excerpt')
    # No un-upgrade is needed for the 85 -> 86 hop: it relaxes
    # client_instructions.proceeding_id via a table rebuild, which copies rows
    # across whether or not the source column was NOT NULL.
    con.execute('PRAGMA user_version = %d' % version)
    con.commit(); con.close()
`;

function fixture(version) {
  const matterRoot = mkdtempSync(join(tmpdir(), "coclerk-migrate-"));
  const caseDataDir = join(matterRoot, "case-data");
  mkdirSync(caseDataDir);
  mkdirSync(join(matterRoot, "4. LAWYER BRIEF", "CoWork"), { recursive: true });
  writeFileSync(join(matterRoot, "coclerk.json"), JSON.stringify({
    schema_version: 5,
    matter_root: matterRoot,
    case_data_dir: caseDataDir,
    evidence_sql_path: join("4. LAWYER BRIEF", "CoWork", "evidence.sql"),
  }));
  const res = spawnSync(PYTHON, ["-c", BUILD_FIXTURE, SCHEMA, caseDataDir, String(version)], {
    encoding: "utf-8",
  });
  if (res.status !== 0) throw new Error(`fixture Python failed: ${res.stderr}`);
  return { matterRoot, caseDataDir, cleanup: () => rmSync(matterRoot, { recursive: true, force: true }) };
}

function staleFixture(version) {
  const scratch = mkdtempSync(join(tmpdir(), "coclerk-migrate-stale-"));
  const litigationRoot = join(scratch, "Litigation - Documents");
  const matterRoot = join(litigationRoot, "T9999 Scratch Matter");
  const caseDataDir = join(litigationRoot, "0. CASE DATA", "T9999 Scratch Matter");
  mkdirSync(caseDataDir, { recursive: true });
  mkdirSync(join(matterRoot, "4. LAWYER BRIEF", "CoWork"), { recursive: true });
  writeFileSync(join(matterRoot, "coclerk.json"), JSON.stringify({
    schema_version: 5,
    matter_root: "C:\\Users\\DeletedProfile\\Matter",
    case_data_dir: "C:\\Users\\DeletedProfile\\case-data",
    evidence_sql_path: join("4. LAWYER BRIEF", "CoWork", "evidence.sql"),
  }));
  const res = spawnSync(PYTHON, ["-c", BUILD_FIXTURE, SCHEMA, caseDataDir, String(version)], {
    encoding: "utf-8",
  });
  if (res.status !== 0) throw new Error(`fixture Python failed: ${res.stderr}`);
  return { matterRoot, caseDataDir, cleanup: () => rmSync(scratch, { recursive: true, force: true }) };
}

function userVersions(caseDataDir) {
  const res = spawnSync(PYTHON, ["-c",
    "import sqlite3,sys;print(','.join(str(sqlite3.connect(sys.argv[1]+'/'+d+'.sqlite')" +
    ".execute('PRAGMA user_version').fetchone()[0]) for d in ('main','law','privileged')))",
    caseDataDir], { encoding: "utf-8" });
  if (res.status !== 0) throw new Error(res.stderr);
  return res.stdout.trim().split(",").map(Number);
}

test("case_data__migrate is registered with a destructive annotation", () => {
  const def = buildToolDefinitions().find((t) => t.name === "case_data__migrate");
  assert.ok(def, "case_data__migrate is missing from the tool list");
  assert.deepEqual(def.inputSchema.required, ["matter_root", "mode"]);
  // plan is destructive too: pointer resolution rewrites coclerk.json.
  assert.equal(def.annotations.destructiveHint, true);
  assert.notEqual(def.annotations.readOnlyHint, true);
});

test("dispatch rejects an unknown mode before spawning anything", async () => {
  await assert.rejects(
    () => callTool({}, "case_data__migrate", { matter_root: "C:\\nope", mode: "sideways" }),
    /unknown mode .*expected plan, apply, restore, or backups/,
  );
});

test("plan then apply reaches v9.0 through the full adapter stack", async () => {
  const f = fixture(76);
  const { env, cleanup } = isolatedEnv();
  try {
    assert.deepEqual(userVersions(f.caseDataDir), [76, 76, 76]);

    const plan = await caseDataMigrate(f.matterRoot, "plan", {}, env);
    assert.equal(plan.from_version, "7.6");
    assert.equal(plan.already_current, false);
    assert.match(plan.plan_token, /^cdm1\.[0-9a-f]{32}$/);
    assert.equal(plan.user_confirmation_required, "MIGRATE matter v7.6 -> v9.0");
    // A plan is a dry run: the natives must still be at 7.6.
    assert.deepEqual(userVersions(f.caseDataDir), [76, 76, 76]);

    const applied = await caseDataMigrate(f.matterRoot, "apply", {
      planToken: plan.plan_token,
      userConfirmation: plan.user_confirmation_required,
    }, env);
    assert.equal(applied.applied, true);
    assert.deepEqual(userVersions(f.caseDataDir), [90, 90, 90]);
    assert.equal(applied.evidence_sql_written, true);

    // The lock released, so a follow-up call succeeds rather than timing out.
    const listing = await caseDataMigrate(f.matterRoot, "backups", {}, env);
    assert.equal(listing.backups.length, 1);
    assert.equal(listing.backups[0].backup_id, applied.backup_id);
    assert.equal(listing.inflight, false);
  } finally {
    cleanup();
    f.cleanup();
  }
});

test("migration plan uses R2 live derivation and heals a stale breadcrumb", async () => {
  const f = staleFixture(76);
  const { env, cleanup } = isolatedEnv();
  try {
    const plan = await caseDataMigrate(f.matterRoot, "plan", {}, env);
    assert.equal(plan.from_version, "7.6");
    const healed = JSON.parse(readFileSync(join(f.matterRoot, "coclerk.json"), "utf-8"));
    assert.equal(healed.matter_root, f.matterRoot);
    assert.equal(healed.case_data_dir, f.caseDataDir);
    assert.deepEqual(userVersions(f.caseDataDir), [76, 76, 76]);
  } finally {
    cleanup();
    f.cleanup();
  }
});

test("a refusal round-trips as a DataServerError carrying the engine's code", async () => {
  const f = fixture(90);
  const { env, cleanup } = isolatedEnv();
  try {
    await assert.rejects(
      () => caseDataMigrate(f.matterRoot, "apply", {
        planToken: "cdm1.0000000000000000000000000000000",
        userConfirmation: "MIGRATE matter v9.0 -> v9.0",
      }, env),
      (err) => {
        assert.equal(err.code, "migrate_refused");
        assert.match(err.message, /already at v9\.0/);
        return true;
      },
    );
  } finally {
    cleanup();
    f.cleanup();
  }
});

test("a missing repo root fails loudly instead of silently skipping migrate", async () => {
  const f = fixture(76);
  // Auto-detection off: this asserts the no-configuration failure. Without the
  // flag, the walk-up candidate would find this checkout's own repo (the suite
  // runs from inside it) and migrate would actually run.
  const { env, cleanup } = isolatedEnv({
    COCLERK_REPO_ROOT: "",
    COCLERK_REPO_ROOT_AUTODETECT: "0",
  });
  try {
    await assert.rejects(
      () => caseDataMigrate(f.matterRoot, "plan", {}, env),
      (err) => {
        assert.equal(err.code, "repo_root_missing");
        assert.match(err.message, /cannot locate the case-data maintenance scripts: no installed Probanda plugin holds it/);
        return true;
      },
    );
  } finally {
    cleanup();
    f.cleanup();
  }
});
