// Suggestion 1cbe8467-808b-42a2-a03e-f76e15556dbe item 3: where the card's buttons cannot reach this
// computer, the link to the working card is a button in the note, before the hidden actions.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { stubCloud, suggestionDevice } from "./helpers/suggestion-fixture.mjs";

const card = await import("../build/suggestions/card.js");
const { loadStopWords } = await import("../build/suggestions/crosscheck.js");
const { loadPlaceholders } = await import("../build/suggestions/mockup.js");
const { RECORD_SOURCES } = await import("../build/suggestions/records.js");

const RECORDS = {
  texts: { client: ["Orrinvale Mercantile Ltd."], matter: ["Pellwick boundary claim"], contact: ["Tamsin Okonkwo-Frey"], folder_name: ["Pellwick v Darrow"], document_title: ["Affidavit of Ilse Brandvold"], file_name: ["Letter to Quorne.pdf"] },
  states: Object.fromEntries(RECORD_SOURCES.map((s) => [s, "read"])),
  firmName: "Ashgrove Teller LLP",
};
const FACTS = { plugins: [{ plugin: "lawyer", installed: true, version: "0.9.14" }], other_tools: 3, host: "Code", os: { platform: "linux", release: null, arch: "x64" } };
const INPUT = {
  origin: "practitioner",
  source: "user",
  skill: "show-me",
  pain_point: { text: "The table of dates for [matter] wrapped badly on a narrow window.", guess: false },
  items: [{ text: "Let the table scroll sideways instead of wrapping." }],
  context_lines: [{ kind: "constraint", text: "Keep the table on one page." }],
};

async function builtPage(t) {
  const f = suggestionDevice(t);
  const cloud = await stubCloud(t, () => [200, { suggestion_id: "5d2e8f10-3a4b-4c6d-8e9f-0a1b2c3d4e5f", items_saved: true, previews_saved: false, mockup_saved: false }]);
  f.env.SUPABASE_URL = cloud.url;
  const deps = { env: f.env, records: async () => RECORDS, stopWords: () => loadStopWords(process.env), placeholders: () => loadPlaceholders(process.env), seams: f.seams };
  const result = await card.buildCard(card.cardInput(structuredClone(INPUT)), structuredClone(FACTS), deps);
  assert.equal(result.built, true, JSON.stringify(result));
  return { result, body: readFileSync(result.card_path, "utf-8").replace(/<script[\s\S]*?<\/script>/g, "") };
}

test("the link to the working card is shown as a button, in the note before the actions", async (t) => {
  const { result, body } = await builtPage(t);
  const note = /<p [^>]*id="offline"[^>]*>([\s\S]*?)<\/p>/.exec(body);
  assert.ok(note && body.indexOf(note[0]) < body.indexOf('id="actions"'), "the note sits before the actions");
  const link = [...note[1].matchAll(/<a ([^>]*)>/g)].find((m) => (/href="([^"]+)"/.exec(m[1])?.[1] ?? "").replace(/&#38;/g, "&") === result.card_url);
  assert.ok(link, "the note links to card_url");
  assert.match(link[1], /class="[^"]*\bbutton\b/, "the link to the working card is styled as a button");
});
