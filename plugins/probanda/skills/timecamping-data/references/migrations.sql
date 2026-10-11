-- timecamping.db migration hops.
--
-- Format: each hop is a "-- MIGRATE <from> -> <to>" marker followed by the
-- SQL that applies it, self-contained (must end by stamping
-- db_meta.schema_version to its own target -- migrate_engine.py's runner
-- applies the hop's SQL verbatim and does no stamping of its own). A future
-- schema change is an ADDITIVE new hop here, never an edit to an existing
-- one -- and bumps TARGET_SCHEMA_VERSION in scripts/migrate_engine.py by one.
--
-- v1 schema shape settled 2026-08-28 (issue #430), reviewed by Fable 5, and
-- corrected against one live TimeCamp /third_party/api/entries/ response
-- pulled during the build: the entries endpoint already returns each row's
-- task display name and hex colour inline ("name", "color") -- no separate
-- /third_party/api/tasks/ call is needed to resolve timecamp_time_entries'
-- task_display/task_color columns, simplifying the fetch this hop's schema
-- was designed to support.

-- MIGRATE 0 -> 1

CREATE TABLE timecamp_time_entries (
    id                 INTEGER PRIMARY KEY,
    native_id          TEXT NOT NULL UNIQUE,   -- TimeCamp entry "id" (integer, stored as text)
    start_ts           TEXT NOT NULL,          -- ISO 8601 UTC, from date+start_time in the practitioner's local tz
    end_ts             TEXT NOT NULL,          -- ISO 8601 UTC, from date+end_time
    local_date         TEXT NOT NULL,          -- TimeCamp's own "date" field, YYYY-MM-DD
    duration_seconds   INTEGER NOT NULL,       -- TimeCamp's "duration" (numeric string), parsed
    timecamp_task_id   TEXT,                   -- "task_id"; existing assignment, verbatim/unresolved
    task_display       TEXT,                   -- "name" -- already inline on the entries response
    task_color         TEXT,                   -- "color", hex; amber #E5C947 = work queue, green #5CCB72 = billable matter
    description        TEXT,                   -- "description" -- typically empty pre-categorization; write-back target
    billable           INTEGER NOT NULL DEFAULT 1 CHECK (billable IN (0,1)),  -- "billable" (already 0/1)
    locked              INTEGER NOT NULL DEFAULT 0 CHECK (locked IN (0,1)),    -- "locked" ("0"/"1" string), invoiced entries
    raw_payload         TEXT,                   -- JSON: full source row verbatim (user_id, user_name, task_note, invoiceId, ...)
    fetched_at           TEXT NOT NULL
);
CREATE INDEX idx_tc_entries_date ON timecamp_time_entries(local_date);

CREATE TABLE timecamp_computer_activities (
    id                 INTEGER PRIMARY KEY,
    native_id          TEXT NOT NULL UNIQUE,   -- activity_id
    start_ts           TEXT NOT NULL,          -- end_time - time_span
    end_ts             TEXT NOT NULL,
    local_date         TEXT NOT NULL,
    application        TEXT,
    window_title       TEXT,
    timecamp_task_id   TEXT,                   -- "0" = unassigned
    raw_payload        TEXT,
    fetched_at         TEXT NOT NULL
);
CREATE INDEX idx_tc_activities_date ON timecamp_computer_activities(local_date);

-- Capture-level rows (one row = one capture), NOT build-timeline's block-level
-- `evidence blocks` shape: every SyncoPaid-heavy fixture needs per-capture
-- window titles, input counts, and the 1:1 screenshot (the mixed-entry
-- fixture's "same screenshot id repeated" proves the 1:1). Output shape
-- unverified against the live capture-level CLI subcommand at migration
-- time -- nullable columns + raw_payload absorb shape surprises; a real
-- mismatch becomes an additive 1 -> 2 hop, never an edit to this one.
CREATE TABLE syncopaid_captures (
    id                        INTEGER PRIMARY KEY,
    native_id                 TEXT NOT NULL UNIQUE,  -- normalized capture instant, UTC seconds precision
    captured_at               TEXT NOT NULL,
    end_ts                    TEXT,                  -- next capture's instant (computed); NULL for the day's last
    local_date                TEXT NOT NULL,
    process_name              TEXT,
    window_title               TEXT,
    mouse_clicks               INTEGER,
    keyboard_events             INTEGER,
    screenshot_ref              TEXT,                  -- path/handle from the live CLI; shape unverified
    ocr_text                    TEXT,
    syncopaid_matter_id        TEXT,                  -- SyncoPaid's own guess, verbatim, never acted on directly
    syncopaid_matter_display   TEXT,
    raw_payload                 TEXT,
    fetched_at                   TEXT NOT NULL
);
CREATE INDEX idx_syncopaid_date ON syncopaid_captures(local_date);

CREATE TABLE telus_calls (
    id                 INTEGER PRIMARY KEY,
    native_id          TEXT NOT NULL UNIQUE,   -- c{date}T{time}{phone}, per build-timeline/reference/TelusConnect.md
    start_ts           TEXT NOT NULL,
    end_ts             TEXT NOT NULL,
    local_date         TEXT NOT NULL,
    phone_number       TEXT NOT NULL,          -- E.164
    contact_name       TEXT,
    action             TEXT,
    action_result      TEXT,
    result_description TEXT,
    duration_seconds   INTEGER NOT NULL,
    raw_type           TEXT NOT NULL CHECK (raw_type IN ('phone_call','voicemail')),
    is_internal        INTEGER NOT NULL DEFAULT 0 CHECK (is_internal IN (0,1)),
    raw_payload        TEXT,
    fetched_at         TEXT NOT NULL
);
CREATE INDEX idx_telus_date ON telus_calls(local_date);

-- Assembly gate (design doc step 3): the durable, queryable form of "no
-- inference until every source is fully populated for the day". No CHECK on
-- source_name -- the design doc anticipates later-registered sources (email,
-- calendars, Chrometa), and a CHECK would force a migration per registration.
-- Re-fetching a day upserts on (source_name, local_date).
CREATE TABLE source_fetch_log (
    id            INTEGER PRIMARY KEY,
    source_name   TEXT NOT NULL,
    local_date    TEXT NOT NULL,
    status        TEXT NOT NULL CHECK (status IN ('fetched','empty','failed','skipped')),
    row_count     INTEGER NOT NULL DEFAULT 0,
    error_detail  TEXT,
    fetched_at    TEXT NOT NULL,
    UNIQUE (source_name, local_date)
);
CREATE INDEX idx_fetch_log_date ON source_fetch_log(local_date);

-- Presumptions (created before proposals: proposals references it).
CREATE TABLE presumptions (
    id                       INTEGER PRIMARY KEY,
    identifier               TEXT NOT NULL UNIQUE,   -- channel-agnostic, e.g. "John Baker"; a composite
                                                     -- pattern is one identifier string ("John Baker + Sara Smith")
    matter_ref               TEXT NOT NULL,
    matter_display            TEXT,
    status                    TEXT NOT NULL DEFAULT 'candidate' CHECK (status IN ('candidate','approved','suspended','voided')),
    confirmed_count           INTEGER NOT NULL DEFAULT 0,
    conflicting_count         INTEGER NOT NULL DEFAULT 0,
    correlation_at_approval   REAL,
    running_correlation       REAL,
    first_observed_at         TEXT NOT NULL,
    approved_at               TEXT,        -- stamped by the presumption-offer/approval ceremony
    suspended_at              TEXT,
    suspension_reason         TEXT,
    voided_at                 TEXT
);
CREATE INDEX idx_presumptions_status ON presumptions(status);

-- Proposals (design doc step 5 output). One proposal per block -- the block
-- IS the proposal's span, so there is no separate block table; member rows
-- live in evidence_chain. An empty block (no data from any source) is a
-- proposal with corroboration='empty' and an empty evidence_chain. Re-running
-- a day marks that day's prior proposals 'superseded' first.
CREATE TABLE proposals (
    id                           INTEGER PRIMARY KEY,
    local_date                   TEXT NOT NULL,
    start_ts                     TEXT NOT NULL,
    end_ts                       TEXT NOT NULL,
    proposed_timecamp_task_id    TEXT,
    proposed_matter_ref          TEXT,
    proposed_description         TEXT NOT NULL,   -- {verb} {object} {details} grammar
    evidence_chain                TEXT NOT NULL,   -- JSON [{source_table, source_row_id, role}]; [] for empty blocks
    rationale                     TEXT,
    corroboration                  TEXT NOT NULL CHECK (corroboration IN ('direct_carries','direct_leap','indirect_only','conflict','empty')),
    has_conflict                    INTEGER NOT NULL DEFAULT 0 CHECK (has_conflict IN (0,1)),
    presumption_id                  INTEGER REFERENCES presumptions(id),   -- non-null only when an approved presumption was applied
    overlapping_presumption_ids      TEXT,            -- JSON array; populated only on void-on-overlap
    needs_ceremony                    INTEGER NOT NULL CHECK (needs_ceremony IN (0,1)),
    ceremony_grid_row                  INTEGER CHECK (ceremony_grid_row BETWEEN 1 AND 9),  -- recorded for silent rows too (audit/regression)
    status                              TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','committed_silent','committed_after_ceremony','rejected','superseded')),
    proposed_at                          TEXT NOT NULL,
    written_back                          INTEGER NOT NULL DEFAULT 0 CHECK (written_back IN (0,1)),
    written_back_at                        TEXT
);
CREATE INDEX idx_proposals_date ON proposals(local_date);
CREATE INDEX idx_proposals_status ON proposals(status);

-- Determinations (design doc step 7: block-ceremony answers as evidence).
-- Presumption-lifecycle ceremonies (offer/re-approval) are NOT rows here --
-- they stamp the presumptions row directly (approved_at,
-- correlation_at_approval), which already carries every fact an offer
-- determination would hold. Write-back state lives on proposals only.
CREATE TABLE determinations (
    id                      INTEGER PRIMARY KEY,
    proposal_id             INTEGER NOT NULL UNIQUE REFERENCES proposals(id),
    decided_at              TEXT NOT NULL,
    decision                TEXT NOT NULL CHECK (decision IN ('approved','corrected','rejected','written_off')),
    final_timecamp_task_id  TEXT,
    final_matter_ref        TEXT,
    final_description       TEXT,
    practitioner_note       TEXT,   -- elicitation content (e.g. the Mason-example actual start/end) -- itself new evidence
    ceremony_kind            TEXT NOT NULL CHECK (ceremony_kind IN ('conflict','no_corroboration','indirect_only','elicitation')),
    corroborates              TEXT    -- JSON {"identifier":..., "matter_ref":...} -- feeds presumption pattern-counting
);
CREATE INDEX idx_determinations_kind ON determinations(ceremony_kind);

CREATE TABLE db_meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

INSERT INTO db_meta (key, value) VALUES ('schema_version', '1');

-- MIGRATE 1 -> 2

-- Register Google Calendar as the fifth evidence source (issue #454). Purely
-- additive: source_fetch_log needs no change, because source_name is
-- deliberately not CHECK-constrained precisely so registering a source costs
-- no migration there. The gate row and the UNION ALL branch that make this
-- table actually reachable live in references/splice.sql.
--
-- Shape mirrors telus_calls, the closest existing source table. The columns
-- that are not boilerplate, and why (ticket #454, findings from #421):
--   created/updated -- structured source fields, NOT ingest-time
--     interpretation (which build-timeline/SKILL.md 169-171 forbids). The
--     lead time from created to start_ts sets the prior on a hypothesis, and
--     updated == created on a booking whose real-world time changed is the
--     staleness fingerprint.
--   all_day/transparency -- the event's SHAPE, stored so Step 5 can refuse to
--     turn an all-day 'Busy' marker into a 24-hour interval. transparency
--     carries no CHECK and no default: an omitted field is stored NULL rather
--     than fabricated into the API's documented default.
--   calendar_id -- which of the three Google identities the row came from. NOT
--     NULL on purpose: a row whose calendar is unknown is exactly the
--     wrong-calendar failure this registration exists to prevent, so it fails
--     hard rather than inheriting the route's assumed identity.
--   attendees -- JSON, each with responseStatus. The attendee address often
--     resolves to nothing; stored for completeness, never as a matter key.

CREATE TABLE gcal_events (
    id            INTEGER PRIMARY KEY,
    native_id     TEXT NOT NULL UNIQUE,   -- 'gcal:{event_id}', per build-timeline/reference/GoogleCalendar.md
    calendar_id   TEXT NOT NULL,          -- the calendar this event was read from
    start_ts      TEXT NOT NULL,          -- ISO 8601 UTC
    end_ts        TEXT NOT NULL,          -- ISO 8601 UTC; for an all-day event, the source's own exclusive end
    local_date    TEXT NOT NULL,          -- local date of start_ts, YYYY-MM-DD
    all_day       INTEGER NOT NULL DEFAULT 0 CHECK (all_day IN (0,1)),
    title         TEXT,                   -- the event's "summary"
    description   TEXT,
    location      TEXT,
    transparency  TEXT,                   -- 'opaque'/'transparent' verbatim; NULL when the API omits it
    attendees     TEXT,                   -- JSON array, each with responseStatus
    created       TEXT,                   -- verbatim
    updated       TEXT,                   -- verbatim
    raw_payload   TEXT,                   -- JSON: full source row verbatim
    fetched_at    TEXT NOT NULL
);
CREATE INDEX idx_gcal_date ON gcal_events(local_date);

UPDATE db_meta SET value = '2' WHERE key = 'schema_version';

-- MIGRATE 2 -> 3

-- evidence_chain names member lists (issue #938). The consolidated-day read
-- now merges consecutive identical rows into one line that lists every member
-- row id, so a chain entry cites a list: {source_table, source_row_ids, role},
-- where source_row_ids is always an array (one element for an unmerged row)
-- and null for a standing fact. No DDL changes -- the proposals column comment
-- in the 0 -> 1 hop above still shows the old scalar shape and is superseded
-- by this hop.
--
-- Rewrites every existing entry, superseded proposals included: the scalar
-- source_row_id is removed and source_row_ids is set to [id], or to null when
-- it was null. Array order and every other key are kept. An entry with no
-- source_row_id key is left exactly as it is -- it is not a v2 entry, and this
-- hop invents no value for it.

UPDATE proposals
SET evidence_chain = (
  SELECT json_group_array(
    CASE
      WHEN json_type(e.value, '$.source_row_id') IS NULL THEN json(e.value)
      WHEN json_type(e.value, '$.source_row_id') = 'null' THEN
        json_set(json_remove(e.value, '$.source_row_id'), '$.source_row_ids', json('null'))
      ELSE
        json_set(json_remove(e.value, '$.source_row_id'), '$.source_row_ids',
                 json_array(json_extract(e.value, '$.source_row_id')))
    END
    ORDER BY e.key
  )
  FROM json_each(proposals.evidence_chain) AS e
);

UPDATE db_meta SET value = '3' WHERE key = 'schema_version';

-- MIGRATE 3 -> 4

-- Manual completion of an uncovered proposal (issue #997). An uncovered block
-- has no TimeCamp entry to write back to, so the practitioner enters it by
-- hand. entered_by_hand_at is NULL until the practitioner confirms that entry,
-- then the UTC time of that confirmation. It is not an API write:
-- written_back stays 0 and status keeps its Step 6 outcome. A proposal is
-- terminal when written_back = 1 or entered_by_hand_at is set.

ALTER TABLE proposals ADD COLUMN entered_by_hand_at TEXT;

UPDATE db_meta SET value = '4' WHERE key = 'schema_version';

-- MIGRATE 4 -> 5

-- Register the practitioner's iCloud calendar as the sixth evidence source
-- (issue #1199). Purely additive, like the 1 -> 2 hop: source_fetch_log needs
-- no change, and the gate row and UNION ALL branch live in
-- references/splice.sql.
--
-- Shape mirrors gcal_events. The columns that differ, and why (decisions on
-- #1199; the route is build-timeline/reference/ICloudCalendar.md):
--   calendar -- the calendar NAME the event was read from ('Work' or 'Home';
--     'Family' is never read). NOT NULL for the same reason as
--     gcal_events.calendar_id: a row whose calendar is unknown is the
--     wrong-calendar failure, silently reasoned over.
--   calendar_url -- the CalDAV URL of that calendar, as the qualified calendar
--     list reported it. Route qualification compares by URL, not name.
--   busy -- the extension's busy flag, verbatim. With all_day it is the
--     event's SHAPE, stored so Step 5 can classify it; nothing is dropped at
--     ingest. No default on either: the extension always returns both.
--   notes -- the extension trims them to 500 characters.
--   uid -- the iCalendar UID. Every occurrence of a repeating event shares it
--     and the extension exposes no recurrence id, so native_id adds the local
--     start date: '{uid}_{YYYY-MM-DD}'.
-- No etag column (decided on #1199; raw_payload keeps the whole event, etag
-- included) and no created/updated: iCloud returns neither, so the Google
-- staleness fingerprint is unavailable for this source.

CREATE TABLE icloud_events (
    id            INTEGER PRIMARY KEY,
    native_id     TEXT NOT NULL UNIQUE,   -- '{uid}_{local start date}', per build-timeline/reference/ICloudCalendar.md
    calendar      TEXT NOT NULL,          -- the calendar name this event was read from
    calendar_url  TEXT,                   -- that calendar's URL from the qualified calendar list
    start_ts      TEXT NOT NULL,          -- ISO 8601 UTC
    end_ts        TEXT NOT NULL,          -- ISO 8601 UTC; for an all-day event, local midnight of the source's exclusive end date
    local_date    TEXT NOT NULL,          -- local date of start_ts, YYYY-MM-DD
    all_day       INTEGER NOT NULL CHECK (all_day IN (0,1)),
    busy          INTEGER NOT NULL CHECK (busy IN (0,1)),
    title         TEXT,
    location      TEXT,
    notes         TEXT,                   -- trimmed to 500 characters by the extension
    uid           TEXT NOT NULL,          -- iCalendar UID, shared by every occurrence of a repeating event
    raw_payload   TEXT,                   -- JSON: full source row verbatim
    fetched_at    TEXT NOT NULL
);
CREATE INDEX idx_icloud_date ON icloud_events(local_date);

UPDATE db_meta SET value = '5' WHERE key = 'schema_version';

-- MIGRATE 5 -> 6

-- Register the practitioner's sent mail as the seventh evidence source
-- (issue #1261). Purely additive, like the 4 -> 5 hop: source_fetch_log needs
-- no change, and the gate row and UNION ALL branch live in
-- references/splice.sql.
--
-- A sent email is a build-timeline Event: one instant, no duration. It is read
-- from the iCloud copy of the Microsoft 365 Sent Items through the iCloud
-- desktop extension (the route is build-timeline/reference/SentMail.md).
-- Metadata only, never a body. The columns, and why (decisions on #1261):
--   native_id -- the RFC 5322 Message-ID, angle brackets stripped. It is the
--     same wherever the message is held (the iCloud copy keeps the original
--     Exchange Message-ID), so a message in several folders is one row, and any
--     later route must key on it and write into this table, never a second.
--   sent_ts -- the Event's ts: the message's own date, converted to UTC.
--   folder -- the iCloud folder the kept copy was read from: 'Sent Items',
--     'Sent Messages' or either's 'Outbound LEAP Matter Based Emails'
--     subfolder (Sent Messages added on #942). NOT NULL for the same
--     reason as icloud_events.calendar. No CHECK, so a folder added to the
--     in-scope table after review needs no migration; the ingest script
--     refuses any other folder.
--   to_recipients, cc_recipients -- JSON arrays, verbatim; '[]' when none.
--   uid -- the IMAP UID within that folder. Not stable across folders, so it
--     is never a key; it is kept for a single-row detail read.

CREATE TABLE sent_mail (
    id              INTEGER PRIMARY KEY,
    native_id       TEXT NOT NULL UNIQUE,   -- RFC 5322 Message-ID, angle brackets stripped, per build-timeline/reference/SentMail.md
    sent_ts         TEXT NOT NULL,          -- ISO 8601 UTC
    local_date      TEXT NOT NULL,          -- local date of sent_ts, YYYY-MM-DD
    folder          TEXT NOT NULL,          -- the iCloud folder the kept copy was read from
    from_address    TEXT,
    subject         TEXT,
    to_recipients   TEXT NOT NULL,          -- JSON array, verbatim
    cc_recipients   TEXT NOT NULL,          -- JSON array, verbatim; '[]' when none
    uid             TEXT NOT NULL,          -- IMAP UID within folder; not stable across folders
    raw_payload     TEXT,                   -- JSON: the search result message verbatim, never a body
    fetched_at      TEXT NOT NULL
);
CREATE INDEX idx_sent_mail_date ON sent_mail(local_date);

UPDATE db_meta SET value = '6' WHERE key = 'schema_version';
