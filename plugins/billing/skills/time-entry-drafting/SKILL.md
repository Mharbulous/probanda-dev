---
name: time-entry-drafting
disable-model-invocation: true
description: Draft UTBMS-coded time entries from sorted time blocks (from time-sorting); approved entries commit to the practice database. Use for 'draft today's entries', 'draft entries for [date]', 'generate time entries', or reviewing/correcting draft entries. Does not sort time (time-sorting), read the raw timeline (build-timeline), or report WIP (wip-tracker).
dependencies:
  - time-pipeline-data # `timesort` namespace (input) and `tedraft` namespace (output)
  - practice-data  # time entries (approved entries), matters (matter lookup)
---

<!-- billing v0.5.3 -->
> **Installed copy.** This skill's full source tree ships beside this file, and a relative path in the text below cites that tree. Resolve one by trying, in order: the directory of the file you are reading, then `${CLAUDE_SKILL_DIR}/<path>`, then `${CLAUDE_SKILL_DIR}/../<path>` (so `shared/x.md` is at `${CLAUDE_SKILL_DIR}/../shared/x.md`). `${CLAUDE_SKILL_DIR}` is the directory holding this SKILL.md, even where it shows unsubstituted: never search for it or guess. Read references and shared files from there with the Read tool, a whole file or an offset and limit, never with a shell command, the litigation data server's skill-source tool or a folder-access request; scripts and templates the text declares are executed and read from there too. Before each fresh read (a file not already in context), list only `${CLAUDE_SKILL_DIR}/../../..` (the folder holding this plugin's folder). If it holds this plugin's folder name, with any `~g<N>` suffix removed, plus a `~g<N>` higher than this plugin's folder's own (none counts as 0), or if `${CLAUDE_SKILL_DIR}` no longer exists, the plugin was re-synced mid-session: take the highest `~g<N>` copy and repeat the same three tries with its `skills/<this skill>` directory in place of `${CLAUDE_SKILL_DIR}`; tell the user once that the plugin updated mid-session, from the version in this file's version comment to the version in that folder's copy of this SKILL.md. If a file the text names is missing at every one of those paths, including the re-synced folder's, STOP and report the exact path and error to the user rather than substituting an alternative: do not re-derive a script's logic from its source text or the prose, and do not search elsewhere on the filesystem. Ask the user to reinstall the plugin and fully restart the app; this may fix it, but STOP means stop regardless: do not diagnose further yourself.
> **HTML pages.** Every HTML file this plugin writes is a human interface generated from its databases; an agent never views, reads, greps, parses, scripts over, authors or requests a screenshot of one, but may present one to a human user to view, staging it first where presenting needs that, and may view a screenshot the user provides on their own initiative. The rule and the data to use instead: `shared/html-pages.md`.

## Contents

| Section | Read when |
|---|---|
| Pipeline Position | Always, to see where this skill sits and what it reads and writes |
| Design Principles | Always, and whenever a decision is in doubt |
| Data Model | Reading the sorted day, or handling draft entries, patterns or UTBMS metadata |
| Workflow | Drafting entries for a date, from loading the sorted day to committing approved entries |
| Queries | The practitioner asks to draft, show or re-draft entries, check a UTBMS code or change the billing increment |
| Integration | Checking how this skill relates to time-sorting, practice-data and the billing skills |

# Time Entry Drafting

Interpret classified time blocks from time-sorting and produce professional time entry descriptions with UTBMS litigation codes. This skill bridges the gap between "which matter was I working on?" (answered by time-sorting) and "what did I do for that matter?" (answered here).

## Pipeline Position

```
build-timeline → time-sorting → time-entry-drafting → invoice-tracking
(raw signals)    (matter assignment)  (descriptions + UTBMS)   (billing)
```

This skill reads from the `timesort` namespace and writes drafts to the `tedraft` namespace. Approved entries are committed as time entries through `/practice-data`.

## Design Principles

These four principles govern every decision in this skill. When in doubt, refer back here.

**Never fabricate from insufficient signals.** When the pattern database has no confident match for an activity block, surface the raw signals and ask the practitioner to describe what they were doing. A fabricated description on a client invoice is a professional conduct issue; an honest gap that prompts a quick practitioner input is a minor inconvenience.

**Learn from every correction.** Store practitioner corrections as new entries in the pattern database, linking the activity signals to the description the practitioner provided. Each correction is a labeled training example — the skill's value depends on accumulating these examples so the same correction is never needed twice.

**Description first, code second.** Generate the narrative description before assigning the UTBMS code. The description captures the specific meaning of the work; the UTBMS code categorizes that meaning. Starting with the code constrains the description to fit a predetermined category and produces generic, unhelpful entries.

**Structured descriptions follow legal billing conventions.** Produce descriptions using the standard legal billing pattern: verb phrase + subject + context. These descriptions may appear on client invoices — non-standard or casual phrasing looks unprofessional.

## Data Model

### Input: Time-Sorting Day Object

Read classified activities for the target date:

``time-pipeline-data`` `get` — `namespace: "timesort"`, `key: "day:{YYYY-MM-DD}"`

Each activity in the day object provides:
- `id`, `start`, `end` — identity and timing
- `matter` — matter number (e.g. "L8948") or null
- `task_name` — human-readable matter name or null
- `category` — admin category or null
- `activity_type` — screen_work, phone_call, meeting, court, untracked
- `confidence` — high, medium, low
- `attribution.signals` — raw signals (window titles, app names, phone numbers)

Activities with `matter` set are billable. Activities with `category` set are non-billable — they are still committed as non-billable entries when the activity also names a matter, and stay draft-only when it does not. Activities with both null are unassigned — flag for practitioner review.

### Output: tedraft Namespace

Draft state, UTBMS metadata, and the pattern database live in the time-pipeline store under the `tedraft` namespace. The practice-data skill owns the time entry's fields, so UTBMS enrichment data is stored separately here.

| Key pattern | Value | Purpose |
|-------------|-------|---------|
| `draft:{YYYY-MM-DD}` | JSON array of draft entries | Pending review |
| `utbms:{YYYY-MM-DD}:{entry_id}` | JSON `{task_code, activity_code}` | UTBMS codes for a committed entry |
| `pattern:{hash}` | JSON pattern object | Signal-to-description mapping |
| `patterns:index` | JSON array of pattern summaries | Fast pattern lookup |
| `config:billing_increment` | Number (default `0.1`) | Hours per billing unit |
| `config:minimum_entry` | Number (default `0.1`) | Minimum billable duration |

### Draft Entry Schema

```json
{
  "id": "d1",
  "matter": "L8948",
  "matter_name": "Smith v Jones",
  "category": null,
  "entry_date": "2026-04-14",
  "source_activities": ["a1", "a2", "a3"],
  "start": "09:02",
  "end": "10:15",
  "raw_hours": 1.22,
  "billed_hours": 1.3,
  "description": "Research law regarding quantum of non-pecuniary damages for ankle injury",
  "utbms_task": "L120",
  "utbms_activity": "A102",
  "description_source": "pattern_match | generated | insufficient",
  "status": "draft | approved | corrected | rejected"
}
```

When `description_source` is `"insufficient"`, the `description` field contains the raw signals instead of a narrative — the practitioner must provide the description.

### Pattern Object Schema

```json
{
  "hash": "sha256 of normalized signal fingerprint",
  "signal_fingerprint": {
    "applications": ["Microsoft Word"],
    "window_title_keywords": ["statement", "claim"],
    "activity_type": "screen_work",
    "matter_context": "litigation"
  },
  "description_template": "Drafting statement of claim",
  "utbms_task": "L120",
  "utbms_activity": "A103",
  "match_count": 5,
  "last_matched": "2026-04-14",
  "created_from_correction": true
}
```

### Schema Dependency

The practice database records a time entry's matter, date, hours, description, and whether it is billable. This skill needs UTBMS codes per entry but does not own the time entry's fields. UTBMS metadata is stored in `tedraft` namespace keys (`utbms:{date}:{entry_id}`) cross-referenced by the time entry `id` returned after insertion. If practice-data's time entries gain UTBMS fields in the future, this skill should migrate to writing them directly.

## Workflow

### Step 0: Load Sorted Day

Read the classified day from time-sorting:

``time-pipeline-data`` `get` — `namespace: "timesort"`, `key: "day:{YYYY-MM-DD}"`

If the returned value is `null`, tell the practitioner: "No sorted time found for {date}. Run time-sorting for that date first." Do not proceed.

Check the day's summary: if `unassigned_hours` exceeds 20% of `total_hours`, warn the practitioner before proceeding: "{N} hours are unassigned in time-sorting. Draft entries for those periods will be incomplete — consider re-sorting first."

### Step 1: Aggregate Into Billable Blocks

Group consecutive or near-consecutive activities for the same matter (or category) into billable blocks. Two activities belong in the same block when:

1. They share the same `matter` (or both share the same `category` if non-billable)
2. The gap between them is 5 minutes or less

Gaps longer than 5 minutes produce separate time entries — the practitioner likely did something else in between, even if it wasn't captured.

For each block, record:
- Combined `start` (earliest) and `end` (latest)
- Summed `raw_hours` from constituent activities
- Collected `attribution.signals` from all activities (for description generation)
- All source `activity_id`s

Unassigned activities (null matter, null category) become standalone entries with `description_source: "insufficient"`.

### Step 2: Generate Narrative Descriptions

For each billable block, generate a professional description. Process in this order:

**1. Check the pattern database.** Compute the signal fingerprint from the block's collected signals (applications used, window title keywords, activity type). Search `patterns:index` for matches:

``time-pipeline-data`` `get` — `namespace: "tedraft"`, `key: "patterns:index"`

If a pattern matches with `match_count >= 3`, use its `description_template` as the base description. Set `description_source: "pattern_match"`.

**2. Interpret signals directly.** If no pattern matches, interpret the raw signals to generate a description. Use the attribution signals — window titles, application names, activity types — to infer the work performed:

- **LEAP + document title** → "Review/revise [document type] in [matter name]"
- **CanLII/Westlaw + Chrome** → "Research law regarding [topic from window titles]"
- **Word + extended session** → "Draft [document type inferred from title]"
- **Phone call + matter context** → "Telephone call with [party] regarding [matter context]"
- **Court calendar event** → "Attend [hearing type] in [matter name]"

Descriptions follow the legal billing pattern: **verb phrase + subject + context**.

Good: "Research law regarding limitation period for personal injury claim"
Good: "Telephone call with client regarding formal offer to settle"
Bad: "Looked at cases about damages"
Bad: "Working on the Smith file"

Set `description_source: "generated"`.

**3. Surface insufficient signals.** If the signals are too ambiguous to produce a confident description (e.g., generic window title "Document1", Chrome tab "Google"), do NOT fabricate. Set `description_source: "insufficient"` and populate `description` with the raw signal summary so the practitioner can see what was captured:

```
[Insufficient signals] Word: "Document1 - Microsoft Word" (45 min), Chrome: "Google" (12 min)
```

The practitioner will provide the description during review.

### Step 3: Assign UTBMS Codes

After generating descriptions (not before), assign UTBMS codes. Read the reference at `references/utbms-litigation.md` for the code tables and signal heuristics.

For each entry:
1. Determine the **activity code** (A-series) from the description verb: research → A102, draft → A103, review → A104, communicate → A106/A107/A108, appear → A109
2. Determine the **task code** (L-series) from the matter context and work type: pre-trial pleading work → L120, discovery → L130, trial prep → L150

When the task code is ambiguous, default to L110 (Case Assessment, Development and Administration) — the broadest category. The practitioner can correct it during review.

For entries with `description_source: "insufficient"`, leave UTBMS codes as null. They will be assigned when the practitioner provides the description.

For non-billable entries (category-based), skip UTBMS assignment entirely.

### Step 4: Round to Billing Increments

Read the billing increment configuration:

``time-pipeline-data`` `get` — `namespace: "tedraft"`, `key: "config:billing_increment"`

Default to `0.1` (6-minute increments) if not set. Round each entry's `raw_hours` up to the nearest increment to produce `billed_hours`. Entries below the minimum entry threshold (default `0.1`) are still kept — the practitioner decides whether to bill them.

### Step 5: Store Draft and Present

Build the draft entry array and store it:

``time-pipeline-data`` `set` — `namespace: "tedraft"`, `key: "draft:{YYYY-MM-DD}"`, `value: '{draft_json}'`

Present the draft entries as a table:

```
#  Time         Hours  Description                                           UTBMS     Status
1  09:02-10:15  1.3    Research law regarding quantum of damages              L120/A102  Draft
2  10:15-10:33  0.3    Telephone call with client re: settlement offer        L120/A106  Draft
3  10:33-11:45  1.2    [Insufficient signals] Word: "Document1" (72 min)      —/—        Needs input
4  11:45-12:00  0.3    Email triage and scheduling                            —          Admin
5  13:00-14:30  1.5    Draft reply to application to dismiss                  L120/A103  Draft
```

Below the table, show the summary:
```
Billable: 3.3 hrs across 3 entries | Admin: 0.3 hrs | Needs input: 1 entry
Pattern matches: 2 | Generated: 1 | Insufficient: 1
```

Ask the practitioner to review: "Review the entries above. You can approve all, correct individual descriptions, reject entries, or provide descriptions for entries marked 'Needs input'."

### Step 6: Process Practitioner Review

The practitioner can:

**Approve all:** "Approve all" or "looks good" — commit all draft entries.

**Correct a description:** "Entry 3 was drafting the notice of civil claim" — update the entry's description, assign UTBMS codes based on the new description, set `status: "corrected"`, and learn from the correction (Step 7).

**Correct a UTBMS code:** "Entry 1 should be L150, not L120" — update the code, store the correction for pattern learning.

**Reject an entry:** "Remove entry 4" — set `status: "rejected"`, exclude from commit.

**Modify hours:** "Entry 2 was only 0.1" — update `billed_hours`.

After processing all corrections, re-display the updated table and ask for final approval before committing.

### Step 7: Learn from Corrections

When the practitioner corrects a description or UTBMS code, store the correction as a new pattern (or update an existing one):

1. Extract the signal fingerprint from the corrected entry's `source_activities` — gather the original attribution signals from the timesort day object
2. Compute a normalized hash of the fingerprint (sort keywords, lowercase, deduplicate)
3. Check if a pattern with this hash already exists:

``time-pipeline-data`` `get` — `namespace: "tedraft"`, `key: "pattern:{hash}"`

4. If it exists, update `description_template` and increment `match_count`
5. If new, create a pattern object and store it:

``time-pipeline-data`` `set` — `namespace: "tedraft"`, `key: "pattern:{hash}"`, `value: '{pattern_json}'`

6. Update the patterns index: get ``time-pipeline-data`` `get` — `namespace: "tedraft"`, `key: "patterns:index"`; append or update the entry, then ``time-pipeline-data`` `set` — `namespace: "tedraft"`, `key: "patterns:index"`, `value: '{updated_index}'`

The pattern fingerprint uses normalized, order-independent signals so that "Word + CanLII" matches "CanLII + Word". Keywords are extracted from window titles by stripping common suffixes ("- Google Chrome", "- Microsoft Word") and lowercasing.

### Step 8: Commit Approved Entries

For each approved or corrected entry with a non-null `matter` — billable and non-billable alike:

1. Invoke ``practice-data`` `matter-lookup` to find the matter by its number. If no matching matter exists, warn the practitioner and skip: "No matter found for {matter} in the practice database. Entry not committed — add the matter first."

2. Invoke ``practice-data`` `insert-time-entry` with the matter row id returned by the step-1 lookup, entry date, billed hours, and description. For a category (non-billable) entry, also pass `billable: false` — it is recorded against the matter but stays out of WIP and AR. The operation returns the new entry's ID.

3. Store UTBMS metadata keyed to the database ID:

``time-pipeline-data`` `set` — `namespace: "tedraft"`, `key: "utbms:{date}:{entry_db_id}"`, `value: '{"task_code":"L120","activity_code":"A102"}'`

4. Update the draft status:

``time-pipeline-data`` `set` — `namespace: "tedraft"`, `key: "draft:{YYYY-MM-DD}"`, `value: '{updated_draft_with_committed_status}'`

A category (non-billable) entry with no matter cannot be committed — a time entry must belong to a matter — so matter-less admin time stays in the draft for the practitioner's reference only.

Report completion: "Committed {N} time entries for {date} ({B} billable, {NB} non-billable). Total billable hours: {H}."

## Queries

| Question | How to answer |
|----------|---------------|
| Draft today's entries | Full workflow for today's date |
| Draft entries for March 15 | Full workflow with `date=2026-03-15` |
| Show draft for today | ``time-pipeline-data`` `get` — `namespace: "tedraft"`, `key: "draft:{date}"` → present table |
| What UTBMS code is entry X? | ``time-pipeline-data`` `get` — `namespace: "tedraft"`, `key: "utbms:{date}:{entry_id}"` |
| Re-draft today | Clear existing draft, re-run from Step 0 |
| Change billing increment to 0.25 | ``time-pipeline-data`` `set` — `namespace: "tedraft"`, `key: "config:billing_increment"`, `value: "0.25"` |

## Integration

| Skill | Relationship |
|-------|-------------|
| **time-sorting** | Upstream. Provides classified day objects. Must run before this skill. |
| **build-timeline** | Upstream of time-sorting. Provides raw data. |
| **practice-data** | Owns time entries. This skill writes approved entries there. |
| **wip-tracker** | Downstream. Reads committed time entries to calculate WIP. |
| **wip-tracker** | Downstream. Aggregates committed entries for WIP and billing reports. |
| **invoice-tracking** | Downstream. Uses committed entries for invoice generation. |
