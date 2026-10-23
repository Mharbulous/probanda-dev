// Independent proof for wayfinder ticket #313 ("Build per-form population
// skills"): the new /draft skill delegates all write guidance to
// /drafting-data's references/filing-checklists.md. This file seeds one
// fresh proceeding per v1 form kind -- new party/fact/argument content, not
// the Ashbourne/Halloway/Larchmont fixtures forms-render-*.db.test.mjs already
// covers -- by following *only* that checklist doc, then asserts each filing
// renders without throwing and with none of the work-marker glyphs the
// checklist claims are avoidable when every listed field is actually filled.
//
// This does not prove the checklist is *sufficient* guidance for a live
// practitioner session -- an implementer-authored test written with the
// checklist open cannot prove that; #303's measured practitioner loop will.
// It proves something narrower but new: a filing populated exactly as the
// checklist directs renders clean, which is the population skill's actual
// end-state (the existing golden fixtures deliberately include gaps and
// reserved rows to exercise the markers, so nothing before this asserted a
// fully-populated filing has zero markers).
//
// Schema v10/v11 (#380, #384): filing-checklists.md does not yet direct
// populating a filing's Written Arguments companion pointer rows
// (document='written_argument') -- that's the deferred "document-pointer
// elicitation" follow-on ticket, #384's own resolution. Until it lands, an
// item the venue form deploys and the checklist-driven seed below never
// separately points into the Written Arguments, so 🧵 *loose thread* fires
// on every such form line -- expected, fail-visible noise (work-markers.md:
// "render lands #384"), not a checklist gap. Asserted explicitly below
// rather than silently excluded.
//
// #400: 🧾 *factual basis needed* is likewise expected fail-visible noise on
// every contention line below -- filing-checklists.md does not (yet) direct
// linking a submission's rested-on facts via submission_facts, so every
// seeded submission fires 🧾 unconditionally by SSOT design (#388/#373).
// Unlike 🧵, part of this noise is permanent rather than deferred: a
// law-only jurisdiction submission fires 🧾 with no exemption to populate
// toward. Fixtures are seeded checklist-only on purpose (see file header),
// so no submission_facts row is added here to silence it -- excluded from
// the glyph list below and asserted explicitly instead.

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

const { freshSubmissionDb } = await import("./helpers/template-db.mjs");
const { writePartiesOfRecord } = await import("./helpers/matter-data-fixture.mjs");
const { submissionDataExecute } = await import("../build/submission/backend.js");
const { submissionFormsRender } = await import("../build/submission/forms.js");

// Every glyph markers.ts can emit (see .claude/skills/drafting-data/
// references/work-markers.md and drafting-data/references/filing-checklists.md
// §5) a clean render must contain none of, EXCEPT 🧵 and 🧾 (see file header) --
// checked for separately, and deliberately, per venue-form document below.
const ALL_MARKER_GLYPHS = ["🧩", "🏷️", "🕵️", "⬜", "🏛️", "📖", "🔬", "📜", "📑", "💬", "📍", "📌", "🧷", "📇", "👤", "🗣️", "✍️", "🖋️", "✒️", "🚧", "⚠️", "🚨", "⛔", "🕰️", "🂡", "🤥", "🚩", "🦵", "👃", "↩️", "🥈", "🥉", "🏅"];

function assertRendersClean(label, text) {
  const found = ALL_MARKER_GLYPHS.filter((g) => text.includes(g));
  assert.deepEqual(found, [], `${label} should render with no work markers, found: ${found.join(" ")}\n---\n${text}`);
}

// The case data each fixture's parties are linked to, holding their counsel (party/counsel SSOT).
const WHITLOCK_CASE_DATA = {
  parties: [
    { id: 1, name: "Marisol Whitlock", counsel_name: "K. Alderman" },
    { id: 2, name: "Ironclad Fabrication Ltd." },
  ],
};
const FENWICK_CASE_DATA = {
  proceedings: [{ id: 1, file_number: "S-247711" }],
  parties: [
    { id: 1, name: "Tobias Fenwick", counsel_name: "R. Okonkwo", of_record: [[1, "plaintiff"]] },
    { id: 2, name: "Larkspur Holdings Inc.", of_record: [[1, "defendant"]] },
  ],
};
const HARROW_CASE_DATA = {
  proceedings: [{ id: 1, file_number: "S-118820" }],
  parties: [
    { id: 1, name: "Odalys Harrow", counsel_name: "J. Vantassel", of_record: [[1, "plaintiff"]] },
    { id: 2, name: "Prairie Rock Contracting Ltd.", of_record: [[1, "defendant"]] },
  ],
};
const CASTELLAN_CASE_DATA = {
  proceedings: [{ id: 1, file_number: "S-330214" }],
  parties: [
    { id: 1, name: "Renata Castellan", counsel_name: "M. Ferreira", of_record: [[1, "plaintiff"]] },
    { id: 2, name: "Bluewater Marine Services Ltd.", counsel_name: "P. Nakagawa", of_record: [[1, "defendant"]] },
  ],
};
const MARCHETTI_CASE_DATA = {
  proceedings: [{ id: 1, file_number: "S-552011" }],
  parties: [
    { id: 1, name: "Priya Marchetti", counsel_name: "H. Ostrander", of_record: [[1, "plaintiff"]] },
    { id: 2, name: "Alderglen Ranch Holdings Ltd.", counsel_name: "F. Byrne", of_record: [[1, "defendant"]] },
  ],
};

/** A matter folder in a scratch dir: the database in its own `0. CASE DATA`, beside the `0. DRAFT` its
 * Writings' mockups are written in (spec 2026-10-22). */
function seededDbFixture() {
  const dir = mkdtempSync(join(tmpdir(), "coclerk-submission-skill-population-"));
  const matter = join(dir, "Matter");
  mkdirSync(join(matter, "0. CASE DATA"), { recursive: true });
  mkdirSync(join(matter, "0. DRAFT"));
  const dbPath = join(matter, "0. CASE DATA", "submission.sqlite");
  return { dir, dbPath, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

function findFile(dir, fileName) {
  const found = readdirSync(dir).find((f) => f === fileName);
  if (!found) throw new Error(`${fileName} not found in ${dir} (has: ${readdirSync(dir).join(", ")})`);
  return readFileSync(join(dir, found), "utf-8");
}

// The whole page, data line included. Phase D put marker glyphs on the board's data (design §13),
// which looked like a reason to stop scanning it -- but a checklist-clean population prints only
// 🧵 and 🧾, and this file's ALL_MARKER_GLYPHS excludes both, so the scan still passes. Keeping it
// is what catches a recorder that records an entry for a glyph no document printed: over-recording
// shows up in this data line and nowhere else on a clean population. Since ADR 0033's 2026-10-05
// amendment the board is the filing's own Job Board page, written only by a render given a draft folder.
function boardPage(f, client) {
  const draft = join(f.dir, "Matter", "0. DRAFT");
  const rendered = submissionFormsRender(f.dbPath, 1, client, "mockup", undefined, undefined, undefined, undefined, undefined, draft);
  return readFileSync(rendered.documents.find((d) => d.document_type === "Work_board").path, "utf-8");
}

test("VanIAC submissions package renders clean from checklist-only population", async () => {
  const f = seededDbFixture();
  try {
    await freshSubmissionDb(f.dbPath);
    writePartiesOfRecord(dirname(f.dbPath), WHITLOCK_CASE_DATA);
    await submissionDataExecute(
      f.dbPath,
      `
      INSERT INTO proceedings (id, matter_reference, forum, court_or_centre, registry, file_number, style_of_cause, courthouse_address)
        VALUES (1, 'L5501 - Whitlock', 'CAN/BC/Vancouver-International-Arbitration-Centre', 'VanIAC', NULL, NULL, 'Whitlock v. Ironclad Fabrication Ltd.', NULL);

      INSERT INTO parties (id, proceeding_id, name, role, ordinal, is_client, is_applicant, to_be_served, case_party_id)
        VALUES
          (1, 1, 'Marisol Whitlock', 'Claimant', 1, 1, 1, 0, 1),
          (2, 1, 'Ironclad Fabrication Ltd.', 'Respondent', 2, 0, 0, 1, 2);

      INSERT INTO authorities (id, proceeding_id, style_of_cause_or_title, citation, kind, weight, treatment)
        VALUES (1, 1, 'Bellweather Holdings v. Stone', '2023 BCCA 55', 'case', 'binding', 'good_law');

      INSERT INTO submissions (id, proceeding_id, contention, ordinal)
        VALUES (1, 1, 'The Respondent breached clause 4.2 of the Fabrication Agreement.', 1);
      INSERT INTO law_assertions (id, proceeding_id, proposition, dead_end)
        VALUES (1, 1, 'breach of a delivery condition', 0);
      -- source (schema v9, issue #365) rated 'primary' -- "checklist-only
      -- population renders clean" must stay true once 🥉/🥈 join the glyph
      -- set; an unrated statement here would fire 🏅 unrated (#597; 🥉 before
      -- that issue narrowed it) and break that guarantee.
      INSERT INTO statements_of_law (id, proceeding_id, law_assertion_id, authority_id, pinpoint, excerpt, source, verification)
        VALUES (1, 1, 1, 1, 'para 12', 'A term requiring delivery by a fixed date is a condition, not a warranty.', 'primary', 'verified');
      INSERT INTO submission_law (submission_id, law_assertion_id) VALUES (1, 1);

      -- Issue #348, re-shaped by #380 onto order_sought_requires: a 'filled'
      -- edge needs excerpt_id pointing at a statements_of_law row -- a
      -- standalone citation (law_assertion_id NULL), reusing the same
      -- good-law authority, to actually satisfy "checklist-only population
      -- renders clean".
      -- source rated here too: 🏅 unrated (#597) reads every statement of law,
      -- jurisdictional as well as doctrinal, so a standalone citation left
      -- unrated would fire it and break "renders clean" the same way an
      -- unrated doctrinal statement would.
      INSERT INTO statements_of_law (id, proceeding_id, law_assertion_id, authority_id, pinpoint, excerpt, source, verification)
        VALUES (2, 1, NULL, 1, 'para 4', 'the arbitral tribunal has the power to award damages for breach of the Fabrication Agreement', 'primary', 'verified');

      INSERT INTO order_sought (id, proceeding_id, wording, amount)
        VALUES (1, 1, 'payment of $85,000 in damages', 85000);
      INSERT INTO order_sought_requires (order_sought_id, excerpt_id, basis_state) VALUES (1, 2, 'filled');
      -- 🦵 unserved petitum needs a serving submission (schema v10, #380).
      INSERT INTO order_sought_served_by (order_sought_id, submission_id) VALUES (1, 1);

      INSERT INTO witnesses (id, proceeding_id, name, relationship) VALUES (1, 1, 'D. Okafor', 'site supervisor');

      INSERT INTO facts (id, proceeding_id, postulate)
        VALUES (1, 1, 'Ironclad Fabrication Ltd. failed to deliver the fabricated components by March 1, 2026.');

      INSERT INTO documents (id, proceeding_id, label, document_date, description)
        VALUES (1, 1, 'Fabrication Agreement', '2025-11-01', 'The signed agreement, clause 4.2 at issue');

      INSERT INTO filings (id, proceeding_id, kind, subkind, round, title)
        VALUES (1, 1, 'submissions_package', NULL, 'opening', 'Whitlock Opening Submissions');

      -- VanIAC's own venue document is document='form' (#380's resolution --
      -- "for a VanIAC submissions package that face is the submissions
      -- document itself"); there is no separate Written Arguments companion
      -- for this kind, so no 'written_argument' pointer rows and no 🧵.
      INSERT INTO filing_submissions (filing_id, submission_id, document, ordinal) VALUES (1, 1, 'form', 1);
      INSERT INTO filing_orders (filing_id, order_sought_id, document, ordinal) VALUES (1, 1, 'form', 1);
      INSERT INTO filing_documents (filing_id, document_id, ordinal, role) VALUES (1, 1, 1, 'evidence');

      INSERT INTO documents (id, proceeding_id, label, instrument, deponent, execution, signed_at)
        VALUES (2, 1, 'Witness Statement of D. Okafor', 'witness_statement', 1, '2026-08-15', 'Vancouver, BC');
      INSERT INTO filing_documents (filing_id, document_id, ordinal, role) VALUES (1, 2, 1, 'witness_statement');
      INSERT INTO statement_paragraphs (id, document_id, ordinal, text)
        VALUES (1, 2, 1, 'I inspected the delivery site on March 1, 2026 and no components had arrived.');
      INSERT INTO statements_of_fact (id, proceeding_id, fact_id, witness_id, instrument, exhibit_id, pinpoint, interviewed)
        VALUES (1, 1, 1, 1, 2, 1, 'para 1', 1);
      INSERT INTO paragraph_statements_of_fact (statement_paragraph_id, statement_of_fact_id) VALUES (1, 1);

      UPDATE db_meta SET value = CAST(value AS INTEGER) + 1 WHERE key = 'revision';
      `.trim()
    );

    const result = submissionFormsRender(f.dbPath, 1, { clientName: "Whitlock", clientNo: "5501", matterNo: "L5501" });
    // Written Arguments (venue) + Evidence Index + Witness Statement + the Job Board's entry (ADR 0009; #1365: its summary, no file).
    assert.equal(result.documents.length, 4);
    const baseDir = dirname(result.documents[0].path);

    const wa = findFile(baseDir, "Written Arguments.md");
    assert.ok(wa.includes("🧾"), "factual-basis-needed should fire on a contention with no submission_facts row -- its absence would be a silent regression, not a clean render");
    assertRendersClean("Written Arguments", wa);
    assertRendersClean("Witness Statement", findFile(baseDir, "Witness Statement - D. Okafor.md"));
    assertRendersClean("Evidence Index", findFile(baseDir, "Evidence Index.md"));
    assertRendersClean("Job Board", boardPage(f, { clientName: "Whitlock", clientNo: "5501", matterNo: "L5501" }));
  } finally {
    f.cleanup();
  }
});

test("BCSC Notice of Application renders clean from checklist-only population", async () => {
  const f = seededDbFixture();
  try {
    await freshSubmissionDb(f.dbPath);
    writePartiesOfRecord(dirname(f.dbPath), FENWICK_CASE_DATA);
    await submissionDataExecute(
      f.dbPath,
      `
      INSERT INTO proceedings (id, matter_reference, forum, court_or_centre, registry, file_number, style_of_cause, courthouse_address)
        VALUES (1, 'L5502 - Fenwick', 'CAN/BC/BCSC', 'BC Supreme Court', 'Victoria', 'S-247711', 'Fenwick v. Larkspur Holdings Inc.', '850 Burdett Avenue');

      INSERT INTO parties (id, proceeding_id, name, role, ordinal, is_client, is_applicant, to_be_served, case_party_id)
        VALUES
          (1, 1, 'Tobias Fenwick', 'Plaintiff', 1, 1, 1, 0, 1),
          (2, 1, 'Larkspur Holdings Inc.', 'Defendant', 2, 0, 0, 1, 2);

      INSERT INTO authorities (id, proceeding_id, style_of_cause_or_title, citation, kind, weight, treatment)
        VALUES (1, 1, 'Supreme Court Civil Rules', 'R. 7-1', 'rule', 'binding', 'good_law');
      -- #1628: a rule is noted up by its statute-currency result alone, recorded as
      -- filing-checklists.md "Recording a statute-currency result" directs.
      UPDATE authorities SET currency_status = 'current', currency_checked_on = '2026-10-04' WHERE id = 1;

      -- Issue #348, re-shaped by #380: a 'filled' order_sought_requires edge
      -- needs excerpt_id -- a standalone citation (law_assertion_id NULL),
      -- reusing the same good-law authority.
      -- source rated here too, for 🏅 unrated (#597) -- see the VanIAC seed.
      INSERT INTO statements_of_law (id, proceeding_id, law_assertion_id, authority_id, pinpoint, excerpt, source, verification)
        VALUES (2, 1, NULL, 1, 'R. 7-1(2)', 'the court has inherent jurisdiction to compel production in aid of its Rule 7-1 powers', 'primary', 'verified');

      INSERT INTO order_sought (id, proceeding_id, wording)
        VALUES (1, 1, 'an order requiring production of the 2025 financial statements');
      INSERT INTO order_sought_requires (order_sought_id, excerpt_id, basis_state) VALUES (1, 2, 'filled');

      INSERT INTO submissions (id, proceeding_id, contention, ordinal)
        VALUES (1, 1, 'The court has jurisdiction under Rule 7-1 to compel document production.', 1);
      INSERT INTO law_assertions (id, proceeding_id, proposition, dead_end)
        VALUES (1, 1, 'production jurisdiction', 0);
      -- source (schema v9, issue #365) rated 'primary' -- same reason as the
      -- other seed's doctrinal statement: keeps this fixture marker-clean.
      INSERT INTO statements_of_law (id, proceeding_id, law_assertion_id, authority_id, pinpoint, excerpt, source, verification)
        VALUES (1, 1, 1, 1, 'R. 7-1(1)', 'The court may order a party to produce a document in that party''s possession.', 'primary', 'verified');
      INSERT INTO submission_law (submission_id, law_assertion_id) VALUES (1, 1);
      -- 🦵 unserved petitum needs a serving submission (schema v10, #380).
      INSERT INTO order_sought_served_by (order_sought_id, submission_id) VALUES (1, 1);

      INSERT INTO documents (id, proceeding_id, label, document_date, description)
        VALUES (2, 1, 'Response to Civil Claim', '2026-06-12', 'The filed response, containing no denial of the production obligation');
      INSERT INTO facts (id, proceeding_id, postulate, court_record, court_record_pinpoint)
        VALUES (1, 1, 'The Response to Civil Claim contains no denial of the production obligation.', 2, 'Part 1, Division 1');

      INSERT INTO documents (id, proceeding_id, label, document_date, description)
        VALUES (1, 1, 'Correspondence re: production request', '2026-07-02', 'Letter requesting the 2025 financial statements');

      -- Issue #398: Part 4 now checks the exhibit-side 👤 marker on
      -- role='evidence'/'other' rows -- document 1 must be tendered per the
      -- checklist's own Evidence Index guidance (filing-checklists.md §1),
      -- or this "checklist-only population" fixture is no longer clean.
      -- Tendered by the plaintiff's own personal-knowledge statement (fact 1
      -- already renders clean via its court_record link for noWitnessMarker/
      -- statementOfFactMarkers -- and since Phase C (#777) the fact-side pin
      -- markers sit inside that guard too, so 📌 and 🧷 stay off this line
      -- whatever locators this row holds).
      INSERT INTO witnesses (id, proceeding_id, name, relationship)
        VALUES (1, 1, 'T. Fenwick', 'plaintiff, personal knowledge of the correspondence');
      INSERT INTO statements_of_fact (id, proceeding_id, fact_id, witness_id, exhibit_id, pinpoint, interviewed)
        VALUES (1, 1, 1, 1, 1, 'letter dated 2026-07-02', 1);

      INSERT INTO filings (id, proceeding_id, kind, subkind, round, title)
        VALUES (1, 1, 'notice_of_application', NULL, NULL, 'Fenwick Notice of Application');

      INSERT INTO hearing_details (filing_id, hearing_date, hearing_time, time_estimate_minutes, associate_judge, proposed_hearing)
        VALUES (1, '2026-10-14', '10:00 am', 30, 1, '2026-10-14 at 10:00 am');
      -- filing_facts.section renamed to .part (#380); document='form' -- no
      -- matching document='written_argument' row is seeded (the deferred
      -- elicitation ticket's job), so 🧵 is expected on this fact/order/
      -- submission's own form line (see file header, asserted below).
      INSERT INTO filing_facts (filing_id, fact_id, document, part, ordinal) VALUES (1, 1, 'form', 'part2', 1);
      INSERT INTO filing_submissions (filing_id, submission_id, document, ordinal) VALUES (1, 1, 'form', 1);
      INSERT INTO filing_orders (filing_id, order_sought_id, document, ordinal) VALUES (1, 1, 'form', 1);
      INSERT INTO filing_documents (filing_id, document_id, ordinal, role) VALUES (1, 1, 1, 'evidence');

      UPDATE db_meta SET value = CAST(value AS INTEGER) + 1 WHERE key = 'revision';
      `.trim()
    );

    const result = submissionFormsRender(f.dbPath, 1, { clientName: "Fenwick", clientNo: "5502", matterNo: "L5502" });
    // NoA + Written Arguments companion + the Job Board's entry (ADR 0009; #1365: its summary, no file).
    assert.equal(result.documents.length, 3);
    const baseDir = dirname(result.documents[0].path);
    const noa = findFile(baseDir, "Notice of Application.md");
    // 🧵 is expected pre-elicitation noise (file header) -- assert it fires,
    // then confirm every other glyph is genuinely absent.
    assert.ok(noa.includes("🧵"), "loose-thread should fire pre-elicitation -- its absence would be a silent regression, not a clean render");
    // The lone submission is pointed only via document='form' (no 'written_argument' row is
    // seeded -- see the 🧵 comment above), so 🧾 fires on the NoA's own Part 3 line, not on the
    // Written Arguments companion, which renders no submissions for this filing at all.
    assert.ok(noa.includes("🧾"), "factual-basis-needed should fire on a contention with no submission_facts row -- its absence would be a silent regression, not a clean render");
    assertRendersClean("Notice of Application", noa);
    // Issue #440: fact 1's court_record_pinpoint ('Part 1, Division 1') must reach the
    // rendered fact line as real citation text, not just silence the 📍 marker.
    assert.ok(noa.includes("(Part 1, Division 1)"), "fact 1's court-record pinpoint should render as a citation, not disappear once captured");
    // B.C. Reg. 105/2026's Form 32 fixes no hearing date: the notice states the applicant's proposal.
    assert.ok(noa.includes("will be heard on 2026-10-14 at 10:00 am."), "hearing_details.proposed_hearing should be filled, not the hearing placeholder text");
    const wa = findFile(baseDir, "Written Arguments.md");
    assertRendersClean("Written Arguments companion", wa);
    assertRendersClean("Job Board", boardPage(f, { clientName: "Fenwick", clientNo: "5502", matterNo: "L5502" }));
  } finally {
    f.cleanup();
  }
});

test("BCSC default-judgment requisition and Form 8 render clean from checklist-only population", async () => {
  const f = seededDbFixture();
  try {
    await freshSubmissionDb(f.dbPath);
    writePartiesOfRecord(dirname(f.dbPath), HARROW_CASE_DATA);
    await submissionDataExecute(
      f.dbPath,
      `
      INSERT INTO proceedings (id, matter_reference, forum, court_or_centre, registry, file_number, style_of_cause)
        VALUES (1, 'L5503 - Harrow', 'CAN/BC/BCSC', 'BC Supreme Court', 'Kelowna', 'S-118820', 'Harrow v. Prairie Rock Contracting Ltd.');

      INSERT INTO parties (id, proceeding_id, name, role, ordinal, is_client, is_applicant, to_be_served, case_party_id)
        VALUES
          (1, 1, 'Odalys Harrow', 'Plaintiff', 1, 1, 1, 0, 1),
          (2, 1, 'Prairie Rock Contracting Ltd.', 'Defendant', 2, 0, 0, 1, 2);

      INSERT INTO order_sought (id, proceeding_id, wording, template_key, template_values)
        VALUES
          (1, 1, 'damages to be assessed', 'damages_to_be_assessed', NULL),
          (2, 1, 'costs in the fixed amount of $2,800', 'costs_fixed', '{"amount": 2800}');

      INSERT INTO documents (id, proceeding_id, label)
        VALUES (1, 1, 'Draft default judgment'), (2, 1, 'Affidavit of service and non-delivery');

      INSERT INTO filings (id, proceeding_id, kind, subkind, round, title)
        VALUES (1, 1, 'requisition_default_judgment', 'default_judgment', NULL, 'Harrow Default Judgment Requisition');

      INSERT INTO filing_orders (filing_id, order_sought_id, document, ordinal) VALUES (1, 1, 'form', 1), (1, 2, 'form', 2);
      INSERT INTO filing_documents (filing_id, document_id, ordinal, role) VALUES (1, 1, 1, 'order'), (1, 2, 2, 'affidavit');

      -- Form 8 does not read jurisdictionLadderMarker (no jurisdiction
      -- basis concept on a requisition's operative order), so no
      -- order_sought_requires seeding is needed for 🏛️ here -- only 🦵.
      -- #370's requisition-tracks inversion: this basis submission is
      -- pointed to by the Written Arguments companion, not the form itself
      -- (deployed via document='written_argument' below) -- deploying it
      -- there, not on the form, both satisfies order_sought_served_by's FK
      -- and keeps it out of the reserve (deployed, so no 🂡).
      INSERT INTO submissions (id, proceeding_id, contention, ordinal) VALUES (1, 1, 'Damages and costs are owed on the default.', 1);
      INSERT INTO filing_submissions (filing_id, submission_id, document, ordinal) VALUES (1, 1, 'written_argument', 1);
      INSERT INTO order_sought_served_by (order_sought_id, submission_id) VALUES (1, 1), (2, 1);

      UPDATE db_meta SET value = CAST(value AS INTEGER) + 1 WHERE key = 'revision';
      `.trim()
    );

    const result = submissionFormsRender(f.dbPath, 1, { clientName: "Harrow", clientNo: "5503", matterNo: "L5503" });
    // Requisition + Form 8 + Written Arguments companion + the Job Board's entry (ADR 0009; #1365: its summary, no file).
    assert.equal(result.documents.length, 4);
    const baseDir = dirname(result.documents[0].path);
    assertRendersClean("Form 17 Draft Requisition", findFile(baseDir, "Form 17 Draft Requisition.md"));
    // Unlike the NoA, the requisition renderers don't wire 🧵 -- a
    // requisition's operative order isn't "argued" the way NoA relief is
    // (#370's requisition-tracks inversion is about submissions/facts, not
    // this bare procedural order), so no written_argument pointer duplication
    // is needed here and no 🧵 is expected.
    const form8 = findFile(baseDir, "Form 8 Default Judgment.md");
    assertRendersClean("Form 8 Default Judgment", form8);
    assert.ok(!form8.includes("unrecognized template_key"), "both template_key values must be from the closed set");
    const wa = findFile(baseDir, "Written Arguments.md");
    assert.ok(wa.includes("🧾"), "factual-basis-needed should fire on a contention with no submission_facts row -- its absence would be a silent regression, not a clean render");
    assertRendersClean("Written Arguments companion", wa);
    assertRendersClean("Job Board", boardPage(f, { clientName: "Harrow", clientNo: "5503", matterNo: "L5503" }));
  } finally {
    f.cleanup();
  }
});

test("BCSC consent-order requisition and consent order render clean from checklist-only population", async () => {
  const f = seededDbFixture();
  try {
    await freshSubmissionDb(f.dbPath);
    writePartiesOfRecord(dirname(f.dbPath), CASTELLAN_CASE_DATA);
    await submissionDataExecute(
      f.dbPath,
      `
      INSERT INTO proceedings (id, matter_reference, forum, court_or_centre, registry, file_number, style_of_cause)
        VALUES (1, 'L5504 - Castellan', 'CAN/BC/BCSC', 'BC Supreme Court', 'Nanaimo', 'S-330214', 'Castellan v. Bluewater Marine Services Ltd.');

      INSERT INTO parties (id, proceeding_id, name, role, ordinal, is_client, is_applicant, to_be_served, case_party_id)
        VALUES
          (1, 1, 'Renata Castellan', 'Plaintiff', 1, 1, 1, 0, 1),
          (2, 1, 'Bluewater Marine Services Ltd.', 'Defendant', 2, 0, 0, 0, 2);

      INSERT INTO order_sought (id, proceeding_id, wording)
        VALUES (1, 1, 'the style of cause is corrected to reflect the Defendant''s full corporate name');

      INSERT INTO submissions (id, proceeding_id, contention, ordinal) VALUES (1, 1, 'Both parties consent to the corrected style of cause.', 1);
      INSERT INTO order_sought_served_by (order_sought_id, submission_id) VALUES (1, 1);

      INSERT INTO filings (id, proceeding_id, kind, subkind, round, title)
        VALUES (1, 1, 'requisition_consent', 'consent', NULL, 'Castellan Consent Order Requisition');

      INSERT INTO filing_orders (filing_id, order_sought_id, document, ordinal) VALUES (1, 1, 'form', 1);
      -- #370's requisition-tracks inversion: deployed via the Written
      -- Arguments companion, not the form (same reasoning as the default-
      -- judgment seed above).
      INSERT INTO filing_submissions (filing_id, submission_id, document, ordinal) VALUES (1, 1, 'written_argument', 1);

      UPDATE db_meta SET value = CAST(value AS INTEGER) + 1 WHERE key = 'revision';
      `.trim()
    );

    const result = submissionFormsRender(f.dbPath, 1, { clientName: "Castellan", clientNo: "5504", matterNo: "L5504" });
    // Requisition + Consent Order + Written Arguments companion + the Job Board's entry (ADR 0009; #1365: its summary, no file).
    assert.equal(result.documents.length, 4);
    const baseDir = dirname(result.documents[0].path);
    assertRendersClean("Requisition for Consent Order", findFile(baseDir, "Requisition for Consent Order.md"));
    const consentOrder = findFile(baseDir, "Consent Order.md");
    assertRendersClean("Consent Order", consentOrder);
    assert.ok(consentOrder.includes("M. Ferreira") && consentOrder.includes("P. Nakagawa"), "both represented parties should get a signature block");
    const wa = findFile(baseDir, "Written Arguments.md");
    assert.ok(wa.includes("🧾"), "factual-basis-needed should fire on a contention with no submission_facts row -- its absence would be a silent regression, not a clean render");
    assertRendersClean("Written Arguments companion", wa);
    assertRendersClean("Job Board", boardPage(f, { clientName: "Castellan", clientNo: "5504", matterNo: "L5504" }));
  } finally {
    f.cleanup();
  }
});

test("BCSC Application Response renders clean from checklist-only population (issue #386, checklist §5)", async () => {
  const f = seededDbFixture();
  try {
    await freshSubmissionDb(f.dbPath);
    writePartiesOfRecord(dirname(f.dbPath), MARCHETTI_CASE_DATA);
    await submissionDataExecute(
      f.dbPath,
      `
      INSERT INTO proceedings (id, matter_reference, forum, court_or_centre, registry, file_number, style_of_cause, courthouse_address)
        VALUES (1, 'L5505 - Marchetti', 'CAN/BC/BCSC', 'BC Supreme Court', 'Kamloops', 'S-552011', 'Marchetti v. Alderglen Ranch Holdings Ltd.', '455 Columbia Street');

      -- address_for_service_filed set on both parties -- checklist §5 says
      -- 'unknown' (the column default) fires the derived AFS question marker.
      INSERT INTO parties (id, proceeding_id, name, role, ordinal, is_client, is_applicant, to_be_served, address_for_service_filed, case_party_id)
        VALUES
          (1, 1, 'Priya Marchetti', 'Plaintiff', 1, 0, 1, 0, 'yes', 1),
          (2, 1, 'Alderglen Ranch Holdings Ltd.', 'Defendant', 2, 1, 0, 1, 'yes', 2);

      INSERT INTO documents (id, proceeding_id, label, document_date, description)
        VALUES
          (1, 1, 'Notice of Application', '2026-07-20', NULL),
          (2, 1, 'Affidavit of F. Byrne', '2026-08-05', 'Responding affidavit');

      -- Every opposing_orders row positioned -- checklist §5 says an
      -- unpositioned row fires the derived ⬜ instance.
      INSERT INTO opposing_orders (id, proceeding_id, document_id, paragraph_number, wording)
        VALUES (1, 1, 1, 1, 'an order compelling an accounting of the ranch trust funds');

      INSERT INTO filings (id, proceeding_id, kind, subkind, round, title)
        VALUES (1, 1, 'application_response', NULL, NULL, 'Marchetti Application Response');

      INSERT INTO filing_positions (filing_id, opposing_order_id, position, proposed_terms)
        VALUES (1, 1, 'opposed', NULL);

      INSERT INTO hearing_details (filing_id, time_estimate_minutes, proposed_hearing, hearing_date_position) VALUES (1, 60, '2026-11-02', 'agree');

      -- court_record links the fact to the affidavit proving it (issue
      -- #360/#362) -- silences 👤 no-witness the same way the other kinds'
      -- clean-population seeds do (a witness statement is the other route;
      -- this is the cheaper one for a purely documentary fact).
      INSERT INTO facts (id, proceeding_id, postulate, court_record, court_record_pinpoint)
        VALUES (1, 1, 'Alderglen Ranch Holdings Ltd. has provided a full accounting each quarter since 2024.', 2, 'para 4');
      INSERT INTO filing_facts (filing_id, fact_id, document, part, ordinal) VALUES (1, 1, 'form', 'part4', 1);

      -- No submission_law row at all -- an unlinked submission renders clean
      -- (📖 fires only on a law_assertions row with no statement, not on a
      -- submission with no law_assertions row -- checklist §5 does not
      -- direct populating law for a purely factual submission).
      INSERT INTO submissions (id, proceeding_id, contention, ordinal)
        VALUES (1, 1, 'The requested accounting has already been provided in full.', 1);
      INSERT INTO filing_submissions (filing_id, submission_id, document, ordinal) VALUES (1, 1, 'form', 1);

      INSERT INTO filing_documents (filing_id, document_id, ordinal, role, provenance)
        VALUES (1, 2, 1, 'affidavit', 'served_with_this_response');

      UPDATE db_meta SET value = CAST(value AS INTEGER) + 1 WHERE key = 'revision';
      `.trim()
    );

    const result = submissionFormsRender(f.dbPath, 1, { clientName: "Marchetti", clientNo: "5505", matterNo: "L5505" });
    // Application Response + Written Arguments companion + the Job Board's entry (ADR 0009; #1365: its summary, no file).
    assert.equal(result.documents.length, 3);
    const baseDir = dirname(result.documents[0].path);
    const ar = findFile(baseDir, "Application Response.md");
    // 🧵 is expected pre-elicitation noise (file header) -- assert it fires,
    // then confirm every other glyph, including ⬜ and 🕵️, is genuinely absent.
    assert.ok(ar.includes("🧵"), "loose-thread should fire pre-elicitation -- its absence would be a silent regression, not a clean render");
    // Same shape as the NoA fixture above: the lone submission is pointed only via
    // document='form', so 🧾 fires on the AR's own Part 5 line, not on the Written Arguments
    // companion, which renders no submissions for this filing at all.
    assert.ok(ar.includes("🧾"), "factual-basis-needed should fire on a contention with no submission_facts row -- its absence would be a silent regression, not a clean render");
    assertRendersClean("Application Response", ar);
    // Issue #440: fact 1's court_record_pinpoint ('para 4') must reach the rendered fact
    // line as real citation text, not just silence the 📍 marker.
    assert.ok(ar.includes("(para 4)"), "fact 1's court-record pinpoint should render as a citation, not disappear once captured");
    assert.ok(!ar.includes("Positions not yet taken"), "every opposing order was positioned -- no unpositioned-orders listing expected");
    const wa = findFile(baseDir, "Written Arguments.md");
    assertRendersClean("Written Arguments companion", wa);
    assertRendersClean("Job Board", boardPage(f, { clientName: "Marchetti", clientNo: "5505", matterNo: "L5505" }));
  } finally {
    f.cleanup();
  }
});
