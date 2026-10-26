// The local suggestion store (suggestions/store.ts): one file under CLAUDE_PLUGIN_DATA, one list of
// records each naming its kind, the old suggestions.local.json beside probanda.json read into it once
// with no entry lost, and the suggestion_log__* tools over it.

import assert from "node:assert/strict";
import { readFileSync, statSync, writeFileSync } from "node:fs";
import test from "node:test";

import { suggestionDevice } from "./helpers/suggestion-fixture.mjs";

const { loadStore, withStore, storePath } = await import("../build/suggestions/store.js");
const { suggestionLogRead, suggestionLogWrite } = await import("../build/suggestions/tools.js");

const OLD_LOG = {
  suggestions: [
    { suggestion_id: "0b7c3a5e-1f2d-4c6b-9a8e-7d6c5b4a3f21", title: "Shorter letters", posted_on: "2026-10-01", last_status: "approved in part", last_shown_status: "new" },
    { suggestion_id: "1c8d4b6f-2e3a-4d7c-8b9f-6e5d4c3b2a10", title: "Bigger buttons", posted_on: "2026-10-02", last_status: "rejected", last_shown_status: "rejected" },
    { suggestion_id: "2d9e5c7a-3f4b-4e8d-9c1a-5f6e4d3c2b11", title: "A date column", posted_on: "2026-10-03", last_status: "new", last_shown_status: null },
  ],
  held: [{ held_id: "h-1", held_on: "2026-10-04", draft: { title: "Held one", body: "Drafted with no key.", source: "user" } }],
};

test("the store lives under CLAUDE_PLUGIN_DATA, and a host that gives no data folder is refused by name", async (t) => {
  const f = suggestionDevice(t);
  assert.equal(storePath(f.env), f.store);
  await assert.rejects(loadStore({ ...f.env, CLAUDE_PLUGIN_DATA: "" }), (e) => e.code === "plugin_data_unset");
  await assert.rejects(loadStore({ ...f.env, CLAUDE_PLUGIN_DATA: "${CLAUDE_PLUGIN_DATA}" }), (e) => e.code === "plugin_data_unset");
});

test("an existing suggestions.local.json is migrated once on first read, with no entry lost", async (t) => {
  const f = suggestionDevice(t);
  writeFileSync(f.legacyLog, JSON.stringify(OLD_LOG));
  const before = readFileSync(f.legacyLog, "utf-8");

  const log = await suggestionLogRead(f.env);
  assert.deepEqual(log.suggestions.map((s) => [s.suggestion_id, s.title, s.sent_on, s.status, s.badge, s.shown_badge]), [
    [OLD_LOG.suggestions[0].suggestion_id, "Shorter letters", "2026-10-01", "Submitted ✓", "Approved", "Submitted"],
    [OLD_LOG.suggestions[1].suggestion_id, "Bigger buttons", "2026-10-02", "Submitted ✓", "Declined", "Declined"],
    [OLD_LOG.suggestions[2].suggestion_id, "A date column", "2026-10-03", "Submitted ✓", "Submitted", null],
  ]);
  assert.deepEqual(log.held, [{ held_id: "h-1", held_on: "2026-10-04", draft: OLD_LOG.held[0].draft }]);

  const stored = JSON.parse(readFileSync(f.store, "utf-8"));
  assert.equal(stored.migrated_log.from, "suggestions.local.json");
  assert.ok(stored.records.every((r) => typeof r.kind === "string"), "one list, each record naming its kind");
  assert.ok(stored.records.filter((r) => r.kind === "suggestion").every((r) => r.payload === null && r.state === "sent"));
  assert.equal(readFileSync(f.legacyLog, "utf-8"), before, "the old file is left as it was");

  // Read once: a later change to the old file is not read again.
  writeFileSync(f.legacyLog, JSON.stringify({ suggestions: [], held: [{ held_id: "h-2", held_on: "2026-10-05", draft: { title: "t", body: "b" } }] }));
  const mtime = statSync(f.store).mtimeMs;
  assert.equal((await suggestionLogRead(f.env)).held.length, 1);
  assert.equal(statSync(f.store).mtimeMs, mtime, "a plain read writes nothing");
});

test("a log written before held suggestions existed still migrates", async (t) => {
  const f = suggestionDevice(t);
  writeFileSync(f.legacyLog, JSON.stringify({ suggestions: [] }));
  assert.deepEqual(await suggestionLogRead(f.env), { suggestions: [], held: [], open_cards: [] });
  assert.equal(JSON.parse(readFileSync(f.store, "utf-8")).migrated_log.from, "suggestions.local.json");
});

test("an old log that cannot be read stops the read, and nothing is written", async (t) => {
  const f = suggestionDevice(t);
  writeFileSync(f.legacyLog, "{ not json");
  await assert.rejects(suggestionLogRead(f.env), (e) => e.code === "invalid_file");
  assert.throws(() => readFileSync(f.store), /ENOENT/);
});

test("seen and release over the store; nothing new is held; a kind this version does not know is kept", async (t) => {
  const f = suggestionDevice(t);
  const draft = { title: "Shorter letters", body: "Letters run long.", source: "user" };
  await withStore(f.env, (store) => {
    store.records.push({ kind: "dismissal", record_id: "d-1", fingerprint: { plugin: "lawyer", version: "0.9.14", kind: "slow" } });
    store.records.push({ kind: "held", record_id: "h-9", created_at: "2026-10-04T00:00:00.000Z", draft });
  });
  const held_id = "h-9";
  assert.deepEqual((await suggestionLogRead(f.env)).held.map((h) => h.draft), [draft]);
  assert.equal((await suggestionLogWrite({ op: "release", held_id }, f.env)).status, "released");
  assert.deepEqual((await suggestionLogRead(f.env)).held, []);
  await assert.rejects(suggestionLogWrite({ op: "release", held_id }, f.env), (e) => e.code === "not_found");
  await assert.rejects(suggestionLogWrite({ op: "seen", suggestion_ids: ["nope"] }, f.env), (e) => e.code === "not_found");
  await assert.rejects(suggestionLogWrite({ op: "add", suggestion_id: "x", title: "y" }, f.env), /op must be/);
  // A suggestion with no key is sent from its card and retried; nothing is held any more.
  await assert.rejects(suggestionLogWrite({ op: "hold", draft }, f.env), /op must be "seen" or "release"/);
  const stored = JSON.parse(readFileSync(f.store, "utf-8"));
  assert.deepEqual(stored.records.map((r) => r.kind), ["dismissal"]);
  assert.deepEqual((await suggestionLogRead(f.env)).suggestions, [], "a dismissal is not a sent suggestion");
});
