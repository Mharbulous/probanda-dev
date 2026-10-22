-- =========================================================================
-- Submission drafting -- migration snippets
-- Each section is one version hop, applied in full by
-- references/scripts/migrate_engine.py. Marker format:
--   -- MIGRATE <from_int> -> <to_int>
-- Single database (unlike case-data's main/law/privileged split), so no
-- "DB:" tag is needed on the marker.
--
-- Every hop's SQL is self-contained and must end by stamping
-- db_meta.schema_version to its own <to_int> -- the runner applies the text
-- verbatim and does no stamping of its own. The 0 -> 1 hop also seeds
-- db_meta.revision, since db_meta itself is created here.
-- The 27 -> 28, 28 -> 29 and 29 -> 30 hops are engine-assisted: 27 -> 28
-- reads temp.forum_tree_keys, which the engine builds from /draft's venues
-- index, 28 -> 29 is preceded by an engine refusal check, and 29 -> 30 reads
-- temp.filing_layouts, which the engine builds from /draft's type files and
-- venue.md files (see the module docstring of
-- references/scripts/migrate_engine.py). The 42 -> 43 and 58 -> 59 hops are
-- preceded by an engine refusal check too.
--
-- Legacy db_meta keys (2026-09-14, docs/design/2026-09-14 work-board-local-
-- only-design.md): workboard_artifact_url and workboard_template_version
-- belonged to the retired hosted Work Board artifact. No hop clears them and
-- no schema version changed. A migration cannot delete the hosted artifact,
-- and clearing its URL first would orphan it, so /draft step 2
-- deletes the artifact and only then clears both keys (jobs.md section 13).
-- =========================================================================

-- MIGRATE 0 -> 1
-- Full v1 schema: proceeding-scoped substance (2.1), filing-scoped
-- selection and join rows (2.2), and the slice/revision concurrency stamps
-- (2.3). Design: docs/Research/2026-08-18 legal-submissions plugin domain model
-- and schema (issue 291).md. Consent-capture columns (design doc 2.2,
-- "consent_capture") are deliberately absent -- they arrive with issue 293
-- in a later migration, not blocking v1.

CREATE TABLE db_meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

-- Every writable row carries slice_id (design doc section 4); proceedings
-- and slices reference each other, so proceedings.slice_id is nullable --
-- the bootstrap-owned "core" slice for a proceeding can only be created
-- after the proceeding row exists, and is written back onto it afterward.
CREATE TABLE slices (
    id            INTEGER PRIMARY KEY,
    proceeding_id INTEGER NOT NULL,
    filing_id     INTEGER,
    name          TEXT NOT NULL,
    revision      INTEGER NOT NULL DEFAULT 0,
    created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    FOREIGN KEY (proceeding_id) REFERENCES proceedings(id),
    FOREIGN KEY (filing_id) REFERENCES filings(id)
);

-- ---------------------------------------------------------------------
-- 2.1 Proceeding-scoped substance
-- ---------------------------------------------------------------------

CREATE TABLE proceedings (
    id                    INTEGER PRIMARY KEY,
    slice_id              INTEGER REFERENCES slices(id),
    matter_reference       TEXT NOT NULL,
    forum                 TEXT NOT NULL CHECK (forum IN ('bcsc', 'vaniac')),
    court_or_centre        TEXT,
    registry              TEXT,
    file_number            TEXT,
    style_of_cause         TEXT,
    courthouse_address     TEXT,
    commenced_on           DATE,
    tribunal_appointed_on  DATE,
    expedited_opt_in       INTEGER NOT NULL DEFAULT 0 CHECK (expedited_opt_in IN (0, 1)),
    rule_24h_consent       INTEGER NOT NULL DEFAULT 0 CHECK (rule_24h_consent IN (0, 1)),
    has_counterclaim       INTEGER NOT NULL DEFAULT 0 CHECK (has_counterclaim IN (0, 1))
);

CREATE TABLE parties (
    id                  INTEGER PRIMARY KEY,
    proceeding_id       INTEGER NOT NULL REFERENCES proceedings(id),
    slice_id            INTEGER NOT NULL REFERENCES slices(id),
    name                TEXT NOT NULL,
    role                TEXT NOT NULL, -- the forum's own vocabulary; no neutral role enum (design doc 2.1)
    ordinal             INTEGER NOT NULL,
    is_client           INTEGER NOT NULL DEFAULT 0 CHECK (is_client IN (0, 1)),
    is_applicant        INTEGER NOT NULL DEFAULT 0 CHECK (is_applicant IN (0, 1)),
    to_be_served        INTEGER NOT NULL DEFAULT 0 CHECK (to_be_served IN (0, 1)),
    address_for_service TEXT
);

CREATE TABLE issues (
    id            INTEGER PRIMARY KEY,
    proceeding_id INTEGER NOT NULL REFERENCES proceedings(id),
    slice_id      INTEGER NOT NULL REFERENCES slices(id),
    name          TEXT NOT NULL,
    ordinal       INTEGER NOT NULL
);

CREATE TABLE documents (
    id                 INTEGER PRIMARY KEY,
    proceeding_id      INTEGER NOT NULL REFERENCES proceedings(id),
    slice_id           INTEGER NOT NULL REFERENCES slices(id),
    label              TEXT NOT NULL,
    doc_type           TEXT,
    document_date      DATE,
    description        TEXT,
    legal_status       TEXT,
    is_best_copy       INTEGER NOT NULL DEFAULT 0 CHECK (is_best_copy IN (0, 1)),
    file_path          TEXT,
    affidavit_deponent TEXT,
    affidavit_number   TEXT,
    affidavit_sworn_on DATE
);

CREATE TABLE witnesses (
    id                  INTEGER PRIMARY KEY,
    proceeding_id       INTEGER NOT NULL REFERENCES proceedings(id),
    slice_id            INTEGER NOT NULL REFERENCES slices(id),
    name                TEXT NOT NULL,
    relationship        TEXT,
    is_past_relationship INTEGER NOT NULL DEFAULT 0 CHECK (is_past_relationship IN (0, 1))
);

CREATE TABLE facts (
    id            INTEGER PRIMARY KEY,
    proceeding_id INTEGER NOT NULL REFERENCES proceedings(id),
    slice_id      INTEGER NOT NULL REFERENCES slices(id),
    statement     TEXT NOT NULL,
    source_kind   TEXT NOT NULL CHECK (source_kind IN ('admitted', 'court_record', 'document', 'witness', 'theorised')),
    witness_id    INTEGER REFERENCES witnesses(id),
    posture       TEXT
);

CREATE TABLE authorities (
    id                    INTEGER PRIMARY KEY,
    proceeding_id         INTEGER NOT NULL REFERENCES proceedings(id),
    slice_id              INTEGER NOT NULL REFERENCES slices(id),
    style_of_cause_or_title TEXT NOT NULL,
    citation              TEXT,
    kind                  TEXT NOT NULL CHECK (kind IN ('case', 'statute', 'regulation', 'rule', 'doctrine')),
    tier                  TEXT CHECK (tier IN ('binding', 'persuasive', 'doctrinal')),
    url_or_locator        TEXT,
    disposition           TEXT NOT NULL DEFAULT 'included' CHECK (disposition IN ('included', 'reserved'))
);

CREATE TABLE excerpts (
    id             INTEGER PRIMARY KEY,
    proceeding_id  INTEGER NOT NULL REFERENCES proceedings(id),
    slice_id       INTEGER NOT NULL REFERENCES slices(id),
    authority_id   INTEGER NOT NULL REFERENCES authorities(id),
    pinpoint       TEXT, -- null => pin marker (design doc 2.1)
    text_verbatim  TEXT NOT NULL,
    proposition    TEXT NOT NULL
);

CREATE TABLE evidence_uses (
    id                     INTEGER PRIMARY KEY,
    proceeding_id          INTEGER NOT NULL REFERENCES proceedings(id),
    slice_id               INTEGER NOT NULL REFERENCES slices(id),
    fact_id                INTEGER NOT NULL REFERENCES facts(id),
    document_id            INTEGER REFERENCES documents(id),
    witness_id             INTEGER REFERENCES witnesses(id),
    statement_paragraph_ref TEXT,
    pinpoint               TEXT,
    sworn_status            TEXT NOT NULL CHECK (sworn_status IN ('sworn', 'written_unsworn', 'oral', 'none')),
    admissibility_note      TEXT
);

CREATE TABLE relief_items (
    id               INTEGER PRIMARY KEY,
    proceeding_id    INTEGER NOT NULL REFERENCES proceedings(id),
    slice_id         INTEGER NOT NULL REFERENCES slices(id),
    label            TEXT NOT NULL,
    wording          TEXT NOT NULL,
    template_key     TEXT,
    template_values  TEXT, -- JSON text
    kind             TEXT NOT NULL CHECK (kind IN ('substantive', 'costs')),
    against_party_id INTEGER REFERENCES parties(id),
    alternative_to   INTEGER REFERENCES relief_items(id),
    issue_id         INTEGER REFERENCES issues(id),
    amount           REAL,
    disposition      TEXT NOT NULL DEFAULT 'included' CHECK (disposition IN ('included', 'reserved'))
);

CREATE TABLE arguments (
    id            INTEGER PRIMARY KEY,
    proceeding_id INTEGER NOT NULL REFERENCES proceedings(id),
    slice_id      INTEGER NOT NULL REFERENCES slices(id),
    proposition   TEXT NOT NULL,
    proof_text    TEXT,
    kind          TEXT NOT NULL CHECK (kind IN ('ordinary', 'cap', 'relief')),
    issue_id      INTEGER REFERENCES issues(id),
    ordinal       INTEGER NOT NULL,
    disposition   TEXT NOT NULL DEFAULT 'included' CHECK (disposition IN ('included', 'reserved'))
);

CREATE TABLE argument_authorities (
    id             INTEGER PRIMARY KEY,
    proceeding_id  INTEGER NOT NULL REFERENCES proceedings(id),
    slice_id       INTEGER NOT NULL REFERENCES slices(id),
    argument_id    INTEGER NOT NULL REFERENCES arguments(id),
    excerpt_id     INTEGER REFERENCES excerpts(id),
    authority_id   INTEGER REFERENCES authorities(id),
    slot_state     TEXT NOT NULL CHECK (slot_state IN ('open', 'requested', 'filled', 'dead_end')),
    point_of_law   TEXT NOT NULL,
    tier_required  TEXT NOT NULL CHECK (tier_required IN ('binding', 'doctrinal'))
);

CREATE TABLE opposing_points (
    id                     INTEGER PRIMARY KEY,
    proceeding_id          INTEGER NOT NULL REFERENCES proceedings(id),
    slice_id               INTEGER NOT NULL REFERENCES slices(id),
    component              TEXT NOT NULL,
    pinpoint               TEXT,
    kind                   TEXT,
    verbatim_words         TEXT,
    answered_by_argument_id INTEGER REFERENCES arguments(id),
    ordinal                INTEGER NOT NULL
);

-- ---------------------------------------------------------------------
-- 2.2 Filing-scoped (filings must exist before notes, which may reference
-- one; SQLite does not require referenced tables to exist at CREATE TABLE
-- time, so this reordering relative to the design doc's own table order is
-- cosmetic only)
-- ---------------------------------------------------------------------

CREATE TABLE filings (
    id              INTEGER PRIMARY KEY,
    proceeding_id   INTEGER NOT NULL REFERENCES proceedings(id),
    slice_id        INTEGER NOT NULL REFERENCES slices(id),
    kind            TEXT NOT NULL CHECK (kind IN ('submissions_package', 'notice_of_application', 'requisition')),
    subkind         TEXT CHECK (subkind IN ('default_judgment', 'consent')),
    round           TEXT CHECK (round IN ('opening', 'response', 'reply', 'non_participation')),
    title           TEXT NOT NULL,
    procedure_track TEXT
);

CREATE TABLE notes (
    id            INTEGER PRIMARY KEY,
    proceeding_id INTEGER NOT NULL REFERENCES proceedings(id),
    slice_id      INTEGER NOT NULL REFERENCES slices(id),
    scope         TEXT NOT NULL CHECK (scope IN ('proceeding', 'filing')),
    filing_id     INTEGER REFERENCES filings(id),
    kind          TEXT NOT NULL CHECK (kind IN ('posture', 'strategy', 'drafting_note')),
    text          TEXT NOT NULL -- never rendered (ADR 0004 / design doc section 3)
);

CREATE TABLE gaps (
    id            INTEGER PRIMARY KEY,
    proceeding_id INTEGER NOT NULL REFERENCES proceedings(id),
    slice_id      INTEGER NOT NULL REFERENCES slices(id),
    entity        TEXT NOT NULL,
    entity_id     INTEGER NOT NULL,
    field         TEXT NOT NULL,
    ask           TEXT,
    wrapper       TEXT NOT NULL CHECK (wrapper IN ('gap', 'authority', 'source', 'not_recorded', 'unchosen'))
);

CREATE TABLE filing_relief (
    id              INTEGER PRIMARY KEY,
    filing_id       INTEGER NOT NULL REFERENCES filings(id),
    slice_id        INTEGER NOT NULL REFERENCES slices(id),
    relief_item_id  INTEGER NOT NULL REFERENCES relief_items(id),
    ordinal         INTEGER NOT NULL,
    wording_override TEXT
);

CREATE TABLE filing_facts (
    id            INTEGER PRIMARY KEY,
    filing_id     INTEGER NOT NULL REFERENCES filings(id),
    slice_id      INTEGER NOT NULL REFERENCES slices(id),
    fact_id       INTEGER NOT NULL REFERENCES facts(id),
    ordinal       INTEGER NOT NULL,
    section       TEXT NOT NULL CHECK (section IN ('part2', 'argument', 'statement'))
);

CREATE TABLE filing_arguments (
    id          INTEGER PRIMARY KEY,
    filing_id   INTEGER NOT NULL REFERENCES filings(id),
    slice_id    INTEGER NOT NULL REFERENCES slices(id),
    argument_id INTEGER NOT NULL REFERENCES arguments(id),
    ordinal     INTEGER NOT NULL
);

CREATE TABLE filing_authorities (
    id            INTEGER PRIMARY KEY,
    filing_id     INTEGER NOT NULL REFERENCES filings(id),
    slice_id      INTEGER NOT NULL REFERENCES slices(id),
    authority_id  INTEGER NOT NULL REFERENCES authorities(id),
    ordinal       INTEGER NOT NULL
);

CREATE TABLE filing_documents (
    id          INTEGER PRIMARY KEY,
    filing_id   INTEGER NOT NULL REFERENCES filings(id),
    slice_id    INTEGER NOT NULL REFERENCES slices(id),
    document_id INTEGER NOT NULL REFERENCES documents(id),
    ordinal     INTEGER NOT NULL,
    role        TEXT NOT NULL CHECK (role IN ('affidavit', 'pleading', 'order', 'evidence', 'other'))
);

CREATE TABLE witness_statements (
    id         INTEGER PRIMARY KEY,
    filing_id  INTEGER NOT NULL REFERENCES filings(id),
    slice_id   INTEGER NOT NULL REFERENCES slices(id),
    witness_id INTEGER NOT NULL REFERENCES witnesses(id),
    signed_on  DATE,
    signed_at  TEXT,
    ordinal    INTEGER NOT NULL
);

CREATE TABLE statement_paragraphs (
    id                   INTEGER PRIMARY KEY,
    witness_statement_id INTEGER NOT NULL REFERENCES witness_statements(id),
    slice_id             INTEGER NOT NULL REFERENCES slices(id),
    ordinal              INTEGER NOT NULL,
    text                 TEXT NOT NULL
);

-- Pure link table (design doc: "fact_ids (join table statement_paragraph_facts)")
-- -- ownership follows the parent statement_paragraphs row's slice, so it
-- carries no slice_id of its own.
CREATE TABLE statement_paragraph_facts (
    statement_paragraph_id INTEGER NOT NULL REFERENCES statement_paragraphs(id),
    fact_id                INTEGER NOT NULL REFERENCES facts(id),
    PRIMARY KEY (statement_paragraph_id, fact_id)
);

CREATE TABLE hearing_details (
    id                    INTEGER PRIMARY KEY,
    filing_id             INTEGER NOT NULL UNIQUE REFERENCES filings(id),
    slice_id              INTEGER NOT NULL REFERENCES slices(id),
    hearing_date          DATE,
    hearing_time          TEXT,
    am_pm                 TEXT,
    place                 TEXT,
    time_estimate_minutes INTEGER,
    associate_judge       INTEGER NOT NULL DEFAULT 0 CHECK (associate_judge IN (0, 1)),
    notice_mode           TEXT
);

CREATE TABLE entitlement_grounds (
    id             INTEGER PRIMARY KEY,
    filing_id      INTEGER NOT NULL REFERENCES filings(id),
    slice_id       INTEGER NOT NULL REFERENCES slices(id),
    label          TEXT NOT NULL,
    rule_reference TEXT,
    proof_kind     TEXT,
    proof_reference TEXT,
    proof_status   TEXT,
    ordinal        INTEGER NOT NULL
);

CREATE TABLE computations (
    id        INTEGER PRIMARY KEY,
    filing_id INTEGER NOT NULL REFERENCES filings(id),
    slice_id  INTEGER NOT NULL REFERENCES slices(id),
    label     TEXT NOT NULL,
    method    TEXT,
    result    REAL
);

CREATE TABLE computation_inputs (
    id             INTEGER PRIMARY KEY,
    computation_id INTEGER NOT NULL REFERENCES computations(id),
    slice_id       INTEGER NOT NULL REFERENCES slices(id),
    label          TEXT NOT NULL,
    value          REAL,
    proof_kind     TEXT,
    pinpoint       TEXT,
    excerpt_id     INTEGER REFERENCES excerpts(id),
    status         TEXT
);

CREATE TABLE computation_steps (
    id             INTEGER PRIMARY KEY,
    computation_id INTEGER NOT NULL REFERENCES computations(id),
    slice_id       INTEGER NOT NULL REFERENCES slices(id),
    output         REAL
);

-- Pure link table (design doc: "step consumes[] (join computation_step_inputs)")
CREATE TABLE computation_step_inputs (
    computation_step_id  INTEGER NOT NULL REFERENCES computation_steps(id),
    computation_input_id INTEGER NOT NULL REFERENCES computation_inputs(id),
    PRIMARY KEY (computation_step_id, computation_input_id)
);

-- ---------------------------------------------------------------------
-- Indexes on the FK columns renderers actually filter by (design doc
-- section 5: "each form renderer is a pure projection over one filing plus
-- its joins") -- proceeding_id and filing_id, not every secondary FK.
-- ---------------------------------------------------------------------

CREATE INDEX idx_parties_proceeding ON parties(proceeding_id);
CREATE INDEX idx_issues_proceeding ON issues(proceeding_id);
CREATE INDEX idx_documents_proceeding ON documents(proceeding_id);
CREATE INDEX idx_witnesses_proceeding ON witnesses(proceeding_id);
CREATE INDEX idx_facts_proceeding ON facts(proceeding_id);
CREATE INDEX idx_authorities_proceeding ON authorities(proceeding_id);
CREATE INDEX idx_excerpts_proceeding ON excerpts(proceeding_id);
CREATE INDEX idx_evidence_uses_proceeding ON evidence_uses(proceeding_id);
CREATE INDEX idx_evidence_uses_fact ON evidence_uses(fact_id);
CREATE INDEX idx_relief_items_proceeding ON relief_items(proceeding_id);
CREATE INDEX idx_arguments_proceeding ON arguments(proceeding_id);
CREATE INDEX idx_argument_authorities_proceeding ON argument_authorities(proceeding_id);
CREATE INDEX idx_argument_authorities_argument ON argument_authorities(argument_id);
CREATE INDEX idx_opposing_points_proceeding ON opposing_points(proceeding_id);
CREATE INDEX idx_filings_proceeding ON filings(proceeding_id);
CREATE INDEX idx_notes_proceeding ON notes(proceeding_id);
CREATE INDEX idx_notes_filing ON notes(filing_id);
CREATE INDEX idx_gaps_proceeding ON gaps(proceeding_id);
CREATE INDEX idx_filing_relief_filing ON filing_relief(filing_id);
CREATE INDEX idx_filing_facts_filing ON filing_facts(filing_id);
CREATE INDEX idx_filing_arguments_filing ON filing_arguments(filing_id);
CREATE INDEX idx_filing_authorities_filing ON filing_authorities(filing_id);
CREATE INDEX idx_filing_documents_filing ON filing_documents(filing_id);
CREATE INDEX idx_witness_statements_filing ON witness_statements(filing_id);
CREATE INDEX idx_statement_paragraphs_witness_statement ON statement_paragraphs(witness_statement_id);
CREATE INDEX idx_entitlement_grounds_filing ON entitlement_grounds(filing_id);
CREATE INDEX idx_computations_filing ON computations(filing_id);
CREATE INDEX idx_computation_inputs_computation ON computation_inputs(computation_id);
CREATE INDEX idx_computation_steps_computation ON computation_steps(computation_id);
CREATE INDEX idx_slices_proceeding ON slices(proceeding_id);
CREATE INDEX idx_slices_filing ON slices(filing_id);

INSERT INTO db_meta (key, value) VALUES ('schema_version', '1');
INSERT INTO db_meta (key, value) VALUES ('revision', '0');

-- MIGRATE 1 -> 2
-- Simplify pass: issues 300 (requirements ledger), 301 (deletion pass) and
-- 302 (jurisdictional slot moves to relief_items) applied together, per
-- design doc (docs/Research/2026-08-18 legal-submissions plugin domain model and
-- schema (issue 291).md) section 7 "Handed forward" and its inline
-- amendment notes. The v1 schema (build ticket #295) never shipped to a
-- real matter, so this hop drops and recreates every affected table rather
-- than ALTER-and-preserve -- there is no data to carry forward, and most
-- struck columns (slice_id above all) carry a FOREIGN KEY SQLite's
-- ALTER TABLE ... DROP COLUMN refuses to drop anyway.
--
-- Struck entirely (issue 300, section 4 superseded -- no parallel workers
-- in v1): slices, and slice_id on every table that carried it.
-- Struck entirely (issue 300): issues, notes, filing_authorities,
-- entitlement_grounds, computations, computation_inputs, computation_steps,
-- computation_step_inputs.
-- Struck columns (issue 300): proceedings.commenced_on/tribunal_appointed_on
-- /has_counterclaim, documents.legal_status, filings.procedure_track,
-- hearing_details.notice_mode, relief_items.issue_id, arguments.issue_id;
-- argument_authorities.slot_state drops the 'requested' value.
-- Struck columns (issue 301): proceedings.expedited_opt_in,
-- documents.doc_type, witnesses.is_past_relationship, facts.witness_id
-- (evidence_uses.witness_id is the link), evidence_uses.statement_paragraph_ref,
-- relief_items.label/kind/against_party_id, opposing_points.kind,
-- hearing_details.am_pm/place, arguments.kind. argument_authorities.tier_required
-- was renamed to basis_kind by issue 301, then struck outright by issue 302
-- (every remaining slot is doctrinal by construction) -- net effect in this
-- single combined hop is a straight drop, so basis_kind is never created.
-- Added (issue 301): parties.counsel_name (replaces the never-built
-- consent_capture table); authorities.tier gains a fourth CHECK value --
-- 'unverified' -- for a tier-3 unverified/secondary-source lead (the
-- existing three values measure precedential weight, not source
-- reliability, so this is an addition, not a rename); evidence_uses gains
-- purpose (nullable, unconstrained -- 'impeachment' is its only value
-- named so far, marking a reserved evidence use held for cross; see
-- .claude/skills/submission-data/references/work-markers.md).
-- Added (issue 302): relief_items.jurisdiction_excerpt_id (nullable FK to
-- excerpts) and jurisdiction_slot_state ('open | filled | dead_end',
-- NOT NULL -- one jurisdictional slot per order sought). authorities gains
-- treatment (nullable CHECK 'distinguishable | negative | overruled |
-- good_law' -- NULL = not yet noted up, renders the law-side suspicious
-- marker; a v2 input on #302 posted 2026-08-20, from #305 amendment 10).
-- Retained, corrected from the design doc: argument_authorities.authority_id
-- was struck by issue 301 in the design doc's amendment block but
-- reinstated by issue 305 (requirements ledger line 214, G13 "excerpt
-- needed") -- without it, "authority chosen, excerpt not yet captured" is
-- unrepresentable (excerpts.text_verbatim is NOT NULL) and the law-side
-- excerpt-needed marker can never fire. Nullable FK to authorities(id).
-- evidence_uses also gains disposition ('included | reserved', matching
-- authorities/relief_items/arguments) -- work-markers.md's impeachment
-- marker reads purpose='impeachment' AND disposition='reserved' together;
-- purpose alone (issue 302) cannot render it.
-- gaps.wrapper gains 'question' -- the open-question marker's own value,
-- named in work-markers.md as needed and absent from the v1 CHECK.
-- Not carried into this hop: gaps.wrapper's 'not_started' value mentioned
-- in design doc section 7 -- the existing 'not_recorded' value already
-- covers that predicate (work-markers.md line 30) and no renderer or
-- journey names a distinct 'not_started' reader -- left for a future hop
-- if a journey names its reader.

DROP TABLE slices;
DROP TABLE issues;
DROP TABLE notes;
DROP TABLE filing_authorities;
DROP TABLE entitlement_grounds;
DROP TABLE computations;
DROP TABLE computation_inputs;
DROP TABLE computation_steps;
DROP TABLE computation_step_inputs;

-- No explicit DROP INDEX -- SQLite removes a table's indexes automatically
-- when the table itself is dropped, and every index below belongs to a
-- table dropped here.

DROP TABLE proceedings;
DROP TABLE parties;
DROP TABLE documents;
DROP TABLE witnesses;
DROP TABLE facts;
DROP TABLE authorities;
DROP TABLE excerpts;
DROP TABLE evidence_uses;
DROP TABLE relief_items;
DROP TABLE arguments;
DROP TABLE argument_authorities;
DROP TABLE opposing_points;
DROP TABLE filings;
DROP TABLE gaps;
DROP TABLE filing_relief;
DROP TABLE filing_facts;
DROP TABLE filing_arguments;
DROP TABLE filing_documents;
DROP TABLE witness_statements;
DROP TABLE statement_paragraphs;
DROP TABLE hearing_details;

CREATE TABLE proceedings (
    id                  INTEGER PRIMARY KEY,
    matter_reference    TEXT NOT NULL,
    forum               TEXT NOT NULL CHECK (forum IN ('bcsc', 'vaniac')),
    court_or_centre     TEXT,
    registry            TEXT,
    file_number         TEXT,
    style_of_cause      TEXT,
    courthouse_address  TEXT,
    rule_24h_consent    INTEGER NOT NULL DEFAULT 0 CHECK (rule_24h_consent IN (0, 1))
);

CREATE TABLE parties (
    id                  INTEGER PRIMARY KEY,
    proceeding_id       INTEGER NOT NULL REFERENCES proceedings(id),
    name                TEXT NOT NULL,
    role                TEXT NOT NULL, -- the forum's own vocabulary; no neutral role enum (design doc 2.1)
    ordinal             INTEGER NOT NULL,
    is_client           INTEGER NOT NULL DEFAULT 0 CHECK (is_client IN (0, 1)),
    is_applicant        INTEGER NOT NULL DEFAULT 0 CHECK (is_applicant IN (0, 1)),
    to_be_served        INTEGER NOT NULL DEFAULT 0 CHECK (to_be_served IN (0, 1)),
    address_for_service TEXT,
    counsel_name        TEXT -- added issue 301, replaces consent_capture
);

CREATE TABLE documents (
    id                 INTEGER PRIMARY KEY,
    proceeding_id      INTEGER NOT NULL REFERENCES proceedings(id),
    label              TEXT NOT NULL,
    document_date      DATE,
    description        TEXT,
    is_best_copy       INTEGER NOT NULL DEFAULT 0 CHECK (is_best_copy IN (0, 1)),
    file_path          TEXT,
    affidavit_deponent TEXT,
    affidavit_number   TEXT,
    affidavit_sworn_on DATE
);

CREATE TABLE witnesses (
    id            INTEGER PRIMARY KEY,
    proceeding_id INTEGER NOT NULL REFERENCES proceedings(id),
    name          TEXT NOT NULL,
    relationship  TEXT
);

CREATE TABLE facts (
    id            INTEGER PRIMARY KEY,
    proceeding_id INTEGER NOT NULL REFERENCES proceedings(id),
    statement     TEXT NOT NULL,
    source_kind   TEXT NOT NULL CHECK (source_kind IN ('admitted', 'court_record', 'document', 'witness', 'theorised')),
    posture       TEXT
);

CREATE TABLE authorities (
    id                      INTEGER PRIMARY KEY,
    proceeding_id           INTEGER NOT NULL REFERENCES proceedings(id),
    style_of_cause_or_title TEXT NOT NULL,
    citation                TEXT,
    kind                    TEXT NOT NULL CHECK (kind IN ('case', 'statute', 'regulation', 'rule', 'doctrine')),
    tier                    TEXT CHECK (tier IN ('binding', 'persuasive', 'doctrinal', 'unverified')),
    url_or_locator          TEXT,
    disposition             TEXT NOT NULL DEFAULT 'included' CHECK (disposition IN ('included', 'reserved')),
    treatment               TEXT CHECK (treatment IN ('distinguishable', 'negative', 'overruled', 'good_law')) -- added issue 302 (#305 amendment 10); NULL = not yet noted up
);

CREATE TABLE excerpts (
    id            INTEGER PRIMARY KEY,
    proceeding_id INTEGER NOT NULL REFERENCES proceedings(id),
    authority_id  INTEGER NOT NULL REFERENCES authorities(id),
    pinpoint      TEXT, -- null => pin marker (design doc 2.1)
    text_verbatim TEXT NOT NULL,
    proposition   TEXT NOT NULL
);

CREATE TABLE evidence_uses (
    id                 INTEGER PRIMARY KEY,
    proceeding_id      INTEGER NOT NULL REFERENCES proceedings(id),
    fact_id            INTEGER NOT NULL REFERENCES facts(id),
    document_id        INTEGER REFERENCES documents(id),
    witness_id         INTEGER REFERENCES witnesses(id),
    pinpoint           TEXT,
    sworn_status       TEXT NOT NULL CHECK (sworn_status IN ('sworn', 'written_unsworn', 'oral', 'none')),
    admissibility_note TEXT,
    purpose            TEXT, -- added issue 301; 'impeachment' marks a reserved use held for cross (work-markers.md)
    disposition        TEXT NOT NULL DEFAULT 'included' CHECK (disposition IN ('included', 'reserved')) -- added issue 302; impeachment reads purpose='impeachment' AND disposition='reserved' together (work-markers.md)
);

CREATE TABLE relief_items (
    id                      INTEGER PRIMARY KEY,
    proceeding_id           INTEGER NOT NULL REFERENCES proceedings(id),
    wording                 TEXT NOT NULL,
    template_key            TEXT,
    template_values         TEXT, -- JSON text
    alternative_to          INTEGER REFERENCES relief_items(id),
    amount                  REAL,
    disposition             TEXT NOT NULL DEFAULT 'included' CHECK (disposition IN ('included', 'reserved')),
    jurisdiction_excerpt_id INTEGER REFERENCES excerpts(id), -- added issue 302
    jurisdiction_slot_state TEXT NOT NULL CHECK (jurisdiction_slot_state IN ('open', 'filled', 'dead_end')) -- added issue 302
);

CREATE TABLE arguments (
    id            INTEGER PRIMARY KEY,
    proceeding_id INTEGER NOT NULL REFERENCES proceedings(id),
    proposition   TEXT NOT NULL,
    proof_text    TEXT,
    ordinal       INTEGER NOT NULL,
    disposition   TEXT NOT NULL DEFAULT 'included' CHECK (disposition IN ('included', 'reserved'))
);

CREATE TABLE argument_authorities (
    id            INTEGER PRIMARY KEY,
    proceeding_id INTEGER NOT NULL REFERENCES proceedings(id),
    argument_id   INTEGER NOT NULL REFERENCES arguments(id),
    authority_id  INTEGER REFERENCES authorities(id), -- reinstated (#305 ledger line 214, G13): authority chosen, excerpt not yet captured
    excerpt_id    INTEGER REFERENCES excerpts(id),
    slot_state    TEXT NOT NULL CHECK (slot_state IN ('open', 'filled', 'dead_end')),
    point_of_law  TEXT NOT NULL
);

CREATE TABLE opposing_points (
    id                      INTEGER PRIMARY KEY,
    proceeding_id           INTEGER NOT NULL REFERENCES proceedings(id),
    component               TEXT NOT NULL,
    pinpoint                TEXT,
    verbatim_words          TEXT,
    answered_by_argument_id INTEGER REFERENCES arguments(id),
    ordinal                 INTEGER NOT NULL
);

CREATE TABLE filings (
    id            INTEGER PRIMARY KEY,
    proceeding_id INTEGER NOT NULL REFERENCES proceedings(id),
    kind          TEXT NOT NULL CHECK (kind IN ('submissions_package', 'notice_of_application', 'requisition')),
    subkind       TEXT CHECK (subkind IN ('default_judgment', 'consent')),
    round         TEXT CHECK (round IN ('opening', 'response', 'reply', 'non_participation')),
    title         TEXT NOT NULL
);

CREATE TABLE gaps (
    id            INTEGER PRIMARY KEY,
    proceeding_id INTEGER NOT NULL REFERENCES proceedings(id),
    entity        TEXT NOT NULL,
    entity_id     INTEGER NOT NULL,
    field         TEXT NOT NULL,
    ask           TEXT,
    wrapper       TEXT NOT NULL CHECK (wrapper IN ('gap', 'authority', 'source', 'not_recorded', 'unchosen', 'question')) -- 'question' added issue 302 (work-markers.md: open-question marker)
);

CREATE TABLE filing_relief (
    id               INTEGER PRIMARY KEY,
    filing_id        INTEGER NOT NULL REFERENCES filings(id),
    relief_item_id   INTEGER NOT NULL REFERENCES relief_items(id),
    ordinal          INTEGER NOT NULL,
    wording_override TEXT
);

CREATE TABLE filing_facts (
    id        INTEGER PRIMARY KEY,
    filing_id INTEGER NOT NULL REFERENCES filings(id),
    fact_id   INTEGER NOT NULL REFERENCES facts(id),
    ordinal   INTEGER NOT NULL,
    section   TEXT NOT NULL CHECK (section IN ('part2', 'argument', 'statement'))
);

CREATE TABLE filing_arguments (
    id          INTEGER PRIMARY KEY,
    filing_id   INTEGER NOT NULL REFERENCES filings(id),
    argument_id INTEGER NOT NULL REFERENCES arguments(id),
    ordinal     INTEGER NOT NULL
);

CREATE TABLE filing_documents (
    id          INTEGER PRIMARY KEY,
    filing_id   INTEGER NOT NULL REFERENCES filings(id),
    document_id INTEGER NOT NULL REFERENCES documents(id),
    ordinal     INTEGER NOT NULL,
    role        TEXT NOT NULL CHECK (role IN ('affidavit', 'pleading', 'order', 'evidence', 'other'))
);

CREATE TABLE witness_statements (
    id         INTEGER PRIMARY KEY,
    filing_id  INTEGER NOT NULL REFERENCES filings(id),
    witness_id INTEGER NOT NULL REFERENCES witnesses(id),
    signed_on  DATE,
    signed_at  TEXT,
    ordinal    INTEGER NOT NULL
);

CREATE TABLE statement_paragraphs (
    id                   INTEGER PRIMARY KEY,
    witness_statement_id INTEGER NOT NULL REFERENCES witness_statements(id),
    ordinal              INTEGER NOT NULL,
    text                 TEXT NOT NULL
);

CREATE TABLE hearing_details (
    id                    INTEGER PRIMARY KEY,
    filing_id             INTEGER NOT NULL UNIQUE REFERENCES filings(id),
    hearing_date          DATE,
    hearing_time          TEXT,
    time_estimate_minutes INTEGER,
    associate_judge       INTEGER NOT NULL DEFAULT 0 CHECK (associate_judge IN (0, 1))
);

CREATE INDEX idx_parties_proceeding ON parties(proceeding_id);
CREATE INDEX idx_documents_proceeding ON documents(proceeding_id);
CREATE INDEX idx_witnesses_proceeding ON witnesses(proceeding_id);
CREATE INDEX idx_facts_proceeding ON facts(proceeding_id);
CREATE INDEX idx_authorities_proceeding ON authorities(proceeding_id);
CREATE INDEX idx_excerpts_proceeding ON excerpts(proceeding_id);
CREATE INDEX idx_evidence_uses_proceeding ON evidence_uses(proceeding_id);
CREATE INDEX idx_evidence_uses_fact ON evidence_uses(fact_id);
CREATE INDEX idx_relief_items_proceeding ON relief_items(proceeding_id);
CREATE INDEX idx_arguments_proceeding ON arguments(proceeding_id);
CREATE INDEX idx_argument_authorities_proceeding ON argument_authorities(proceeding_id);
CREATE INDEX idx_argument_authorities_argument ON argument_authorities(argument_id);
CREATE INDEX idx_argument_authorities_authority ON argument_authorities(authority_id);
CREATE INDEX idx_opposing_points_proceeding ON opposing_points(proceeding_id);
CREATE INDEX idx_filings_proceeding ON filings(proceeding_id);
CREATE INDEX idx_gaps_proceeding ON gaps(proceeding_id);
CREATE INDEX idx_filing_relief_filing ON filing_relief(filing_id);
CREATE INDEX idx_filing_facts_filing ON filing_facts(filing_id);
CREATE INDEX idx_filing_arguments_filing ON filing_arguments(filing_id);
CREATE INDEX idx_filing_documents_filing ON filing_documents(filing_id);
CREATE INDEX idx_witness_statements_filing ON witness_statements(filing_id);
CREATE INDEX idx_statement_paragraphs_witness_statement ON statement_paragraphs(witness_statement_id);

UPDATE db_meta SET value = '2' WHERE key = 'schema_version';

-- MIGRATE 2 -> 3
-- Schema v3 (issue #328, widened by #323/#330/#327): postulate/statements_of_fact
-- restructure, submissions/law-assertion split off argument_authorities, the
-- witness_statements -> documents fold, and the filing_facts.section narrowing.
-- Data-preserving (unlike the 1->2 hop): every table below with live rows is
-- rebuilt via rename-recreate-reinsert-drop, not blind drop+recreate. Original
-- primary-key ids are reused wherever the row survives unchanged, so no id
-- remap table is needed except for the witness_statements->documents fold
-- (a genuinely new id space) and the argument_authorities->law_assertions /
-- statements_of_law dissolution (row ids reused 1:1 across the split, since
-- argument_authorities disappears entirely and its id space is free).
--
-- Ordering note: SQLite's ALTER TABLE RENAME auto-rewrites every OTHER
-- table's still-live FOREIGN KEY definitions to follow the renamed table --
-- so a child table not itself rebuilt before a later INSERT keeps pointing
-- at the now-dropped "_v2" name and fails with a "no such table" error that
-- names the wrong table entirely (confirmed empirically against SQLite
-- 3.50.4 / Python 3.14's sqlite3 module while drafting this hop). Every
-- table below that both (a) gets rebuilt in this hop and (b) is the FK
-- target of a table this hop later INSERTs into is rebuilt *before* that
-- later insert -- see filing_documents, rebuilt immediately after documents
-- rather than at the end, for exactly this reason.
--
-- Deliberately NOT in this hop (out of #328's scope; tracked as follow-up in
-- the ticket's resolution comment, terms-and-symbols.md's own "Open decisions"):
-- facts.source_kind/posture untouched (no reserve/doubt/source columns added
-- to facts or statements_of_fact); authorities.tier/weight/verification
-- untouched; relief_items and its jurisdiction_excerpt_id untouched (still
-- nominally points at the retired excerpts id-space -- harmless at the DDL
-- level, SQLite does not validate FK target existence at CREATE/DROP time,
-- and relief_items itself is never INSERTed into by this hop so the rename
-- gotcha above does not apply to it either); the `admissions` table is NOT
-- created this hop -- #330's comment made it explicitly conditional ("if
-- the v3 hop creates admissions"), no live matter data exercises it, and
-- creating it is a substantial independent decision (party/method/ladder)
-- better left to its own ticket.
--
-- L8212-specific data correction (Submission 2 was actually a postulate
-- mis-stored in arguments.proposition, per terms-and-symbols.md's Renames
-- section and this ticket's row-migration note) is NOT baked into this
-- generic hop -- it is a one-off `execute` script run once against that one
-- proceeding's database after migration, because the correction identifies
-- one specific row by content, not by a structural rule every database
-- should have applied to it.

-- ---------------------------------------------------------------------
-- documents: fold in instrument/deponent/execution (2NF, #327); drop the
-- free-text affidavit_deponent and affidavit_sworn_on it replaces.
-- ---------------------------------------------------------------------
ALTER TABLE documents RENAME TO documents_v2;
CREATE TABLE documents (
    id                 INTEGER PRIMARY KEY,
    proceeding_id      INTEGER NOT NULL REFERENCES proceedings(id),
    label              TEXT NOT NULL,
    document_date      DATE,
    description        TEXT,
    is_best_copy       INTEGER NOT NULL DEFAULT 0 CHECK (is_best_copy IN (0, 1)),
    file_path          TEXT,
    instrument         TEXT CHECK (instrument IN ('witness_statement', 'affidavit')),
    deponent           INTEGER REFERENCES witnesses(id),
    execution          DATE,
    signed_at          TEXT,
    affidavit_number   TEXT
);
INSERT INTO documents (id, proceeding_id, label, document_date, description, is_best_copy, file_path, instrument, deponent, execution, affidavit_number)
SELECT dv2.id, dv2.proceeding_id, dv2.label, dv2.document_date, dv2.description, dv2.is_best_copy, dv2.file_path,
       CASE WHEN dv2.affidavit_deponent IS NOT NULL OR dv2.affidavit_sworn_on IS NOT NULL THEN 'affidavit' ELSE NULL END,
       (SELECT w.id FROM witnesses w WHERE w.proceeding_id = dv2.proceeding_id AND w.name = dv2.affidavit_deponent),
       dv2.affidavit_sworn_on,
       dv2.affidavit_number
FROM documents_v2 dv2;

-- filing_documents.role gains 'witness_statement' (ticket #328 comment;
-- decided here since the ticket left the choice open). Rebuilt now, before
-- dropping documents_v2 -- SQLite auto-rewrites filing_documents' live FK
-- to follow the documents->documents_v2 rename, so any row still pointing
-- at documents_v2 blocks that DROP with a FOREIGN KEY constraint failure
-- until filing_documents itself is rebuilt against the new `documents`
-- (see the ordering note above; confirmed empirically against L8212's own
-- 5 filing_documents rows while drafting this hop).
ALTER TABLE filing_documents RENAME TO filing_documents_v2;
CREATE TABLE filing_documents (
    id          INTEGER PRIMARY KEY,
    filing_id   INTEGER NOT NULL REFERENCES filings(id),
    document_id INTEGER NOT NULL REFERENCES documents(id),
    ordinal     INTEGER NOT NULL,
    role        TEXT NOT NULL CHECK (role IN ('affidavit', 'pleading', 'order', 'evidence', 'other', 'witness_statement'))
);
INSERT INTO filing_documents (id, filing_id, document_id, ordinal, role)
SELECT id, filing_id, document_id, ordinal, role FROM filing_documents_v2;
DROP TABLE filing_documents_v2;
DROP TABLE documents_v2;

-- witness_statements folds into documents (#327): one documents row per
-- witness_statement, instrument='witness_statement', deponent=witness,
-- execution=signed_on. New ids continue from the current max(documents.id).
CREATE TABLE _ws_migration_map (
    witness_statement_id INTEGER PRIMARY KEY,
    new_document_id       INTEGER NOT NULL
);
INSERT INTO _ws_migration_map (witness_statement_id, new_document_id)
SELECT ws.id, (SELECT COALESCE(MAX(id), 0) FROM documents) + ROW_NUMBER() OVER (ORDER BY ws.id)
FROM witness_statements ws;

INSERT INTO documents (id, proceeding_id, label, instrument, deponent, execution, signed_at)
SELECT m.new_document_id, f.proceeding_id, 'Witness Statement of ' || w.name, 'witness_statement', ws.witness_id, ws.signed_on, ws.signed_at
FROM witness_statements ws
JOIN _ws_migration_map m ON m.witness_statement_id = ws.id
JOIN filings f ON f.id = ws.filing_id
JOIN witnesses w ON w.id = ws.witness_id;

-- filing membership/order that lived on witness_statements.filing_id/ordinal
-- now goes through filing_documents, role='witness_statement'.
INSERT INTO filing_documents (filing_id, document_id, ordinal, role)
SELECT ws.filing_id, m.new_document_id, ws.ordinal, 'witness_statement'
FROM witness_statements ws
JOIN _ws_migration_map m ON m.witness_statement_id = ws.id;

-- statement_paragraphs re-parented from witness_statement_id to document_id.
ALTER TABLE statement_paragraphs RENAME TO statement_paragraphs_v2;
CREATE TABLE statement_paragraphs (
    id          INTEGER PRIMARY KEY,
    document_id INTEGER NOT NULL REFERENCES documents(id),
    ordinal     INTEGER NOT NULL,
    text        TEXT NOT NULL
);
INSERT INTO statement_paragraphs (id, document_id, ordinal, text)
SELECT sp.id, m.new_document_id, sp.ordinal, sp.text
FROM statement_paragraphs_v2 sp
JOIN _ws_migration_map m ON m.witness_statement_id = sp.witness_statement_id;

-- statement_paragraphs_v2 (old rows still pointing at witness_statements
-- via its original, un-rewritten FK) must drop before witness_statements
-- itself -- same live-FK-on-DROP ordering rule as above.
DROP TABLE statement_paragraphs_v2;
DROP TABLE witness_statements;
DROP TABLE _ws_migration_map;

-- ---------------------------------------------------------------------
-- facts.statement -> facts.postulate (pure rename; source_kind/posture
-- untouched -- out of this hop's scope).
-- ---------------------------------------------------------------------
ALTER TABLE facts RENAME TO facts_v2;
CREATE TABLE facts (
    id            INTEGER PRIMARY KEY,
    proceeding_id INTEGER NOT NULL REFERENCES proceedings(id),
    postulate     TEXT NOT NULL,
    source_kind   TEXT NOT NULL CHECK (source_kind IN ('admitted', 'court_record', 'document', 'witness', 'theorised')),
    posture       TEXT
);
INSERT INTO facts (id, proceeding_id, postulate, source_kind, posture)
SELECT id, proceeding_id, statement, source_kind, posture FROM facts_v2;
-- facts_v2 is NOT dropped yet: evidence_uses/statement_paragraph_facts/
-- filing_facts below still carry their original (auto-rewritten-by-rename)
-- FK pointing at facts_v2 until each is itself rebuilt or dropped -- same
-- live-FK-on-DROP ordering rule as the documents/arguments clusters above.
-- Dropped at the end of this cluster, after filing_facts_v2.

-- ---------------------------------------------------------------------
-- evidence_uses -> statements_of_fact: witness_id NOT NULL (document-only
-- rows dropped -- no v1 reader beyond struck markers); sworn_status ->
-- interviewed; document_id -> exhibit_id (#330, supersedes the ticket
-- body's "document_id dropped" for witness-backed rows); instrument
-- derived from the paragraph link where the same witness authored a
-- statement_paragraph on this fact (best-effort -- no live matter
-- exercises multi-witness ambiguity on this join today).
-- ---------------------------------------------------------------------
ALTER TABLE evidence_uses RENAME TO evidence_uses_v2;
CREATE TABLE statements_of_fact (
    id                 INTEGER PRIMARY KEY,
    proceeding_id      INTEGER NOT NULL REFERENCES proceedings(id),
    fact_id            INTEGER NOT NULL REFERENCES facts(id),
    witness_id         INTEGER NOT NULL REFERENCES witnesses(id),
    instrument         INTEGER REFERENCES documents(id),
    exhibit_id         INTEGER REFERENCES documents(id),
    pinpoint           TEXT,
    interviewed        INTEGER NOT NULL DEFAULT 0 CHECK (interviewed IN (0, 1)),
    admissibility_note TEXT,
    purpose            TEXT,
    disposition        TEXT NOT NULL DEFAULT 'included' CHECK (disposition IN ('included', 'reserved'))
);
INSERT INTO statements_of_fact (id, proceeding_id, fact_id, witness_id, instrument, exhibit_id, pinpoint, interviewed, admissibility_note, purpose, disposition)
SELECT eu.id, eu.proceeding_id, eu.fact_id, eu.witness_id,
       (SELECT sp.document_id
          FROM statement_paragraph_facts spf
          JOIN statement_paragraphs sp ON sp.id = spf.statement_paragraph_id
          JOIN documents doc ON doc.id = sp.document_id
         WHERE spf.fact_id = eu.fact_id AND doc.deponent = eu.witness_id
         LIMIT 1),
       eu.document_id,
       eu.pinpoint,
       CASE WHEN eu.sworn_status = 'none' THEN 0 ELSE 1 END,
       eu.admissibility_note,
       eu.purpose,
       eu.disposition
FROM evidence_uses_v2 eu
WHERE eu.witness_id IS NOT NULL;
DROP TABLE evidence_uses_v2;

-- statement_paragraph_facts -> paragraph_statements_of_fact: a paragraph
-- links to the witness's statement of fact, not the fact (closes the
-- double path -- ticket body). Disambiguate by matching the paragraph's
-- own document (witness) against a surviving statements_of_fact row for
-- the same fact and witness.
CREATE TABLE paragraph_statements_of_fact (
    statement_paragraph_id INTEGER NOT NULL REFERENCES statement_paragraphs(id),
    statement_of_fact_id   INTEGER NOT NULL REFERENCES statements_of_fact(id),
    PRIMARY KEY (statement_paragraph_id, statement_of_fact_id)
);
INSERT INTO paragraph_statements_of_fact (statement_paragraph_id, statement_of_fact_id)
SELECT spf.statement_paragraph_id, sof.id
FROM statement_paragraph_facts spf
JOIN statement_paragraphs sp ON sp.id = spf.statement_paragraph_id
JOIN documents doc ON doc.id = sp.document_id
JOIN statements_of_fact sof ON sof.fact_id = spf.fact_id AND sof.witness_id = doc.deponent
WHERE doc.deponent IS NOT NULL;
DROP TABLE statement_paragraph_facts;

-- ---------------------------------------------------------------------
-- filing_facts.section: drop 'argument'/'statement' (no reader).
-- ---------------------------------------------------------------------
ALTER TABLE filing_facts RENAME TO filing_facts_v2;
CREATE TABLE filing_facts (
    id        INTEGER PRIMARY KEY,
    filing_id INTEGER NOT NULL REFERENCES filings(id),
    fact_id   INTEGER NOT NULL REFERENCES facts(id),
    ordinal   INTEGER NOT NULL,
    section   TEXT NOT NULL CHECK (section IN ('part2'))
);
INSERT INTO filing_facts (id, filing_id, fact_id, ordinal, section)
SELECT id, filing_id, fact_id, ordinal, section FROM filing_facts_v2;
DROP TABLE filing_facts_v2;

-- Now safe: every table that referenced facts_v2 has been rebuilt or
-- dropped (evidence_uses_v2, statement_paragraph_facts, filing_facts_v2).
DROP TABLE facts_v2;

-- ---------------------------------------------------------------------
-- arguments -> submissions (contention, not proposition; proof_text
-- struck -- #323).
-- ---------------------------------------------------------------------
ALTER TABLE arguments RENAME TO arguments_v2;
CREATE TABLE submissions (
    id            INTEGER PRIMARY KEY,
    proceeding_id INTEGER NOT NULL REFERENCES proceedings(id),
    contention    TEXT NOT NULL,
    ordinal       INTEGER NOT NULL,
    disposition   TEXT NOT NULL DEFAULT 'included' CHECK (disposition IN ('included', 'reserved'))
);
INSERT INTO submissions (id, proceeding_id, contention, ordinal, disposition)
SELECT id, proceeding_id, proposition, ordinal, disposition FROM arguments_v2;

-- argument_authorities dissolves (#323): each row's point_of_law becomes a
-- law_assertions row (its own id reused 1:1, the argument_authorities id
-- space being freed by this same hop); a row with authority_id set also
-- gets a statements_of_law row (authority_id + excerpt/pinpoint from its
-- old excerpts row); slot_state='dead_end' moves onto the new proposition.
CREATE TABLE law_assertions (
    id            INTEGER PRIMARY KEY,
    proceeding_id INTEGER NOT NULL REFERENCES proceedings(id),
    proposition   TEXT NOT NULL,
    dead_end      INTEGER NOT NULL DEFAULT 0 CHECK (dead_end IN (0, 1))
);
INSERT INTO law_assertions (id, proceeding_id, proposition, dead_end)
SELECT id, proceeding_id, point_of_law, CASE WHEN slot_state = 'dead_end' THEN 1 ELSE 0 END
FROM argument_authorities;

CREATE TABLE statements_of_law (
    id                INTEGER PRIMARY KEY,
    proceeding_id     INTEGER NOT NULL REFERENCES proceedings(id),
    law_assertion_id  INTEGER NOT NULL REFERENCES law_assertions(id),
    authority_id      INTEGER NOT NULL REFERENCES authorities(id),
    pinpoint          TEXT,
    excerpt           TEXT
);
INSERT INTO statements_of_law (id, proceeding_id, law_assertion_id, authority_id, pinpoint, excerpt)
SELECT aa.id, aa.proceeding_id, aa.id, aa.authority_id, ex.pinpoint, ex.text_verbatim
FROM argument_authorities aa
LEFT JOIN excerpts ex ON ex.id = aa.excerpt_id
WHERE aa.authority_id IS NOT NULL;

CREATE TABLE submission_facts (
    submission_id INTEGER NOT NULL REFERENCES submissions(id),
    fact_id       INTEGER NOT NULL REFERENCES facts(id),
    PRIMARY KEY (submission_id, fact_id)
);

CREATE TABLE submission_law (
    submission_id     INTEGER NOT NULL REFERENCES submissions(id),
    law_assertion_id  INTEGER NOT NULL REFERENCES law_assertions(id),
    PRIMARY KEY (submission_id, law_assertion_id)
);
INSERT INTO submission_law (submission_id, law_assertion_id)
SELECT argument_id, id FROM argument_authorities;

-- filing_arguments -> filing_submissions, and opposing_points' FK rename,
-- both rebuilt *before* dropping arguments_v2/argument_authorities/excerpts
-- below -- same ordering reason as the documents/filing_documents note
-- above: filing_arguments (7 live rows on L8212) has its FK auto-rewritten
-- to arguments_v2 by the RENAME above, and dropping arguments_v2 first
-- fails with FOREIGN KEY constraint failed until filing_arguments no
-- longer points at it.
ALTER TABLE filing_arguments RENAME TO filing_arguments_v2;
CREATE TABLE filing_submissions (
    id            INTEGER PRIMARY KEY,
    filing_id     INTEGER NOT NULL REFERENCES filings(id),
    submission_id INTEGER NOT NULL REFERENCES submissions(id),
    ordinal       INTEGER NOT NULL
);
INSERT INTO filing_submissions (id, filing_id, submission_id, ordinal)
SELECT id, filing_id, argument_id, ordinal FROM filing_arguments_v2;
DROP TABLE filing_arguments_v2;

-- opposing_points.answered_by_argument_id -> answered_by_submission_id.
ALTER TABLE opposing_points RENAME TO opposing_points_v2;
CREATE TABLE opposing_points (
    id                        INTEGER PRIMARY KEY,
    proceeding_id             INTEGER NOT NULL REFERENCES proceedings(id),
    component                 TEXT NOT NULL,
    pinpoint                  TEXT,
    verbatim_words            TEXT,
    answered_by_submission_id INTEGER REFERENCES submissions(id),
    ordinal                   INTEGER NOT NULL
);
INSERT INTO opposing_points (id, proceeding_id, component, pinpoint, verbatim_words, answered_by_submission_id, ordinal)
SELECT id, proceeding_id, component, pinpoint, verbatim_words, answered_by_argument_id, ordinal FROM opposing_points_v2;
DROP TABLE opposing_points_v2;

-- Now safe to drop: filing_arguments/opposing_points no longer reference
-- arguments_v2, and argument_authorities/excerpts have already been fully
-- read into law_assertions/statements_of_law/submission_law above.
DROP TABLE argument_authorities;
DROP TABLE excerpts;
DROP TABLE arguments_v2;

-- relief_items.jurisdiction_excerpt_id drops its dangling REFERENCES
-- excerpts(id) (excerpts is retired above) -- SQLite's FK enforcement
-- resolves every column's declared FK target the moment ANY statement
-- touches that table's own schema, even when the value is NULL, so
-- leaving this pointing at a table that no longer exists breaks every
-- future INSERT into relief_items outright with a misleading "no such
-- table: main.excerpts" (confirmed empirically while drafting this hop --
-- not hypothetical). Column stays, unenforced -- #328 does not settle
-- where a jurisdictional basis link ultimately lives (relief_items ->
-- order_sought is its own open decision, terms-and-symbols.md).
ALTER TABLE relief_items RENAME TO relief_items_v2;
CREATE TABLE relief_items (
    id                      INTEGER PRIMARY KEY,
    proceeding_id           INTEGER NOT NULL REFERENCES proceedings(id),
    wording                 TEXT NOT NULL,
    template_key            TEXT,
    template_values         TEXT, -- JSON text
    alternative_to          INTEGER REFERENCES relief_items(id),
    amount                  REAL,
    disposition             TEXT NOT NULL DEFAULT 'included' CHECK (disposition IN ('included', 'reserved')),
    jurisdiction_excerpt_id INTEGER,
    jurisdiction_slot_state TEXT NOT NULL CHECK (jurisdiction_slot_state IN ('open', 'filled', 'dead_end'))
);
INSERT INTO relief_items (id, proceeding_id, wording, template_key, template_values, alternative_to, amount, disposition, jurisdiction_excerpt_id, jurisdiction_slot_state)
SELECT id, proceeding_id, wording, template_key, template_values, alternative_to, amount, disposition, jurisdiction_excerpt_id, jurisdiction_slot_state
FROM relief_items_v2;

-- filing_relief rebuilt too -- its FK auto-rewrote to relief_items_v2 by
-- the RENAME above (same ordering rule as documents/filing_documents
-- earlier in this hop: a child not itself rebuilt before its parent's old
-- copy is dropped blocks that DROP with a live FOREIGN KEY failure).
ALTER TABLE filing_relief RENAME TO filing_relief_v2;
CREATE TABLE filing_relief (
    id               INTEGER PRIMARY KEY,
    filing_id        INTEGER NOT NULL REFERENCES filings(id),
    relief_item_id   INTEGER NOT NULL REFERENCES relief_items(id),
    ordinal          INTEGER NOT NULL,
    wording_override TEXT
);
INSERT INTO filing_relief (id, filing_id, relief_item_id, ordinal, wording_override)
SELECT id, filing_id, relief_item_id, ordinal, wording_override FROM filing_relief_v2;
DROP TABLE filing_relief_v2;
DROP TABLE relief_items_v2;

-- ---------------------------------------------------------------------
-- Indexes -- drop with their tables automatically; recreate for every
-- renamed/new table's FK columns, mirroring the 1->2 hop's index list.
-- ---------------------------------------------------------------------
CREATE INDEX idx_facts_proceeding ON facts(proceeding_id);
CREATE INDEX idx_relief_items_proceeding ON relief_items(proceeding_id);
CREATE INDEX idx_filing_relief_filing ON filing_relief(filing_id);
CREATE INDEX idx_statements_of_fact_proceeding ON statements_of_fact(proceeding_id);
CREATE INDEX idx_statements_of_fact_fact ON statements_of_fact(fact_id);
CREATE INDEX idx_submissions_proceeding ON submissions(proceeding_id);
CREATE INDEX idx_law_assertions_proceeding ON law_assertions(proceeding_id);
CREATE INDEX idx_statements_of_law_proceeding ON statements_of_law(proceeding_id);
CREATE INDEX idx_statements_of_law_assertion ON statements_of_law(law_assertion_id);
CREATE INDEX idx_statements_of_law_authority ON statements_of_law(authority_id);
CREATE INDEX idx_submission_law_law_assertion ON submission_law(law_assertion_id);
CREATE INDEX idx_submission_facts_fact ON submission_facts(fact_id);
CREATE INDEX idx_opposing_points_proceeding ON opposing_points(proceeding_id);
CREATE INDEX idx_filing_facts_filing ON filing_facts(filing_id);
CREATE INDEX idx_filing_submissions_filing ON filing_submissions(filing_id);
CREATE INDEX idx_filing_documents_filing ON filing_documents(filing_id);
CREATE INDEX idx_statement_paragraphs_document ON statement_paragraphs(document_id);
CREATE INDEX idx_documents_proceeding ON documents(proceeding_id);

UPDATE db_meta SET value = '3' WHERE key = 'schema_version';

-- MIGRATE 3 -> 4
-- Fact-side verbatim excerpt column (issue #321, Fable-reviewed 2026-08-23):
-- completes terms-and-symbols.md's fact tree "excerpt" node (previously
-- "realization open"), mirroring statements_of_law.excerpt so a submission's
-- postulate can carry its own quoted exhibit passage the same way a
-- proposition already carries its quoted authority passage. Additive only --
-- nullable TEXT, no CHECK, no rebuild needed.

ALTER TABLE statements_of_fact ADD COLUMN excerpt TEXT;

UPDATE db_meta SET value = '4' WHERE key = 'schema_version';

-- MIGRATE 4 -> 5
-- Admissions table (issue #339, Fable-reviewed 2026-08-23): the design
-- deliberately deferred by the v3 hop (see the note above at the v2->v3
-- boundary) -- one row per party per method (terms-and-symbols.md tree
-- lines 48-60, "Admissions -- ladder"; ADR-0006). State is derived,
-- never stored: no state/disposition/reserve column. Not rendered in
-- citation order, so no ordinal. Additive only -- new table, no rebuild.

CREATE TABLE admissions (
    id                    INTEGER PRIMARY KEY,
    proceeding_id         INTEGER NOT NULL REFERENCES proceedings(id),
    fact_id               INTEGER NOT NULL REFERENCES facts(id),
    party                 INTEGER NOT NULL REFERENCES parties(id),
    method                TEXT NOT NULL CHECK (method IN ('notice_to_admit', 'pleading', 'interrogatories', 'oral')),
    exhibit               INTEGER REFERENCES documents(id),
    instrument            INTEGER REFERENCES documents(id),
    instrument_pinpoint   TEXT,
    response_due          DATE,
    response              INTEGER REFERENCES documents(id),
    response_pinpoint     TEXT,
    response_excerpt      TEXT,
    answer                TEXT CHECK (answer IN ('agreed', 'denied', 'refused', 'no_knowledge')),
    struck_on             DATE,
    UNIQUE (fact_id, party, method),
    CHECK (answer IS NULL OR response IS NOT NULL)
);

CREATE INDEX idx_admissions_proceeding ON admissions(proceeding_id);
CREATE INDEX idx_admissions_fact ON admissions(fact_id);

UPDATE db_meta SET value = '5' WHERE key = 'schema_version';

-- MIGRATE 5 -> 6
-- documents.served_on (issue #344): the admission instrument's service
-- date -- terms-and-symbols.md Support objects line 106: served_on, date or
-- NULL; NULL while the document is some admissions.instrument renders 🎾
-- (never bare). Drives the ladder's served/unserved split (ADR-0006).
-- Additive only -- nullable DATE, no CHECK, no rebuild.

ALTER TABLE documents ADD COLUMN served_on DATE;

UPDATE db_meta SET value = '6' WHERE key = 'schema_version';

-- MIGRATE 6 -> 7
-- relief_items.jurisdiction_excerpt_id settles onto statements_of_law
-- (issue 348) -- resolves #328's "does not settle" note. statements_of_law
-- .law_assertion_id becomes nullable so a statement can stand alone as a
-- jurisdiction citation (relief_items.jurisdiction_slot_state already
-- carries the open/filled/dead_end state a synthetic law_assertions row
-- would only duplicate); doctrinal statements are unaffected -- every
-- doctrinal reader joins sl.law_assertion_id = la.id, which a NULL never
-- matches. Pre-v7 jurisdiction_excerpt_id values pointed at the excerpts
-- id-space retired by the v2->v3 hop (left unenforced there, see that
-- hop's closing note), so the copy below preserves a value only when it
-- resolves to a same-proceeding statements_of_law row and NULLs the rest
-- rather than tripping the newly enforced FK or silently retargeting.

ALTER TABLE statements_of_law RENAME TO statements_of_law_v6;
CREATE TABLE statements_of_law (
    id                INTEGER PRIMARY KEY,
    proceeding_id     INTEGER NOT NULL REFERENCES proceedings(id),
    law_assertion_id  INTEGER REFERENCES law_assertions(id),
    authority_id      INTEGER NOT NULL REFERENCES authorities(id),
    pinpoint          TEXT,
    excerpt           TEXT
);
INSERT INTO statements_of_law (id, proceeding_id, law_assertion_id, authority_id, pinpoint, excerpt)
SELECT id, proceeding_id, law_assertion_id, authority_id, pinpoint, excerpt FROM statements_of_law_v6;
DROP TABLE statements_of_law_v6;
CREATE INDEX idx_statements_of_law_proceeding ON statements_of_law(proceeding_id);
CREATE INDEX idx_statements_of_law_assertion ON statements_of_law(law_assertion_id);
CREATE INDEX idx_statements_of_law_authority ON statements_of_law(authority_id);

ALTER TABLE relief_items RENAME TO relief_items_v6;
CREATE TABLE relief_items (
    id                      INTEGER PRIMARY KEY,
    proceeding_id           INTEGER NOT NULL REFERENCES proceedings(id),
    wording                 TEXT NOT NULL,
    template_key            TEXT,
    template_values         TEXT, -- JSON text
    alternative_to          INTEGER REFERENCES relief_items(id),
    amount                  REAL,
    disposition             TEXT NOT NULL DEFAULT 'included' CHECK (disposition IN ('included', 'reserved')),
    jurisdiction_excerpt_id INTEGER REFERENCES statements_of_law(id), -- enforced as of this hop (issue 348)
    jurisdiction_slot_state TEXT NOT NULL CHECK (jurisdiction_slot_state IN ('open', 'filled', 'dead_end'))
);
INSERT INTO relief_items (id, proceeding_id, wording, template_key, template_values, alternative_to, amount, disposition, jurisdiction_excerpt_id, jurisdiction_slot_state)
SELECT rv.id, rv.proceeding_id, rv.wording, rv.template_key, rv.template_values, rv.alternative_to, rv.amount, rv.disposition,
       CASE WHEN EXISTS (SELECT 1 FROM statements_of_law sl
                          WHERE sl.id = rv.jurisdiction_excerpt_id
                            AND sl.proceeding_id = rv.proceeding_id)
            THEN rv.jurisdiction_excerpt_id ELSE NULL END,
       rv.jurisdiction_slot_state
FROM relief_items_v6 rv;

-- filing_relief's FK auto-rewrote to relief_items_v6 by the RENAME above --
-- rebuild it BEFORE dropping relief_items_v6, or the DROP fails with a live
-- FOREIGN KEY error (the v2->v3 hop's documented, empirically confirmed
-- ordering rule for this exact pair).
ALTER TABLE filing_relief RENAME TO filing_relief_v6;
CREATE TABLE filing_relief (
    id               INTEGER PRIMARY KEY,
    filing_id        INTEGER NOT NULL REFERENCES filings(id),
    relief_item_id   INTEGER NOT NULL REFERENCES relief_items(id),
    ordinal          INTEGER NOT NULL,
    wording_override TEXT
);
INSERT INTO filing_relief (id, filing_id, relief_item_id, ordinal, wording_override)
SELECT id, filing_id, relief_item_id, ordinal, wording_override FROM filing_relief_v6;
DROP TABLE filing_relief_v6;
DROP TABLE relief_items_v6;

CREATE INDEX idx_relief_items_proceeding ON relief_items(proceeding_id);
CREATE INDEX idx_filing_relief_filing ON filing_relief(filing_id);

UPDATE db_meta SET value = '7' WHERE key = 'schema_version';

-- MIGRATE 7 -> 8
-- Strike facts.source_kind (issue #360, grilled 2026-08-23; applied by
-- #362): all five stored values are derivable or unneeded. 'admitted'
-- retired by the derived per-party ladder (ADR-0006, #345). 'court_record'
-- derives from the new proof link below. 'document'/'witness'/'theorised'
-- were never distinguished by any renderer. Adds facts.court_record
-- (-> documents, the court document that proves the fact -- conclusive
-- against ALL parties, the one non-per-party silence) +
-- court_record_pinpoint, mirroring admissions.instrument/
-- instrument_pinpoint. Existing 'court_record' rows cannot name their
-- proving document: the link starts NULL and no-witness fires until the
-- lawyer links the record -- fail-visible, not silently preserved silence.
--
-- Idiom note: plain ALTERs, NOT a table rebuild. A create-copy-drop-rename
-- fails on a populated database: with the engine's PRAGMA foreign_keys=ON,
-- DROP TABLE runs an implicit DELETE and rows in the four child tables
-- (statements_of_fact, filing_facts, submission_facts, admissions) trip an
-- immediate FOREIGN KEY failure (confirmed empirically against SQLite
-- 3.50.4 -- the fresh-DB test suite cannot catch this, its children are
-- empty at hop time, but a populated matter database would hard-fail).
-- DROP COLUMN removes source_kind's own column CHECK with it, touches no
-- child row, and keeps idx_facts_proceeding; nothing else in the schema
-- references the column. Requires SQLite >= 3.35 (2021).

ALTER TABLE facts ADD COLUMN court_record INTEGER REFERENCES documents(id);
ALTER TABLE facts ADD COLUMN court_record_pinpoint TEXT;
ALTER TABLE facts DROP COLUMN source_kind;

UPDATE db_meta SET value = '8' WHERE key = 'schema_version';

-- MIGRATE 8 -> 9
-- Adds statements_of_law.source (issue #365), the best-authority-source rung
-- backing a doctrinal proposition: 'primary' 🥇 / 'secondary' 🥈 / 'tertiary' 🥉.
-- Nullable: existing rows land unrated (NULL), which the 🥉 predicate reads as
-- "not 🥇/🥈" and so fires 🥉 until the lawyer rates the statement --
-- fail-visible, the same choice the 7->8 hop made for facts.court_record.
--
-- Idiom note: plain ALTER, NOT a table rebuild. statements_of_law is FK-
-- referenced by relief_items.jurisdiction_excerpt_id (since v7), so under the
-- engine's PRAGMA foreign_keys=ON a create-copy-drop-rename hard-fails on any
-- populated matter database (7->8 hop's documented, empirically confirmed
-- rule). ADD COLUMN touches no child row and keeps all three
-- statements_of_law indexes.

ALTER TABLE statements_of_law ADD COLUMN source TEXT CHECK (source IN ('primary', 'secondary', 'tertiary'));

UPDATE db_meta SET value = '9' WHERE key = 'schema_version';

-- MIGRATE 9 -> 10
-- The #380 hop (2026-08-26): realizes #370's per-document pointer model and
-- #372's Form 33 (application response) structures, retires stored
-- disposition (reserve is derived: a pool item deployed by no advocacy
-- document of the filing is held in reserve -- never stored), adds the
-- crossed-out axis and the served_by junction, and lands the settled rename
-- backlog -- one hop, not a dribble (terms-and-symbols.md -> Renames, "v10 hop").
--
-- Ordering discipline: plain ALTERs first; then the rebuild chain, with
-- every child re-pointed (or dropped) before its renamed parent drops --
-- the v2->v3 / v6->v7 documented FK rule; the engine runs
-- PRAGMA foreign_keys=ON.

-- (a) parties: address-for-service filed flag (#372) -- three-state, never
-- a guessed checkbox: 'unknown' renders a question marker on the mockup,
-- nothing on the filed face. Independent of address_for_service itself.
ALTER TABLE parties ADD COLUMN address_for_service_filed TEXT NOT NULL DEFAULT 'unknown' CHECK (address_for_service_filed IN ('yes', 'no', 'unknown'));

-- (b) authorities: tier splits into weight + verification (the third axis,
-- statement-level source, shipped v9/#365). 'doctrinal' maps to
-- persuasive/verified and backfills source='secondary' on its statements
-- still unrated ('doctrinal' collides with the doctrinal-basis marker --
-- terms-and-symbols.md -> Axes of reliability). disposition retired: reserve is
-- derived from deployment, never stored.
ALTER TABLE authorities ADD COLUMN weight TEXT CHECK (weight IN ('binding', 'persuasive'));
ALTER TABLE authorities ADD COLUMN verification TEXT CHECK (verification IN ('verified', 'lead'));
UPDATE authorities SET weight = CASE tier WHEN 'binding' THEN 'binding' WHEN 'persuasive' THEN 'persuasive' WHEN 'doctrinal' THEN 'persuasive' ELSE NULL END;
UPDATE authorities SET verification = CASE WHEN tier IN ('binding', 'persuasive', 'doctrinal') THEN 'verified' WHEN tier = 'unverified' THEN 'lead' ELSE NULL END;
UPDATE statements_of_law SET source = 'secondary'
 WHERE source IS NULL
   AND authority_id IN (SELECT id FROM authorities WHERE tier = 'doctrinal');
ALTER TABLE authorities DROP COLUMN tier;
ALTER TABLE authorities DROP COLUMN disposition;

-- (c) submissions / statements_of_fact: disposition retired. facts.posture
-- moves onto the statement as doubt (the settled rename): a fact's posture
-- is copied to every statement of that fact -- over-marking is fail-visible
-- (the doubt marker renders until the lawyer prunes), silent loss is not; a
-- posture on a statement-less fact has no statement to land on and drops
-- with the column (nothing rendered it at v9 either). The law side gains
-- its mirror doubt column, empty.
ALTER TABLE submissions DROP COLUMN disposition;
ALTER TABLE statements_of_fact ADD COLUMN doubt TEXT;
UPDATE statements_of_fact SET doubt = (SELECT posture FROM facts WHERE facts.id = statements_of_fact.fact_id);
ALTER TABLE statements_of_fact DROP COLUMN disposition;
ALTER TABLE facts DROP COLUMN posture;
ALTER TABLE statements_of_law ADD COLUMN doubt TEXT;

-- (d) gaps.wrapper -> kind (RENAME COLUMN carries the CHECK with it).
ALTER TABLE gaps RENAME COLUMN wrapper TO kind;

-- (e) filings: kind gains 'application_response' (#372) -- a CHECK change,
-- so a rebuild; children re-pointed in (g)-(i) before filings_v9 drops.
ALTER TABLE filings RENAME TO filings_v9;
CREATE TABLE filings (
    id            INTEGER PRIMARY KEY,
    proceeding_id INTEGER NOT NULL REFERENCES proceedings(id),
    kind          TEXT NOT NULL CHECK (kind IN ('submissions_package', 'notice_of_application', 'requisition', 'application_response')),
    subkind       TEXT CHECK (subkind IN ('default_judgment', 'consent')),
    round         TEXT CHECK (round IN ('opening', 'response', 'reply', 'non_participation')),
    title         TEXT NOT NULL
);
INSERT INTO filings (id, proceeding_id, kind, subkind, round, title)
SELECT id, proceeding_id, kind, subkind, round, title FROM filings_v9;

-- (f) relief_items -> order_sought: disposition retired, the jurisdiction
-- pair moves onto the requires edge, crossed_out_on added -- the pursued
-- axis: set = crossed out, the lawyer's own act, restorable by clearing the
-- date; mockup-only strikethrough + derived cascade, never the delivered
-- face (terms-and-symbols.md -> Deployment).
ALTER TABLE relief_items RENAME TO relief_items_v9;
CREATE TABLE order_sought (
    id              INTEGER PRIMARY KEY,
    proceeding_id   INTEGER NOT NULL REFERENCES proceedings(id),
    wording         TEXT NOT NULL,
    template_key    TEXT,
    template_values TEXT, -- JSON text
    alternative_to  INTEGER REFERENCES order_sought(id),
    amount          REAL,
    crossed_out_on  DATE
);
INSERT INTO order_sought (id, proceeding_id, wording, template_key, template_values, alternative_to, amount, crossed_out_on)
SELECT id, proceeding_id, wording, template_key, template_values, alternative_to, amount, NULL FROM relief_items_v9;

-- The requires edge: one row per migrated order carrying the jurisdictional
-- basis ('open' renamed 'needed'); the v7 jurisdiction citation rides along
-- as excerpt_id. law_assertion_id stays NULL for migrated rows -- v7
-- deliberately let a jurisdiction citation stand alone.
CREATE TABLE order_sought_requires (
    id               INTEGER PRIMARY KEY,
    order_sought_id  INTEGER NOT NULL REFERENCES order_sought(id),
    law_assertion_id INTEGER REFERENCES law_assertions(id),
    excerpt_id       INTEGER REFERENCES statements_of_law(id),
    basis_state      TEXT NOT NULL CHECK (basis_state IN ('needed', 'filled', 'dead_end'))
);
INSERT INTO order_sought_requires (order_sought_id, law_assertion_id, excerpt_id, basis_state)
SELECT id, NULL, jurisdiction_excerpt_id,
       CASE jurisdiction_slot_state WHEN 'open' THEN 'needed' ELSE jurisdiction_slot_state END
FROM relief_items_v9;

-- The served_by junction (#380): the petitum's serving submissions. Starts
-- empty -- an unserved order renders the unserved-petitum marker until its
-- submissions are linked, fail-visible as ever.
CREATE TABLE order_sought_served_by (
    order_sought_id INTEGER NOT NULL REFERENCES order_sought(id),
    submission_id   INTEGER NOT NULL REFERENCES submissions(id),
    PRIMARY KEY (order_sought_id, submission_id)
);

-- (g) the pointer tables go per-document (#370): each advocacy document of
-- a filing carries its own ordered pointer list -- membership and paragraph
-- order are one fact. Existing rows deploy on 'form', the filing's delivered
-- face (for a VanIAC submissions package that face is the submissions
-- document itself). The fact pointer's section becomes part and gains
-- 'part4' (#372).
ALTER TABLE filing_facts RENAME TO filing_facts_v9;
CREATE TABLE filing_facts (
    id        INTEGER PRIMARY KEY,
    filing_id INTEGER NOT NULL REFERENCES filings(id),
    fact_id   INTEGER NOT NULL REFERENCES facts(id),
    document  TEXT NOT NULL CHECK (document IN ('form', 'written_argument')),
    part      TEXT NOT NULL CHECK (part IN ('part2', 'part4')),
    ordinal   INTEGER NOT NULL
);
INSERT INTO filing_facts (id, filing_id, fact_id, document, part, ordinal)
SELECT id, filing_id, fact_id, 'form', section, ordinal FROM filing_facts_v9;
DROP TABLE filing_facts_v9;

ALTER TABLE filing_submissions RENAME TO filing_submissions_v9;
CREATE TABLE filing_submissions (
    id            INTEGER PRIMARY KEY,
    filing_id     INTEGER NOT NULL REFERENCES filings(id),
    submission_id INTEGER NOT NULL REFERENCES submissions(id),
    document      TEXT NOT NULL CHECK (document IN ('form', 'written_argument')),
    ordinal       INTEGER NOT NULL
);
INSERT INTO filing_submissions (id, filing_id, submission_id, document, ordinal)
SELECT id, filing_id, submission_id, 'form', ordinal FROM filing_submissions_v9;
DROP TABLE filing_submissions_v9;

-- filing_relief -> filing_orders (the order pointer list; wording_override
-- kept -- the delivered wording of a templated order).
CREATE TABLE filing_orders (
    id               INTEGER PRIMARY KEY,
    filing_id        INTEGER NOT NULL REFERENCES filings(id),
    order_sought_id  INTEGER NOT NULL REFERENCES order_sought(id),
    document         TEXT NOT NULL CHECK (document IN ('form', 'written_argument')),
    ordinal          INTEGER NOT NULL,
    wording_override TEXT
);
INSERT INTO filing_orders (id, filing_id, order_sought_id, document, ordinal, wording_override)
SELECT id, filing_id, relief_item_id, 'form', ordinal, wording_override FROM filing_relief;
DROP TABLE filing_relief;

-- relief_items_v9 carries a self-referential alternative_to FK; NULL it
-- before the drop so the implicit row DELETE cannot trip the immediate
-- self-FK on a populated chain (the fresh-DB suite cannot catch this --
-- same class of hazard the 7->8 hop documented).
UPDATE relief_items_v9 SET alternative_to = NULL;
DROP TABLE relief_items_v9;

-- (h) filing_documents gains the Part 6 provenance value (#372) -- the
-- pointer's own words, per filing: served with this application response vs
-- already in the court file; NULL where the form has no such Part
-- (documents.served_on is a date on the document, not this marker). The
-- rebuild also re-points its filings FK.
ALTER TABLE filing_documents RENAME TO filing_documents_v9;
CREATE TABLE filing_documents (
    id          INTEGER PRIMARY KEY,
    filing_id   INTEGER NOT NULL REFERENCES filings(id),
    document_id INTEGER NOT NULL REFERENCES documents(id),
    ordinal     INTEGER NOT NULL,
    role        TEXT NOT NULL CHECK (role IN ('affidavit', 'pleading', 'order', 'evidence', 'other', 'witness_statement')),
    provenance  TEXT CHECK (provenance IN ('served_with_this_response', 'already_in_court_file'))
);
INSERT INTO filing_documents (id, filing_id, document_id, ordinal, role, provenance)
SELECT id, filing_id, document_id, ordinal, role, NULL FROM filing_documents_v9;
DROP TABLE filing_documents_v9;

-- (i) hearing_details: straight copy to re-point the filings FK.
ALTER TABLE hearing_details RENAME TO hearing_details_v9;
CREATE TABLE hearing_details (
    id                    INTEGER PRIMARY KEY,
    filing_id             INTEGER NOT NULL UNIQUE REFERENCES filings(id),
    hearing_date          DATE,
    hearing_time          TEXT,
    time_estimate_minutes INTEGER,
    associate_judge       INTEGER NOT NULL DEFAULT 0 CHECK (associate_judge IN (0, 1))
);
INSERT INTO hearing_details (id, filing_id, hearing_date, hearing_time, time_estimate_minutes, associate_judge)
SELECT id, filing_id, hearing_date, hearing_time, time_estimate_minutes, associate_judge FROM hearing_details_v9;
DROP TABLE hearing_details_v9;

DROP TABLE filings_v9;

-- (j) #372's sought-orders pool and position pointers: the applicant's
-- Part 1 orders verbatim, one row each, anchored to the served notice's
-- documents row (which also supplies the "THIS IS A RESPONSE TO ..." date);
-- the Form 33 pointer carries the position -- Part placement and payload
-- are one fact (Parts 1/2/3 = consented/opposed/no_position), proposed
-- terms only on a consented pointer, one position per order per filing; no
-- ordinal -- orders render in the served notice's own paragraph order.
CREATE TABLE opposing_orders (
    id               INTEGER PRIMARY KEY,
    proceeding_id    INTEGER NOT NULL REFERENCES proceedings(id),
    document_id      INTEGER NOT NULL REFERENCES documents(id),
    paragraph_number INTEGER NOT NULL,
    wording          TEXT NOT NULL,
    UNIQUE (document_id, paragraph_number)
);

CREATE TABLE filing_positions (
    id                INTEGER PRIMARY KEY,
    filing_id         INTEGER NOT NULL REFERENCES filings(id),
    opposing_order_id INTEGER NOT NULL REFERENCES opposing_orders(id),
    position          TEXT NOT NULL CHECK (position IN ('consented', 'opposed', 'no_position')),
    proposed_terms    TEXT,
    UNIQUE (filing_id, opposing_order_id),
    CHECK (proposed_terms IS NULL OR position = 'consented')
);

-- (k) indexes for everything rebuilt or new (a table rename keeps its
-- indexes, which then die with the _v9 drop).
CREATE INDEX idx_filings_proceeding ON filings(proceeding_id);
CREATE INDEX idx_filing_facts_filing ON filing_facts(filing_id);
CREATE INDEX idx_filing_submissions_filing ON filing_submissions(filing_id);
CREATE INDEX idx_filing_documents_filing ON filing_documents(filing_id);
CREATE INDEX idx_order_sought_proceeding ON order_sought(proceeding_id);
CREATE INDEX idx_order_sought_requires_order ON order_sought_requires(order_sought_id);
CREATE INDEX idx_order_sought_served_by_submission ON order_sought_served_by(submission_id);
CREATE INDEX idx_filing_orders_filing ON filing_orders(filing_id);
CREATE INDEX idx_opposing_orders_proceeding ON opposing_orders(proceeding_id);
CREATE INDEX idx_filing_positions_filing ON filing_positions(filing_id);

UPDATE db_meta SET value = '10' WHERE key = 'schema_version';

-- MIGRATE 10 -> 11
-- Adverse-fact and anticipated-point tracking (#390, carving out approved
-- scope from #373 Candidate 3). Purely additive -- no rebuild chain needed.
--
-- (a) facts: adverse is a stored boolean at the assertion level, the same
-- level as the derived reserve posture -- a fact's adverseness doesn't
-- depend on which statement proves it. Practitioner-set, never derived.
ALTER TABLE facts ADD COLUMN adverse INTEGER CHECK (adverse IN (0, 1));

-- (b) anticipated_points: deliberately separate from opposing_points, not a
-- flag on it. opposing_points holds something the other side has actually
-- raised in a served document (pinpoint + verbatim_words presuppose a real
-- source, and an unanswered row fires the rebuttal-needed marker);
-- anticipated_points holds the practitioner's own prediction of what the
-- other side might argue, before they've said it -- no real document to
-- pin or quote, and no rebuttal-needed marker (awareness alone is the
-- point, per #373's approved scope). Minimal shape: no pinpoint, no
-- verbatim_words, no answered_by link, no ordinal -- this material is
-- never deployed onto any document's pointer list (Counsel Brief only,
-- terms-and-symbols.md -> Deployment), so it needs none of the fields that
-- exist to support that. When a prediction materializes as a real,
-- served point, the practitioner records it as an opposing_points row and
-- deletes the spent anticipated_points row (work-markers.md seams,
-- 🚩 vs ↩️) -- no link kept, ordinary CRUD.
CREATE TABLE anticipated_points (
    id            INTEGER PRIMARY KEY,
    proceeding_id INTEGER NOT NULL REFERENCES proceedings(id),
    point         TEXT NOT NULL
);

CREATE INDEX idx_anticipated_points_proceeding ON anticipated_points(proceeding_id);

UPDATE db_meta SET value = '11' WHERE key = 'schema_version';

-- MIGRATE 11 -> 12
-- BCCA chambers-application response (#436, research #433): a third forum
-- value 'bcca' on proceedings and a sixth filing kind 'bcca_stay_response'
-- (the respondents' R. 21(1)(a) response book -- no prescribed form exists;
-- content per the registrar's completion instructions). Both are CHECK
-- widenings only -- no new columns, no data change. SQLite cannot ALTER a
-- CHECK, so each table is rebuilt create-copy-drop-rename with foreign_keys
-- OFF for the hop: the old table is dropped (never renamed), so child
-- tables' textual "REFERENCES proceedings(id)" / "REFERENCES filings(id)"
-- clauses are left untouched and re-bind to the rebuilt tables by name --
-- no child rebuild chain needed (unlike the v10 hop, which renamed).
PRAGMA foreign_keys = OFF;

CREATE TABLE proceedings_v12 (
    id                  INTEGER PRIMARY KEY,
    matter_reference    TEXT NOT NULL,
    forum               TEXT NOT NULL CHECK (forum IN ('bcsc', 'vaniac', 'bcca')),
    court_or_centre     TEXT,
    registry            TEXT,
    file_number         TEXT,
    style_of_cause      TEXT,
    courthouse_address  TEXT,
    rule_24h_consent    INTEGER NOT NULL DEFAULT 0 CHECK (rule_24h_consent IN (0, 1))
);
INSERT INTO proceedings_v12 (id, matter_reference, forum, court_or_centre, registry, file_number, style_of_cause, courthouse_address, rule_24h_consent)
SELECT id, matter_reference, forum, court_or_centre, registry, file_number, style_of_cause, courthouse_address, rule_24h_consent FROM proceedings;
DROP TABLE proceedings;
ALTER TABLE proceedings_v12 RENAME TO proceedings;

CREATE TABLE filings_v12 (
    id            INTEGER PRIMARY KEY,
    proceeding_id INTEGER NOT NULL REFERENCES proceedings(id),
    kind          TEXT NOT NULL CHECK (kind IN ('submissions_package', 'notice_of_application', 'requisition', 'application_response', 'bcca_stay_response')),
    subkind       TEXT CHECK (subkind IN ('default_judgment', 'consent')),
    round         TEXT CHECK (round IN ('opening', 'response', 'reply', 'non_participation')),
    title         TEXT NOT NULL
);
INSERT INTO filings_v12 (id, proceeding_id, kind, subkind, round, title)
SELECT id, proceeding_id, kind, subkind, round, title FROM filings;
DROP TABLE filings;
ALTER TABLE filings_v12 RENAME TO filings;
CREATE INDEX idx_filings_proceeding ON filings(proceeding_id);

PRAGMA foreign_keys = ON;

UPDATE db_meta SET value = '12' WHERE key = 'schema_version';

-- MIGRATE 12 -> 13
-- BCCA response-book compliance completion (renderer fix following #436):
-- the outer cover page's "ON APPEAL FROM" line and access-restriction notes,
-- the cover page's counsel contact table, and the Part 3 table-of-authorities
-- exclusion rule (e-CI §1.2: "not already referenced in the application
-- book") all need data the schema had nowhere to hold. Purely additive --
-- nullable columns and one new table, no CHECK widening, no rebuild chain.
--
-- (a) proceedings: the cover template's "ON APPEAL FROM the order of [judge]
-- of the [court] pronounced on [date]" line is a 1:1 property of the appeal
-- proceeding, not of any one filing -- same reasoning as rule_24h_consent's
-- existing forum-specific column. access_restrictions holds a practitioner-
-- composed verbatim sealing-order/publication-ban line (or several,
-- newline-separated) for the cover page; NULL when none apply, per the
-- template's own "remove placeholder if none" instruction.
ALTER TABLE proceedings ADD COLUMN under_appeal_judge TEXT;
ALTER TABLE proceedings ADD COLUMN under_appeal_court TEXT;
ALTER TABLE proceedings ADD COLUMN under_appeal_pronounced DATE;
ALTER TABLE proceedings ADD COLUMN access_restrictions TEXT;

-- (b) parties: the book cover's two-column contact table needs firm/phone/
-- email alongside the existing counsel_name and address_for_service.
ALTER TABLE parties ADD COLUMN counsel_firm TEXT;
ALTER TABLE parties ADD COLUMN counsel_phone TEXT;
ALTER TABLE parties ADD COLUMN counsel_email TEXT;

-- (c) opposing_authorities: the e-CI §1.2 Part 3 exclusion is a DELTA --
-- "including new cases...that have not been referenced in the application
-- book" -- so the renderer needs to know what the opposing party's own
-- filed application book cites. Same seam as opposing_orders (#372/#386):
-- a verbatim transcription of one page of a served document, anchored to
-- the documents row for that book, human-confirmed at capture time. The
-- delta is computed by authority_id equality (nullable link to our own
-- authorities row), never fuzzy citation matching -- a row with no
-- authority_id match is still correctly recorded (an opposing-only
-- authority), it just never participates in the exclusion. Deliberately
-- not a column on authorities: an authority cited by both sides would need
-- a three-state flag, and an opposing-only entry would pollute the
-- verification/treatment workflow that column carries for our own
-- authorities.
CREATE TABLE opposing_authorities (
    id                      INTEGER PRIMARY KEY,
    proceeding_id           INTEGER NOT NULL REFERENCES proceedings(id),
    document_id             INTEGER NOT NULL REFERENCES documents(id),
    ordinal                 INTEGER NOT NULL,
    style_of_cause_or_title TEXT NOT NULL,
    citation                TEXT,
    authority_id            INTEGER REFERENCES authorities(id),
    UNIQUE (document_id, ordinal)
);

CREATE INDEX idx_opposing_authorities_proceeding ON opposing_authorities(proceeding_id);

UPDATE db_meta SET value = '13' WHERE key = 'schema_version';

-- MIGRATE 13 -> 14
-- BCCA response-book Word assembly (/assemble-submission, assemble-
-- response-book subskill): the outer cover page's BETWEEN/AND party blocks
-- each carry a bracketed lower-court role line -- "(Plaintiffs)",
-- "(Defendants)" -- per the Style of Proceedings practice directive
-- (bcca-response-book-form.md §§5, 10). components.ts's bccaCoverPage
-- already accepts and renders this via lowerCourtRoleByRole, keyed by the
-- appeal-role group; nothing populated it until now. One party per row,
-- because every party sharing an appeal role is not guaranteed to share a
-- lower-court role (bcca-response-book-form.md §5's split-block case) --
-- the renderer groups by (appeal role, lower_court_role) pair, not by
-- appeal role alone. NULL for non-BCCA proceedings and for any BCCA party
-- not yet elicited; renders nothing for that party's group rather than a
-- guessed value (bccaCoverPage's existing omit-if-absent behaviour).
ALTER TABLE parties ADD COLUMN lower_court_role TEXT;

UPDATE db_meta SET value = '14' WHERE key = 'schema_version';

-- MIGRATE 14 -> 15
-- Ticket-driven /draft-submission sessions (design doc
-- Engineering/1. Design/2026-09-02_draft-submission-ticket-sessions-design.md,
-- ADR 0009): stored, rendered process state -- rendered by the new Work
-- Board mockup, never on any advocacy document. Amends this skill's
-- SKILL.md "Not stored, deliberately... review state of any kind" and
-- ADR 0004's #300 "nothing unrendered" note (the Work Board satisfies it).
-- Purely additive -- no CHECK widening, no rebuild chain, no PRAGMA
-- bracket. Every write to these six tables is EXEMPT from the
-- db_meta.revision bump (filing-checklists.md §8) -- otherwise every claim
-- or step tick would archive the mockups; a substance write made under a
-- ticket still bumps revision as usual.
--
-- (a) tickets: one unit of session work. filing_id NULL means proceeding-
-- scoped. Invariants held as table CHECKs rather than app logic: wip status
-- requires a lock and vice versa; superseded requires superseded_by and
-- vice versa; completed requires completed_at and vice versa; a 'work'
-- ticket always carries its billing_anchor (the live-issue test derives
-- it -- never asked when it can be inferred); a plan and its approval
-- timestamp travel together. Cycle detection over ticket_blocks is a
-- renderer/skill concern, not a CHECK.
CREATE TABLE tickets (
    id               INTEGER PRIMARY KEY,
    proceeding_id    INTEGER NOT NULL REFERENCES proceedings(id),
    filing_id        INTEGER REFERENCES filings(id),
    title            TEXT NOT NULL,
    intent           TEXT NOT NULL,
    status           TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'wip', 'completed', 'superseded')),
    priority         INTEGER NOT NULL DEFAULT 0,
    kind             TEXT NOT NULL CHECK (kind IN ('work', 'charting')),
    billing_anchor   TEXT,
    locked_by        TEXT,
    locked_at        TEXT,
    plan             TEXT,
    plan_approved_at TEXT,
    created          TEXT NOT NULL,
    completed_at     TEXT,
    superseded_by    INTEGER REFERENCES tickets(id),
    CHECK ((status = 'wip') = (locked_by IS NOT NULL)),
    CHECK ((locked_by IS NULL) = (locked_at IS NULL)),
    CHECK ((status = 'superseded') = (superseded_by IS NOT NULL)),
    CHECK ((status = 'completed') = (completed_at IS NOT NULL)),
    CHECK (kind <> 'work' OR billing_anchor IS NOT NULL),
    CHECK ((plan IS NULL) = (plan_approved_at IS NULL)),
    CHECK (superseded_by IS NULL OR superseded_by <> id)
);
CREATE INDEX idx_tickets_proceeding ON tickets(proceeding_id);
CREATE INDEX idx_tickets_filing ON tickets(filing_id);

-- (b) ticket_steps: the approved plan's legal work steps; done_at is the
-- progress write-back a successor session inherits.
CREATE TABLE ticket_steps (
    ticket_id INTEGER NOT NULL REFERENCES tickets(id),
    ordinal   INTEGER NOT NULL,
    text      TEXT NOT NULL,
    done_at   TEXT,
    PRIMARY KEY (ticket_id, ordinal)
);

-- (c) ticket_scope: entity = table name; entity_id NULL means the whole
-- table within this ticket's filing/proceeding (what a row-creating ticket
-- needs). Enforcement of what a write may touch is skill-side
-- (references/jobs.md), not a database constraint.
CREATE TABLE ticket_scope (
    id        INTEGER PRIMARY KEY,
    ticket_id INTEGER NOT NULL REFERENCES tickets(id),
    entity    TEXT NOT NULL,
    entity_id INTEGER
);
CREATE INDEX idx_ticket_scope_ticket ON ticket_scope(ticket_id);

-- (d) ticket_blocks: blocker_id must complete before blocked_id is ripe.
-- Pure link table, no id column.
CREATE TABLE ticket_blocks (
    blocker_id INTEGER NOT NULL REFERENCES tickets(id),
    blocked_id INTEGER NOT NULL REFERENCES tickets(id),
    PRIMARY KEY (blocker_id, blocked_id),
    CHECK (blocker_id <> blocked_id)
);

-- (e) ticket_conflicts: mutually exclusive tickets, canonical order
-- (a_id < b_id) so a symmetric check queries with OR.
CREATE TABLE ticket_conflicts (
    a_id INTEGER NOT NULL REFERENCES tickets(id),
    b_id INTEGER NOT NULL REFERENCES tickets(id),
    PRIMARY KEY (a_id, b_id),
    CHECK (a_id < b_id)
);

-- (f) seeds: an idea captured without deciding -- verbatim, <=5 sentences,
-- no options or recommendations (references/jobs.md enforces the
-- capture discipline; nothing here can). Never ripe, never a blocker;
-- consumed by a charting session that sets charted_into. Column named
-- surfaced_by rather than the design doc's "trigger" -- TRIGGER is an
-- SQLite keyword, and while it parses (quoted or not, SQLite's grammar
-- accepts it as an identifier here), it is needless friction for SQL
-- composed at write time.
CREATE TABLE seeds (
    id               INTEGER PRIMARY KEY,
    proceeding_id    INTEGER NOT NULL REFERENCES proceedings(id),
    filing_id        INTEGER REFERENCES filings(id),
    origin_ticket_id INTEGER REFERENCES tickets(id),
    created          TEXT NOT NULL,
    surfaced_by      TEXT NOT NULL,
    idea             TEXT NOT NULL,
    charted_into     INTEGER REFERENCES tickets(id)
);
CREATE INDEX idx_seeds_proceeding ON seeds(proceeding_id);

UPDATE db_meta SET value = '15' WHERE key = 'schema_version';

-- MIGRATE 15 -> 16
-- Dropped axis (practitioner + Fable review, 2026-09-06; terms-and-symbols.md ->
-- Deployment, "Dropped"): a submission or an authority the practitioner
-- reviewed and rejected, kept intact -- wording, excerpts, statements of law
-- -- so no later drafting or research session regenerates or re-proposes it.
-- Not a reversal of the v9->v10 hop's "reserve is derived, never stored":
-- reserve (deployed by no document => held in reserve) stays derived and
-- still says nothing about WHY an item is undeployed; dropped_on records the
-- one case where the answer is "rejected". Same idiom as
-- order_sought.crossed_out_on and documents.served_on: a DATE, set = the act
-- happened and when, NULL = not, restorable by clearing. Not a boolean
-- (loses the date), not a verification value (a verified authority can be
-- dropped -- reliability and rejection are different axes), never a row
-- delete (the content is the breadcrumb). Scope: these two tables only --
-- no fact-side twin and no statement-level drop until a journey names a
-- reader (terms-and-symbols.md's own "Breaks" convention).
--
-- Rendering contract (render-vaniac-submissions.ts, render-companions.ts,
-- render-form32-filed-face.ts, render-form33-filed-face.ts,
-- render-bcca-stay-response.ts): a dropped submission renders on no
-- deployed face and carries no reserve marker -- the write that drops it
-- deletes its filing_submissions rows in the same script
-- (filing-checklists.md), and every venue renderer filters
-- dropped_on IS NULL as the deterministic-test backstop (ADR 0004); a
-- dropped authority's statements of law ride the brief-only cap exactly as
-- verification='lead' does. Both surface only in the Counsel Brief's
-- Dropped sections. No marker (work-markers.md rule 5, as crossed out).
-- Purely additive -- no CHECK change, no rebuild chain.

ALTER TABLE submissions ADD COLUMN dropped_on DATE;
ALTER TABLE authorities ADD COLUMN dropped_on DATE;

UPDATE db_meta SET value = '16' WHERE key = 'schema_version';

-- MIGRATE 16 -> 17
-- Filing lifecycle (2026-09-08 design, "retire a filing"): the six states a
-- filing passes through -- drafting -> filed -> heard -> decided -> appeal
-- expired -> retired -- and the reason a retirement happened. Three dates,
-- same idiom as v16's dropped_on and order_sought.crossed_out_on: a DATE,
-- set = the act happened and when, NULL = it has not, cleared to undo
-- (recovery clears retired_on and retirement_reason together). "Retire",
-- never "archive" -- archive already names the renderer's revision-archive
-- copies.
--
-- Only three of the six states are stored. "Heard" derives from the
-- existing hearing_details.hearing_date (one-to-one with the filing) against
-- today, NULL-guarded -- VanIAC and requisition filings may never set one.
-- "Appeal expired" derives from the proceeding's appeal deadline, which is
-- supplied per render call by the caller from /dates-and-deadlines and is
-- NEVER stored here: deadlines are on this skill's "not stored,
-- deliberately" list. "Drafting" is the absence of all of them. The
-- derivation itself lives in the renderer (forms/lifecycle.ts) and is
-- documented in filing-checklists.md section 11.
--
-- retirement_reason's closed set covers terminal retirement (appeal expired
-- or exhausted) and the early retirements the practitioner may instruct
-- (settled, abandoned, adjourned generally, other). Nullable: a filing that
-- has not been retired has no reason, and recovery clears it.
ALTER TABLE filings ADD COLUMN filed_on DATE;
ALTER TABLE filings ADD COLUMN decided_on DATE;
ALTER TABLE filings ADD COLUMN retired_on DATE;
ALTER TABLE filings ADD COLUMN retirement_reason TEXT CHECK (retirement_reason IN ('appeal_expired', 'appeal_exhausted', 'settled', 'abandoned', 'adjourned_generally', 'other'));

-- Retiring a filing supersedes its own open queued tickets (jobs.md
-- section 9a), and nothing supersedes them -- the retirement does, and a
-- retirement is not a ticket. The v15 CHECK made supersession without a
-- superseding ticket impossible ((status = 'superseded') = (superseded_by IS
-- NOT NULL)), so it relaxes to one direction only: a superseded_by pointer
-- still implies status = 'superseded', but a superseded ticket may now have
-- none. SQLite cannot ALTER a CHECK, so the table is rebuilt
-- create-copy-drop-rename with foreign_keys OFF for the hop, exactly as the
-- v12 hop rebuilt proceedings/filings: the old table is DROPPED (never
-- renamed), so the child tables' textual "REFERENCES tickets(id)" clauses
-- are left untouched and re-bind to the rebuilt table by name -- no child
-- rebuild chain. Every other CHECK, column, default and index is carried
-- over unchanged.
PRAGMA foreign_keys = OFF;

CREATE TABLE tickets_v17 (
    id               INTEGER PRIMARY KEY,
    proceeding_id    INTEGER NOT NULL REFERENCES proceedings(id),
    filing_id        INTEGER REFERENCES filings(id),
    title            TEXT NOT NULL,
    intent           TEXT NOT NULL,
    status           TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'wip', 'completed', 'superseded')),
    priority         INTEGER NOT NULL DEFAULT 0,
    kind             TEXT NOT NULL CHECK (kind IN ('work', 'charting')),
    billing_anchor   TEXT,
    locked_by        TEXT,
    locked_at        TEXT,
    plan             TEXT,
    plan_approved_at TEXT,
    created          TEXT NOT NULL,
    completed_at     TEXT,
    superseded_by    INTEGER REFERENCES tickets(id),
    CHECK ((status = 'wip') = (locked_by IS NOT NULL)),
    CHECK ((locked_by IS NULL) = (locked_at IS NULL)),
    CHECK (superseded_by IS NULL OR status = 'superseded'),
    CHECK ((status = 'completed') = (completed_at IS NOT NULL)),
    CHECK (kind <> 'work' OR billing_anchor IS NOT NULL),
    CHECK ((plan IS NULL) = (plan_approved_at IS NULL)),
    CHECK (superseded_by IS NULL OR superseded_by <> id)
);
INSERT INTO tickets_v17 (id, proceeding_id, filing_id, title, intent, status, priority, kind, billing_anchor, locked_by, locked_at, plan, plan_approved_at, created, completed_at, superseded_by)
SELECT id, proceeding_id, filing_id, title, intent, status, priority, kind, billing_anchor, locked_by, locked_at, plan, plan_approved_at, created, completed_at, superseded_by FROM tickets;
DROP TABLE tickets;
ALTER TABLE tickets_v17 RENAME TO tickets;
CREATE INDEX idx_tickets_proceeding ON tickets(proceeding_id);
CREATE INDEX idx_tickets_filing ON tickets(filing_id);

PRAGMA foreign_keys = ON;

UPDATE db_meta SET value = '17' WHERE key = 'schema_version';

-- MIGRATE 17 -> 18
-- 'decided' joins retirement_reason's closed set (practitioner decision,
-- 2026-09-10). The v17 set split retirement into terminal (appeal_expired,
-- appeal_exhausted) and early (settled, abandoned, adjourned_generally,
-- other), so retiring a decided filing meant first proving appeal rights
-- were exhausted. The practitioner judged that an appeal of a BCCA
-- single-justice interlocutory refusal is the exception, not the rule: a
-- filing may be retired once decided, without that proof. 'decided' is
-- therefore deliberately NOT a synonym for 'appeal_exhausted' -- it records
-- that no exhaustion finding was made.
--
-- Recovery is unchanged and must stay so: the idiom in
-- filing-checklists.md section 11 --
--   UPDATE filings SET retired_on = NULL, retirement_reason = NULL WHERE id = ?;
-- -- takes a 'decided' filing out of retirement exactly as it does any other
-- reason, so the filing can resume if an appeal is in fact pursued. Nothing
-- in forms/lifecycle.ts reads the reason (it derives state from the three
-- dates alone), and no special-casing is added here or there.
--
-- SQLite cannot ALTER a CHECK, so filings is rebuilt create-copy-drop-rename
-- with foreign_keys OFF for the hop, exactly as the v16->v17 hop rebuilt
-- tickets: the old table is DROPPED (never renamed), so the child tables'
-- textual "REFERENCES filings(id)" clauses (filing_facts, filing_submissions,
-- filing_orders, filing_documents, hearing_details, filing_positions, seeds,
-- tickets) are left untouched and re-bind to the rebuilt table by name -- no
-- child rebuild chain. Every other column, CHECK, default and the
-- idx_filings_proceeding index is carried over unchanged.
PRAGMA foreign_keys = OFF;

CREATE TABLE filings_v18 (
    id                INTEGER PRIMARY KEY,
    proceeding_id     INTEGER NOT NULL REFERENCES proceedings(id),
    kind              TEXT NOT NULL CHECK (kind IN ('submissions_package', 'notice_of_application', 'requisition', 'application_response', 'bcca_stay_response')),
    subkind           TEXT CHECK (subkind IN ('default_judgment', 'consent')),
    round             TEXT CHECK (round IN ('opening', 'response', 'reply', 'non_participation')),
    title             TEXT NOT NULL,
    filed_on          DATE,
    decided_on        DATE,
    retired_on        DATE,
    retirement_reason TEXT CHECK (retirement_reason IN ('appeal_expired', 'appeal_exhausted', 'decided', 'settled', 'abandoned', 'adjourned_generally', 'other'))
);
INSERT INTO filings_v18 (id, proceeding_id, kind, subkind, round, title, filed_on, decided_on, retired_on, retirement_reason)
SELECT id, proceeding_id, kind, subkind, round, title, filed_on, decided_on, retired_on, retirement_reason FROM filings;
DROP TABLE filings;
ALTER TABLE filings_v18 RENAME TO filings;
CREATE INDEX idx_filings_proceeding ON filings(proceeding_id);

PRAGMA foreign_keys = ON;

UPDATE db_meta SET value = '18' WHERE key = 'schema_version';

-- MIGRATE 18 -> 19
-- "Entered" joins the filing lifecycle between Decided and Appeal period
-- expired (practitioner decision, 2026-09-10): the date a BCCA order is
-- formally entered with the registry, distinct from the date it was decided
-- (pronounced). One column, additive -- no CHECK, no rebuild.
--
-- Ordering is fixed in forms/lifecycle.ts, not here: Appeal period expired
-- must still win whenever the caller-supplied appeal deadline has passed,
-- entered or not -- BCCA appeal time runs from pronouncement, not entry.
-- Entered is neither a precondition for retirement nor a terminal state:
-- filings.retired_on may be set with or without entered_on ever having been
-- set, exactly as decided_on already works. retirement_reason's closed set
-- is unchanged by this hop.
ALTER TABLE filings ADD COLUMN entered_on DATE;

UPDATE db_meta SET value = '19' WHERE key = 'schema_version';

-- MIGRATE 19 -> 20
-- hearing_details.associate_judge gains "not yet determined" (#451,
-- practitioner decision 2026-09-13): NULL, now the default. The old NOT NULL
-- DEFAULT 0 made 0 both "not within an associate judge's jurisdiction" and
-- the value the filing checklist told drafters to leave when undecided, so a
-- stored 0 cannot be told apart from a deferral -- every 0 becomes NULL and
-- the practitioner confirms each one; 1 stays 1. Applies to every filing
-- kind: only the Notice of Application reads the column.
--
-- A NOT NULL/DEFAULT change needs a rebuild. Rename-then-create (the v9 -> v10
-- idiom) keeps the stored CREATE statement unquoted; nothing references
-- hearing_details, so the rename rewrites no other table.
ALTER TABLE hearing_details RENAME TO hearing_details_v19;
CREATE TABLE hearing_details (
    id                    INTEGER PRIMARY KEY,
    filing_id             INTEGER NOT NULL UNIQUE REFERENCES filings(id),
    hearing_date          DATE,
    hearing_time          TEXT,
    time_estimate_minutes INTEGER,
    associate_judge       INTEGER CHECK (associate_judge IN (0, 1)) -- NULL = not yet determined (#451)
);
INSERT INTO hearing_details (id, filing_id, hearing_date, hearing_time, time_estimate_minutes, associate_judge)
SELECT id, filing_id, hearing_date, hearing_time, time_estimate_minutes, NULLIF(associate_judge, 0) FROM hearing_details_v19;
DROP TABLE hearing_details_v19;

UPDATE db_meta SET value = '20' WHERE key = 'schema_version';

-- MIGRATE 20 -> 21
-- db_meta.revision moves in the database itself, not by skill-text convention
-- (#607, decided in #581 question 1 option (b)). Until now every substantive
-- execute script was told to end with the bump by filing-checklists.md 8; the
-- 2026-09-14 E2E report (Finding 4.6) found 3 of 4 substance scripts omitting
-- it, and render memoisation (#582) turns a missed bump from a lost archive
-- copy into a stale review surface.
--
-- Three triggers per table -- rev_<table>_ins|upd|del -- on every table except
-- db_meta itself and the six ticket tables exempted by schema v15 / ADR 0009
-- (tickets, ticket_steps, ticket_scope, ticket_blocks, ticket_conflicts,
-- seeds): bumping on a ticket claim or a step tick would archive every mockup
-- in the filing on session bookkeeping the practitioner never asked to review.
-- db_meta carries no trigger, so the bump cannot recurse (and SQLite's
-- recursive_triggers is off by default in any case).
--
-- Revision now advances by ROW, not by script: a two-row INSERT moves it twice.
-- Only equality is ever compared (forms.ts archives a mockup when its stamped
-- revision differs from the current one), so this changes archive names only.
--
-- FOR A FUTURE HOP THAT REBUILDS A TABLE (the rename-then-create idiom used by
-- 9 -> 10 and 19 -> 20): SQLite carries a table's triggers through
-- ALTER TABLE RENAME and drops them with DROP TABLE, so the new table has
-- none. Recreate its three triggers in the same hop, AFTER dropping the
-- renamed original -- until then the old trigger names are still taken.
-- tests/test_migrate_engine.py's TestV21RevisionTriggers fails if you forget.

CREATE TRIGGER rev_parties_ins AFTER INSERT ON parties BEGIN UPDATE db_meta SET value = CAST(value AS INTEGER) + 1 WHERE key = 'revision'; END;
CREATE TRIGGER rev_parties_upd AFTER UPDATE ON parties BEGIN UPDATE db_meta SET value = CAST(value AS INTEGER) + 1 WHERE key = 'revision'; END;
CREATE TRIGGER rev_parties_del AFTER DELETE ON parties BEGIN UPDATE db_meta SET value = CAST(value AS INTEGER) + 1 WHERE key = 'revision'; END;
CREATE TRIGGER rev_witnesses_ins AFTER INSERT ON witnesses BEGIN UPDATE db_meta SET value = CAST(value AS INTEGER) + 1 WHERE key = 'revision'; END;
CREATE TRIGGER rev_witnesses_upd AFTER UPDATE ON witnesses BEGIN UPDATE db_meta SET value = CAST(value AS INTEGER) + 1 WHERE key = 'revision'; END;
CREATE TRIGGER rev_witnesses_del AFTER DELETE ON witnesses BEGIN UPDATE db_meta SET value = CAST(value AS INTEGER) + 1 WHERE key = 'revision'; END;
CREATE TRIGGER rev_authorities_ins AFTER INSERT ON authorities BEGIN UPDATE db_meta SET value = CAST(value AS INTEGER) + 1 WHERE key = 'revision'; END;
CREATE TRIGGER rev_authorities_upd AFTER UPDATE ON authorities BEGIN UPDATE db_meta SET value = CAST(value AS INTEGER) + 1 WHERE key = 'revision'; END;
CREATE TRIGGER rev_authorities_del AFTER DELETE ON authorities BEGIN UPDATE db_meta SET value = CAST(value AS INTEGER) + 1 WHERE key = 'revision'; END;
CREATE TRIGGER rev_gaps_ins AFTER INSERT ON gaps BEGIN UPDATE db_meta SET value = CAST(value AS INTEGER) + 1 WHERE key = 'revision'; END;
CREATE TRIGGER rev_gaps_upd AFTER UPDATE ON gaps BEGIN UPDATE db_meta SET value = CAST(value AS INTEGER) + 1 WHERE key = 'revision'; END;
CREATE TRIGGER rev_gaps_del AFTER DELETE ON gaps BEGIN UPDATE db_meta SET value = CAST(value AS INTEGER) + 1 WHERE key = 'revision'; END;
CREATE TRIGGER rev_documents_ins AFTER INSERT ON documents BEGIN UPDATE db_meta SET value = CAST(value AS INTEGER) + 1 WHERE key = 'revision'; END;
CREATE TRIGGER rev_documents_upd AFTER UPDATE ON documents BEGIN UPDATE db_meta SET value = CAST(value AS INTEGER) + 1 WHERE key = 'revision'; END;
CREATE TRIGGER rev_documents_del AFTER DELETE ON documents BEGIN UPDATE db_meta SET value = CAST(value AS INTEGER) + 1 WHERE key = 'revision'; END;
CREATE TRIGGER rev_statement_paragraphs_ins AFTER INSERT ON statement_paragraphs BEGIN UPDATE db_meta SET value = CAST(value AS INTEGER) + 1 WHERE key = 'revision'; END;
CREATE TRIGGER rev_statement_paragraphs_upd AFTER UPDATE ON statement_paragraphs BEGIN UPDATE db_meta SET value = CAST(value AS INTEGER) + 1 WHERE key = 'revision'; END;
CREATE TRIGGER rev_statement_paragraphs_del AFTER DELETE ON statement_paragraphs BEGIN UPDATE db_meta SET value = CAST(value AS INTEGER) + 1 WHERE key = 'revision'; END;
CREATE TRIGGER rev_facts_ins AFTER INSERT ON facts BEGIN UPDATE db_meta SET value = CAST(value AS INTEGER) + 1 WHERE key = 'revision'; END;
CREATE TRIGGER rev_facts_upd AFTER UPDATE ON facts BEGIN UPDATE db_meta SET value = CAST(value AS INTEGER) + 1 WHERE key = 'revision'; END;
CREATE TRIGGER rev_facts_del AFTER DELETE ON facts BEGIN UPDATE db_meta SET value = CAST(value AS INTEGER) + 1 WHERE key = 'revision'; END;
CREATE TRIGGER rev_statements_of_fact_ins AFTER INSERT ON statements_of_fact BEGIN UPDATE db_meta SET value = CAST(value AS INTEGER) + 1 WHERE key = 'revision'; END;
CREATE TRIGGER rev_statements_of_fact_upd AFTER UPDATE ON statements_of_fact BEGIN UPDATE db_meta SET value = CAST(value AS INTEGER) + 1 WHERE key = 'revision'; END;
CREATE TRIGGER rev_statements_of_fact_del AFTER DELETE ON statements_of_fact BEGIN UPDATE db_meta SET value = CAST(value AS INTEGER) + 1 WHERE key = 'revision'; END;
CREATE TRIGGER rev_paragraph_statements_of_fact_ins AFTER INSERT ON paragraph_statements_of_fact BEGIN UPDATE db_meta SET value = CAST(value AS INTEGER) + 1 WHERE key = 'revision'; END;
CREATE TRIGGER rev_paragraph_statements_of_fact_upd AFTER UPDATE ON paragraph_statements_of_fact BEGIN UPDATE db_meta SET value = CAST(value AS INTEGER) + 1 WHERE key = 'revision'; END;
CREATE TRIGGER rev_paragraph_statements_of_fact_del AFTER DELETE ON paragraph_statements_of_fact BEGIN UPDATE db_meta SET value = CAST(value AS INTEGER) + 1 WHERE key = 'revision'; END;
CREATE TRIGGER rev_submissions_ins AFTER INSERT ON submissions BEGIN UPDATE db_meta SET value = CAST(value AS INTEGER) + 1 WHERE key = 'revision'; END;
CREATE TRIGGER rev_submissions_upd AFTER UPDATE ON submissions BEGIN UPDATE db_meta SET value = CAST(value AS INTEGER) + 1 WHERE key = 'revision'; END;
CREATE TRIGGER rev_submissions_del AFTER DELETE ON submissions BEGIN UPDATE db_meta SET value = CAST(value AS INTEGER) + 1 WHERE key = 'revision'; END;
CREATE TRIGGER rev_law_assertions_ins AFTER INSERT ON law_assertions BEGIN UPDATE db_meta SET value = CAST(value AS INTEGER) + 1 WHERE key = 'revision'; END;
CREATE TRIGGER rev_law_assertions_upd AFTER UPDATE ON law_assertions BEGIN UPDATE db_meta SET value = CAST(value AS INTEGER) + 1 WHERE key = 'revision'; END;
CREATE TRIGGER rev_law_assertions_del AFTER DELETE ON law_assertions BEGIN UPDATE db_meta SET value = CAST(value AS INTEGER) + 1 WHERE key = 'revision'; END;
CREATE TRIGGER rev_submission_facts_ins AFTER INSERT ON submission_facts BEGIN UPDATE db_meta SET value = CAST(value AS INTEGER) + 1 WHERE key = 'revision'; END;
CREATE TRIGGER rev_submission_facts_upd AFTER UPDATE ON submission_facts BEGIN UPDATE db_meta SET value = CAST(value AS INTEGER) + 1 WHERE key = 'revision'; END;
CREATE TRIGGER rev_submission_facts_del AFTER DELETE ON submission_facts BEGIN UPDATE db_meta SET value = CAST(value AS INTEGER) + 1 WHERE key = 'revision'; END;
CREATE TRIGGER rev_submission_law_ins AFTER INSERT ON submission_law BEGIN UPDATE db_meta SET value = CAST(value AS INTEGER) + 1 WHERE key = 'revision'; END;
CREATE TRIGGER rev_submission_law_upd AFTER UPDATE ON submission_law BEGIN UPDATE db_meta SET value = CAST(value AS INTEGER) + 1 WHERE key = 'revision'; END;
CREATE TRIGGER rev_submission_law_del AFTER DELETE ON submission_law BEGIN UPDATE db_meta SET value = CAST(value AS INTEGER) + 1 WHERE key = 'revision'; END;
CREATE TRIGGER rev_opposing_points_ins AFTER INSERT ON opposing_points BEGIN UPDATE db_meta SET value = CAST(value AS INTEGER) + 1 WHERE key = 'revision'; END;
CREATE TRIGGER rev_opposing_points_upd AFTER UPDATE ON opposing_points BEGIN UPDATE db_meta SET value = CAST(value AS INTEGER) + 1 WHERE key = 'revision'; END;
CREATE TRIGGER rev_opposing_points_del AFTER DELETE ON opposing_points BEGIN UPDATE db_meta SET value = CAST(value AS INTEGER) + 1 WHERE key = 'revision'; END;
CREATE TRIGGER rev_admissions_ins AFTER INSERT ON admissions BEGIN UPDATE db_meta SET value = CAST(value AS INTEGER) + 1 WHERE key = 'revision'; END;
CREATE TRIGGER rev_admissions_upd AFTER UPDATE ON admissions BEGIN UPDATE db_meta SET value = CAST(value AS INTEGER) + 1 WHERE key = 'revision'; END;
CREATE TRIGGER rev_admissions_del AFTER DELETE ON admissions BEGIN UPDATE db_meta SET value = CAST(value AS INTEGER) + 1 WHERE key = 'revision'; END;
CREATE TRIGGER rev_statements_of_law_ins AFTER INSERT ON statements_of_law BEGIN UPDATE db_meta SET value = CAST(value AS INTEGER) + 1 WHERE key = 'revision'; END;
CREATE TRIGGER rev_statements_of_law_upd AFTER UPDATE ON statements_of_law BEGIN UPDATE db_meta SET value = CAST(value AS INTEGER) + 1 WHERE key = 'revision'; END;
CREATE TRIGGER rev_statements_of_law_del AFTER DELETE ON statements_of_law BEGIN UPDATE db_meta SET value = CAST(value AS INTEGER) + 1 WHERE key = 'revision'; END;
CREATE TRIGGER rev_order_sought_ins AFTER INSERT ON order_sought BEGIN UPDATE db_meta SET value = CAST(value AS INTEGER) + 1 WHERE key = 'revision'; END;
CREATE TRIGGER rev_order_sought_upd AFTER UPDATE ON order_sought BEGIN UPDATE db_meta SET value = CAST(value AS INTEGER) + 1 WHERE key = 'revision'; END;
CREATE TRIGGER rev_order_sought_del AFTER DELETE ON order_sought BEGIN UPDATE db_meta SET value = CAST(value AS INTEGER) + 1 WHERE key = 'revision'; END;
CREATE TRIGGER rev_order_sought_requires_ins AFTER INSERT ON order_sought_requires BEGIN UPDATE db_meta SET value = CAST(value AS INTEGER) + 1 WHERE key = 'revision'; END;
CREATE TRIGGER rev_order_sought_requires_upd AFTER UPDATE ON order_sought_requires BEGIN UPDATE db_meta SET value = CAST(value AS INTEGER) + 1 WHERE key = 'revision'; END;
CREATE TRIGGER rev_order_sought_requires_del AFTER DELETE ON order_sought_requires BEGIN UPDATE db_meta SET value = CAST(value AS INTEGER) + 1 WHERE key = 'revision'; END;
CREATE TRIGGER rev_order_sought_served_by_ins AFTER INSERT ON order_sought_served_by BEGIN UPDATE db_meta SET value = CAST(value AS INTEGER) + 1 WHERE key = 'revision'; END;
CREATE TRIGGER rev_order_sought_served_by_upd AFTER UPDATE ON order_sought_served_by BEGIN UPDATE db_meta SET value = CAST(value AS INTEGER) + 1 WHERE key = 'revision'; END;
CREATE TRIGGER rev_order_sought_served_by_del AFTER DELETE ON order_sought_served_by BEGIN UPDATE db_meta SET value = CAST(value AS INTEGER) + 1 WHERE key = 'revision'; END;
CREATE TRIGGER rev_filing_facts_ins AFTER INSERT ON filing_facts BEGIN UPDATE db_meta SET value = CAST(value AS INTEGER) + 1 WHERE key = 'revision'; END;
CREATE TRIGGER rev_filing_facts_upd AFTER UPDATE ON filing_facts BEGIN UPDATE db_meta SET value = CAST(value AS INTEGER) + 1 WHERE key = 'revision'; END;
CREATE TRIGGER rev_filing_facts_del AFTER DELETE ON filing_facts BEGIN UPDATE db_meta SET value = CAST(value AS INTEGER) + 1 WHERE key = 'revision'; END;
CREATE TRIGGER rev_filing_submissions_ins AFTER INSERT ON filing_submissions BEGIN UPDATE db_meta SET value = CAST(value AS INTEGER) + 1 WHERE key = 'revision'; END;
CREATE TRIGGER rev_filing_submissions_upd AFTER UPDATE ON filing_submissions BEGIN UPDATE db_meta SET value = CAST(value AS INTEGER) + 1 WHERE key = 'revision'; END;
CREATE TRIGGER rev_filing_submissions_del AFTER DELETE ON filing_submissions BEGIN UPDATE db_meta SET value = CAST(value AS INTEGER) + 1 WHERE key = 'revision'; END;
CREATE TRIGGER rev_filing_orders_ins AFTER INSERT ON filing_orders BEGIN UPDATE db_meta SET value = CAST(value AS INTEGER) + 1 WHERE key = 'revision'; END;
CREATE TRIGGER rev_filing_orders_upd AFTER UPDATE ON filing_orders BEGIN UPDATE db_meta SET value = CAST(value AS INTEGER) + 1 WHERE key = 'revision'; END;
CREATE TRIGGER rev_filing_orders_del AFTER DELETE ON filing_orders BEGIN UPDATE db_meta SET value = CAST(value AS INTEGER) + 1 WHERE key = 'revision'; END;
CREATE TRIGGER rev_filing_documents_ins AFTER INSERT ON filing_documents BEGIN UPDATE db_meta SET value = CAST(value AS INTEGER) + 1 WHERE key = 'revision'; END;
CREATE TRIGGER rev_filing_documents_upd AFTER UPDATE ON filing_documents BEGIN UPDATE db_meta SET value = CAST(value AS INTEGER) + 1 WHERE key = 'revision'; END;
CREATE TRIGGER rev_filing_documents_del AFTER DELETE ON filing_documents BEGIN UPDATE db_meta SET value = CAST(value AS INTEGER) + 1 WHERE key = 'revision'; END;
CREATE TRIGGER rev_opposing_orders_ins AFTER INSERT ON opposing_orders BEGIN UPDATE db_meta SET value = CAST(value AS INTEGER) + 1 WHERE key = 'revision'; END;
CREATE TRIGGER rev_opposing_orders_upd AFTER UPDATE ON opposing_orders BEGIN UPDATE db_meta SET value = CAST(value AS INTEGER) + 1 WHERE key = 'revision'; END;
CREATE TRIGGER rev_opposing_orders_del AFTER DELETE ON opposing_orders BEGIN UPDATE db_meta SET value = CAST(value AS INTEGER) + 1 WHERE key = 'revision'; END;
CREATE TRIGGER rev_filing_positions_ins AFTER INSERT ON filing_positions BEGIN UPDATE db_meta SET value = CAST(value AS INTEGER) + 1 WHERE key = 'revision'; END;
CREATE TRIGGER rev_filing_positions_upd AFTER UPDATE ON filing_positions BEGIN UPDATE db_meta SET value = CAST(value AS INTEGER) + 1 WHERE key = 'revision'; END;
CREATE TRIGGER rev_filing_positions_del AFTER DELETE ON filing_positions BEGIN UPDATE db_meta SET value = CAST(value AS INTEGER) + 1 WHERE key = 'revision'; END;
CREATE TRIGGER rev_anticipated_points_ins AFTER INSERT ON anticipated_points BEGIN UPDATE db_meta SET value = CAST(value AS INTEGER) + 1 WHERE key = 'revision'; END;
CREATE TRIGGER rev_anticipated_points_upd AFTER UPDATE ON anticipated_points BEGIN UPDATE db_meta SET value = CAST(value AS INTEGER) + 1 WHERE key = 'revision'; END;
CREATE TRIGGER rev_anticipated_points_del AFTER DELETE ON anticipated_points BEGIN UPDATE db_meta SET value = CAST(value AS INTEGER) + 1 WHERE key = 'revision'; END;
CREATE TRIGGER rev_proceedings_ins AFTER INSERT ON proceedings BEGIN UPDATE db_meta SET value = CAST(value AS INTEGER) + 1 WHERE key = 'revision'; END;
CREATE TRIGGER rev_proceedings_upd AFTER UPDATE ON proceedings BEGIN UPDATE db_meta SET value = CAST(value AS INTEGER) + 1 WHERE key = 'revision'; END;
CREATE TRIGGER rev_proceedings_del AFTER DELETE ON proceedings BEGIN UPDATE db_meta SET value = CAST(value AS INTEGER) + 1 WHERE key = 'revision'; END;
CREATE TRIGGER rev_opposing_authorities_ins AFTER INSERT ON opposing_authorities BEGIN UPDATE db_meta SET value = CAST(value AS INTEGER) + 1 WHERE key = 'revision'; END;
CREATE TRIGGER rev_opposing_authorities_upd AFTER UPDATE ON opposing_authorities BEGIN UPDATE db_meta SET value = CAST(value AS INTEGER) + 1 WHERE key = 'revision'; END;
CREATE TRIGGER rev_opposing_authorities_del AFTER DELETE ON opposing_authorities BEGIN UPDATE db_meta SET value = CAST(value AS INTEGER) + 1 WHERE key = 'revision'; END;
CREATE TRIGGER rev_filings_ins AFTER INSERT ON filings BEGIN UPDATE db_meta SET value = CAST(value AS INTEGER) + 1 WHERE key = 'revision'; END;
CREATE TRIGGER rev_filings_upd AFTER UPDATE ON filings BEGIN UPDATE db_meta SET value = CAST(value AS INTEGER) + 1 WHERE key = 'revision'; END;
CREATE TRIGGER rev_filings_del AFTER DELETE ON filings BEGIN UPDATE db_meta SET value = CAST(value AS INTEGER) + 1 WHERE key = 'revision'; END;
CREATE TRIGGER rev_hearing_details_ins AFTER INSERT ON hearing_details BEGIN UPDATE db_meta SET value = CAST(value AS INTEGER) + 1 WHERE key = 'revision'; END;
CREATE TRIGGER rev_hearing_details_upd AFTER UPDATE ON hearing_details BEGIN UPDATE db_meta SET value = CAST(value AS INTEGER) + 1 WHERE key = 'revision'; END;
CREATE TRIGGER rev_hearing_details_del AFTER DELETE ON hearing_details BEGIN UPDATE db_meta SET value = CAST(value AS INTEGER) + 1 WHERE key = 'revision'; END;

UPDATE db_meta SET value = '21' WHERE key = 'schema_version';

-- MIGRATE 21 -> 22
-- BC Court of Appeal respondent's factum (#648; ownership #438, part contents
-- #647): a seventh filing kind 'bcca_factum', plus two filing-scoped tables
-- for the factum parts no existing table holds --
--   filing_chronology: the Chronology part's Date / Event rows;
--   filing_prose: one free-text block per (filing, slot) -- the unnumbered
--     Opening Statement, Part 1's position on the appellants' statement of
--     facts, and Part 4's place of signing.
-- Part 1's other facts reuse filing_facts (part='part2' is the per-kind slot
-- label, as for bcca_stay_response), Part 2 reuses opposing_points, Part 3
-- the submissions chain, Part 4 order_sought/filing_orders -- no change.
--
-- filings is rebuilt create-copy-drop-rename exactly as the 17 -> 18 hop did
-- (SQLite cannot ALTER a CHECK), carrying v19's entered_on. DROP TABLE takes
-- the v21 revision triggers with it, so rev_filings_* are recreated below,
-- after the drop, per the 20 -> 21 hop's warning.
PRAGMA foreign_keys = OFF;

CREATE TABLE filings_v22 (
    id                INTEGER PRIMARY KEY,
    proceeding_id     INTEGER NOT NULL REFERENCES proceedings(id),
    kind              TEXT NOT NULL CHECK (kind IN ('submissions_package', 'notice_of_application', 'requisition', 'application_response', 'bcca_stay_response', 'bcca_factum')),
    subkind           TEXT CHECK (subkind IN ('default_judgment', 'consent')),
    round             TEXT CHECK (round IN ('opening', 'response', 'reply', 'non_participation')),
    title             TEXT NOT NULL,
    filed_on          DATE,
    decided_on        DATE,
    retired_on        DATE,
    retirement_reason TEXT CHECK (retirement_reason IN ('appeal_expired', 'appeal_exhausted', 'decided', 'settled', 'abandoned', 'adjourned_generally', 'other')),
    entered_on        DATE
);
INSERT INTO filings_v22 (id, proceeding_id, kind, subkind, round, title, filed_on, decided_on, retired_on, retirement_reason, entered_on)
SELECT id, proceeding_id, kind, subkind, round, title, filed_on, decided_on, retired_on, retirement_reason, entered_on FROM filings;
DROP TABLE filings;
ALTER TABLE filings_v22 RENAME TO filings;
CREATE INDEX idx_filings_proceeding ON filings(proceeding_id);

PRAGMA foreign_keys = ON;

CREATE TRIGGER rev_filings_ins AFTER INSERT ON filings BEGIN UPDATE db_meta SET value = CAST(value AS INTEGER) + 1 WHERE key = 'revision'; END;
CREATE TRIGGER rev_filings_upd AFTER UPDATE ON filings BEGIN UPDATE db_meta SET value = CAST(value AS INTEGER) + 1 WHERE key = 'revision'; END;
CREATE TRIGGER rev_filings_del AFTER DELETE ON filings BEGIN UPDATE db_meta SET value = CAST(value AS INTEGER) + 1 WHERE key = 'revision'; END;

CREATE TABLE filing_chronology (
    id         INTEGER PRIMARY KEY,
    filing_id  INTEGER NOT NULL REFERENCES filings(id),
    event_date DATE NOT NULL,
    event      TEXT NOT NULL,
    ordinal    INTEGER NOT NULL
);
CREATE INDEX idx_filing_chronology_filing ON filing_chronology(filing_id);

CREATE TABLE filing_prose (
    id        INTEGER PRIMARY KEY,
    filing_id INTEGER NOT NULL REFERENCES filings(id),
    slot      TEXT NOT NULL CHECK (slot IN ('opening_statement', 'facts_position', 'signing_place')),
    text      TEXT NOT NULL,
    UNIQUE (filing_id, slot)
);

CREATE TRIGGER rev_filing_chronology_ins AFTER INSERT ON filing_chronology BEGIN UPDATE db_meta SET value = CAST(value AS INTEGER) + 1 WHERE key = 'revision'; END;
CREATE TRIGGER rev_filing_chronology_upd AFTER UPDATE ON filing_chronology BEGIN UPDATE db_meta SET value = CAST(value AS INTEGER) + 1 WHERE key = 'revision'; END;
CREATE TRIGGER rev_filing_chronology_del AFTER DELETE ON filing_chronology BEGIN UPDATE db_meta SET value = CAST(value AS INTEGER) + 1 WHERE key = 'revision'; END;
CREATE TRIGGER rev_filing_prose_ins AFTER INSERT ON filing_prose BEGIN UPDATE db_meta SET value = CAST(value AS INTEGER) + 1 WHERE key = 'revision'; END;
CREATE TRIGGER rev_filing_prose_upd AFTER UPDATE ON filing_prose BEGIN UPDATE db_meta SET value = CAST(value AS INTEGER) + 1 WHERE key = 'revision'; END;
CREATE TRIGGER rev_filing_prose_del AFTER DELETE ON filing_prose BEGIN UPDATE db_meta SET value = CAST(value AS INTEGER) + 1 WHERE key = 'revision'; END;

UPDATE db_meta SET value = '22' WHERE key = 'schema_version';

-- MIGRATE 22 -> 23
-- Pre-filing proceedings (#692, ADR 0018): a proceeding may exist before its
-- forum is chosen, so a pre-litigation effort can hold tickets and seeds --
-- choosing the forum can itself be the ticket. "Not yet chosen" is NULL, never
-- a sentinel value (the 19 -> 20 hop's reasoning). The guard sits at the
-- filing: no filing may sit on a proceeding whose forum is NULL, so every
-- forum-reading renderer, which runs only inside a filing's render, never
-- meets one. Three guards hold it: a filing inserted on, or moved onto, such
-- a proceeding, and a forum cleared while the proceeding has a filing.
--
-- proceedings is rebuilt create-copy-drop-rename exactly as the 11 -> 12 hop
-- did (SQLite cannot drop a NOT NULL), carrying v13's four columns. DROP TABLE
-- takes the rev_proceedings_* triggers with it, so they are recreated below.
PRAGMA foreign_keys = OFF;

CREATE TABLE proceedings_v23 (
    id                      INTEGER PRIMARY KEY,
    matter_reference        TEXT NOT NULL,
    forum                   TEXT CHECK (forum IN ('bcsc', 'vaniac', 'bcca')),
    court_or_centre         TEXT,
    registry                TEXT,
    file_number             TEXT,
    style_of_cause          TEXT,
    courthouse_address      TEXT,
    rule_24h_consent        INTEGER NOT NULL DEFAULT 0 CHECK (rule_24h_consent IN (0, 1)),
    under_appeal_judge      TEXT,
    under_appeal_court      TEXT,
    under_appeal_pronounced DATE,
    access_restrictions     TEXT
);
INSERT INTO proceedings_v23 (id, matter_reference, forum, court_or_centre, registry, file_number, style_of_cause, courthouse_address, rule_24h_consent, under_appeal_judge, under_appeal_court, under_appeal_pronounced, access_restrictions)
SELECT id, matter_reference, forum, court_or_centre, registry, file_number, style_of_cause, courthouse_address, rule_24h_consent, under_appeal_judge, under_appeal_court, under_appeal_pronounced, access_restrictions FROM proceedings;
DROP TABLE proceedings;
ALTER TABLE proceedings_v23 RENAME TO proceedings;

PRAGMA foreign_keys = ON;

CREATE TRIGGER rev_proceedings_ins AFTER INSERT ON proceedings BEGIN UPDATE db_meta SET value = CAST(value AS INTEGER) + 1 WHERE key = 'revision'; END;
CREATE TRIGGER rev_proceedings_upd AFTER UPDATE ON proceedings BEGIN UPDATE db_meta SET value = CAST(value AS INTEGER) + 1 WHERE key = 'revision'; END;
CREATE TRIGGER rev_proceedings_del AFTER DELETE ON proceedings BEGIN UPDATE db_meta SET value = CAST(value AS INTEGER) + 1 WHERE key = 'revision'; END;

CREATE TRIGGER guard_filings_need_forum_ins BEFORE INSERT ON filings
WHEN (SELECT forum FROM proceedings WHERE id = NEW.proceeding_id) IS NULL
 AND EXISTS (SELECT 1 FROM proceedings WHERE id = NEW.proceeding_id)
BEGIN SELECT RAISE(ABORT, 'no filing until the proceeding''s forum is chosen (ADR 0018)'); END;
CREATE TRIGGER guard_filings_need_forum_upd BEFORE UPDATE OF proceeding_id ON filings
WHEN (SELECT forum FROM proceedings WHERE id = NEW.proceeding_id) IS NULL
 AND EXISTS (SELECT 1 FROM proceedings WHERE id = NEW.proceeding_id)
BEGIN SELECT RAISE(ABORT, 'no filing until the proceeding''s forum is chosen (ADR 0018)'); END;
CREATE TRIGGER guard_proceedings_keep_forum BEFORE UPDATE OF forum ON proceedings
WHEN NEW.forum IS NULL AND EXISTS (SELECT 1 FROM filings WHERE proceeding_id = NEW.id)
BEGIN SELECT RAISE(ABORT, 'the forum cannot be cleared while the proceeding has a filing (ADR 0018)'); END;

UPDATE db_meta SET value = '23' WHERE key = 'schema_version';

-- MIGRATE 23 -> 24
-- Exhibit numbering runs across the proceeding, not the filing (#712). A
-- document keeps one Ex. N for the proceeding's life: the number is its
-- position in one proceeding-wide ordered list, derived at render time and
-- never stored. Both forums impose nothing here -- the VanIAC Rules never say
-- "exhibit", and Supreme Court Civil Rules 22-2 and 8-1 read complete contain
-- no provision on exhibit labelling across rounds -- so this is the firm's own
-- convention, settled on #712.
--
-- Deriving alone would let a later edit to an earlier round shift an
-- already-filed round's numbers away from the served paper. Rather than store
-- the number and copy it on filing (there is no hook: filed_on is set by hand
-- SQL, and nothing in code observes the transition), the freeze is structural:
-- a filed filing's exhibit links cannot change. With those rows fixed, every
-- filed document's position in the list is fixed, while a draft's numbers
-- follow its ordinal freely.
--
-- This also makes "renaming, renumbering or re-rendering filings already
-- filed" impossible rather than merely out of scope. Clearing a filed_on set
-- in error is an UPDATE on filings, which these guards do not touch, so
-- recovery stays available.
CREATE TRIGGER guard_filing_documents_filed_ins BEFORE INSERT ON filing_documents
WHEN (SELECT filed_on FROM filings WHERE id = NEW.filing_id) IS NOT NULL
BEGIN SELECT RAISE(ABORT, 'a filed filing''s exhibits do not change (#712)'); END;
CREATE TRIGGER guard_filing_documents_filed_upd BEFORE UPDATE ON filing_documents
WHEN (SELECT filed_on FROM filings WHERE id = OLD.filing_id) IS NOT NULL
   OR (SELECT filed_on FROM filings WHERE id = NEW.filing_id) IS NOT NULL
BEGIN SELECT RAISE(ABORT, 'a filed filing''s exhibits do not change (#712)'); END;
CREATE TRIGGER guard_filing_documents_filed_del BEFORE DELETE ON filing_documents
WHEN (SELECT filed_on FROM filings WHERE id = OLD.filing_id) IS NOT NULL
BEGIN SELECT RAISE(ABORT, 'a filed filing''s exhibits do not change (#712)'); END;

UPDATE db_meta SET value = '24' WHERE key = 'schema_version';

-- MIGRATE 24 -> 25
-- Work Board Proposals, Phase A (Engineering/1. Design/2026-09-15_work-board-
-- proposals-design.md sections 3, 9 and 10; Engineering/2. Plan/2026-09-15_work-
-- board-proposals-implementation-plan.md Phase A). Four changes:
--
-- 1. verification moves from authorities to statements_of_law (design 3). An
--    authority is a lead when none of its statements is verified, so the value
--    belongs on the statement. The new column is NOT NULL with no default: a
--    nullable column would give the proposition-line 🔬 ("none verified") a
--    third state the statement-line 🔬 ("only 'lead'") does not read, and every
--    insert must now say which it is rather than drifting in as a lead. Each
--    existing statement takes COALESCE(its authority's verification, 'lead') --
--    an authority never marked verified becomes a brief-only lead until a
--    research-lawyer return supports marking a statement verified, the
--    fail-visible choice the v9 🥉 hop set.
--    The session that runs this hop lists every statement it defaulted from
--    NULL, for the practitioner to sort (submission-data/SKILL.md, Current
--    version). statements_of_law is rebuilt create-copy-drop-rename (SQLite
--    cannot ADD a NOT NULL column without a default), so its three revision
--    triggers and its three indexes are recreated below, after the drop, per
--    the 20 -> 21 hop's warning. authorities.verification then goes by
--    DROP COLUMN -- nothing else in the schema names it, so no rebuild, and
--    rev_authorities_* survive untouched.
--
-- 2. statements_of_fact.exhibit_excerpt and exhibit_pinpoint (design 3): the
--    excerpt and pinpoint markers split by basis, so a statement proved through
--    an exhibit needs its own locator and quote. The hop moves no value -- the
--    existing pinpoint stays the instrument's locator, and the session lists
--    every row with exhibit_id set so the practitioner can sort which locator
--    each stored pinpoint held.
--
-- 3. tickets.rejected_at (design 10) and tickets.superseded_marker_gone_at
--    (Engineering/2. Plan/2026-09-21_goal-card-and-prepare-implementation-plan.md,
--    Decisions made for this plan, item 1 -- folded into this hop so that plan's
--    Phase 1 needs no rebuild). Both nullable, no CHECK: rejected_at sits
--    outside the tickets CHECKs deliberately, so the claim guard
--    (AND rejected_at IS NULL) is the only barrier (design 10).
--
-- 4. ticket_proposals and proposal_rejections (design 9 and 10), the seventh and
--    eighth ticket tables. NEITHER CARRIES REVISION TRIGGERS, and neither ever
--    gains any: a conversion, rejection or restore is session bookkeeping, and a
--    write confined to the ticket tables must never bump db_meta.revision
--    and archive a mockup. tests/test_migrate_engine.py's TestV21RevisionTriggers
--    exempts them by name. ticket_proposals.item carries the count-free item
--    text the Goal card reads, NOT NULL from the start (same fold as 3).
PRAGMA foreign_keys = OFF;

CREATE TABLE statements_of_law_v25 (
    id                INTEGER PRIMARY KEY,
    proceeding_id     INTEGER NOT NULL REFERENCES proceedings(id),
    law_assertion_id  INTEGER REFERENCES law_assertions(id),
    authority_id      INTEGER NOT NULL REFERENCES authorities(id),
    pinpoint          TEXT,
    excerpt           TEXT,
    source            TEXT CHECK (source IN ('primary', 'secondary', 'tertiary')),
    doubt             TEXT,
    verification      TEXT NOT NULL CHECK (verification IN ('verified', 'lead'))
);
INSERT INTO statements_of_law_v25 (id, proceeding_id, law_assertion_id, authority_id, pinpoint, excerpt, source, doubt, verification)
SELECT sl.id, sl.proceeding_id, sl.law_assertion_id, sl.authority_id, sl.pinpoint, sl.excerpt, sl.source, sl.doubt,
       COALESCE((SELECT a.verification FROM authorities a WHERE a.id = sl.authority_id), 'lead')
FROM statements_of_law sl;
DROP TABLE statements_of_law;
ALTER TABLE statements_of_law_v25 RENAME TO statements_of_law;
CREATE INDEX idx_statements_of_law_proceeding ON statements_of_law(proceeding_id);
CREATE INDEX idx_statements_of_law_assertion ON statements_of_law(law_assertion_id);
CREATE INDEX idx_statements_of_law_authority ON statements_of_law(authority_id);

PRAGMA foreign_keys = ON;

CREATE TRIGGER rev_statements_of_law_ins AFTER INSERT ON statements_of_law BEGIN UPDATE db_meta SET value = CAST(value AS INTEGER) + 1 WHERE key = 'revision'; END;
CREATE TRIGGER rev_statements_of_law_upd AFTER UPDATE ON statements_of_law BEGIN UPDATE db_meta SET value = CAST(value AS INTEGER) + 1 WHERE key = 'revision'; END;
CREATE TRIGGER rev_statements_of_law_del AFTER DELETE ON statements_of_law BEGIN UPDATE db_meta SET value = CAST(value AS INTEGER) + 1 WHERE key = 'revision'; END;

ALTER TABLE authorities DROP COLUMN verification;

ALTER TABLE statements_of_fact ADD COLUMN exhibit_excerpt TEXT;
ALTER TABLE statements_of_fact ADD COLUMN exhibit_pinpoint TEXT;

ALTER TABLE tickets ADD COLUMN rejected_at TEXT;
ALTER TABLE tickets ADD COLUMN superseded_marker_gone_at TEXT;

CREATE TABLE ticket_proposals (
    ticket_id    INTEGER NOT NULL REFERENCES tickets(id),
    proposal_key TEXT NOT NULL,
    item         TEXT NOT NULL,
    PRIMARY KEY (ticket_id, proposal_key)
);

CREATE TABLE proposal_rejections (
    proposal_key TEXT PRIMARY KEY,
    ticket_id    INTEGER REFERENCES tickets(id),
    marker       TEXT NOT NULL,
    item         TEXT NOT NULL,
    rejected_at  TEXT NOT NULL
);

UPDATE db_meta SET value = '25' WHERE key = 'schema_version';

-- MIGRATE 25 -> 26
-- Vocabulary rename, "dropped" -> "killed" (#796, decision point 1,
-- practitioner 2026-09-21: "Let's go with killed. It works with the
-- headstone."). The v16 axis is unchanged in meaning -- a submission or an
-- authority the practitioner reviewed and rejected, kept intact so no later
-- session re-proposes it, restorable by clearing the date. Only the word
-- moves: submissions.dropped_on and authorities.dropped_on become killed_on.
-- "dead" was considered and refused because it collides with the 🚧
-- dead_end state (researched, nothing found); "killed" does not.
-- RENAME COLUMN rewrites the stored CREATE TABLE text in place (SQLite
-- 3.25+); nothing else in the schema -- no trigger, index or view -- names
-- the column, so no rebuild chain and no data movement.

ALTER TABLE submissions RENAME COLUMN dropped_on TO killed_on;
ALTER TABLE authorities RENAME COLUMN dropped_on TO killed_on;

UPDATE db_meta SET value = '26' WHERE key = 'schema_version';

-- MIGRATE 26 -> 27
-- Practitioner review (Engineering/1. Design/2026-09-22_practitioner-review-
-- design.md sections 5 and 7; Engineering/2. Plan/2026-09-22_practitioner-review-
-- implementation-plan.md Phase 3). Two new tables:
--
-- 1. review_approvals (design 5): one row per approval of an object, the
--    object named as ticket_scope names it (entity = table, entity_id = row).
--    snapshot holds, by value as one JSON text, the stored fields the
--    practitioner reviewed -- never the rendered wording, so a renderer
--    template change re-raises no marker. The 🧐 predicate compares an
--    object's current stored fields with its latest snapshot, so a later
--    change re-raises the marker with no trigger and no invalidation write.
--    APPEND-ONLY: no reference offers an UPDATE or DELETE path.
--
-- 2. review_points (design 7): a discussion point raised in a review session,
--    anchored to an object, holding the practitioner's comment verbatim.
--    resolution is NULL while the point is open. 'change_wanted' closes it and,
--    in the same write, captures a seed, which seed_id names.
--
-- NEITHER CARRIES REVISION TRIGGERS, and neither ever gains any: approving or
-- discussing changes no substance, so it must never bump db_meta.revision,
-- archive a mockup or stale the gate. With the ticket tables they make ten
-- revision-exempt tables. tests/test_migrate_engine.py's
-- TestV21RevisionTriggers exempts them by name.

CREATE TABLE review_approvals (
    id            INTEGER PRIMARY KEY,
    entity        TEXT NOT NULL,
    entity_id     INTEGER NOT NULL,
    approved_at   TEXT NOT NULL,
    session_token TEXT NOT NULL,
    practitioner  TEXT NOT NULL,
    revision      INTEGER NOT NULL,
    snapshot      TEXT NOT NULL
);

CREATE TABLE review_points (
    id          INTEGER PRIMARY KEY,
    filing_id   INTEGER NOT NULL REFERENCES filings(id),
    ticket_id   INTEGER NOT NULL REFERENCES tickets(id),
    entity      TEXT NOT NULL,
    entity_id   INTEGER NOT NULL,
    created     TEXT NOT NULL,
    comment     TEXT NOT NULL,
    resolution  TEXT CHECK (resolution IN ('answered', 'change_wanted', 'leave_it')),
    resolved_at TEXT,
    seed_id     INTEGER REFERENCES seeds(id)
);

UPDATE db_meta SET value = '27' WHERE key = 'schema_version';

-- MIGRATE 27 -> 28
-- The forum becomes a knowledge-tree key (Engineering/1. Design/2026-09-24_draft-
-- generalization-and-localize-spec.md section 5 "Migrations"; Engineering/2. Plan/
-- 2026-09-25_draft-generalization-and-localize-implementation-plan.md Phase 5
-- step 4). proceedings.forum holds <Country>/<Jurisdiction>/<Venue>, the venue
-- being its folder name, its code, in /draft's tree (shared/knowledge-tree.md
-- "Folder grammar"): 'bcsc' becomes 'CAN/BC/BCSC', 'bcca' 'CAN/BC/BCCA', and
-- 'vaniac' 'CAN/BC/Vancouver-International-Arbitration-Centre'.
--
-- The rewrite is one-to-one and is not written here. migrate_engine.py
-- resolves every stored value through /draft's jurisdiction index for BC (a
-- venue row's code matched ignoring case, or one of its aliases) into
-- temp.forum_tree_keys before this hop runs, and refuses, naming the row, a
-- value that names no venue or more than one. NULL (forum not yet chosen,
-- ADR 0018) stays NULL.
--
-- The CHECK closing forum to three values is dropped: the forum is open text,
-- and the composing skill validates it against the tree. SQLite cannot drop a
-- CHECK, so proceedings is rebuilt create-copy-drop-rename as the 22 -> 23 hop
-- did. The two filing guards name proceedings in their bodies, so they are
-- dropped before the rebuild and recreated after it, with the
-- rev_proceedings_* triggers and guard_proceedings_keep_forum that DROP TABLE
-- takes with it.
PRAGMA foreign_keys = OFF;

DROP TRIGGER IF EXISTS guard_filings_need_forum_ins;
DROP TRIGGER IF EXISTS guard_filings_need_forum_upd;

CREATE TABLE proceedings_v28 (
    id                      INTEGER PRIMARY KEY,
    matter_reference        TEXT NOT NULL,
    forum                   TEXT,
    court_or_centre         TEXT,
    registry                TEXT,
    file_number             TEXT,
    style_of_cause          TEXT,
    courthouse_address      TEXT,
    rule_24h_consent        INTEGER NOT NULL DEFAULT 0 CHECK (rule_24h_consent IN (0, 1)),
    under_appeal_judge      TEXT,
    under_appeal_court      TEXT,
    under_appeal_pronounced DATE,
    access_restrictions     TEXT
);
INSERT INTO proceedings_v28 (id, matter_reference, forum, court_or_centre, registry, file_number, style_of_cause, courthouse_address, rule_24h_consent, under_appeal_judge, under_appeal_court, under_appeal_pronounced, access_restrictions)
SELECT p.id, p.matter_reference, (SELECT k.tree_key FROM temp.forum_tree_keys k WHERE k.stored = p.forum), p.court_or_centre, p.registry, p.file_number, p.style_of_cause, p.courthouse_address, p.rule_24h_consent, p.under_appeal_judge, p.under_appeal_court, p.under_appeal_pronounced, p.access_restrictions FROM proceedings p;
DROP TABLE proceedings;
ALTER TABLE proceedings_v28 RENAME TO proceedings;
DROP TABLE temp.forum_tree_keys;

PRAGMA foreign_keys = ON;

CREATE TRIGGER rev_proceedings_ins AFTER INSERT ON proceedings BEGIN UPDATE db_meta SET value = CAST(value AS INTEGER) + 1 WHERE key = 'revision'; END;
CREATE TRIGGER rev_proceedings_upd AFTER UPDATE ON proceedings BEGIN UPDATE db_meta SET value = CAST(value AS INTEGER) + 1 WHERE key = 'revision'; END;
CREATE TRIGGER rev_proceedings_del AFTER DELETE ON proceedings BEGIN UPDATE db_meta SET value = CAST(value AS INTEGER) + 1 WHERE key = 'revision'; END;

CREATE TRIGGER guard_filings_need_forum_ins BEFORE INSERT ON filings
WHEN (SELECT forum FROM proceedings WHERE id = NEW.proceeding_id) IS NULL
 AND EXISTS (SELECT 1 FROM proceedings WHERE id = NEW.proceeding_id)
BEGIN SELECT RAISE(ABORT, 'no filing until the proceeding''s forum is chosen (ADR 0018)'); END;
CREATE TRIGGER guard_filings_need_forum_upd BEFORE UPDATE OF proceeding_id ON filings
WHEN (SELECT forum FROM proceedings WHERE id = NEW.proceeding_id) IS NULL
 AND EXISTS (SELECT 1 FROM proceedings WHERE id = NEW.proceeding_id)
BEGIN SELECT RAISE(ABORT, 'no filing until the proceeding''s forum is chosen (ADR 0018)'); END;
CREATE TRIGGER guard_proceedings_keep_forum BEFORE UPDATE OF forum ON proceedings
WHEN NEW.forum IS NULL AND EXISTS (SELECT 1 FROM filings WHERE proceeding_id = NEW.id)
BEGIN SELECT RAISE(ABORT, 'the forum cannot be cleared while the proceeding has a filing (ADR 0018)'); END;

UPDATE db_meta SET value = '28' WHERE key = 'schema_version';

-- MIGRATE 28 -> 29
-- The kind migration (spec section 5 "Migrations"; plan Phase 5 step 4). The
-- stored kind identifiers stay, and each is an alias in its venue's kinds
-- index in /draft's tree, which maps it to its type file. Only 'requisition'
-- changes: its two variants become two kinds, 'requisition_default_judgment'
-- and 'requisition_consent', taken from subkind, which keeps its value.
-- migrate_engine.py refuses, naming the row, a requisition with no subkind
-- before this hop runs; the CASE below yields NULL for one, so the NOT NULL
-- on kind refuses it here too.
--
-- The CHECK closing kind to six values is dropped: the kind is open text, and
-- the composing skill validates it against the tree. filings is rebuilt
-- create-copy-drop-rename as the 17 -> 18 hop did, every other column, CHECK
-- and index carried over unchanged. Four triggers on other tables name
-- filings in their bodies (guard_proceedings_keep_forum and the three
-- guard_filing_documents_filed_* freezes), so they are dropped before the
-- rebuild and recreated after it, with the rev_filings_* triggers and the two
-- filing guards that DROP TABLE takes with it.
PRAGMA foreign_keys = OFF;

DROP TRIGGER IF EXISTS guard_proceedings_keep_forum;
DROP TRIGGER IF EXISTS guard_filing_documents_filed_ins;
DROP TRIGGER IF EXISTS guard_filing_documents_filed_upd;
DROP TRIGGER IF EXISTS guard_filing_documents_filed_del;

CREATE TABLE filings_v29 (
    id                INTEGER PRIMARY KEY,
    proceeding_id     INTEGER NOT NULL REFERENCES proceedings(id),
    kind              TEXT NOT NULL,
    subkind           TEXT CHECK (subkind IN ('default_judgment', 'consent')),
    round             TEXT CHECK (round IN ('opening', 'response', 'reply', 'non_participation')),
    title             TEXT NOT NULL,
    filed_on          DATE,
    decided_on        DATE,
    retired_on        DATE,
    retirement_reason TEXT CHECK (retirement_reason IN ('appeal_expired', 'appeal_exhausted', 'decided', 'settled', 'abandoned', 'adjourned_generally', 'other')),
    entered_on        DATE
);
INSERT INTO filings_v29 (id, proceeding_id, kind, subkind, round, title, filed_on, decided_on, retired_on, retirement_reason, entered_on)
SELECT id, proceeding_id,
       CASE WHEN kind = 'requisition'
            THEN CASE subkind WHEN 'default_judgment' THEN 'requisition_default_judgment' WHEN 'consent' THEN 'requisition_consent' END
            ELSE kind END,
       subkind, round, title, filed_on, decided_on, retired_on, retirement_reason, entered_on
FROM filings;
DROP TABLE filings;
ALTER TABLE filings_v29 RENAME TO filings;
CREATE INDEX idx_filings_proceeding ON filings(proceeding_id);

PRAGMA foreign_keys = ON;

CREATE TRIGGER rev_filings_ins AFTER INSERT ON filings BEGIN UPDATE db_meta SET value = CAST(value AS INTEGER) + 1 WHERE key = 'revision'; END;
CREATE TRIGGER rev_filings_upd AFTER UPDATE ON filings BEGIN UPDATE db_meta SET value = CAST(value AS INTEGER) + 1 WHERE key = 'revision'; END;
CREATE TRIGGER rev_filings_del AFTER DELETE ON filings BEGIN UPDATE db_meta SET value = CAST(value AS INTEGER) + 1 WHERE key = 'revision'; END;

CREATE TRIGGER guard_filings_need_forum_ins BEFORE INSERT ON filings
WHEN (SELECT forum FROM proceedings WHERE id = NEW.proceeding_id) IS NULL
 AND EXISTS (SELECT 1 FROM proceedings WHERE id = NEW.proceeding_id)
BEGIN SELECT RAISE(ABORT, 'no filing until the proceeding''s forum is chosen (ADR 0018)'); END;
CREATE TRIGGER guard_filings_need_forum_upd BEFORE UPDATE OF proceeding_id ON filings
WHEN (SELECT forum FROM proceedings WHERE id = NEW.proceeding_id) IS NULL
 AND EXISTS (SELECT 1 FROM proceedings WHERE id = NEW.proceeding_id)
BEGIN SELECT RAISE(ABORT, 'no filing until the proceeding''s forum is chosen (ADR 0018)'); END;
CREATE TRIGGER guard_proceedings_keep_forum BEFORE UPDATE OF forum ON proceedings
WHEN NEW.forum IS NULL AND EXISTS (SELECT 1 FROM filings WHERE proceeding_id = NEW.id)
BEGIN SELECT RAISE(ABORT, 'the forum cannot be cleared while the proceeding has a filing (ADR 0018)'); END;

CREATE TRIGGER guard_filing_documents_filed_ins BEFORE INSERT ON filing_documents
WHEN (SELECT filed_on FROM filings WHERE id = NEW.filing_id) IS NOT NULL
BEGIN SELECT RAISE(ABORT, 'a filed filing''s exhibits do not change (#712)'); END;
CREATE TRIGGER guard_filing_documents_filed_upd BEFORE UPDATE ON filing_documents
WHEN (SELECT filed_on FROM filings WHERE id = OLD.filing_id) IS NOT NULL
   OR (SELECT filed_on FROM filings WHERE id = NEW.filing_id) IS NOT NULL
BEGIN SELECT RAISE(ABORT, 'a filed filing''s exhibits do not change (#712)'); END;
CREATE TRIGGER guard_filing_documents_filed_del BEFORE DELETE ON filing_documents
WHEN (SELECT filed_on FROM filings WHERE id = OLD.filing_id) IS NOT NULL
BEGIN SELECT RAISE(ABORT, 'a filed filing''s exhibits do not change (#712)'); END;

UPDATE db_meta SET value = '29' WHERE key = 'schema_version';

-- MIGRATE 29 -> 30
-- The Writing model (Engineering/1. Design/2026-09-24_draft-generalization-and-
-- localize-spec.md section 5; Engineering/2. Plan/2026-09-25_draft-
-- generalization-and-localize-implementation-plan.md Phase 10; ADR 0024 D6
-- and D8). A filing row is a Writing: any legal writing /draft drafts, only
-- some of which go to a forum. Four changes:
--
-- 1. The needs-forum fact. filings.needs_forum_parts (0 or 1) says whether
--    the Writing prints parts only a forum supplies, as its type file declares
--    (shared/declared-layout.md). It replaces the three ADR 0018 guards, which
--    keep their names: a needs-forum Writing may not be inserted on, moved
--    onto, or turned needs-forum on a proceeding with no forum, and a forum
--    may not be cleared while a needs-forum Writing sits on the proceeding. A
--    Writing that needs no forum parts may sit on a forum-less proceeding.
--    DEFAULT 1 keeps the old guard for an insert that does not state the fact.
--
-- 2. The layout snapshot. filings.layout_snapshot is one JSON text:
--    {"layout": <the type file's layout block>, "venue": <the venue.md
--    block>, "passage_hashes": {<rule_ref>: <sha256>}}. Renderers will read
--    only this stored copy. Writing it is an UPDATE on filings, so it moves
--    db_meta.revision and enters the render stamp through the revision; the
--    stamp gains no input. NULL until the runtime snapshots the Writing.
--    This hop backfills every existing filing, and moves no revision doing
--    it: migrate_engine.py copies each filing's type-file block and venue.md
--    block verbatim from /draft's tree into temp.filing_layouts, with
--    needs_forum_parts read from the type file, and refuses, naming the row,
--    a filing whose forum or kind has no shipped file, or whose blocks cite a
--    rule_ref (the shipped files record no passage hash to copy).
--
-- 3. The signer and the sent copy. signer_key is a firm roster key and
--    signer_party_id a party, for a type declaring signer: party; at most one
--    is set. signer_snapshot holds the signer's details as JSON text, NULL
--    until the Writing is sent. sent_copy_id is the documents row of the copy
--    as sent (ADR 0024 D6), never linked through filing_documents. There is
--    no separate sent date: sending records filed_on, the existing delivery
--    date, which also freezes the exhibits (the 23 -> 24 hop).
--
-- 4. The service list (ADR 0024 D8). recipients is proceeding-scoped: name,
--    capacity in the practitioner's own words, email, address, and an
--    optional party the recipient is or acts for. filing_recipients joins a
--    Writing to its recipients as 'to', 'cc' or 'bcc', ordered within each
--    role. Both carry revision triggers: recipients print on the sent face.
--
-- filings is rebuilt create-copy-drop-rename as the 28 -> 29 hop did, every
-- existing column, CHECK and index carried over unchanged, and the four
-- triggers on other tables that name filings are dropped first and recreated
-- after it.
PRAGMA foreign_keys = OFF;

DROP TRIGGER IF EXISTS guard_proceedings_keep_forum;
DROP TRIGGER IF EXISTS guard_filing_documents_filed_ins;
DROP TRIGGER IF EXISTS guard_filing_documents_filed_upd;
DROP TRIGGER IF EXISTS guard_filing_documents_filed_del;

CREATE TABLE filings_v30 (
    id                INTEGER PRIMARY KEY,
    proceeding_id     INTEGER NOT NULL REFERENCES proceedings(id),
    kind              TEXT NOT NULL,
    subkind           TEXT CHECK (subkind IN ('default_judgment', 'consent')),
    round             TEXT CHECK (round IN ('opening', 'response', 'reply', 'non_participation')),
    title             TEXT NOT NULL,
    filed_on          DATE,
    decided_on        DATE,
    retired_on        DATE,
    retirement_reason TEXT CHECK (retirement_reason IN ('appeal_expired', 'appeal_exhausted', 'decided', 'settled', 'abandoned', 'adjourned_generally', 'other')),
    entered_on        DATE,
    needs_forum_parts INTEGER NOT NULL DEFAULT 1 CHECK (needs_forum_parts IN (0, 1)),
    layout_snapshot   TEXT, -- JSON text: {"layout", "venue", "passage_hashes"}
    signer_key        TEXT,
    signer_party_id   INTEGER REFERENCES parties(id),
    signer_snapshot   TEXT, -- JSON text, NULL until sent
    sent_copy_id      INTEGER REFERENCES documents(id),
    CHECK (signer_key IS NULL OR signer_party_id IS NULL)
);
INSERT INTO filings_v30 (id, proceeding_id, kind, subkind, round, title, filed_on, decided_on, retired_on, retirement_reason, entered_on, needs_forum_parts, layout_snapshot)
SELECT f.id, f.proceeding_id, f.kind, f.subkind, f.round, f.title, f.filed_on, f.decided_on, f.retired_on, f.retirement_reason, f.entered_on,
       (SELECT l.needs_forum_parts FROM temp.filing_layouts l WHERE l.filing_id = f.id),
       (SELECT l.layout_snapshot FROM temp.filing_layouts l WHERE l.filing_id = f.id)
FROM filings f;
DROP TABLE filings;
ALTER TABLE filings_v30 RENAME TO filings;
CREATE INDEX idx_filings_proceeding ON filings(proceeding_id);
DROP TABLE temp.filing_layouts;

CREATE TABLE recipients (
    id            INTEGER PRIMARY KEY,
    proceeding_id INTEGER NOT NULL REFERENCES proceedings(id),
    name          TEXT NOT NULL,
    capacity      TEXT, -- the practitioner's own words, e.g. counsel for the Respondent
    email         TEXT,
    address       TEXT,
    party_id      INTEGER REFERENCES parties(id), -- the party this recipient is or acts for
    ordinal       INTEGER NOT NULL
);
CREATE INDEX idx_recipients_proceeding ON recipients(proceeding_id);

CREATE TABLE filing_recipients (
    id           INTEGER PRIMARY KEY,
    filing_id    INTEGER NOT NULL REFERENCES filings(id),
    recipient_id INTEGER NOT NULL REFERENCES recipients(id),
    role         TEXT NOT NULL CHECK (role IN ('to', 'cc', 'bcc')),
    ordinal      INTEGER NOT NULL,
    UNIQUE (filing_id, recipient_id)
);
CREATE INDEX idx_filing_recipients_filing ON filing_recipients(filing_id);

PRAGMA foreign_keys = ON;

CREATE TRIGGER rev_filings_ins AFTER INSERT ON filings BEGIN UPDATE db_meta SET value = CAST(value AS INTEGER) + 1 WHERE key = 'revision'; END;
CREATE TRIGGER rev_filings_upd AFTER UPDATE ON filings BEGIN UPDATE db_meta SET value = CAST(value AS INTEGER) + 1 WHERE key = 'revision'; END;
CREATE TRIGGER rev_filings_del AFTER DELETE ON filings BEGIN UPDATE db_meta SET value = CAST(value AS INTEGER) + 1 WHERE key = 'revision'; END;
CREATE TRIGGER rev_recipients_ins AFTER INSERT ON recipients BEGIN UPDATE db_meta SET value = CAST(value AS INTEGER) + 1 WHERE key = 'revision'; END;
CREATE TRIGGER rev_recipients_upd AFTER UPDATE ON recipients BEGIN UPDATE db_meta SET value = CAST(value AS INTEGER) + 1 WHERE key = 'revision'; END;
CREATE TRIGGER rev_recipients_del AFTER DELETE ON recipients BEGIN UPDATE db_meta SET value = CAST(value AS INTEGER) + 1 WHERE key = 'revision'; END;
CREATE TRIGGER rev_filing_recipients_ins AFTER INSERT ON filing_recipients BEGIN UPDATE db_meta SET value = CAST(value AS INTEGER) + 1 WHERE key = 'revision'; END;
CREATE TRIGGER rev_filing_recipients_upd AFTER UPDATE ON filing_recipients BEGIN UPDATE db_meta SET value = CAST(value AS INTEGER) + 1 WHERE key = 'revision'; END;
CREATE TRIGGER rev_filing_recipients_del AFTER DELETE ON filing_recipients BEGIN UPDATE db_meta SET value = CAST(value AS INTEGER) + 1 WHERE key = 'revision'; END;

CREATE TRIGGER guard_filings_need_forum_ins BEFORE INSERT ON filings
WHEN NEW.needs_forum_parts = 1
 AND (SELECT forum FROM proceedings WHERE id = NEW.proceeding_id) IS NULL
 AND EXISTS (SELECT 1 FROM proceedings WHERE id = NEW.proceeding_id)
BEGIN SELECT RAISE(ABORT, 'a Writing that needs forum parts needs its proceeding''s forum chosen first'); END;
CREATE TRIGGER guard_filings_need_forum_upd BEFORE UPDATE OF proceeding_id, needs_forum_parts ON filings
WHEN NEW.needs_forum_parts = 1
 AND (SELECT forum FROM proceedings WHERE id = NEW.proceeding_id) IS NULL
 AND EXISTS (SELECT 1 FROM proceedings WHERE id = NEW.proceeding_id)
BEGIN SELECT RAISE(ABORT, 'a Writing that needs forum parts needs its proceeding''s forum chosen first'); END;
CREATE TRIGGER guard_proceedings_keep_forum BEFORE UPDATE OF forum ON proceedings
WHEN NEW.forum IS NULL AND EXISTS (SELECT 1 FROM filings WHERE proceeding_id = NEW.id AND needs_forum_parts = 1)
BEGIN SELECT RAISE(ABORT, 'the forum cannot be cleared while a Writing on the proceeding needs forum parts'); END;

CREATE TRIGGER guard_filing_documents_filed_ins BEFORE INSERT ON filing_documents
WHEN (SELECT filed_on FROM filings WHERE id = NEW.filing_id) IS NOT NULL
BEGIN SELECT RAISE(ABORT, 'a filed filing''s exhibits do not change (#712)'); END;
CREATE TRIGGER guard_filing_documents_filed_upd BEFORE UPDATE ON filing_documents
WHEN (SELECT filed_on FROM filings WHERE id = OLD.filing_id) IS NOT NULL
   OR (SELECT filed_on FROM filings WHERE id = NEW.filing_id) IS NOT NULL
BEGIN SELECT RAISE(ABORT, 'a filed filing''s exhibits do not change (#712)'); END;
CREATE TRIGGER guard_filing_documents_filed_del BEFORE DELETE ON filing_documents
WHEN (SELECT filed_on FROM filings WHERE id = OLD.filing_id) IS NOT NULL
BEGIN SELECT RAISE(ABORT, 'a filed filing''s exhibits do not change (#712)'); END;

UPDATE db_meta SET value = '30' WHERE key = 'schema_version';

-- MIGRATE 30 -> 31
-- Clause rows with provenance (Engineering/2. Plan/2026-09-25_draft-
-- generalization-and-localize-implementation-plan.md Phase 12; #1078 items 3
-- and 4). A Writing with numbered operative clauses (a release, an
-- undertaking, a settlement agreement) draws them from the proceeding's
-- clause rows, each of which records where it comes from:
--
-- 1. clauses is proceeding-scoped. basis 'express' cites a documents row in
--    the proceeding (the offer, the acceptance, a proposed form) by
--    document_id, with a pinpoint and an excerpt, both NULL until captured.
--    basis 'implied' may cite a statements_of_law row by excerpt_id and
--    carries no document, pinpoint or excerpt of its own. CHECKs hold each
--    basis to its own columns.
--
-- 2. filing_clauses selects and orders a Writing's clauses, as filing_orders
--    does for orders sought: ordinal, and wording_override for a Writing
--    that words a clause differently. A clause appears once per Writing.
--
-- Both tables are substance, not review records, so both carry the three
-- revision triggers.
CREATE TABLE clauses (
    id            INTEGER PRIMARY KEY,
    proceeding_id INTEGER NOT NULL REFERENCES proceedings(id),
    wording       TEXT NOT NULL,
    basis         TEXT NOT NULL CHECK (basis IN ('express', 'implied')),
    document_id   INTEGER REFERENCES documents(id), -- express: the source the clause is taken from
    pinpoint      TEXT,
    excerpt       TEXT,
    excerpt_id    INTEGER REFERENCES statements_of_law(id), -- implied: optional
    CHECK (basis = 'implied' OR (document_id IS NOT NULL AND excerpt_id IS NULL)),
    CHECK (basis = 'express' OR (document_id IS NULL AND pinpoint IS NULL AND excerpt IS NULL))
);
CREATE INDEX idx_clauses_proceeding ON clauses(proceeding_id);

CREATE TABLE filing_clauses (
    id               INTEGER PRIMARY KEY,
    filing_id        INTEGER NOT NULL REFERENCES filings(id),
    clause_id        INTEGER NOT NULL REFERENCES clauses(id),
    ordinal          INTEGER NOT NULL,
    wording_override TEXT,
    UNIQUE (filing_id, clause_id)
);
CREATE INDEX idx_filing_clauses_filing ON filing_clauses(filing_id);

CREATE TRIGGER rev_clauses_ins AFTER INSERT ON clauses BEGIN UPDATE db_meta SET value = CAST(value AS INTEGER) + 1 WHERE key = 'revision'; END;
CREATE TRIGGER rev_clauses_upd AFTER UPDATE ON clauses BEGIN UPDATE db_meta SET value = CAST(value AS INTEGER) + 1 WHERE key = 'revision'; END;
CREATE TRIGGER rev_clauses_del AFTER DELETE ON clauses BEGIN UPDATE db_meta SET value = CAST(value AS INTEGER) + 1 WHERE key = 'revision'; END;
CREATE TRIGGER rev_filing_clauses_ins AFTER INSERT ON filing_clauses BEGIN UPDATE db_meta SET value = CAST(value AS INTEGER) + 1 WHERE key = 'revision'; END;
CREATE TRIGGER rev_filing_clauses_upd AFTER UPDATE ON filing_clauses BEGIN UPDATE db_meta SET value = CAST(value AS INTEGER) + 1 WHERE key = 'revision'; END;
CREATE TRIGGER rev_filing_clauses_del AFTER DELETE ON filing_clauses BEGIN UPDATE db_meta SET value = CAST(value AS INTEGER) + 1 WHERE key = 'revision'; END;

UPDATE db_meta SET value = '31' WHERE key = 'schema_version';

-- MIGRATE 31 -> 32
-- The delivered reason, the layout freeze and the no-forum date refusals
-- (Engineering/1. Design/2026-09-24_draft-generalization-and-localize-spec.md
-- section 5; Engineering/2. Plan/2026-09-25_draft-generalization-and-localize-
-- implementation-plan.md Phase 11). Three changes:
--
-- 1. 'delivered' joins filings.retirement_reason's closed set: ADR 0024 D5 as
--    reconciled on #1047, the reason for a Writing recorded as sent that
--    asks for nothing.
--
-- 2. The layout freeze. Spec section 5 allows a re-snapshot "only while the
--    Writing is drafting", and holds it at database level:
--    guard_filings_layout_frozen refuses any change to layout_snapshot or
--    needs_forum_parts once filed_on or retired_on is set.
--
-- 3. The no-forum date refusals. Spec section 5: a Writing that needs no
--    forum parts takes no hearing, decision or entry date. Four guard
--    triggers refuse decided_on, entered_on and a hearing_details row on a
--    Writing with needs_forum_parts = 0, and a switch to 0 while any of them
--    exists. filed_on and retired_on stay allowed.
--
-- filings is rebuilt create-copy-drop-rename as the 29 -> 30 hop did, since
-- SQLite cannot alter a CHECK: every column, CHECK and index is carried over
-- unchanged but the one CHECK, and the four triggers on other tables that
-- name filings are dropped first and recreated after it. The two new
-- hearing_details triggers also name filings, so a future filings rebuild
-- drops and recreates them as this hop does the four above.
PRAGMA foreign_keys = OFF;

DROP TRIGGER IF EXISTS guard_proceedings_keep_forum;
DROP TRIGGER IF EXISTS guard_filing_documents_filed_ins;
DROP TRIGGER IF EXISTS guard_filing_documents_filed_upd;
DROP TRIGGER IF EXISTS guard_filing_documents_filed_del;

CREATE TABLE filings_v32 (
    id                INTEGER PRIMARY KEY,
    proceeding_id     INTEGER NOT NULL REFERENCES proceedings(id),
    kind              TEXT NOT NULL,
    subkind           TEXT CHECK (subkind IN ('default_judgment', 'consent')),
    round             TEXT CHECK (round IN ('opening', 'response', 'reply', 'non_participation')),
    title             TEXT NOT NULL,
    filed_on          DATE,
    decided_on        DATE,
    retired_on        DATE,
    retirement_reason TEXT CHECK (retirement_reason IN ('appeal_expired', 'appeal_exhausted', 'decided', 'settled', 'abandoned', 'adjourned_generally', 'other', 'delivered')),
    entered_on        DATE,
    needs_forum_parts INTEGER NOT NULL DEFAULT 1 CHECK (needs_forum_parts IN (0, 1)),
    layout_snapshot   TEXT, -- JSON text: {"layout", "venue", "passage_hashes"}
    signer_key        TEXT,
    signer_party_id   INTEGER REFERENCES parties(id),
    signer_snapshot   TEXT, -- JSON text, NULL until sent
    sent_copy_id      INTEGER REFERENCES documents(id),
    CHECK (signer_key IS NULL OR signer_party_id IS NULL)
);
INSERT INTO filings_v32 (id, proceeding_id, kind, subkind, round, title, filed_on, decided_on, retired_on, retirement_reason, entered_on, needs_forum_parts, layout_snapshot, signer_key, signer_party_id, signer_snapshot, sent_copy_id)
SELECT id, proceeding_id, kind, subkind, round, title, filed_on, decided_on, retired_on, retirement_reason, entered_on, needs_forum_parts, layout_snapshot, signer_key, signer_party_id, signer_snapshot, sent_copy_id
FROM filings;
DROP TABLE filings;
ALTER TABLE filings_v32 RENAME TO filings;
CREATE INDEX idx_filings_proceeding ON filings(proceeding_id);

PRAGMA foreign_keys = ON;

CREATE TRIGGER rev_filings_ins AFTER INSERT ON filings BEGIN UPDATE db_meta SET value = CAST(value AS INTEGER) + 1 WHERE key = 'revision'; END;
CREATE TRIGGER rev_filings_upd AFTER UPDATE ON filings BEGIN UPDATE db_meta SET value = CAST(value AS INTEGER) + 1 WHERE key = 'revision'; END;
CREATE TRIGGER rev_filings_del AFTER DELETE ON filings BEGIN UPDATE db_meta SET value = CAST(value AS INTEGER) + 1 WHERE key = 'revision'; END;

CREATE TRIGGER guard_filings_need_forum_ins BEFORE INSERT ON filings
WHEN NEW.needs_forum_parts = 1
 AND (SELECT forum FROM proceedings WHERE id = NEW.proceeding_id) IS NULL
 AND EXISTS (SELECT 1 FROM proceedings WHERE id = NEW.proceeding_id)
BEGIN SELECT RAISE(ABORT, 'a Writing that needs forum parts needs its proceeding''s forum chosen first'); END;
CREATE TRIGGER guard_filings_need_forum_upd BEFORE UPDATE OF proceeding_id, needs_forum_parts ON filings
WHEN NEW.needs_forum_parts = 1
 AND (SELECT forum FROM proceedings WHERE id = NEW.proceeding_id) IS NULL
 AND EXISTS (SELECT 1 FROM proceedings WHERE id = NEW.proceeding_id)
BEGIN SELECT RAISE(ABORT, 'a Writing that needs forum parts needs its proceeding''s forum chosen first'); END;
CREATE TRIGGER guard_proceedings_keep_forum BEFORE UPDATE OF forum ON proceedings
WHEN NEW.forum IS NULL AND EXISTS (SELECT 1 FROM filings WHERE proceeding_id = NEW.id AND needs_forum_parts = 1)
BEGIN SELECT RAISE(ABORT, 'the forum cannot be cleared while a Writing on the proceeding needs forum parts'); END;

CREATE TRIGGER guard_filing_documents_filed_ins BEFORE INSERT ON filing_documents
WHEN (SELECT filed_on FROM filings WHERE id = NEW.filing_id) IS NOT NULL
BEGIN SELECT RAISE(ABORT, 'a filed filing''s exhibits do not change (#712)'); END;
CREATE TRIGGER guard_filing_documents_filed_upd BEFORE UPDATE ON filing_documents
WHEN (SELECT filed_on FROM filings WHERE id = OLD.filing_id) IS NOT NULL
   OR (SELECT filed_on FROM filings WHERE id = NEW.filing_id) IS NOT NULL
BEGIN SELECT RAISE(ABORT, 'a filed filing''s exhibits do not change (#712)'); END;
CREATE TRIGGER guard_filing_documents_filed_del BEFORE DELETE ON filing_documents
WHEN (SELECT filed_on FROM filings WHERE id = OLD.filing_id) IS NOT NULL
BEGIN SELECT RAISE(ABORT, 'a filed filing''s exhibits do not change (#712)'); END;

CREATE TRIGGER guard_filings_layout_frozen BEFORE UPDATE OF layout_snapshot, needs_forum_parts ON filings
WHEN (OLD.filed_on IS NOT NULL OR OLD.retired_on IS NOT NULL OR NEW.filed_on IS NOT NULL OR NEW.retired_on IS NOT NULL)
 AND (NEW.layout_snapshot IS NOT OLD.layout_snapshot OR NEW.needs_forum_parts <> OLD.needs_forum_parts)
BEGIN SELECT RAISE(ABORT, 'a sent or retired Writing''s layout does not change; re-snapshot only while drafting'); END;
CREATE TRIGGER guard_filings_no_forum_dates_ins BEFORE INSERT ON filings
WHEN NEW.needs_forum_parts = 0 AND (NEW.decided_on IS NOT NULL OR NEW.entered_on IS NOT NULL)
BEGIN SELECT RAISE(ABORT, 'a Writing that needs no forum parts takes no hearing, decision or entry date'); END;
CREATE TRIGGER guard_filings_no_forum_dates_upd BEFORE UPDATE OF decided_on, entered_on, needs_forum_parts ON filings
WHEN NEW.needs_forum_parts = 0
 AND (NEW.decided_on IS NOT NULL OR NEW.entered_on IS NOT NULL OR EXISTS (SELECT 1 FROM hearing_details WHERE filing_id = NEW.id))
BEGIN SELECT RAISE(ABORT, 'a Writing that needs no forum parts takes no hearing, decision or entry date'); END;
CREATE TRIGGER guard_hearing_details_no_forum_ins BEFORE INSERT ON hearing_details
WHEN (SELECT needs_forum_parts FROM filings WHERE id = NEW.filing_id) = 0
BEGIN SELECT RAISE(ABORT, 'a Writing that needs no forum parts takes no hearing, decision or entry date'); END;
CREATE TRIGGER guard_hearing_details_no_forum_upd BEFORE UPDATE OF filing_id ON hearing_details
WHEN (SELECT needs_forum_parts FROM filings WHERE id = NEW.filing_id) = 0
BEGIN SELECT RAISE(ABORT, 'a Writing that needs no forum parts takes no hearing, decision or entry date'); END;

UPDATE db_meta SET value = '32' WHERE key = 'schema_version';

-- MIGRATE 32 -> 33
-- filing_prose.slot becomes open text (Engineering/2. Plan/2026-09-25_draft-
-- generalization-and-localize-implementation-plan.md Phase 14). A general
-- Writing's own text lives in filing_prose: a `slot:<name>` part of its
-- stored layout reads the row whose slot is <name>, and the addressee and
-- sender parts read the rows 'addressee' and 'sender'. The slot names a
-- Writing uses are the ones its stored layout declares, so the closed CHECK
-- of the 21 -> 22 hop goes; the renderer ignores a row its layout does not
-- declare. The BCCA factum's three slots keep their names and meaning.
--
-- filing_prose is rebuilt create-copy-drop-rename (SQLite cannot ALTER a
-- CHECK), every row and UNIQUE (filing_id, slot) carried over. DROP TABLE
-- takes its three revision triggers with it, so they are recreated after it.
CREATE TABLE filing_prose_v33 (
    id        INTEGER PRIMARY KEY,
    filing_id INTEGER NOT NULL REFERENCES filings(id),
    slot      TEXT NOT NULL,
    text      TEXT NOT NULL,
    UNIQUE (filing_id, slot)
);
INSERT INTO filing_prose_v33 (id, filing_id, slot, text) SELECT id, filing_id, slot, text FROM filing_prose;
DROP TABLE filing_prose;
ALTER TABLE filing_prose_v33 RENAME TO filing_prose;

CREATE TRIGGER rev_filing_prose_ins AFTER INSERT ON filing_prose BEGIN UPDATE db_meta SET value = CAST(value AS INTEGER) + 1 WHERE key = 'revision'; END;
CREATE TRIGGER rev_filing_prose_upd AFTER UPDATE ON filing_prose BEGIN UPDATE db_meta SET value = CAST(value AS INTEGER) + 1 WHERE key = 'revision'; END;
CREATE TRIGGER rev_filing_prose_del AFTER DELETE ON filing_prose BEGIN UPDATE db_meta SET value = CAST(value AS INTEGER) + 1 WHERE key = 'revision'; END;

UPDATE db_meta SET value = '33' WHERE key = 'schema_version';

-- MIGRATE 33 -> 34
-- The statute-currency result on the authority (#1181). /draft writes it
-- after /legal-research relays the statute-currency check's `currency` value
-- for an authority of kind statute, regulation or rule (shared/statute-
-- currency.md); currency_checked_on is the date it was relayed. NULL in both
-- means never checked. The general renderer's `terms` projection reads it:
-- an implied clause naming an enactment whose result is not 'current' is
-- tagged on the mockup and refuses the filed render (forms.ts).
--
-- Additive: two nullable columns, no rebuild, no backfill. ADD COLUMN keeps
-- every row, index and trigger on authorities.
ALTER TABLE authorities ADD COLUMN currency_status TEXT CHECK (currency_status IN ('current', 'repealed', 'archived', 'not-found', 'validation_unavailable'));
ALTER TABLE authorities ADD COLUMN currency_checked_on DATE;

UPDATE db_meta SET value = '34' WHERE key = 'schema_version';

-- MIGRATE 34 -> 35
-- The statute-currency result is cleared on a rename (#1188). The result was
-- for the enactment as then named, so a change to the authority's citation or
-- style_of_cause_or_title sets currency_status and currency_checked_on back to
-- NULL (never checked). Until v35 only a writer's rule said so, and a rename
-- that forgot it kept an old 'current' that let the renamed enactment pass the
-- filed-render gate unchecked (forms.ts).
--
-- IS NOT counts NULL-to-value and value-to-NULL as a change and a same-value
-- write as none. A single statement that renames and sets a new result still
-- ends cleared: the writer records the fresh result in a later statement. The
-- inner UPDATE fires rev_authorities_upd again, so the revision moves twice.
--
-- Additive: one trigger, no rebuild, no row changes.
CREATE TRIGGER clear_authorities_currency_on_rename AFTER UPDATE OF citation, style_of_cause_or_title ON authorities
WHEN (NEW.citation IS NOT OLD.citation OR NEW.style_of_cause_or_title IS NOT OLD.style_of_cause_or_title)
 AND (NEW.currency_status IS NOT NULL OR NEW.currency_checked_on IS NOT NULL)
BEGIN UPDATE authorities SET currency_status = NULL, currency_checked_on = NULL WHERE id = NEW.id; END;

UPDATE db_meta SET value = '35' WHERE key = 'schema_version';

-- MIGRATE 35 -> 36
-- A Writing's prose-cited authorities (#1214). A statement of law that a
-- Writing's own text cites is linked to that Writing by filing_law, so the
-- general renderer lists it under the mockup-only "Authorities cited" heading
-- with its statement-line work markers, and the pre-send hold counts them.
-- The link is to the statement, not the authority: every marker the held
-- criteria count but note-up reads a statements_of_law column. A prose-cited
-- statement needs no proposition, since law_assertion_id is already nullable.
--
-- A statement is linked once per Writing. filing_law is substance, so it
-- carries the three revision triggers, as filing_clauses does. Two guard
-- triggers refuse a link whose statement belongs to another proceeding than
-- the Writing's.
--
-- Additive: one table, its index and triggers, no rebuild, no row changes.
CREATE TABLE filing_law (
    id           INTEGER PRIMARY KEY,
    filing_id    INTEGER NOT NULL REFERENCES filings(id),
    statement_id INTEGER NOT NULL REFERENCES statements_of_law(id),
    UNIQUE (filing_id, statement_id)
);
CREATE INDEX idx_filing_law_filing ON filing_law(filing_id);

CREATE TRIGGER rev_filing_law_ins AFTER INSERT ON filing_law BEGIN UPDATE db_meta SET value = CAST(value AS INTEGER) + 1 WHERE key = 'revision'; END;
CREATE TRIGGER rev_filing_law_upd AFTER UPDATE ON filing_law BEGIN UPDATE db_meta SET value = CAST(value AS INTEGER) + 1 WHERE key = 'revision'; END;
CREATE TRIGGER rev_filing_law_del AFTER DELETE ON filing_law BEGIN UPDATE db_meta SET value = CAST(value AS INTEGER) + 1 WHERE key = 'revision'; END;

CREATE TRIGGER guard_filing_law_proceeding_ins BEFORE INSERT ON filing_law
WHEN (SELECT proceeding_id FROM filings WHERE id = NEW.filing_id)
  <> (SELECT proceeding_id FROM statements_of_law WHERE id = NEW.statement_id)
BEGIN SELECT RAISE(ABORT, 'a Writing links only a statement of law of its own proceeding'); END;
CREATE TRIGGER guard_filing_law_proceeding_upd BEFORE UPDATE OF filing_id, statement_id ON filing_law
WHEN (SELECT proceeding_id FROM filings WHERE id = NEW.filing_id)
  <> (SELECT proceeding_id FROM statements_of_law WHERE id = NEW.statement_id)
BEGIN SELECT RAISE(ABORT, 'a Writing links only a statement of law of its own proceeding'); END;

UPDATE db_meta SET value = '36' WHERE key = 'schema_version';

-- MIGRATE 36 -> 37
-- A sent or retired Writing's content freeze (#1215). The v32 layout freeze
-- holds a Writing's layout once filed_on or retired_on is set, and the v24
-- exhibit freeze its filing_documents once filed_on is set. filing_law,
-- filing_prose and filing_clauses carried only revision triggers, so an edit
-- after sending could still change the cited statements of law, the prose or
-- the clause selection a re-rendered mockup shows as sent. Nine guard
-- triggers, shaped like the exhibit guards with the layout guard's
-- filed-or-retired condition, refuse every insert, update and delete of a
-- sent or retired Writing's rows in the three tables. An update is checked
-- against both the old and the new owning Writing, so a row can neither
-- leave nor join a frozen Writing. A drafting Writing's rows stay writable,
-- and clearing a filed_on or retired_on set in error is a filings update,
-- untouched by these guards.
--
-- Additive: nine triggers, no rebuild, no row changes.
CREATE TRIGGER guard_filing_law_frozen_ins BEFORE INSERT ON filing_law
WHEN (SELECT filed_on IS NOT NULL OR retired_on IS NOT NULL FROM filings WHERE id = NEW.filing_id)
BEGIN SELECT RAISE(ABORT, 'a sent or retired Writing''s cited statements of law do not change (#1215)'); END;
CREATE TRIGGER guard_filing_law_frozen_upd BEFORE UPDATE ON filing_law
WHEN (SELECT filed_on IS NOT NULL OR retired_on IS NOT NULL FROM filings WHERE id = OLD.filing_id)
  OR (SELECT filed_on IS NOT NULL OR retired_on IS NOT NULL FROM filings WHERE id = NEW.filing_id)
BEGIN SELECT RAISE(ABORT, 'a sent or retired Writing''s cited statements of law do not change (#1215)'); END;
CREATE TRIGGER guard_filing_law_frozen_del BEFORE DELETE ON filing_law
WHEN (SELECT filed_on IS NOT NULL OR retired_on IS NOT NULL FROM filings WHERE id = OLD.filing_id)
BEGIN SELECT RAISE(ABORT, 'a sent or retired Writing''s cited statements of law do not change (#1215)'); END;

CREATE TRIGGER guard_filing_prose_frozen_ins BEFORE INSERT ON filing_prose
WHEN (SELECT filed_on IS NOT NULL OR retired_on IS NOT NULL FROM filings WHERE id = NEW.filing_id)
BEGIN SELECT RAISE(ABORT, 'a sent or retired Writing''s prose does not change (#1215)'); END;
CREATE TRIGGER guard_filing_prose_frozen_upd BEFORE UPDATE ON filing_prose
WHEN (SELECT filed_on IS NOT NULL OR retired_on IS NOT NULL FROM filings WHERE id = OLD.filing_id)
  OR (SELECT filed_on IS NOT NULL OR retired_on IS NOT NULL FROM filings WHERE id = NEW.filing_id)
BEGIN SELECT RAISE(ABORT, 'a sent or retired Writing''s prose does not change (#1215)'); END;
CREATE TRIGGER guard_filing_prose_frozen_del BEFORE DELETE ON filing_prose
WHEN (SELECT filed_on IS NOT NULL OR retired_on IS NOT NULL FROM filings WHERE id = OLD.filing_id)
BEGIN SELECT RAISE(ABORT, 'a sent or retired Writing''s prose does not change (#1215)'); END;

CREATE TRIGGER guard_filing_clauses_frozen_ins BEFORE INSERT ON filing_clauses
WHEN (SELECT filed_on IS NOT NULL OR retired_on IS NOT NULL FROM filings WHERE id = NEW.filing_id)
BEGIN SELECT RAISE(ABORT, 'a sent or retired Writing''s clause selection does not change (#1215)'); END;
CREATE TRIGGER guard_filing_clauses_frozen_upd BEFORE UPDATE ON filing_clauses
WHEN (SELECT filed_on IS NOT NULL OR retired_on IS NOT NULL FROM filings WHERE id = OLD.filing_id)
  OR (SELECT filed_on IS NOT NULL OR retired_on IS NOT NULL FROM filings WHERE id = NEW.filing_id)
BEGIN SELECT RAISE(ABORT, 'a sent or retired Writing''s clause selection does not change (#1215)'); END;
CREATE TRIGGER guard_filing_clauses_frozen_del BEFORE DELETE ON filing_clauses
WHEN (SELECT filed_on IS NOT NULL OR retired_on IS NOT NULL FROM filings WHERE id = OLD.filing_id)
BEGIN SELECT RAISE(ABORT, 'a sent or retired Writing''s clause selection does not change (#1215)'); END;

UPDATE db_meta SET value = '37' WHERE key = 'schema_version';

-- MIGRATE 37 -> 38
-- A sent Writing's clause wording is snapshotted (#1227). v37 froze a sent
-- Writing's filing_clauses rows, but a row with no wording_override prints
-- the proceeding's shared clauses.wording, read live, so editing a shared
-- clause for a later draft still changed what an earlier sent Writing's
-- mockup and filed render show as sent.
--
-- 1. snapshot_clause_wording_on_send fills each NULL wording_override of a
--    Writing's filing_clauses rows with its clause's wording in the statement
--    that first sets filings.filed_on, whichever write sets it. A BEFORE
--    trigger sees the filings row still unsent, so the v37 guard lets its
--    write through. It keys on filed_on alone: a Writing retired without
--    being sent was never delivered, and recovering it from retirement
--    must leave it following shared edits. Setting filed_on on a Writing
--    already retired is refused by the v37 guard when a clause would be
--    filled: record the Sent date before retiring. Clearing a filed_on set in
--    error leaves the filled overrides; that Writing follows shared edits
--    again only once they are set back to NULL.
--
-- 2. Every Writing already sent takes the same snapshot now, past the v37
--    update guard, dropped and recreated verbatim around the write. This
--    records today's wording, which may have drifted since sending; the
--    sent copy (filings.sent_copy_id) stays the record of what went out.
--
-- Additive: one trigger; rows change only in filing_clauses.wording_override,
-- and no rendered text changes.
CREATE TRIGGER snapshot_clause_wording_on_send BEFORE UPDATE OF filed_on ON filings
WHEN OLD.filed_on IS NULL AND NEW.filed_on IS NOT NULL
BEGIN
    UPDATE filing_clauses SET wording_override = (SELECT wording FROM clauses WHERE id = filing_clauses.clause_id)
    WHERE filing_id = NEW.id AND wording_override IS NULL;
END;

DROP TRIGGER guard_filing_clauses_frozen_upd;
UPDATE filing_clauses SET wording_override = (SELECT wording FROM clauses WHERE id = filing_clauses.clause_id)
WHERE wording_override IS NULL AND filing_id IN (SELECT id FROM filings WHERE filed_on IS NOT NULL);
CREATE TRIGGER guard_filing_clauses_frozen_upd BEFORE UPDATE ON filing_clauses
WHEN (SELECT filed_on IS NOT NULL OR retired_on IS NOT NULL FROM filings WHERE id = OLD.filing_id)
  OR (SELECT filed_on IS NOT NULL OR retired_on IS NOT NULL FROM filings WHERE id = NEW.filing_id)
BEGIN SELECT RAISE(ABORT, 'a sent or retired Writing''s clause selection does not change (#1215)'); END;

UPDATE db_meta SET value = '38' WHERE key = 'schema_version';

-- MIGRATE 38 -> 39
-- A recipient off the forum default (#1234). recipients is the proceeding's
-- service list, and the forum default idiom copies every row of it onto a
-- Writing addressed to the forum, so a witness or expert entered there to
-- address a letter to would reach every later forum letter.
--
-- recipients.forum_default says whether a Writing addressed to the forum
-- copies the row by default: 1 for the service list (party counsel, a party
-- with none, and the forum's own addressees), 0 for a person a letter is
-- addressed to who is not on it (a witness, an expert, a records custodian,
-- an insurer, anyone else). There is no closed list of who that is: capacity
-- holds the practitioner's own words. Every existing row reads 1, which is
-- what the forum idiom copied before this hop.
--
-- Additive: one column, no rebuild, no backfill. ADD COLUMN keeps every
-- row, index and trigger on recipients.
ALTER TABLE recipients ADD COLUMN forum_default INTEGER NOT NULL DEFAULT 1 CHECK (forum_default IN (0, 1));

UPDATE db_meta SET value = '39' WHERE key = 'schema_version';

-- MIGRATE 39 -> 40
-- A general Writing records that its cited authority was confirmed (#1231).
-- v36 linked a statement of law a Writing cites through filing_law but
-- backfilled no link, so a Writing drafted before v36 whose prose cites a case
-- has no filing_law row, reads primary-authority and excerpts as met, and the
-- pre-send hold stays silent. Nothing parses prose: the Writing itself records
-- that it either links its cited authority or cites none.
--
-- filings.authority_confirmed_on is the date the practitioner-directed session
-- confirmed it, NULL until then. Every existing row stays NULL, so every
-- unsent general Writing drafted before this hop is flagged, and the hold
-- clears when the column is set (no waiver). The letters.md write path sets it
-- in the same write as a letter's insert of its filing_law links, or once when
-- the letter cites none.
--
-- Additive: one nullable column, no rebuild, no backfill.
ALTER TABLE filings ADD COLUMN authority_confirmed_on TEXT;

UPDATE db_meta SET value = '40' WHERE key = 'schema_version';

-- MIGRATE 40 -> 41
-- Party and counsel are read from case data, and a sent Writing keeps the
-- party rows it printed (party/counsel SSOT). Counsel of record and the
-- address for service are court-record state, owned by /case-data, which
-- applies every counsel-change notice and order. The parties rows here were
-- copied from it once and never re-read, so a change of counsel after setup
-- went stale.
--
-- 1. parties.case_party_id names the /case-data party a row stands for, NULL
--    until a session links it. The runtime compares a linked row's counsel
--    and address for service with case data and reports a row that differs,
--    or is unlinked, as drift.
--
-- 2. parties_snapshot holds the party rows as a sent Writing printed them,
--    one row per party of its proceeding, with every column the renderers
--    read. party_id records which parties row it was, with no foreign key,
--    so a party removed later never blocks the delete or loses the record.
--    It carries the three revision triggers like every substance table.
--
-- 3. snapshot_parties_on_send fills it in the statement that first sets
--    filings.filed_on, whichever write sets it, as v38's
--    snapshot_clause_wording_on_send does for clauses. It keys on filed_on
--    alone: a Writing retired without being sent was never delivered. A
--    Writing that already has snapshot rows keeps them, so a filed_on cleared
--    in error and set again keeps the first snapshot; delete its rows before
--    setting filed_on again if the party rows printed changed in between.
--
-- 4. Every Writing already sent takes its snapshot now, from its proceeding's
--    current party rows, which is what it renders today, so no rendered text
--    changes. The seed runs before the revision triggers exist, so the hop
--    moves no revision.
ALTER TABLE parties ADD COLUMN case_party_id INTEGER;

CREATE TABLE parties_snapshot (
    id                        INTEGER PRIMARY KEY,
    filing_id                 INTEGER NOT NULL REFERENCES filings(id),
    party_id                  INTEGER NOT NULL, -- the parties row printed; deliberately no FK (v41 hop)
    name                      TEXT NOT NULL,
    role                      TEXT NOT NULL,
    ordinal                   INTEGER NOT NULL,
    is_client                 INTEGER NOT NULL,
    is_applicant              INTEGER NOT NULL,
    to_be_served              INTEGER NOT NULL,
    address_for_service       TEXT,
    address_for_service_filed TEXT NOT NULL,
    counsel_name              TEXT,
    counsel_firm              TEXT,
    counsel_phone             TEXT,
    counsel_email             TEXT,
    lower_court_role          TEXT,
    UNIQUE (filing_id, party_id)
);

CREATE INDEX idx_parties_snapshot_filing ON parties_snapshot(filing_id);

INSERT INTO parties_snapshot (filing_id, party_id, name, role, ordinal, is_client, is_applicant, to_be_served,
                              address_for_service, address_for_service_filed, counsel_name, counsel_firm,
                              counsel_phone, counsel_email, lower_court_role)
SELECT f.id, p.id, p.name, p.role, p.ordinal, p.is_client, p.is_applicant, p.to_be_served,
       p.address_for_service, p.address_for_service_filed, p.counsel_name, p.counsel_firm,
       p.counsel_phone, p.counsel_email, p.lower_court_role
  FROM filings f JOIN parties p ON p.proceeding_id = f.proceeding_id
 WHERE f.filed_on IS NOT NULL;

CREATE TRIGGER rev_parties_snapshot_ins AFTER INSERT ON parties_snapshot BEGIN UPDATE db_meta SET value = CAST(value AS INTEGER) + 1 WHERE key = 'revision'; END;

CREATE TRIGGER rev_parties_snapshot_upd AFTER UPDATE ON parties_snapshot BEGIN UPDATE db_meta SET value = CAST(value AS INTEGER) + 1 WHERE key = 'revision'; END;

CREATE TRIGGER rev_parties_snapshot_del AFTER DELETE ON parties_snapshot BEGIN UPDATE db_meta SET value = CAST(value AS INTEGER) + 1 WHERE key = 'revision'; END;

CREATE TRIGGER snapshot_parties_on_send BEFORE UPDATE OF filed_on ON filings
WHEN OLD.filed_on IS NULL AND NEW.filed_on IS NOT NULL
 AND NOT EXISTS (SELECT 1 FROM parties_snapshot WHERE filing_id = NEW.id)
BEGIN
    INSERT INTO parties_snapshot (filing_id, party_id, name, role, ordinal, is_client, is_applicant, to_be_served,
                                  address_for_service, address_for_service_filed, counsel_name, counsel_firm,
                                  counsel_phone, counsel_email, lower_court_role)
    SELECT NEW.id, p.id, p.name, p.role, p.ordinal, p.is_client, p.is_applicant, p.to_be_served,
           p.address_for_service, p.address_for_service_filed, p.counsel_name, p.counsel_firm,
           p.counsel_phone, p.counsel_email, p.lower_court_role
      FROM parties p
     WHERE p.proceeding_id = NEW.proceeding_id;
END;

UPDATE db_meta SET value = '41' WHERE key = 'schema_version';

-- MIGRATE 41 -> 42
-- The runtime writes a sent Writing's party rows (party/counsel SSOT). v41's
-- snapshot_parties_on_send copied the parties columns, which a drafting
-- Writing no longer reads: its counsel and address for service come from case
-- data. So a Writing sent through that trigger froze the stale copy, not the
-- values its mockup showed, and once the columns are dropped there is nothing
-- to copy.
--
-- 1. snapshot_parties_on_send is dropped. submission_data__record_sent and
--    submission_data__record_filed write parties_snapshot from the case-data
--    read, in the same transaction and before the statement that sets
--    filed_on, and refuse while a party drifts. A Writing that already has
--    snapshot rows keeps them, as before.
--
-- 2. guard_filings_parties_snapshot refuses the statement that first sets a
--    Writing's filed_on while the Writing has no snapshot rows and its
--    proceeding has a party, so no write sets it any other way. A proceeding
--    with no party has nothing to snapshot. Clearing a filed_on set in error,
--    setting it again over the first snapshot, and retiring are untouched.
--
-- Every snapshot row stands as it is: v41 seeded every Writing already sent.
-- No row changes and no rendered text changes.
DROP TRIGGER snapshot_parties_on_send;

CREATE TRIGGER guard_filings_parties_snapshot BEFORE UPDATE OF filed_on ON filings
WHEN OLD.filed_on IS NULL AND NEW.filed_on IS NOT NULL
 AND NOT EXISTS (SELECT 1 FROM parties_snapshot WHERE filing_id = NEW.id)
 AND EXISTS (SELECT 1 FROM parties WHERE proceeding_id = NEW.proceeding_id)
BEGIN SELECT RAISE(ABORT, 'a Writing''s filed_on is set by submission_data__record_sent (a general Writing) or submission_data__record_filed (any other), which first write the party rows it was sent with (party/counsel SSOT)'); END;

UPDATE db_meta SET value = '42' WHERE key = 'schema_version';

-- MIGRATE 42 -> 43
-- The submission copy of counsel of record is dropped (party/counsel SSOT).
-- Counsel of record and the address for service are owned by /case-data: a
-- drafting Writing reads them from case data through parties.case_party_id
-- (v41), and a sent one prints its parties_snapshot rows (v41, written by the
-- runtime since v42). Nothing reads the copy any more, and an editable copy
-- outside case data is what went stale.
--
-- 1. parties loses counsel_name, counsel_firm, counsel_phone, counsel_email
--    and address_for_service by DROP COLUMN: no index, trigger or constraint
--    names them, every row keeps its id and every other column, and the
--    triggers naming parties stand as they are. address_for_service_filed and
--    every other column stay. parties_snapshot keeps its columns: a copy
--    frozen when a Writing is sent is not an editable copy.
--
-- 2. recipients' name, email and address become nullable, and a party-linked
--    row holds none of them: it takes all three from its party's read (the
--    case-data read while a Writing drafts, parties_snapshot once it is sent).
--    CHECK (party_id IS NOT NULL OR name IS NOT NULL) keeps a name on every
--    other row (the forum, a witness, an expert), and CHECK (party_id IS NULL
--    OR (name IS NULL AND email IS NULL AND address IS NULL)) keeps the copy
--    off every party-linked one. The hop sets the three to NULL on every
--    party-linked row; a row with party_id NULL is copied unchanged. SQLite
--    cannot ALTER a CHECK, so recipients is rebuilt create-copy-drop-rename
--    with foreign_keys OFF for the hop, as the v16 -> v17 hop rebuilt
--    tickets: the old table is dropped, never renamed, so filing_recipients'
--    textual "REFERENCES recipients(id)" re-binds by name. Its index and its
--    three revision triggers are recreated, and forum_default is kept.
--
-- The engine refuses the hop, naming the rows, while a parties row with no
-- case_party_id holds a value in any of the five columns (it was never
-- offered back to case data), or while a Writing with filed_on set has no
-- parties_snapshot rows and its proceeding has a party (it would print no
-- counsel); the database then stays at v42. The runtime's migrate refuses
-- before the engine runs while any counsel offer or parties_drift row stands
-- (references/filing-checklists.md section 0).
--
-- No revision moves: DROP COLUMN fires no trigger, and the copy runs before
-- the rebuilt table has its triggers.
ALTER TABLE parties DROP COLUMN counsel_name;
ALTER TABLE parties DROP COLUMN counsel_firm;
ALTER TABLE parties DROP COLUMN counsel_phone;
ALTER TABLE parties DROP COLUMN counsel_email;
ALTER TABLE parties DROP COLUMN address_for_service;

PRAGMA foreign_keys = OFF;

CREATE TABLE recipients_v43 (
    id            INTEGER PRIMARY KEY,
    proceeding_id INTEGER NOT NULL REFERENCES proceedings(id),
    name          TEXT, -- NULL on a party-linked row, which takes it from its party's read (v43 hop)
    capacity      TEXT, -- the practitioner's own words, e.g. counsel for the Respondent
    email         TEXT,
    address       TEXT,
    party_id      INTEGER REFERENCES parties(id), -- the party this recipient is or acts for
    ordinal       INTEGER NOT NULL,
    forum_default INTEGER NOT NULL DEFAULT 1 CHECK (forum_default IN (0, 1)),
    CHECK (party_id IS NOT NULL OR name IS NOT NULL),
    CHECK (party_id IS NULL OR (name IS NULL AND email IS NULL AND address IS NULL))
);
INSERT INTO recipients_v43 (id, proceeding_id, name, capacity, email, address, party_id, ordinal, forum_default)
SELECT id, proceeding_id,
       CASE WHEN party_id IS NULL THEN name END,
       capacity,
       CASE WHEN party_id IS NULL THEN email END,
       CASE WHEN party_id IS NULL THEN address END,
       party_id, ordinal, forum_default
  FROM recipients;
DROP TABLE recipients;
ALTER TABLE recipients_v43 RENAME TO recipients;
CREATE INDEX idx_recipients_proceeding ON recipients(proceeding_id);

CREATE TRIGGER rev_recipients_ins AFTER INSERT ON recipients BEGIN UPDATE db_meta SET value = CAST(value AS INTEGER) + 1 WHERE key = 'revision'; END;

CREATE TRIGGER rev_recipients_upd AFTER UPDATE ON recipients BEGIN UPDATE db_meta SET value = CAST(value AS INTEGER) + 1 WHERE key = 'revision'; END;

CREATE TRIGGER rev_recipients_del AFTER DELETE ON recipients BEGIN UPDATE db_meta SET value = CAST(value AS INTEGER) + 1 WHERE key = 'revision'; END;

PRAGMA foreign_keys = ON;

UPDATE db_meta SET value = '43' WHERE key = 'schema_version';

-- MIGRATE 43 -> 44
-- A sent Writing's recipients are frozen (#1307). Since v41 a sent Writing's
-- party-linked recipients print from parties_snapshot, but its recipient
-- membership (filing_recipients), each recipient's capacity and party_id, and
-- a recipient with no party's name, email and address (the forum, a witness,
-- an expert) were still read live, so editing the service list after the send
-- changed a sent Writing's To and cc lines.
--
-- 1. filing_recipients belongs to one Writing, like filing_prose, filing_law
--    and filing_clauses, and takes the v37 freeze guards: once a Writing's
--    filed_on or retired_on is set, inserting, updating or deleting its rows
--    is refused, and an update is checked against both the old and the new
--    owning Writing. Clearing a filed_on or retired_on set in error is a
--    filings update and stays available.
--
-- 2. recipients is the proceeding's service list, shared by every Writing,
--    and stays editable for later drafts, as v38 left clauses editable.
--    recipients_snapshot holds each of a sent Writing's recipients as it was
--    sent: its capacity and party_id, and the name, email and address of a
--    recipient with no party (a party-linked row holds none since v43, and
--    takes them from parties_snapshot by the party_id recorded here).
--    recipient_id records which recipients row it was, with no foreign key,
--    as parties_snapshot's party_id. It carries the three revision triggers.
--    It is a table of its own rather than columns on filing_recipients, so
--    the snapshot write never meets the freeze guards: sending a Writing
--    already retired is not refused for its recipients, as v38's override
--    fill is refused for its clauses.
--
-- 3. snapshot_recipients_on_send fills it in the statement that first sets
--    filings.filed_on, whichever write sets it (submission_data__record_sent
--    or submission_data__record_filed), as v38's
--    snapshot_clause_wording_on_send does for clauses. It keys on filed_on
--    alone: a Writing retired without being sent was never delivered. A
--    recipient already snapshotted for the Writing keeps its row, so a
--    filed_on cleared in error and set again keeps the first snapshot, and a
--    recipient added while it was cleared is snapshotted with the second.
--
-- 4. Every Writing already sent takes its snapshot now, from today's rows,
--    which is what it renders today, so no rendered text changes. This may
--    record values that drifted since sending; the sent copy
--    (filings.sent_copy_id) stays the record of what went out. The seed runs
--    before the revision triggers exist, so the hop moves no revision.
CREATE TABLE recipients_snapshot (
    id           INTEGER PRIMARY KEY,
    filing_id    INTEGER NOT NULL REFERENCES filings(id),
    recipient_id INTEGER NOT NULL, -- the recipients row printed; deliberately no FK (v44 hop)
    capacity     TEXT,
    party_id     INTEGER, -- the party whose parties_snapshot row it prints, NULL for none
    name         TEXT,
    email        TEXT,
    address      TEXT,
    UNIQUE (filing_id, recipient_id)
);

INSERT INTO recipients_snapshot (filing_id, recipient_id, capacity, party_id, name, email, address)
SELECT fr.filing_id, r.id, r.capacity, r.party_id, r.name, r.email, r.address
  FROM filing_recipients fr
  JOIN filings f ON f.id = fr.filing_id
  JOIN recipients r ON r.id = fr.recipient_id
 WHERE f.filed_on IS NOT NULL;

CREATE TRIGGER rev_recipients_snapshot_ins AFTER INSERT ON recipients_snapshot BEGIN UPDATE db_meta SET value = CAST(value AS INTEGER) + 1 WHERE key = 'revision'; END;

CREATE TRIGGER rev_recipients_snapshot_upd AFTER UPDATE ON recipients_snapshot BEGIN UPDATE db_meta SET value = CAST(value AS INTEGER) + 1 WHERE key = 'revision'; END;

CREATE TRIGGER rev_recipients_snapshot_del AFTER DELETE ON recipients_snapshot BEGIN UPDATE db_meta SET value = CAST(value AS INTEGER) + 1 WHERE key = 'revision'; END;

CREATE TRIGGER snapshot_recipients_on_send BEFORE UPDATE OF filed_on ON filings
WHEN OLD.filed_on IS NULL AND NEW.filed_on IS NOT NULL
BEGIN
    INSERT INTO recipients_snapshot (filing_id, recipient_id, capacity, party_id, name, email, address)
    SELECT NEW.id, r.id, r.capacity, r.party_id, r.name, r.email, r.address
      FROM filing_recipients fr JOIN recipients r ON r.id = fr.recipient_id
     WHERE fr.filing_id = NEW.id
       AND NOT EXISTS (SELECT 1 FROM recipients_snapshot s WHERE s.filing_id = NEW.id AND s.recipient_id = r.id);
END;

CREATE TRIGGER guard_filing_recipients_frozen_ins BEFORE INSERT ON filing_recipients
WHEN (SELECT filed_on IS NOT NULL OR retired_on IS NOT NULL FROM filings WHERE id = NEW.filing_id)
BEGIN SELECT RAISE(ABORT, 'a sent or retired Writing''s recipients do not change (#1307)'); END;

CREATE TRIGGER guard_filing_recipients_frozen_upd BEFORE UPDATE ON filing_recipients
WHEN (SELECT filed_on IS NOT NULL OR retired_on IS NOT NULL FROM filings WHERE id = OLD.filing_id)
  OR (SELECT filed_on IS NOT NULL OR retired_on IS NOT NULL FROM filings WHERE id = NEW.filing_id)
BEGIN SELECT RAISE(ABORT, 'a sent or retired Writing''s recipients do not change (#1307)'); END;

CREATE TRIGGER guard_filing_recipients_frozen_del BEFORE DELETE ON filing_recipients
WHEN (SELECT filed_on IS NOT NULL OR retired_on IS NOT NULL FROM filings WHERE id = OLD.filing_id)
BEGIN SELECT RAISE(ABORT, 'a sent or retired Writing''s recipients do not change (#1307)'); END;

UPDATE db_meta SET value = '44' WHERE key = 'schema_version';

-- MIGRATE 44 -> 45
-- The record tools are renamed with their gatekeeper skill (drafting-data,
-- 2026-10-01). guard_filings_parties_snapshot (v42) names both tools in its
-- refusal message, and a session that hits it is told which tool sets
-- filed_on, so the message must name tools that exist.
--
-- The trigger is dropped and created again, identical to v42's except that
-- the message names the two tools without a tool prefix, as /drafting-data's
-- record-sent and record-filed tools, so a later rename of the tool family
-- leaves the stored message true. No row changes and no revision moves.
DROP TRIGGER guard_filings_parties_snapshot;

CREATE TRIGGER guard_filings_parties_snapshot BEFORE UPDATE OF filed_on ON filings
WHEN OLD.filed_on IS NULL AND NEW.filed_on IS NOT NULL
 AND NOT EXISTS (SELECT 1 FROM parties_snapshot WHERE filing_id = NEW.id)
 AND EXISTS (SELECT 1 FROM parties WHERE proceeding_id = NEW.proceeding_id)
BEGIN SELECT RAISE(ABORT, 'a Writing''s filed_on is set by /drafting-data''s record-sent tool (a general Writing) or record-filed tool (any other), which first write the party rows it was sent with (party/counsel SSOT)'); END;

UPDATE db_meta SET value = '45' WHERE key = 'schema_version';

-- MIGRATE 45 -> 46
-- A failed scrutiny is recorded on the statement (Engineering/2. Plan/2026-10-02_
-- failed-scrutiny-outcome-plan.md). Until v46 verification held only 'verified'
-- and 'lead', so a research-lawyer return that the lead does not support the
-- proposition had nowhere to go, and the statement-line 🔬 (verification =
-- 'lead') proposed the same scrutiny again after the job completed.
--
-- 1. verification admits 'failed', the research lawyer's negative return. A
--    failed statement carries its finding in doubt, and a table CHECK refuses
--    a failed row with no doubt. statements_of_law is rebuilt create-copy-drop-
--    rename on the v25 hop's shape, every row and column copied unchanged (no
--    statement is 'failed' before this hop), and its three indexes and three
--    revision triggers are recreated after the rename.
--    guard_filing_law_proceeding_ins and _upd (v36) name statements_of_law in
--    their bodies, and a RENAME with such a trigger present fails SQLite's
--    schema re-parse once the old table is dropped, so both are dropped before
--    the rebuild and recreated verbatim after it (the v32 rule for filings).
--
-- 2. Two triggers reopen scrutiny when what was judged changes, on the v35
--    shape (IS NOT, so a same-value write changes nothing):
--    reopen_scrutiny_on_statement_change sets a failed statement back to
--    'lead' when its excerpt or pinpoint changes, and
--    reopen_scrutiny_on_proposition_change sets every failed statement of a
--    proposition back to 'lead' when the proposition's wording changes. A
--    single statement that changes the excerpt and records a new result still
--    ends 'lead'. Neither clears doubt, so the next scrutiny dispatch carries
--    the finding. Neither is a revision trigger. The inner UPDATE sets only
--    verification, which neither trigger watches, and fires
--    rev_statements_of_law_upd a second time, once per statement reset, which
--    is harmless: the revision moves twice, as under v35's trigger.
--
-- The hop moves no revision: the copy runs before the revision triggers exist.
PRAGMA foreign_keys = OFF;

DROP TRIGGER guard_filing_law_proceeding_ins;
DROP TRIGGER guard_filing_law_proceeding_upd;

CREATE TABLE statements_of_law_v46 (
    id                INTEGER PRIMARY KEY,
    proceeding_id     INTEGER NOT NULL REFERENCES proceedings(id),
    law_assertion_id  INTEGER REFERENCES law_assertions(id),
    authority_id      INTEGER NOT NULL REFERENCES authorities(id),
    pinpoint          TEXT,
    excerpt           TEXT,
    source            TEXT CHECK (source IN ('primary', 'secondary', 'tertiary')),
    doubt             TEXT,
    verification      TEXT NOT NULL CHECK (verification IN ('verified', 'lead', 'failed')),
    CHECK (verification <> 'failed' OR doubt IS NOT NULL)
);
INSERT INTO statements_of_law_v46 (id, proceeding_id, law_assertion_id, authority_id, pinpoint, excerpt, source, doubt, verification)
SELECT id, proceeding_id, law_assertion_id, authority_id, pinpoint, excerpt, source, doubt, verification
FROM statements_of_law;
DROP TABLE statements_of_law;
ALTER TABLE statements_of_law_v46 RENAME TO statements_of_law;
CREATE INDEX idx_statements_of_law_proceeding ON statements_of_law(proceeding_id);
CREATE INDEX idx_statements_of_law_assertion ON statements_of_law(law_assertion_id);
CREATE INDEX idx_statements_of_law_authority ON statements_of_law(authority_id);

PRAGMA foreign_keys = ON;

CREATE TRIGGER rev_statements_of_law_ins AFTER INSERT ON statements_of_law BEGIN UPDATE db_meta SET value = CAST(value AS INTEGER) + 1 WHERE key = 'revision'; END;
CREATE TRIGGER rev_statements_of_law_upd AFTER UPDATE ON statements_of_law BEGIN UPDATE db_meta SET value = CAST(value AS INTEGER) + 1 WHERE key = 'revision'; END;
CREATE TRIGGER rev_statements_of_law_del AFTER DELETE ON statements_of_law BEGIN UPDATE db_meta SET value = CAST(value AS INTEGER) + 1 WHERE key = 'revision'; END;

CREATE TRIGGER guard_filing_law_proceeding_ins BEFORE INSERT ON filing_law
WHEN (SELECT proceeding_id FROM filings WHERE id = NEW.filing_id)
  <> (SELECT proceeding_id FROM statements_of_law WHERE id = NEW.statement_id)
BEGIN SELECT RAISE(ABORT, 'a Writing links only a statement of law of its own proceeding'); END;
CREATE TRIGGER guard_filing_law_proceeding_upd BEFORE UPDATE OF filing_id, statement_id ON filing_law
WHEN (SELECT proceeding_id FROM filings WHERE id = NEW.filing_id)
  <> (SELECT proceeding_id FROM statements_of_law WHERE id = NEW.statement_id)
BEGIN SELECT RAISE(ABORT, 'a Writing links only a statement of law of its own proceeding'); END;

CREATE TRIGGER reopen_scrutiny_on_statement_change AFTER UPDATE OF excerpt, pinpoint ON statements_of_law
WHEN OLD.verification = 'failed'
 AND (NEW.excerpt IS NOT OLD.excerpt OR NEW.pinpoint IS NOT OLD.pinpoint)
BEGIN UPDATE statements_of_law SET verification = 'lead' WHERE id = NEW.id; END;

CREATE TRIGGER reopen_scrutiny_on_proposition_change AFTER UPDATE OF proposition ON law_assertions
WHEN NEW.proposition IS NOT OLD.proposition
BEGIN UPDATE statements_of_law SET verification = 'lead' WHERE law_assertion_id = NEW.id AND verification = 'failed'; END;

UPDATE db_meta SET value = '46' WHERE key = 'schema_version';

-- MIGRATE 46 -> 47
-- Scrutiny settles once (Engineering/1. Design/2026-10-02_scrutiny-settles-once-spec.md;
-- Engineering/2. Plan/2026-10-02_scrutiny-settles-once-plan.md). Under v46 a failed statement looped:
-- a reword, a re-point or a dispute set it back to 'lead', 🔬 derived again, and the research
-- lawyer was dispatched on the same objection. A scrutiny return now settles the pair it judged
-- (authority_id, pinpoint, excerpt), a failed one goes to a practitioner review job, and only that
-- review's confirmed close moves the row on.
--
-- 1. statements_of_law is rebuilt on the v46 hop's shape (guard_filing_law_proceeding_ins and _upd
--    dropped before the rebuild and recreated verbatim after it; the three indexes and three
--    revision triggers recreated after the rename). It gains settled_on and settled_note, the
--    practitioner's confirmed decision verbatim, and scrutinized_authority_id, scrutinized_pinpoint
--    and scrutinized_excerpt, the pair as last scrutinized or confirmed. scrutinized_authority_id
--    has no foreign key: it is a snapshot, as parties_snapshot.party_id is. verification admits
--    'settled', counsel's confirmed close over a finding, which is never 'verified'. A failed or
--    settled row must carry its finding in doubt, and a settled row its date, its note and its
--    snapshot, by CHECK. No CHECK ties a snapshot to 'verified'.
--
-- 2. Backfills. Every 'verified' row takes its current pair as its snapshot, in the copy. After the
--    rename, every 'lead' row whose doubt holds a finding in the v46 write's own words ("Scrutiny
--    failed ") becomes 'failed': the old triggers or a dispute had reset it, and it now gets one
--    review job and one confirmed close. A finding recorded in other words stays 'lead'.
--
-- 3. reopen_scrutiny_on_proposition_change is dropped first (it names statements_of_law in its body)
--    and not recreated: a proposition's wording is counsel's, and rewording it reopens nothing.
--    reopen_scrutiny_on_statement_change goes with the old table and is replaced by one trigger:
--    a 'verified' or 'settled' row whose authority_id, pinpoint or excerpt moves off its snapshot
--    returns to 'lead', so 🔬 derives once for the new pair. It reads NEW.verification, so a single
--    UPDATE that moves the pair and writes 'lead' or 'failed' itself fires nothing, and the
--    confirmation write, which moves the pair and the snapshot together, leaves NEW pair equal to
--    NEW snapshot and fires nothing either. A 'failed' row is never reset by an edit. IS NOT, so a
--    same-value write changes nothing. Recursive triggers are off, so its inner UPDATE, which sets
--    only verification, fires no trigger but rev_statements_of_law_upd, moving the revision a second
--    time, as under v46.
--
-- 4. Every 'failed' statement linked to a live Writing gets one practitioner review job
--    (references/jobs.md section 3d), unless a live one already names it. Linked means: its law
--    assertion is in submission_law for an unkilled submission that filing_submissions deploys on
--    an unretired Writing; or it is the excerpt_id of an order_sought_requires row whose order
--    filing_orders deploys on such a Writing; or filing_law links it to such a Writing. A failed
--    statement linked to none gets no job and stays 'failed'. The job is section 3d's fixed text,
--    kind 'work', filing_id NULL, priority one above the proceeding's highest queued unshelved job,
--    and billing_anchor that of the latest job holding the statement's Scrutinize key, else the
--    proceeding's latest anchored job. The engine refuses the hop beforehand, naming the
--    statements, when neither exists, since a 'work' job with no anchor fails the tickets CHECK.
--    Job rows are revision-exempt.
--
-- An open Scrutinize job or Proposal keyed on a row now 'failed' needs no statement here: 🔬 stops
-- deriving, the Proposal leaves the board, and a queued job holding that key fails /draft's
-- pre-claim check at the next Opening, which offers close as superseded (jobs.md section 9b).
--
-- The hop moves no revision: every row write runs before the revision triggers exist, and the job
-- tables carry none.
DROP TRIGGER reopen_scrutiny_on_proposition_change;

PRAGMA foreign_keys = OFF;

DROP TRIGGER guard_filing_law_proceeding_ins;
DROP TRIGGER guard_filing_law_proceeding_upd;

CREATE TABLE statements_of_law_v47 (
    id                       INTEGER PRIMARY KEY,
    proceeding_id            INTEGER NOT NULL REFERENCES proceedings(id),
    law_assertion_id         INTEGER REFERENCES law_assertions(id),
    authority_id             INTEGER NOT NULL REFERENCES authorities(id),
    pinpoint                 TEXT,
    excerpt                  TEXT,
    source                   TEXT CHECK (source IN ('primary', 'secondary', 'tertiary')),
    doubt                    TEXT,
    verification             TEXT NOT NULL CHECK (verification IN ('verified', 'lead', 'failed', 'settled')),
    settled_on               TEXT,
    settled_note             TEXT,
    scrutinized_authority_id INTEGER, -- a snapshot of authority_id; deliberately no FK (v47 hop)
    scrutinized_pinpoint     TEXT,
    scrutinized_excerpt      TEXT,
    CHECK (verification NOT IN ('failed', 'settled') OR doubt IS NOT NULL),
    CHECK (verification <> 'settled' OR (settled_on IS NOT NULL AND settled_note IS NOT NULL AND scrutinized_authority_id IS NOT NULL))
);
INSERT INTO statements_of_law_v47 (id, proceeding_id, law_assertion_id, authority_id, pinpoint, excerpt, source, doubt, verification,
                                   settled_on, settled_note, scrutinized_authority_id, scrutinized_pinpoint, scrutinized_excerpt)
SELECT id, proceeding_id, law_assertion_id, authority_id, pinpoint, excerpt, source, doubt, verification,
       NULL, NULL,
       CASE WHEN verification = 'verified' THEN authority_id END,
       CASE WHEN verification = 'verified' THEN pinpoint END,
       CASE WHEN verification = 'verified' THEN excerpt END
FROM statements_of_law;
DROP TABLE statements_of_law;
ALTER TABLE statements_of_law_v47 RENAME TO statements_of_law;
CREATE INDEX idx_statements_of_law_proceeding ON statements_of_law(proceeding_id);
CREATE INDEX idx_statements_of_law_assertion ON statements_of_law(law_assertion_id);
CREATE INDEX idx_statements_of_law_authority ON statements_of_law(authority_id);

UPDATE statements_of_law SET verification = 'failed' WHERE verification = 'lead' AND doubt LIKE '%Scrutiny failed %';

PRAGMA foreign_keys = ON;

CREATE TRIGGER rev_statements_of_law_ins AFTER INSERT ON statements_of_law BEGIN UPDATE db_meta SET value = CAST(value AS INTEGER) + 1 WHERE key = 'revision'; END;
CREATE TRIGGER rev_statements_of_law_upd AFTER UPDATE ON statements_of_law BEGIN UPDATE db_meta SET value = CAST(value AS INTEGER) + 1 WHERE key = 'revision'; END;
CREATE TRIGGER rev_statements_of_law_del AFTER DELETE ON statements_of_law BEGIN UPDATE db_meta SET value = CAST(value AS INTEGER) + 1 WHERE key = 'revision'; END;

CREATE TRIGGER guard_filing_law_proceeding_ins BEFORE INSERT ON filing_law
WHEN (SELECT proceeding_id FROM filings WHERE id = NEW.filing_id)
  <> (SELECT proceeding_id FROM statements_of_law WHERE id = NEW.statement_id)
BEGIN SELECT RAISE(ABORT, 'a Writing links only a statement of law of its own proceeding'); END;
CREATE TRIGGER guard_filing_law_proceeding_upd BEFORE UPDATE OF filing_id, statement_id ON filing_law
WHEN (SELECT proceeding_id FROM filings WHERE id = NEW.filing_id)
  <> (SELECT proceeding_id FROM statements_of_law WHERE id = NEW.statement_id)
BEGIN SELECT RAISE(ABORT, 'a Writing links only a statement of law of its own proceeding'); END;

CREATE TRIGGER reopen_scrutiny_on_statement_change AFTER UPDATE OF authority_id, pinpoint, excerpt ON statements_of_law
WHEN NEW.verification IN ('verified', 'settled')
 AND (NEW.authority_id IS NOT NEW.scrutinized_authority_id
   OR NEW.pinpoint IS NOT NEW.scrutinized_pinpoint
   OR NEW.excerpt IS NOT NEW.scrutinized_excerpt)
BEGIN UPDATE statements_of_law SET verification = 'lead' WHERE id = NEW.id; END;

CREATE TEMP TABLE review_jobs AS
SELECT sl.id AS statement_id, sl.proceeding_id, sl.law_assertion_id,
       'Review scrutiny finding: ' || a.style_of_cause_or_title || ' (statement ' || sl.id || ')' AS title,
       COALESCE(
         (SELECT t.billing_anchor FROM ticket_proposals p JOIN tickets t ON t.id = p.ticket_id
           WHERE p.proposal_key = 'scrutinize:statements_of_law:' || sl.id AND t.billing_anchor IS NOT NULL ORDER BY t.id DESC LIMIT 1),
         (SELECT t.billing_anchor FROM tickets t WHERE t.proceeding_id = sl.proceeding_id AND t.billing_anchor IS NOT NULL ORDER BY t.id DESC LIMIT 1)
       ) AS billing_anchor,
       COALESCE((SELECT MAX(priority) + 1 FROM tickets WHERE proceeding_id = sl.proceeding_id AND status = 'queued' AND rejected_at IS NULL), 0) AS priority
FROM statements_of_law sl JOIN authorities a ON a.id = sl.authority_id
WHERE sl.verification = 'failed'
  AND (EXISTS (SELECT 1 FROM submission_law sw
                 JOIN submissions s ON s.id = sw.submission_id AND s.killed_on IS NULL
                 JOIN filing_submissions fs ON fs.submission_id = s.id
                 JOIN filings f ON f.id = fs.filing_id AND f.retired_on IS NULL
                WHERE sw.law_assertion_id = sl.law_assertion_id)
    OR EXISTS (SELECT 1 FROM order_sought_requires r
                 JOIN filing_orders fo ON fo.order_sought_id = r.order_sought_id
                 JOIN filings f ON f.id = fo.filing_id AND f.retired_on IS NULL
                WHERE r.excerpt_id = sl.id)
    OR EXISTS (SELECT 1 FROM filing_law fl
                 JOIN filings f ON f.id = fl.filing_id AND f.retired_on IS NULL
                WHERE fl.statement_id = sl.id))
  AND NOT EXISTS (SELECT 1 FROM tickets t JOIN ticket_scope sc ON sc.ticket_id = t.id
                   WHERE t.status IN ('queued', 'wip') AND t.rejected_at IS NULL
                     AND t.title LIKE 'Review scrutiny finding: %'
                     AND sc.entity = 'statements_of_law' AND sc.entity_id = sl.id);

INSERT INTO tickets (proceeding_id, filing_id, title, intent, kind, priority, billing_anchor, created)
SELECT proceeding_id, NULL, title,
       'Counsel reviews the scrutinizer''s finding on this statement of law against the source and confirms, revises or drops the statement.',
       'work', priority, billing_anchor, strftime('%Y-%m-%dT%H:%M', 'now', 'localtime')
FROM review_jobs ORDER BY statement_id;

-- Each new job is the one queued job with its title that holds no step yet (jobs.md section 3c's
-- property); "(statement N)" makes the title unique per statement.
CREATE TEMP TABLE review_job_ids AS
SELECT t.id AS ticket_id, j.statement_id, j.law_assertion_id
FROM review_jobs j JOIN tickets t ON t.proceeding_id = j.proceeding_id AND t.title = j.title
WHERE t.status = 'queued' AND NOT EXISTS (SELECT 1 FROM ticket_steps st WHERE st.ticket_id = t.id);

INSERT INTO ticket_steps (ticket_id, ordinal, text)
SELECT ticket_id, 1, 'Review the finding against the source and confirm, revise or drop the statement' FROM review_job_ids ORDER BY ticket_id;
INSERT INTO ticket_scope (ticket_id, entity, entity_id)
SELECT ticket_id, 'statements_of_law', statement_id FROM review_job_ids ORDER BY ticket_id;
INSERT INTO ticket_scope (ticket_id, entity, entity_id)
SELECT ticket_id, 'law_assertions', law_assertion_id FROM review_job_ids WHERE law_assertion_id IS NOT NULL ORDER BY ticket_id;
INSERT INTO ticket_scope (ticket_id, entity, entity_id)
SELECT ticket_id, 'authorities', NULL FROM review_job_ids ORDER BY ticket_id;

DROP TABLE temp.review_job_ids;
DROP TABLE temp.review_jobs;

UPDATE db_meta SET value = '47' WHERE key = 'schema_version';

-- MIGRATE 47 -> 48
-- Counsel records that a contention needs no stated fact (terms-and-symbols.md, the 🧾 decision log,
-- 2026-10-04). Until v48 🧾 ("factual basis needed") read only whether a submission had a linked
-- fact, so a contention resting on law alone could clear it, its Proposal and its job only by
-- linking a fact it does not need. The decision is counsel's, in counsel's words, never inferred.
--
-- 1. submissions gains no_facts_needed_on, the date counsel decided, no_facts_needed_note, counsel's
--    reason verbatim, and no_facts_needed_contention, the wording the decision was made on. The three
--    are set together or not at all, by a CHECK on the third column, and no_facts_needed_on holds a
--    YYYY-MM-DD date, by a CHECK of its own. ADD COLUMN, no rebuild: every existing row reads NULL in
--    all three. The name avoids *settled*, v47's law-statement value.
--
-- 2. reset_no_facts_needed_on_contention_change clears all three when the contention's wording moves
--    off the wording the decision was made on. It reads NEW, on the v47 reopen trigger's shape, so a
--    same-value write changes nothing, and the decision write, which sets no_facts_needed_contention
--    = contention and leaves contention alone, fires nothing. Changing the wording back does not
--    restore the decision. Its inner UPDATE sets only the three columns, so it fires
--    rev_submissions_upd and nothing else, moving the revision a second time.
--
-- The hop moves no revision: it writes no row.
ALTER TABLE submissions ADD COLUMN no_facts_needed_on TEXT CHECK (no_facts_needed_on IS NULL OR no_facts_needed_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]');
ALTER TABLE submissions ADD COLUMN no_facts_needed_note TEXT;
ALTER TABLE submissions ADD COLUMN no_facts_needed_contention TEXT CHECK ((no_facts_needed_on IS NULL) = (no_facts_needed_note IS NULL) AND (no_facts_needed_on IS NULL) = (no_facts_needed_contention IS NULL));

CREATE TRIGGER reset_no_facts_needed_on_contention_change AFTER UPDATE OF contention ON submissions
WHEN NEW.no_facts_needed_on IS NOT NULL
 AND NEW.contention IS NOT NEW.no_facts_needed_contention
BEGIN UPDATE submissions SET no_facts_needed_on = NULL, no_facts_needed_note = NULL, no_facts_needed_contention = NULL WHERE id = NEW.id; END;

UPDATE db_meta SET value = '48' WHERE key = 'schema_version';

-- MIGRATE 48 -> 49
-- Counsel records that a Notice of Application or Application Response is to be filed with an
-- empty factual-basis Part (Form 32 Part 2, Form 33 Part 4), printed "Nil.". The assembler accepts
-- an empty factual-basis Part only under pure_law_confirmed: true, and until v49 nothing recorded
-- counsel's decision, so the filed-face emitters refused every such filing. The decision is
-- counsel's, in counsel's words, never inferred. It is a filing-level record, on the shape of
-- filings.authority_confirmed_on (v40), and is not v48's per-contention no_facts_needed_on, which
-- answers a different question.
--
-- 1. filings gains pure_law_on, the date counsel decided, and pure_law_note, counsel's reason
--    verbatim. The two are set together or not at all, by a CHECK on the second column, and
--    pure_law_on holds a YYYY-MM-DD date, by a CHECK of its own. ADD COLUMN, no rebuild: every
--    existing row reads NULL in both.
--
-- 2. Seven reset_pure_law_on_* triggers clear both columns when the filing gains something the
--    decision did not see:
--    - reset_pure_law_on_fact_ins: a filing_facts row pointed at the form is inserted;
--    - reset_pure_law_on_order_ins: a filing_orders row pointed at the form is inserted;
--    - reset_pure_law_on_order_override: a form filing_orders row's wording_override changes;
--    - reset_pure_law_on_order_wording: an order_sought row's wording changes, clearing every
--      filing that deploys that order to its form;
--    - reset_pure_law_on_submission_ins: a filing_submissions row pointed at the form is inserted;
--    - reset_pure_law_on_position_ins: a filing_positions row is inserted (a position taken);
--    - reset_pure_law_on_position_upd: a filing_positions row's position changes.
--    Each reads NEW against OLD where it watches an UPDATE, so a same-value write changes nothing.
--    Deletes reset nothing, and writing the two columns themselves fires none of the seven. Each
--    inner UPDATE sets only the two columns, so it fires rev_filings_upd and nothing else, moving
--    the revision a second time. The emitters refuse whenever form facts and the decision coexist,
--    so a write path these triggers miss still cannot reach the filed face.
--
-- The hop moves no revision: it writes no row.
ALTER TABLE filings ADD COLUMN pure_law_on TEXT CHECK (pure_law_on IS NULL OR pure_law_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]');
ALTER TABLE filings ADD COLUMN pure_law_note TEXT CHECK ((pure_law_on IS NULL) = (pure_law_note IS NULL));

CREATE TRIGGER reset_pure_law_on_fact_ins AFTER INSERT ON filing_facts
WHEN NEW.document = 'form' AND (SELECT pure_law_on FROM filings WHERE id = NEW.filing_id) IS NOT NULL
BEGIN UPDATE filings SET pure_law_on = NULL, pure_law_note = NULL WHERE id = NEW.filing_id; END;

CREATE TRIGGER reset_pure_law_on_order_ins AFTER INSERT ON filing_orders
WHEN NEW.document = 'form' AND (SELECT pure_law_on FROM filings WHERE id = NEW.filing_id) IS NOT NULL
BEGIN UPDATE filings SET pure_law_on = NULL, pure_law_note = NULL WHERE id = NEW.filing_id; END;

CREATE TRIGGER reset_pure_law_on_order_override AFTER UPDATE OF wording_override ON filing_orders
WHEN NEW.document = 'form' AND NEW.wording_override IS NOT OLD.wording_override
 AND (SELECT pure_law_on FROM filings WHERE id = NEW.filing_id) IS NOT NULL
BEGIN UPDATE filings SET pure_law_on = NULL, pure_law_note = NULL WHERE id = NEW.filing_id; END;

CREATE TRIGGER reset_pure_law_on_order_wording AFTER UPDATE OF wording ON order_sought
WHEN NEW.wording IS NOT OLD.wording
BEGIN UPDATE filings SET pure_law_on = NULL, pure_law_note = NULL
 WHERE pure_law_on IS NOT NULL
   AND id IN (SELECT filing_id FROM filing_orders WHERE order_sought_id = NEW.id AND document = 'form'); END;

CREATE TRIGGER reset_pure_law_on_submission_ins AFTER INSERT ON filing_submissions
WHEN NEW.document = 'form' AND (SELECT pure_law_on FROM filings WHERE id = NEW.filing_id) IS NOT NULL
BEGIN UPDATE filings SET pure_law_on = NULL, pure_law_note = NULL WHERE id = NEW.filing_id; END;

CREATE TRIGGER reset_pure_law_on_position_ins AFTER INSERT ON filing_positions
WHEN (SELECT pure_law_on FROM filings WHERE id = NEW.filing_id) IS NOT NULL
BEGIN UPDATE filings SET pure_law_on = NULL, pure_law_note = NULL WHERE id = NEW.filing_id; END;

CREATE TRIGGER reset_pure_law_on_position_upd AFTER UPDATE OF position ON filing_positions
WHEN NEW.position IS NOT OLD.position AND (SELECT pure_law_on FROM filings WHERE id = NEW.filing_id) IS NOT NULL
BEGIN UPDATE filings SET pure_law_on = NULL, pure_law_note = NULL WHERE id = NEW.filing_id; END;

UPDATE db_meta SET value = '49' WHERE key = 'schema_version';

-- MIGRATE 49 -> 50
-- A job records whether its title and intent were the session's proposal. The practitioner-words
-- gate accepted only the practitioner's own words until v50; it now also accepts a proposal the
-- session showed in its visible reply and the practitioner approved word for word with a bare yes,
-- and requires the write to say so.
--
-- 1. tickets gains session_proposed, 0 or 1 by CHECK, DEFAULT 0: 1 on a job whose title and intent
--    were a session proposal the practitioner approved word for word, 0 on one in the
--    practitioner's own words or fixed text. ADD COLUMN, no rebuild: every existing row reads 0.
--
-- tickets is revision-exempt and carries no triggers, so nothing is recreated. The hop moves no
-- revision: it writes no row.
ALTER TABLE tickets ADD COLUMN session_proposed INTEGER NOT NULL DEFAULT 0 CHECK (session_proposed IN (0, 1));

UPDATE db_meta SET value = '50' WHERE key = 'schema_version';

-- MIGRATE 50 -> 51
-- An authority keeps its note-up return's coverage line and qualifications. The treatment enum
-- records one finding and had no home for what the research lawyer read or what it qualified, so
-- until v51 a mixed or qualified return lost both.
--
-- 1. authorities gains treatment_note, nullable text: the note-up return's coverage line and each
--    qualification, verbatim, replaced (never appended) by each return, NULL when the return gives
--    neither. The treatment enum is unchanged. ADD COLUMN, no rebuild: every existing row reads
--    NULL.
--
-- The authorities triggers (rev_authorities_ins/upd/del and clear_authorities_currency_on_rename)
-- name no column this hop adds, so none is recreated. The hop moves no revision: it writes no row.
ALTER TABLE authorities ADD COLUMN treatment_note TEXT;

UPDATE db_meta SET value = '51' WHERE key = 'schema_version';

-- MIGRATE 51 -> 52
-- A job records the research answers saved for it. Until v52 a job's card showed nothing of a saved
-- answer, and its idle tag measured only from its lock and its done steps, so a job whose session
-- was still saving answers and capturing seeds read as idle and was offered for take-over.
--
-- 1. ticket_answers, one row per answer research_filing__save_answer saved for a job: ticket_id,
--    file_path (the saved file, relative to the matter root, from its `6. LAW` segment on, with
--    backslash separators, as documents.file_path is stored) and saved_at (the minute it was saved,
--    host local time). The save writes its row only while the job's lock is the saving session's.
--    Indexed on ticket_id.
--
-- ticket_answers joins the revision-exempt job tables and carries no triggers, now or ever: saving
-- an answer changes no substance, so it must never archive a mockup. The hop moves no revision: it
-- writes no row.
CREATE TABLE ticket_answers (
    id        INTEGER PRIMARY KEY,
    ticket_id INTEGER NOT NULL REFERENCES tickets(id),
    file_path TEXT NOT NULL,
    saved_at  TEXT NOT NULL
);

CREATE INDEX idx_ticket_answers_ticket ON ticket_answers(ticket_id);

UPDATE db_meta SET value = '52' WHERE key = 'schema_version';

-- MIGRATE 52 -> 53
-- Statute currency is recorded per cited provision, not only per instrument. One instrument-level
-- currency_status (v34) could not say "Rule 8-1 amended; Rules 9-6, 3-4 and 14-1 untouched", had no
-- value for a provision in force with an unconsolidated amendment not yet checked, and read
-- 'current' on a day an amendment effective after the consolidation's "current to" date had not
-- been read. authorities.currency_status stays the instrument's own result (shared/statute-
-- currency.md leg 1); this table holds each cited provision's (leg 3).
--
-- 1. provision_currency, one row per authority and provision. provision is the pinpoint exactly as
--    statements_of_law.pinpoint records it, so a statement reads the row whose authority_id and
--    provision match its own. currency_status is the provision's result; checked_on the date it was
--    recorded; current_to the consolidation's "current to" date; amended_on the effective date of
--    the newest amendment to the provision effective after current_to, NULL when there is none;
--    amendment_checked_on the date that amendment was checked against the provision, NULL until it
--    is. A CHECK refuses 'current' without current_to, and while amended_on is set and
--    amendment_checked_on is not: that provision is 'amendment-unchecked' until the amendment is
--    read.
--
-- 2. Revision triggers rev_provision_currency_ins/upd/del, since the general renderer's `terms`
--    projection reads the table.
--
-- 3. clear_provision_currency_on_rename deletes an authority's rows whenever its citation or
--    style_of_cause_or_title changes, as v35's trigger clears the instrument's result: each row was
--    a result for the enactment as then named.
--
-- Additive: a new table and four triggers. No existing row changes and the hop moves no revision.
CREATE TABLE provision_currency (
    id                   INTEGER PRIMARY KEY,
    authority_id         INTEGER NOT NULL REFERENCES authorities(id),
    provision            TEXT NOT NULL, -- the pinpoint exactly as statements_of_law.pinpoint records it
    currency_status      TEXT NOT NULL CHECK (currency_status IN ('current', 'amendment-unchecked', 'repealed', 'not-found', 'validation_unavailable')),
    checked_on           DATE NOT NULL,
    current_to           DATE, -- the consolidation's "current to" date
    amended_on           DATE, -- the newest amendment effective after current_to; NULL = none
    amendment_checked_on DATE, -- when that amendment was checked against the provision; NULL = not yet
    CHECK (currency_status <> 'current' OR (current_to IS NOT NULL AND (amended_on IS NULL OR amendment_checked_on IS NOT NULL))),
    UNIQUE (authority_id, provision)
);

CREATE TRIGGER rev_provision_currency_ins AFTER INSERT ON provision_currency BEGIN UPDATE db_meta SET value = CAST(value AS INTEGER) + 1 WHERE key = 'revision'; END;
CREATE TRIGGER rev_provision_currency_upd AFTER UPDATE ON provision_currency BEGIN UPDATE db_meta SET value = CAST(value AS INTEGER) + 1 WHERE key = 'revision'; END;
CREATE TRIGGER rev_provision_currency_del AFTER DELETE ON provision_currency BEGIN UPDATE db_meta SET value = CAST(value AS INTEGER) + 1 WHERE key = 'revision'; END;

CREATE TRIGGER clear_provision_currency_on_rename AFTER UPDATE OF citation, style_of_cause_or_title ON authorities
WHEN NEW.citation IS NOT OLD.citation OR NEW.style_of_cause_or_title IS NOT OLD.style_of_cause_or_title
BEGIN DELETE FROM provision_currency WHERE authority_id = NEW.id; END;

UPDATE db_meta SET value = '53' WHERE key = 'schema_version';

-- MIGRATE 53 -> 54
-- A deleted job is kept, not removed. Until v54 deleting a mistaken job deleted its tickets row and
-- every row pointing at it, so its number left an unexplained gap on the Job Board, nothing could
-- bring it back, and a job carrying a review comment or a saved answer could not be deleted at all.
--
-- 1. tickets gains deleted_at, nullable text: the minute the job was deleted, host local time, set
--    by the delete and cleared by the restore. Every child row stays where it is; every reader skips
--    a job whose deleted_at is set. Nullable with no CHECK, like rejected_at, so every guard is the
--    script's own. ADD COLUMN, no rebuild: every existing row reads NULL.
--
-- tickets is revision-exempt and carries no triggers, so nothing is recreated. The hop moves no
-- revision: it writes no row.
ALTER TABLE tickets ADD COLUMN deleted_at TEXT;

UPDATE db_meta SET value = '54' WHERE key = 'schema_version';

-- MIGRATE 54 -> 55
-- A job's plan is its steps. Until v55 tickets.plan held the approved steps again, joined into one
-- sentence, and the CHECK ((plan IS NULL) = (plan_approved_at IS NULL)) forced that copy on every
-- approval, so a Job Board card showed one plan three times: the intent, the step checklist and a
-- Plan row.
--
-- 1. tickets drops plan and that CHECK. plan_approved_at alone is the approval stamp, and the job's
--    ticket_steps rows are the approved plan. Every other column, CHECK, default and index is
--    carried over unchanged, the columns appended since v17 included (rejected_at,
--    superseded_marker_gone_at, session_proposed with its CHECK, deleted_at).
--
-- SQLite cannot drop a column a CHECK names, so the table is rebuilt create-copy-drop-rename with
-- foreign_keys OFF for the hop, exactly as the v17 hop rebuilt it: the old table is DROPPED (never
-- renamed), so the textual "REFERENCES tickets(id)" clauses of ticket_steps, ticket_scope,
-- ticket_blocks, ticket_conflicts, seeds (both columns), ticket_proposals, proposal_rejections,
-- review_points, ticket_answers and tickets.superseded_by re-bind to the rebuilt table by name. No
-- trigger names tickets and the table is revision-exempt, so nothing else is recreated. The hop
-- moves no revision.
PRAGMA foreign_keys = OFF;

CREATE TABLE tickets_v55 (
    id                        INTEGER PRIMARY KEY,
    proceeding_id             INTEGER NOT NULL REFERENCES proceedings(id),
    filing_id                 INTEGER REFERENCES filings(id),
    title                     TEXT NOT NULL,
    intent                    TEXT NOT NULL,
    status                    TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'wip', 'completed', 'superseded')),
    priority                  INTEGER NOT NULL DEFAULT 0,
    kind                      TEXT NOT NULL CHECK (kind IN ('work', 'charting')),
    billing_anchor            TEXT,
    locked_by                 TEXT,
    locked_at                 TEXT,
    plan_approved_at          TEXT,
    created                   TEXT NOT NULL,
    completed_at              TEXT,
    superseded_by             INTEGER REFERENCES tickets(id),
    rejected_at               TEXT,
    superseded_marker_gone_at TEXT,
    session_proposed          INTEGER NOT NULL DEFAULT 0 CHECK (session_proposed IN (0, 1)),
    deleted_at                TEXT,
    CHECK ((status = 'wip') = (locked_by IS NOT NULL)),
    CHECK ((locked_by IS NULL) = (locked_at IS NULL)),
    CHECK (superseded_by IS NULL OR status = 'superseded'),
    CHECK ((status = 'completed') = (completed_at IS NOT NULL)),
    CHECK (kind <> 'work' OR billing_anchor IS NOT NULL),
    CHECK (superseded_by IS NULL OR superseded_by <> id)
);
INSERT INTO tickets_v55 (id, proceeding_id, filing_id, title, intent, status, priority, kind, billing_anchor, locked_by, locked_at, plan_approved_at, created, completed_at, superseded_by, rejected_at, superseded_marker_gone_at, session_proposed, deleted_at)
SELECT id, proceeding_id, filing_id, title, intent, status, priority, kind, billing_anchor, locked_by, locked_at, plan_approved_at, created, completed_at, superseded_by, rejected_at, superseded_marker_gone_at, session_proposed, deleted_at FROM tickets;
DROP TABLE tickets;
ALTER TABLE tickets_v55 RENAME TO tickets;
CREATE INDEX idx_tickets_proceeding ON tickets(proceeding_id);
CREATE INDEX idx_tickets_filing ON tickets(filing_id);

PRAGMA foreign_keys = ON;

UPDATE db_meta SET value = '55' WHERE key = 'schema_version';

-- MIGRATE 55 -> 56
-- An affidavit's sworn exhibits (E2E 2026-10-05 finding 4.3). A fact's court_record_pinpoint can
-- cite an exhibit of a draft affidavit that the sworn version does not carry, and nothing re-checked
-- it once the affidavit was sworn.
--
-- 1. documents gains exhibit_letters: the exhibit letters of the sworn version, as a list of letters
--    and ranges ("A-J" or "A-J, L"). Set when execution is set; NULL only while the sworn exhibits
--    are unknown. 📌 on a court-record fact reads it: a sworn court record whose pinpoint cites a
--    letter it lacks, or whose exhibit_letters is NULL or unparseable, owes its pinpoint again.
--
-- Additive only: nullable TEXT, no CHECK, no rebuild. Existing rows start NULL, so a sworn court
-- record cited by exhibit letter shows 📌 until its letters are recorded (fail-visible). The hop
-- moves no revision.
ALTER TABLE documents ADD COLUMN exhibit_letters TEXT;

UPDATE db_meta SET value = '56' WHERE key = 'schema_version';

-- MIGRATE 56 -> 57
-- On-the-fly paragraph revision (/draft references/revise-on-the-fly.md). A practitioner may reword
-- one reviewed paragraph in any session, holding a job or not, and until v57 nothing recorded the
-- old and new text of a substance row or who authored the new text.
--
-- 1. paragraph_revisions: one row per revision decision on one of the six reviewed paragraph types
--    (facts.postulate, statements_of_fact.excerpt, law_assertions.proposition,
--    statements_of_law.excerpt, submissions.contention, order_sought.wording, or, for an order
--    whose Writing prints its own wording for it, that filing_orders row's wording_override,
--    entity_id being the filing_orders row's id). It records the text
--    before and after, the practitioner's proposed text, the model's alternative, the fidelity flags
--    shown (NULL or a JSON text), the choice made, who authored the new text, the session token and
--    the minute. Two CHECKs: the choice fixes the origin (only 'alternative' is the model's), and
--    'current' writes no new text. The practitioner-words gate reads every INSERT into it.
--
--    A move (swapping two Part 2 facts on a filing's form, /drafting-data references/
--    paragraph-revision.md §6) is recorded here too: entity 'filing_facts', entity_id the
--    filing_facts row's id, field 'ordinal', old_text and new_text the ordinals as text, choice
--    'move'. A move carries no wording, so proposed_text, alternative_text and review_flags are
--    NULL and old_text differs from new_text. Three more CHECKs fix this: 'move' is used for
--    filing_facts and nothing else, a filing_facts row has that shape, and every other entity
--    still requires proposed_text and alternative_text.
--
-- Append-only and revision-exempt, like review_approvals: no revision triggers, now or ever, and no
-- UPDATE or DELETE path anywhere. The substance UPDATE written beside it moves the revision through
-- that table's own triggers. Additive: the hop writes no row and moves no revision.
CREATE TABLE paragraph_revisions (
    id               INTEGER PRIMARY KEY,
    entity           TEXT NOT NULL CHECK (entity IN ('facts', 'statements_of_fact', 'law_assertions', 'statements_of_law', 'submissions', 'order_sought', 'filing_orders', 'filing_facts')),
    entity_id        INTEGER NOT NULL,
    field            TEXT NOT NULL,
    old_text         TEXT NOT NULL,
    new_text         TEXT NOT NULL,
    proposed_text    TEXT,
    alternative_text TEXT,
    review_flags     TEXT,
    choice           TEXT NOT NULL CHECK (choice IN ('current', 'proposed', 'alternative', 'other', 'move')),
    origin           TEXT NOT NULL CHECK (origin IN ('practitioner', 'model')),
    session_token    TEXT NOT NULL,
    created          TEXT NOT NULL,
    CHECK ((choice = 'alternative') = (origin = 'model')),
    CHECK (choice <> 'current' OR new_text = old_text),
    CHECK ((choice = 'move') = (entity = 'filing_facts')),
    CHECK (entity <> 'filing_facts' OR (field = 'ordinal' AND new_text <> old_text
           AND proposed_text IS NULL AND alternative_text IS NULL AND review_flags IS NULL)),
    CHECK (entity = 'filing_facts' OR (proposed_text IS NOT NULL AND alternative_text IS NOT NULL))
);

UPDATE db_meta SET value = '57' WHERE key = 'schema_version';

-- MIGRATE 57 -> 58
-- The v37 content freeze extended to a Writing's pointer lists. v37 froze a
-- sent or retired Writing's filing_law, filing_prose and filing_clauses, but
-- filing_facts, filing_submissions and filing_orders carried only revision
-- triggers, so an edit after sending could still change the fact order, the
-- submission list or the order list (and an order's wording_override) a
-- re-rendered mockup shows as sent. Nine guard triggers, shaped exactly like
-- v37's, refuse every insert, update and delete of a sent or retired
-- Writing's rows in the three tables, checking an update against both the
-- old and the new owning Writing. A drafting Writing's rows stay writable.
--
-- Killing a submission now removes its filing_submissions rows only from
-- drafting Writings: a Writing sent with the submission keeps it
-- (/drafting-data references/filing-checklists.md, "Killing a submission").
--
-- These nine join the triggers whose bodies name filings, so a future
-- create-copy-drop-rename rebuild of filings drops and recreates them, as the
-- 28 -> 29 hop did the exhibit guards.
--
-- Additive: nine triggers, no rebuild, no row changes, no revision moved.
CREATE TRIGGER guard_filing_facts_frozen_ins BEFORE INSERT ON filing_facts
WHEN (SELECT filed_on IS NOT NULL OR retired_on IS NOT NULL FROM filings WHERE id = NEW.filing_id)
BEGIN SELECT RAISE(ABORT, 'a sent or retired Writing''s facts do not change'); END;
CREATE TRIGGER guard_filing_facts_frozen_upd BEFORE UPDATE ON filing_facts
WHEN (SELECT filed_on IS NOT NULL OR retired_on IS NOT NULL FROM filings WHERE id = OLD.filing_id)
  OR (SELECT filed_on IS NOT NULL OR retired_on IS NOT NULL FROM filings WHERE id = NEW.filing_id)
BEGIN SELECT RAISE(ABORT, 'a sent or retired Writing''s facts do not change'); END;
CREATE TRIGGER guard_filing_facts_frozen_del BEFORE DELETE ON filing_facts
WHEN (SELECT filed_on IS NOT NULL OR retired_on IS NOT NULL FROM filings WHERE id = OLD.filing_id)
BEGIN SELECT RAISE(ABORT, 'a sent or retired Writing''s facts do not change'); END;

CREATE TRIGGER guard_filing_submissions_frozen_ins BEFORE INSERT ON filing_submissions
WHEN (SELECT filed_on IS NOT NULL OR retired_on IS NOT NULL FROM filings WHERE id = NEW.filing_id)
BEGIN SELECT RAISE(ABORT, 'a sent or retired Writing''s submissions do not change'); END;
CREATE TRIGGER guard_filing_submissions_frozen_upd BEFORE UPDATE ON filing_submissions
WHEN (SELECT filed_on IS NOT NULL OR retired_on IS NOT NULL FROM filings WHERE id = OLD.filing_id)
  OR (SELECT filed_on IS NOT NULL OR retired_on IS NOT NULL FROM filings WHERE id = NEW.filing_id)
BEGIN SELECT RAISE(ABORT, 'a sent or retired Writing''s submissions do not change'); END;
CREATE TRIGGER guard_filing_submissions_frozen_del BEFORE DELETE ON filing_submissions
WHEN (SELECT filed_on IS NOT NULL OR retired_on IS NOT NULL FROM filings WHERE id = OLD.filing_id)
BEGIN SELECT RAISE(ABORT, 'a sent or retired Writing''s submissions do not change'); END;

CREATE TRIGGER guard_filing_orders_frozen_ins BEFORE INSERT ON filing_orders
WHEN (SELECT filed_on IS NOT NULL OR retired_on IS NOT NULL FROM filings WHERE id = NEW.filing_id)
BEGIN SELECT RAISE(ABORT, 'a sent or retired Writing''s orders sought do not change'); END;
CREATE TRIGGER guard_filing_orders_frozen_upd BEFORE UPDATE ON filing_orders
WHEN (SELECT filed_on IS NOT NULL OR retired_on IS NOT NULL FROM filings WHERE id = OLD.filing_id)
  OR (SELECT filed_on IS NOT NULL OR retired_on IS NOT NULL FROM filings WHERE id = NEW.filing_id)
BEGIN SELECT RAISE(ABORT, 'a sent or retired Writing''s orders sought do not change'); END;
CREATE TRIGGER guard_filing_orders_frozen_del BEFORE DELETE ON filing_orders
WHEN (SELECT filed_on IS NOT NULL OR retired_on IS NOT NULL FROM filings WHERE id = OLD.filing_id)
BEGIN SELECT RAISE(ABORT, 'a sent or retired Writing''s orders sought do not change'); END;

UPDATE db_meta SET value = '58' WHERE key = 'schema_version';

-- MIGRATE 58 -> 59
-- A fact a submission rests on is placed in the form's facts Part
-- (Engineering/1. Design/2026-10-06_submission-facts-part3-placement-spec.md §4).
-- On a Notice of Application (facts Part 'part2') or an Application Response
-- ('part4'), a fact attached to a submission on the form (submission_facts)
-- but not placed in the form's facts Part (filing_facts, document 'form')
-- printed in full under the submission in the legal-basis Part. From this hop
-- the database places every such fact, and the legal-basis Part never prints
-- fact text. Only these two kinds: a BCCA stay response or factum uses the
-- same tables with 'part2' and prints attached facts under the submission by
-- design. Only drafting Writings (filed_on and retired_on both NULL).
--
-- 1. Four guards, created first because their messages are expressions,
--    which needs SQLite 3.47.0 or later: on an older library the hop fails at
--    its first statement and nothing of it is applied.
--    guard_filing_facts_attached_del and guard_filing_facts_attached_upd
--    refuse removing a placed fact (a delete, or a change of its filing_id,
--    fact_id, document or part) while it is attached to a submission on the
--    same form, naming the submission. ordinal stays writable, so the fact
--    swap (references/paragraph-revision.md §6) still runs.
--    guard_filing_submissions_fixed_upd refuses a change of a
--    filing_submissions row's document or filing_id, and
--    guard_submission_facts_upd every update of submission_facts: delete the
--    row and insert it again, so the placement triggers see it.
-- 2. Two placement triggers. place_facts_on_attach (a submission_facts
--    insert) and place_facts_on_deploy (a filing_submissions insert with
--    document 'form') add each attached fact to the facts Part of every
--    drafting Notice of Application or Application Response whose form
--    carries the submission, when it is not there, last (MAX(ordinal) + 1
--    across the Writing's form rows). Each also adds the fact's Written
--    Arguments pointer row (document 'written_argument', the same part, last
--    across the Writing's written_argument rows) when the Writing has none
--    for the fact, so a placed fact does not light 🧵. Never a pointer row for
--    the submission. A placed form row clears a recorded pure-law decision
--    through reset_pure_law_on_fact_ins, because the decision did not see the
--    fact, and every placed row moves the revision.
-- 3. The backfill: the same two rows for every drafting Notice of
--    Application and Application Response, ordered by the first form
--    position of a submission resting on the fact, then by fact id. The
--    engine refuses the hop first, naming the Writing, when the backfill
--    would place a fact on a Writing whose pure_law_on is set
--    (migrate_engine.py, _refuse_pure_law_placement).
--
-- Detaching a fact, or killing a submission, removes nothing from the facts
-- Part. Every placed row moves the revision, so mockups re-render.
CREATE TRIGGER guard_filing_facts_attached_del BEFORE DELETE ON filing_facts
WHEN OLD.document = 'form'
 AND (SELECT kind IN ('notice_of_application', 'application_response') FROM filings WHERE id = OLD.filing_id)
 AND EXISTS (SELECT 1 FROM filing_submissions fs JOIN submission_facts sf ON sf.submission_id = fs.submission_id
              WHERE fs.filing_id = OLD.filing_id AND fs.document = 'form' AND sf.fact_id = OLD.fact_id)
BEGIN SELECT RAISE(ABORT, 'fact ' || OLD.fact_id || ' is attached to submission '
  || (SELECT group_concat(submission_id, ', ') FROM (SELECT DISTINCT fs.submission_id FROM filing_submissions fs
        JOIN submission_facts sf ON sf.submission_id = fs.submission_id
       WHERE fs.filing_id = OLD.filing_id AND fs.document = 'form' AND sf.fact_id = OLD.fact_id ORDER BY fs.submission_id))
  || ' on Writing ' || OLD.filing_id || '''s form, so it stays in the form''s facts Part. Detach it from the submission first; detaching also drops it from the submission''s argument in the Written Arguments.'); END;

CREATE TRIGGER guard_filing_facts_attached_upd BEFORE UPDATE OF filing_id, fact_id, document, part ON filing_facts
WHEN (NEW.filing_id IS NOT OLD.filing_id OR NEW.fact_id IS NOT OLD.fact_id OR NEW.document IS NOT OLD.document OR NEW.part IS NOT OLD.part)
 AND OLD.document = 'form'
 AND (SELECT kind IN ('notice_of_application', 'application_response') FROM filings WHERE id = OLD.filing_id)
 AND EXISTS (SELECT 1 FROM filing_submissions fs JOIN submission_facts sf ON sf.submission_id = fs.submission_id
              WHERE fs.filing_id = OLD.filing_id AND fs.document = 'form' AND sf.fact_id = OLD.fact_id)
BEGIN SELECT RAISE(ABORT, 'fact ' || OLD.fact_id || ' is attached to submission '
  || (SELECT group_concat(submission_id, ', ') FROM (SELECT DISTINCT fs.submission_id FROM filing_submissions fs
        JOIN submission_facts sf ON sf.submission_id = fs.submission_id
       WHERE fs.filing_id = OLD.filing_id AND fs.document = 'form' AND sf.fact_id = OLD.fact_id ORDER BY fs.submission_id))
  || ' on Writing ' || OLD.filing_id || '''s form, so it stays in the form''s facts Part. Detach it from the submission first; detaching also drops it from the submission''s argument in the Written Arguments.'); END;

CREATE TRIGGER guard_filing_submissions_fixed_upd BEFORE UPDATE OF document, filing_id ON filing_submissions
WHEN NEW.document IS NOT OLD.document OR NEW.filing_id IS NOT OLD.filing_id
BEGIN SELECT RAISE(ABORT, 'filing_submissions row ' || OLD.id || ': a submission''s Writing and document do not change; delete the row and insert a new one'); END;

CREATE TRIGGER guard_submission_facts_upd BEFORE UPDATE ON submission_facts
BEGIN SELECT RAISE(ABORT, 'submission_facts row (submission ' || OLD.submission_id || ', fact ' || OLD.fact_id || '): an attachment does not change; detach the fact and attach the one wanted'); END;

CREATE TRIGGER place_facts_on_attach AFTER INSERT ON submission_facts
BEGIN
    INSERT INTO filing_facts (filing_id, fact_id, document, part, ordinal)
    SELECT f.id, NEW.fact_id, 'form', CASE f.kind WHEN 'notice_of_application' THEN 'part2' ELSE 'part4' END,
           (SELECT COALESCE(MAX(ff.ordinal), 0) + 1 FROM filing_facts ff WHERE ff.filing_id = f.id AND ff.document = 'form')
      FROM filings f
     WHERE f.kind IN ('notice_of_application', 'application_response') AND f.filed_on IS NULL AND f.retired_on IS NULL
       AND EXISTS (SELECT 1 FROM filing_submissions fs WHERE fs.filing_id = f.id AND fs.document = 'form' AND fs.submission_id = NEW.submission_id)
       AND NOT EXISTS (SELECT 1 FROM filing_facts ff WHERE ff.filing_id = f.id AND ff.document = 'form' AND ff.fact_id = NEW.fact_id
                          AND ff.part = CASE f.kind WHEN 'notice_of_application' THEN 'part2' ELSE 'part4' END);
    INSERT INTO filing_facts (filing_id, fact_id, document, part, ordinal)
    SELECT f.id, NEW.fact_id, 'written_argument', CASE f.kind WHEN 'notice_of_application' THEN 'part2' ELSE 'part4' END,
           (SELECT COALESCE(MAX(ff.ordinal), 0) + 1 FROM filing_facts ff WHERE ff.filing_id = f.id AND ff.document = 'written_argument')
      FROM filings f
     WHERE f.kind IN ('notice_of_application', 'application_response') AND f.filed_on IS NULL AND f.retired_on IS NULL
       AND EXISTS (SELECT 1 FROM filing_submissions fs WHERE fs.filing_id = f.id AND fs.document = 'form' AND fs.submission_id = NEW.submission_id)
       AND NOT EXISTS (SELECT 1 FROM filing_facts ff WHERE ff.filing_id = f.id AND ff.document = 'written_argument' AND ff.fact_id = NEW.fact_id);
END;

CREATE TRIGGER place_facts_on_deploy AFTER INSERT ON filing_submissions
WHEN NEW.document = 'form'
 AND (SELECT kind IN ('notice_of_application', 'application_response') AND filed_on IS NULL AND retired_on IS NULL FROM filings WHERE id = NEW.filing_id)
BEGIN
    INSERT INTO filing_facts (filing_id, fact_id, document, part, ordinal)
    SELECT NEW.filing_id, sf.fact_id, 'form', p.part,
           (SELECT COALESCE(MAX(ff.ordinal), 0) FROM filing_facts ff WHERE ff.filing_id = NEW.filing_id AND ff.document = 'form')
             + ROW_NUMBER() OVER (ORDER BY sf.fact_id)
      FROM submission_facts sf
      JOIN (SELECT CASE kind WHEN 'notice_of_application' THEN 'part2' ELSE 'part4' END AS part FROM filings WHERE id = NEW.filing_id) p
     WHERE sf.submission_id = NEW.submission_id
       AND NOT EXISTS (SELECT 1 FROM filing_facts ff WHERE ff.filing_id = NEW.filing_id AND ff.document = 'form' AND ff.fact_id = sf.fact_id AND ff.part = p.part);
    INSERT INTO filing_facts (filing_id, fact_id, document, part, ordinal)
    SELECT NEW.filing_id, sf.fact_id, 'written_argument', p.part,
           (SELECT COALESCE(MAX(ff.ordinal), 0) FROM filing_facts ff WHERE ff.filing_id = NEW.filing_id AND ff.document = 'written_argument')
             + ROW_NUMBER() OVER (ORDER BY sf.fact_id)
      FROM submission_facts sf
      JOIN (SELECT CASE kind WHEN 'notice_of_application' THEN 'part2' ELSE 'part4' END AS part FROM filings WHERE id = NEW.filing_id) p
     WHERE sf.submission_id = NEW.submission_id
       AND NOT EXISTS (SELECT 1 FROM filing_facts ff WHERE ff.filing_id = NEW.filing_id AND ff.document = 'written_argument' AND ff.fact_id = sf.fact_id);
END;

INSERT INTO filing_facts (filing_id, fact_id, document, part, ordinal)
SELECT a.filing_id, a.fact_id, 'form', a.part,
       (SELECT COALESCE(MAX(ff.ordinal), 0) FROM filing_facts ff WHERE ff.filing_id = a.filing_id AND ff.document = 'form')
         + ROW_NUMBER() OVER (PARTITION BY a.filing_id ORDER BY a.first_ordinal, a.fact_id)
  FROM (SELECT f.id AS filing_id, sf.fact_id, CASE f.kind WHEN 'notice_of_application' THEN 'part2' ELSE 'part4' END AS part,
               MIN(fs.ordinal) AS first_ordinal
          FROM filings f
          JOIN filing_submissions fs ON fs.filing_id = f.id AND fs.document = 'form'
          JOIN submission_facts sf ON sf.submission_id = fs.submission_id
         WHERE f.kind IN ('notice_of_application', 'application_response') AND f.filed_on IS NULL AND f.retired_on IS NULL
         GROUP BY f.id, sf.fact_id) a
 WHERE NOT EXISTS (SELECT 1 FROM filing_facts ff WHERE ff.filing_id = a.filing_id AND ff.document = 'form' AND ff.fact_id = a.fact_id AND ff.part = a.part);

INSERT INTO filing_facts (filing_id, fact_id, document, part, ordinal)
SELECT a.filing_id, a.fact_id, 'written_argument', a.part,
       (SELECT COALESCE(MAX(ff.ordinal), 0) FROM filing_facts ff WHERE ff.filing_id = a.filing_id AND ff.document = 'written_argument')
         + ROW_NUMBER() OVER (PARTITION BY a.filing_id ORDER BY a.first_ordinal, a.fact_id)
  FROM (SELECT f.id AS filing_id, sf.fact_id, CASE f.kind WHEN 'notice_of_application' THEN 'part2' ELSE 'part4' END AS part,
               MIN(fs.ordinal) AS first_ordinal
          FROM filings f
          JOIN filing_submissions fs ON fs.filing_id = f.id AND fs.document = 'form'
          JOIN submission_facts sf ON sf.submission_id = fs.submission_id
         WHERE f.kind IN ('notice_of_application', 'application_response') AND f.filed_on IS NULL AND f.retired_on IS NULL
         GROUP BY f.id, sf.fact_id) a
 WHERE NOT EXISTS (SELECT 1 FROM filing_facts ff WHERE ff.filing_id = a.filing_id AND ff.document = 'written_argument' AND ff.fact_id = a.fact_id);

UPDATE db_meta SET value = '59' WHERE key = 'schema_version';

-- MIGRATE 59 -> 60
-- Counsel records that a contention needs no stated law
-- (Engineering/1. Design/2026-10-06_application-paragraphs-spec.md §4.3). From
-- this version 📚 ("proposition needed") flags a submission with no linked
-- proposition (no submission_law row), the law-side twin of 🧾, and a
-- deliberately fact-only contention could clear it only by linking a
-- proposition it does not need. The decision is counsel's, in counsel's words,
-- never inferred. It mirrors v48's no-facts-needed record exactly.
--
-- 1. submissions gains no_law_needed_on, the date counsel decided,
--    no_law_needed_note, counsel's reason verbatim, and
--    no_law_needed_contention, the wording the decision was made on. The three
--    are set together or not at all, by a CHECK on the third column, and
--    no_law_needed_on holds a YYYY-MM-DD date, by a CHECK of its own. A second
--    CHECK on no_law_needed_on refuses a row carrying both this record and
--    v48's no_facts_needed_on: a contention with neither facts nor law is not
--    a submission. ADD COLUMN, no rebuild: every existing row reads NULL in
--    all three, so no existing row can break the second CHECK.
--
-- 2. reset_no_law_needed_on_contention_change clears all three when the
--    contention's wording moves off the wording the decision was made on, on
--    reset_no_facts_needed_on_contention_change's shape: a same-value write
--    changes nothing, the decision write fires nothing, and changing the
--    wording back does not restore the decision. Its inner UPDATE sets only
--    the three columns, so it fires rev_submissions_upd and nothing else,
--    moving the revision a second time.
--
-- The hop moves no revision: it writes no row.
ALTER TABLE submissions ADD COLUMN no_law_needed_on TEXT CHECK (no_law_needed_on IS NULL OR no_law_needed_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]') CHECK (no_law_needed_on IS NULL OR no_facts_needed_on IS NULL);
ALTER TABLE submissions ADD COLUMN no_law_needed_note TEXT;
ALTER TABLE submissions ADD COLUMN no_law_needed_contention TEXT CHECK ((no_law_needed_on IS NULL) = (no_law_needed_note IS NULL) AND (no_law_needed_on IS NULL) = (no_law_needed_contention IS NULL));

CREATE TRIGGER reset_no_law_needed_on_contention_change AFTER UPDATE OF contention ON submissions
WHEN NEW.no_law_needed_on IS NOT NULL
 AND NEW.contention IS NOT NEW.no_law_needed_contention
BEGIN UPDATE submissions SET no_law_needed_on = NULL, no_law_needed_note = NULL, no_law_needed_contention = NULL WHERE id = NEW.id; END;

UPDATE db_meta SET value = '60' WHERE key = 'schema_version';

-- MIGRATE 60 -> 61
-- Cheap checks of an authority's fit to its proposition, at record and reuse
-- time (Engineering/1. Design/2026-10-06_authority-fit-checks-spec.md). A
-- statement recorded a case as verified for a proposition about a provision
-- enacted years after the case, its excerpt being another court's words the
-- judgment quoted, with no pinpoint.
--
-- 1. statements_of_law gains excerpt_speaker: the source the judgment
--    attributes the excerpt to, when the words are not the court's own
--    ("Lord Diplock in <case>"). NULL is the court's own words, or not yet
--    determined. It prints as a "(quoting <source>)" tag on the mockup and is
--    withheld from the filed face.
--
-- 2. statements_of_law gains verified_on, the YYYY-MM-DD date the verified
--    write recorded the research lawyer's pass, for the reuse provenance line.
--    A row verified before v61 reads NULL: "date not recorded".
--
-- 3. provision_currency gains in_force_on, the YYYY-MM-DD date the provision
--    came into force, when the publisher's page shows it. The anachronism
--    check (🕰️) reads it before the year in the provision's citation.
--
-- 4. guard_verified_pinpoint_ins and guard_verified_pinpoint_upd refuse a
--    verified statement with no pinpoint. New writes only: the update guard
--    fires on a move into 'verified', so a row verified with no pinpoint
--    before v61 stays valid and every other edit of it still goes through.
--    Neither guards UPDATE OF pinpoint, so clearing a verified row's pinpoint
--    still reaches reopen_scrutiny_on_statement_change, which returns it to
--    'lead'.
--
-- ADD COLUMN, no rebuild: every existing row reads NULL in all three. The hop
-- moves no revision: it writes no row.
ALTER TABLE statements_of_law ADD COLUMN excerpt_speaker TEXT;
ALTER TABLE statements_of_law ADD COLUMN verified_on TEXT CHECK (verified_on IS NULL OR verified_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]');
ALTER TABLE provision_currency ADD COLUMN in_force_on TEXT CHECK (in_force_on IS NULL OR in_force_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]');

CREATE TRIGGER guard_verified_pinpoint_ins BEFORE INSERT ON statements_of_law
WHEN NEW.verification = 'verified' AND (NEW.pinpoint IS NULL OR TRIM(NEW.pinpoint) = '')
BEGIN SELECT RAISE(ABORT, 'a verified statement of law needs a pinpoint: record the pinpoint the research lawyer returned in the same write'); END;

CREATE TRIGGER guard_verified_pinpoint_upd BEFORE UPDATE OF verification ON statements_of_law
WHEN NEW.verification = 'verified' AND OLD.verification IS NOT 'verified'
 AND (NEW.pinpoint IS NULL OR TRIM(NEW.pinpoint) = '')
BEGIN SELECT RAISE(ABORT, 'a verified statement of law needs a pinpoint: record the pinpoint the research lawyer returned in the same write'); END;

UPDATE db_meta SET value = '61' WHERE key = 'schema_version';

-- MIGRATE 61 -> 62
-- Form 32 as substituted by B.C. Reg. 105/2026 (in force 2026-10-01): a
-- notice of application no longer fixes the hearing date. It says the hearing
-- is "on a date to be set by Notice of Hearing of Application" and states the
-- applicant's proposal: "The applicant(s) propose(s) that the matter will be
-- heard on [insert date, date range, or assize]."
--
-- hearing_details gains proposed_hearing: that proposal, free text as the
-- practitioner gives it (a date, a date range or an assize). hearing_date and
-- hearing_time keep meaning the hearing actually fixed, which is what the
-- lifecycle ("heard"), the imminent band and the hearing-date criterion read;
-- a proposal stored there would mark a filing heard when no hearing was set.
--
-- ADD COLUMN, no rebuild: every existing row reads NULL. The hop moves no
-- revision: it writes no row.
ALTER TABLE hearing_details ADD COLUMN proposed_hearing TEXT;

UPDATE db_meta SET value = '62' WHERE key = 'schema_version';

-- MIGRATE 62 -> 63
-- The practitioner records that a piece of evidence is inadmissible to prove the fact it is linked
-- to (Engineering/1. Design/2026-10-07_provable-facts-page-spec.md §9.1). Until v63 only
-- admissibility_note held anything, and it is a concern, not a decision: the evidence still drafts
-- and the practitioner may run the risk. The decision is the practitioner's, in their words, never
-- proposed or inferred by a session. The Provable Facts page strikes a fact only when every link it
-- has carries this record, unless the fact is on the court record or admitted by every opposing
-- party.
--
-- statements_of_fact gains inadmissible_on, the date the practitioner decided, and
-- inadmissible_note, their reason verbatim. The two are set together or not at all, and the note
-- holds words, never an empty or blank string, by a CHECK on the second column; inadmissible_on
-- holds a YYYY-MM-DD date, by a CHECK of its own. ADD COLUMN, no rebuild: every existing row reads
-- NULL in both.
--
-- The hop moves no revision: it writes no row.
ALTER TABLE statements_of_fact ADD COLUMN inadmissible_on TEXT CHECK (inadmissible_on IS NULL OR inadmissible_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]');
ALTER TABLE statements_of_fact ADD COLUMN inadmissible_note TEXT CHECK ((inadmissible_on IS NULL) = (inadmissible_note IS NULL) AND (inadmissible_note IS NULL OR trim(inadmissible_note) <> ''));

UPDATE db_meta SET value = '63' WHERE key = 'schema_version';

-- MIGRATE 63 -> 64
-- The practitioner strikes a proposition of law that does not matter to the case
-- (Engineering/1. Design/2026-10-07_raw-research-page-spec.md §10.2; Brahm, 2026-10-07: "When a legal
-- proposition doesn't matter to the case, the practitioner strikes the proposition."). Until v64
-- only submissions and authorities could be killed (v16, renamed v26), and a proposition had no
-- rejection of its own. The strike is the practitioner's act, never
-- proposed or inferred by a session, kept with its wording and statements so no later pass
-- re-proposes it, and restorable by clearing the date. The Raw Research page strikes a struck
-- proposition's card, as it strikes a statement whose authority is killed.
--
-- law_assertions gains killed_on, the date the practitioner struck it, a YYYY-MM-DD date by a
-- CHECK. ADD COLUMN, no rebuild: every existing row reads NULL.
--
-- The hop moves no revision: it writes no row.
ALTER TABLE law_assertions ADD COLUMN killed_on TEXT CHECK (killed_on IS NULL OR killed_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]');

UPDATE db_meta SET value = '64' WHERE key = 'schema_version';

-- MIGRATE 64 -> 65
-- The practitioner links a rebuttal to the counter-arguments it answers, for the Arguments view
-- page (shared/html-pages.md; Brahm, 2026-10-08). A rebuttal is a submission held in reserve,
-- derived as before, never stored; a counter-argument is an opposing point (raised) or an
-- anticipated point (predicted). One rebuttal may answer a set of counter-arguments, and one
-- counter-argument may be answered by several rebuttals, so each kind gets a many-to-many table.
--
-- The links are advisory: neither complete nor exhaustive. Nothing reads them as coverage. A
-- counter-argument with no link is not unanswered, and a link never clears the ↩️ marker, which
-- still reads opposing_points.answered_by_submission_id alone. anticipated_points stays undeployed
-- and outside 🂡's predicate (#390): a link points at a prediction, it does not deploy one.
--
-- Both tables are substance, so each carries the three revision triggers, as submission_law does:
-- a new link re-renders the page.
--
-- Additive: two tables and their triggers, no rebuild. The hop moves no revision: it writes no row.
CREATE TABLE submission_rebuts_opposing_points (
    submission_id     INTEGER NOT NULL REFERENCES submissions(id),
    opposing_point_id INTEGER NOT NULL REFERENCES opposing_points(id),
    PRIMARY KEY (submission_id, opposing_point_id)
);

CREATE TRIGGER rev_submission_rebuts_opposing_points_ins AFTER INSERT ON submission_rebuts_opposing_points BEGIN UPDATE db_meta SET value = CAST(value AS INTEGER) + 1 WHERE key = 'revision'; END;
CREATE TRIGGER rev_submission_rebuts_opposing_points_upd AFTER UPDATE ON submission_rebuts_opposing_points BEGIN UPDATE db_meta SET value = CAST(value AS INTEGER) + 1 WHERE key = 'revision'; END;
CREATE TRIGGER rev_submission_rebuts_opposing_points_del AFTER DELETE ON submission_rebuts_opposing_points BEGIN UPDATE db_meta SET value = CAST(value AS INTEGER) + 1 WHERE key = 'revision'; END;

CREATE TABLE submission_rebuts_anticipated_points (
    submission_id        INTEGER NOT NULL REFERENCES submissions(id),
    anticipated_point_id INTEGER NOT NULL REFERENCES anticipated_points(id),
    PRIMARY KEY (submission_id, anticipated_point_id)
);

CREATE TRIGGER rev_submission_rebuts_anticipated_points_ins AFTER INSERT ON submission_rebuts_anticipated_points BEGIN UPDATE db_meta SET value = CAST(value AS INTEGER) + 1 WHERE key = 'revision'; END;
CREATE TRIGGER rev_submission_rebuts_anticipated_points_upd AFTER UPDATE ON submission_rebuts_anticipated_points BEGIN UPDATE db_meta SET value = CAST(value AS INTEGER) + 1 WHERE key = 'revision'; END;
CREATE TRIGGER rev_submission_rebuts_anticipated_points_del AFTER DELETE ON submission_rebuts_anticipated_points BEGIN UPDATE db_meta SET value = CAST(value AS INTEGER) + 1 WHERE key = 'revision'; END;

UPDATE db_meta SET value = '65' WHERE key = 'schema_version';

-- MIGRATE 65 -> 66
-- A session ranks every open loose thread best to worst for follow-up, for the Loose Ideas view
-- page and the board_card loose_threads lane (shared/html-pages.md; Brahm, 2026-10-08). seeds
-- gains rank, 1 the best to follow up; rank_group, one of /draft loose-thread triage's seven
-- content groups as a slug; and rank_reason, one line that states no law and never names time
-- remaining or a deadline. All three NULL is unranked: a thread captured after the last ranking
-- stays unranked until the next one, so the capture write is unchanged.
--
-- Ranking orders, it never removes: it deletes no row and never sets charted_into. A weak
-- thread leaves only by the existing drop write, on the practitioner's word.
--
-- seeds is job process state (ADR 0009), so the columns carry no revision triggers.
--
-- The three are set together or all NULL: rank_reason's CHECK ties them, so a partial write
-- cannot leave a ranked thread with no group or no reason.
--
-- Additive: three ADD COLUMNs, no rebuild; every existing row reads NULL, unranked. The hop
-- moves no revision: it writes no row.
ALTER TABLE seeds ADD COLUMN rank INTEGER CHECK (rank IS NULL OR rank >= 1);
ALTER TABLE seeds ADD COLUMN rank_group TEXT CHECK (rank_group IS NULL OR rank_group IN ('decision','tooling','housekeeping','research','authority','evidence','other'));
ALTER TABLE seeds ADD COLUMN rank_reason TEXT CHECK ((rank IS NULL) = (rank_group IS NULL) AND (rank IS NULL) = (rank_reason IS NULL));

UPDATE db_meta SET value = '66' WHERE key = 'schema_version';

-- MIGRATE 66 -> 67
-- A draft that is not a Writing attaches to one Job Board (ADR 0042; Brahm, 2026-10-08). A client
-- letter (/draft letters.md section 10) and a reply on the reply route (ADR 0040) have no Writing
-- row, so until v67 neither was on any board. board_attachments points one at a board: a client
-- letter by its folder, a reply by its file. `path` is in documents.file_path's stored form,
-- relative to the matter root with backslash separators (references/document-paths.md), and is
-- UNIQUE, so a draft is on one board at a time. `filing_id` names a Writing's board; NULL names the
-- proceeding's own board, which exists only while the proceeding has no Writing (ADR 0018).
-- `attached_on` is the date attached, YYYY-MM-DD.
--
-- The row holds the path and the board, nothing else: no title, status or body text. The Job
-- Board reads a client letter's counsel's-review status from its review draft's first line when it
-- renders, and never stores it. A path is not solicitor-client communication, so ADR 0004's rule
-- that such material has no column stands.
--
-- Moving is an UPDATE of filing_id (and proceeding_id); detaching is a DELETE, which leaves the
-- files where they are. A Writing never moves (ADR 0042 D1).
--
-- Guards:
--   guard_board_attachments_live_ins/_upd: never a retired Writing, which has no board.
--   guard_board_attachments_proceeding_ins/_upd: only a Writing of the row's own proceeding.
--   guard_board_attachments_pre_filing_ins/_upd: a proceeding's own board (filing_id NULL) only
--     while the proceeding has no Writing, live or retired: once it has one, that board is gone
--     (fetchPreFilingProceedings). drafting_data__create_writing moves a row written before the
--     proceeding's first Writing onto that Writing in the same transaction; a row with no Writing
--     that remains anyway shows only on the proceeding's lowest-id live Writing's board.
--   guard_filings_retire_attached: a Writing is not retired while a row names it, or while it is
--     the last live Writing of a proceeding holding a row with no filing, either of which would
--     leave a draft on no board. Retirement first moves or detaches each one (ADR 0042 D4). A
--     future `filings` rebuild drops and recreates it with the other triggers that name `filings`.
--
-- Like the job tables (ADR 0009), board_attachments carries no revision triggers: attaching
-- changes no mockup, only the Job Board pages, which every page write reads afresh.
--
-- Additive: one table and seven triggers, no rebuild. The hop moves no revision: it writes no row.
CREATE TABLE board_attachments (
    id            INTEGER PRIMARY KEY,
    proceeding_id INTEGER NOT NULL REFERENCES proceedings(id),
    filing_id     INTEGER REFERENCES filings(id),
    path          TEXT NOT NULL UNIQUE,
    kind          TEXT NOT NULL CHECK (kind IN ('client_letter','reply')),
    attached_on   TEXT NOT NULL
);

CREATE TRIGGER guard_board_attachments_live_ins BEFORE INSERT ON board_attachments
WHEN NEW.filing_id IS NOT NULL AND (SELECT retired_on FROM filings WHERE id = NEW.filing_id) IS NOT NULL
BEGIN SELECT RAISE(ABORT, 'a retired Writing has no Job Board: attach the draft to a live Writing''s board (ADR 0042)'); END;

CREATE TRIGGER guard_board_attachments_live_upd BEFORE UPDATE OF proceeding_id, filing_id ON board_attachments
WHEN NEW.filing_id IS NOT NULL AND (SELECT retired_on FROM filings WHERE id = NEW.filing_id) IS NOT NULL
BEGIN SELECT RAISE(ABORT, 'a retired Writing has no Job Board: attach the draft to a live Writing''s board (ADR 0042)'); END;

CREATE TRIGGER guard_board_attachments_proceeding_ins BEFORE INSERT ON board_attachments
WHEN NEW.filing_id IS NOT NULL AND (SELECT proceeding_id FROM filings WHERE id = NEW.filing_id) IS NOT NEW.proceeding_id
BEGIN SELECT RAISE(ABORT, 'an attachment names a Writing of its own proceeding (ADR 0042)'); END;

CREATE TRIGGER guard_board_attachments_proceeding_upd BEFORE UPDATE OF proceeding_id, filing_id ON board_attachments
WHEN NEW.filing_id IS NOT NULL AND (SELECT proceeding_id FROM filings WHERE id = NEW.filing_id) IS NOT NEW.proceeding_id
BEGIN SELECT RAISE(ABORT, 'an attachment names a Writing of its own proceeding (ADR 0042)'); END;

CREATE TRIGGER guard_board_attachments_pre_filing_ins BEFORE INSERT ON board_attachments
WHEN NEW.filing_id IS NULL AND EXISTS (SELECT 1 FROM filings WHERE proceeding_id = NEW.proceeding_id)
BEGIN SELECT RAISE(ABORT, 'a proceeding with a Writing has no board of its own: attach the draft to a live Writing''s board (ADR 0042)'); END;

CREATE TRIGGER guard_board_attachments_pre_filing_upd BEFORE UPDATE OF proceeding_id, filing_id ON board_attachments
WHEN NEW.filing_id IS NULL AND EXISTS (SELECT 1 FROM filings WHERE proceeding_id = NEW.proceeding_id)
BEGIN SELECT RAISE(ABORT, 'a proceeding with a Writing has no board of its own: attach the draft to a live Writing''s board (ADR 0042)'); END;

CREATE TRIGGER guard_filings_retire_attached BEFORE UPDATE OF retired_on ON filings
WHEN OLD.retired_on IS NULL AND NEW.retired_on IS NOT NULL
 AND (EXISTS (SELECT 1 FROM board_attachments WHERE filing_id = NEW.id)
      OR (EXISTS (SELECT 1 FROM board_attachments WHERE filing_id IS NULL AND proceeding_id = NEW.proceeding_id)
          AND NOT EXISTS (SELECT 1 FROM filings WHERE proceeding_id = NEW.proceeding_id AND id <> NEW.id AND retired_on IS NULL)))
BEGIN SELECT RAISE(ABORT, 'a draft is attached to this Writing''s Job Board: move or detach each attachment before retiring it (ADR 0042)'); END;

UPDATE db_meta SET value = '67' WHERE key = 'schema_version';

-- MIGRATE 67 -> 68
-- The practitioner defers a loose thread indefinitely from the Loose Threads page's Defer button
-- (Brahm, 2026-10-08). seeds gains deferred_at, the minute deferred, YYYY-MM-DDTHH:MM local time;
-- NULL is not deferred. Deferring sets a thread aside: it stays open, keeps its rank, and is
-- never deleted or outlined by it. The page writes it through the data server's localhost
-- listener; a session writes it by the raw idiom in references/jobs-run.md section 8.
--
-- seeds is job process state (ADR 0009), so the column carries no revision trigger.
--
-- Additive: one ADD COLUMN, no rebuild; every existing row reads NULL, not deferred. The hop
-- moves no revision: it writes no row.
ALTER TABLE seeds ADD COLUMN deferred_at TEXT;

UPDATE db_meta SET value = '68' WHERE key = 'schema_version';

-- MIGRATE 68 -> 69
-- Counsel suppresses one non-waivable marker on one line (Brahm, 2026-10-08). The requirement stays:
-- the mockup prints 🤫 in its place, and the board counts the item as met. A row is the practitioner's
-- decision: suppressed_on, the date, and note, their words verbatim (filing-checklists.md §6).
-- item is the line's text the decision was made on. The key is (marker, keyed_table, keyed_id); for
-- now the CHECKs admit only the fact-side 👤, which renders once per fact, flat across parties.
--
-- reset_marker_suppressions_fact_change deletes a fact's suppression when its postulate moves off
-- item, so rewording the line lapses the decision, as v48's reset does; changing the wording back
-- does not restore it. clear_marker_suppressions_fact_del deletes it with the fact.
--
-- The table is a counsel's-review record that changes the mockup, so it moves the revision, as v48's
-- columns do.
--
-- Additive: one new table, no rebuild. The hop moves no revision: it writes no row.
CREATE TABLE marker_suppressions (
    marker        TEXT NOT NULL CHECK (marker IN ('👤')),
    keyed_table   TEXT NOT NULL CHECK (keyed_table IN ('facts')),
    keyed_id      INTEGER NOT NULL,
    item          TEXT NOT NULL,
    suppressed_on TEXT NOT NULL CHECK (suppressed_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
    note          TEXT NOT NULL CHECK (trim(note) <> ''),
    PRIMARY KEY (marker, keyed_table, keyed_id)
);

CREATE TRIGGER reset_marker_suppressions_fact_change AFTER UPDATE OF postulate ON facts
BEGIN DELETE FROM marker_suppressions WHERE keyed_table = 'facts' AND keyed_id = NEW.id AND item IS NOT NEW.postulate; END;

CREATE TRIGGER clear_marker_suppressions_fact_del AFTER DELETE ON facts
BEGIN DELETE FROM marker_suppressions WHERE keyed_table = 'facts' AND keyed_id = OLD.id; END;

CREATE TRIGGER rev_marker_suppressions_ins AFTER INSERT ON marker_suppressions BEGIN UPDATE db_meta SET value = CAST(value AS INTEGER) + 1 WHERE key = 'revision'; END;
CREATE TRIGGER rev_marker_suppressions_upd AFTER UPDATE ON marker_suppressions BEGIN UPDATE db_meta SET value = CAST(value AS INTEGER) + 1 WHERE key = 'revision'; END;
CREATE TRIGGER rev_marker_suppressions_del AFTER DELETE ON marker_suppressions BEGIN UPDATE db_meta SET value = CAST(value AS INTEGER) + 1 WHERE key = 'revision'; END;

UPDATE db_meta SET value = '69' WHERE key = 'schema_version';

-- MIGRATE 69 -> 70
-- Ranking first restates each open loose thread as a job description, then ranks the jobs
-- (/draft loose-thread triage Step 2; Brahm, 2026-10-08). seeds gains rank_job: the work the
-- thread asks for, in actionable form, written by the ranking session together with rank,
-- rank_group and rank_reason. It restates only what the thread says: no position, figure,
-- statement of law, recommendation, or research question worded beyond the thread's own words,
-- and, like rank_reason, never time remaining or a deadline. idea is never overwritten: it stays
-- the verbatim capture, and the Loose Threads page shows it under the description.
--
-- A session-written description is not the practitioner's wording. When the thread is outlined
-- into a job, the practitioner-words gate still applies, unless the practitioner corrected or
-- adopted the description.
--
-- seeds is job process state (ADR 0009), so the column carries no revision trigger.
--
-- The CHECK is one-way: a description needs a rank, but a ranked thread may lack one. SQLite tests
-- an added column's CHECK against existing rows, so tying all four would fail on every database
-- already ranked. A thread ranked before v70 keeps its rank and reads NULL here until the next
-- ranking, which writes all four; its confirm-read counts any ranked thread still without one.
--
-- Additive: one ADD COLUMN, no rebuild; every existing row reads NULL. The hop moves no revision:
-- it writes no row.
ALTER TABLE seeds ADD COLUMN rank_job TEXT CHECK (rank_job IS NULL OR rank IS NOT NULL);

UPDATE db_meta SET value = '70' WHERE key = 'schema_version';

-- MIGRATE 70 -> 71
-- A rhetorical paragraph: a numbered paragraph of persuasion from the record that fits no other
-- type (Brahm, 2026-10-08). The triggering case was a paragraph characterising the opposing party's
-- pleading, which had nowhere to live and was stored as a fact in a form's factual-basis part. It is
-- the deliberate outlet for what the design did not anticipate, so the database refuses none for a
-- missing link. A paragraph-kind column on facts or submissions stays rejected (2026-10-06): it would
-- drag their markers onto it.
--
-- 1. rhetorical_paragraphs: proceeding-scoped substance, like a submission. wording is the text
--    counsel reviews (review.md, snapshot json_object('wording', wording)). states_law and
--    states_fact are the drafter's record of whether the wording states law and whether it states
--    fact, NOT NULL with no default so every write states them, and never reset by a trigger,
--    because zeroing them on a wording change would silently clear the advice. They drive two
--    advisory mockup tags, never a refusal (filing-checklists.md §15).
-- 2. Five optional link tables: rhetorical_paragraph_submissions, _opposing_points, _facts, _law,
--    and rhetorical_paragraph_record, a record cite by document, pinpoint and excerpt with no
--    witness, the shape of an express clause. The links are advisory, never coverage, as v65's are:
--    a link to an opposing point never clears ↩️, which still reads
--    opposing_points.answered_by_submission_id alone, and a link to a submission never supplies its
--    🧾 or 📚 basis, which still read submission_facts and submission_law alone.
-- 3. filing_rhetoric: the placement on one advocacy document of one Writing. part names the host
--    part (facts, submissions or orders) and ordinal is a position on that part's own pointer
--    ordinals, so the paragraph prints after the host item at that ordinal with no anchor key: when
--    the host item goes, it prints after the next lower one, never hidden. Deployed by no document
--    of any filing of the proceeding, a rhetorical paragraph is held in reserve 🂡, as a submission
--    is (#959). Frozen on a sent or retired Writing, as v58 froze the other pointer lists. A form
--    placement clears a recorded pure-law decision, as a form submission does.
-- 4. paragraph_revisions gains the entity 'rhetorical_paragraphs' (field 'wording'), so the
--    on-the-fly route revises it. SQLite cannot ALTER a CHECK, so the table is rebuilt
--    create-copy-drop-rename with every row and every other CHECK carried over verbatim. It stays
--    append-only and revision-exempt: no triggers, before or after.
--
-- Every new table is substance and carries the three revision triggers. Abandoning a rhetorical
-- paragraph is a scripted DELETE of its placements, links and row; no killed_on.
--
-- Additive apart from the paragraph_revisions rebuild, which changes no row. The hop moves no
-- revision: it writes no substance row.
CREATE TABLE rhetorical_paragraphs (
    id            INTEGER PRIMARY KEY,
    proceeding_id INTEGER NOT NULL REFERENCES proceedings(id),
    wording       TEXT NOT NULL,
    states_law    INTEGER NOT NULL CHECK (states_law IN (0, 1)),
    states_fact   INTEGER NOT NULL CHECK (states_fact IN (0, 1))
);
CREATE INDEX idx_rhetorical_paragraphs_proceeding ON rhetorical_paragraphs(proceeding_id);

CREATE TRIGGER rev_rhetorical_paragraphs_ins AFTER INSERT ON rhetorical_paragraphs BEGIN UPDATE db_meta SET value = CAST(value AS INTEGER) + 1 WHERE key = 'revision'; END;
CREATE TRIGGER rev_rhetorical_paragraphs_upd AFTER UPDATE ON rhetorical_paragraphs BEGIN UPDATE db_meta SET value = CAST(value AS INTEGER) + 1 WHERE key = 'revision'; END;
CREATE TRIGGER rev_rhetorical_paragraphs_del AFTER DELETE ON rhetorical_paragraphs BEGIN UPDATE db_meta SET value = CAST(value AS INTEGER) + 1 WHERE key = 'revision'; END;

CREATE TABLE rhetorical_paragraph_submissions (
    rhetorical_paragraph_id INTEGER NOT NULL REFERENCES rhetorical_paragraphs(id),
    submission_id           INTEGER NOT NULL REFERENCES submissions(id),
    PRIMARY KEY (rhetorical_paragraph_id, submission_id)
);

CREATE TRIGGER rev_rhetorical_paragraph_submissions_ins AFTER INSERT ON rhetorical_paragraph_submissions BEGIN UPDATE db_meta SET value = CAST(value AS INTEGER) + 1 WHERE key = 'revision'; END;
CREATE TRIGGER rev_rhetorical_paragraph_submissions_upd AFTER UPDATE ON rhetorical_paragraph_submissions BEGIN UPDATE db_meta SET value = CAST(value AS INTEGER) + 1 WHERE key = 'revision'; END;
CREATE TRIGGER rev_rhetorical_paragraph_submissions_del AFTER DELETE ON rhetorical_paragraph_submissions BEGIN UPDATE db_meta SET value = CAST(value AS INTEGER) + 1 WHERE key = 'revision'; END;

CREATE TABLE rhetorical_paragraph_opposing_points (
    rhetorical_paragraph_id INTEGER NOT NULL REFERENCES rhetorical_paragraphs(id),
    opposing_point_id       INTEGER NOT NULL REFERENCES opposing_points(id),
    PRIMARY KEY (rhetorical_paragraph_id, opposing_point_id)
);

CREATE TRIGGER rev_rhetorical_paragraph_opposing_points_ins AFTER INSERT ON rhetorical_paragraph_opposing_points BEGIN UPDATE db_meta SET value = CAST(value AS INTEGER) + 1 WHERE key = 'revision'; END;
CREATE TRIGGER rev_rhetorical_paragraph_opposing_points_upd AFTER UPDATE ON rhetorical_paragraph_opposing_points BEGIN UPDATE db_meta SET value = CAST(value AS INTEGER) + 1 WHERE key = 'revision'; END;
CREATE TRIGGER rev_rhetorical_paragraph_opposing_points_del AFTER DELETE ON rhetorical_paragraph_opposing_points BEGIN UPDATE db_meta SET value = CAST(value AS INTEGER) + 1 WHERE key = 'revision'; END;

CREATE TABLE rhetorical_paragraph_facts (
    rhetorical_paragraph_id INTEGER NOT NULL REFERENCES rhetorical_paragraphs(id),
    fact_id                 INTEGER NOT NULL REFERENCES facts(id),
    PRIMARY KEY (rhetorical_paragraph_id, fact_id)
);

CREATE TRIGGER rev_rhetorical_paragraph_facts_ins AFTER INSERT ON rhetorical_paragraph_facts BEGIN UPDATE db_meta SET value = CAST(value AS INTEGER) + 1 WHERE key = 'revision'; END;
CREATE TRIGGER rev_rhetorical_paragraph_facts_upd AFTER UPDATE ON rhetorical_paragraph_facts BEGIN UPDATE db_meta SET value = CAST(value AS INTEGER) + 1 WHERE key = 'revision'; END;
CREATE TRIGGER rev_rhetorical_paragraph_facts_del AFTER DELETE ON rhetorical_paragraph_facts BEGIN UPDATE db_meta SET value = CAST(value AS INTEGER) + 1 WHERE key = 'revision'; END;

CREATE TABLE rhetorical_paragraph_law (
    rhetorical_paragraph_id INTEGER NOT NULL REFERENCES rhetorical_paragraphs(id),
    law_assertion_id        INTEGER NOT NULL REFERENCES law_assertions(id),
    PRIMARY KEY (rhetorical_paragraph_id, law_assertion_id)
);

CREATE TRIGGER rev_rhetorical_paragraph_law_ins AFTER INSERT ON rhetorical_paragraph_law BEGIN UPDATE db_meta SET value = CAST(value AS INTEGER) + 1 WHERE key = 'revision'; END;
CREATE TRIGGER rev_rhetorical_paragraph_law_upd AFTER UPDATE ON rhetorical_paragraph_law BEGIN UPDATE db_meta SET value = CAST(value AS INTEGER) + 1 WHERE key = 'revision'; END;
CREATE TRIGGER rev_rhetorical_paragraph_law_del AFTER DELETE ON rhetorical_paragraph_law BEGIN UPDATE db_meta SET value = CAST(value AS INTEGER) + 1 WHERE key = 'revision'; END;

CREATE TABLE rhetorical_paragraph_record (
    id                      INTEGER PRIMARY KEY,
    rhetorical_paragraph_id INTEGER NOT NULL REFERENCES rhetorical_paragraphs(id),
    document_id             INTEGER NOT NULL REFERENCES documents(id),
    pinpoint                TEXT,
    excerpt                 TEXT
);
CREATE INDEX idx_rhetorical_paragraph_record_paragraph ON rhetorical_paragraph_record(rhetorical_paragraph_id);

CREATE TRIGGER rev_rhetorical_paragraph_record_ins AFTER INSERT ON rhetorical_paragraph_record BEGIN UPDATE db_meta SET value = CAST(value AS INTEGER) + 1 WHERE key = 'revision'; END;
CREATE TRIGGER rev_rhetorical_paragraph_record_upd AFTER UPDATE ON rhetorical_paragraph_record BEGIN UPDATE db_meta SET value = CAST(value AS INTEGER) + 1 WHERE key = 'revision'; END;
CREATE TRIGGER rev_rhetorical_paragraph_record_del AFTER DELETE ON rhetorical_paragraph_record BEGIN UPDATE db_meta SET value = CAST(value AS INTEGER) + 1 WHERE key = 'revision'; END;

CREATE TABLE filing_rhetoric (
    id                      INTEGER PRIMARY KEY,
    filing_id               INTEGER NOT NULL REFERENCES filings(id),
    rhetorical_paragraph_id INTEGER NOT NULL REFERENCES rhetorical_paragraphs(id),
    document                TEXT NOT NULL CHECK (document IN ('form', 'written_argument')),
    part                    TEXT NOT NULL CHECK (part IN ('facts', 'submissions', 'orders')),
    ordinal                 INTEGER NOT NULL
);
CREATE INDEX idx_filing_rhetoric_filing ON filing_rhetoric(filing_id);

CREATE TRIGGER rev_filing_rhetoric_ins AFTER INSERT ON filing_rhetoric BEGIN UPDATE db_meta SET value = CAST(value AS INTEGER) + 1 WHERE key = 'revision'; END;
CREATE TRIGGER rev_filing_rhetoric_upd AFTER UPDATE ON filing_rhetoric BEGIN UPDATE db_meta SET value = CAST(value AS INTEGER) + 1 WHERE key = 'revision'; END;
CREATE TRIGGER rev_filing_rhetoric_del AFTER DELETE ON filing_rhetoric BEGIN UPDATE db_meta SET value = CAST(value AS INTEGER) + 1 WHERE key = 'revision'; END;

CREATE TRIGGER guard_filing_rhetoric_frozen_ins BEFORE INSERT ON filing_rhetoric
WHEN (SELECT filed_on IS NOT NULL OR retired_on IS NOT NULL FROM filings WHERE id = NEW.filing_id)
BEGIN SELECT RAISE(ABORT, 'a sent or retired Writing''s rhetorical paragraphs do not change'); END;

CREATE TRIGGER guard_filing_rhetoric_frozen_upd BEFORE UPDATE ON filing_rhetoric
WHEN (SELECT filed_on IS NOT NULL OR retired_on IS NOT NULL FROM filings WHERE id = OLD.filing_id)
  OR (SELECT filed_on IS NOT NULL OR retired_on IS NOT NULL FROM filings WHERE id = NEW.filing_id)
BEGIN SELECT RAISE(ABORT, 'a sent or retired Writing''s rhetorical paragraphs do not change'); END;

CREATE TRIGGER guard_filing_rhetoric_frozen_del BEFORE DELETE ON filing_rhetoric
WHEN (SELECT filed_on IS NOT NULL OR retired_on IS NOT NULL FROM filings WHERE id = OLD.filing_id)
BEGIN SELECT RAISE(ABORT, 'a sent or retired Writing''s rhetorical paragraphs do not change'); END;

CREATE TRIGGER reset_pure_law_on_rhetoric_ins AFTER INSERT ON filing_rhetoric
WHEN NEW.document = 'form' AND (SELECT pure_law_on FROM filings WHERE id = NEW.filing_id) IS NOT NULL
BEGIN UPDATE filings SET pure_law_on = NULL, pure_law_note = NULL WHERE id = NEW.filing_id; END;

CREATE TABLE paragraph_revisions_v71 (
    id               INTEGER PRIMARY KEY,
    entity           TEXT NOT NULL CHECK (entity IN ('facts', 'statements_of_fact', 'law_assertions', 'statements_of_law', 'submissions', 'order_sought', 'filing_orders', 'filing_facts', 'rhetorical_paragraphs')),
    entity_id        INTEGER NOT NULL,
    field            TEXT NOT NULL,
    old_text         TEXT NOT NULL,
    new_text         TEXT NOT NULL,
    proposed_text    TEXT,
    alternative_text TEXT,
    review_flags     TEXT,
    choice           TEXT NOT NULL CHECK (choice IN ('current', 'proposed', 'alternative', 'other', 'move')),
    origin           TEXT NOT NULL CHECK (origin IN ('practitioner', 'model')),
    session_token    TEXT NOT NULL,
    created          TEXT NOT NULL,
    CHECK ((choice = 'alternative') = (origin = 'model')),
    CHECK (choice <> 'current' OR new_text = old_text),
    CHECK ((choice = 'move') = (entity = 'filing_facts')),
    CHECK (entity <> 'filing_facts' OR (field = 'ordinal' AND new_text <> old_text
           AND proposed_text IS NULL AND alternative_text IS NULL AND review_flags IS NULL)),
    CHECK (entity = 'filing_facts' OR (proposed_text IS NOT NULL AND alternative_text IS NOT NULL))
);
INSERT INTO paragraph_revisions_v71 (id, entity, entity_id, field, old_text, new_text, proposed_text, alternative_text, review_flags, choice, origin, session_token, created)
  SELECT id, entity, entity_id, field, old_text, new_text, proposed_text, alternative_text, review_flags, choice, origin, session_token, created FROM paragraph_revisions;
DROP TABLE paragraph_revisions;
ALTER TABLE paragraph_revisions_v71 RENAME TO paragraph_revisions;

UPDATE db_meta SET value = '71' WHERE key = 'schema_version';

-- MIGRATE 71 -> 72
-- A /draft session may be assigned a job it created (Brahm, 2026-10-09). One job per session still
-- holds, and creating jobs does not use it up, but a session that created jobs may be assigned only
-- one of the jobs it created in that session, never a pre-existing job or another session's.
--
-- 1. tickets gains created_by, the creating session's session_token, NULL by default. Only the
--    outlining creates (jobs-create.md §3, the plain create and the guarded create from Proposals)
--    write it; intake, the stock, counsel's review, scrutiny review and gate jobs, and a holding
--    session's spin-offs leave it NULL. drafting_data__assign_job reads it: once any job carries
--    this session's token, the session is assigned only a job that carries it (jobs-run.md §4).
-- Job process state, so no revision triggers. Additive: no row changes and no revision moves.

ALTER TABLE tickets ADD COLUMN created_by TEXT;

UPDATE db_meta SET value = '72' WHERE key = 'schema_version';

-- MIGRATE 72 -> 73
-- Where a /draft session stands on its skill's map of rule nodes (rules-DAG spec §4.5, §4.6, §4.8;
-- Brahm, 2026-10-09). rules__move and rules__branch store the position and log each rule they
-- serve, so the tool, not the model, decides which rules apply, and a rule's lifecycle can be read
-- off the log. Four tables, written only by those two tools:
--
-- 1. out_of_bounds_visit: one row per move to the map's out-of-bounds node, with the path left
--    (node ids, root first, space-separated). turn_summary and provisional_rules stay NULL until
--    the improviser is built (plan phase 7).
-- 2. session_position: the session's path on each branch, keyed (session_token, branch). branch is
--    'main', or the label of the one side branch open. session_facts holds the session-level facts
--    (unattended, host) as JSON, and in_force the rules the branch's last block left in force, as
--    JSON [[rule_id, [conditional facts]], ...], so a move sends only what changed. No row exists
--    before a session's first rules__move.
-- 3. job_position: the held job's latest in-bounds path, for a session that takes the job over,
--    and the visit that took its holder out of bounds since, if any. A deleted job takes its row
--    with it.
-- 4. rule_served: one row per rule whose text a move or branch sent. The rule_id index is enough
--    for the lifecycle's count of distinct session tokens per rule.
--
-- Process state, so no revision triggers. Additive: no row changes and no revision moves.
CREATE TABLE out_of_bounds_visit (
    id                INTEGER PRIMARY KEY,
    session_token     TEXT NOT NULL,
    from_path         TEXT NOT NULL,
    turn_summary      TEXT,
    provisional_rules TEXT,
    visited_at        TEXT NOT NULL
);

CREATE TABLE session_position (
    session_token TEXT NOT NULL,
    branch        TEXT NOT NULL,
    path          TEXT NOT NULL,
    session_facts TEXT NOT NULL DEFAULT '{}',
    in_force      TEXT NOT NULL DEFAULT '[]',
    updated_at    TEXT NOT NULL,
    PRIMARY KEY (session_token, branch)
);

CREATE TABLE job_position (
    job_id                INTEGER PRIMARY KEY REFERENCES tickets(id) ON DELETE CASCADE,
    last_in_bounds_path   TEXT NOT NULL,
    went_out_of_bounds_to INTEGER REFERENCES out_of_bounds_visit(id),
    updated_at            TEXT NOT NULL
);

CREATE TABLE rule_served (
    id            INTEGER PRIMARY KEY,
    rule_id       TEXT NOT NULL,
    node          TEXT NOT NULL,
    path          TEXT NOT NULL,
    session_token TEXT NOT NULL,
    served_at     TEXT NOT NULL
);
CREATE INDEX idx_rule_served_rule ON rule_served(rule_id);

UPDATE db_meta SET value = '73' WHERE key = 'schema_version';

-- MIGRATE 73 -> 74
-- A job can be held until a bring-forward (BF) date (Brahm, 2026-10-12). Until that date the job
-- shows in the Job Board's Bring Forward lane and is not assigned.
--
-- 1. tickets gains bf_on, nullable: the first day the job may be worked, a YYYY-MM-DD by a CHECK of
--    its own, like filings.pure_law_on. It is a start date, never a deadline. Written only on the
--    practitioner's word (jobs-closeout.md §10b), never proposed or inferred by a session, and the
--    one job value typed as given and not computed in SQL. The lane is derived at render: a queued,
--    unshelved job whose bf_on is later than the local date is in Bring Forward, and from that date
--    on it reads as Blocked or Ready with no write. drafting_data__assign_job reads it: a job is
--    not assigned before its bf_on (jobs-run.md §4). ADD COLUMN, no rebuild: every existing row
--    reads NULL.
-- Job process state, so no revision triggers. Additive: no row changes and no revision moves.

ALTER TABLE tickets ADD COLUMN bf_on TEXT CHECK (bf_on IS NULL OR bf_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]');

UPDATE db_meta SET value = '74' WHERE key = 'schema_version';

-- MIGRATE 74 -> 75
-- A loose thread can leave the board without being deleted (Brahm, 2026-10-13). seeds gains two
-- nullable minutes, YYYY-MM-DDTHH:MM local time, as deferred_at is:
--
-- 1. discarded_at: the minute the practitioner dropped the thread. NULL is not discarded. A discarded
--    thread is kept, is no longer open, and shows as a struck line that can be restored by clearing
--    the minute. It replaces the row delete: every drop of a loose thread writes it.
-- 2. suggested_at: the minute the thread was sent to Probanda as a suggestion about the plugin. NULL
--    is not suggested. A suggested thread is kept and is no longer open.
--
-- Both are written by the raw idioms in references/jobs-run.md section 8, only on the practitioner's
-- word. seeds is job process state (ADR 0009), so the columns carry no revision trigger.
--
-- Additive: two ADD COLUMNs, no rebuild; every existing row reads NULL in both. The hop moves no
-- revision: it writes no row.
ALTER TABLE seeds ADD COLUMN discarded_at TEXT;
ALTER TABLE seeds ADD COLUMN suggested_at TEXT;

UPDATE db_meta SET value = '75' WHERE key = 'schema_version';

-- MIGRATE 75 -> 76
-- A job records the sources its work goes on to get (Brahm, 2026-10-13). A research job is created
-- with one step, and the decisions, enactments and files the research then names were recorded
-- nowhere on it, so an interrupted job held no record of what was about to be retrieved.
--
-- 1. ticket_sources: one row per source to get on a job. kind is what is retrieved, never a legal
--    category. label is a citation, an instrument's title and citation, or a file name: no statement
--    of law, no deadline, and no date other than the one inside a citation. A row is open until
--    closed_at is set with its outcome; reason is a short mechanical status, on either outcome.
--    Written only by drafting_data__track_source, under the job's lock.
--
-- Why a table of its own and not ticket_steps rows: the steps are the approved plan, in the
-- practitioner's words. A Change deletes and recreates them (jobs-run.md section 5), which would
-- drop these rows, and the practitioner-words gate does not read a step appended without a delete,
-- so a session's item would stand as the practitioner's. The rows key to the job, not to a step,
-- because a step's ordinal names different work after a Change (section 6).
--
-- Job process state (ADR 0009), like ticket_answers, so no revision triggers: adding or closing a
-- source never archives a mockup. Additive: one CREATE TABLE, whose UNIQUE serves the read by job;
-- no row changes and no revision moves.
CREATE TABLE ticket_sources (
    id        INTEGER PRIMARY KEY,
    ticket_id INTEGER NOT NULL REFERENCES tickets(id),
    kind      TEXT NOT NULL CHECK (kind IN ('decision', 'legislation', 'file')),
    label     TEXT NOT NULL,
    added_at  TEXT NOT NULL,
    closed_at TEXT,
    outcome   TEXT CHECK (outcome IN ('got', 'not_retrieved')),
    reason    TEXT,
    CHECK ((closed_at IS NULL) = (outcome IS NULL)),
    CHECK (reason IS NULL OR outcome IS NOT NULL),
    UNIQUE (ticket_id, kind, label)
);

UPDATE db_meta SET value = '76' WHERE key = 'schema_version';

-- MIGRATE 76 -> 77
-- The Job Board's Provable Facts page splits in two (Brahm, 2026-10-20, docs/ADRs/0011): Procedural
-- History, the facts that speak to the litigation process itself (a filing, a service, procedural
-- correspondence), each on the date it happened, and Material Facts, every other fact. Both keep how
-- each fact is proven.
--
-- facts gains procedural_on, YYYY-MM-DD: the date the procedural step happened. NULL is a material
-- fact. One column holds both the kind and the date, so a procedural fact without a date cannot be
-- stored. The session sets it by inference from the fact and its source, and the practitioner's
-- correction sets or clears it (SKILL.md "Procedural and material facts"). It records an act that
-- has happened, never a date by which something must be done: nothing computes from it and no
-- deadline is derived from it.
--
-- This column deepens drafting-data's reliance on Exception 2 of the commandments by Brahm's express
-- ruling of 2026-10-20 (ADR 0011).
--
-- Additive: one ADD COLUMN, no rebuild. Every existing fact reads NULL, so it stays on Material
-- Facts, the renamed Provable Facts page. facts keeps its revision triggers, so a fact moved between
-- the pages re-renders them. The hop writes no row and moves no revision.
ALTER TABLE facts ADD COLUMN procedural_on TEXT CHECK (procedural_on IS NULL OR procedural_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]');

UPDATE db_meta SET value = '77' WHERE key = 'schema_version';

-- MIGRATE 77 -> 78
-- A job step can say more than open or done (Brahm, 2026-10-21). A step that could not be done (a
-- missing credential, an unreachable source) was stamped done so the plan moved on, and the frozen
-- stamp then reported work that never ran; a step waiting on an external run could show no wait.
--
-- ticket_steps gains three nullable columns:
-- 1. status: NULL is today's meaning (open until done_at is set). 'retry' is a step blocked by a
--    missing credential or an unreachable source, to be tried again. 'cancelled' and 'deferred' are
--    a step the practitioner chose to drop or put off, and only on the practitioner's words.
--    'waiting' is a step waiting on an external process the session will check again.
-- 2. wait_until: on a waiting step, the minute (YYYY-MM-DDTHH:MM local time, by a CHECK) at which the
--    session checks the process again. A wake-up time for checking a process, never a deadline and
--    never time remaining: nothing computes from it beyond that check, and once it has passed the
--    step reads as open again.
-- 3. status_note: the practitioner's own words for a cancelled or deferred step.
--
-- done_at stays the only meaning of done, and a stamped step takes no status: every stamp already
-- written stays frozen. Written only by drafting_data__set_step, under the job's lock.
--
-- These columns deepen drafting-data's reliance on the commandments' Exception by Brahm's express
-- ruling of 2026-10-21.
--
-- Job process state (ADR 0009), so no revision triggers. Additive: three ADD COLUMNs, no rebuild.
-- Every existing step reads NULL in all three, so it keeps its two-state meaning; no row changes and
-- no revision moves.
ALTER TABLE ticket_steps ADD COLUMN status TEXT CHECK (status IS NULL OR status IN ('retry', 'cancelled', 'deferred', 'waiting'));
ALTER TABLE ticket_steps ADD COLUMN wait_until TEXT CHECK (wait_until IS NULL OR wait_until GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]');
ALTER TABLE ticket_steps ADD COLUMN status_note TEXT;

UPDATE db_meta SET value = '78' WHERE key = 'schema_version';
