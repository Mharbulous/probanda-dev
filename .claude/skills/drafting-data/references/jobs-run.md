Read when: `drafting_data__assign_job` returns `assigned`, and for every write on that job until it is completed or released: plan approval, a step stamp, a scope expansion, a loose thread, the completion, a release, a spin-off of blocker jobs (§3f). Also, holding no job, when `/legal-research` captures a research return's open items for a draft (§8a).
Any §N not in this file: find it in SKILL.md, "Job and scrutiny operations".

## 4. Assign

This write and its confirm-read run as one call, `drafting_data__assign_job` (`takeover: true` for the variant below); the SQL here is what that tool runs and is kept as the documented semantics.

**One job per session, and a session that created jobs takes only one of its own.** Creating jobs (§3) does not use up the session's one job. But once any job carries this session's token in `created_by` (§3), the session is assigned only a job that carries it: never a pre-existing job, and never one another session created (Brahm, 2026-10-09, replacing "never in a session that has outlined"). A session that only outlined afresh (§3a) created nothing and is assigned no job. A §3f spin-off is not outlining, writes no `created_by`, and is run by the holding session on the job it holds.

```sql
UPDATE tickets SET status = 'wip', locked_by = 'sess-a1', locked_at = strftime('%Y-%m-%dT%H:%M', 'now', 'localtime')
  WHERE id = 2 AND status = 'queued' AND locked_by IS NULL AND rejected_at IS NULL AND deleted_at IS NULL
    AND (created_by = 'sess-a1' OR NOT EXISTS (SELECT 1 FROM tickets c WHERE c.created_by = 'sess-a1'));
```

The `created_by` clause is the creator guard. It rides the take-over variant below too. On a database before v72, which has no `created_by`, the tool leaves it out.

`'sess-a1'` stands in for your own `session_token` (§1) — write that value, never a name you invented.

`AND rejected_at IS NULL` is what stops a session being assigned a job the practitioner has since shelved: an Opening card composed from a stale board matches zero rows, and the confirm-read below stops the session there. That guard is the only barrier, because `rejected_at` sits outside the table's CHECKs by design — nothing else in the database refuses the assigning write. `AND deleted_at IS NULL` is the same barrier for a deleted job (§10a).

`AND status = 'queued'` is the same kind of barrier, for a superseded job. A job superseded **by another job** is refused loudly without it, because `superseded_by` is set and the CHECK is `superseded_by IS NULL OR status = 'superseded'` — moving that row to `wip` fails the CHECK and the whole script rolls back. But a retirement supersedes with no superseding job (§9a), so `superseded_by` stays NULL and the CHECK is satisfied by the `wip` row: without the status clause, a retirement-superseded job is silently assigned straight back to `wip`. The status clause is the only barrier there, exactly as `rejected_at IS NULL` is the only barrier for a shelved one.

Then run the confirm-read (§2). Three failures, and they are not the same failure:

- **Another session's token on the returned row** — the assigning write lost a race (single-practitioner use makes this rare, not impossible). Re-render and restate the Opening, with one line saying the job was just taken. Never proceed as if the job had been assigned, and never convert it into a take-over on your own initiative. **With nobody to present the Opening to** (the unattended run, the 2026-09-21 design §5.4): stop and report the lost race, naming the job and the token now on it. Never retry, whether on that job or the next eligible one.
- **`not_created_here`** — `locked_by` NULL, this session created jobs, and the returned row's `created_by` is not this session's token: the creator guard refused it. Nothing was written. Say in one line that this session created jobs and may be assigned only one of those, and that a new `/draft` session takes this one. Never retry.
- **`locked_by` NULL on the returned row** otherwise — not a race for the lock. Two writes clear a `wip` lock: §10's release, which the holding session runs on its own job and another session runs only on the practitioner's "Return it to Ready" (ADR 0037), and §10a's in-progress shelving, which clears the lock and stamps `rejected_at` in the same `UPDATE`, and runs on another session's job only on the practitioner's own answer. Short of one of those landing between the assigning write and this read, a NULL here means the `UPDATE` matched no row at all: a wrong id, or a job already `wip` or shelved when the card was composed. That is a composition bug in this session's own script. This read cannot tell the two apart, because a job shelved before the card was composed carries `rejected_at` too, and a release landing in between leaves the same row as a wrong id. Either way, stop and report it, naming the id written and what the read returned.

**Take-over variant** (design §5.2 — a `wip` job started in another session, possibly still open): the same `UPDATE` with no `locked_by IS NULL` guard and a widened status clause, only after the practitioner has explicitly said yes to the take-over prompt:

```sql
UPDATE tickets SET status = 'wip', locked_by = 'sess-a1', locked_at = strftime('%Y-%m-%dT%H:%M', 'now', 'localtime')
  WHERE id = 2 AND status IN ('queued', 'wip') AND rejected_at IS NULL AND deleted_at IS NULL AND substr(locked_by, -8) = 'ss-other'
    AND (created_by = 'sess-a1' OR NOT EXISTS (SELECT 1 FROM tickets c WHERE c.created_by = 'sess-a1'));
```

`'ss-other'` stands in for the `holder:` tag on the job's card, the last 8 characters of the holder's token.

The shelving guard stays on: a shelved job is never assigned, by take-over or otherwise. The status clause widens to admit the `wip` job the take-over is for, and still refuses the completed and superseded ones for the reason above. The confirm-read afterward still matters: it is what proves the new `locked_by` actually landed.

`holder_changed`, another session's token on the row after a take-over, means another session took the job over between the card read and this write. Nothing was written: re-render and ask the practitioner afresh, and never re-run to win. For the own-token case below, the card's tag is your own token's last 8 characters.

Before either, apply §1's start-time rule: a `wip` job whose `locked_at` precedes your `bootstrapped_at` is another session's, so it takes the take-over variant and the practitioner's yes, even if its `locked_by` already equals your token.

## 5. Plan approval

**The guard rides every statement in the script** — the rule §3a states, for the same reason: `drafting_data__execute` runs the script in one transaction and rolls back on an exception, and a guarded write matching zero rows is not one, so an unguarded statement beside a guarded one commits alone. The predicate is different here. §3a's job has no holder; this one is `wip` under this session's own lock, so what each statement proves is that the lock is still this session's — `locked_by = 'sess-a1'`, your own `session_token` (§1), written as the literal value, never a name you invented. That one clause is the whole guard: the CHECK ties `status = 'wip'` to a non-NULL `locked_by`, so it refuses every way a held job can leave this session between the assigning write and this one — a take-over (§4), which writes another session's token, and §10a's in-progress shelving, which clears the lock, as does a successor's completion (§9) after a take-over. No `rejected_at` clause is needed beside it, because no script in the job checklist leaves this session's token on a shelved row.

`plan_approved_at` is the approval stamp, and the approved plan is the job's `ticket_steps` rows: no column holds the plan a second time. A first approval, or a re-approval, stamps it:

```sql
UPDATE tickets SET plan_approved_at = strftime('%Y-%m-%dT%H:%M', 'now', 'localtime')
  WHERE id = 2 AND locked_by = 'sess-a1';
```

The steps are the legal work presented to the practitioner for approval (design §3.2) — never tool calls, table names, or SQL — and any replaced `ticket_steps` are the steps they confirmed or changed, in their words.

**Stamp only when the steps are unchanged.** An approval that leaves the steps as they stand on the job — nothing reworded, reordered, added or removed — writes only the stamp above on a first approval. An already-approved job takes the next paragraph, which writes nothing. A newly assigned job whose steps are announced as written at outlining is approved by the stamp alone. `/draft` writes that stamp itself, after announcing the plan, under the practitioner's standing announce-and-proceed rule (`draft/references/job-session.md`, Announce and proceed), so a stamp with no step list replaced records an approval under that rule; a replaced list is the Change path's, in the practitioner's words.

The stamp-only approval and its confirm-read run as one call, `drafting_data__approve_plan` `{db_path, ticket_id, session_token}`; never hand-write it through `execute`. It runs the stamp above with one more guard, `AND plan_approved_at IS NULL`, so an already-approved job is left alone as the next paragraph requires, then the confirm-read below. Outcomes: `approved` (`changes` 1), `already_approved` (this session's token, `plan_approved_at` already set, `changes` 0), and `not_held`, `shelved`, `completed` or `no_match`, read as the confirm-read below reads them. Never retry. It moves no revision. Refusals write nothing: `invalid_ticket_id`, `invalid_session_token`, `not_found`, and `no_steps`, a job with no `ticket_steps` rows and so no plan to approve.

**A re-approval confirmed unaltered writes nothing.** If the job is already approved and the practitioner confirms the read-back step list unaltered, `plan_approved_at` and `ticket_steps` are left alone, as §3a leaves them, and every `done_at` on those steps survives. `plan_approved_at` is not re-stamped: it still records when those same steps were approved. On a taken-over job this is what keeps the predecessor session's `done_at` stamps, which the take-over exists to inherit.

**Otherwise the steps travel with the approval.** The `ticket_steps` rows must be the approved plan, so a change always replaces the whole list. A re-approval after "Change" that re-stamps the approval and leaves the old rows in place is what makes a later session inherit `done_at` marks that no longer correspond to anything approved. So a first approval whose steps differ from the rows on the job, and every re-approval that alters the steps through the outlining interview, replaces the step list in the same script as the stamp:

```sql
DELETE FROM ticket_steps WHERE ticket_id = 2
  AND EXISTS (SELECT 1 FROM tickets WHERE id = 2 AND locked_by = 'sess-a1');
INSERT INTO ticket_steps (ticket_id, ordinal, text)
  SELECT 2, 1, 'Audit the exhibit list' FROM tickets WHERE id = 2 AND locked_by = 'sess-a1';
INSERT INTO ticket_steps (ticket_id, ordinal, text)
  SELECT 2, 2, 'Reconcile against the disclosure log' FROM tickets WHERE id = 2 AND locked_by = 'sess-a1';
UPDATE tickets SET plan_approved_at = strftime('%Y-%m-%dT%H:%M', 'now', 'localtime')
  WHERE id = 2 AND locked_by = 'sess-a1';
```

Each replaced step's text is a run of one practitioner turn: their own words, or the block they pasted back by the adoption ceremony (`shared/paralegal-posture.md` section 3). The practitioner-words gate refuses any other.

If the practitioner asks for a change, it is taken in their words through the outlining interview's questions (still the same session, still the same assigned job); the revised step list is written once, with the stamp, on re-approval, exactly as above.

**The premise check's Change path also drops the dead keys.** Where the Change was taken because a key's marker no longer fires — the assign-time premise check amendment to `Engineering/1. Design/2026-09-15_work-board-proposals-design.md` — the same script deletes those keys from `ticket_proposals`. The practitioner has just dropped that work, and a marker firing again on one of those rows must not stay hidden behind this job. The dead set is every key on the `keys:` line of the job's card (`drafting_forms__board_card` with `jobs`) that reads `(now: dead)`; name it positively, as literals copied character for character out of that line on §3's terms, never recomposed from a slug and a row id:

```sql
DELETE FROM ticket_proposals WHERE ticket_id = 2
  AND proposal_key IN ('note-up:authorities:5', 'authority-excerpt:statements_of_law:12')
  AND EXISTS (SELECT 1 FROM tickets WHERE id = 2 AND locked_by = 'sess-a1');
```

Never a `NOT IN` of the keys kept: a `DELETE` should name what it removes, and `NOT IN` removes every key the session failed to name. Only on that path: a first approval, or a re-approval the practitioner asked for on their own account, has no dead set and writes no such statement. Where every key is dead the job ends holding no conversion record at all. Accepted cost: it hides nothing, which is the point, but the next time it is assigned the check reports it as outlined by hand, which is wrong about where it came from.

This and §3a's "keep it" path are the only writes in the job checklist that remove `ticket_proposals` rows.

**The Change path also refreshes `item` on the keys the job keeps**, on §3a's terms: only a key whose item now reads differently, only after the practitioner has been shown both texts and confirmed, and in the same script, under this section's guard:

```sql
UPDATE ticket_proposals SET item = 'Brown v. Green, 2024 BCSC 77'
  WHERE ticket_id = 2 AND proposal_key = 'note-up:authorities:5'
    AND EXISTS (SELECT 1 FROM tickets WHERE id = 2 AND locked_by = 'sess-a1');
```

Then run the confirm-read — §2's third shape, the same one §10a uses:

```sql
SELECT id, title, status, rejected_at, locked_by, priority FROM tickets WHERE id = 2;
```

`locked_by` still your own token: every statement in the script landed. Anything else and none of them did, and the readings are not §4's — your own assigning write already proved the id, so this is never a composition bug. **Another session's token** — the job was taken over (§4) after it was assigned to you. **NULL with `rejected_at` stamped** — the practitioner shelved it in another session (§10a), which clears the lock. **NULL with `status = 'completed'`** — it was taken over and finished there. Either way this session's job work is over: a shelved job cannot be assigned again (§4), and a taken-over one belongs to its new holder. Report which one it was, naming any files saved under the job, and stop; never re-run the script against a guess about what changed.

## 6. Step progress

Stamp `done_at` as each step of the approved plan completes — a successor session (after an interrupted `wip` job is taken over) reads this off the Job Board to know what's already done:

```sql
UPDATE ticket_steps SET done_at = strftime('%Y-%m-%dT%H:%M', 'now', 'localtime')
  WHERE ticket_id = 2 AND ordinal = 1
    AND EXISTS (SELECT 1 FROM tickets WHERE id = 2 AND locked_by = 'sess-a1');
```

That `EXISTS` is §5's guard in its child-table shape — the same clause, on a child row, for the same reason; §5 states it and nothing is restated here. The harm it refuses is specific: after a take-over the successor may already have re-approved through §5, which deletes and recreates `ticket_steps`, so `ordinal = 1` no longer names the same work. The bare stamp then lands `done_at` on a step nobody has done while the step actually worked reads undone, and the Job Board shows a step done that was not — the very read-back a take-over exists to inherit.

**No confirm-read here: read `changes` on each tick.** `changes` 1 means the stamp landed. `changes` 0 means it matched nothing, which means the holder changed: stop, and run §2's scope read, whose row says why. That misses a wrong but valid ordinal, which matches one row: read `ordinal, text` first.

## 7. Scope expansion

The practitioner may expand a job's scope at any time (design §6.3); the expansion is itself in scope for the job's current holder. Append, never delete an existing scope row:

```sql
INSERT INTO ticket_scope (ticket_id, entity, entity_id)
  SELECT 2, 'statements_of_law', 12 FROM tickets WHERE id = 2 AND locked_by = 'sess-a1';
```

That `INSERT ... SELECT` is §5's guard in its child-insert shape — the same clause, proving the lock is still this session's; §5 states it and nothing is restated here.

Re-run the scope read (§2) immediately after, so the write that prompted the expansion checks against the row that was actually just added, not a cached copy. **That read is also the confirm-read**, so this section needs none of its own: the session composed the literal `(entity, entity_id)` pair it just wrote, so a guarded miss makes that pair absent from the read, and since the read now carries the holder columns too, the same row says why. One edge worth recording: where an identical `(entity, entity_id)` pair already existed on this job, the read cannot tell the new row from the old one. That is harmless, because the scope already covers the write the expansion was for.

**§7's harm is the lowest this guard programme covers**, and the guard here is consistency rather than urgency. On a taken-over job the successor inherits a scope row the practitioner asked for; on a shelved one the next outline afresh replaces the scope rows wholesale (§3a). Neither leaves a false read-back behind, which is what §6's guard exists to prevent.

## 8. Loose-thread capture

Mid-job, an out-of-scope idea may be captured without deciding anything about it (design §7) — a standing scope exemption, so this write is always in scope regardless of the current job's own `ticket_scope` rows:

```sql
INSERT INTO seeds (proceeding_id, filing_id, origin_ticket_id, created, surfaced_by, idea)
  VALUES (1, 1, 2, strftime('%Y-%m-%dT%H:%M', 'now', 'localtime'), 'noticed while reconciling the exhibit list', 'Consider a standing exhibit-numbering convention for future filings in this proceeding.');
```

`origin_ticket_id` is the job this session holds. Its card (`drafting_forms__board_card` with `jobs`) then lists the loose thread, and the loose thread's `created` counts as the job's latest activity, which the idle tag measures from.

`idea` is captured **verbatim**, at most five sentences, with no options or recommendations — the appearance of alternatives is the tell that outlining has started, and it belongs in an outlining session, not this write. `surfaced_by` is one line naming what surfaced it (a Westlaw memo, a practitioner aside, a document read in passing) — never `TRIGGER`; that column was deliberately not named after the SQLite keyword.

### 8a. With no job held

`shared/legal-research.md`'s after-the-answer step ("With an origin, the return's open items go on the board") captures a research return's open items for the draft the question came from, in a session holding no job. Same write, same `idea` and `surfaced_by` rules, with `origin_ticket_id` NULL: no job surfaced it, so there is no lock to guard and no job's idle clock to restart. The thread renders under "Loose Threads" with no origin job, like one whose job was deleted (`jobs-closeout.md` §10a).

1. **Session entry.** `drafting_forms__open_session` with the matter root gives `db_path` and `draft_dir`. A refusal, or no drafting database for the matter, means there is no board: capture nothing and report that.
2. **Resolve the board from the origin.**
   - A Writing id: the Writing and its proceeding, `SELECT proceeding_id, retired_on FROM filings WHERE id = ?`. A retired Writing has no Job Board page, so its threads go on the proceeding with `filing_id` NULL, which shows them on every live Writing's board in it. No row: there is no board.
   - A plain draft file attached to a board (a reply's file, or a file in a client letter's folder; `filing-checklists.md` §14): that board, `SELECT proceeding_id, filing_id FROM board_attachments WHERE lower(path) IN (lower(?), lower(?))`, the file's stored path and its folder's.
   - Any other plain draft file: the proceeding it serves. `SELECT id, forum, file_number, style_of_cause FROM proceedings ORDER BY id`. One row is the board, with `filing_id` NULL. Several: ask the practitioner once which proceeding the draft serves, naming each by its forum and file number, and capture every thread of the return on the one they name. None: there is no board.
3. **Write every thread in one script**, one `INSERT` per thread:

```sql
INSERT INTO seeds (proceeding_id, filing_id, origin_ticket_id, created, surfaced_by, idea)
  VALUES (1, NULL, NULL, strftime('%Y-%m-%dT%H:%M', 'now', 'localtime'), 'research answer 2026-01-01 ML re example question.md', 'Would you like me to research whether the example rule applies to the example situation? live_issue: no');
```

4. **Confirm-read**, expected one row per thread written: `SELECT id, idea FROM seeds WHERE proceeding_id = ? AND origin_ticket_id IS NULL AND surfaced_by = ? AND charted_into IS NULL ORDER BY id`.
5. **Re-render** with `draft_dir` (the Writing, or the proceeding's live Writing or the proceeding itself), so its Job Board page lists the threads. `pages_refused` means the page is stale: say so.

Never create a proceeding or a job here, and never assign anything: a loose thread is consumed only by a later outlining session (§3).

**Dropping a loose thread** — only in an outlining session, and only when the practitioner, asked what to do with the quoted loose thread, says to drop it. No table references a loose thread, so the delete stands alone:

```sql
DELETE FROM seeds WHERE id = 1;
```

**Dropping a group of loose threads** (`/draft`'s loose-thread triage): on the practitioner's yes to dropping the threads a reported group holds, one delete naming every id positively, never `NOT IN`. Same rule: only in an outlining session, and only on the practitioner's word for those threads. Then the confirm-read, expected `0`:

```sql
DELETE FROM seeds WHERE id IN (3, 7, 12);
SELECT COUNT(*) FROM seeds WHERE id IN (3, 7, 12);
```

**Ranking the loose threads** (`/draft`'s loose-thread triage, v66): only in an outlining session. Every open thread of the proceeding is ranked, meaning the set the board's loose_threads lane shows, `charted_into IS NULL` or outlined into a deleted job (`charted_into IN (SELECT id FROM tickets WHERE deleted_at IS NOT NULL)`), which shows again. Each gets a job description, a group and a reason, one `UPDATE` per thread, all in one script. `rank_job` (v70) is the job description: the work the thread asks for, stated in actionable form, written before the threads are ranked so that the ranking orders jobs. It restates only what the thread says, with no position, figure, statement of law, recommendation, or research question worded beyond the thread's own words, and never names time remaining or a deadline. `idea` is never overwritten. `rank` is 1 for the best to follow up, then 2, 3 and on. `rank_group` is one of seven slugs, mirroring the triage groups: `decision` (the practitioner's own remark or decision already made), `tooling` (a tool failure, missing feature, skill or page defect), `housekeeping` (case-data or law-folder housekeeping: ingesting a document, an authority row, filing a text), `research` (a research offer or an open question about the law), `authority` (the Writing departs from an authority as cited), `evidence` (the Writing departs from the evidence or pleadings), `other` (fits none of these). `rank_reason` is one line saying why the thread sits where it does. It states no law, and never names time remaining or a deadline. Ranking orders, it never removes: it deletes no row and never sets `charted_into`, and a weak thread leaves only by the drop write above, on the practitioner's word. A thread captured after the ranking stays unranked (all four NULL) until the next ranking. The four are set together or all left NULL. A CHECK ties `rank`, `rank_group` and `rank_reason`, and another refuses `rank_job` without a rank, but a thread ranked before v70 may still lack `rank_job`, so the confirm-read counts that gap too. A deferred thread (below) is left as it is, unless the practitioner asks for it to be ranked. Then the confirm-read, expected `0`:

```sql
UPDATE seeds SET rank = 1, rank_group = 'tooling', rank_job = 'Fix the exhibit download that fails on the second exhibit.', rank_reason = 'Blocks the exhibit download the evidence threads need.' WHERE id = 7;
UPDATE seeds SET rank = 2, rank_group = 'evidence', rank_job = 'Correct the exhibit letter in paragraph 12 to match the affidavit.', rank_reason = 'One exhibit letter to correct, checked against the record already on file.' WHERE id = 3;
SELECT COUNT(*) FROM seeds WHERE proceeding_id = 1 AND (rank IS NULL OR rank_job IS NULL) AND deferred_at IS NULL
  AND (charted_into IS NULL OR charted_into IN (SELECT id FROM tickets WHERE deleted_at IS NOT NULL));
```

**Correcting a job description** (v70): only when the practitioner names a ranked thread and gives the description it should carry. The session writes their words, changing nothing else on the row. The column does not record who wrote a description: it is the practitioner's wording, for the practitioner-words gate when the thread is outlined, only where they wrote or adopted it in the conversation. Then the confirm-read, expected the one row with the new text:

```sql
UPDATE seeds SET rank_job = 'Research Rule 22-3 regarding: 1. Should the bracketed notes at the head of new Form 32 be reproduced or are they only drafting instructions? 2. What page formatting governs the 10-page limit?' WHERE id = 7 AND proceeding_id = 1 AND rank IS NOT NULL;
SELECT id, rank_job FROM seeds WHERE id = 7;
```

**Deferring a loose thread** (v68): `deferred_at` is the minute the practitioner deferred the thread indefinitely, `YYYY-MM-DDTHH:MM` in local time, and NULL when it is not deferred. The practitioner usually defers from the Loose Threads page: its Defer button writes this column through the data server's localhost listener, with no session involved. A session writes it only when the practitioner tells it to defer a named thread, or to bring a deferred one back. Deferring sets a thread aside. It stays open: deferring deletes no row, never sets `charted_into`, and leaves the rank as it was. board_card's loose_threads lane still lists it, its line ending ` · deferred`, and that lane is where a session reads the state. Triage and every other step that proposes loose threads skip a deferred thread, unless the practitioner asks about it or asks for the deferred threads. The guard is the page's own: the thread's proceeding, open, and not already in the state asked for. Then the confirm-read, expected the one row with `deferred_at` set (or NULL after an undefer):

```sql
UPDATE seeds SET deferred_at = strftime('%Y-%m-%dT%H:%M', 'now', 'localtime')
  WHERE id = 7 AND proceeding_id = 1 AND deferred_at IS NULL
  AND (charted_into IS NULL OR charted_into IN (SELECT id FROM tickets WHERE deleted_at IS NOT NULL));
SELECT id, deferred_at FROM seeds WHERE id = 7;
```

To bring it back, the mirror write: `UPDATE seeds SET deferred_at = NULL WHERE id = 7 AND proceeding_id = 1 AND deferred_at IS NOT NULL AND (charted_into IS NULL OR charted_into IN (SELECT id FROM tickets WHERE deleted_at IS NOT NULL));`, then the same confirm-read.

## 9. Complete

**Before the completion, the still-firing check.** A job carrying `ticket_proposals` keys re-renders first and reads which keys on its card's `keys:` line (`drafting_forms__board_card` with `jobs`) still derive, those whose `(now: …)` names a glyph and a current item: §5's premise-check subtraction, read for the keys kept rather than the keys dropped. None still derives: complete. Any does: name them to the practitioner in one line ("its marker still fires on N of M items") and run the completion script only on their yes. Otherwise the job stays `wip` under this session's lock (§10). An unattended run reports that line and stops, the job left `wip`. A job with no `ticket_proposals` keys, outlined by hand, has nothing to check.

The completion, its confirm-read and the rewrite of the matter's pages (the Litigation Strategy page and each Job Board page, ADR 0033's 2026-10-05 amendment) run as one call, `drafting_data__complete_job`, with `db_path`, `ticket_id`, `session_token` and `draft_dir` from session entry; the SQL here is what that tool runs and is kept as the documented semantics.

The supersession of **only the `queued` conflict partners** runs first, then the completion — both statements carrying this session's own token. A `wip` partner's lock belongs to another session and must never be cleared by this one. The tool binds the job's own id to every `2` below (this is one job's own completion, not a join across two):

```sql
UPDATE tickets SET status = 'superseded', superseded_by = 2
  WHERE status = 'queued' AND deleted_at IS NULL
    AND id IN (
      SELECT b_id FROM ticket_conflicts WHERE a_id = 2
      UNION
      SELECT a_id FROM ticket_conflicts WHERE b_id = 2
    )
    AND EXISTS (SELECT 1 FROM tickets WHERE id = 2 AND locked_by = 'sess-a1');
UPDATE tickets SET status = 'completed', completed_at = strftime('%Y-%m-%dT%H:%M', 'now', 'localtime'), locked_by = NULL, locked_at = NULL
  WHERE id = 2 AND locked_by = 'sess-a1';
```

Keep the token guard on both statements and keep the supersession first: an unguarded completion, and a supersession keyed on `status = 'completed'`, have each been reproduced writing the wrong row.

The two statements run in one transaction, in order, and see each other's writes, so statement 1 reads the token statement 2 is about to clear. `superseded` in the result is statement 1's row count and `changes` is statement 2's.

If a conflict partner is `wip`, do not touch it — report it to the practitioner (the Job Board already shows it as "Either/or with ... in progress") and let its own session complete or supersede it in turn. The session then ends its job work; it is never assigned another (design §3.4).

The tool then runs the confirm-read:

```sql
SELECT status, completed_at, locked_by, rejected_at FROM tickets WHERE id = 2;
```

and returns its outcome:

- **`completed`** (`status = 'completed'` with `locked_by` NULL) means **the job is complete**. `changes` 1 means this call completed it. `changes` 0 means a successor's completion after a take-over left the same row, and this call wrote nothing. The end state is the same either way, so on either reading the session runs §14's open-jobs read next, before presenting, even with other jobs open (then no write).
- **`not_held`** — another session's token is on the row: a take-over (§4). **`shelved`** — `locked_by` NULL with `rejected_at` stamped: a §10a shelving. **`no_match`** — neither statement matched, and the returned row shows why. On any of these neither statement landed: report which one it was and stop.

Only when `changes` is 1 does the call rewrite the matter's pages, by the render a session runs with `draft_dir`, and it returns `pages_written`, `job_board_path`, `board_changed` and `board_moves`, so no separate render is needed after it. When the result says `pages_written: false` after a completion this call made, say the Job Board was not refreshed and quote `pages_refused` verbatim. The completion stands either way.

## 10. Unfinished

A `wip` job the session does not finish stays `wip`, under this session's own lock, unless the practitioner tells the session to release it (below) or shelve it (§10a). It surfaces on the Job Board as "In Progress" for take-over by a later session (§4). With every step stamped it still surfaces as "In Progress", `wip` under its lock, and is closed only by the practitioner's answer to `/draft`'s close form, which runs §4's take-over variant then §9. Nothing closes it on its own; there is no lock timeout. A session never releases or shelves its own job on its own initiative, except §3f's release on the practitioner's yes, and an unattended run never does either.

**Release (the holding session's own job)** — on the practitioner's typed "release job #N" about the job this session holds, applied at once with no confirmation (ADR 0028). A §3f spin-off ends with this same release, on the practitioner's yes to the spin-off, in the same script as its `ticket_blocks` edges. The job goes back to `queued`, unlocked and **not** shelved, so it shows in Ready again. Its `plan_approved_at`, `ticket_steps` with every `done_at`, `ticket_scope` and `ticket_proposals` are left exactly as they are, so the next session to be assigned it inherits them through the taken-over read-back, as a restored job does (§10a). The guard is this session's own token on a `wip` row:

```sql
UPDATE tickets SET status = 'queued', locked_by = NULL, locked_at = NULL
  WHERE id = 42 AND status = 'wip' AND locked_by = 'sess-a1';
```

The release and its confirm-read (§2, confirm-read after a release) run as one call, `drafting_data__release_job` with `db_path`, `ticket_id` and `session_token`; the SQL here is what that tool runs and is kept as the documented semantics. Its outcome is read off the confirm-read. `released` means the release landed (`changes` 1): re-render. Every other outcome wrote nothing: `taken_over`, another session's token on the row, means the job was taken over before the release; `shelved`, `locked_by` NULL with `rejected_at` stamped, means it was shelved in another session (§10a); `completed` means a successor finished it after a take-over (§9); `no_match` means the guards matched nothing, and the returned `status` shows why. Report which it was and stop. On a landed release, or any of these, this session holds no job and is assigned no other (§9's rule for a completed job).

**Return it to Ready (another session's job)** — the same tool with `expected_holder`, the `holder:` tag off the job's card, run only on the practitioner's choice of "Return it to Ready" on `/draft`'s take-over form (ADR 0037). The job goes back to `queued`, unlocked and not shelved, with every column and child row above kept, as the own-job release leaves it. The guard is the holder on the card, on a `wip` row that is not shelved:

```sql
UPDATE tickets SET status = 'queued', locked_by = NULL, locked_at = NULL
  WHERE id = 42 AND status = 'wip' AND substr(locked_by, -8) = 'ss-other' AND rejected_at IS NULL;
```

`'ss-other'` stands in for the `holder:` tag, as in §4's take-over variant. The outcomes read as above, but `taken_over` here means the holder changed since the card was read: nothing was written, so re-render and put the form to the practitioner again on the fresh card, never re-running to win.

Where the practitioner wants the job back in Queued to outline it afresh (§3a) or close it (§9b), the release does that directly. To retire its Writing (§9a), the release or the in-progress shelve each suffices, since the retirement supersedes every `queued` job on the Writing. A confirm-read on a job this session was assigned (§5, §9) that returns `locked_by` NULL with `status = 'queued'` and `rejected_at` NULL means the job was taken over and released, or shelved in progress and restored, in another session: the lock is gone and the job is queued for whoever takes it next. This session's job work is over: report it and stop. On §4's confirm-read the same row is §4's composition-bug reading, not this one. ([#1000](https://github.com/Mharbulous/CoClerk/issues/1000)'s direct release of a matter's Job #6 predates this write. Its `done_at` reset was a one-off practitioner-approved write; this release keeps every stamp.)
