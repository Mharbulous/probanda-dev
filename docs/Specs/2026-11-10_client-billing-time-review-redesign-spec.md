# Faster, defensible client billing: the time review redesign

Decided by the practitioner on 2026-11-10, in an interview reviewing `/bill-client` (billing plugin). This is a spec, not a plan: it states what to build, why, the limits it must respect and what done looks like, and leaves the build order to the plan. The current process is drawn in `docs/diagrams/Built/Client billing.html` (checked against `72c1eb07`). Why the review works a whole day at a time, never one matter, is recorded in `source/skills/timecamping/VISION.md`.

## How to read this spec

The Goals and Success criteria say what must be achieved. Parts 1 to 4 are the design worked out in the interview: ideas that show the intent, not a straitjacket. A planner may find a better way to reach the goals, and should question any requirement here that looks wrong, bringing it to the practitioner, not following it blindly. The flexibility is in the planning. The process the plan produces is not flexible: it is decided in advance, down to the instructions each step follows, so cheap models can run it rigidly.

## Contents

| Section | What it holds |
|---|---|
| Goals | What the practitioner is trying to achieve, drawn from the whole interview |
| Constraints | The limits every part must respect |
| Part 1 | The time review page |
| Part 2 | The candidate list that grows across runs |
| Part 3 | Days reviewed in parallel by a day-reviewer agent |
| Part 4 | Orchestration, so parallel reviews never overwrite each other |
| Rename | /bill-client becomes /bill |
| Success criteria | What done looks like |
| Open points | What is still undecided |

## Goals

The requests share one pattern. Billing moves from a long chat in which the AI works and the practitioner watches and answers, to a pipeline that produces a stored, evidenced record of every block of time, which the practitioner audits on a fixed interface, looking only at the exceptions. Within that:

1. **Defensibility.** Every billed minute can be justified later, to a client or an assessment officer, by opening the block and seeing everything the AI relied on: the screenshots, what was read from them, and the mail, calls, calendar entries and documents behind it. The record outlives the session that made it.
2. **Transparency.** The practitioner can see how each recommendation was reached, and an approval in the record means the practitioner actually looked.
3. **The practitioner's attention goes only where it is needed.** The AI settles what the evidence settles and flags the rest. Review is a fast walk from one flagged block to the next, not a confirmation of every line.
4. **Speed.** A bill with many candidate dates finishes in a fraction of today's time, because days are judged in parallel and the review never stops mid-day to wait for an answer.
5. **Work accumulates instead of being thrown away.** The candidate list, the screenshot readings and each day's judgment are saved once and built on. A repeated run becomes more complete, not a repeat.
6. **Safe under parallel work.** Several sessions or agents can work at once without overwriting each other, and a mistake can be undone up to the point the bill becomes final.
7. **Token efficiency.** A bill costs as few tokens as it can while staying robust and reliable.
8. **Cheap models run it.** Most of the process runs on Sonnet and Haiku, following instructions planned in advance and written to be followed rigidly. Strong models are kept for the few judgments that need them, such as the day reviewer's.

## Constraints

- **Token cost.** Each job runs on the cheapest model that can do it well. Gathering, selecting screenshots and drawing the page are code. Screenshots are read first by Haiku 5.5, never by the judging model. Other raw evidence is reduced by code or a cheaper model. Opus 5.5 is kept for the judgment, and works from the assembled day, not raw files. Nothing is redone that was saved: no second reading of a screenshot, no rebuilding of the candidate list, no second judgment of a day another bill already judged. The costly full re-check runs only on request.
- **Each raw item is read by a model at most once.** What a model concludes from a screenshot or document is saved, so the page and any later redraft use the saved result.
- **Presentation is deterministic.** The review page is a fixed template filled from the database. No model draws, lays out or reads it.
- **The day is the unit of review, never the matter.** Each block of a day goes to exactly one matter, misfiled time shows only in the whole day, and the day gives context for its own blocks. A filter by matter changes only what is shown.
- **The human keeps the decisions.** AI agents propose and never change TimeCamp or the bill on their own. Flagged blocks need the practitioner's action. The lawyer's signature is the final approval of every line.
- **An approval means what it says.** No button records approval of blocks the practitioner did not open.
- **Avoid one-way doors** (Commandment 8). A merge or split stays reversible until the invoice is issued. A merge never deletes or combines TimeCamp entries. Issued records stay locked, and later fixes are adjustments.
- **Client Information stays on the practitioner's PC** (Commandment 3). The review page is a local page opened from a file card, never a hosted artifact. Decrypted screenshots stay on the PC.
- **Local storage does not encode the rulebook** (Commandment 5). New fields and tables are checked against it. Evidence is stored as rows labelled with their source, never one column per source.
- **No lost or overwritten work.** One writer per record, claims that refuse a second claimant, saves that refuse a stale write, and a check on resume for saves that went missing.
- **Keep it simple.** Prefer the design that adds the least machinery. Reuse what exists: the local-page server under `source/lawyer/mcp/src/local-page/` (as the `/housekeeping` approval page uses), `/show-me`, the staging tool the ingest extractors use, and `/timecamping`'s know-how as a skill the agent preloads, so the agent and the human-in-the-loop review read one source.
- **Enforced rules change only on the practitioner's instruction.** Any hook or gate this work loosens is named, with what will no longer be enforced, before the change.

## Part 1: the time review page

### What it replaces

One page replaces both reviews held in chat today: the day review (`/timecamping`, stage 3 of the diagram) and line vetting (`/vet-billable-time`, stage 4). Each time block is one card holding its matter, its invoice description, its duration and its evidence.

### How it is built

- A fixed HTML template, filled by the plugin's server from stored data, under `shared/html-pages.md`: generated from the databases, presented as a file card, never read by a session, its buttons writing through the data server's localhost listener.
- Its buttons work only while a session is open. During a review the session waits on the page, as `/housekeeping` does, and acts when a click needs it.

### Each card shows

- The client and matter (file number and client name), or the non-billable code.
- The invoice description.
- The start, end and duration.
- The evidence: every screenshot of the block in a slideshow the practitioner steps through with left and right arrows, each with the reader's description of it, plus the mail, calls, calendar entries, document metadata, window activity and other rows its evidence chain cites.
- Its state: flagged, approved, auto-assigned (never flagged), corrected, written off, merged or split.

### Navigation

- A date picker.
- A matter dropdown, all matters by default.
- Previous and Next, through blocks in time order within the filter.
- Next flagged: the next flagged block across all matters, or within the chosen matter.

Every block can be opened, flagged or not.

### Actions, on every block

- **Approve.** Records the approval and clears the flag.
- **Correct.** Edit the matter (dropdown), the description and the start and end times. Saving clears the flag.
- **Write off.** Takes a short reason.
- **Split** at a chosen screenshot. The time from that screenshot on becomes a new block. The waiting session at once redrafts the matter and description of both halves from the evidence on file, including the saved screenshot readings, with no new look at any image. Both halves come back flagged.
- **Merge** adjacent blocks. A script joins their descriptions with "; ", with no model. The merged block is a new block. The originals are kept and marked "merged into" it.
- **Unmerge and unsplit,** until the time is on an issued invoice. The originals return exactly as they were and come back flagged, because the approval was for the other version. After issue, the existing issued-record lock makes it final. This needs only a link field and one rule, not a history mechanism.

### What is flagged

A block is flagged when there is doubt about its matter, or about what goes on the bill, and the AI could not resolve it (Part 3, "Doubt"):

- Matter: the cases where the day review holds a ceremony today (`/timecamping` Step 6 grid): the evidence does not name the matter, sources conflict with no covering presumption, the evidence is indirect only (a calendar entry, TimeCamp's own label), or an identifier-to-matter leap no presumption covers yet.
- What goes on the bill: the cases line vetting singles out today (`/vet-billable-time` Steps 5 and 6): a description resting on inference, a duration the evidence cannot bound, no evidence at all, staff time described by inference, a proposed write-off from a non-billable marker, an estimate for unlogged time, and a late line from a date the last bill missed or under-billed.

A block the AI assigned without doubt is shown as auto-assigned.

### When a day is clear

A day is clear once every flagged block on it, across all matters, is approved, corrected or written off. Approving a block never clears another.

### What a bill needs

Only flagged blocks need the practitioner's action before the bill is made. Unflagged blocks go onto the draft invoice as the AI described them. The draft still lists every line, and the lawyer's signature is the final approval.

### TimeCamp

- A change to a block's matter or description is written to TimeCamp at once, when the practitioner clicks Approve or Correct, by the waiting session through the `timecamp` connector's `update_entry`, and read back to confirm, as `/timecamping` Step 7 does today. The card shows "saved to TimeCamp" or the error.
- One text per block: the invoice description, in bill style (`/vet-billable-time` Step 5), is also the TimeCamp note.
- Exception: a staff entry's TimeCamp note is left as the staff member wrote it. Its invoice description lives only in Probanda.
- A merge or split changes Probanda's records only.

### Change needed first: save the screenshot readings

`/timecamping` Step 5 records only the ids of the captures `billing:screenshot-reader` viewed, not what it reported. Save each capture's reading, and each answer to a later question about it, with its capture id, so the page can show them and a redraft can use them without another look at the image.

## Part 2: the candidate list grows across runs

Today every resume rebuilds the candidate-date list from scratch, because `/bill-client` re-runs Steps 6 to 9 whatever was saved. The rule's stated reason is about how the status is worded, not about trusting the saved list (commit `295116df`; `docs/Plans/2026-11-04_bill-client-rerun-audit.md`).

- **What a resume searches.** Every source for the days after the list's last covered date, plus, for the whole period, each source listed under "Unexplored leads" or not reached last time. Saved dates are kept. A new date is added with the date it was found.
- **Where the list lives.** In the time-review database, one row per date: strength, Lawyer or Staff, flags, when found, and links to its evidence rows. The `YYYY-MM-DD Candidate dates` file in `BILLING` is generated from those rows for the practitioner to read. No run parses it back.
- **Changes in TimeCamp after a day is judged.** When a day is judged or cleared, save a fingerprint of its TimeCamp entries (each entry's id, start, end, task and note). On resume, compare each judged day in the bill's period with its fingerprint. An entry added, removed or changed comes back flagged, and the day is no longer clear. The rest of the day keeps its approvals. This replaces the reviewed-day mark that never expires.
- **Lost saves.** On resume, check each listed date against its evidence rows. A date missing rows is searched again for that date alone, and the practitioner is told. Separately, find and fix the cause of the evidence save lost on 2026-11-04 (rerun audit).
- **The status wording stays.** A resume says the list was extended and what was added. It never calls Step 6 done, kept or saved (`/bill-client` "The status").

## Part 3: days reviewed in parallel by a day-reviewer agent

### Why

The day review runs in the main session, one date after another, and stops each day to ask about unclear blocks, so a bill with many candidate dates is slow. Under Part 1 those questions become flags, so nothing needs the practitioner mid-review.

### The pipeline

1. **Gather, in one place.** One step fetches every candidate date's evidence in turn, driven by a script wherever the order is fixed, and each day passes the seven-source gate (`/timecamping` Step 3). Writes to the time-review store and calls to TimeCamp stay here, never in parallel, to avoid lock and rate-limit failures.
2. **Pick the screenshots, by script.** For each stretch: the first, a middle and the last capture, and each capture where the window title changes. This is interim. The choice belongs in the SyncoPaid app at capture time, which knows how long a window was open, which files were recently active, and which captures are plainly personal or empty. That is work in the SyncoPaid repo.
3. **Read the screenshots, with Haiku 5.5 only.** `billing:screenshot-reader` instances in parallel. Each capture's description is saved with its capture id.
4. **Summarize the other raw evidence with code or cheaper models.** File metadata, mail, window activity and other raw items are reduced to rows by a script where possible, else by Sonnet or Haiku.
5. **Judge each day, in parallel,** one day-reviewer agent per date (Part 4 sets the cap), from that day's assembled table: blocks, evidence rows and screenshot descriptions.

### The day-reviewer agent

- A custom agent in the billing plugin, on Opus 5.5 at high effort. Its job is the judgment: each block's matter, and its description in standard firm billing style ("Draft…; consider…; correspondence with…"). It never reads documents or file metadata itself.
- It preloads `/timecamping`'s know-how (the inference reference and presumptions) (CLAUDE.md, "Skills and agents").
- It holds no TimeCamp write tool. It writes the day's blocks, flags and evidence links to a holding area through a tool, as the ingest extractors stage their results, and returns only a status line, for example `2026-10-02: 14 blocks, 3 flagged, 1 source missing`, with an `end:` line. The page reads the rows from the store, so the timesheet never passes through the main session.
- **Doubt.** When a block is unclear, it first asks the screenshot reader specific questions about named captures ("What name appears in the document's heading?"). Only when those answers seem doubtful or unreliable does it open a capture itself, sparingly. A block still unclear after that is flagged.
- Opening a capture itself requires loosening `source/billing/hooks/screenshot-reader-gate.py` for this agent alone. That hook enforces that only the reader views screenshots (commit `99659a15`), so the builder states what will no longer be enforced and gets the practitioner's instruction first.

## Part 4: orchestration, so parallel reviews never overwrite each other

### The problem

Found while billing L145 on 2026-11-10:

1. No date can be reserved. `/timecamping` reads a whole TimeCamp day, so two sessions can judge one date at once and write competing proposals for the same entry, even while billing different matters. L145 and L166 share about 29 candidate dates.
2. The bill record's `time_pipeline__set` overwrites whatever is there, so the last writer wins.
3. `judged-dates.jsonl` is kept per matter folder and written only when a date is finished. It neither spans matters nor marks a date in progress.
4. There is no re-check mode. A judged date is skipped, never checked for errors.

The timecamping database's write lock (`source/lawyer/mcp/src/timecamping/lock.ts`) prevents corruption only.

### Decisions

- **Concurrency.** The orchestrator runs at most 10 day reviewers at once, candidate dates first, strongest first. That leaves room under the session's 20-subagent limit for the readers they question.
- **One status per date, shared by every matter.** The time-review store holds each date's status: not started, in progress (who claimed it and when), judged, clear. It replaces `judged-dates.jsonl` and carries Part 2's fingerprint. A date is claimed through a tool that refuses a second claim, and the claim expires after a set time (for example 2 hours), so a crashed run never blocks a date for good.
- **A date is judged once for every matter.** A bill that reaches a date another bill has claimed moves on to its other dates and uses the judged day when it is finished.
- **The bill record has one writer.** Day reviewers never write it. The orchestrator does, and a save is refused when the record changed since it was read.
- **Re-checking a judged date.** Every time, the fingerprint check (Part 2). On request only, for one date or a whole bill, a fresh day reviewer judges the day again in compare mode: where its result differs from the stored one, the block is flagged, and nothing stored is overwritten.

## Rename: /bill-client becomes /bill

The redesign renames the skill `bill-client` to `bill`, typed as `/bill` (`/billing:bill`). The name is free across the plugins. Every reference moves with it in the same change: the eight shipped files that name `/bill-client` today, `source/assignment.json`, the diagrams, and the scripts and tests under the skill's folder. Skill names are not on CLAUDE.md's permanent-name list, and no user has installed the plugins yet.

## Success criteria

Done means each of these holds, each checked by a test or a recorded run, not by a model's report:

**Defensibility and transparency**
1. From any line of a draft or issued invoice, the practitioner can open its block on the page and see its matter, description, duration, every screenshot and its reading, and every evidence row, all read from the database.
2. Every block's record shows whether the practitioner approved, corrected or wrote it off, or whether it was auto-assigned. No block is recorded as approved that the practitioner did not act on.
3. A fixture for each flag case in Part 1 ("What is flagged") produces a flag, and a fixture where the evidence names the matter produces none.

**The page**
4. The page is generated from the template with no model drawing it, and opens from a file card on the PC.
5. The date picker, matter filter, Previous, Next and Next flagged work, with Next flagged honouring the filter.
6. Approve, Correct and Write off save to the store. A change of matter or description reaches TimeCamp at once and is read back, and a failed read-back shows on the card.
7. Split produces two flagged halves with fresh drafts and no screenshot viewed by any model during the split. Merge joins descriptions with "; " by script. Unmerge and unsplit return the originals exactly, until issue, and are refused after it.
8. A day shows clear exactly when no flagged block remains on it across all matters.

**Cost and reuse**
9. No model views a screenshot to build the page or to redraft after a split. Readings are saved and reused.
10. On resume, sources are searched only for days after the last covered date and for leads left open, and the costly activity scan covers only the new days. The candidate list is read from the database and never parsed from Markdown.
11. A date already judged for one matter is not judged again for another.
12. On the same matter and period, a bill costs fewer tokens than the same bill run the current way, measured on one real bill before and after.

**Speed**
13. Day reviews run in parallel, up to 10 at once, and no question reaches the practitioner during them.
14. On that same measured bill, the time from start to a reviewable page is well below today's time for the same work.

**Safety under parallel work**
15. Two bills sharing dates run at the same time: each shared date is judged exactly once, no proposal is duplicated, and no step row of either bill record is lost.
16. A claim left by a crashed run expires and the date can be claimed again.
17. A TimeCamp change made after a day was judged comes back flagged on the next resume, and the rest of the day keeps its approvals.
18. A listed date with missing evidence rows is detected on resume and searched again. The cause of the 2026-11-04 lost save is found and fixed.
19. A full re-check on request flags differences and leaves every stored judgment unchanged.

**Cheap, rigid execution**
20. Every step except the day reviewer's judgment runs on Sonnet, Haiku or code, from instructions written before the run, and a run on a real bill completes on those models without a stronger model stepping in.
21. `/bill` replaces `/bill-client`, and no shipped file names `/bill-client`.

## Open points

- **Sequencing with Phase 2.** `docs/Plans/2026-11-10_data-store-restructure-phase-2.md` merges `timecamping.db` into `time_pipeline.db` as items whose `kind` is a value (decision 5), retires the `timecamping_data__*` tools at the timetracking-data conversion, and moves `time_pipeline.db`'s tools to `billing` (decision 6, Order step 1). Every store change in this spec lands in that store, so the build plan decides whether each change waits for that conversion or is built on the new store as part of it, never on `timecamping.db`'s typed tables.

- What the page does in Cowork, where screenshots can be read only on the PC.
- How the page gets the screenshot images: decrypted PNGs kept for the page, or decrypted when shown.
- The table changes in the time-review store (merged-into and split-from links, readings, fingerprints, candidate-date rows, date status and claims) must be checked against Commandment 5.
- How the page's records reach `/vet-billable-time`'s tie-out and `invoice_lines.json`, which today come from `vetted.json`.
- Presumptions count confirmations across days ("third occurrence", `/timecamping` Step 6). Days judged in parallel cannot see each other's confirmations, so when presumption offers are computed needs deciding.
- How long a date claim lasts before it expires.
- The baseline for success criteria 12 and 14: one real bill, measured the current way before the build starts.
