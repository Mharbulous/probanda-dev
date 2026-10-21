// The key_request__* tools and cloud_key__configure_credential, served by the data server alone
// (docs/Specs/2026-10-20_move-key-request-tools-to-lawyer-plugin-spec.md). The server started
// alone lists them: key-request-server.e2e.test.mjs.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";

// The request's reference and the key are saved under LOCALAPPDATA, so each run uses its own.
const STATE = await mkdtemp(join(tmpdir(), "probanda-key-request-"));
process.env.LOCALAPPDATA = STATE;
delete process.env.LEGAL_COMMONS_SUPABASE_KEY;
delete process.env.SUPABASE_SERVICE_ROLE_KEY;
// Not a real project.
const PROJECT = "https://example-project.example";
process.env.SUPABASE_URL = PROJECT;
after(() => rm(STATE, { recursive: true, force: true }));

const { callTool } = await import("../build/dispatch.js");
const { buildToolDefinitions, buildFileManagerToolDefinitions } = await import("../build/schema-gen.js");
const { loadCloudKey } = await import("../build/cloud-key.js");
const { credentialPath } = await import("../../../mcp-shared/commons-key.js");

const KEY_TOOLS = ["cloud_key__configure_credential", "key_request__status", "key_request__submit"];
const CALL = {
  full_name: "Jane Example", year_of_call: "2011", call_date: "2011-05-20", firm_name: "Example Law LLP",
  email: "jane@example.com", phone: "+1 604 555 0100",
};
// Matter and client details a careless page or caller might add. None may reach the cloud.
const SMUGGLED = { matter: "MATTER-SENTINEL-2207", client: "CLIENT-SENTINEL-Smith", notes: "Re: CLIENT-SENTINEL-Smith v Jones" };

const call = (name, args = {}) => callTool({}, name, args);

// Answers every call to the fake project and records it; the local page is reached through the real fetch.
function fakeCloud(t, respond) {
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    if (!String(url).startsWith(PROJECT)) return original(url, init);
    const call = { url: String(url), method: init.method, headers: init.headers ?? {}, body: init.body ? JSON.parse(init.body) : undefined };
    calls.push(call);
    const [status, json] = respond(call);
    return new Response(JSON.stringify(json), { status, headers: { "Content-Type": "application/json" } });
  };
  t.after(() => {
    globalThis.fetch = original;
  });
  return calls;
}

function withKey(t) {
  process.env.LEGAL_COMMONS_SUPABASE_KEY = "sb_secret_HELD";
  t.after(() => delete process.env.LEGAL_COMMONS_SUPABASE_KEY);
}

async function openPage() {
  const result = await call("key_request__submit");
  assert.equal(result.status, "awaiting_details");
  assert.match(result.url, /^http:\/\/127\.0\.0\.1:\d+\/key-request\/[0-9a-f]{48}$/);
  return result.url;
}

test("the key tools take no argument, and the files server does not serve them", () => {
  const tools = buildToolDefinitions().filter((t) => KEY_TOOLS.includes(t.name));
  assert.deepEqual(tools.map((t) => t.name).sort(), KEY_TOOLS);
  for (const tool of tools) assert.deepEqual(Object.keys(tool.inputSchema.properties), [], `${tool.name} takes no argument`);
  assert.deepEqual(buildFileManagerToolDefinitions().filter((t) => KEY_TOOLS.includes(t.name)), []);
});

test("status before any request says none was sent and calls nothing", async (t) => {
  const calls = fakeCloud(t, () => [500, {}]);
  const result = await call("key_request__status");
  assert.equal(result.requested, false);
  assert.match(result.next, /key_request__submit/);
  assert.equal(calls.length, 0);
});

test("submit refuses details as tool arguments", async () => {
  await assert.rejects(() => call("key_request__submit", { full_name: "Jane Example" }), /unknown field/);
});

test("submit is refused on a computer that already holds a key", async (t) => {
  withKey(t);
  await assert.rejects(() => call("key_request__submit"), /already holds Probanda's key/);
});

test("the page asks only for what verifying a practising lawyer requires, plus a contact email and phone", async () => {
  const html = await (await fetch(await openPage())).text();
  const names = [...html.matchAll(/<(?:input|select|textarea)\b[^>]*\bname="([^"]+)"/g)].map((m) => m[1]).sort();
  assert.deepEqual(names, ["call_date", "email", "firm_name", "full_name", "phone", "year_of_call"]);
  assert.match(html, /never to the one you type here/);
});

test("a request carries no matter or client data and no key, and its status is checked by token alone", async (t) => {
  const calls = fakeCloud(t, (call) =>
    call.url.endsWith("/key-request-submit")
      ? [200, { request_id: "0b7e2b1c-1111-4222-8333-944445555666" }]
      : [200, { status: "pending", requested_at: "2026-10-20T17:00:00Z", decided_at: null }]);
  const res = await fetch(await openPage(), { method: "POST", body: new URLSearchParams({ ...CALL, ...SMUGGLED }) });
  assert.match(await res.text(), /Request sent/);

  assert.equal(calls.length, 1);
  const [sent] = calls;
  assert.equal(sent.url, `${PROJECT}/functions/v1/key-request-submit`);
  assert.deepEqual(Object.keys(sent.headers).map((h) => h.toLowerCase()), ["content-type"], "no apikey or Authorization header");
  assert.deepEqual(sent.body, {
    full_name: "Jane Example", jurisdiction: "BC", year_of_call: 2011, call_date: "2011-05-20",
    firm_name: "Example Law LLP", email: "jane@example.com", phone: "+1 604 555 0100", token_hash: sent.body.token_hash,
  });
  assert.ok(!JSON.stringify(sent.body).includes("SENTINEL"), "the request omits every matter and client field the form was sent");

  const status = await call("key_request__status");
  assert.equal(calls.length, 2);
  const [, asked] = calls;
  assert.equal(asked.url, `${PROJECT}/functions/v1/key-request-status`);
  assert.deepEqual(Object.keys(asked.body), ["request_token"], "a status check sends no personal detail");
  assert.equal(createHash("sha256").update(asked.body.request_token).digest("hex"), sent.body.token_hash,
    "the cloud holds only the token's hash");
  assert.equal(status.requested, true);
  assert.equal(status.status, "pending");
  assert.equal(status.request_id, "0b7e2b1c-1111-4222-8333-944445555666");
});

test("an issued request points to cloud_key__configure_credential", async (t) => {
  fakeCloud(t, () => [200, { status: "issued", requested_at: "2026-10-20T17:00:00Z", decided_at: "2026-10-21T09:00:00Z" }]);
  const status = await call("key_request__status");
  assert.equal(status.status, "issued");
  assert.match(status.next, /cloud_key__configure_credential/);
});

test("a request with an impossible year of call is not sent", async (t) => {
  const calls = fakeCloud(t, () => [200, { request_id: "x" }]);
  const res = await fetch(await openPage(), { method: "POST", body: new URLSearchParams({ ...CALL, year_of_call: "20111" }) });
  assert.match(await res.text(), /Not sent: type your year of call as four digits/);
  assert.equal(calls.length, 0);
});

test("a request with no email is not sent, and one with no phone omits it", async (t) => {
  const calls = fakeCloud(t, () => [200, { request_id: "0b7e2b1c-1111-4222-8333-944445555666" }]);
  const { email, ...noEmail } = CALL;
  const refused = await fetch(await openPage(), { method: "POST", body: new URLSearchParams(noEmail) });
  assert.match(await refused.text(), /Not sent: type the email address Probanda can contact you at/);
  assert.equal(calls.length, 0);

  const { phone, ...noPhone } = CALL;
  const res = await fetch(await openPage(), { method: "POST", body: new URLSearchParams(noPhone) });
  assert.match(await res.text(), /Request sent/);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].body.email, email);
  assert.ok(!("phone" in calls[0].body), `the optional phone (${phone}) is left out when blank`);
});

test("the cloud's guiding question is shown on the page and nothing is saved", async (t) => {
  fakeCloud(t, () => [429, { error: "Can this request wait until tomorrow?" }]);
  const res = await fetch(await openPage(), { method: "POST", body: new URLSearchParams(CALL) });
  assert.match(await res.text(), /Not sent: Probanda&#39;s Cloud did not save the request \(429\): Can this request wait until tomorrow\?/);
});

// The key is typed on the local page cloud_key__configure_credential serves, never passed as a
// tool argument. Posts `secret` to that page and returns its HTML.
async function pasteOnKeyPage(secret) {
  const result = await call("cloud_key__configure_credential");
  assert.equal(result.status, "awaiting_key");
  assert.match(result.url, /^http:\/\/127\.0\.0\.1:\d+\/cloud-key\/[0-9a-f]{48}$/);
  assert.match(result.next, /practice_data__config_status/);
  const res = await fetch(result.url, { method: "POST", body: new URLSearchParams({ secret }) });
  assert.equal(res.status, 200);
  return res.text();
}

test("configure_credential refuses a key as a tool argument", async () => {
  await assert.rejects(() => call("cloud_key__configure_credential", { static_key: "sb_secret_X" }), /unknown field/);
  assert.equal(existsSync(credentialPath()), false);
});

test("configure_credential's page rejects the publishable key without probing or saving it", async (t) => {
  const calls = fakeCloud(t, () => [200, []]);
  const html = await pasteOnKeyPage("sb_publishable_ABCDEFGHIJKLMNOP");
  assert.match(html, /Not saved: that is the project&#39;s publishable key/);
  assert.equal(calls.length, 0, "must fail before spending a network round trip");
  assert.equal(existsSync(credentialPath()), false);
});

test("configure_credential's page saves nothing when Probanda's Cloud refuses the key", async (t) => {
  const calls = fakeCloud(t, () => [401, { message: "Invalid API key" }]);
  const html = await pasteOnKeyPage("sb_secret_WRONGKEY");
  assert.match(html, /Not saved: that key did not work against Probanda&#39;s Cloud \(401\)/);
  assert.ok(!html.includes("sb_secret_WRONGKEY"), "the page does not echo the key");
  assert.equal(calls.length, 1);
  assert.equal(existsSync(credentialPath()), false);
});

// Last: it leaves a key stored, which the refusals above must not see. Saving goes through DPAPI,
// so it runs on Windows only, as the suite does.
test("configure_credential's page checks the key, then saves it where every server reads it", { skip: process.platform !== "win32" }, async (t) => {
  const calls = fakeCloud(t, () => [200, []]);
  const html = await pasteOnKeyPage("  sb_secret_GOODKEY_0123456789\n");
  assert.match(html, /Connected to Probanda's Cloud/);
  assert.ok(!html.includes("sb_secret_GOODKEY"), "the page does not echo the key");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `${PROJECT}/functions/v1/items-sync`);
  assert.deepEqual(calls[0].body, {});
  assert.equal(calls[0].headers.apikey, "sb_secret_GOODKEY_0123456789");
  assert.deepEqual(await loadCloudKey(), { configured: true, supabaseUrl: PROJECT, staticKey: "sb_secret_GOODKEY_0123456789" });
  await assert.rejects(() => call("key_request__submit"), /already holds Probanda's key/);
});
