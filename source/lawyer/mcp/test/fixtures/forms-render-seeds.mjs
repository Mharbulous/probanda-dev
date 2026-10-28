// Shared seeds and helpers for the forms-render-*.db.test.mjs golden-fixture tests (build ticket
// #297), split out of the former forms-render.test.mjs. Seeds a real database from the migrated
// template plus drafting_data__execute, then renders and compares byte-for-byte against a
// checked-in fixture.
//
// Regenerate after reviewing a new render by eye (an env var, not a CLI flag: `node --test`
// treats trailing positional args as test-name filters, not argv for the test file to read):
//   COCLERK_REGENERATE_GOLDEN=1 node --test test/forms-render-*.db.test.mjs

import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const { submissionDataExecute, submissionDataQuery } = await import("../../build/submission/backend.js");
const { filingBoardData } = await import("../../build/submission/matter-pages.js");
const { fetchProceeding, fetchRevision } = await import("../../build/submission/forms/query.js");
const { writePartiesOfRecord } = await import("../helpers/matter-data-fixture.mjs");

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = HERE;
const REGENERATE = process.env.COCLERK_REGENERATE_GOLDEN === "1";

/** A matter folder in a scratch dir, laid out as ADR 0013 lays one out: the database in the matter's own
 * `0. CASE DATA`, beside its `0. DRAFT`, which holds every Writing's own folder (spec 2026-10-22). */
export function seededDbFixture() {
  const dir = mkdtempSync(join(tmpdir(), "coclerk-submission-forms-"));
  const matter = join(dir, "L4801 Matter");
  mkdirSync(join(matter, "0. CASE DATA"), { recursive: true });
  mkdirSync(join(matter, "0. DRAFT"));
  const dbPath = join(matter, "0. CASE DATA", "submission.sqlite");
  return { dir, dbPath, draft: join(matter, "0. DRAFT"), cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

// Each seed below links its parties (case_party_id) and writes the case data beside the database,
// holding exactly the counsel and address for service its parties rows hold (party/counsel SSOT).

// No file number: the parties are linked by case_party_id, with no proceeding of record.
export const VANIAC_CASE_DATA = {
  parties: [
    { id: 1, name: "Marcus Ashbourne", counsel_name: "A. Lawyer" },
    { id: 2, name: "Northridge Construction Ltd." },
  ],
};

export async function seedVaniacProceeding(dbPath) {
  writePartiesOfRecord(dirname(dbPath), VANIAC_CASE_DATA);
  await submissionDataExecute(
    dbPath,
    `
    INSERT INTO proceedings (id, matter_reference, forum, court_or_centre, registry, file_number, style_of_cause, courthouse_address)
      VALUES (1, 'L4801 - Ashbourne', 'CAN/BC/Vancouver-International-Arbitration-Centre', 'VanIAC', NULL, NULL, 'Ashbourne v. Northridge', NULL);

    INSERT INTO parties (id, proceeding_id, name, role, ordinal, is_client, is_applicant, to_be_served, case_party_id)
      VALUES
        (1, 1, 'Marcus Ashbourne', 'Claimant', 1, 1, 1, 0, 1),
        (2, 1, 'Northridge Construction Ltd.', 'Respondent', 2, 0, 0, 1, 2);

    -- verification lives on statements_of_law since schema v25: authority 2 is a
    -- lead because its only statement (4, below) is, not the other way round.
    INSERT INTO authorities (id, proceeding_id, style_of_cause_or_title, citation, kind, weight, treatment)
      VALUES
        (1, 1, 'Tekk Enterprises v. Acme Co.', '2024 BCCA 118', 'case', 'binding', 'distinguishable'),
        (2, 1, 'Reserved Authority v. X', '2020 BCSC 1', 'case', NULL, NULL),
        (3, 1, 'Second Authority v. Comparator', '2019 BCCA 5', 'case', 'persuasive', 'negative');

    -- disposition retired (schema v10, #380): submission 3 stays a pool row
    -- with no filing_submissions pointer at all (below) -- deployed by
    -- nothing, so it renders nowhere (derived 🂡); the reserve inventory records it.
    INSERT INTO submissions (id, proceeding_id, contention, ordinal)
      VALUES
        (1, 1, 'The Respondent owes $150,000 under the plain words of the Asset Purchase Agreement.', 1),
        (2, 1, 'No authority has yet been located for the second submission.', 2),
        (3, 1, 'A reserved fallback argument, held for reply.', 3);

    -- law_assertions dissolved off argument_authorities (schema v3, #328/
    -- #323): submission 1 requires two distinct law assertions, each backed
    -- by one statement of law (authority + excerpt); submission 2 requires
    -- two distinct law assertions with NO statement yet -- both fire the
    -- identical doctrinal-basis-needed glyph 📖; issue 322: the line must
    -- render 📖 once, not once per assertion.
    INSERT INTO law_assertions (id, proceeding_id, proposition, dead_end)
      VALUES
        (1, 1, 'contractual interpretation principles', 0),
        (2, 1, 'second point of law', 0),
        (3, 1, 'point of law not yet researched', 0),
        (4, 1, 'a second point of law also not yet researched', 0);
    -- source (schema v9, issue #365): assertion 1's statement rated primary
    -- (proves 🥇 renders nothing on a real proposition line); assertion 2's
    -- rated secondary (proves 🥈 renders). Assertions 3/4 have no statements
    -- at all, so 📖 still renders bare -- no seed change needed for those.
    INSERT INTO statements_of_law (id, proceeding_id, law_assertion_id, authority_id, pinpoint, excerpt, source, verification)
      VALUES
        (1, 1, 1, 1, 'para 31', 'The obligation is not confined to documents the party intends to rely on.', 'primary', 'verified'),
        (2, 1, 2, 3, 'para 12', 'The comparator case is questioned on this point.', 'secondary', 'verified');
    INSERT INTO submission_law (submission_id, law_assertion_id)
      VALUES (1, 1), (1, 2), (2, 3), (2, 4);

    -- Issue #348, re-shaped by #380 onto order_sought_requires: order 1's
    -- jurisdictional basis, a standalone statements_of_law row (law_assertion_id
    -- NULL -- not a doctrinal proposition) citing authority 1 (Tekk
    -- Enterprises, distinguishable) -- exercises the ladder's ⚠️ end-to-end
    -- in the Written Arguments' Relief block. Inserted before order_sought so
    -- the FK it's about to be referenced by resolves immediately (FK
    -- enforcement is ON).
    INSERT INTO statements_of_law (id, proceeding_id, law_assertion_id, authority_id, pinpoint, excerpt, verification)
      VALUES (3, 1, NULL, 1, 'para 8', 'the Tribunal has the power to grant this relief under s. 24 of the Arbitration Act', 'verified');

    -- The brief-only cap, exercised end to end:
    -- assertion 3 -- required by DEPLOYED submission 2 -- is supported only by statement 4, whose
    -- verification is 'lead'. Every delivered document must still show the proposition with no
    -- excerpt, and the reserve inventory records the lead statement's own line. Since #502 the proposition itself reads 🔬 (a lead is in hand to scrutinize), not 📖,
    -- and source='secondary' now DOES fire 🥈: with no verified statement the source rung falls
    -- back to the leads, so the line reads 🔬 🥈.
    INSERT INTO statements_of_law (id, proceeding_id, law_assertion_id, authority_id, pinpoint, excerpt, source, verification)
      VALUES (4, 1, 3, 2, 'para 7', 'An unverified lead, held back from every delivered document.', 'secondary', 'lead');

    -- Design §4 (#796): a killed authority (schema v16) whose statement still supports
    -- assertion 3. It rides the brief-only cap, and a killed item's own lines render no marker of
    -- any type, work or event -- so its line shows nothing at all, not 🔬 (lead), not 🏅 (unrated),
    -- and not 📍 (no pinpoint) or 📇 (never noted up) either. The plain-text "(killed <date>)" tag
    -- on its citation line is what keeps the silenced line from reading as sound support.
    -- Assertion 3's own line is unchanged (killed statements are not counted).
    INSERT INTO authorities (id, proceeding_id, style_of_cause_or_title, citation, kind, killed_on)
      VALUES (4, 1, 'Killed Authority v. Y', '2018 BCSC 9', 'case', '2026-09-01');
    INSERT INTO statements_of_law (id, proceeding_id, law_assertion_id, authority_id, excerpt, verification)
      VALUES (5, 1, 3, 4, 'A passage from an authority the practitioner reviewed and rejected.', 'lead');

    -- The jurisdictional half of the same rule: statement 6 is a standalone jurisdictional row
    -- (law_assertion_id NULL) on that SAME killed authority, and order 3's only
    -- order_sought_requires edge points at it as 'filled'. A killed edge contributes exactly 🏛️
    -- and nothing else, so order 3's line reads 🏛️ (the basis is still owed -- a rejected
    -- authority cannot supply the power to make the order) and carries no 🏅, even though the row
    -- is unrated. Everything captured (excerpt + pinpoint) and verification 'verified', so the
    -- only glyph the edge could otherwise have printed is 📇 -- the authority is never noted up --
    -- and the silencing rule withholds it. That settles what #777 left open: §4's "a killed item
    -- renders no 🂡 and no marker" governs the item's own lines, and its six-marker list governs
    -- aggregation only (#796).
    INSERT INTO statements_of_law (id, proceeding_id, law_assertion_id, authority_id, pinpoint, excerpt, verification)
      VALUES (6, 1, NULL, 4, 'para 15', 'A power-conferring passage from the rejected authority.', 'verified');

    -- order 2 ('a reserved fallback order') stays a pool row with no
    -- filing_orders pointer at all (below) -- deployed by nothing, derived 🂡,
    -- printed nowhere (schema v10, #380 -- disposition retired). Order 3 is a pool row on the
    -- same footing, carrying the killed-authority basis edge above.
    INSERT INTO order_sought (id, proceeding_id, wording, amount)
      VALUES
        (1, 1, 'payment of $150,000', 150000),
        (2, 1, 'a reserved fallback order', 5000),
        (3, 1, 'an order whose only basis cites a killed authority', NULL);
    INSERT INTO order_sought_requires (order_sought_id, excerpt_id, basis_state) VALUES (1, 3, 'filled'), (3, 6, 'filled');
    INSERT INTO order_sought_served_by (order_sought_id, submission_id) VALUES (1, 1);

    INSERT INTO filings (id, proceeding_id, kind, subkind, round, title)
      VALUES (1, 1, 'submissions_package', NULL, 'opening', 'Opening Submissions Package');

    -- VanIAC's own venue document is document='form' (#380's resolution --
    -- "for a VanIAC submissions package that face is the submissions
    -- document itself"); submission 3 and order 2 (both undeployed here) stay
    -- reserved -- printed nowhere.
    INSERT INTO filing_submissions (filing_id, submission_id, document, ordinal) VALUES (1, 1, 'form', 1), (1, 2, 'form', 2);
    INSERT INTO filing_orders (filing_id, order_sought_id, document, ordinal) VALUES (1, 1, 'form', 1);

    INSERT INTO witnesses (id, proceeding_id, name, relationship) VALUES (1, 1, 'A. Renwick', 'project manager');

    -- Issue #364: document 1 is marked the best copy of its label group --
    -- Ex. 1 renders clean, exercising the "group has a winner" branch, while
    -- Ex. 2 (below) and every other unmarked document still fire 🏆.
    INSERT INTO documents (id, proceeding_id, label, document_date, description, file_path, is_best_copy)
      VALUES
        (1, 1, 'Asset Purchase Agreement', '2023-12-01', 'The signed agreement, s. 2.3 at issue', '3. DISCLOSURE\\Asset Purchase Agreement (executed).pdf, PDF pp. 1-12', 1);
    INSERT INTO documents (id, proceeding_id, label, document_date, description, file_path)
      VALUES (2, 1, 'Undescribed exhibit', NULL, NULL, NULL);
    INSERT INTO filing_documents (filing_id, document_id, ordinal, role)
      VALUES (1, 1, 1, 'evidence'), (1, 2, 2, 'evidence');

    -- witness_statements folds into documents (schema v3, #328/#327): the
    -- witness statement itself is a documents row, reached through
    -- filing_documents(role='witness_statement').
    INSERT INTO documents (id, proceeding_id, label, instrument, deponent, execution, signed_at)
      VALUES (3, 1, 'Witness Statement of A. Renwick', 'witness_statement', 1, NULL, NULL);
    INSERT INTO filing_documents (filing_id, document_id, ordinal, role) VALUES (1, 3, 1, 'witness_statement');
    INSERT INTO statement_paragraphs (id, document_id, ordinal, text)
      VALUES
        (1, 3, 1, 'I was the project manager on the contract at issue.'),
        (2, 3, 2, 'I have no personal knowledge linked to any fact record.');

    -- #401: fact 1 is deployed (submission 2 rests_on it below, pointed via document='form') and
    -- also marked adverse -- exercises the SSOT's central orthogonality claim end-to-end: a fact
    -- can be deployed, even disclosed, and still carry 🚩 (work-markers.md §4 "Adverse orthogonal").
    INSERT INTO facts (id, proceeding_id, postulate, adverse)
      VALUES (1, 1, 'The parties entered the Asset Purchase Agreement on December 1, 2023.', 1);
    -- a paragraph links to the witness's statement of fact, not the fact
    -- directly (schema v3, #328): paragraph 2 stays deliberately unlinked
    -- to exercise the gap marker. Statement 1 cites through the instrument
    -- (pinpoint 'para 1', the paragraph linked below) to the exhibit
    -- (exhibit_pinpoint 's. 2.3' into the same document the Evidence Index
    -- numbers Ex. 1) -- the SSOT's own example shape, and the Ex.-N citation
    -- path end to end.
    INSERT INTO statements_of_fact (id, proceeding_id, fact_id, witness_id, instrument, exhibit_id, pinpoint, exhibit_excerpt, exhibit_pinpoint, interviewed)
      VALUES (1, 1, 1, 1, 3, 1, 'para 1', 'the Purchaser shall pay the Balance in full on the Closing Date', 's. 2.3', 1);
    INSERT INTO paragraph_statements_of_fact (statement_paragraph_id, statement_of_fact_id) VALUES (1, 1);

    -- A second statement of fact on fact 1, purpose='impeachment' (schema
    -- v10, #380 -- was disposition='reserved'; statements_of_law has no
    -- purpose column, so this path is fact-only): the brief-only cap
    -- excludes it from the inline body regardless of deployment -- Counsel
    -- Brief only (#370 item 4).
    INSERT INTO statements_of_fact (id, proceeding_id, fact_id, witness_id, pinpoint, excerpt, interviewed, purpose)
      VALUES (2, 1, 1, 1, 'p. 4', 'a reserved account not yet deployed', 1, 'impeachment');

    -- Submission 2 rests_on fact 1 (issue #321 target: "Submission 2's
    -- postulate on a fact line"); submission 1 stays law-only, exercising a
    -- submission with no fenced fact block at all.
    INSERT INTO submission_facts (submission_id, fact_id) VALUES (2, 1);

    -- Build #329/#320: three more witness statements, none referenced by any
    -- submission or filing_facts row, exercising the fact-side ladder
    -- independent of the Written Argument/Evidence Index goldens.

    -- J. Renwick: no statements_of_fact row at all and no paragraphs -- the
    -- live L4801 Adrian/Jonah Renwick shape this ticket fixes. Expect the
    -- statement-level 🧩 gap line, no 🖋️, no trailing subsection.
    INSERT INTO witnesses (id, proceeding_id, name, relationship) VALUES (2, 1, 'J. Renwick', 'site foreman');
    INSERT INTO documents (id, proceeding_id, label, instrument, deponent, execution, signed_at)
      VALUES (4, 1, 'Witness Statement of J. Renwick', 'witness_statement', 2, NULL, NULL);
    INSERT INTO filing_documents (filing_id, document_id, ordinal, role) VALUES (1, 4, 2, 'witness_statement');

    -- M. Reyes: two included statements_of_fact, neither linked to any
    -- paragraph (zero paragraphs at all), so 🖋️ must stay off even though
    -- facts exist -- proven independent of the 🧩 case above. Statement 3
    -- (interviewed=0, no instrument, no pinpoint) exercises 🗣️ -- and no
    -- pin glyph, since the #511 split gives an instrument-less statement
    -- nothing to locate -- plus doubt
    -- (schema v10, #380 -- was facts.posture) to exercise 👃 on the
    -- statement line; statement 4 (interviewed=1, pinpoint captured)
    -- exercises ✍️ alone.
    INSERT INTO witnesses (id, proceeding_id, name, relationship) VALUES (3, 1, 'M. Reyes', 'site supervisor');
    INSERT INTO documents (id, proceeding_id, label, instrument, deponent, execution, signed_at)
      VALUES (5, 1, 'Witness Statement of M. Reyes', 'witness_statement', 3, NULL, NULL);
    INSERT INTO filing_documents (filing_id, document_id, ordinal, role) VALUES (1, 5, 3, 'witness_statement');
    INSERT INTO facts (id, proceeding_id, postulate)
      VALUES
        (2, 1, 'The crew worked overtime during the final week of the project.'),
        (3, 1, 'Overtime hours were logged in the site diary.');
    INSERT INTO statements_of_fact (id, proceeding_id, fact_id, witness_id, interviewed, pinpoint, doubt)
      VALUES
        (3, 1, 2, 3, 0, NULL, 'disputed by the Respondent'),
        (4, 1, 3, 3, 1, 'p. 9', NULL);

    -- K. Bell: one included statement_of_fact, drafted and linked to the
    -- statement's only paragraph, document signed -- the clean case: no 🧩,
    -- no 🖋️, no trailing subsection.
    INSERT INTO witnesses (id, proceeding_id, name, relationship) VALUES (4, 1, 'K. Bell', 'quantity surveyor');
    INSERT INTO documents (id, proceeding_id, label, instrument, deponent, execution, signed_at)
      VALUES (6, 1, 'Witness Statement of K. Bell', 'witness_statement', 4, '2026-08-15', 'Vancouver, BC');
    INSERT INTO filing_documents (filing_id, document_id, ordinal, role) VALUES (1, 6, 4, 'witness_statement');
    INSERT INTO statement_paragraphs (id, document_id, ordinal, text)
      VALUES (3, 6, 1, 'I counter-signed the change order for the final week of work.');
    INSERT INTO facts (id, proceeding_id, postulate)
      VALUES (4, 1, 'K. Bell counter-signed the change order for the final week of work.');
    INSERT INTO statements_of_fact (id, proceeding_id, fact_id, witness_id, instrument, interviewed, pinpoint)
      VALUES (5, 1, 4, 4, 6, 1, 'p. 1');
    INSERT INTO paragraph_statements_of_fact (statement_paragraph_id, statement_of_fact_id) VALUES (3, 5);

    -- Build #339: an exhibit tendered only by an admission, no
    -- statements_of_fact row at all -- proves the admission alone clears
    -- 👤 and drives the Tendered by cell. Document 8 is the Notice to
    -- Admit (the admission instrument), document 9 its response; neither
    -- is joined into filing_documents -- only the admitted exhibit (7)
    -- is a filing-selected document.
    INSERT INTO documents (id, proceeding_id, label, document_date, description)
      VALUES (7, 1, 'Site Diary — Week 12', '2023-11-20', 'Daily entries for the final week of the project');
    INSERT INTO filing_documents (filing_id, document_id, ordinal, role) VALUES (1, 7, 3, 'evidence');
    -- Issue #344: document 8's served_on drives the admission-ladder
    -- derivation (nothing else in the hop). Document 9 (their response)
    -- carries no served_on -- it's never an admissions.instrument.
    INSERT INTO documents (id, proceeding_id, label, document_date, description, served_on)
      VALUES
        (8, 1, 'Notice to Admit dated 2026-06-01', '2026-06-01', NULL, '2026-06-01'),
        (9, 1, 'Response to Notice to Admit dated 2026-06-15', '2026-06-15', NULL, NULL);
    INSERT INTO facts (id, proceeding_id, postulate)
      VALUES (5, 1, 'The Site Diary — Week 12 is a genuine business record of Northridge Construction Ltd.');
    -- Admitted, response not filing-selected -- ladder state "tender" (base
    -- admitted), no response_excerpt -- renders "🤝 🕹️ 📑" (issue #344; the
    -- notice-to-admit route owes the exhibit pair, #502).
    INSERT INTO admissions (id, proceeding_id, fact_id, party, method, exhibit, instrument, instrument_pinpoint, response, response_pinpoint, answer)
      VALUES (1, 1, 5, 2, 'notice_to_admit', 7, 8, 'item 1', 9, 'item 1', 'agreed');

    -- Issue #344: four more admissions on the same party/exhibit, spanning
    -- the ladder's other rungs -- each on its own fact (UNIQUE(fact_id,
    -- party, method)).
    INSERT INTO facts (id, proceeding_id, postulate)
      VALUES
        (6, 1, 'The Site Diary — Week 12 entries were made contemporaneously.'),
        (7, 1, 'The Site Diary — Week 12 was kept in the ordinary course of business.'),
        (8, 1, 'The Site Diary — Week 12 entries are accurate.'),
        (9, 1, 'The Site Diary — Week 12 was retained without alteration.');

    -- 🎾 drafted, unserved (no served_on, no response) -- renders "🎾" alone.
    INSERT INTO documents (id, proceeding_id, label, document_date, description)
      VALUES (10, 1, 'Notice to Admit dated 2026-08-01', '2026-08-01', NULL);
    INSERT INTO admissions (id, proceeding_id, fact_id, party, method, exhibit, instrument, instrument_pinpoint)
      VALUES (2, 1, 6, 2, 'notice_to_admit', 7, 10, 'item 1');

    -- ⏳ served, response period running -- far-future response_due keeps
    -- this fixture stable regardless of when the test runs -- renders "⏳" alone.
    INSERT INTO documents (id, proceeding_id, label, document_date, description, served_on)
      VALUES (11, 1, 'Notice to Admit dated 2026-07-01', '2026-07-01', NULL, '2026-07-01');
    INSERT INTO admissions (id, proceeding_id, fact_id, party, method, exhibit, instrument, instrument_pinpoint, response_due)
      VALUES (3, 1, 7, 2, 'notice_to_admit', 7, 11, 'item 2', '2126-01-01');

    -- 🙅🏻‍♂️ denied, in time -- renders "🙅🏻‍♂️" alone (excerpt/pinpoints all captured).
    INSERT INTO documents (id, proceeding_id, label, document_date, description, served_on)
      VALUES (12, 1, 'Notice to Admit dated 2026-07-01', '2026-07-01', NULL, '2026-07-01');
    INSERT INTO documents (id, proceeding_id, label, document_date, description)
      VALUES (13, 1, 'Response to Notice to Admit dated 2026-07-10', '2026-07-10', NULL);
    INSERT INTO admissions (id, proceeding_id, fact_id, party, method, exhibit, instrument, instrument_pinpoint, response_due, response, response_pinpoint, response_excerpt, answer)
      VALUES (4, 1, 8, 2, 'notice_to_admit', 7, 12, 'item 3', '2026-07-20', 13, 'item 3', 'refused to admit the entries were accurate', 'denied');

    -- ⏰ deemed -- served, response_due long expired, no response;
    -- instrument_pinpoint left NULL to prove the pin renders alongside 🕹️ --
    -- renders "⏰ 🕹️ 📌" (instrument unfiled, so 🕹️'s tender is outstanding;
    -- the notice-to-admit route owes the exhibit pair, #511).
    INSERT INTO documents (id, proceeding_id, label, document_date, description, served_on)
      VALUES (14, 1, 'Notice to Admit dated 2020-01-01', '2020-01-01', NULL, '2020-01-01');
    INSERT INTO admissions (id, proceeding_id, fact_id, party, method, exhibit, instrument, response_due)
      VALUES (5, 1, 9, 2, 'notice_to_admit', 7, 14, '2020-02-01');

    -- Issue #345: a fourth exhibit tendered only by a spent (denied)
    -- admission -- proves the event glyph is not silently dropped but
    -- re-homed as a prefix on 👤 (terms-and-symbols.md "🙅🏻‍♂️→👤"), and that a
    -- denied admission no longer counts toward Tendered by / clearing 👤.
    INSERT INTO documents (id, proceeding_id, label, document_date, description)
      VALUES (15, 1, 'Delivery Note — Week 12', '2023-11-25', 'Delivery log for the final week of the project');
    INSERT INTO filing_documents (filing_id, document_id, ordinal, role) VALUES (1, 15, 4, 'evidence');
    INSERT INTO facts (id, proceeding_id, postulate)
      VALUES (10, 1, 'The Delivery Note — Week 12 is a genuine business record of Northridge Construction Ltd.');
    INSERT INTO documents (id, proceeding_id, label, document_date, description, served_on)
      VALUES (16, 1, 'Notice to Admit dated 2026-07-01', '2026-07-01', NULL, '2026-07-01');
    INSERT INTO documents (id, proceeding_id, label, document_date, description)
      VALUES (17, 1, 'Response to Notice to Admit dated 2026-07-10', '2026-07-10', NULL);
    INSERT INTO admissions (id, proceeding_id, fact_id, party, method, exhibit, instrument, instrument_pinpoint, response_due, response, response_pinpoint, response_excerpt, answer)
      VALUES (6, 1, 10, 2, 'notice_to_admit', 15, 16, 'item 1', '2026-07-20', 17, 'item 1', 'refused to admit the note was genuine', 'denied');

    -- Issue #345: the unless-admitted guard's per-party half, exercised
    -- end-to-end through the render (the multi-party arithmetic itself is
    -- covered by admittedAgainstAllOpposing's unit tests -- this fixture's
    -- job is to prove the wiring reaches the guard). Both facts rest_on
    -- submission 2 alongside fact 1. Neither admission names an exhibit --
    -- these are fact admissions, not exhibit tenders, keeping the Evidence
    -- Index golden untouched by this pair.
    --
    -- Fact 11: no court-record link, with an otherwise-markable statement
    -- (interviewed=0, no pinpoint, no excerpt, no instrument -- would fire
    -- 🗣️ 💬 absent the guard), admitted by the sole opposing party
    -- (Northridge) -- covered, so every evidence-side marker silences.
    INSERT INTO facts (id, proceeding_id, postulate)
      VALUES (11, 1, 'The delivery schedule required completion by the final week.');
    INSERT INTO statements_of_fact (id, proceeding_id, fact_id, witness_id, interviewed)
      VALUES (6, 1, 11, 1, 0);
    INSERT INTO documents (id, proceeding_id, label, document_date, description, served_on)
      VALUES (18, 1, 'Notice to Admit dated 2026-06-05', '2026-06-05', NULL, '2026-06-05');
    INSERT INTO documents (id, proceeding_id, label, document_date, description)
      VALUES (19, 1, 'Response to Notice to Admit dated 2026-06-20', '2026-06-20', NULL);
    INSERT INTO admissions (id, proceeding_id, fact_id, party, method, instrument, instrument_pinpoint, response, response_pinpoint, response_excerpt, answer)
      VALUES (7, 1, 11, 2, 'notice_to_admit', 18, 'item 1', 19, 'item 1', 'agreed the schedule required completion by the final week', 'agreed');

    -- Fact 12: no statements_of_fact row at all, admission on this fact
    -- DENIED by the sole opposing party -- not covered, so 👤 still fires.
    -- Proves per-party coverage governs the guard, not any flat write on
    -- the fact itself.
    INSERT INTO facts (id, proceeding_id, postulate)
      VALUES (12, 1, 'The final walkthrough occurred before handover.');
    INSERT INTO documents (id, proceeding_id, label, document_date, description, served_on)
      VALUES (20, 1, 'Notice to Admit dated 2026-06-05', '2026-06-05', NULL, '2026-06-05');
    INSERT INTO documents (id, proceeding_id, label, document_date, description)
      VALUES (21, 1, 'Response to Notice to Admit dated 2026-06-20', '2026-06-20', NULL);
    INSERT INTO admissions (id, proceeding_id, fact_id, party, method, instrument, instrument_pinpoint, response, response_pinpoint, response_excerpt, answer)
      VALUES (8, 1, 12, 2, 'notice_to_admit', 20, 'item 1', 21, 'item 1', 'refused to admit the walkthrough occurred as described', 'denied');

    INSERT INTO submission_facts (submission_id, fact_id) VALUES (2, 11), (2, 12);

    -- Phase C (#777): an exhibit-backed statement with no instrument and no exhibit_pinpoint. Before
    -- Phase B this shape rendered 📍; after the #511 split it rendered no locator at all, because no
    -- renderer query selected exhibit_pinpoint. It owes 📌 (work-markers.md row 📌; §5 "📌 still fires
    -- if an exhibit is set"), and ✍️ (interviewed, no instrument). exhibit_excerpt is captured so the
    -- line isolates the pin; the fence quotes the exhibit, not testimony. Document 7 is Ex. 3.
    INSERT INTO facts (id, proceeding_id, postulate)
      VALUES (13, 1, 'Overtime for the final week was recorded in the Site Diary.');
    INSERT INTO statements_of_fact (id, proceeding_id, fact_id, witness_id, exhibit_id, exhibit_excerpt, interviewed)
      VALUES (7, 1, 13, 3, 7, 'Week 12: crew on site until 21:00 each day', 1);
    INSERT INTO submission_facts (submission_id, fact_id) VALUES (2, 13);

    -- Build #359: opposing_points -- one answered (clears ↩️, names the
    -- answering submission), one not (renders ↩️). Proceeding-scoped, no
    -- filing_id column on the table.
    INSERT INTO opposing_points (id, proceeding_id, component, pinpoint, verbatim_words, answered_by_submission_id, ordinal)
      VALUES
        (1, 1, 'Opposing written argument', 'Submission 3', 'the Agreement was never validly executed', 1, 1),
        (2, 1, 'Witness statement of R. Opposing', 'para 6', 'the delivery schedule was informal only', NULL, 2);

    -- #401: anticipated_points -- the practitioner's own prediction of a point the other side may
    -- run, not yet raised. Distinct from opposing_points above (real, served points that drive ↩️).
    INSERT INTO anticipated_points (id, proceeding_id, point)
      VALUES (1, 1, 'The Respondent may argue the change order was never authorized in writing.');

    -- Revision reset LAST: schema v21 triggers move db_meta.revision on every seeded row (#607).
    UPDATE db_meta SET value = '1' WHERE key = 'revision';
    `.trim()
  );
}

export const DEFAULT_JUDGMENT_CASE_DATA = {
  proceedings: [{ id: 1, file_number: "S-901433" }],
  parties: [
    { id: 1, name: "Wren Halloway", counsel_name: "B. Counsel", of_record: [[1, "plaintiff"]] },
    { id: 2, name: "Corbin Vasey", of_record: [[1, "defendant"]] },
  ],
};

/** `link` false leaves the parties unlinked, for a database migrated only to a version before
 * case_party_id (v41). */
export async function seedBcscDefaultJudgment(dbPath, { link = true } = {}) {
  writePartiesOfRecord(dirname(dbPath), DEFAULT_JUDGMENT_CASE_DATA);
  await submissionDataExecute(
    dbPath,
    `
    INSERT INTO proceedings (id, matter_reference, forum, court_or_centre, registry, file_number, style_of_cause, courthouse_address)
      VALUES (1, 'L9002 - Halloway', 'CAN/BC/BCSC', 'BC Supreme Court', 'Vancouver', 'S-901433', 'Halloway v. Vasey', '800 Smithe Street');

    INSERT INTO parties (id, proceeding_id, name, role, ordinal, is_client, is_applicant, to_be_served)
      VALUES
        (1, 1, 'Wren Halloway', 'Plaintiff', 1, 1, 1, 0),
        (2, 1, 'Corbin Vasey', 'Defendant', 2, 0, 0, 1);
    ${link ? "UPDATE parties SET case_party_id = id;" : ""}

    INSERT INTO order_sought (id, proceeding_id, wording, template_key, template_values)
      VALUES
        (1, 1, 'damages to be assessed', 'damages_to_be_assessed', NULL),
        (2, 1, 'costs to be assessed', 'costs_to_be_assessed', NULL),
        (3, 1, 'costs in a fixed amount', 'costs_fixed', '{"amount": 2500}');

    UPDATE order_sought SET alternative_to = 2 WHERE id = 3;

    INSERT INTO documents (id, proceeding_id, label, document_date, description, file_path)
      VALUES (1, 1, 'Draft default judgment', NULL, NULL, NULL);

    INSERT INTO filings (id, proceeding_id, kind, subkind, round, title)
      VALUES (1, 1, 'requisition_default_judgment', 'default_judgment', NULL, 'Default Judgment Requisition');

    INSERT INTO filing_orders (filing_id, order_sought_id, document, ordinal) VALUES (1, 1, 'form', 1), (1, 2, 'form', 2);
    INSERT INTO filing_documents (filing_id, document_id, ordinal, role) VALUES (1, 1, 1, 'order');

    -- Revision reset LAST: schema v21 triggers move db_meta.revision on every seeded row (#607).
    UPDATE db_meta SET value = '1' WHERE key = 'revision';
    `.trim()
  );
}

// Moved here from forms-render-bcsc.db.test.mjs (#805) so the filed-face coverage meta-test can
// seed a requisition/consent filing from the same source as the golden-fixture tests.
export const CONSENT_ORDER_CASE_DATA = {
  proceedings: [{ id: 1, file_number: "S-290002" }],
  parties: [
    { id: 1, name: "Larchmont (B.C.) Inc.", counsel_name: "C. Lawyer", of_record: [[1, "plaintiff"]] },
    { id: 2, name: "Example Defendant Ltd.", counsel_name: "D. Lawyer", of_record: [[1, "defendant"]] },
  ],
};

export async function seedBcscConsentOrder(dbPath) {
  writePartiesOfRecord(dirname(dbPath), CONSENT_ORDER_CASE_DATA);
  await submissionDataExecute(
    dbPath,
    `
    INSERT INTO proceedings (id, matter_reference, forum, court_or_centre, registry, file_number, style_of_cause, courthouse_address)
      VALUES (1, 'L8470 - Larchmont', 'CAN/BC/BCSC', 'BC Supreme Court', 'Vancouver', 'S-290002', 'Larchmont v. Example', NULL);

    INSERT INTO parties (id, proceeding_id, name, role, ordinal, is_client, is_applicant, to_be_served, case_party_id)
      VALUES
        (1, 1, 'Larchmont (B.C.) Inc.', 'Plaintiff', 1, 1, 1, 0, 1),
        (2, 1, 'Example Defendant Ltd.', 'Defendant', 2, 0, 0, 1, 2);

    INSERT INTO order_sought (id, proceeding_id, wording)
      VALUES (1, 1, 'the style of cause is corrected as set out above');

    INSERT INTO filings (id, proceeding_id, kind, subkind, round, title)
      VALUES (1, 1, 'requisition_consent', 'consent', NULL, 'Consent Order Requisition');

    INSERT INTO filing_orders (filing_id, order_sought_id, document, ordinal) VALUES (1, 1, 'form', 1);

    -- Revision reset LAST: schema v21 triggers move db_meta.revision on every seeded row (#607).
    UPDATE db_meta SET value = '1' WHERE key = 'revision';
    `.trim()
  );
}

// Moved here from application-response.db.test.mjs (#805) so the filed-face coverage meta-test
// can seed an application_response filing from the same source as the renderer tests.
// A fully-positioned application_response filing: 3 opposing_orders
// (consented-with-terms, opposed, no_position), 2 Part 4 facts, 1 Part 5
// submission, 1 Part 6 document, AFS states covering 'yes' and the
// 'unknown' default. Fully positioned so both the mockup (clean, no ⬜) and
// the emitter (which refuses on any gap) share one seed.
export const APPLICATION_RESPONSE_CASE_DATA = {
  proceedings: [{ id: 1, file_number: "S-601122" }],
  parties: [
    { id: 1, name: "Adaeze Okonkwo", counsel_name: "C. Counsel", of_record: [[1, "plaintiff"]] },
    { id: 2, name: "Reece Ferris", counsel_name: "D. Advocate", of_record: [[1, "defendant"]] },
  ],
};

export async function seedApplicationResponse(dbPath) {
  writePartiesOfRecord(dirname(dbPath), APPLICATION_RESPONSE_CASE_DATA);
  // The hearing-date position arrived in schema v79; a test holding an older database seeds without it.
  const schemaVersion = Number(submissionDataQuery(dbPath, "SELECT value FROM db_meta WHERE key = 'schema_version'").rows[0].value);
  const hearingDetails =
    schemaVersion >= 79
      ? "INSERT INTO hearing_details (filing_id, time_estimate_minutes, proposed_hearing, hearing_date_position) VALUES (1, 90, '2026-09-15', 'agree');"
      : "INSERT INTO hearing_details (filing_id, time_estimate_minutes) VALUES (1, 90);";
  await submissionDataExecute(
    dbPath,
    `
    INSERT INTO proceedings (id, matter_reference, forum, court_or_centre, registry, file_number, style_of_cause, courthouse_address)
      VALUES (1, 'T601 - Okonkwo', 'CAN/BC/BCSC', 'BC Supreme Court', 'Vancouver', 'S-601122', 'Okonkwo v. Ferris', '800 Smithe Street');

    INSERT INTO parties (id, proceeding_id, name, role, ordinal, is_client, is_applicant, to_be_served, address_for_service_filed, case_party_id)
      VALUES
        (1, 1, 'Adaeze Okonkwo', 'Plaintiff', 1, 0, 1, 0, 'unknown', 1),
        (2, 1, 'Reece Ferris', 'Defendant', 2, 1, 0, 1, 'yes', 2);

    INSERT INTO documents (id, proceeding_id, label, document_date, description, file_path)
      VALUES
        (1, 1, 'Notice of Application', '2026-08-01', NULL, NULL),
        (2, 1, 'Affidavit of Reece Ferris', '2026-08-10', 'Responding affidavit', NULL);

    INSERT INTO opposing_orders (id, proceeding_id, document_id, paragraph_number, wording)
      VALUES
        (1, 1, 1, 1, 'an order that the defendant produce all correspondence'),
        (2, 1, 1, 2, 'an order for security for costs'),
        (3, 1, 1, 3, 'costs of the application');

    INSERT INTO filings (id, proceeding_id, kind, subkind, round, title)
      VALUES (1, 1, 'application_response', NULL, NULL, 'Application Response');

    INSERT INTO filing_positions (filing_id, opposing_order_id, position, proposed_terms)
      VALUES
        (1, 1, 'consented', 'within 14 days'),
        (1, 2, 'opposed', NULL),
        (1, 3, 'no_position', NULL);

    ${hearingDetails}

    INSERT INTO facts (id, proceeding_id, postulate)
      VALUES
        (1, 1, 'The correspondence sought was already produced on 2026-07-15.'),
        (2, 1, 'The defendant has sufficient assets within the jurisdiction.'),
        -- Ticket 2026-08-31: rested-on by submission 1 below, so Part 5 actually exercises the
        -- new per-assertion paragraph shape (and this test's own "continuous Part 4-5 numbering"
        -- claim), instead of the submission rendering the no-facts/no-law marker-only line.
        (3, 1, 'The defendant has never previously failed to satisfy a costs award.');
    INSERT INTO filing_facts (filing_id, fact_id, document, part, ordinal) VALUES (1, 1, 'form', 'part4', 1), (1, 2, 'form', 'part4', 2);

    INSERT INTO submissions (id, proceeding_id, contention, ordinal)
      VALUES (1, 1, 'Security for costs is unwarranted given the defendant''s assets in this jurisdiction.', 1);
    INSERT INTO filing_submissions (filing_id, submission_id, document, ordinal) VALUES (1, 1, 'form', 1);
    INSERT INTO submission_facts (submission_id, fact_id) VALUES (1, 3);

    INSERT INTO filing_documents (filing_id, document_id, ordinal, role, provenance)
      VALUES (1, 2, 1, 'affidavit', 'served_with_this_response');

    -- Revision reset LAST: schema v21 triggers move db_meta.revision on every seeded row (#607).
    UPDATE db_meta SET value = '1' WHERE key = 'revision';
    `.trim()
  );
}

// Markdown is the default; a fixture that is not markdown (the HTML Work
// Board) names its own extension.
export function goldenPath(name) {
  return join(FIXTURES_DIR, name.includes(".") ? name : `${name}.md`);
}

export function assertMatchesGolden(name, actual) {
  const path = goldenPath(name);
  if (REGENERATE) {
    mkdirSync(FIXTURES_DIR, { recursive: true });
    writeFileSync(path, actual, "utf-8");
    return;
  }
  if (!existsSync(path)) {
    assert.fail(`Golden fixture missing: ${path}. Review a render by eye, then regenerate with: COCLERK_REGENERATE_GOLDEN=1 node --test test/forms-render-*.db.test.mjs`);
  }
  assert.equal(actual, readFileSync(path, "utf-8"));
}

export function findFile(dir, fileName) {
  const found = readdirSync(dir).find((f) => f === fileName);
  if (!found) throw new Error(`${fileName} not found in ${dir} (has: ${readdirSync(dir).join(", ")})`);
  return readFileSync(join(dir, found), "utf-8");
}

// ADR 0009 (ticket-driven /draft sessions): seeds one ticket per
// Milestone category, plus a mutual-block pair (circular) and one uncharted
// / one already-charted seed. Deliberately no revision bump in this script --
// that omission is itself the exemption under test (filing-checklists.md §8:
// ticket, step, scope, block, conflict, seed and lock writes are exempt).
// Ties into seedVaniacProceeding's proceeding 1 / filing 1.
export async function seedTickets(dbPath) {
  await submissionDataExecute(
    dbPath,
    `
    -- Ticket 1: completed -- the audit that started this feature (L4801).
    INSERT INTO tickets (id, proceeding_id, filing_id, title, intent, status, priority, kind, billing_anchor, created, completed_at)
      VALUES (1, 1, 1, 'Audit the three Westlaw memos', 'Verify the propositions with pinpoints.', 'completed', 5, 'work', 'L4801|attornment defeats the stay', '2026-09-02T08:00', '2026-09-02T09:00');

    -- Ticket 2: queued, blocked only by completed ticket 1 -- Ready. Carries
    -- scope rows (a whole-table grant plus a row-scoped one).
    INSERT INTO tickets (id, proceeding_id, filing_id, title, intent, status, priority, kind, billing_anchor, created)
      VALUES (2, 1, 1, 'Draft the reply on attornment', 'Write the reply submission once the memos are audited.', 'queued', 4, 'work', 'L4801|attornment defeats the stay', '2026-09-02T08:05');
    INSERT INTO ticket_blocks (blocker_id, blocked_id) VALUES (1, 2);
    INSERT INTO ticket_scope (ticket_id, entity, entity_id) VALUES (2, 'facts', NULL), (2, 'statements_of_law', 12);

    -- Ticket 3: queued, blocked by still-queued ticket 2 -- Blocked.
    INSERT INTO tickets (id, proceeding_id, filing_id, title, intent, status, priority, kind, billing_anchor, created)
      VALUES (3, 1, 1, 'Cite-check the reply', 'Confirm every citation in the reply once it is drafted.', 'queued', 3, 'work', 'L4801|attornment defeats the stay', '2026-09-02T08:06');
    INSERT INTO ticket_blocks (blocker_id, blocked_id) VALUES (2, 3);

    -- Ticket 4: wip, its two steps approved (one done) -- In progress.
    INSERT INTO tickets (id, proceeding_id, filing_id, title, intent, status, priority, kind, billing_anchor, locked_by, locked_at, plan_approved_at, created)
      VALUES (4, 1, 1, 'Rebuild the evidence index', 'Reconcile the exhibit list against the disclosure log.', 'wip', 2, 'work', 'L4801|attornment defeats the stay', 'sess-a1', '2026-09-02T10:05', '2026-09-02T10:00', '2026-09-02T09:50');
    INSERT INTO ticket_steps (ticket_id, ordinal, text, done_at) VALUES (4, 1, 'Audit the exhibit list', '2026-09-02T10:10');
    INSERT INTO ticket_steps (ticket_id, ordinal, text) VALUES (4, 2, 'Reconcile against the disclosure log');

    -- Ticket 5: superseded by ticket 1 (also its conflict partner) -- Superseded.
    INSERT INTO tickets (id, proceeding_id, filing_id, title, intent, status, priority, kind, billing_anchor, created, superseded_by)
      VALUES (5, 1, 1, 'Old approach to the stay argument', 'Superseded by ticket 1''s revised approach.', 'superseded', 1, 'work', 'L4801|attornment defeats the stay', '2026-09-02T07:00', 1);
    INSERT INTO ticket_conflicts (a_id, b_id) VALUES (1, 5);

    -- Ticket 6: queued, blocked by superseded ticket 5 -- Blocked, needs a fresh outline.
    INSERT INTO tickets (id, proceeding_id, filing_id, title, intent, status, priority, kind, billing_anchor, created)
      VALUES (6, 1, 1, 'Follow-on task from the old approach', 'Depends on the now-superseded ticket 5.', 'queued', 1, 'work', 'L4801|attornment defeats the stay', '2026-09-02T07:05');
    INSERT INTO ticket_blocks (blocker_id, blocked_id) VALUES (5, 6);

    -- Ticket 7: proceeding-scoped (filing_id NULL), no blockers -- Ready,
    -- and must appear on every filing's board in this proceeding (design §5.1).
    INSERT INTO tickets (id, proceeding_id, filing_id, title, intent, status, priority, kind, billing_anchor, created)
      VALUES (7, 1, NULL, 'Proceeding-wide filing tracker check', 'Confirm every filing in the proceeding is accounted for.', 'queued', 0, 'work', 'L4801|attornment defeats the stay', '2026-09-02T06:00');

    -- Ticket 8: kind='charting', no billing_anchor (CHECK permits it), no blockers -- Ready.
    INSERT INTO tickets (id, proceeding_id, filing_id, title, intent, status, priority, kind, created)
      VALUES (8, 1, 1, 'Chart the outstanding research', 'Turn the remaining open questions into tickets.', 'queued', 0, 'charting', '2026-09-02T05:00');

    -- Tickets 9/10: mutual block -- a charting defect the board must label
    -- circular rather than crash on.
    INSERT INTO tickets (id, proceeding_id, filing_id, title, intent, status, priority, kind, billing_anchor, created)
      VALUES
        (9, 1, 1, 'Circular A', 'Depends on Circular B.', 'queued', 0, 'work', 'L4801|attornment defeats the stay', '2026-09-02T04:00'),
        (10, 1, 1, 'Circular B', 'Depends on Circular A.', 'queued', 0, 'work', 'L4801|attornment defeats the stay', '2026-09-02T04:01');
    INSERT INTO ticket_blocks (blocker_id, blocked_id) VALUES (9, 10), (10, 9);

    -- Ticket 11: blocked by a ticket that exists but in a DIFFERENT proceeding
    -- -- forbidden only by discipline (jobs.md §11), not by any FK, so the
    -- schema allows it. The renderer only loads proceeding 1's own tickets;
    -- this proves an edge to a ticket outside that set renders as an
    -- unresolved blocker (Blocked, named but titleless), not as if no
    -- blocker existed at all (which would wrongly show Ready).
    INSERT INTO proceedings (id, matter_reference, forum) VALUES (2, 'Unrelated matter', 'CAN/BC/BCSC');
    INSERT INTO tickets (id, proceeding_id, filing_id, title, intent, status, priority, kind, billing_anchor, created)
      VALUES (99, 2, NULL, 'Ticket in a different proceeding', 'Exists only to be pointed at across proceedings.', 'queued', 0, 'work', 'X|other', '2026-09-02T03:00');
    INSERT INTO tickets (id, proceeding_id, filing_id, title, intent, status, priority, kind, billing_anchor, created)
      VALUES (11, 1, 1, 'Cross-proceeding blocker test', 'Blocked by a ticket the renderer never loads for this proceeding.', 'queued', 0, 'work', 'L4801|attornment defeats the stay', '2026-09-02T02:00');
    INSERT INTO ticket_blocks (blocker_id, blocked_id) VALUES (99, 11);

    -- Seed 1: uncharted, surfaced mid-ticket-4 -- Loose Threads. Seed 2:
    -- already charted into ticket 7 -- must never render.
    INSERT INTO seeds (id, proceeding_id, filing_id, origin_ticket_id, created, surfaced_by, idea)
      VALUES (1, 1, 1, 4, '2026-09-02T10:12', 'noticed while reconciling the exhibit list', 'Consider a standing exhibit-numbering convention for future filings in this proceeding.');
    INSERT INTO seeds (id, proceeding_id, filing_id, origin_ticket_id, created, surfaced_by, idea, charted_into)
      VALUES (2, 1, 1, NULL, '2026-09-02T05:30', 'raised during charting', 'An idea already charted into ticket 7.', 7);

    -- This helper is otherwise all ticket/seed writes, which carry no revision
    -- triggers -- but the cross-proceeding fixture further up inserts a proceedings
    -- row, which does. Reset so seedTickets stays revision-neutral (#607).
    UPDATE db_meta SET value = '1' WHERE key = 'revision';
    `.trim()
  );
}

// Phase D step 4 (Work Board Proposals design §7, §8): the Proposal cases the Milestone's data
// test asserts on -- the authority and testimony ladders seedVaniacProceeding leaves bare, a
// Proposal held by a ticket on another filing, a direct rejection, a lapsed rejection, a rejected
// ticket and the ticket it blocks. Runs AFTER seedVaniacProceeding and seedTickets, and only in
// the board-data test, so no advocacy golden moves.
export async function seedProposalCases(dbPath) {
  await submissionDataExecute(
    dbPath,
    `
    -- Two more authorities, treatment NULL so every statement of them prints 📇 (the note-up
    -- rung). Both are attached to deployed submission 1 through submission_law below, so they
    -- print on the Written Arguments.
    INSERT INTO authorities (id, proceeding_id, style_of_cause_or_title, citation, kind, weight)
      VALUES
        (5, 1, 'Excerpt Pending v. Zephyr Holdings', '2022 BCSC 44', 'case', 'binding'),
        (6, 1, 'Fully Captured v. Westmount', '2021 BCCA 77', 'case', 'binding');

    INSERT INTO law_assertions (id, proceeding_id, proposition, dead_end)
      VALUES
        (5, 1, 'a proposition whose authority is located but not yet quoted', 0),
        (6, 1, 'a proposition whose authority is captured in full', 0),
        (7, 1, 'a proposition whose authority is quoted but not yet located', 0);

    -- Statement 7: excerpt missing, so 📜 is the rung (authority-excerpt), and its 📇 is uncleared.
    -- Statement 8: everything captured and verified, so only 📇 prints -- and it IS cleared, which
    -- is the one positive current-rung condition (design §5).
    -- Statement 9: pinpoint missing on the same authority 5, so 📍 is the rung; authority 5's two
    -- statements both leave 📇 uncleared, so note-up:authorities:5 never becomes current. Since v61 a
    -- statement cannot move into 'verified' with no pinpoint, so statement 9 is built as a row
    -- verified before v61 stands: verified with a pinpoint and a snapshot holding none, then the
    -- pinpoint cleared, which leaves it off no snapshot and reopens nothing.
    INSERT INTO statements_of_law (id, proceeding_id, law_assertion_id, authority_id, pinpoint, excerpt, source, verification,
                                   scrutinized_authority_id, scrutinized_pinpoint, scrutinized_excerpt)
      VALUES
        (7, 1, 5, 5, 'para 3', NULL, 'primary', 'verified', NULL, NULL, NULL),
        (8, 1, 6, 6, 'para 4', 'The passage that clears the authority ladder in full.', 'primary', 'verified', NULL, NULL, NULL),
        (9, 1, 7, 5, 'para 9', 'A passage captured without the pinpoint that locates it.', 'primary', 'verified',
         5, NULL, 'A passage captured without the pinpoint that locates it.');
    UPDATE statements_of_law SET pinpoint = NULL WHERE id = 9;
    INSERT INTO submission_law (submission_id, law_assertion_id) VALUES (1, 5), (1, 6), (1, 7);

    -- K. Bell (witness 4) is interviewed and her statement (document 6) is executed, so nothing on
    -- the witness or instrument rung holds the locator back: this statement's 🧷 and 💬 are both
    -- current. It is drafted into a paragraph of that statement, which keeps it off the "not yet
    -- in this statement" list -- an unlinked statement is read as instrument-less and would fire
    -- ✍️ on the witness, holding both locators back. Rested on by deployed submission 2, which
    -- already carries facts -- submission 1 stays fact-free so its own 🧾 keeps printing.
    INSERT INTO facts (id, proceeding_id, postulate)
      VALUES (14, 1, 'The change order for the final week was counter-signed before the work began.');
    INSERT INTO statements_of_fact (id, proceeding_id, fact_id, witness_id, instrument, interviewed)
      VALUES (8, 1, 14, 4, 6, 1);
    INSERT INTO statement_paragraphs (id, document_id, ordinal, text)
      VALUES (4, 6, 2, 'I counter-signed the change order before the final week of work began.');
    INSERT INTO paragraph_statements_of_fact (statement_paragraph_id, statement_of_fact_id) VALUES (4, 8);
    INSERT INTO submission_facts (submission_id, fact_id) VALUES (2, 14);

    -- A second filing, so a held Proposal can name the filing its ticket sits on.
    INSERT INTO filings (id, proceeding_id, kind, subkind, round, title)
      VALUES (2, 1, 'submissions_package', NULL, 'reply', 'Reply Submissions Package');

    -- Ticket 12 sits on filing 2 and holds filing 1's 🏷️ Proposal: on filing 1's board that
    -- Proposal reads held, ticketed on the other filing's title.
    INSERT INTO tickets (id, proceeding_id, filing_id, title, intent, status, priority, kind, billing_anchor, created)
      VALUES (12, 1, 2, 'Describe the second exhibit', 'Record its label, date and description.', 'queued', 0, 'work', 'L4801|exhibit description', '2026-09-02T11:00');
    INSERT INTO ticket_proposals (ticket_id, proposal_key, item) VALUES (12, 'not-recorded:documents:2', 'Undescribed exhibit');

    -- Ticket 13 was rejected, so it holds nothing; its snapshot rejection row is what keeps the
    -- Proposal it was outlined from off the board (design §7).
    INSERT INTO tickets (id, proceeding_id, filing_id, title, intent, status, priority, kind, billing_anchor, created, rejected_at)
      VALUES (13, 1, 1, 'Serve the August notice to admit', 'Serve it and diarise the response period.', 'queued', 0, 'work', 'L4801|notice to admit', '2026-09-02T11:05', '2026-09-03T09:00');
    INSERT INTO ticket_proposals (ticket_id, proposal_key, item) VALUES (13, 'serve-it:documents:10', 'Notice to Admit dated 2026-08-01');

    -- Ticket 14 is blocked by that rejected ticket, so its own outline needs re-charting.
    INSERT INTO tickets (id, proceeding_id, filing_id, title, intent, status, priority, kind, billing_anchor, created)
      VALUES (14, 1, 1, 'Tender the admitted diary entries', 'Enter the admission once the notice is served.', 'queued', 0, 'work', 'L4801|notice to admit', '2026-09-02T11:06');
    INSERT INTO ticket_blocks (blocker_id, blocked_id) VALUES (13, 14);

    -- Ticket 2 (Ready, on this board's own filing) holds an ordinary Proposal: held, ticketed_on null.
    INSERT INTO ticket_proposals (ticket_id, proposal_key, item)
      VALUES (2, 'factual-basis:submissions:1', 'The Respondent owes $150,000 under the plain words of the Asset Purchase Agreement.');

    INSERT INTO proposal_rejections (proposal_key, ticket_id, marker, item, rejected_at)
      VALUES
        -- Snapshot (ticket_id set): hides ticket 13's Proposal, never a Rejected angle itself.
        ('serve-it:documents:10', 13, '🎾', 'Notice to Admit dated 2026-08-01', '2026-09-03T09:00'),
        -- Direct (ticket_id NULL) and still describing the work: lane rejected.
        ('unserved-petitum:order_sought:2', NULL, '🦵', 'a reserved fallback order', '2026-09-03T09:05'),
        -- Lapsed: the item no longer matches what the render derives, so the row hides nothing and
        -- the key is reported for the next Opening to delete.
        ('doctrinal-basis:law_assertions:4', NULL, '📖', 'an older wording of the proposition', '2026-09-03T09:10');

    -- Revision reset LAST: the substance rows above move db_meta.revision by trigger (#607).
    UPDATE db_meta SET value = '1' WHERE key = 'revision';
    `.trim()
  );
}

// #908: a proposition rung fused to 🏅. Each assertion holds two counted, verified statements, one
// rated and one unrated, so sourceRungMarker prints the rung with 🏅 glued on (🥈🏅, 🥉🏅). The third
// is a dead end holding the same mix, so 🚧 owns its line and no rung prints. Runs AFTER
// seedVaniacProceeding, and only in the proposal-inventory test, so no advocacy golden moves.
export async function seedFusedRungCases(dbPath) {
  await submissionDataExecute(
    dbPath,
    `
    INSERT INTO authorities (id, proceeding_id, style_of_cause_or_title, citation, kind, weight)
      VALUES
        (20, 1, 'Rated Commentary v. Aldergrove', '2023 BCSC 20', 'case', 'persuasive'),
        (21, 1, 'Unrated Source v. Birchwood', '2023 BCSC 21', 'case', 'persuasive');

    INSERT INTO law_assertions (id, proceeding_id, proposition, dead_end)
      VALUES
        (20, 1, 'a proposition resting on secondary and unrated sources', 0),
        (21, 1, 'a proposition resting on tertiary and unrated sources', 0),
        (22, 1, 'a researched dead end resting on secondary and unrated sources', 1);

    INSERT INTO statements_of_law (id, proceeding_id, law_assertion_id, authority_id, pinpoint, excerpt, source, verification)
      VALUES
        (20, 1, 20, 20, 'para 1', 'A secondary passage on the first proposition.', 'secondary', 'verified'),
        (21, 1, 20, 21, 'para 2', 'An unrated passage on the first proposition.', NULL, 'verified'),
        (22, 1, 21, 20, 'para 3', 'A tertiary passage on the second proposition.', 'tertiary', 'verified'),
        (23, 1, 21, 21, 'para 4', 'An unrated passage on the second proposition.', NULL, 'verified'),
        (24, 1, 22, 20, 'para 5', 'A secondary passage on the dead end.', 'secondary', 'verified'),
        (25, 1, 22, 21, 'para 6', 'An unrated passage on the dead end.', NULL, 'verified');
    INSERT INTO submission_law (submission_id, law_assertion_id) VALUES (1, 20), (1, 21), (1, 22);

    -- Revision reset LAST: the substance rows above move db_meta.revision by trigger (#607).
    UPDATE db_meta SET value = '1' WHERE key = 'revision';
    `.trim()
  );
}

// The board's content is its data (2026-09-14 local-only design, amended 2026-09-15). Since #1365 a
// render returns only board_summary, and since ADR 0033's 2026-10-05 amendment the data is the one
// section of the filing's own Milestone page: boardDataOf builds a filing's section exactly as the
// page and the summary build it, from the inventory its last render saved, and sectionOf reads it
// off the page.
function nowStamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function boardDataOf(dbPath, filingId, client = {}, now = nowStamp()) {
  const [filing] = submissionDataQuery(dbPath, "SELECT * FROM filings WHERE id = ?", [filingId]).rows;
  assert.ok(filing, `expected filing ${filingId}`);
  return filingBoardData(dbPath, filing, fetchProceeding(dbPath, filing.proceeding_id), client, now, fetchRevision(dbPath));
}

/** The Milestone page files in the draft folder, relative to it, sorted: a Writing's `Milestone.html`
 * in its own folder, and a board with no Writing's `Milestone <id>.html` at the top. */
export function milestonePages(draftDir) {
  const top = readdirSync(draftDir, { withFileTypes: true });
  return [
    ...top.filter((e) => e.isFile() && /^Milestone .*\.html$/.test(e.name)).map((e) => e.name),
    ...top.filter((e) => e.isDirectory() && existsSync(join(draftDir, e.name, "Milestone.html"))).map((e) => join(e.name, "Milestone.html")),
  ].sort();
}

/** The section of the Milestone page whose one section is filing `filingId`'s. */
export function sectionOf(draftDir, filingId) {
  const page = milestonePages(draftDir)
    .map((name) => readBoardData(join(draftDir, name)))
    .find((data) => data.sections[0]?.meta.filing_id === filingId);
  assert.ok(page, `expected a Milestone page for filing ${filingId} in ${draftDir}`);
  assert.equal(page.sections.length, 1, `filing ${filingId}'s Milestone page holds one section`);
  return page.sections[0];
}

export const DATA_LINE_PREFIX = "window.WORKBOARD = ";

export function boardDataLines(html) {
  return html.split("\n").filter((line) => line.startsWith(DATA_LINE_PREFIX));
}

export function readBoardData(file) {
  const lines = boardDataLines(readFileSync(file, "utf-8"));
  assert.equal(lines.length, 1, `expected exactly one data line in ${file}`);
  assert.ok(lines[0].endsWith(";"), `unexpected data line shape: ${lines[0].slice(0, 80)}`);
  return JSON.parse(lines[0].slice(DATA_LINE_PREFIX.length, -1));
}

/** The page with its one data line removed: what must be identical across matters. */

// #466 / ADR 0012: presentation_dir -- the server writes the draft-folder presentation copies
// itself, so an ordinary render no longer pushes every document's markdown through the host's
// tool-result cap. `documents` then names which documents also come back inline.
export const ASHBOURNE = { clientName: "Ashbourne", clientNo: "2417", matterNo: "L4801" };

/** The matter's 0. DRAFT folder and the VanIAC seed's Writing's own folder in it. */
export function draftFolder(f) {
  const draft = join(f.dir, "L4801 Matter", "0. DRAFT");
  mkdirSync(draft, { recursive: true });
  return { draft, leaf: join(draft, "Opening Submissions Package") };
}

// The "Rendered:" frontmatter line and any bench-line date carry the real
// wall-clock timestamp -- normalize them to a fixed placeholder so the
// golden fixtures don't churn on every run.
export function replaceStamp(text) {
  return text.replace(/^Rendered: .*$/m, "Rendered: <TIMESTAMP>");
}
