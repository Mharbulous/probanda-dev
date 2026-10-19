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
// render-vaniac-submissions.ts (its one message line is a MESSAGE_LINE_RES entry). The stay
// response's `NONE 🕵️` (Part 1, no documents) is not a message line: it strips to the true word NONE.

import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
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

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "coclerk-bcca-mockup-messages-"));
  return { dbPath: join(dir, "submission.sqlite"), cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

async function renderBoth(seed, documentType, caseData) {
  const f = fixture();
  try {
    await freshSubmissionDb(f.dbPath);
    writePartiesOfRecord(dirname(f.dbPath), caseData);
    await submissionDataExecute(f.dbPath, seed);
    const mockup = submissionFormsRender(f.dbPath, 1, {}).documents.find((d) => d.document_type === documentType).markdown;
    const filedResult = submissionFormsRender(f.dbPath, 1, {}, "filed");
    assert.ok(filedResult.documents.length > 0, `filed render refused: ${filedResult.note}`);
    assertFiledFaceDocumentsClean(filedResult.documents);
    const filed = filedResult.documents.find((d) => d.document_type === documentType).markdown;
    return { mockup, filed };
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
