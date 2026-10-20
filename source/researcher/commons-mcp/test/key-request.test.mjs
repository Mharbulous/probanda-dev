import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";

// The request's reference is saved under LOCALAPPDATA, so each run uses its own.
const STATE = await mkdtemp(join(tmpdir(), "probanda-key-request-"));
process.env.LOCALAPPDATA = STATE;
after(() => rm(STATE, { recursive: true, force: true }));

const index = await import("../build/index.js");
const schemaGen = await import("../build/schema-gen.js");

// Not a real project.
const PROJECT = "https://example-project.example";
const CALL = {
  full_name: "Jane Example", year_of_call: "2011", call_date: "2011-05-20", firm_name: "Example Law LLP",
  email: "jane@example.com", phone: "+1 604 555 0100",
};
// Matter and client details a careless page or caller might add. None may reach the cloud.
const SMUGGLED = { matter: "MATTER-SENTINEL-2207", client: "CLIENT-SENTINEL-Smith", notes: "Re: CLIENT-SENTINEL-Smith v Jones" };

function client(hasKey = false) {
  return { projectUrl: () => PROJECT, hasStaticKey: () => hasKey };
}

function context(lc) {
  return { legalCommons: lc, troubleshoot: {} };
}

// Answers every call to the fake project and records it; the local page is reached through the real fetch.
function fakeCloud(t, respond) {
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    if (!String(url).startsWith(PROJECT)) return original(url, init);
    const call = { url: String(url), headers: init.headers ?? {}, body: JSON.parse(init.body) };
    calls.push(call);
    const [status, json] = respond(call);
    return new Response(JSON.stringify(json), { status, headers: { "Content-Type": "application/json" } });
  };
  t.after(() => {
    globalThis.fetch = original;
  });
  return calls;
}

async function openPage(lc = client()) {
  const result = await index.callTool(context(lc), "key_request__submit", {});
  assert.equal(result.status, "awaiting_details");
  assert.match(result.url, /^http:\/\/127\.0\.0\.1:\d+\/key-request\/[0-9a-f]{48}$/);
  return result.url;
}

test("the key_request tools are registered, take no argument and have no matter_id", () => {
  const tools = schemaGen.buildToolDefinitions().filter((t) => t.name.startsWith("key_request__"));
  assert.deepEqual(tools.map((t) => t.name).sort(), ["key_request__status", "key_request__submit"]);
  for (const tool of tools) assert.deepEqual(Object.keys(tool.inputSchema.properties), [], `${tool.name} takes no argument`);
});

test("status before any request says none was sent and calls nothing", async (t) => {
  const calls = fakeCloud(t, () => [500, {}]);
  const result = await index.callTool(context(client()), "key_request__status", {});
  assert.equal(result.requested, false);
  assert.match(result.next, /key_request__submit/);
  assert.equal(calls.length, 0);
});

test("submit refuses details as tool arguments", async () => {
  await assert.rejects(() => index.callTool(context(client()), "key_request__submit", { full_name: "Jane Example" }), /unknown field/);
});

test("submit is refused on a computer that already holds a key", async () => {
  await assert.rejects(() => index.callTool(context(client(true)), "key_request__submit", {}), /already holds Probanda's key/);
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
  assert.deepEqual(Object.keys(sent.body).sort(),
    ["call_date", "email", "firm_name", "full_name", "jurisdiction", "phone", "token_hash", "year_of_call"]);
  assert.deepEqual(sent.body, {
    full_name: "Jane Example", jurisdiction: "BC", year_of_call: 2011, call_date: "2011-05-20",
    firm_name: "Example Law LLP", email: "jane@example.com", phone: "+1 604 555 0100", token_hash: sent.body.token_hash,
  });
  const text = JSON.stringify(sent.body);
  assert.ok(!text.includes("SENTINEL"), "the request omits every matter and client field the form was sent");

  const status = await index.callTool(context(client()), "key_request__status", {});
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

test("an issued request points to configure_credential", async (t) => {
  fakeCloud(t, () => [200, { status: "issued", requested_at: "2026-10-20T17:00:00Z", decided_at: "2026-10-21T09:00:00Z" }]);
  const status = await index.callTool(context(client()), "key_request__status", {});
  assert.equal(status.status, "issued");
  assert.match(status.next, /legal_commons__configure_credential/);
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
