-- =========================================================================
-- Case Data — schema v9.0 — three-database architecture (main / law / privileged)
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
-- v6.2 → v6.3 changes:
--   law: legal_concepts and legal_criteria gain in_force_date, repeal_date (temporal validity)
-- v6.3 → v6.4 changes:
--   law: authorities gains disposition (case outcome)
--   law: concept_authorities gains finding, factual_context, obiter (case brief fields)
-- v6.4 → v6.5 changes:
--   law: authorities gains last_verified_at (verification timestamp)
-- v6.5 → v6.6 changes:
--   law: added authority_treatments table (authority-to-authority treatment linkage)
--   law: concept_authorities gains treatment, treated_by_authority_id; relationship CHECK adds 'affirms'
--   law: legal_criteria gains treatment, treated_by_authority_id
-- v6.6 → v6.7 changes:
--   main: sources gains parent_source_id (self-referential FK for compound documents)
--   main: facts gains basis_of_knowledge, informant (affidavit hearsay tracking)
-- v6.7 → v6.8 changes:
--   main: sources gains ingestion_status (completeness signal for incremental re-ingestion)
-- v6.8 → v6.9 changes:
--   main: sources gains last_verified_at (verification timestamp for non-authority sources)
--   main: facts gains human_reviewed (distinguishes AI-verified from lawyer-confirmed)
--   main: positions gains human_reviewed (same purpose)
--   main: added idx_facts_source_locator composite index
-- v6.9 → v7.0 changes (issue #49 — local working legal-knowledge layer / up-pointers):
--   law: legal_concepts gains cloud_principle_id, pushed_at, pushed_source_hash
--        (one-way up-pointer + derived push-state tracking) + two cross-column CHECKs
--        + idx_legal_concepts_cloud
--   law: authorities gains cloud_authority_id (dedup cache; no push-state machinery)
--   main: added issue_concepts junction (issue_id, concept_id, relevance, notes)
--        + idx_issue_concepts_concept
-- v7.0 → v7.1 changes (123A — legal edges enter the verification pipeline):
--   law: concept_authorities gains verified (4-state enum per shared/conventions.md §4)
--        and notes (provenance of a correction). Edges were previously write-once at
--        ingest: verified by nothing, amendable by nothing. operations/amend-law.md is
--        now the sole sanctioned path that changes law-side text.
--   Backfill is 0 for existing rows (nothing has ever verified an edge). NOT NULL —
--        every consumer filters `verified >= 0`, and NULL rows vanish under SQL
--        three-valued logic.
-- v7.1 → v7.2 changes (counterclaim-posture roles):
--   main: proceeding_parties.role CHECK gains 'plaintiff_by_counterclaim' and
--         'defendant_by_counterclaim', so a party's counterclaim-side role
--         (e.g. a plaintiff who is also a defendant by counterclaim) can be
--         distinguished from its main-action role instead of reusing the same
--         plaintiff/defendant value for both and looking like a duplicate/
--         contradictory row.
-- v7.2 → v7.3 changes (authority search capture):
--   law: authorities gains fact_pattern and loss_description; concept_authorities
--        gains order_terms. All three are local-only capture fields.
-- v7.3 → v7.4 changes (theorized-fact placeholders):
--   privileged: fact_provenance gains disposition (active|dismissed) — the terminal
--        investigation marker for a theorized fact (a fact theorized for
--        investigation, provenance-linked to a 'Theory of the case' placeholder
--        source, no evidence yet). 'dismissed' means our own investigation concluded
--        the fact is likely untrue; arguments must not rest on it. Backfill 'active'
--        for every existing row (default). No main-side change — a theorized fact
--        with no positions honestly derives posture 'unaddressed'; the firewall keeps
--        this private case-theory conclusion out of main.sqlite by construction.
-- v7.4 → v7.5 changes (counterclaim role correction):
--   main: proceeding_parties.role removes 'plaintiff_by_counterclaim'.
--         Existing main-action defendants remain defendants when they bring a
--         counterclaim; 'defendant_by_counterclaim' is reserved for a party
--         joined only through the counterclaim.
-- v7.5 → v7.6 changes:
--   main: positions replace silent with not_admit/no_position and add position_basis
--   main: relief_items/relief_positions separate remedies from factual propositions
--   main: source_references records incorporation, response, and procedural references
-- v7.6 → v7.7 changes (housekeeping review log):
--   main: housekeeping_reviews records which files the housekeeping file-naming run
--        has already opened and reached a verdict on, so a later run skips them
--        instead of paying to reopen them. Keyed on the file's SHA-256 so a file
--        manually renamed after review is still recognised; also indexed on the
--        name it carried at review time, which is the cheap first lookup. This is
--        operational run-state, not case data — see CLAUDE.md decision #26.
-- v7.7 → v7.8 changes (witnesses and client instructions):
--   main: witnesses become first-class entities, with experts represented by
--        witness_type = 'expert' and expert-only retention/qualification fields;
--        proceeding_witnesses links each witness to a proceeding and calling party.
--   privileged: client_instructions records bitemporal solicitor-client directions,
--        source-linked within privileged.sqlite and trigger-linked to the client and
--        proceeding in main.sqlite.
-- v7.8 → v7.9 changes (affidavit execution status):
--   main: sources gains execution_status ('draft'|'affirmed'|'filed') — the
--        affidavit execution state carried by the body row (exhibits stay NULL).
--        NULL = not an affidavit / never assessed; honest backfill for every
--        existing row, so no DEFAULT.
-- v7.9 → v8.0 changes (targeted correction re-verification):
--   main: facts and positions gain pending_reverification. A corrected row stays
--        unverified but is quarantined until a second isolated verifier confirms
--        it; the cross-column CHECK prevents pending rows from appearing verified
--        or human-reviewed.
-- v8.0 → v8.1 changes (admissions as proof instruments):
--   main: new admissions table. An admission is a proof instrument, not a
--        stance: positions record what a party said (decision #25), and a
--        deemed admission is a legal consequence of silence that no party
--        asserted, so minting an 'admit' position for it would fabricate a
--        stance the party never took (decisions #8, #25). Six kinds; four
--        qualify an application's admitted-proof route unsworn, and
--        express_other/discovery are provenance-only instruments cited by a
--        sworn evidence use. Purely additive — no backfill.
-- v8.1 → v8.2 changes (address-for-service provenance):
--   main: parties gains service_address_filed_date and replaced_representative —
--        two breadcrumbs, not a history. The date answers "was service at time X
--        to the then-current address?"; the replaced name is the search key into
--        the scanned court file. A full bitemporal address history was considered
--        and rejected: chains of successive changes reconstruct from the court
--        file using these two fields, and a snapshot table does not earn
--        bitemporal machinery. A Notice of Withdrawal sets both symmetrically
--        with an appointment — filing date, and the withdrawing lawyer as the
--        replaced representative, the party becoming self-represented at its
--        Rule 4-2(7) last-known address. Nullable, no DEFAULT: NULL is the
--        honest backfill for every existing row.
-- v8.2 → v8.3 changes (appeal role):
--   main: proceeding_parties.role CHECK gains 'appellant' — a BC Court of
--        Appeal proceeding has no role for the party who filed the appeal;
--        'respondent' already covers the opposing party (it is reused
--        unchanged across petition, application, and appeal contexts, matching
--        BC practice's own use of one word for all three). Table rebuild,
--        same pattern as the v7.1→v7.2 CHECK widening.
-- v8.3 → v8.4 changes (sought orders):
--   main: new sought_orders table — a flat, verbatim, paragraph-numbered
--        transcription of a served Notice of Application's Part 1, captured
--        at ingest and linked to its sources row. Not relief_items: relief_items
--        tracks a party's bitemporal stance toward a paraphrased remedy across
--        the proceeding; this table transcribes one document's own printed
--        text with no stance and no versioning (decision #44). Purely
--        additive — no backfill of previously ingested documents.
-- v8.4 → v8.5 changes (retired-filing law bridge):
--   law: authorities.authority_type CHECK gains 'oral_reasons' — a decision
--        pronounced from the bench with no transcript. It is a real authority
--        row so treatments can point at it, and it carries a synthetic
--        citation built from court + file number + judge + date; it is never
--        given a concept_authorities edge, because it can be cited for
--        nothing until a transcript arrives (design D4).
--   law: authority_treatments.treatment CHECK gains 'follows',
--        'declines_to_follow' and 'not_considered' — the present-tense
--        vocabulary an oral decision's treatment of a cited authority needs
--        (design D7). 'distinguishes' was already there and is reused.
--   law: concept_authorities.relationship CHECK gains 'answered' (the edge an
--        opposing authority earns when the practitioner ties it to a law
--        assertion the filing answered — written only on a practitioner tie),
--        and two new local-only capture columns, pinpoint and excerpt.
--        pinpoint/excerpt are the same class as order_terms: never-cross,
--        excluded from pushed_source_hash and from the push payload.
--   All three are CHECK widenings, so each is a table rebuild under an
--   explicit PRAGMA foreign_keys = OFF/ON bracket (authorities is a parent
--   table; migrate_engine._apply_marker sets foreign_keys ON).
-- v8.5 → v8.6 changes (client instructions without a proceeding):
--   privileged: client_instructions.proceeding_id becomes nullable. A matter
--        may have no proceeding (pure advice work) and solicitor-client
--        privilege attaches without one, but the column NOT NULL rejected
--        every such instruction and left the trigger's
--        WHEN NEW.proceeding_id IS NOT NULL guard unreachable. Same pattern as
--        privileged_sources.proceeding_id. party_id stays NOT NULL: an
--        instruction always names the instructing party. Table rebuild under
--        a PRAGMA foreign_keys = OFF/ON bracket (prior_id is a self-reference).
-- v8.6 → v8.7 changes (pending privilege review):
--   main: sources gains privilege_status ('pending'|'cleared'). NULL = never
--        assessed, the honest backfill for every existing row, so no DEFAULT.
--        'pending' = the practitioner has not yet made the privilege call;
--        'cleared' = the practitioner decided the document is not privileged.
--        A document decided privileged does not stay in main at all — it is
--        re-homed to privileged.privileged_sources (decision #49). The
--        cross-column CHECK makes listed = 1 impossible while pending. TEMP
--        triggers refuse a new evidence_links or positions row citing a
--        pending source, and the drafting/evidence reads hold its facts back.
--        The migration backfills 'pending' only where notes start
--        'PRIVILEGE REVIEW PENDING'; everything else stays NULL.
-- v8.7 → v8.8 changes (housekeeping ingest outcomes):
--   main: housekeeping_reviews.outcome CHECK gains 'not_ingested' (the
--        practitioner filed the file without ingesting it; settles the name
--        arm and, by hash, the ingest arm) and 'ingest_failed' (a remembered
--        ingest failure; settles nothing, it schedules the automatic retry).
--        folder_type becomes nullable: a root file's failure has no folder
--        type. New nullable columns reason, failure_class
--        ('deterministic'|'extractor') and retry_next_run (0|1). 'declined'
--        stays in the CHECK so no existing row is rewritten; nothing writes
--        it. Table rebuild; every existing row is copied across unchanged.
-- v8.8 → v8.9 changes (counsel of record read live; decision #55):
--   main: parties gains lawyer_email and lawyer_phone, counsel's email and
--        telephone as fields of their own. proceeding_parties gains nullable
--        per-proceeding overrides of the party's counsel and address for
--        service: lawyer_name, lawyer_firm, lawyer_email, lawyer_phone,
--        address, service_address_filed_date. Counsel of record is per party
--        by default; an override is written only when the practitioner
--        expressly says counsel differs for that proceeding, and a reader
--        resolves each value to the override when set, else the party's own.
--        Additive, nullable, no DEFAULT; NULL is the honest backfill.
-- v8.9 → v9.0 changes (participant name aliases; decision #65):
--   main: new tribunal_members table — judges, associate judges, arbitrators,
--        tribunal members and registrars are participants, not parties.
--   main: new participant_aliases table — other spellings and the firm's
--        file-name codes for a party, a party's counsel, a witness or a
--        tribunal member. approved_on records the practitioner's approval
--        turn. Purely additive: main moves from 23 to 25 tables.
-- Sections below MUST be delimited by the v6 BEGIN/END markers.
-- The init/rebuild scripts parse this file by marker.
-- PRAGMA user_version encoding: v9.0 = 90 (major * 10 + minor).
-- Set by initialize.md on creation; maintained by migrate.md/rebuild.py.
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
    contact_info    TEXT,
    service_address_filed_date TEXT,   -- ISO date the CURRENT address for service was
                                       -- filed/effective in the court record (the filed
                                       -- NOWOL/NACL/NOAIP date, or the order date if
                                       -- changed by order). NULL = unknown/unchanged.
    replaced_representative    TEXT,   -- name (and firm if known) of the lawyer or
                                       -- representative the current one replaced (e.g.
                                       -- "George Lee - George Lee Law Corporation" or
                                       -- "self-represented"). NULL = no predecessor known.
                                       -- No comma in this comment: SQLite's DROP COLUMN
                                       -- of a later last column reads one as the column
                                       -- separator and breaks the stored DDL.
    lawyer_email    TEXT,              -- v8.9: counsel email; NULL = none of record
    lawyer_phone    TEXT               -- v8.9: counsel telephone; NULL = none of record
);

CREATE TABLE proceeding_parties (
    proceeding_id   INTEGER NOT NULL REFERENCES proceedings(proceeding_id),
    party_id        INTEGER NOT NULL REFERENCES parties(party_id),
    role            TEXT NOT NULL CHECK(role IN (
                        'plaintiff','defendant','third_party','intervenor',
                        'applicant','respondent','petitioner','appellant',
                        'defendant_by_counterclaim')),
    -- v8.9: per-proceeding overrides of the party's counsel and address for
    -- service. NULL = the party's own value applies. Written only when the
    -- practitioner expressly says counsel differs for this proceeding and
    -- then on every role row the party holds in it (decision #55). No comma
    -- in these comments (see parties.replaced_representative).
    lawyer_name     TEXT,
    lawyer_firm     TEXT,
    lawyer_email    TEXT,
    lawyer_phone    TEXT,
    address         TEXT,
    service_address_filed_date TEXT,
    PRIMARY KEY (proceeding_id, party_id, role)
);

-- -----------------------------------------------------------------
-- Witnesses and proceeding assignments (v7.8)
-- Experts are a witness subtype, not a separate entity.
-- -----------------------------------------------------------------
CREATE TABLE witnesses (
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

CREATE TABLE proceeding_witnesses (
    proceeding_id       INTEGER NOT NULL REFERENCES proceedings(proceeding_id),
    witness_id          INTEGER NOT NULL REFERENCES witnesses(witness_id),
    called_by_party_id  INTEGER REFERENCES parties(party_id),
    PRIMARY KEY (proceeding_id, witness_id)
);

-- -----------------------------------------------------------------
-- Tribunal members (v9.0; decision #65)
-- The decision-makers and registry officers a matter deals with: judges,
-- associate judges, arbitrators, tribunal members, registrars. Participants,
-- not parties. capacity is the forum's own word; tribunal_body names the forum.
-- -----------------------------------------------------------------
CREATE TABLE tribunal_members (
    tribunal_member_id  INTEGER PRIMARY KEY,
    name                TEXT NOT NULL,
    capacity            TEXT,
    tribunal_body       TEXT,
    proceeding_id       INTEGER REFERENCES proceedings(proceeding_id),
    notes               TEXT
);

-- -----------------------------------------------------------------
-- Participant aliases (v9.0; decision #65)
-- Other spellings of a participant's name, and the firm's file-name
-- author/recipient codes for them (file_code, e.g. SmithJ). Each row belongs
-- to exactly one party, party's counsel (of_counsel = 1), witness or tribunal
-- member. approved_on is the date of the practitioner's approval turn: no
-- alias is written without one.
-- -----------------------------------------------------------------
CREATE TABLE participant_aliases (
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
    notes               TEXT,
    parent_source_id    INTEGER REFERENCES sources(source_id),
    ingestion_status    TEXT CHECK(ingestion_status IN ('complete','partial','failed')),
    last_verified_at    TEXT,
    execution_status    TEXT CHECK(execution_status IN ('draft','affirmed','filed')),
    privilege_status    TEXT CHECK(privilege_status IN ('pending','cleared')
                            AND (privilege_status IS NOT 'pending' OR listed = 0))
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
    -- UTC default: never relied on; inserts set it with date('now','localtime')
    -- (shared/conventions.md §10). Changes at the next schema bump, as do the
    -- valid_from defaults below.
    created_date    TEXT DEFAULT (date('now')),
    notes           TEXT,
    basis_of_knowledge TEXT CHECK(basis_of_knowledge IN ('personal','information_and_belief')),
    informant       TEXT,
    human_reviewed  INTEGER DEFAULT 0 CHECK(human_reviewed IN (0,1)),
    pending_reverification INTEGER NOT NULL DEFAULT 0
        CHECK(pending_reverification IN (0,1)
          AND (pending_reverification = 0
               OR (verified IS 0 AND human_reviewed IS 0)))
);

-- -----------------------------------------------------------------
-- Positions on factual propositions
-- -----------------------------------------------------------------
CREATE TABLE positions (
    position_id     INTEGER PRIMARY KEY,
    fact_id         INTEGER NOT NULL REFERENCES facts(fact_id),
    party_id        INTEGER NOT NULL REFERENCES parties(party_id),
    position        TEXT NOT NULL CHECK(position IN (
                        'claim','admit','deny','not_admit','no_position')),
    position_basis  TEXT CHECK(position_basis IN (
                        'outside_knowledge','strict_proof','insufficient_particulars',
                        'directed_to_other_party','qualified','other')),
    qualification   TEXT,
    source_id       INTEGER REFERENCES sources(source_id),
    source_locator  TEXT,
    valid_from      TEXT NOT NULL DEFAULT (date('now')),
    valid_to        TEXT,
    prior_id        INTEGER REFERENCES positions(position_id),
    verified        INTEGER DEFAULT 0 CHECK(verified IN (-1,0,1,2)),
    notes           TEXT,
    human_reviewed  INTEGER DEFAULT 0 CHECK(human_reviewed IN (0,1)),
    pending_reverification INTEGER NOT NULL DEFAULT 0
        CHECK(pending_reverification IN (0,1)
          AND (pending_reverification = 0
               OR (verified IS 0 AND human_reviewed IS 0)))
);

-- -----------------------------------------------------------------
-- Admissions — proof instruments, distinct from positions
-- -----------------------------------------------------------------
-- A position is an on-record stance bound to a responding source and locator;
-- an admission is the evidentiary instrument that proves a fact without the
-- fact's own sworn evidence. Deemed kinds arise from a served instrument plus a
-- non-event, so they have no stance to record and require both
-- deemed_effective_date and source_id. Withdrawal closes valid_to and happens
-- by consent or with leave of the court (R. 7-7(5)) — never leave alone.
CREATE TABLE admissions (
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

-- -----------------------------------------------------------------
-- Relief sought and parties' positions on relief
-- -----------------------------------------------------------------
CREATE TABLE relief_items (
    relief_id           INTEGER PRIMARY KEY,
    proceeding_id       INTEGER REFERENCES proceedings(proceeding_id),
    source_id           INTEGER NOT NULL REFERENCES sources(source_id),
    seeking_party_id    INTEGER NOT NULL REFERENCES parties(party_id),
    against_party_id    INTEGER REFERENCES parties(party_id),
    description         TEXT NOT NULL,
    source_locator      TEXT,
    verified            INTEGER DEFAULT 0 CHECK(verified IN (-1,0,1,2)),
    notes               TEXT,
    human_reviewed      INTEGER DEFAULT 0 CHECK(human_reviewed IN (0,1))
);

CREATE TABLE relief_positions (
    relief_position_id  INTEGER PRIMARY KEY,
    relief_id           INTEGER NOT NULL REFERENCES relief_items(relief_id),
    party_id            INTEGER NOT NULL REFERENCES parties(party_id),
    position            TEXT NOT NULL CHECK(position IN (
                            'seek','consent','oppose','no_position')),
    qualification       TEXT,
    source_id           INTEGER REFERENCES sources(source_id),
    source_locator      TEXT,
    valid_from          TEXT NOT NULL DEFAULT (date('now')),
    valid_to            TEXT,
    prior_id            INTEGER REFERENCES relief_positions(relief_position_id),
    verified            INTEGER DEFAULT 0 CHECK(verified IN (-1,0,1,2)),
    notes               TEXT,
    human_reviewed      INTEGER DEFAULT 0 CHECK(human_reviewed IN (0,1))
);

-- -----------------------------------------------------------------
-- Sought orders — Part 1 of a served Notice of Application, captured
-- verbatim at ingest
-- -----------------------------------------------------------------
-- Not relief_items: relief_items tracks a party's bitemporal *stance* toward
-- a paraphrased remedy, generically, across every pleading type. This table
-- is a flat, paragraph-numbered transcription of one specific document
-- section's own printed text — no stance, no versioning (decision #44's
-- reasoning: one table cannot honestly answer both "what does the document
-- say" and "what does a party think about it"). Scope: a served Notice of
-- Application's Part 1 only. Dual capture is intended: an ingested NOA still
-- produces relief_items rows through the unchanged extract-facts path, and
-- these rows are never deduplicated against them.
CREATE TABLE sought_orders (
    sought_order_id  INTEGER PRIMARY KEY,
    source_id        INTEGER NOT NULL REFERENCES sources(source_id),
    order_number     TEXT NOT NULL,
    order_text       TEXT NOT NULL,
    verified         INTEGER DEFAULT 0 CHECK(verified IN (-1,0,1,2)),
    notes            TEXT,
    human_reviewed   INTEGER DEFAULT 0 CHECK(human_reviewed IN (0,1)),
    UNIQUE(source_id, order_number)
);

-- -----------------------------------------------------------------
-- Non-factual source references and procedural metadata
-- -----------------------------------------------------------------
CREATE TABLE source_references (
    source_reference_id INTEGER PRIMARY KEY,
    source_id           INTEGER NOT NULL REFERENCES sources(source_id),
    reference_type      TEXT NOT NULL CHECK(reference_type IN (
                            'responds_to','incorporates','adopts',
                            'paragraph_reference','procedural','other')),
    target_source_id    INTEGER REFERENCES sources(source_id),
    source_locator      TEXT,
    target_locator      TEXT,
    description         TEXT NOT NULL,
    verified            INTEGER DEFAULT 0 CHECK(verified IN (-1,0,1,2)),
    notes               TEXT
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

-- Issue-concept linkage (v7.0) — standalone doctrine/test/remedy concepts
-- with no path to an issue via causes_of_action or criteria.
-- notes = matter-strategy annotation home (severed by construction).
CREATE TABLE issue_concepts (
    issue_id    INTEGER NOT NULL REFERENCES issues(issue_id),
    concept_id  INTEGER NOT NULL,   -- trigger-enforced FK to law.legal_concepts
    relevance   TEXT CHECK(relevance IN ('supports','undermines','context')),
    notes       TEXT,
    PRIMARY KEY (issue_id, concept_id)
);

-- -----------------------------------------------------------------
-- Housekeeping review log (operational run-state, not case data)
-- -----------------------------------------------------------------
CREATE TABLE housekeeping_reviews (
    review_id      INTEGER PRIMARY KEY,
    file_hash      TEXT NOT NULL,       -- SHA-256 of the file's raw bytes, lowercase hex
    file_name      TEXT NOT NULL,       -- basename the file carried when the review closed
    folder_type    TEXT,                -- housekeeping folder type, e.g. 'Correspondence';
                                        -- NULL for a root file's ingest failure (v8.8)
    outcome        TEXT NOT NULL CHECK(outcome IN (
                       'renamed','declined','manual_review',
                       'not_ingested','ingest_failed')),
    reviewed_at    TEXT NOT NULL,
    reason         TEXT,                -- v8.8: why an ingest failed
    failure_class  TEXT CHECK(failure_class IN ('deterministic','extractor')),
    retry_next_run INTEGER CHECK(retry_next_run IN (0,1)),
    UNIQUE (file_hash, file_name)
);

-- -----------------------------------------------------------------
-- Indexes (main)
-- -----------------------------------------------------------------
CREATE INDEX idx_housekeeping_reviews_name   ON housekeeping_reviews(file_name);
CREATE INDEX idx_sources_proceeding          ON sources(proceeding_id);
CREATE INDEX idx_sources_hash                ON sources(file_hash);
CREATE INDEX idx_sources_parent              ON sources(parent_source_id);
CREATE INDEX idx_facts_source                ON facts(source_id);
CREATE INDEX idx_facts_source_locator        ON facts(source_id, source_locator);
CREATE INDEX idx_facts_category              ON facts(category);
CREATE INDEX idx_proceeding_parties_party    ON proceeding_parties(party_id);
CREATE INDEX idx_witnesses_type              ON witnesses(witness_type);
CREATE INDEX idx_witnesses_retained_by       ON witnesses(retained_by_party_id);
CREATE INDEX idx_witnesses_report_source     ON witnesses(report_source_id);
CREATE INDEX idx_tribunal_members_proceeding ON tribunal_members(proceeding_id);
CREATE UNIQUE INDEX idx_participant_aliases_unique ON participant_aliases(
    COALESCE(party_id, 0), of_counsel, COALESCE(witness_id, 0),
    COALESCE(tribunal_member_id, 0), alias_text COLLATE NOCASE);
CREATE INDEX idx_proceeding_witnesses_witness ON proceeding_witnesses(witness_id);
CREATE INDEX idx_proceeding_witnesses_called_by ON proceeding_witnesses(called_by_party_id);
CREATE INDEX idx_positions_fact_current      ON positions(fact_id, valid_to);
CREATE INDEX idx_positions_party             ON positions(party_id);
CREATE INDEX idx_positions_source            ON positions(source_id);
CREATE UNIQUE INDEX uq_positions_current_response
    ON positions(fact_id, party_id, COALESCE(source_id, -1), COALESCE(source_locator, ''))
    WHERE valid_to IS NULL;
CREATE INDEX idx_admissions_fact_party        ON admissions(fact_id, admitting_party_id, valid_to);
CREATE INDEX idx_admissions_kind              ON admissions(admission_kind, valid_to);
CREATE INDEX idx_admissions_source            ON admissions(source_id);
CREATE INDEX idx_relief_items_source          ON relief_items(source_id);
CREATE INDEX idx_relief_items_proceeding      ON relief_items(proceeding_id);
CREATE INDEX idx_relief_positions_relief      ON relief_positions(relief_id, valid_to);
CREATE INDEX idx_relief_positions_source      ON relief_positions(source_id);
CREATE UNIQUE INDEX uq_relief_positions_current_response
    ON relief_positions(
        relief_id, party_id, COALESCE(source_id, -1), COALESCE(source_locator, ''))
    WHERE valid_to IS NULL;
CREATE INDEX idx_source_references_source     ON source_references(source_id);
CREATE INDEX idx_source_references_target     ON source_references(target_source_id);
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
CREATE INDEX idx_issue_concepts_concept        ON issue_concepts(concept_id);
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
                        'case_law','statute','regulation','treatise','other',
                        'oral_reasons')),  -- v8.5: bench decision, no transcript
    jurisdiction    TEXT,
    file_path       TEXT,
    file_hash       TEXT,
    notes           TEXT,
    disposition     TEXT,
    fact_pattern    TEXT,  -- Design: Engineering/1. Design/2026-07-18_authority-search-capture-design.md
    loss_description TEXT, -- Design: Engineering/1. Design/2026-07-18_authority-search-capture-design.md
    last_verified_at TEXT,
    cloud_authority_id TEXT  -- cache of the deduped cloud authority UUID (v7.0);
                             -- citation remains the natural key; no push-state machinery
);

-- -----------------------------------------------------------------
-- Authority treatments (v6.6)
-- How one authority treats another (affirms, reverses, etc.)
-- -----------------------------------------------------------------
CREATE TABLE authority_treatments (
    treating_authority_id INTEGER NOT NULL REFERENCES authorities(authority_id),
    treated_authority_id  INTEGER NOT NULL REFERENCES authorities(authority_id),
    treatment TEXT NOT NULL CHECK(treatment IN (
        'affirms','reverses','varies','distinguishes','overrules',
        'follows','declines_to_follow','not_considered')),  -- v8.5: oral-decision vocabulary
    scope TEXT CHECK(scope IN ('full','partial')),
    notes TEXT,
    PRIMARY KEY (treating_authority_id, treated_authority_id),
    CHECK (treating_authority_id != treated_authority_id)
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
    in_force_date   DATE,
    repeal_date     DATE,
    notes           TEXT,
    cloud_principle_id  TEXT,     -- one-way up-pointer: cloud principle UUID (v7.0);
                                  -- NULL = unpushed. Never rewritten on cloud merges;
                                  -- redirects resolve in the cloud lookup tool (issue 48, D2).
    pushed_at           TEXT,     -- ISO timestamp of last push or cloud import
    pushed_source_hash  TEXT,     -- SHA-256 of push-source fields (name, description,
                                  -- ordered criteria) at push time; divergence = recomputed
                                  -- hash differs. Computed by the gatekeeper; SQLite cannot
                                  -- derive it.
    UNIQUE(name, jurisdiction),
    CHECK ((cloud_principle_id IS NULL) = (pushed_at IS NULL)),
    CHECK ((cloud_principle_id IS NULL) = (pushed_source_hash IS NULL))
);

-- -----------------------------------------------------------------
-- Concept-authority linkage (v6.1)
-- Which authorities establish, refine, or distinguish a concept.
-- -----------------------------------------------------------------
CREATE TABLE concept_authorities (
    concept_id      INTEGER NOT NULL REFERENCES legal_concepts(concept_id),
    authority_id    INTEGER NOT NULL REFERENCES authorities(authority_id),
    relationship    TEXT NOT NULL CHECK(relationship IN (
                        'establishes','refines','applies','distinguishes','affirms',
                        'answered')),  -- v8.5: opposing authority the filing answered
    proposition     TEXT,
    finding         TEXT,
    factual_context TEXT,
    obiter          TEXT,
    order_terms     TEXT,  -- Design: Engineering/1. Design/2026-07-18_authority-search-capture-design.md
    pinpoint        TEXT,  -- v8.5: local-only capture; never crosses, hash-excluded
    excerpt         TEXT,  -- v8.5: local-only capture; never crosses, hash-excluded
    treatment       TEXT CHECK(treatment IN (
                        'affirmed','reversed','varied','distinguished','overruled')),
    treated_by_authority_id INTEGER REFERENCES authorities(authority_id),
    verified        INTEGER DEFAULT 0 CHECK(verified IN (-1,0,1,2)),  -- v7.1
    notes           TEXT,                                             -- v7.1: correction provenance
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
    burden_of_proof         TEXT,   -- free text (v7.0, widened during B3 migration,
                                    -- handover 114H): the cloud layer models this as
                                    -- free text and real matter data uses it for the
                                    -- burden-BEARER ("on the party asserting duress"),
                                    -- not only the standard. The former 3-value enum
                                    -- ('balance','beyond_reasonable_doubt','clear_and_convincing')
                                    -- discarded 24 real rows. Do NOT re-narrow to the enum
                                    -- without normalizing the underlying data first.
    determined_by_concept_id INTEGER REFERENCES legal_concepts(concept_id),
    authority_id            INTEGER REFERENCES authorities(authority_id),
    authority_proposition   TEXT,
    notes                   TEXT,
    in_force_date           DATE,
    repeal_date             DATE,
    treatment               TEXT CHECK(treatment IN (
                                'affirmed','reversed','varied','distinguished','overruled')),
    treated_by_authority_id INTEGER REFERENCES authorities(authority_id),
    UNIQUE(concept_id, criterion_order)
);

-- -----------------------------------------------------------------
-- Indexes (law)
-- -----------------------------------------------------------------
CREATE INDEX idx_authority_treatments_treated    ON authority_treatments(treated_authority_id);
CREATE INDEX idx_legal_concepts_type             ON legal_concepts(concept_type);
CREATE INDEX idx_legal_concepts_cloud            ON legal_concepts(cloud_principle_id);
CREATE INDEX idx_concept_authorities_authority   ON concept_authorities(authority_id);
CREATE INDEX idx_concept_authorities_treated_by  ON concept_authorities(treated_by_authority_id);
CREATE INDEX idx_legal_criteria_concept          ON legal_criteria(concept_id);
CREATE INDEX idx_legal_criteria_authority        ON legal_criteria(authority_id);
CREATE INDEX idx_legal_criteria_determined_by    ON legal_criteria(determined_by_concept_id);
CREATE INDEX idx_legal_criteria_treated_by       ON legal_criteria(treated_by_authority_id);
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
    disposition TEXT NOT NULL DEFAULT 'active' CHECK(disposition IN ('active','dismissed')),
    PRIMARY KEY (fact_id, source_id)
);

-- -----------------------------------------------------------------
-- Client instructions (v7.8 — privileged and bitemporal)
-- -----------------------------------------------------------------
CREATE TABLE client_instructions (
    instruction_id  INTEGER PRIMARY KEY,
    proceeding_id   INTEGER,           -- trigger-enforced FK to main.proceedings; NULL = no proceeding (v8.6)
    party_id        INTEGER NOT NULL,  -- trigger-enforced FK to main.parties
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

-- -----------------------------------------------------------------
-- Indexes (privileged)
-- -----------------------------------------------------------------
CREATE INDEX idx_privileged_sources_proc ON privileged_sources(proceeding_id);
CREATE INDEX idx_fact_provenance_fact    ON fact_provenance(fact_id);
CREATE INDEX idx_fact_provenance_source  ON fact_provenance(source_id);
CREATE INDEX idx_client_instructions_proceeding_status
    ON client_instructions(proceeding_id, status, valid_to);
CREATE INDEX idx_client_instructions_party
    ON client_instructions(party_id, valid_to);
CREATE INDEX idx_client_instructions_source
    ON client_instructions(source_id);
-- ===== v6 END privileged =====
