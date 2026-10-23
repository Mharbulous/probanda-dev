// Pure unit tests for the filed-face transform (build ticket #359) --
// toFiledFace in filed-face.ts. No database: synthetic markdown strings, so
// each pass (frontmatter, comments, sections, inline tags, glyphs, tidy) can
// be pinned independently of any real renderer's exact output (mirrors
// markers-source-rung.unit.test.mjs's no-DB style). forms-render-*.db.test.mjs covers
// the transform wired against real rendered documents.

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

const { toFiledFace } = await import("../build/submission/forms/filed-face.js");
const { ALL_MARKER_GLYPHS, mockupMessage } = await import("../build/submission/forms/markers.js");
const { CITATION_MISSING } = await import("../build/submission/forms/render-vaniac-submissions.js");
const { freshSubmissionDb } = await import("./helpers/template-db.mjs");

// No file number: the parties are linked by case_party_id to case data holding their counsel.
const CLAIMANT_CASE_DATA = {
  parties: [
    { id: 1, name: "Claimant Co.", counsel_name: "A. Lawyer" },
    { id: 2, name: "Respondent Co." },
  ],
};
const { writePartiesOfRecord } = await import("./helpers/matter-data-fixture.mjs");
const { submissionDataExecute, submissionDataQuery } = await import("../build/submission/backend.js");
const { submissionFormsRender } = await import("../build/submission/forms.js");

function withFrontmatter(body) {
  return (
    "---\n" +
    "Matter no: L4801\n" +
    "Matter Description: Ashbourne v Kestrel\n" +
    "Client Name: Ashbourne\n" +
    "Client no: 2417\n" +
    "Document Type: Written_argument\n" +
    "Document Name: Written argument\n" +
    "Document Date: ________\n" +
    "Venue: VanIAC\n" +
    "Proceeding File no: \n" +
    "Revision: 1\n" +
    "Rendered: 2026-08-24 12:00\n" +
    "---\n" +
    body
  );
}

test("strips the frontmatter block", () => {
  const out = toFiledFace(withFrontmatter("<!-- filing 1 proceeding 1 -->\n\nHello.\n"));
  assert.doesNotMatch(out, /Client Name|Document Type|Document Date|________|Revision:|Rendered:/);
  assert.match(out, /Hello\./);
});

test("strips HTML comments anywhere in the line", () => {
  const out = toFiledFace(withFrontmatter("1. **A submission.** <!-- submission 1 -->\n"));
  assert.doesNotMatch(out, /<!--/);
  assert.match(out, /1\. \*\*A submission\.\*\*/);
});

test("a mockupMessage line is removed whole, sentence included (#1243)", () => {
  const out = toFiledFace(withFrontmatter("## CHRONOLOGY\n\n" + mockupMessage("🧩", "No chronology events recorded.") + "\n\n## OPENING STATEMENT\n\nKept.\n"));
  assert.doesNotMatch(out, /No chronology|mockup-only|<!--/);
  assert.match(out, /## CHRONOLOGY\n\n## OPENING STATEMENT\n\nKept\./);
});

test("removes a mockup-only section through to the next heading", () => {
  const out = toFiledFace(
    withFrontmatter(
      "1. **Included.**\n\n" +
        "## Source trace\n\n" +
        "- Ex. 1 — some/path.pdf\n\n" +
        "## Opposing points\n\n" +
        "- Their point. ↩️\n"
    )
  );
  assert.match(out, /1\. \*\*Included\.\*\*/);
  assert.doesNotMatch(out, /## Source trace|some\/path\.pdf/);
  assert.doesNotMatch(out, /## Opposing points|Their point/);
});

test("removes a crossed-out (struck) line entirely, renumbering is left to the caller", () => {
  const out = toFiledFace(
    withFrontmatter("1. **Included.** <!-- order 1 -->\n\n~~Excluded, crossed out.~~ <!-- order crossed-out 1 -->\n\n2. **Also included.** <!-- order 2 -->\n")
  );
  assert.match(out, /1\. \*\*Included\.\*\*/);
  assert.match(out, /2\. \*\*Also included\.\*\*/);
  assert.doesNotMatch(out, /~~|Excluded, crossed out/);
});

test("removes a mockup-only section emitted at a deeper heading level (BCCA #### nested under ###), stopping at the next same-or-shallower heading", () => {
  const out = toFiledFace(
    withFrontmatter(
      "### Part 2: Issues\n\n" +
        "1. Included issue.\n\n" +
        "#### Positions not yet taken\n\n" +
        "- Order 2: excluded order. ⬜\n\n" +
        "### Part 3: Analysis\n\n" +
        "2. Included analysis.\n"
    )
  );
  assert.match(out, /1\. Included issue\./);
  assert.doesNotMatch(out, /#### Positions not yet taken|excluded order|⬜/);
  assert.match(out, /### Part 3: Analysis/, "the next heading (a shallower ###) must survive the strip");
  assert.match(out, /2\. Included analysis\./);
});

test("removes a level-2 mockup-only section that itself contains deeper subheadings, stopping only at the next level-2 heading (regression)", () => {
  const out = toFiledFace(
    withFrontmatter(
      "1. **Included.**\n\n" +
        "## Source trace\n\n" +
        "### A nested subheading inside the stripped section\n\n" +
        "- Ex. 1 — some/path.pdf\n\n" +
        "## Opposing points\n\n" +
        "- Their point. ↩️\n"
    )
  );
  assert.match(out, /1\. \*\*Included\.\*\*/);
  assert.doesNotMatch(out, /## Source trace|A nested subheading|some\/path\.pdf/);
  assert.doesNotMatch(out, /## Opposing points|Their point/);
});

test("removes a mockup-only section that runs to end of document", () => {
  const out = toFiledFace(
    withFrontmatter("I, A. Witness, state as follows:\n\n1. A paragraph.\n\n## Facts attributed to this witness, not yet in this statement\n\n- An unlinked fact.\n")
  );
  assert.match(out, /1\. A paragraph\./);
  assert.doesNotMatch(out, /## Facts attributed|An unlinked fact/);
});

test("strips the [facts F#] and [GAP] inline tags", () => {
  const out = toFiledFace(
    withFrontmatter(
      "1. Traced sentence. [facts F1, F2] <!-- statement_paragraph 1 -->\n" +
        "2. Untraced sentence. 🧩 [GAP -- no fact linked] <!-- statement_paragraph 2 -->\n"
    )
  );
  assert.match(out, /1\. Traced sentence\./);
  assert.doesNotMatch(out, /\[facts/);
  assert.match(out, /2\. Untraced sentence\./);
  assert.doesNotMatch(out, /\[GAP|🧩/);
});

test("strips the Rule 24(j) practitioner cap warning", () => {
  const out = toFiledFace(
    withFrontmatter(
      "The total claimed is $300,000. [PRACTITIONER — total exceeds the Rule 24(j) cap; Rule 24(h) consent position required]\n"
    )
  );
  assert.match(out, /The total claimed is \$300,000\./);
  assert.doesNotMatch(out, /PRACTITIONER/);
});

test("drops the whole no-facts-attributed message line, not just its glyph", () => {
  const out = toFiledFace(withFrontmatter("I, A. Witness, state as follows:\n\n🧩 no facts attributed to this witness\n\nI make this statement believing its contents to be true.\n"));
  assert.doesNotMatch(out, /no facts attributed to this witness/, "a bare 'no facts attributed' sentence with the glyph stripped would read as a false assertion of record");
});

test("strips the general renderer's two confirmation tags and keeps the prose around them", () => {
  const out = toFiledFace(
    withFrontmatter("# Letter to counsel [unverified: R-title, transcribed from PDF p. 4]\n\n## Re [source changed: R-body]\n\n1. The body stays.\n")
  );
  assert.match(out, /^# Letter to counsel$/m);
  assert.match(out, /^## Re$/m);
  assert.match(out, /1\. The body stays\./);
  assert.doesNotMatch(out, /unverified|source changed/);
});

test("strips the terms projection's currency tag and keeps the clause around it (#1181)", () => {
  const out = toFiledFace(
    withFrontmatter("1. The Limitation Act governs. [currency: repealed] 🧐 <!-- clause_id 8 -->\n\n2. The Act applies. [currency: unchecked]\n")
  );
  assert.match(out, /^1\. The Limitation Act governs\.$/m);
  assert.match(out, /^2\. The Act applies\.$/m);
  assert.doesNotMatch(out, /currency/);
});

test("strips the no-stated-fact-needed tag and keeps the contention around it (schema v48)", () => {
  const out = toFiledFace(withFrontmatter("1. **The tribunal has jurisdiction.** (no stated fact needed, per counsel 2026-10-04) 🧐 <!-- submission_id 1 -->\n"));
  assert.match(out, /^1\. \*\*The tribunal has jurisdiction\.\*\*$/m);
  assert.doesNotMatch(out, /no stated fact needed|per counsel/);
});

test("strips the note-up tag through its own parentheses, alone or after a settled tag, and keeps the citation (schema v51)", () => {
  const note = "CanLII: noted up (1992 CanLII 613: 43 citing decisions; 4 read); step 3 alone would rate 'negative (partial)'.";
  const out = toFiledFace(
    withFrontmatter(
      `   > *R v Bernard*, 1992 CanLII 613, para 12 (note-up: ${note})\n   <!-- statement_of_law_id 1 -->\n\n` +
        `   > *Settled v. S*, 2021 BCSC 11, para 11 (settled by counsel 2026-10-02 over scrutiny finding) (note-up: ${note})\n   🧐 <!-- statement_of_law_id 2 -->\n`
    )
  );
  assert.match(out, /^ {3}> \*R v Bernard\*, 1992 CanLII 613, para 12$/m);
  assert.match(out, /^ {3}> \*Settled v\. S\*, 2021 BCSC 11, para 11$/m);
  assert.doesNotMatch(out, /note-up|settled by counsel|CanLII: noted up|partial/);
});

test("drops the header's optional list fields with the header, and keeps the body", () => {
  const lists =
    "Authorities cited:\n  - Example v. Authority, 2020 BCSC 1 📜 <!-- statement_of_law_id 1 -->\n" +
    "Page budget:\n  - Limit: 2 pages; estimate: 1 pages\n" +
    "Layout confirmation:\n  - Note: the No venue requirements for Letter were learned by an agent.\n" +
    "Blind copies:\n  - bcc: Ada Client\n";
  const out = toFiledFace(withFrontmatter("## Re\n\n1. Body.\n\nTo: Cara Counsel\n").replace("\n---\n", `\n${lists}---\n`));
  assert.equal(out, "## Re\n\n1. Body.\n\nTo: Cara Counsel\n");
});

test("drops each whole gap line, its blank underline included, and keeps the signing space", () => {
  const out = toFiledFace(
    withFrontmatter("Yours truly,\n\n________________________________\n🧩 ________ <!-- signer not chosen -->\n\n🧩 ________ <!-- no To recipient -->\n")
  );
  assert.equal(out, "Yours truly,\n\n________________________________\n", "a stray underline would read as a blank on the letter");
});

test("strips every known marker glyph", () => {
  const body = ALL_MARKER_GLYPHS.map((g) => `Line with ${g} marker.`).join("\n");
  const out = toFiledFace(withFrontmatter(body));
  for (const glyph of ALL_MARKER_GLYPHS) {
    assert.doesNotMatch(out, new RegExp(glyph), `expected ${glyph} stripped`);
  }
});

test("keeps ordinary drafted prose, verbatim quotes, and placeholders untouched", () => {
  const body =
    '   "the Purchaser shall pay the Balance in full on the Closing Date" (Ex. 1, s. 2.3)\n\n' +
    "| Ex. 2 | undated | (not recorded) | |\n\n" +
    "Signed at: ________________\n" +
    "Date: ________________\n";
  const out = toFiledFace(withFrontmatter(body));
  assert.match(out, /the Purchaser shall pay the Balance in full on the Closing Date/);
  assert.match(out, /\(not recorded\)/);
  assert.match(out, /undated/);
  assert.match(out, /Signed at: ________________/);
});

test("collapses blank lines left behind by stripping without leaving 3+ in a row", () => {
  const out = toFiledFace(withFrontmatter("A. 🧩\n\nB. 🏷️\n\n\n\nC.\n"));
  assert.doesNotMatch(out, /\n{3,}/);
});

// Ticket 2026-08-31, decision 5: CITATION_MISSING ("[citation missing]") is text, not a marker
// glyph -- it must never be silently stripped by this transform. The filing gate in forms.ts
// scans the pre-strip mockup for it and refuses the whole render before toFiledFace ever runs;
// this transform's own job is only to leave the placeholder alone if it somehow reached it.
test("never treats the missing-citation placeholder as a marker glyph -- the filing gate depends on it never being silently stripped", () => {
  assert.ok(
    !ALL_MARKER_GLYPHS.includes(CITATION_MISSING),
    "expected the missing-citation placeholder to not be registered as a marker glyph"
  );
  const escaped = CITATION_MISSING.replace(/[[\]]/g, "\\$&");
  const out = toFiledFace(withFrontmatter(`> *Some Authority*, ${CITATION_MISSING} para 1\n`));
  assert.match(out, new RegExp(escaped), "expected toFiledFace to leave the placeholder untouched, not silently strip it");
});

// Ticket 2026-08-31, decision 5: "less is more" -- a filed-face render refuses outright rather
// than deliver a document that would print CITATION_MISSING, mirroring the existing
// bundle_outdated refusal shape in forms.ts.
test("filed-mode render refuses when a deployed statement of law has no authorities.citation", async () => {
  const dir = mkdtempSync(join(tmpdir(), "coclerk-filed-face-citation-gate-"));
  const matter = join(dir, "L4801 Matter");
  mkdirSync(join(matter, "0. CASE DATA"), { recursive: true });
  mkdirSync(join(matter, "0. DRAFT"));
  const dbPath = join(matter, "0. CASE DATA", "submission.sqlite");
  try {
    await freshSubmissionDb(dbPath);
    writePartiesOfRecord(dirname(dbPath), CLAIMANT_CASE_DATA);
    await submissionDataExecute(
      dbPath,
      `
      INSERT INTO proceedings (id, matter_reference, forum, court_or_centre, registry, file_number, style_of_cause, courthouse_address)
        VALUES (1, 'L0001 - Gate', 'CAN/BC/Vancouver-International-Arbitration-Centre', 'VanIAC', NULL, NULL, 'Gate v. Test', NULL);

      INSERT INTO parties (id, proceeding_id, name, role, ordinal, is_client, is_applicant, to_be_served, case_party_id)
        VALUES
          (1, 1, 'Claimant Co.', 'Claimant', 1, 1, 1, 0, 1),
          (2, 1, 'Respondent Co.', 'Respondent', 2, 0, 0, 1, 2);

      INSERT INTO filings (id, proceeding_id, kind, subkind, round, title)
        VALUES (1, 1, 'submissions_package', NULL, 'opening', 'Opening Submissions Package');

      -- No citation recorded -- the exact condition the gate exists to catch.
      INSERT INTO authorities (id, proceeding_id, style_of_cause_or_title, citation, kind, weight, treatment)
        VALUES (1, 1, 'Unreported Authority v. Nobody', NULL, 'case', 'binding', NULL);

      INSERT INTO submissions (id, proceeding_id, contention, ordinal)
        VALUES (1, 1, 'A submission resting on an uncited authority.', 1);
      INSERT INTO filing_submissions (filing_id, submission_id, document, ordinal) VALUES (1, 1, 'form', 1);
      INSERT INTO law_assertions (id, proceeding_id, proposition, dead_end)
        VALUES (1, 1, 'a proposition backed by an uncited authority', 0);
      INSERT INTO statements_of_law (id, proceeding_id, law_assertion_id, authority_id, pinpoint, excerpt, source, verification)
        VALUES (1, 1, 1, 1, 'para 1', 'the relevant excerpt', 'primary', 'verified');
      INSERT INTO submission_law (submission_id, law_assertion_id) VALUES (1, 1);

      -- Revision reset LAST: schema v21 triggers move db_meta.revision on every seeded row (#607).
      UPDATE db_meta SET value = '1' WHERE key = 'revision';
      `.trim()
    );

    const result = submissionFormsRender(dbPath, 1, {}, "filed");
    assert.equal(result.citation_gate_failed, true, "expected the citation gate to fire");
    assert.deepEqual(result.documents, [], "expected no documents -- refusing beats delivering a document with the placeholder in it");
    assert.match(result.note ?? "", /citation/i, "expected the refusal note to explain what's missing");

    // Sanity check the gate actually protects against a real leak: mockup mode (which never
    // gates) does print the placeholder, proving the fixture above genuinely exercises the gate
    // rather than a proposition that happened to have no excerpt at all.
    const mockup = submissionFormsRender(dbPath, 1, {}, "mockup");
    const writtenArgument = mockup.documents.find((d) => d.document_type === "Written_arguments").markdown;
    assert.match(writtenArgument, new RegExp(CITATION_MISSING.replace(/[[\]]/g, "\\$&")), "expected the mockup (which never gates) to show the placeholder, confirming the seed exercises the gate");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// Schema v16 (practitioner + Fable review, 2026-09-06): a killed submission or authority must
// never reach a filed face, and must never disappear from the database -- never a delete.
test("killed submission and killed authority: absent from the filed face, never deleted", async () => {
  const dir = mkdtempSync(join(tmpdir(), "coclerk-filed-face-killed-"));
  const dbPath = join(dir, "submission.sqlite");
  try {
    await freshSubmissionDb(dbPath);
    writePartiesOfRecord(dirname(dbPath), CLAIMANT_CASE_DATA);
    await submissionDataExecute(
      dbPath,
      `
      INSERT INTO proceedings (id, matter_reference, forum, court_or_centre, registry, file_number, style_of_cause, courthouse_address)
        VALUES (1, 'L0002 - Killed', 'CAN/BC/Vancouver-International-Arbitration-Centre', 'VanIAC', NULL, NULL, 'Killed v. Test', NULL);

      INSERT INTO parties (id, proceeding_id, name, role, ordinal, is_client, is_applicant, to_be_served, case_party_id)
        VALUES
          (1, 1, 'Claimant Co.', 'Claimant', 1, 1, 1, 0, 1),
          (2, 1, 'Respondent Co.', 'Respondent', 2, 0, 0, 1, 2);

      INSERT INTO filings (id, proceeding_id, kind, subkind, round, title)
        VALUES (1, 1, 'submissions_package', NULL, 'opening', 'Opening Submissions Package');

      -- A killed authority (schema v16): reviewed and rejected, kept intact -- its citation and
      -- excerpt stay in the database as the breadcrumb, but must ride the brief-only cap exactly
      -- like a 'lead' authority.
      INSERT INTO authorities (id, proceeding_id, style_of_cause_or_title, citation, kind, weight, treatment, killed_on)
        VALUES (1, 1, 'Killed Authority v. Nobody', '2020 BCSC 1', 'case', 'persuasive', NULL, '2026-09-06');

      -- A live submission requiring that killed authority -- deployed on the venue document.
      INSERT INTO submissions (id, proceeding_id, contention, ordinal)
        VALUES (1, 1, 'A live submission requiring a killed authority.', 1);
      INSERT INTO filing_submissions (filing_id, submission_id, document, ordinal) VALUES (1, 1, 'form', 1);
      INSERT INTO law_assertions (id, proceeding_id, proposition, dead_end)
        VALUES (1, 1, 'a proposition resting on a killed authority', 0);
      INSERT INTO statements_of_law (id, proceeding_id, law_assertion_id, authority_id, pinpoint, excerpt, source, verification)
        VALUES (1, 1, 1, 1, 'para 5', 'the killed authority excerpt text', 'primary', 'verified');
      INSERT INTO submission_law (submission_id, law_assertion_id) VALUES (1, 1);

      -- A killed submission (schema v16): reviewed and rejected, never deployed -- kept intact,
      -- not deleted, so a later drafting pass recognizes it was already considered.
      INSERT INTO submissions (id, proceeding_id, contention, ordinal, killed_on)
        VALUES (2, 1, 'A killed submission, already considered and rejected.', 2, '2026-09-06');

      -- Revision reset LAST: schema v21 triggers move db_meta.revision on every seeded row (#607).
      UPDATE db_meta SET value = '1' WHERE key = 'revision';
      `.trim()
    );

    const filed = submissionFormsRender(dbPath, 1, {}, "filed");
    assert.equal(filed.citation_gate_failed, undefined, "the killed authority has a citation -- the gate must not fire on it");
    const filedWA = filed.documents.find((d) => d.document_type === "Written_arguments").markdown;
    assert.match(filedWA, /A live submission requiring a killed authority\./, "the live submission itself must still render");
    assert.doesNotMatch(filedWA, /killed authority excerpt text/, "a killed authority's excerpt must never reach a filed face");
    assert.doesNotMatch(filedWA, /Killed Authority v\. Nobody|2020 BCSC 1/, "a killed authority's citation must never reach a filed face");
    assert.doesNotMatch(filedWA, /A killed submission/, "a killed submission must never reach a filed face");

    // Never deleted: both rows are still in the database, exactly so a later research or drafting
    // pass can recognize they were already considered rather than re-proposing them.
    const rows = submissionDataQuery(dbPath, `SELECT killed_on FROM submissions WHERE id = 2`).rows;
    assert.equal(rows[0]?.killed_on, "2026-09-06");
    const authRows = submissionDataQuery(dbPath, `SELECT killed_on FROM authorities WHERE id = 1`).rows;
    assert.equal(authRows[0]?.killed_on, "2026-09-06");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
