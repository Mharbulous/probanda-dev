-- Canonical consolidated-day query (design doc step 3 + step 4). This is the
-- ONLY sanctioned way to read consolidated evidence for a day -- the "no
-- inference until every source is fully populated" hard gate lives INSIDE
-- this read, not beside it, so a partially-fetched day cannot produce
-- evidence rows no matter how this query is invoked.
--
-- Call via timecamping_data__query with:
--   { "sql": <this file's text>, "params": ["<YYYY-MM-DD>"] }
-- exactly one param -- the target local_date -- referenced throughout via
-- the `target` CTE below, never repeated positionally.
--
-- Result shape (issue #938): ONE text column, `line`, one row per output
-- line, in reading order. The exact line formats are documented once, in
-- timecamping-data SKILL.md (Reading a day's consolidated evidence); the
-- output also names them itself, in its SOURCES and FORMAT lines. The old
-- shape -- one JSON object per source row, nine keys each -- served 0.88 to
-- 1.43 million characters for a working day, more than a model can read.
--   - Gate violation: exactly one line, 'GATE VIOLATION: missing <sources>',
--     naming the source(s) still missing a terminal source_fetch_log status
--     for this date. No header, no standing facts and no evidence accompany
--     it -- the CROSS JOINs below zero them out.
--   - Otherwise: a DAY header whose `lines` and `chars` count every line after
--     it (so a caller paging a spilled result can prove it reached the end),
--     the SOURCES legend, the FORMAT line, then the standing-fact lines, then
--     the evidence lines. The query enforces no size budget and never windows
--     the day: the budget is /timecamping Step 4's rule, applied to the
--     header's own count.
--   - Standing facts (FACT lines): a fact a source carries that does NOT
--     belong to any one day -- today, the Telus contact directory (issue
--     #844). A call log is a directory as well as a log: which person owns a
--     phone number is established by that source's rows whatever their dates,
--     and the number that decides a day is routinely named only by calls on
--     other days (the combined-history cross-day-identity fixture:
--     telus_calls is `skipped` for 2026-08-31, contributes zero evidence
--     rows, and still names the caller from rows dated 08-26 and 08-28).
--     These lines carry no timestamps, member ids or abuts markers and are
--     NOT evidence: they must never be read as something that happened on
--     the target date. `detail` carries the fact's own observation span,
--     which the session repeats when a conclusion rests on it. The block is
--     identical for every target date -- it is a directory read, not a
--     per-day read.
--   - Evidence lines: the day's source records, unioned across all seven
--     registered source tables, in time order, with a boundary-continuity
--     marker (abuts_prior/abuts_next) flagging exact-second continuity (the
--     fact the telus-call-boundary E2E fixture exercises) so it isn't left to
--     be noticed by eye. This is an EXISTS check against every evidence row
--     (any source) sharing this row's boundary instant, not a positional
--     LAG/LEAD over "the nearest row in time order" -- two designs were tried
--     and rejected during this build's own seed-and-replay verification
--     before landing here: a plain global LAG/LEAD is defeated whenever an
--     unrelated row from another source (e.g. a stray SyncoPaid capture)
--     happens to start in the exact gap between two truly-adjacent rows --
--     precisely the shape the boundary fixture's orphan block has;
--     partitioning LAG/LEAD by source_table fixes that but then misses
--     genuine CROSS-source continuity (a TimeCamp entry ending exactly when a
--     Telus call begins). An EXISTS-based check catches both, is immune to
--     what else is interleaved between them, and costs nothing more than
--     being a hint -- the inference pass still applies its own judgment on
--     top of it. It is computed per RAW row, before any merging.
--
-- MERGING (issue #938). Raw evidence rows are ordered by start_ts, summary,
-- source_table, source_row_id, and a row joins the line before it only when
-- all three hold against the row immediately before it in that order: the
-- same source_table, a byte-identical summary (every flag -- '[OCR
-- available]', '[amber/work-queue]', the calendar flags, the TimeCamp
-- '[tracked Ns]' and '[tte ...]'/'[untracked]' tags -- lives inside
-- summary, so a flag appearing or disappearing breaks the run), and a
-- start_ts no later than that row's end_ts (any gap, even one second, breaks
-- the run). A row from any other source sitting between two otherwise
-- mergeable rows breaks the run too, so a merged line never spans a row it
-- would move out of time order. Overlaps are therefore never resolved: two
-- sources covering the same stretch stay separate lines. A merged line names
-- every member row id in member order, its member count, and its span (the
-- first member's start_ts to the latest end_ts among members); it takes
-- abuts_prior from its first member and abuts_next from its last member. The
-- member list is what a proposal's evidence_chain cites, so every line
-- traces back to its source rows.
--
-- Adding a STANDING-FACT branch follows the same UNION ALL shape inside the
-- standing_facts CTE, under four rules: it is unfiltered by date (that is the
-- whole point), it aggregates to one row per distinct fact rather than per
-- source row, it puts its observation span in `detail`, and it never emits a
-- start_ts. Deliberately NOT filtered: internal extensions and voicemail rows
-- carry contact_name too, and a colleague's extension is an identity like any
-- other -- do not add an is_internal or raw_type filter here. Deliberately NOT
-- collapsed: a number appearing under two spellings of a name yields two rows,
-- so the disagreement is visible rather than silently resolved by the query.
--
-- Adding a source is a new UNION ALL branch here plus a new expected_sources
-- row (its table name and the short alias its lines carry), and the same
-- expected_sources row in backfill.sql, whose gate is a copy of this one (a
-- test asserts the two lists match) -- no schema
-- migration required for source_fetch_log itself (see its comment in
-- migrations.sql), only for the source's own table. Google Calendar
-- (gcal_events) was registered this way as the fifth source (issue #454), the
-- iCloud calendar (icloud_events) as the sixth (issue #1199), and sent mail
-- (sent_mail) as the seventh (issue #1261); the design doc's step 1
-- anticipates Chrometa the same way.
--
-- REGISTERING A SOURCE HERE GIVES IT TEETH. From the moment its name appears
-- in expected_sources, every day blocks until it reaches a terminal status, so
-- its fetch path must record an outcome on every exit -- see /timecamping
-- SKILL.md Step 2, which enumerates each path and the status it writes.
--
-- A source's expected_sources name is its TABLE name, which is what
-- source_fetch_log.source_name must carry -- 'gcal_events', not 'gcal'.

WITH target(local_date) AS (
  SELECT ?
),
-- The SOURCES legend line is built from this list, so an alias can never
-- reach a line without its table name reaching the legend.
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
standing_facts AS (
  -- Telus contact directory. One row per distinct (number, name) PAIR, over
  -- the whole call history rather than the target date. phone_number is
  -- E.164 as stored ('+16045550172'), so a session matching it against a
  -- number written elsewhere in another format ('+1 604-555-0172' in a
  -- calendar description) normalizes on its side -- the query does not
  -- guess at formats, because every format it failed to anticipate would
  -- silently reproduce the defect this branch exists to fix.
  SELECT
    'telus_calls' AS source_table,
    phone_number || ' = ' || contact_name AS summary,
    'seen ' || MIN(local_date) || ' to ' || MAX(local_date)
      || ' (' || COUNT(*) || ' calls)' AS detail
  FROM telus_calls
  WHERE contact_name IS NOT NULL AND contact_name <> ''
  GROUP BY phone_number, contact_name
),
evidence AS (
  SELECT
    'timecamp_time_entries' AS source_table,
    id AS source_row_id,
    start_ts,
    end_ts,
    task_display
      || CASE WHEN task_color = '#E5C947' THEN ' [amber/work-queue]' ELSE '' END
      -- Switching File (#853): matched by task id, never by its brown colour,
      -- which Write-off and MS Teams Write off share.
      || CASE WHEN timecamp_task_id = '80544222' THEN ' [switching-file/work-queue]' ELSE '' END
      -- TRACKED TIME (#1102): duration_seconds is the time TimeCamp counts,
      -- the sum of the activity rows attributed to this entry. The clock span
      -- is only first row to last and also holds nested entries' seconds and
      -- untracked stretches, so the span never stands for coverage.
      || ' [tracked ' || duration_seconds || 's]'
      || CASE WHEN description IS NOT NULL AND description <> '' THEN ' -- ' || description ELSE '' END
      AS summary
  FROM timecamp_time_entries
  WHERE local_date = (SELECT local_date FROM target)

  UNION ALL

  -- ATTRIBUTION (#1102): each activity row counts toward exactly one entry,
  -- named by its payload's entry_id ('0' = none). [tte <id>] is that entry's
  -- id in this read; [tte ?<native id>] an entry absent from the table, kept
  -- distinct so it is never read as untracked; [untracked] no entry at all.
  -- The tag lives inside summary, so a run breaks where attribution changes.
  SELECT
    'timecamp_computer_activities',
    a.id,
    a.start_ts,
    a.end_ts,
    COALESCE(a.application, '') || ': ' || COALESCE(a.window_title, '')
      || CASE
           WHEN COALESCE(CAST(json_extract(a.raw_payload, '$.entry_id') AS TEXT), '0') IN ('0', '') THEN ' [untracked]'
           WHEN e.id IS NOT NULL THEN ' [tte ' || e.id || ']'
           ELSE ' [tte ?' || CAST(json_extract(a.raw_payload, '$.entry_id') AS TEXT) || ']'
         END
  FROM timecamp_computer_activities a
  LEFT JOIN timecamp_time_entries e
    ON e.native_id = CAST(json_extract(a.raw_payload, '$.entry_id') AS TEXT)
  WHERE a.local_date = (SELECT local_date FROM target)

  UNION ALL

  SELECT
    'syncopaid_captures',
    id,
    captured_at,
    COALESCE(end_ts, captured_at),
    COALESCE(process_name, '') || ': ' || COALESCE(window_title, '')
      || CASE WHEN ocr_text IS NOT NULL AND ocr_text <> '' THEN ' [OCR available]' ELSE '' END
  FROM syncopaid_captures
  WHERE local_date = (SELECT local_date FROM target)

  UNION ALL

  SELECT
    'telus_calls',
    id,
    start_ts,
    end_ts,
    COALESCE(contact_name, phone_number) || ' (' || action_result || ', ' || duration_seconds || 's)'
  FROM telus_calls
  WHERE local_date = (SELECT local_date FROM target)

  UNION ALL

  -- Structural facts only -- this branch classifies nothing. Whether an event
  -- is a marker or a work block, and whether it happened at all, is Step 5's
  -- judgment; the flags below are the shape it needs to make it, in the same
  -- spirit as the SyncoPaid branch's '[OCR available]' pointer.
  SELECT
    'gcal_events',
    id,
    start_ts,
    end_ts,
    COALESCE(title, '(untitled)')
      || CASE WHEN all_day = 1 THEN ' [all-day]' ELSE '' END
      || CASE WHEN transparency = 'transparent' THEN ' [free]' ELSE '' END
      || CASE WHEN attendees IS NOT NULL AND attendees <> '' AND attendees <> '[]'
              THEN ' [guests listed]' ELSE '' END
      || CASE WHEN updated IS NOT NULL AND updated = created
              THEN ' [never edited since created ' || created || ']' ELSE '' END
  FROM gcal_events
  WHERE local_date = (SELECT local_date FROM target)

  UNION ALL

  -- Structural facts only, as for gcal_events: the calendar the event was read
  -- from, [all-day], and [free] for an event the calendar marks not busy.
  -- iCloud returns no created/updated, so there is no staleness flag here.
  SELECT
    'icloud_events',
    id,
    start_ts,
    end_ts,
    COALESCE(title, '(untitled)')
      || ' [calendar: ' || calendar || ']'
      || CASE WHEN all_day = 1 THEN ' [all-day]' ELSE '' END
      || CASE WHEN busy = 0 THEN ' [free]' ELSE '' END
  FROM icloud_events
  WHERE local_date = (SELECT local_date FROM target)

  UNION ALL

  -- A sent email is an event, one instant, so its span starts and ends at
  -- sent_ts. Structural facts only, and never a body: the subject, '->', the
  -- To list, and the Cc list when there is one. Whether an email bills time,
  -- and whether a meeting response is only a marker, is Step 5's judgment.
  SELECT
    'sent_mail',
    id,
    sent_ts AS start_ts,
    sent_ts AS end_ts,
    COALESCE(subject, '(no subject)')
      || ' -> ' || COALESCE((SELECT GROUP_CONCAT(value, ', ' ORDER BY key) FROM json_each(to_recipients)), '')
      || CASE WHEN json_array_length(cc_recipients) > 0
              THEN ' [cc ' || (SELECT GROUP_CONCAT(value, ', ' ORDER BY key) FROM json_each(cc_recipients)) || ']'
              ELSE '' END
  FROM sent_mail
  WHERE local_date = (SELECT local_date FROM target)
),
-- Boundary continuity per raw row, before merging (see the header).
flagged AS (
  SELECT
    evidence.*,
    CASE WHEN EXISTS (
      SELECT 1 FROM evidence e2
      WHERE e2.end_ts = evidence.start_ts
        AND NOT (e2.source_table = evidence.source_table AND e2.source_row_id = evidence.source_row_id)
    ) THEN 1 ELSE 0 END AS abuts_prior,
    CASE WHEN EXISTS (
      SELECT 1 FROM evidence e2
      WHERE e2.start_ts = evidence.end_ts
        AND NOT (e2.source_table = evidence.source_table AND e2.source_row_id = evidence.source_row_id)
    ) THEN 1 ELSE 0 END AS abuts_next
  FROM evidence
),
-- Gaps and islands. island_start is 0 only when the row continues the row
-- immediately before it (the MERGING rule in the header). A NULL summary never
-- compares equal, so such a row always stands alone.
ordered AS (
  SELECT
    flagged.*,
    ROW_NUMBER() OVER w AS seq,
    CASE WHEN source_table = LAG(source_table) OVER w
          AND summary = LAG(summary) OVER w
          AND start_ts <= LAG(end_ts) OVER w
         THEN 0 ELSE 1 END AS island_start
  FROM flagged
  WINDOW w AS (ORDER BY start_ts, summary, source_table, source_row_id)
),
islands AS (
  SELECT
    ordered.*,
    SUM(island_start) OVER (ORDER BY seq) AS island,
    COALESCE(LEAD(island_start) OVER (ORDER BY seq), 1) AS island_end
  FROM ordered
),
-- One row per output evidence line. source_table and summary are identical
-- across an island's members by construction. MIN(start_ts) is the first
-- member's, because members are in start_ts order.
merged AS (
  SELECT
    MIN(seq) AS first_seq,
    source_table,
    summary,
    COUNT(*) AS member_count,
    GROUP_CONCAT(source_row_id, ',' ORDER BY seq) AS member_ids,
    MIN(start_ts) AS start_ts,
    MAX(end_ts) AS end_ts,
    MAX(CASE WHEN island_start = 1 THEN abuts_prior END) AS abuts_prior,
    MAX(CASE WHEN island_end = 1 THEN abuts_next END) AS abuts_next
  FROM islands
  GROUP BY island, source_table, summary
),
-- Every line after the DAY header, with its sort key. Standing facts sort
-- BEFORE evidence: a real day carries well over a thousand evidence lines, and
-- a directory placed at the tail is the part a truncated read loses. The
-- summary sort makes the fact block deterministic.
body(part, k, sort_text, line) AS MATERIALIZED (
  SELECT 1, 0, '',
    'SOURCES ' || GROUP_CONCAT(alias || '=' || source_name, ' ' ORDER BY alias)
  FROM expected_sources

  UNION ALL

  SELECT 2, 0, '',
    'FORMAT fields are tab-separated; summary is last and verbatim'
      || ' | FACT line: FACT, source, detail, summary'
      || ' | evidence line: source, [member ids], count, start, end, abuts, summary'
      || ' | start is a UTC timestamp; end is HH:MM:SS if on start''s UTC date, else a UTC timestamp'
      || ' | abuts is 2 chars: < if the first member starts where another row ends, else -;'
      || ' > if the last member ends where another row starts, else -'
      || ' | count > 1 merges consecutive rows of one source with identical summary and no gap;'
      || ' start is the first member''s, end the latest member''s'
      || ' | tte [tracked Ns] = seconds TimeCamp counts for the entry, not its span;'
      || ' tca [tte <id>] = the entry the row counts toward (it may be an entry dated another day),'
      || ' [tte ?<native id>] = entry not in the table, [untracked] = no entry'

  UNION ALL

  SELECT 3, 0, f.summary,
    'FACT' || char(9) || COALESCE(s.alias, f.source_table) || char(9) || f.detail
      || char(9) || f.summary
  FROM standing_facts f
  LEFT JOIN expected_sources s ON s.source_name = f.source_table

  UNION ALL

  SELECT 4, m.first_seq, '',
    COALESCE(s.alias, m.source_table)
      || char(9) || '[' || m.member_ids || ']'
      || char(9) || m.member_count
      || char(9) || m.start_ts
      || char(9) || CASE WHEN substr(m.end_ts, 1, 10) = substr(m.start_ts, 1, 10)
                         THEN substr(m.end_ts, 12, 8) ELSE m.end_ts END
      || char(9) || CASE WHEN m.abuts_prior = 1 THEN '<' ELSE '-' END
                 || CASE WHEN m.abuts_next = 1 THEN '>' ELSE '-' END
      || char(9) || COALESCE(m.summary, '')
  FROM merged m
  LEFT JOIN expected_sources s ON s.source_name = m.source_table
)
-- The branches are wrapped in a subquery so the ORDER BY below can name
-- columns the result does not carry: SQLite requires every ORDER BY term
-- applied directly to a compound (UNION ALL) SELECT to be a result column.
SELECT line FROM (

SELECT 0 AS part, 0 AS k, '' AS sort_text,
  'GATE VIOLATION: missing ' || gate.missing_sources AS line
FROM gate
WHERE gate.missing_count > 0

UNION ALL

SELECT 0, 0, '',
  'DAY ' || target.local_date
    || ' | lines ' || (SELECT COUNT(*) FROM body)
    || ' | chars ' || (SELECT SUM(LENGTH(line)) FROM body)
FROM gate
CROSS JOIN target
WHERE gate.missing_count = 0

UNION ALL

-- Gated exactly like evidence, standing facts included, on purpose. A
-- standing fact is a projection of one source's table, so serving it on a
-- violation day would show the model a single source's contents while
-- assembly is still incomplete -- the one exposure the hard gate exists to
-- prevent. On a violation the session halts anyway, so an ungated fact would
-- have no reader. gate is the outer loop, so a violation day never scans body.
SELECT body.part, body.k, body.sort_text, body.line
FROM gate
CROSS JOIN body
WHERE gate.missing_count = 0

)
ORDER BY part, k, sort_text, line;
