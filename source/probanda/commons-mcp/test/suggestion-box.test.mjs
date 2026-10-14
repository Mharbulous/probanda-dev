import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";

// The state folder is a temporary one for this whole file, so no test can write
// a credential file into the real one. Set before anything is imported.
const STATE_DIR = await mkdtemp(join(tmpdir(), "coclerk-suggestion-box-"));
const SAVED_LOCALAPPDATA = process.env.LOCALAPPDATA;
process.env.LOCALAPPDATA = STATE_DIR;
after(async () => {
  if (SAVED_LOCALAPPDATA === undefined) delete process.env.LOCALAPPDATA;
  else process.env.LOCALAPPDATA = SAVED_LOCALAPPDATA;
  await rm(STATE_DIR, { recursive: true, force: true });
});

const index = await import("../build/index.js");
const schemaGen = await import("../build/schema-gen.js");
const { credentialPath, loadSuggestionBoxConfig } = await import("../build/suggestion-box/config.js");

// Not a real repo and not a real token.
const REPO = "example-owner/example-repo";
const TOKEN = "fake-token-0000000000-not-a-real-credential";
const OLD = { repo: "example-owner/earlier-repo", token: "fake-token-1111111111-the-earlier-credential" };
const SUGGESTION = { title: "Offer a shorter confirmation step", body: "The confirmation step asks twice for the same answer." };
const ISSUE = { number: 7, html_url: `https://github.example/${REPO}/issues/7` };

function reply(status, json = {}) {
  return new Response(JSON.stringify(json), { status, headers: { "Content-Type": "application/json" } });
}

// Replaces the global fetch for one test. Nothing reaches the network: each call
// is recorded and answered by `respond`. The Request is still built, so a header
// the real fetch would refuse is refused here too.
function fakeFetch(t, respond) {
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const request = new Request(url, init);
    const call = { url: String(url), method: request.method, body: init.body };
    calls.push(call);
    return respond(call);
  };
  t.after(() => {
    globalThis.fetch = original;
  });
  return calls;
}

// GitHub as the tools see it: the repo lookup, then the issue post.
function github({ repo = reply(200, { private: true }), issue = reply(201, ISSUE) } = {}) {
  return (call) => (call.method === "GET" ? repo : issue);
}

function context(credential = { repo: REPO, token: TOKEN }) {
  return { suggestionBox: { credential: credential && { ...credential } } };
}

function errorMessage(result) {
  assert.equal(result.isError, true, result.content[0].text);
  return JSON.parse(result.content[0].text).error.message;
}

test("the suggestion_box__* definitions are exactly the three tools", () => {
  const names = schemaGen.buildToolDefinitions()
    .map((t) => t.name)
    .filter((n) => n.startsWith("suggestion_box__"))
    .sort();
  assert.deepEqual(names, [
    "suggestion_box__configure_credential",
    "suggestion_box__configure_status",
    "suggestion_box__submit",
  ]);
});

test("submit is refused when nothing is configured, before any call", async (t) => {
  const calls = fakeFetch(t, github());
  const message = errorMessage(await index.dispatchTool(context(null), "suggestion_box__submit", SUGGESTION));
  assert.match(message, /^the Suggestion Box is not configured/);
  assert.match(message, /suggestion_box__configure_credential/);

  const unreadable = { suggestionBox: { credential: null, credentialError: "the file is damaged" } };
  assert.match(
    errorMessage(await index.dispatchTool(unreadable, "suggestion_box__submit", SUGGESTION)),
    /the stored credential could not be read: the file is damaged/
  );
  assert.equal(calls.length, 0);
});

// [kind, the field that carries it, text the refusal must not echo]
const REFUSALS = [
  ["email", { title: "Sign-in fails for jdoe@example.com" }, ["jdoe@example.com", "jdoe"]],
  ["email", { body: "Write to jdoe@example.com when it is fixed" }, ["jdoe@example.com", "jdoe"]],
  ["user_path", { body: "It reads C:\\Users\\jdoe\\AppData\\Local\\x.json" }, ["jdoe"]],
  ["user_path", { title: "open /home/jdoe/.config/x.json failed" }, ["jdoe"]],
  ["matter_folder", { body: "Seen in C:\\Docs\\0. CASE DATA\\Smith v Jones\\notes" }, ["Smith"]],
  ["matter_folder", { title: "Litigation - Documents/Smith v Jones is slow" }, ["Smith"]],
  ["too_long", { body: "a".repeat(2001) }, ["a".repeat(50)]],
];

for (const [kind, override, leaks] of REFUSALS) {
  test(`submit refuses ${kind} in ${JSON.stringify(override).slice(0, 60)} without echoing it`, async (t) => {
    const calls = fakeFetch(t, github());
    const message = errorMessage(
      await index.dispatchTool(context(), "suggestion_box__submit", { ...SUGGESTION, ...override })
    );
    assert.match(message, /^submit refused: /);
    assert.ok(message.includes(kind), `message names ${kind}: ${message}`);
    for (const leak of leaks) assert.ok(!message.includes(leak), `message does not contain "${leak}"`);
    assert.equal(calls.length, 0, "refused before any fetch call");
  });
}

test("submit is refused when the repo is not private, and posts nothing", async (t) => {
  for (const repoJson of [{ private: false }, {}, { private: "true" }]) {
    const calls = fakeFetch(t, github({ repo: reply(200, repoJson) }));
    await assert.rejects(
      () => index.callTool(context(), "suggestion_box__submit", SUGGESTION),
      /that repo is not private/
    );
    assert.deepEqual(calls.map((c) => c.method), ["GET"], `no POST for ${JSON.stringify(repoJson)}`);
  }
});

test("submit is refused when the repo check answers 401, 404 or 500, and posts nothing", async (t) => {
  for (const [status, pattern] of [[401, /refused the token \(401\)/], [404, /no such repo for that token \(404\)/], [500, /answered 500 for the repo/]]) {
    const calls = fakeFetch(t, github({ repo: reply(status) }));
    await assert.rejects(() => index.callTool(context(), "suggestion_box__submit", SUGGESTION), pattern);
    assert.deepEqual(calls.map((c) => c.method), ["GET"], `no POST after ${status}`);
  }
});

test("submit checks the repo, then posts the title, the body and the label alone", async (t) => {
  const calls = fakeFetch(t, github());
  const result = await index.callTool(context(), "suggestion_box__submit", {
    title: `  ${SUGGESTION.title}  `,
    body: `${SUGGESTION.body}\n`,
  });
  assert.deepEqual(result, { issue_number: 7, url: ISSUE.html_url });
  assert.deepEqual(
    calls.map((c) => [c.method, c.url]),
    [
      ["GET", `https://api.github.com/repos/${REPO}`],
      ["POST", `https://api.github.com/repos/${REPO}/issues`],
    ]
  );
  assert.equal(calls[0].body, undefined);
  assert.deepEqual(JSON.parse(calls[1].body), { ...SUGGESTION, labels: ["suggestion"] });
});

test("submit treats any reply to the post but 201 as an error", async (t) => {
  for (const status of [200, 202, 403, 404, 410, 422, 500]) {
    const calls = fakeFetch(t, github({ issue: reply(status, ISSUE) }));
    await assert.rejects(
      () => index.callTool(context(), "suggestion_box__submit", SUGGESTION),
      new RegExp(`GitHub answered ${status}, so the suggestion was not posted`)
    );
    assert.equal(calls.length, 2);
  }
});

test("submit requires a title and a body that are not blank", async (t) => {
  const calls = fakeFetch(t, github());
  await assert.rejects(() => index.callTool(context(), "suggestion_box__submit", { ...SUGGESTION, title: "   " }), /requires a title/);
  await assert.rejects(() => index.callTool(context(), "suggestion_box__submit", { ...SUGGESTION, body: " \n " }), /requires a body/);
  await assert.rejects(() => index.callTool(context(), "suggestion_box__submit", { title: SUGGESTION.title }), /body is required/);
  assert.equal(calls.length, 0);
});

test("configure_credential refuses a 404, a 401 and a public repo, and keeps the earlier credential", async (t) => {
  const cases = [
    [reply(404), /not saved: GitHub found no such repo for that token \(404\)/],
    [reply(401), /not saved: GitHub refused the token \(401\)/],
    [reply(200, { private: false }), /not saved: that repo is not private/],
  ];
  for (const [repoReply, pattern] of cases) {
    const calls = fakeFetch(t, github({ repo: repoReply }));
    const ctx = context(OLD);
    await assert.rejects(
      () => index.callTool(ctx, "suggestion_box__configure_credential", { repo: REPO, token: TOKEN }),
      pattern
    );
    assert.deepEqual(ctx.suggestionBox.credential, OLD);
    assert.deepEqual(calls.map((c) => [c.method, c.url]), [["GET", `https://api.github.com/repos/${REPO}`]]);
    assert.equal(existsSync(credentialPath()), false, "nothing was written to disk");
  }
});

test("configure_credential refuses a repo not written owner/name, or no token, without probing", async (t) => {
  const calls = fakeFetch(t, github());
  const ctx = context(OLD);
  for (const repo of ["example-repo", "example-owner/example-repo/issues", "https://github.example/example-owner/example-repo"]) {
    await assert.rejects(
      () => index.callTool(ctx, "suggestion_box__configure_credential", { repo, token: TOKEN }),
      /requires repo as owner\/name/
    );
  }
  await assert.rejects(
    () => index.callTool(ctx, "suggestion_box__configure_credential", { repo: REPO, token: "   " }),
    /requires token/
  );
  assert.equal(calls.length, 0);
  assert.deepEqual(ctx.suggestionBox.credential, OLD);
});

// A token GitHub never issues: fetch refuses to put it in a header, and its own
// message for that quotes the header, token and all.
test("configure_credential refuses a token that cannot go in a header, without echoing it", async (t) => {
  for (const token of ["fake-token-0000\n000000-broken-in-two", "fake-token-0000 000000-with-a-space", "fake-token-0000\u2603000000-snowman"]) {
    const calls = fakeFetch(t, github());
    const ctx = context(OLD);
    const result = await index.dispatchTool(ctx, "suggestion_box__configure_credential", { repo: REPO, token });
    const message = errorMessage(result);
    assert.match(message, /token/);
    for (const part of [token, "fake-token-0000", "000000-"]) {
      assert.ok(!result.content[0].text.includes(part), `the reply does not contain "${part}"`);
    }
    assert.equal(calls.length, 0);
    assert.deepEqual(ctx.suggestionBox.credential, OLD);
  }
});

// Writes the credential file, into the temporary state folder only. Reading it
// back needs DPAPI, which is Windows-only; elsewhere the save is reported failed.
test("configure_credential sets a working pair live and saves it under the state folder", async (t) => {
  const calls = fakeFetch(t, github());
  const ctx = context(OLD);
  t.after(() => rm(credentialPath(), { force: true }));
  assert.ok(credentialPath().startsWith(STATE_DIR), "the credential file is under the temporary folder");

  const result = await index.callTool(ctx, "suggestion_box__configure_credential", { repo: ` ${REPO} `, token: ` ${TOKEN} ` });
  assert.deepEqual(ctx.suggestionBox.credential, { repo: REPO, token: TOKEN });
  assert.deepEqual(calls.map((c) => c.method), ["GET"]);
  assert.ok(!JSON.stringify(result).includes(TOKEN), "the token is not in the result");

  if (process.platform !== "win32") {
    assert.equal(result.configured, true);
    assert.equal(result.persisted, false);
    return;
  }
  assert.deepEqual(result, { configured: true, persisted: true });
  assert.deepEqual(await loadSuggestionBoxConfig(), { credential: { repo: REPO, token: TOKEN } });
});

test("configure_status never returns the token", async (t) => {
  const calls = fakeFetch(t, github());
  const result = await index.callTool(context(), "suggestion_box__configure_status", {});
  assert.deepEqual(result, { configured: true, repo: REPO, token_hint: "fake-token…tial" });
  assert.ok(!JSON.stringify(result).includes(TOKEN), "the full token is not in the result");
  assert.ok(!JSON.stringify(result).includes("0000000000"), "the token body is not in the result");

  const short = await index.callTool(context({ repo: REPO, token: "fake-short-token" }), "suggestion_box__configure_status", {});
  assert.equal(short.token_hint, null, "a short token gets no hint at all");

  assert.deepEqual(await index.callTool(context(null), "suggestion_box__configure_status", {}), {
    configured: false,
    repo: null,
    token_hint: null,
  });
  assert.equal(calls.length, 0);
});

test("no error message contains the token", async (t) => {
  const unreachable = () => {
    throw new TypeError("fetch failed");
  };
  const failures = [
    github({ repo: reply(401) }),
    github({ repo: reply(404) }),
    github({ repo: reply(500) }),
    github({ repo: reply(200, { private: false }) }),
    github({ issue: reply(403) }),
    github({ issue: reply(422) }),
    unreachable,
  ];
  for (const respond of failures) {
    for (const [name, args] of [
      ["suggestion_box__submit", SUGGESTION],
      ["suggestion_box__configure_credential", { repo: REPO, token: TOKEN }],
    ]) {
      fakeFetch(t, respond);
      const ctx = context(name === "suggestion_box__submit" ? undefined : OLD);
      const result = await index.dispatchTool(ctx, name, args);
      // A failed post does not fail configure_credential, which never posts.
      if (result.isError !== true) {
        assert.equal(name, "suggestion_box__configure_credential");
        await rm(credentialPath(), { force: true });
      }
      const text = result.content[0].text;
      for (const secret of [TOKEN, OLD.token, "0000000000", "1111111111"]) {
        assert.ok(!text.includes(secret), `${name}: the reply does not contain the token: ${text}`);
      }
    }
  }
});
