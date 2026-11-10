# Procedural history

Shared doctrine. It is not a skill: it has no `SKILL.md` and is never wrapped. Each matter keeps one readable log of what has happened in it, written as work proceeds and read in place of asking the practitioner to recount it.

- **The file.** `ProceduralHistory.md` at the top of the matter folder, one per matter (`shared/workspace-output-rule.md`, the third exception). Where the matter has more than one proceeding, each entry names its proceeding by court file number.
- **Not the Procedural History page.** A Work Board's Procedural History view page (`shared/html-pages.md`) is drawn from the drafting database's dated facts, each with how it will be proven. This file is the matter's own log, and neither is written from the other.
- **Header.** A YAML header with one field, `last_updated`, an ISO 8601 timestamp with its offset (`2026-10-13T18:59:58-07:00`). The writing tool (below) stamps it from the host's own clock on every write. Never write it by hand.
- **Body.** Newest first. One `## YYYY-MM-DD` heading for each date on which something happened, and under it one bullet for each event: what happened in one line, then the source file as a path relative to the matter folder. An event the practitioner told the session carries `(the practitioner, <date told>)` in place of a path. Today's heading also holds the session's work in progress: `Started Job <N>: <title>`, and `Completed Job <N>: <title>` when it is done.

  ```
  ---
  last_updated: 2026-10-13T18:59:58-07:00
  ---
  # Procedural history

  ## 2026-10-13
  - Started Job 12: Draft the notice of application.

  ## 2026-09-30
  - Order made adjourning the application. `5. COURT FILE\2026-09-30 ORDR Adjournment.pdf`
  ```

- **Writing.** `matter_data__procedural_history_append` is the only way to write the file. Never edit it with a file tool or a shell script. Pass `matter_root`, `date` (the event's date) and `line` (what happened, in one line), with `source_path` (relative to the matter folder) or, for an event the practitioner told the session, `told_on` (the date told). The tool adds the bullet under the heading for that date, creating the file and the heading in date order when missing, and refuses a duplicate bullet and a line holding a date later than its heading. The event's date is the date the document itself states, or the date the practitioner gives. Never rewrite or delete an earlier entry, except to correct one that case data contradicts: that correction passes the old entry's full text as `replaces`. Writing an entry asks the practitioner nothing and is never announced.
- **Who writes.** `/matter-data` writes an entry when it ingests a court document or correspondence (`ingest-extract.md`, "Procedural history entry") and when an order's effects are applied (`order-effects.md` Step 5). `drafting_data__take_job` writes one when it takes a job, and `/draft` when a take-over assigns one, when a job is completed, and after `drafting_data__record_filed`, `drafting_data__record_served` (the entry reads `Served <title>`) or `drafting_data__record_sent` succeeds. `/issue-invoice` writes one after `practice_data__record_invoice_sent`. Any session that learns of an event from the practitioner writes it.
- **Never in the file.**
  - A deadline, a limitation date, a computed date or time remaining (`shared/deadline-isolation.md`). No entry holds a date later than the date of its own heading: a letter that fixes a hearing is recorded as a letter fixing a hearing, without the hearing date. A date a document states for a past event is content.
  - A statement of law. Only `/legal-research` states law. A research answer is recorded as an event, with the path of the saved answer and nothing of what it says.
  - Privileged substance. A solicitor-client entry is factual only (a retainer signed, an account sent), or left out. Nothing goes in that the matter folder does not already hold.
- **Standing.** The file is a narrative log, not a store of facts. Case data stays the source of record for structured facts. Where the two differ, case data governs and the entry is corrected.
- **Reading.** When the full history is needed, read the whole file. Never ask the practitioner to explain or recount the history of the matter.
- **The currency check.** To confirm the file is current, read its top 100 lines.
  - The file is current when a heading carries today's date, or `last_updated` is less than 8 hours old. Ask nothing. Say `Looks like we were working on <today's work that is started and not completed>.`
  - Otherwise ask this one question, word for word, placeholders filled from the newest entry: `Looking at the history of this matter, it appears the most recent activity was on <date> when we were <summary>. Has anything else happened since then?` Record each event the answer gives as an entry. A "no" calls the tool with no `date` and no `line`, which rewrites `last_updated` and adds nothing. No further question about the history follows.
- **No file yet.** Build it before the currency check, without asking: list the matter's court-file and correspondence folders, take each event's date and kind from its file name, open a file only where its name leaves the event unclear, and write each event with the tool, one call per event. Then run the currency check.
