-- Backfill overlay (issue #1270). The second sanctioned consolidated read,
-- for one use only: after a source registered late (iCloud on #1199, sent
-- mail on #1261) has been fetched and ingested for a day whose proposals
-- already exist, this read lays each of that day's sent_mail and
-- icloud_events rows over the day's non-superseded proposals, so a backfill
-- can find the proposals the new evidence contradicts without reading the
-- whole day through splice.sql. It also gives, per row, the day's TimeCamp
-- time entries covering it, so a backfill can tell recorded work (an entry
-- covers it, whether or not a proposal does) from possible unrecorded work
-- (no entry covers it). Most of a day's entries are green ones that never
-- became proposals, so proposal overlap alone cannot answer that.
--
-- It is gated identically to splice.sql: the expected_sources, missing and
-- gate CTEs below are copied from it verbatim, so no row is returned until
-- every registered source has a terminal source_fetch_log status for the
-- date. A test asserts the two expected_sources lists match, so a source
-- registered in splice.sql must be registered here too. It is never an input to an inference pass (/timecamping Step 5 reads
-- only splice.sql).
--
-- Call via timecamping_data__query exactly like splice.sql:
--   { "sql": <this file's text>, "params": ["<YYYY-MM-DD>"] }
-- one param, the target local_date, bound once through the `target` CTE.
--
-- Result columns: source ('sm' or 'ic'), source_row_id, start_ts, end_ts,
-- summary (built exactly as splice.sql builds it for the same row),
-- proposal_id, proposal_status, proposed_matter_ref, proposal_start_ts,
-- proposal_end_ts, written_back, entered_by_hand_at, timecamp_entries.
--   - timecamp_entries: a JSON array of the target date's TimeCamp time
--     entries covering the source row, as {id, timecamp_task_id,
--     task_display} objects ordered by start_ts, id (id is the entry's id in
--     splice.sql's tte lines), or NULL when no entry covers it. It depends
--     only on the source row, so it repeats on each of that row's proposal
--     rows. The overlap rule is the same half-open one as for proposals. The
--     table holds only the practitioner's own entries (build_ingest.py
--     filters by user_id), so no ownership filter applies here.
--   - One row per (source row, overlapping non-superseded proposal of the
--     date). A sent email is an instant, so it overlaps a proposal when
--     start_ts <= sent_ts < end_ts; an iCloud event overlaps one when the two
--     spans intersect. A row overlapping two proposals appears twice; a row
--     overlapping none appears once, with every proposal column NULL.
--   - Ordered by start_ts, source, source_row_id, proposal_id.
--   - Gate violation: exactly one row, source = 'GATE', summary =
--     'GATE VIOLATION: missing <sources>', every other column NULL, and
--     nothing else (the CROSS JOIN below zeroes the overlay out).

WITH target(local_date) AS (
  SELECT ?
),
expected_sources(source_name, alias) AS (
  VALUES
    ('timecamp_time_entries', 'tte'),
    ('timecamp_computer_activities', 'tca'),
    ('syncopaid_captures', 'sc'),
    ('telus_calls', 'tc'),
    ('gcal_events', 'gc'),
    ('icloud_events', 'ic'),
    ('sent_mail', 'sm')
),
missing AS (
  SELECT e.source_name
  FROM expected_sources e
  LEFT JOIN source_fetch_log f
    ON f.source_name = e.source_name
   AND f.local_date = (SELECT local_date FROM target)
  WHERE f.status IS NULL OR f.status NOT IN ('fetched', 'empty', 'skipped')
),
gate AS (
  SELECT
    COUNT(*) AS missing_count,
    GROUP_CONCAT(source_name, ', ') AS missing_sources
  FROM missing
),
backfilled AS (
  SELECT
    'sm' AS source,
    id AS source_row_id,
    sent_ts AS start_ts,
    sent_ts AS end_ts,
    COALESCE(subject, '(no subject)')
      || ' -> ' || COALESCE((SELECT GROUP_CONCAT(value, ', ' ORDER BY key) FROM json_each(to_recipients)), '')
      || CASE WHEN json_array_length(cc_recipients) > 0
              THEN ' [cc ' || (SELECT GROUP_CONCAT(value, ', ' ORDER BY key) FROM json_each(cc_recipients)) || ']'
              ELSE '' END
      AS summary
  FROM sent_mail
  WHERE local_date = (SELECT local_date FROM target)

  UNION ALL

  SELECT
    'ic',
    id,
    start_ts,
    end_ts,
    COALESCE(title, '(untitled)')
      || ' [calendar: ' || calendar || ']'
      || CASE WHEN all_day = 1 THEN ' [all-day]' ELSE '' END
      || CASE WHEN busy = 0 THEN ' [free]' ELSE '' END
  FROM icloud_events
  WHERE local_date = (SELECT local_date FROM target)
),
overlay AS (
  SELECT
    b.source,
    b.source_row_id,
    b.start_ts,
    b.end_ts,
    b.summary,
    p.id AS proposal_id,
    p.status AS proposal_status,
    p.proposed_matter_ref,
    p.start_ts AS proposal_start_ts,
    p.end_ts AS proposal_end_ts,
    p.written_back,
    p.entered_by_hand_at,
    NULLIF((SELECT json_group_array(json_object(
                     'id', e.id, 'timecamp_task_id', e.timecamp_task_id, 'task_display', e.task_display)
                     ORDER BY e.start_ts, e.id)
              FROM timecamp_time_entries e
             WHERE e.local_date = (SELECT local_date FROM target)
               AND CASE WHEN b.source = 'sm'
                        THEN e.start_ts <= b.start_ts AND b.start_ts < e.end_ts
                        ELSE e.start_ts < b.end_ts AND b.start_ts < e.end_ts
                   END), '[]') AS timecamp_entries
  FROM backfilled b
  LEFT JOIN proposals p
    ON p.local_date = (SELECT local_date FROM target)
   AND p.status <> 'superseded'
   AND CASE WHEN b.source = 'sm'
            THEN p.start_ts <= b.start_ts AND b.start_ts < p.end_ts
            ELSE p.start_ts < b.end_ts AND b.start_ts < p.end_ts
       END
)
-- Wrapped in a subquery so the ORDER BY can name `part`, which the result
-- does not carry (SQLite's rule for ORDER BY on a compound SELECT).
SELECT source, source_row_id, start_ts, end_ts, summary, proposal_id, proposal_status,
       proposed_matter_ref, proposal_start_ts, proposal_end_ts, written_back, entered_by_hand_at,
       timecamp_entries
FROM (

SELECT 0 AS part, 'GATE' AS source, NULL AS source_row_id, NULL AS start_ts, NULL AS end_ts,
  'GATE VIOLATION: missing ' || gate.missing_sources AS summary,
  NULL AS proposal_id, NULL AS proposal_status, NULL AS proposed_matter_ref,
  NULL AS proposal_start_ts, NULL AS proposal_end_ts, NULL AS written_back, NULL AS entered_by_hand_at,
  NULL AS timecamp_entries
FROM gate
WHERE gate.missing_count > 0

UNION ALL

SELECT 1, overlay.*
FROM gate
CROSS JOIN overlay
WHERE gate.missing_count = 0

)
ORDER BY part, start_ts, source, source_row_id, proposal_id;
