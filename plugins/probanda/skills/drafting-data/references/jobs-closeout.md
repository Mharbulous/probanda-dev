Read when: the practitioner retires a Writing, closes a job as superseded, shelves or restores a Proposal or a job, or deletes a mistaken job or restores a deleted job; the render reports lapsed shelvings; or `drafting_forms__bootstrap` returns a non-null `legacy_workboard_artifact_url`.
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

## 9b. Close as superseded (bookkeeping)

A job outlined from Proposals whose marker no longer shows is closed on the practitioner's instruction, never on a session's own initiative and never by the render (the 2026-09-21 design §4.7). It is the practitioner-visible act for that case: not a shelving, which reads as an angle they chose not to pursue, and not a completion, which would stamp work that was never done.

**When it may run.** Only when the job's card (`drafting_forms__board_card` with `jobs`), read after a current render, shows every key on its `keys:` line as `(now: dead)`. If this session has written substance since its last render, render first. One widening (the 2026-09-21 design §4.8): a fast-path job whose item changed may be closed while its key still derives. A fast-path job here means a one-step job whose title is the Proposal's own `<work name>: <old item>`, and the practitioner chose "close it as superseded" from the three-choice form. It is available wherever shelving and restoring are (§10a), for any job except the session's own. A job in progress in another session is left to that session or a take-over, and the guard below refuses it.

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

**Deleting a mistaken job** — only on the practitioner's typed instruction to delete that job, for a job that should never have been written. It is received, never offered, and it is not a way to finish, drop or tidy work: a job the practitioner chose not to pursue is shelved (above), and one whose marker has gone is closed by §9b. While a marker-derived job is deleted its Proposals return to Proposed, and the next Opening's intake (§3e) writes them afresh while the marker still fires. To be rid of the work, shelve the Proposal or the job instead. Only a `queued` job, shelved or not, can be deleted. A `wip`, `completed` or `superseded` job is refused by the guard. The delete stamps the job and moves nothing (schema v54):

```sql
UPDATE tickets SET deleted_at = strftime('%Y-%m-%dT%H:%M', 'now', 'localtime')
  WHERE id = 42 AND status = 'queued' AND deleted_at IS NULL;
```

Then run the confirm-read:

```sql
SELECT status, rejected_at, deleted_at FROM tickets WHERE id = 42;
```

`changes` 1 with `deleted_at` stamped means it landed. `changes` 0 means the guard matched nothing and the row says why: `wip`, `completed` or `superseded` is refused by its status, and `queued` with `deleted_at` already stamped was deleted earlier. Report which it was and stop.

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

**A BF date is a start date, never a deadline** (`shared/deadline-isolation.md`). It is printed as a plain date, with no day count, no overdue marking and no "due". Never label, compute or reason about it as a deadline or a limitation date, and never send it to `probanda:docket-clerk`.

**Only on the practitioner's word.** A session sets, changes or clears a BF date only when the practitioner says so and names the date. It is never proposed, offered, inferred from a document or computed from another date. The date is the one job value typed as the practitioner gave it and not computed in SQL (`jobs-common.md` §0). Like a shelving, the write is bookkeeping: permitted in every session, and never a licence to edit the job's title, intent or steps.

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
