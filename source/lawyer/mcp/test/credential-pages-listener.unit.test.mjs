// The four credential pages (cloud key, key request, mail password, TimeCamp token) on the shared
// local-page listener, each on its own ephemeral port: the page answers GET with its form and the
// credential page headers, a refused save shows why and keeps the link, a good save spends it, a
// newer serve makes the older link 404, and the listener's /health names the page.

import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";

import { fakeCloudKeyStore } from "./helpers/fake-cloud-key-store.mjs";

// The key request saves its reference under LOCALAPPDATA, so this run uses its own.
const STATE = await mkdtemp(join(tmpdir(), "probanda-credential-pages-"));
after(() => rm(STATE, { recursive: true, force: true }));
const PROJECT = "https://example-project.example";
const ENV = { ...process.env, LOCALAPPDATA: STATE, SUPABASE_URL: PROJECT };
delete ENV.LEGAL_COMMONS_SUPABASE_KEY;
delete ENV.SUPABASE_SERVICE_ROLE_KEY;

const { serveKeyPage } = await import("../build/key-request/page.js");
const { callKeyRequestTool } = await import("../build/key-request/tools.js");
const { servePasswordPage } = await import("../build/mail/page.js");
const { serveTokenPage } = await import("../build/timecamp/page.js");
const { setCloudKeyStore } = await import("../../../mcp-shared/commons-key.js");
setCloudKeyStore(fakeCloudKeyStore());

const CSP = "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'";
const MAIL_FIELDS = { host: "imap.example.test", port: 993, secure: true, username: "user@example.test" };
const REQUEST = { full_name: "Jane Example", year_of_call: "2011", firm_name: "Example Law LLP", email: "jane@example.com" };

// The cloud the key request posts to: refuses while `cloud.refuse` is set, else confirms.
// `calls` counts every save that was reached, on any page.
const cloud = { refuse: false, calls: 0 };
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init = {}) => {
  if (!String(url).startsWith(PROJECT)) return realFetch(url, init);
  cloud.calls += 1;
  const [status, body] = cloud.refuse ? [400, { error: "refused" }] : [200, { request_id: "0b7e2b1c-1111-4222-8333-944445555666" }];
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
};
after(() => { globalThis.fetch = realFetch; });

/** Each page: how to serve a link whose save refuses while `state.refuse` is set, the form it posts,
 * what its form page and its success page say, and its bundle and kind on /health. */
const PAGES = {
  "cloud key": {
    serve: (state) => serveKeyPage(async () => { cloud.calls += 1; if (state.refuse) throw new Error("refused"); }),
    form: { secret: "sb_secret_X" }, shows: /Probanda&#39;s Cloud key/, saved: /Connected to Probanda's Cloud/,
    bundle: "lawyer", kind: "cloud-key",
  },
  "key request": {
    serve: async (state) => {
      cloud.refuse = state.refuse;
      const page = (await callKeyRequestTool("key_request__submit", ENV)).url;
      return { toString: () => page, sync: () => { cloud.refuse = state.refuse; } };
    },
    form: REQUEST, shows: /Ask Probanda for a key/, saved: /Request sent/,
    bundle: "lawyer", kind: "key-request",
  },
  mail: {
    serve: (state) => servePasswordPage(MAIL_FIELDS, async () => {
      cloud.calls += 1;
      if (state.refuse) throw new Error("refused");
      return { inbox: { messages: 3, unseen: 0 }, persisted: true };
    }),
    form: { secret: "app-password" }, shows: /Probanda mail connector/, saved: /Signed in\. 3 messages/,
    bundle: "mail", kind: "mail",
  },
  timecamp: {
    serve: (state) => serveTokenPage(async () => {
      cloud.calls += 1;
      if (state.refuse) throw new Error("refused");
      return { user: "Jane", persisted: true };
    }),
    form: { secret: "tc-token" }, shows: /Probanda TimeCamp connector/, saved: /Connected to TimeCamp as Jane/,
    bundle: "timecamp", kind: "timecamp",
  },
};

const post = (link, form) => fetch(String(link), { method: "POST", body: new URLSearchParams(form) });

for (const [name, p] of Object.entries(PAGES)) {
  test(`${name} page: GET serves the form with the credential page headers, and /health names the page`, async () => {
    const link = String(await p.serve({ refuse: false }));
    const res = await fetch(link);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("content-type"), "text/html; charset=utf-8");
    assert.equal(res.headers.get("content-security-policy"), CSP);
    assert.equal(res.headers.get("cache-control"), "no-store");
    assert.equal(res.headers.get("referrer-policy"), "no-referrer");
    assert.equal(res.headers.get("x-content-type-options"), "nosniff");
    const page = await res.text();
    assert.match(page, p.shows);
    assert.match(page, /<form method="post">/);
    const health = await (await fetch(new URL("/health", link))).json();
    assert.equal(health.bundle, p.bundle);
    assert.deepEqual(health.kinds, [p.kind]);
  });

  test(`${name} page: a refused save shows why and keeps the link, and a good save spends it`, async () => {
    const state = { refuse: true };
    const link = await p.serve(state);
    const refused = await post(link, p.form);
    assert.equal(refused.status, 200);
    assert.match(await refused.text(), /Not (saved|sent): .*refused/);
    assert.equal((await fetch(String(link))).status, 200, "the link still works");
    state.refuse = false;
    link.sync?.();
    const saved = await post(link, p.form);
    assert.equal(saved.status, 200);
    assert.match(await saved.text(), p.saved);
    const spent = await fetch(String(link));
    assert.equal(spent.status, 404);
    assert.match(await spent.text(), /This link has expired/);
  });

  test(`${name} page: an old link 404s once a new one is served, and the new one works`, async () => {
    const old = String(await p.serve({ refuse: false }));
    const newest = String(await p.serve({ refuse: false }));
    assert.notEqual(old, newest);
    const stale = await fetch(old);
    assert.equal(stale.status, 404);
    assert.equal(stale.headers.get("content-security-policy"), CSP);
    assert.match(await stale.text(), /This link has expired/);
    assert.equal((await fetch(newest)).status, 200);
  });

  test(`${name} page: another method or a longer link still gets a credential page, and a form over 4 KB is never saved`, async () => {
    const link = String(await p.serve({ refuse: false }));
    const put = await fetch(link, { method: "PUT" });
    assert.equal(put.status, 405);
    const longer = await fetch(link + "0");
    assert.equal(longer.status, 404);
    for (const res of [put, longer]) {
      assert.equal(res.headers.get("content-type"), "text/html; charset=utf-8");
      assert.equal(res.headers.get("content-security-policy"), CSP);
      await res.text();
    }
    const before = cloud.calls;
    const big = await post(link, { ...p.form, secret: "x".repeat(5 * 1024) }).catch(() => undefined);
    if (big) assert.notEqual(big.status, 200);
    assert.equal(cloud.calls, before, "the save was never reached");
    assert.equal((await fetch(link)).status, 200, "the link was not spent");
  });
}
