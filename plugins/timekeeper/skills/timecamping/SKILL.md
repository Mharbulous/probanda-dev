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

<!-- timekeeper v0.3.1 -->
> **Installed copy.** This skill's full source tree ships beside this file, and a relative path in the text below cites that tree. Resolve one by trying, in order: the directory of the file you are reading, then `${CLAUDE_SKILL_DIR}/<path>`, then `${CLAUDE_SKILL_DIR}/../<path>` (so `shared/x.md` is at `${CLAUDE_SKILL_DIR}/../shared/x.md`). The host substitutes `${CLAUDE_SKILL_DIR}` with the directory holding this SKILL.md when this file loads; if the literal text `${CLAUDE_SKILL_DIR}` is what you see, that IS the definition: it means the directory containing this SKILL.md, not a placeholder to search for or guess. Read references and shared files natively from there, never over the litigation data server's skill-source tool and never by requesting folder access; scripts and templates the text declares are executed and read from there too. If `${CLAUDE_SKILL_DIR}` itself no longer exists, the plugin was re-synced mid-session: list only `${CLAUDE_SKILL_DIR}/../../..` (the folder that held this plugin's folder), take the folder named as this plugin's folder with any `~g<N>` suffix removed plus the highest `~g<N>`, and repeat the same three tries with its `skills/<this skill>` directory in place of `${CLAUDE_SKILL_DIR}`; tell the user once that the plugin updated mid-session, from the version in this file's version comment to the version in that folder's copy of this SKILL.md. If a file the text names is missing at every one of those paths, including the re-synced folder's, STOP and report the exact path and error to the user rather than substituting an alternative: do not re-derive a script's logic from its source text or the prose, and do not search elsewhere on the filesystem. Ask the user to reinstall the plugin and fully restart the app; this may fix it, but STOP means stop regardless: do not diagnose further yourself.
> **HTML pages.** Every HTML file this plugin writes is a human interface generated from its databases; an agent never views, reads, greps, parses, scripts over, stages, authors or requests a screenshot of one, but may present one to a human user to view, and may view a screenshot the user provides on their own initiative. The rule and the data to use instead: `shared/html-pages.md`.

## Contents

| Section | Read when |
|---|---|
| Critical constraints | Always |
| Scope | Deciding whether a request falls inside this skill |
| Workflow | Every run: Steps 0 to 7. Step 2 reads `reference/sources.md`, Steps 4 and 5 `reference/inference.md`, Step 6's presumptions `reference/presumptions.md` |
| Queries | The practitioner asks one of the listed questions. A Backfill reads `reference/backfill.md` |

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
when, not hoping it holds back.

## Critical constraints

- **No write-back without explicit, per-entry practitioner approval, ever**
  — Step 7 is dry-run by default regardless of how confident a proposal is;
  a silent *commit* (Step 6) is never a silent *write* (Step 7).
- **The TimeCamp write-back is confirmed for matter + note only** (live,
  2026-09-22, `reference/TimeCampEntries.md`). Any other field
  (duration, times, billable) is unverified: do not send it.
- **The relationship to `/time-sorting` is genuinely open.** Both skills
  apply an evidence-reliability hierarchy to reach a matter conclusion, over
  related but distinct objects (raw, uncategorized activity vs. TimeCamp's
  own existing entries). This is not something to resolve unilaterally in
  this file — flag it to the practitioner if it becomes confusing in
  practice, rather than silently picking a resolution. One part is settled:
  the practitioner placed the uncovered-time check here, not in
  `/time-sorting` (#939, 2026-09-24).

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
  `/build-timeline` (`reference/sources.md`), reusing the existing
  ingester rather than duplicating its fetch logic.
- Classify raw, never-before-categorized activity into a first cut — that
  remains `/time-sorting`'s job. This skill's object is TimeCamp's *own*
  existing entries, which already carry a task assignment (even if it's an
  amber placeholder), plus the uncovered time above; the relationship
  between the two skills' jobs is not fully settled and is flagged in
  Critical constraints.
- Draft UTBMS billing codes or produce invoice-ready descriptions in the
  full `/time-entry-drafting` sense — it writes a corrected TimeCamp note in
  the note grammar of `reference/inference.md` (evidence doctrine item 8), nothing more.

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
fetched and gated per-day, never as a wider range).

### Step 2: Populate per-source tables

A day's evidence reaches the database as **one ingest file and one bulk
ingest**, and no source row passes through this session's context: each
source's material goes to a file, the gatekeeper's `build_ingest.py` converts
it, and only the script's one-line summary comes back. Follow
`reference/sources.md` for the seven sources, the procedure and every
source's exit statuses.

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
`/timecamping-data` documents the line format it returns. How to read the
lines, including standing facts: `reference/inference.md`.

**Read the whole day, or stop.** The first line is a header stating how many
lines follow and how many characters they hold. If its character count is
over 400,000, halt: report the date, the character count and the line count
for the practitioner to decide, and do not proceed on a partial read.
Otherwise read every line before Step 5; if the result spills to a file, page
through it to the end. The header counts `line` values, not lines of the file:
a spilled result is pretty-printed JSON, where each `line` value takes several
lines of the file, so check that you read as many `line` values as the header
states.

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

Before grouping, read `reference/inference.md`: the presumptions P1–P10,
the evidence doctrine, uncovered time and the re-run rules.

Output is a proposal per block — matter, note, evidence chain, and which
family of the ceremony grid it falls into (below) — never a commit.

### Step 6: Confidence-gated ceremony

For each proposed block, evaluate its evidence and any matching presumption
against this grid:

| Situation | Action |
|---|---|
| Direct evidence carries the conclusion outright (its content names the matter) | **Silent commit.** No presumption needed, none can override it. |
| A direct-evidence identifier→matter leap, first or second occurrence | **Ceremony.** One or two instances is not yet a pattern. |
| Same leap, third occurrence at ≥99% observed correlation | **Ceremony**, plus a **separate** ceremony offering a standing presumption — never bundled into the categorization question itself. |
| Same leap, an approved standing presumption already covers it | **Silent commit** under the presumption — but only when no other approved presumption also matches this block (void-on-overlap, `reference/presumptions.md`). |
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

### Step 7: Write-back — dry-run by default

Produce a report of every proposal now ready to write back — silent commits
included — and of every uncovered proposal, and **stop there** until the practitioner explicitly says to
commit.

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

## Queries

| Question | How to answer |
|---|---|
| Categorize today's amber entries | Full workflow, target=today. |
| Categorize {date}'s entries | Full workflow, target={date}. |
| Show me today's pending write-backs | Step 7's report only — do not re-run Steps 1-6 if today's proposals already exist and no source has been re-fetched since. |
| What unbilled time is on {date}? | Full workflow, target={date}, Steps 1-6 unmodified, gate included; answer with Step 7's **Possible unbilled time** list alone. If {date}'s proposals already exist and no source has been re-fetched since, report that list without re-running Steps 1-6. |
| I entered {uncovered block} in TimeCamp by hand | Step 7's manual-completion record for that one proposal, then Step 7's report. Ask which proposal if the practitioner's words match more than one. |
| Backfill {sources} on closed {dates} | `reference/backfill.md`, one date at a time. |
| Why did entry {id} get proposed for {matter}? | Read that proposal's evidence chain and rationale back verbatim — never re-derive or paraphrase from memory. |
| What presumptions are active? | List approved presumptions with their identifier, matter, and running correlation; flag any suspended ones and why (`reference/presumptions.md`). |
| Verify against fixture {E2E test file} | `reference/inference.md`, Verifying against a fixture. |
