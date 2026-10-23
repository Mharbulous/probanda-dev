// Probanda's key in Windows Credential Manager (mcp-shared/commons-key.js): save, read, the one-time
// migration of a key an earlier version kept as a DPAPI file, missing, and an unreadable store. The
// store is a fake throughout. The DPAPI-file migration is in commons-key-migration.e2e.test.mjs and the
// real store in key-store-roundtrip.e2e.test.mjs, because each spawns PowerShell past the unit budget.
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { fakeCloudKeyStore } from "./helpers/fake-cloud-key-store.mjs";

const { CLOUD_KEY_TARGET, credentialPath, loadCommonsKey, saveCommonsKey } = await import("../../../mcp-shared/commons-key.js");

const BAKED_URL = "https://nbzkuhgiqscjkypedqff.supabase.co";

function scratchEnv(t) {
  const dir = mkdtempSync(join(tmpdir(), "probanda-commons-key-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return { LOCALAPPDATA: dir };
}

test("the target is the one the skill text and the hook name", () => {
  assert.equal(CLOUD_KEY_TARGET, "Probanda/cloud-key");
});

test("save writes the store only, and the saved key is read back without a second store read", async (t) => {
  const env = scratchEnv(t);
  const store = fakeCloudKeyStore();
  await saveCommonsKey("sb_secret_SAVED", env, store);
  assert.equal(store.secret, "sb_secret_SAVED");
  assert.equal(existsSync(credentialPath(env)), false, "no file holds the key");
  assert.deepEqual(await loadCommonsKey(env, store), { supabaseUrl: BAKED_URL, staticKey: "sb_secret_SAVED" });
  assert.equal(store.reads, 0, "the process keeps the key it just saved");
});

test("a key already in the store is read once and then cached; env still wins", async (t) => {
  const env = scratchEnv(t);
  const store = fakeCloudKeyStore("sb_secret_STORED");
  assert.equal((await loadCommonsKey(env, store)).staticKey, "sb_secret_STORED");
  assert.equal((await loadCommonsKey(env, store)).staticKey, "sb_secret_STORED");
  assert.equal(store.reads, 1);
  assert.equal((await loadCommonsKey({ ...env, LEGAL_COMMONS_SUPABASE_KEY: "sb_secret_ENV" }, store)).staticKey, "sb_secret_ENV");
});

test("missing: an empty store and no legacy file read as not configured, and the store is asked again next time", async (t) => {
  const env = scratchEnv(t);
  const store = fakeCloudKeyStore();
  assert.deepEqual(await loadCommonsKey(env, store), { supabaseUrl: BAKED_URL, staticKey: "" });
  await loadCommonsKey(env, store);
  assert.equal(store.reads, 2, "absence is never cached");
  assert.equal(store.writes, 0, "nothing to migrate");
});

test("an unreadable store reads as not configured with the cause, and never throws", async (t) => {
  const env = scratchEnv(t);
  const store = fakeCloudKeyStore();
  store.failRead = "Credential Manager read failed: CredReadW failed with Win32 error 5\nat line 3";
  const key = await loadCommonsKey(env, store);
  assert.equal(key.staticKey, "");
  assert.equal(key.credentialError, "Credential Manager read failed: CredReadW failed with Win32 error 5");
});
