// The suggestion cross-check (docs/Plans/2026-10-25_suggestion-design.md, decisions 8 and 28), over
// invented records given directly: a planted client token is found in every part of the card and from
// every record source, a card of Probanda's own template words and common English passes, and the
// email, path, date and amount patterns are classified as decision 8 says. No Python: the records are
// handed in; suggestion-crosscheck.db.test.mjs reads them from real stores.

import assert from "node:assert/strict";
import test from "node:test";

const { buildTokenIndex, crossCheck, findPatterns, loadStopWords, runCrossCheck, tokens } = await import("../build/suggestions/crosscheck.js");
const { RECORD_SOURCES } = await import("../build/suggestions/records.js");

const STOP = loadStopWords(process.env);

// One invented, unmistakable token per record source, plus ordinary words each record also holds.
const RECORDS = {
  texts: {
    client: ["Quillfeather Holdings Ltd.", "C-7731"],
    matter: ["Vantressa estate dispute", "F-88214"],
    contact: ["Dremmond Okafor", "dokafor@example.org", "604-555-0142"],
    folder_name: ["L901 Ghostwillow v Brumbridge", "Pleadings/Halvorsend/*"],
    document_title: ["Affidavit of Cressida Pemberforth"],
    file_name: ["2024-03-01 Letter to Marchetti-Yovanovich.pdf"],
  },
  states: Object.fromEntries(RECORD_SOURCES.map((s) => [s, "read"])),
  firmName: "Lindqvist Harrow LLP",
};

const PLANTED = {
  client: "Quillfeather",
  matter: "vantressa",
  contact: "OKAFOR",
  folder_name: "Ghostwillow",
  document_title: "Pemberforth",
  file_name: "Yovanovich",
};

const span = (text, hit) => text.slice(hit.start, hit.end);

test("a planted record token is found in every part of the card, with its part, place and kind", () => {
  const index = buildTokenIndex(RECORDS, STOP);
  const card = {
    pain_point: "The list for Quillfeather was hard to read.",
    items: ["Put numbers in their own column.", "Show the Vantressa heading in bold."],
    context_lines: ["No nested boxes, as Okafor said."],
    comment: "Like the Ghostwillow page.",
    raw_observation: ["tool error class timeout", "seen while Pemberforth was open"],
    mockup: "<html><body><p>Placeholder list for Yovanovich</p></body></html>",
    environment_facts: { plugins: [{ plugin: "lawyer", installed: true, version: "0.9.14" }], other_tools: 7731, host: "Code" },
  };
  const hits = crossCheck(card, index);
  const byPart = (part) => hits.filter((h) => h.part === part);
  assert.deepEqual(hits.map((h) => h.part), ["pain_point", "items", "context_lines", "comment", "raw_observation", "mockup", "environment_facts"]);
  for (const h of hits) assert.equal(h.kind, "record");

  const [pain] = byPart("pain_point");
  assert.equal(span(card.pain_point, pain), "Quillfeather");
  assert.deepEqual(pain.sources, ["client"]);
  assert.deepEqual([pain.text, pain.offer, pain.action, pain.defect], ["readable", "remove_only", "prompt", false]);

  const [item] = byPart("items");
  assert.equal(item.index, 1);
  assert.equal(span(card.items[1], item), "Vantressa");
  const [line] = byPart("context_lines");
  assert.equal(span(card.context_lines[0], line), "Okafor");
  assert.equal(span(card.comment, byPart("comment")[0]), "Ghostwillow");

  const [obs] = byPart("raw_observation");
  assert.equal(obs.index, 1);
  assert.deepEqual([obs.text, obs.offer, obs.action, obs.defect], ["generated", null, "remove_line", true]);
  const [mock] = byPart("mockup");
  assert.deepEqual([mock.action, mock.defect], ["remove_mockup", true]);
  const [fact] = byPart("environment_facts");
  assert.deepEqual([fact.field, fact.action, fact.defect, fact.sources], ["other_tools", "remove_line", true, ["client"]]);
});

test("a planted token is found from each record source, named by that source", () => {
  const index = buildTokenIndex(RECORDS, STOP);
  for (const source of RECORD_SOURCES) {
    const text = `We saw ${PLANTED[source]} on the page.`;
    const hits = crossCheck({ pain_point: text }, index);
    assert.equal(hits.length, 1, `${source}: ${JSON.stringify(hits)}`);
    assert.deepEqual(hits[0].sources, [source]);
    assert.equal(span(text, hits[0]).toLowerCase(), PLANTED[source].toLowerCase());
  }
});

test("matching is whole-word and ignores case; short words and short numbers are never tokens", () => {
  const index = buildTokenIndex(
    { ...RECORDS, texts: { ...RECORDS.texts, client: ["Al Bo Quillfeather 123 4567"] } },
    STOP
  );
  assert.deepEqual(tokens("Al Bo 123 4567 Quillfeather").map((t) => t.key), ["4567", "quillfeather"]);
  assert.equal(index.has("al"), false);
  assert.equal(index.has("123"), false);
  assert.equal(crossCheck({ pain_point: "QUILLFEATHER" }, index).length, 1);
  assert.equal(crossCheck({ pain_point: "quillfeathers and Quillfeatherly" }, index).length, 0, "only whole words match");
  assert.equal(crossCheck({ pain_point: "Al and Bo, item 123" }, index).length, 0);
  assert.equal(crossCheck({ pain_point: "ref 4567 here" }, index).length, 1);
  assert.equal(crossCheck({ pain_point: "ref 45678 here" }, index).length, 0, "a number matches only whole");
});

test("the firm's own name and the stop lists are never tokens", () => {
  const index = buildTokenIndex(RECORDS, STOP);
  for (const word of ["Lindqvist", "Harrow", "Holdings", "estate", "Affidavit", "Letter", "Pleadings", "dispute"]) {
    assert.equal(crossCheck({ comment: word }, index).length, 0, word);
  }
});

test("a card holding only Probanda's template words and common English passes with no hit", () => {
  // Records that share many of the card's ordinary words, so only the stop lists keep them out.
  const records = {
    ...RECORDS,
    texts: {
      ...RECORDS.texts,
      client: [...RECORDS.texts.client, "Technical Software Account Services", "Past Status Review Group"],
      contact: [...RECORDS.texts.contact, "Person Document File", "Clients Matters People Files"],
      document_title: [...RECORDS.texts.document_title, "Letter about the date and amount"],
    },
  };
  const card = {
    // Decision 6's fixed strings and decision 27's bracket labels.
    pain_point: "Probanda noticed: You suggested: our guess, edit if wrong. The list for [client] was hard to read on [date] for [amount].",
    items: [
      "Put the numbers in their own column with a hanging indent. our guess, edit if wrong",
      "Show connectors like \"or alternatively\" on their own italic lines.",
      "Use black serif text on a light background for the [matter] and the [person].",
    ],
    context_lines: ["No nested cards or boxes: the first mockup was too graphical.", "Show a mockup of this", "Not like this, because the [document] and the [file] looked wrong."],
    comment: "Please don't name clients, matters, people or files.",
    raw_observation: [
      "Probanda receives this from your account: what you see here, a technical write-up of it, and technical details about the Probanda software on this computer.",
      "Show technical details",
      "You can see this later, with its status, under Past suggestions.",
      "Submit Suggestion Dismiss Restore Suggestion Sending... Submitted ✓ Not sent, will retry Not sent; Probanda could not be reached",
      "Submitted Under Review Approved Declined Implemented in lawyer 0.9.14 Withdrawn",
    ],
  };
  const result = runCrossCheck(card, records, STOP);
  assert.deepEqual(result.hits, []);
  assert.equal(result.passed, true);
  assert.equal(result.complete, true);
});

test("an email, a path, a date and an amount are each found and classified", () => {
  const index = buildTokenIndex(RECORDS, STOP);
  const cases = [
    ["Write to jane.doe@example.com today", "email", "jane.doe@example.com", "remove_only"],
    ["It opened D:\\Data\\Someone\\Desktop\\x.pdf here", "path", "D:\\Data\\Someone\\Desktop\\x.pdf", "remove_only"],
    ["It opened /home/someone/cases/x.pdf.", "path", "/home/someone/cases/x.pdf", "remove_only"],
    ["It opened \\\\server\\share\\x here", "path", "\\\\server\\share\\x", "remove_only"],
    ["See Folder\\Sub\\x.pdf now", "path", "Folder\\Sub\\x.pdf", "remove_only"],
    ["It was due 2026-03-04 then", "date", "2026-03-04", "remove_or_send_anyway"],
    ["It was due 4/3/2026 then", "date", "4/3/2026", "remove_or_send_anyway"],
    ["It was due March 4, 2026 then", "date", "March 4, 2026", "remove_or_send_anyway"],
    ["It was due 4 March 2026 then", "date", "4 March 2026", "remove_or_send_anyway"],
    ["It cost $1,250.00 then", "amount", "$1,250.00", "remove_or_send_anyway"],
    ["It cost 300 dollars then", "amount", "300 dollars", "remove_or_send_anyway"],
    ["It cost CAD 45 then", "amount", "CAD 45", "remove_or_send_anyway"],
    ["It cost 12,500 then", "amount", "12,500", "remove_or_send_anyway"],
  ];
  for (const [text, kind, matched, offer] of cases) {
    const hits = crossCheck({ pain_point: text }, index);
    assert.equal(hits.length, 1, `${text}: ${JSON.stringify(hits)}`);
    assert.equal(hits[0].kind, kind, text);
    assert.equal(span(text, hits[0]), matched, text);
    assert.equal(hits[0].offer, offer, text);
    assert.equal(hits[0].action, "prompt", text);
  }
  // In a generated part the same match removes its line, unasked, whatever its kind.
  const [fact] = crossCheck({ environment_facts: { note: "due 2026-03-04" } }, index);
  assert.deepEqual([fact.kind, fact.offer, fact.action, fact.defect], ["date", null, "remove_line", true]);
});

test("ordinary text is not a path, a date or an amount", () => {
  for (const text of [
    "Use and/or in the list",
    "<p>Placeholder</p></div>",
    "Version 0.9.14 and 0.10.7",
    "Approved (1 of 2) at 3 p.m.",
    "See https://example.com/docs/page",
    "git@github.com:owner/repo",
    "Items 1 to 12",
    "You may be right",
  ]) {
    assert.deepEqual(findPatterns(text), [], text);
  }
});

test("a hit carries no matched text", () => {
  const index = buildTokenIndex(RECORDS, STOP);
  const hits = crossCheck({ pain_point: "Quillfeather wrote from dokafor@example.org on 2024-03-01 about $1,200" }, index);
  assert.ok(hits.length >= 4);
  const serialized = JSON.stringify(hits);
  for (const secret of ["Quillfeather", "quillfeather", "dokafor", "2024-03-01", "1,200"]) assert.doesNotMatch(serialized, new RegExp(secret));
});

test("both tools are routed by the data server and validate their input", async () => {
  const { memoryKv, seedItems } = await import("./helpers/fake-cloud.mjs");
  const { PracticeStore } = await import("../build/practice/store.js");
  const { callTool } = await import("../build/dispatch.js");
  const kv = memoryKv();
  // A client and no matter: no case data to read, so no Python.
  seedItems(kv, [{ id: "c1", kind: "client", data: { name: "Quillfeather Holdings Ltd.", client_num: "C-7731" } }]);
  const store = new PracticeStore({ PATH: process.env.PATH }, kv);
  const context = { practiceDb: store };

  const result = await callTool(context, "suggestion_card__check", { pain_point: "Quillfeather again", items: ["fine"] });
  assert.deepEqual(result.hits.map((h) => [h.part, h.kind, h.sources]), [["pain_point", "record", ["client"]]]);
  assert.equal(result.records.client, "read");
  assert.equal(result.records.document_title, "none");
  await assert.rejects(callTool(context, "suggestion_card__check", { pain_point: 3 }));
  await assert.rejects(callTool(context, "suggestion_card__check", { surprise: "x" }));

  const facts = await callTool(context, "suggestion_card__environment_facts", { tool_names: ["mcp__plugin_lawyer_data__suggestion_card__check", "Read"] });
  assert.equal(facts.host, "Code");
  assert.equal(facts.other_tools, 1);
  assert.doesNotMatch(JSON.stringify(facts), /[\\/]/);
  const checked = await callTool(context, "suggestion_card__check", { environment_facts: facts });
  assert.deepEqual(checked.hits, [], "the environment facts pass the check");
});
