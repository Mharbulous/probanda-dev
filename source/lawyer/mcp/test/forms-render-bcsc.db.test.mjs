// Golden-fixture tests for the submission form renderers (build ticket #297): BCSC forms: Form 32 Notice of Application (including hearing withholding), the default-judgment and consent-order requisitions.
// Split out of the former forms-render.test.mjs; shared seeds live in fixtures/forms-render-seeds.mjs,
// which also documents regenerating the golden fixtures.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { seededDbFixture, seedBcscConsentOrder, seedBcscDefaultJudgment, assertMatchesGolden, findFile, ASHBOURNE, draftFolder, replaceStamp } from "./fixtures/forms-render-seeds.mjs";
import { knowledgeFixture } from "./helpers/knowledge-fixture.mjs";
const { freshSubmissionDb, seedSql } = await import("./helpers/template-db.mjs");
const { assertFiledFaceDocumentsClean } = await import("./helpers/filed-face-scan.mjs");
const { submissionDataExecute } = await import("../build/submission/backend.js");
const { submissionFormsRender, submissionFormsEmitForm32, submissionFormsEmitForm33 } = await import("../build/submission/forms.js");
const { MOCKUP_ONLY_TAG } = await import("../build/submission/forms/markers.js");

test("renders BCSC Form 32 notice of application", async () => {
  const f = seededDbFixture();
  try {
    await freshSubmissionDb(f.dbPath);
    await seedBcscDefaultJudgment(f.dbPath); // reuse the same proceeding/party shape
    await submissionDataExecute(
      f.dbPath,
      `
      INSERT INTO hearing_details (filing_id, hearing_date, hearing_time, time_estimate_minutes, associate_judge)
        VALUES (1, '2026-09-01', '9:45 am', 45, 1);

      UPDATE filings SET kind = 'notice_of_application', subkind = NULL, title = 'Notice of Application' WHERE id = 1;

      INSERT INTO facts (id, proceeding_id, postulate)
        VALUES
          (1, 1, 'Corbin Vasey has not filed a response to civil claim.'),
          (2, 1, 'The property was inspected and found vacant on the relevant date.'),
          (3, 1, 'The final walkthrough occurred before handover.');
      -- filing_facts.section renamed to .part, gains a document discriminator
      -- (schema v10, #380) -- 'form' for the venue document's own Part 2.
      INSERT INTO filing_facts (filing_id, fact_id, document, part, ordinal) VALUES (1, 1, 'form', 'part2', 1), (1, 2, 'form', 'part2', 2), (1, 3, 'form', 'part2', 3);
      -- Fact 1's Written Argument pointer, carrying this kind's own part value
      -- exactly as checklists section 9 requires of a both-documents pair. It
      -- is an accounting pointer only and must put nothing on the rendered
      -- form; unfiltered, it renders fact 1 a second time in PART 2.
      INSERT INTO filing_facts (filing_id, fact_id, document, part, ordinal) VALUES (1, 1, 'written_argument', 'part2', 1);

      -- Issue #361: fact 3's sole admission is denied by the sole opposing
      -- party (Corbin Vasey) -- proves PART 2 also prefixes the denied
      -- admission's event glyph onto the fact-side 👤, mirroring fact 12's
      -- scenario in the Written Argument. No response_due, same as fact 12's
      -- seed -- keeps the classification date-stable.
      INSERT INTO documents (id, proceeding_id, label, document_date, description, served_on)
        VALUES (2, 1, 'Notice to Admit dated 2026-06-05', '2026-06-05', NULL, '2026-06-05');
      INSERT INTO documents (id, proceeding_id, label, document_date, description)
        VALUES (3, 1, 'Response to Notice to Admit dated 2026-06-20', '2026-06-20', NULL);
      INSERT INTO admissions (id, proceeding_id, fact_id, party, method, instrument, instrument_pinpoint, response, response_pinpoint, response_excerpt, answer)
        VALUES (1, 1, 3, 2, 'notice_to_admit', 2, 'item 1', 3, 'item 1', 'refused to admit the walkthrough occurred as described', 'denied');

      -- #360/#362: fact 1 remodelled from the mislabelled 'court_record' write to a
      -- pleading-route deemed admission: the served Notice of Civil Claim with the
      -- response period expired and no response derives 'tender' (base deemed) ->
      -- role "tenders" -> the sole opposing party covers fact 1, so its line and its
      -- PART 3 postulate line render clean exactly as the old flat guard did.
      INSERT INTO documents (id, proceeding_id, label, document_date, description, served_on)
        VALUES (4, 1, 'Notice of Civil Claim', '2026-06-01', NULL, '2026-06-10');
      INSERT INTO admissions (id, proceeding_id, fact_id, party, method, instrument, instrument_pinpoint, response_due)
        VALUES (2, 1, 1, 2, 'pleading', 4, 'paras 1-12', '2026-07-02');

      INSERT INTO witnesses (id, proceeding_id, name, relationship)
        VALUES (1, 1, 'P. Inspector', 'property inspector'), (2, 1, 'Q. Neighbour', 'neighbouring occupant');

      -- Issue #364: statement 1's instrument, an already-sworn affidavit --
      -- execution set so statementOfFactMarkers' ✍️/✒️ branches are unaffected
      -- (interviewed=1 + instrument set + execution set already skips both);
      -- the only new glyph this adds to fact 2's line is 🏆 (unmarked copy),
      -- isolating PART 2's own tokens-loop wiring from the pre-existing
      -- sign-it ladder.
      INSERT INTO documents (id, proceeding_id, label, instrument, deponent, execution, signed_at)
        VALUES (5, 1, 'Affidavit of P. Inspector', 'affidavit', 1, '2026-06-01', 'Vancouver, BC');

      -- Phase C defect 1 (#777): fact 1 is covered by the pleading-route admission above, so the
      -- unless-admitted guard silences its evidence work. This statement links an executed affidavit with
      -- no instrument pinpoint -- 🧷 would fire on fact 1's PART 2 line if the pin sat outside the guard.
      -- is_best_copy=1 keeps 🏆 (not silenced) off the line so the assertion isolates the pin.
      INSERT INTO documents (id, proceeding_id, label, instrument, deponent, execution, signed_at, is_best_copy)
        VALUES (8, 1, 'Affidavit of Q. Neighbour', 'affidavit', 2, '2026-06-02', 'Vancouver, BC', 1);
      INSERT INTO statements_of_fact (id, proceeding_id, fact_id, witness_id, interviewed, instrument)
        VALUES (3, 1, 1, 2, 1, 8);

      -- two statements_of_fact rows on fact 2 (schema v3, #328: every
      -- statement is witness-backed -- document-only evidence_uses rows are
      -- struck). After the #511 basis split these two pin *which* statement
      -- owes a locator, not the per-statement dedupe: statement 1 is linked to
      -- instrument 5 with no pinpoint, so it owes 🧷; statement 2 has no
      -- instrument, so the SSOT owes it no locator and it emits nothing. The
      -- unit-level form of issue 322's once-per-line dedupe lives in
      -- markers-capture.unit.test.mjs.
      INSERT INTO statements_of_fact (id, proceeding_id, fact_id, witness_id, interviewed, instrument)
        VALUES
          (1, 1, 2, 1, 1, 5),
          (2, 1, 2, 2, 1, NULL);

      -- One submission for PART 3 (issue #321: same shape as the Written
      -- Argument's Submissions body) so this golden fixture actually
      -- exercises the new renderSubmissionBody path, not just an empty
      -- Part 3. Rests_on fact 1 (covered by the pleading-route admission
      -- above -- the unless-admitted guard silences its statement markers,
      -- a clean postulate line); requires one law assertion with a
      -- captured statement of law.
      INSERT INTO authorities (id, proceeding_id, style_of_cause_or_title, citation, kind, weight, treatment)
        VALUES (1, 1, 'Miazga v. Kvello Estate', '2009 SCC 51', 'case', 'binding', 'good_law');
      INSERT INTO submissions (id, proceeding_id, contention, ordinal)
        VALUES (1, 1, 'Corbin Vasey is in default under the Rules.', 1);
      INSERT INTO law_assertions (id, proceeding_id, proposition, dead_end)
        VALUES (1, 1, 'a defendant who fails to file a response to civil claim within the prescribed time is in default', 0);
      -- source (schema v9, issue #365) deliberately left unset (NULL) here --
      -- exercises the unrated-default 🥉 case end-to-end in PART 3, the twin
      -- of the primary/secondary cases already covered in the VanIAC fixture.
      INSERT INTO statements_of_law (id, proceeding_id, law_assertion_id, authority_id, pinpoint, excerpt, verification)
        VALUES (1, 1, 1, 1, 'para 15', 'default judgment may be entered once the response period has expired without a filed response', 'verified');
      INSERT INTO submission_law (submission_id, law_assertion_id) VALUES (1, 1);
      INSERT INTO submission_facts (submission_id, fact_id) VALUES (1, 1);
      INSERT INTO filing_submissions (filing_id, submission_id, document, ordinal) VALUES (1, 1, 'form', 1);

      -- Issue #348, re-shaped by #380 onto order_sought_requires: order 1
      -- ('damages to be assessed') gets a jurisdictional basis reusing
      -- authority 1 (Miazga, good_law) -- a standalone statements_of_law row
      -- (law_assertion_id NULL, not a doctrinal proposition), fully captured
      -- -- exercises the ladder's clean case (renders nothing). Order 2
      -- ('costs to be assessed') gets no requires edge at all -- fails
      -- toward showing work, still renders 🏛️.
      INSERT INTO statements_of_law (id, proceeding_id, law_assertion_id, authority_id, pinpoint, excerpt, verification)
        VALUES (2, 1, NULL, 1, 'para 3', 'the court retains inherent jurisdiction to grant damages to be assessed', 'verified');
      INSERT INTO order_sought_requires (order_sought_id, excerpt_id, basis_state) VALUES (1, 2, 'filled');
      -- 🦵 unserved petitum needs a serving submission (schema v10, #380).
      INSERT INTO order_sought_served_by (order_sought_id, submission_id) VALUES (1, 1), (2, 1);

      -- Order 5 carries a jurisdictional edge 'filled' against a statement of a KILLED authority
      -- (schema v16). A killed item's own lines render no marker of any type (design §4,
      -- ticket #796), so that edge contributes exactly 🏛️: the practitioner rejected the
      -- authority, so the power to make the order is still owed. Everything on the killed
      -- statement is clean (excerpt + pinpoint captured, verified) and its authority's treatment
      -- is left NULL, so the only glyph the edge could have printed besides 🏛️ is 📇 -- which
      -- the silencing rule now withholds.
      --
      -- In-path presence control (it replaces the 📇 one, which this change silenced): order 5
      -- gets a SECOND edge, 'filled' against a LIVE authority (1, good_law), fully captured,
      -- verified and UNRATED, so the line reads 🏛️ 🏅. Both halves are load-bearing:
      --   * 🏅 proves the edges were fetched at all. An order with no edge renders the synthetic
      --     🏛️ alone (jurisdictionLadderMarker([]) fails toward showing work) and can never
      --     produce 🏅, which reads sl.source over the statements_of_law LEFT JOIN.
      --   * 🏛️ proves the killed edge among them was read. [live-unrated] alone renders 🏅 and
      --     no 🏛️ -- its basis is filled -- so 🏛️ here can only come from the killed edge. And
      --     had the authorities LEFT JOIN not delivered killed_on, that edge would have read as
      --     live with treatment NULL and printed 📇; the absence of 📇 pins it as arriving.
      INSERT INTO authorities (id, proceeding_id, style_of_cause_or_title, citation, kind, weight, killed_on)
        VALUES (2, 1, 'Rejected Authority v. Z', '2015 BCSC 77', 'case', 'binding', '2026-09-02');
      INSERT INTO statements_of_law (id, proceeding_id, law_assertion_id, authority_id, pinpoint, excerpt, verification)
        VALUES (3, 1, NULL, 2, 'para 9', 'a passage the practitioner reviewed and rejected before filing', 'verified');
      INSERT INTO statements_of_law (id, proceeding_id, law_assertion_id, authority_id, pinpoint, excerpt, verification)
        VALUES (4, 1, NULL, 1, 'para 4', 'the court may grant the further relief this order seeks', 'verified');
      INSERT INTO order_sought (id, proceeding_id, wording)
        VALUES (5, 1, 'an order resting on a rejected authority');
      INSERT INTO order_sought_requires (order_sought_id, excerpt_id, basis_state) VALUES (5, 3, 'filled'), (5, 4, 'filled');
      INSERT INTO order_sought_served_by (order_sought_id, submission_id) VALUES (5, 1);
      INSERT INTO filing_orders (filing_id, order_sought_id, document, ordinal) VALUES (1, 5, 'form', 4);

      -- Issue #367, superseded by #380: crossed-out (order_sought.crossed_out_on)
      -- replaces the old disposition='reserved' inline-strikethrough workaround
      -- -- a deployed order the practitioner isn't pursuing, kept visible and
      -- restorable, rendered with no glyph (work-markers.md rule 5). Seeded
      -- between orders 1 and 2 (ordinal 2) to prove it interleaves in filing
      -- order rather than always sorting last.
      INSERT INTO order_sought (id, proceeding_id, wording, crossed_out_on)
        VALUES (4, 1, 'leave to file a further affidavit at the hearing', '2026-08-20');
      UPDATE filing_orders SET ordinal = 3 WHERE filing_id = 1 AND order_sought_id = 2;
      INSERT INTO filing_orders (filing_id, order_sought_id, document, ordinal) VALUES (1, 4, 'form', 2);

      -- Issue #398: exhibit-side 👤 parity on Part 4, gated to role='evidence'/
      -- 'other' (dual-approved role scope). is_best_copy=1 keeps 🏆 off these
      -- two lines, isolating the 👤 assertion (a singleton unmarked group
      -- still fires 🏆 -- no group-size gate, markers.ts notBestCopyMarkers).
      -- Document 6 is tendered by the existing statement of fact on fact 2
      -- (witness Q. Neighbour, statement id 2) -- clean, no 👤. Document 7 is
      -- tendered only by the existing denied admission (id 1) -- 👤 fires with
      -- the denied admission's event glyph prefixed, mirroring the VanIAC
      -- Evidence Index's Ex. 4 case (#345) on this surface. Document 1
      -- (role='order', 'Draft default judgment') stays untouched -- the
      -- excluded-role regression case comes free from the base seed.
      INSERT INTO documents (id, proceeding_id, label, document_date, is_best_copy)
        VALUES
          (6, 1, 'Inspection Report', '2026-05-15', 1),
          (7, 1, 'Unsourced site photograph', NULL, 1);
      UPDATE statements_of_fact SET exhibit_id = 6 WHERE id = 2;
      UPDATE admissions SET exhibit = 7 WHERE id = 1;
      INSERT INTO filing_documents (filing_id, document_id, ordinal, role) VALUES (1, 6, 2, 'evidence'), (1, 7, 3, 'evidence');

      -- Golden fixture pins Revision: 1, and every write above moves it
      -- through v21's triggers. Reset last (#607).
      UPDATE db_meta SET value = '1' WHERE key = 'revision';
      `.trim()
    );

    const result = submissionFormsRender(f.dbPath, 1, { clientName: "Halloway", clientNo: "3120", matterNo: "L9002" });
    const baseDir = dirname(result.documents[0].path);
    const noticeOfApplication = replaceStamp(findFile(baseDir, "Notice of Application.md"));

    // The seeded document='written_argument' pointer row is an accounting
    // pointer (checklists section 9): PART 2 lists the three form facts only.
    const part2Section = noticeOfApplication.split("## PART 2")[1].split("## PART 3")[0];
    assert.equal(
      (part2Section.match(/<!-- fact \d+ -->/g) ?? []).length,
      3,
      "expected the written_argument pointer row not to render a fourth PART 2 fact"
    );
    assert.equal(
      (part2Section.match(/Corbin Vasey has not filed a response to civil claim\./g) ?? []).length,
      1,
      "expected fact 1's postulate to render once, not once per filing_facts pointer row"
    );

    const fact2Line = noticeOfApplication
      .split("\n")
      .find((l) => l.includes("The property was inspected and found vacant"));
    const pinpointGlyphCount = (fact2Line.match(/🧷/g) ?? []).length;
    assert.equal(
      pinpointGlyphCount,
      1,
      `expected exactly one 🧷 on fact 2's line -- statement 1 owes its instrument's locator, statement 2 has no instrument and owes none, got: ${fact2Line}`
    );

    // Issue #361: PART 2's own fact-side twin of the Ex.4 / fact-12 assertions.
    const fact3Line = noticeOfApplication.split("\n").find((l) => l.includes("<!-- fact 3 -->"));
    assert.match(fact3Line, /🙅🏻‍♂️👤/, "expected the denied admission's event glyph to prefix the fact-side 👤 in PART 2, fused as one set");

    // Phase C defect 1 (#777): fact 1 is admitted against the sole opposing party; its statement 3 has an
    // instrument and no pinpoint, which owes 🧷 only outside the guard.
    // fact 2's pinpointGlyphCount assertion above is the same-query-path control: it proves PART 2's
    // fetchStatementsOfFact really returns statements and really emits pins, so a silent empty result
    // cannot make the guard assertion below pass vacuously.
    const fact1Line = part2Section.split("\n").find((l) => l.startsWith("1. "));
    assert.doesNotMatch(fact1Line, /🧷|📌/, "expected the fact-side pins silenced by the unless-admitted guard");
    // Fact 1 is in PART 2, so PART 3 names its paragraph number instead of re-printing it with its
    // statement 3 beneath (the submission is form-only here, so this document is its one surface).
    const part3OfNoa = noticeOfApplication.split("## PART 3: LEGAL BASIS")[1].split("## PART 4")[0];
    assert.doesNotMatch(part3OfNoa, /<!-- fact_id/, "expected no linked fact re-printed in PART 3 when it is already a PART 2 paragraph");
    assert.doesNotMatch(part3OfNoa, /statement_of_fact_id/, "expected no statement re-printed in PART 3 under a fact already in PART 2");
    assert.match(
      part3OfNoa.split("\n").find((l) => l.includes("<!-- submission_id 1 -->")),
      /<!-- submission_id 1 --> <!-- supporting fact paragraphs: 1 -->$/,
      "expected the contention line to name fact 1's PART 2 paragraph number"
    );

    // Issue #348: relief 1's jurisdictional basis is fully captured and
    // good_law -- clean, no marker. Relief 2 stays 'filled' with no linked
    // statement -- fails toward showing work, still renders 🏛️.
    const part1Section = noticeOfApplication.split("## PART 1: ORDER(S) SOUGHT")[1].split("## PART 2")[0];
    const relief1Line = part1Section.split("\n").find((l) => l.includes("<!-- order 1 -->"));
    assert.ok(relief1Line, "expected relief 1's order line to render as order 1 (positional, not DB id)");
    assert.doesNotMatch(
      relief1Line,
      /🏛️|📜|💬|📍|👃|📇|⚠️|🚨|⛔|🥉|🥈/,
      "expected relief 1's fully-captured good-law jurisdictional basis to render clean -- issue #365's source rung is doctrinal-only and must never leak onto this jurisdictional line"
    );
    // Issue #367, #380: order 2 sits after the crossed-out order 4 in filing
    // order, so it renders as order 2 (positional) despite being DB id 2.
    const relief2Line = part1Section.split("\n").find((l) => l.includes("<!-- order 2 -->"));
    assert.ok(relief2Line, "expected order 2's line to render as order 2 (positional, after the crossed-out order)");
    assert.match(relief2Line, /🏛️/, "expected an order with no requires edge at all to fail toward showing work");

    // Design §4 (#796): a killed item's own lines render no marker of any type. Order 5's
    // killed-authority edge therefore contributes exactly 🏛️ -- the power to make the order is
    // still owed, this renderer's only surface for it -- and no 📇, though the authority is not
    // noted up. Its live sibling edge supplies 🏅 (see the seed comment for why both halves are
    // the in-path presence control that replaced the silenced 📇 one).
    const relief3Line = part1Section.split("\n").find((l) => l.includes("<!-- order 3 -->"));
    assert.ok(relief3Line, "expected the killed-authority order to render as order 3 (positional)");
    assert.match(relief3Line, /🏛️/, "expected 🏛️ from the 'filled' edge that rests on a killed authority");
    assert.doesNotMatch(relief3Line, /📇|📜|📍|🔬|⚠️|🚨|⛔/, "expected every marker withheld from the killed authority's own edge");
    assert.match(relief3Line, /🏅/, "expected the live sibling edge's unrated marker, proving the edges were fetched at all");
    // Control for the 🏅 assertion above: relief 1 carries the same ladder on a LIVE authority --
    // its statement is unrated too, so 🏅 does render there. Without this a renderer that had
    // simply stopped emitting 🏅 would pass it.
    assert.match(relief1Line, /🏅/, "expected the unrated marker on a live authority's jurisdictional statement");

    // Issue #367, superseded by #380: the crossed-out order (order 4) renders
    // inline between orders 1 and 2 (its filing position), struck and
    // unnumbered, no glyph (work-markers.md rule 5 -- strikethrough alone is
    // the rendering; crossed-out is not "held in reserve", so no 🂡) -- never
    // in a trailing "Held in reserve" section, which this form does not have
    // and never has.
    const crossedOutLine = part1Section.split("\n").find((l) => l.includes("<!-- order crossed-out 1 -->"));
    assert.ok(crossedOutLine, "expected the crossed-out order to render inline in Part 1");
    assert.equal(crossedOutLine.trim(), "~~leave to file a further affidavit at the hearing~~ <!-- order crossed-out 1 -->", "expected the crossed-out order struck through, unnumbered, and carrying no glyph");
    assert.doesNotMatch(noticeOfApplication, /## Held in reserve/, "expected no Held-in-reserve trailing section on the Notice of Application");

    const part3Section = noticeOfApplication.split("## PART 3: LEGAL BASIS")[1].split("## PART 4")[0];
    assert.match(part3Section, /^\d+\. Corbin Vasey is in default under the Rules\./m, "expected the contention as the submission's own opening paragraph");
    assert.doesNotMatch(part3Section, /Corbin Vasey has not filed a response to civil claim\./, "expected the rested-on postulate, already PART 2 paragraph 1, not to render again under the submission");
    assert.match(
      part3Section,
      /```\n   default judgment may be entered once the response period has expired without a filed response\n   ```\n   > \*Miazga v\. Kvello Estate\*, 2009 SCC 51, para 15/,
      "expected the required proposition's statement of law as a fenced quote, citation as its own blockquote line after the fence (ticket 2026-08-31)"
    );

    // Issue #398: exhibit-side 👤 parity on Part 4, gated to role='evidence'/'other'.
    const part4Section = noticeOfApplication.split("## PART 4: MATERIAL TO BE RELIED ON")[1];
    const doc6Line = part4Section.split("\n").find((l) => l.includes("Inspection Report"));
    assert.ok(doc6Line, "expected the witness-tendered exhibit to render in Part 4");
    assert.doesNotMatch(doc6Line, /👤/, "expected no unsponsored-exhibit marker on a witness-tendered exhibit");
    const doc7Line = part4Section.split("\n").find((l) => l.includes("Unsourced site photograph"));
    assert.match(doc7Line, /🙅🏻‍♂️👤/, "expected the denied admission's event glyph to prefix 👤 in Part 4, fused as one set, mirroring the Evidence Index");
    const doc1Line = part4Section.split("\n").find((l) => l.includes("Draft default judgment"));
    assert.doesNotMatch(doc1Line, /👤/, "expected no exhibit-side marker on a role='order' attachment -- excluded from the dual-approved role scope (#398)");
    // The standard closing lines number on from the documents and carry no marker and no trace,
    // while a real document keeps its 🏆.
    const part4Numbered = part4Section.split("## ")[0].split("\n").filter((l) => /^\d+\. /.test(l));
    assert.deepEqual(
      part4Numbered.slice(-2),
      ["4. Pleadings filed in this proceeding", "5. Such further affidavits or filed court documents as this honourable court may allow"],
      "expected the two standard closing lines last in Part 4, unmarked and untraced"
    );
    assert.match(doc1Line, /🏆/, "expected a real listed document to keep its 🏆");

    assertMatchesGolden("notice-of-application", noticeOfApplication);
  } finally {
    f.cleanup();
  }
});

// A submission's linked fact that is already a PART 2 paragraph is named by its PART 2 number on
// the contention line instead of being re-printed in PART 3. Four submissions cover every case:
// A links three PART 2 facts whose ordinals differ from their ids; B links nothing and has no
// decision (🧾 fires, printed against a NONE comment); C links nothing under counsel's
// no-facts-needed decision (no 🧾, no comment); D links a fact seeded only in the Written
// Arguments, which the database places in PART 2 when D is deployed (schema v59), so D names it too.
test("Notice of Application PART 3 references a linked fact already in PART 2 by its paragraph number", async () => {
  const f = seededDbFixture();
  try {
    await freshSubmissionDb(f.dbPath);
    await seedBcscDefaultJudgment(f.dbPath);
    await submissionDataExecute(
      f.dbPath,
      `
      INSERT INTO hearing_details (filing_id, hearing_date, hearing_time, time_estimate_minutes, associate_judge)
        VALUES (1, '2026-09-01', '9:45 am', 45, 1);
      UPDATE filings SET kind = 'notice_of_application', subkind = NULL, title = 'Notice of Application' WHERE id = 1;
      INSERT INTO facts (id, proceeding_id, postulate)
        VALUES
          (1, 1, 'Fact one is second in Part 2.'),
          (2, 1, 'Fact two is third in Part 2.'),
          (3, 1, 'Fact three is first in Part 2.'),
          (4, 1, 'Fact four is argued in the Written Arguments only.');
      INSERT INTO filing_facts (filing_id, fact_id, document, part, ordinal)
        VALUES (1, 3, 'form', 'part2', 1), (1, 1, 'form', 'part2', 2), (1, 2, 'form', 'part2', 3), (1, 4, 'written_argument', 'part2', 1);
      INSERT INTO submissions (id, proceeding_id, contention, ordinal)
        VALUES
          (1, 1, 'Submission A rests on three Part 2 facts.', 1),
          (2, 1, 'Submission B states no fact.', 2),
          (3, 1, 'Submission C needs no stated fact.', 3),
          (4, 1, 'Submission D rests on a fact outside Part 2.', 4);
      UPDATE submissions SET no_facts_needed_on = '2026-10-04', no_facts_needed_note = 'C turns on the Rules alone.',
                             no_facts_needed_contention = contention WHERE id = 3;
      INSERT INTO submission_facts (submission_id, fact_id) VALUES (1, 1), (1, 2), (1, 3), (4, 4);
      INSERT INTO filing_submissions (filing_id, submission_id, document, ordinal)
        VALUES (1, 1, 'form', 1), (1, 2, 'form', 2), (1, 3, 'form', 3), (1, 4, 'form', 4);
      `.trim()
    );

    const client = { clientName: "Halloway", clientNo: "3120", matterNo: "L9002" };
    const result = submissionFormsRender(f.dbPath, 1, client);
    const noa = result.documents.find((d) => d.document_type === "Notice_of_application").markdown;
    const part3 = noa.split("## PART 3: LEGAL BASIS")[1].split("## PART 4")[0];
    const lineOf = (id) => part3.split("\n").find((l) => l.includes(`<!-- submission_id ${id} -->`));

    // A: ascending PART 2 numbers, nothing re-printed beneath.
    assert.match(lineOf(1), /<!-- submission_id 1 --> <!-- supporting fact paragraphs: 1, 2, 3 -->$/);
    const underA = part3.split("<!-- submission_id 1 -->")[1].split("<!-- submission_id 2 -->")[0];
    assert.doesNotMatch(underA, /<!-- fact_id/, "expected no PART 2 fact re-printed under A");

    // B: 🧾 prints touching the NONE comment, and nowhere else on the line.
    assert.match(lineOf(2), /<!-- submission_id 2 --> 🧾<!-- supporting fact paragraphs: {2}NONE -->$/);
    assert.equal(lineOf(2).match(/🧾/g)?.length, 1, "expected 🧾 once on B's line, against the comment");

    // C: counsel's decision tag, no 🧾, no comment.
    assert.match(lineOf(3), / \(no stated fact needed, per counsel 2026-10-04\)/);
    assert.doesNotMatch(lineOf(3), /🧾|supporting fact paragraphs/);

    // D: deploying D placed its fact last in PART 2, as paragraph 4, so D names it and prints no fact text.
    assert.match(lineOf(4), /<!-- submission_id 4 --> <!-- supporting fact paragraphs: 4 -->$/);
    const underD = part3.split("<!-- submission_id 4 -->")[1];
    assert.doesNotMatch(underD, /<!-- fact_id|Fact four/, "expected no fact text printed under D");

    // 🧾 is still derived and recorded once, on B.
    const inventory = JSON.parse(readFileSync(join(f.draft, "Drafting records", `render-manifest-${result.filing_id}.json`), "utf-8")).inventory;
    assert.deepEqual(
      inventory.filter((e) => e.marker === "🧾" && e.doc === "Notice_of_application").map((e) => `${e.table}:${e.id}`),
      ["submissions:2"]
    );

    // The filed face strips the comment and the 🧾 against it, leaving A's contention alone.
    const filed = submissionFormsRender(f.dbPath, 1, client, "filed");
    assertFiledFaceDocumentsClean(filed.documents);
    const filedNoa = filed.documents.find((d) => d.document_type === "Notice_of_application").markdown;
    assert.doesNotMatch(filedNoa, /supporting fact paragraphs|🧾|NOT PLACED/);
    assert.match(filedNoa, /^\d+\. Submission A rests on three Part 2 facts\.$/m);
  } finally {
    f.cleanup();
  }
});

// 📚 proposition needed on Form 32 PART 3 (application-paragraphs spec §4.2-§4.3, schema v60). Unlike
// 🧾, 📚 stays in the contention line's marker set in reference mode and never moves onto the
// supporting-fact-paragraphs comment. A rests on a PART 2 fact and links no proposition (📚); B links
// nothing (📚 in the marker set, 🧾 against the NONE comment); C rests on a fact under counsel's
// no-law-needed decision (the tag, no 📚). Linking a proposition to A clears its 📚.
test("Notice of Application PART 3 marks a contention with no linked proposition 📚, in the marker set", async () => {
  const f = seededDbFixture();
  try {
    await freshSubmissionDb(f.dbPath);
    await seedBcscDefaultJudgment(f.dbPath);
    await submissionDataExecute(
      f.dbPath,
      `
      INSERT INTO hearing_details (filing_id, hearing_date, hearing_time, time_estimate_minutes, associate_judge)
        VALUES (1, '2026-09-01', '9:45 am', 45, 1);
      UPDATE filings SET kind = 'notice_of_application', subkind = NULL, title = 'Notice of Application' WHERE id = 1;
      INSERT INTO facts (id, proceeding_id, postulate) VALUES (1, 1, 'Fact one is first in Part 2.');
      INSERT INTO filing_facts (filing_id, fact_id, document, part, ordinal) VALUES (1, 1, 'form', 'part2', 1);
      INSERT INTO submissions (id, proceeding_id, contention, ordinal)
        VALUES
          (1, 1, 'Submission A rests on a Part 2 fact.', 1),
          (2, 1, 'Submission B states neither fact nor law.', 2),
          (3, 1, 'Submission C needs no stated law.', 3);
      UPDATE submissions SET no_law_needed_on = '2026-10-06', no_law_needed_note = 'C is a question of fact alone.',
                             no_law_needed_contention = contention WHERE id = 3;
      INSERT INTO submission_facts (submission_id, fact_id) VALUES (1, 1), (3, 1);
      INSERT INTO filing_submissions (filing_id, submission_id, document, ordinal)
        VALUES (1, 1, 'form', 1), (1, 2, 'form', 2), (1, 3, 'form', 3),
               (1, 1, 'written_argument', 1), (1, 2, 'written_argument', 2), (1, 3, 'written_argument', 3);
      INSERT INTO law_assertions (id, proceeding_id, proposition, dead_end) VALUES (90, 1, 'A proposition A requires.', 0);
      `.trim()
    );

    const client = { clientName: "Halloway", clientNo: "3120", matterNo: "L9002" };
    const part3Of = (result) =>
      result.documents.find((d) => d.document_type === "Notice_of_application").markdown.split("## PART 3: LEGAL BASIS")[1].split("## PART 4")[0];
    const lineOf = (part3, id) => part3.split("\n").find((l) => l.includes(`<!-- submission_id ${id} -->`));

    const result = submissionFormsRender(f.dbPath, 1, client);
    const part3 = part3Of(result);
    assert.match(lineOf(part3, 1), /^\d+\. Submission A rests on a Part 2 fact\. 📚 <!-- submission_id 1 --> <!-- supporting fact paragraphs: 1 -->$/);
    assert.match(lineOf(part3, 2), /^\d+\. Submission B states neither fact nor law\. 📚 <!-- submission_id 2 --> 🧾<!-- supporting fact paragraphs: {2}NONE -->$/);
    assert.match(lineOf(part3, 3), /^\d+\. Submission C needs no stated law\. \(no stated law needed, per counsel 2026-10-06\)/);
    assert.doesNotMatch(lineOf(part3, 3), /📚/);

    const inventory = JSON.parse(readFileSync(join(f.draft, "Drafting records", `render-manifest-${result.filing_id}.json`), "utf-8")).inventory;
    assert.deepEqual(
      inventory.filter((e) => e.marker === "📚" && e.doc === "Notice_of_application").map((e) => `${e.slug}:${e.table}:${e.id}`),
      ["proposition:submissions:1", "proposition:submissions:2"]
    );

    // The filed face strips 📚 and counsel's tag, leaving C's contention alone.
    const filed = submissionFormsRender(f.dbPath, 1, client, "filed");
    assertFiledFaceDocumentsClean(filed.documents);
    const filedNoa = filed.documents.find((d) => d.document_type === "Notice_of_application").markdown;
    assert.doesNotMatch(filedNoa, /📚|no stated law needed/);
    assert.match(filedNoa, /^\d+\. Submission C needs no stated law\.$/m);

    // Linking a proposition clears A's 📚.
    await submissionDataExecute(f.dbPath, "INSERT INTO submission_law (submission_id, law_assertion_id) VALUES (1, 90);");
    const linkedLine = lineOf(part3Of(submissionFormsRender(f.dbPath, 1, client)), 1);
    assert.doesNotMatch(linkedLine, /📚/, linkedLine);
    assert.match(linkedLine, /<!-- submission_id 1 --> <!-- supporting fact paragraphs: 1 -->$/);
  } finally {
    f.cleanup();
  }
});

// A fact attached to a deployed submission but missing from PART 2. The database places every such
// fact on a drafting Writing (schema v59), so the seed attaches and deploys while the Writing is still
// a requisition, a kind no placement trigger watches, then makes it a Notice of Application. On the
// drafting Writing PART 3 prints no fact text: the contention's comment names the fact NOT PLACED,
// and both filed-face paths refuse. A sent Writing renders as it always did, the fact in full.
test("an attached fact missing from PART 2 prints NOT PLACED on the mockup, and the filed face refuses while drafting", async () => {
  const f = seededDbFixture();
  try {
    await freshSubmissionDb(f.dbPath);
    await seedBcscDefaultJudgment(f.dbPath);
    await submissionDataExecute(
      f.dbPath,
      `
      INSERT INTO hearing_details (filing_id, hearing_date, hearing_time, time_estimate_minutes, associate_judge)
        VALUES (1, '2026-09-01', '9:45 am', 45, 1);
      INSERT INTO documents (id, proceeding_id, label) VALUES (2, 1, 'Affidavit of a site witness');
      INSERT INTO facts (id, proceeding_id, postulate, court_record)
        VALUES (1, 1, 'Fact one is placed in Part 2.', 2), (2, 1, 'Fact two was never placed.', NULL);
      INSERT INTO submissions (id, proceeding_id, contention, ordinal) VALUES (1, 1, 'Submission A rests on a placed fact and an unplaced one.', 1);
      INSERT INTO submission_facts (submission_id, fact_id) VALUES (1, 1), (1, 2);
      INSERT INTO filing_submissions (filing_id, submission_id, document, ordinal) VALUES (1, 1, 'form', 1);
      INSERT INTO filing_facts (filing_id, fact_id, document, part, ordinal) VALUES (1, 1, 'form', 'part2', 1), (1, 1, 'written_argument', 'part2', 1);
      UPDATE filings SET kind = 'notice_of_application', subkind = NULL, title = 'Notice of Application' WHERE id = 1;
      `.trim()
    );
    const client = { clientName: "Halloway", clientNo: "3120", matterNo: "L9002" };
    const part3Of = (markdown) => markdown.split("## PART 3: LEGAL BASIS")[1].split("## PART 4")[0];

    const result = submissionFormsRender(f.dbPath, 1, client);
    const noa = result.documents.find((d) => d.document_type === "Notice_of_application").markdown;
    const part3 = part3Of(noa);
    assert.match(
      part3.split("\n").find((l) => l.includes("<!-- submission_id 1 -->")),
      /<!-- submission_id 1 --> <!-- supporting fact paragraphs: 1; NOT PLACED: fact 2 "Fact two was never placed\." -->$/
    );
    const belowContention = part3.split("<!-- submission_id 1 -->")[1].split("\n").slice(1).join("\n");
    assert.doesNotMatch(belowContention, /<!-- fact_id|Fact one|Fact two/, "expected no fact text printed in PART 3");
    // Fact 1's 📌 is recorded once, by its PART 2 line, and the unplaced fact records nothing.
    const inventory = JSON.parse(readFileSync(join(f.draft, "Drafting records", `render-manifest-${result.filing_id}.json`), "utf-8")).inventory;
    const noaEntries = inventory.filter((e) => e.doc === "Notice_of_application" && e.table === "facts");
    assert.deepEqual(noaEntries.filter((e) => e.marker === "📌").map((e) => e.id), [1]);
    assert.deepEqual(noaEntries.filter((e) => e.id === 2), []);

    const refusal = (err) =>
      err.code === "facts_not_placed" && /Writing 1/.test(err.message) && /submission 1/.test(err.message) && /fact 2 "Fact two was never placed\."/.test(err.message);
    assert.throws(() => submissionFormsRender(f.dbPath, 1, client, "filed"), refusal);
    assert.throws(() => submissionFormsEmitForm32(f.dbPath, 1), refusal);
    await submissionDataExecute(f.dbPath, "UPDATE filings SET kind = 'application_response' WHERE id = 1;");
    assert.throws(() => submissionFormsEmitForm33(f.dbPath, 1), refusal);

    // Sent: unchanged on every surface. The mockup prints the fact in full under A, and the filed face renders.
    seedSql(
      f.dbPath,
      `INSERT INTO parties_snapshot (filing_id, party_id, name, role, ordinal, is_client, is_applicant, to_be_served, address_for_service_filed)
         VALUES (1, 1, 'Wren Halloway', 'Plaintiff', 1, 1, 1, 0, 'unknown'), (1, 2, 'Corbin Vasey', 'Defendant', 2, 0, 0, 1, 'unknown');
       UPDATE filings SET kind = 'notice_of_application', filed_on = '2026-10-06' WHERE id = 1;`
    );
    const sent = part3Of(submissionFormsRender(f.dbPath, 1, client).documents.find((d) => d.document_type === "Notice_of_application").markdown);
    assert.match(sent.split("\n").find((l) => l.includes("<!-- submission_id 1 -->")), /<!-- supporting fact paragraphs: 1 -->$/);
    assert.match(sent, /Fact two was never placed\.[^\n]*<!-- fact_id 2 -->/);
    const filed = submissionFormsRender(f.dbPath, 1, client, "filed").documents.find((d) => d.document_type === "Notice_of_application").markdown;
    assert.match(filed, /Fact two was never placed\./);
  } finally {
    f.cleanup();
  }
});

// Issue #367, superseded by #380: the Notice of Application renders a
// crossed-out order inline in Part 1, struck, rather than confining it to a
// "Held in reserve" section like every other filing kind -- the delivered-
// face rule (every delivered face omits crossed-out material, terms-and-symbols.md's
// Rendering paragraph) still has to hold for this display shape. This proves
// filed-face.ts's STRUCT_LINE_RE line-drop (added alongside the crossed-out
// display) actually catches it.
test("Notice of Application filed face drops a crossed-out order entirely", async () => {
  const f = seededDbFixture();
  try {
    await freshSubmissionDb(f.dbPath);
    await seedBcscDefaultJudgment(f.dbPath);
    await submissionDataExecute(
      f.dbPath,
      `
      INSERT INTO hearing_details (filing_id, hearing_date, hearing_time, time_estimate_minutes, associate_judge)
        VALUES (1, '2026-09-01', '9:45 am', 45, 1);
      UPDATE filings SET kind = 'notice_of_application', subkind = NULL, title = 'Notice of Application' WHERE id = 1;
      INSERT INTO order_sought (id, proceeding_id, wording, crossed_out_on)
        VALUES (4, 1, 'leave to file a further affidavit at the hearing', '2026-08-20');
      INSERT INTO filing_orders (filing_id, order_sought_id, document, ordinal) VALUES (1, 4, 'form', 3);
      `.trim()
    );

    const result = submissionFormsRender(f.dbPath, 1, { clientName: "Halloway", clientNo: "3120", matterNo: "L9002" }, "filed");
    assertFiledFaceDocumentsClean(result.documents);
    const notice = result.documents.find((d) => d.document_type === "Notice_of_application");
    assert.ok(notice, "expected a Notice_of_application document in filed mode");
    const filed = replaceStamp(notice.markdown);

    assert.doesNotMatch(filed, /leave to file a further affidavit at the hearing/, "expected the crossed-out order's wording gone entirely from the filed face");
    assert.doesNotMatch(filed, /~~/, "expected no strikethrough markup left in the filed face");
    assert.doesNotMatch(filed, /🂡|🤥/, "expected no reserved/impeachment glyph left in the filed face");
    assert.doesNotMatch(filed, /## Held in reserve/, "expected no Held-in-reserve section (this form never has one)");
    assert.match(filed, /damages to be assessed/, "expected the included order to survive onto the filed face");
    // Nothing pinned this form's filed Part 1 until now, which is how the mockup-only "Power to
    // make" note reached a delivered face unnoticed (CLAUDE.md: rendered for the human, withheld
    // from the forum). The golden fixture is the standing guard -- any mockup annotation that
    // regains the filed face changes this file and fails here.
    assertMatchesGolden("notice-of-application-filed", filed);

    // #805: every kind but VanIAC and the two BCCA kinds also delivers a Written Arguments
    // companion (document='written_argument'), a different face from the VanIAC venue form that
    // written-argument-filed pins. Nothing pinned the companion's filed face until now; this
    // Notice of Application render is the cheapest one that produces it.
    const companion = result.documents.find((d) => d.document_type === "Written_arguments");
    assert.ok(companion, "expected the Written Arguments companion in the filed-mode output");
    assertMatchesGolden("written-argument-companion-filed", replaceStamp(companion.markdown));
  } finally {
    f.cleanup();
  }
});

// ADR 0038: an enactment change on record that amends Form 32, which its identity file does not
// list as conformed to, heads the Notice of Application mockup as one glyphless mockup-only line.
// The filed face drops it by the existing tag strip, and a conformed form adds none. The record and
// the identity file are a scratch skills tree's, so the checkout's own records move nothing here.
const REG = "B.C. Reg. 105/2026";

function currencyTree(t, conformedTo) {
  const fx = knowledgeFixture(t);
  fx.shipped("docket-clerk/rule-freshness.json", {
    enactments: [
      {
        name: "Supreme Court Civil Rules",
        pending_changes: [{ amending_reg: REG, amending_oic: "OIC 264/2026", commencement_date: "2026-10-01", sections: [], forms: ["32", "33"] }],
      },
    ],
  });
  const listed = conformedTo.map((reg) => `\n  - ${reg}`).join("");
  fx.shipped("publish/CAN/BC/BCSC/Documents/notice-of-application.md", `---\nform_number: 32\nform_key: form-32\nconformed_to:${listed}\n---\n`);
  return fx;
}

async function seedNotice(dbPath) {
  await freshSubmissionDb(dbPath);
  await seedBcscDefaultJudgment(dbPath);
  await submissionDataExecute(
    dbPath,
    `
    INSERT INTO hearing_details (filing_id, hearing_date, hearing_time, time_estimate_minutes, associate_judge)
      VALUES (1, '2026-09-01', '9:45 am', 45, 1);
    UPDATE filings SET kind = 'notice_of_application', subkind = NULL, title = 'Notice of Application' WHERE id = 1;
    `.trim()
  );
}

/** One render of filing 1 at a pinned clock, reading the form currency from `seams`' tree. */
function renderWith(dbPath, mode, seams) {
  const client = { clientName: "Halloway", clientNo: "3120", matterNo: "L9002" };
  return submissionFormsRender(dbPath, 1, client, mode, undefined, undefined, undefined, "2026-10-06 09:00", undefined, undefined, undefined, undefined, undefined, seams);
}

const noticeOf = (result) => result.documents.find((d) => d.document_type === "Notice_of_application").markdown;

test("an unconformed amendment to Form 32 heads the mockup as a mockup-only line, and the filed face drops it", async (t) => {
  const f = seededDbFixture();
  try {
    await seedNotice(f.dbPath);
    const fx = currencyTree(t, []);

    const mockup = renderWith(f.dbPath, "mockup", fx.seams);
    assert.equal(mockup.form_currency.form_key, "form-32");
    const line = noticeOf(mockup).split("\n").find((l) => l.endsWith(MOCKUP_ONLY_TAG) && l.includes("Form 32"));
    assert.equal(line, `${mockup.form_currency.warning} ${MOCKUP_ONLY_TAG}`, "expected the warning verbatim as a tagged line, with no glyph");
    assert.match(line, /^Form 32: B\.C\. Reg\. 105\/2026 \(OIC 264\/2026\), in force 2026-10-01, /);

    const filed = renderWith(f.dbPath, "filed", fx.seams);
    assertFiledFaceDocumentsClean(filed.documents);
    const filedNotice = noticeOf(filed);
    assert.ok(!filedNotice.includes(MOCKUP_ONLY_TAG), "expected no mockup-only tag on the filed face");
    assert.doesNotMatch(filedNotice, /B\.C\. Reg\./, "expected the warning withheld from the forum");
    assert.equal(filed.form_currency, undefined, "a filed render carries no form_currency");
  } finally {
    f.cleanup();
  }
});

test("a Form 32 identity file that lists the amending reg as conformed adds no line", async (t) => {
  const f = seededDbFixture();
  try {
    await seedNotice(f.dbPath);
    const fx = currencyTree(t, [REG]);

    const mockup = renderWith(f.dbPath, "mockup", fx.seams);
    assert.equal(mockup.form_currency.warning, null);
    assert.doesNotMatch(noticeOf(mockup), /B\.C\. Reg\./);
  } finally {
    f.cleanup();
  }
});

// Form 32's template (publish-bcsc-form/templates/032-noa.dotx) carries one
// estimate sentence, after TAKE NOTICE and before PART 1. The mockup keeps only
// template sentences, so no "Time estimate:" label and no trailing restatement.
test("Notice of Application states the time estimate once, in the template's sentence and position", async () => {
  const f = seededDbFixture();
  try {
    await freshSubmissionDb(f.dbPath);
    await seedBcscDefaultJudgment(f.dbPath);
    await submissionDataExecute(
      f.dbPath,
      `
      INSERT INTO hearing_details (filing_id, hearing_date, hearing_time, time_estimate_minutes, associate_judge)
        VALUES (1, '2026-09-01', '9:45 am', NULL, 1);
      UPDATE filings SET kind = 'notice_of_application', subkind = NULL, title = 'Notice of Application' WHERE id = 1;
      `.trim()
    );
    const estimateSection = (markdown) => markdown.split("TAKE NOTICE")[1].split("## PART 1")[0];

    const renderNotice = (mode) =>
      submissionFormsRender(f.dbPath, 1, { clientName: "Halloway", clientNo: "3120", matterNo: "L9002" }, mode, ["Notice_of_application"])
        .documents.find((d) => d.document_type === "Notice_of_application").markdown;
    const assertOneTemplateSentence = (markdown, expected, label) => {
      assert.match(estimateSection(markdown), new RegExp(`^The applicant estimates that the application will take: ${expected}$`, "m"), `expected "${expected}" in the ${label}`);
      assert.equal((markdown.match(/estimates that the application will take/g) ?? []).length, 1, `expected exactly one estimate sentence in the ${label}`);
      assert.doesNotMatch(markdown, /Time estimate|time estimated above/, `expected no non-template estimate wording in the ${label}`);
    };

    assertOneTemplateSentence(renderNotice("mockup"), "🧩", "mockup with no estimate recorded");
    // 45 minutes (zero hour slot left out) is covered by the golden fixture; filed
    // mode writes nothing to disk, which keeps these renders cheap.
    for (const [minutes, expected] of [[60, "1 hour"], [121, "2 hours 1 minute"]]) {
      await submissionDataExecute(f.dbPath, `UPDATE hearing_details SET time_estimate_minutes = ${minutes} WHERE filing_id = 1;`);
      assertOneTemplateSentence(renderNotice("filed"), expected, `filed face for ${minutes} minutes`);
    }
  } finally {
    f.cleanup();
  }
});

// #451: Form 32's template carries one jurisdiction sentence, after the estimate and before
// PART 1. associate_judge NULL -- or no hearing_details row -- is not yet determined: the mockup
// shows the ⬜ line in that sentence's place, and the filed face refuses rather than print either.
test("Notice of Application states associate-judge jurisdiction once in the template's sentence, or ⬜ while undetermined", async () => {
  const f = seededDbFixture();
  try {
    await freshSubmissionDb(f.dbPath);
    await seedBcscDefaultJudgment(f.dbPath);
    await submissionDataExecute(f.dbPath, `UPDATE filings SET kind = 'notice_of_application', subkind = NULL, title = 'Notice of Application' WHERE id = 1;`);
    const render = (mode) => submissionFormsRender(f.dbPath, 1, { clientName: "Halloway", clientNo: "3120", matterNo: "L9002" }, mode, ["Notice_of_application"]);
    const markdownOf = (result) => result.documents.find((d) => d.document_type === "Notice_of_application").markdown;
    const topSection = (markdown) => markdown.split("TAKE NOTICE")[1].split("## PART 1")[0];

    for (const setup of ["", `INSERT INTO hearing_details (filing_id, hearing_date, hearing_time, time_estimate_minutes) VALUES (1, '2026-09-01', '9:45 am', 45);`]) {
      if (setup) await submissionDataExecute(f.dbPath, setup);
      const mockup = markdownOf(render("mockup"));
      assert.match(topSection(mockup), /^Associate judge jurisdiction: not yet determined ⬜$/m, "expected the ⬜ line in the jurisdiction sentence's place");
      assert.doesNotMatch(mockup, /jurisdiction of an associate judge|heard by/, "expected no confident jurisdiction sentence while undetermined");

      const filed = render("filed");
      assert.equal(filed.associate_judge_gate_failed, true, "expected the filed face to refuse while undetermined");
      assert.deepEqual(filed.documents, []);
      assert.match(filed.note, /associate_judge/);
    }

    for (const [value, sentence] of [[1, "This matter is within the jurisdiction of an associate judge."], [0, "This matter is not within the jurisdiction of an associate judge."]]) {
      await submissionDataExecute(f.dbPath, `UPDATE hearing_details SET associate_judge = ${value} WHERE filing_id = 1;`);
      for (const mode of ["mockup", "filed"]) {
        const markdown = markdownOf(render(mode));
        assert.ok(topSection(markdown).split("\n").includes(sentence), `expected "${sentence}" before PART 1 in the ${mode} render`);
        assert.equal((markdown.match(/jurisdiction of an associate judge/g) ?? []).length, 1, `expected exactly one jurisdiction sentence in the ${mode} render`);
        assert.doesNotMatch(markdown, /heard by|not yet determined/, `expected no non-template jurisdiction wording in the ${mode} render`);
      }
    }
  } finally {
    f.cleanup();
  }
});

test("renders the default-judgment requisition and Form 8", async () => {
  const f = seededDbFixture();
  try {
    await freshSubmissionDb(f.dbPath);
    await seedBcscDefaultJudgment(f.dbPath);

    const result = submissionFormsRender(f.dbPath, 1, { clientName: "Halloway", clientNo: "3120", matterNo: "L9002" });
    const baseDir = dirname(result.documents[0].path);
    assertMatchesGolden("requisition-default-judgment", replaceStamp(findFile(baseDir, "Form 17 Draft Requisition.md")));
    assertMatchesGolden("form-8-default-judgment", replaceStamp(findFile(baseDir, "Form 8 Default Judgment.md")));

    // #805: both delivered faces of this kind pinned in filed mode too -- a mockup annotation
    // written as plain prose carries none of the mechanisms toFiledFace strips, so only a golden
    // catches it reaching the forum.
    const filed = submissionFormsRender(f.dbPath, 1, { clientName: "Halloway", clientNo: "3120", matterNo: "L9002" }, "filed");
    assertFiledFaceDocumentsClean(filed.documents);
    const filedOf = (fileName) => {
      const doc = filed.documents.find((d) => d.file_name === fileName);
      assert.ok(doc, `expected ${fileName} in the filed-mode output`);
      return replaceStamp(doc.markdown);
    };
    assertMatchesGolden("requisition-default-judgment-filed", filedOf("Form 17 Draft Requisition.md"));
    assertMatchesGolden("form-8-default-judgment-filed", filedOf("Form 8 Default Judgment.md"));
  } finally {
    f.cleanup();
  }
});

// #832: a Form 8 alternative-relief row is an ordinary order_sought row (schema.sql:193), so
// crossed_out_on is its own fact. fetchAlternatives used to ignore it, with two results: a struck alternative rendered as a live operative sentence and reached the FILED
// face (nothing downstream catches it -- #825's gate reads template_key only, and after #826 the
// line carries no glyph for the strip to remove), and an alternative chained to a struck primary
// vanished from every surface, including the mockup, which is the practitioner's only review
// surface. alternative_to is placement, not a state cascade: terms-and-symbols.md's Cascade paragraph
// runs orders -> submissions -> facts/law assertions and has no alternative_to leg, so each row
// renders by its own state. Brahm's call 2026-09-22 on #832, on Fable's recommendation. #960: its
// primary's placement deploys it -- no 🂡, no 🦵 -- struck or live.
test("a Form 8 alternative renders by its own crossed-out state, not its primary's", async () => {
  const f = seededDbFixture();
  try {
    await freshSubmissionDb(f.dbPath);
    await seedBcscDefaultJudgment(f.dbPath);
    await submissionDataExecute(
      f.dbPath,
      `
      -- Order 2 (costs to be assessed) is struck; its alternative, order 3, is NOT. Order 4 is a
      -- live primary whose own alternative, order 5, IS struck -- the two directions in one render.
      UPDATE order_sought SET crossed_out_on = '2026-08-20' WHERE id = 2;
      INSERT INTO order_sought (id, proceeding_id, wording, template_key, template_values, alternative_to, crossed_out_on)
        VALUES
          (4, 1, 'the assessed value of the goods', 'assessed_value_for_operative', NULL, NULL, NULL),
          (5, 1, 'interest under the Court Order Interest Act', 'interest_coia', NULL, 4, '2026-08-21');
      INSERT INTO filing_orders (filing_id, order_sought_id, document, ordinal) VALUES (1, 4, 'form', 3);
      `.trim()
    );

    const mockup = submissionFormsRender(f.dbPath, 1, { clientName: "Halloway", clientNo: "3120", matterNo: "L9002" })
      .documents.find((d) => d.file_name === "Form 8 Default Judgment.md").markdown;

    // (3) The live alternative of a struck primary reaches the mockup, unstruck and on its own terms.
    assert.match(
      mockup,
      /^THIS COURT FURTHER ORDERS that, in the alternative, the defendant\(s\) Corbin Vasey pay to the plaintiff\(s\) costs in the fixed amount of \$2,500\. \u{1F9D0} <!-- order_sought_id 3 -->$/mu,
      "expected the live alternative of the struck primary to render live on the mockup, awaiting final review and with no unserved-petitum marker (#960)"
    );
    // (2) The struck alternative renders struck, in the primary branch's shape.
    assert.match(
      mockup,
      /^~~in the alternative, the defendant\(s\) Corbin Vasey interest under the Court Order Interest Act~~ <!-- order crossed-out 5 -->$/m,
      "expected the crossed-out alternative to render struck on the mockup, not as a live order"
    );
    assert.doesNotMatch(
      mockup,
      /THIS COURT FURTHER ORDERS that, in the alternative, the defendant\(s\) Corbin Vasey interest under the Court Order Interest Act/,
      "expected no live operative sentence for the crossed-out alternative"
    );

    const filed = submissionFormsRender(f.dbPath, 1, { clientName: "Halloway", clientNo: "3120", matterNo: "L9002" }, "filed");
    assertFiledFaceDocumentsClean(filed.documents);
    const filedForm8 = filed.documents.find((d) => d.file_name === "Form 8 Default Judgment.md").markdown;

    // The consequence that reaches the court: the struck alternative must be gone from the filed
    // face entirely, and the live one must survive it.
    assert.doesNotMatch(filedForm8, /interest under the Court Order Interest Act/, "expected the crossed-out alternative gone from the filed face");
    assert.doesNotMatch(filedForm8, /~~/, "expected no strikethrough markup left in the filed face");
    assert.match(filedForm8, /in the alternative, the defendant\(s\) Corbin Vasey pay to the plaintiff\(s\) costs in the fixed amount of \$2,500\./, "expected the live alternative to survive onto the filed face");
    assert.doesNotMatch(filedForm8, /costs to be assessed/, "expected the crossed-out primary gone from the filed face");
  } finally {
    f.cleanup();
  }
});

// #825: a deployed Form 8 order whose template_key is null, or outside renderTemplate's closed
// set, renders a fallback that survives the filed face's glyph strip as a grammatical, signable
// order that orders nothing. The mockup keeps showing it -- that is the practitioner's only
// review surface -- and the filed render refuses instead of delivering it. Brahm's call
// 2026-09-22, covering both branches together; same refusal shape as the #451 associate-judge
// gate above. No golden: the refusal returns no documents.
test("Form 8 refuses the filed face for a deployed order with no usable template_key", async () => {
  const f = seededDbFixture();
  try {
    await freshSubmissionDb(f.dbPath);
    await seedBcscDefaultJudgment(f.dbPath);
    const render = (mode) => submissionFormsRender(f.dbPath, 1, { clientName: "Halloway", clientNo: "3120", matterNo: "L9002" }, mode);
    const form8 = (result) => result.documents.find((d) => d.file_name === "Form 8 Default Judgment.md");

    for (const [value, marker] of [["NULL", "\u2b1c (template not chosen)"], ["'costs_agreed'", '\ud83c\udff7\ufe0f unrecognized template_key "costs_agreed"']]) {
      await submissionDataExecute(f.dbPath, `UPDATE order_sought SET template_key = ${value} WHERE id = 1;`);

      const mockup = form8(render("mockup")).markdown;
      assert.ok(mockup.includes(`Corbin Vasey ${marker}.`), `expected the mockup to render ${marker} for the practitioner`);

      const filed = render("filed");
      assert.equal(filed.template_key_gate_failed, true, `expected the filed face to refuse for template_key ${value}`);
      assert.deepEqual(filed.documents, []);
      assert.match(filed.note, /order_sought id\(s\) 1/);
    }

    // A crossed-out order is withdrawn, and filed-face.ts drops the whole ~~line~~, so it never
    // reaches the forum and must not block a filing it is absent from.
    await submissionDataExecute(f.dbPath, `UPDATE order_sought SET template_key = NULL, crossed_out_on = '2026-09-22' WHERE id = 1;`);
    // The struck line still carries the fallback; only its crossed-out marker keeps it off the gate.
    assert.match(form8(render("mockup")).markdown, /^~~.*template not chosen.*~~ <!-- order crossed-out 1 -->$/m);
    const struck = render("filed");
    assert.equal(struck.template_key_gate_failed, undefined, "a crossed-out order never reaches the filed face");
    assert.doesNotMatch(form8(struck).markdown, /template not chosen/);
  } finally {
    f.cleanup();
  }
});

test("renders the consent-order requisition and consent order", async () => {
  const f = seededDbFixture();
  try {
    await freshSubmissionDb(f.dbPath);
    await seedBcscConsentOrder(f.dbPath);

    const result = submissionFormsRender(f.dbPath, 1, { clientName: "Larchmont", clientNo: "4001", matterNo: "L8470" });
    const baseDir = dirname(result.documents[0].path);
    assertMatchesGolden("requisition-consent", replaceStamp(findFile(baseDir, "Requisition for Consent Order.md")));
    assertMatchesGolden("consent-order", replaceStampAndDate(findFile(baseDir, "Consent Order.md")));

    // #805, as above: pin both delivered faces of this kind in filed mode as well.
    const filed = submissionFormsRender(f.dbPath, 1, { clientName: "Larchmont", clientNo: "4001", matterNo: "L8470" }, "filed");
    assertFiledFaceDocumentsClean(filed.documents);
    const filedOf = (fileName) => {
      const doc = filed.documents.find((d) => d.file_name === fileName);
      assert.ok(doc, `expected ${fileName} in the filed-mode output`);
      return doc.markdown;
    };
    assertMatchesGolden("requisition-consent-filed", replaceStamp(filedOf("Requisition for Consent Order.md")));
    assertMatchesGolden("consent-order-filed", replaceStampAndFiledDate(filedOf("Consent Order.md")));
  } finally {
    f.cleanup();
  }
});

// ADR 0013 (deadline isolation): a mockup render withholds a Notice of Application's proposed hearing
// from the markdown it returns; the mockup file keeps it. B.C. Reg. 105/2026's
// Form 32 fixes no hearing date, so the fixed hearing date and time print nowhere on the notice.
const WITHHELD = "[withheld from drafting context]";
const PROPOSED = "The applicant proposes that the matter will be heard on";
const TO_BE_SET = "on a date to be set by Notice of Hearing of Application for the orders set out in Part 1 below.";

async function seedNoticeOfApplication(dbPath, hearingSql) {
  await seedBcscDefaultJudgment(dbPath);
  await submissionDataExecute(
    dbPath,
    `${hearingSql}
    UPDATE filings SET kind = 'notice_of_application', subkind = NULL, title = 'Notice of Application' WHERE id = 1;`
  );
}

const NOA_WITH_HEARING = `INSERT INTO hearing_details (filing_id, hearing_date, hearing_time, time_estimate_minutes, associate_judge, proposed_hearing) VALUES (1, '2026-09-01', '9:45 am', 45, 1, '2026-09-14 to 2026-09-18');`;

test("render withholds a Notice of Application's proposed hearing from the response, never from the file", async () => {
  const f = seededDbFixture();
  try {
    await freshSubmissionDb(f.dbPath);
    await seedNoticeOfApplication(f.dbPath, NOA_WITH_HEARING);
    const { draft } = draftFolder(f);
    const leaf = join(draft, "Notice of Application");

    const result = submissionFormsRender(f.dbPath, 1, ASHBOURNE, "mockup", ["Notice_of_application"], undefined, leaf);

    const noa = result.documents.find((d) => d.document_type === "Notice_of_application");
    assert.ok(noa.markdown.includes(`${PROPOSED} ${WITHHELD}.`));
    assert.ok(!noa.markdown.includes("2026-09-14"), "the proposed hearing never crosses the tool boundary");
    assert.ok(!noa.markdown.includes("2026-09-01"), "nor the fixed hearing date");
    assert.ok(!noa.markdown.includes("9:45 am"), "nor the fixed hearing time");
    const file = readFileSync(noa.path, "utf-8");
    assert.equal(noa.path, join(leaf, "Notice of Application.md"));
    assert.ok(file.includes(`${PROPOSED} 2026-09-14 to 2026-09-18.`), "the mockup in the Writing's folder keeps the proposal");
    assert.equal(noa.markdown_chars, file.length, "measured before withholding");
  } finally {
    f.cleanup();
  }
});

test("render leaves a blank proposed hearing visible and prints no fixed hearing date", async () => {
  const f = seededDbFixture();
  try {
    await freshSubmissionDb(f.dbPath);
    await seedNoticeOfApplication(f.dbPath, `INSERT INTO hearing_details (filing_id, hearing_date, hearing_time, associate_judge) VALUES (1, '2026-09-01', NULL, 1);`);

    const noa = submissionFormsRender(f.dbPath, 1, ASHBOURNE).documents.find((d) => d.document_type === "Notice_of_application");

    assert.ok(noa.markdown.includes(`${PROPOSED} ________________.`));
    assert.ok(!noa.markdown.includes(WITHHELD));
    assert.ok(!noa.markdown.includes("2026-09-01"));
  } finally {
    f.cleanup();
  }
});

test("render leaves the proposed hearing blank visible when a Notice of Application has no hearing row", async () => {
  const f = seededDbFixture();
  try {
    await freshSubmissionDb(f.dbPath);
    await seedNoticeOfApplication(f.dbPath, "");

    const noa = submissionFormsRender(f.dbPath, 1, ASHBOURNE).documents.find((d) => d.document_type === "Notice_of_application");

    assert.ok(noa.markdown.includes(TO_BE_SET));
    assert.ok(noa.markdown.includes(`${PROPOSED} ________________.`));
    assert.ok(!noa.markdown.includes(WITHHELD));
  } finally {
    f.cleanup();
  }
});

test("filed mode neither withholds nor blanks the proposed hearing", async () => {
  const f = seededDbFixture();
  try {
    await freshSubmissionDb(f.dbPath);
    await seedNoticeOfApplication(f.dbPath, NOA_WITH_HEARING);

    const result = submissionFormsRender(f.dbPath, 1, ASHBOURNE, "filed");
    assertFiledFaceDocumentsClean(result.documents);
    const noa = result.documents.find((d) => d.document_type === "Notice_of_application");

    assert.ok(noa.markdown.includes(TO_BE_SET));
    assert.ok(noa.markdown.includes(`${PROPOSED} 2026-09-14 to 2026-09-18.`));
    assert.ok(!noa.markdown.includes(WITHHELD));
  } finally {
    f.cleanup();
  }
});

function replaceStampAndDate(text) {
  return replaceStamp(text).replace(/^BEFORE A REGISTRAR \).*$/m, "BEFORE A REGISTRAR )  <DATE>  )  )");
}

// Same bench line on the filed face, where filed-face.ts's tidy() has already collapsed the runs
// of spaces around the parentheses -- so the mockup pattern above no longer matches, and without
// this the golden would carry a live wall-clock date and go stale overnight.
function replaceStampAndFiledDate(text) {
  return replaceStamp(text).replace(/^BEFORE A REGISTRAR\).*$/m, "BEFORE A REGISTRAR) <DATE>))");
}
