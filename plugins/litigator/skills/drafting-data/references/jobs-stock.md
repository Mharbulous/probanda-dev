Read when: writing a fixed-text job: `/prepare` offers a Writing kind's stock jobs or a letter, an `internal-memo` or an `unstructured` or `unstructured-<recipient>` Writing is saved (§3b), the pre-review passes leave nothing open (§3c), a scrutiny return is recorded `'failed'` (§3d), a pre-review pass leaves a finding undecided (§3g), the practitioner accepts `/draft`'s conversion offer on an `unstructured` or `unstructured-<recipient>` Writing (§3h), or the practitioner names a relayed `/legal-research` Step 5 offer to add (§3i), or answers "No" to `/legal-research`'s closing plan question (§3l), or `/legal-research`'s board mode writes blockers, a premise job, a rewording or a closing (§3m).
Any §N not in this file: find it in SKILL.md, "Job and scrutiny operations".

## 3b. Stock bundle jobs (`/prepare` outlining, and `/draft`'s letter, memo and Unstructured Writing save)

Fixed-text jobs `/prepare` may offer per Writing kind (the 2026-09-21 design §6.5 and §6.6). The practitioner picks or declines each at the closing read-back, and the pick is the approval, as on the fast path. The text below is the whole record of each job's title, intent and steps: it lives here and nowhere else, and a session never rewords it. Each job is identified by its fixed title, exactly as §14's gate job is, so a title here is fixed once shipped.

| Writing kind | Stock jobs, in the stage `/prepare` offers them |
|---|---|
| Notice of Application | `Availability letter` (opening stage), `Serve the application` (after the gate job completes), `Set down for hearing` and optionally `Reply affidavits` (once each response is in or its time has run), `Application book` (after set-down), `Reset for hearing` (once adjourned generally). `File and serve` (after the gate job completes) only for a notice filed under the rule before B.C. Reg. 105/2026 |
| Application Response | `Serve the response` (after the gate job completes), `File the served response` (once the notice of hearing is filed or served). `File and serve` (after the gate job completes) only for a response filed under the rule before B.C. Reg. 105/2026 |
| A letter kind (any `_NoVenue` letter kind, or a venue's `letter` kind) | `Deliver` alone, at the letter's save (ADR 0024 D10; a letter saved before 2026-10-23 also holds `Draft the letter`) |
| `internal-memo` | `Deliver` alone, at the memo's save, with the memo's own intent and steps below (#1161: a memo is sent like a letter; a memo saved before 2026-10-23 also holds `Draft the letter`) |
| `unstructured` (a venue's stock type for a document type with no type file of its own), or `unstructured-<recipient>` (a `_NoVenue` recipient's) other than `unstructured-internal` | `Draft the Writing` and `Deliver`, both at the Writing's save |
| `unstructured-internal` (the `_NoVenue` stock type for a Writing for counsel only, which is never sent) | `Draft the Writing` alone, at the Writing's save: no `Deliver` |

Each is written through §3's two-call idiom as `kind = 'work'`, with `billing_anchor` by §3's rule and `priority` from §3's priority read. **`filing_id` is always the lead Writing's id** — the Notice of Application, the Application Response, or the letter — and never NULL: a proceeding-scoped stock job would show on every later Writing's board and survive this Writing's retirement.

Opening a Milestone with no Writing (`drafting_data__create_milestone`) writes no stock job.

**`Availability letter`.** A `/draft` session dispatches it and drafts the letter. The letter is BCSC's `letter` kind, saved as a Writing on the proceeding of the job's own Writing when the job is dispatched, with its recipients defaulting to the whole service list by `filing-checklists.md` §13's forum idiom. The job is the letter's drafting job under its own title, so that save writes `Deliver` blocked by this job. No date appears in the job, nor any value derived from one.

- Intent: `Obtain the court's availability for the hearing of this application by letter.`
- Step 1: `Draft the chambers-availability letter`
- Scope: `('filing_prose', NULL)` and `('filing_recipients', NULL)`, as `Draft the letter`'s. An `entity_id` of NULL covers the whole table within the job's proceeding, and the letter is a Writing on the proceeding of this job's own Writing, so the letter's prose and recipient writes pass the scope read under this job.

**Amended Rule 8-1 (B.C. Reg. 105/2026, in force 2026-10-01).** A notice of application and an application response are served unfiled, and filed later: the notice at set-down with a notice of hearing of application (Form 33.01), the response after set-down (8-1 (3), (9), (14.1)-(14.7)). The jobs below follow that order. `File and serve` files and then serves, the order before that amendment, and stays only for a Writing filed under that rule. The service jobs record the service through `drafting_data__record_served` (`filing-checklists.md` §11), which freezes the Writing as served. Its registry filing later is a step of `Set down for hearing` or `File the served response`, saved as an unlinked `documents` row as `File and serve`'s affidavit of service is, and never a lifecycle state. A registry filing step is e-filed with `/e-file`. That pointer lives here, never in a job's fixed text.

**`File and serve`.** Modelled on §14's gate job. Filing or service work outlined outside this stock job takes a title starting `File and serve`, `Serve the application` or `Serve the response` too, so `/draft`'s Dispatch recognises it and skips it while the `gate` criterion is unmet.

- Intent: `File this Writing in the registry, serve it, and record the filing date and any affidavit of service.`
- Step 1: `File in the registry and record the filing date`
- Step 2: `Serve the filed documents`
- Step 3: `Affidavit of service, or n/a`
- Scope: `('filings', <the lead Writing's id>)` and `('documents', NULL)`. The filing date is written by `drafting_data__record_filed` (`filing-checklists.md` §11). The affidavit of service is a `documents` row produced by `/publish` form 015 or 016 and is **not** linked to the filed Writing, because the filed-date triggers refuse any `filing_documents` change once `filed_on` is set. Step 3 closes as `Affidavit of service: n/a` where none is sworn, by rewriting its text and stamping `done_at` as §14 closes an `n/a` check.

**`Serve the application`.** Like `File and serve`, it waits on the gate.

- Intent: `Serve a copy of this unfiled notice of application, with the affidavits and other materials it relies on, on every party of record and every other person the orders sought may affect, and record the service.`
- Step 1: `Serve the unfiled notice and its affidavits and materials on each person entitled to them`
- Step 2: `Record the notice as served, with the copy served`
- Step 3: `Affidavit of service, or n/a`
- Scope: `('filings', <the lead Writing's id>)` and `('documents', NULL)`. Step 2 is `drafting_data__record_served`. Step 3 is as `File and serve`'s.

On a contempt application, Step 1 instead reads `Serve the unfiled notice and its affidavits and materials on each person entitled to them, and on the alleged contemnor by personal service` (Rule 22-8 (11)). The title, intent and other steps are unchanged.

**`Serve the response`.** Like `File and serve`, it waits on the gate.

- Intent: `Serve a copy of this unfiled application response, with any affidavits and other materials not already served, on the applicant and every other party of record, and record the service.`
- Step 1: `Serve the unfiled response and its affidavits and materials on the applicant and each other party of record`
- Step 2: `Record the response as served, with the copy served`
- Step 3: `Affidavit of service, or n/a`
- Scope: `('filings', <the lead Writing's id>)` and `('documents', NULL)`. Step 2 is `drafting_data__record_served`. Step 3 is as `File and serve`'s.

**`Set down for hearing`.**

- Intent: `Set this application down for hearing: file a notice of hearing of application with the served notice and the originals of its served affidavits and materials, then serve the filed notice of hearing on each application respondent.`
- Step 1: `Prepare the notice of hearing of application (Form 33.01)`
- Step 2: `File it with the served notice of application and the originals of its served affidavits and materials not yet filed`
- Step 3: `Record the hearing date and time it sets, and save the filed copies`
- Step 4: `Serve the filed notice of hearing on each application respondent`
- Step 5: `Affidavit of service, or n/a`
- Scope: `('hearing_details', NULL)` and `('documents', NULL)`. Step 3 records the hearing date by `filing-checklists.md` §2, and saves each filed copy as an unlinked `documents` row. It never writes `filed_on`, which holds the service date.

**`Reply affidavits`.** Optional.

- Intent: `Serve the applicant's reply affidavits on each application respondent, then file their originals before the hearing.`
- Step 1: `Serve the reply affidavits on each application respondent`
- Step 2: `File the originals of the served reply affidavits`
- Step 3: `Affidavit of service, or n/a`
- Scope: `('documents', NULL)`

**`File the served response`.**

- Intent: `File the served application response, with the originals of its served affidavits and other materials not yet filed, after the notice of hearing is filed and before the hearing, and bring copies to the hearing.`
- Step 1: `File the served response with the originals of its served affidavits and materials not yet filed`
- Step 2: `Save the filed copies`
- Step 3: `Bring copies of the filed materials to the hearing`
- Scope: `('documents', NULL)`. Step 2 saves each filed copy as an unlinked `documents` row.

**`Application book`.** Its steps follow amended Rule 8-1 (15), (15.1) and (17). Steps 2 and 3 are `/assemble`'s `assemble-bcsc-record`.

- Intent: `Prepare the application record: its Form 30.001 cover and index, bound with the filed notice of application, the responses served on the applicant and the filed and served evidence relied on; serve the index; and provide the record, with a marked copy of the notice, to the registry.`
- Step 1: `Render the cover page (Form 30.001) and the index`
- Step 2: `Bind the record in the rule's order and fill in the page numbers`
- Step 3: `Prepare a separate copy of the filed notice with the orders sought in Part 1 marked`
- Step 4: `Serve the index on each application respondent`
- Step 5: `Provide the record and the marked copy to the registry`
- No scope rows: `/publish` and `/assemble` write nothing to this database, and the record's contents are chosen at assembly time.

**`Reset for hearing`.** For a notice of application adjourned generally, which stays live and is never retired (8-1 (21.1)).

- Intent: `Reset this application, adjourned generally, for hearing: file a notice of hearing of application and serve the filed copy on each application respondent.`
- Step 1: `Prepare the notice of hearing of application (Form 33.01)`
- Step 2: `File it and record the new hearing date and time`
- Step 3: `Serve the filed notice of hearing on each application respondent`
- Step 4: `Affidavit of service, or n/a`
- Scope: `('hearing_details', NULL)` and `('documents', NULL)`

**`Draft the letter`.** One step. No longer written: since 2026-10-23 a letter's or a memo's save writes `Deliver` alone. A letter or memo saved before then still holds it, `filing_id` the Writing's own id, worked and completed as an ordinary job, and it keeps its place in every exclusion keyed by title.

- Intent: `Draft this letter and render its mockup for review.`
- Step 1: `Draft the letter`
- Scope: `('filing_prose', NULL)` and `('filing_recipients', NULL)`

**`Deliver`.** Blocked by nothing at a letter's or a memo's own save; by the `Availability letter` job when saved under it; on an `unstructured` or `unstructured-<recipient>` Writing by `Draft the Writing`; and on a letter or memo saved before 2026-10-23 by `Draft the letter`. Its last step, `Record the letter as sent` (on a memo, `Record the memo as sent`), is the Sent write, `drafting_data__record_sent` (`filing-checklists.md` §13 "Sent write"), which is lawyer-only and carries the pre-send hold (§14a). The Sent write itself closes `Deliver`: in its transaction both steps are stamped done and the job is completed, whichever session made the call, so a bare "record it as sent" leaves nothing queued. This is the one place a write other than the job's own session clears a `wip` lock (§9). A job session that already completed `Deliver`, and a shelved or superseded one, are tolerated: the Sent write leaves that job as it stands.

- Intent: `Send this letter to its recipients and record it as sent.`
- Step 1: `Send the letter to its recipients`
- Step 2: `Record the letter as sent`
- Scope: `('filings', <the letter's id>)` and `('documents', NULL)`

**The practitioner moves `Deliver`.** Its first step, sending, is the practitioner's own act, so `/draft`'s Dispatch never chooses it (`work/references/dispatch.md`, "The practitioner's own"). It runs when the practitioner names it, and the Sent write closes it whichever session makes that call. No `Deliver` is written on an `unstructured-internal` Writing, which is never sent. One that an earlier save wrote there is left as it stands until the practitioner shelves it: nothing deletes or shelves it unasked.

**On an `internal-memo`.** The same two titles, blocking and scope, so every exclusion keyed by title holds for a memo unchanged. Only the intent and step text differ, and they are as fixed as the letter's:

`Draft the letter` on a memo:

- Intent: `Draft this memo and render its mockup for review.`
- Step 1: `Draft the memo`

`Deliver` on a memo:

- Intent: `Circulate this memo or put it on file, and record it as sent.`
- Step 1: `Circulate the memo or put it on file`
- Step 2: `Record the memo as sent`

The memo's save follows the letter save idiom below with this text in place of the letter's.

**`Draft the Writing`.** One step. Written at an `unstructured` or `unstructured-<recipient>` Writing's save, in place of `Draft the letter`, `filing_id` the Writing's own id. The Writing's `Deliver` is the letter's, its intent and steps unchanged, because the Sent write closes `Deliver` by its title.

- Intent: `Draft this Writing and render its mockup for review.`
- Step 1: `Draft the Writing`
- Scope: `('filing_prose', NULL)`, `('filing_recipients', NULL)`, `('filing_documents', NULL)` and `('documents', NULL)`, so the saved form copy's `documents` row and its link (filing-checklists.md §13, "Form copy") are in scope.

The Writing's save writes this job and `Deliver` through §3's two-call idiom: call 1 for each job, then call 3 for this job's step and its four scope rows, `Deliver`'s steps and scope as in the letter save idiom below, and one `ticket_blocks` row from this job to `Deliver`.

An `unstructured-internal` Writing's save writes `Draft the Writing` alone: call 1 inserts that one row, call 2 recovers its id, and call 3 writes its step and its four scope rows. No `Deliver` row and no `ticket_blocks` edge are written. Its stored layout declares no `recipients`, and its Milestone has no `gate` row, because it is never sent.

**These twelve jobs sit outside §14's nothing-open test**, read by these titles, so a queued stock job never holds the gate job back. That is their only exception in the job checklist: every other script treats them as ordinary `work` jobs. (The `gate` completion criterion, which reads unmet while a job is open, leaves out all twelve by the same titles, and §14a's `Pre-send gate` job too.)

### Letter save idiom

The letter's `Deliver` job is written through §3's two-call idiom, `kind = 'work'`, `billing_anchor` by §3's rule, and `filing_id` the letter's own id. Its `title` and `intent` here are this section's fixed text. The example's ids are literals: proceeding `1`, the letter Writing `8`, an `Availability letter` job `19`, and the new job `20`, which in practice §3's call 2 recovers. A new letter has nothing queued on it, so the job takes §3's starting priority, `0`. A memo's save runs the same statements with the memo's intents and step text (above) in place of the letter's, never the letter's.

The plain save writes `Deliver` alone, blocked by nothing. Its first statement is call 1; run call 2 for its id, `20` here, then the rest as call 3:

```sql
INSERT INTO tickets (proceeding_id, filing_id, title, intent, kind, priority, billing_anchor, created)
  VALUES (1, 8, 'Deliver', 'Send this letter to its recipients and record it as sent.', 'work', 0, '<matter>|late jurisdictional objection', strftime('%Y-%m-%dT%H:%M', 'now', 'localtime'));
INSERT INTO ticket_steps (ticket_id, ordinal, text) VALUES (20, 1, 'Send the letter to its recipients');
INSERT INTO ticket_steps (ticket_id, ordinal, text) VALUES (20, 2, 'Record the letter as sent');
INSERT INTO ticket_scope (ticket_id, entity, entity_id) VALUES (20, 'filings', 8);
INSERT INTO ticket_scope (ticket_id, entity, entity_id) VALUES (20, 'documents', NULL);
```

A save under the `Availability letter` job writes the same `Deliver`, blocked by that job:

```sql
INSERT INTO tickets (proceeding_id, filing_id, title, intent, kind, priority, billing_anchor, created)
  VALUES (1, 8, 'Deliver', 'Send this letter to its recipients and record it as sent.', 'work', 0, '<matter>|late jurisdictional objection', strftime('%Y-%m-%dT%H:%M', 'now', 'localtime'));
INSERT INTO ticket_steps (ticket_id, ordinal, text) VALUES (20, 1, 'Send the letter to its recipients');
INSERT INTO ticket_steps (ticket_id, ordinal, text) VALUES (20, 2, 'Record the letter as sent');
INSERT INTO ticket_scope (ticket_id, entity, entity_id) VALUES (20, 'filings', 8);
INSERT INTO ticket_scope (ticket_id, entity, entity_id) VALUES (20, 'documents', NULL);
INSERT INTO ticket_blocks (blocker_id, blocked_id) VALUES (19, 20);
```

## 3c. Counsel's review jobs

Two fixed-text jobs a Writing gains once every completion criterion printed above counsel's review holds and the pre-review passes leave nothing open (`Engineering/1. Design/2026-09-22_practitioner-review-design.md` §4 step 3). They are created together, by the session that ran those passes, with no closing read-back: the text below is the whole record of each job's title, intent and steps, it lives here and nowhere else, and a session never rewords it. Each is identified by its fixed title, exactly as §14's gate job is.

**`Prepare the review pages`.** An AI job.

- Intent: `Extract the source pages each paragraph of this Writing relies on into the Writing's folder, ready for counsel's review.`
- Step 1: `Extract the source pages into the Writing's folder`
- No scope rows: the pages are disposable projections in the Writing's folder, and the job writes nothing to this database.

**`Counsel's review of <filings.title>`.** The title is `Counsel's review of ` followed by the Writing's own `filings.title`, copied character for character; a reader matches the job by that prefix. A retitle, one `execute` script while the Writing is drafting, sets `filings.title` and this job's suffix while it is queued or wip. The practitioner is its mover: its one step is the practitioner's, listed for them and never dispatched.

- Intent: `Counsel reviews every paragraph of this Writing, in document order, against its source pages.`
- Step 1: `Review every paragraph and resolve every discussion point`
- Scope: `entity_id` NULL on every substance table of the Writing (design §4 step 3), so any change the practitioner dictates during the review is in scope. That is the reviewed tables `statements_of_law`, `statements_of_fact`, `law_assertions`, `facts`, `submissions`, `order_sought` and `rhetorical_paragraphs`; the other proceeding-scoped substance `parties`, `documents`, `witnesses`, `authorities`, `opposing_points` and `gaps`; and the Writing's own join and prose tables `filing_facts`, `filing_submissions`, `filing_orders`, `filing_rhetoric`, `filing_documents`, `filing_positions`, `filing_chronology` and `filing_prose`.
- Blocked on `Prepare the review pages`, one `ticket_blocks` edge.

Both are written as `kind = 'work'`, with `billing_anchor` by §3's rule, `priority` one above the highest §3's priority read returns, and `filing_id` the Writing's own id, never NULL. `Prepare the review pages` is inserted first, so at equal priority it heads the Ready queue (`priority DESC, id`).

Creating this pair, like §14's gate job, is a fixed-text create and not outlining: it writes no `created_by`, so §4's rule for a session that created jobs does not bind the creating session when it then assigns a job.

**Guarded create.** Neither job is inserted while a `queued` or `wip` job, unshelved, carrying either title already exists on the Writing. The pair lands whole or not at all, so a review still waiting on the practitioner never gains a second `Prepare the review pages`. Call 1 inserts both rows by §3's `INSERT ... VALUES` and then deletes both, in the same script, when a live job with either title already holds a step. Every job holds at least one step once its call 3 has run, and the two rows just inserted hold none yet, so the guard can never match its own rows:

```sql
INSERT INTO tickets (proceeding_id, filing_id, title, intent, kind, priority, billing_anchor, created)
  VALUES (1, 7, 'Prepare the review pages', 'Extract the source pages each paragraph of this Writing relies on into the Writing''s folder, ready for counsel''s review.', 'work', 10, 'L8212|attornment defeats the stay', strftime('%Y-%m-%dT%H:%M', 'now', 'localtime'));
INSERT INTO tickets (proceeding_id, filing_id, title, intent, kind, priority, billing_anchor, created)
  VALUES (1, 7, 'Counsel''s review of Notice of Application', 'Counsel reviews every paragraph of this Writing, in document order, against its source pages.', 'work', 10, 'L8212|attornment defeats the stay', strftime('%Y-%m-%dT%H:%M', 'now', 'localtime'));
DELETE FROM tickets WHERE filing_id = 7 AND status = 'queued' AND deleted_at IS NULL
  AND title IN ('Prepare the review pages', 'Counsel''s review of Notice of Application')
  AND NOT EXISTS (SELECT 1 FROM ticket_steps s WHERE s.ticket_id = tickets.id)
  AND EXISTS (
    SELECT 1 FROM tickets t WHERE t.filing_id = 7 AND t.status IN ('queued', 'wip') AND t.rejected_at IS NULL AND t.deleted_at IS NULL
      AND t.title IN ('Prepare the review pages', 'Counsel''s review of Notice of Application')
      AND EXISTS (SELECT 1 FROM ticket_steps s WHERE s.ticket_id = t.id));
```

**Call 2 recovers both ids** by the same property, with no `LIMIT`:

```sql
SELECT id, title FROM tickets t WHERE filing_id = 7 AND status = 'queued' AND deleted_at IS NULL
  AND title IN ('Prepare the review pages', 'Counsel''s review of Notice of Application')
  AND NOT EXISTS (SELECT 1 FROM ticket_steps s WHERE s.ticket_id = t.id);
```

No row means the guard fired: take the live review job's number from `drafting_forms__board_card` with `lanes: ["live"]`, read after the re-render, and say "already a job: Job #N" in one line. One row per title is the new pair. Anything else: stop and ask.

**Call 3 writes the children**, on the recovered literal ids (here `9` and `10`):

```sql
INSERT INTO ticket_steps (ticket_id, ordinal, text) VALUES (9, 1, 'Extract the source pages into the Writing''s folder');
INSERT INTO ticket_steps (ticket_id, ordinal, text) VALUES (10, 1, 'Review every paragraph and resolve every discussion point');
INSERT INTO ticket_scope (ticket_id, entity, entity_id) VALUES (10, 'statements_of_law', NULL);
INSERT INTO ticket_scope (ticket_id, entity, entity_id) VALUES (10, 'statements_of_fact', NULL);
INSERT INTO ticket_scope (ticket_id, entity, entity_id) VALUES (10, 'law_assertions', NULL);
INSERT INTO ticket_scope (ticket_id, entity, entity_id) VALUES (10, 'facts', NULL);
INSERT INTO ticket_scope (ticket_id, entity, entity_id) VALUES (10, 'submissions', NULL);
INSERT INTO ticket_scope (ticket_id, entity, entity_id) VALUES (10, 'order_sought', NULL);
INSERT INTO ticket_scope (ticket_id, entity, entity_id) VALUES (10, 'rhetorical_paragraphs', NULL);
INSERT INTO ticket_scope (ticket_id, entity, entity_id) VALUES (10, 'parties', NULL);
INSERT INTO ticket_scope (ticket_id, entity, entity_id) VALUES (10, 'documents', NULL);
INSERT INTO ticket_scope (ticket_id, entity, entity_id) VALUES (10, 'witnesses', NULL);
INSERT INTO ticket_scope (ticket_id, entity, entity_id) VALUES (10, 'authorities', NULL);
INSERT INTO ticket_scope (ticket_id, entity, entity_id) VALUES (10, 'opposing_points', NULL);
INSERT INTO ticket_scope (ticket_id, entity, entity_id) VALUES (10, 'gaps', NULL);
INSERT INTO ticket_scope (ticket_id, entity, entity_id) VALUES (10, 'filing_facts', NULL);
INSERT INTO ticket_scope (ticket_id, entity, entity_id) VALUES (10, 'filing_submissions', NULL);
INSERT INTO ticket_scope (ticket_id, entity, entity_id) VALUES (10, 'filing_orders', NULL);
INSERT INTO ticket_scope (ticket_id, entity, entity_id) VALUES (10, 'filing_rhetoric', NULL);
INSERT INTO ticket_scope (ticket_id, entity, entity_id) VALUES (10, 'filing_documents', NULL);
INSERT INTO ticket_scope (ticket_id, entity, entity_id) VALUES (10, 'filing_positions', NULL);
INSERT INTO ticket_scope (ticket_id, entity, entity_id) VALUES (10, 'filing_chronology', NULL);
INSERT INTO ticket_scope (ticket_id, entity, entity_id) VALUES (10, 'filing_prose', NULL);
INSERT INTO ticket_blocks (blocker_id, blocked_id) VALUES (9, 10);
```

Both jobs are drafting work: they count among the open jobs the `gate` completion criterion reads and in §14's nothing-open test (§14), with no title exclusion.

**Re-review.** A completed review job is never reopened. When content changes after approval, 🧐 fires again on it, and a fresh pair comes from this same guarded create. The completed pair stays as it is.

## 3d. Scrutiny review jobs

One fixed-text job per failed statement of law (schema v47): the practitioner's review of the research lawyer's finding, which ends only in counsel's confirmed close. It replaces re-dispatching scrutiny: a failed statement is never scrutinized again on the same pair.

**Who creates it.** The session that records a failed scrutiny return (`/drafting-data` "Record a scrutiny return"), one job per failed statement, written straight to Ready with no closing read-back, in the same session as the failed write. The v47 migration created one for every failed statement it found linked. A session that re-links a failed statement's law assertion to a submission or order on a live Writing creates one then. A failed statement linked to nothing gets none: it stays `'failed'`, quiet, until it is linked again. Linked means the v47 migration's test (`migrations.sql`, the 46 -> 47 hop, step 4): its law assertion is in `submission_law` for an unkilled submission that `filing_submissions` deploys on an unretired Writing, or it is the `excerpt_id` of an `order_sought_requires` row whose order `filing_orders` deploys on one, or `filing_law` links it to one.

The text below is the whole record of the job's title, intent and step; it lives here and nowhere else, and a session never rewords it.

- Title: `Review scrutiny finding: <authorities.style_of_cause_or_title> (statement <statements_of_law.id>)`, the authority's title copied character for character. A reader matches the job by the prefix `Review scrutiny finding: `.
- Intent: `Counsel reviews the scrutinizer's finding on this statement of law against the source and confirms, revises or drops the statement.`
- Step 1: `Review the finding against the source and confirm, revise or drop the statement`
- Scope: `('statements_of_law', <the statement's id>)`; `('law_assertions', <its law_assertion_id>)` when that is not NULL; and `('authorities', NULL)`. A reword, a re-point and a new authority are all in scope, and nothing else is.

`kind = 'work'`, `billing_anchor` by §3's rule, `priority` one above the highest §3's priority read returns, and `filing_id` NULL: the keyed row is proceeding-scoped substance (§3's rule for a job outlined from a Proposal).

**Guarded create**, on §3c's shape. Call 1 inserts the row by §3's `INSERT ... VALUES` and deletes it again, in the same script, when a `queued` or `wip` unshelved job carrying the title prefix already has a `ticket_scope` row naming this statement. The row just inserted has no scope rows yet, so it can never match its own guard:

```sql
INSERT INTO tickets (proceeding_id, filing_id, title, intent, kind, priority, billing_anchor, created)
  VALUES (1, NULL, 'Review scrutiny finding: Smith v. Jones (statement 12)', 'Counsel reviews the scrutinizer''s finding on this statement of law against the source and confirms, revises or drops the statement.', 'work', 6, '<matter>|attornment defeats the stay', strftime('%Y-%m-%dT%H:%M', 'now', 'localtime'));
DELETE FROM tickets WHERE id = last_insert_rowid()
  AND EXISTS (
    SELECT 1 FROM tickets t JOIN ticket_scope sc ON sc.ticket_id = t.id
      WHERE t.status IN ('queued', 'wip') AND t.rejected_at IS NULL AND t.deleted_at IS NULL AND t.title LIKE 'Review scrutiny finding: %'
        AND sc.entity = 'statements_of_law' AND sc.entity_id = 12);
```

**Call 2 recovers its id** by §3c's property, with no `LIMIT`: the one queued job with that title that holds no step yet.

```sql
SELECT id FROM tickets t WHERE proceeding_id = 1 AND title = 'Review scrutiny finding: Smith v. Jones (statement 12)' AND status = 'queued' AND deleted_at IS NULL
  AND NOT EXISTS (SELECT 1 FROM ticket_steps s WHERE s.ticket_id = t.id);
```

No row means the guard fired: take the live job's number from `drafting_forms__board_card` with `key`, after a re-render (the live job it prints, or the `held by #N` on that key's Proposed line) and say "already a job: Job #N" in one line. One row is the new job. More than one: stop and ask.

**Call 3 writes the children** on the recovered literal id (here `14`):

```sql
INSERT INTO ticket_steps (ticket_id, ordinal, text) VALUES (14, 1, 'Review the finding against the source and confirm, revise or drop the statement');
INSERT INTO ticket_scope (ticket_id, entity, entity_id) VALUES (14, 'statements_of_law', 12);
INSERT INTO ticket_scope (ticket_id, entity, entity_id) VALUES (14, 'law_assertions', 5);
INSERT INTO ticket_scope (ticket_id, entity, entity_id) VALUES (14, 'authorities', NULL);
```

A completed review job never blocks a new one: the guard reads only `queued` and `wip` jobs.

**The practitioner decides it, and `/draft`'s Dispatch may choose it** (`work/references/dispatch.md`, which skips only counsel's review and `Deliver` as the practitioner's own). Once it is assigned, `/draft`'s confirmation procedure (`draft/references/authorities.md` "Failed scrutiny") runs in place of dispatch. It completes by §9 only after the confirmation write (or the drop) in the same session (`/drafting-data` "Close a scrutiny review"). It carries no `ticket_proposals` keys, so §9's still-firing check has nothing to read. It is drafting work: no title exclusion leaves it out of the open jobs the `gate` completion criterion reads or §14's nothing-open test, as none leaves out §3c's jobs.

**A Scrutinize job that lapses.** A queued Scrutinize job whose statement is now `'failed'` holds a key that no longer derives, since 🔬 does not fire on a failed row. It fails `/draft`'s pre-claim check at the next Opening and is closed as superseded by §9b. Nothing re-dispatches it.

## 3g. Pass finding jobs

One fixed-text job per finding the pre-review passes leave undecided: `/draft`'s letter passes (`draft/references/letters.md` section 4) and its overstatement review (`draft/references/overstatement.md`) on any Writing. A finding lives on the Milestone and nowhere else: never in the Writing's text, its mockup, a report file or a file card (spec `Engineering/1. Design/2026-10-06_letter-passes-emit-board-items-spec.md` §12). A client letter is no Writing and gets none: its findings stay in chat.

**Who creates it.** The session that ran the pass, in the turn it states the finding to the practitioner, for each finding not resolved in that turn, written straight to Ready with no closing read-back. A finding fixed or decided in the same turn is never written.

The text below is the whole record of each job's title and intent; it lives here and nowhere else, and a session never rewords it. A reader matches the job by its title, exactly.

| Pass | Title | Intent | Mover |
|---|---|---|---|
| 1, Facts | `Check a date or quotation against its source` | `Bring a date, amount, name, quotation or citation in this Writing into line with the source it comes from, or locate that source.` | dispatchable |
| 2, Position consistency | `Decide a position our own correspondence contradicts` | `Counsel decides whether this Writing keeps, narrows or drops a position the firm's own prior correspondence or filings contradict.` | the practitioner |
| 5, Overstatement | `Decide an overstatement finding` | `Counsel keeps the assertion as drafted or rewrites it at its source's strength; a source not located is found first.` | the practitioner |

- Step 1, the finding, quoted from its sources and never from the practitioner's words or the session's own: `¶<n>: "<the draft's words>" — <verdict>; <source and pinpoint>: "<what the source says>"`. Pass 5 adds `; rewrite: "<rewrite at the source's strength>"` on a row that has one, and its verdict is one of `overstatement.md`'s. Pass 1's verdict is `does not match` or `not located`; Pass 2's is `contradicts`, `retreats from` or `sits awkwardly beside`, and its source is the prior letter or filing. `<n>` is the mockup's printed paragraph number.
- Scope: `('filing_prose', NULL)` on a general Writing; on any other Writing, the row the flagged paragraph prints from, as a revision of it names that row.

`kind = 'work'`, `billing_anchor` by §3's rule, `priority` from §3's priority read, and `filing_id` the Writing's own id: a finding is about this Writing's text.

**Guarded create**, on §3c's shape, one finding per call 1. Call 1 inserts the row and deletes it again, in the same script, when any job on the Writing, of any status, shelved included, and not deleted, carries the same title and a step with the same text. The row just inserted has no step yet, so it can never match its own guard. This is the dedup intake gives a Proposal key: a finding re-detected on a later render, or one a completed job already settled, is never written again.

```sql
INSERT INTO tickets (proceeding_id, filing_id, title, intent, kind, priority, billing_anchor, created)
  VALUES (1, 8, 'Decide an overstatement finding', 'Counsel keeps the assertion as drafted or rewrites it at its source''s strength; a source not located is found first.', 'work', 0, '<matter>|late jurisdictional objection', strftime('%Y-%m-%dT%H:%M', 'now', 'localtime'));
DELETE FROM tickets WHERE id = last_insert_rowid()
  AND EXISTS (
    SELECT 1 FROM tickets t JOIN ticket_steps s ON s.ticket_id = t.id
      WHERE t.filing_id = 8 AND t.deleted_at IS NULL AND t.title = 'Decide an overstatement finding'
        AND s.text = '¶3: "The Court ordered the plaintiff to deliver its reply by 14 March." — overstated; Order, para 3: "the plaintiff may deliver a reply within 7 days after service of it"; rewrite: "The order permits the plaintiff to deliver a reply within 7 days after service of any amended response."');
```

**Call 2 recovers its id**, with no `LIMIT`: the one queued job on the Writing with that title that holds no step yet.

```sql
SELECT id FROM tickets t WHERE filing_id = 8 AND title = 'Decide an overstatement finding' AND status = 'queued' AND deleted_at IS NULL
  AND NOT EXISTS (SELECT 1 FROM ticket_steps s WHERE s.ticket_id = t.id);
```

No row means the guard fired: the finding is already on the board, or was settled there. Say "already on the board" in one line and write nothing more. One row is the new job. More than one: stop and ask.

**Call 3 writes the children** on the recovered literal id (here `23`): the step exactly as call 1's guard compared it, and the scope.

```sql
INSERT INTO ticket_steps (ticket_id, ordinal, text) VALUES (23, 1, '¶3: "The Court ordered the plaintiff to deliver its reply by 14 March." — overstated; Order, para 3: "the plaintiff may deliver a reply within 7 days after service of it"; rewrite: "The order permits the plaintiff to deliver a reply within 7 days after service of any amended response."');
INSERT INTO ticket_scope (ticket_id, entity, entity_id) VALUES (23, 'filing_prose', NULL);
```

**Closing it records the decision.** A keep, a rewrite (an ordinary revision, written and re-rendered first), a drop, or a source found and the sentence matched to it: the job completes by §9, and the guard then never writes that finding again. A rewrite changes the sentence, so a later pass that flags the new words writes a new finding.

**Mover.** Dispatch may start any of the three, as it starts a scrutiny review (#1596). A Pass 2 or Pass 5 job is decided by counsel: the session working it shows the practitioner the finding and its source, and writes only their decision, never one of its own. A Pass 1 job is ordinary work. All three are drafting work: no title exclusion leaves them out of the open jobs the `gate` completion criterion reads or §14's nothing-open test, as none leaves out §3d's. None stops §3c's counsel's review jobs from being created. They carry no `ticket_proposals` keys.

**A Pass 2 job holds sending.** While a `queued` or `wip` unshelved `Decide a position our own correspondence contradicts` job is on a Writing, the pre-send hold reads `position-conflict` unmet (§14a). Closing the job meets it; "send anyway" waives it as it waives every held criterion.

## 3h. The conversion job

One fixed-text job, written when the practitioner accepts `/draft`'s conversion offer after the Sent write succeeds on an `unstructured` or `unstructured-<recipient>` Writing (`draft/references/unstructured.md` section 5). It turns that Writing into a general type file, so the next Writing of its type is a Structured Writing. It is unbilled firm infrastructure (`shared/live-issue-test.md` §1). The text below is the whole record of its title, intent and steps; it lives here and nowhere else, and a session never rewords it.

- Title: `Keep the layout of <filings.title> for next time`, the Writing's own title copied character for character. A reader matches the job by the prefix `Keep the layout of ` and the suffix ` for next time`, or, on a job written before 2026-10-22, by the old prefix `Make ` and suffix ` a Structured Writing`.
- Intent: `Record this document's layout so the next <filings.title> is drafted from it. Unbilled: firm infrastructure.`
- Step 1: `Compose the candidate layout from the frozen Writing, structure only`
- Step 2: `Run /localize create with the practitioner layout and, for a court form, the saved copy of the linked form`
- No scope rows: `/localize` writes the knowledge tree, never this database. No step offers retirement: recording a Writing as sent never leads to a retirement offer (ADR 0042 D8).

`kind = 'work'`, `billing_anchor` `<matter>|unbilled firm infrastructure`, `priority` from §3's priority read, and `filing_id` the Writing's own id, so the job sits on its own Milestone. Written through §3's two-call idiom with no guard: the offer is made once, when the Writing is recorded as sent. Call 1, for a Writing titled `Notice of discontinuance`:

```sql
INSERT INTO tickets (proceeding_id, filing_id, title, intent, kind, priority, billing_anchor, created)
  VALUES (1, 9, 'Keep the layout of Notice of discontinuance for next time', 'Record this document''s layout so the next Notice of discontinuance is drafted from it. Unbilled: firm infrastructure.', 'work', 0, '<matter>|unbilled firm infrastructure', strftime('%Y-%m-%dT%H:%M', 'now', 'localtime'));
```

Call 3 on the recovered literal id (here `30`):

```sql
INSERT INTO ticket_steps (ticket_id, ordinal, text) VALUES (30, 1, 'Compose the candidate layout from the frozen Writing, structure only');
INSERT INTO ticket_steps (ticket_id, ordinal, text) VALUES (30, 2, 'Run /localize create with the practitioner layout and, for a court form, the saved copy of the linked form');
```

The job is ordinary `work`: no title exclusion leaves it out of the open jobs the `gate` completion criterion reads. Completing it follows §9.

## 3i. Research offer jobs

One fixed-text job per follow-up research offer the practitioner names to add. An offer is one item the audit agent proposes at the end of a `/legal-research` return (`shared/legal-audit-protocol.md`, Step 5).

**Who creates it.** The session that relayed the return, only when the practitioner names a relayed offer to add. The sort in `shared/legal-research.md` ("After the answer") creates no job: it captures each offer as a loose thread or drops it. It runs in any session with a board, holding a job or not, and is not outlining: it writes no `created_by`, no `ticket_proposals` row and no `ticket_blocks` edge.

The job's words come from the offer's `job:` and `steps:` lines in the return the session relayed (`shared/legal-audit-protocol.md`, Step 5) and from this section, never from the session.

- Title and intent: the offer's `job:` line, character for character, without its `job: ` label. Single quotes are doubled in the SQL literal.
- Steps: the offer's `steps:` line, without its `steps: ` label, split on ` · `, one `ticket_steps` row per part, character for character, ordinals in the printed order. Step 5 lets no step restate the `job:` line, so `/draft`'s pre-claim check passes them.
- An offer with no `job:` line gets no job. Write nothing, and say in one line that the offer carries no job line and that the practitioner can outline it in their own words under `/draft`.
- An offer with a `job:` line and no `steps:` line takes the plan marker as its one step (`jobs-create.md` §3, "The plan marker"), never steps the session words.
- An offer tagged `kind: note-up` gets no job, even on "add" (`shared/legal-audit-protocol.md`, Step 5, prints it with no `job:` line). Write nothing, and say in one line that a note-up is written only on the practitioner's own instruction, such as "note up <case>", outlined under `/draft`, or by the "Note up all cited authorities" create. **Hard rule:** no session writes a job whose title or intent is a note-up of an authority, a read of its citing cases, or a citator or KeyCite check, except on the practitioner's express instruction or by that create. Never from a research offer, a loose thread or a finding by the session's own reading.
- The offer itself stays on record: the loose thread this add consumes keeps it verbatim (`seeds.idea`, with `charted_into` set to the job), so the job's words can be checked against it.
- No scope rows: the job writes no substance table (`jobs-common.md` §2 allows a job with none).

`kind = 'work'`. `billing_anchor` is never asked: in a session holding a job it is the held job's, otherwise the one the board's open work jobs carry. With none to copy it is `<matter>|<the Writing's or Milestone's title>`, or for a proceeding with no Writing `<matter>|<its forum and file number>`. `priority` is one below the lowest §3's priority read returns, or `0` when no row returns.

`filing_id` and `proceeding_id`: in a session holding a job, the held job's. Otherwise the board's: a Writing's id and proceeding, a Milestone with no Writing's own id and proceeding, or `filing_id` NULL where §8a step 2 resolves to the proceeding alone or to a retired Writing.

**Guarded create**, on §3g's shape, one offer per call 1. Call 1 inserts the row and deletes it again, in the same script, when any job in the proceeding, of any status, shelved included, and not deleted, carries the same title and a step. The row just inserted has no step yet, so it can never match its own guard. An offer a later return repeats, or one a completed job already answered, is never written again.

```sql
INSERT INTO tickets (proceeding_id, filing_id, title, intent, kind, priority, billing_anchor, created)
  VALUES (1, 1, 'Research whether the example rule applies to the example situation', 'Research whether the example rule applies to the example situation', 'work', 3, '<matter>|attornment defeats the stay', strftime('%Y-%m-%dT%H:%M', 'now', 'localtime'));
DELETE FROM tickets WHERE id = last_insert_rowid()
  AND EXISTS (
    SELECT 1 FROM tickets t JOIN ticket_steps s ON s.ticket_id = t.id
      WHERE t.proceeding_id = 1 AND t.deleted_at IS NULL
        AND t.title = 'Research whether the example rule applies to the example situation');
```

**Call 2 recovers its id**, with no `LIMIT`: the one queued job in the proceeding with that title that holds no step yet.

```sql
SELECT id FROM tickets t WHERE proceeding_id = 1 AND title = 'Research whether the example rule applies to the example situation' AND status = 'queued' AND deleted_at IS NULL
  AND NOT EXISTS (SELECT 1 FROM ticket_steps s WHERE s.ticket_id = t.id);
```

No row means the guard fired: take the existing job's number from `drafting_forms__board_card` with `lanes: ["live"]`, or `lanes: ["completed"]` when it is not there, and say "already a job: Job #K" in one line. One row is the new job. More than one: stop and ask.

**Call 3 writes the steps** on the recovered literal id (here `31`), one row per part of the `steps:` line:

```sql
INSERT INTO ticket_steps (ticket_id, ordinal, text) VALUES (31, 1, 'Read the example rule');
INSERT INTO ticket_steps (ticket_id, ordinal, text) VALUES (31, 2, 'Put the question to /legal-research');
INSERT INTO ticket_steps (ticket_id, ordinal, text) VALUES (31, 3, 'Save the answer under this job');
```

These rows stand for one offer's `steps:` line. They are never a default plan and are never copied onto another job: a job with no `steps:` line of its own takes the plan marker.

**Consuming the thread on "add".** A relayed offer was captured as a loose thread in the turn it was relayed (`jobs-run.md` §8 or §8a). When the practitioner names it to add, write its job as above, then mark that thread, here `7`, as outlined into the job:

```sql
UPDATE seeds SET charted_into = 31 WHERE id = 7;
```

This is one of two `charted_into` writes outside an outlining session, the other the loose-threads job's (`jobs-create.md` §3, "Consuming a loose thread the held job worked"). It runs in the session the sort ran in, and only on a thread that sort captured.

The job is ordinary `work`: no title exclusion leaves it out of the open jobs the `gate` completion criterion reads or §14's nothing-open test, as none leaves out §3g's. Completing it follows §9.

## 3l. Research plan issue jobs

One job per issue on the list the practitioner approved at `/legal-research`'s plan stage (`shared/legal-research.md`, "Approved plan issues become jobs"). Their "No" to the closing question approves the list and is the request: it creates one job per listed issue and none for an issue they skipped. The plan stage runs in a session holding no job, and is not outlining: the write carries no `created_by`, no `ticket_proposals` row and no `ticket_blocks` edge.

- Title and intent: the issue's text as the list showed it, character for character, without its number. Never cleaned. Single quotes are doubled in the SQL literal.
- Steps: the plan marker as its one step (`jobs-create.md` §3, "The plan marker").
- No scope rows, and `kind`, `billing_anchor`, `priority`, `filing_id` and `proceeding_id` as §3i gives them for a session holding no job. The board is the one §8a steps 1 and 2 resolve from the question's origin, and a question with no origin takes step 2's last branch, the proceeding. With no board, write nothing (`shared/legal-research.md` says what follows).

Each issue is written by §3i's guarded create and its call 2, on the issue's title. A guard that fires says "already a job: Job #K" in one line and goes on with the next issue. Call 3 writes the plan marker on the recovered literal id:

```sql
INSERT INTO ticket_steps (ticket_id, ordinal, text) VALUES (32, 1, 'Create a plan for how to complete this job.');
```

Once every issue is written, re-render the board with `draft_dir`, so its Milestone page lists the new jobs. `pages_refused` means the page is stale: say so. No research runs from this write: each job is researched when it is worked.

## 3m. Research board writes

The writes of `/legal-research`'s board mode, which works several research jobs on one board, each held under its own token (§4). None of them is outlining, so the session that runs them may hold jobs.

**Blockers.** Each hard or soft blocker the research triage returns is one `ticket_blocks` edge. Its kind and reason are not stored. Add and delete edges with §3a's edge shapes (`jobs-create.md`), whose guard proves the blocked job still queued and unshelved, so a held or completed job never gains or loses an edge. An edge the triage's latest graph no longer holds is deleted by the same shape. Then read the edges back:

```sql
SELECT blocker_id, blocked_id FROM ticket_blocks WHERE blocked_id IN (5, 6, 7);
```

**A premise job**, only on the practitioner's yes to a premise or threshold question the triage proposes. Write it as §3l writes an issue: §3i's guarded create and its call 2 on the proposed question, character for character, as title and intent, then the plan marker as its one step. Then write its edges as above.

**Rewording a held job**, only on the practitioner's approval of the proposed question. The guard is this job's own token (§5):

```sql
UPDATE tickets SET title = 'Whether a request to correct the award extends the time to apply to set it aside', intent = 'Whether a request to correct the award extends the time to apply to set it aside'
  WHERE id = 5 AND status = 'wip' AND locked_by = 'sess-b2';
```

`changes` 0 means the lock is no longer this token's: report it and stop. When the practitioner keeps the original question, write nothing.

**Closing a job a memo already answers**, only on the practitioner's yes: §10a's shelving of a `queued` job (`jobs-closeout.md`).
