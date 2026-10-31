// The migration guard (#812): a migration is applied only when the resulting schema is one the
// running bundle can actually read.
//
// Before this guard, every "ahead of the installed bundle" check compared the database against
// TARGET_SCHEMA_VERSION read live out of the working tree -- the same file a pending migration
// comes from, so the ceiling rose with every hop and the check could never fire. Matter L8145 was
// migrated to v26 by a read-only baseline call and then rendered `no such column: s.dropped_on`.
//
// These tests run against the unbundled build/ output, which carries no baked schema version, so
// each one states the ceiling through COCLERK_SUBMISSION_BUNDLE_SCHEMA_VERSION -- the test seam
// that loses to a baked value and therefore does nothing on a real bundled server.

import assert from "node:assert/strict";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after, before } from "node:test";

process.env.COCLERK_SUBMISSION_LOCK_ROOT = mkdtempSync(join(tmpdir(), "coclerk-schema-ceiling-locks-"));
after(() => rmSync(process.env.COCLERK_SUBMISSION_LOCK_ROOT, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }));

const { submissionDataMigrate, currentSchemaVersion } = await import("../build/submission/migrate.js");
const { submissionFormsBootstrap } = await import("../build/submission/forms.js");
const { CEILING_SEAM_ENV, OVERRIDE_ENV, renderableSchemaVersion, schemaSourceStatus } = await import(
  "../build/submission/schema-ceiling.js"
);
const { freshSubmissionDb, submissionDbAt } = await import("./helpers/template-db.mjs");
const { submissionDataQuery } = await import("../build/submission/backend.js");

const ENGINE_TARGET = currentSchemaVersion();

// Databases one and two hops behind the engine target, built once through the engine and copied per
// test, so a test migrates only those hops. Migrating the whole chain from an empty file runs past
// the Python driver's limit on the CI runner (#81).
const BEHIND_DIR = mkdtempSync(join(tmpdir(), "coclerk-schema-ceiling-behind-"));
const BEHIND_PATH = (hops) => join(BEHIND_DIR, `behind-${hops}.sqlite`);
before(() => {
  submissionDbAt(BEHIND_PATH(2), ENGINE_TARGET - 2);
  copyFileSync(BEHIND_PATH(2), BEHIND_PATH(1));
  submissionDbAt(BEHIND_PATH(1), ENGINE_TARGET - 1);
});
after(() => rmSync(BEHIND_DIR, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }));
function hopsBehindDb(dbPath, hops) {
  copyFileSync(BEHIND_PATH(hops), dbPath);
  assert.equal(Number(recordedVersion(dbPath)), ENGINE_TARGET - hops);
}

/** Restores every seam this suite sets, whatever the test does. */
function sandbox(t) {
  const before = { [CEILING_SEAM_ENV]: process.env[CEILING_SEAM_ENV], [OVERRIDE_ENV]: process.env[OVERRIDE_ENV] };
  t.after(() => {
    for (const [key, value] of Object.entries(before)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  const dir = mkdtempSync(join(tmpdir(), "coclerk-schema-ceiling-"));
  t.after(() => rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }));
  return { dir, dbPath: join(dir, "submission.sqlite") };
}

function backupsBeside(dbPath) {
  const dir = join(dbPath, "..");
  return readdirSync(dir).filter((name) => name.startsWith("submission.sqlite.bak-")).sort();
}

function recordedVersion(dbPath) {
  return submissionDataQuery(dbPath, "SELECT value FROM db_meta WHERE key = 'schema_version'", []).rows[0].value;
}

test("the ceiling is the bundle's stated version, not the migration source's target", () => {
  assert.equal(renderableSchemaVersion(ENGINE_TARGET, { [CEILING_SEAM_ENV]: String(ENGINE_TARGET - 1) }), ENGINE_TARGET - 1);
});

test("unbundled code with no stated ceiling falls back to the engine target", () => {
  assert.equal(renderableSchemaVersion(ENGINE_TARGET, {}), ENGINE_TARGET);
});

test("capped: a migration stops at the bundle's ceiling, never at the source's target", async (t) => {
  const { dbPath } = sandbox(t);
  hopsBehindDb(dbPath, 2);
  process.env[CEILING_SEAM_ENV] = String(ENGINE_TARGET - 1);
  delete process.env[OVERRIDE_ENV];

  await submissionDataMigrate(dbPath);
  assert.equal(Number(recordedVersion(dbPath)), ENGINE_TARGET - 1);
});

test("at the ceiling: a migration touches nothing, and copies nothing aside", async (t) => {
  const { dbPath } = sandbox(t);
  hopsBehindDb(dbPath, 1);
  const bytesBefore = readFileSync(dbPath);
  const backupsBefore = backupsBeside(dbPath);
  process.env[CEILING_SEAM_ENV] = String(ENGINE_TARGET - 1);
  delete process.env[OVERRIDE_ENV];

  await submissionDataMigrate(dbPath);
  assert.deepEqual(readFileSync(dbPath), bytesBefore, "the database file must be byte-identical");
  assert.equal(Number(recordedVersion(dbPath)), ENGINE_TARGET - 1);
  assert.deepEqual(backupsBeside(dbPath), backupsBefore, "no backup may be left behind by a migration that never ran");
});

test("override: COCLERK_SUBMISSION_ALLOW_UNBUILT_SCHEMA lets the hop through, and says so", async (t) => {
  const { dbPath } = sandbox(t);
  hopsBehindDb(dbPath, 1);
  process.env[CEILING_SEAM_ENV] = String(ENGINE_TARGET - 1);
  process.env[OVERRIDE_ENV] = "1";

  await submissionDataMigrate(dbPath);
  assert.equal(Number(recordedVersion(dbPath)), ENGINE_TARGET);

  const status = schemaSourceStatus(ENGINE_TARGET);
  assert.equal(status.schema_source_ahead, true);
  assert.match(status.schema_note, new RegExp(`${OVERRIDE_ENV} is set, so migrations do NOT stop at ${ENGINE_TARGET - 1}`));
});

test("normal path: a hop the bundle understands still migrates as it does today", async (t) => {
  const { dbPath } = sandbox(t);
  hopsBehindDb(dbPath, 1);
  process.env[CEILING_SEAM_ENV] = String(ENGINE_TARGET);
  delete process.env[OVERRIDE_ENV];

  await submissionDataMigrate(dbPath);
  assert.equal(Number(recordedVersion(dbPath)), ENGINE_TARGET);
  assert.equal(schemaSourceStatus(ENGINE_TARGET).schema_source_ahead, false);
});

test("bootstrap lists a database the bundle can read, even with the source ahead of the bundle", async (t) => {
  const { dbPath } = sandbox(t);
  hopsBehindDb(dbPath, 1);
  process.env[CEILING_SEAM_ENV] = String(ENGINE_TARGET - 1);
  const result = submissionFormsBootstrap(dbPath);

  assert.equal(result.migration_required, false);
  assert.equal(result.bundle_outdated, false);
  assert.equal(result.note, undefined);
  assert.ok(result.session_token, "a listed database gets a session");
  assert.equal(result.current_schema_version, ENGINE_TARGET - 1);
  assert.equal(result.schema_target_version, ENGINE_TARGET);
  assert.equal(result.bundle_schema_version, ENGINE_TARGET - 1);
  assert.equal(result.schema_source_ahead, true);
});

test("bootstrap reports a database ahead of the bundle as bundle_outdated -- the L8145 shape", async (t) => {
  const { dbPath } = sandbox(t);
  process.env[CEILING_SEAM_ENV] = String(ENGINE_TARGET);
  await freshSubmissionDb(dbPath);

  // The bundle is now the one that is behind, exactly as v1.28.39 was behind L8145's v26.
  process.env[CEILING_SEAM_ENV] = String(ENGINE_TARGET - 1);
  const result = submissionFormsBootstrap(dbPath);

  assert.equal(result.bundle_outdated, true);
  assert.equal(result.migration_required, false);
  assert.deepEqual(result.filings, []);
  assert.equal(result.current_schema_version, ENGINE_TARGET - 1);
});

test("divergence is reported even when no migration was attempted", async (t) => {
  const { dbPath } = sandbox(t);
  process.env[CEILING_SEAM_ENV] = String(ENGINE_TARGET);
  await freshSubmissionDb(dbPath);
  assert.ok(existsSync(dbPath));

  const healthy = submissionFormsBootstrap(dbPath);
  assert.equal(healthy.schema_target_version, ENGINE_TARGET);
  assert.equal(healthy.bundle_schema_version, ENGINE_TARGET);
  assert.equal(healthy.schema_source_ahead, false);
  assert.equal(healthy.migration_required, false);
  assert.equal(healthy.schema_note, undefined, "a note is for divergence, not for the healthy case");
});
