-- =========================================================================
-- Case Data — schema v6.2 — three-database architecture (main / law / privileged)
-- v5 → v6 changes:
--   Placement: three databases restructured (core/internal/ev → main/law/privileged)
--   Shape: documents→sources, evidence_items eliminated, positions simplified
--          (4 types: claim/admit/deny/silent), evidence_links replaces fact_evidence
--   Legal: legal_criteria moves to law.sqlite
-- v6 → v6.1 changes:
--   law: added legal_concepts table (concept_type discriminator)
--   law: added concept_authorities junction table
--   law: legal_criteria gains concept_id FK, requirement_type, determined_by_concept_id
--   law: legal_criteria drops coa_type column
--   main: causes_of_action.coa_type replaced by concept_id (trigger-enforced FK)
-- v6.1 → v6.2 changes:
--   main: added matter_metadata key-value table for self-describing databases
--   main: proceedings gains courthouse_address and trial_date
--   main/privileged: evidence/provenance pinpoints use source_locator
-- Sections below MUST be delimited by the v6 BEGIN/END markers.
-- The init/rebuild scripts parse this file by marker.
-- =========================================================================

-- ===== v6 BEGIN main =====
PRAGMA foreign_keys = ON;

-- -----------------------------------------------------------------
-- Matter metadata
-- -----------------------------------------------------------------
CREATE TABLE matter_metadata (
    key   TEXT PRIMARY KEY,
    value TEXT
);

-- -----------------------------------------------------------------
-- Proceedings
-- -----------------------------------------------------------------
CREATE TABLE proceedings (
    proceeding_id   INTEGER PRIMARY KEY,
    court           TEXT NOT NULL,
    registry        TEXT,
    file_number     TEXT NOT NULL UNIQUE,
    style_of_cause  TEXT,
    courthouse_address TEXT,
    trial_date      TEXT,
    status          TEXT CHECK(status IN ('active','stayed','concluded'))
);

-- -----------------------------------------------------------------
-- Parties
-- -----------------------------------------------------------------
CREATE TABLE parties (
    party_id        INTEGER PRIMARY KEY,
    name            TEXT NOT NULL,
    party_type      TEXT CHECK(party_type IN (
                        'individual','corporation','partnership','other')),
    lawyer_name     TEXT,
    lawyer_firm     TEXT,
    address         TEXT,
    contact_info    TEXT
);

CREATE TABLE proceeding_parties (
    proceeding_id   INTEGER NOT NULL REFERENCES proceedings(proceeding_id),
    party_id        INTEGER NOT NULL REFERENCES parties(party_id),
    role            TEXT NOT NULL CHECK(role IN (
                        'plaintiff','defendant','third_party','intervenor',
                        'applicant','respondent','petitioner')),
    PRIMARY KEY (proceeding_id, party_id, role)
);

-- -----------------------------------------------------------------
-- Sources (non-privileged, case-specific materials)
-- -----------------------------------------------------------------
CREATE TABLE sources (
    source_id           INTEGER PRIMARY KEY,
    proceeding_id       INTEGER REFERENCES proceedings(proceeding_id),
    category            TEXT NOT NULL CHECK(category IN (
                            'court','correspondence','production',
                            'work_product','disbursements')),
    title               TEXT NOT NULL,
    description         TEXT,
    filed_by_party_id   INTEGER REFERENCES parties(party_id),
    date                TEXT,
    file_path           TEXT,
    file_hash           TEXT,
    listed              INTEGER DEFAULT 0 CHECK(listed IN (0,1)),
    admissible          INTEGER CHECK(admissible IN (0,1)),
    last_ingested_at    TEXT,
    verified            INTEGER DEFAULT 0 CHECK(verified IN (-1,0,1,2)),
    notes               TEXT
);

-- -----------------------------------------------------------------
-- Facts
-- -----------------------------------------------------------------
CREATE TABLE facts (
    fact_id         INTEGER PRIMARY KEY,
    description     TEXT NOT NULL,
    category        TEXT,
    date_of_fact    TEXT,
    source_id       INTEGER REFERENCES sources(source_id),
    source_locator  TEXT,
    verified        INTEGER DEFAULT 0 CHECK(verified IN (-1,0,1,2)),
    created_date    TEXT DEFAULT (date('now')),
    notes           TEXT
);

-- -----------------------------------------------------------------
-- Positions (claim / admit / deny / silent)
-- -----------------------------------------------------------------
CREATE TABLE positions (
    position_id     INTEGER PRIMARY KEY,
    fact_id         INTEGER NOT NULL REFERENCES facts(fact_id),
    party_id        INTEGER NOT NULL REFERENCES parties(party_id),
    position        TEXT NOT NULL CHECK(position IN ('claim','admit','deny','silent')),
    qualification   TEXT,
    source_id       INTEGER REFERENCES sources(source_id),
    source_locator  TEXT,
    valid_from      TEXT NOT NULL DEFAULT (date('now')),
    valid_to        TEXT,
    prior_id        INTEGER REFERENCES positions(position_id),
    verified        INTEGER DEFAULT 0 CHECK(verified IN (-1,0,1,2)),
    notes           TEXT
);

-- -----------------------------------------------------------------
-- Evidence links (source -> fact, with strength)
-- -----------------------------------------------------------------
CREATE TABLE evidence_links (
    evidence_link_id INTEGER PRIMARY KEY,
    source_id       INTEGER NOT NULL REFERENCES sources(source_id),
    fact_id         INTEGER NOT NULL REFERENCES facts(fact_id),
    source_locator  TEXT,
    strength        INTEGER NOT NULL CHECK(strength IN (-2,-1,0,1,2)),
    valid_from      TEXT NOT NULL DEFAULT (date('now')),
    valid_to        TEXT,
    prior_id        INTEGER REFERENCES evidence_links(evidence_link_id),
    verified        INTEGER DEFAULT 0 CHECK(verified IN (-1,0,1,2)),
    notes           TEXT
);

-- -----------------------------------------------------------------
-- Causes of action (case-specific, v6.1: concept_id replaces coa_type)
-- -----------------------------------------------------------------
CREATE TABLE causes_of_action (
    coa_id              INTEGER PRIMARY KEY,
    proceeding_id       INTEGER REFERENCES proceedings(proceeding_id),
    claiming_party_id   INTEGER NOT NULL REFERENCES parties(party_id),
    against_party_id    INTEGER REFERENCES parties(party_id),
    name                TEXT NOT NULL,
    concept_id          INTEGER NOT NULL,  -- trigger-enforced FK to law.legal_concepts
    source_id           INTEGER REFERENCES sources(source_id),
    notes               TEXT
);

-- Case-specific criterion assessment
CREATE TABLE coa_criteria (
    coa_id      INTEGER NOT NULL REFERENCES causes_of_action(coa_id),
    criterion_id  INTEGER NOT NULL,   -- trigger-enforced FK to law.legal_criteria
    sufficiency TEXT CHECK(sufficiency IN (
                    'proven','likely','gap','unknown')) DEFAULT 'unknown',
    notes       TEXT,
    PRIMARY KEY (coa_id, criterion_id)
);

-- Criterion-fact linkage
CREATE TABLE criteria_facts (
    criterion_id  INTEGER NOT NULL,   -- trigger-enforced FK to law.legal_criteria
    fact_id     INTEGER NOT NULL REFERENCES facts(fact_id),
    relevance   TEXT CHECK(relevance IN ('supports','undermines','context')),
    PRIMARY KEY (criterion_id, fact_id)
);

-- -----------------------------------------------------------------
-- Issues
-- -----------------------------------------------------------------
CREATE TABLE issues (
    issue_id            INTEGER PRIMARY KEY,
    proceeding_id       INTEGER REFERENCES proceedings(proceeding_id),
    title               TEXT NOT NULL,
    description         TEXT,
    issue_type          TEXT CHECK(issue_type IN ('factual','legal','mixed')),
    status              TEXT CHECK(status IN (
                            'open','resolved','abandoned')) DEFAULT 'open',
    our_position        TEXT,
    opposing_position   TEXT,
    priority            INTEGER,
    verified            INTEGER DEFAULT 0 CHECK(verified IN (-1,0,1,2)),
    notes               TEXT
);

CREATE TABLE issue_facts (
    issue_id    INTEGER NOT NULL REFERENCES issues(issue_id),
    fact_id     INTEGER NOT NULL REFERENCES facts(fact_id),
    relevance   TEXT CHECK(relevance IN ('supports','undermines','context')),
    PRIMARY KEY (issue_id, fact_id)
);

CREATE TABLE issue_criteria (
    issue_id    INTEGER NOT NULL REFERENCES issues(issue_id),
    criterion_id  INTEGER NOT NULL,   -- trigger-enforced FK to law.legal_criteria
    PRIMARY KEY (issue_id, criterion_id)
);

-- -----------------------------------------------------------------
-- Indexes (main)
-- -----------------------------------------------------------------
CREATE INDEX idx_sources_proceeding          ON sources(proceeding_id);
CREATE INDEX idx_sources_hash                ON sources(file_hash);
CREATE INDEX idx_facts_source                ON facts(source_id);
CREATE INDEX idx_facts_category              ON facts(category);
CREATE INDEX idx_proceeding_parties_party    ON proceeding_parties(party_id);
CREATE INDEX idx_positions_fact_current      ON positions(fact_id, valid_to);
CREATE INDEX idx_positions_party             ON positions(party_id);
CREATE INDEX idx_positions_source            ON positions(source_id);
CREATE INDEX idx_evidence_links_fact_current ON evidence_links(fact_id, valid_to);
CREATE INDEX idx_evidence_links_source       ON evidence_links(source_id);
CREATE INDEX idx_coa_proceeding              ON causes_of_action(proceeding_id);
CREATE INDEX idx_coa_claiming_party          ON causes_of_action(claiming_party_id);
CREATE INDEX idx_coa_concept                 ON causes_of_action(concept_id);
CREATE INDEX idx_coa_criteria_criterion        ON coa_criteria(criterion_id);
CREATE INDEX idx_criteria_facts_fact          ON criteria_facts(fact_id);
CREATE INDEX idx_issues_proceeding           ON issues(proceeding_id);
CREATE INDEX idx_issue_facts_fact            ON issue_facts(fact_id);
CREATE INDEX idx_issue_criteria_criterion      ON issue_criteria(criterion_id);
-- ===== v6 END main =====

-- ===== v6 BEGIN law =====
PRAGMA foreign_keys = ON;

-- -----------------------------------------------------------------
-- Authorities (case law, statutes, legal principles)
-- -----------------------------------------------------------------
CREATE TABLE authorities (
    authority_id    INTEGER PRIMARY KEY,
    title           TEXT NOT NULL,
    citation        TEXT,
    authority_type  TEXT CHECK(authority_type IN (
                        'case_law','statute','regulation','treatise','other')),
    jurisdiction    TEXT,
    file_path       TEXT,
    file_hash       TEXT,
    notes           TEXT
);

-- -----------------------------------------------------------------
-- Legal concepts (v6.1)
-- Causes of action, doctrines, tests, defences, and remedies as
-- first-class entities. Universal catalogue — zero client data.
-- -----------------------------------------------------------------
CREATE TABLE legal_concepts (
    concept_id      INTEGER PRIMARY KEY,
    name            TEXT NOT NULL,
    concept_type    TEXT NOT NULL CHECK(concept_type IN (
                        'cause_of_action','doctrine','test','defence','remedy')),
    description     TEXT,
    jurisdiction    TEXT,
    notes           TEXT,
    UNIQUE(name, jurisdiction)
);

-- -----------------------------------------------------------------
-- Concept-authority linkage (v6.1)
-- Which authorities establish, refine, or distinguish a concept.
-- -----------------------------------------------------------------
CREATE TABLE concept_authorities (
    concept_id      INTEGER NOT NULL REFERENCES legal_concepts(concept_id),
    authority_id    INTEGER NOT NULL REFERENCES authorities(authority_id),
    relationship    TEXT NOT NULL CHECK(relationship IN (
                        'establishes','refines','applies','distinguishes')),
    proposition     TEXT,
    PRIMARY KEY (concept_id, authority_id)
);

-- -----------------------------------------------------------------
-- Legal criteria (v6.1: concept_id FK, requirement_type, nesting)
-- Requirements belonging to a legal concept: elements or factors.
-- -----------------------------------------------------------------
CREATE TABLE legal_criteria (
    criterion_id              INTEGER PRIMARY KEY,
    concept_id              INTEGER NOT NULL REFERENCES legal_concepts(concept_id),
    requirement_type        TEXT NOT NULL DEFAULT 'element'
                            CHECK(requirement_type IN ('element','factor')),
    criterion_order           INTEGER NOT NULL,
    criterion_description     TEXT NOT NULL,
    burden_of_proof         TEXT CHECK(burden_of_proof IN (
                                'balance','beyond_reasonable_doubt',
                                'clear_and_convincing')),
    determined_by_concept_id INTEGER REFERENCES legal_concepts(concept_id),
    authority_id            INTEGER REFERENCES authorities(authority_id),
    authority_proposition   TEXT,
    notes                   TEXT,
    UNIQUE(concept_id, criterion_order)
);

-- -----------------------------------------------------------------
-- Indexes (law)
-- -----------------------------------------------------------------
CREATE INDEX idx_legal_concepts_type           ON legal_concepts(concept_type);
CREATE INDEX idx_concept_authorities_authority ON concept_authorities(authority_id);
CREATE INDEX idx_legal_criteria_concept        ON legal_criteria(concept_id);
CREATE INDEX idx_legal_criteria_authority      ON legal_criteria(authority_id);
CREATE INDEX idx_legal_criteria_determined_by  ON legal_criteria(determined_by_concept_id);
-- ===== v6 END law =====

-- ===== v6 BEGIN privileged =====
PRAGMA foreign_keys = ON;

-- -----------------------------------------------------------------
-- Privileged sources
-- -----------------------------------------------------------------
CREATE TABLE privileged_sources (
    source_id       INTEGER PRIMARY KEY,
    proceeding_id   INTEGER,    -- trigger-enforced FK to main.proceedings
    category        TEXT NOT NULL CHECK(category IN (
                        'solicitor_client','privileged_correspondence',
                        'privileged_work_product','other')),
    title           TEXT NOT NULL,
    description     TEXT,
    author          TEXT,
    recipient       TEXT,
    date            TEXT,
    file_path       TEXT,
    file_hash       TEXT,
    verified        INTEGER DEFAULT 0 CHECK(verified IN (-1,0,1,2)),
    notes           TEXT
);

-- -----------------------------------------------------------------
-- Fact provenance (where we first learned a fact — privileged)
-- -----------------------------------------------------------------
CREATE TABLE fact_provenance (
    fact_id     INTEGER NOT NULL,   -- trigger-enforced FK to main.facts
    source_id   INTEGER NOT NULL REFERENCES privileged_sources(source_id),
    source_locator TEXT,
    source_note TEXT,
    verified    INTEGER DEFAULT 0 CHECK(verified IN (-1,0,1,2)),
    PRIMARY KEY (fact_id, source_id)
);

-- -----------------------------------------------------------------
-- Indexes (privileged)
-- -----------------------------------------------------------------
CREATE INDEX idx_privileged_sources_proc ON privileged_sources(proceeding_id);
CREATE INDEX idx_fact_provenance_fact    ON fact_provenance(fact_id);
CREATE INDEX idx_fact_provenance_source  ON fact_provenance(source_id);
-- ===== v6 END privileged =====
