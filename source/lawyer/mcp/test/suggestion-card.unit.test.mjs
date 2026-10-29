// The suggestion card (suggestions/card.ts and card-page.ts; docs/Plans/2026-10-25_suggestion-design.md,
// decisions 2, 5 to 13 and 22 to 28; lifecycle plan Phase 4), over invented records handed in:
// building refuses while the full check finds a match and a built card passes it; the page holds every
// fixed string in decision 6's order; at Submit a record token, email or path in readable text offers
// Remove only and a date or amount Remove and Send anyway, and Remove deletes it from what is stored
// and sent; a match in generated text is dropped unasked and recorded as a defect; Dismiss and Restore
// Suggestion; the wait tool and the mockup round, a rejection's reason becoming a constraint line.

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { stubCloud, suggestionDevice } from "./helpers/suggestion-fixture.mjs";

const card = await import("../build/suggestions/card.js");
const { loadStopWords, runCrossCheck } = await import("../build/suggestions/crosscheck.js");
const { loadPlaceholders } = await import("../build/suggestions/mockup.js");
const { RECORD_SOURCES } = await import("../build/suggestions/records.js");

const STOP = loadStopWords(process.env);
const PLACEHOLDERS = loadPlaceholders(process.env);
const ID = "0b7c3a5e-1f2d-4c6b-9a8e-7d6c5b4a3f21";

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

const INPUT = {
  origin: "practitioner",
  source: "user",
  skill: "show-me",
  pain_point: { text: "The list for [client] was hard to read in white on dark green.", guess: false },
  items: [
    { text: "Put the numbers in their own column with hanging indents.", visual: true },
    { text: "Put connectors such as or alternatively on their own italic lines.", visual: true, guess: true },
    { text: "Say which list is the current one, as for [matter], [person], [document], [file] and [date]." },
  ],
  context_lines: [{ kind: "constraint", text: "No nested cards or boxes." }, { kind: "evidence", text: "The list ran to [amount] lines.", guess: true }],
};

async function device(t, { cloud: respond } = {}) {
  const f = suggestionDevice(t);
  const deps = {
    env: f.env,
    records: async () => RECORDS,
    stopWords: () => STOP,
    placeholders: () => PLACEHOLDERS,
    seams: f.seams,
  };
  const cloud = await stubCloud(t, respond ?? (() => [200, { suggestion_id: ID, items_saved: true, previews_saved: false, mockup_saved: false }]));
  f.env.SUPABASE_URL = cloud.url;
  return { f, deps, cloud };
}

const read = (f) => JSON.parse(readFileSync(f.store, "utf-8"));
const stored = (f, id) => read(f).records.find((r) => r.record_id === id);

/** Starts the agent's wait and returns once its first poll has marked the card as waited on. */
async function startWait(f, deps, cardId) {
  const before = stored(f, cardId).waiter_until;
  const done = card.waitForCard(cardId, { ...deps, timeoutMs: 5000, pollMs: 10 });
  while (stored(f, cardId).waiter_until === before) await new Promise((resolve) => setTimeout(resolve, 5));
  return { done };
}

async function built(deps, input = INPUT) {
  const result = await card.buildCard(card.cardInput(structuredClone(input)), structuredClone(FACTS), deps);
  assert.equal(result.built, true, JSON.stringify(result));
  return result;
}

test("a card is built only when the full check finds nothing, and a built card passes it (decision 22)", async (t) => {
  const { f, deps } = await device(t);
  const refused = await card.buildCard(card.cardInput({ ...INPUT, pain_point: { text: "The list for Quillfeather, sent on 3 March 2026, was hard to read." } }), FACTS, deps);
  assert.equal(refused.built, false);
  assert.deepEqual(refused.hits.map((h) => [h.part, h.kind, h.offer]), [["pain_point", "record", "remove_only"], ["pain_point", "date", "remove_or_send_anyway"]]);
  assert.ok(!JSON.stringify(refused).includes("Quillfeather"), "the refusal never quotes the match");
  assert.throws(() => readFileSync(f.store), /ENOENT/, "nothing is stored for a refused card");

  const { card_id, card_path } = await built(deps);
  assert.equal(card_path, join(f.device, "suggestions", `Suggestion-${card_id}.html`));
  const record = stored(f, card_id);
  assert.equal(record.kind, "card");
  const check = runCrossCheck(card.cardText(record), RECORDS, STOP);
  assert.deepEqual(check.hits, []);
  assert.equal(check.passed, true);
  assert.throws(() => card.cardInput({ ...INPUT, pain_point: { text: "As [Smith] said." } }), /\[Smith\]/);
});

const UNREAD = { ...RECORDS, states: { ...RECORDS.states, matter: "unavailable", file_name: "partial" } };

test("a build whose check could not read every record source is refused, naming only the categories, and nothing is saved", async (t) => {
  const { f, deps } = await device(t);
  const result = await card.buildCard(card.cardInput(structuredClone(INPUT)), FACTS, { ...deps, records: async () => UNREAD });
  assert.deepEqual(result, { built: false, reason: "records_unreadable", unreadable: ["matter", "file name"] });
  assert.throws(() => readFileSync(f.store), /ENOENT/, "nothing is stored");
  const { readdirSync, existsSync: exists } = await import("node:fs");
  const folder = join(f.device, "suggestions");
  assert.ok(!exists(folder) || !readdirSync(folder).some((n) => n.startsWith("Suggestion-")), "no card page is written");
});

test("a Submit whose check could not read every record source sends nothing, keeps the cause locally, and can be tried again", async (t) => {
  const { f, deps, cloud } = await device(t);
  const { card_id, card_path } = await built(deps);
  assert.ok(readFileSync(card_path, "utf-8").includes("Not sent: Probanda could not check this against your records."), "the line is built into the page");
  const unread = { ...deps, records: async () => UNREAD };
  const result = await card.submitCard(card_id, { comment: "Most mornings." }, unread);
  assert.equal(result.outcome, "unchecked");
  assert.equal(cloud.calls.length, 0, "nothing reaches the cloud");
  const record = stored(f, card_id);
  assert.equal(record.state, "open", "the card stays open");
  assert.equal(record.check_failures.length, 1);
  assert.equal(record.check_failures[0].records.matter, "unavailable", "the raw cause is in the local record");
  assert.equal(record.suggestion_record_id, null);
  assert.equal(read(f).records.filter((r) => r.kind === "suggestion").length, 0, "nothing is saved for sending");
  assert.equal((await card.readCardState(card_id, deps)).status, null);
  const again = await card.submitCard(card_id, {}, deps);
  assert.equal(again.outcome, "sent", "Submit works once every source can be read");
  assert.equal(cloud.calls[0].body.comment, "Most mornings.");
});

test("the page holds every fixed string in decision 6's order, the guess label and the brackets", async (t) => {
  const { f, deps } = await device(t);
  const { card_path } = await built(deps);
  const html = readFileSync(card_path, "utf-8");
  const body = html.replace(/<script[\s\S]*?<\/script>/g, "").replace(/<style[\s\S]*?<\/style>/g, "");
  const order = [
    "You suggested:",
    "The list for",
    '<span class="bracket">[client]</span>',
    "Put the numbers in their own column",
    "Put connectors such as or alternatively",
    "our guess, edit if wrong",
    "Say which list is the current one, as for",
    '<span class="bracket">[matter]</span>',
    '<span class="bracket">[person]</span>',
    '<span class="bracket">[document]</span>',
    '<span class="bracket">[file]</span>',
    '<span class="bracket">[date]</span>',
    "Show a mockup of this",
    "Constraint",
    "No nested cards or boxes.",
    "Evidence",
    '<span class="bracket">[amount]</span>',
    "our guess, edit if wrong",
    `placeholder="Please don&#39;t name clients, matters, people or files."`,
    "Probanda receives this from your account: what you see here, a technical write-up of it, and technical details about the Probanda software on this computer.",
    "Show technical details",
    "You can see this later, with its status, under Past suggestions.",
    "Submit Suggestion",
    "Dismiss",
  ];
  let at = 0;
  for (const piece of order) {
    const found = body.indexOf(piece, at);
    assert.ok(found >= 0, `"${piece}" is missing or out of order`);
    at = found + piece.length;
  }
  assert.equal((body.match(/our guess, edit if wrong/g) ?? []).length, 2, "the label only on the blocks marked as a guess");
  for (const bracket of card.BRACKETS) assert.ok(body.includes(`<span class="bracket">[${bracket}]</span>`), `the bracket [${bracket}] is marked out`);
  for (const piece of ["Open this suggestion again to see a mockup", "Restore Suggestion", "Sending..."]) {
    assert.ok(html.includes(piece), `the page carries "${piece}"`);
  }
  assert.ok(!/<script[^>]*\ssrc=/.test(html), "no outside script");
  assert.match(html, /connect-src http:\/\/127\.0\.0\.1:\d+;/);

  const noticed = await built(deps, { ...INPUT, origin: "probanda", source: "assisted", items: [{ text: "Say which list is the current one." }] });
  const other = readFileSync(noticed.card_path, "utf-8").replace(/<script[\s\S]*?<\/script>/g, "");
  assert.ok(other.includes("Probanda noticed:"));
  assert.ok(!other.includes("Show a mockup of this"), "no mockup link when no item is visual");
});

test("until the page API answers, the card hides its buttons and says it cannot send, linking to card_url", async (t) => {
  const { deps } = await device(t);
  const { card_path, card_url } = await built(deps);
  const body = readFileSync(card_path, "utf-8").replace(/<script[\s\S]*?<\/script>/g, "");
  const note = /<p class="status error" id="offline">This copy cannot reach Probanda, so it cannot send\. <a href="([^"]+)"[^>]*>Open on this computer<\/a>, with Claude open there, to submit or dismiss it\.<\/p>/.exec(body);
  assert.ok(note, "the note and its link are on the page as written, with no script run");
  assert.equal(note[1].replace(/&#38;/g, "&"), card_url);
  assert.match(body, /<div class="actions" id="actions" hidden><button type="button" id="submit">/, "Submit and Dismiss start hidden");
});

test("the page's script parses", async (t) => {
  const { deps } = await device(t);
  const { card_path } = await built(deps);
  const { Script } = await import("node:vm");
  const html = readFileSync(card_path, "utf-8");
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  assert.equal(scripts.length, 1);
  assert.doesNotThrow(() => new Script(scripts[0]));
});

test("at Submit a record token, email or path offers Remove only, a date or amount Remove and Send anyway, and Remove deletes it from what is stored and sent", async (t) => {
  const { f, deps, cloud } = await device(t);
  const { card_id } = await built(deps);
  const before = stored(f, card_id);
  const edits = {
    pain_point: "The list for Okafor was hard to read.",
    items: [
      { id: "i1", text: "Send it to jane.doe@example.com when it is ready." },
      { id: "i2", text: "Keep the copy in D:\\Data\\Ledger\\list.pdf as it is." },
      { id: "i3", text: "It cost $1,200 on 3 March 2026." },
    ],
    context_lines: before.context_lines.map(({ id, text }) => ({ id, text })),
    comment: "Like the Ghostwillow page.",
  };
  const first = await card.submitCard(card_id, edits, deps);
  assert.equal(first.outcome, "check");
  assert.equal(cloud.calls.length, 0, "nothing is sent while a prompt is open");
  const offers = first.prompts.map((p) => [p.part, p.id, p.kind, p.offer]);
  assert.deepEqual(offers, [
    ["pain_point", null, "record", "remove_only"],
    ["items", "i1", "email", "remove_only"],
    ["items", "i2", "path", "remove_only"],
    ["items", "i3", "amount", "remove_or_send_anyway"],
    ["items", "i3", "date", "remove_or_send_anyway"],
    ["comment", null, "record", "remove_only"],
  ]);
  assert.equal(first.prompts[0].text, "Okafor");

  // A record token cannot be sent anyway.
  const refused = await card.resolvePrompt(card_id, { ...first.prompts[0], action: "send_anyway" }, deps);
  assert.equal(refused.outcome, "stale");
  assert.ok(stored(f, card_id).pain_point.text.includes("Okafor"));

  let reply = first;
  const answer = async (kind, part, action) => {
    const p = reply.prompts.find((x) => x.kind === kind && x.part === part);
    reply = await card.resolvePrompt(card_id, { part: p.part, id: p.id, start: p.start, end: p.end, action }, deps);
    return reply;
  };
  await answer("record", "pain_point", "remove");
  assert.equal(stored(f, card_id).pain_point.text, "The list for [person] was hard to read.", "Remove deletes it from the stored card");
  await answer("email", "items", "remove");
  await answer("path", "items", "remove");
  await answer("amount", "items", "remove");
  await answer("date", "items", "send_anyway");
  assert.equal(reply.outcome, "check");
  assert.deepEqual(reply.prompts.map((p) => p.part), ["comment"]);
  await answer("record", "comment", "remove");
  assert.equal(reply.outcome, "sent");
  assert.equal(reply.status, "Submitted ✓");

  assert.equal(cloud.calls.length, 1);
  const sent = cloud.calls[0].raw;
  for (const planted of ["Okafor", "jane.doe@example.com", "Ledger", "$1,200", "Ghostwillow"]) {
    assert.ok(!sent.includes(planted), `${planted} is not sent`);
    assert.ok(!JSON.stringify(read(f)).includes(planted), `${planted} is not stored`);
  }
  assert.ok(sent.includes("3 March 2026"), "a date sent anyway is sent");
  const body = cloud.calls[0].body;
  assert.equal(body.pain_point, "The list for [person] was hard to read.");
  assert.deepEqual(body.items, ["Send it to [person] when it is ready.", "Keep the copy in [file] as it is.", "It cost [amount] on 3 March 2026."]);
  assert.equal(body.comment, "Like the [file] page.");
  assert.equal(body.origin, "practitioner");
  assert.equal(body.title, "The list for [person] was hard to read.");
  assert.deepEqual(body.environment_facts, FACTS);
  const record = stored(f, card_id);
  assert.equal(record.state, "submitted");
  const suggestion = stored(f, record.suggestion_record_id);
  assert.equal(suggestion.payload, sent, "the payload stored is the payload sent");
  assert.equal((await card.readCardState(card_id, deps)).status, "Submitted ✓", "the card shows its status");
  assert.equal((await card.submitCard(card_id, {}, deps)).outcome, "closed", "a second Submit sends nothing");
  assert.equal(cloud.calls.length, 1);
});

test("an emptied item is removed, and an edited block loses its guess label", async (t) => {
  const { f, deps, cloud } = await device(t);
  const { card_id } = await built(deps);
  const result = await card.submitCard(card_id, {
    items: [{ id: "i1", text: "" }, { id: "i2", text: "Put connectors on their own italic lines." }, { id: "i3", text: "Say which list is the current one." }],
  }, deps);
  assert.equal(result.outcome, "sent");
  const record = stored(f, card_id);
  assert.deepEqual(record.items.map((i) => [i.id, i.guess]), [["i2", false], ["i3", false]]);
  assert.deepEqual(cloud.calls[0].body.items, ["Put connectors on their own italic lines.", "Say which list is the current one."]);
});

test("a match in the environment facts, the raw observation or the mockup is dropped without a prompt and recorded as a defect", async (t) => {
  const { f, deps, cloud } = await device(t);
  const { card_id } = await built(deps, { ...INPUT, origin: "probanda", source: "assisted", raw_observation: ["tool error class timeout", "retries 3"] });
  // Plant a match in each generated part, as a defect in what generated it would.
  const { withStore } = await import("../build/suggestions/store.js");
  await withStore(f.env, (s) => {
    const c = s.records.find((r) => r.record_id === card_id);
    c.environment_facts.plugins.push({ plugin: "Vantressa", installed: false, version: null });
    c.raw_observation.push("seen while Pemberforth was open");
    c.mockup = { n: 1, html: "<p>Placeholder list for Yovanovich</p>" };
  });
  const result = await card.submitCard(card_id, {}, deps);
  assert.equal(result.outcome, "sent", "no prompt for generated text");
  const body = cloud.calls[0].body;
  const facts = structuredClone(FACTS);
  facts.plugins.push({ installed: false, version: null });
  assert.deepEqual(body.environment_facts, facts, "only the planted fact is removed");
  assert.equal(body.raw_observation, "tool error class timeout\nretries 3");
  assert.equal(body.mockup, undefined, "the whole mockup is removed");
  const record = stored(f, card_id);
  assert.deepEqual(record.defects.map((d) => [d.when, d.part, d.kind]), [
    ["click", "raw_observation", "record"],
    ["click", "mockup", "record"],
    ["click", "environment_facts", "record"],
  ]);
  assert.equal(record.defects[2].field, "plugins[1].plugin");
  assert.ok(!JSON.stringify(record.defects).match(/Vantressa|Pemberforth|Yovanovich/), "a defect never holds the text");
});

test("Dismiss sends nothing and is recorded; Restore Suggestion takes it back; neither shows under Past suggestions", async (t) => {
  const { f, deps, cloud } = await device(t);
  const { card_id } = await built(deps);
  assert.deepEqual(await card.dismissCard(card_id, deps), { outcome: "dismissed" });
  let s = read(f);
  const dismissal = s.records.find((r) => r.kind === "dismissal");
  assert.equal(dismissal.card_id, card_id);
  assert.equal(dismissal.plugin_version, "lawyer 0.9.14");
  assert.equal(stored(f, card_id).state, "dismissed");
  assert.equal((await card.submitCard(card_id, {}, deps)).outcome, "closed", "a dismissed card sends nothing");
  assert.equal(cloud.calls.length, 0);
  assert.deepEqual(await card.restoreCard(card_id, deps), { outcome: "restored" });
  s = read(f);
  assert.equal(s.records.filter((r) => r.kind === "dismissal").length, 0);
  assert.equal(stored(f, card_id).state, "open");
  await card.dismissCard(card_id, deps);
  const { writePastSuggestionsPage } = await import("../build/suggestions/page.js");
  const page = readFileSync(await writePastSuggestionsPage(f.env), "utf-8");
  assert.ok(!page.includes("hard to read"), "a dismissed card is not a past suggestion");
});

test("the wait tool returns at Submit and Dismiss, and the mockup link is live only while it waits", async (t) => {
  const { f, deps } = await device(t);
  const { card_id } = await built(deps);
  assert.equal((await card.readCardState(card_id, deps)).mockup_link, "no_waiter");
  assert.deepEqual(await card.requestMockup(card_id, {}, deps), { outcome: "no_waiter" });
  const pending = await card.waitForCard(card_id, { ...deps, timeoutMs: 50, pollMs: 10 });
  assert.equal(pending.event, "pending");
  assert.equal((await card.readCardState(card_id, deps)).mockup_link, "available", "a waiter just polled");

  const waiting = await startWait(f, deps, card_id);
  assert.deepEqual(await card.requestMockup(card_id, {}, deps), { outcome: "requested" });
  const event = await waiting.done;
  assert.equal(event.event, "mockup");
  assert.deepEqual(event.items, [INPUT.items[0].text, INPUT.items[1].text], "every visual item, together");
  assert.deepEqual(event.constraints, ["No nested cards or boxes."]);
  assert.deepEqual(event.placeholders, PLACEHOLDERS);
  assert.equal((await card.readCardState(card_id, deps)).mockup_link, "requested");

  const submitted = await startWait(f, deps, card_id);
  await card.submitCard(card_id, {}, deps);
  assert.equal((await submitted.done).event, "submitted");
  assert.equal(stored(f, card_id).waiter_until, null);
});

const MOCKUP = '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Page title</title>' +
  "<style>body{font-family:Georgia,serif;background:white;color:black}ol{padding-left:2em}.alt{font-style:italic}</style></head>" +
  '<body><h1>Heading</h1><ol><li>First item</li><li class="alt">or alternatively</li><li>Second item</li></ol></body></html>';

test("a rejected mockup's reason becomes a constraint line, its page is deleted, and the link comes back up to three times", async (t) => {
  const { f, deps, cloud } = await device(t);
  const { card_id } = await built(deps);
  const round = async (n) => {
    const waiting = await startWait(f, deps, card_id);
    assert.deepEqual(await card.requestMockup(card_id, {}, deps), { outcome: "requested" }, `round ${n}`);
    assert.equal((await waiting.done).event, "mockup");
    const { mockup_path } = await card.attachMockup(card_id, MOCKUP, deps);
    assert.equal(mockup_path, join(f.device, "suggestions", `Suggestion-${card_id}-mockup-${n}.html`));
    const page = readFileSync(mockup_path, "utf-8");
    assert.ok(page.includes("Not like this, because..."));
    assert.equal((await card.readCardState(card_id, deps)).mockup_link, "hidden", "no link while a mockup is on the card");
    return mockup_path;
  };
  const path = await round(1);
  const rejected = await card.rejectMockup(card_id, 1, "Too graphical for a list of points.", deps);
  assert.deepEqual(rejected, { outcome: "rejected", mockup_available: true });
  assert.equal(existsSync(path), false, "the rejected mockup's page is deleted");
  const record = stored(f, card_id);
  assert.deepEqual(record.context_lines.at(-1), { id: "c3", kind: "constraint", text: "Too graphical for a list of points.", guess: false });
  assert.equal(record.mockup, null);
  assert.deepEqual((await card.rejectMockup(card_id, 1, "again", deps)), { outcome: "gone" });

  for (const n of [2, 3]) {
    await round(n);
    assert.equal((await card.rejectMockup(card_id, n, `Reason ${n}.`, deps)).mockup_available, true);
  }
  await round(4);
  assert.deepEqual(await card.rejectMockup(card_id, 4, "Reason 4.", deps), { outcome: "rejected", mockup_available: false });
  assert.equal((await card.readCardState(card_id, deps)).mockup_link, "hidden", "after the third return the link stays away");

  await card.submitCard(card_id, {}, deps);
  const body = cloud.calls[0].body;
  assert.deepEqual(body.context_lines.map((l) => l.text).slice(2), ["Too graphical for a list of points.", "Reason 2.", "Reason 3.", "Reason 4."]);
  assert.equal(body.mockup, undefined, "no rejected mockup travels");
});

test("only the mockup on the card at the click travels", async (t) => {
  const { f, deps, cloud } = await device(t);
  const { card_id } = await built(deps);
  const waiting = await startWait(f, deps, card_id);
  await card.requestMockup(card_id, {}, deps);
  await waiting.done;
  await assert.rejects(card.attachMockup(card_id, MOCKUP.replace("First item", "Quillfeather"), deps), /placeholder text/);
  await card.attachMockup(card_id, MOCKUP, deps);
  await assert.rejects(card.attachMockup(card_id, MOCKUP, deps), /no mockup was asked for/);
  await card.submitCard(card_id, {}, deps);
  assert.equal(cloud.calls[0].body.mockup, MOCKUP, "byte for byte");
});
