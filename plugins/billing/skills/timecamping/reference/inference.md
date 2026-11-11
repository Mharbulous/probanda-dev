Read when: Step 4 reads the consolidated day and Step 5 groups it into blocks and proposes a matter for each, or a change to either is verified against a fixture.

# Reading the day and the inference pass

## Step 4: the consolidated lines

The consolidated read returns every
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

The same read also returns a block of **standing facts** ahead of the
time-ordered lines, which `/timecamping-data` defines (A standing fact is
not an event). A number is stored E.164 (`+16045550172`), so normalize a
number written in another format elsewhere — a calendar description's
`+1 604-555-0172` — before matching it against the directory. A source whose
own rows all fall outside the target day, and whose status for the day is
therefore `skipped`, still contributes here: `skipped` means "no events this
day," never "contributes nothing."

## Step 5: presumptions, evidence doctrine and uncovered time

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
  shown to the practitioner with the date's coverage report and never asked
  from memory beyond show-me rule 4 — never silently included, excluded, or
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
  at ingest — `build-timeline/SKILL.md` (`raw_type`) forbids inferring a type from
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
   times it repeats (see the ceremony grid, row 6/9, in `SKILL.md` Step 6).

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

A backfill (`backfill.md`) is not a re-run and supersedes nothing. Before
grouping, read the day's written-back and entered-by-hand spans through
`/timecamping-data`. Time an entered-by-hand proposal spans counts as
covered, so a re-run never flags it again, whether or not the re-fetched
entries already show the hand-made entry.

## Step 6: a no-data stretch

A stretch with no line from any source may hide court, a site visit or a
witness meeting, so it is searched before anything is concluded (the
practitioner, 2026-11-11).

1. **Verified, or not no data.** A stretch is no data only when every source
   was read for the date: each is under PRESENT in the date's coverage
   report. A source under MISSING (skipped, failed or not fetched) is not an
   absence. Fetch it again through Step 2 if you can. While it stays MISSING,
   the stretch is unread, never empty, and its ceremony names that source as
   the reason the stretch is unknown.
2. **Narrow by the day.** From Step 4's lines, take the files with any
   activity that day, even a minute: a matter a line names or a TimeCamp
   entry sits on. That is usually 3 or 4 files. Search only those, never the
   whole practice.
3. **Search those files** with `/triage-billing-dates` Phase 2's procedures,
   limited to them and to these windows:
   - *Calendars* (its Calendar bullet), for the date: court appearances and
     appointments, including all-day events.
   - *Mail, sent and received* (its Mail bullets, deduplicated, a truncated
     search narrowed and run again), from 3 days before to 3 days after the
     date: anything about a hearing, a site visit or a witness meeting.
   - *Disbursements and receipts* (its Documents bullet, the receipts and
     disbursements folders, dated the same way), and receipts in that mail,
     for something at the stretch's time, such as courthouse parking.
   Save each hit to the evidence store as Phase 3 of that skill saves a
   row (`time_pipeline__set`, namespace `evidence`, key
   `<family>:<native id>`), metadata only.
4. **Something found** becomes a block resting on that evidence, cited in
   its evidence chain. The evidence is indirect, so the block always takes a
   ceremony, and the ceremony asks about the evidence shown, never about
   memory (show-me rule 4: no memory question about an event more than 60
   hours old).
5. **Nothing found.** The stretch stays **t.b.d.** (P6), a ceremony on the
   data shown, reported as SyncoPaid or TimeCamp not running because of a
   technical glitch. It is never written off and never dropped without the
   practitioner's answer (ruled by the practitioner, 2026-11-11). A stretch
   left unread under item 1 is not reported as a glitch.

## Verifying against a fixture

| Question | How to answer |
|---|---|
| Verify against fixture {E2E test file} | Seed the timecamping database's source tables and fetch log directly from that fixture's documented data (bypassing live Steps 1-2), then run Steps 3-7 unmodified and diff the result against that fixture's "Expected output"/"Pass criteria" sections. Any ceremony the run would trigger is answered with that fixture's own documented answer, labeled `SIMULATED` in the output — this checks the pipeline's logic and the ceremony's rendered content, not whether a human actually saw it; run at least one ceremony-heavy fixture fully live with the practitioner periodically to confirm the presentation itself, not just the logic. |
