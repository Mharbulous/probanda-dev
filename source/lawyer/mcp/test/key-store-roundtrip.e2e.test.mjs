// The real Windows Credential Manager (mcp-shared/credential-manager.js), under a throwaway target
// this run owns and removes. The DPAPI store's PowerShell branch shipped broken twice because nothing
// executed it (commons-mcp/test/dpapi-store.test.mjs), so the Add-Type and marshalling here are run
// for real rather than mocked. Never touches Probanda/cloud-key itself.
import assert from "node:assert/strict";
import test from "node:test";

const { deleteCredential, readCredential, writeCredential } = await import("../../../mcp-shared/credential-manager.js");

const onWindows = process.platform === "win32";
const TARGET = `Probanda/cloud-key-test-${process.pid}`;

test("write, read back, delete, and read as absent", { skip: !onWindows }, async (t) => {
  t.after(() => deleteCredential(TARGET));
  assert.equal(await readCredential(TARGET), null, "a fresh target reads as absent, not as an error");
  const secret = "sb_secret_ROUNDTRIP_ÀÉÎ_ÿ";
  await writeCredential(TARGET, secret);
  assert.equal(await readCredential(TARGET), secret);
  await writeCredential(TARGET, "sb_secret_REPLACED");
  assert.equal(await readCredential(TARGET), "sb_secret_REPLACED", "a second write replaces the first");
  await deleteCredential(TARGET);
  assert.equal(await readCredential(TARGET), null);
  await deleteCredential(TARGET);
});

test("a target that is not a plain name is refused before PowerShell runs", async () => {
  await assert.rejects(() => readCredential("Probanda/cloud-key'; exit 1; '"), /not a plain name/);
  await assert.rejects(() => writeCredential("Probanda/cloud-key", ""), /needs a secret/);
});

test("off Windows every call says so", { skip: onWindows }, async () => {
  await assert.rejects(() => readCredential(TARGET), /supported only on Windows/);
  await assert.rejects(() => writeCredential(TARGET, "x"), /supported only on Windows/);
  await assert.rejects(() => deleteCredential(TARGET), /supported only on Windows/);
});
