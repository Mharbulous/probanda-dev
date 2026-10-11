Read when: writing a fixed-text job: `/prepare` offers a Writing kind's stock jobs or a letter, an `internal-memo` or an `unstructured` or `unstructured-<recipient>` Writing is saved (§3b), the pre-review passes leave nothing open (§3c), a scrutiny return is recorded `'failed'` (§3d), a pre-review pass leaves a finding undecided (§3g), or the practitioner accepts `/draft`'s conversion offer on an `unstructured` or `unstructured-<recipient>` Writing (§3h).
Any §N not in this file: find it in SKILL.md, "Job and scrutiny operations".

## 3b. Stock bundle jobs (`/prepare` outlining, and `/draft`'s letter, memo and Unstructured Writing save)

Fixed-text jobs `/prepare` may offer per Writing kind (the 2026-09-21 design §6.5 and §6.6). The practitioner picks or declines each at the closing read-back, and the pick is the approval, as on the fast path. The text below is the whole record of each job's title, intent and steps: it lives here and nowhere else, and a session never rewords it. Each job is identified by its fixed title, exactly as §14's gate job is, so a title here is fixed once shipped.

| Writing kind | Stock jobs, in the stage `/prepare` offers them |
|---|---|
| Notice of Application | `Availability letter` (opening stage), `File and serve` (after the gate job completes), `Application book` (after responses arrive) |
| Application Response | `File and serve` (after the gate job completes) |
| A letter kind (any `_NoVenue` letter kind, or a venue's `letter` kind) | `Draft the letter` and `Deliver`, both at the letter's save (ADR 0024 D10) |
| `internal-memo` | `Draft the letter` and `Deliver`, both at the memo's save, with the memo's own intents and steps below (#1161: a memo is sent like a letter) |
| `unstructured` (a venue's stock type for a document type with no type file of its own), or `unstructured-<recipient>` (a `_NoVenue` recipient's) | `Draft the Writing` and `Deliver`, both at the Writing's save |

Each is written through §3's two-call idiom as `kind = 'work'`, with `billing_anchor` by §3's rule and `priority` from §3's priority read. **`filing_id` is always the lead Writing's id** — the Notice of Application, the Application Response, or the letter — and never NULL: a proceeding-scoped stock job would show on every later Writing's board and survive this Writing's retirement.

**`Availability letter`.** A `/draft` session dispatches it and drafts the letter. The letter is BCSC's `letter` kind, saved as a Writing on the proceeding of the job's own Writing when the job is dispatched, with its recipients defaulting to the whole service list by `filing-checklists.md` §13's forum idiom. The job stands in for `Draft the letter` under its own title, so that save writes no `Draft the letter` row and writes `Deliver` blocked by this job. No date appears in the job, nor any value derived from one.

- Intent: `Obtain the court's availability for the hearing of this application by letter.`
- Step 1: `Draft the chambers-availability letter`
- Scope: `('filing_prose', NULL)` and `('filing_recipients', NULL)`, as `Draft the letter`'s. An `entity_id` of NULL covers the whole table within the job's proceeding, and the letter is a Writing on the proceeding of this job's own Writing, so the letter's prose and recipient writes pass the scope read under this job.

**`File and serve`.** Modelled on §14's gate job. Filing or service work outlined outside this stock job takes a title starting `File and serve` too, so `/draft`'s Dispatch recognises it and skips it while the `gate` criterion is unmet.

- Intent: `File this Writing in the registry, serve it, and record the filing date and any affidavit of service.`
- Step 1: `File in the registry and record the filing date`
- Step 2: `Serve the filed documents`
- Step 3: `Affidavit of service, or n/a`
- Scope: `('filings', <the lead Writing's id>)` and `('documents', NULL)`. The filing date is written by `drafting_data__record_filed` (`filing-checklists.md` §11). The affidavit of service is a `documents` row produced by `/publish` form 015 or 016 and is **not** linked to the filed Writing, because the filed-date triggers refuse any `filing_documents` change once `filed_on` is set. Step 3 closes as `Affidavit of service: n/a` where none is sworn, by rewriting its text and stamping `done_at` as §14 closes an `n/a` check.

**`Application book`.**

- Intent: `Prepare the application book: render its title page and index, then bind them with the documents and fill in the page numbers.`
- Step 1: `Render the title page and index`
- Step 2: `Bind the book and fill in the page numbers`
- No scope rows: `/publish` and `/assemble` write nothing to this database, and the book's index membership is derived at assembly time.

**`Draft the letter`.** One step. Written at a letter's or a memo's save, `filing_id` the Writing's own id. Not written when the save happens under the `Availability letter` job, which stands in for it.

- Intent: `Draft this letter and render its mockup for review.`
- Step 1: `Draft the letter`
- Scope: `('filing_prose', NULL)` and `('filing_recipients', NULL)`

**`Deliver`.** Blocked by `Draft the letter` (or by the `Availability letter` job, or on an `unstructured` or `unstructured-<recipient>` Writing by `Draft the Writing`). Its last step, `Record the letter as sent` (on a memo, `Record the memo as sent`), is the Sent write, `drafting_data__record_sent` (`filing-checklists.md` §13 "Sent write"), which is lawyer-only and carries the pre-send hold (§14a). The Sent write itself closes `Deliver`: in its transaction both steps are stamped done and the job is completed, whichever session made the call, so a bare "record it as sent" leaves nothing queued. This is the one place a write other than the job's own session clears a `wip` lock (§9). A job session that already completed `Deliver`, and a shelved or superseded one, are tolerated: the Sent write leaves that job as it stands.

- Intent: `Send this letter to its recipients and record it as sent.`
- Step 1: `Send the letter to its recipients`
- Step 2: `Record the letter as sent`
- Scope: `('filings', <the letter's id>)` and `('documents', NULL)`

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

The Writing's save follows the letter save idiom below with this job's title, intent and step in place of `Draft the letter`'s, its two extra scope rows added to call 3, and `Deliver` blocked by it.

**These six jobs sit outside §14's nothing-open test**, read by these titles, so a queued stock job never holds the gate job back. That is their only exception in the job checklist: every other script treats them as ordinary `work` jobs. (The `gate` completion criterion, which reads unmet while a job is open, leaves out all six by the same titles, and §14a's `Pre-send gate` job too.)

### Letter save idiom

The two letter jobs are written through §3's two-call idiom, `kind = 'work'`, `billing_anchor` by §3's rule, and `filing_id` the letter's own id. Their `title` and `intent` here are this section's fixed text, exempt from §3's words rule, and the practitioner-words gate (`hooks/practitioner-words-gate.py`) reads no create. The example's ids are literals: proceeding `1`, the letter Writing `8`, an `Availability letter` job `19`, and the new jobs `20` and `21`, which in practice §3's call 2 recovers. A new letter has nothing queued on it, so each job takes §3's starting priority, `0`. A memo's save runs the same statements with the memo's intents and step text (above) in place of the letter's, never the letter's: the gate admits both, so it cannot catch the swap.

The plain save, call 1 for each job:

```sql
INSERT INTO tickets (proceeding_id, filing_id, title, intent, kind, priority, billing_anchor, created)
  VALUES (1, 8, 'Draft the letter', 'Draft this letter and render its mockup for review.', 'work', 0, '<matter>|late jurisdictional objection', strftime('%Y-%m-%dT%H:%M', 'now', 'localtime'));
INSERT INTO tickets (proceeding_id, filing_id, title, intent, kind, priority, billing_anchor, created)
  VALUES (1, 8, 'Deliver', 'Send this letter to its recipients and record it as sent.', 'work', 0, '<matter>|late jurisdictional objection', strftime('%Y-%m-%dT%H:%M', 'now', 'localtime'));
```

Then call 3 for both, on the recovered ids:

```sql
INSERT INTO ticket_steps (ticket_id, ordinal, text) VALUES (20, 1, 'Draft the letter');
INSERT INTO ticket_scope (ticket_id, entity, entity_id) VALUES (20, 'filing_prose', NULL);
INSERT INTO ticket_scope (ticket_id, entity, entity_id) VALUES (20, 'filing_recipients', NULL);
INSERT INTO ticket_steps (ticket_id, ordinal, text) VALUES (21, 1, 'Send the letter to its recipients');
INSERT INTO ticket_steps (ticket_id, ordinal, text) VALUES (21, 2, 'Record the letter as sent');
INSERT INTO ticket_scope (ticket_id, entity, entity_id) VALUES (21, 'filings', 8);
INSERT INTO ticket_scope (ticket_id, entity, entity_id) VALUES (21, 'documents', NULL);
INSERT INTO ticket_blocks (blocker_id, blocked_id) VALUES (20, 21);
```

A save under the `Availability letter` job writes `Deliver` only, blocked by that job. Its first statement is call 1; run call 2 for its id, which is `20` here because it is the only new job, then the rest as call 3:

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

- Intent: `Extract the source pages each paragraph of this Writing relies on into the presentation folder, ready for counsel's review.`
- Step 1: `Extract the source pages into the presentation folder`
- No scope rows: the pages are disposable projections in the presentation folder, and the job writes nothing to this database.

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
  VALUES (1, 7, 'Prepare the review pages', 'Extract the source pages each paragraph of this Writing relies on into the presentation folder, ready for counsel''s review.', 'work', 10, 'L8212|attornment defeats the stay', strftime('%Y-%m-%dT%H:%M', 'now', 'localtime'));
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
INSERT INTO ticket_steps (ticket_id, ordinal, text) VALUES (9, 1, 'Extract the source pages into the presentation folder');
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

**The practitioner decides it, and `/draft`'s Dispatch may choose it** (`draft/references/dispatch.md`, which skips only counsel's review). Once it is assigned, `/draft`'s confirmation procedure (`draft/references/authorities.md` "Failed scrutiny") runs in place of dispatch. It completes by §9 only after the confirmation write (or the drop) in the same session (`/drafting-data` "Close a scrutiny review"). It carries no `ticket_proposals` keys, so §9's still-firing check has nothing to read. It is drafting work: no title exclusion leaves it out of the open jobs the `gate` completion criterion reads or §14's nothing-open test, as none leaves out §3c's jobs.

**A Scrutinize job that lapses.** A queued Scrutinize job whose statement is now `'failed'` holds a key that no longer derives, since 🔬 does not fire on a failed row. It fails `/draft`'s pre-claim check at the next Opening and is closed as superseded by §9b. Nothing re-dispatches it.

## 3g. Pass finding jobs

One fixed-text job per finding the pre-review passes leave undecided: `/draft`'s letter passes (`draft/references/letters.md` section 4) and its overstatement review (`draft/references/overstatement.md`) on any Writing. A finding lives on the Job Board and nowhere else: never in the Writing's text, its mockup, a report file or a file card (spec `Engineering/1. Design/2026-10-06_letter-passes-emit-board-items-spec.md` §12). A client letter is no Writing and gets none: its findings stay in chat.

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

- Title: `Make <filings.title> a Structured Writing`, the Writing's own title copied character for character. A reader matches the job by the prefix `Make ` and the suffix ` a Structured Writing`.
- Intent: `Turn this Writing into a type file so the next <filings.title> is a Structured Writing. Unbilled: firm infrastructure.`
- Step 1: `Compose the candidate layout from the frozen Writing, structure only`
- Step 2: `Run /localize create with the practitioner layout and, for a court form, the saved copy of the linked form`
- No scope rows: `/localize` writes the knowledge tree, never this database. No step offers retirement: recording a Writing as sent never leads to a retirement offer (ADR 0042 D8).

`kind = 'work'`, `billing_anchor` `<matter>|unbilled firm infrastructure`, `priority` from §3's priority read, and `filing_id` the Writing's own id, so the job sits on its own Job Board. Written through §3's two-call idiom with no guard: the offer is made once, when the Writing is recorded as sent. Call 1, for a Writing titled `Notice of discontinuance`:

```sql
INSERT INTO tickets (proceeding_id, filing_id, title, intent, kind, priority, billing_anchor, created)
  VALUES (1, 9, 'Make Notice of discontinuance a Structured Writing', 'Turn this Writing into a type file so the next Notice of discontinuance is a Structured Writing. Unbilled: firm infrastructure.', 'work', 0, '<matter>|unbilled firm infrastructure', strftime('%Y-%m-%dT%H:%M', 'now', 'localtime'));
```

Call 3 on the recovered literal id (here `30`):

```sql
INSERT INTO ticket_steps (ticket_id, ordinal, text) VALUES (30, 1, 'Compose the candidate layout from the frozen Writing, structure only');
INSERT INTO ticket_steps (ticket_id, ordinal, text) VALUES (30, 2, 'Run /localize create with the practitioner layout and, for a court form, the saved copy of the linked form');
```

The job is ordinary `work`: no title exclusion leaves it out of the open jobs the `gate` completion criterion reads. Completing it follows §9.
