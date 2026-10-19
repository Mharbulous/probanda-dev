// CA52140-shaped bcca_stay_response fixture (#436, research #433), populated per
// filing-checklists.md §10. Moved out of bcca-stay-response.db.test.mjs (#805) so the filed-face
// coverage meta-test seeds this kind from the same source as the renderer tests.
//
// Bare: no filing_positions rows. A test that wants a fully positioned response book appends
// STAY_RESPONSE_POSITIONS.

// The case data STAY_RESPONSE_SEED's parties are linked to (case_party_id), holding exactly their
// counsel and address for service (party/counsel SSOT); a test writes it beside the database with
// helpers/matter-data-fixture.mjs's writePartiesOfRecord.
export const STAY_RESPONSE_CASE_DATA = {
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
    { id: 2, name: "Kestrel Collective Inc.", of_record: [[1, "appellant"]] },
    {
      id: 3,
      name: "Merrow Clothing Manufacturers Ltd.",
      counsel_name: "Elena Marsh",
      counsel_firm: "Beacon Law",
      counsel_email: "emarsh@beaconlaw.ca",
      counsel_phone: "(604) 555-0188",
      address_for_service: "320 - 240 Cambie Street, Vancouver, BC V6B 2N7",
      of_record: [[1, "respondent"]],
    },
    { id: 4, name: "Adrian Renwick", counsel_name: "Elena Marsh", of_record: [[1, "respondent"]] },
    { id: 5, name: "Jonah Renwick", counsel_name: "Elena Marsh", of_record: [[1, "respondent"]] },
  ],
};

export const STAY_RESPONSE_SEED = `
INSERT INTO proceedings (id, matter_reference, forum, court_or_centre, registry, file_number, style_of_cause, courthouse_address, under_appeal_judge, under_appeal_court, under_appeal_pronounced, access_restrictions)
  VALUES (1, 'L4801 - Merrow', 'CAN/BC/BCCA', 'Court of Appeal for British Columbia', 'Vancouver', 'CA52140', NULL, NULL, 'Madam Justice Trelawney', 'Supreme Court of British Columbia', '2026-06-29', NULL);
INSERT INTO parties (id, proceeding_id, name, role, ordinal, is_client, is_applicant, case_party_id) VALUES
  (1, 1, 'Tidewater Outfitters Inc.', 'Appellant', 1, 0, 1, 1),
  (2, 1, 'Kestrel Collective Inc.', 'Appellant', 2, 0, 0, 2),
  (3, 1, 'Merrow Clothing Manufacturers Ltd.', 'Respondent', 3, 1, 0, 3),
  (4, 1, 'Adrian Renwick', 'Respondent', 4, 0, 0, 4),
  (5, 1, 'Jonah Renwick', 'Respondent', 5, 0, 0, 5);
INSERT INTO filings (id, proceeding_id, kind, subkind, round, title)
  VALUES (1, 1, 'bcca_stay_response', NULL, 'response', 'Stay Application Response');
INSERT INTO hearing_details (filing_id, hearing_date, hearing_time, time_estimate_minutes) VALUES (1, '2026-09-04', '10:00 am', 40);
INSERT INTO documents (id, proceeding_id, label, document_date) VALUES
  (10, 1, 'Notice of Application (stay of execution)', '2026-08-27');
INSERT INTO opposing_orders (id, proceeding_id, document_id, paragraph_number, wording) VALUES
  (1, 1, 10, 1, 'A stay of execution of the order of Trelawney J. pending the appeal'),
  (2, 1, 10, 2, 'An order extending the interim stay of VanIAC arbitration 2767-DCA-EP');
INSERT INTO witnesses (id, proceeding_id, name) VALUES (1, 1, 'Adrian Renwick');
INSERT INTO documents (id, proceeding_id, label, document_date, description, instrument, deponent, execution, affidavit_number) VALUES
  (11, 1, 'Affidavit #1 of Adrian Renwick', '2026-08-30', 'Responding affidavit', 'affidavit', 1, '2026-08-30', '1');
INSERT INTO filing_documents (id, filing_id, document_id, ordinal, role) VALUES (1, 1, 11, 1, 'affidavit');
INSERT INTO facts (id, proceeding_id, postulate) VALUES (1, 1, 'The arbitration was commenced on 12 May 2026.');
INSERT INTO filing_facts (id, filing_id, fact_id, document, part, ordinal) VALUES (1, 1, 1, 'form', 'part2', 1);
INSERT INTO statements_of_fact (id, proceeding_id, fact_id, witness_id, instrument, pinpoint, interviewed, excerpt)
  VALUES (1, 1, 1, 1, 11, 'para 4', 1, 'The arbitration was commenced on 12 May 2026.');
INSERT INTO submissions (id, proceeding_id, contention, ordinal) VALUES
  (1, 1, 'The appeal raises no serious question to be tried.', 1);
INSERT INTO filing_submissions (id, filing_id, submission_id, document, ordinal) VALUES (1, 1, 1, 'form', 1);
INSERT INTO submission_facts (submission_id, fact_id) VALUES (1, 1);
INSERT INTO law_assertions (id, proceeding_id, proposition) VALUES (1, 1, 'A stay requires a serious question, irreparable harm, and a favourable balance of convenience.');
INSERT INTO submission_law (submission_id, law_assertion_id) VALUES (1, 1);
INSERT INTO authorities (id, proceeding_id, style_of_cause_or_title, citation, kind, treatment, weight)
  VALUES (1, 1, 'RJR-MacDonald Inc. v. Canada (Attorney General)', '[1994] 1 SCR 311', 'case', 'good_law', 'binding');
INSERT INTO statements_of_law (id, proceeding_id, law_assertion_id, authority_id, pinpoint, excerpt, source, verification)
  VALUES (1, 1, 1, 1, 'at 334', 'the tripartite test', 'primary', 'verified');
INSERT INTO order_sought (id, proceeding_id, wording) VALUES (1, 1, 'The application is dismissed, with costs.');
INSERT INTO filing_orders (id, filing_id, order_sought_id, document, ordinal) VALUES (1, 1, 1, 'form', 1);
UPDATE db_meta SET value = CAST(value AS INTEGER) + 1 WHERE key = 'revision';
`;

// Both opposing orders opposed -- the fully positioned shape the clean-render test and the
// filed-face coverage meta-test both use.
export const STAY_RESPONSE_POSITIONS = `
INSERT INTO filing_positions (id, filing_id, opposing_order_id, position) VALUES
  (1, 1, 1, 'opposed'),
  (2, 1, 2, 'opposed');
`;
