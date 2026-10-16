// CA52140-shaped bcca_factum fixture (#648), populated per filing-checklists.md §12. Shared by
// bcca-factum.db.test.mjs (mockup) and emit-bcca-factum.db.test.mjs (filed face).

// The case data FACTUM_SEED's parties are linked to (case_party_id), holding exactly their counsel
// and address for service (party/counsel SSOT); a test writes it beside the database with
// helpers/case-data-fixture.mjs's writePartiesOfRecord.
export const FACTUM_CASE_DATA = {
  proceedings: [{ id: 1, court: "BCCA", file_number: "CA52140" }],
  parties: [
    {
      id: 1,
      name: "Tidewater Outfitters Inc.",
      counsel_name: "Ian Kerr",
      counsel_firm: "Caldwell, Fenn & Roe LLP",
      counsel_email: "ikerr@cfr-law.ca",
      counsel_phone: "(604) 555-0142",
      address_for_service: "410 - 1290 Beatty Street, Vancouver, BC V6B 2M8",
      of_record: [[1, "appellant"]],
    },
    {
      id: 2,
      name: "Merrow Clothing Manufacturers Ltd.",
      counsel_name: "Elena Marsh",
      counsel_firm: "Beacon Law",
      counsel_email: "emarsh@beaconlaw.ca",
      counsel_phone: "(604) 555-0188",
      address_for_service: "320 - 240 Cambie Street, Vancouver, BC V6B 2N7",
      of_record: [[1, "respondent"]],
    },
    { id: 3, name: "Adrian Renwick", counsel_name: "Elena Marsh", of_record: [[1, "respondent"]] },
  ],
};

export const FACTUM_SEED = `
INSERT INTO proceedings (id, matter_reference, forum, court_or_centre, registry, file_number, under_appeal_judge, under_appeal_court, under_appeal_pronounced)
  VALUES (1, 'L4801 - Merrow', 'CAN/BC/BCCA', 'Court of Appeal for British Columbia', 'Vancouver', 'CA52140', 'Madam Justice Trelawney', 'Supreme Court of British Columbia', '2026-06-29');
INSERT INTO parties (id, proceeding_id, name, role, ordinal, is_client, lower_court_role, case_party_id) VALUES
  (1, 1, 'Tidewater Outfitters Inc.', 'Appellant', 1, 0, 'Respondent', 1),
  (2, 1, 'Merrow Clothing Manufacturers Ltd.', 'Respondent', 2, 1, 'Petitioner', 2),
  (3, 1, 'Adrian Renwick', 'Respondent', 3, 0, 'Petitioner', 3);
INSERT INTO filings (id, proceeding_id, kind, title) VALUES (1, 1, 'bcca_factum', 'Respondents'' Factum');
INSERT INTO filing_chronology (filing_id, event_date, event, ordinal) VALUES
  (1, '2026-06-29', 'Order under appeal pronounced', 1),
  (1, '2026-07-28', 'Notice of appeal filed', 2);
INSERT INTO filing_prose (filing_id, slot, text) VALUES
  (1, 'opening_statement', 'This appeal concerns an arbitration stay.

The chambers judge made no error.'),
  (1, 'facts_position', 'The respondents agree with the appellants'' statement of facts, except as set out below.'),
  (1, 'signing_place', 'Vancouver');
INSERT INTO documents (id, proceeding_id, label) VALUES (20, 1, 'Appeal Record');
INSERT INTO facts (id, proceeding_id, postulate, court_record, court_record_pinpoint) VALUES
  (1, 1, 'The arbitration was commenced on 12 May 2026.', 20, 'Appeal Record, Vol. 1, p. 12');
INSERT INTO filing_facts (filing_id, fact_id, document, part, ordinal) VALUES (1, 1, 'form', 'part2', 1);
INSERT INTO submissions (id, proceeding_id, contention, ordinal) VALUES
  (1, 1, 'The chambers judge applied the correct test.', 1),
  (2, 1, 'The order was within the judge''s discretion.', 2);
INSERT INTO filing_submissions (filing_id, submission_id, document, ordinal) VALUES (1, 1, 'form', 1), (1, 2, 'form', 2);
INSERT INTO submission_facts (submission_id, fact_id) VALUES (1, 1);
INSERT INTO law_assertions (id, proceeding_id, proposition) VALUES
  (1, 1, 'The standard of review on a question of law is correctness.'),
  (2, 1, 'A court may stay proceedings in favour of arbitration.');
INSERT INTO submission_law (submission_id, law_assertion_id) VALUES (1, 1), (2, 2);
INSERT INTO authorities (id, proceeding_id, style_of_cause_or_title, citation, kind, treatment, weight) VALUES
  (1, 1, 'Housen v Nikolaisen', '2002 SCC 33', 'case', 'good_law', 'binding'),
  (2, 1, 'Arbitration Act', 'SBC 2020, c 2', 'statute', 'good_law', 'binding'),
  (3, 1, 'Court of Appeal Rules', 'BC Reg 120/2022', 'rule', 'good_law', 'binding'),
  (4, 1, 'Anonymous Lead v Unverified', '2020 BCSC 1', 'case', NULL, NULL);
-- verification lives on statements_of_law since schema v25: authority 4 is a lead
-- because its only statement is.
INSERT INTO statements_of_law (proceeding_id, law_assertion_id, authority_id, pinpoint, excerpt, source, verification) VALUES
  (1, 1, 1, 'para 8', 'the standard of review for questions of law is correctness', 'primary', 'verified'),
  (1, 2, 2, 's 7', '7 (1) If a party to an arbitration agreement commences legal proceedings, the court must stay them.', 'primary', 'verified'),
  (1, 2, 3, 'R 25', 'A respondent must file a factum.', 'primary', 'verified'),
  (1, 2, 4, 'para 1', 'lead text', 'primary', 'lead');
INSERT INTO opposing_points (proceeding_id, component, pinpoint, verbatim_words, answered_by_submission_id, ordinal) VALUES
  (1, 'Appellants'' factum, Part 2', 'para 1', 'The judge applied the wrong test.', 1, 1),
  (1, 'Appellants'' factum, Part 2', 'para 2', 'The judge ignored the evidence.', NULL, 2);
INSERT INTO order_sought (id, proceeding_id, wording) VALUES (1, 1, 'that the appeal be dismissed, with costs to the respondents.');
INSERT INTO filing_orders (filing_id, order_sought_id, document, ordinal) VALUES (1, 1, 'form', 1);
`;
