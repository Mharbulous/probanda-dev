---
name: build-timeline
description: "Sole ingester of raw time evidence into the timeline store, one date at a time, from the registered sources: TimeCamp, Telus Business Connect, Google Calendar, the iCloud calendar (Work and Home calendars, read through the lawyer plugin's calendar tools), sent mail (the iCloud copy of the Microsoft 365 Sent Items, read through the lawyer plugin's mail tools), and SyncoPaid screen-activity blocks, plus a one-time historical bulk import of Chrometa screen-activity logs. Use to build/refresh/re-import raw time-tracking data for a date, or to run the Chrometa historical import. Raw data only -- does not classify time or assign it to matters (that is time-sorting), and does not bill."
dependencies:
  - time-pipeline-data  # continuous timeline store under the `timeline` namespace
  - timecamping-data    # the Telus source's importer and its bulk ingest
  - google-calendar-mcp # calendar events (optional — degrades gracefully if unavailable)
  - calendar tools of the lawyer plugin's contacts-calendars-email server # iCloud calendar events (Work and Home calendars only), read-only (an unconfigured calendar records that source `failed`)
  - mail tools of the lawyer plugin's contacts-calendars-email server # sent mail (Sent Items, Sent Messages and their LEAP subfolders only), metadata only
---

<!-- billing v0.5.3 -->
> **Installed copy.** This skill's full source tree ships beside this file, and a relative path in the text below cites that tree. Resolve one by trying, in order: the directory of the file you are reading, then `${CLAUDE_SKILL_DIR}/<path>`, then `${CLAUDE_SKILL_DIR}/../<path>` (so `shared/x.md` is at `${CLAUDE_SKILL_DIR}/../shared/x.md`). `${CLAUDE_SKILL_DIR}` is the directory holding this SKILL.md, even where it shows unsubstituted: never search for it or guess. Read references and shared files from there with the Read tool, a whole file or an offset and limit, never with a shell command, the litigation data server's skill-source tool or a folder-access request; scripts and templates the text declares are executed and read from there too. Before each fresh read (a file not already in context), list only `${CLAUDE_SKILL_DIR}/../../..` (the folder holding this plugin's folder). If it holds this plugin's folder name, with any `~g<N>` suffix removed, plus a `~g<N>` higher than this plugin's folder's own (none counts as 0), or if `${CLAUDE_SKILL_DIR}` no longer exists, the plugin was re-synced mid-session: take the highest `~g<N>` copy and repeat the same three tries with its `skills/<this skill>` directory in place of `${CLAUDE_SKILL_DIR}`; tell the user once that the plugin updated mid-session, from the version in this file's version comment to the version in that folder's copy of this SKILL.md. If a file the text names is missing at every one of those paths, including the re-synced folder's, STOP and report the exact path and error to the user rather than substituting an alternative: do not re-derive a script's logic from its source text or the prose, and do not search elsewhere on the filesystem. Ask the user to reinstall the plugin and fully restart the app; this may fix it, but STOP means stop regardless: do not diagnose further yourself.
> **HTML pages.** Every HTML file this plugin writes is a human interface generated from its databases; an agent never views, reads, greps, parses, scripts over, authors or requests a screenshot of one, but may present one to a human user to view, staging it first where presenting needs that, and may view a screenshot the user provides on their own initiative. The rule and the data to use instead: `shared/html-pages.md`.

## Contents

| Section | Read when |
|---|---|
| Scope | Deciding whether a request or source falls inside this skill's job |
| Core primitives | Deciding whether a record is an activity or an event |
| Data model | Building row ids, keys, indexes or row schemas |
| Workflow | Every build, refresh or re-import run |
| Queries | Mapping a practitioner request to the action that answers it |
| Display rules | The practitioner asks to see the raw timeline |
| Integration with other skills | Working out how downstream skills use these rows |
| Critical constraints | Always |

This skill deliberately carries no `disable-model-invocation` line: `/timecamping`'s source ingestion opens it
through the Skill tool, which refuses a skill carrying that line. It is a stated
exception. Do not add the line back.

# Build-Timeline

Fetch raw activities and events from time-stamped sources and store them in a
continuous, source-attributed chronology. This skill is strictly a data
assembly layer — it records what sources observed, without interpretation.

## Scope

This skill handles:

- Fetching TimeCamp computer activities, Telus Business Connect telephony
  records, Google Calendar events, iCloud calendar events, sent mail, and
  SyncoPaid screen-activity blocks for a requested date or date range.
- Running Chrometa's one-time historical bulk import (2019-01 to 2020-03) on
  request — a closed data window, outside the per-date source loop. See
  Queries.
- Storing each record as either an **activity** (start + end) or an **event**
  (single timestamp) in the time-pipeline store under the `timeline` namespace.
- Preserving the raw source payload alongside the normalized row so downstream
  skills and the practitioner can see exactly what came from where.
- Replacing previously-fetched data from a given source within the requested
  range when re-fetched, while preserving row identity so downstream
  annotations survive.

This skill does NOT handle:

- Choosing an "activity type" when sources overlap — both records are stored
  as parallel observations; reconciliation is classification's job.
- Filling quiet periods with "untracked" segments — that requires knowing
  business hours, which is interpretive.
- Inferring activities from clusters of events (e.g., ten file saves over
  forty minutes implying a long screen-work session) — that is classification.
- Assigning activities to matters, projects, or categories.
- Displaying the full day as a unified table — display is limited to 60-minute
  windows on explicit request.

## Core primitives

Two entity types, modelled separately because they behave differently:

- **Activity** — an observation with a start and end time. Examples: a TimeCamp
  screen session, a Telus phone call, a Google Calendar event. Activities have
  duration and can overlap with other activities.
- **Event** — an observation at a single instant. Examples: a file download, an
  email send, a Git commit. Events have no duration and cannot overlap in a
  meaningful sense.

Events are kept as a distinct entity rather than as zero-duration activities
because summing durations across a mixed set of rows produces misleading math,
and because events are primarily enrichment signals for activity classification
downstream, not timeline segments in their own right.

## Data model

All data lives in the `timeline` namespace of the time-pipeline store (``time-pipeline-data``).

### Row identity

Each activity or event row has a deterministic ID derived from its source and
the source's native record identifier:

- **Format:** `{source}:{native_id}`
- **Examples:**
  - `timecamp:a48291` — TimeCamp activity with internal id 48291
  - `telus:c2026-04-15T14:30+16045551234` — Telus call record (composite key
    from normalized timestamp + E.164 phone number; the real export has no
    call-id column — see `reference/TelusConnect.md`)
  - `gcal:{ical-uid}` — Google Calendar event by its iCal UID
  - `icloud:{uid}_{YYYY-MM-DD}` — iCloud calendar event by its iCalendar UID (`#2`, `#3` for further same-day occurrences)
    and local start date, since repeating occurrences share one UID (see
    `reference/ICloudCalendar.md`)
  - `sent_mail:{message-id}` — sent email, an event, by its RFC 5322
    Message-ID with the angle brackets stripped (see `reference/SentMail.md`)
  - `syncopaid:2026-04-15T16:02:00Z` — SyncoPaid activity block, keyed by its
    normalized UTC start instant
  - `download:{filename}:{mtime}` — file in Downloads folder (future source)

The source is responsible for producing a stable native_id. When a source
provides no stable identifier, compose one from immutable fields (timestamp +
phone number, filename + modification time, etc.). Never use a random or
time-of-fetch component — that would break re-fetch idempotency.

Where the immutable fields are freeform text that can't be embedded literally
in an id — long, or containing the `:` separator — hash the composite instead
(e.g. `chrometa:{sha1-16}`), documenting the exact pre-hash string in the
source's reference file so it stays reproducible. A fixed-width structured
field that merely contains `:` — a timestamp — needs no hashing; ids are
split on the first `:` only, as the Telus and SyncoPaid examples above show.
The hashing rule targets freeform text of unbounded length, not this case.

Stable IDs matter because downstream skills (classification, corrections,
time-entry drafting) store their own records keyed to these IDs. If the IDs
changed on every re-fetch, every downstream annotation would be orphaned.

> **Resolved 2026-08-28 (ticket #420):** a real Telus Business Connect CSV
> export was inspected — it has no call-id column, so the composite key above
> is the format. Exact fields, ordering, and normalization are documented in
> `reference/TelusConnect.md`.

### Key layout

| Key pattern | Value | Purpose |
|-------------|-------|---------|
| `source:{source}:fetched_at` | ISO 8601 UTC timestamp (trailing `Z`) | Last successful fetch for this source |
| `source:{source}:ranges` | JSON array of `[start, end]` UTC timestamps | Ranges of time this source has been fetched for |
| `activity:{id}` | JSON activity row | A single activity observation |
| `event:{id}` | JSON event row | A single event observation |
| `index:activity:by-date:{YYYY-MM-DD}` | JSON array of activity ids | Activities whose interval overlaps this **local** date (local-date indexing matches how the practitioner thinks; mapping to UTC happens at query time) |
| `index:event:by-date:{YYYY-MM-DD}` | JSON array of event ids | Events whose timestamp falls on this **local** date |
| `index:activity:by-source:{source}` | JSON array of activity ids | All activities from a given source |
| `index:event:by-source:{source}` | JSON array of event ids | All events from a given source |

The time-pipeline store is a key-value store, so relational queries (e.g., "all activities
overlapping this hour") are computed in Python at read time by loading the
relevant by-date indexes and filtering. At daily granularity the row counts
are small enough that this is cheap.

### Reference data is not stored here

TimeCamp also exposes a Projects/Tasks tree — a taxonomy used by classification
to resolve TimeCamp `task_id` foreign keys on activity records. That tree is
**reference data**, not timeline data: it has no temporal dimension, is
refreshed on a different cadence, and exists solely to support interpretation.

Build-timeline stores each activity's `task_id` verbatim inside `raw_payload`
and never resolves it. The tree itself lives in the `timesort` namespace,
fetched and maintained by the time-sorting skill. This is a deliberate
ownership rule: the timeline namespace holds observations in time; reference
data belongs wherever it is consumed.

The same rule covers any source's foreign key into its own taxonomy:
SyncoPaid's `matterId` / `matterDisplay` are stored verbatim in `raw_payload`
and never resolved, matched, or acted on.

### Activity row schema

```json
{
  "id": "timecamp:a48291",
  "source": "timecamp",
  "native_id": "a48291",
  "start_ts": "2026-04-15T16:02:00Z",
  "end_ts": "2026-04-15T16:47:00Z",
  "raw_type": "screen_work",
  "raw_payload": {
    "application": "LEAP",
    "window_title": "Smith v Jones (L8948) - Settlement Memo",
    "task_id": "0"
  },
  "fetched_at": "2026-04-16T02:30:00Z"
}
```

- `start_ts` / `end_ts` — always ISO 8601 in **UTC** (trailing `Z`). Storage
  is in UTC so that timestamps are unambiguous and independent of local
  offset changes (DST, travel). Display and user input use the practitioner's
  local timezone, read from `probanda.json` → `time_tracking.timezone`
  (default `"America/Vancouver"` if unset) — converted to UTC before storage
  and back to local for display.
- `raw_type` — the source's native classification, kept as-is, or `null` when
  the source does not provide one. TimeCamp → `"screen_work"`. Telus →
  `"phone_call"`, `"voicemail"`, `"text"` (Telus exposes a subtype
  directly). GCal → `null`; Google Calendar has no native type taxonomy for
  our purposes, so we pass through GCal's raw fields inside `raw_payload` and
  leave classification to derive a type from them. iCloud → `null`, as for
  GCal. Sent mail → `"email_sent"`, a fixed constant (`reference/SentMail.md`).
  Never infer `raw_type`
  from content that isn't a structured source field (e.g., a title string);
  that is interpretation and belongs to classification.
- `raw_payload` — the source's native fields, kept verbatim so downstream
  skills and humans can see exactly what was observed.
- `fetched_at` — when this row was most recently written. Overwritten on
  re-fetch.

### Event row schema

```json
{
  "id": "download:Settlement-Memo.docx:1713193820",
  "source": "download",
  "native_id": "Settlement-Memo.docx:1713193820",
  "ts": "2026-04-15T20:43:40Z",
  "raw_type": "file_download",
  "raw_payload": {
    "filename": "Settlement-Memo.docx",
    "path": "C:/Users/Brahm/Downloads/Settlement-Memo.docx",
    "size_bytes": 48213
  },
  "fetched_at": "2026-04-16T02:30:00Z"
}
```

- `ts` — a single ISO 8601 instant in UTC (same rule as `start_ts` / `end_ts`
  on activity rows). Events have no duration, so there is no corresponding
  end field.
- `source`, `native_id`, `raw_type`, `raw_payload`, `fetched_at` — same
  semantics as on the activity row schema above.

## Workflow

### Step 0: First-run setup

Read the time-tracking registry: `time_tracking` in the machine-level
`probanda.json` (location and No-registry rule:
`time-sorting/protocols/FirstSetup.md`). If `time_tracking.sources` is absent
or empty, stop and run that protocol first; never proceed without a
registry. On subsequent runs this check passes through immediately.

### Step 1: Resolve target range

Default target is today in the practitioner's local timezone. Accepted user
inputs: a single date ("build timeline for 2026-04-15"), a relative date
("yesterday", "today"), a range ("build timeline for this week"), or a list of
dates, such as one matter's triage dates, each run once and nothing between them.
Interpret the input in local time (from `probanda.json` → `time_tracking.timezone`,
default `"America/Vancouver"` if unset),
then convert to UTC for the concrete `[start_ts, end_ts]` pair used
downstream. For example, "2026-04-15 in Vancouver" becomes the UTC range
`[2026-04-15T07:00:00Z, 2026-04-16T07:00:00Z)` during PDT.

### Step 2: Iterate over enabled sources

For each source in `probanda.json` → `time_tracking.sources` where `enabled` is
true, perform the source-specific fetch per `source.reference` — the reference
file path already recorded on the registry entry (see `time-sorting/protocols/FirstSetup.md`
for the entry schema). No name→file mapping is maintained here; adding a
source means adding a registry entry and a reference file, nothing else.

A failed source must never block other sources. Record the failure and
continue. Surface all failures to the practitioner in the final summary — do
not silently omit data.

### Step 3: Normalize each raw record

For each raw record returned by a source:

1. Decide whether it is an **activity** (has meaningful start + end) or an
   **event** (single timestamp only).
2. Compute the row ID: `{source}:{native_id}`. Refer to the source's reference
   file for how `native_id` is derived.
3. Build the row per the activity/event schemas above.
4. Do not make classification decisions. Do not collapse overlaps. Do not
   drop records because they overlap with another source. Each source's
   records are stored independently.

### Step 4: Replace-by-source within range

A date's replacement is **one `/time-pipeline-data` bulk apply**, covering every
source fetched for that date. Never delete rows one at a time. For a range, do this
once per date. For each source fetched:

1. Load `index:activity:by-source:{source}` and `index:event:by-source:{source}`.
2. For each id, load the row and check whether its timestamp (for events) or
   interval (for activities) falls within the date. Activities that
   overlap the date — even partially — are considered in-range.
3. Add to the date's JSONL file, in this order: a `delete` line for every in-range
   row (`activity:{id}` or `event:{id}`); a `set` line for every freshly-fetched
   row; a `set` line for each by-source index with its in-range ids removed and
   the fresh ids added; and for each by-date index the source touches, a `merge`
   line with `drop_prefix` `{source}:` and `add` the ids that index should hold
   from this source.

Then apply the file once.

The practical effect: re-fetching Telus for 2026-04-15 wipes only Telus rows
in that date; TimeCamp and GCal rows for the same day are untouched.

Note on stable IDs: because IDs are derived from source + native_id, a row
that existed before and still exists now gets the same ID both times. Any
downstream classification or correction record keyed to that ID continues to
point to valid data.

**Scaling note:** Step 4.2 scans every id in `index:activity:by-source:{source}`
to find the in-range rows, which is O(all rows from that source) on each
fetch. At daily/weekly scale with a single-user practice this is cheap, but
row counts will grow unbounded over months. When a fetch starts taking more
than a second or two, add a sharded index like
`index:activity:by-source-and-date:{source}:{YYYY-MM-DD}` so replace-by-source
can load only the dates touched by the requested range.

### Step 5: Update source metadata

After a successful fetch:

- Set `source:{source}:fetched_at` to now.
- Update `source:{source}:ranges` by taking the union of the existing stored
  ranges with the newly-fetched range, then normalizing. Normalization: sort
  ranges by start_ts; merge any two ranges where the earlier's end_ts is
  greater than or equal to the later's start_ts (touching or overlapping
  intervals collapse into one). The result is a minimal, non-overlapping,
  sorted list of `[start_ts, end_ts]` pairs expressing exactly which instants
  this source has been fetched for.

If the fetch failed — or was skipped because a source's own live access gate
is off — leave both keys untouched.

### Step 6: Report

Print a one-line summary per source plus an overall total:

```
TimeCamp:  47 activities fetched for 2026-04-15 (18 new, 29 replaced)
Telus:     3 activities fetched for 2026-04-15 (3 new, 0 replaced)
GCal:      4 activities fetched for 2026-04-15 (4 new, 0 replaced)
Downloads: 12 events fetched for 2026-04-15 (12 new, 0 replaced)

Total: 54 activities, 12 events stored in timeline.
```

If any source failed, list the failures explicitly:

```
Telus: failed — call archive folder not found
```

If a source was skipped because its own live access gate is off, or because no
archive covers the date — an expected state, not an error — give it its own
line, distinct from a failure, and omit it from the counts block above (a
skipped source has no counts, and appearing there as `0 activities` would read
as "checked, found nothing" rather than "never checked"):

```
SyncoPaid: skipped — evidence access disabled (lawyer opt-in off)
Telus: skipped — no archive covers 2026-09-15
```

Step 2 iterates only enabled sources, so take the registry's `enabled: false`
entries from the Step 0 read and give each the same kind of line:

```
GCal: skipped — disabled in the time-tracking registry
```

Do not present the fetched rows as a table unless the practitioner asks. See
Queries below.

## Queries

| Question | How to answer |
|----------|---------------|
| Build today's timeline | Full workflow for today. |
| Build the timeline for 2026-04-15 | Full workflow with target=2026-04-15. |
| Re-import the call archive for {date} | Run Telus source only, target={date}. Replaces only Telus rows in that range. |
| Fetch only {sources} for {date} | Run Step 2 for the named registry entries only, target={date}. Each must still be `enabled: true` and qualified per its own reference. Replace-by-source (Step 4) and the metadata update (Step 5) touch only those sources. The report lists only them, and names every other registry source as not fetched this run, not as skipped. The call archive re-import row above is this row with Telus. |
| Import Chrometa historical logs | Run the Chrometa import per `reference/Chrometa.md` against `C:\Users\Brahm\Sync\ADMIN\TIME TRACKING\Chrometa Time Records\Consolidated Time Summaries.xlsx`, scoped to the full 2019-01–2020-03 range. |
| What sources are fetched for {date}? | Read `source:{source}:ranges` for each registry entry, plus Chrometa; report which cover {date}. |
| Show me the raw timeline for {window} | Require a window ≤ 60 minutes. Load `index:activity:by-date:{date}` and `index:event:by-date:{date}`, filter to the window, sort by start_ts/ts, present as a table with columns: Time, Duration (activities only), Source, Raw Type, Key Fields. |
| When was {source} last fetched? | ``time-pipeline-data`` `get` — `namespace: "timeline"`, `key: "source:{source}:fetched_at"` |

## Display rules

The practitioner can ask to inspect the raw timeline, but:

- The window must be **≤ 60 minutes**. If a larger window is requested, ask
  the practitioner to narrow it — full-day dumps are what downstream skills
  are for, not this one.
- The Time column is rendered in the practitioner's local timezone (from
  `probanda.json` → `time_tracking.timezone`, default `"America/Vancouver"` if
  unset), even though rows are stored in
  UTC. Conversion happens at render time only.
- Overlapping activities are shown as separate rows, sorted by start time.
  When an activity's start falls inside another activity already printed,
  prefix its row with `↳ ` (U+21B3) to make the overlap visible at a glance.
  Do not collapse overlapping rows.
- Events are interleaved with activities by timestamp (events have no
  Duration value; the column reads `—`).
- Show `raw_type` and the most useful raw_payload fields (e.g., window title
  for TimeCamp, phone number for Telus, event title for GCal and iCloud, `processName`
  for SyncoPaid). Do not show a `task`, `matter`, or `category` column — those
  are classification concerns and this skill does not produce them. This
  holds even when a source's payload carries a matter field of its own
  (SyncoPaid's `matterId` / `matterDisplay`): stored, never displayed as a
  column.

## Integration with other skills

| Skill | How it integrates |
|-------|-------------------|
| **time-sorting** | Consumes `activity:*` and `event:*` rows via the by-date indexes. Handles reconciliation, gap-filling, and task assignment. Writes its results under a separate namespace. |
| **retainer-tracking** | Independent — build-timeline does not need the matter list. Classification does. |
| **time-entry-drafting** | Reads the classified day from time-sorting, not from build-timeline directly. |

## Critical constraints

- **Read-only sources.** Never write back to TimeCamp, Google Calendar, the iCloud
  calendar, Telus, SyncoPaid, or any other source. This includes never changing a source's own
  access state: build-timeline reads SyncoPaid's `evidence status` but never
  calls `evidence enable` — that is the practitioner's act alone. This skill
  is strictly downstream of those systems.
- **TimeCamp only through its connector.** TimeCamp is read only through the
  `timecamp` connector's tools (`reference/TimeCamp.md`). If its `status`
  reports the API unusable, TimeCamp fails for the run with that reason, told
  to the practitioner. Never open the TimeCamp web app as a substitute.
- **No silent data loss.** Every source ends in exactly one of three loud
  outcomes: it succeeds (rows stored, indexes updated, metadata recorded), it
  fails (reported in the summary), or it is skipped because its own live
  access gate is off, no archive covers the date, or its registry entry is `enabled: false` (reported in
  the summary on its own line, metadata untouched). There is no middle state and no silent outcome.
- **No interpretation.** If there is a choice to make about what a period
  "really was," defer it. This skill's job is faithful recording.
