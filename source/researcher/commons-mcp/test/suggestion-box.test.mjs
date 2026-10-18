import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

// submit reads the researcher plugin's version from <plugin root>/.claude-plugin/plugin.json,
// two folders above its own module. The package has no such file, so each copy of
// the build below sits in a temporary plugin root: one with a manifest, one without.
// The build also imports source/mcp-shared by relative path, so that is copied to
// the same place relative to each copy.
const BUILD = fileURLToPath(new URL("../build", import.meta.url));
const SHARED = fileURLToPath(new URL("../../../mcp-shared", import.meta.url));
const VERSION = "9.9.9-test";
const ROOT = await mkdtemp(join(tmpdir(), "probanda-suggestion-box-"));
after(() => rm(ROOT, { recursive: true, force: true }));

async function pluginRoot(name, manifest) {
  const dir = join(ROOT, name, "researcher", "commons-mcp");
  await cp(BUILD, join(dir, "build"), { recursive: true });
  await cp(SHARED, join(ROOT, name, "mcp-shared"), { recursive: true });
  if (manifest !== undefined) {
    await mkdir(join(dir, ".claude-plugin"));
    await writeFile(join(dir, ".claude-plugin", "plugin.json"), JSON.stringify(manifest));
  }
  return {
    dispatch: await import(pathToFileURL(join(dir, "build", "dispatch.js")).href),
    client: await import(pathToFileURL(join(dir, "build", "legal-commons", "client.js")).href),
  };
}

const withManifest = await pluginRoot("with-manifest", { name: "researcher", version: VERSION });
const noManifest = await pluginRoot("no-manifest");

// Not a real project and not a real key.
const PROJECT = "https://example-project.example";
const KEY = "sb_secret_FAKE0000000000-not-a-real-key";
const SUGGESTION = { title: "Offer a shorter confirmation step", body: "The confirmation step asks twice for the same answer.", source: "user" };

function reply(status, json = {}) {
  return new Response(JSON.stringify(json), { status, headers: { "Content-Type": "application/json" } });
}

// Replaces the global fetch for one test. Nothing reaches the network: each call
// is recorded and answered by `respond`.
function fakeFetch(t, respond = () => reply(200, { suggestion_id: "s-1" })) {
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const call = { url: String(url), method: init.method, headers: init.headers, body: init.body };
    calls.push(call);
    return respond(call);
  };
  t.after(() => {
    globalThis.fetch = original;
  });
  return calls;
}

function context({ client }, staticKey = KEY) {
  return { legalCommons: new client.LegalCommonsClient({ supabaseUrl: PROJECT, staticKey, schema: "legal_commons" }) };
}

function errorMessage(result) {
  assert.equal(result.isError, true, result.content[0].text);
  return JSON.parse(result.content[0].text).error.message;
}

test("submit posts the title, body, source and the manifest's version to suggestion-submit", async (t) => {
  const calls = fakeFetch(t);
  const result = await withManifest.dispatch.callTool(context(withManifest), "suggestion_box__submit", {
    title: `  ${SUGGESTION.title}  `,
    body: `${SUGGESTION.body}\n`,
    source: "user",
  });
  assert.deepEqual(result, { suggestion_id: "s-1" });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, "POST");
  assert.equal(calls[0].url, `${PROJECT}/functions/v1/suggestion-submit`);
  assert.equal(calls[0].headers.Authorization, `Bearer ${KEY}`);
  assert.deepEqual(JSON.parse(calls[0].body), { ...SUGGESTION, plugin_version: VERSION });
});

test("submit carries the skill when one is named", async (t) => {
  const calls = fakeFetch(t);
  await withManifest.dispatch.callTool(context(withManifest), "suggestion_box__submit", { ...SUGGESTION, source: "llm", skill: " draft " });
  assert.deepEqual(JSON.parse(calls[0].body), { ...SUGGESTION, source: "llm", plugin_version: VERSION, skill: "draft" });
});

test("submit refuses a missing or blank required field, or a blank skill, before any call", async (t) => {
  const calls = fakeFetch(t);
  const submit = (args) => withManifest.dispatch.callTool(context(withManifest), "suggestion_box__submit", args);
  await assert.rejects(() => submit({ title: SUGGESTION.title, source: "user" }), /body is required/);
  await assert.rejects(() => submit({ title: SUGGESTION.title, body: SUGGESTION.body }), /source is required/);
  await assert.rejects(() => submit({ ...SUGGESTION, title: "   " }), /requires a title/);
  await assert.rejects(() => submit({ ...SUGGESTION, body: " \n " }), /requires a body/);
  await assert.rejects(() => submit({ ...SUGGESTION, source: "bot" }), /source must be one of: user, llm/);
  await assert.rejects(() => submit({ ...SUGGESTION, skill: "  " }), /must name a skill/);
  await assert.rejects(() => submit({ ...SUGGESTION, plugin_version: "0.0.1" }), /unknown field/);
  assert.equal(calls.length, 0);
});

test("submit is refused when this computer has no key, before any call", async (t) => {
  const calls = fakeFetch(t);
  const message = errorMessage(await withManifest.dispatch.dispatchTool(context(withManifest, ""), "suggestion_box__submit", SUGGESTION));
  assert.match(message, /has no key on this computer/);
  assert.match(message, /legal_commons__configure_credential/);
  assert.equal(calls.length, 0);
});

test("submit sends nothing when the plugin's plugin.json cannot be read", async (t) => {
  const calls = fakeFetch(t);
  await assert.rejects(
    () => noManifest.dispatch.callTool(context(noManifest), "suggestion_box__submit", SUGGESTION),
    /could not read the researcher plugin's version/
  );
  assert.equal(calls.length, 0);
});

// [kind, the field that carries it, text the refusal must not echo]
const REFUSALS = [
  ["email", { title: "Sign-in fails for jdoe@example.com" }, ["jdoe@example.com", "jdoe"]],
  // Joined here so that no line of this file holds a path that looks real.
  ["user_path", { body: `It reads ${["C:", "Users", "jdoe", "AppData", "x.json"].join("\\")}` }, ["jdoe"]],
  ["matter_folder", { body: "Seen in C:\\Docs\\0. CASE DATA\\Smith v Jones\\notes" }, ["Smith"]],
  ["too_long", { body: "a".repeat(2001) }, ["a".repeat(50)]],
];

for (const [kind, override, leaks] of REFUSALS) {
  test(`submit refuses ${kind} without echoing it or calling out`, async (t) => {
    const calls = fakeFetch(t);
    const message = errorMessage(
      await withManifest.dispatch.dispatchTool(context(withManifest), "suggestion_box__submit", { ...SUGGESTION, ...override })
    );
    assert.match(message, /^submit refused: /);
    assert.ok(message.includes(kind), `message names ${kind}: ${message}`);
    for (const leak of leaks) assert.ok(!message.includes(leak), `message does not contain "${leak}"`);
    assert.equal(calls.length, 0);
  });
}

test("submit reports an error when the cloud refuses or does not confirm the save", async (t) => {
  for (const [respond, pattern] of [
    [() => reply(500, { error: "x" }), /suggestion-submit failed \(500\)/],
    [() => reply(200, {}), /did not confirm the suggestion/],
  ]) {
    fakeFetch(t, respond);
    await assert.rejects(() => withManifest.dispatch.callTool(context(withManifest), "suggestion_box__submit", SUGGESTION), pattern);
  }
});
