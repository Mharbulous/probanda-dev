// The technical write-up that follows a sent suggestion (suggestions/specification.ts, with card.ts,
// send.ts and page.ts; docs/Plans/2026-10-25_suggestion-design.md, decision 18; lifecycle plan Phase
// 6), over invented records handed in and a stand-in cloud:
//   - the citation verifier rejects a sentence citing nothing, a citation to a missing card line,
//     environment-fact key or shipped file, and a quoted span not in its source, and passes a
//     specification whose every sentence traces;
//   - only a card a session was waiting on at the click gets a write-up, once;
//   - a planted client token is removed without a prompt and logged in the local record, never as text;
//   - a failed backstop, a failed citation check or an incoherent removal sends nothing after the
//     suggestion (zero calls to suggestion-attach-specification), and the local record says why;
//   - a write-up whose suggestion was not yet sent follows it when it is;
//   - the Past suggestions page opens at a suggestion with its write-up and both safeguards shown.

import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { stubCloud, suggestionDevice } from "./helpers/suggestion-fixture.mjs";

const card = await import("../build/suggestions/card.js");
const spec = await import("../build/suggestions/specification.js");
const { retryUnsent } = await import("../build/suggestions/send.js");
const page = await import("../build/suggestions/page.js");
const { loadStopWords } = await import("../build/suggestions/crosscheck.js");
const { RECORD_SOURCES } = await import("../build/suggestions/records.js");

const STOP = loadStopWords(process.env);
const ID = "0b7c3a5e-1f2d-4c6b-9a8e-7d6c5b4a3f21";
const ATTACH = "/functions/v1/suggestion-attach-specification";
const SUBMIT = "/functions/v1/suggestion-submit";

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
  ],
  context_lines: [{ kind: "constraint", text: "No nested cards or boxes." }, { kind: "evidence", text: "The list ran to [amount] lines.", guess: true }],
};

// A shipped file of the lawyer plugin, served from the fixture's install root as the plugin's own
// file read serves it. Its second line holds a matter's word, for the quoted-span rule.
const SHIPPED = "suggestion/SKILL.md";
const SHIPPED_TEXT = "# Suggestion\n\nThe suggestion is shown to the practitioner as a card,\nand only as a file card.\n\nVantressa appears here only for this test.\n";

// The plugin's own file read resolves paths the Windows way, so off Windows the flow tests read the
// shipped file through this stand-in; the reader itself is tested on Windows below.
const READER = (path) => (path === SHIPPED ? SHIPPED_TEXT : null);

const OK = (call) => (call.path === SUBMIT ? [200, { suggestion_id: ID, items_saved: true, previews_saved: false, mockup_saved: false }] : [200, { suggestion_id: ID, saved: true }]);

async function device(t, respond = OK) {
  const f = suggestionDevice(t);
  mkdirSync(join(f.seams.installRoot, "skills", "suggestion"), { recursive: true });
  mkdirSync(join(f.seams.installRoot, "skills", "shared"), { recursive: true });
  writeFileSync(join(f.seams.installRoot, "skills", ...SHIPPED.split("/")), SHIPPED_TEXT);
  const cloud = await stubCloud(t, respond);
  f.env.SUPABASE_URL = cloud.url;
  f.env.COCLERK_REPO_ROOT_AUTODETECT = "0";
  const deps = { env: f.env, records: async () => RECORDS, stopWords: () => STOP, seams: f.seams, readShipped: READER };
  return { f, deps, cloud };
}

const read = (f) => JSON.parse(readFileSync(f.store, "utf-8"));
const stored = (f, id) => read(f).records.find((r) => r.record_id === id);
const attachCalls = (cloud) => cloud.calls.filter((c) => c.path === ATTACH);

/** Builds a card and submits it, with a session waiting on it at the click unless `waited` is false. */
async function submitted(f, deps, { waited = true } = {}) {
  const built = await card.buildCard(card.cardInput(structuredClone(INPUT)), structuredClone(FACTS), deps);
  assert.equal(built.built, true, JSON.stringify(built));
  const cardId = built.card_id;
  let done = null;
  if (waited) {
    done = card.waitForCard(cardId, { ...deps, timeoutMs: 5000, pollMs: 10 });
    while (stored(f, cardId).waiter_until === null) await new Promise((resolve) => setTimeout(resolve, 5));
  }
  const result = await card.submitCard(cardId, {}, deps);
  assert.ok(result.outcome === "sent" || result.outcome === "unsent", JSON.stringify(result));
  const event = done ? await done : null;
  return { cardId, event };
}

/** A specification every sentence of which traces to the card, the facts or the shipped file. */
function good() {
  return {
    sentences: [
      { text: "The practitioner wants each list number set in its own column, with a hanging indent.", item: 1, cites: [{ card: "i1", quote: "their own column with hanging indents" }] },
      { text: "Connectors between list entries should stand on their own italic lines.", item: 2, cites: [{ card: "i2", quote: "on their own italic lines" }] },
      { text: "The fix must not use nested cards or boxes.", cites: [{ card: "c1", quote: "No nested cards or boxes." }] },
      { text: "The suggestion was sent from Claude Code, with version 0.9.14 of the lawyer plugin installed.", cites: [{ fact: "host", quote: "Code" }, { fact: "plugins[0].version", quote: "0.9.14" }] },
      { text: "Suggestions reach the practitioner only as a card shown as a file card.", cites: [{ file: SHIPPED, quote: "shown to the practitioner as a card, and only as a file card" }] },
    ],
  };
}

const ALL_SUPPORTED = (s) => ({ sentences: s.sentences.map((_, i) => ({ n: i + 1, supported: true })) });

// ------------------------------------------------------------- the verifier --

test("the citation verifier passes a specification whose every sentence traces, and rejects each kind of untraceable sentence", () => {
  const brief = {
    card_lines: [{ id: "p", kind: "pain point", text: INPUT.pain_point.text }, { id: "i1", kind: "item", text: INPUT.items[0].text }, { id: "i2", kind: "item", text: INPUT.items[1].text }, { id: "c1", kind: "constraint", text: "No nested cards or boxes." }],
    environment_facts: spec.factEntries(FACTS),
  };
  const reader = READER;
  const verify = (s) => spec.verifyCitations(spec.parseSpecification(s), brief, reader);
  assert.deepEqual(verify(good()), { passed: true, failures: [] });

  const one = (sentence) => {
    const s = good();
    s.sentences.push(sentence);
    return verify(s).failures;
  };
  assert.deepEqual(one({ text: "The fix also needs a new colour scheme for every page." }), [{ sentence: 6, problem: "no_citation" }]);
  assert.deepEqual(one({ text: "Item three asks for a summary.", cites: [{ card: "i3", quote: "a summary of the list" }] }), [{ sentence: 6, cite: 1, problem: "unknown_card_line" }]);
  assert.deepEqual(one({ text: "The host machine runs macOS.", cites: [{ fact: "os.hostname", quote: "macOS" }] }), [{ sentence: 6, cite: 1, problem: "unknown_fact" }]);
  assert.deepEqual(one({ text: "The card page has a print button.", cites: [{ file: "suggestion/references/print.md", quote: "a print button" }] }), [{ sentence: 6, cite: 1, problem: "unknown_file" }]);
  assert.deepEqual(one({ text: "The practitioner asked for larger type.", cites: [{ card: "i1", quote: "set the type larger" }] }), [{ sentence: 6, cite: 1, problem: "quote_not_found" }]);
  assert.deepEqual(one({ text: "Cards are emailed to the practitioner.", cites: [{ file: SHIPPED, quote: "emailed to the practitioner" }] }), [{ sentence: 6, cite: 1, problem: "quote_not_found" }]);
  assert.deepEqual(one({ text: "Version 0.9 is installed.", cites: [{ fact: "plugins[0].version", quote: "0.9" }] }), [{ sentence: 6, cite: 1, problem: "quote_not_found" }], "a fact's quote is its whole value");
  assert.deepEqual(one({ text: "It is about lists.", cites: [{ card: "i1", quote: "Put" }] }), [{ sentence: 6, cite: 1, problem: "quote_too_short" }]);
  assert.deepEqual(one({ text: "Two sources in one citation.", cites: [{ card: "i1", fact: "host", quote: "Code" }] }), [{ sentence: 6, cite: 1, problem: "citation_shape" }]);
  assert.throws(() => spec.parseSpecification("not json"), /not_a_specification/);
  assert.throws(() => spec.parseSpecification({ sentences: [] }), /not_a_specification/);
});

test("a shipped file counts only when it is an installed plugin's own file", { skip: process.platform !== "win32" && "the plugin's file read resolves paths the Windows way" }, async (t) => {
  const { f } = await device(t);
  const reader = spec.shippedReader(f.env, f.seams.installRoot);
  assert.equal(reader(SHIPPED), SHIPPED_TEXT);
  assert.equal(reader("matter-data/SKILL.md"), null, "a folder the install does not ship is not a shipped file");
  assert.equal(reader("../../plugin-data/suggestions/suggestions.json"), null, "the data folder is never a shipped file");
});

// ------------------------------------------------------------- the flow --

test("a waited-on card's write-up passes both halves of the backstop and follows the suggestion", async (t) => {
  const { f, deps, cloud } = await device(t);
  const { cardId, event } = await submitted(f, deps);
  assert.deepEqual(event, { event: "submitted", card_id: cardId, write_up: true });

  const brief = await spec.writeUpBrief(cardId, deps);
  assert.equal(brief.write, true);
  assert.deepEqual(brief.brief.card_lines.map((l) => l.id), ["p", "i1", "i2", "c1", "c2", "skill"]);
  assert.ok(brief.brief.environment_facts.some((e) => e.key === "plugins[0].version" && e.value === "0.9.14"));
  assert.deepEqual(await spec.writeUpBrief(cardId, deps), { write: false, reason: "already_written" }, "a write-up is written once");

  const s = good();
  const checked = await spec.checkWriteUp(cardId, JSON.stringify(s), deps);
  assert.equal(checked.verified, true);
  assert.equal(checked.backstop_input.sentences.length, 5);
  assert.deepEqual(checked.backstop_input.sentences[0].cites[0], { card: "i1", line_kind: "item", line: INPUT.items[0].text, quote: "their own column with hanging indents" });

  const sent = await spec.sendWriteUp(cardId, ALL_SUPPORTED(s), deps);
  assert.equal(sent.outcome, "sent");
  const calls = attachCalls(cloud);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].body.suggestion_id, ID);
  assert.deepEqual(Object.keys(calls[0].body).sort(), ["backstop_result", "specification", "suggestion_id"]);
  const sentSpec = JSON.parse(calls[0].body.specification);
  assert.equal(sentSpec.sentences.length, 5);
  assert.equal(calls[0].body.backstop_result.passed, true);
  assert.equal(calls[0].body.backstop_result.citations.passed, true);
  assert.equal(calls[0].body.backstop_result.judgement.passed, true);
  const record = read(f).records.find((r) => r.kind === "suggestion");
  assert.equal(record.write_up.state, "sent");
  assert.equal(record.specification, calls[0].body.specification, "the local record keeps what was sent");
  assert.deepEqual(record.backstop_result, calls[0].body.backstop_result);
});

test("a card submitted with no session waiting gets no write-up", async (t) => {
  const { f, deps, cloud } = await device(t);
  const { cardId } = await submitted(f, deps, { waited: false });
  assert.deepEqual(await spec.writeUpBrief(cardId, deps), { write: false, reason: "not_waited_on" });
  const record = read(f).records.find((r) => r.kind === "suggestion");
  assert.equal(record.write_up, undefined);
  assert.equal(attachCalls(cloud).length, 0);
});

test("a planted client token is removed without a prompt and logged in the local record, never as text", async (t) => {
  const { f, deps, cloud } = await device(t);
  const { cardId } = await submitted(f, deps);
  await spec.writeUpBrief(cardId, deps);
  const s = good();
  s.sentences.push({ text: "The list was for Quillfeather, and it was hard to read.", cites: [{ card: "p", quote: "hard to read in white on dark green" }] });
  assert.equal((await spec.checkWriteUp(cardId, s, deps)).verified, true, "the citations are real");
  const sent = await spec.sendWriteUp(cardId, ALL_SUPPORTED(s), deps);
  assert.equal(sent.outcome, "sent", "one sentence in six removed leaves it coherent; nobody is asked");
  const [call] = attachCalls(cloud);
  assert.ok(!call.raw.includes("Quillfeather"), "the token never leaves");
  assert.deepEqual(JSON.parse(call.body.specification).sentences.map((x) => x.n), [1, 2, 3, 4, 5]);
  assert.deepEqual(call.body.backstop_result.record_check, { ran: true, removed: [6], incoherent: null });
  const record = read(f).records.find((r) => r.kind === "suggestion");
  assert.deepEqual(record.write_up.removals, [{ sentence: 6, in: "sentence", kind: "record", sources: ["client"] }]);
  assert.ok(!readFileSync(f.store, "utf-8").includes("Quillfeather"), "the local record logs the removal, never the text");
});

test("a failed backstop judgement sends nothing after the suggestion, and the local record says why", async (t) => {
  const { f, deps, cloud } = await device(t);
  const { cardId } = await submitted(f, deps);
  await spec.writeUpBrief(cardId, deps);
  const s = good();
  assert.equal((await spec.checkWriteUp(cardId, s, deps)).verified, true);
  const judgement = ALL_SUPPORTED(s);
  judgement.sentences[2].supported = false;
  const sent = await spec.sendWriteUp(cardId, judgement, deps);
  assert.equal(sent.outcome, "stands_alone");
  assert.equal(attachCalls(cloud).length, 0, "zero calls to suggestion-attach-specification");
  assert.equal(cloud.calls.filter((c) => c.path === SUBMIT).length, 1, "the suggestion itself was sent at the click");
  const record = read(f).records.find((r) => r.kind === "suggestion");
  assert.equal(record.write_up.state, "stands_alone");
  assert.equal(record.write_up.reason, "backstop_failed");
  assert.equal(record.specification, null);
  assert.deepEqual(record.backstop_result.judgement, { judged: true, passed: false, unsupported: [3] });
  assert.equal(record.write_up.draft, undefined);

  // A judgement that leaves a sentence out fails as well.
  const two = await device(t);
  const second = await submitted(two.f, two.deps);
  await spec.writeUpBrief(second.cardId, two.deps);
  await spec.checkWriteUp(second.cardId, s, two.deps);
  assert.equal((await spec.sendWriteUp(second.cardId, { sentences: [{ n: 1, supported: true }] }, two.deps)).outcome, "stands_alone");
  assert.equal(attachCalls(two.cloud).length, 0);
});

test("a specification with a fact found nowhere fails the citation check and sends nothing", async (t) => {
  const { f, deps, cloud } = await device(t);
  const { cardId } = await submitted(f, deps);
  await spec.writeUpBrief(cardId, deps);
  const s = good();
  s.sentences.push({ text: "The firm uses a dark theme on every page.", cites: [{ card: "c1", quote: "a dark theme on every page" }] });
  assert.deepEqual(await spec.checkWriteUp(cardId, s, deps), { verified: false, card_id: cardId });
  await assert.rejects(spec.sendWriteUp(cardId, ALL_SUPPORTED(s), deps), /not at that step/);
  assert.equal(attachCalls(cloud).length, 0);
  const record = read(f).records.find((r) => r.kind === "suggestion");
  assert.equal(record.write_up.reason, "backstop_failed");
  assert.deepEqual(record.backstop_result.citations.failures, [{ sentence: 6, cite: 1, problem: "quote_not_found" }]);
});

test("a removal that leaves the specification incoherent sends nothing: a match in a quoted span, or more than a quarter removed", async (t) => {
  for (const [label, extra] of [
    ["in a quoted span", [{ text: "The skill file holds a test line.", cites: [{ file: SHIPPED, quote: "Vantressa appears here only for this test." }] }]],
    ["too much removed", [
      { text: "The list for Quillfeather was hard to read.", cites: [{ card: "p", quote: "hard to read in white on dark green" }] },
      { text: "Dremmond Okafor found the list hard to read.", cites: [{ card: "p", quote: "hard to read in white on dark green" }] },
    ]],
  ]) {
    const { f, deps, cloud } = await device(t);
    const { cardId } = await submitted(f, deps);
    await spec.writeUpBrief(cardId, deps);
    const s = good();
    s.sentences.push(...extra);
    assert.equal((await spec.checkWriteUp(cardId, s, deps)).verified, true, label);
    assert.equal((await spec.sendWriteUp(cardId, ALL_SUPPORTED(s), deps)).outcome, "stands_alone", label);
    assert.equal(attachCalls(cloud).length, 0, label);
    const record = read(f).records.find((r) => r.kind === "suggestion");
    assert.equal(record.write_up.reason, "incoherent", label);
    assert.equal(record.backstop_result.record_check.incoherent, label === "too much removed" ? "too_much_removed" : "removal_in_cited_span");
    assert.equal(record.specification, null, label);
  }
});

test("a write-up whose suggestion was not yet sent waits, and follows it when a server start sends it", async (t) => {
  let up = false;
  const { f, deps, cloud } = await device(t, (call) => (up ? OK(call) : [503, { error: "down" }]));
  const { cardId, event } = await submitted(f, deps);
  assert.equal(event.write_up, true);
  await spec.writeUpBrief(cardId, deps);
  const s = good();
  await spec.checkWriteUp(cardId, s, deps);
  assert.equal((await spec.sendWriteUp(cardId, ALL_SUPPORTED(s), deps)).outcome, "waiting");
  assert.equal(attachCalls(cloud).length, 0, "nothing follows a suggestion that is not sent");
  up = true;
  await retryUnsent(f.env, f.seams);
  const paths = cloud.calls.filter((c) => c.path === SUBMIT || c.path === ATTACH).map((c) => c.path);
  assert.deepEqual(paths.slice(-2), [SUBMIT, ATTACH], "the suggestion first, then its write-up");
  assert.equal(read(f).records.find((r) => r.kind === "suggestion").write_up.state, "sent");
});

// ------------------------------------------------------------- the page --

test("Past suggestions opens at a suggestion with its write-up shown and both safeguards explained", async (t) => {
  const { f, deps } = await device(t);
  const { cardId } = await submitted(f, deps);
  await spec.writeUpBrief(cardId, deps);
  const s = good();
  await spec.checkWriteUp(cardId, s, deps);
  await spec.sendWriteUp(cardId, ALL_SUPPORTED(s), deps);
  const recordId = read(f).records.find((r) => r.kind === "suggestion").record_id;
  const path = await page.writePastSuggestionsPage(f.env, { focus: recordId });
  const html = readFileSync(path, "utf-8");
  assert.ok(html.includes(`id="s-${recordId}"`));
  assert.ok(html.includes('<details class="write-up" open>'), "the write-up is shown");
  assert.ok(html.includes(`"focus":"s-${recordId}"`), "the page scrolls to it");
  for (const line of page.WRITE_UP_SAFEGUARDS) assert.ok(html.includes(line.replace(/'/g, "&#39;")), line);
  assert.ok(html.includes(page.WRITE_UP_NOTES.sent.replace(/'/g, "&#39;")));
  assert.ok(html.includes("Connectors between list entries should stand on their own italic lines."));
  assert.ok(html.includes("From your card") && html.includes("From the technical details") && html.includes("From Probanda&#39;s own files"));
  assert.ok(!html.includes(SHIPPED), "no file path is shown to the practitioner");
  const plain = await page.writePastSuggestionsPage(f.env);
  assert.ok(!readFileSync(plain, "utf-8").includes("<details class=\"write-up\" open>"), "without a suggestion named, the write-up stays behind its toggle");
  await assert.rejects(page.writePastSuggestionsPage(f.env, { focus: "no-such-record" }), /no suggestion/);
});
