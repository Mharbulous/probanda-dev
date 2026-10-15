// The mail credential's loader (src/mail/config.ts): the env override, an empty
// state folder, and a stored file that cannot be read. Temp folders only: no
// test touches the real credential file. Every value is fake.

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test, { after } from "node:test";

const STATE_DIR = mkdtempSync(join(tmpdir(), "coclerk-mail-config-"));
const SAVED_LOCALAPPDATA = process.env.LOCALAPPDATA;
process.env.LOCALAPPDATA = STATE_DIR;
after(() => {
  if (SAVED_LOCALAPPDATA === undefined) delete process.env.LOCALAPPDATA;
  else process.env.LOCALAPPDATA = SAVED_LOCALAPPDATA;
  rmSync(STATE_DIR, { recursive: true, force: true });
});

const { credentialPath, loadMailConfig } = await import("../build/mail/config.js");

function emptyStateDir(t) {
  const dir = mkdtempSync(join(tmpdir(), "coclerk-mail-state-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test("the env override supplies the credential and the file is not read", async (t) => {
  const env = {
    LOCALAPPDATA: emptyStateDir(t),
    PROBANDA_MAIL_HOST: "imap.example.test",
    PROBANDA_MAIL_PORT: "1993",
    PROBANDA_MAIL_USERNAME: "someone",
    PROBANDA_MAIL_PASSWORD: "fake-password-not-real",
    PROBANDA_MAIL_FROM: "someone@example.test",
  };
  assert.deepEqual(await loadMailConfig(env), {
    credential: {
      host: "imap.example.test",
      port: 1993,
      secure: true,
      username: "someone",
      password: "fake-password-not-real",
      fromAddress: "someone@example.test",
    },
  });
});

test("a partial env override is reported, not half-used", async (t) => {
  const state = await loadMailConfig({ LOCALAPPDATA: emptyStateDir(t), PROBANDA_MAIL_HOST: "imap.example.test" });
  assert.equal(state.credential, null);
  assert.match(state.credentialError, /must be set together/);
});

test("no env and no file: not configured, with no error", async (t) => {
  assert.deepEqual(await loadMailConfig({ LOCALAPPDATA: emptyStateDir(t) }), { credential: null });
});

test("a stored file that is not valid DPAPI degrades to unconfigured without throwing", async (t) => {
  const env = { LOCALAPPDATA: emptyStateDir(t) };
  const path = credentialPath(env);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, Buffer.from([0x00, 0x13, 0x37, 0xfe, 0xff, 0x42]));
  const state = await loadMailConfig(env);
  assert.equal(state.credential, null);
  assert.equal(typeof state.credentialError, "string");
  assert.ok(state.credentialError.length > 0);
});
