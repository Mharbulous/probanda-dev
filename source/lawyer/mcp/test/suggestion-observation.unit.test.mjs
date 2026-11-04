// AI-noticed suggestions (suggestions/observation.ts and the observation path of card.ts;
// docs/Plans/2026-10-25_suggestion-design.md, decisions 2, 3, 4, 9 and 12; lifecycle plan Phase 5):
// an observation is structured Probanda output only, and free text, a path, an email or an argument
// value is refused; its fingerprint comes from the installed plugin, never the caller; one card a
// day across sessions; a dismissed, sent or unanswered fingerprint is suppressed for 30 days and while
// the version is unchanged; a card left open by an ended session counts as dismissed; the cross-check
// drops a raw observation line that matches a record, unasked, as a defect.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { stubCloud, suggestionDevice } from "./helpers/suggestion-fixture.mjs";

const card = await import("../build/suggestions/card.js");
const obs = await import("../build/suggestions/observation.js");
const { loadStopWords } = await import("../build/suggestions/crosscheck.js");
const { loadPlaceholders } = await import("../build/suggestions/mockup.js");
const { RECORD_SOURCES } = await import("../build/suggestions/records.js");

const STOP = loadStopWords(process.env);
const PLACEHOLDERS = loadPlaceholders(process.env);
const TEXTS = obs.loadObservationTexts(process.env);
const ID = "0b7c3a5e-1f2d-4c6b-9a8e-7d6c5b4a3f21";
const DAY = 24 * 60 * 60_000;
const START = new Date(2026, 9, 26, 10, 0, 0);

const RECORDS = {
  texts: {
    client: ["Quillfeather Holdings Ltd."],
    matter: ["Vantressa estate dispute"],
    contact: ["Dremmond Okafor"],
    folder_name: ["Ghostwillow v Brumbridge"],
    document_title: ["Affidavit of Cressida Pemberforth"],
    file_name: ["Letter to Marchetti-Yovanovich.pdf"],
  },
  states: Object.fromEntries(RECORD_SOURCES.map((s) => [s, "read"])),
  firmName: "Lindqvist Harrow LLP",
};
const FACTS = { plugins: [{ plugin: "lawyer", installed: true, version: "0.9.14" }], other_tools: 12, host: "Code", os: { platform: "linux", release: null, arch: "x64" } };

/** A device whose clock and installed plugins the test sets. */
async function device(t) {
  const f = suggestionDevice(t);
  const state = {
    now: START,
    plugins: [
      { plugin: "lawyer", version: "0.9.14", skills: ["suggestion", "practice-data"] },
      { plugin: "litigator", version: "0.5.0", skills: ["draft", "work"] },
    ],
  };
  const seams = { ...f.seams, now: () => state.now, plugins: () => state.plugins, texts: () => TEXTS };
  const deps = { env: f.env, records: async () => RECORDS, stopWords: () => STOP, placeholders: () => PLACEHOLDERS, seams, now: () => state.now };
  const cloud = await stubCloud(t, () => [200, { suggestion_id: ID, items_saved: true, previews_saved: false, mockup_saved: false }]);
  f.env.SUPABASE_URL = cloud.url;
  return { f, state, seams, deps, cloud };
}

const stored = (f) => JSON.parse(readFileSync(f.store, "utf-8"));
const later = (state, days) => { state.now = new Date(START.getTime() + days * DAY); };

const TOOL_ERROR = { kind: "tool_error", skill: "draft", tool: "mcp__plugin_lawyer_data__practice_data__matter_lookup", error_code: "not_found" };

async function record(d, args = TOOL_ERROR) {
  const result = await obs.recordObservation(structuredClone(args), d.f.env, d.seams);
  assert.equal(result.recorded, true, JSON.stringify(result));
  return result.observation_id;
}

async function raise(d, session) {
  const next = await obs.nextObservation({ chat_session: session }, d.f.env, d.seams);
  if (next.observation === null) return null;
  const input = card.cardInput({
    origin: "probanda", source: "llm", observation_id: next.observation.observation_id, chat_session: session,
    pain_point: { text: "A step in drafting stopped with an error and had to be done another way.", guess: true },
    items: [{ text: "Make the step finish without the error.", guess: true }],
  });
  const built = await card.buildCard(input, structuredClone(FACTS), d.deps);
  assert.equal(built.built, true, JSON.stringify(built));
  return built.card_id;
}

test("an observation holds only structured Probanda output, in fixed words, and its fingerprint comes from the installed plugin", async (t) => {
  const d = await device(t);
  const id = await record(d, { ...TOOL_ERROR, counts: { calls: 3 }, text_key: "noted_as_loose_thread" });
  const rec = stored(d.f).records.find((r) => r.record_id === id);
  assert.equal(rec.kind, "observation");
  assert.deepEqual(rec.fingerprint, { plugin: "litigator", version: "0.5.0", skill: "draft", kind: "tool_error" }, "the plugin that ships the skill, at its installed version");
  assert.deepEqual(rec.raw_observation, [
    "A Probanda tool returned an error.",
    "Tool: plugin_lawyer_data__practice_data__matter_lookup",
    "Error code: not_found",
    "Calls: 3",
    TEXTS.get("noted_as_loose_thread"),
  ]);
  assert.equal(rec.displayed_at, null);
  const cowork = await obs.recordObservation({ kind: "tool_missing", tool: "mcp__a1b2c3__plugin_lawyer_data__practice_data__matter_lookup" }, d.f.env, d.seams);
  assert.equal(stored(d.f).records.find((r) => r.record_id === cowork.observation_id).observation.tool, "plugin_lawyer_data__practice_data__matter_lookup", "a Cowork bridge prefix is dropped");
  assert.deepEqual(stored(d.f).records.find((r) => r.record_id === cowork.observation_id).fingerprint, { plugin: "lawyer", version: "0.9.14", kind: "tool_missing" }, "no skill: the tool's plugin");
  const again = await obs.recordObservation(structuredClone({ ...TOOL_ERROR, counts: { calls: 3 }, text_key: "noted_as_loose_thread" }), d.f.env, d.seams);
  assert.deepEqual(again, { recorded: false, reason: "already_held", observation_id: id }, "the same observation, not yet shown, is not held twice");
});

test("a raw observation carrying free text, a path, an email or argument values is refused, and nothing is stored", async (t) => {
  const d = await device(t);
  const refused = [
    { ...TOOL_ERROR, message: "the affidavit for the estate could not be found" },
    { ...TOOL_ERROR, note: "anything" },
    { ...TOOL_ERROR, plugin: "lawyer" },
    { ...TOOL_ERROR, version: "9.9.9" },
    { ...TOOL_ERROR, error_code: "File not found: matters/estate/affidavit.pdf" },
    { ...TOOL_ERROR, error_code: "../matters/estate/affidavit.pdf" },
    { ...TOOL_ERROR, error_code: "someone@example.com" },
    { ...TOOL_ERROR, error_code: "not found" },
    { ...TOOL_ERROR, tool: 'practice_data__matter_lookup({"sql": "SELECT name FROM clients"})' },
    { ...TOOL_ERROR, tool: "mcp__plugin_lawyer_data__practice_data__matter_lookup --name someone" },
    { ...TOOL_ERROR, tool: "mcp__plugin_lawyer_data__no_such_tool" },
    { ...TOOL_ERROR, tool: "Bash" },
    { ...TOOL_ERROR, args: { name: "someone" } },
    { ...TOOL_ERROR, counts: { calls: "three" } },
    { ...TOOL_ERROR, counts: { calls: 2.5 } },
    { ...TOOL_ERROR, counts: { client_name: 1 } },
    { ...TOOL_ERROR, text_key: "The practitioner said the page was ugly." },
    { ...TOOL_ERROR, skill: "Draft the letter to someone" },
    { ...TOOL_ERROR, skill: "no-such-skill" },
    { kind: "free_text", tool: TOOL_ERROR.tool },
    { kind: "tool_error" },
    { kind: "repeated_calls", tool: TOOL_ERROR.tool },
    { kind: "token_use", counts: { calls: 2 } },
  ];
  for (const args of refused) {
    await assert.rejects(obs.recordObservation(args, d.f.env, d.seams), /must|has no field|names the tool|gives counts|unknown count|one of/, JSON.stringify(args));
  }
  let records = [];
  try {
    records = stored(d.f).records;
  } catch {
    records = [];
  }
  assert.equal(records.filter((r) => r.kind === "observation").length, 0);
  assert.equal(await obs.recordObservation({ kind: "token_use", counts: { input_tokens: 120000 } }, d.f.env, d.seams).then((r) => r.recorded), true);
});

test("one card a day across sessions: a second is not raised the same day, and is the next", async (t) => {
  const d = await device(t);
  await record(d);
  const second = await record(d, { kind: "tool_refused", skill: "work", tool: "drafting_data__query", error_code: "ValidationError" });
  const first = await raise(d, "session-a");
  assert.ok(first);
  const shown = stored(d.f);
  assert.equal(shown.records.find((r) => r.record_id === first).fingerprint.kind, "tool_error");
  assert.equal(shown.ai_noticed.next, null);
  assert.equal(shown.ai_noticed.session_id, "session-a");
  assert.equal(shown.ai_noticed.latest_observation, second);
  assert.equal(shown.ai_noticed.recheck_at, new Date(2026, 9, 27).toISOString(), "the answer holds until the next local midnight");

  assert.deepEqual(await obs.nextObservation({ chat_session: "session-a" }, d.f.env, d.seams), { observation: null });
  assert.deepEqual(await obs.nextObservation({ chat_session: "session-b" }, d.f.env, d.seams), { observation: null }, "the cap is across sessions");
  const forced = await card.buildCard(card.cardInput({
    origin: "probanda", source: "llm", observation_id: second, chat_session: "session-b",
    pain_point: { text: "A guess.", guess: true }, items: [{ text: "A change.", guess: true }],
  }), structuredClone(FACTS), d.deps);
  assert.deepEqual(forced, { built: false, reason: "not_raised" }, "the build enforces the cap itself");
  assert.equal(stored(d.f).records.find((r) => r.record_id === second).displayed_at, null);

  later(d.state, 1);
  const next = await obs.nextObservation({ chat_session: "session-c" }, d.f.env, d.seams);
  assert.equal(next.observation.observation_id, second, "the next day, the other fingerprint is raised");
});

test("a dismissed fingerprint is suppressed for 30 days and while the version is unchanged, and allowed after 30 days with a new version", async (t) => {
  const d = await device(t);
  await record(d);
  const cardId = await raise(d, "session-a");
  assert.equal((await card.dismissCard(cardId, d.deps)).outcome, "dismissed");
  const dismissal = stored(d.f).records.find((r) => r.kind === "dismissal");
  assert.deepEqual(dismissal.fingerprint, { plugin: "litigator", version: "0.5.0", skill: "draft", kind: "tool_error" });
  assert.equal(dismissal.plugin_version, "0.5.0");

  later(d.state, 2);
  await record(d, { ...TOOL_ERROR, error_code: "records_unreadable" });
  assert.deepEqual(await obs.nextObservation({ chat_session: "s2" }, d.f.env, d.seams), { observation: null }, "within 30 days");

  later(d.state, 31);
  assert.deepEqual(await obs.nextObservation({ chat_session: "s3" }, d.f.env, d.seams), { observation: null }, "after 30 days, but the version is the one it was dismissed under");

  later(d.state, 12);
  d.state.plugins[1].version = "0.5.1";
  const fresh = await record(d, { ...TOOL_ERROR, error_code: "ECONNREFUSED" });
  assert.equal(stored(d.f).records.find((r) => r.record_id === fresh).fingerprint.version, "0.5.1");
  assert.deepEqual(await obs.nextObservation({ chat_session: "s4" }, d.f.env, d.seams), { observation: null },
    "a new version within 30 days is still suppressed, and an observation noticed under the old version is not raised");
  later(d.state, 32);
  const next = await obs.nextObservation({ chat_session: "s5" }, d.f.env, d.seams);
  assert.equal(next.observation?.observation_id, fresh, "after 30 days, under a new version");
});

test("a sent fingerprint is suppressed, and the payload carries the fingerprint", async (t) => {
  const d = await device(t);
  await record(d);
  const cardId = await raise(d, "session-a");
  const sent = await card.submitCard(cardId, {}, d.deps);
  assert.equal(sent.outcome, "sent");
  const body = d.cloud.calls.find((c) => c.path.endsWith("suggestion-submit")).body;
  assert.equal(body.origin, "probanda");
  assert.equal(body.source, "llm");
  assert.equal(body.skill, "draft");
  assert.deepEqual(body.fingerprint, { plugin: "litigator", version: "0.5.0", skill: "draft", kind: "tool_error" });
  assert.equal(body.raw_observation, "A Probanda tool returned an error.\nTool: plugin_lawyer_data__practice_data__matter_lookup\nError code: not_found");
  later(d.state, 5);
  await record(d, { ...TOOL_ERROR, error_code: "HTTP 500" });
  assert.deepEqual(await obs.nextObservation({ chat_session: "s2" }, d.f.env, d.seams), { observation: null });
});

test("a card left unanswered when its session ended counts as dismissed at the next check, with no hook at session end", async (t) => {
  const d = await device(t);
  await record(d);
  const cardId = await raise(d, "session-a");
  later(d.state, 1);
  assert.deepEqual(await obs.nextObservation({ chat_session: "session-a" }, d.f.env, d.seams), { observation: null });
  assert.equal(stored(d.f).records.find((r) => r.record_id === cardId).state, "open", "its own session may still answer it");

  await record(d, { ...TOOL_ERROR, error_code: "invalid" });
  assert.deepEqual(await obs.nextObservation({ chat_session: "session-b" }, d.f.env, d.seams), { observation: null }, "the unanswered fingerprint is suppressed");
  const after = stored(d.f);
  const left = after.records.find((r) => r.record_id === cardId);
  assert.equal(left.state, "dismissed");
  assert.equal(left.unanswered, true);
  const dismissal = after.records.find((r) => r.kind === "dismissal" && r.card_id === cardId);
  assert.equal(dismissal.unanswered, true);
  assert.deepEqual(dismissal.fingerprint, { plugin: "litigator", version: "0.5.0", skill: "draft", kind: "tool_error" });
  assert.equal((await card.submitCard(cardId, {}, d.deps)).outcome, "closed", "a card counted as dismissed sends nothing");
});

test("the cross-check runs over the raw observation before the card is shown: a matching line is removed unasked, as a defect", async (t) => {
  const d = await device(t);
  await record(d, { ...TOOL_ERROR, error_code: "quillfeather_missing" });
  const cardId = await raise(d, "session-a");
  const built = stored(d.f).records.find((r) => r.record_id === cardId);
  assert.deepEqual(built.raw_observation, ["A Probanda tool returned an error.", "Tool: plugin_lawyer_data__practice_data__matter_lookup"]);
  assert.equal(built.defects.length, 1);
  assert.equal(built.defects[0].part, "raw_observation");
  assert.equal(built.defects[0].kind, "record");
  assert.ok(!JSON.stringify(built.defects).includes("quillfeather"), "a defect names where and what kind, never the text");
  const page = readFileSync(card.cardPath(cardId, d.f.env), "utf-8");
  assert.ok(page.includes("Probanda noticed:"), "the AI-noticed origin cue");
  assert.ok(page.includes("our guess, edit if wrong"));
  assert.ok(!page.includes("quillfeather"));
});

test("a card for an observation takes its raw observation and skill from the observation alone", async (t) => {
  const d = await device(t);
  const id = await record(d);
  const base = { origin: "probanda", source: "llm", observation_id: id, chat_session: "s", pain_point: { text: "A guess.", guess: true }, items: [{ text: "A change." }] };
  assert.throws(() => card.cardInput({ ...base, raw_observation: ["anything at all"] }), /raw observation from the observation/);
  assert.throws(() => card.cardInput({ ...base, skill: "draft" }), /skill from the observation/);
  assert.throws(() => card.cardInput({ ...base, origin: "practitioner" }), /origin probanda and source llm/);
  assert.throws(() => card.cardInput({ ...base, chat_session: undefined }), /chat_session/);
  assert.throws(() => card.cardInput({ ...base, session_id: "s" }), /unknown field "session_id"/, "the old input name is an unknown field: the Cowork bridge strips it");
  assert.throws(() => card.cardInput({ origin: "probanda", source: "assisted", chat_session: "s", pain_point: base.pain_point, items: base.items }), /only with observation_id/);
});
