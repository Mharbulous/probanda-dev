-- =========================================================================
-- Case Data — Queries v9.0.
-- Views and canonical queries for the main/law/privileged architecture.
--
-- Views are CREATE VIEW statements (created in main.sqlite after ATTACH).
-- Canonical queries are parameterized SQL (? placeholders).
--
-- Query numbering:
--   01-12: v6 core queries (07 and 11 eliminated — contests/privilege_challenges removed)
--   13-17: v6.1 legal taxonomy queries
--   18:    v6.4 case brief query
--   19:    v6.6 authority treatment chain
--   20-21: v7.0 B2 gap-closure reads (criteria_facts, privileged_sources)
--   05c:   v7.1 edge-verification backlog (operations/verify-law.md)
--   05d:   v8.0 targeted corrected-row re-verification backlog
--   22:    v7.4 theorized-fact placeholders (operations/theorize-fact.md)
--   23-24: v7.8 witnesses and privileged client instructions
--   27:    v8.5 oral-reasons treatments (operations/ingest-submission-law.md)
--   28:    v8.7 sources pending privilege review (operations/resolve-privilege.md)
--   29:    v8.9 exhibits of a document (which affidavit exhibits it)
--   30:    v8.9 held copy of an instrument's full text (/legal-research fallback)
--
-- Pending privilege review (v8.7, design-decisions #49): the drafting and
-- evidence reads (v_fact_status, v_current_positions, 01, 02, 04, 20, 25)
-- hold back facts, positions and evidence from a main.sources row whose
-- privilege_status = 'pending'. The verification backlogs (review_queue,
-- 05a/05b/05d, 12), the history reads (09a/09b) and the integrity reads (06)
-- deliberately still see them.
--
-- Bare rows (design-decisions #67): a Fact known only from a privileged source
-- is a main.facts row with description = '' and nothing else. v_fact_status,
-- 05a and 05b skip it, which also keeps it out of get_facts_for_drafting.py.
-- Only 10 and 22 show what a bare row means, by reading the privileged side.
-- =========================================================================

-- =========================================================================
-- query_13/14/15/17 read law.sqlite's WORKING layer — a distinct surface
-- from the pooled layer-3 (/legal-commons) reads, not duplicates.
--
-- Upsert-only entity local read coverage (all 8 reachable):
--   coa_criteria         → @query_03      concept_authorities  → @query_14/@query_18
--   criteria_facts       → @query_20      authority_treatments → @query_19
--   issue_facts          → @query_08      privileged_sources   → @query_21
--   issue_criteria       → @query_08      fact_provenance      → @query_10
-- =========================================================================

-- =========================================================================
-- VIEWS
-- =========================================================================

-- -----------------------------------------------------------------
-- v_current_positions: current, non-rejected, non-quarantined positions,
-- excluding a position whose own source is pending privilege review (v8.7)
-- -----------------------------------------------------------------
CREATE VIEW IF NOT EXISTS v_current_positions AS
SELECT  p.position_id,
        p.fact_id,
        p.party_id,
        p.position,
        p.position_basis,
        p.qualification,
        p.source_id,
        p.source_locator,
        p.valid_from,
        p.verified
FROM    positions p
WHERE   p.valid_to IS NULL
  AND   p.verified >= 0
  AND   p.pending_reverification = 0
  AND   NOT EXISTS (
          SELECT 1 FROM sources ps
          WHERE ps.source_id = p.source_id AND ps.privilege_status = 'pending'
        );

-- -----------------------------------------------------------------
-- v_fact_status: one row per fact with derived posture
-- Posture rules (evaluated in precedence order):
--   Any deny                       → disputed
--   Any non-admission              → not_admitted
--   Any admission                  → admitted
--   Any express no-position        → no_position
--   Claim only                     → claimed
--   No current position rows       → unaddressed
-- A fact whose source is pending privilege review is held back (v8.7). The
-- predicate reads main.sources only: a main view cannot read the privileged
-- database. A fact with no source_id stays in.
-- A bare row (description = '', design-decisions #67) is held back too: it is
-- a Fact known only from a privileged source and holds nothing to show. The
-- view is dropped and created on every run, so this exclusion reaches a matter
-- whose views predate it.
-- -----------------------------------------------------------------
DROP VIEW IF EXISTS v_fact_status;
CREATE VIEW v_fact_status AS
SELECT
    f.fact_id,
    f.description,
    f.category,
    f.date_of_fact,
    f.verified,
    CASE
        WHEN EXISTS (
            SELECT 1 FROM v_current_positions WHERE fact_id = f.fact_id AND position = 'deny'
        ) THEN 'disputed'
        WHEN EXISTS (
            SELECT 1 FROM v_current_positions
            WHERE fact_id = f.fact_id AND position = 'not_admit'
        ) THEN 'not_admitted'
        WHEN EXISTS (
            SELECT 1 FROM v_current_positions WHERE fact_id = f.fact_id AND position = 'admit'
        ) THEN 'admitted'
        WHEN EXISTS (
            SELECT 1 FROM v_current_positions
            WHERE fact_id = f.fact_id AND position = 'no_position'
        ) THEN 'no_position'
        WHEN EXISTS (
            SELECT 1 FROM v_current_positions WHERE fact_id = f.fact_id AND position = 'claim'
        ) THEN 'claimed'
        ELSE 'unaddressed'
    END AS posture
FROM facts f
WHERE f.verified >= 0
  AND f.pending_reverification = 0
  AND f.description <> ''
  AND NOT EXISTS (
    SELECT 1 FROM sources ps
    WHERE ps.source_id = f.source_id AND ps.privilege_status = 'pending'
  );

-- -----------------------------------------------------------------
-- review_queue: cross-table surface for practitioner review
-- Covers facts and positions (verified = 2, not yet human-reviewed) and sources
-- (verified = 2 or ingestion_status = 'failed').
-- Notes prefix classification enables filtering by flag_type.
-- -----------------------------------------------------------------
CREATE VIEW IF NOT EXISTS review_queue AS
SELECT
    'fact'             AS record_type,
    f.fact_id          AS record_id,
    f.source_id,
    s.title            AS source_title,
    f.source_locator,
    f.description      AS summary,
    f.notes,
    f.verified,
    f.human_reviewed,
    CASE
        WHEN f.notes LIKE 'DISCREPANCY:%' THEN 'discrepancy'
        WHEN f.notes LIKE 'UNCONFIRMED:%' THEN 'unconfirmed'
        WHEN f.notes LIKE 'OCR:%'         THEN 'ocr'
        WHEN f.notes LIKE 'REVERIFICATION:%' THEN 'reverification_failed'
        ELSE 'flagged'
    END                AS flag_type
FROM   facts   f
-- LEFT JOIN (v8.7): a flagged fact with no main source (re-homed by
-- resolve-privilege.md, or learned from a privileged source) stays queued.
LEFT JOIN sources s ON s.source_id = f.source_id
WHERE  f.verified = 2
  AND  f.human_reviewed = 0
UNION ALL
SELECT
    'position'         AS record_type,
    p.position_id      AS record_id,
    p.source_id,
    s.title            AS source_title,
    p.source_locator,
    p.position || ': ' || f.description AS summary,
    p.notes,
    p.verified,
    p.human_reviewed,
    CASE
        WHEN p.notes LIKE 'REVERIFICATION:%' THEN 'reverification_failed'
        ELSE 'flagged'
    END                 AS flag_type
FROM positions p
JOIN facts f ON f.fact_id = p.fact_id
LEFT JOIN sources s ON s.source_id = p.source_id
WHERE p.verified = 2
  AND p.human_reviewed = 0
  AND p.valid_to IS NULL
UNION ALL
SELECT
    'relief_item'      AS record_type,
    r.relief_id        AS record_id,
    r.source_id,
    s.title            AS source_title,
    r.source_locator,
    r.description      AS summary,
    r.notes,
    r.verified,
    r.human_reviewed,
    'flagged'           AS flag_type
FROM relief_items r
JOIN sources s ON s.source_id = r.source_id
WHERE r.verified = 2
  AND r.human_reviewed = 0
UNION ALL
SELECT
    'relief_position'  AS record_type,
    rp.relief_position_id AS record_id,
    rp.source_id,
    s.title            AS source_title,
    rp.source_locator,
    rp.position || ': ' || r.description AS summary,
    rp.notes,
    rp.verified,
    rp.human_reviewed,
    'flagged'           AS flag_type
FROM relief_positions rp
JOIN relief_items r ON r.relief_id = rp.relief_id
LEFT JOIN sources s ON s.source_id = rp.source_id
WHERE rp.verified = 2
  AND rp.human_reviewed = 0
  AND rp.valid_to IS NULL
UNION ALL
SELECT
    'source_reference' AS record_type,
    sr.source_reference_id AS record_id,
    sr.source_id,
    s.title            AS source_title,
    sr.source_locator,
    sr.description     AS summary,
    sr.notes,
    sr.verified,
    0                   AS human_reviewed,
    'flagged'           AS flag_type
FROM source_references sr
JOIN sources s ON s.source_id = sr.source_id
WHERE sr.verified = 2
UNION ALL
SELECT
    'source'           AS record_type,
    s.source_id        AS record_id,
    s.source_id,
    s.title            AS source_title,
    NULL               AS source_locator,
    s.description      AS summary,
    s.notes,
    s.verified,
    0                  AS human_reviewed,
    CASE
        WHEN s.ingestion_status = 'failed' THEN 'failed_ingest'
        WHEN s.notes LIKE 'UNCONFIRMED:%'  THEN 'unconfirmed'
        WHEN s.notes LIKE 'DISCREPANCY:%'  THEN 'discrepancy'
        ELSE 'flagged'
    END                AS flag_type
FROM   sources s
WHERE  s.verified = 2
   OR  s.ingestion_status = 'failed';

-- =========================================================================
-- CANONICAL QUERIES
-- =========================================================================

-- -----------------------------------------------------------------
-- @query_01_denied_facts_no_evidence
-- Facts that are denied but have no evidence link supporting them.
-- A fact, or an evidence link, from a source pending privilege review is
-- held back (v8.7).
-- -----------------------------------------------------------------
SELECT
    f.fact_id,
    f.description,
    f.category
FROM facts f
JOIN v_current_positions p ON p.fact_id = f.fact_id AND p.position = 'deny'
WHERE f.verified >= 0
  AND f.pending_reverification = 0
  AND NOT EXISTS (
    SELECT 1 FROM sources ps
    WHERE ps.source_id = f.source_id AND ps.privilege_status = 'pending'
  )
  AND NOT EXISTS (
    SELECT 1 FROM evidence_links el
    WHERE el.fact_id = f.fact_id
      AND el.valid_to IS NULL
      AND el.verified >= 0
      AND el.strength > 0
      AND NOT EXISTS (
        SELECT 1 FROM sources ps
        WHERE ps.source_id = el.source_id AND ps.privilege_status = 'pending'
      )
  )
ORDER BY f.fact_id;

-- -----------------------------------------------------------------
-- @query_02_uncontested_admitted_facts
-- Facts admitted by at least one party and contradicted by none: a current
-- 'admit' exists, and no current 'deny' OR 'not_admit'. A non-admission puts
-- the fact in issue under SCCR 3-3(2), so it is
-- excluded — an admission by one party does not bind a party who pleaded no
-- knowledge. has_qualified_admission flags facts whose admission carries
-- verbatim limiting text (the text itself lives in @query_09a, per decision #8).
-- Renamed from @query_02_universally_admitted_facts: the predicate cannot
-- enumerate every party who should respond, so "uncontested" is the honest
-- label. (Supersedes the retired cloud query_02, which returned admit-only
-- facts and wrongly excluded normally-admitted claim+admit facts.)
-- A fact from a source pending privilege review is held back (v8.7).
-- -----------------------------------------------------------------
SELECT
    f.fact_id,
    f.description,
    f.category,
    EXISTS (
        SELECT 1 FROM v_current_positions q
        WHERE q.fact_id = f.fact_id
          AND q.position = 'admit'
          AND q.qualification IS NOT NULL
          AND TRIM(q.qualification) != ''
    ) AS has_qualified_admission
FROM facts f
WHERE f.verified >= 0
  AND f.pending_reverification = 0
  AND NOT EXISTS (
    SELECT 1 FROM sources ps
    WHERE ps.source_id = f.source_id AND ps.privilege_status = 'pending'
  )
  AND EXISTS (
    SELECT 1 FROM v_current_positions WHERE fact_id = f.fact_id AND position = 'admit'
  )
  AND NOT EXISTS (
    SELECT 1 FROM v_current_positions
    WHERE fact_id = f.fact_id AND position IN ('deny','not_admit')
  )
ORDER BY f.fact_id;

-- -----------------------------------------------------------------
-- @query_03_coa_gap_analysis
-- Criteria for a cause of action with sufficiency assessment.
-- Parameter: ? = coa_id
-- -----------------------------------------------------------------
SELECT
    le.criterion_id,
    le.requirement_type,
    le.criterion_order,
    le.criterion_description,
    ce.sufficiency,
    CASE
        WHEN le.requirement_type = 'element' AND (ce.sufficiency IS NULL OR ce.sufficiency = 'gap')
        THEN 'FATAL GAP'
        WHEN le.requirement_type = 'factor' AND (ce.sufficiency IS NULL OR ce.sufficiency = 'gap')
        THEN 'WEAK (factor gap)'
        ELSE 'OK'
    END AS gap_severity
FROM causes_of_action coa
JOIN law.legal_criteria le ON le.concept_id = coa.concept_id
LEFT JOIN coa_criteria ce ON ce.coa_id = coa.coa_id AND ce.criterion_id = le.criterion_id
WHERE coa.coa_id = ?
ORDER BY le.criterion_order;

-- -----------------------------------------------------------------
-- @query_04_witness_dependencies
-- Sources that are the sole evidence for any fact (single point of failure).
-- A source pending privilege review, a fact from one, and a link from one
-- are held back (v8.7): a pending link neither proves nor counts as the
-- alternative evidence that would make another source not the sole one.
-- -----------------------------------------------------------------
SELECT
    s.source_id,
    s.title,
    s.category,
    COUNT(DISTINCT el.fact_id) AS facts_solely_proven
FROM evidence_links el
JOIN sources s ON s.source_id = el.source_id
JOIN facts f ON f.fact_id = el.fact_id
WHERE el.valid_to IS NULL
  AND el.verified >= 0
  AND f.pending_reverification = 0
  AND el.strength > 0
  AND s.privilege_status IS NOT 'pending'
  AND NOT EXISTS (
    SELECT 1 FROM sources ps
    WHERE ps.source_id = f.source_id AND ps.privilege_status = 'pending'
  )
  AND NOT EXISTS (
    SELECT 1 FROM evidence_links el2
    WHERE el2.fact_id = el.fact_id
      AND el2.source_id != el.source_id
      AND el2.valid_to IS NULL
      AND el2.verified >= 0
      AND el2.strength > 0
      AND NOT EXISTS (
        SELECT 1 FROM sources ps
        WHERE ps.source_id = el2.source_id AND ps.privilege_status = 'pending'
      )
  )
GROUP BY s.source_id
ORDER BY facts_solely_proven DESC;

-- -----------------------------------------------------------------
-- @query_05a_verification_backlog_unverified
-- All unverified rows (verified = 0) across tables. A bare row (description
-- = '', #67) holds no content to verify and is left out.
-- -----------------------------------------------------------------
SELECT 'facts' AS table_name, fact_id AS row_id, description AS summary
FROM facts WHERE verified = 0 AND pending_reverification = 0 AND description <> ''
UNION ALL
SELECT 'sources', source_id, title FROM sources WHERE verified = 0
UNION ALL
SELECT 'positions', position_id, position FROM positions
WHERE verified = 0 AND pending_reverification = 0 AND valid_to IS NULL
UNION ALL
SELECT 'evidence_links', evidence_link_id, CAST(strength AS TEXT) FROM evidence_links WHERE verified = 0 AND valid_to IS NULL
UNION ALL
SELECT 'issues', issue_id, title FROM issues WHERE verified = 0
ORDER BY table_name, row_id;

-- -----------------------------------------------------------------
-- @query_05b_verification_needs_human
-- Rows flagged for human review (verified = 2). A bare row (description = '',
-- #67) is left out.
-- -----------------------------------------------------------------
SELECT 'facts' AS table_name, fact_id AS row_id, description AS summary
FROM facts WHERE verified = 2 AND description <> ''
UNION ALL
SELECT 'sources', source_id, title FROM sources WHERE verified = 2
UNION ALL
SELECT 'positions', position_id, position FROM positions WHERE verified = 2 AND valid_to IS NULL
UNION ALL
SELECT 'evidence_links', evidence_link_id, CAST(strength AS TEXT) FROM evidence_links WHERE verified = 2 AND valid_to IS NULL
UNION ALL
SELECT 'issues', issue_id, title FROM issues WHERE verified = 2
UNION ALL
-- v7.1: law-side edges escalated by operations/amend-law.md (an autonomous proposed
-- correction never overwrites text; it lands here). row_id is the concept_id — the
-- edge's real key is (concept_id, authority_id), carried in the summary.
SELECT 'concept_authorities', concept_id,
       'authority ' || authority_id || ' — ' || substr(coalesce(proposition, finding, ''), 1, 80)
FROM law.concept_authorities WHERE verified = 2
ORDER BY table_name, row_id;

-- -----------------------------------------------------------------
-- @query_05c_edge_verification_backlog
-- v7.1: law-side edges awaiting the edge verifier (verified = 0), grouped by the
-- authority document that settles them — the verifier's batch unit is one document
-- (operations/verify-law.md). Edges at verified = 2 are the LAWYER's queue (05b),
-- not the verifier's, and are excluded here: only a human clears an escalation.
-- Kept separate from 05a because an edge's key is (concept_id, authority_id) and
-- does not fit 05a's single row_id shape.
-- -----------------------------------------------------------------
SELECT a.authority_id,
       a.title,
       a.citation,
       a.file_path,
       a.file_hash,
       ca.concept_id,
       c.name AS concept_name,
       ca.relationship,
       ca.pinpoint,
       ca.excerpt,
       substr(coalesce(ca.proposition, ca.finding, ''), 1, 80) AS summary
FROM law.concept_authorities ca
JOIN law.authorities a ON a.authority_id = ca.authority_id
JOIN law.legal_concepts c ON c.concept_id = ca.concept_id
WHERE ca.verified = 0
ORDER BY a.authority_id, ca.concept_id;

-- -----------------------------------------------------------------
-- @query_05d_pending_reverification
-- Corrected facts and current position successors awaiting a fresh isolated
-- verifier. This is the AI queue, never the lawyer's verified = 2 queue.
-- Group by source_id (and affidavit segment) before dispatch.
-- -----------------------------------------------------------------
SELECT 'fact' AS row_kind,
       f.fact_id AS row_id,
       f.source_id,
       s.parent_source_id,
       s.title AS source_title,
       s.file_path,
       f.source_locator,
       f.description AS summary
FROM facts f
JOIN sources s ON s.source_id = f.source_id
WHERE f.verified = 0
  AND f.pending_reverification = 1
UNION ALL
SELECT 'position' AS row_kind,
       p.position_id AS row_id,
       COALESCE(p.source_id, f.source_id) AS source_id,
       s.parent_source_id,
       s.title AS source_title,
       s.file_path,
       p.source_locator,
       p.position || ': ' || f.description AS summary
FROM positions p
JOIN facts f ON f.fact_id = p.fact_id
JOIN sources s ON s.source_id = COALESCE(p.source_id, f.source_id)
WHERE p.verified = 0
  AND p.pending_reverification = 1
  AND p.valid_to IS NULL
ORDER BY source_id, row_kind, row_id;

-- -----------------------------------------------------------------
-- @query_06_drift_detection
-- Sources with file_hash set — for recompute-and-compare integrity check.
-- -----------------------------------------------------------------
SELECT
    source_id,
    title,
    file_path,
    file_hash
FROM sources
WHERE file_hash IS NOT NULL
  AND file_path IS NOT NULL
ORDER BY source_id;

-- -----------------------------------------------------------------
-- @query_08_issue_heatmap
-- Issues ranked by number of linked facts and criteria.
-- -----------------------------------------------------------------
SELECT
    i.issue_id,
    i.title,
    i.status,
    i.priority,
    COUNT(DISTINCT if2.fact_id) AS linked_facts,
    COUNT(DISTINCT ie.criterion_id) AS linked_criteria
FROM issues i
LEFT JOIN issue_facts if2 ON if2.issue_id = i.issue_id
LEFT JOIN issue_criteria ie ON ie.issue_id = i.issue_id
WHERE i.verified >= 0
GROUP BY i.issue_id
ORDER BY i.priority, linked_facts DESC;

-- -----------------------------------------------------------------
-- @query_09a_fact_position_history
-- Full position history for a fact (including superseded).
-- Parameter: ? = fact_id
-- -----------------------------------------------------------------
SELECT
    p.position_id,
    p.party_id,
    pa.name AS party_name,
    p.position,
    p.qualification,
    p.source_id,
    s.title AS source_title,
    p.valid_from,
    p.valid_to,
    p.prior_id,
    p.verified
FROM positions p
JOIN parties pa ON pa.party_id = p.party_id
LEFT JOIN sources s ON s.source_id = p.source_id
WHERE p.fact_id = ?
ORDER BY p.valid_from DESC;

-- -----------------------------------------------------------------
-- @query_09b_fact_evidence_history
-- Full evidence link history for a fact (including superseded).
-- Parameter: ? = fact_id
-- -----------------------------------------------------------------
SELECT
    el.evidence_link_id,
    el.source_id,
    s.title AS source_title,
    s.category AS source_category,
    el.source_locator,
    el.strength,
    el.valid_from,
    el.valid_to,
    el.prior_id,
    el.verified
FROM evidence_links el
JOIN sources s ON s.source_id = el.source_id
WHERE el.fact_id = ?
ORDER BY el.valid_from DESC;

-- -----------------------------------------------------------------
-- @query_10_facts_only_privileged_sources
-- Facts that have provenance in privileged sources but no admissible
-- evidence link — trial-prep gaps.
-- A bare row (description = '', #67) is the usual case here. Its Statement of
-- Fact and category are read from the privileged side: the STATEMENT: and
-- CATEGORY: lines of its fact_provenance.source_note, taking the lowest
-- source_id that has one. This is the read that shows a bare row's meaning.
-- It reads privileged.sqlite, so its output is the practitioner's and never
-- goes into a draft, list, book or page.
-- -----------------------------------------------------------------
SELECT
    f.fact_id,
    CASE WHEN f.description = '' THEN (
        SELECT CASE WHEN instr(r.rest, char(10)) > 0
                    THEN substr(r.rest, 1, instr(r.rest, char(10)) - 1)
                    ELSE r.rest END
        FROM (SELECT substr(fp.source_note, instr(fp.source_note, 'STATEMENT: ') + 11) AS rest
              FROM privileged.fact_provenance fp
              WHERE fp.fact_id = f.fact_id AND instr(fp.source_note, 'STATEMENT: ') > 0
              ORDER BY fp.source_id LIMIT 1) r)
         ELSE f.description END AS description,
    CASE WHEN f.description = '' THEN (
        SELECT CASE WHEN instr(r.rest, char(10)) > 0
                    THEN substr(r.rest, 1, instr(r.rest, char(10)) - 1)
                    ELSE r.rest END
        FROM (SELECT substr(fp.source_note, instr(fp.source_note, 'CATEGORY: ') + 10) AS rest
              FROM privileged.fact_provenance fp
              WHERE fp.fact_id = f.fact_id AND instr(fp.source_note, 'CATEGORY: ') > 0
              ORDER BY fp.source_id LIMIT 1) r)
         ELSE f.category END AS category
FROM facts f
WHERE f.verified >= 0
  AND f.pending_reverification = 0
  AND EXISTS (
    SELECT 1 FROM privileged.fact_provenance fp WHERE fp.fact_id = f.fact_id
  )
  AND NOT EXISTS (
    SELECT 1 FROM evidence_links el
    WHERE el.fact_id = f.fact_id
      AND el.valid_to IS NULL
      AND el.verified >= 0
      AND el.strength > 0
  )
ORDER BY f.fact_id;

-- -----------------------------------------------------------------
-- @query_12_unreviewed_sources
-- Sources that have never been ingested (no last_ingested_at).
-- -----------------------------------------------------------------
SELECT
    source_id,
    title,
    category,
    file_path,
    date
FROM sources
WHERE last_ingested_at IS NULL
  AND verified >= 0
ORDER BY date, source_id;

-- =========================================================================
-- v6.1 LEGAL TAXONOMY QUERIES
-- =========================================================================

-- -----------------------------------------------------------------
-- @query_13_concept_requirements
-- All requirements (elements + factors) for a concept.
-- Parameter: ? = concept_id
-- -----------------------------------------------------------------
SELECT
    le.criterion_id,
    le.requirement_type,
    le.criterion_order,
    le.criterion_description,
    le.burden_of_proof,
    le.determined_by_concept_id,
    det.name AS determined_by_name,
    le.authority_id,
    a.title AS authority_title,
    a.citation AS authority_citation,
    le.authority_proposition,
    le.treatment,
    le.treated_by_authority_id,
    ta.title AS treated_by_title,
    ta.citation AS treated_by_citation
FROM law.legal_criteria le
LEFT JOIN law.legal_concepts det ON det.concept_id = le.determined_by_concept_id
LEFT JOIN law.authorities a ON a.authority_id = le.authority_id
LEFT JOIN law.authorities ta ON ta.authority_id = le.treated_by_authority_id
WHERE le.concept_id = ?
ORDER BY le.criterion_order;

-- -----------------------------------------------------------------
-- @query_14_concept_authorities
-- Authorities shaping a concept (concept-level linkage).
-- Parameter: ? = concept_id
-- -----------------------------------------------------------------
SELECT
    ca.relationship,
    ca.proposition,
    ca.finding,
    ca.factual_context,
    ca.obiter,
    ca.pinpoint,
    ca.excerpt,
    ca.treatment,
    ca.treated_by_authority_id,
    ca.verified,
    ta.title AS treated_by_title,
    ta.citation AS treated_by_citation,
    a.authority_id,
    a.title,
    a.citation,
    a.authority_type,
    a.jurisdiction,
    a.disposition
FROM law.concept_authorities ca
JOIN law.authorities a ON a.authority_id = ca.authority_id
LEFT JOIN law.authorities ta ON ta.authority_id = ca.treated_by_authority_id
WHERE ca.concept_id = ? AND ca.verified >= 0
ORDER BY
    CASE ca.relationship
        WHEN 'establishes' THEN 1
        WHEN 'refines' THEN 2
        WHEN 'applies' THEN 3
        WHEN 'distinguishes' THEN 4
        WHEN 'affirms' THEN 5
        WHEN 'answered' THEN 6
    END;

-- -----------------------------------------------------------------
-- @query_15_element_test_hierarchy
-- Full test hierarchy for a criterion (one level of nesting).
-- Returns the determining concept and all its requirements.
-- Parameter: ? = criterion_id
-- -----------------------------------------------------------------
SELECT
    le_parent.criterion_id AS parent_criterion_id,
    le_parent.criterion_description AS parent_description,
    lc.concept_id AS test_concept_id,
    lc.name AS test_name,
    le_child.criterion_id AS child_criterion_id,
    le_child.requirement_type AS child_requirement_type,
    le_child.criterion_order AS child_order,
    le_child.criterion_description AS child_description
FROM law.legal_criteria le_parent
JOIN law.legal_concepts lc ON lc.concept_id = le_parent.determined_by_concept_id
JOIN law.legal_criteria le_child ON le_child.concept_id = lc.concept_id
WHERE le_parent.criterion_id = ?
ORDER BY le_child.criterion_order;

-- -----------------------------------------------------------------
-- @query_16_coa_gap_analysis_v61
-- COA gap analysis with element vs factor severity.
-- Same as query_03 but explicitly named for v6.1 documentation.
-- Parameter: ? = coa_id
-- NOTE: query_03 already implements v6.1 gap analysis. This alias
-- exists for documentation purposes. Use query_03 in practice.
-- -----------------------------------------------------------------

-- -----------------------------------------------------------------
-- @query_17_concepts_by_type_jurisdiction
-- All concepts of a given type in a jurisdiction.
-- Parameters: ?1 = concept_type, ?2 = jurisdiction
-- -----------------------------------------------------------------
SELECT
    lc.concept_id,
    lc.name,
    lc.description,
    lc.notes,
    COUNT(le.criterion_id) AS requirement_count
FROM law.legal_concepts lc
LEFT JOIN law.legal_criteria le ON le.concept_id = lc.concept_id
WHERE lc.concept_type = ?
  AND lc.jurisdiction = ?
GROUP BY lc.concept_id
ORDER BY lc.name;

-- -----------------------------------------------------------------
-- @query_18_case_brief_by_authority
-- Case brief for one authority: disposition + per-concept finding,
-- factual_context, proposition, obiter.
-- Parameter: ? = authority_id
-- -----------------------------------------------------------------
SELECT
    a.title,
    a.citation,
    a.disposition,
    lc.name            AS concept_name,
    ca.relationship,
    ca.proposition,
    ca.finding,
    ca.factual_context,
    ca.obiter,
    ca.treatment,
    ca.treated_by_authority_id,
    ca.verified
FROM law.authorities a
JOIN law.concept_authorities ca ON ca.authority_id = a.authority_id
JOIN law.legal_concepts lc      ON lc.concept_id   = ca.concept_id
WHERE a.authority_id = ? AND ca.verified >= 0
ORDER BY lc.name;

-- -----------------------------------------------------------------
-- @query_19_authority_treatment_chain
-- All authorities that treat or are treated by a given authority.
-- Parameter: ? = authority_id (bind to both placeholders)
-- -----------------------------------------------------------------
SELECT
    trt.treating_authority_id,
    a_ing.title AS treating_title,
    a_ing.citation AS treating_citation,
    trt.treated_authority_id,
    a_ed.title AS treated_title,
    a_ed.citation AS treated_citation,
    trt.treatment,
    trt.scope,
    trt.notes
FROM law.authority_treatments trt
JOIN law.authorities a_ing ON a_ing.authority_id = trt.treating_authority_id
JOIN law.authorities a_ed  ON a_ed.authority_id  = trt.treated_authority_id
WHERE trt.treating_authority_id = ?
   OR trt.treated_authority_id = ?
ORDER BY a_ing.citation;

-- =========================================================================
-- v7.0 B2 GAP-CLOSURE READS
-- The cloud analytics surface had no RPC reading criteria_facts or
-- privileged_sources; these queries give both upsert-only entities a
-- documented local read path (plan §B2 verify). Semantics-preserving,
-- not re-homes of a cloud RPC.
-- =========================================================================

-- -----------------------------------------------------------------
-- @query_20_criterion_facts
-- Facts linked to a legal criterion via criteria_facts, with relevance
-- (supports / undermines / context). Local read path for the
-- criteria_facts junction. Parameter: ? = criterion_id
-- A fact from a source pending privilege review is held back (v8.7).
-- -----------------------------------------------------------------
SELECT
    cf.criterion_id,
    cf.fact_id,
    f.description,
    f.category,
    cf.relevance
FROM criteria_facts cf
JOIN facts f ON f.fact_id = cf.fact_id
WHERE cf.criterion_id = ?
  AND f.verified >= 0
  AND f.pending_reverification = 0
  AND NOT EXISTS (
    SELECT 1 FROM sources ps
    WHERE ps.source_id = f.source_id AND ps.privilege_status = 'pending'
  )
ORDER BY cf.relevance, cf.fact_id;

-- -----------------------------------------------------------------
-- @query_21_privileged_source_inventory
-- Privilege-log inventory: all privileged sources in the matter. Local
-- read path for the privileged_sources table — distinct from @query_10,
-- which reads fact_provenance. Content stays in privileged.sqlite; this
-- read never crosses the firewall into main.
-- -----------------------------------------------------------------
SELECT
    source_id,
    category,
    title,
    author,
    recipient,
    date,
    verified
FROM privileged.privileged_sources
WHERE verified >= 0
ORDER BY date, source_id;

-- -----------------------------------------------------------------
-- @query_22_theorized_facts
-- Theorized facts (v7.4): facts theorized for investigation. A theorized
-- fact is a main.facts row whose ONLY provenance is a 'Theory of the case —'
-- placeholder source (privileged_work_product) and which has NO admissible
-- evidence link — the fact entered on the strength of the case theory alone.
-- `disposition` distinguishes 'active' (an open investigative item — the
-- stage-9 verifier tolerates it as `theorized_only`) from 'dismissed' (our own
-- investigation concluded it likely untrue — terminal; the verifier FAILs an
-- argument resting on it as `dismissed_fact`). A fact ceases to appear here by
-- construction the moment a real evidence_link lands (the NOT EXISTS below).
-- A theorized fact is a bare row (#67, #23): its wording and category are the
-- STATEMENT: and CATEGORY: lines of the theory provenance row's source_note,
-- read here from the privileged side. A row not yet emptied still answers from
-- its own columns. This read is the practitioner's and never goes into a draft.
-- No parameter: returns every theorized fact in the matter. The stage-9 caller
-- and the convergence summary both read this once and key per-fact status off it.
-- -----------------------------------------------------------------
SELECT
    f.fact_id,
    CASE WHEN f.description = '' THEN (
        SELECT CASE WHEN instr(r.rest, char(10)) > 0
                    THEN substr(r.rest, 1, instr(r.rest, char(10)) - 1)
                    ELSE r.rest END
        FROM (SELECT substr(fp.source_note, instr(fp.source_note, 'STATEMENT: ') + 11) AS rest) r
        WHERE instr(fp.source_note, 'STATEMENT: ') > 0)
         ELSE f.description END AS description,
    CASE WHEN f.description = '' THEN (
        SELECT CASE WHEN instr(r.rest, char(10)) > 0
                    THEN substr(r.rest, 1, instr(r.rest, char(10)) - 1)
                    ELSE r.rest END
        FROM (SELECT substr(fp.source_note, instr(fp.source_note, 'CATEGORY: ') + 10) AS rest) r
        WHERE instr(fp.source_note, 'CATEGORY: ') > 0)
         ELSE f.category END AS category,
    fp.disposition,
    ps.title AS theory_source_title
FROM facts f
JOIN privileged.fact_provenance fp ON fp.fact_id = f.fact_id
JOIN privileged.privileged_sources ps ON ps.source_id = fp.source_id
WHERE f.verified >= 0
  AND f.pending_reverification = 0
  AND ps.category = 'privileged_work_product'
  AND ps.title LIKE 'Theory of the case —%'
  AND NOT EXISTS (
    SELECT 1 FROM privileged.fact_provenance fp2
    JOIN privileged.privileged_sources ps2 ON ps2.source_id = fp2.source_id
    WHERE fp2.fact_id = f.fact_id
      AND NOT (ps2.category = 'privileged_work_product'
               AND ps2.title LIKE 'Theory of the case —%')
  )
  AND NOT EXISTS (
    SELECT 1 FROM evidence_links el
    WHERE el.fact_id = f.fact_id
      AND el.valid_to IS NULL
      AND el.verified >= 0
      AND el.strength > 0
  )
ORDER BY fp.disposition, f.fact_id;

-- -----------------------------------------------------------------
-- @query_23_witnesses_by_proceeding
-- Fact and expert witnesses assigned to one proceeding, including the calling
-- party and expert-only retention/report metadata.
-- Parameter: ? = proceeding_id
-- -----------------------------------------------------------------
SELECT
    w.witness_id,
    w.name,
    w.witness_type,
    w.field_of_expertise,
    w.qualified,
    pw.called_by_party_id,
    called_by.name AS called_by_party_name,
    w.retained_by_party_id,
    retained_by.name AS retained_by_party_name,
    w.report_source_id
FROM proceeding_witnesses pw
JOIN witnesses w ON w.witness_id = pw.witness_id
LEFT JOIN parties retained_by
       ON retained_by.party_id = w.retained_by_party_id
LEFT JOIN parties called_by
       ON called_by.party_id = pw.called_by_party_id
WHERE pw.proceeding_id = ?
ORDER BY w.witness_id;

-- -----------------------------------------------------------------
-- @query_24_client_instructions_status
-- Current, non-rejected privileged client instructions for one proceeding
-- (or, with a NULL proceeding_id, the matter's no-proceeding advice
-- instructions) in one requested lifecycle status.
-- Parameters: ?1 = proceeding_id (NULL selects rows with no proceeding), ?2 = status
-- -----------------------------------------------------------------
SELECT
    ci.instruction_id,
    ci.proceeding_id,
    ci.party_id,
    client.name AS client_name,
    ci.instructed_by,
    ci.date,
    ci.description,
    ci.source_id,
    ps.title AS source_title,
    ci.source_locator,
    ci.status,
    ci.valid_from,
    ci.prior_id,
    ci.verified,
    ci.notes
FROM privileged.client_instructions ci
JOIN parties client ON client.party_id = ci.party_id
LEFT JOIN privileged.privileged_sources ps ON ps.source_id = ci.source_id
WHERE ci.proceeding_id IS ?
  AND ci.status = ?
  AND ci.valid_to IS NULL
  AND ci.verified >= 0
ORDER BY ci.date, ci.instruction_id;

-- -----------------------------------------------------------------
-- @query_25_admitted_facts
-- Every current admission of a fact by ONE NAMED PARTY, from both stores that
-- hold one, with its provenance and its route qualification.
--
-- This is NOT @query_02_uncontested_admitted_facts and must never be
-- substituted for it. That query answers "is this fact uncontested?" — admitted
-- by at least one party and contradicted by none — which is a fact-level test
-- over the whole party roster. This query answers "has THIS party admitted this
-- fact?", which is what a per-order proof route needs: an application must prove
-- each material fact against every party the order is sought against, so the
-- caller runs this once per target party and requires a row for each. Using the
-- uncontested test instead would pass a fact against a non-admitting
-- co-respondent.
--
-- route_qualifying is the mechanical route test, and it is deliberately
-- conservative on both axes:
--   * kind — only the four unsworn-qualifying kinds. express_other and
--     discovery admissions are provenance-only instruments: they reach an
--     application through a sworn evidence use that exhibits or deposes to
--     them, never on their own.
--   * qualification — any verbatim limiting text disqualifies the row
--     mechanically (decision #8: qualification is evidentiary text, not
--     commentary). The caller may still rely on it, but only on an explicit
--     recorded reason addressing why the limit does not touch the fact as
--     pleaded, and the qualification is displayed verbatim.
-- Rows are returned regardless of route_qualifying so the caller can render a
-- per-party gap honestly rather than seeing an empty result.
--
-- A fact from a source pending privilege review is held back, and so is an
-- admission whose own instrument source is pending (v8.7).
--
-- Parameters: ? = proceeding_id, ? = admitting_party_id
-- -----------------------------------------------------------------
SELECT
    f.fact_id,
    f.description,
    f.category,
    a.admitting_party_id,
    party.name                AS admitting_party_name,
    'admissions'              AS record_source,
    a.admission_kind,
    a.source_id,
    src.title                 AS source_title,
    a.source_locator,
    a.deemed_effective_date,
    a.qualification,
    a.verified,
    a.human_reviewed,
    CASE
        WHEN a.admission_kind IN (
                 'express_pleading', 'express_notice_to_admit',
                 'deemed_default', 'deemed_rule_7_7')
             AND (a.qualification IS NULL OR TRIM(a.qualification) = '')
        THEN 1 ELSE 0
    END                       AS route_qualifying
FROM admissions a
JOIN facts f    ON f.fact_id = a.fact_id
JOIN parties party ON party.party_id = a.admitting_party_id
LEFT JOIN sources src ON src.source_id = a.source_id
WHERE a.valid_to IS NULL
  AND a.verified >= 0
  AND f.verified >= 0
  AND f.pending_reverification = 0
  AND a.admitting_party_id = ?2
  AND (f.source_id IS NULL OR EXISTS (
        SELECT 1 FROM sources fs
        WHERE fs.source_id = f.source_id AND fs.proceeding_id = ?1))
  AND NOT EXISTS (
        SELECT 1 FROM sources ps
        WHERE ps.source_id IN (f.source_id, a.source_id)
          AND ps.privilege_status = 'pending')

UNION ALL

-- The same admission may also be on record as a party posture. Both rows are
-- returned with their own provenance rather than collapsed: positions carry the
-- responding source and locator the party actually filed, and an application
-- cites the instrument it relies on.
SELECT
    f.fact_id,
    f.description,
    f.category,
    p.party_id                AS admitting_party_id,
    party.name                AS admitting_party_name,
    'positions'               AS record_source,
    'express_pleading'        AS admission_kind,
    p.source_id,
    src.title                 AS source_title,
    p.source_locator,
    NULL                      AS deemed_effective_date,
    p.qualification,
    p.verified,
    praw.human_reviewed,
    CASE
        WHEN (p.qualification IS NULL OR TRIM(p.qualification) = '')
             AND (p.position_basis IS NULL OR p.position_basis != 'qualified')
        THEN 1 ELSE 0
    END                       AS route_qualifying
FROM v_current_positions p
JOIN positions praw ON praw.position_id = p.position_id
JOIN facts f    ON f.fact_id = p.fact_id
JOIN parties party ON party.party_id = p.party_id
LEFT JOIN sources src ON src.source_id = p.source_id
WHERE p.position = 'admit'
  AND f.verified >= 0
  AND f.pending_reverification = 0
  AND p.party_id = ?2
  AND (f.source_id IS NULL OR EXISTS (
        SELECT 1 FROM sources fs
        WHERE fs.source_id = f.source_id AND fs.proceeding_id = ?1))
  AND NOT EXISTS (
        SELECT 1 FROM sources ps
        WHERE ps.source_id = f.source_id AND ps.privilege_status = 'pending')
ORDER BY 1, 6;

-- @query_26_sought_orders
-- Part 1 sought orders of a served Notice of Application, in the document's
-- own printed order (ORDER BY sought_order_id — insertion order, never
-- lexicographic order_number, where '10' sorts before '2').
--
-- Not @query_25-style admission checking and not relief_items: this is a
-- flat, verbatim transcription of one document's own Part 1 text, captured
-- for a response filing to position against without re-typing the served
-- notice (decision #44). A row with verified = 2 and a notes prefix of
-- UNCONFIRMED: or OCR: flags degraded extraction (unnumbered Part 1, or
-- OCR-uncertain wording) — the caller should surface that flag rather than
-- treat the row as settled fact.
--
-- Parameters: ? = source_id (the served Notice of Application's own source_id)
-- -----------------------------------------------------------------
SELECT
    so.sought_order_id,
    so.order_number,
    so.order_text,
    so.verified,
    so.notes,
    s.title              AS source_title,
    s.date               AS source_date,
    s.filed_by_party_id,
    s.proceeding_id
FROM sought_orders so
JOIN sources s ON s.source_id = so.source_id
WHERE so.source_id = ?1
ORDER BY so.sought_order_id;

-- -----------------------------------------------------------------
-- @query_27_oral_treatments_for_authorities
-- v8.5: every treatment recorded BY an oral-reasons decision over a given set
-- of authorities. The consolidation stage reads this to carry the practitioner's
-- own account of what the court did with each cited authority — treatment no
-- citator will ever surface (design D4).
--
-- Scope, deliberately: the treating side is restricted to
-- authorities.authority_type = 'oral_reasons'. Ordinary appellate treatments
-- between reported decisions are @query_19's job, not this one.
--
-- An oral-reasons row never carries a concept_authorities edge (it can be cited
-- for nothing until a transcript arrives), so the treated authority's own
-- citation is the only cross-matter identifier here; the treating row's
-- synthetic citation carries no style of cause by construction.
--
-- Parameters: ?1 = a comma-separated list of treated authority_ids, matched
-- with instr(',' || ?1 || ',', ',' || trt.treated_authority_id || ',') so one
-- bound parameter serves a set (SQLite has no array binding). Pass '' to get
-- no rows.
-- -----------------------------------------------------------------
SELECT
    trt.treating_authority_id,
    oral.title             AS treating_title,
    oral.citation          AS treating_citation,
    oral.disposition       AS treating_disposition,
    oral.jurisdiction      AS treating_jurisdiction,
    trt.treated_authority_id,
    treated.title          AS treated_title,
    treated.citation       AS treated_citation,
    treated.authority_type AS treated_authority_type,
    trt.treatment,
    trt.scope,
    trt.notes
FROM law.authority_treatments trt
JOIN law.authorities oral    ON oral.authority_id    = trt.treating_authority_id
JOIN law.authorities treated ON treated.authority_id = trt.treated_authority_id
WHERE oral.authority_type = 'oral_reasons'
  AND instr(',' || ?1 || ',', ',' || trt.treated_authority_id || ',') > 0
ORDER BY trt.treating_authority_id, trt.treated_authority_id;

-- -----------------------------------------------------------------
-- @query_28_pending_privilege_review
-- v8.7: every main.sources row whose privilege call is undecided
-- (privilege_status = 'pending'), oldest ingestion first, with the number of
-- facts extracted from it. The worklist for operations/resolve-privilege.md,
-- which decides one document per run. last_ingested_at is the date ingested.
-- No parameter.
-- -----------------------------------------------------------------
SELECT
    s.source_id,
    s.title,
    s.file_path,
    s.category,
    s.last_ingested_at,
    s.notes,
    (SELECT COUNT(*) FROM facts f WHERE f.source_id = s.source_id) AS fact_count
FROM sources s
WHERE s.privilege_status = 'pending'
ORDER BY s.last_ingested_at, s.source_id;

-- -----------------------------------------------------------------
-- @query_29_exhibits_of_document
-- v8.9: which affidavit exhibits a given document. Lists every exhibit row
-- (a main.sources child titled 'Exhibit ...') that matches the document, with
-- its affidavit body and that body's execution_status.
--
-- An exhibit row shares its affidavit's file_hash by design (decision #17),
-- so the match is by date or title, never by identity. The facts.date_of_fact
-- branch is a loose recall aid: it returns any exhibit with a fact on that
-- date, whatever the exhibit is. Exhibit dates exist only on rows ingested
-- after ingest-extract.md Path C Pass 3 began writing them; older exhibit rows
-- match by title or fact date alone. It answers only for affidavits that have
-- been ingested (decision #63).
--
-- Parameters: ?1 = the document's date (YYYY-MM-DD), ?2 = a title fragment
-- -----------------------------------------------------------------
SELECT b.source_id AS affidavit_id, b.title AS affidavit, b.execution_status,
       e.source_id AS exhibit_id, e.title AS exhibit, e.date AS exhibit_date
FROM sources e
JOIN sources b ON b.source_id = e.parent_source_id
WHERE e.title LIKE 'Exhibit %'
  AND (e.date = ?1
       OR e.title LIKE '%' || ?2 || '%'
       OR EXISTS (SELECT 1 FROM facts f WHERE f.source_id = e.source_id AND f.date_of_fact = ?1))
ORDER BY b.execution_status, b.source_id, e.source_id;

-- -----------------------------------------------------------------
-- @query_30_instrument_text_source
-- v8.9: which held authority carries a statute's or regulation's full text,
-- for /legal-research when legislation-fetcher filed nothing for it
-- (Engineering/1. Design/2026-10-06_statute-first-research-route-spec.md §4.2).
-- Matches the citation ignoring periods, spaces and case (`R.S.B.C. 1996,
-- c. 238` = `RSBC 1996, c 238`), or a title fragment. A bundled entry's
-- file_path and file_hash are the whole book's (shared/extraction-protocol.md,
-- "Bundled books of authorities"); bundled_pages is the `X–Y` its notes record,
-- NULL for a standalone copy. Merged tombstones are left out. Citation
-- matches come first, then standalone copies. char(59) is a semicolon, kept
-- out of the text because a named query ends at its first one.
--
-- Parameters: ?1 = the citation ('' for none), ?2 = a title fragment ('' for none)
-- -----------------------------------------------------------------
WITH held AS (
    SELECT a.*,
           CASE WHEN instr(a.notes, 'Bundled authority, pp. ') > 0
                THEN substr(a.notes, instr(a.notes, 'Bundled authority, pp. ') + 23)
           END AS rest,
           (?1 <> '' AND lower(replace(replace(a.citation, '.', ''), ' ', ''))
                       = lower(replace(replace(?1, '.', ''), ' ', ''))) AS citation_match
    FROM law.authorities a
    WHERE a.authority_type IN ('statute', 'regulation')
      AND (a.notes IS NULL OR instr(a.notes, '[MERGED-INTO:') = 0)
)
SELECT authority_id, title, citation, authority_type, jurisdiction, file_path, file_hash,
       rtrim(substr(rest, 1, instr(rest || ' ', ' ') - 1), ',.' || char(59)) AS bundled_pages,
       notes
FROM held
WHERE citation_match OR (?2 <> '' AND title LIKE '%' || ?2 || '%')
ORDER BY citation_match DESC, rest IS NOT NULL, authority_id;
