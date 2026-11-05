---
name: time-sorting
description: Classify raw timeline activities (built by build-timeline) into client matters and admin categories using the source-reliability hierarchy (phone logs outrank screen tracking outrank calendar). Owns the sorted/unsorted state of each day. Use for 'sort today's time', 'sort time for [date]', 're-sort [date]'. Does not fetch raw data (build-timeline) or draft entries (time-entry-drafting).
dependencies:
  - time-pipeline-data # `timeline` namespace (input) and `timesort` namespace (output)
  - practice-data      # matter list (matter numbers + client names) for task assignment
---

<!-- timekeeper v0.8.0 -->
> **Installed copy.** This skill's full source tree ships beside this file, and a relative path in the text below cites that tree. Resolve one by trying, in order: the directory of the file you are reading, then `${CLAUDE_SKILL_DIR}/<path>`, then `${CLAUDE_SKILL_DIR}/../<path>` (so `shared/x.md` is at `${CLAUDE_SKILL_DIR}/../shared/x.md`). The host substitutes `${CLAUDE_SKILL_DIR}` with the directory holding this SKILL.md when this file loads; if the literal text `${CLAUDE_SKILL_DIR}` is what you see, that IS the definition: it means the directory containing this SKILL.md, not a placeholder to search for or guess. Read references and shared files natively from there, never over the litigation data server's skill-source tool and never by requesting folder access; scripts and templates the text declares are executed and read from there too. Before each fresh read (a file not already in context), list only `${CLAUDE_SKILL_DIR}/../../..` (the folder holding this plugin's folder). If it holds this plugin's folder name, with any `~g<N>` suffix removed, plus a `~g<N>` higher than this plugin's folder's own (none counts as 0), or if `${CLAUDE_SKILL_DIR}` no longer exists, the plugin was re-synced mid-session: take the highest `~g<N>` copy and repeat the same three tries with its `skills/<this skill>` directory in place of `${CLAUDE_SKILL_DIR}`; tell the user once that the plugin updated mid-session, from the version in this file's version comment to the version in that folder's copy of this SKILL.md. If a file the text names is missing at every one of those paths, including the re-synced folder's, STOP and report the exact path and error to the user rather than substituting an alternative: do not re-derive a script's logic from its source text or the prose, and do not search elsewhere on the filesystem. Ask the user to reinstall the plugin and fully restart the app; this may fix it, but STOP means stop regardless: do not diagnose further yourself.
> **HTML pages.** Every HTML file this plugin writes is a human interface generated from its databases; an agent never views, reads, greps, parses, scripts over, authors or requests a screenshot of one, but may present one to a human user to view, staging it first where presenting needs that, and may view a screenshot the user provides on their own initiative. The rule and the data to use instead: `shared/html-pages.md`.

## Contents

| Section | Read when |
|---|---|
| Quick Navigation | To jump to a step or section by link |
| Overview | Always: purpose, the reconcile-first principle, and the critical constraints |
| Configuration | Reading source-specific signals during reconciliation or task assignment |
| Data Model | Reading or writing `timeline` or `timesort` keys, day objects, corrections or sort metadata |
| Workflow | Sorting a date, Steps 0 to 8 |
| User Corrections | The practitioner corrects an activity after presentation |
| Coverage Query | Asked whether a date range is sorted and clears the unassigned-hours threshold |
| Queries | Answering a question about sorted time or the last sort |
| Integration with Other Skills | Before handing work to or from build-timeline, practice-data or the downstream time skills |

This skill deliberately carries no `disable-model-invocation` line: `/timecamping` opens it for the TimeCamp task-tree sync
through the Skill tool, which refuses a skill carrying that line. It is a stated
exception. Do not add the line back.

## Quick Navigation

**Jump to any major section:**

- [Workflow Overview](#workflow)
  - [Step 0: Check timeline data](#step-0-check-timeline-data)
  - [Step 1: Sync TimeCamp Project/Task Tree](#step-1-sync-timecamp-projecttask-tree)
  - [Step 2: Load Activities from Timeline](#step-2-load-activities-from-timeline)
  - [Step 3: Reconcile Overlapping Sources](#step-3-reconcile-overlapping-sources)
  - [Step 4: Fill Gaps](#step-4-fill-gaps)
  - [Step 5: Assign Activities to Tasks](#step-5-assign-activities-to-tasks)
  - [Step 6: Replay Corrections](#step-6-replay-corrections)
  - [Step 7: Store Results](#step-7-store-results)
  - [Step 8: Present Results](#step-8-present-results)
- [Data Model](#data-model)
- [Queries & Integration](#queries)
- [User Corrections](#user-corrections)

# Time-Sorting

Classify raw activities from the timeline into TimeCamp Projects and Tasks, representing client matters and non-billable administrative categories.

## Overview

This skill takes the raw, source-attributed chronology assembled by `build-timeline` and interprets it: reconciling overlapping sources, filling untracked gaps during business hours, assigning each period to a known TimeCamp Task or admin category, and storing the classified day under the `timesort` namespace.

**Why:** This creates an audit trail for billing and accountability, ensures no client data leaves the practitioner's machine, and handles real-world complexity where a single time period might be documented in multiple sources.

**Prerequisite:** Before sorting, the `timeline` namespace must contain activity data for the target date, loaded by `build-timeline`. If the timeline is empty or stale, tell the practitioner: "No timeline data found for {date}. Run ``build-timeline`` for that date first."

### Core Principle: Reconcile First, Hierarchy as Tiebreaker

When sources provide conflicting signals, **first attempt to reconcile** — use context from all sources to find a consistent interpretation. Only fall back to the source reliability hierarchy (Telus → SyncoPaid → TimeCamp → Chrometa → iCloud calendar → Google Calendar) when signals genuinely conflict and cannot be resolved.

**Reliability order (for unresolvable conflicts only):**
1. Telus Business Connect — most reliable for activity type (phone calls, voicemail, texts)
2. SyncoPaid (screen-activity blocks) — window titles plus click and keystroke counts
3. TimeCamp (computer activities) — highest volume
4. Chrometa (historical screen activity, 2019-01 to 2020-03 only)
5. iCloud calendar (meetings/court) — the master calendar; outranks Google Calendar
6. Google Calendar (meetings/court) — least reliable

All sources contribute context for task assignment regardless of hierarchy.

### Critical Constraints

- **Read-only on timeline:** Never modify `timeline` namespace data. This skill reads from `timeline` and writes only to `timesort`.
- **Classify before assigning:** Complete overlap reconciliation and gap-fill before assigning any activity.
- **Source attribution:** Every assigned activity traces back to the raw data that produced the assignment.
- **Surface failures:** Report any data gaps or anomalies explicitly; never silently omit periods.

## Configuration

Source-specific reconciliation and assignment context:

- **TimeCamp activities:** `raw_payload.application` and `raw_payload.window_title` are the primary signals. `raw_payload.task_id` is respected if non-zero (pre-assigned in TimeCamp).
- **SyncoPaid:** `raw_payload.processName` and `raw_payload.windowTitles` are the primary signals. `raw_payload.distinctWindowTitleCount` shows when `windowTitles` was capped at 10. `raw_payload.matterId` / `raw_payload.matterDisplay` are SyncoPaid's own machine inference, not a practitioner's assignment: when non-null they count as an assignment signal, but on their own they never support more than `confidence: "medium"` (see assignment rule 7).
- **Google Calendar:** Event title and description are signals. GCal has no native `raw_type` — derive activity type during classification from event title keywords.
- **iCloud calendar:** Event title and location are signals. `raw_payload.allDay` and `raw_payload.busy` are preserved in `raw_payload`. iCloud has no native `raw_type` — derive activity type during classification from event title keywords, as for Google Calendar.
- **Telus Connect:** `raw_payload.phone_number`, `raw_payload.direction`, `raw_payload.contact_name`. `raw_type` is already set (`phone_call`, `voicemail`, `text`).

## Data Model

### Namespaces

- **Input:** `timeline` namespace — `activity:{id}`, `event:{id}`, index keys. Read-only.
- **Output:** `timesort` namespace — classified day objects, project tree, corrections, metadata.

### Key Schema (timesort namespace)

| Key pattern | Value | Purpose |
|------------|-------|---------|
| `projects:tree` | JSON tree of TimeCamp Projects/Tasks | Task assignment lookup |
| `projects:lookup` | JSON map of `task_id` → {name, parent_id, level, billable} | Fast task matching |
| `projects:synced_at` | ISO timestamp | Staleness check for project tree |
| `day:{YYYY-MM-DD}` | Day JSON object | Classified timeline for a single day |
| `corrections:{YYYY-MM-DD}` | JSON array of correction objects | User edits that survive re-sorts |
| `sort:latest` | Sort metadata JSON | Last sort summary |

Note: the project tree is synced through the timekeeper plugin's `timecamp` connector, which holds the TimeCamp API token itself (Step 1).

### Day Object Schema

```json
{
  "date": "YYYY-MM-DD",
  "sorted_at": "ISO 8601 timestamp",
  "sources_present": ["timecamp", "gcal"],
  "sources_absent": ["telus"],
  "activities": [
    {
      "id": "a1",
      "timeline_ids": ["timecamp:a48291"],
      "start": "HH:MM",
      "end": "HH:MM",
      "activity_type": "screen_work | phone_call | meeting | court | untracked",
      "activity_source": "telus | syncopaid | timecamp | chrometa | gcal | icloud | none",
      "task_id": "TimeCamp task_id or null",
      "task_name": "Smith v Jones (L8948) or null",
      "project_name": "Client Matters or null",
      "matter": "L8948 or null",
      "category": "admin | billing | training | professional_development | business_development | tech_troubleshooting | onboarding | bookkeeping | null",
      "confidence": "high | medium | low",
      "attribution": {
        "activity_from": "source that determined activity type",
        "assigned_from": "source/signal that determined task assignment",
        "signals": ["list of raw signals used"]
      }
    }
  ],
  "summary": {
    "total_hours": 8.2,
    "assigned_hours": 7.5,
    "unassigned_hours": 0.7,
    "by_matter": {"L8948": 3.2},
    "by_category": {"admin": 1.5}
  }
}
```

`timeline_ids` — one or more `activity:{id}` or `event:{id}` keys from the `timeline` namespace that contributed to this classified activity. Preserves traceability back to raw source data.

An activity is **assigned** if it has either a non-null `task_id` or a non-null `category`. Activities with both null are **unassigned**.

Activities use source-native granularity — no rounding to billing increments. The time-entry-drafting skill handles rounding downstream.

### Correction Object Schema

```json
{
  "activity_id": "a2",
  "field": "task_id | category",
  "old_value": "12345",
  "new_value": "67890",
  "corrected_at": "ISO 8601 timestamp"
}
```

### Sort Metadata Schema

```json
{
  "date": "YYYY-MM-DD",
  "sorted_at": "ISO 8601 timestamp",
  "sources": ["timecamp", "gcal"],
  "activities": 14,
  "assigned": 12,
  "unassigned": 2
}
```

## Workflow

### Step 0: Check Timeline Data

Read the time-tracking registry: `time_tracking` in the machine-level `probanda.json` (location and No-registry rule: `protocols/FirstSetup.md`). If `time_tracking.sources` is absent or empty, stop and run that protocol first; never proceed without a registry. After the protocol completes, continue from Step 1.

Check that build-timeline has populated data for the target date:

``time-pipeline-data`` `get` — `namespace: "timeline"`, `key: "index:activity:by-date:{YYYY-MM-DD}"`

If the returned value is `null` or an empty array, tell the practitioner: "No timeline data found for {date}. Run ``build-timeline`` for that date first, then re-sort." Do not proceed.

Note which sources are present by checking `source:{source}:ranges` in the `timeline` namespace for each known source (telus, syncopaid, timecamp, chrometa, gcal, icloud, sent_mail). Report absent sources to the practitioner before sorting (they affect completeness, not correctness).

### Step 1: Sync TimeCamp Project/Task Tree

Before assigning activities, ensure the project tree is loaded. Check:

``time-pipeline-data`` `get` — `namespace: "timesort"`, `key: "projects:synced_at"`

If found and fresh, also `get` `projects:lookup` and check one entry for `parent_id` (the shape trigger under **When to sync** below). If not found, stale (> 24 hours), or in the old shape, sync the tree through the `timecamp` connector, calling each tool under whichever of `mcp__plugin_timekeeper_timecamp__<name>` and `mcp__remote-devices__plugin_timekeeper_timecamp__<name>` this host grants. Call its `status` first: if it reports the API unusable, stop and tell the practitioner its reason. Never open the TimeCamp web app as a substitute. Then call its `tasks` with no `query` to fetch every active Project and Task.

The connector keeps the mandatory trailing slash on `/tasks/`. Confirmed live 2026-09-24 (#940): HTTP 200, 487 entries (Projects and Tasks together).

`tasks` returns a **flat list** of entries, not a nested tree, each as TimeCamp gives it plus a `path`. Fields observed on every entry include `task_id` (int), `parent_id` (int, `0` for a top-level Project), `name`, `level` (int, `1` = top-level Project), `billable` (int `0`/`1`) and `archived` (int `0`/`1`). `hasChildren` (bool) appears only on some entries, so do not rely on it. The connector already drops entries with `archived: 1`, matching the active-only filter the sync always applied. Leave out the connector's `path` and build the tree yourself: `projects:tree` is a JSON array of the top-level entries (`parent_id` 0), each entry stored as returned plus a `children` array holding its child entries in the same form, recursively. Walk it to get all Tasks.

Store the tree in the `timesort` namespace:

``time-pipeline-data`` `set` — `namespace: "timesort"`, `key: "projects:tree"`, `value: '{json_tree}'`
``time-pipeline-data`` `set` — `namespace: "timesort"`, `key: "projects:synced_at"`, `value: '{ISO_timestamp}'`

Also build a flat lookup for quick matching, mapping each `task_id` to that entry's `{name, parent_id, level, billable}` and nothing more. Store `parent_id` as an int, as the API returns it (`0` for a top-level Project), and copy no other field (such as `color`) into the lookup:

``time-pipeline-data`` `set` — `namespace: "timesort"`, `key: "projects:lookup"`, `value: '{task_id_to_name_map}'`

**When to sync:**
- On first run (no `projects:tree` key exists)
- When the practitioner asks to refresh the project list
- When an activity's window title mentions a matter not in the current tree
- When a stored `projects:lookup` or `projects:tree` entry has no `parent_id`. A store keyed on `parentId` (a string, with `color`) is the pre-#940 shape. This re-sync counts as the session's one sync. Tell the practitioner: "The stored TimeCamp project tree was in the pre-#940 shape (`parentId`, not `parent_id`). Re-syncing it now."
- At most once per session to avoid API rate limits

If the token is absent, skip the sync and proceed — task assignment will rely on the practice matter list only. Tell the practitioner: "TimeCamp token not configured in timeline namespace. Project tree not synced — task IDs will not be resolved."

### Step 2: Load Activities from Timeline

Load all activity IDs for the target date from the `timeline` namespace:

``time-pipeline-data`` `get` — `namespace: "timeline"`, `key: "index:activity:by-date:{YYYY-MM-DD}"`

For each ID in the array, fetch the full activity row:

``time-pipeline-data`` `get` — `namespace: "timeline"`, `key: "activity:{id}"`

Build a working list of activity rows sorted by `start_ts`. Convert UTC timestamps to local time (from `probanda.json` → `time_tracking.timezone`, default `"America/Vancouver"`) for display and gap-fill calculations. Work in local time for business-hours logic; store results in local `HH:MM` strings in the day object.

Also load events for context signals:

``time-pipeline-data`` `get` — `namespace: "timeline"`, `key: "index:event:by-date:{YYYY-MM-DD}"`

Events do not become classified activities — they are enrichment signals for task assignment only.

### Step 3: Reconcile Overlapping Sources

Build-timeline may store parallel observations from multiple sources for the same time period (e.g., a TimeCamp screen session and a Google Calendar event both covering 14:00–14:30). Reconcile these before assigning.

#### Overlap Detection

Two activities overlap if one's `start_ts` falls before the other's `end_ts` AND one's `end_ts` falls after the other's `start_ts`.

#### Reconciliation Procedure

For each overlapping group:

1. **Attempt reconciliation** — look for a consistent interpretation using context from all overlapping sources. Example: a GCal event titled "Smith hearing" + TimeCamp showing LEAP open to the Smith file → consistent. Use both as signals; keep the row from the highest-ranked source present (Telus, then SyncoPaid, then TimeCamp) as the primary (more reliable for duration).

2. **Apply source hierarchy only when signals genuinely conflict** — Telus → SyncoPaid → TimeCamp → Chrometa → iCloud → GCal. Where the two calendars conflict with each other, iCloud wins. The source that "wins" determines `activity_type` and `activity_source`. The losing source's signals go into `attribution.signals` for task assignment.

3. **Telus during TimeCamp:** If irreconcilable: the Telus activity replaces the overlapping portion of the TimeCamp activity. Split the TimeCamp activity into up to three segments:
   - Pre-Telus segment (TimeCamp, before Telus start)
   - Telus segment (Telus — keep TimeCamp window titles during this period as attribution signals)
   - Post-Telus segment (TimeCamp, after Telus end)
   Drop any resulting segment shorter than 1 minute.

4. **Telus during GCal or iCloud:** If irreconcilable: Telus takes precedence for activity type. Calendar event context preserved as attribution signal.

5. **GCal or iCloud during TimeCamp (no Telus):** If irreconcilable: TimeCamp takes precedence.

6. **SyncoPaid during TimeCamp (no Telus):** If irreconcilable: SyncoPaid replaces the overlapping portion of the TimeCamp activity, splitting it into pre-, during- and post-SyncoPaid segments exactly as rule 3 does for Telus. TimeCamp window titles for the overlapping period are kept as attribution signals.

`activity_source` is always set to the source that determined the **activity type** for that segment. Context from other sources goes into `attribution.signals`.

Populate `timeline_ids` with all source IDs that contributed to each reconciled activity.

### Step 4: Fill Gaps

After reconciliation, scan the period 07:00–19:00 in local time. Any continuous gap of 1 minute or more with no activity from any source becomes an activity with:
- `activity_type: "untracked"`
- `activity_source: "none"`
- `task_id: null`, `category: null`
- `confidence` omitted (not applicable)

These "untracked" periods represent time the practitioner was working but not captured by any connected source. They are kept in the day object so the practitioner can review and assign them manually if needed.

### Step 5: Assign Activities to Tasks

For each reconciled activity (including untracked periods), determine the TimeCamp Task it belongs to — either a client matter Task or a non-billable category Task.

#### Load Assignment Targets

Two sources provide the set of valid assignment targets:

1. **TimeCamp Project/Task tree** (from Step 1) — the authoritative list of Tasks
2. **Practice matter list** (via ``practice-data``) — provides matter numbers and client names that map to TimeCamp Tasks

Fetch the matter list from ``practice-data`` `trust-summary` (all matters). Each returned row provides the matter number (`matt_num`), file number, and client name.

Build a combined lookup: matter numbers → TimeCamp Task IDs + client names. Where a matter number appears in both the TimeCamp tree and the practice matter list, use the TimeCamp `task_id` as the canonical reference.

#### Assignment Rules

For each activity, analyze the attribution signals:

1. **Window title matching** — Look for matter numbers (e.g. "L8948"), client names (e.g. "Smith"), or matter descriptions in window titles. LEAP windows typically contain the client/matter name.

2. **Application context** — LEAP indicates client work. Gmail/Outlook likely admin unless the subject line indicates a specific matter. Chrome depends on the URL/page title.

3. **Phone call context** — For Telus activities, check SyncoPaid and TimeCamp window titles in `attribution.signals` for the same period. If the practitioner had a client file open during the call, assign to that matter's Task with `confidence: "medium"`.

4. **Calendar context** — GCal and iCloud event titles often name the matter, client, or court proceeding.

5. **Non-billable assignment** — If signals clearly indicate non-client work, assign a category from this fixed enum (these correspond to non-billable Tasks in TimeCamp):
   - `admin` — General administration, email triage, scheduling
   - `billing` — Invoice preparation, AR follow-up, accounting system work
   - `training` — CLE, legal education
   - `professional_development` — Non-CLE professional growth
   - `business_development` — Marketing, networking, client development
   - `tech_troubleshooting` — IT issues, software setup
   - `onboarding` — New client/matter intake
   - `bookkeeping` — Financial record-keeping

6. **Pre-assigned activities** — If a TimeCamp activity's `raw_payload.task_id` is non-zero, respect that assignment. Set `confidence: "high"` and `assigned_from: "timecamp_preassigned"`.

7. **SyncoPaid matter inference** — If a SyncoPaid activity's `raw_payload.matterId` or `raw_payload.matterDisplay` is non-null, treat it as a signal for that matter and set `assigned_from: "syncopaid_inferred"` when it decides the assignment. On its own it supports at most `confidence: "medium"`. Reach `high` only when an independent signal, such as a matter number in a window title, names the same matter.

#### Confidence Levels

- **high** — Unambiguous match: matter number in window title, LEAP window with exact client name matching a known Task, or pre-assigned in TimeCamp
- **medium** — Likely but uncertain: client name appears in a non-LEAP window, phone call while client file is open, or SyncoPaid's inferred matter with no independent confirmation
- **low** — Best guess: weak signals, multiple possible Tasks, or ambiguous context

#### Confidence Scoring Examples

**Example 1 (HIGH Confidence)**

Activity: Screen work in LEAP window titled "Smith v Jones (L8948) - Settlement Memo" (45 min)

Signals: Matter number L8948 in title + LEAP application + practice matter list confirmation

→ **Confidence: HIGH** — Explicit matter identification. No competing interpretation.

**Example 2 (MEDIUM Confidence)**

Activity: Incoming phone call at 13:45 (18 min). TimeCamp signal shows Chrome: "Client Portal - Doe v BC"

Signals: Telus confirms call type, TimeCamp signal shows Doe v BC context, but no caller ID name

→ **Confidence: MEDIUM** — Call type certain (Telus), task assignment relies on concurrent window. Could be unrelated call.

**Example 3 (LOW Confidence)**

Activity: Chrome window titled "Re: Update" (45 min). No other context.

Signals: Generic title could be email about any matter, client portal, research, or admin work

→ **Confidence: LOW** — Multiple possible interpretations. Practitioner must review manually.

#### Unassigned Activities

If an activity cannot be assigned to any known Task AND does not clearly fit a non-billable category, leave `task_id: null` and `category: null`. Do NOT invent Task IDs or guess. The practitioner resolves these during review.

### Step 6: Replay Corrections

Check for stored corrections from a previous sort of this date:

``time-pipeline-data`` `get` — `namespace: "timesort"`, `key: "corrections:{YYYY-MM-DD}"`

If corrections exist (the returned value is non-null), parse the JSON array. For each correction:
1. Find the activity with matching `activity_id` in the current assignment
2. If found, apply the correction: set `activity.{field}` to `new_value`
3. If the activity_id no longer exists (timeline was merged differently), silently skip — the practitioner will see the unmodified assignment and correct again if needed

Track how many corrections were re-applied vs. skipped for the summary.

### Step 7: Store Results

Build the Day object from the classified activities. Calculate the summary:
- `total_hours`: sum of all activity durations (end - start)
- `assigned_hours`: sum of durations for activities with non-null `task_id` or non-null `category`
- `unassigned_hours`: `total_hours - assigned_hours`
- `by_matter`: map of matter number → total hours
- `by_category`: map of category → total hours

Store the Day object:

``time-pipeline-data`` `set` — `namespace: "timesort"`, `key: "day:{YYYY-MM-DD}"`, `value: '{day_json}'`

Update sort metadata:

``time-pipeline-data`` `set` — `namespace: "timesort"`, `key: "sort:latest"`, `value: '{"date":"{YYYY-MM-DD}","sorted_at":"{ISO_NOW}","sources":[{sources_present}],"activities":{N},"assigned":{M},"unassigned":{U}}'`

### Idempotency

Re-running "sort time" for a date that already has assignments:
1. Re-reads from `timeline` namespace (may include new data if build-timeline was re-run)
2. Re-classifies from scratch
3. Replays stored corrections where activity IDs still match
4. Overwrites `day:{date}` with the new assignments
5. Reports what changed: "Re-sorted {date}: {N} activities classified, {M} corrections re-applied, {K} corrections skipped (activities changed)"

### Step 8: Present Results

After storing, present the classified timeline as a table:

```
Time         Duration  Type         Task/Category              Confidence  Source
09:02-09:47  0:45      Screen work  Smith v Jones (L8948)       High       TimeCamp
09:47-10:05  0:18      Phone call   Smith v Jones (L8948)       Medium     Telus + TimeCamp
10:05-10:30  0:25      Screen work  Admin                       High       TimeCamp
10:30-10:32  0:02      Untracked    — (unassigned)              —          —
...

Summary: 8.2h total | 7.5h assigned (91%) | 0.7h unassigned
By matter: Smith v Jones 3.2h, Doe v BC 2.1h
By category: Admin 1.5h, Billing 0.7h
```

If any sources were absent from the timeline, note them above the table:
"Note: Telus data not in timeline for this date — phone calls are not included."

If corrections were re-applied, note: "Re-applied {N} corrections from previous sort."

## User Corrections

The practitioner can correct any activity after presentation (equivalent to "moving" activities between Tasks in TimeCamp):
- "Change the 09:47 activity to the Doe file" → Update the activity's `task_id` and `task_name` to the Doe file's Task
- "That admin activity was actually billing" → Update the activity's `category` to `"billing"`, clear `task_id`/`task_name` if set
- "The 10:05 activity was for L4201" → Update the activity's `task_id`, `task_name`, and `matter`

When processing a correction:

1. Identify the activity by time or description
2. Validate the new value (if task, must exist in the project tree or the practice matter list; if category, must be in the fixed enum)
3. Update the activity in the Day object
4. Store the correction: first, get existing corrections (may not exist) with ``time-pipeline-data`` `get` — `namespace: "timesort"`, `key: "corrections:{YYYY-MM-DD}"`. Append the new correction to the array (or create new array), then ``time-pipeline-data`` `set` — `namespace: "timesort"`, `key: "corrections:{YYYY-MM-DD}"`, `value: '{updated_corrections_json}'`

5. Re-store the updated Day object:

``time-pipeline-data`` `set` — `namespace: "timesort"`, `key: "day:{YYYY-MM-DD}"`, `value: '{updated_day_json}'`

6. Update the sort metadata
7. Confirm: "Updated: {time} activity now assigned to {new_value}"

## Coverage Query

`coverage(date_from, date_to, max_unassigned_hours)` reports, for a date range, whether each day is sorted and whether its sort quality clears a threshold. No new storage: this is built entirely from the existing `day:{date}` objects.

For each date in the inclusive range `[date_from, date_to]`:

1. ``time-pipeline-data`` `get` — `namespace: "timesort"`, `key: "day:{date}"`
2. If the returned value is `null`, the day has never been sorted: `{date, sorted: false, unassigned_hours: null, meets_threshold: false}`.
3. Otherwise parse the JSON value and read `summary.unassigned_hours` (already on the Day object schema above): `{date, sorted: true, unassigned_hours, meets_threshold: unassigned_hours <= max_unassigned_hours}`.

**Default `max_unassigned_hours`: 0.5** (30 minutes/day) when the caller doesn't supply one. This is a provisional default, not a fixed rule: half an hour of untracked or ambiguous time per day is normal noise even after a careful sort, but more than that signals a day that needs practitioner attention before it's treated as billing-ready. Always state the threshold in use when presenting results ("using default 0.5h/day — say a different number to change it"), since a stricter or looser value may suit a given practitioner's workload.

A day with no `day:{date}` key reports `sorted: false` even when it was a non-working day (weekend, holiday, vacation) — coverage does not guess which days should have been worked. Present the per-day results as a table and let the practitioner read non-working days off it themselves.

## Queries

| Question | How to answer |
|----------|---------------|
| Sort today's time | Full workflow for today |
| Sort time for March 15 | Same workflow with `date=2026-03-15` |
| How much time on the Smith file this week? | ``time-pipeline-data`` `list` — `namespace: "timesort"`, `prefix: "day:"` for each date in the week → sum activities where `matter` matches |
| What's unassigned this week? | Same day list → filter activities where `task_id` is null AND `category` is null |
| When was the last sort? | ``time-pipeline-data`` `get` — `namespace: "timesort"`, `key: "sort:latest"` |
| Show the sorted day for April 10 | ``time-pipeline-data`` `get` — `namespace: "timesort"`, `key: "day:2026-04-10"` → present as table |
| Refresh the project list | Re-sync the TimeCamp project tree and update `projects:tree` in `timesort` namespace |
| Is every day between {date_from} and {date_to} sorted (coverage check)? | Run the Coverage Query above; present as a per-day table |

## Integration with Other Skills

| Skill | How it integrates |
|-------|-------------------|
| **build-timeline** | Prerequisite. Populates the `timeline` namespace that time-sorting reads. Run build-timeline first if timeline data is absent or stale. |
| **practice-data** | Provides the matter list (matter numbers + client names) via ``practice-data`` `trust-summary` — used alongside the TimeCamp project tree for task assignment |
| **time-entry-drafting** | Reads via ``time-pipeline-data`` `get` — `namespace: "timesort"`, `key: "day:{date}"` → rounds activities to billing increments → drafts LEAP time entries |
| **task-prioritization** | Uses assigned time to assess file activity levels |
| **matter-status-tracking** | Reads recent activities to determine last-activity dates |
