---
name: timecamping
description: Use for "correct my TimeCamp entries", "categorize today's amber entries", "fix my time tracking for {date}", "what unbilled time is on {date}", reviewing or correcting TimeCamp assignments, or working a matter's candidate dates for /bill. Does not classify raw activity into a first cut (/time-sorting), bill (/bill) or create a time entry.
dependencies:
  - timecamping-data        # timecamping.db: source tables, the assembly gate, proposals, determinations, presumptions
  - build-timeline           # delegated ingestion for TimeCamp computer-activity, Telus, Google Calendar, iCloud calendar and sent-mail rows
  - show-me           # every ceremony in Step 6 and the presumption lifecycle
  - practice-data            # matter_lookup for identifier -> matter resolution
  - time-sorting             # first-run handoff; reuses its TimeCamp task-tree sync rather than refetching
---

<!-- billing v0.4.8 -->
> **Installed copy.** This skill's full source tree ships beside this file, and a relative path in the text below cites that tree. Resolve one by trying, in order: the directory of the file you are reading, then `${CLAUDE_SKILL_DIR}/<path>`, then `${CLAUDE_SKILL_DIR}/../<path>` (so `shared/x.md` is at `${CLAUDE_SKILL_DIR}/../shared/x.md`). `${CLAUDE_SKILL_DIR}` is the directory holding this SKILL.md, even where it shows unsubstituted: never search for it or guess. Read references and shared files from there with the Read tool, a whole file or an offset and limit, never with a shell command, the litigation data server's skill-source tool or a folder-access request; scripts and templates the text declares are executed and read from there too. Before each fresh read (a file not already in context), list only `${CLAUDE_SKILL_DIR}/../../..` (the folder holding this plugin's folder). If it holds this plugin's folder name, with any `~g<N>` suffix removed, plus a `~g<N>` higher than this plugin's folder's own (none counts as 0), or if `${CLAUDE_SKILL_DIR}` no longer exists, the plugin was re-synced mid-session: take the highest `~g<N>` copy and repeat the same three tries with its `skills/<this skill>` directory in place of `${CLAUDE_SKILL_DIR}`; tell the user once that the plugin updated mid-session, from the version in this file's version comment to the version in that folder's copy of this SKILL.md. If a file the text names is missing at every one of those paths, including the re-synced folder's, STOP and report the exact path and error to the user rather than substituting an alternative: do not re-derive a script's logic from its source text or the prose, and do not search elsewhere on the filesystem. Ask the user to reinstall the plugin and fully restart the app; this may fix it, but STOP means stop regardless: do not diagnose further yourself.
> **HTML pages.** Every HTML file this plugin writes is a human interface generated from its databases; an agent never views, reads, greps, parses, scripts over, authors or requests a screenshot of one, but may present one to a human user to view, staging it first where presenting needs that, and may view a screenshot the user provides on their own initiative. The rule and the data to use instead: `shared/html-pages.md`.

## Contents

| Section | Read when |
|---|---|
| Critical constraints | Always |
| Scope | Deciding whether a request falls inside this skill |
| Workflow | Every run: Steps 0 to 7. Step 2 reads `reference/sources.md`, Steps 4 and 5 `reference/inference.md`, Step 6's presumptions `reference/presumptions.md` |
| Queries | The practitioner asks one of the listed questions. A Backfill reads `reference/backfill.md` |
| A candidate list | `/bill` opened this skill, or the practitioner gave a matter's candidate-dates file |

This skill deliberately carries no `disable-model-invocation` line: `/bill` opens it through the Skill tool, which refuses a skill carrying that line. It is a stated exception. Do not add the line back. It never starts a correction unasked: the bill starts only when the practitioner types it, and nothing is written to TimeCamp until the practitioner says to commit (Step 7).

# Timecamping

Correct a lawyer's own pre-categorized TimeCamp time entries by assembling
every available evidence source into one time-ordered picture *before*
inferring which client matter a block of time belongs to, then writing
approved corrections back to TimeCamp as the system of record. The same
evidence also flags uncovered time: client work that no TimeCamp entry
covers, reported for the practitioner to enter by hand.

**The governing principle — read `source/skills/timecamping/VISION.md`
before touching this skill's logic:** inference is forbidden until evidence
assembly is complete, enforced by pipeline structure, not by asking the
model to wait. An LLM shown one source at a time infers confidently and
wrongly from whatever it's handed; the fix is controlling what it sees and
when, not hoping it holds back.

## Critical constraints

- **No write-back until the practitioner explicitly says to commit, ever** —
  Step 7 is dry-run by default regardless of how confident a proposal is;
  a silent *commit* (Step 6) is never a silent *write* (Step 7).
- **The TimeCamp write-back is confirmed for matter + note only** (live,
  2026-09-22, `reference/TimeCampEntries.md`). Any other field
  (duration, times, billable) is unverified: do not send it.
- **The relationship to `/time-sorting` is genuinely open.** Both skills
  apply an evidence-reliability hierarchy to reach a matter conclusion, over
  related but distinct objects (raw, uncategorized activity vs. TimeCamp's
  own existing entries). This is not something to resolve unilaterally in
  this file — flag it to the practitioner if it becomes confusing in
  practice, rather than silently picking a resolution. Two parts are settled:
  the practitioner placed the uncovered-time check here, not in
  `/time-sorting` (#939, 2026-09-24), and for billing this skill is the only
  judge of a block's matter, with `/time-sorting` kept for its task list
  (Brahm, 2026-11-02).

## Scope

This skill corrects **TimeCamp's pre-categorized time entries** — the
amber/green colored timesheet blocks, not raw computer-activity tracking.
It checks every entry against every registered evidence source, not just
phone-labeled entries against the phone log.

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
`Telus calls: skipped — no archive covers this date`. A registry-disabled `timecamp`
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
rests on a stretch SyncoPaid covers, pick at least the first, a middle and
the last capture, and more wherever the window title moves between matters.
A stretch whose captures carry no OCR text is where the image matters most.
`scripts/screenshot_pick.py pick --captures <the stretch's captures>` makes
the pick: the first, a middle and the last capture, and each capture where the
window title changes, grouped 5 to a dispatch. Decrypt them as
`reference/SyncoPaidCaptures.md` says. The reader looks first:
`billing:screenshot-reader` views them, up to 5 per dispatch, passing no
model or effort. `billing:day-reviewer` opens an image itself only after the
reader's answers leave a doubt about a block. A failed decrypt is disclosed in
the ceremony.

**Look up before you dispatch, save after.** A capture is read once. Before
decrypting or dispatching, call `time_pipeline__get` with namespace `item` and
key `capture_reading:<capture id>` for each chosen capture, and use the saved
reading of every capture that has one: skip it, send the reader only the
captures with no record. The report's UNCHANGED line compares an image with the
one before it in that dispatch's brief, and is saved as reported. After a reader reports, save each
capture's block, as the reader reported it, with `time_pipeline__set`:
namespace `item`, key `capture_reading:<capture id>`, `expect_absent: true`,
value a JSON object `{"kind": "capture_reading", "capture_id", "read_at",
"reading": {"on_screen", "identifiers", "unchanged", "unreadable"},
"answers": []}`. A `stale_write` means another run saved that capture first:
read it with `time_pipeline__get` and use that one. A later answer about a
capture (the practitioner's, or a question the reading raised) is appended to
that record's `answers` list: read it, add the answer, and save with
`expect_sha256` from the read. The `reading` is never changed.

Record the viewed capture ids in the proposal's evidence record. A proposal
resting on a covered stretch without them is not ready to commit.

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
just without a blocking question. Each ceremony, a presumption offer
included, is one decision that `Skill (show-me)` presents, with the block's
screenshots and the blocks around it. A block with no screen captures shows
Step 4's lines for it and the blocks around it, verbatim in a code block, and
discloses the missing captures as a gap.

### Step 7: Write-back — dry-run by default

Produce a report of every proposal now ready to write back — silent commits
included — and of every uncovered proposal, and **stop there** until the practitioner explicitly says to
commit.

When the practitioner says to commit, write the entries **one at a time**. No
pasted approval is asked: the original evidence stays on file, and a note is
not primary evidence, so a wrong write can be rebuilt. The request is
`reference/TimeCampEntries.md`'s confirmed write, the `timecamp` connector's
`update_entry` (entry id, the matter's TimeCamp `task_id`, the Step 5 note).
Call the connector's `status` first: if it reports the API unusable, stop,
send nothing, and tell the practitioner its reason. Never open the TimeCamp web
app to make the change instead.

1. Skip an entry and say so if it is `locked` = `"1"` (invoiced), or if its matter
   does not resolve to exactly one TimeCamp `task_id` in the synced task
   tree. Also skip any proposal, from any rule, whose target task has
   `level` 1 in the synced task tree, with the reason: "Skipped: target task
   `<name>` (`<task_id>`) is a top-level project (level 1); TimeCamp's API
   refuses time on that level (403). Move it by hand in TimeCamp, or choose
   a child task." This rests on one refused write, to `PERSONAL` (#1097);
   every successful write so far went to a level-2 task. The entries left
   are the list.
2. For each entry on the list, in order: call `update_entry` with its
   request, then re-fetch that date with the connector's `entries` and
   compare the entry's `task_id` and `description` with what was sent. A
   non-200, or a re-read that does not match, stops the whole write-back:
   report it and send nothing further.
3. Report each entry written: its id, date and time, old task → new task
   (name and `task_id`) and the whole note.

Any entry skipped or not sent stays in the dry-run report, which the
practitioner can still apply by hand.

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

## A candidate list

Given a matter's candidate-dates file, run Steps 0 to 7 once per date, in this order: Strong, then Medium, each oldest first. Then offer the Weak dates once as a group, and work them only on a yes. A date marked `Staff` alone is not worked, because this skill judges only the practitioner's own time.

- **Recheck the matter's own entries.** This run reviews the entries already on the matter's task as well as the default queue. Being opened with a candidate list is the practitioner-directed recheck `reference/TimeCampEntries.md` describes.
- **Holder.** `/bill` passes its bill id as the holder. A candidate-list run with no bill uses `timecamping:<UTC stamp>`, made once at the start. The `review_date__*` tools are on this plugin's `timekeeping` server, under whichever of `mcp__plugin_billing_timekeeping__<name>` and `mcp__remote-devices__plugin_billing_timekeeping__<name>` this host grants.
- **For each date, in the list's existing order:**
  1. Call `review_date__claim` with the date and the holder.
     - `judged`: do not review the date. Add it to the "already judged" list with `judged_by`. Go to the next date.
     - `held`: do not review the date and do not wait. Add it to the "held" list with `holder` and `expires_at`. Go to the next date.
     - `claimed`: keep the `token` for this date and go on.
  2. Run Steps 0 to 7 for the date. Call `review_date__renew` at three fixed points: when the Step 3 gate passes, when Step 5's screenshot reading returns, and after each answer the practitioner gives at Step 7.
     - `claim_lost` from any renew: stop work on this date, write nothing more for it, and report it as taken by another run.
  3. When the date meets the judged condition (no proposal is `pending`, and Step 7 is answered for each entry), call `review_date__judge`.
     - `claim_lost`: report the date as left without a mark, taken by another run. Do not retry.
  4. When the date stops at the Step 3 gate or on a failed source, call `review_date__release` and report it, then go on to the next date.
  5. After the last date, call `review_date__claim` once more for each date on the "held" list and work those now claimed. A date still `held` is reported as left without a mark, with its holder and expiry.
- **The run never appends to `judged-dates.jsonl`.** A session that loses its token (a crash) cannot renew, so its claim lapses within 60 minutes and the date becomes claimable again.
- **No duplicate proposals.** Before writing a date's proposals on a re-run, read its live proposals. Keep one that has the same span and matter, whatever has been answered about it.
- **Calls in window titles.** For each match in `<matter-data folder>\triage-billing-dates\phone-matches.json` on this date, save a `call_window` row to `/timecamping-data`'s evidence store and cite it in the block's evidence chain. A match off the matter's task or with no entry is direct evidence of a call on the matter: propose it as a block on the matter, for a ceremony. A title that is only a number names no matter by itself, so the service list is what ties it.
- **What the practitioner says.** Save a statement about a date or matter that the evidence does not hold ("I know I called the client that day") verbatim as a `statement` row, with when it was said, and cite it. Save a ruling that a window pattern is never billable as a `marker` row: the pattern, the ruling verbatim and when. A pattern holds no client content.
- **At the end,** return the Possible unbilled time list across all the dates, the "already judged" list, and each date left without a mark and why.

### Parallel mode

Not called by `/bill` yet. It judges a candidate list's dates with `billing:day-reviewer` agents and puts no question to the practitioner. A date's blocks are staged by its reviewer through `time_review__stage_day`, and a question about one waits for the page that shows the staged day.

1. **Order.** Export the matter's `candidate_date` records (`time_pipeline__export`, namespace `item`, prefix `candidate_date:<matter>:`) and call `review_date__status` for the dates. Run `scripts/day_plan.py order --records <export> --status <status reply>`. Its `order` is the days to review, strongest candidate first, then earliest. A day it lists under `judged` is read from the stored blocks. A day under `held` is skipped now and asked for again, with `review_date__claim`, once the holder has judged it.
2. **Gather, one date at a time.** For each day in `order`, in order, call `review_date__claim` (holder as above) and keep the token. Run `/build-timeline` for that one date, through the seven-source gate. Then call `time_review__save_evidence` with every source's outcome and the day's rows. A day whose gate does not pass is released with `review_date__release` and reported.
3. **Pick and read screenshots.** For each stretch of the day that SyncoPaid covers, run Step 5's pick and have `billing:screenshot-reader` read it, saving each reading as Step 5 says. Write the day's readings to a file for the reviewer.
4. **Dispatch.** Start at most 10 `billing:day-reviewer` agents at once, in the background, one per claimed and gathered day. The brief names the date, the token, the paths of `reference/inference.md` and `reference/presumptions.md`, the readings file, and the standing presumptions approved when the run began. Run `scripts/day_plan.py next --order <plan> --in-flight <dates running> --done <dates returned> --limit 10` each time a reviewer returns, and start the days it names.
5. **Renew** each running day's claim with `review_date__renew` when its reviewer is dispatched and every 20 minutes after.
6. **Judge.** A reviewer's first line is `status: staged ...` when its blocks are staged. Then call `review_date__judge` with the date and its token. Any other status is reported for that date with no judge call: `held`, `judged` or `claim_lost` mean another run has the day, and `evidence_missing`, `evidence_short` or `failed` release the claim.
7. **Presumptions.** A reviewer applies the presumptions approved at the start of the run and offers none. Counting confirmations and offering a new presumption wait until every day is judged, run in date order over the stored blocks. That count is not built yet, so a new presumption is not offered in this mode.

Two bills that share dates judge each date once: the second finds it `judged` or `held` at the claim, and the staged blocks it reads are the first bill's.

**On resume,** for each date that is already judged, fetch its TimeCamp entries again with the connector's `entries` and call `time_review__compare_day` with the date and every entry (`id`, `start`, `end`, `task`, `note`). Judging saved the fingerprint of the entries it judged. `changed` means an entry was changed, added or removed since: the block citing a changed or removed entry is back to flagged, an added entry has a new flagged block, and the day is no longer clear. Every other block keeps its approval. Say which dates changed, then serve the page so the practitioner judges the flagged blocks. `unchanged` needs nothing. `no_fingerprint` means the date was judged before fingerprints were saved: compare nothing and say so.

### The review page

Not called by `/bill` yet. The `timecamp` connector's tools are under whichever of `mcp__plugin_billing_timecamp__<name>` and `mcp__remote-devices__plugin_billing_timecamp__<name>` this host grants. A fixed page shows every staged block from the store, with no model drawing it: each card holds the matter, the description, the times, the state and flags, the evidence rows, the screenshot slideshow and each saved reading. It has a date picker, a matter filter, Previous, Next and Next flagged (which honours the matter filter), and on every card the Approve, Correct and Write off buttons. A click on one is saved to its block by the page itself before you hear of it: the act, who, when and, for a write-off, the reason. A block records an approval from nothing else, so never record or imply one yourself. A day reads as clear (`clear` in `time_review__read_day`) when it is judged and no block on it is flagged. Each card also has Split here (at the screenshot on show), Merge with next and Unsplit or Unmerge. They make new flagged blocks and keep the originals, linked, so they can be undone until the time is on an issued invoice.

- **PC only.** The page is served from the PC and shows screenshots from the `syncopaid-screens` folder. In Cowork, stop where the run stops today and say that the page is served on the PC only; do not try to serve it.
- **Serve.** Call `time_review__serve_page` with `screens_dir`, the absolute path of the `syncopaid-screens` folder the screenshot reader reads from (leave it out and the cards show no images). Give the practitioner the `url` to open in Chrome. Serving drops every earlier page. Never open, read or describe the page or an image on it: the page is for the practitioner's eyes (`shared/html-pages.md`).
- **Wait.** `time_review__wait_click` returns the oldest click on the page, or `pending` after about 45 seconds, when you call it again. Keep calling it while the practitioner reviews. For a click whose `act` is `approve` or `correct`, in order:
  1. Read the block with `time_review__read_day` (its `date` is the first ten characters of the block id). Use the block's saved matter and description.
  2. A staff entry's TimeCamp note is the staff member's: do not write it. Call `time_review__record_timecamp` with the block and `staff_left_alone`, and go on. A block counts as staff when its `bill_basis` holds `staff_inferred` or the TimeCamp row its evidence cites belongs to a user other than the practitioner.
  3. Otherwise fetch the block's TimeCamp entry with the connector's `entries`. If its `task_id` and `description` already equal the block's matter's `task_id` and description, record `unchanged`. If the entry is `locked` = `"1"`, or the matter does not resolve to exactly one `task_id`, or the block cites no TimeCamp entry, record `error` with that reason.
  4. Otherwise run Step 7's write, for this one entry: call the connector's `status` (if it reports the API unusable, record `error` with its reason and send nothing), then `update_entry`, then re-fetch the date with `entries` and compare `task_id` and `description` with what was sent. Record `saved` when they match, passing `entry` (the re-read entry's `id`, `start`, `end`, `task` and `note`), so the day's fingerprint takes your write and the next resume does not report it. Record `unchanged` the same way. A non-200 or a re-read that does not match is recorded as `error` with what came back, and never retried on its own.
  5. For `write_off` there is no TimeCamp write: go on.
  6. For `split`, the page has already made two new flagged halves, kept the original and linked them, and `blocks` names the halves. Call `time_review__read_day` once and draft each half from what it returns: the day's saved `evidence` rows and the saved `readings` of the screenshots the half cites. Write each description in bill style, as `billing:day-reviewer` does. Never open, view or describe an image, and never dispatch `billing:screenshot-reader` for a split: if the saved evidence and readings do not settle the matter or the description, say what is missing in the description's place and leave the half flagged. Save each half with `time_review__redraft` (its `block`, `matter` and `description`). A half stays flagged until a click approves it.
  7. A `merge` or `undo` click needs nothing from you: the page joined the descriptions with "; " by script, or returned the originals, flagged. `blocks` lists the blocks it made or restored. None of split, merge or undo writes to TimeCamp, and none can be undone once the time is on an issued invoice (`/issue-invoice` marks the blocks with `time_review__mark_issued`).
  A click that names no block, or an act you do not know, is ignored.

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
