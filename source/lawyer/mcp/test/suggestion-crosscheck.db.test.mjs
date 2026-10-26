// The suggestion cross-check reading this computer's own records (src/suggestions/records.ts): invented
// practice items, a firm profile, a folder map and a real matter-data database each hold one planted
// token, and the check through the data server's tool finds each in a card, named by its record
// source. A source that cannot be read is reported, never its error text.
//
// The runtime resolves /matter-data's scripts by Windows paths only (repo-root.ts), as the nightly
// suite runs on Windows. Off Windows the tests read case data through the same script, named by its
// POSIX path, and the one test through the data server's tool runs on Windows only.

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { memoryKv, seedItems } from "./helpers/fake-cloud.mjs";
import { writeCaseData } from "./helpers/matter-data-fixture.mjs";

const { PracticeStore } = await import("../build/practice/store.js");
const { callTool } = await import("../build/dispatch.js");
const { readRecordTexts } = await import("../build/suggestions/records.js");
const { listCaseRecordNames } = await import("../build/case/list-record-names.js");
const { loadStopWords, runCrossCheck } = await import("../build/suggestions/crosscheck.js");

const WINDOWS = process.platform === "win32";
const SCRIPTS = WINDOWS ? undefined : join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..", ".claude", "skills", "matter-data", "references", "scripts");
const seams = WINDOWS ? {} : { listNames: (folders, env) => listCaseRecordNames(folders, env, SCRIPTS) };
const STOP = loadStopWords(process.env);

const SEED = `
INSERT INTO proceedings (proceeding_id, court, file_number, style_of_cause)
VALUES (1, 'BCSC', 'S-245678', 'Ghostwillow v Brumbridge');
INSERT INTO parties (party_id, name, lawyer_name, lawyer_firm)
VALUES (1, 'Torvald Ashgrove', 'Y. Counsel', 'Lindqvist Harrow LLP');
INSERT INTO sources (source_id, category, title, file_path)
VALUES (1, 'court', 'Affidavit of Cressida Pemberforth', 'Pleadings/2024-03-01 Letter to Marchetti-Yovanovich.pdf');
`;

function device(t) {
  const dir = mkdtempSync(join(tmpdir(), "probanda-crosscheck-"));
  t.after(() => rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));
  const library = join(dir, "library");
  const root = join(library, "0. CASE DATA");
  const firm = join(root, "_practice", "firm");
  mkdirSync(join(firm, "folder-maps"), { recursive: true });
  writeFileSync(join(firm, "firm.json"), JSON.stringify({
    firm_name: "Lindqvist Harrow LLP",
    roster: [{ key: "bk", name: "B. Kay", designation: "", role: "lawyer", email: "bk@firm.example", direct_line: "", closing: "", initials: "BK", active: true }],
  }));
  writeFileSync(join(firm, "folder-maps", "bk.json"), JSON.stringify({ entries: [{ type: "correspondence_witness", folders: ["Halvorsend Letters/*"] }] }));
  const config = join(dir, "probanda.json");
  writeFileSync(config, JSON.stringify({ case_data_root: root, person: "bk" }));
  // The matter's own case data folder (ADR 0013), named for its matter number.
  const caseData = join(library, "L901 Orlavikson v Brumbridge", "0. CASE DATA");
  mkdirSync(caseData, { recursive: true });
  writeCaseData(caseData, SEED, ...(SCRIPTS ? [SCRIPTS] : []));
  const env = { ...process.env, COCLERK_CONFIG_PATH: config, COCLERK_CASE_DATA_ROOT: root };
  const kv = memoryKv();
  seedItems(kv, [
    { id: "c1", kind: "client", data: { name: "Quillfeather Holdings Ltd.", client_num: "C-7731" } },
    { id: "m1", kind: "matter", data: { description: "Vantressa estate", matt_num: "L901", file_number: "F-88214", folder: "Zephyrine Files" }, links: { client: "c1" } },
    { id: "p1", kind: "contact", data: { name: "Dremmond Okafor", emails: ["dokafor@example.org"], phones: [], addresses: [{ street: "12 Wrenfield Road" }], other_names: [] }, tags: { entity: "person" } },
  ]);
  return { store: new PracticeStore(env, kv), env };
}

test("each record source is read, and a planted token from each is found in the card", async (t) => {
  const { store, env } = device(t);
  const records = await readRecordTexts(store, env, seams);
  assert.deepEqual(records.states, {
    client: "read", matter: "read", contact: "read", folder_name: "read", document_title: "read", file_name: "read",
  });
  assert.equal(records.firmName, "Lindqvist Harrow LLP");

  const planted = {
    client: "Quillfeather",
    matter: "Vantressa",
    contact: "Okafor",
    folder_name: "Halvorsend",
    document_title: "Pemberforth",
    file_name: "Yovanovich",
  };
  // Case data adds to three sources: the court file number to matter, a party to contact, and the
  // case data folder's name to folder_name.
  const fromCaseData = { matter: "245678", contact: "Ashgrove", folder_name: "Orlavikson" };
  const alsoFolder = "Zephyrine";
  const alsoAddress = "Wrenfield";

  for (const [source, word] of [...Object.entries(planted), ...Object.entries(fromCaseData), ["folder_name", alsoFolder], ["contact", alsoAddress]]) {
    const result = runCrossCheck({ comment: `It happened near ${word} again.` }, records, STOP);
    assert.equal(result.passed, false, word);
    assert.equal(result.hits.length, 1, `${word}: ${JSON.stringify(result.hits)}`);
    assert.deepEqual(result.hits[0].sources, [source], word);
    assert.equal(result.complete, true);
  }

  // The firm's own name, the generic words and the parts of the matter number are never tokens.
  const clean = runCrossCheck({
    pain_point: "Lindqvist Harrow letters about the estate and the affidavit were hard to read.",
    items: ["Show each holding in its own row."],
  }, records, STOP);
  assert.deepEqual(clean.hits, []);
  assert.equal(clean.passed, true);
});

test("the planted token is found in every part, and the result carries no record text", async (t) => {
  const { store, env } = device(t);
  const records = await readRecordTexts(store, env, seams);
  const card = {
    pain_point: "Quillfeather",
    items: ["Vantressa"],
    context_lines: ["Okafor"],
    comment: "Halvorsend",
    raw_observation: ["Pemberforth"],
    mockup: "<p>Yovanovich</p>",
    environment_facts: { note: "Ashgrove" },
  };
  const result = runCrossCheck(card, records, STOP);
  assert.deepEqual(result.hits.map((h) => [h.part, h.action]), [
    ["pain_point", "prompt"], ["items", "prompt"], ["context_lines", "prompt"], ["comment", "prompt"],
    ["raw_observation", "remove_line"], ["mockup", "remove_mockup"], ["environment_facts", "remove_line"],
  ]);
  const serialized = JSON.stringify(result);
  for (const word of Object.values(card).flat().map(String)) {
    if (!word.startsWith("[object")) assert.ok(!serialized.includes(word.replace(/<\/?p>/g, "")), `result holds ${word}`);
  }
  assert.ok(!serialized.includes("Ashgrove"));
});

test("a source that cannot be read is reported by its state only", async (t) => {
  const { store, env } = device(t);
  const broken = { ...env, COCLERK_CASE_DATA_ROOT: join(tmpdir(), "no-such-case-data-root"), COCLERK_CONFIG_PATH: join(tmpdir(), "no-such-probanda.json") };
  const records = await readRecordTexts(new PracticeStore(broken, store["kv"]), broken, {
    matterFolders: (_s, _m, miss) => {
      miss(null);
      return [];
    },
  });
  assert.equal(records.states.client, "read");
  assert.equal(records.states.document_title, "unavailable");
  assert.equal(records.states.folder_name, "partial");
  assert.equal(records.firmName, null);
});

test("the data server's tool reads every source itself", { skip: WINDOWS ? false : "the runtime resolves case data scripts by Windows paths only" }, async (t) => {
  const { store } = device(t);
  for (const word of ["Quillfeather", "Halvorsend", "Pemberforth", "Yovanovich", "Ashgrove"]) {
    const result = await callTool({ practiceDb: store }, "suggestion_card__check", { comment: `near ${word}` });
    assert.equal(result.hits.length, 1, word);
    assert.equal(result.complete, true);
  }
  const clean = await callTool({ practiceDb: store }, "suggestion_card__check", { comment: "Lindqvist Harrow letters were hard to read." });
  assert.equal(clean.passed, true);
});
