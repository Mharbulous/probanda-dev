Read when: a source registered after a day's proposals were committed must be backfilled on that closed day.

# Backfill: a source registered after a day closed

A source registered after a day's proposals were committed leaves that day
gated (#1270). The backfill fetches and ingests only the sources that day
actually lacks: `/build-timeline`'s "Fetch only {sources} for {date}" row,
then a day file holding only those sources' lines, loaded with one bulk
ingest. iCloud events are owed only through 2026-06-22, so from 2026-06-23
on name sent mail alone. A day lacks sent mail when it has no terminal
sent-mail status, or when its sent-mail fetch predates the four-folder
route fix (commit ff412c4, 2026-10-01). Step 2's per-source confirmation and
exit-status tables (`sources.md`) apply unchanged, and a source whose fetch did not happen
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
  (`inference.md`) items 1-3: `practice_data__matter_lookup`, the synced TimeCamp task tree,
  and verification of an unfamiliar identity at its authoritative source.

Every item is one question, asked one per turn as a ceremony under
`show-me`'s rules (Step 6), the next only after the answer. Record each
answer at once through `/timecamping-data`'s reopen record or its
possible-unrecorded-work record, one item per write, and re-read the rows
written. A reopen is answered "stands", "corrected" or "written off",
never "rejected": a rejected successor would leave the span with no live
terminal proposal, so a later run would flag it again. Where the old
proposal was entered by hand, the practitioner edits his hand-made entry
himself, and the successor gets the manual-completion record on his
confirmation.
