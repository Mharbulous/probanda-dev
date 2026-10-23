// A key an earlier version kept as a DPAPI file (mcp-shared/commons-key.js, migrateLegacyFile) is moved
// into the store the first time it is read, from its real path or a packaged app's redirected copy, and
// the file is deleted. Real DPAPI files, so Windows only, in the e2e tier: each spawns PowerShell.
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { fakeCloudKeyStore } from "./helpers/fake-cloud-key-store.mjs";

const { credentialPath, loadCommonsKey, saveCommonsKey } = await import("../../../mcp-shared/commons-key.js");
const { writeProtectedJson } = await import("../../../mcp-shared/dpapi-store.js");

const onWindows = process.platform === "win32";

function scratchEnv(t) {
  const dir = mkdtempSync(join(tmpdir(), "probanda-commons-key-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return { LOCALAPPDATA: dir };
}

// The legacy files are real DPAPI files, so this runs on Windows only, as the DPAPI tests do.
test("a key an earlier version saved as a file is moved into the store once, and the files are deleted", { skip: !onWindows }, async (t) => {
  const env = scratchEnv(t);
  const real = credentialPath(env);
  const redirected = join(env.LOCALAPPDATA, "Packages", "Claude_abc123", "LocalCache", "Local", "Coclerk", "legal-commons", "credential.json.dpapi");
  mkdirSync(join(redirected, ".."), { recursive: true });
  await writeProtectedJson(redirected, { staticKey: "sb_secret_FROM_REDIRECTED_FILE" }, true);

  const store = fakeCloudKeyStore();
  assert.equal((await loadCommonsKey(env, store)).staticKey, "sb_secret_FROM_REDIRECTED_FILE");
  assert.equal(store.secret, "sb_secret_FROM_REDIRECTED_FILE");
  assert.equal(existsSync(redirected), false, "the redirected copy is gone");
  assert.equal(existsSync(real), false);

  // The real path is preferred when both exist, and both are removed.
  const second = fakeCloudKeyStore();
  await writeProtectedJson(real, { staticKey: "sb_secret_FROM_REAL_FILE" }, true);
  await writeProtectedJson(redirected, { staticKey: "sb_secret_FROM_REDIRECTED_FILE" }, true);
  assert.equal((await loadCommonsKey(env, second)).staticKey, "sb_secret_FROM_REAL_FILE");
  assert.equal(existsSync(real), false);
  assert.equal(existsSync(redirected), false);
  assert.equal(second.writes, 1);
});

test("saving a new key removes a legacy file without reading it", { skip: !onWindows }, async (t) => {
  const env = scratchEnv(t);
  const real = credentialPath(env);
  await writeProtectedJson(real, { staticKey: "sb_secret_OLD" }, true);
  const store = fakeCloudKeyStore();
  await saveCommonsKey("sb_secret_NEW", env, store);
  assert.equal(store.secret, "sb_secret_NEW");
  assert.equal(existsSync(real), false);
});
