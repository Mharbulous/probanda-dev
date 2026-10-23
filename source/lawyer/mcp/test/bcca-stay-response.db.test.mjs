// BCCA stay-application Response Book renderer (#436, research #433).
// Mirrors skill-population.db.test.mjs's checklist-only discipline for the new
// kind: a CA52140-shaped fixture populated per filing-checklists.md §10
// renders clean (every listed field filled, submission facts linked), and a
// served order left unpositioned fires the existing ⬜ instance exactly as
// on the BCSC Application Response.

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import { assertMatchesGolden, replaceStamp } from "./fixtures/forms-render-seeds.mjs";
import { STAY_RESPONSE_CASE_DATA, STAY_RESPONSE_SEED as SEED, STAY_RESPONSE_POSITIONS } from "./fixtures/bcca-stay-response-seed.mjs";
const { freshSubmissionDb } = await import("./helpers/template-db.mjs");
const { writePartiesOfRecord } = await import("./helpers/matter-data-fixture.mjs");
const { assertFiledFaceDocumentsClean } = await import("./helpers/filed-face-scan.mjs");
const { submissionDataExecute } = await import("../build/submission/backend.js");
const { submissionFormsEmitBccaBook, submissionFormsRender } = await import("../build/submission/forms.js");

const ALL_MARKER_GLYPHS = ["🧩", "🏷️", "🕵️", "⬜", "🏛️", "📖", "🔬", "📜", "📑", "💬", "📍", "📌", "🧷", "📇", "👤", "🗣️", "✍️", "🖋️", "✒️", "🚧", "⚠️", "🚨", "⛔", "🕰️", "🂡", "🤥", "🚩", "🦵", "👃", "↩️", "🧵", "🧾", "🥈", "🥉", "🏅"];

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "coclerk-submission-bcca-"));
  const matter = join(dir, "L4801 Matter");
  mkdirSync(join(matter, "0. CASE DATA"), { recursive: true });
  mkdirSync(join(matter, "0. DRAFT"));
  return { dbPath: join(matter, "0. CASE DATA", "submission.sqlite"), cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

test("BCCA stay response renders clean from checklist-only population (issue #436, checklist §10)", async () => {
  const f = fixture();
  try {
    await freshSubmissionDb(f.dbPath);
    writePartiesOfRecord(dirname(f.dbPath), STAY_RESPONSE_CASE_DATA);
    await submissionDataExecute(
      f.dbPath,
      SEED +
        STAY_RESPONSE_POSITIONS +
        `
INSERT INTO opposing_authorities (id, proceeding_id, document_id, ordinal, style_of_cause_or_title, citation, authority_id) VALUES
  (1, 1, 10, 1, 'Hawthorn v. Hawrish', '2023 BCCA 182', NULL);
`
    );
    const result = submissionFormsRender(f.dbPath, 1, {});
    const book = result.documents.find((d) => d.document_type === "Response_book");
    assert.ok(book, "Response_book document rendered");
    const text = book.markdown;
    assert.ok(text.includes("**COURT OF APPEAL**"), "BCCA cover page title per tpl_ca_book_cover_page.dotx");
    assert.ok(text.includes("Court of Appeal File No. CA52140"), "file number");
    // The returned markdown withholds the hearing date and time (ADR 0013); the file keeps them.
    assert.ok(readFileSync(book.path, "utf-8").includes("returnable 2026-09-04 at 10:00 am"), "hearing date from hearing_details");
    // No response-book template carries a time-estimate sentence, and the mockup keeps only template sentences.
    assert.doesNotMatch(text, /estimate/i, "no time-estimate line, even with time_estimate_minutes seeded");
    // Cover page (schema v13 compliance fix): "ON APPEAL FROM" line, sourced from proceedings.under_appeal_*.
    assert.ok(
      text.includes("ON APPEAL FROM the order of Madam Justice Trelawney of the Supreme Court of British Columbia pronounced on 2026-06-29"),
      "outer cover ON APPEAL FROM line"
    );
    // Cover page's counsel contact table.
    assert.ok(text.includes("Caldwell, Fenn & Roe LLP"), "appellants' counsel firm on cover contact table");
    assert.ok(text.includes("Beacon Law"), "respondents' counsel firm on cover contact table");
    assert.ok(text.includes("ikerr@cfr-law.ca"), "appellants' counsel email on cover contact table");
    assert.ok(text.includes("emarsh@beaconlaw.ca"), "respondents' counsel email on cover contact table");
    // Table of contents (e-CI §1.2, unconditional).
    assert.ok(text.includes("## TABLE OF CONTENTS"), "table of contents section");
    assert.ok(text.includes("Affidavit #1 of Adrian Renwick, filed 2026-08-30"), "TOC affidavit row with deponent and filed date");
    // Multi-party boilerplate -- 2 appellants, 3 respondents, matching CA52140's real parties.
    assert.ok(
      text.includes("Response of: the Respondents, Merrow Clothing Manufacturers Ltd., Adrian Renwick, and Jonah Renwick"),
      "multi-party 'Response of:' names all three respondents"
    );
    assert.ok(
      text.includes("THIS IS A RESPONSE TO the stay application of the Appellants, Tidewater Outfitters Inc. and Kestrel Collective Inc.,"),
      "multi-party 'THIS IS A RESPONSE TO' names both appellants"
    );
    assert.ok(text.includes("PART 2: WRITTEN ARGUMENT"), "written argument part");
    // Written argument's own required cover page (e-CI §2.1), positioned before its Statement of Facts.
    assert.ok(
      text.includes("WRITTEN ARGUMENT OF THE RESPONDENTS ON A STAY APPLICATION"),
      "written argument's own cover page title, pluralized"
    );
    assert.ok(
      text.indexOf("WRITTEN ARGUMENT OF THE RESPONDENTS ON A STAY APPLICATION") < text.indexOf("### Part 1: Statement of Facts"),
      "written argument cover page appears before its Statement of Facts"
    );
    assert.ok(text.includes("Whether the order sought in paragraph 1"), "issues derived from opposed orders");
    assert.ok(text.includes("RJR-MacDonald"), "table of authorities retains an authority not in the application book");
    assert.ok(text.includes("Prepared by: Elena Marsh"), "preparer line");
    // No separate Written Arguments companion for this kind -- the book IS the argument.
    assert.equal(
      result.documents.some((d) => d.document_type === "Written_arguments"),
      false,
      "no separate Written Arguments companion"
    );
    const found = ALL_MARKER_GLYPHS.filter((g) => text.includes(g));
    assert.deepEqual(found, [], `should render with no work markers, found: ${found.join(" ")}\n---\n${text}`);

    // #805: nothing pinned this kind's delivered face. A mockup annotation written as plain prose
    // carries none of the mechanisms toFiledFace strips, so only a golden catches it reaching the
    // forum.
    const filed = submissionFormsRender(f.dbPath, 1, {}, "filed");
    assertFiledFaceDocumentsClean(filed.documents);
    const filedBook = filed.documents.find((d) => d.document_type === "Response_book");
    assert.ok(filedBook, "expected a Response_book document in filed mode");
    assertMatchesGolden("response-book-filed", replaceStamp(filedBook.markdown));
  } finally {
    f.cleanup();
  }
});

test("BCCA stay response Part 3 excludes an authority already in the application book, retains one that isn't", async () => {
  const f = fixture();
  try {
    await freshSubmissionDb(f.dbPath);
    writePartiesOfRecord(dirname(f.dbPath), STAY_RESPONSE_CASE_DATA);
    await submissionDataExecute(
      f.dbPath,
      SEED +
        `
INSERT INTO filing_positions (id, filing_id, opposing_order_id, position) VALUES
  (1, 1, 1, 'opposed'),
  (2, 1, 2, 'opposed');
INSERT INTO authorities (id, proceeding_id, style_of_cause_or_title, citation, kind, treatment, weight)
  VALUES (2, 1, 'Hawthorn v. Hawrish', '2023 BCCA 182', 'case', 'good_law', 'binding');
INSERT INTO law_assertions (id, proceeding_id, proposition) VALUES (2, 1, 'Attornment does not extend to a separate arbitral proceeding.');
INSERT INTO submission_law (submission_id, law_assertion_id) VALUES (1, 2);
INSERT INTO statements_of_law (id, proceeding_id, law_assertion_id, authority_id, pinpoint, excerpt, source, verification)
  VALUES (2, 1, 2, 2, 'at para 34', 'attornment doctrine', 'primary', 'verified');
INSERT INTO opposing_authorities (id, proceeding_id, document_id, ordinal, style_of_cause_or_title, citation, authority_id) VALUES
  (1, 1, 10, 1, 'Hawthorn v. Hawrish', '2023 BCCA 182', 2);
`
    );
    const result = submissionFormsRender(f.dbPath, 1, {});
    const text = result.documents.find((d) => d.document_type === "Response_book").markdown;
    const toaStart = text.indexOf("## PART 3: TABLE OF AUTHORITIES (OPTIONAL)");
    assert.ok(toaStart !== -1, "Part 3 table-of-authorities heading present");
    const toaSection = text.slice(toaStart);
    assert.ok(text.includes("RJR-MacDonald"), "authority not in the application book is retained");
    assert.ok(
      text.slice(0, toaStart).includes("Hawthorn v. Hawrish"),
      "authority already in the application book is still cited in the written argument body"
    );
    assert.ok(
      !toaSection.includes("Hawthorn v. Hawrish"),
      "authority already in the application book is excluded from Part 3's standalone table (delta rule)"
    );
  } finally {
    f.cleanup();
  }
});

test("BCCA stay response Part 3 fires the unverified-delta marker when no opposing_authorities rows exist yet", async () => {
  const f = fixture();
  try {
    await freshSubmissionDb(f.dbPath);
    writePartiesOfRecord(dirname(f.dbPath), STAY_RESPONSE_CASE_DATA);
    await submissionDataExecute(
      f.dbPath,
      SEED +
        `
INSERT INTO filing_positions (id, filing_id, opposing_order_id, position) VALUES
  (1, 1, 1, 'opposed'),
  (2, 1, 2, 'opposed');
`
    );
    const result = submissionFormsRender(f.dbPath, 1, {});
    const text = result.documents.find((d) => d.document_type === "Response_book").markdown;
    assert.ok(text.includes("RJR-MacDonald"), "cited authority still listed while the delta is unverified");
    assert.ok(text.includes("🕵️"), "unverified-delta question marker fires");
    assert.ok(text.includes("not yet transcribed"), "unverified-delta note explains why");
  } finally {
    f.cleanup();
  }
});

test("BCCA stay response Part 3 dedupes a law assertion shared by two submissions (ticket 2026-09-01)", async () => {
  const f = fixture();
  try {
    await freshSubmissionDb(f.dbPath);
    writePartiesOfRecord(dirname(f.dbPath), STAY_RESPONSE_CASE_DATA);
    await submissionDataExecute(
      f.dbPath,
      SEED +
        `
INSERT INTO filing_positions (id, filing_id, opposing_order_id, position) VALUES
  (1, 1, 1, 'opposed'),
  (2, 1, 2, 'opposed');
INSERT INTO submissions (id, proceeding_id, contention, ordinal) VALUES
  (2, 1, 'The same tripartite test forecloses a stay on this record too.', 2);
INSERT INTO filing_submissions (id, filing_id, submission_id, document, ordinal) VALUES (2, 1, 2, 'form', 2);
INSERT INTO submission_law (submission_id, law_assertion_id) VALUES (2, 1);
`
    );
    const result = submissionFormsRender(f.dbPath, 1, {});
    const text = result.documents.find((d) => d.document_type === "Response_book").markdown;
    const propositionText = "A stay requires a serious question, irreparable harm, and a favourable balance of convenience.";
    const propositionOccurrences = text.split(propositionText).length - 1;
    assert.equal(propositionOccurrences, 2, "a shared law assertion renders in full once and once more inside its cross-reference paragraph");
    const crossRef = text.match(/^(\d+)\. As set out in paragraph (\d+), above, /m);
    assert.ok(crossRef, "the repeat renders as a numbered 'As set out in paragraph N, above' cross-reference paragraph");
    const fullRender = text.match(new RegExp(`^(\\d+)\\. ${propositionText.slice(0, 20)}`, "m"));
    assert.ok(fullRender, "the first occurrence renders as its own numbered paragraph");
    assert.equal(Number(crossRef[2]), Number(fullRender[1]), "the cross-reference cites the full render's own paragraph number");
    const excerptOccurrences = text.split("<!-- statement_of_law_id").length - 1;
    assert.equal(excerptOccurrences, 1, "the excerpt-and-citation block renders only under the first occurrence, never under the cross-reference");
    const traceOccurrences = text.split("<!-- law_assertion_id 1 -->").length - 1;
    assert.equal(traceOccurrences, 2, "both occurrences carry the assertion's id-trace comment");
    assert.ok(
      text.includes("<!-- submission_id 2 -->"),
      "the second submission still traces even though its only law assertion was already rendered under the first"
    );
    // Paragraph numbers run consecutively with no gaps or duplicates across the written argument
    // (the Table of Authorities' own restarted 1./2./3. list is a separate list, sliced out).
    const argumentSection = text.slice(text.indexOf("### Part 1: Statement of Facts"), text.indexOf("## PART 3: TABLE OF AUTHORITIES"));
    const paraNums = [...argumentSection.matchAll(/^(\d+)\. /gm)].map((m) => Number(m[1]));
    assert.ok(paraNums.length > 1, "sanity: multiple numbered paragraphs found");
    for (let i = 1; i < paraNums.length; i++) {
      assert.equal(paraNums[i], paraNums[i - 1] + 1, `paragraph numbering has a gap or duplicate: ...${paraNums[i - 1]}, ${paraNums[i]}...`);
    }
  } finally {
    f.cleanup();
  }
});

test("BCCA stay response renders bracketed lower-court-role lines on both covers when every party in a group agrees (schema v14)", async () => {
  const f = fixture();
  try {
    await freshSubmissionDb(f.dbPath);
    writePartiesOfRecord(dirname(f.dbPath), STAY_RESPONSE_CASE_DATA);
    await submissionDataExecute(
      f.dbPath,
      SEED +
        `
INSERT INTO filing_positions (id, filing_id, opposing_order_id, position) VALUES
  (1, 1, 1, 'opposed'),
  (2, 1, 2, 'opposed');
UPDATE parties SET lower_court_role = 'Defendants' WHERE id IN (1, 2);
UPDATE parties SET lower_court_role = 'Plaintiffs' WHERE id IN (3, 4, 5);
`
    );
    const result = submissionFormsRender(f.dbPath, 1, {});
    const text = result.documents.find((d) => d.document_type === "Response_book").markdown;
    const occurrences = (needle) => text.split(needle).length - 1;
    assert.equal(occurrences("*Defendants*"), 2, "appellants' lower-court role appears once per cover (outer + written argument)");
    assert.equal(occurrences("*Plaintiffs*"), 2, "respondents' lower-court role appears once per cover (outer + written argument)");
  } finally {
    f.cleanup();
  }
});

test("BCCA stay response omits the lower-court-role line for a group whose parties disagree or have none set", async () => {
  const f = fixture();
  try {
    await freshSubmissionDb(f.dbPath);
    writePartiesOfRecord(dirname(f.dbPath), STAY_RESPONSE_CASE_DATA);
    await submissionDataExecute(
      f.dbPath,
      SEED +
        `
INSERT INTO filing_positions (id, filing_id, opposing_order_id, position) VALUES
  (1, 1, 1, 'opposed'),
  (2, 1, 2, 'opposed');
UPDATE parties SET lower_court_role = 'Plaintiffs' WHERE id = 3;
`
    );
    // Respondents disagree (only party 3 set, 4 and 5 left NULL); appellants have none set at
    // all -- both cases omit the line rather than guessing or concatenating.
    const result = submissionFormsRender(f.dbPath, 1, {});
    const text = result.documents.find((d) => d.document_type === "Response_book").markdown;
    assert.ok(!text.includes("*Plaintiffs*"), "no line rendered where a group's parties disagree");
    assert.ok(!text.includes("*Defendants*"), "no line rendered where a group has no value set");
  } finally {
    f.cleanup();
  }
});

test("BCCA stay response fires ⬜ on a served order with no position", async () => {
  const f = fixture();
  try {
    await freshSubmissionDb(f.dbPath);
    writePartiesOfRecord(dirname(f.dbPath), STAY_RESPONSE_CASE_DATA);
    await submissionDataExecute(
      f.dbPath,
      SEED +
        `
INSERT INTO filing_positions (id, filing_id, opposing_order_id, position) VALUES (1, 1, 1, 'opposed');
`
    );
    const result = submissionFormsRender(f.dbPath, 1, {});
    const text = result.documents.find((d) => d.document_type === "Response_book").markdown;
    assert.ok(text.includes("Positions not yet taken"), "unpositioned section renders");
    assert.ok(text.includes("⬜"), "existing unpositioned-order instance fires");
    assert.ok(text.includes("extending the interim stay"), "the unpositioned order is listed");

    // filed-face regression (filed-face.ts stripSections is now level-aware): this renderer
    // emits "Positions not yet taken" as #### (nested under "### Part 2: Issues"), which the
    // old level-2-only strip would miss entirely, leaking mockup-only content into the filed face.
    const filed = submissionFormsRender(f.dbPath, 1, {}, "filed");
    assertFiledFaceDocumentsClean(filed.documents);
    const filedText = filed.documents.find((d) => d.document_type === "Response_book").markdown;
    assert.ok(!filedText.includes("Positions not yet taken"), "mockup-only section absent from the filed face");
    assert.ok(!filedText.includes("extending the interim stay"), "the unpositioned order itself is absent from the filed face");
    assert.ok(!filedText.includes("⬜"), "no marker glyph reaches the filed face");
  } finally {
    f.cleanup();
  }
});

// ADR 0013 (deadline isolation): the response book's "returnable <date> at <time>" sentence is
// withheld from the returned markdown, each value on its own; the file and the copy keep both.
test("render withholds the response book's hearing date and time from the response, never from the file or the copy", async () => {
  const f = fixture();
  try {
    await freshSubmissionDb(f.dbPath);
    writePartiesOfRecord(dirname(f.dbPath), STAY_RESPONSE_CASE_DATA);
    await submissionDataExecute(f.dbPath, SEED);
    const draft = join(dirname(dirname(f.dbPath)), "0. DRAFT");
    const leaf = join(draft, "Stay Application Response");

    const result = submissionFormsRender(f.dbPath, 1, {}, "mockup", ["Response_book"], undefined, leaf);
    const book = result.documents.find((d) => d.document_type === "Response_book");

    const withheld = "[withheld from drafting context]";
    assert.ok(book.markdown.includes(`returnable ${withheld} at ${withheld}.`));
    assert.ok(!book.markdown.includes("2026-09-04"), "the hearing date never crosses the tool boundary");
    assert.ok(!book.markdown.includes("10:00 am"), "nor the hearing time");
    const file = readFileSync(book.path, "utf-8");
    assert.ok(file.includes("returnable 2026-09-04 at 10:00 am."), "the canonical mockup keeps both");
    assert.equal(dirname(book.path), leaf, "the mockup is the file in the Writing's folder");
    assert.equal(book.markdown_chars, file.length, "measured before withholding");
  } finally {
    f.cleanup();
  }
});

// #842: an overruled authority's statements ride the brief-only cap, so Part 3's table of
// authorities must not name one -- fetchCitedAuthorities would otherwise list an authority the
// response book never cites, and emit-bcca-book.ts reuses the same query for the response book's
// boa_toc. Authority 2 is overruled but NOT killed: killed_on stays NULL, so only the treatment
// clause can drop it. RJR-MacDonald, the seed's live authority, is the guard against a filter
// that empties the table.
test("#842: an overruled authority is absent from the BCCA stay response's Part 3 table of authorities", async () => {
  const f = fixture();
  try {
    await freshSubmissionDb(f.dbPath);
    writePartiesOfRecord(dirname(f.dbPath), STAY_RESPONSE_CASE_DATA);
    await submissionDataExecute(
      f.dbPath,
      SEED +
        STAY_RESPONSE_POSITIONS +
        `
INSERT INTO authorities (id, proceeding_id, style_of_cause_or_title, citation, kind, treatment, weight)
  VALUES (2, 1, 'Ashford v. Pell Holdings Ltd.', '1998 BCCA 404', 'case', 'overruled', 'binding');
INSERT INTO law_assertions (id, proceeding_id, proposition) VALUES (2, 1, 'Irreparable harm is presumed where an arbitration is stayed.');
INSERT INTO submission_law (submission_id, law_assertion_id) VALUES (1, 2);
INSERT INTO statements_of_law (id, proceeding_id, law_assertion_id, authority_id, pinpoint, excerpt, source, verification)
  VALUES (2, 1, 2, 2, 'at para 41', 'a stayed arbitration is irreparable harm without more', 'primary', 'verified');
`
    );
    const result = submissionFormsRender(f.dbPath, 1, {});
    const text = result.documents.find((d) => d.document_type === "Response_book").markdown;

    const toaStart = text.indexOf("## PART 3: TABLE OF AUTHORITIES (OPTIONAL)");
    assert.ok(toaStart !== -1, "Part 3 table-of-authorities heading present");
    const toaSection = text.slice(toaStart);
    assert.equal(toaSection.includes("Ashford v. Pell Holdings Ltd."), false, "expected the overruled authority off Part 3's table");
    assert.equal(toaSection.includes("1998 BCCA 404"), false, "expected its citation off Part 3's table too");
    assert.ok(toaSection.includes("RJR-MacDonald"), "expected the live cited authority still listed -- the filter drops one row, not the table");
  } finally {
    f.cleanup();
  }
});

// #850: a lead statement never prints in Part 3's body, so an authority cited only by leads must be
// off Part 3's table of authorities and off the response book's boa_toc -- both read
// fetchCitedAuthorities. Authority 2 is lead-only. Authority 3 carries one lead and one verified
// statement, the guard that the exclusion drops statements, not whole authorities; RJR-MacDonald,
// the seed's live authority, guards against a filter that empties the table.
test("#850: a lead-only authority is absent from the BCCA stay response's Part 3 table and the response book's boa_toc", async () => {
  const f = fixture();
  try {
    await freshSubmissionDb(f.dbPath);
    writePartiesOfRecord(dirname(f.dbPath), STAY_RESPONSE_CASE_DATA);
    await submissionDataExecute(
      f.dbPath,
      SEED +
        STAY_RESPONSE_POSITIONS +
        `
INSERT INTO authorities (id, proceeding_id, style_of_cause_or_title, citation, kind, weight) VALUES
  (2, 1, 'Ashford v. Pell Holdings Ltd.', '1998 BCCA 404', 'case', 'binding'),
  (3, 1, 'Corwen v. Tallis', '2011 BCCA 77', 'case', 'binding');
INSERT INTO law_assertions (id, proceeding_id, proposition) VALUES (2, 1, 'Irreparable harm is presumed where an arbitration is stayed.');
INSERT INTO submission_law (submission_id, law_assertion_id) VALUES (1, 2);
INSERT INTO statements_of_law (id, proceeding_id, law_assertion_id, authority_id, pinpoint, excerpt, source, verification) VALUES
  (2, 1, 2, 2, 'at para 41', 'a stayed arbitration is irreparable harm without more', 'primary', 'lead'),
  (3, 1, 2, 3, 'at para 9', 'harm from a stayed arbitration may be irreparable', 'primary', 'lead'),
  (4, 1, 2, 3, 'at para 12', 'the harm must still be proved', 'primary', 'verified');
`
    );
    const result = submissionFormsRender(f.dbPath, 1, {});
    const text = result.documents.find((d) => d.document_type === "Response_book").markdown;

    const toaStart = text.indexOf("## PART 3: TABLE OF AUTHORITIES (OPTIONAL)");
    assert.ok(toaStart !== -1, "Part 3 table-of-authorities heading present");
    const toaSection = text.slice(toaStart);
    assert.equal(toaSection.includes("Ashford v. Pell Holdings Ltd."), false, "expected the lead-only authority off Part 3's table");
    assert.equal(toaSection.includes("1998 BCCA 404"), false, "expected its citation off Part 3's table too");
    assert.ok(toaSection.includes("Corwen v. Tallis"), "expected the authority with a verified statement still listed");
    assert.ok(toaSection.includes("RJR-MacDonald"), "expected the live cited authority still listed -- the filter drops one row, not the table");

    const book = submissionFormsEmitBccaBook(f.dbPath, 1).markdown;
    const boaToc = JSON.parse(book.match(/^boa_toc: (.*)$/m)[1]);
    assert.deepEqual(
      boaToc.map((r) => r.authority),
      ["Corwen v. Tallis", "RJR-MacDonald Inc. v. Canada (Attorney General)"],
      "expected the lead-only authority off boa_toc, both others kept"
    );
    const boaParts = JSON.parse(book.match(/^boa_parts: (.*)$/m)[1]);
    assert.equal(boaParts.some((p) => p.bookmark.includes("Ashford")), false, "expected no bound part for the lead-only authority");
    assert.equal(boaParts.length, 2, "expected one part per remaining authority");
  } finally {
    f.cleanup();
  }
});
