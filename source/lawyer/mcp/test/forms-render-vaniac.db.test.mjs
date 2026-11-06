// Golden-fixture tests for the submission form renderers (build ticket #297): the VanIAC submissions package, and bootstrap/render behaviour on a seeded VanIAC matter.
// Split out of the former forms-render.test.mjs; shared seeds live in fixtures/forms-render-seeds.mjs,
// which also documents regenerating the golden fixtures.

import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { seededDbFixture, seedVaniacProceeding, assertMatchesGolden, findFile, replaceStamp } from "./fixtures/forms-render-seeds.mjs";
const { freshSubmissionDb } = await import("./helpers/template-db.mjs");
const { writePartiesOfRecord } = await import("./helpers/matter-data-fixture.mjs");
const { assertFiledFaceDocumentsClean } = await import("./helpers/filed-face-scan.mjs");
const { submissionDataExecute, submissionDataQuery } = await import("../build/submission/backend.js");
const { submissionFormsRender, submissionFormsBootstrap } = await import("../build/submission/forms.js");
const { renderWrittenArguments } = await import("../build/submission/forms/render-companions.js");
const { fetchReviewState } = await import("../build/submission/forms/review-state.js");
const { renderWitnessStatements } = await import("../build/submission/forms/render-witness-statements.js");
const { currentSchemaVersion } = await import("../build/submission/migrate.js");

// Ticket 2026-09-01: a submission's body opens with its own contention
// paragraph, followed by several standalone numbered paragraphs (one per
// postulate/proposition it rests on or requires). The contention sentence
// also prints elsewhere in the document (a struck-submission summary line,
// and the "Opposing points" section's "— answered by:" label, both
// deliberately unchanged), so a raw
// contention-substring search can match the wrong section entirely. Delimit
// by the submission's own `<!-- submission_id N -->` trace comment instead
// (appended once, to the contention paragraph): start at that line, end at
// the next line carrying a different submission's trace, the next markdown
// heading, or EOF.
function submissionBlock(markdown, submissionId) {
  const lines = markdown.split("\n");
  const startIdx = lines.findIndex((l) => l.includes(`<!-- submission_id ${submissionId} -->`));
  if (startIdx === -1) throw new Error(`no line contains submission_id ${submissionId}'s trace comment`);
  let endIdx = lines.length;
  for (let i = startIdx + 1; i < lines.length; i++) {
    if (lines[i].includes("<!-- submission_id ") || /^#{2,6}\s/.test(lines[i])) {
      endIdx = i;
      break;
    }
  }
  return lines.slice(startIdx, endIdx).join("\n");
}

test("renders the VanIAC submissions package (written argument, witness statement, evidence index)", async () => {
  const f = seededDbFixture();
  try {
    await freshSubmissionDb(f.dbPath);
    await seedVaniacProceeding(f.dbPath);

    const result = submissionFormsRender(f.dbPath, 1, { clientName: "Ashbourne", clientNo: "2417", matterNo: "L4801" });
    assert.equal(result.filing_id, 1);
    assert.equal(result.revision, 1);
    // Written Arguments (venue) + 4 witness statements + evidence index + Work Board (ADR 0009).
    assert.equal(result.documents.length, 7);

    const baseDir = dirname(result.documents[0].path);
    const writtenArgument = replaceStamp(findFile(baseDir, "Written Arguments.md"));

    // Submission 1 requires two law assertions, each with its own statement
    // of law -- issue #321 moves ⚠️/🚨 off the contention line onto each
    // statement's own block-quote line (they no longer collapse onto one
    // shared line the way the old argument-level marker string did). The
    // block's first line is the submission's own contention paragraph.
    const submission1Block = submissionBlock(writtenArgument, 1);
    assert.match(
      submission1Block.split("\n")[0],
      /^\d+\. The Respondent owes \$150,000 under the plain words of the Asset Purchase Agreement\./,
      "expected the submission's first paragraph to be its own contention"
    );
    assert.doesNotMatch(
      submission1Block.split("\n")[0],
      /⚠️|🚨/,
      "expected the submission's contention line to carry no law-side marker -- those belong to the proposition/statement lines beneath it"
    );
    assert.match(submission1Block, /⚠️/, "expected the distinguishable-treatment marker on the first authority's statement line");
    assert.match(submission1Block, /🚨/, "expected the negative-treatment marker on the second authority's statement line");

    // Submission 2 rests_on fact 1 and requires two law assertions neither of
    // which has verified support -- each renders on its own proposition line
    // now, so issue #322's same-line collapse doesn't arise (the ticket's own
    // note): two separate lines, each carrying its doctrinal-slot glyph
    // exactly once, not one line with two glyphs collapsed to one. Since #502
    // the two glyphs differ -- assertion 3 holds a lead (🔬), assertion 4
    // holds nothing at all (📖).
    const submission2Block = submissionBlock(writtenArgument, 2);
    assert.match(submission2Block, /The parties entered the Asset Purchase Agreement/, "expected submission 2's rested-on postulate to render");
    assert.match(submission2Block, /the Purchaser shall pay the Balance in full on the Closing Date/, "expected the fact's statement excerpt as a fenced quote");
    assert.match(
      submission2Block,
      /> Witness Statement of A\. Renwick, para 1, Ex\. 1, s\. 2\.3/,
      "expected the citation to cite through the instrument to the exhibit the Evidence Index numbers Ex. 1"
    );
    assert.match(submission2Block, /🖋️/, "expected the unsigned-witness-statement marker on the fact's statement line");
    assert.doesNotMatch(submission2Block, /a reserved account not yet deployed/, "expected the reserved statement of fact to be excluded from the inline body");
    const doctrinalLines = submission2Block.split("\n").filter((l) => /📖|🔬/.test(l));
    assert.equal(
      doctrinalLines.length,
      2,
      `expected two separate proposition lines each carrying a doctrinal-slot glyph, not one collapsed line, got:\n${submission2Block}`
    );
    for (const line of doctrinalLines) {
      assert.equal((line.match(/📖|🔬/g) ?? []).length, 1, `expected exactly one doctrinal-slot glyph per proposition line, got: ${line}`);
    }

    // Issue #345: the unless-admitted guard's per-party half, exercised
    // through submission 2's two new facts. Fact 11 is admitted by the sole
    // opposing party (Northridge) -- covered, so every evidence-side marker
    // silences, including on its own statement of fact. Fact 12's admission
    // is denied -- not covered, so 👤 still fires even with no court-record
    // link on the fact itself.
    const fact11Line = writtenArgument.split("\n").find((l) => l.includes("<!-- fact_id 11 -->"));
    assert.ok(fact11Line, "expected fact 11's postulate line to render");
    assert.doesNotMatch(fact11Line, /🗣️|💬|📍|🧷|👤/, "expected a fact admitted against every opposing party to render with no evidence-side markers");
    const stmt6Line = writtenArgument.split("\n").find((l) => l.includes("<!-- statement_of_fact_id 6 -->"));
    assert.ok(stmt6Line, "expected fact 11's statement line to render");
    assert.doesNotMatch(stmt6Line, /🗣️|💬|📍|🧷/, "expected the covered fact's own statement markers silenced too");

    // Phase C (#777): an exhibit-backed statement with no instrument and no exhibit_pinpoint owes 📌 and
    // quotes the exhibit -- the shape that rendered no locator at all between #511 and this build.
    const stmt7Line = writtenArgument.split("\n").find((l) => l.includes("<!-- statement_of_fact_id 7 -->"));
    assert.ok(stmt7Line, "expected the exhibit-backed statement to render under fact 13");
    assert.match(stmt7Line, /📌/, "expected the exhibit pin on an exhibit-backed statement with no exhibit_pinpoint");
    assert.doesNotMatch(stmt7Line, /🧷|📑|💬/, "no instrument means no 🧷; the exhibit passage is captured, so no excerpt marker");
    assert.match(submissionBlock(writtenArgument, 2), /Week 12: crew on site until 21:00 each day\n   ```\n\n   > Ex\. 3 .*<!-- statement_of_fact_id 7 -->\n/, "expected the fence to quote the exhibit and the citation line to name Ex. 3");
    const fact12Line = writtenArgument.split("\n").find((l) => l.includes("<!-- fact_id 12 -->"));
    // Issue #361: the fact-side twin of the Ex.4 assertion below -- the denied
    // admission's event glyph prefixes 👤 instead of silently disappearing.
    assert.match(fact12Line, /🙅🏻‍♂️👤/, "expected the denied admission's event glyph to prefix the fact-side 👤, fused as one set");

    // #380/#384: "Held in reserve" is retired from the Written Arguments --
    // the impeachment statement (purpose='impeachment', was disposition=
    // 'reserved') is excluded from the inline body entirely (asserted
    // above) and prints on no face.
    assert.doesNotMatch(writtenArgument, /## Held in reserve/, "expected no Held-in-reserve trailing section on the Written Arguments");
    // #401: fact 1 is marked adverse and fully rendered here (deployed, so no 🂡) -- 🚩 must never
    // leak onto the Written Arguments regardless: no page prints 🂡, 🤥 or 🚩.
    assert.doesNotMatch(writtenArgument, /🚩/, "expected no adverse marker leaked onto the Written Arguments");

    // Issue #348, re-shaped by #380 onto order_sought_requires: order 1 is
    // linked to a distinguishable authority via a 'filled' requires edge --
    // exercises the ladder's ⚠️ end-to-end, mirroring the Notice of
    // Application's own jurisdiction marker.
    const reliefLine = writtenArgument.split("\n").find((l) => l.includes("<!-- relief_item a -->"));
    assert.ok(reliefLine, "expected relief 1's order line to render");
    assert.match(reliefLine, /⚠️/, "expected the distinguishable-treatment marker on the jurisdictional basis");
    // This edge is the same shape as order 3's killed-authority edge, but on a LIVE authority and
    // its statement is unrated, so 🏅 does render here.
    assert.match(reliefLine, /🏅/, "expected the unrated marker on a live authority's jurisdictional statement");

    assertMatchesGolden("written-argument", writtenArgument);
    assertMatchesGolden("witness-statement", replaceStamp(findFile(baseDir, "Witness Statement - A. Renwick.md")));

    // Build #329/#320: the fact-side ladder, three more witness statements.
    const jRenwick = replaceStamp(findFile(baseDir, "Witness Statement - J. Renwick.md"));
    assert.match(jRenwick, /🧩 no facts attributed to this witness/, "expected the statement-level gap for a witness with no included statements_of_fact row");
    assert.doesNotMatch(jRenwick, /🖋️/, "expected no sign-it marker on an empty statement");
    assert.doesNotMatch(jRenwick, /## Facts attributed to this witness/, "expected no trailing subsection when there is nothing to list");
    assertMatchesGolden("witness-statement-empty", jRenwick);

    const mReyes = replaceStamp(findFile(baseDir, "Witness Statement - M. Reyes.md"));
    assert.doesNotMatch(mReyes, /🧩 no facts attributed to this witness/, "expected no statement-level gap -- this witness has included statements_of_fact rows");
    assert.doesNotMatch(mReyes, /🖋️/, "expected no sign-it marker -- no paragraph is linked to any statement of fact yet");
    const mReyesSubsection = mReyes.split("## Facts attributed to this witness, not yet in this statement")[1];
    assert.ok(mReyesSubsection, "expected the trailing subsection to render");
    // Schema v10 (#380): facts.posture retired -- doubt (statements_of_fact.doubt)
    // is now statement-level, rendering 👃 instead of a prose parenthetical.
    assert.match(mReyesSubsection, /The crew worked overtime during the final week of the project\. 🗣️👃/, "expected the not-yet-interviewed row's rung plus the doubt marker");
    assert.match(mReyesSubsection, /Overtime hours were logged in the site diary\. ✍️/, "expected the interviewed-with-pinpoint row's rung");
    // Phase C defect 4 (#777): an unlinked statement owes 📌 when an exhibit is set, never 🧷.
    assert.match(mReyesSubsection, /Overtime for the final week was recorded in the Site Diary\. 📌✍️/, "expected the exhibit pin beside ✍️ on the unlinked row");
    assertMatchesGolden("witness-statement-unlinked-facts", mReyes);

    const kBell = replaceStamp(findFile(baseDir, "Witness Statement - K. Bell.md"));
    assert.doesNotMatch(kBell, /🧩 no facts attributed to this witness/, "expected no statement-level gap");
    assert.doesNotMatch(kBell, /🖋️/, "expected no sign-it marker -- already signed");
    assert.doesNotMatch(kBell, /## Facts attributed to this witness/, "expected no trailing subsection -- its one fact is fully linked");
    assertMatchesGolden("witness-statement-clean", kBell);

    const evidenceIndex = replaceStamp(findFile(baseDir, "Evidence Index.md"));
    // Tendered by / 👤 (issue #330/#333): Ex. 1 is tendered by statement 1
    // (witness A. Renwick, instrument = document 3); Ex. 2 has no tendering
    // statement at all and should render 👤 with an empty Tendered by cell.
    assert.match(evidenceIndex, /\| Ex\. \| Date \| Description \| Tendered by \|/, "expected the fourth Tendered by column header");
    const ex1Line = evidenceIndex.split("\n").find((l) => l.includes("<!-- document_id 1 -->"));
    assert.match(ex1Line, /\| A\. Renwick \(Witness Statement of A\. Renwick\) \|/, "expected Ex. 1's Tendered by cell to name the tendering witness and instrument");
    assert.doesNotMatch(ex1Line, /👤/, "expected no unsponsored-exhibit marker on a tendered exhibit");
    const ex2Line = evidenceIndex.split("\n").find((l) => l.includes("<!-- document_id 2 -->"));
    assert.match(ex2Line, /👤/, "expected the unsponsored-exhibit marker on an exhibit nobody tenders");
    assert.match(ex2Line, /\|\s*\|\s*<!-- document_id 2 -->/, "expected Ex. 2's Tendered by cell to be empty");
    // Build #339: Ex. 3 is tendered only by admissions (party Northridge
    // Construction Ltd., no statements_of_fact row at all) -- proves
    // admissions alone clear 👤 and drive the Tendered by cell. Issue #344:
    // five admissions on this exhibit, each decorated with its derived
    // admission-ladder rung -- 🤝 (tender outstanding, no excerpt), 🎾, ⏳,
    // 🙅🏻‍♂️, and ⏰ (tender outstanding, no instrument pinpoint). Issue
    // #345: state-aware suppression drops only the denied admission (🙅🏻‍♂️)
    // from the cell -- 🎾/⏳ are live work, not a tender, but the bug #345
    // fixes names only denied/refused/no-knowledge/struck, so they stay.
    const ex3Line = evidenceIndex.split("\n").find((l) => l.includes("<!-- document_id 7 -->"));
    const expectedTenderedBy = [
      "Northridge Construction Ltd. (admission 🤝🕹️📑)",
      "Northridge Construction Ltd. (admission 🎾)",
      "Northridge Construction Ltd. (admission ⏳)",
      "Northridge Construction Ltd. (admission ⏰🕹️📌)",
    ].join("; ");
    assert.ok(
      ex3Line.includes(expectedTenderedBy),
      `expected Ex. 3's Tendered by cell to show the four non-spent admissions with their derived ladder rungs; got: ${ex3Line}`
    );
    assert.doesNotMatch(ex3Line, /🙅🏻‍♂️/, "expected the denied admission suppressed from the Tendered by cell -- it tenders nothing");
    assert.doesNotMatch(ex3Line, /👤/, "expected no unsponsored-exhibit marker on an admission-tendered exhibit");

    // Issue #345: Ex. 4 is tendered only by a spent (denied) admission --
    // tenders nothing, so 👤 fires, and the event glyph re-homes as a
    // prefix on the description cell instead of silently disappearing.
    const ex4Line = evidenceIndex.split("\n").find((l) => l.includes("<!-- document_id 15 -->"));
    assert.match(ex4Line, /🙅🏻‍♂️👤/, "expected the denied admission's event glyph to prefix 👤 on the description cell, fused as one set");
    assert.match(ex4Line, /\|\s*\|\s*<!-- document_id 15 -->/, "expected Ex. 4's Tendered by cell to be empty -- the denied admission tenders nothing");

    // Source trace (issue #325): renders for the exhibit with a file_path,
    // stays silent for the one without -- no marker, no line.
    assert.match(evidenceIndex, /## Source trace/);
    assert.match(evidenceIndex, /Ex\. 1 — 3\. DISCLOSURE\\Asset Purchase Agreement \(executed\)\.pdf, PDF pp\. 1-12/);
    const sourceTraceSection = evidenceIndex.split("## Source trace")[1];
    assert.doesNotMatch(sourceTraceSection, /Ex\. 2/, "expected no source-trace line for the document with a NULL file_path");
    assertMatchesGolden("evidence-index", evidenceIndex);

    // Build #359: opposing_points -- an answered point names its answering
    // submission and carries no ↩️; an unanswered one does.
    const opposingSection = writtenArgument.split("## Opposing points")[1];
    assert.ok(opposingSection, "expected the Opposing points section to render");
    const point1Line = opposingSection.split("\n").find((l) => l.includes("<!-- opposing_point_id 1 -->"));
    assert.match(point1Line, /the Agreement was never validly executed/);
    assert.match(point1Line, /— answered by: The Respondent owes \$150,000/);
    assert.doesNotMatch(point1Line, /↩️/, "expected no rebuttal marker on an answered opposing point");
    const point2Line = opposingSection.split("\n").find((l) => l.includes("<!-- opposing_point_id 2 -->"));
    assert.match(point2Line, /the delivery schedule was informal only/);
    assert.match(point2Line, /↩️/, "expected the rebuttal marker on an unanswered opposing point");
  } finally {
    f.cleanup();
  }
});

test("render_mode 'filed' strips every human-side element and writes nothing to disk", async () => {
  const f = seededDbFixture();
  try {
    await freshSubmissionDb(f.dbPath);
    await seedVaniacProceeding(f.dbPath);

    const result = submissionFormsRender(f.dbPath, 1, { clientName: "Ashbourne", clientNo: "2417", matterNo: "L4801" }, "filed");
    assert.equal(result.filing_id, 1);
    // Written Arguments (venue) + 4 witness statements + evidence index --
    // the Work Board is genuinely absent here, not merely stripped (ADR 0009).
    assert.equal(result.documents.length, 6);

    // No disk write at all in filed mode -- not even the mockups root.
    assert.deepEqual(readdirSync(f.draft), [], "expected render_mode 'filed' to write nothing to disk");

    assert.ok(!result.documents.some((d) => d.document_type === "Work_board"), "expected the Work Board genuinely absent from filed-mode output, not merely stripped");

    assertFiledFaceDocumentsClean(result.documents);

    const writtenArgument = replaceStamp(result.documents.find((d) => d.file_name === "Written Arguments.md").markdown);
    assert.doesNotMatch(writtenArgument, /a reserved account not yet deployed|A reserved fallback argument/, "expected reserved content gone from the filed face");
    assert.match(writtenArgument, /^1\. The Respondent owes \$150,000 under the plain words of the Asset Purchase Agreement\.$/m, "expected the contention sentence as the submission's own opening paragraph, even in filed mode");
    assert.match(writtenArgument, /contractual interpretation principles/, "expected submission 1's law assertion to survive as its own paragraph");
    assertMatchesGolden("written-argument-filed", writtenArgument);

    const renwickStatement = replaceStamp(result.documents.find((d) => d.file_name === "Witness Statement - A. Renwick.md").markdown);
    assert.doesNotMatch(renwickStatement, /Relationship to the matter/, "expected no relationship parenthetical (#538)");
    assert.doesNotMatch(renwickStatement, /confirm before filing/);
    assert.match(renwickStatement, /Documents relied on/, "expected the Rule 18\\(b\\)\\(v\\) section to survive onto the filed face");
    assert.match(renwickStatement, /________________________________/, "expected a real signature line");
    assertMatchesGolden("witness-statement-filed", renwickStatement);

    const evidenceIndex = replaceStamp(result.documents.find((d) => d.file_name === "Evidence Index.md").markdown);
    assert.match(evidenceIndex, /\| Ex\. \| Date \| Description \| Tendered by \|/, "expected the Evidence Index table itself to survive onto the filed face");
    assertMatchesGolden("evidence-index-filed", evidenceIndex);
  } finally {
    f.cleanup();
  }
});

// Plan Phase 16: the caption and the Written Arguments read their venue from venue.md and a keyed
// map, never a default. A proceeding whose forum is a venue key nothing ships fails hard on each,
// naming the filing or the proceeding and the key, and nothing it prints falls back to VanIAC.
test("a fabricated venue key fails hard on the caption, the Written Arguments and the render, and never prints VanIAC", async () => {
  const f = seededDbFixture();
  try {
    await freshSubmissionDb(f.dbPath);
    await seedVaniacProceeding(f.dbPath);
    await submissionDataExecute(f.dbPath, "UPDATE proceedings SET forum = 'CAN/BC/Nowhere', court_or_centre = NULL WHERE id = 1;");
    const one = (sql) => submissionDataQuery(f.dbPath, sql, []).rows[0];
    const ctx = {
      dbPath: f.dbPath,
      proceeding: one("SELECT * FROM proceedings WHERE id = 1"),
      parties: submissionDataQuery(f.dbPath, "SELECT * FROM parties WHERE proceeding_id = 1 ORDER BY ordinal", []).rows,
      filing: one("SELECT * FROM filings WHERE id = 1"),
      revision: 1,
      rendered: "2026-09-26 10:00",
      clientName: "Ashbourne",
      clientNo: "2417",
      matterNo: "L4801",
      paragraphLedger: new Map(),
      lifecycle: { state: "drafting", since: null, readyToRetire: false },
      inventory: [],
      review: fetchReviewState(f.dbPath, 1),
    };
    const neverVaniac = (code, pattern) => (err) => {
      assert.equal(err.code, code);
      assert.match(err.message, pattern);
      assert.doesNotMatch(err.message, /vaniac/i);
      return true;
    };

    assert.throws(() => renderWrittenArguments(ctx, "form"), neverVaniac("venue_unknown", /Proceeding 1 has forum "CAN\/BC\/Nowhere", which has no Written Arguments settings/));
    assert.throws(() => renderWitnessStatements(ctx), neverVaniac("venue_missing", /Probanda has no layout for its court or tribunal, CAN\/BC\/Nowhere/));
    assert.throws(() => submissionFormsRender(f.dbPath, 1, { clientName: "Ashbourne", clientNo: "2417", matterNo: "L4801" }), neverVaniac("type_file_missing", /CAN\/BC\/Nowhere/));
    assert.deepEqual(readdirSync(f.draft), [], "a refused render writes nothing");
  } finally {
    f.cleanup();
  }
});

// Ticket 2026-09-01: a submission with neither a rested-on fact nor a
// required law assertion (the schema allows this) must never silently
// disappear from the mockup -- it renders its contention as an ordinary
// numbered paragraph, carrying 🧾 (no supporting fact) and 📚 (no stated law),
// and consumes exactly one paragraph number like any other submission.
test("a submission with no linked facts and no linked law still renders a numbered contention paragraph", async () => {
  const f = seededDbFixture();
  try {
    await freshSubmissionDb(f.dbPath);
    // No file number: the parties are linked by case_party_id to case data holding their counsel.
    writePartiesOfRecord(dirname(f.dbPath), {
      parties: [
        { id: 1, name: "Claimant Co.", counsel_name: "A. Lawyer" },
        { id: 2, name: "Respondent Co." },
      ],
    });
    await submissionDataExecute(
      f.dbPath,
      `
      INSERT INTO proceedings (id, matter_reference, forum, court_or_centre, registry, file_number, style_of_cause, courthouse_address)
        VALUES (1, 'L9999 - Empty', 'CAN/BC/Vancouver-International-Arbitration-Centre', 'VanIAC', NULL, NULL, 'Empty v. Test', NULL);

      INSERT INTO parties (id, proceeding_id, name, role, ordinal, is_client, is_applicant, to_be_served, case_party_id)
        VALUES
          (1, 1, 'Claimant Co.', 'Claimant', 1, 1, 1, 0, 1),
          (2, 1, 'Respondent Co.', 'Respondent', 2, 0, 0, 1, 2);

      INSERT INTO filings (id, proceeding_id, kind, subkind, round, title)
        VALUES (1, 1, 'submissions_package', NULL, 'opening', 'Opening Submissions Package');

      -- Submission 1 has neither a rested-on fact nor a required law
      -- assertion: it must still render its contention as paragraph 1.
      INSERT INTO submissions (id, proceeding_id, contention, ordinal)
        VALUES (1, 1, 'An empty submission with nothing linked yet.', 1);
      INSERT INTO filing_submissions (filing_id, submission_id, document, ordinal) VALUES (1, 1, 'form', 1);

      -- Submission 2 has one law assertion with a captured statement -- its
      -- own contention paragraph must number 2, proving submission 1 above
      -- consumed paragraph 1.
      INSERT INTO authorities (id, proceeding_id, style_of_cause_or_title, citation, kind, weight, treatment)
        VALUES (1, 1, 'Some Authority v. Other', '2020 BCCA 1', 'case', 'binding', 'good_law');
      INSERT INTO submissions (id, proceeding_id, contention, ordinal)
        VALUES (2, 1, 'A submission with real content.', 2);
      INSERT INTO filing_submissions (filing_id, submission_id, document, ordinal) VALUES (1, 2, 'form', 2);
      INSERT INTO law_assertions (id, proceeding_id, proposition, dead_end)
        VALUES (1, 1, 'a proposition with a captured statement', 0);
      INSERT INTO statements_of_law (id, proceeding_id, law_assertion_id, authority_id, pinpoint, excerpt, source, verification)
        VALUES (1, 1, 1, 1, 'para 1', 'the relevant excerpt', 'primary', 'verified');
      INSERT INTO submission_law (submission_id, law_assertion_id) VALUES (2, 1);

      -- Revision reset LAST: schema v21 triggers move db_meta.revision on every seeded row (#607).
      UPDATE db_meta SET value = '1' WHERE key = 'revision';
      `.trim()
    );

    const result = submissionFormsRender(f.dbPath, 1, { clientName: "Empty", clientNo: "9999", matterNo: "L9999" });
    const writtenArgument = result.documents.find((d) => d.document_type === "Written_arguments").markdown;

    const submission1Block = submissionBlock(writtenArgument, 1);
    assert.equal(
      submission1Block.trim(),
      "1. An empty submission with nothing linked yet. 🧾📚 <!-- submission_id 1 -->",
      "expected the empty submission's contention as a numbered paragraph, carrying 🧾 and 📚 for its missing facts and law"
    );

    const submission2Line = writtenArgument.split("\n").find((l) => l.includes("<!-- submission_id 2 -->"));
    assert.match(
      submission2Line,
      /^2\. A submission with real content\. 🧾/,
      "expected submission 2's contention to consume paragraph 2, proving submission 1's contention consumed paragraph 1"
    );
    const lawLine = writtenArgument.split("\n").find((l) => l.includes("<!-- law_assertion_id 1 -->"));
    assert.match(lawLine, /^3\. a proposition with a captured statement/, "expected the law paragraph to follow at 3");

    const filed = submissionFormsRender(f.dbPath, 1, { clientName: "Empty", clientNo: "9999", matterNo: "L9999" }, "filed");
    assertFiledFaceDocumentsClean(filed.documents);
    const filedWrittenArgument = filed.documents.find((d) => d.document_type === "Written_arguments").markdown;
    assert.doesNotMatch(filedWrittenArgument, /🧾|📚|submission_id/, "expected marker glyphs and id-trace comments stripped in filed mode");
    assert.match(
      filedWrittenArgument,
      /^1\. An empty submission with nothing linked yet\.$/m,
      "expected the empty submission's contention to survive as filed-face paragraph 1"
    );
    assert.match(
      filedWrittenArgument,
      /^3\. a proposition with a captured statement/m,
      "expected the real submission's law paragraph to still number 3 in filed mode"
    );
  } finally {
    f.cleanup();
  }
});

// Schema v48: counsel records that a contention needs no stated fact. The decision clears 🧾 and
// its factual-basis key, prints as a plain-text tag after the contention on the mockup, and never
// reaches the filed face. Rewording the contention clears the decision in the database, so 🧾 returns.
test("a submission counsel has recorded as needing no stated fact raises no 🧾, prints the tag on the mockup only, and a reworded contention brings 🧾 back", async () => {
  const f = seededDbFixture();
  try {
    await freshSubmissionDb(f.dbPath);
    writePartiesOfRecord(dirname(f.dbPath), {
      parties: [
        { id: 1, name: "Claimant Co.", counsel_name: "A. Lawyer" },
        { id: 2, name: "Respondent Co." },
      ],
    });
    await submissionDataExecute(
      f.dbPath,
      `
      INSERT INTO proceedings (id, matter_reference, forum, court_or_centre, registry, file_number, style_of_cause, courthouse_address)
        VALUES (1, 'L9999 - Law only', 'CAN/BC/Vancouver-International-Arbitration-Centre', 'VanIAC', NULL, NULL, 'Law v. Only', NULL);
      INSERT INTO parties (id, proceeding_id, name, role, ordinal, is_client, is_applicant, to_be_served, case_party_id)
        VALUES (1, 1, 'Claimant Co.', 'Claimant', 1, 1, 1, 0, 1), (2, 1, 'Respondent Co.', 'Respondent', 2, 0, 0, 1, 2);
      INSERT INTO filings (id, proceeding_id, kind, subkind, round, title)
        VALUES (1, 1, 'submissions_package', NULL, 'opening', 'Opening Submissions Package');
      INSERT INTO submissions (id, proceeding_id, contention, ordinal) VALUES (1, 1, 'The tribunal has jurisdiction.', 1);
      INSERT INTO filing_submissions (filing_id, submission_id, document, ordinal) VALUES (1, 1, 'form', 1);
      UPDATE submissions SET no_facts_needed_on = '2026-10-04', no_facts_needed_note = 'Jurisdiction turns on the arbitration agreement''s words alone.',
                             no_facts_needed_contention = contention WHERE id = 1;
      `.trim()
    );
    const render = (mode) => submissionFormsRender(f.dbPath, 1, { clientName: "Law", clientNo: "9999", matterNo: "L9999" }, mode);
    const contentionLine = (result, type) => result.documents.find((d) => d.document_type === type).markdown.split("\n").find((l) => l.includes("<!-- submission_id 1 -->"));
    const factualBasisEntries = (result) => {
      const manifest = join(f.draft, "Drafting records", "render-manifest-1.json");
      return JSON.parse(readFileSync(manifest, "utf-8")).inventory.filter((e) => e.marker === "🧾" && e.table === "submissions" && e.id === 1);
    };

    const decided = render("mockup");
    for (const type of ["Written_arguments"]) {
      const line = contentionLine(decided, type);
      assert.match(line, /^1\. The tribunal has jurisdiction\. \(no stated fact needed, per counsel 2026-10-04\)/, `${type}: ${line}`);
      assert.doesNotMatch(line, /🧾/, `${type}: ${line}`);
    }
    assert.deepEqual(factualBasisEntries(decided), [], "no factual-basis key is recorded");

    const filed = render("filed");
    assertFiledFaceDocumentsClean(filed.documents);
    const filedWrittenArgument = filed.documents.find((d) => d.document_type === "Written_arguments").markdown;
    assert.match(filedWrittenArgument, /^1\. The tribunal has jurisdiction\.$/m);
    assert.doesNotMatch(filedWrittenArgument, /no stated fact needed/);

    await submissionDataExecute(f.dbPath, "UPDATE submissions SET contention = 'The tribunal has jurisdiction over the counterclaim.' WHERE id = 1;");
    const reworded = render("mockup");
    const line = contentionLine(reworded, "Written_arguments");
    assert.match(line, /^1\. The tribunal has jurisdiction over the counterclaim\. 🧾/, line);
    assert.doesNotMatch(line, /no stated fact needed/);
    assert.ok(factualBasisEntries(reworded).length > 0, "the factual-basis key is recorded again");
  } finally {
    f.cleanup();
  }
});

// Schema v48: the tag prints only where the decision suppresses 🧾. A submission with a linked fact
// and a recorded decision prints neither the tag nor 🧾.
test("a submission with a recorded no-facts-needed decision and a linked fact prints neither the tag nor 🧾", async () => {
  const f = seededDbFixture();
  try {
    await freshSubmissionDb(f.dbPath);
    writePartiesOfRecord(dirname(f.dbPath), {
      parties: [
        { id: 1, name: "Claimant Co.", counsel_name: "A. Lawyer" },
        { id: 2, name: "Respondent Co." },
      ],
    });
    await submissionDataExecute(
      f.dbPath,
      `
      INSERT INTO proceedings (id, matter_reference, forum, court_or_centre, registry, file_number, style_of_cause, courthouse_address)
        VALUES (1, 'L9999 - Law only', 'CAN/BC/Vancouver-International-Arbitration-Centre', 'VanIAC', NULL, NULL, 'Law v. Only', NULL);
      INSERT INTO parties (id, proceeding_id, name, role, ordinal, is_client, is_applicant, to_be_served, case_party_id)
        VALUES (1, 1, 'Claimant Co.', 'Claimant', 1, 1, 1, 0, 1), (2, 1, 'Respondent Co.', 'Respondent', 2, 0, 0, 1, 2);
      INSERT INTO filings (id, proceeding_id, kind, subkind, round, title)
        VALUES (1, 1, 'submissions_package', NULL, 'opening', 'Opening Submissions Package');
      INSERT INTO submissions (id, proceeding_id, contention, ordinal) VALUES (1, 1, 'The tribunal has jurisdiction.', 1);
      INSERT INTO filing_submissions (filing_id, submission_id, document, ordinal) VALUES (1, 1, 'form', 1);
      INSERT INTO facts (id, proceeding_id, postulate) VALUES (1, 1, 'The parties signed the arbitration agreement.');
      INSERT INTO submission_facts (submission_id, fact_id) VALUES (1, 1);
      UPDATE submissions SET no_facts_needed_on = '2026-10-04', no_facts_needed_note = 'Jurisdiction turns on the arbitration agreement''s words alone.',
                             no_facts_needed_contention = contention WHERE id = 1;
      `.trim()
    );
    const result = submissionFormsRender(f.dbPath, 1, { clientName: "Law", clientNo: "9999", matterNo: "L9999" });
    for (const type of ["Written_arguments"]) {
      const line = result.documents.find((d) => d.document_type === type).markdown.split("\n").find((l) => l.includes("<!-- submission_id 1 -->"));
      assert.match(line, /^1\. The tribunal has jurisdiction\./, `${type}: ${line}`);
      assert.doesNotMatch(line, /no stated fact needed|🧾/, `${type}: ${line}`);
    }
  } finally {
    f.cleanup();
  }
});

// 📚 proposition needed (application-paragraphs spec §4.2-§4.3, schema v60): a contention with no
// linked proposition carries 📚 on its own line, which holds 🧐 back there. Linking a proposition
// clears it, and so does counsel's recorded no-law-needed decision, which prints a plain-text tag on
// the mockup only. Rewording the contention clears the decision in the database, so 📚 returns.
test("📚 marks a contention with no linked proposition, holds 🧐 back, and clears on a link or counsel's no-law-needed decision", async () => {
  const f = seededDbFixture();
  try {
    await freshSubmissionDb(f.dbPath);
    writePartiesOfRecord(dirname(f.dbPath), {
      parties: [
        { id: 1, name: "Claimant Co.", counsel_name: "A. Lawyer" },
        { id: 2, name: "Respondent Co." },
      ],
    });
    await submissionDataExecute(
      f.dbPath,
      `
      INSERT INTO proceedings (id, matter_reference, forum, court_or_centre, registry, file_number, style_of_cause, courthouse_address)
        VALUES (1, 'L9999 - Fact only', 'CAN/BC/Vancouver-International-Arbitration-Centre', 'VanIAC', NULL, NULL, 'Fact v. Only', NULL);
      INSERT INTO parties (id, proceeding_id, name, role, ordinal, is_client, is_applicant, to_be_served, case_party_id)
        VALUES (1, 1, 'Claimant Co.', 'Claimant', 1, 1, 1, 0, 1), (2, 1, 'Respondent Co.', 'Respondent', 2, 0, 0, 1, 2);
      INSERT INTO filings (id, proceeding_id, kind, subkind, round, title)
        VALUES (1, 1, 'submissions_package', NULL, 'opening', 'Opening Submissions Package');
      INSERT INTO submissions (id, proceeding_id, contention, ordinal)
        VALUES (1, 1, 'The respondent received the notice.', 1), (2, 1, 'The notice was delivered on time.', 2);
      INSERT INTO filing_submissions (filing_id, submission_id, document, ordinal) VALUES (1, 1, 'form', 1), (1, 2, 'form', 2);
      INSERT INTO facts (id, proceeding_id, postulate) VALUES (1, 1, 'The courier left the notice at the office on the second day.');
      INSERT INTO submission_facts (submission_id, fact_id) VALUES (1, 1), (2, 1);
      INSERT INTO law_assertions (id, proceeding_id, proposition, dead_end) VALUES (1, 1, 'A notice left at the office is received.', 0);
      `.trim()
    );
    const render = (mode) => submissionFormsRender(f.dbPath, 1, { clientName: "Fact", clientNo: "9999", matterNo: "L9999" }, mode);
    const contentionLine = (result, type, id) =>
      result.documents.find((d) => d.document_type === type).markdown.split("\n").find((l) => l.includes(`<!-- submission_id ${id} -->`));
    const propositionEntries = (result) => {
      const manifest = join(f.draft, "Drafting records", "render-manifest-1.json");
      return JSON.parse(readFileSync(manifest, "utf-8")).inventory
        .filter((e) => e.marker === "📚" && e.doc === "Written_arguments")
        .map((e) => `${e.slug}:${e.table}:${e.id}`);
    };

    // Neither submission links a proposition: 📚 on each contention line, and no 🧐 beside it.
    const bare = render("mockup");
    for (const type of ["Written_arguments"]) {
      assert.match(contentionLine(bare, type, 1), /^1\. The respondent received the notice\. 📚 <!-- submission_id 1 -->$/, type);
      assert.match(contentionLine(bare, type, 2), /^\d+\. The notice was delivered on time\. 📚 <!-- submission_id 2 -->$/, type);
    }
    assert.deepEqual(propositionEntries(bare), ["proposition:submissions:1", "proposition:submissions:2"]);

    // Linking a proposition clears 📚, and with nothing else owed on the line 🧐 shows.
    await submissionDataExecute(f.dbPath, "INSERT INTO submission_law (submission_id, law_assertion_id) VALUES (1, 1);");
    const linked = render("mockup");
    const linkedLine = contentionLine(linked, "Written_arguments", 1);
    assert.match(linkedLine, /^1\. The respondent received the notice\. 🧐 <!-- submission_id 1 -->$/, linkedLine);
    assert.deepEqual(propositionEntries(linked), ["proposition:submissions:2"]);

    // Counsel records that submission 2 needs no stated law: no 📚, the tag on the mockup only.
    await submissionDataExecute(
      f.dbPath,
      `UPDATE submissions SET no_law_needed_on = '2026-10-06', no_law_needed_note = 'Delivery is a question of fact alone.',
                              no_law_needed_contention = contention WHERE id = 2;`
    );
    const decided = render("mockup");
    for (const type of ["Written_arguments"]) {
      const line = contentionLine(decided, type, 2);
      assert.match(line, /^\d+\. The notice was delivered on time\. \(no stated law needed, per counsel 2026-10-06\)/, `${type}: ${line}`);
      assert.doesNotMatch(line, /📚/, `${type}: ${line}`);
    }
    assert.deepEqual(propositionEntries(decided), [], "no proposition key is recorded");

    const filed = render("filed");
    assertFiledFaceDocumentsClean(filed.documents);
    const filedWrittenArgument = filed.documents.find((d) => d.document_type === "Written_arguments").markdown;
    assert.match(filedWrittenArgument, /^\d+\. The notice was delivered on time\.$/m);
    assert.doesNotMatch(filedWrittenArgument, /no stated law needed|📚/);

    // Rewording the contention clears the decision, so 📚 returns.
    await submissionDataExecute(f.dbPath, "UPDATE submissions SET contention = 'The notice was delivered before the deadline.' WHERE id = 2;");
    const reworded = render("mockup");
    const line = contentionLine(reworded, "Written_arguments", 2);
    assert.match(line, /^\d+\. The notice was delivered before the deadline\. 📚 <!-- submission_id 2 -->$/, line);
    assert.deepEqual(propositionEntries(reworded), ["proposition:submissions:2"], "the proposition key is recorded again");
  } finally {
    f.cleanup();
  }
});

// Issue #351: bootstrap read schema_version first but rendered every filing
// before returning, so on a database behind the current schema it died inside a
// renderer (`no such table: admissions`) and the caller never got the version.
// draft/SKILL.md step 2 and the *Offer what the matter already
// knows* journey both open on that version being reported, so neither could run.
test("bootstrap reports a stale schema instead of throwing from a renderer", async () => {
  const f = seededDbFixture();
  try {
    await freshSubmissionDb(f.dbPath);
    await seedVaniacProceeding(f.dbPath);

    const current = currentSchemaVersion();
    // Behind the oldest version the runtime reads (v42, forms.ts MIN_READABLE_SCHEMA_VERSION), with an
    // earlier hop's table gone -- the exact shape
    // that threw (admissions predates the v8->v9 hop, which only adds a
    // column). Without the gate, bootstrap reaches fetchExhibitTenders and
    // dies on `admissions` before it can report anything.
    await submissionDataExecute(
      f.dbPath,
      `DROP TABLE admissions;
       UPDATE db_meta SET value = '41' WHERE key = 'schema_version';`
    );

    const result = submissionFormsBootstrap(f.dbPath, { clientName: "Ashbourne", clientNo: "2417", matterNo: "L4801" });
    assert.equal(result.schema_version, 41);
    assert.equal(result.current_schema_version, current);
    assert.equal(result.migration_required, true);
    assert.equal(result.bundle_outdated, false, "expected the stale-database refusal distinguishable from the ahead-database one");
    assert.deepEqual(result.filings, [], "a stale database must render nothing and list nothing");
    assert.match(result.note, /drafting_data__migrate/, "expected the note to name the remedy");
  } finally {
    f.cleanup();
  }
});

// Issue #352: the symmetric case -- a frozen installed bundle meeting a
// database a newer repo session already migrated ahead of it. Silently
// proceeding crashes inside a renderer or renders wrong output, so this must
// refuse just as the behind case does, but with a distinguishable flag and a
// remedy that does NOT point at drafting_data__migrate (migrating a
// database that is already ahead cannot help).
test("bootstrap refuses a database ahead of the installed bundle", async () => {
  const f = seededDbFixture();
  try {
    await freshSubmissionDb(f.dbPath);

    const current = currentSchemaVersion();
    await submissionDataExecute(f.dbPath, `UPDATE db_meta SET value = '${current + 1}' WHERE key = 'schema_version';`);

    const result = submissionFormsBootstrap(f.dbPath, { clientName: "Ashbourne", clientNo: "2417", matterNo: "L4801" });
    assert.equal(result.schema_version, current + 1);
    assert.equal(result.current_schema_version, current);
    assert.equal(result.migration_required, false);
    assert.equal(result.bundle_outdated, true);
    assert.deepEqual(result.filings, [], "an ahead-of-bundle database must render nothing and list nothing");
    assert.match(result.note, /\/lawyer:suggestion|fully restart the app/, "expected the note to name the actual remedy");
    assert.doesNotMatch(result.note, /drafting_data__migrate/, "migrating cannot help when the database is ahead of the bundle");
  } finally {
    f.cleanup();
  }
});

test("render refuses a database ahead of the installed bundle", async () => {
  const f = seededDbFixture();
  try {
    await freshSubmissionDb(f.dbPath);

    const current = currentSchemaVersion();
    await submissionDataExecute(f.dbPath, `UPDATE db_meta SET value = '${current + 1}' WHERE key = 'schema_version';`);

    // The gate fires before any filing lookup, so filing_id need not exist.
    const result = submissionFormsRender(f.dbPath, 1, { clientName: "Ashbourne", clientNo: "2417", matterNo: "L4801" });
    assert.deepEqual(result.documents, [], "an ahead-of-bundle database must render nothing");
    assert.equal(result.schema_version, current + 1);
    assert.equal(result.current_schema_version, current);
    assert.equal(result.bundle_outdated, true);
    assert.equal(result.revision, undefined, "a refused render never computes a revision");
    assert.doesNotMatch(result.note, /drafting_data__migrate/, "migrating cannot help when the database is ahead of the bundle");
  } finally {
    f.cleanup();
  }
});

// A stale database must not come back looking like a healthy one, so the
// healthy response has to carry the same two version fields and say so.
test("bootstrap reports migration_required false on a current database", async () => {
  const f = seededDbFixture();
  try {
    await freshSubmissionDb(f.dbPath);
    await seedVaniacProceeding(f.dbPath);

    const result = submissionFormsBootstrap(f.dbPath, { clientName: "Ashbourne", clientNo: "2417", matterNo: "L4801" });
    assert.equal(result.migration_required, false);
    assert.equal(result.bundle_outdated, false);
    assert.equal(result.current_schema_version, currentSchemaVersion());
    assert.equal(result.schema_version, result.current_schema_version);
  } finally {
    f.cleanup();
  }
});

test("bootstrap lists a seeded matter's filings and reports the schema version, rendering nothing", async () => {
  const f = seededDbFixture();
  try {
    await freshSubmissionDb(f.dbPath);
    await seedVaniacProceeding(f.dbPath);

    const result = submissionFormsBootstrap(f.dbPath, { clientName: "Ashbourne", clientNo: "2417", matterNo: "L4801" });
    assert.equal(result.db_path, f.dbPath);
    assert.equal(result.schema_version, currentSchemaVersion());
    assert.equal(result.filings.length, 1);
    // #584: the critical path is SQLite plus one manifest read. Nothing has been rendered for
    // this matter yet, so there is nothing on disk to list and render_state says exactly that.
    assert.deepEqual(result.filings[0].paths, [], "bootstrap must report only what is on disk");
    assert.equal(result.filings[0].render_state, "never");
    assert.deepEqual(readdirSync(f.draft), [], "bootstrap must not write a mockup at all");

    // Once the filing is rendered, bootstrap reports its files -- still without rendering them.
    const rendered = submissionFormsRender(f.dbPath, 1, { clientName: "Ashbourne", clientNo: "2417", matterNo: "L4801" });
    assert.equal(rendered.documents.length, 7);

    const after = submissionFormsBootstrap(f.dbPath, { clientName: "Ashbourne", clientNo: "2417", matterNo: "L4801" });
    // Written Arguments (venue) + 4 witness statements + evidence index; the Work Board
    // is no file of the filing's since #1365.
    assert.equal(after.filings[0].paths.length, 6);
    for (const p of after.filings[0].paths) assert.ok(existsSync(p), `expected ${p} to exist`);
    assert.equal(after.filings[0].render_state, "fresh");
  } finally {
    f.cleanup();
  }
});

// One deliberate exception to "byte-identical" (ADR 0013): the hearing date and
// time in the Notice of Application's "on <date> at <time> for the orders" sentence
// and the BCCA response book's "returnable <date> at <time>" sentence are withheld
// from the returned markdown only. The fixtures below have no hearing row; do not
// "fix" the divergence where one exists -- see the ADR 0013 tests further down.
//
// Issue #337: a session never opens the mockup paths it is handed (the rule
// outlived the move into the matter folder, docs/ADRs/0013). render's response is
// the only channel it reads -- if it carries no markdown, ADR 0005's
// "orient from the mockup" rule has no working path and a session falls back to
// the query battery ADR 0005 exists to forbid.
test("render returns each document's markdown, byte-identical to the file it wrote", async () => {
  const f = seededDbFixture();
  try {
    await freshSubmissionDb(f.dbPath);
    await seedVaniacProceeding(f.dbPath);

    const result = submissionFormsRender(f.dbPath, 1, { clientName: "Ashbourne", clientNo: "2417", matterNo: "L4801" });

    // Written Arguments (venue) + 4 witness statements + evidence index, then the
    // Work Board's entry (#1365), with no file of the filing's, no page without a draft folder, and no
    // summary unless the board is named in documents.
    assert.equal(result.documents.length, 7);
    for (const doc of result.documents) {
      assert.ok(doc.document_type, "expected every returned document to name its type");
      if (doc.document_type === "Work_board") {
        assert.equal(doc.path, undefined, "no page is written without a draft folder");
        assert.equal(doc.board_summary, undefined, "the board is not named, so no summary");
        continue;
      }
      assert.equal(doc.markdown, readFileSync(doc.path, "utf-8"), `markdown for ${doc.path} differs from the written file`);
    }

    // The work markers are the whole point of returning the text -- a session
    // reads these to build its worklist.
    const writtenArgument = result.documents.find((d) => d.document_type === "Written_arguments");
    assert.ok(writtenArgument, "expected a Written_arguments document");
    assert.match(writtenArgument.markdown, /Revision: 1/, "expected the revision stamp in the returned markdown");
  } finally {
    f.cleanup();
  }
});

// Issue #337: bootstrap renders every filing of every proceeding and a session
// works one of them. Returning all that text on entry spends the tokens before
// the practitioner has confirmed which filing they meant, so bootstrap stays
// content-free and render on the confirmed filing supplies the content.
// #609: session_token used to be `${process.pid}-${module load time}`, which is one value for
// the whole server process. Under Cowork one server is shared by every session on the machine,
// so two concurrent sessions received byte-identical tokens and tickets.locked_by could not tell
// them apart -- observed live twice. Identity is now minted per bootstrap call.
test("each bootstrap mints its own session identity, and render only echoes one back", async () => {
  const f = seededDbFixture();
  try {
    await freshSubmissionDb(f.dbPath);
    await seedVaniacProceeding(f.dbPath);
    const client = { clientName: "Ashbourne", clientNo: "2417", matterNo: "L4801" };

    // Two sessions against this one server process -- the case the old token could not separate.
    const first = submissionFormsBootstrap(f.dbPath, client);
    const second = submissionFormsBootstrap(f.dbPath, client);

    assert.ok(first.session_token, "bootstrap must issue an identity on success");
    assert.ok(second.session_token, "bootstrap must issue an identity on success");
    assert.notEqual(
      first.session_token,
      second.session_token,
      "two bootstraps in one process must yield different identities -- this is the whole fix"
    );
    assert.ok(
      !first.session_token.includes(String(process.pid)),
      "identity must not be derived from the server process (#586, #609)"
    );

    // #609 decision 4: bootstrap anchors the session's own start on the same wall clock
    // tickets.locked_at is written on, so the bootstrap-to-first-render window is covered.
    assert.match(first.bootstrapped_at, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/, "expected a YYYY-MM-DD HH:mm stamp");

    // The other half of the constraint: one session keeps ONE identity across its own renders,
    // so it can still recognise a lock it placed itself. Render echoes, it never mints.
    const echoed = submissionFormsRender(f.dbPath, 1, client, "mockup", undefined, undefined, undefined, undefined, first.session_token);
    assert.equal(echoed.session_token, first.session_token, "render must echo the caller's identity unchanged");

    const anonymous = submissionFormsRender(f.dbPath, 1, client);
    assert.equal(anonymous.session_token, undefined, "render mints nothing -- no token in, no token out");
  } finally {
    f.cleanup();
  }
});

test("bootstrap returns paths only, never markdown", async () => {
  const f = seededDbFixture();
  try {
    await freshSubmissionDb(f.dbPath);
    await seedVaniacProceeding(f.dbPath);

    const result = submissionFormsBootstrap(f.dbPath, { clientName: "Ashbourne", clientNo: "2417", matterNo: "L4801" });

    const serialized = JSON.stringify(result);
    assert.ok(!serialized.includes("markdown"), "expected no markdown key anywhere in the bootstrap result");
    assert.ok(
      !serialized.includes("Revision:"),
      "expected no rendered document body in the bootstrap result -- it must stay cheap enough to call before the practitioner confirms the filing"
    );
  } finally {
    f.cleanup();
  }
});

// Brief 2026-09-14 §0 (#579): every later bootstrap optimisation is measured against these phases.
test("bootstrap and render report per-phase timings", async () => {
  const f = seededDbFixture();
  try {
    await freshSubmissionDb(f.dbPath);
    await seedVaniacProceeding(f.dbPath);
    const client = { clientName: "Ashbourne", clientNo: "2417", matterNo: "L4801" };
    const assertTimings = (timings, required) => {
      assert.ok(Array.isArray(timings), "expected a timings array");
      for (const t of timings) assert.ok(typeof t.phase === "string" && Number.isFinite(t.ms) && t.ms >= 0, `bad timing ${JSON.stringify(t)}`);
      const phases = timings.map((t) => t.phase);
      for (const phase of required) assert.ok(phases.includes(phase), `expected phase "${phase}" in ${JSON.stringify(phases)}`);
    };

    const render = submissionFormsRender(f.dbPath, 1, client);
    const files = render.documents.filter((d) => d.document_type !== "Work_board").map((d) => d.file_name);
    const perDocument = [...new Set(files.map((name) => (name.startsWith("Witness Statement") ? "render Witness statements" : `render ${name}`)))];
    assertTimings(render.timings, ["schema_check", "load_filing", ...perDocument, ...files.map((name) => `write ${name}`), "remove retired board files", "board_section", "total"]);

    const bootstrap = submissionFormsBootstrap(f.dbPath, client);
    assertTimings(bootstrap.timings, ["schema_check", "revision", "filing_list", "filing_entries", "order", "total"]);
    // #584's acceptance, as a standing assertion rather than a one-off measurement: bootstrap
    // must not scale with document count. A phase named for a document, a write, or one
    // filing's own work would mean a render had returned to the critical path.
    for (const t of bootstrap.timings) {
      assert.ok(!/^render |^write |board_write|^filing \d+:/.test(t.phase), `bootstrap must render nothing: found phase "${t.phase}"`);
    }
  } finally {
    f.cleanup();
  }
});

test("render archives the previous mockup only when db_meta.revision has moved", async () => {
  const f = seededDbFixture();
  try {
    await freshSubmissionDb(f.dbPath);
    await seedVaniacProceeding(f.dbPath);

    const first = submissionFormsRender(f.dbPath, 1, { clientName: "Ashbourne", clientNo: "2417", matterNo: "L4801" });
    const baseDir = dirname(first.documents[0].path);
    const archiveDir = join(baseDir, "archive");

    // Re-render at the same revision: no archive copy.
    submissionFormsRender(f.dbPath, 1, { clientName: "Ashbourne", clientNo: "2417", matterNo: "L4801" });
    assert.ok(!existsSync(archiveDir), "expected no archive directory before the revision moved");

    await submissionDataExecute(f.dbPath, "UPDATE db_meta SET value = '2' WHERE key = 'revision';");
    const second = submissionFormsRender(f.dbPath, 1, { clientName: "Ashbourne", clientNo: "2417", matterNo: "L4801" });
    assert.equal(second.revision, 2);
    assert.ok(existsSync(archiveDir), "expected an archive directory after the revision moved");
    const archived = readdirSync(archiveDir);
    assert.ok(
      archived.some((name) => name.startsWith("Written Arguments @rev1 ")),
      `expected an archived rev1 copy, found: ${archived.join(", ")}`
    );
  } finally {
    f.cleanup();
  }
});
