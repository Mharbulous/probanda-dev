-- =========================================================================
-- Case Data — migration snippets
-- Each section upgrades the schema by one minor version.
-- Parsed by operations/migrate.md using the MIGRATE markers.
-- Marker format: -- MIGRATE <from_int> -> <to_int> -- DB: <main|law|privileged>
-- =========================================================================

-- MIGRATE 62 -> 63 -- DB: law
-- law: legal_concepts and legal_criteria gain temporal validity columns
ALTER TABLE legal_concepts ADD COLUMN in_force_date DATE;
ALTER TABLE legal_concepts ADD COLUMN repeal_date DATE;
ALTER TABLE legal_criteria ADD COLUMN in_force_date DATE;
ALTER TABLE legal_criteria ADD COLUMN repeal_date DATE;

-- MIGRATE 63 -> 64 -- DB: law
-- law: authorities gains disposition; concept_authorities gains brief fields
ALTER TABLE authorities ADD COLUMN disposition TEXT;
ALTER TABLE concept_authorities ADD COLUMN finding TEXT;
ALTER TABLE concept_authorities ADD COLUMN factual_context TEXT;
ALTER TABLE concept_authorities ADD COLUMN obiter TEXT;

-- MIGRATE 64 -> 65 -- DB: law
-- law: authorities gains last_verified_at
ALTER TABLE authorities ADD COLUMN last_verified_at TEXT;

-- MIGRATE 65 -> 66 -- DB: law
-- law: authority_treatments table; concept_authorities gains treatment columns
--       and relationship CHECK adds 'affirms'; legal_criteria gains treatment columns
-- NOTE: concept_authorities requires table rebuild for CHECK constraint change.

CREATE TABLE IF NOT EXISTS authority_treatments (
    treating_authority_id INTEGER NOT NULL REFERENCES authorities(authority_id),
    treated_authority_id  INTEGER NOT NULL REFERENCES authorities(authority_id),
    treatment TEXT NOT NULL CHECK(treatment IN (
        'affirms','reverses','varies','distinguishes','overrules')),
    scope TEXT CHECK(scope IN ('full','partial')),
    notes TEXT,
    PRIMARY KEY (treating_authority_id, treated_authority_id),
    CHECK (treating_authority_id != treated_authority_id)
);

ALTER TABLE legal_criteria ADD COLUMN treatment TEXT CHECK(treatment IN (
    'affirmed','reversed','varied','distinguished','overruled'));
ALTER TABLE legal_criteria ADD COLUMN treated_by_authority_id INTEGER REFERENCES authorities(authority_id);

-- concept_authorities table rebuild (CHECK constraint change on relationship).
-- Uses explicit column names in SELECT to fail loudly if a column is missing.
CREATE TABLE concept_authorities_new (
    concept_id      INTEGER NOT NULL REFERENCES legal_concepts(concept_id),
    authority_id    INTEGER NOT NULL REFERENCES authorities(authority_id),
    relationship    TEXT NOT NULL CHECK(relationship IN (
                        'establishes','refines','applies','distinguishes','affirms')),
    proposition     TEXT,
    finding         TEXT,
    factual_context TEXT,
    obiter          TEXT,
    treatment       TEXT CHECK(treatment IN (
                        'affirmed','reversed','varied','distinguished','overruled')),
    treated_by_authority_id INTEGER REFERENCES authorities(authority_id),
    PRIMARY KEY (concept_id, authority_id)
);
INSERT INTO concept_authorities_new (
    concept_id, authority_id, relationship, proposition,
    finding, factual_context, obiter, treatment, treated_by_authority_id
)
SELECT
    concept_id, authority_id, relationship, proposition,
    finding, factual_context, obiter, NULL, NULL
FROM concept_authorities;
DROP TABLE concept_authorities;
ALTER TABLE concept_authorities_new RENAME TO concept_authorities;

-- MIGRATE 66 -> 67 -- DB: main
-- main: sources gains parent_source_id; facts gains basis_of_knowledge, informant
ALTER TABLE sources ADD COLUMN parent_source_id INTEGER REFERENCES sources(source_id);
ALTER TABLE facts ADD COLUMN basis_of_knowledge TEXT CHECK(basis_of_knowledge IN ('personal','information_and_belief'));
ALTER TABLE facts ADD COLUMN informant TEXT;

-- MIGRATE 67 -> 68 -- DB: main
-- main: sources gains ingestion_status (completeness signal for incremental re-ingestion)
ALTER TABLE sources ADD COLUMN ingestion_status TEXT CHECK(ingestion_status IN ('complete','partial','failed'));

-- MIGRATE 68 -> 69 -- DB: main
-- main: sources gains last_verified_at; facts and positions gain human_reviewed;
--       composite index on facts(source_id, source_locator) for verification dedup
ALTER TABLE sources ADD COLUMN last_verified_at TEXT;
ALTER TABLE facts ADD COLUMN human_reviewed INTEGER DEFAULT 0 CHECK(human_reviewed IN (0,1));
ALTER TABLE positions ADD COLUMN human_reviewed INTEGER DEFAULT 0 CHECK(human_reviewed IN (0,1));
CREATE INDEX IF NOT EXISTS idx_facts_source_locator ON facts(source_id, source_locator);

-- MIGRATE 70 -> 71 -- DB: law
-- law: concept_authorities gains verified (4-state enum per shared/conventions.md §4 --
--      legal edges enter the verification pipeline; they were previously write-once at
--      ingest, verified by nothing and amendable by nothing) and notes (provenance of a
--      correction: who/why/source, on the row the correction was applied to).
--      Backfill is 0 (unverified) for every existing row: nothing has ever verified an
--      edge. NULL is wrong here -- every consumer filters `verified >= 0`, and under SQL
--      three-valued logic NULL rows would silently vanish from the drafting script and the
--      push queue. `notes` never crosses to the pool (push-state.md excludes notes from the
--      push-queue payload) and is excluded from pushed_source_hash.
ALTER TABLE concept_authorities ADD COLUMN verified INTEGER DEFAULT 0 CHECK(verified IN (-1,0,1,2));
ALTER TABLE concept_authorities ADD COLUMN notes TEXT;

-- MIGRATE 71 -> 72 -- DB: main
-- main: proceeding_parties.role CHECK gains plaintiff_by_counterclaim and
--       defendant_by_counterclaim, so a party's counterclaim-side posture is
--       distinguishable from its main-action role instead of reusing the same
--       plaintiff/defendant value for both and looking like a duplicate/contradiction.
-- NOTE: proceeding_parties requires table rebuild for CHECK constraint change
--       (single-column CHECK, same pattern as the v6.5->v6.6 concept_authorities rebuild).
CREATE TABLE proceeding_parties_new (
    proceeding_id   INTEGER NOT NULL REFERENCES proceedings(proceeding_id),
    party_id        INTEGER NOT NULL REFERENCES parties(party_id),
    role            TEXT NOT NULL CHECK(role IN (
                        'plaintiff','defendant','third_party','intervenor',
                        'applicant','respondent','petitioner',
                        'plaintiff_by_counterclaim','defendant_by_counterclaim')),
    PRIMARY KEY (proceeding_id, party_id, role)
);
INSERT INTO proceeding_parties_new (proceeding_id, party_id, role)
SELECT proceeding_id, party_id, role FROM proceeding_parties;
DROP TABLE proceeding_parties;
ALTER TABLE proceeding_parties_new RENAME TO proceeding_parties;
CREATE INDEX IF NOT EXISTS idx_proceeding_parties_party ON proceeding_parties(party_id);

-- MIGRATE 72 -> 73 -- DB: law
-- law: authorities gains fact_pattern (relief-free situation shape) and loss_description
--      (mechanism-free loss, two registers); concept_authorities gains order_terms
--      (source-faithful operative terms, remedy edges only). All three are local-only:
--      they never cross to the pool and stay out of pushed_source_hash.
--      Design: Engineering/1. Design/2026-07-18_authority-search-capture-design.md
ALTER TABLE authorities ADD COLUMN fact_pattern TEXT;
ALTER TABLE authorities ADD COLUMN loss_description TEXT;
ALTER TABLE concept_authorities ADD COLUMN order_terms TEXT;

-- MIGRATE 73 -> 74 -- DB: privileged
-- privileged: fact_provenance gains disposition (active|dismissed) — the terminal
--      investigation marker for a theorized fact. Backfill 'active' for every existing
--      row (the column default supplies it on ALTER). NOT NULL is safe: SQLite fills
--      existing rows with the DEFAULT when adding a NOT NULL column that has one.
ALTER TABLE fact_provenance ADD COLUMN disposition TEXT NOT NULL DEFAULT 'active' CHECK(disposition IN ('active','dismissed'));

-- v7.4 -> v7.5 is intentionally absent from this incremental chain.
-- The proceeding_parties CHECK replacement is owned by rebuild.py --migrate,
-- which rejects deprecated plaintiff_by_counterclaim rows before rebuilding
-- the table and verifying row-count preservation.
-- v7.5 -> v7.6 is likewise absent for the same reason (owned by rebuild.py).

-- MIGRATE 76 -> 77 -- DB: main
-- main: housekeeping_reviews records which files the housekeeping file-naming run
--      has already opened and reached a verdict on, so a later run skips them instead
--      of paying to reopen them. A pure additive CREATE TABLE, so this step returns to
--      the incremental chain -- it runs AFTER the rebuild-only carve-out has stamped
--      76 (migrate.md step 8), not before it.
CREATE TABLE IF NOT EXISTS housekeeping_reviews (
    review_id   INTEGER PRIMARY KEY,
    file_hash   TEXT NOT NULL,
    file_name   TEXT NOT NULL,
    folder_type TEXT NOT NULL,
    outcome     TEXT NOT NULL CHECK(outcome IN (
                    'renamed','declined','manual_review')),
    reviewed_at TEXT NOT NULL,
    UNIQUE (file_hash, file_name)
);
CREATE INDEX IF NOT EXISTS idx_housekeeping_reviews_name ON housekeeping_reviews(file_name);

-- MIGRATE 77 -> 78 -- DB: main
-- main: witnesses become first-class entities. Experts are represented by the
--      expert witness subtype and carry the retention, report, qualification,
--      and field metadata that does not apply to fact witnesses.
CREATE TABLE IF NOT EXISTS witnesses (
    witness_id              INTEGER PRIMARY KEY,
    name                    TEXT NOT NULL,
    witness_type            TEXT NOT NULL CHECK(witness_type IN ('fact','expert')),
    field_of_expertise      TEXT,
    retained_by_party_id    INTEGER REFERENCES parties(party_id),
    report_source_id        INTEGER REFERENCES sources(source_id),
    qualified               INTEGER CHECK(qualified IN (0,1)),
    CHECK (
        witness_type = 'expert'
        OR (
            field_of_expertise IS NULL
            AND retained_by_party_id IS NULL
            AND report_source_id IS NULL
            AND qualified IS NULL
        )
    )
);
CREATE TABLE IF NOT EXISTS proceeding_witnesses (
    proceeding_id       INTEGER NOT NULL REFERENCES proceedings(proceeding_id),
    witness_id          INTEGER NOT NULL REFERENCES witnesses(witness_id),
    called_by_party_id  INTEGER REFERENCES parties(party_id),
    PRIMARY KEY (proceeding_id, witness_id)
);
CREATE INDEX IF NOT EXISTS idx_witnesses_type
    ON witnesses(witness_type);
CREATE INDEX IF NOT EXISTS idx_witnesses_retained_by
    ON witnesses(retained_by_party_id);
CREATE INDEX IF NOT EXISTS idx_witnesses_report_source
    ON witnesses(report_source_id);
CREATE INDEX IF NOT EXISTS idx_proceeding_witnesses_witness
    ON proceeding_witnesses(witness_id);
CREATE INDEX IF NOT EXISTS idx_proceeding_witnesses_called_by
    ON proceeding_witnesses(called_by_party_id);

-- MIGRATE 77 -> 78 -- DB: privileged
-- privileged: client instructions are privileged bitemporal directions linked
--      to their proceeding and client through the TEMP trigger layer.
CREATE TABLE IF NOT EXISTS client_instructions (
    instruction_id  INTEGER PRIMARY KEY,
    proceeding_id   INTEGER NOT NULL,
    party_id        INTEGER NOT NULL,
    instructed_by   TEXT NOT NULL,
    date            TEXT NOT NULL,
    description     TEXT NOT NULL,
    source_id       INTEGER REFERENCES privileged_sources(source_id),
    source_locator  TEXT,
    status          TEXT NOT NULL DEFAULT 'open'
                    CHECK(status IN ('open','actioned','superseded')),
    valid_from      TEXT NOT NULL DEFAULT (date('now')),
    valid_to        TEXT,
    prior_id        INTEGER REFERENCES client_instructions(instruction_id),
    notes           TEXT,
    verified        INTEGER DEFAULT 0 CHECK(verified IN (-1,0,1,2))
);
CREATE INDEX IF NOT EXISTS idx_client_instructions_proceeding_status
    ON client_instructions(proceeding_id, status, valid_to);
CREATE INDEX IF NOT EXISTS idx_client_instructions_party
    ON client_instructions(party_id, valid_to);
CREATE INDEX IF NOT EXISTS idx_client_instructions_source
    ON client_instructions(source_id);

-- MIGRATE 78 -> 79 -- DB: main
-- main: sources gains execution_status ('draft'|'affirmed'|'filed') — the
--      affidavit execution state carried by the body row (exhibits stay NULL).
--      Nullable with no DEFAULT: NULL is the honest backfill for every existing
--      row, meaning not an affidavit / never assessed.
ALTER TABLE sources ADD COLUMN execution_status TEXT CHECK(execution_status IN ('draft','affirmed','filed'));

-- MIGRATE 79 -> 80 -- DB: main
-- main: corrected facts and positions gain an explicit quarantine marker.
--      DEFAULT 0 grandfathers existing rows without inventing correction history.
--      The CHECK requires pending rows to remain AI-owned and unverified until
--      their isolated targeted re-check succeeds or escalates to human review.
ALTER TABLE facts ADD COLUMN pending_reverification INTEGER NOT NULL DEFAULT 0
    CHECK(pending_reverification IN (0,1)
      AND (pending_reverification = 0
           OR (verified IS 0 AND human_reviewed IS 0)));
ALTER TABLE positions ADD COLUMN pending_reverification INTEGER NOT NULL DEFAULT 0
    CHECK(pending_reverification IN (0,1)
      AND (pending_reverification = 0
           OR (verified IS 0 AND human_reviewed IS 0)));

-- MIGRATE 80 -> 81 -- DB: main
-- main: new admissions table — the proof instruments that establish a fact
--      without the fact's own sworn evidence. Deliberately not an extension of
--      positions: a position is an on-record stance bound to a responding
--      source (decision #25), while a deemed admission is a legal consequence
--      of silence that no party asserted, so an 'admit' position row for it
--      would fabricate a stance (decision #8). Purely additive — existing
--      matters are unaffected until something writes an admission.
CREATE TABLE IF NOT EXISTS admissions (
    admission_id       INTEGER PRIMARY KEY,
    fact_id            INTEGER NOT NULL REFERENCES facts(fact_id),
    admitting_party_id INTEGER NOT NULL REFERENCES parties(party_id),
    admission_kind     TEXT NOT NULL CHECK(admission_kind IN (
                           'express_pleading',
                           'express_notice_to_admit',
                           'deemed_default',
                           'deemed_rule_7_7',
                           'express_other',
                           'discovery')),
    source_id          INTEGER REFERENCES sources(source_id),
    source_locator     TEXT,
    deemed_effective_date TEXT,
    qualification      TEXT,
    valid_from         TEXT NOT NULL DEFAULT (date('now')),
    valid_to           TEXT,
    prior_id           INTEGER REFERENCES admissions(admission_id),
    verified           INTEGER DEFAULT 0 CHECK(verified IN (-1,0,1,2)),
    human_reviewed     INTEGER DEFAULT 0 CHECK(human_reviewed IN (0,1)),
    notes              TEXT,
    CHECK (admission_kind NOT IN ('deemed_default','deemed_rule_7_7')
           OR (deemed_effective_date IS NOT NULL AND source_id IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS idx_admissions_fact_party
    ON admissions(fact_id, admitting_party_id, valid_to);
CREATE INDEX IF NOT EXISTS idx_admissions_kind
    ON admissions(admission_kind, valid_to);
CREATE INDEX IF NOT EXISTS idx_admissions_source
    ON admissions(source_id);

-- MIGRATE 81 -> 82 -- DB: main
-- main: parties gains the address-for-service provenance breadcrumbs —
--      service_address_filed_date (when the current address for service was
--      filed) and replaced_representative (who the current representative
--      replaced). Purely additive, nullable, no DEFAULT: NULL is the honest
--      backfill, since nothing in a pre-v8.2 matter recorded either fact.
--      Unlike the CREATE TABLE IF NOT EXISTS hops above, ALTER TABLE ADD COLUMN
--      is not re-runnable — SQLite raises on a duplicate column. The engine
--      applies each hop exactly once, and the 78 -> 79 hop above sets the same
--      precedent.
ALTER TABLE parties ADD COLUMN service_address_filed_date TEXT;
ALTER TABLE parties ADD COLUMN replaced_representative TEXT;

-- MIGRATE 82 -> 83 -- DB: main
-- main: proceeding_parties.role CHECK gains 'appellant', so a BC Court of
--       Appeal proceeding's moving party has a role of its own instead of
--       being left off the roster entirely. 'respondent' is unchanged and
--       reused for the opposing party, matching BC practice's own use of one
--       word for the opposing party in a petition, an application, and an
--       appeal alike.
-- NOTE: proceeding_parties requires table rebuild for CHECK constraint change
--       (single-column CHECK, same pattern as the v7.1->v7.2 rebuild).
CREATE TABLE proceeding_parties_new (
    proceeding_id   INTEGER NOT NULL REFERENCES proceedings(proceeding_id),
    party_id        INTEGER NOT NULL REFERENCES parties(party_id),
    role            TEXT NOT NULL CHECK(role IN (
                        'plaintiff','defendant','third_party','intervenor',
                        'applicant','respondent','petitioner','appellant',
                        'defendant_by_counterclaim')),
    PRIMARY KEY (proceeding_id, party_id, role)
);
INSERT INTO proceeding_parties_new (proceeding_id, party_id, role)
SELECT proceeding_id, party_id, role FROM proceeding_parties;
DROP TABLE proceeding_parties;
ALTER TABLE proceeding_parties_new RENAME TO proceeding_parties;
CREATE INDEX IF NOT EXISTS idx_proceeding_parties_party ON proceeding_parties(party_id);

-- MIGRATE 83 -> 84 -- DB: main
-- main: new sought_orders table — a flat, verbatim, paragraph-numbered
--      transcription of a served Notice of Application's Part 1, linked to
--      its sources row. Not relief_items: relief_items tracks a bitemporal
--      stance toward a paraphrased remedy; this is a one-shot transcription
--      of one document's own printed text (decision #44). Purely additive,
--      no backfill of previously ingested documents — CREATE TABLE IF NOT
--      EXISTS keeps this hop re-runnable, same shape as the 80 -> 81 and
--      81 -> 82 hops above.
CREATE TABLE IF NOT EXISTS sought_orders (
    sought_order_id  INTEGER PRIMARY KEY,
    source_id        INTEGER NOT NULL REFERENCES sources(source_id),
    order_number     TEXT NOT NULL,
    order_text       TEXT NOT NULL,
    verified         INTEGER DEFAULT 0 CHECK(verified IN (-1,0,1,2)),
    notes            TEXT,
    human_reviewed   INTEGER DEFAULT 0 CHECK(human_reviewed IN (0,1)),
    UNIQUE(source_id, order_number)
);

-- MIGRATE 84 -> 85 -- DB: law
-- law: three CHECK widenings for the retired-filing law bridge
--      (operations/ingest-submission-law.md), plus two local-only capture
--      columns on concept_authorities.
--        authorities.authority_type          + 'oral_reasons'
--        authority_treatments.treatment      + 'follows','declines_to_follow',
--                                              'not_considered'
--        concept_authorities.relationship    + 'answered'
--        concept_authorities                 + pinpoint TEXT, excerpt TEXT
-- NOTE: SQLite has no ALTER TABLE for a CHECK constraint, so all three are
--       table rebuilds (CREATE new / INSERT SELECT with explicit column lists /
--       DROP / RENAME), the same pattern as the 82 -> 83 hop. Unlike that hop
--       this one rebuilds `authorities`, a PARENT table referenced by
--       authority_treatments, concept_authorities and legal_criteria — so the
--       whole hop runs inside an explicit PRAGMA foreign_keys = OFF/ON bracket
--       (migrate_engine._apply_marker sets foreign_keys ON before the script;
--       precedent for the bracket is rebuild.upgrade_69_to_70). Row counts are
--       preserved exactly; pinpoint/excerpt are born NULL, which is the honest
--       backfill — nothing in a pre-v8.5 matter recorded either.
PRAGMA foreign_keys = OFF;

CREATE TABLE authorities_new (
    authority_id    INTEGER PRIMARY KEY,
    title           TEXT NOT NULL,
    citation        TEXT,
    authority_type  TEXT CHECK(authority_type IN (
                        'case_law','statute','regulation','treatise','other',
                        'oral_reasons')),
    jurisdiction    TEXT,
    file_path       TEXT,
    file_hash       TEXT,
    notes           TEXT,
    disposition     TEXT,
    fact_pattern    TEXT,
    loss_description TEXT,
    last_verified_at TEXT,
    cloud_authority_id TEXT
);
INSERT INTO authorities_new (
    authority_id, title, citation, authority_type, jurisdiction, file_path,
    file_hash, notes, disposition, fact_pattern, loss_description,
    last_verified_at, cloud_authority_id)
SELECT
    authority_id, title, citation, authority_type, jurisdiction, file_path,
    file_hash, notes, disposition, fact_pattern, loss_description,
    last_verified_at, cloud_authority_id
FROM authorities;
DROP TABLE authorities;
ALTER TABLE authorities_new RENAME TO authorities;

CREATE TABLE authority_treatments_new (
    treating_authority_id INTEGER NOT NULL REFERENCES authorities(authority_id),
    treated_authority_id  INTEGER NOT NULL REFERENCES authorities(authority_id),
    treatment TEXT NOT NULL CHECK(treatment IN (
        'affirms','reverses','varies','distinguishes','overrules',
        'follows','declines_to_follow','not_considered')),
    scope TEXT CHECK(scope IN ('full','partial')),
    notes TEXT,
    PRIMARY KEY (treating_authority_id, treated_authority_id),
    CHECK (treating_authority_id != treated_authority_id)
);
INSERT INTO authority_treatments_new (
    treating_authority_id, treated_authority_id, treatment, scope, notes)
SELECT
    treating_authority_id, treated_authority_id, treatment, scope, notes
FROM authority_treatments;
DROP TABLE authority_treatments;
ALTER TABLE authority_treatments_new RENAME TO authority_treatments;

CREATE TABLE concept_authorities_new (
    concept_id      INTEGER NOT NULL REFERENCES legal_concepts(concept_id),
    authority_id    INTEGER NOT NULL REFERENCES authorities(authority_id),
    relationship    TEXT NOT NULL CHECK(relationship IN (
                        'establishes','refines','applies','distinguishes','affirms',
                        'answered')),
    proposition     TEXT,
    finding         TEXT,
    factual_context TEXT,
    obiter          TEXT,
    order_terms     TEXT,
    pinpoint        TEXT,
    excerpt         TEXT,
    treatment       TEXT CHECK(treatment IN (
                        'affirmed','reversed','varied','distinguished','overruled')),
    treated_by_authority_id INTEGER REFERENCES authorities(authority_id),
    verified        INTEGER DEFAULT 0 CHECK(verified IN (-1,0,1,2)),
    notes           TEXT,
    PRIMARY KEY (concept_id, authority_id)
);
INSERT INTO concept_authorities_new (
    concept_id, authority_id, relationship, proposition, finding,
    factual_context, obiter, order_terms, treatment, treated_by_authority_id,
    verified, notes)
SELECT
    concept_id, authority_id, relationship, proposition, finding,
    factual_context, obiter, order_terms, treatment, treated_by_authority_id,
    verified, notes
FROM concept_authorities;
DROP TABLE concept_authorities;
ALTER TABLE concept_authorities_new RENAME TO concept_authorities;

-- Every index on the three rebuilt tables, recreated.
CREATE INDEX IF NOT EXISTS idx_authority_treatments_treated
    ON authority_treatments(treated_authority_id);
CREATE INDEX IF NOT EXISTS idx_concept_authorities_authority
    ON concept_authorities(authority_id);
CREATE INDEX IF NOT EXISTS idx_concept_authorities_treated_by
    ON concept_authorities(treated_by_authority_id);

PRAGMA foreign_keys = ON;

-- MIGRATE 85 -> 86 -- DB: privileged
-- privileged: client_instructions.proceeding_id becomes nullable, so an
--      instruction can be recorded on a matter with no proceeding (pure advice
--      work). party_id stays NOT NULL. The cross-database trigger already
--      guards with WHEN NEW.proceeding_id IS NOT NULL, the privileged_sources
--      pattern; the column NOT NULL is what made that guard unreachable.
-- NOTE: SQLite cannot drop a NOT NULL in place, so this is a table rebuild
--       (CREATE new / INSERT SELECT with explicit column lists / DROP /
--       RENAME). client_instructions references itself through prior_id, so
--       the rebuild runs inside an explicit PRAGMA foreign_keys = OFF/ON
--       bracket, as the 84 -> 85 law hop does. Every row, prior_id chains
--       included, is copied unchanged; the three indexes go with the dropped
--       table and are recreated.
PRAGMA foreign_keys = OFF;

CREATE TABLE client_instructions_new (
    instruction_id  INTEGER PRIMARY KEY,
    proceeding_id   INTEGER,
    party_id        INTEGER NOT NULL,
    instructed_by   TEXT NOT NULL,
    date            TEXT NOT NULL,
    description     TEXT NOT NULL,
    source_id       INTEGER REFERENCES privileged_sources(source_id),
    source_locator  TEXT,
    status          TEXT NOT NULL DEFAULT 'open'
                    CHECK(status IN ('open','actioned','superseded')),
    valid_from      TEXT NOT NULL DEFAULT (date('now')),
    valid_to        TEXT,
    prior_id        INTEGER REFERENCES client_instructions(instruction_id),
    notes           TEXT,
    verified        INTEGER DEFAULT 0 CHECK(verified IN (-1,0,1,2))
);
INSERT INTO client_instructions_new (
    instruction_id, proceeding_id, party_id, instructed_by, date, description,
    source_id, source_locator, status, valid_from, valid_to, prior_id, notes,
    verified)
SELECT
    instruction_id, proceeding_id, party_id, instructed_by, date, description,
    source_id, source_locator, status, valid_from, valid_to, prior_id, notes,
    verified
FROM client_instructions;
DROP TABLE client_instructions;
ALTER TABLE client_instructions_new RENAME TO client_instructions;

CREATE INDEX IF NOT EXISTS idx_client_instructions_proceeding_status
    ON client_instructions(proceeding_id, status, valid_to);
CREATE INDEX IF NOT EXISTS idx_client_instructions_party
    ON client_instructions(party_id, valid_to);
CREATE INDEX IF NOT EXISTS idx_client_instructions_source
    ON client_instructions(source_id);

PRAGMA foreign_keys = ON;

-- MIGRATE 86 -> 87 -- DB: main
-- main: sources gains privilege_status ('pending'|'cleared'), the first-class
--      "pending privilege review" state (decision #49). Nullable with no
--      DEFAULT: NULL (never assessed) is the honest backfill for every row.
--      The cross-column CHECK makes listed = 1 impossible while pending.
--      The backfill promotes the legacy free-text convention: a row whose
--      notes start 'PRIVILEGE REVIEW PENDING' becomes 'pending'; every other
--      row stays NULL. The notes are left as they are -- resolve-privilege.md
--      strips the leading text when the practitioner makes the call.
--      FAIL-CLOSED, deliberately: if a legacy row carrying that note is
--      already listed = 1, the UPDATE fails the CHECK and the whole migration
--      rolls back. A document on the list of documents while its privilege
--      call is undecided is a state for the practitioner to resolve by hand,
--      not one for the migration to guess at.
--      Like the 81 -> 82 hop, ALTER TABLE ADD COLUMN is not re-runnable; the
--      engine applies each hop exactly once.
ALTER TABLE sources ADD COLUMN privilege_status TEXT
    CHECK(privilege_status IN ('pending','cleared')
          AND (privilege_status IS NOT 'pending' OR listed = 0));
UPDATE sources SET privilege_status = 'pending'
WHERE notes LIKE 'PRIVILEGE REVIEW PENDING%';

-- MIGRATE 87 -> 88 -- DB: main
-- main: housekeeping_reviews records the housekeeping redesign's ingest
--      outcomes. The outcome CHECK gains 'not_ingested' and 'ingest_failed';
--      folder_type becomes nullable (a root file's ingest failure has no
--      folder type); three nullable columns arrive: reason, failure_class
--      ('deterministic'|'extractor') and retry_next_run (0|1). 'declined'
--      stays in the CHECK, so no existing row is rewritten.
-- NOTE: a CHECK change and a dropped NOT NULL both need a table rebuild
--       (CREATE new / INSERT SELECT with explicit columns / DROP / RENAME),
--       the v8.2 -> v8.3 pattern. housekeeping_reviews has no foreign key in
--       either direction, so no PRAGMA foreign_keys bracket is needed. Every
--       existing row is copied across unchanged, its new columns NULL.
CREATE TABLE housekeeping_reviews_new (
    review_id      INTEGER PRIMARY KEY,
    file_hash      TEXT NOT NULL,
    file_name      TEXT NOT NULL,
    folder_type    TEXT,
    outcome        TEXT NOT NULL CHECK(outcome IN (
                       'renamed','declined','manual_review',
                       'not_ingested','ingest_failed')),
    reviewed_at    TEXT NOT NULL,
    reason         TEXT,
    failure_class  TEXT CHECK(failure_class IN ('deterministic','extractor')),
    retry_next_run INTEGER CHECK(retry_next_run IN (0,1)),
    UNIQUE (file_hash, file_name)
);
INSERT INTO housekeeping_reviews_new
    (review_id, file_hash, file_name, folder_type, outcome, reviewed_at)
SELECT review_id, file_hash, file_name, folder_type, outcome, reviewed_at
FROM housekeeping_reviews;
DROP TABLE housekeeping_reviews;
ALTER TABLE housekeeping_reviews_new RENAME TO housekeeping_reviews;
CREATE INDEX IF NOT EXISTS idx_housekeeping_reviews_name ON housekeeping_reviews(file_name);

-- MIGRATE 88 -> 89 -- DB: main
-- main: counsel of record is court-record state, read live by the drafting
--      runtime through parties_of_record.py (decision #55). parties gains
--      lawyer_email and lawyer_phone, so counsel's email and telephone are
--      fields of their own instead of a part of the contact_info blob.
--      proceeding_parties gains nullable per-proceeding overrides of the
--      party's counsel and address for service (lawyer_name, lawyer_firm,
--      lawyer_email, lawyer_phone, address, service_address_filed_date).
--      Counsel of record is per party by default; an override is written only
--      when the practitioner expressly says counsel differs for that
--      proceeding, on every role row the party holds in it. A reader resolves
--      each value to the override when set, else the party's own value.
--      Purely additive, nullable, no DEFAULT: NULL is the honest backfill.
--      Like the 81 -> 82 hop, ALTER TABLE ADD COLUMN is not re-runnable; the
--      engine applies each hop exactly once.
ALTER TABLE parties ADD COLUMN lawyer_email TEXT;
ALTER TABLE parties ADD COLUMN lawyer_phone TEXT;
ALTER TABLE proceeding_parties ADD COLUMN lawyer_name TEXT;
ALTER TABLE proceeding_parties ADD COLUMN lawyer_firm TEXT;
ALTER TABLE proceeding_parties ADD COLUMN lawyer_email TEXT;
ALTER TABLE proceeding_parties ADD COLUMN lawyer_phone TEXT;
ALTER TABLE proceeding_parties ADD COLUMN address TEXT;
ALTER TABLE proceeding_parties ADD COLUMN service_address_filed_date TEXT;

-- MIGRATE 89 -> 90 -- DB: main
-- main: participant name aliases (decision #65). New tribunal_members table:
--      judges, associate judges, arbitrators, tribunal members and registrars
--      are participants, not parties. New participant_aliases table: other
--      spellings of a participant's name and the firm's file-name codes for
--      them, each row owned by exactly one party, party's counsel, witness or
--      tribunal member, and stamped with the date of the practitioner's
--      approval. Purely additive, no backfill. CREATE ... IF NOT EXISTS keeps
--      this hop re-runnable, the same shape as the 83 -> 84 hop.
CREATE TABLE IF NOT EXISTS tribunal_members (
    tribunal_member_id  INTEGER PRIMARY KEY,
    name                TEXT NOT NULL,
    capacity            TEXT,
    tribunal_body       TEXT,
    proceeding_id       INTEGER REFERENCES proceedings(proceeding_id),
    notes               TEXT
);
CREATE TABLE IF NOT EXISTS participant_aliases (
    alias_id            INTEGER PRIMARY KEY,
    party_id            INTEGER REFERENCES parties(party_id),
    of_counsel          INTEGER NOT NULL DEFAULT 0 CHECK(of_counsel IN (0,1)),
    witness_id          INTEGER REFERENCES witnesses(witness_id),
    tribunal_member_id  INTEGER REFERENCES tribunal_members(tribunal_member_id),
    alias_text          TEXT NOT NULL CHECK(length(trim(alias_text)) > 0),
    alias_kind          TEXT NOT NULL CHECK(alias_kind IN ('spelling','file_code')),
    approved_on         TEXT NOT NULL CHECK(length(approved_on) >= 10),
    notes               TEXT,
    CHECK ((party_id IS NOT NULL) + (witness_id IS NOT NULL)
           + (tribunal_member_id IS NOT NULL) = 1),
    CHECK (of_counsel = 0 OR party_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_tribunal_members_proceeding ON tribunal_members(proceeding_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_participant_aliases_unique ON participant_aliases(
    COALESCE(party_id, 0), of_counsel, COALESCE(witness_id, 0),
    COALESCE(tribunal_member_id, 0), alias_text COLLATE NOCASE);
