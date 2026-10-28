// The shared credential page helpers (key-request/page.ts), as the cloud-key and mail pages use them:
// every page carries the security headers, a form over 4 KB is refused before the secret is checked,
// only the newest link works, and a successful save spends it.

import assert from "node:assert/strict";
import test from "node:test";

const { serveKeyPage } = await import("../build/key-request/page.js");
const { servePasswordPage } = await import("../build/mail/page.js");

const FIELDS = { host: "imap.example.test", port: 993, secure: true, username: "user@example.test" };
const post = (secret) => ({ method: "POST", body: new URLSearchParams({ secret }) });

const servers = {
  key: (save) => serveKeyPage(async (secret) => { await save(secret); }),
  mail: (save) => servePasswordPage(FIELDS, async (secret) => {
    await save(secret);
    return { inbox: { messages: 0, unseen: 0 }, persisted: true };
  }),
};

for (const [name, serve] of Object.entries(servers)) {
  test(`${name} page: every response carries the security headers`, async () => {
    const link = await serve(async () => {});
    for (const res of [await fetch(link), await fetch(link, { method: "PUT" }), await fetch(link + "0")]) {
      assert.equal(res.headers.get("content-security-policy"), "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'");
      assert.equal(res.headers.get("cache-control"), "no-store");
      assert.equal(res.headers.get("referrer-policy"), "no-referrer");
      assert.equal(res.headers.get("x-content-type-options"), "nosniff");
      assert.equal(res.headers.get("content-type"), "text/html; charset=utf-8");
      await res.text();
    }
  });

  test(`${name} page: a form over 4 KB never reaches the save`, async () => {
    let saved = 0;
    const link = await serve(async () => { saved++; });
    const res = await fetch(link, post("x".repeat(5 * 1024))).catch(() => undefined);
    if (res) assert.notEqual(res.status, 200);
    assert.equal(saved, 0);
  });

  test(`${name} page: a replaced link returns 404 and the newest one works`, async () => {
    const old = await serve(async () => {});
    const newest = await serve(async () => {});
    assert.equal((await fetch(old)).status, 404);
    assert.equal((await fetch(newest)).status, 200);
  });

  test(`${name} page: a successful save spends the link, a refused one keeps it`, async () => {
    let refuse = true;
    const link = await serve(async () => { if (refuse) throw new Error("refused"); });
    const refused = await fetch(link, post("wrong"));
    assert.equal(refused.status, 200);
    assert.match(await refused.text(), /Not saved: refused/);
    refuse = false;
    assert.equal((await fetch(link, post("right"))).status, 200);
    assert.equal((await fetch(link)).status, 404);
  });
}
