// The data server reads Probanda's Cloud credential the way the commons server does
// (source/mcp-shared/commons-key.js): the env override first, then Credential Manager (a fake here), with the baked URL.

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { fakeCloudKeyStore } from "./helpers/fake-cloud-key-store.mjs";

const { loadCloudKey } = await import("../build/cloud-key.js");

const BAKED_URL = "https://nbzkuhgiqscjkypedqff.supabase.co";

function emptyStateDir(t) {
  const dir = mkdtempSync(join(tmpdir(), "coclerk-cloud-key-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test("the env override supplies the key, with the baked URL", async (t) => {
  const env = { LOCALAPPDATA: emptyStateDir(t), LEGAL_COMMONS_SUPABASE_KEY: "sb_secret_FROM_ENV" };
  assert.deepEqual(await loadCloudKey(env), { configured: true, supabaseUrl: BAKED_URL, staticKey: "sb_secret_FROM_ENV" });
});

test("LEGAL_COMMONS_SUPABASE_KEY wins over SUPABASE_SERVICE_ROLE_KEY, which is read when it is blank", async (t) => {
  const dir = emptyStateDir(t);
  const both = { LOCALAPPDATA: dir, LEGAL_COMMONS_SUPABASE_KEY: "sb_secret_FIRST", SUPABASE_SERVICE_ROLE_KEY: "sb_secret_SECOND" };
  assert.equal((await loadCloudKey(both)).staticKey, "sb_secret_FIRST");
  const second = { LOCALAPPDATA: dir, LEGAL_COMMONS_SUPABASE_KEY: "", SUPABASE_SERVICE_ROLE_KEY: "sb_secret_SECOND" };
  assert.equal((await loadCloudKey(second)).staticKey, "sb_secret_SECOND");
});

test("SUPABASE_URL overrides the baked URL", async (t) => {
  const env = { LOCALAPPDATA: emptyStateDir(t), SUPABASE_URL: "https://example.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "sb_secret_X" };
  assert.equal((await loadCloudKey(env)).supabaseUrl, "https://example.supabase.co");
});

test("no env key and nothing in the store: not configured, naming the tool that sets it", async (t) => {
  const result = await loadCloudKey({ LOCALAPPDATA: emptyStateDir(t) }, fakeCloudKeyStore());
  assert.equal(result.configured, false);
  assert.equal(result.supabaseUrl, BAKED_URL);
  assert.equal("staticKey" in result, false);
  assert.match(result.reason, /no credential is configured; set it with cloud_key__configure_credential, or ask Probanda for a key with key_request__submit/);
});

test("a key in the store is configured; an unreadable store names the cause", async (t) => {
  const env = { LOCALAPPDATA: emptyStateDir(t) };
  assert.deepEqual(await loadCloudKey(env, fakeCloudKeyStore("sb_secret_STORED")), { configured: true, supabaseUrl: BAKED_URL, staticKey: "sb_secret_STORED" });
  const broken = fakeCloudKeyStore();
  broken.failRead = "Credential Manager read failed: CredReadW failed with Win32 error 5";
  const result = await loadCloudKey(env, broken);
  assert.equal(result.configured, false);
  assert.match(result.reason, /^the stored credential could not be read \(Credential Manager read failed: CredReadW failed with Win32 error 5\); set it with cloud_key__configure_credential/);
});
