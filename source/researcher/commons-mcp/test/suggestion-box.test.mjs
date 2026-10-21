import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
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
  assert.deepEqual(result, { suggestion_id: "s-1", items_saved: false, previews_saved: false });
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
  await assert.rejects(() => submit({ ...SUGGESTION, source: "bot" }), /source must be one of: user, llm, assisted/);
  await assert.rejects(() => submit({ ...SUGGESTION, skill: "  " }), /must name a skill/);
  await assert.rejects(() => submit({ ...SUGGESTION, plugin_version: "0.0.1" }), /unknown field/);
  assert.equal(calls.length, 0);
});

test("submit is refused when this computer has no key, before any call", async (t) => {
  const calls = fakeFetch(t);
  const message = errorMessage(await withManifest.dispatch.dispatchTool(context(withManifest, ""), "suggestion_box__submit", SUGGESTION));
  assert.match(message, /has no key on this computer/);
  assert.match(message, /cloud_key__configure_credential/);
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


const ITEM = {
  pain: "The confirmation step asks twice",
  where: "the confirmation step of a skill",
  done_test: "One answer confirms the step",
  constraints: ["Keep the step itself"],
  changes: [{ change: "Ask once", origin: "lawyer" }, { change: "Remember the answer for the session", origin: "probanda" }],
};
const PREVIEW = { label: "One question", chosen: true, reason: "Shortest", html: "<p>Confirm? Yes | No</p>" };

test("submit accepts source assisted, items and previews, and echoes what the cloud saved", async (t) => {
  const calls = fakeFetch(t, () => reply(200, { suggestion_id: "s-2", items_saved: true, previews_saved: true }));
  const args = { ...SUGGESTION, source: "assisted", items: [ITEM], previews: [PREVIEW, { label: "Two questions", chosen: false, html: "<p>Sure?</p>" }] };
  const result = await withManifest.dispatch.callTool(context(withManifest), "suggestion_box__submit", args);
  assert.deepEqual(result, { suggestion_id: "s-2", items_saved: true, previews_saved: true });
  const sent = JSON.parse(calls[0].body);
  assert.equal(sent.source, "assisted");
  assert.deepEqual(sent.items, [ITEM]);
  assert.deepEqual(sent.previews, args.previews);
});

test("submit reports items and previews as not saved when the cloud predates them", async (t) => {
  fakeFetch(t, () => reply(200, { suggestion_id: "s-3" }));
  const result = await withManifest.dispatch.callTool(context(withManifest), "suggestion_box__submit", { ...SUGGESTION, items: [ITEM], previews: [PREVIEW] });
  assert.deepEqual(result, { suggestion_id: "s-3", items_saved: false, previews_saved: false });
});

test("submit refuses a badly shaped item or preview before any call", async (t) => {
  const calls = fakeFetch(t);
  const submit = (args) => withManifest.dispatch.callTool(context(withManifest), "suggestion_box__submit", { ...SUGGESTION, ...args });
  await assert.rejects(() => submit({ items: [] }), /list of 1 to 10 items/);
  await assert.rejects(() => submit({ items: Array(11).fill(ITEM) }), /list of 1 to 10 items/);
  await assert.rejects(() => submit({ items: [{ ...ITEM, extra: "x" }] }), /unknown field "extra"/);
  await assert.rejects(() => submit({ items: [{ ...ITEM, done_test: " " }] }), /done_test must be non-empty/);
  await assert.rejects(() => submit({ items: [{ ...ITEM, changes: [{ change: "x", origin: "someone" }] }] }), /origin must be probanda or lawyer/);
  await assert.rejects(() => submit({ previews: Array(5).fill(PREVIEW) }), /list of 1 to 4 Previews/);
  await assert.rejects(() => submit({ previews: [{ ...PREVIEW, chosen: "yes" }] }), /chosen must be true or false/);
  assert.equal(calls.length, 0);
});

// [kind, override, text the refusal must not echo]
const NESTED_REFUSALS = [
  ["email", { items: [{ ...ITEM, changes: [{ change: "Write to jdoe@example.com", origin: "lawyer" }] }] }, ["jdoe"]],
  ["matter_folder", { items: [{ ...ITEM, constraints: ["Keep 0. CASE DATA\\Smith v Jones\\notes"] }] }, ["Smith"]],
  ["too_long", { items: [{ ...ITEM, constraints: ["a".repeat(2001)] }] }, ["a".repeat(50)]],
  ["items_too_long", { items: Array(10).fill({ ...ITEM, constraints: Array(4).fill("b".repeat(1500)) }) }, ["b".repeat(50)]],
  ["email", { previews: [{ ...PREVIEW, html: "<p>jdoe@example.com</p>" }] }, ["jdoe"]],
  ["user_path", { previews: [{ ...PREVIEW, html: `<p>${["C:", "Users", "jdoe", "x"].join("\\")}</p>` }] }, ["jdoe"]],
  ["too_long", { previews: [{ ...PREVIEW, label: "c".repeat(2001) }] }, ["c".repeat(50)]],
  ["preview_too_long", { previews: [{ ...PREVIEW, html: "d".repeat(200_001) }] }, ["d".repeat(50)]],
];

for (const [kind, override, leaks] of NESTED_REFUSALS) {
  test(`submit refuses ${kind} nested in ${Object.keys(override)[0]} without echoing it or calling out`, async (t) => {
    const calls = fakeFetch(t);
    const message = errorMessage(
      await withManifest.dispatch.dispatchTool(context(withManifest), "suggestion_box__submit", { ...SUGGESTION, ...override })
    );
    assert.match(message, /^submit refused: /);
    assert.ok(message.split(/[:;,] ?/).includes(kind), `message names ${kind}: ${message}`);
    for (const leak of leaks) assert.ok(!message.includes(leak), `message does not contain "${leak}"`);
    assert.equal(calls.length, 0);
  });
}

test("a Preview's html may run past 2,000 characters up to its own cap", async (t) => {
  fakeFetch(t, () => reply(200, { suggestion_id: "s-4", items_saved: false, previews_saved: true }));
  const result = await withManifest.dispatch.callTool(context(withManifest), "suggestion_box__submit", {
    ...SUGGESTION, previews: [{ ...PREVIEW, html: "e".repeat(200_000) }],
  });
  assert.equal(result.previews_saved, true);
});

// Fixture previews by path. The folder is the one pages__preview writes to, so
// these tests write their own uniquely named files there and remove them after.
const FIXTURES = join(tmpdir(), "Probanda fixture previews");
const MARKER = "<!-- probanda-fixture-preview -->\n";
const TAG = `suggestion-box-test-${process.pid}`;
await mkdir(FIXTURES, { recursive: true });
const written = [];
after(() => Promise.all(written.map((path) => rm(path, { force: true }))));

async function fixtureFile(name, text, dir = FIXTURES) {
  const path = join(dir, `${TAG} ${name}.html`);
  await writeFile(path, text);
  written.push(path);
  return path;
}

test("submit reads a fixture preview's path and sends its text as the html", async (t) => {
  const calls = fakeFetch(t, () => reply(200, { suggestion_id: "s-5", previews_saved: true }));
  const text = `<p>Confirm? Yes | No</p>\n${MARKER}`;
  const path = await fixtureFile("good", text);
  const result = await withManifest.dispatch.callTool(context(withManifest), "suggestion_box__submit", {
    ...SUGGESTION, previews: [{ label: "One question", chosen: true, path }],
  });
  assert.equal(result.previews_saved, true);
  assert.deepEqual(JSON.parse(calls[0].body).previews, [{ label: "One question", chosen: true, html: text }]);
});

test("submit refuses a preview path that is not a fixture preview, before any call", async (t) => {
  const calls = fakeFetch(t);
  const submit = (preview) => withManifest.dispatch.callTool(context(withManifest), "suggestion_box__submit", {
    ...SUGGESTION, previews: [{ label: "One question", chosen: true, ...preview }],
  });
  const noMarker = await fixtureFile("no marker", "<p>Real data</p>\n");
  const outside = await fixtureFile("outside", `<p>x</p>\n${MARKER}`, tmpdir());
  const notFixture = /path must be a preview that a board preview tool wrote from fixtures/;
  await assert.rejects(() => submit({ path: noMarker }), notFixture);
  await assert.rejects(() => submit({ path: outside }), notFixture);
  const besideFolder = await fixtureFile("beside", `<p>x</p>\n${MARKER}`, tmpdir());
  await assert.rejects(() => submit({ path: join(FIXTURES, "..", besideFolder.split(/[\\/]/).at(-1)) }), notFixture);
  await assert.rejects(() => submit({ path: join(FIXTURES, `${TAG} missing.html`) }), notFixture);
  await assert.rejects(() => submit({ path: FIXTURES }), notFixture);
  await assert.rejects(() => submit({ path: noMarker, html: "<p>x</p>" }), /exactly one of html or path/);
  await assert.rejects(() => submit({}), /exactly one of html or path/);
  assert.equal(calls.length, 0);
});

test("submit refuses a symlink in the fixture folder that points outside it", async (t) => {
  const calls = fakeFetch(t);
  const outside = await fixtureFile("link target", `<p>x</p>\n${MARKER}`, tmpdir());
  const link = join(FIXTURES, `${TAG} link.html`);
  try {
    await symlink(outside, link, "file");
  } catch {
    t.skip("this machine cannot create a symlink");
    return;
  }
  written.push(link);
  await assert.rejects(
    () => withManifest.dispatch.callTool(context(withManifest), "suggestion_box__submit", {
      ...SUGGESTION, previews: [{ label: "One question", chosen: true, path: link }],
    }),
    /path must be a preview that a board preview tool wrote from fixtures/
  );
  assert.equal(calls.length, 0);
});

test("a fixture preview read by path gets the same redaction screen and cap as inline html", async (t) => {
  const calls = fakeFetch(t);
  const email = await fixtureFile("email", `<p>jdoe@example.com</p>\n${MARKER}`);
  const long = await fixtureFile("long", `${"f".repeat(200_000)}\n${MARKER}`);
  for (const [path, kind] of [[email, "email"], [long, "preview_too_long"]]) {
    const message = errorMessage(await withManifest.dispatch.dispatchTool(context(withManifest), "suggestion_box__submit", {
      ...SUGGESTION, previews: [{ label: "One question", chosen: true, path }],
    }));
    assert.ok(message.split(/[:;,] ?/).includes(kind), `message names ${kind}: ${message}`);
    assert.ok(!message.includes("jdoe"));
  }
  assert.equal(calls.length, 0);
});

const ID_A = "11111111-1111-4111-8111-111111111111";
const ID_B = "22222222-2222-4222-8222-222222222222";
const ID_UNASKED = "33333333-3333-4333-8333-333333333333";

test("status posts the IDs and returns only suggestion_id, status and triaged_at, omitting unknown IDs", async (t) => {
  const calls = fakeFetch(t, () => reply(200, {
    statuses: [
      { suggestion_id: ID_A, status: "approved", triaged_at: "2026-10-19T01:02:03Z", title: "leak", body: "leak", issue_number: 7 },
      { suggestion_id: ID_UNASKED, status: "new", triaged_at: null },
    ],
  }));
  const result = await withManifest.dispatch.callTool(context(withManifest), "suggestion_box__status", { suggestion_ids: [ID_A, ID_B] });
  assert.deepEqual(result, { statuses: [{ suggestion_id: ID_A, status: "approved", triaged_at: "2026-10-19T01:02:03Z" }] });
  assert.equal(calls[0].url, `${PROJECT}/functions/v1/suggestion-status`);
  assert.deepEqual(JSON.parse(calls[0].body), { suggestion_ids: [ID_A, ID_B] });
});

test("status refuses bad IDs, too many IDs or no key, before any call", async (t) => {
  const calls = fakeFetch(t);
  const status = (args, key) => withManifest.dispatch.callTool(context(withManifest, key), "suggestion_box__status", args);
  await assert.rejects(() => status({ suggestion_ids: [] }), /list of 1 to 50 IDs/);
  await assert.rejects(() => status({ suggestion_ids: Array(51).fill(ID_A) }), /list of 1 to 50 IDs/);
  await assert.rejects(() => status({ suggestion_ids: ["not-an-id"] }), /suggestion_id that submit returned/);
  await assert.rejects(() => status({ suggestion_ids: [ID_A] }, ""), /has no key on this computer/);
  assert.equal(calls.length, 0);
});
