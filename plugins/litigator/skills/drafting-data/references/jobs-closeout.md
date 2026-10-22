Read when: the practitioner retires a Writing, closes a job as superseded, merges a duplicate job into another, shelves or restores a Proposal or a job, or deletes a mistaken job or restores a deleted job, or moves jobs to another board; the render reports lapsed shelvings; or `drafting_forms__bootstrap` returns a non-null `legacy_workboard_artifact_url`.
Any §N not in this file: find it in SKILL.md, "Job and scrutiny operations".

## 9a. Supersession on retirement

Retiring a Writing (schema v17, `filing-checklists.md` §11) ends its job work: every `queued` job scoped to that Writing is superseded by the retirement itself. Not by another job — a retirement is not a job and has no id to point at, which is why the v17 hop relaxed the CHECK to `superseded_by IS NULL OR status = 'superseded'`. Leave `superseded_by` NULL; the Job Board prints "Superseded by: retirement of this Writing (date)" from the Writing's own `retired_on`.

**Read first — a `wip` job on this Writing refuses the retirement.** Its lock belongs to another session, and clearing it here is the same violation §9 forbids on a `wip` conflict partner:

```sql
SELECT id, title, locked_by, locked_at FROM tickets WHERE filing_id = 7 AND status = 'wip';
```

Any row returned: stop, do not write anything, and report the job and its holder to the practitioner. Retirement resumes once that session completes or supersedes its own job. **That read is the report surface, not the barrier** — it is what names the blocking job and its holder, which the guard below cannot do; the guard is what actually refuses the write.

**Then, no draft left attached** (schema v67). Each attachment its Job Board shows is moved or detached, as the practitioner says for each, before the script below runs (`filing-checklists.md` §11 and §14). While one is left, the v67 trigger `guard_filings_retire_attached` refuses the `filings` statement and the whole script with it.

With no rows, write the retirement — **`filing_id` scoped, never proceeding-scoped**: a `filing_id IS NULL` job belongs to the whole proceeding, which the retirement of one Writing does not end. Every statement in the script carries the same `NOT EXISTS` clause, because guarding only the job supersession would leave the `filings` write to land alone, and the `filings` write is the one that ends the Writing:

```sql
UPDATE filings SET retired_on = '2026-09-08', retirement_reason = 'appeal_expired'
  WHERE id = 7
    AND NOT EXISTS (SELECT 1 FROM tickets WHERE filing_id = 7 AND status = 'wip');
UPDATE tickets SET status = 'superseded'
  WHERE filing_id = 7 AND status = 'queued' AND deleted_at IS NULL
    AND NOT EXISTS (SELECT 1 FROM tickets WHERE filing_id = 7 AND status = 'wip');
```

The `filings` statement's own text is owned by `filing-checklists.md` §11 and is shown here only because the clause must ride every statement in the script. §11 is the source of truth for that statement and carries the same guarded form.

Then run the confirm-read:

```sql
SELECT retired_on, retirement_reason FROM filings WHERE id = 7;
```

NULL means the guard matched nothing — a `wip` job appeared between the read-first and the write. Re-run the read-first and report its rows.

`completed`, already-`superseded` and deleted (§10a) jobs are left as they are. Recovery (clearing `filings.retired_on`) does **not** un-supersede them: the work they described belonged to the Writing as it stood, and a recovered Writing is outlined afresh. This write rides in the same `execute` script as the `filings` UPDATE, which is a substance write — so that script moves the revision through §8's triggers, the job tables' revision-bump exemption notwithstanding.

**Closing a Job Board with no Writing** is this same script, with the board's id as the `filings` id and `retirement_reason = 'other'`: a job in progress on it refuses the close, and its queued jobs are superseded. Reopening it clears the two columns and un-supersedes nothing (`filing-checklists.md` §11).

## 9b. Close as superseded (bookkeeping)

A job outlined from Proposals whose marker no longer shows is closed on the practitioner's instruction, never on a session's own initiative and never by the render (the 2026-09-21 design §4.7). It is the practitioner-visible act for that case: not a shelving, which reads as an angle they chose not to pursue, and not a completion, which would stamp work that was never done.

**When it may run.** Only when the job's card (`drafting_forms__board_card` with `jobs`), read after a current render, shows every key on its `keys:` line as `(now: dead)`. If this session has written substance since its last render, render first. One widening (the 2026-09-21 design §4.8): a fast-path job whose item changed may be closed while its key still derives. A fast-path job here means a one-step job holding at least one key whose title and intent are the same text, and the practitioner chose "close it as superseded" from the three-choice form. It is available wherever shelving and restoring are (§10a), for any job except the session's own. A job in progress in another session is left to that session or a take-over, and the guard below refuses it.

```sql
UPDATE tickets SET status = 'superseded', superseded_marker_gone_at = strftime('%Y-%m-%dT%H:%M', 'now', 'localtime')
  WHERE id = 42 AND status = 'queued' AND rejected_at IS NULL AND deleted_at IS NULL
    AND EXISTS (SELECT 1 FROM ticket_proposals WHERE ticket_id = 42);
```

`superseded_by` stays NULL: nothing superseded the job. The `ticket_proposals` clause is what stops this becoming a general supersede instruction. A hand-outlined job carries no conversion record, so it can never be closed this way.

Then run the confirm-read:

```sql
SELECT status, superseded_marker_gone_at, locked_by, rejected_at FROM tickets WHERE id = 42;
```

`status = 'superseded'` with `superseded_marker_gone_at` stamped means it landed. Anything else means the guard matched nothing, and the row says why: `wip` means another session holds it, `rejected_at` stamped means it is shelved, and `queued` with both NULL means it carries no conversion record. Report which it was and stop.

**What stays.** The job's `ticket_proposals` rows are kept. They hide nothing now, because only a `queued` or `wip` unshelved job hides its Proposals, so if the marker fires again the Proposal returns to Proposed. There is **no restore path**: the returned Proposal is picked afresh. No revision bump, as for every write in this file except §9a's retirement script. Accepted cost: a job waiting on the closed one stays in Blocked until it is outlined afresh, even where the work was done elsewhere.

## 9c. Merge two jobs (bookkeeping)

Two jobs on one board can name the same work in different words. `/draft`'s duplicate check (`draft/references/job-session.md`, "The duplicate check") proposes a merge, and it runs only on the practitioner's bare yes, which the practitioner-words hook checks. It is never run on a session's own initiative and never in an unattended run. The merge is one call, `drafting_data__merge_jobs` `{db_path, survivor_id, absorbed_id, session_token}`. Never hand-write it through `execute`.

**What it may merge.** The survivor is Ready (`queued`, no lock) or held by this session. The absorbed job is Ready. Both are unshelved and not deleted, in one proceeding and on one Writing, or both General Jobs. The absorbed job has no either/or partner, and neither job waits on a job outside the pair that is not completed. A completed job is never merged (`draft/references/job-session.md`, "A form is one job"). The tool reads both rows first and refuses anything else, writing nothing and naming the job that refused (`refused_job`).

**What it writes,** every statement under one guard in one transaction, so either all of them land or none does:

- The absorbed job's steps not yet done (no `done_at`, and not dropped or put off) are appended after the survivor's highest ordinal, in their own order. This is §5's partial replace `INSERT` with no `DELETE`: every survivor step keeps its row, its ordinal, its words and its `done_at`.
- Its `ticket_scope` rows and `ticket_proposals` keys that the survivor lacks are copied to it.
- Each job waiting on the absorbed job waits on the survivor instead, and the absorbed job's blocker rows are deleted, so nothing is left Blocked by a superseded job. A survivor that waited on the absorbed job is not made to wait on itself.
- The survivor's `plan_approved_at` is cleared when steps were added, as §3a's "Adding a step" clears it. `drafting_data__approve_plan` stamps it again when the plan is announced.
- The absorbed job becomes `superseded`, with `superseded_by` set to the survivor. The board prints "Superseded by" the survivor.

**What stays.** The absorbed job keeps its own steps, scope, keys, saved answers and sources to get, as its record. It is superseded, not deleted, so it has no restore path. Outcomes: `merged`, `no_match` (a job changed between the read and the write, so re-render and read both cards again), and the refusals the tool's description lists. No revision bump. Re-render after it.

## 10a. Shelve and restore (bookkeeping)

Applying a shelving or restore is bookkeeping: permitted in every session, including on the job assigned to the session (ADR 0028), never counting as outlining, and never a licence to edit a job's title, intent or steps. Nothing below is held by the schema — `rejected_at` sits outside the `tickets` CHECKs and neither new table constrains anything but its own key — so every guard here is the script's own.

**Shelving a Proposal** — one row, `ticket_id` NULL. `marker` is the glyph the render printed and `item` the same item text §3's conversion record stores, both exactly as they stood at the moment of shelving:

```sql
INSERT INTO proposal_rejections (proposal_key, ticket_id, marker, item, rejected_at)
  VALUES ('note-up:authorities:5', NULL, '📇', 'Smith v. Jones, 2023 BCCA 182', strftime('%Y-%m-%dT%H:%M', 'now', 'localtime'));
```

**Only a Proposal in the `proposed` lane is shelved this way.** `drafting_forms__board_card` with `key` also shows a held Proposal: as the holding job, whose `keys:` line carries it, or as a Proposed line reading `lane: held by #N on <date the job was outlined>`. A request matching one of those is answered by naming the holder and offering to shelve that job instead — never by writing this row. A `ticket_id` NULL row under a held key is exactly what stands in the way of that job's own snapshot below. The insert is left unguarded on purpose: a collision here is a composition bug and should raise.

**Shelving a job** — `queued` or `wip` only; a `completed` or `superseded` job cannot be shelved, and the status guard is what refuses one. Which of the three scripts below applies is decided by the status and the holder: a `queued` job takes this one, a `wip` job in progress in another session takes the in-progress variant, and the session's own `wip` job takes the own-job variant. For a `queued` job the status is left as it is:

```sql
UPDATE tickets SET rejected_at = strftime('%Y-%m-%dT%H:%M', 'now', 'localtime')
  WHERE id = 42 AND status = 'queued' AND deleted_at IS NULL;
```

**A `wip` job in progress in another session** takes the variant below, which runs only after the practitioner has answered the decision form that names that session. The `WHERE` clause widens to `status IN ('queued', 'wip')`; what actually does the work is three further `SET` assignments, which clear the lock and set the status back to `queued` in the same `UPDATE` that stamps `rejected_at`, because the CHECK ties `status = 'wip'` to `locked_by`:

```sql
UPDATE tickets SET status = 'queued', locked_by = NULL, locked_at = NULL, rejected_at = strftime('%Y-%m-%dT%H:%M', 'now', 'localtime')
  WHERE id = 42 AND status IN ('queued', 'wip') AND deleted_at IS NULL;
```

Then run the confirm-read (§2's third shape): `status` back to `queued`, `locked_by` NULL, `rejected_at` stamped. This and §10's release with `expected_holder` (the take-over form's *Return it to Ready*) are the only places a session clears a lock it does not hold, each only on the practitioner's own answer — §9, §9a and §10's refusals stand everywhere else.

**The session's own `wip` job** — on the practitioner's typed "shelve job #N" about the job this session holds, applied at once with no decision form, since the typed instruction is the practitioner's own act. The same `SET` as the in-progress variant, guarded on this session's own token, so a job taken over in the meantime is never shelved without the form. Because the `UPDATE` clears the token, the snapshot rows below go **first** in the script, each carrying the same token guard beside its key-collision clause:

```sql
INSERT INTO proposal_rejections (proposal_key, ticket_id, marker, item, rejected_at)
  SELECT 'authority-excerpt:statements_of_law:12', 42, '📜', 'Smith v. Jones, 2023 BCCA 182 — the implied-term test', strftime('%Y-%m-%dT%H:%M', 'now', 'localtime')
  WHERE NOT EXISTS (SELECT 1 FROM proposal_rejections WHERE proposal_key = 'authority-excerpt:statements_of_law:12')
    AND EXISTS (SELECT 1 FROM tickets WHERE id = 42 AND locked_by = 'sess-a1');
UPDATE tickets SET status = 'queued', locked_by = NULL, locked_at = NULL, rejected_at = strftime('%Y-%m-%dT%H:%M', 'now', 'localtime')
  WHERE id = 42 AND status = 'wip' AND locked_by = 'sess-a1';
```

Then run the same confirm-read, then re-render. `queued`, `locked_by` NULL and `rejected_at` stamped means it landed, and this session holds no job and is assigned no other (§10). Another session's token means the job was taken over before the shelving and nothing was written: it is now in progress in another session, so offer that variant's decision form. NULL with `rejected_at` stamped means it was already shelved elsewhere; `completed` means a successor finished it. Report either and stop.

**A shelved job also takes one snapshot row per deriving key**, so its Proposals do not return to Proposed the moment the job leaves that Job list. One row for each key on the job's `keys:` line whose `(now: <glyph> "<current item>")` shows a Proposal deriving at that moment, carrying the job's own id, that glyph as `marker` and that current item, unquoted, as `item`, every value snapshotted from the job's card (`drafting_forms__board_card` with `jobs`). A key reading `(now: dead)` gets no row, and the job's `ticket_proposals` rows are left untouched.

**The insert is conditional, because `proposal_key` is the primary key.** A key can already carry a row — a direct shelving taken while the job held it, or another shelved job's snapshot after a lapse and restore. A plain `INSERT` raises there, and `execute` rolls the whole script back: the `rejected_at` stamp is lost, and in the in-progress variants the lock stays set although the practitioner already authorised clearing it. So the snapshot skips a key that already has a row, and the first row on a key wins:

```sql
INSERT INTO proposal_rejections (proposal_key, ticket_id, marker, item, rejected_at)
  SELECT 'authority-excerpt:statements_of_law:12', 42, '📜', 'Smith v. Jones, 2023 BCCA 182 — the implied-term test', strftime('%Y-%m-%dT%H:%M', 'now', 'localtime')
  WHERE NOT EXISTS (SELECT 1 FROM proposal_rejections WHERE proposal_key = 'authority-excerpt:statements_of_law:12');
```

**Never `INSERT OR IGNORE` here, and never `INSERT OR REPLACE`.** `OR IGNORE` suppresses every constraint on the statement, so a NULL `marker` or `item` would vanish silently instead of raising; the `WHERE NOT EXISTS` form skips only the key collision and leaves every other failure loud. `OR REPLACE` overwrites the existing row, so a direct shelving's `ticket_id` NULL row would be replaced by a snapshot and the restore below would match nothing, putting that shelving beyond recovery.

**What the skip costs.** The later shelved holder gets no row of its own, so when the earlier row goes — that job restored, or the shelving lapsed — the Proposal returns to Proposed while this job is still shelved. It shows in Shelved beside the returned Proposal, which is the same visible failure a lapsed snapshot already produces. Nothing is hidden; the practitioner shelves it again if they still want it gone.

A snapshot row only hides. The shelved job already shows in Shelved, so its Proposal gets no second line there. Where the row that survived is a direct shelving instead, the Proposal does show a second line — it was shelved in its own right, and that line is its own, not the job's.

**Restoring a Proposal** — delete the direct shelving. `AND ticket_id IS NULL` is load-bearing: without it the same `proposal_key` could take a shelved job's snapshot row with it:

```sql
DELETE FROM proposal_rejections WHERE proposal_key = 'note-up:authorities:5' AND ticket_id IS NULL;
```

**Restoring a job** — clear the stamp and delete the rows carrying its id, in the same script. It returns to whatever Job list its `status` gives it; one shelved while in progress comes back `queued` with no lock, and its done steps are inherited through §4's take-over read-back. `AND rejected_at IS NOT NULL` keeps this write as confirm-readable as every other one here: a restore aimed at a job that was never shelved matches zero rows and reads as a miss, rather than writing NULL over NULL and looking like a success:

```sql
UPDATE tickets SET rejected_at = NULL WHERE id = 42 AND rejected_at IS NOT NULL AND deleted_at IS NULL;
DELETE FROM proposal_rejections WHERE ticket_id = 42
  AND EXISTS (SELECT 1 FROM tickets WHERE id = 42 AND deleted_at IS NULL);
```

Both statements leave a deleted job alone: a typed restore of a deleted job takes "Restoring a deleted job" below, whose state read routes it there first, and without the guard a mis-routed restore would clear a deleted shelved job's stamp and delete its snapshot rows.

**Deleting lapsed rows.** A shelving applies to the line as it read when it was shelved. The render reports the keys whose shelving has lapsed — the Proposal now deriving under that key carries a different `marker` glyph or a different `item` — and the next Opening deletes those rows, with a one-line notice naming what it cleared:

```sql
DELETE FROM proposal_rejections WHERE proposal_key IN ('note-up:authorities:5', 'exhibit-pinpoint:statements_of_fact:8');
```

`marker` and `item` are compared exactly, with no normalisation of any kind — no case folding, no whitespace collapsing, no punctuation allowance. Rewording an item therefore lapses its shelving, which is the accepted cost of catching a reused row id. A shelving whose Proposal no longer derives at all has not lapsed: it is dormant, shows nowhere, and is left where it is, like a `killed_on` date.

**Deleting a mistaken job** — only on the practitioner's typed instruction to delete that job, for a job that should never have been written. It is received, never offered, and it is not a way to finish, drop or tidy work: a job the practitioner chose not to pursue is shelved (above), and one whose marker has gone is closed by §9b. While a marker-derived job is deleted its Proposals return to Proposed, and the next Opening's intake (§3e) writes them afresh while the marker still fires. To be rid of the work, shelve the Proposal or the job instead. A `queued` job, shelved or not, can be deleted, and so can a `wip` job held by this session. Another session's `wip` job is never deleted, and a `completed` or `superseded` job is refused. The delete stamps the job and moves nothing else (schema v54).

The delete is one `drafting_data__delete_job` call, `{db_path, ticket_ids, session_token}`, never a hand-written `UPDATE`. Several jobs named in one instruction go in one call. Each job's holder check and its `deleted_at` stamp are one guarded statement, so no session can claim the job between them. A `wip` job held by this session goes back to `queued` with its lock cleared in the same write, so a restore returns it as a Ready job with no lock, and from then on this session holds no job, as after a release (§10). The tool runs the confirm-read itself and returns one outcome per job:

- `deleted`: it landed.
- `held_elsewhere`: the job is in progress in another session, and nothing was written. Say so in one line and stop. The delete never clears another session's lock; the practitioner can return the job to Ready through `/draft`'s take-over form first.
- `refused_status`: the job is `completed` or `superseded`.
- `already_deleted`: it was deleted earlier.
- `not_found`: no job has that number.

Every outcome but `deleted` wrote nothing for that job. Report each one and never re-run to win.

**What the deletion leaves.** Nothing is deleted, so the restore below returns the job exactly as it was. Every row that points at the job stays where it is: its steps, scope rows, waits-on and either/or edges, Proposal keys, shelving-snapshot rows, the loose threads captured under it or outlined into it, the practitioner's comments on it and the answers saved for it. Every reader skips the job and reads those rows as if it were gone: a job that waited on it no longer waits on it; its either/or partner is no longer held back by it; a job it superseded (a stale gate job pointed at it) reads as superseded with no pointer; a loose thread outlined into it shows again in "Loose Threads", and a loose thread captured under it shows with no origin job; its Proposals return to Proposed; and its snapshot rows hide nothing and are never reported lapsed, so the Opening's lapsed-row deletion never takes them. A job carrying comments or saved answers deletes like any other. Accepted cost: a loose thread outlined into a new job while this one is deleted moves to that job, and the restore does not take it back. A deleted job on a Writing later retired is left as it was by §9a, and restoring it afterwards is accepted, putting a `queued` job back on the retired Writing for the practitioner to shelve or close.

**Where it shows.** Only as one struck red line in the Job Board page's Completed list, with a Restore link that copies `restore job #N` for the practitioner to paste into a session. It is on no card, in no count and in no summary, so a session that needs its state takes the read-first below.

**Restoring a deleted job** — on the practitioner's typed `restore job #N`, the instruction the page's Restore link copies. Read first:

```sql
SELECT status, rejected_at, deleted_at FROM tickets WHERE id = 42;
```

This is the state read `/draft` takes on every typed `restore job #N`, because a deleted job is on no card. `deleted_at` set: this restore. `deleted_at` NULL with `rejected_at` set: "Restoring a job" above. Both NULL: nothing to restore, so say "Job #42 is neither deleted nor shelved" and write nothing.

While the job was deleted its Proposals returned to Proposed, and intake may have written a new job for one of them. Restoring it then would leave two live jobs holding one key, so the restore matches no row while another live job holds any of its keys. A shelved job holds nothing, so a shelved deleted job always restores:

```sql
UPDATE tickets SET deleted_at = NULL
  WHERE id = 42 AND deleted_at IS NOT NULL
    AND (rejected_at IS NOT NULL OR NOT EXISTS (
      SELECT 1 FROM ticket_proposals p JOIN tickets t ON t.id = p.ticket_id
        WHERE t.id <> 42 AND t.status IN ('queued', 'wip') AND t.rejected_at IS NULL AND t.deleted_at IS NULL
          AND p.proposal_key IN (SELECT proposal_key FROM ticket_proposals WHERE ticket_id = 42)));
```

Then run the confirm-read, the same `SELECT` as the read-first. `deleted_at` NULL means it landed: the job is back in whatever list its `status` and `rejected_at` give it, with every step, scope row, edge, key, snapshot row, comment and answer as they were. `deleted_at` still set means another live job holds one of its keys. Run the holder read, say "Job #M now holds `<key>`. Delete or shelve Job #M first, then restore Job #42.", and stop:

```sql
SELECT t.id, t.title, p.proposal_key FROM ticket_proposals p JOIN tickets t ON t.id = p.ticket_id
  WHERE t.id <> 42 AND t.status IN ('queued', 'wip') AND t.rejected_at IS NULL AND t.deleted_at IS NULL
    AND p.proposal_key IN (SELECT proposal_key FROM ticket_proposals WHERE ticket_id = 42);
```

After a restore that landed, re-render.

## 10b. Bring forward (bookkeeping)

A job the practitioner wants held until a set day carries that day in `tickets.bf_on` (schema v74), a `YYYY-MM-DD` by CHECK. Until then the job shows in the Job Board's Bring Forward lane, tagged `BF <date>` on `board_card`'s `live` lane, and `drafting_data__assign_job` refuses it with `before_bf` (`jobs-run.md` §4). From that day on it reads as Blocked or Ready with no write: the lane is derived at each render from the local date, and nothing is stored but the date. Bring Forward waits on a date, Blocked waits on another job, and a job held by both shows in Bring Forward first.

**A BF date is a start date, never a deadline** (`shared/deadline-isolation.md`). It is printed as a plain date, with no day count, no overdue marking and no "due". Never label, compute or reason about it as a deadline or a limitation date, and never send it to `lawyer:docket-clerk`.

**Only on the practitioner's word.** A session sets, changes or clears a BF date only when the practitioner says so and names the date, either as a calendar date or as a calendar phrase counted from today ("next Monday", "the week after next", "the first business day of the week after next"). It is never proposed, offered, inferred from a document or computed from another date: a phrase counted from anything but today ("two weeks after the hearing") names no date, so ask for one. Like a shelving, the write is bookkeeping: permitted in every session, and never a licence to edit the job's title, intent or steps.

**A date given as a phrase.** Resolve it with a read-only `drafting_data__query` using SQLite date modifiers on `date('now', 'localtime')`, never by your own arithmetic, for example "Monday of the week after next":

```sql
WITH d(bf_on) AS (SELECT date('now', 'localtime', '+1 day', 'weekday 1', '+7 days'))
SELECT bf_on, CASE strftime('%w', bf_on) WHEN '0' THEN 'Sunday' WHEN '1' THEN 'Monday' WHEN '2' THEN 'Tuesday'
  WHEN '3' THEN 'Wednesday' WHEN '4' THEN 'Thursday' WHEN '5' THEN 'Friday' ELSE 'Saturday' END AS weekday FROM d;
```

Print the result in plain text as the weekday and the date ("Monday, 2026-11-02") and write it only on the practitioner's bare yes. The query's date, not the phrase, is what is confirmed and written, and the write below still takes a literal `YYYY-MM-DD`. A date the practitioner changes in reply replaces the phrase and is read back the same way. A phrase with more than one reasonable reading ("the Monday of the week after next" against "the second Monday from now") is never resolved silently: resolve each reading, show the two or three dates, and ask which. A business day is Monday to Friday: a "business day" phrase skips Saturday and Sunday and nothing else, since the session holds no holiday calendar and the read-back is where the practitioner catches a holiday. A weekday named outright resolves to that weekday, a Saturday or Sunday included.

**Setting or changing the date** — a `queued`, unshelved job only. A `wip` job is not moved by a date, so release it first (`jobs-run.md` §10) if the practitioner wants it held; a shelved one is restored first (§10a):

```sql
UPDATE tickets SET bf_on = '2026-11-02'
  WHERE id = 42 AND status = 'queued' AND rejected_at IS NULL AND deleted_at IS NULL;
```

**Clearing the date** — which is also how the practitioner has a job worked before its date: there is no override on the assigning write.

```sql
UPDATE tickets SET bf_on = NULL WHERE id = 42 AND bf_on IS NOT NULL AND deleted_at IS NULL;
```

Then, after either, run the confirm-read:

```sql
SELECT status, rejected_at, deleted_at, bf_on FROM tickets WHERE id = 42;
```

`changes` 1 with `bf_on` as written means it landed. `changes` 0 means the guard matched nothing and the row says why: a status other than `queued`, `rejected_at` or `deleted_at` stamped, or, on a clear, no date to clear. A date that is not a `YYYY-MM-DD` is refused by the CHECK. Report which it was and stop. No revision bump. After a write that landed, re-render.

## 10c. Move jobs to another board (bookkeeping)

**When.** The practitioner asks to move one job, several, or every job of one board to another board of the matter. A request to merge two boards is §10d, not a move. Received, never offered. Like a shelving, the move is bookkeeping: permitted in every session, never counting as outlining, and never a licence to edit a job's title, intent or steps. It is the one write that changes a job's `filing_id` (`jobs-create.md` §3a).

**The target.** Name it from `filing-checklists.md` §14's "The matter's boards" read. The source and the target share a `proceeding_id`, because no job moves between proceedings (`jobs-integrity.md` §11), and the target is live (`retired_on IS NULL`). It may be a Writing or a Job Board with no Writing. Proceeding scope (`filing_id` NULL, which makes each moved job a General Job) is a target only when the source is a Writing's board, because a General Job never shows on a Job Board with no Writing (`jobs-integrity.md` §11). Every guard below is the script's own: nothing in the schema refuses a move.

**What moves.** Every `queued` job on the source with `deleted_at` NULL, shelved ones included, and, on a whole-board move, the source's open loose threads, so a Job Board with no Writing's own threads follow its jobs. A job holding a `note-up` key, or a key on one of the Writing's own rows (`filings`, `filing_facts`, `filing_submissions` or `filing_orders`, `jobs-create.md` §3, "`filing_id` on a job outlined from a Proposal"), stays: §3k's one-note-up-job-per-Writing guard reads `filing_id`, and those keys name the source Writing. `completed`, `superseded` and deleted (§10a) jobs stay too. Edges stay as they are: a `ticket_blocks` or `ticket_conflicts` edge still joins two jobs of one proceeding, which is all `jobs-integrity.md` §11 asks.

**Read first — a `wip` job on the source refuses the move**, as it refuses §9a's close, and the jobs that stay are named in one line. Here the source is board `7`:

```sql
SELECT id, title, locked_by, locked_at FROM tickets WHERE filing_id = 7 AND status = 'wip';
SELECT DISTINCT t.id, t.title, p.proposal_key FROM tickets t JOIN ticket_proposals p ON p.ticket_id = t.id
  WHERE t.filing_id = 7 AND t.status = 'queued' AND t.deleted_at IS NULL
    AND (p.proposal_key GLOB 'note-up:*' OR p.proposal_key GLOB '*:filings:*' OR p.proposal_key GLOB '*:filing_facts:*'
      OR p.proposal_key GLOB '*:filing_submissions:*' OR p.proposal_key GLOB '*:filing_orders:*');
```

A row from the first read: stop, write nothing, and report the job and its holder. Rows from the second: those jobs stay on the source, to be closed by §9b or left; name them in one line.

**Move every job of a board**, one `execute` script, here from board `7` to board `8`. Every statement carries the same `wip` guard and the target's live, same-proceeding guard:

```sql
UPDATE tickets SET filing_id = 8
  WHERE filing_id = 7 AND status = 'queued' AND deleted_at IS NULL
    AND NOT EXISTS (SELECT 1 FROM ticket_proposals p WHERE p.ticket_id = tickets.id
      AND (p.proposal_key GLOB 'note-up:*' OR p.proposal_key GLOB '*:filings:*' OR p.proposal_key GLOB '*:filing_facts:*'
        OR p.proposal_key GLOB '*:filing_submissions:*' OR p.proposal_key GLOB '*:filing_orders:*'))
    AND EXISTS (SELECT 1 FROM filings f WHERE f.id = 8 AND f.proceeding_id = tickets.proceeding_id AND f.retired_on IS NULL)
    AND NOT EXISTS (SELECT 1 FROM tickets w WHERE w.filing_id = 7 AND w.status = 'wip');
UPDATE seeds SET filing_id = 8
  WHERE filing_id = 7 AND charted_into IS NULL AND discarded_at IS NULL AND suggested_at IS NULL
    AND EXISTS (SELECT 1 FROM filings f WHERE f.id = 8 AND f.proceeding_id = seeds.proceeding_id AND f.retired_on IS NULL)
    AND NOT EXISTS (SELECT 1 FROM tickets w WHERE w.filing_id = 7 AND w.status = 'wip');
```

To proceeding scope, from a Writing's board only, each statement sets `filing_id = NULL` and drops the target's `EXISTS` clause.

**Move one job**, or several named by id, with the same guards on each id, here job `42`:

```sql
UPDATE tickets SET filing_id = 8
  WHERE id = 42 AND filing_id = 7 AND status = 'queued' AND deleted_at IS NULL
    AND NOT EXISTS (SELECT 1 FROM ticket_proposals p WHERE p.ticket_id = tickets.id
      AND (p.proposal_key GLOB 'note-up:*' OR p.proposal_key GLOB '*:filings:*' OR p.proposal_key GLOB '*:filing_facts:*'
        OR p.proposal_key GLOB '*:filing_submissions:*' OR p.proposal_key GLOB '*:filing_orders:*'))
    AND EXISTS (SELECT 1 FROM filings f WHERE f.id = 8 AND f.proceeding_id = tickets.proceeding_id AND f.retired_on IS NULL)
    AND NOT EXISTS (SELECT 1 FROM tickets w WHERE w.filing_id = 7 AND w.status = 'wip');
```

Then run the confirm-read:

```sql
SELECT id, filing_id, status FROM tickets WHERE filing_id IN (7, 8) AND deleted_at IS NULL ORDER BY id;
```

`changes` 0 means a `wip` job appeared, the target is retired or in another proceeding, or nothing qualified: re-run the read-first and report which. No revision bump: the job tables are exempt (`jobs-common.md`). After a move that landed, re-render both boards under `draft_dir`.

**Emptying a board** is two acts: this move, then closing the Job Board with no Writing (§9a's close) or retiring the Writing (`/draft` `retire-filing.md`). Say so in one line, and ask for the second separately: the move never closes or retires anything. When the practitioner asks to merge two boards, that is §10d, which keeps both boards' Writings and jobs where they are.

## 10d. Merge two Job Boards

**When.** The practitioner asks to merge two boards. Received, never offered. A merge joins two boards whose goals overlap or cohere onto one page (`docs/ADRs/0010-job-boards-organized-by-goals.md`): the survivor's page draws both as one board, with one Completion Criteria card and one set of lanes holding both boards' jobs, each naming its Writing, and one set of view pages spans the board's Writings. No job, loose thread or Writing row is written. Boards in different proceedings may merge, as may a Job Board with no Writing and a pre-filing proceeding's board.

**Ask first.** Read both boards' statements of goals (`drafting_forms__board_card`, lane `goals`) and show them side by side, each as "none" when it has none. In the same reply, propose one combined goal for the merged board as the reply's only fenced code block, framed per `shared/paralegal-posture.md` section 3b, "Goal framing": one outcome sentence, never a document, a step or two Writing titles joined. Then ask whether to merge the two boards with that goal. The question says in plain words that each Writing stays a separate filing, with its own documents, numbering, mockup and jobs, and that only the Job Board page, the view pages and the goal combine. For example: "Merging puts both boards on one Job Board page, with one set of view pages and the one goal above. The Requisition and the Notice of Application stay separate filings, each with its own documents and numbering. Merge the two boards with that goal? Or type the goal you want instead." When the practitioner's words show they expect the Writings themselves combined, say first that Probanda cannot move documents between Writings or make two Writings into one. A bare yes confirms both the merge and the proposed goal. A sentence the practitioner types in reply is their goal and replaces the proposal. The practitioner-words gate refuses any other call. When the practitioner wants the merge but no goal yet, ask "Merge without a goal for now?" and, on a bare yes, merge with no `goal_statement`.

**The write.** `drafting_data__merge_job_boards` `{db_path, boards: [{filing_id | proceeding_id}, {filing_id | proceeding_id}], confirmed: true, session_token, goal_statement?}`. `goal_statement` is the fenced block character for character after a bare yes, or the practitioner's own sentence; omit it when they gave no goal. It picks the survivor (a Writing's board over a Job Board with no Writing over a pre-filing board, then the lower id) and writes the goal as the board's one statement, confirmed. Every earlier statement of both boards is kept under the survivor's `merged` as history only, never drawn once the board holds one goal. Without `goal_statement` the board's goal status is `needs_consolidation`, and `/draft`'s next attended Opening asks once for one combined goal (`draft/references/dispatch.md`, "Statement of goals"). Relay a framing warning in the note once. A board already merged into another refuses `board_merged`: name its survivor. `drafting_forms__board_card` reads the merged board by the survivor's id and refuses the absorbed board's with `board_merged` too. Then re-render under `draft_dir`: the absorbed board's pages move to `TRASH`.

**Splitting** a merged board is specified in the ADR and not yet built: say so and stop.

## 13. Clearing the retired Work Board keys

The hosted Work Board artifact is retired (`docs/design/2026-09-14 work-board-local-only-design.md`, ADR 0015): the board is a local file only, and nothing in this file is mirrored anywhere. A matter that published one under the retired design still holds two `db_meta` keys, and `drafting_forms__bootstrap` reports the first as `legacy_workboard_artifact_url`. Two scripts, run only from `/draft` step 2, at most one of them ever per matter. Like every script in this file except §9a's retirement script, they touch only exempt tables, so §8's revision bump never fires for them.

**Clear**, only after the Artifact tool's `delete` of that URL has succeeded or found none. Clearing the keys first would leave a hosted artifact no later session can find, which is also why no migration clears them:

```sql
DELETE FROM db_meta WHERE key IN ('workboard_artifact_url', 'workboard_template_version');
```

**Record the practitioner's word**, only when the practitioner has said the board is already gone and the `delete` could not be issued at all (no Artifact tool, or nobody present to answer the host's confirmation prompt). A `delete` that was issued and failed, or a prompt the practitioner declined, writes nothing. No session can verify the statement, so the address is not cleared: it moves to a key bootstrap does not read. The report stops, and the address stays here under that key if the board ever turns out to still exist. Nothing offers its deletion again; restoring the report is a manual write of the key name back.

```sql
UPDATE db_meta SET key = 'workboard_artifact_url_attested_gone' WHERE key = 'workboard_artifact_url';
DELETE FROM db_meta WHERE key = 'workboard_template_version';
```
