// #1243: the BCCA factum and stay-response renderers print whole-sentence work messages
// ("No chronology events recorded.", ...). The mockup keeps every one for the practitioner; the
// filed face drops the whole line, because dropping only the glyph delivers the sentence to the
// forum as prose (#811). Each state below is rendered both ways.
//
// The guard scan reads two renderers, listed by name. A glyph-led message added to any other
// renderer is not caught until that file joins the list. Deliberately not listed, because none
// prints a work message the mechanism owns: render-requisition.ts (order-template fragments
// interpolated mid-sentence, refused by template_key_gate_failed), projections.ts gap() (the
// general renderer, covered by MESSAGE_LINE_RES and unwritten_gate_failed), and
// the VanIAC submission renderers (their one message line is a MESSAGE_LINE_RES entry). The stay
// response's `NONE 🕵️` (Part 1, no documents) is not a message line: it strips to the true word NONE.

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import { STAY_RESPONSE_CASE_DATA, STAY_RESPONSE_SEED } from "./fixtures/bcca-stay-response-seed.mjs";
import { FACTUM_CASE_DATA, FACTUM_SEED } from "./fixtures/bcca-factum-seed.mjs";
const { freshSubmissionDb } = await import("./helpers/template-db.mjs");
const { writePartiesOfRecord } = await import("./helpers/matter-data-fixture.mjs");
const { assertFiledFaceDocumentsClean } = await import("./helpers/filed-face-scan.mjs");
const { submissionDataExecute } = await import("../build/submission/backend.js");
const { submissionFormsRender } = await import("../build/submission/forms.js");
const { inventoryCriterion } = await import("../build/submission/forms/goal-criteria.js");

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "coclerk-bcca-mockup-messages-"));
  const matter = join(dir, "L4801 Matter");
  mkdirSync(join(matter, "0. CASE DATA"), { recursive: true });
  mkdirSync(join(matter, "0. DRAFT"));
  return { dbPath: join(matter, "0. CASE DATA", "submission.sqlite"), cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

async function renderBoth(seed, documentType, caseData) {
  const f = fixture();
  try {
    await freshSubmissionDb(f.dbPath);
    writePartiesOfRecord(dirname(f.dbPath), caseData);
    await submissionDataExecute(f.dbPath, seed);
    const doc = submissionFormsRender(f.dbPath, 1, {}).documents.find((d) => d.document_type === documentType);
    const mockup = doc.markdown;
    // The mockup render's marker inventory, as its manifest saved it.
    const inventory = JSON.parse(readFileSync(join(dirname(dirname(doc.path)), "Drafting records", "render-manifest-1.json"), "utf-8")).inventory;
    const filedResult = submissionFormsRender(f.dbPath, 1, {}, "filed");
    assert.ok(filedResult.documents.length > 0, `filed render refused: ${filedResult.note}`);
    assertFiledFaceDocumentsClean(filedResult.documents);
    const filed = filedResult.documents.find((d) => d.document_type === documentType).markdown;
    return { mockup, filed, inventory };
  } finally {
    f.cleanup();
  }
}

function assertMockupKeepsFiledDrops(mockup, filed, glyph, sentence) {
  assert.ok(mockup.includes(`${glyph} ${sentence}`), `mockup keeps "${glyph} ${sentence}"`);
  assert.ok(!filed.includes(sentence), `filed face drops "${sentence}"`);
}

const FACTUM_EMPTY_SQL = `
DELETE FROM filing_chronology;
DELETE FROM filing_prose WHERE slot IN ('opening_statement', 'facts_position');
DELETE FROM filing_orders;
`;

test("factum: empty chronology, opening statement, facts position and order sought stay on the mockup, off the filed face", async () => {
  const { mockup, filed } = await renderBoth(FACTUM_SEED + FACTUM_EMPTY_SQL, "Factum", FACTUM_CASE_DATA);
  for (const sentence of [
    "No chronology events recorded.",
    "No opening statement recorded.",
    "No position on the appellants' statement of facts recorded.",
    "No order sought recorded. The order must include a costs disposition.",
  ]) {
    assertMockupKeepsFiledDrops(mockup, filed, "🧩", sentence);
  }
  assert.ok(filed.includes("## CHRONOLOGY"), "the heading survives; only the message line goes");
});

test("factum: no deployed submissions stays on the mockup, off the filed face", async () => {
  const { mockup, filed } = await renderBoth(FACTUM_SEED + "DELETE FROM filing_submissions;", "Factum", FACTUM_CASE_DATA);
  assertMockupKeepsFiledDrops(mockup, filed, "🧩", "No submissions deployed to this factum.");
});

test("factum: no issues on appeal stays on the mockup, off the filed face", async () => {
  const { mockup, filed } = await renderBoth(FACTUM_SEED + "DELETE FROM filing_prose WHERE slot = 'issues';", "Factum", FACTUM_CASE_DATA);
  assertMockupKeepsFiledDrops(mockup, filed, "🧩", "No issues on appeal recorded.");
});

test("factum: an issue naming no Part 3 argument, and an argument no issue names, stay on the mockup, off the filed face", async () => {
  const issues = "The respondents say there was no error.\n\nWas the test correct? <!-- arguments 1 -->\n\nIs a further question open?";
  const { mockup, filed } = await renderBoth(FACTUM_SEED + `UPDATE filing_prose SET text = '${issues}' WHERE slot = 'issues';`, "Factum", FACTUM_CASE_DATA);
  assertMockupKeepsFiledDrops(mockup, filed, "🧩", "This issue names no argument in Part 3.");
  assertMockupKeepsFiledDrops(mockup, filed, "🧩", "No issue in Part 2 names this argument.");
  const part2 = mockup.slice(mockup.indexOf("## PART 2"), mockup.indexOf("## PART 3"));
  assert.match(part2, /^\(a\) Was the test correct\? <!-- arguments 1 -->$/m, "the issue keeps its link on the mockup");
  assert.match(part2, /^\(b\) Is a further question open\?\n🧩 This issue names no argument in Part 3\./m, "the flag sits under the unlinked issue");
  const part3 = mockup.slice(mockup.indexOf("## PART 3"), mockup.indexOf("## PART 4"));
  assert.equal(part3.split("No issue in Part 2 names this argument.").length - 1, 1, "only argument 2 is unframed");
  assert.match(filed, /^\(a\) Was the test correct\?$/m, "the filed face drops the link comment");
  assert.doesNotMatch(filed, /<!-- arguments/, "no link comment reaches the forum");
});

test("factum: an enactment with no excerpt stays on the mockup, off the filed face", async () => {
  // The verified statement keeps 'verified' with no excerpt: the write snapshots the pair it leaves, as
  // the v47 verified write does, so the reopen trigger has no moved pair to reset.
  const { mockup, filed } = await renderBoth(
    FACTUM_SEED + "UPDATE statements_of_law SET excerpt = NULL, scrutinized_authority_id = authority_id, scrutinized_pinpoint = pinpoint, scrutinized_excerpt = NULL WHERE authority_id = 2;",
    "Factum",
    FACTUM_CASE_DATA
  );
  assertMockupKeepsFiledDrops(mockup, filed, "🧩", "No excerpt recorded for this enactment.");
});

test("factum: a facts-position paragraph restating a Part 1 fact carries 👯 on both, off the filed face", async () => {
  const position = "The respondents agree with the appellants'' statement of facts, except as set out below.\n\nThe supply agreement was signed by both parties on 3 March 2026 and contains an arbitration clause.";
  const sql = `
UPDATE filing_prose SET text = '${position}' WHERE slot = 'facts_position';
INSERT INTO facts (id, proceeding_id, postulate, court_record, court_record_pinpoint) VALUES
  (2, 1, 'The supply agreement, signed by both parties on 3 March 2026, contains an arbitration clause.', 20, 'Appeal Record, Vol. 1, p. 14');
INSERT INTO filing_facts (filing_id, fact_id, document, part, ordinal) VALUES (1, 2, 'form', 'part2', 2);
`;
  const { mockup, filed, inventory } = await renderBoth(FACTUM_SEED + sql, "Factum", FACTUM_CASE_DATA);
  assert.deepEqual(
    inventory.filter((e) => e.marker === "👯").map((e) => [e.generating, e.table, e.id, e.item, e.doc]),
    [
      [false, "filing_prose.facts_position", 2, "Part 1 para. 2: repeats para. 4", "Factum"],
      [false, "facts", 2, "Part 1 para. 4: repeats para. 2", "Factum"],
    ],
    "both paragraphs are recorded for the open-items count"
  );
  const part1 = mockup.slice(mockup.indexOf("## PART 1"), mockup.indexOf("## PART 2"));
  assert.match(part1, /^2\. The supply agreement was signed .* 👯 <!-- repeats para\. 4 -->$/m, "the position paragraph names the fact it repeats");
  assert.match(part1, /^4\. The supply agreement, signed .*👯.*<!-- repeats para\. 2 -->$/m, "the fact names the position paragraph that repeats it");
  assert.doesNotMatch(part1, /^[13]\. .*👯/m, "paragraphs that state nothing twice carry no 👯");
  assert.match(part1, /^3\. .*🧐/m, "an unapproved fact with nothing else owed asks for review");
  assert.doesNotMatch(part1, /^4\. .*🧐/m, "👯 is work on the line, so it holds 🧐 back");
  assert.doesNotMatch(filed, /👯|repeats para/, "the filed face carries neither the marker nor its comment");
});

test("factum: two facts-position paragraphs restating one fact each count once toward open-items", async () => {
  const position = "The supply agreement was signed by both parties on 3 March 2026 and contains an arbitration clause.\n\nThe respondents say the supply agreement, signed by both parties on 3 March 2026, contains an arbitration clause.";
  const sql = `
UPDATE filing_prose SET text = '${position}' WHERE slot = 'facts_position';
INSERT INTO facts (id, proceeding_id, postulate, court_record, court_record_pinpoint) VALUES
  (2, 1, 'The supply agreement, signed by both parties on 3 March 2026, contains an arbitration clause.', 20, 'Appeal Record, Vol. 1, p. 14');
INSERT INTO filing_facts (filing_id, fact_id, document, part, ordinal) VALUES (1, 2, 'form', 'part2', 2);
`;
  const { mockup, inventory } = await renderBoth(FACTUM_SEED + sql, "Factum", FACTUM_CASE_DATA);
  assert.match(mockup, /<!-- repeats paras\. 1, 2 -->/, "the fact names both position paragraphs");
  const counted = inventoryCriterion({ id: "open-items", text: "", members: (e) => e.marker === "👯" }, inventory, new Set(), new Set());
  assert.deepEqual(
    counted.items,
    ["Part 1 para. 1: repeats para. 4", "Part 1 para. 2: repeats para. 4", "Part 1 para. 4: repeats paras. 1, 2"],
    "each flagged paragraph is its own open item"
  );
});

test("stay response: no order sought, no positions and no opposing_authorities row stay on the mockup, off the filed face", async () => {
  const { mockup, filed } = await renderBoth(STAY_RESPONSE_SEED + "DELETE FROM filing_orders;", "Response_book", STAY_RESPONSE_CASE_DATA);
  assertMockupKeepsFiledDrops(mockup, filed, "🧩", "No order sought has been recorded for this response.");
  assertMockupKeepsFiledDrops(mockup, filed, "🕵️", "No position has been recorded on any order sought in the notice of application.");
  assertMockupKeepsFiledDrops(mockup, filed, "🕵️", "Opposing application book's table of authorities not yet transcribed");
  assert.doesNotMatch(filed, /may include authorities that must be excluded/, "the tail of the opposing-authorities sentence is gone too");
});

test("the BCCA renderers build no glyph-led message line outside mockupMessage", () => {
  for (const file of ["render-bcca-factum.ts", "render-bcca-stay-response.ts"]) {
    const source = readFileSync(new URL(`../src/submission/forms/${file}`, import.meta.url), "utf-8");
    const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    assert.ok(code.includes("mockupMessage("), `expected the scan to see ${file}'s own mockupMessage calls`);
    assert.doesNotMatch(
      code,
      /`\$\{(gapMarker|unpositionedOrderMarker)\(/,
      `${file}: a template literal that starts with a marker glyph is a message line the filed face would deliver; build it with mockupMessage`
    );
  }
});
