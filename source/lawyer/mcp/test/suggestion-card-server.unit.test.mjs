// A suggestion card's clicks through the page API (page-api/server.ts and suggestions/card.ts;
// lifecycle plan Phase 4): with no agent waiting on the card (the session that showed it has ended),
// Submit Suggestion still checks, saves and sends to a stand-in cloud, and the card reads its status;
// a check prompt comes back through the listener and Remove completes the send; Dismiss sends
// nothing; a wrong token is refused; and the mockup link reads as having no agent to answer it.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { closedPort, stubCloud, suggestionDevice } from "./helpers/suggestion-fixture.mjs";

const { startPageApi } = await import("../build/page-api/server.js");
const { pageApiCardToken } = await import("../build/page-api/token.js");
const card = await import("../build/suggestions/card.js");
const { loadStopWords } = await import("../build/suggestions/crosscheck.js");
const { RECORD_SOURCES } = await import("../build/suggestions/records.js");

const STOP = loadStopWords(process.env);
const ID = "1c8d4b6f-2e3a-4d7c-8b9f-6e5d4c3b2a10";
const RECORDS = {
  texts: { ...Object.fromEntries(RECORD_SOURCES.map((s) => [s, []])), client: ["Quillfeather Holdings Ltd."] },
  states: Object.fromEntries(RECORD_SOURCES.map((s) => [s, "read"])),
  firmName: null,
};
const INPUT = {
  origin: "practitioner",
  source: "user",
  pain_point: { text: "The deadline summary runs to three screens." },
  items: [{ text: "Show the next three deadlines first." }, { text: "Put the summary in a narrower column.", visual: true }],
};

async function listening(t) {
  const port = await closedPort();
  const f = suggestionDevice(t, { port });
  const cloud = await stubCloud(t, () => [200, { suggestion_id: ID, items_saved: true, previews_saved: false, mockup_saved: false }]);
  f.env.SUPABASE_URL = cloud.url;
  const deps = { records: async () => RECORDS, stopWords: () => STOP, seams: f.seams };
  const api = await startPageApi(f.env, { card: deps, log: () => {} });
  t.after(() => api.close());
  assert.equal(api.listening(), true);
  const built = await card.buildCard(card.cardInput(structuredClone(INPUT)), { host: "Code" }, { ...deps, env: f.env });
  assert.equal(built.built, true);
  const token = pageApiCardToken(built.card_id, f.env);
  const click = async (route, body = {}, { headers = {} } = {}) => {
    const res = await fetch(`http://127.0.0.1:${port}/cards/${built.card_id}/${route}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "null", ...headers },
      body: JSON.stringify({ token, ...body }),
    });
    return { status: res.status, cors: res.headers.get("access-control-allow-origin"), json: await res.json() };
  };
  return { f, cloud, built, token, click, port };
}

test("Submit on a card no agent waits on still saves and sends, and the card shows its status", async (t) => {
  const { f, cloud, built, click } = await listening(t);
  const html = readFileSync(built.card_path, "utf-8");
  assert.match(html, new RegExp(`"card":"${built.card_id}"`));

  const state = await click("state");
  assert.equal(state.status, 200);
  assert.equal(state.cors, "null", "a file:// page is answered");
  assert.equal(state.json.mockup_link, "no_waiter", "no agent: the link reads Open this suggestion again");
  assert.equal(state.json.state, "open");

  const sent = await click("submit", { edits: { comment: "Most mornings." } });
  assert.deepEqual(sent.json, { outcome: "sent", status: "Submitted ✓" });
  assert.equal(cloud.calls.length, 1);
  assert.equal(cloud.calls[0].path, "/functions/v1/suggestion-submit");
  assert.equal(cloud.calls[0].body.comment, "Most mornings.");
  assert.deepEqual(cloud.calls[0].body.items, INPUT.items.map((i) => i.text));
  const store = JSON.parse(readFileSync(f.store, "utf-8"));
  const suggestion = store.records.find((r) => r.kind === "suggestion");
  assert.equal(suggestion.payload, cloud.calls[0].raw, "saved, then sent, byte for byte");
  assert.equal(suggestion.state, "sent");
  assert.deepEqual((await click("state")).json.status, "Submitted ✓");
});

test("a check prompt comes back through the listener, and Remove completes the send", async (t) => {
  const { cloud, click } = await listening(t);
  const first = await click("submit", { edits: { pain_point: "The summary for Quillfeather runs to three screens." } });
  assert.equal(first.json.outcome, "check");
  const [prompt] = first.json.prompts;
  assert.deepEqual([prompt.part, prompt.kind, prompt.offer, prompt.text], ["pain_point", "record", "remove_only", "Quillfeather"]);
  assert.equal(cloud.calls.length, 0);
  const done = await click("resolve", { part: prompt.part, id: prompt.id, start: prompt.start, end: prompt.end, action: "remove" });
  assert.deepEqual(done.json, { outcome: "sent", status: "Submitted ✓" });
  assert.equal(cloud.calls[0].body.pain_point, "The summary for [client] runs to three screens.");
});

test("Dismiss over the listener sends nothing; a wrong token is refused", async (t) => {
  const { f, cloud, click, port } = await listening(t);
  const wrong = await click("submit", { token: "0".repeat(64) });
  assert.equal(wrong.status, 403);
  assert.equal((await click("dismiss")).json.outcome, "dismissed");
  assert.equal((await click("submit")).json.outcome, "closed");
  assert.equal((await click("restore")).json.outcome, "restored");
  assert.equal(cloud.calls.length, 0);
  const store = JSON.parse(readFileSync(f.store, "utf-8"));
  assert.equal(store.records.filter((r) => r.kind === "dismissal").length, 0, "a restored card leaves no dismissal");
  const missing = await fetch(`http://127.0.0.1:${port}/cards/00000000-0000-0000-0000-000000000000/state`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: "x" }),
  });
  assert.equal(missing.status, 403, "an unknown card has no valid token");
});

test("the listener serves a card's page at card_url only with that card's token", async (t) => {
  const { built, token, port } = await listening(t);
  const base = `http://127.0.0.1:${port}/cards/${built.card_id}`;
  assert.equal(built.card_url, `${base}?token=${token}`);
  const page = await fetch(built.card_url);
  assert.equal(page.status, 200);
  assert.match(page.headers.get("content-type"), /^text\/html/);
  const html = await page.text();
  assert.match(html, new RegExp(`"card":"${built.card_id}"`));
  assert.match(html, new RegExp(`connect-src http://127\.0\.0\.1:${port};`), "its buttons post to the origin that served it");
  for (const url of [base, `${base}?token=${"0".repeat(64)}`, `http://127.0.0.1:${port}/cards/00000000-0000-0000-0000-000000000000?token=${token}`]) {
    const refused = await fetch(url);
    assert.equal(refused.status, 403, url);
    assert.ok(!(await refused.text()).includes(built.card_id), "a refusal carries no card");
  }
  assert.equal((await fetch(built.card_url, { method: "POST", body: "{}" })).status, 405);
});
