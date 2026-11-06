// The suggestion card's wait (suggestions/card.ts waitForCard) on the shared poll loop
// (local-page/wait.ts): a wait with nothing to report returns pending after its budget and has
// written the waiter heartbeat; a mockup request made while it waits is claimed and returned; a
// Dismiss made while it waits ends it as dismissed and clears the heartbeat.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { suggestionDevice } from "./helpers/suggestion-fixture.mjs";

const card = await import("../build/suggestions/card.js");
const { loadStopWords } = await import("../build/suggestions/crosscheck.js");
const { RECORD_SOURCES } = await import("../build/suggestions/records.js");

const STOP = loadStopWords(process.env);
const RECORDS = { texts: Object.fromEntries(RECORD_SOURCES.map((s) => [s, []])), states: Object.fromEntries(RECORD_SOURCES.map((s) => [s, "read"])), firmName: "Lindqvist Harrow LLP" };
const FACTS = { plugins: [{ plugin: "lawyer", installed: true, version: "0.9.14" }], other_tools: 12, host: "Code", os: { platform: "linux", release: null, arch: "x64" } };
const INPUT = {
  origin: "practitioner",
  source: "user",
  skill: "show-me",
  pain_point: { text: "The list was hard to read in white on dark green.", guess: false },
  items: [{ text: "Put the numbers in their own column.", visual: true }],
  context_lines: [{ kind: "constraint", text: "No nested cards or boxes." }],
};

async function builtCard(t) {
  const f = suggestionDevice(t);
  const deps = { env: f.env, records: async () => RECORDS, stopWords: () => STOP, placeholders: () => ["[client]"], seams: f.seams };
  const result = await card.buildCard(card.cardInput(structuredClone(INPUT)), structuredClone(FACTS), deps);
  assert.equal(result.built, true, JSON.stringify(result));
  const stored = () => JSON.parse(readFileSync(f.store, "utf-8")).records.find((r) => r.record_id === result.card_id);
  return { deps, id: result.card_id, stored };
}

/** Waits until the running wait's first poll has written its heartbeat. */
async function heartbeat(stored) {
  while (stored().waiter_until === null || stored().waiter_until === undefined) await new Promise((r) => setTimeout(r, 5));
}

test("a wait with nothing to report returns pending after its budget, having written the heartbeat", async (t) => {
  const { deps, id, stored } = await builtCard(t);
  const started = Date.now();
  assert.deepEqual(await card.waitForCard(id, { ...deps, timeoutMs: 120, pollMs: 20 }), { event: "pending", card_id: id });
  assert.ok(Date.now() - started >= 120, "the whole budget was waited");
  assert.ok(Date.parse(stored().waiter_until) > Date.now(), "the heartbeat says an agent is listening");
});

test("a mockup request made while the card is waited on is claimed and returned", async (t) => {
  const { deps, id, stored } = await builtCard(t);
  const done = card.waitForCard(id, { ...deps, timeoutMs: 5000, pollMs: 10 });
  await heartbeat(stored);
  assert.deepEqual(await card.requestMockup(id, {}, deps), { outcome: "requested" });
  const event = await done;
  assert.equal(event.event, "mockup");
  assert.deepEqual(event.items, ["Put the numbers in their own column."]);
  assert.deepEqual(event.constraints, ["No nested cards or boxes."]);
  assert.ok(stored().mockup_request.taken_at, "the request is claimed");
});

test("a Dismiss made while the card is waited on ends the wait and clears the heartbeat", async (t) => {
  const { deps, id, stored } = await builtCard(t);
  const done = card.waitForCard(id, { ...deps, timeoutMs: 5000, pollMs: 10 });
  await heartbeat(stored);
  await card.dismissCard(id, deps);
  assert.deepEqual(await done, { event: "dismissed", card_id: id });
  assert.equal(stored().waiter_until, null);
});
