// A OneDrive sync conflict split of the matter-data stores: writes, migrate and a query of a
// missing store refuse with sync_conflict_copies, name the copies and create nothing.
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const { caseDataExecute, caseDataQuery } = await import("../build/case/backend.js");
const { caseDataMigrate } = await import("../build/case/migrate.js");

function splitFixture(t, { keepLive = false, store = "main" } = {}) {
  const scratch = mkdtempSync(join(tmpdir(), "coclerk-case-split-"));
  t.after(() => rmSync(scratch, { recursive: true, force: true }));
  const matterRoot = join(scratch, "T9999 Scratch Matter");
  const caseDataDir = join(matterRoot, "0. CASE DATA");
  mkdirSync(caseDataDir, { recursive: true });
  writeFileSync(join(matterRoot, "probanda.json"), JSON.stringify({
    schema_version: 5,
    matter_root: matterRoot,
    case_data_dir: "0. CASE DATA",
    evidence_sql_path: join("0. CASE DATA", "evidence.sql"),
  }));
  if (keepLive) writeFileSync(join(caseDataDir, "main.sqlite"), "");
  writeFileSync(join(caseDataDir, `${store}-DESKTOP-4F2K9.sqlite`), "copy one");
  writeFileSync(join(caseDataDir, `${store}-DEVICE_A.sqlite`), "copy two");
  const triggers = join(scratch, "repo", "source", "skills", "matter-data", "references");
  mkdirSync(triggers, { recursive: true });
  writeFileSync(join(triggers, "triggers.sql"), "SELECT 1;");
  const env = { ...process.env, COCLERK_REPO_ROOT: join(scratch, "repo"), COCLERK_CASE_LOCK_ROOT: join(scratch, "locks") };
  const listing = () => readdirSync(caseDataDir).sort();
  return { matterRoot, caseDataDir, env, listing, before: listing() };
}

async function rejection(promise) {
  try {
    await promise;
  } catch (err) {
    return err;
  }
  assert.fail("expected a refusal");
}

function assertNamesBoth(err, store) {
  assert.equal(err.code, "sync_conflict_copies");
  assert.match(err.message, /^sync_conflict_copies: /);
  assert.match(err.message, new RegExp(`${store}-DESKTOP-4F2K9\\.sqlite`));
  assert.match(err.message, new RegExp(`${store}-DEVICE_A\\.sqlite`));
  assert.doesNotMatch(err.message, /migrate/i);
}

test("a missing main.sqlite with two copies: execute, migrate and query refuse and create nothing", async (t) => {
  const f = splitFixture(t);
  const refusals = [
    await rejection(caseDataExecute(f.matterRoot, "CREATE TABLE t (x);", f.env)),
    await rejection(caseDataMigrate(f.matterRoot, "plan", {}, f.env)),
    await rejection(caseDataMigrate(f.matterRoot, "apply", {}, f.env)),
  ];
  for (const err of refusals) assertNamesBoth(err, "main");
  assert.deepEqual(refusals[0].details.copies.map((p) => p.split(/[\\/]/).pop()), ["main-DESKTOP-4F2K9.sqlite", "main-DEVICE_A.sqlite"]);
  const query = await rejection(Promise.resolve().then(() => caseDataQuery(f.matterRoot, "SELECT 1")));
  assert.match(query.message, /sync_conflict_copies: .*main-DESKTOP-4F2K9\.sqlite.*main-DEVICE_A\.sqlite/);
  assert.doesNotMatch(query.message, /migrate|initialize/i);
  assert.equal(existsSync(join(f.caseDataDir, "main.sqlite")), false, "no fresh store");
  assert.deepEqual(f.listing(), f.before, "nothing created, moved or removed");
  assert.equal(existsSync(join(f.caseDataDir, "evidence.sql")), false);
});

test("copies of law.sqlite beside a live main.sqlite: a write refuses and changes nothing", async (t) => {
  const f = splitFixture(t, { keepLive: true, store: "law" });
  assertNamesBoth(await rejection(caseDataExecute(f.matterRoot, "CREATE TABLE t (x);", f.env)), "law");
  assert.deepEqual(f.listing(), f.before);
});
