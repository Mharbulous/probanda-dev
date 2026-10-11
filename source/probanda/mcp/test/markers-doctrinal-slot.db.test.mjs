// 📖 / 🔬 on a proposition's own line, through the real renderer (#502).
//
// work-markers.md rows 📖 and 🔬: 📖 means *no statement at all* from a
// non-killed authority; a proposition that holds only an unverified lead
// shows 🔬 (scrutinize) instead -- the two are exclusive per proposition by
// construction. A statement resting on a killed authority is invisible to
// both, so a killed-only proposition is still 📖.
//
// Seed pattern follows forms-render-vaniac.db.test.mjs's minimal-seed test
// (freshSubmissionDb + submissionDataExecute), not the full VanIAC fixture.

import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

const { freshSubmissionDb } = await import("./helpers/template-db.mjs");
const { writePartiesOfRecord } = await import("./helpers/case-data-fixture.mjs");
const { submissionDataExecute } = await import("../build/submission/backend.js");
const { submissionFormsRender } = await import("../build/submission/forms.js");
const { proposalKey } = await import("../build/submission/forms/proposal-inventory.js");
const { boardDataOf } = await import("./fixtures/forms-render-seeds.mjs");

// No file number: the parties are linked by case_party_id to case data holding their counsel.
const CLAIMANT_CASE_DATA = {
  parties: [
    { id: 1, name: "Claimant Co.", counsel_name: "A. Lawyer" },
    { id: 2, name: "Respondent Co." },
  ],
};

const SEED = `
INSERT INTO proceedings (id, matter_reference, forum, court_or_centre, registry, file_number, style_of_cause, courthouse_address)
  VALUES (1, 'L9001 - Slot', 'CAN/BC/Vancouver-International-Arbitration-Centre', 'VanIAC', NULL, NULL, 'Slot v. Test', NULL);

INSERT INTO parties (id, proceeding_id, name, role, ordinal, is_client, is_applicant, to_be_served, case_party_id)
  VALUES
    (1, 1, 'Claimant Co.', 'Claimant', 1, 1, 1, 0, 1),
    (2, 1, 'Respondent Co.', 'Respondent', 2, 0, 0, 1, 2);

INSERT INTO filings (id, proceeding_id, kind, subkind, round, title)
  VALUES (1, 1, 'submissions_package', NULL, 'opening', 'Opening Submissions Package');

-- verification lives on statements_of_law since schema v25: authority 1 is a lead
-- because its statements are, not the other way round.
INSERT INTO authorities (id, proceeding_id, style_of_cause_or_title, citation, kind, weight, treatment, killed_on)
  VALUES
    (1, 1, 'Lead Authority v. X', '2021 BCSC 1', 'case', NULL, NULL, NULL),
    (2, 1, 'Verified Authority v. Y', '2022 BCCA 2', 'case', 'binding', 'good_law', NULL),
    (3, 1, 'Killed Authority v. Z', '2023 BCSC 3', 'case', NULL, 'good_law', '2026-09-01'),
    -- Overruled but NOT killed: the state #828 decides. Noted up (so 📇 is spent) and found not
    -- to be good law, but the practitioner has not yet rejected it.
    (4, 1, 'Overruled Authority v. W', '2020 BCSC 4', 'case', NULL, 'overruled', NULL);

INSERT INTO submissions (id, proceeding_id, contention, ordinal)
  VALUES (1, 1, 'One contention requiring four propositions.', 1);
INSERT INTO filing_submissions (filing_id, submission_id, document, ordinal) VALUES (1, 1, 'form', 1);

INSERT INTO law_assertions (id, proceeding_id, proposition, dead_end)
  VALUES
    (1, 1, 'a proposition with no statement at all', 0),
    (2, 1, 'a proposition holding only an unverified lead', 0),
    (3, 1, 'a proposition with a verified primary statement', 0),
    (4, 1, 'a proposition whose only statement rests on a killed authority', 0),
    (5, 1, 'a proposition whose only statement rests on an overruled authority', 0),
    -- #830: the proposition's own line, which reads ACROSS statements and so is a different
    -- surface from the statement's own line #828 settled. 6 is the verified half of the defect
    -- (it rendered clean, a rule-6 falsely-finished proposition); 7 pins that an overruled
    -- statement is dropped from the read set rather than the whole proposition being written off.
    (6, 1, 'a proposition whose only statement is verified on an overruled authority', 0),
    (7, 1, 'a proposition holding an overruled primary statement beside a live tertiary one', 0),
    -- Schema v46: a statement the research lawyer failed. 8 holds nothing else; 9 keeps a verified
    -- statement beside it.
    (8, 1, 'a proposition whose only statement failed scrutiny', 0),
    (9, 1, 'a proposition holding a failed statement beside a verified one', 0);

INSERT INTO statements_of_law (id, proceeding_id, law_assertion_id, authority_id, pinpoint, excerpt, source, verification)
  VALUES
    (1, 1, 2, 1, 'para 4', 'An unverified lead, not yet scrutinized.', 'primary', 'lead'),
    (2, 1, 3, 2, 'para 9', 'A verified statement of the governing test.', 'primary', 'verified'),
    (3, 1, 4, 3, 'para 2', 'A statement resting on a killed authority.', 'primary', 'verified'),
    -- Every withheld rung at once on an overruled authority: excerpt ∅ (📜), pinpoint ∅ (📍),
    -- source ∅ (🏅), verification 'lead' (🔬). Lead, so it rides the brief-only cap and this
    -- statement's own line prints in the Counsel Brief alone -- which is where #828 is asserted.
    (5, 1, 5, 4, NULL, NULL, NULL, 'lead'),
    -- #830. Statement 6 is verified and rated primary on the same overruled authority: every
    -- reason the old read set had to call proposition 6 finished. Statements 7 and 8 put an
    -- overruled primary beside a live tertiary, so the rung's read set is what the assertion
    -- turns on -- counting the overruled one returns 🥇 and clears the rung entirely.
    (6, 1, 6, 4, 'para 11', 'A verified statement on an authority the court has since overruled.', 'primary', 'verified'),
    (7, 1, 7, 4, 'para 12', 'An overruled primary statement.', 'primary', 'verified'),
    (8, 1, 7, 2, 'para 13', 'A live tertiary statement of the same proposition.', 'tertiary', 'verified');

-- Schema v46: a failed statement carries its finding in doubt (CHECK-required). The findings hold
-- parentheses of their own, which the filed-face strip must remove whole.
INSERT INTO statements_of_law (id, proceeding_id, law_assertion_id, authority_id, pinpoint, excerpt, source, doubt, verification)
  VALUES
    (9, 1, 8, 1, 'para 20', 'A passage the research lawyer found does not support proposition 8.', 'primary',
     'Scrutiny failed 2026-10-02: ratio held; fit failed (the passage concerns (a) leases, not licences).', 'failed'),
    (10, 1, 9, 1, 'para 21', 'A passage the research lawyer found does not support proposition 9.', 'primary',
     'Scrutiny failed 2026-10-02: fit failed on the second limb.', 'failed'),
    (11, 1, 9, 2, 'para 22', 'A verified statement of proposition 9.', 'primary', NULL, 'verified');

INSERT INTO submission_law (submission_id, law_assertion_id) VALUES (1, 1), (1, 2), (1, 3), (1, 4), (1, 5), (1, 6), (1, 7), (1, 8), (1, 9);

-- The jurisdictional half of the same rung. A standalone statement of law (law_assertion_id NULL
-- -- the power to grant, not a doctrinal proposition) citing the same unverified lead authority.
-- This is DB-level on purpose: markers-jurisdiction.unit.test.mjs proves the predicate, but only a
-- real render proves fetchOrdersSought actually SELECTs verification and killed_on. Get the alias
-- wrong and the field arrives undefined, so 🔬 silently never fires and the unit test stays green.
INSERT INTO statements_of_law (id, proceeding_id, law_assertion_id, authority_id, pinpoint, excerpt, source, verification)
  VALUES (4, 1, NULL, 1, 'para 8', 'The court has the power to grant this relief.', 'primary', 'lead');

INSERT INTO order_sought (id, proceeding_id, wording, amount)
  VALUES (1, 1, 'an order resting on an unverified lead', NULL);
INSERT INTO order_sought_requires (order_sought_id, excerpt_id, basis_state) VALUES (1, 4, 'filled');
INSERT INTO filing_orders (filing_id, order_sought_id, document, ordinal) VALUES (1, 1, 'form', 1);

-- Schema v46: an order whose filled basis rests on a statement the research lawyer failed.
INSERT INTO statements_of_law (id, proceeding_id, law_assertion_id, authority_id, pinpoint, excerpt, source, doubt, verification)
  VALUES (12, 1, NULL, 1, 'para 23', 'A passage found not to confer the power.', 'primary', 'Scrutiny failed 2026-10-02: no power to grant.', 'failed');
INSERT INTO order_sought (id, proceeding_id, wording, amount)
  VALUES (2, 1, 'an order resting on a failed statement', NULL);
INSERT INTO order_sought_requires (order_sought_id, excerpt_id, basis_state) VALUES (2, 12, 'filled');
INSERT INTO filing_orders (filing_id, order_sought_id, document, ordinal) VALUES (1, 2, 'form', 2);

UPDATE db_meta SET value = '1' WHERE key = 'revision';
`.trim();

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "coclerk-doctrinal-slot-"));
  return { dbPath: join(dir, "submission.sqlite"), cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

test("📖 and 🔬 split the doctrinal slot by whether a non-killed statement exists", async () => {
  const f = fixture();
  try {
    await freshSubmissionDb(f.dbPath);
    writePartiesOfRecord(dirname(f.dbPath), CLAIMANT_CASE_DATA);
    await submissionDataExecute(f.dbPath, SEED);

    const result = submissionFormsRender(f.dbPath, 1, { clientName: "Slot", clientNo: "9001", matterNo: "L9001" });
    const writtenArgument = result.documents.find((d) => d.document_type === "Written_arguments").markdown;
    const lineFor = (id) => {
      const line = writtenArgument.split("\n").find((l) => l.includes(`<!-- law_assertion_id ${id} -->`));
      assert.ok(line, `expected law assertion ${id} to render its own paragraph`);
      return line;
    };

    // (i) no statement at all -- the only state 📖 still names.
    assert.match(lineFor(1), /📖/, "expected 📖 on a proposition with no statement of law");
    assert.doesNotMatch(lineFor(1), /🔬/, "expected no 🔬 where there is nothing to scrutinize");

    // (ii) one lead statement -- a lead is in hand, so the work is scrutiny, not research.
    assert.match(lineFor(2), /🔬/, "expected 🔬 on a proposition holding only an unverified lead");
    assert.doesNotMatch(lineFor(2), /📖/, "expected 📖 withheld once a lead statement exists");

    // (iii) one verified statement -- neither fires.
    assert.doesNotMatch(lineFor(3), /📖|🔬/, "expected neither marker on a verified-backed proposition");

    // (iv) only a killed authority's statement -- invisible to both, so 📖 stands.
    assert.match(lineFor(4), /📖/, "expected 📖 -- a killed authority's statement is invisible to the slot");
    assert.doesNotMatch(lineFor(4), /🔬/, "expected no 🔬 from a killed authority's statement");

    // (v) the jurisdictional twin: an order whose filled basis rests on the same lead. Without the
    // query carrying verification, this line renders clean -- a rule-6 falsely-finished order.
    const reliefLine = writtenArgument.split("\n").find((l) => l.includes("<!-- relief_item a -->"));
    assert.ok(reliefLine, "expected the order's own line to render");
    assert.match(reliefLine, /🔬/, "expected 🔬 on an order whose jurisdictional basis rests on an unverified lead");
    assert.doesNotMatch(reliefLine, /🏛️/, "expected no 🏛️ -- the basis is filled, it is the verification that is outstanding");
  } finally {
    f.cleanup();
  }
});

// #828: an overruled authority's own statement lines render no work marker. ⛔ is an event, and
// work-markers.md's ⛔ row gives the work it routes as "research-lawyer replaces; basis reopens
// (⛔→🏛️⊕📖)", so the whole 📜 📍 🔬 🏅 ladder is withheld on rule 1 (a marker names remaining
// work) -- the same ground as the killed rule, differing only in who rejected the authority.
// The jurisdictional half is pinned by markers-jurisdiction.unit.test.mjs; this is the doctrinal
// half, which the unit tests cannot reach because lawStatementMarkers is module-local.
test("#828: an overruled authority's statement line withholds 📜 📍 🔬 🏅 and keeps ⛔", async () => {
  const f = fixture();
  try {
    await freshSubmissionDb(f.dbPath);
    writePartiesOfRecord(dirname(f.dbPath), CLAIMANT_CASE_DATA);
    await submissionDataExecute(f.dbPath, SEED);

    const result = submissionFormsRender(f.dbPath, 1, { clientName: "Slot", clientNo: "9001", matterNo: "L9001" });
    // A lead statement rides the brief-only cap, so its own line prints in the Counsel Brief only.
    const brief = result.documents.find((d) => d.document_type === "Counsel_brief").markdown;
    const line = brief.split("\n").find((l) => l.includes("<!-- statement_of_law_id 5 -->"));
    assert.ok(line, "expected the overruled authority's statement to render its own line");

    assert.match(line, /⛔/, "expected ⛔ -- the event that routes the replacement still renders");
    assert.doesNotMatch(line, /📜/, "expected 📜 withheld -- nobody is asked to excerpt an authority that is not good law");
    assert.doesNotMatch(line, /📍/, "expected 📍 withheld on an overruled authority");
    assert.doesNotMatch(line, /🔬/, "expected 🔬 withheld -- scrutinizing a lead that is already not good law is not work owed");
    assert.doesNotMatch(line, /🏅/, "expected 🏅 withheld -- rating an overruled authority's source is not work owed");
    assert.doesNotMatch(line, /📇/, "expected no 📇 -- note up is spent, which is how the treatment is known");
  } finally {
    f.cleanup();
  }
});

// #830: the proposition's own line reads ACROSS statements, so it is a different surface from the
// statement's own line #828 settled. An overruled authority's statements count toward nothing read
// across statements, exactly as a killed authority's do not (work-markers.md §1 "Overruled binds
// every row of 1a"), so a proposition holding nothing else has lost its doctrinal basis: 📖 reopens
// with the ⛔ that routed it as its prefix (Types, ⛔→🏛️⊕📖 -- the order's line already ships the
// 🏛️ half). Before this, proposition 5 read 🔬 🏅 (scrutinize an authority already not good law)
// and proposition 6 read clean (rule 6: no work owed, though its only authority was gone).
test("#830: an overruled authority's statements drop out of the proposition's read set, reopening ⛔ 📖", async () => {
  const f = fixture();
  try {
    await freshSubmissionDb(f.dbPath);
    writePartiesOfRecord(dirname(f.dbPath), CLAIMANT_CASE_DATA);
    await submissionDataExecute(f.dbPath, SEED);

    const result = submissionFormsRender(f.dbPath, 1, { clientName: "Slot", clientNo: "9001", matterNo: "L9001" });
    const writtenArgument = result.documents.find((d) => d.document_type === "Written_arguments").markdown;
    const lineFor = (id) => {
      const line = writtenArgument.split("\n").find((l) => l.includes(`<!-- law_assertion_id ${id} -->`));
      assert.ok(line, `expected law assertion ${id} to render its own paragraph`);
      return line;
    };

    // (i) the lead half of the defect: the roll-up asked for scrutiny of an authority already not
    // good law, and rated its source. Both are the work #828 held is not owed.
    assert.match(lineFor(5), /⛔📖/, "expected ⛔📖 -- the event prefixing the basis it reopened, fused as one set");
    assert.doesNotMatch(lineFor(5), /🔬/, "expected no 🔬 -- scrutinizing an overruled lead is not work owed");
    assert.doesNotMatch(lineFor(5), /🏅/, "expected no 🏅 -- rating an overruled authority's source is not work owed");

    // (ii) the verified half: the line was clean, which rule 6 reads as finished.
    assert.match(lineFor(6), /⛔📖/, "expected ⛔📖 on a proposition whose only verified statement is overruled");

    // (iii) the statement drops out of the read set; the proposition is not written off with it.
    // 🥉 is the load-bearing glyph: counting the overruled primary statement returns 🥇, which
    // clears the whole rung and asserts primary support the proposition does not have.
    assert.match(lineFor(7), /🥉/, "expected 🥉 -- the live tertiary statement is the best source actually held");
    assert.doesNotMatch(lineFor(7), /📖/, "expected no 📖 where a counted statement remains");
    assert.match(lineFor(7), /⛔🥉/, "expected ⛔ -- the proposition's line carries the overruling of a statement it keeps beside a live one (#1200)");
    assert.doesNotMatch(lineFor(7), /🔬/, "expected no 🔬 -- the live statement is verified");
  } finally {
    f.cleanup();
  }
});

// #842: printing, not marking. #828 silenced the work markers on an overruled authority's
// statement lines and #830 dropped those statements from the proposition's read set, but both
// left the excerpt and the citation printing on every venue face -- and a filed face is the
// mockup with its markers stripped, so the forum received a verbatim quotation of a case the
// record says is not good law, indistinguishable from a sound one. An overruled authority's
// statements now ride the brief-only cap exactly as a killed authority's do (work-markers.md
// section 4 "Killed"; overruled differs only in who did the rejecting, #828's own ground):
// Counsel Brief only, where the statement's own line still carries the marker that says so.
//
// Proposition 7 is the load-bearing case. It keeps a counted statement, so the overruled one
// prints only in the Counsel Brief; the venue mockup's tell is the ⛔ on the proposition's own
// line (#1200), as a killed authority's statements and a lead are likewise brief-only.
test("#842: an overruled authority's statements ride the brief-only cap, printing in the Counsel Brief alone", async () => {
  const f = fixture();
  try {
    await freshSubmissionDb(f.dbPath);
    writePartiesOfRecord(dirname(f.dbPath), CLAIMANT_CASE_DATA);
    await submissionDataExecute(f.dbPath, SEED);

    const client = { clientName: "Slot", clientNo: "9001", matterNo: "L9001" };
    const OVERRULED_SOLE = "A verified statement on an authority the court has since overruled.";
    const OVERRULED_BESIDE_LIVE = "An overruled primary statement.";
    const LIVE_TERTIARY = "A live tertiary statement of the same proposition.";
    const KILLED = "A statement resting on a killed authority.";

    const mockup = submissionFormsRender(f.dbPath, 1, client);
    const writtenArgument = mockup.documents.find((d) => d.document_type === "Written_arguments").markdown;
    const brief = mockup.documents.find((d) => d.document_type === "Counsel_brief").markdown;
    const filed = submissionFormsRender(f.dbPath, 1, client, "filed")
      .documents.find((d) => d.document_type === "Written_arguments").markdown;

    // (i) The sole-statement case. After #830 this proposition's line reads the basis as reopened;
    // printing the overruled excerpt beneath it made one paragraph assert both.
    assert.equal(writtenArgument.includes(OVERRULED_SOLE), false, "expected the overruled authority's verified excerpt off the venue mockup");
    assert.equal(filed.includes(OVERRULED_SOLE), false, "expected it off the filed face -- the forum must never be quoted an overruled authority");
    assert.equal(writtenArgument.includes("*Overruled Authority v. W*"), false, "expected the citation line withheld too, not just the quotation");
    // #1202: the mockup names the authority only in the proposition line's tag, beside its ⛔.
    assert.match(writtenArgument, /\(overruled: Overruled Authority v\. W[^)]*\) ⛔/, "expected the proposition line to name the overruled authority");
    assert.equal(filed.includes("Overruled Authority v. W"), false, "expected the citation off the filed face");

    // (ii) The proposition is not written off with its statement: a live statement of the same
    // proposition still prints, on both faces.
    assert.equal(writtenArgument.includes(OVERRULED_BESIDE_LIVE), false, "expected the overruled statement dropped where a live one sits beside it");
    assert.ok(writtenArgument.includes(LIVE_TERTIARY), "expected the live statement of the same proposition to print");
    assert.ok(filed.includes(LIVE_TERTIARY), "expected the live statement on the filed face");

    // (iii) Parity with the killed axis, which is the whole ground of the decision.
    assert.equal(writtenArgument.includes(KILLED), false, "expected a killed authority's statement off the venue mockup, as before");

    // (iv) The human keeps a surface. The Counsel Brief lifts the cap, and the statement's own
    // line carries the treatment event -- the flag a killed statement gets as plain text.
    assert.ok(brief.includes(OVERRULED_SOLE), "expected the Counsel Brief to print what the venue faces withhold");
    assert.ok(brief.includes(OVERRULED_BESIDE_LIVE), "expected the brief to print the dropped statement of proposition 7 too");
    const briefLine = brief.split("\n").find((l) => l.includes("<!-- statement_of_law_id 6 -->"));
    assert.ok(briefLine, "expected statement 6 to render its own line in the Counsel Brief");
    assert.match(briefLine, /\u26d4/, "expected the treatment event on that line -- without it the brief reads as sound support (rule 6)");
  } finally {
    f.cleanup();
  }
});

// Schema v46: the research lawyer's negative return is recorded as verification 'failed', the
// finding in doubt. The statement counts toward nothing read across statements, as an overruled
// authority's does not, so a proposition left with nothing else reads 📖 again rather than 🔬 (the
// scrutiny is done), while a sibling statement still supports its own proposition. The failed
// statement rides the brief-only cap: its line, with 👃 and its finding, prints in the Counsel Brief
// alone, and no 🔬 is proposed for it again. The proposition line and the order line never read
// clean while counsel's decision is owed, and the filed face carries neither the excerpt nor the
// finding.
test("v46: a failed statement reopens 📖, keeps 👃 and its finding in the Counsel Brief, and reaches no filed face", async () => {
  const f = fixture();
  try {
    await freshSubmissionDb(f.dbPath);
    writePartiesOfRecord(dirname(f.dbPath), CLAIMANT_CASE_DATA);
    await submissionDataExecute(f.dbPath, SEED);

    const client = { clientName: "Slot", clientNo: "9001", matterNo: "L9001" };
    const FINDING_8 = "Scrutiny failed 2026-10-02: ratio held; fit failed (the passage concerns (a) leases, not licences).";
    const FINDING_9 = "Scrutiny failed 2026-10-02: fit failed on the second limb.";
    const FAILED_8 = "A passage the research lawyer found does not support proposition 8.";
    const VERIFIED_9 = "A verified statement of proposition 9.";

    const mockup = submissionFormsRender(f.dbPath, 1, client);
    const writtenArgumentDoc = mockup.documents.find((d) => d.document_type === "Written_arguments");
    const writtenArgument = writtenArgumentDoc.markdown;
    const brief = mockup.documents.find((d) => d.document_type === "Counsel_brief").markdown;
    const traced = (md, trace) => {
      const lines = md.split("\n");
      const i = lines.findIndex((l) => l.includes(trace));
      assert.ok(i > 0, `expected a line traced ${trace}`);
      return { line: lines[i], before: lines[i - 1] };
    };

    // (i) Nothing else supports proposition 8: 📖, never 🔬, and the finding as a plain-text tag.
    const sole = traced(writtenArgument, "<!-- law_assertion_id 8 -->").line;
    assert.match(sole, /📖/, "expected 📖 -- a failed statement supplies no doctrinal basis");
    assert.doesNotMatch(sole, /🔬/, "expected no 🔬 -- the scrutiny is done");
    assert.ok(sole.includes(` (scrutiny failed: ${FINDING_8})`), sole);

    // (ii) A verified sibling still supports proposition 9, and the tag prints all the same.
    const beside = traced(writtenArgument, "<!-- law_assertion_id 9 -->").line;
    assert.doesNotMatch(beside, /📖|🔬/, "expected neither -- the verified statement supports the proposition");
    assert.ok(beside.includes(` (scrutiny failed: ${FINDING_9})`), beside);
    assert.ok(writtenArgument.includes(VERIFIED_9), "expected the verified sibling to print");
    assert.equal(writtenArgument.includes(FAILED_8), false, "expected the failed excerpt off the venue mockup -- it rides the brief-only cap");

    // (iii) The Counsel Brief prints the failed statement: 👃 and no 🔬 on its marker line, the
    // finding on its citation line just above.
    const statement = traced(brief, "<!-- statement_of_law_id 9 -->");
    assert.ok(brief.includes(FAILED_8), "expected the Counsel Brief to print the failed excerpt");
    assert.match(statement.line, /👃/, "expected 👃 -- the finding is the statement's doubt");
    assert.doesNotMatch(statement.line, /🔬/, "expected no 🔬 on a failed statement");
    assert.ok(statement.before.endsWith(` (scrutiny failed: ${FINDING_8})`), statement.before);

    // (iv) An order whose filled basis rests on a failed statement reads bare 🏛️.
    const order = traced(writtenArgument, "<!-- relief_item b -->").line;
    assert.match(order, /🏛️/, "expected 🏛️ -- a failed statement fills no basis");
    assert.doesNotMatch(order, /🔬|📜|📍|🏅|📇/, "expected no rung of the failed statement's own");

    // (v) The filed face carries neither the excerpt nor either finding; the propositions print bare.
    const filed = submissionFormsRender(f.dbPath, 1, client, "filed").documents.find((d) => d.document_type === "Written_arguments").markdown;
    assert.equal(filed.includes(FAILED_8), false, "expected the failed excerpt off the filed face");
    assert.doesNotMatch(filed, /scrutiny failed/i, "expected no finding on the filed face");
    assert.match(filed, /^\d+\. a proposition whose only statement failed scrutiny$/m);
    assert.match(filed, /^\d+\. a proposition holding a failed statement beside a verified one$/m);
    assert.ok(filed.includes(VERIFIED_9), "expected the verified sibling on the filed face");

    // (vi) No 🔬 is proposed for a failed statement again. Nor is the 📖 it reopened: the next step
    // is counsel's decision on the finding, so that 📖 is recorded as a non-generating proposition
    // instance, which the Goal card still counts. A proposition with no statement at all still
    // proposes doctrinal-basis as before.
    const manifest = JSON.parse(readFileSync(join(dirname(writtenArgumentDoc.path), "render-manifest.json"), "utf-8"));
    const keys = new Set(manifest.inventory.filter((e) => e.generating !== false).map(proposalKey));
    const proposed = new Set(boardDataOf(f.dbPath, 1, client).proposals.map((p) => p.key));
    for (const id of [9, 10, 12]) assert.equal(keys.has(`scrutinize:statements_of_law:${id}`), false, `expected no 🔬 Proposal for failed statement ${id}`);
    for (const set of [keys, proposed]) {
      assert.equal(set.has("doctrinal-basis:law_assertions:8"), false, "expected no 📖 Proposal while a statement of the proposition has failed scrutiny");
      assert.equal(set.has("doctrinal-basis:law_assertions:9"), false, "expected no 📖 Proposal where a verified statement remains");
      assert.ok(set.has("doctrinal-basis:law_assertions:1"), "expected a proposition with no statement at all to propose doctrinal-basis as before");
    }
    assert.ok(
      manifest.inventory.some((e) => e.generating === false && e.marker === "📖" && e.instance === "proposition" && e.table === "law_assertions" && e.id === 8),
      "expected proposition 8's 📖 recorded as a non-generating proposition instance"
    );
    assert.equal(manifest.inventory.some((e) => e.generating === false && e.marker === "📖" && e.id === 1), false, "expected proposition 1's 📖 to generate, not to be recorded as non-generating");
  } finally {
    f.cleanup();
  }
});
