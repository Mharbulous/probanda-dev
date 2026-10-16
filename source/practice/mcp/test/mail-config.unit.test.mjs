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

const { persistMailCredential } = await import("../build/mail/config.js");

const OLD_FORMAT = { host: "imap.example.test", port: 993, secure: true, username: "someone", password: "fake-password-not-real" };

test("a credential saved before the calendar fields existed loads unchanged", async (t) => {
  const env = { LOCALAPPDATA: emptyStateDir(t) };
  await persistMailCredential({ ...OLD_FORMAT }, env);
  assert.deepEqual(await loadMailConfig(env), { credential: OLD_FORMAT });
});

test("the calendar and contacts fields round-trip through the saved file", async (t) => {
  const env = { LOCALAPPDATA: emptyStateDir(t) };
  const full = {
    ...OLD_FORMAT,
    davUsername: "someone@example.test",
    caldavUrl: "https://caldav.example.test",
    carddavUrl: "https://contacts.example.test",
    timezone: "America/Vancouver",
  };
  await persistMailCredential(full, env);
  assert.deepEqual(await loadMailConfig(env), { credential: full });
});

test("the env override carries the calendar fields and refuses a time zone that is not IANA", async (t) => {
  const base = {
    LOCALAPPDATA: emptyStateDir(t),
    PROBANDA_MAIL_HOST: "imap.example.test",
    PROBANDA_MAIL_USERNAME: "someone",
    PROBANDA_MAIL_PASSWORD: "fake-password-not-real",
    PROBANDA_DAV_USERNAME: "someone@example.test",
    PROBANDA_CALDAV_URL: "https://caldav.example.test",
    PROBANDA_CARDDAV_URL: "https://contacts.example.test",
  };
  const good = await loadMailConfig({ ...base, PROBANDA_TIMEZONE: "America/Vancouver" });
  assert.equal(good.credential.davUsername, "someone@example.test");
  assert.equal(good.credential.caldavUrl, "https://caldav.example.test");
  assert.equal(good.credential.carddavUrl, "https://contacts.example.test");
  assert.equal(good.credential.timezone, "America/Vancouver");
  const bad = await loadMailConfig({ ...base, PROBANDA_TIMEZONE: "Pacific Standard Time" });
  assert.equal(bad.credential, null);
  assert.match(bad.credentialError, /not an IANA time zone/);
});
