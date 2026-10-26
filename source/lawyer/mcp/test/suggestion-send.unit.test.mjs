// Sending a suggestion (suggestions/send.ts; docs/Plans/2026-10-25_suggestion-design.md, decisions 13,
// 14 and 16): the exact payload is saved before it is sent; a send that cannot reach Probanda reads
// "Not sent, will retry" with its raw cause kept locally, and the next server start delivers it;
// seven starts whose retry failed stop the retries; a start with no key does not count; withdrawal
// is saved, confirmed after a 409, or refused; a withdrawn suggestion is never asked about.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { closedPort, KEY, stubCloud, suggestionDevice } from "./helpers/suggestion-fixture.mjs";

const { submitSuggestion, retryUnsent, readStatuses, withdrawSuggestion } = await import("../build/suggestions/send.js");
const { callSuggestionTool } = await import("../build/suggestions/tools.js");

const ID = "0b7c3a5e-1f2d-4c6b-9a8e-7d6c5b4a3f21";
const ID2 = "1c8d4b6f-2e3a-4d7c-8b9f-6e5d4c3b2a10";
const FIELDS = { title: "Shorter deadline summary", body: "The summary runs to three screens.", source: "user", skill: "lawyer:show-me" };

const read = (f) => JSON.parse(readFileSync(f.store, "utf-8"));
const only = (f) => read(f).records.filter((r) => r.kind === "suggestion");

const submitted = (call) => [200, { suggestion_id: ID, items_saved: true, previews_saved: false, mockup_saved: false }];

test("a send with the network down is kept unsent with its raw cause, and the next start delivers it", async (t) => {
  const f = suggestionDevice(t);
  f.env.SUPABASE_URL = `http://127.0.0.1:${await closedPort()}`;
  const result = await submitSuggestion(FIELDS, f.env, f.seams);
  assert.equal(result.status, "Not sent, will retry");
  assert.equal(result.not_sent_because, "not_reached");
  let [record] = only(f);
  assert.equal(record.state, "unsent");
  assert.match(record.last_error, /ECONNREFUSED|fetch failed/);
  assert.equal(record.failed_sessions, 0, "the click is not a server start");
  assert.deepEqual(JSON.parse(record.payload), { ...FIELDS, plugin_version: "lawyer 0.9.14" });

  const cloud = await stubCloud(t, submitted);
  f.env.SUPABASE_URL = cloud.url;
  const [retried] = await retryUnsent(f.env, f.seams);
  assert.equal(retried.status, "Submitted ✓");
  assert.equal(cloud.calls.length, 1);
  assert.equal(cloud.calls[0].path, "/functions/v1/suggestion-submit");
  assert.equal(cloud.calls[0].apikey, KEY);
  assert.equal(cloud.calls[0].raw, record.payload, "the bytes posted are the bytes stored");
  [record] = only(f);
  assert.equal(record.state, "sent");
  assert.equal(record.suggestion_id, ID);
  assert.equal(record.badge, "Submitted");
  assert.deepEqual(record.attempts.map((a) => [a.trigger, a.outcome]), [["click", "failed"], ["start", "sent"]]);
  assert.deepEqual(await retryUnsent(f.env, f.seams), [], "a sent suggestion is not sent again");
});

test("a suggestion is saved before it is sent, and the plugin and version come from plugin.json", async (t) => {
  const f = suggestionDevice(t);
  const cloud = await stubCloud(t, (call) => {
    const [stored] = only(f);
    assert.equal(stored.state, "sending", "the record is on disk while the post is out");
    assert.equal(stored.payload, call.raw);
    return submitted(call);
  });
  f.env.SUPABASE_URL = cloud.url;
  // A version in the fields is never sent: the server's own plugin.json names it.
  const sent = await submitSuggestion({ ...FIELDS, plugin_version: "9.9.9" }, f.env, f.seams);
  assert.equal(sent.status, "Submitted ✓");
  assert.equal(sent.items_saved, true);
  assert.equal(cloud.calls[0].body.plugin_version, "lawyer 0.9.14");
  await assert.rejects(callSuggestionTool("suggestion_box__submit", FIELDS, f.env, f.seams), /Unknown suggestion tool/, "no tool sends: only the card's Submit does");
});

test("the screen refuses before anything is saved or sent", async (t) => {
  const f = suggestionDevice(t);
  const cloud = await stubCloud(t, submitted);
  f.env.SUPABASE_URL = cloud.url;
  await assert.rejects(submitSuggestion({ ...FIELDS, body: "Write to jane.doe@example.com about it." }, f.env, f.seams), /submit refused: email/);
  await assert.rejects(submitSuggestion({ ...FIELDS, mockup: "<p>Reply to jane.doe@example.com</p>" }, f.env, f.seams), /submit refused: email/);
  await assert.rejects(submitSuggestion({ ...FIELDS, comment: "x".repeat(2001) }, f.env, f.seams), /too_long/);
  assert.equal(cloud.calls.length, 0);
  assert.throws(() => readFileSync(f.store), /ENOENT/);
});

test("seven starts whose retry failed stop the retries, and the record says Probanda could not be reached", async (t) => {
  const f = suggestionDevice(t);
  const cloud = await stubCloud(t, () => [502, { error: "the suggestion was not saved" }]);
  f.env.SUPABASE_URL = cloud.url;
  assert.equal((await submitSuggestion(FIELDS, f.env, f.seams)).status, "Not sent, will retry");
  for (let start = 1; start <= 6; start++) {
    const [r] = await retryUnsent(f.env, f.seams);
    assert.equal(r.status, "Not sent, will retry", `start ${start}`);
    assert.equal(only(f)[0].failed_sessions, start);
  }
  const [seventh] = await retryUnsent(f.env, f.seams);
  assert.equal(seventh.status, "Not sent; Probanda could not be reached");
  const [record] = only(f);
  assert.equal(record.state, "unreachable");
  assert.equal(record.last_error, "HTTP 502: the suggestion was not saved");
  assert.equal(cloud.calls.length, 8);
  assert.deepEqual(await retryUnsent(f.env, f.seams), [], "no eighth try");
  assert.equal(cloud.calls.length, 8);
});

test("a start with no key configured does not count as a failure to reach Probanda", async (t) => {
  const f = suggestionDevice(t, { key: false });
  const cloud = await stubCloud(t, submitted);
  f.env.SUPABASE_URL = cloud.url;
  const result = await submitSuggestion(FIELDS, f.env, f.seams);
  assert.equal(result.status, "Not sent, will retry");
  assert.equal(result.not_sent_because, "no_key");
  for (let start = 1; start <= 9; start++) await retryUnsent(f.env, f.seams);
  let [record] = only(f);
  assert.equal(record.state, "unsent");
  assert.equal(record.failed_sessions, 0);
  assert.equal(record.attempts.filter((a) => a.outcome === "no_key").length, 10);
  assert.equal(cloud.calls.length, 0);
  f.env.LEGAL_COMMONS_SUPABASE_KEY = KEY;
  assert.equal((await retryUnsent(f.env, f.seams))[0].status, "Submitted ✓");
  [record] = only(f);
  assert.equal(record.state, "sent");
});

async function sentSuggestion(t, respond) {
  const f = suggestionDevice(t);
  const cloud = await stubCloud(t, submitted);
  f.env.SUPABASE_URL = cloud.url;
  const { record_id } = await submitSuggestion(FIELDS, f.env, f.seams);
  cloud.calls.length = 0;
  cloud.respond = respond;
  return { f, cloud, record_id };
}

test("a withdrawal is saved with the badge Withdrawn, and a withdrawn suggestion is never asked about", async (t) => {
  const { f, cloud, record_id } = await sentSuggestion(t, (call) =>
    call.path === "/functions/v1/suggestion-withdraw" ? [200, { suggestion_id: ID, withdrawn: true }] : [200, { statuses: [] }]);
  assert.deepEqual(await withdrawSuggestion(record_id, f.env, f.seams), { outcome: "withdrawn", badge: "Withdrawn" });
  assert.deepEqual(cloud.calls.map((c) => [c.path, c.body]), [["/functions/v1/suggestion-withdraw", { suggestion_id: ID }]]);
  const [record] = only(f);
  assert.ok(record.withdrawn_at);
  assert.equal(record.badge, "Withdrawn");
  assert.notEqual(record.payload, null, "the local copy stays");

  cloud.calls.length = 0;
  assert.deepEqual(await readStatuses(undefined, f.env, f.seams), { suggestions: [], changed: [] });
  assert.deepEqual(await readStatuses([ID], f.env, f.seams), { suggestions: [], changed: [] });
  assert.equal(cloud.calls.length, 0, "suggestion-status never hears of a withdrawn suggestion");
  assert.deepEqual(await withdrawSuggestion(record_id, f.env, f.seams), { outcome: "withdrawn", badge: "Withdrawn" });
  assert.equal(cloud.calls.length, 0, "withdrawing again asks nothing");
});

test("a 409 on a retried withdrawal is confirmed through suggestion-status: an id no longer returned is withdrawn", async (t) => {
  const { f, cloud, record_id } = await sentSuggestion(t, (call) =>
    call.path === "/functions/v1/suggestion-withdraw"
      ? [409, { error: "Not withdrawn. Is this the id of a suggestion this computer sent and has not already withdrawn?" }]
      : [200, { statuses: [] }]);
  assert.equal((await withdrawSuggestion(record_id, f.env, f.seams)).outcome, "withdrawn");
  assert.deepEqual(cloud.calls.map((c) => c.path), ["/functions/v1/suggestion-withdraw", "/functions/v1/suggestion-status"]);
  assert.deepEqual(cloud.calls[1].body, { suggestion_ids: [ID] });
  assert.equal(only(f)[0].badge, "Withdrawn");
});

test("a refused withdrawal changes nothing but keeps its raw cause", async (t) => {
  const { f, cloud, record_id } = await sentSuggestion(t, (call) =>
    call.path === "/functions/v1/suggestion-withdraw"
      ? [409, { error: "Not withdrawn. Is this the id of a suggestion this computer sent and has not already withdrawn?" }]
      : [200, { statuses: [{ suggestion_id: ID, status: "submitted", badge: "Submitted", items: [] }] }]);
  assert.deepEqual(await withdrawSuggestion(record_id, f.env, f.seams), { outcome: "refused", badge: "Submitted" });
  let [record] = only(f);
  assert.equal(record.withdrawn_at, null);
  assert.match(record.withdraw_error, /^HTTP 409: Not withdrawn/);

  cloud.respond = () => [502, { error: "the suggestion was not withdrawn" }];
  assert.equal((await withdrawSuggestion(record_id, f.env, f.seams)).outcome, "unreachable");
  [record] = only(f);
  assert.equal(record.withdrawn_at, null);
  assert.equal(record.withdraw_error, "HTTP 502: the suggestion was not withdrawn");
});

test("a suggestion never sent is withdrawn on this computer alone, and is not retried", async (t) => {
  const f = suggestionDevice(t);
  f.env.SUPABASE_URL = `http://127.0.0.1:${await closedPort()}`;
  const { record_id } = await submitSuggestion(FIELDS, f.env, f.seams);
  assert.equal((await withdrawSuggestion(record_id, f.env, f.seams)).outcome, "withdrawn");
  assert.deepEqual(await retryUnsent(f.env, f.seams), []);
});

test("status stores each badge and per-item decision, and names what changed since it was shown", async (t) => {
  const { f, cloud } = await sentSuggestion(t, () => [200, {
    statuses: [{ suggestion_id: ID, status: "under review", triaged_at: "2026-10-26T10:00:00Z", badge: "Approved",
      items: [{ item: 1, status: "approved", reason: "Shorter summaries help everyone", category: null, implemented_in: null }] },
    { suggestion_id: ID2, badge: "Declined", items: [] }],
  }]);
  const result = await callSuggestionTool("suggestion_box__status", {}, f.env, f.seams);
  assert.deepEqual(result.changed, [ID]);
  assert.deepEqual(cloud.calls[0].body, { suggestion_ids: [ID] });
  assert.ok(result.past_suggestions_path.endsWith("Past suggestions.html"));
  const [record] = only(f);
  assert.equal(record.badge, "Approved");
  assert.equal(record.items[0].reason, "Shorter summaries help everyone");
  await callSuggestionTool("suggestion_log__write", { op: "seen", suggestion_ids: [ID] }, f.env, f.seams);
  const again = await callSuggestionTool("suggestion_box__status", {}, f.env, f.seams);
  assert.deepEqual(again.changed, []);
  assert.equal(again.past_suggestions_path, null);
});
