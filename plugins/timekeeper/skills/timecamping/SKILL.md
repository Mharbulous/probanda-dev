---
name: timecamping
disable-model-invocation: true
description: Correct pre-categorized TimeCamp time entries (amber placeholders like "Phone calls (to be sorted)" and "Viewing Outlook Email Inbox"), and flag uncovered time (client work the evidence shows but no TimeCamp entry covers), by assembling every available evidence source into one time-ordered picture before inferring the matter — never from a partial view. Use for "sort my TimeCamp entries", "categorize today's amber entries", "fix my time tracking for {date}", "what unbilled time is on {date}", or reviewing/correcting TimeCamp assignments. Read-only against every source but TimeCamp itself; write-back requires explicit practitioner approval and defaults to a dry-run report. Uncovered time is reported for the practitioner to enter by hand, never created.
dependencies:
  - timecamping-data        # timecamping.db: source tables, the assembly gate, proposals, determinations, presumptions
  - build-timeline           # delegated ingestion for TimeCamp computer-activity, Telus, Google Calendar, iCloud calendar and sent-mail rows
  - show-me           # every ceremony in Step 6 and the presumption lifecycle
  - practice-data            # matter_lookup for identifier -> matter resolution
  - time-sorting             # first-run handoff; reuses its TimeCamp task-tree sync rather than refetching
---

<!-- timekeeper v0.2.14 -->
> **Installed copy.** This skill's full source tree ships beside this file, and a relative path in the text below cites that tree. Resolve one by trying, in order: the directory of the file you are reading, then `${CLAUDE_SKILL_DIR}/<path>`, then `${CLAUDE_SKILL_DIR}/../<path>` (so `shared/x.md` is at `${CLAUDE_SKILL_DIR}/../shared/x.md`). The host substitutes `${CLAUDE_SKILL_DIR}` with the directory holding this SKILL.md when this file loads; if the literal text `${CLAUDE_SKILL_DIR}` is what you see, that IS the definition: it means the directory containing this SKILL.md, not a placeholder to search for or guess. Read references and shared files natively from there, never over the litigation data server's skill-source tool and never by requesting folder access; scripts and templates the text declares are executed and read from there too. If `${CLAUDE_SKILL_DIR}` itself no longer exists, the plugin was re-synced mid-session: list only `${CLAUDE_SKILL_DIR}/../../..` (the folder that held this plugin's folder), take the folder named as this plugin's folder with any `~g<N>` suffix removed plus the highest `~g<N>`, and repeat the same three tries with its `skills/<this skill>` directory in place of `${CLAUDE_SKILL_DIR}`; tell the user once that the plugin updated mid-session, from the version in this file's version comment to the version in that folder's copy of this SKILL.md. If a file the text names is missing at every one of those paths, including the re-synced folder's, STOP and report the exact path and error to the user rather than substituting an alternative: do not re-derive a script's logic from its source text or the prose, and do not search elsewhere on the filesystem. Ask the user to reinstall the plugin and fully restart the app; this may fix it, but STOP means stop regardless: do not diagnose further yourself.
> **HTML pages.** Every HTML file this plugin writes is a human interface generated from its databases; an agent never views, reads, greps, parses, scripts over, stages, authors or requests a screenshot of one, but may present one to a human user to view, and may view a screenshot the user provides on their own initiative. The rule and the data to use instead: `shared/html-pages.md`.

## Contents

| Section | Read when |
|---|---|
| Scope | Deciding whether a request falls inside this skill |
| Source integration | Fetching or ingesting any evidence source |
| Workflow | Every run: Steps 0 to 7 and the Backfill |
| Presumption lifecycle — summary | A standing presumption is offered, applied or suspended |
| Queries | The practitioner asks one of the listed questions |
| Integration with other skills | Before handing work to another skill |
| Critical constraints | Always |

# Timecamping

Correct a lawyer's own pre-categorized TimeCamp time entries by assembling
every available evidence source into one time-ordered picture *before*
inferring which client matter a block of time belongs to, then writing
approved corrections back to TimeCamp as the system of record. The same
evidence also flags uncovered time: client work that no TimeCamp entry
covers, reported for the practitioner to enter by hand.

**The governing principle — read `.claude/skills/timecamping/VISION.md`
before touching this skill's logic:** inference is forbidden until evidence
assembly is complete, enforced by pipeline structure, not by asking the
model to wait. An LLM shown one source at a time infers confidently and
wrongly from whatever it's handed; the fix is controlling what it sees and
when, not hoping it holds back. The full seven-point pipeline, the evidence
doctrine (direct vs. indirect), the ceremony grid, and the presumption
lifecycle are settled in `Engineering/1. Design/2026-08-28_timecamping-evidence-first-design.md`
— **do not relitigate that design**; this file is how a session executes it.

**Regression target:** every narrative E2E test under `docs/E2E-tests/`
matching `*timecamping*e2e-test.md` is the concrete acceptance bar — the
walkthrough tickets on map #412 add to this set as each source is worked
(#419 TimeCamp, #420 Telus, #423 SyncoPaid, #421 Google Calendar, #424
combined history), so match the glob rather than a fixed count. Each documents
a real fixture, the expected reasoning, and explicit pass criteria — read them
before changing this skill's Step 5/6 logic, and verify against them (Queries,
below) before considering a change complete. The Google Calendar set became
live regression checks when `gcal` was registered (#454), rather than a
specification for something absent.

The `combined-gate-coverage` fixture (#424) states the **standing-fact**
contract, and became a live regression check when #844 landed. Its header and
pass criteria, and the `combined-cross-day-identity` fixture's closing note,
were written before the build; each stale statement is now struck through with
a dated correction beneath it (#849). `splice.sql` now carries standing-fact
lines: a fact a source establishes that belongs to no particular day — today,
which person owns a phone number — exposed independently of the target date, so
a source whose events all fall on other days can still name the caller.

## Scope

This skill corrects **TimeCamp's pre-categorized time entries** — the
amber/green colored timesheet blocks, not raw computer-activity tracking.
It generalizes `bill-client`'s Step 9a Telus cross-check to every registered
evidence source and every entry, not just phone-labeled ones.

It also flags **uncovered time**: a stretch where direct evidence shows work
on a client matter but no TimeCamp entry covers it — possible unbilled time
(Step 5). Uncovered time is reported for the practitioner to enter by hand,
never created in TimeCamp (decided on #939, 2026-09-24).

This skill does NOT:

- Fetch raw computer activity or call logs itself — it **delegates** that to
  `/build-timeline` (see Source integration, below), reusing the existing
  ingester rather than duplicating its fetch logic.
- Classify raw, never-before-categorized activity into a first cut — that
  remains `/time-sorting`'s job. This skill's object is TimeCamp's *own*
  existing entries, which already carry a task assignment (even if it's an
  amber placeholder), plus the uncovered time above; the relationship
  between the two skills' jobs is not fully settled and is flagged in
  Critical Constraints below.
- Draft UTBMS billing codes or produce invoice-ready descriptions in the
  full `/time-entry-drafting` sense — it writes a corrected TimeCamp note in
  the note grammar below, nothing more.
- Ever write to TimeCamp, or any other source, without the practitioner's
  explicit approval per entry, and defaults to a dry-run report even after
  approval (see Step 7).

## Source integration

Seven evidence sources. Reuse the existing `probanda.json →
time_tracking.sources` registry (the same accounts/tokens `build-timeline`
already uses) rather than a second config surface — extend the existing
`timecamp` registry entry's capabilities rather than registering a
duplicate source for the Time Entries fetch. A missing registry is handled
by Step 0.

| Source | Mechanism | Reference |
|---|---|---|
| TimeCamp computer activity | **Delegate**: invoke `/build-timeline` for the target date, then have `/time-pipeline-data` export its stored rows (prefix `activity:timecamp:`) to a file and convert them with the gatekeeper's `build_ingest.py timeline --source timecamp`. No independent HTTP call. | `build-timeline/reference/TimeCamp.md` |
| Telus calls | **Delegate** the same way: export prefix `activity:telus:`, convert with `--source telus`. Reuses the already-verified CSV parsing rules; don't refork them. No CSV supplied for the day → recorded as `skipped`, a terminal (gate-satisfying) status, not `failed`. | `build-timeline/reference/TelusConnect.md` |
| SyncoPaid captures | **New fetch, capture-level** — not build-timeline's coarser block-level call, which discards the per-capture/OCR detail every SyncoPaid-heavy fixture needs. Redirect the `evidence query ... --include-ocr-text` output to a file, then convert it with `build_ingest.py syncopaid-captures`. Same live-opt-in gate as build-timeline's fetch. | `reference/SyncoPaidCaptures.md` |
| TimeCamp time entries | **New fetch** — the practitioner's own amber/green timesheet rows, a different endpoint from build-timeline's computer-activity fetch. The `timecamp` connector's `entries` writes the day's rows to a file (`out_file`), then `build_ingest.py timecamp-entries` converts it, filtering to the practitioner's own `user_id`. Same connector. | `reference/TimeCampEntries.md` |
| Google Calendar | **Delegate** the same way: export prefix `activity:gcal:`, convert with `--source gcal`. build-timeline owns the registry entry and the fetch; this skill qualifies the route first and never reads a calendar independently. Registered as the fifth source in #454; the doctrine behind it is #421's. | `build-timeline/reference/GoogleCalendar.md` |
| iCloud calendar | **Delegate** the same way: export prefix `activity:icloud:`, convert with `--source icloud`. build-timeline owns the registry entry and the fetch, which runs through the lawyer plugin's `calendar__*` tools with the Probanda mail connector's credential. Only the `Work` and `Home` calendars are read; `Family` never is. Registered as the sixth source in #1199. | `build-timeline/reference/ICloudCalendar.md` |
| Sent mail | **Delegate** the same way, but sent mail is stored as events, not activities: export prefix `event:sent_mail:`, convert with `--source sent_mail`. build-timeline owns the registry entry and the fetch, which reads the iCloud copy of the Microsoft 365 Sent Items through the lawyer plugin's data server's mail tools. Only `Sent Items`, `Sent Messages` and their `Outbound LEAP Matter Based Emails` subfolders are read. Subject, recipients and sent time only, never a body. Registered as the seventh source in #1261. | `build-timeline/reference/SentMail.md` |

## Workflow

### Step 0: First-run setup

Read the time-tracking registry: `time_tracking` in the machine-level
`probanda.json` (location and No-registry rule:
`time-sorting/protocols/FirstSetup.md`). If `time_tracking.sources` is absent
or empty, stop and run that protocol first; never proceed without a
registry. If the timecamping database doesn't
exist yet, invoke `/timecamping-data` and let it run its migration before
anything else proceeds — every step below assumes a migrated database.

### Step 1: Resolve target date

Same date-resolution convention as `build-timeline` Step 1: default today,
accept a single date, a relative date ("yesterday"), or a range — interpret
in the practitioner's local timezone (`probanda.json → time_tracking.timezone`,
default `"America/Vancouver"` if unset),
then work one **local day** at a time throughout (every source below is
fetched and gated per-day, never as a wider range — this matches
`build-timeline`'s own per-day discipline for exactly the same
boundary-stability reasons documented there).

### Step 2: Populate per-source tables

A day's evidence reaches the database as **one ingest file and one bulk
ingest**, and no source row passes through this session's context: each
source's material goes to a file, the gatekeeper's `build_ingest.py` converts
it, and only the script's one-line summary comes back. `/timecamping-data`
documents the script, its subcommands and the file shape (Bulk ingest file);
run it with the host Python (`python`; if that is the WindowsApps stub, the
interpreter `COCLERK_PYTHON` names). Pass `--timezone` with the value from
`probanda.json → time_tracking.timezone` to every subcommand that takes it,
and `America/Vancouver` when the key is unset.
For each of the seven sources above, in any order:

1. **Produce the source's material as a file.** A delegated source: run
   `/build-timeline` for the date, then have `/time-pipeline-data` export the
   source's stored rows (prefix per the table above) to a scratch file. A new
   fetch: write the reference's read to a file (for TimeCamp entries, the
   connector's `entries` with `out_file`).
2. **Confirm a delegated source was fetched for the date** before converting
   it. For Google Calendar, the day must fall inside a range in
   `source:gcal:ranges`, read through `/time-pipeline-data`. For the iCloud
   calendar, this run's build-timeline report must show the route qualified
   and read, and the day must fall inside a range in `source:icloud:ranges`.
   For sent mail, this run's build-timeline report must show the folders
   qualified and read, and the day must fall inside a range in
   `source:sent_mail:ranges`.
   For TimeCamp, build-timeline must have reported the day fetched. Telus
   converts only when a Telus CSV was supplied for the day. Unconfirmed
   TimeCamp, Google Calendar, iCloud or sent mail is `failed` (step 4), with an
   `--error-detail` saying the source was not fetched for the date, never
   `empty`: an `empty` for a day never fetched releases the assembly gate on
   missing evidence. Telus with no CSV supplied is `skipped` (step 4).
3. **Convert it** with the matching `build_ingest.py` subcommand, appending to
   the day's ingest file. It writes the source's rows and its `fetched` or
   `empty` status line.
4. **Every other exit writes its status line alone**, with `build_ingest.py
   fetch-log`: `skipped`, or `failed` with the reason as `--error-detail`.

Then load the day's file with one `/timecamping-data` bulk ingest. Re-running
a day rebuilds the file and loads it again; rows upsert in place on their
source key, so their ids stay stable.

A registry-disabled source (`enabled: false`), a live-gate-off source
(SyncoPaid), or a not-yet-provided CSV (Telus) is `skipped`, an expected,
terminal state — never `failed`. A registry with no entry for a source is
`failed`, not `skipped`: only an explicit `enabled: false` may skip a source
(the `timecamp` entry covers both TimeCamp sources). A genuine fetch error
(bad token, malformed response, network failure) is `failed`, and so is the
iCloud calendar on a machine whose mail credential has no calendar fields, and
sent mail on a machine with no mail credential: that day waits until the source can
be read. Sent mail is also `failed` on every day until its registry entry
carries `copy_confirmed`. One source's failure never blocks another's fetch.

**A registered source has teeth: every exit path records an outcome.** From
the moment a source's table name sits in the assembly gate's expected set,
every day blocks until it reaches a terminal status — so a fetch that returns
without writing a row strands that day. Enumerate the paths before running
one. For Google Calendar they are:

| Situation | Status |
|---|---|
| Route qualified (below), events returned | `fetched` |
| Route qualified, zero events | `empty` — a real and recurring state on this calendar, never `failed` |
| Registry entry `enabled: false` | `skipped` |
| Registry present but has no `gcal` entry | `failed`, `error_detail` saying there is no `time_tracking.sources` entry for `gcal` and to add one with `enabled: true` or `enabled: false` |
| Route's calendar list is missing the work calendar | `failed`, `error_detail` naming the missing calendar |
| Neither route reachable | `failed`, `error_detail` naming both routes and the fix |
| Any other fetch error | `failed`, `error_detail` carrying it |

**Qualify the calendar route before you trust its result.** Enumerate the
calendars the route can actually see and confirm the practitioner's work
calendar is among them — the identity table in
`build-timeline/reference/GoogleCalendar.md` is the authority on which one that
is and how to confirm an event's membership. On a mismatch record `failed` and
stop; do **not** proceed on the partial view. This exists because a
wrong-calendar read returns a successful, empty-looking, error-free result:
nothing downstream flags it, and it cost a full walkthrough session and four
fixtures built on a false premise (the `gcal-calendar-identity` fixture). Name
the route used and the calendars it covered in the run summary, so a
wrong-calendar read is visible in the output rather than inferred months later.

For the iCloud calendar the paths are:

| Situation | Status |
|---|---|
| Route qualified (below), events returned | `fetched` |
| Route qualified, zero events | `empty` — the calendar is sparse, and this is never `failed` |
| Registry entry `enabled: false` | `skipped` |
| Registry present but has no `icloud` entry | `failed`, `error_detail` saying there is no `time_tracking.sources` entry for `icloud` and to add one with `enabled: true` or `enabled: false` |
| Calendar not configured (`dav_not_configured`) | `failed`, `error_detail` saying calendar not configured: run `mail__configure_credential` with the calendar fields, or set the `icloud` entry's `enabled: false` to record `skipped` |
| Calendar list is missing the `Work` calendar | `failed`, `error_detail` naming `Work`, its URL and the fix |
| Calendar list is missing only the `Home` calendar | `fetched` or `empty` on `Work` alone, with `Home` named as missing in the run summary |
| Any other fetch error | `failed`, `error_detail` carrying it and naming the fix |

**Qualify the iCloud route by calendar URL before you trust its result.** List
the account's calendars and confirm each in-scope calendar is present, matching
by the URLs in the identity table in `build-timeline/reference/ICloudCalendar.md`,
which is the authority on the calendars and the procedure. Only a missing
`Work` calendar is `failed`. The events read must name only `Work` or `Home`:
`Family` is never read or stored, and the ingest script refuses a row from
any other calendar or with no calendar. Name the calendars read in the run
summary.

For sent mail the paths are:

| Situation | Status |
|---|---|
| Folders qualified (below), copy confirmed, messages kept for the day | `fetched` |
| Folders qualified, copy confirmed, zero messages kept for the day | `empty` |
| Registry entry `enabled: false` | `skipped` |
| Registry present but has no `sent_mail` entry | `failed`, `error_detail` saying there is no `time_tracking.sources` entry for `sent_mail` and to add one with `enabled: true` or `enabled: false` |
| The `sent_mail` entry has no `copy_confirmed` | `failed`, `error_detail` saying the iCloud Sent Items copy is not yet confirmed complete (#1262) and to set `copy_confirmed` when its close check passes |
| The day is before the entry's `copy_from` | `failed`, `error_detail` saying the confirmed copy does not reach that date |
| The mail credential is not configured (`mail__configure_status`, or a `mail_not_configured` error) | `failed`, `error_detail` saying to configure it with `mail__configure_credential` and re-run the date, or to set the `sent_mail` entry's `enabled: false` to record `skipped` |
| Folder list is missing `Sent Messages` | `failed`, `error_detail` naming `Sent Messages` and the fix |
| Folder list has a folder under `Sent Items/` or `Sent Messages/` that the reference does not list | `failed`, `error_detail` naming the folder and the fix: add it to the in-scope table after review |
| Folder list is missing only `Sent Items` or an `Outbound LEAP Matter Based Emails` subfolder | `fetched` or `empty` on the other folders, with the missing folder named in the run summary |
| A search is truncated | `failed`, `error_detail` naming the folder and both counts |
| Any other fetch error | `failed`, `error_detail` carrying it and naming the fix |

`empty` is never recorded for a day that was not read or not covered.

**Qualify the sent-mail folders before you trust the result.** List the
folders and confirm `Sent Messages` is present and that no unlisted folder
sits under it or `Sent Items`, as `build-timeline/reference/SentMail.md`
sets out; that file is the authority on the folders, the day window and the
procedure. Each in-scope folder is searched separately, and a Message-ID found
in several is one row, the copy in the earliest folder of that file's table.
The ingest script refuses a row from any folder out of scope. Name the folders read in
the run summary.

**Name every `skipped` source in the run summary**, one line each with the
reason of the exit taken, kept apart from any counts — for example
`Google Calendar: skipped — disabled in the time-tracking registry`, or
`Telus calls: skipped — no CSV supplied`. A registry-disabled `timecamp`
entry yields two lines, one per TimeCamp source. These lines belong only to
the end-of-run summary, never to this step's output, so a whole-day skip is
visible without showing any per-source view early.

**Produce no narrative output beyond fetch bookkeeping in this step** — no
table of fetched rows, no per-source summary of what was found. This
absence is deliberate (see Step 3): the model must never see a per-source
view before assembly completes, and rendering one here — even just to
report progress — would be exactly the partial view the whole design exists
to prevent.

### Step 3: Hard gate — structural, not promptual

This is the design's central claim, and it is enforced by where the gate
actually lives: **the only sanctioned way to read a day's consolidated
evidence is through the gatekeeper's canonical consolidated-day query**,
which itself refuses to return any evidence rows at all when any
registry-enabled source lacks a terminal (`fetched`/`empty`/`skipped`)
outcome for that day — it returns a violation marker naming the missing
sources instead. Invoke `/timecamping-data` for this read; never construct
a per-source read yourself to "just see what's there so far."

On a violation: halt, report which sources are still missing, and stop —
do not proceed to Step 4 on partial data, and do not silently retry with
whatever's available. There is no code path between Step 2's writes and
Step 4's read that shows the model a single source's table; that absence is
what makes the hard gate structural rather than a prompt instruction the
model could forget or rationalize past.

### Step 4: Splice into a consolidated view

Read the gatekeeper's canonical consolidated query for the target date;
`/timecamping-data` documents the line format it returns. It returns every
source's rows for the day as time-ordered lines, with overlaps **preserved
rather than resolved** — a scheduled calendar block and the real call it
predicted both appear as separate lines sharing overlapping ranges, never
merged away — and a computed boundary-continuity marker on lines that begin
exactly when another row ends, or end exactly when another begins (the fact
the telus-call-boundary fixture exists to test: an orphan block's own few
seconds are unreadable in isolation, but the boundary marker says "this is
the tail of the entry that just ended," which is the clue that decides it).
Consecutive rows of one source with an identical summary and no gap between
them arrive as one line that lists every member row, its count and its span.
Any gap, any flag change, or any other source's row in between keeps rows on
separate lines, so a sub-minute window, a repeat, and the gap between two
windows all stay visible to P1–P4 below. TimeCamp lines carry tracked time:
an entry line's `[tracked Ns]` is the seconds TimeCamp counts for it, and an
activity line's `[tte <id>]` names the entry that row counts toward, which
may be an entry dated another day with no line in the read
(`[tte ?<native id>]` for an entry never ingested, `[untracked]` for none). P7 reads coverage from these, never from an entry's clock span.

**Read the whole day, or stop.** The first line is a header stating how many
lines follow and how many characters they hold. If its character count is
over 400,000, halt: report the date, the character count and the line count
for the practitioner to decide, and do not proceed on a partial read.
Otherwise read every line before Step 5; if the result spills to a file, page
through it to the end. The header counts `line` values, not lines of the file:
a spilled result is pretty-printed JSON, where each `line` value takes several
lines of the file, so check that you read as many `line` values as the header
states.

The same read also returns a block of **standing facts** ahead of the
time-ordered lines — facts a source establishes that belong to no particular
day, today the Telus contact directory (which person owns a phone number).
They are not events: they carry no timestamps, they are identical for every
target date, and a standing fact is never treated as something that happened
on the target day. A number is stored E.164 (`+16045550172`), so normalize a
number written in another format elsewhere — a calendar description's
`+1 604-555-0172` — before matching it against the directory. A source whose
own rows all fall outside the target day, and whose status for the day is
therefore `skipped`, still contributes here: `skipped` means "no events this
day," never "contributes nothing."

### Step 5: Inference pass

Group Step 4's lines into blocks and, for each block, propose a matter and
draft a note. This is model judgment guided by named presumptions, never a
SQL grouping rule — recognizing that one row is "that email's PDF
attachment" takes reading the content, not applying a duration threshold.

**Look at the screen before proposing** (Brahm, 2026-10-01, #942). OCR text
and window titles are never enough to propose a block. For every block that
rests on a stretch SyncoPaid covers, decrypt and view the screenshots with
`evidence show` (`reference/SyncoPaidCaptures.md`): at least the first, a
middle and the last capture of the stretch, and more wherever the window
title moves between matters. A stretch whose captures carry no OCR text is
where the image matters most, because it is the only content evidence.
"Encrypted" is not "unavailable": a capture is unavailable only when
`evidence show` itself fails, and that failure is disclosed in the ceremony.
Record the viewed capture ids in the proposal's evidence record. A proposal
resting on a covered stretch without them is not ready to commit. Batching a
day's ceremony into one list and one approval does not waive this: the list
carries the images.

**Grouping and classification presumptions** (P1–P7 settled across the #419
fixtures, P8 across #421's, P9–P10 on #853; the editable list this skill
carries):

- **P1 — forward merge**: uncategorized time under a minute belongs to the
  matter that follows it, unless separated by a large uncategorized gap.
- **P2 — backward merge**: a sub-minute block matching the *preceding*
  block's matter merges backward into it.
- **P3 — flip-through**: a window open under a minute, not repeated, amid
  work on another matter is incidental window-sorting — its time goes to
  the matter actually worked.
- **P4 — bridging**: repeated short same-matter looks interleaved with
  neutral windows bridge into one block.
- **P5 — neutral windows carry no matter evidence**: a bare inbox view, an
  unsaved draft, a dev tool — these inherit from surrounding evidence and
  never form a boundary or claim time on their own.
- **P6 — idle is data, not an activity**: zero input / an unchanged screen
  is a statement about the *computer*, never about the lawyer, who may be
  in a meeting, on a call, or in court. Disposition is always **t.b.d.**,
  flagged for the practitioner — never silently included, excluded, or
  labeled non-work. **t.b.d. is the default, not the terminus**: where a
  *different* source positively accounts for the stretch — a softphone window
  opening at its start, a booking whose subject the surrounding direct evidence
  confirms — a ceremony may resolve it into that source's block rather than
  leaving it open (#424, the 2026-08-31 call: 15:02–15:24 zero input, absorbed
  into the 15:00:08 call). Only a ceremony may; the pipeline never resolves one
  on its own. The account must be positive — a gap that merely *coincides* with
  a booking resolves nothing, which is the same window where #421 recorded
  reading a gap as corroboration and had to retract it.
- **P7 — double-tracking**: time already covered by a separately-logged
  entry is reconciled with that entry, never duplicated into a new one. An
  entry covers only the seconds TimeCamp tracked to it: the activity rows
  attributed to it (`[tte <id>]`), which sum to its `[tracked Ns]`. Its
  clock span runs from its first row to its last and covers nothing by
  itself. The seconds of an entry nested inside that span, and a stretch
  attributed to no entry (`[untracked]`), are not the outer entry's (#1102:
  829 of 841 entries' durations equal their attributed rows, and none
  includes a nested entry's seconds). Where `[tracked Ns]` and the attributed
  rows disagree, `[tracked Ns]` is the time TimeCamp counts and the rows are
  content.
- **P8 — a calendar event is a marker or a work block, and the title's verb
  relation is the test**: does it name something the practitioner *does*
  (`Work on…`, `Meeting with…`, `Draft…`) or something that *happens to a
  file* (`… Due`, `DEADLINE:`)? Guest structure corroborates and never
  decides — `Work on letter for Joe Lindale` 11:00–13:00 is structurally
  identical to a deadline marker and is real work, so a structural test
  discards real client time. A marker carries zero duration, and an all-day
  extent is never converted into 24 hours or any other figure; resolve its
  matter identifier for context only. Classification happens here and never
  at ingest — `build-timeline/SKILL.md` 169-171 forbids inferring a type from
  a title string in the fetch.
- **P9 — personal time is carved out, never billed to a client**: identified
  only from positive direct content — a personal email, webpage or document,
  or a call-log row to a personal number — never from idle or absent
  activity (P6 stands). A single personal window under one minute, not
  repeated within the block, is absorbed into the surrounding block; the note
  stays silent about it, but the evidence chain names it so the practitioner
  can override. Repeated personal glances in one block are summed, and once
  the sum reaches one minute, or any single stretch is one minute or longer,
  it is carved out to a child task of `PERSONAL` (108448409), never to
  `PERSONAL` itself, a top-level project the API refused a write to (Step 7
  item 1), and never to the separate top-level `Personal` project
  (171376996). The child is the one the personal content matches (a
  personal email to family goes to `Communicating with family`), read from
  the synced task tree: `PERSONAL`'s children are the entries whose
  `parent_id` is 108448409. When no entry in the synced tree carries
  `parent_id` at all, the store is in the pre-#940 shape: stop and send the
  practitioner to re-sync it through `/time-sorting` ("refresh the project
  list") rather than reporting that no child matches. When no child matches
  in a current-shape tree, the proposal is a ceremony
  that lists `PERSONAL`'s children for the practitioner to choose from; no
  task is created. The same child is the target whether the whole entry is
  written back or a split is applied by hand. The inbox lead-in to a
  personal email is personal time too (evidence doctrine item 5 bills
  lead-in to the email opened). The skill cannot split an entry, so the
  proposal states the split for the practitioner to apply by hand: the
  personal segment's exact start and end, the target child task, and the
  remainder's matter and note; if the segment sits at one edge of the entry,
  say so, since trimming an edge is one UI action. Carving personal time out
  of an amber entry follows the grid like any destination; carving it out of
  a green entry contradicts TimeCamp's own categorization and is always a
  ceremony. When the target child carries `billable = 1` in the synced task
  tree, the proposal adds the line: "`<child name>` is flagged billable in
  TimeCamp, so this entry will read billable; exclude from any bill."
- **P10 — `Switching File` is a keyword guess, reviewed like amber**:
  TimeCamp's own rule switches the timer to `Switching File` on LEAP's
  `Matter List` window, and the timer stays there until another rule fires,
  so the entry is a residual bucket that also collects unrelated work (long
  `claude` stretches, a client letter, a client email). Its label is
  indirect evidence, exactly as an amber label is. The entry's own content
  is the activity rows attributed to it (`[tte <its id>]`); rows inside its
  clock span attributed to another entry are that entry's tracked time and
  are P7 double-tracking, never re-billed. Its own rows are tracked by no
  other entry, even when a green entry's span encloses it, so routing them
  never double-counts. Route by content: real work goes to its
  matter or non-billable bucket (development to `App building`); pure LEAP
  navigation (`Matter List`, `Loading...`, `Notifications`, `Pubnub
  Gateway`, `Welcome to LEAP`) merges forward under P1 into the matter
  switched to, capped at one minute per switch, and any navigation beyond
  the cap stays in `Switching File`, non-billable. That forward merge is a
  silent commit under the Step 6 grid's first row, not a ceremony, when all
  four hold: every row attributed to the entry is pure LEAP navigation from
  the list above; its `[tracked Ns]` is one minute or less; the rows
  immediately before and after its own rows count toward one green entry;
  and the row after is a LEAP window naming the matter that green entry's
  task belongs to in the synced task tree. `Switching File` names no
  matter, so no source is disbelieved, and the window names the matter
  outright (#1093, proposal 63). Anything else keeps the ceremony,
  including a window naming a matter other than the surrounding entry's
  (proposal 64). `Switching File` entries
  are in the default review queue alongside amber, identified by task, never
  by their brown colour, which `Write-off` and `MS Teams Write off` share.

**Within a block, apply the evidence doctrine in full:**

1. Extract distinctive identifiers from direct-evidence content (window
   titles, OCR text, call-log numbers, email subjects and recipients) — file numbers,
   party names, contact names.
2. Cross-reference the identifier against `practice_data__matter_lookup`
   and the TimeCamp task tree already synced by `/time-sorting` — reuse
   that sync rather than re-fetching the project tree a second time; if
   stale or absent, trigger the sync `time-sorting`'s own SKILL.md
   documents, don't hand-roll a fetch here.
3. **Verify an ambiguous identity claim at its authoritative source** — an
   unfamiliar phone number is checked against the real directory or contact
   page it belongs to, never accepted from a search engine's synthesized
   summary (the call-identity fixture's explicit anti-pattern: a web search
   once asserted a real government help-desk number belonged to a scam
   operation; the actual government contact page refuted it).
4. **Rank evidence**: direct beats indirect; a phone log beats screen
   tracking beats a label or calendar guess. A source's own categorization
   (TimeCamp's amber label itself, a calendar entry) is **always indirect**
   — a keyword guess or a prediction, never a record of what happened — and
   is *never* itself treated as confirming evidence, no matter how many
   times it repeats (see the ceremony grid, row 6/9, below).

   **A calendar event is a hypothesis, and both verdicts are frequent** —
   direct evidence confirms it or refutes it, and on this practitioner's real
   data neither bias is safe. Three rules follow. **Duration comes from the
   evidence, never from the slot**: slots are round numbers a booking tool
   chose. **A refutation carries the same evidentiary burden as a
   confirmation** — refute from evidence that positively accounts for the
   window, never from the absence of a matching entry, which is only a P6 idle
   question. And **`created`/`updated` set a prior, never a decision rule**:
   a row written minutes before its start is a near-contemporaneous by-product
   of the meeting beginning, one written days ahead is a forecast of intent
   and intent decays, and `updated == created` on a booking whose real-world
   time changed is the staleness fingerprint. A short lead time still gets
   checked; it simply starts from a stronger position. iCloud events carry no
   `created`/`updated`, so no such prior exists for an `ic` line.

   **A `Home` calendar event never supports billable time on its own.** An
   `ic` line tagged `[calendar: Home]` comes from the practitioner's personal
   calendar. It may explain an unbilled gap, such as an idle stretch the
   appointment accounts for, but it never supports billable time on its
   own.

   **A sent email is direct evidence of work by the practitioner**, parallel
   to a Telus call: an `sm` line records that the practitioner sent that
   message at that instant. Its subject and recipients may name a matter;
   they are the only content read, and the body never is. Whether an email
   bills time, and how much, stays this step's judgment: the line is an
   instant, so any duration comes from the surrounding evidence, never from
   the email itself. **A sent meeting response is a marker only, like a
   calendar entry, not evidence of work** (Brahm, 2026-09-30): an `sm` line
   whose subject starts `Accepted:`, `Declined:`, `Tentative:`, `Canceled:`
   or a similar automatic reply may name a matter for context, but it never
   supports time on its own.
5. **Never conclude "email triage" from a bare Inbox window title alone.**
   Outlook reports reading-pane work — including reading or searching a
   specific client's correspondence — under the plain title `Inbox`; check
   SyncoPaid screenshot/OCR evidence before concluding anything from a bare
   inbox title (the inbox-not-triage fixture's rule). By convention,
   inbox-sorting time spent reaching an email is billed to the email opened
   and should never exceed a minute. Sorting beyond that minute is
   reassigned to `Write-off` with the note `inbox sorting over cap`, the
   same shape as P10's `Switching File` cap.
6. **A seconds-long bookend glance is weak evidence next to sustained
   content** — a 35-second look at an unrelated matter immediately before a
   call does not set the call's subject when four minutes of on-point email
   content does (the telus-call-boundary fixture).
7. **State the evidence chain explicitly** before proposing anything — which
   lines, in what role, carried the conclusion. This is a hard structural
   requirement on the proposal, not optional narration. Cite a line by every
   member id it lists, pasted as printed, never by its first id alone;
   `/timecamping-data` documents the entry shape. **A standing fact is
   named as one, with its own dates** — copy the consolidated read's `detail`
   string for that fact into the rationale, so a reader can tell a dated
   observation on this day from a fact established on other days.
8. **Draft the note**: `{verb} {object} {details}`, subject omitted, a
   present-tense verb from the set *Attend, Review, Research, Analyse,
   Consider, Meet with, Phone to, Phone from, Teleconference with, Travel
   to, Draft*. Describes the **legal work the evidence shows was done**,
   never a list of window titles or durations — a longer block gets a
   *more general, shorter* note, not a longer one; description length is
   independent of duration.

**Uncovered time.** A block whose direct evidence (a Telus call, SyncoPaid
captures, TimeCamp computer activity) shows work on a client matter, and
whose time no TimeCamp entry line covers, is **uncovered**. Where an entry
covers only part of the block, the part outside it is the uncovered block,
on its own start and end. An entry covers only its tracked seconds (P7),
never its whole clock span: a stretch inside an entry's span whose activity
rows read `[untracked]`, or that has no activity row, is covered by no
entry. Such a stretch is uncovered only on the direct evidence above;
without it, an idle stretch stays a P6 question. One exception: an entry
whose `[tracked Ns]` exceeds its attributed rows was made or edited by hand
(entry 275316986 tracks 9000 s over 427 s of rows), so TimeCamp counts
seconds its rows do not show. Client work inside its span that no other
entry tracked is then a ceremony, never a silent UNCOVERED flag. State
`UNCOVERED — no TimeCamp entry` and the block's duration in its rationale;
matter, note and evidence chain are drafted as for any block, the note in
its usual grammar without the label. No minimum duration applies beyond
P1–P3's sub-minute merges, and a sub-minute tail merged into an entry's
block is covered. Indirect evidence alone (a calendar booking) never makes
a block uncovered, and neither does a stretch of neutral windows alone
(P5), such as the Claude app between two looks at one matter's folder.
Time an entry covers is never flagged, whatever its task (P7). A day whose
client work every entry covers has no uncovered block.

Output is a proposal per block — matter, note, evidence chain, and which
family of the ceremony grid it falls into (below) — never a commit.
Re-running a day supersedes that day's prior proposals first, except those
already written back or entered by hand (Step 7), which stand with their
evidence. A backfill (below) is not a re-run and supersedes nothing. Before
grouping, read the day's written-back and entered-by-hand spans through
`/timecamping-data`. Time an entered-by-hand proposal spans counts as
covered, so a re-run never flags it again, whether or not the re-fetched
entries already show the hand-made entry.

### Step 6: Confidence-gated ceremony

For each proposed block, evaluate its evidence and any matching presumption
against this grid (the design doc's authoritative 9-row table; reproduced
here at summary grain — read the design doc for the exact evidence-type/
conflict/corroboration columns each row keys on):

| Situation | Action |
|---|---|
| Direct evidence carries the conclusion outright (its content names the matter) | **Silent commit.** No presumption needed, none can override it. |
| A direct-evidence identifier→matter leap, first or second occurrence | **Ceremony.** One or two instances is not yet a pattern. |
| Same leap, third occurrence at ≥99% observed correlation | **Ceremony**, plus a **separate** ceremony offering a standing presumption — never bundled into the categorization question itself. |
| Same leap, an approved standing presumption already covers it | **Silent commit** under the presumption — but only when no other approved presumption also matches this block (see void-on-overlap, below). |
| Same leap, a real pattern below 99% | **Ceremony, every time.** Never offer a presumption unprompted; if the practitioner asks, run a stats-first ceremony scoped to the dominant branch only — the minority branch keeps its ceremony forever. |
| Evidence is indirect only (a calendar entry, TimeCamp's own categorization) | **Ceremony, always, forever** — no run of past confirmations turns a prediction into a record of what happened. |
| Any conflict with no covering presumption | **Ceremony.** Disbelieving a source is always a hypothesis needing ratification. |
| A conflict an approved presumption already covers (e.g. the same keyword-guess mistake happens every week) | **Silent commit** under the presumption. |
| A conflict resolvable only by indirect evidence | **Ceremony, always** — same rule as the indirect-only row. |
| No data from any source for the block | **One light elicitation** ("do you remember what you were doing?"); failing recall, write off as unidentifiable — no standing queue. |

Silent commits are never hidden — they're still listed in the run summary,
just without a blocking question. Every ceremony invokes `Skill
(show-me)` and honours its rules in full: **one decision per
ceremony** (a presumption offer is always its own separate ceremony, never
folded into the categorization question); **render actual evidence** — the
screenshot itself, never OCR text alone or a description of what it shows
(the gap disclosed when the image is unavailable); **show the
surrounding blocks**, not just this one in isolation (the boundary and
orphan fixtures exist because a block's own narrow window is sometimes
unreadable alone); **disclose any gap explicitly, freshly verified this
session** against the real source data — never inherit a stale "no call
logged" claim from another source's label; **ask exactly one sharp,
concrete question**.

**Void-on-overlap:** before applying any approved presumption, check
whether the block matches more than one approved presumption's identifier
(e.g. a call involving two people who each have a standing presumption to
different matters). If it matches more than one, **neither applies** — the
presumptions may be mentioned as context, never presented as competing
authorities — and the block routes to an ordinary evidence-based ceremony.
Exclude this block from *both* presumptions' running-correlation counts, so
a routine joint occurrence never spuriously suspends an otherwise-good
presumption.

**Drift**: every time an approved presumption is applied, recompute its
running correlation. A drop below the correlation it was approved at
auto-suspends it (no ceremony needed to suspend — this is a consequence of
the evidence, not a decision) and reverts it to per-instance ceremonies
until a fresh approval ceremony, showing the new lower stats, restores it —
possibly at that lower figure. Un-suspending is itself the practitioner's
act, ceremony-gated the same as first creating a presumption. Evidence
always wins regardless of any presumption: direct evidence pointing
elsewhere overrides a standing presumption without a ceremony.

### Step 7: Write-back — dry-run by default

Produce a report of every proposal now ready to write back — silent commits
included — and of every uncovered proposal, and **stop there** until the practitioner explicitly says to
commit. This report is what satisfies the earlier #419 fixtures' "commits
nothing without approval" language: that rule binds write-back to TimeCamp
specifically, and a silent commit under Step 6 is a state inside this
skill's own storage, not a write to TimeCamp — the two rules govern
different acts and are both satisfied at once.

When the practitioner says to commit, write **one entry at a time**, each
with its own approval. The request is `reference/TimeCampEntries.md`'s
confirmed write, the `timecamp` connector's `update_entry` (entry id, the
matter's TimeCamp `task_id`, the Step 5 note). Call the connector's `status`
first: if it reports the API unusable, stop, send nothing, and tell the
practitioner its reason. Never open the TimeCamp web app to make the change
instead. For each entry:

1. Skip it and say so if it is `locked` = `"1"` (invoiced), or if its matter
   does not resolve to exactly one TimeCamp `task_id` in the synced task
   tree. Also skip any proposal, from any rule, whose target task has
   `level` 1 in the synced task tree, with the reason: "Skipped: target task
   `<name>` (`<task_id>`) is a top-level project (level 1); TimeCamp's API
   refuses time on that level (403). Move it by hand in TimeCamp, or choose
   a child task." This rests on one refused write, to `PERSONAL` (#1097);
   every successful write so far went to a level-2 task.
2. Show the practitioner the exact request for this entry: entry id, date and
   time, current task → new task (name and `task_id`), and the note. Send it
   only on an explicit yes for this entry. Approval of one entry never covers
   the next.
3. Re-fetch that date with the connector's `entries` and compare the entry's
   `task_id` and `description` with what was sent. A non-200, or a re-read that does not match, stops
   the whole write-back: report it and send nothing further.

Any entry not approved stays in the dry-run report, which the practitioner
can still apply by hand.

An uncovered proposal has no entry to write to, so it is never sent. The
report lists every one under **Possible unbilled time** — matter, date,
start and end in local time, duration, note and evidence — for the
practitioner to create the entry by hand in TimeCamp.

When the practitioner confirms they have entered one by hand, record it
through `/timecamping-data`'s manual-completion record, for the one proposal
they name and only on that explicit confirmation. Never infer it from
silence, from a later fetch, or from approval of a different entry. The
proposal leaves both lists at once. It is not a write-back, and no report
presents it as sent. A proposal not yet past Step 6 cannot be marked, and an
unconfirmed one stays listed.

### Backfill: a source registered after a day closed

A source registered after a day's proposals were committed leaves that day
gated (#1270). The backfill fetches and ingests only the sources that day
actually lacks: `/build-timeline`'s "Fetch only {sources} for {date}" row,
then a day file holding only those sources' lines, loaded with one bulk
ingest. iCloud events are owed only through 2026-06-22, so from 2026-06-23
on name sent mail alone. A day lacks sent mail when it has no terminal
sent-mail status, or when its sent-mail fetch predates the four-folder
route fix (commit ff412c4, 2026-10-01). Step 2's per-source confirmation and
exit-status tables apply unchanged, and a source whose fetch did not happen
is `failed`, never `empty`. Never re-fetch TimeCamp entries on a closed
day: the pipeline's own write-backs would read back as evidence.

Before reading a day's sent mail, compare that day's sent count in the
source mailbox (the logicalaw.ca Sent Items in the PST or Outlook, opened
read-only) with its count in the iCloud copy. A day whose iCloud copy comes
up short is `failed` for sent mail with that reason, and is never read.

Then read `/timecamping-data`'s backfill overlay for the date, never the
day's consolidated read, and run no Step 5 pass. A `GATE` row halts that
day: report which source is missing and go on to the next date.

The contradiction rules, approved by the practitioner:

- A kept sent email contradicts a categorization when (i) it is addressed
  to a party or counsel tied to matter X, inside a block categorized to a
  different matter Y, or (ii) it goes to a client, counsel or court, inside
  a block categorized to any task that is not a client matter, such as
  Break, Personal, Write-off, Switching File, MS Teams Write off, App
  building or General admin.
- Rules (i) and (ii) test the overlapping proposal's categorization, and a
  hit reopens that proposal. When no proposal overlaps the email, they test
  the task of the TimeCamp entry covering it instead, because most entries
  are green and never became proposals. A hit there is raised in the list
  as possible unrecorded work, since there is no proposal to supersede.
- A sent email at an instant no TimeCamp entry covers, or whose recipients
  map to no known matter, is raised as possible unrecorded work. The
  overlay gives each row's covering entries for this. An instant no
  proposal covers is not enough, because most of a day's entries never
  became proposals and are recorded work.
- A meeting response (`Accepted:`, `Declined:`, `Tentative:`, `Canceled:`
  and similar) never reopens anything.
- An iCloud event is indirect evidence and reopens a proposal only through
  a ceremony: a `Work` event whose title names a matter other than the
  overlapping proposal's, or a `Home` event inside a block committed to a
  client matter (#942, 2026-09-27).
- Recipients and titles resolve to a matter by Step 5's evidence doctrine
  items 1-3: `practice_data__matter_lookup`, the synced TimeCamp task tree,
  and verification of an unfamiliar identity at its authoritative source.

Every item is one question, asked one per turn as a ceremony under
`show-me`'s rules (Step 6), the next only after the answer. Record each
answer at once through `/timecamping-data`'s reopen record or its
possible-unrecorded-work record, one item per write, and re-read the rows
written. A reopen is answered "stands", "corrected" or "written off",
never "rejected": a rejected successor would leave the span with no live
terminal proposal, so a later run would flag it again. A partial answer
(only the last ten minutes were matter X) is recorded as corrected, with
the split stated in the practitioner note for the practitioner to apply by
hand, because the successor copies the old span and Step 7 cannot split
entries. A corrected or written-off reopen of a written-back proposal goes
through Step 7, one entry at a time with its own approval. Where the old
proposal was entered by hand, the practitioner edits his hand-made entry
himself, and the successor gets the manual-completion record on his
confirmation. An answer that the old categorization stands is recorded like
any other but needs no TimeCamp write.

## Presumption lifecycle — summary

Full mechanics live in the design doc; the operational summary a session
needs:

- **One presumption per identifier, ever** — channel-forked variants (the
  same person's name via Teams vs. email, tracked as two separate
  presumptions) are forbidden. Either the identifier discriminates on its
  own or it isn't presumption-eligible.
- **Counting**: one instance proves nothing; two confirmed instances make a
  pattern; the standing-presumption offer comes on the third occurrence,
  gated on ≥99% observed correlation.
- **Presumptions are defaults for ambiguous blocks only — evidence always
  wins.** Direct evidence pointing a specific block elsewhere commits to
  that conclusion regardless of any standing presumption covering the same
  identifier.
- None of the six regression fixtures exercises the third-occurrence offer
  or drift-suspension paths directly — implement per the design doc's
  spec, and expect the first live exercise of those paths in a later
  walkthrough, not in this build's own verification pass.

## Queries

| Question | How to answer |
|---|---|
| Categorize today's amber entries | Full workflow, target=today. |
| Categorize {date}'s entries | Full workflow, target={date}. |
| Verify against fixture {E2E test file} | Seed the timecamping database's source tables and fetch log directly from that fixture's documented data (bypassing live Steps 1-2), then run Steps 3-7 unmodified and diff the result against that fixture's "Expected output"/"Pass criteria" sections. Any ceremony the run would trigger is answered with that fixture's own documented answer, labeled `SIMULATED` in the output — this checks the pipeline's logic and the ceremony's rendered content, not whether a human actually saw it; run at least one ceremony-heavy fixture fully live with the practitioner periodically to confirm the presentation itself, not just the logic. |
| Show me today's pending write-backs | Step 7's report only — do not re-run Steps 1-6 if today's proposals already exist and no source has been re-fetched since. |
| What unbilled time is on {date}? | Full workflow, target={date}, Steps 1-6 unmodified, gate included; answer with Step 7's **Possible unbilled time** list alone. If {date}'s proposals already exist and no source has been re-fetched since, report that list without re-running Steps 1-6. |
| I entered {uncovered block} in TimeCamp by hand | Step 7's manual-completion record for that one proposal, then Step 7's report. Ask which proposal if the practitioner's words match more than one. |
| Backfill {sources} on closed {dates} | The Backfill subsection after Step 7, one date at a time. |
| Why did entry {id} get proposed for {matter}? | Read that proposal's evidence chain and rationale back verbatim — never re-derive or paraphrase from memory. |
| What presumptions are active? | List approved presumptions with their identifier, matter, and running correlation; flag any suspended ones and why. |

## Integration with other skills

| Skill | How it integrates |
|---|---|
| **build-timeline** | Delegated ingester for TimeCamp computer-activity, Telus, Google Calendar, iCloud calendar and sent-mail rows (Step 2) — this skill never fetches those five sources independently. |
| **time-sorting** | Source of the synced TimeCamp task tree this skill reuses for identifier resolution (Step 5); also the first-run onboarding handoff (Step 0). The exact division of labor between time-sorting's raw-activity classification and this skill's TimeCamp-entry correction is not yet fully settled — see Critical Constraints. |
| **time-entry-drafting** | Not called by this skill directly. A corrected, matter-assigned TimeCamp entry is downstream input time-entry-drafting could eventually draw on, but that integration is not built here. |
| **show-me** | Every Step 6 ceremony and every presumption-lifecycle ceremony goes through this skill, never a hand-rolled question. |
| **bill-client** | This skill generalizes bill-client's Step 9a single-source Telus cross-check to every registered source and every entry; bill-client's own Step 9a folds into this skill once it exists in production use, per the design doc. |

## Critical constraints

- **No write-back without explicit, per-entry practitioner approval, ever**
  — Step 7 is dry-run by default regardless of how confident a proposal is;
  a silent *commit* (Step 6) is never a silent *write* (Step 7).
- **TimeCamp only through the `timecamp` connector.** Every TimeCamp read and
  write goes through its tools. If its `status` reports the API unusable,
  stop and tell the practitioner why (no token, auth refused, network).
  Never open the TimeCamp web app as a substitute.
- **The TimeCamp write-back is confirmed for matter + note only** (live,
  2026-09-22, `reference/TimeCampEntries.md`). A write is confirmed by
  re-reading the entry, never by the PUT's own response. Any other field
  (duration, times, billable) is unverified: do not send it. Creating an
  entry is unverified too, so uncovered time is reported, never created.
- **Never conclude anything from a single source's view.** This is the
  whole design's reason to exist — Step 3's gate is what makes this a
  structural guarantee rather than a hope.
- **A source's own categorization is never itself corroborating evidence.**
  TimeCamp's amber/existing label, a calendar entry — these are indirect,
  always, and the ceremony grid never lets repetition alone promote them.
- **The relationship to `/time-sorting` is genuinely open.** Both skills
  apply an evidence-reliability hierarchy to reach a matter conclusion, over
  related but distinct objects (raw, uncategorized activity vs. TimeCamp's
  own existing entries). This is not something to resolve unilaterally in
  this file — flag it to the practitioner if it becomes confusing in
  practice, rather than silently picking a resolution. One part is settled:
  the practitioner placed the uncovered-time check here, not in
  `/time-sorting` (#939, 2026-09-24).
- **Never fabricate a field a live source doesn't actually return.** Both
  new reference files (`TimeCampEntries.md`, `SyncoPaidCaptures.md`) name
  exactly what's confirmed vs. still open — extend a schema additively
  through the gatekeeper skill's migration process when a live check
  reveals more, never by guessing ahead of verification.
