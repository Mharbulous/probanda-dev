// BCCA respondent's factum renderer (#648; part contents research #647 §1, §5). A CA52140-shaped
// fixture populated per filing-checklists.md §12 renders every part in the court template's
// order, numbers paragraphs from Part 1 through Part 4 (not the Opening Statement), lists
// authorities alphabetically with their paragraphs, and flags the page limits for the human on
// the mockup only.

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import { assertMatchesGolden, replaceStamp } from "./fixtures/forms-render-seeds.mjs";
const { freshSubmissionDb } = await import("./helpers/template-db.mjs");
const { writePartiesOfRecord } = await import("./helpers/case-data-fixture.mjs");
const { assertFiledFaceClean } = await import("./helpers/filed-face-scan.mjs");
const { submissionDataExecute } = await import("../build/submission/backend.js");
const { submissionFormsRender } = await import("../build/submission/forms.js");
const { FACTUM_CASE_DATA, FACTUM_SEED } = await import("./fixtures/bcca-factum-seed.mjs");

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "coclerk-submission-factum-"));
  return { dbPath: join(dir, "submission.sqlite"), cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

async function renderFactum(extraSql = "", mode = "mockup") {
  const f = fixture();
  await freshSubmissionDb(f.dbPath);
  writePartiesOfRecord(dirname(f.dbPath), FACTUM_CASE_DATA);
  await submissionDataExecute(f.dbPath, FACTUM_SEED + extraSql);
  try {
    const result = submissionFormsRender(f.dbPath, 1, {}, mode);
    return { result, text: result.documents.find((d) => d.document_type === "Factum").markdown };
  } finally {
    f.cleanup();
  }
}

test("factum renders every part in the court template's order (issue #648)", async () => {
  const { result, text } = await renderFactum();
  assert.equal(result.documents.some((d) => d.document_type === "Written_arguments"), false, "no Written Arguments companion");
  const headings = [
    "## TABLE OF CONTENTS",
    "## CHRONOLOGY",
    "## OPENING STATEMENT",
    "## PART 1 - STATEMENT OF FACTS",
    "## PART 2 - ISSUES ON APPEAL",
    "## PART 3 - ARGUMENT",
    "## PART 4 - NATURE OF ORDER SOUGHT",
    "## APPENDICES: LIST OF AUTHORITIES",
    "## APPENDICES: ENACTMENTS",
  ];
  let last = text.indexOf("**COURT OF APPEAL**");
  assert.ok(last >= 0, "cover page first");
  for (const h of headings) {
    const at = text.indexOf(`\n${h}\n`);
    assert.ok(at > last, `${h} present and after the previous part`);
    last = at;
  }
  assert.ok(text.includes("RESPONDENTS' FACTUM"), "cover title for plural respondents");
  assert.ok(text.includes("ON APPEAL FROM the order of Madam Justice Trelawney"), "cover on-appeal-from line");
  assert.ok(text.includes("| June 29, 2026 | Order under appeal pronounced |"), "chronology row in the template's date style");
});

test("paragraph numbering: Opening Statement unnumbered, Parts 1-4 consecutive including the template's Part 4 lines", async () => {
  const { text } = await renderFactum();
  const opening = text.slice(text.indexOf("## OPENING STATEMENT"), text.indexOf("## PART 1"));
  assert.ok(opening.includes("This appeal concerns an arbitration stay."), "opening paragraph rendered");
  assert.doesNotMatch(opening, /^\d+\. /m, "opening statement carries no paragraph numbers");

  const parts = text.slice(text.indexOf("## PART 1"), text.indexOf("## APPENDICES: LIST OF AUTHORITIES"));
  const numbers = [...parts.matchAll(/^(\d+)\. /gm)].map((m) => Number(m[1]));
  assert.deepEqual(numbers, numbers.map((_, i) => i + 1), "one consecutive sequence from Part 1 to Part 4");
  assert.match(parts, /^1\. The respondents agree with the appellants' statement of facts/m, "Part 1 opens with the position on the appellants' facts");
  assert.match(parts, /^\d+\. The respondents seek an Order:$/m, "template's numbered order lead-in");
  assert.match(parts, /^that the appeal be dismissed, with costs to the respondents\./m, "order wording unnumbered");
  assert.match(parts, new RegExp(`^${numbers.at(-1)}\\. All of which is respectfully submitted\\.$`, "m"), "closing line is the last numbered paragraph");
  assert.ok(text.includes("Dated at the City of Vancouver, Province of British Columbia"), "place of signing");
  assert.ok(text.includes("Elena Marsh\nCounsel for the Respondents"), "name authorizing filing, no signature line");
});

test("authorities are alphabetical with paragraphs; enactments hold statutes; rules and leads are held back", async () => {
  const { text } = await renderFactum();
  const list = text.slice(text.indexOf("## APPENDICES: LIST OF AUTHORITIES"), text.indexOf("## APPENDICES: ENACTMENTS"));
  const rows = [...list.matchAll(/^\| ([^|]+) \| \(fills in Word\) \| ([\d, ]+) \|$/gm)].map((m) => m[1]);
  assert.deepEqual(rows, ["Arbitration Act, SBC 2020, c 2", "Court of Appeal Rules, BC Reg 120/2022", "Housen v Nikolaisen, 2002 SCC 33"]);
  assert.doesNotMatch(list, /Anonymous Lead/, "lead authority never listed");

  const housenPara = Number(/^(\d+)\. The standard of review on a question of law is correctness\./m.exec(text)[1]);
  assert.match(list, new RegExp(`Housen v Nikolaisen, 2002 SCC 33 \\| \\(fills in Word\\) \\| ${housenPara} \\|`), "para # is the paragraph the authority supports");

  const enactments = text.slice(text.indexOf("## APPENDICES: ENACTMENTS"));
  assert.ok(enactments.includes("**Arbitration Act**, SBC 2020, c 2"), "statute in the enactments appendix");
  assert.ok(enactments.includes("> 7 (1) If a party to an arbitration agreement"), "statute excerpt reproduced");
  assert.ok(enactments.includes("#### Court rules not in this appendix"), "rule held back for the practitioner");
});

test("page budget and unanswered points render on the mockup and never on the filed face", async () => {
  const { text } = await renderFactum();
  assert.ok(text.includes("## Page budget"), "page budget section");
  assert.match(text, /- Parts 1-4: \d+ words, about 1 page of the 30-page limit\./, "Parts 1-4 against the 30-page cap");
  assert.match(text, /- Opening Statement: \d+ words, about 1 page of the 1-page limit\./, "opening statement against its 1-page cap");
  assert.ok(text.includes("#### Points not yet answered"), "unanswered opposing point listed");
  assert.ok(text.includes("The judge ignored the evidence. ↩️"), "rebuttal marker on the unanswered point");

  const { text: filed } = await renderFactum("", "filed");
  assertFiledFaceClean(filed, "Factum.md");
  assert.doesNotMatch(filed, /Page budget|Points not yet answered|Court rules not in this appendix|↩️/, "mockup-only material stripped");
  assert.ok(filed.includes("## PART 4 - NATURE OF ORDER SOUGHT"), "parts survive the strip");
  // #805: nothing pinned this kind's delivered face. A mockup annotation written as plain prose
  // carries none of the mechanisms toFiledFace strips, so only a golden catches it reaching the
  // forum.
  assertMatchesGolden("factum-filed", replaceStamp(filed));
});

test("a long argument trips the 30-page flag without refusing", async () => {
  const long = "word ".repeat(9200).trim();
  const { text } = await renderFactum(`UPDATE submissions SET contention = '${long}' WHERE id = 2;`);
  assert.match(text, /- Parts 1-4: \d+ words, about \d+ pages of the 30-page limit\. \*\*Over the limit\*\*/, "over-limit flag");
});
