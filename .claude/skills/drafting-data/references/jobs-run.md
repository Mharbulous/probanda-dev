Read when: `drafting_data__assign_job` returns `assigned`, and for every write on that job until it is completed or released: plan approval, a step stamp, a scope expansion, a loose thread, the completion, a release, a spin-off of blocker jobs (§3f). Also, holding no job, when `/legal-research` captures a research return's open items for a draft (§8a).
Any §N not in this file: find it in SKILL.md, "Job and scrutiny operations".

## 4. Assign

This write and its confirm-read run as one call, `drafting_data__assign_job` (`takeover: true` for the variant below); the SQL here is what that tool runs and is kept as the documented semantics.

**One job per session, and a session that created jobs takes only one of its own.** Creating jobs (§3) does not use up the session's one job. But once any job carries this session's token in `created_by` (§3), the session is assigned only a job that carries it: never a pre-existing job, and never one another session created (Brahm, 2026-10-09, replacing "never in a session that has outlined"). A session that only outlined afresh (§3a) created nothing and is assigned no job. A §3f spin-off is not outlining, writes no `created_by`, and is run by the holding session on the job it holds. `/legal-research`'s board mode (§3m) is the other exception to one job per session, beside `/work`'s several jobs: it holds up to three research jobs on one board, each under its own token, and takes the next ready one as each completes.

```sql
UPDATE tickets SET status = 'wip', locked_by = 'sess-a1', locked_at = strftime('%Y-%m-%dT%H:%M', 'now', 'localtime')
  WHERE id = 2 AND status = 'queued' AND locked_by IS NULL AND rejected_at IS NULL AND deleted_at IS NULL
    AND (bf_on IS NULL OR bf_on <= date('now', 'localtime'))
    AND (created_by = 'sess-a1' OR NOT EXISTS (SELECT 1 FROM tickets c WHERE c.created_by = 'sess-a1'));
```

The `created_by` clause is the creator guard. It rides the take-over variant below too. On a database before v72, which has no `created_by`, the tool leaves it out.

The `bf_on` clause is the bring-forward guard (schema v74, `jobs-closeout.md` §10b): a job is not assigned before its BF date, the first day the practitioner said it may be worked. The date is a start date, never a deadline. The guard has no override: the practitioner changes or clears the date, and a session never proposes that. It does not ride the take-over variant, which matches only a `wip` job, and a `wip` job is not moved by a date. On a database before v74, which has no `bf_on`, the tool leaves it out.

`'sess-a1'` stands in for your own `session_token` (§1) — write that value, never a name you invented.

`AND rejected_at IS NULL` is what stops a session being assigned a job the practitioner has since shelved: an Opening card composed from a stale board matches zero rows, and the confirm-read below stops the session there. That guard is the only barrier, because `rejected_at` sits outside the table's CHECKs by design — nothing else in the database refuses the assigning write. `AND deleted_at IS NULL` is the same barrier for a deleted job (§10a).

`AND status = 'queued'` is the same kind of barrier, for a superseded job. A job superseded **by another job** is refused loudly without it, because `superseded_by` is set and the CHECK is `superseded_by IS NULL OR status = 'superseded'` — moving that row to `wip` fails the CHECK and the whole script rolls back. But a retirement supersedes with no superseding job (§9a), so `superseded_by` stays NULL and the CHECK is satisfied by the `wip` row: without the status clause, a retirement-superseded job is silently assigned straight back to `wip`. The status clause is the only barrier there, exactly as `rejected_at IS NULL` is the only barrier for a shelved one.

Then run the confirm-read (§2). Three failures, and they are not the same failure:

- **Another session's token on the returned row** — the assigning write lost a race (single-practitioner use makes this rare, not impossible). Re-render and restate the Opening, with one line saying the job was just taken. Never proceed as if the job had been assigned, and never convert it into a take-over on your own initiative. **With nobody to present the Opening to** (the unattended run, the 2026-09-21 design §5.4): stop and report the lost race, naming the job and the token now on it. Never retry, whether on that job or the next eligible one.
- **`not_created_here`** — `locked_by` NULL, this session created jobs, and the returned row's `created_by` is not this session's token: the creator guard refused it. Nothing was written. Say in one line that this session created jobs and may be assigned only one of those, and that a new `/draft` session takes this one. Never retry.
- **`before_bf`** — `locked_by` NULL on a `queued`, unshelved job whose returned `bf_on` is later than the local date: the bring-forward guard refused it. Nothing was written. Say in one line that the job is held until its BF date, giving the date as a plain date with no day count. Never offer to change or clear the date, and never retry. **With nobody present**, stop and report it.
- **`locked_by` NULL on the returned row** otherwise — not a race for the lock. Two writes clear a `wip` lock: §10's release, which the holding session runs on its own job and another session runs only on the practitioner's "Return it to Ready" (CoClerk ADR 0037), and §10a's in-progress shelving, which clears the lock and stamps `rejected_at` in the same `UPDATE`, and runs on another session's job only on the practitioner's own answer. Short of one of those landing between the assigning write and this read, a NULL here means the `UPDATE` matched no row at all: a wrong id, or a job already `wip` or shelved when the card was composed. That is a composition bug in this session's own script. This read cannot tell the two apart, because a job shelved before the card was composed carries `rejected_at` too, and a release landing in between leaves the same row as a wrong id. Either way, stop and report it, naming the id written and what the read returned.

**Take-over variant** (design §5.2 — a `wip` job started in another session, possibly still open): the same `UPDATE` with no `locked_by IS NULL` guard and a widened status clause, run when `work/references/take-over.md` says. It lands only while the job's holder and last activity are still the ones on the card the decision was made on, and the job has been idle 30 minutes (ADR 0015):

```sql
UPDATE tickets SET status = 'wip', locked_by = 'sess-a1', locked_at = strftime('%Y-%m-%dT%H:%M', 'now', 'localtime')
  WHERE id = 2 AND status IN ('queued', 'wip') AND rejected_at IS NULL AND deleted_at IS NULL AND substr(locked_by, -8) = 'ss-other'
    AND COALESCE((SELECT trim(value, '"') FROM kv_store WHERE namespace = 'last_activity' AND key = 'tickets:' || tickets.id), locked_at) = '2026-10-01T09:40'
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

The stamp-only approval and its confirm-read run as one call, `drafting_data__approve_plan` `{db_path, ticket_id, session_token}`; never hand-write it through `execute`. It runs the stamp above with one more guard, `AND plan_approved_at IS NULL`, so an already-approved job is left alone as the next paragraph requires, then the confirm-read below. Outcomes: `approved` (`changes` 1), `already_approved` (this session's token, `plan_approved_at` already set, `changes` 0), and `not_held`, `shelved`, `completed` or `no_match`, read as the confirm-read below reads them. Never retry. It moves no revision. Refusals write nothing: `invalid_ticket_id`, `invalid_session_token`, `not_found`, `no_steps`, a job with no `ticket_steps` rows and so no plan to approve, and `plan_marker_only`, a job whose only step is the plan marker (`jobs-create.md` §3, "The plan marker") and so has no plan yet.

**A re-approval confirmed unaltered writes nothing.** If the job is already approved and the practitioner confirms the read-back step list unaltered, `plan_approved_at` and `ticket_steps` are left alone, as §3a leaves them, and every `done_at` on those steps survives. `plan_approved_at` is not re-stamped: it still records when those same steps were approved. On a taken-over job this is what keeps the predecessor session's `done_at` stamps, which the take-over exists to inherit.

**Otherwise the steps travel with the approval.** The `ticket_steps` rows must be the approved plan, so a first approval whose steps differ from the rows on the job, and every re-approval that alters the steps through the outlining interview, writes the approved steps by the partial replace below: each step not yet done is replaced, and a done step keeps its row and its `done_at`, because its work was done. A re-approval is re-stamped in that same write; a first approval is then stamped by `drafting_data__approve_plan`. Each step's text is the session's wording of the plan, with no adoption ceremony (`shared/paralegal-posture.md` section 3).

**The partial replace.** A plan upgrade (`shared/job-planning.md` section 3) rewrites only the steps not yet done, so a step already done keeps its row, its ordinal, its words and its `done_at`. It is `drafting_data__rewrite_job` with `held: true`, `session_token` and the new `steps`: it deletes only the steps not done, appends each new step after the highest ordinal left, in order, and re-stamps an approval already on the job. With `append: true` it deletes nothing. It is also the write that adds a step for each `required` item memo-reviewer names on a held research job (`shared/legal-research.md`, "On a held job, an open tier is not an answer"), so every step already on the job keeps its row and its stamp. `not_held` reads as the confirm-read below reads a lost lock.

**The pickup rewrite.** `/draft`'s pickup review (`work/references/job-session.md`, The pickup review) shortens a ready job's title and splits its steps, and its restating check ("A step that only restates the request") replaces a ready job's steps with a plan that names the work, before the job is assigned. It is `drafting_data__rewrite_job` with `title` (only when it changed) and `steps`, the list replaced whole. The tool writes only a queued job with no lock, not shelved, no approval stamp and no step done, and either all of it lands or none does; any other outcome assigns nothing and re-renders. Each title and step is cut from the job card's own words as a `drafting_forms__*` result printed them this session; no stamp is written, because `drafting_data__approve_plan` stamps after the plan is announced.

**The held-job title cleanup.** `/draft`'s title spelling cleanup (`work/references/job-session.md`, "Title spelling cleanup on a held job") corrects the title of a job this session has just taken over, restored or re-taken after a release. It is `drafting_data__rewrite_job` with `held: true`, `session_token` and `title` only, which touches no step and no stamp. The title is the card's title with only a misspelled word corrected.

If the practitioner asks for a change, it is taken in their words through the outlining interview's questions (still the same session, still the same assigned job); the revised step list is written once, by the partial replace, on re-approval, as above. A part added to the held form job (`/work`'s `job-session.md`, "A form is one job") is appended by the partial replace with `append: true`, so done steps keep their stamps, only once the practitioner re-approves the read-back list.

**The premise check's Change path also drops the dead keys.** Where the Change was taken because a key's marker no longer fires — the assign-time premise check amendment to `Engineering/1. Design/2026-09-15_work-board-proposals-design.md` — an `execute` script run right after the partial replace deletes those keys from `ticket_proposals`. The practitioner has just dropped that work, and a marker firing again on one of those rows must not stay hidden behind this job. The dead set is every key on the `keys:` line of the job's card (`drafting_forms__board_card` with `jobs`) that reads `(now: dead)`; name it positively, as literals copied character for character out of that line on §3's terms, never recomposed from a slug and a row id:

```sql
DELETE FROM ticket_proposals WHERE ticket_id = 2
  AND proposal_key IN ('note-up:authorities:5', 'authority-excerpt:statements_of_law:12')
  AND EXISTS (SELECT 1 FROM tickets WHERE id = 2 AND locked_by = 'sess-a1');
```

Never a `NOT IN` of the keys kept: a `DELETE` should name what it removes, and `NOT IN` removes every key the session failed to name. Only on that path: a first approval, or a re-approval the practitioner asked for on their own account, has no dead set and writes no such statement. Where every key is dead the job ends holding no conversion record at all. Accepted cost: it hides nothing, which is the point, but the next time it is assigned the check reports it as outlined by hand, which is wrong about where it came from.

This and §3a's "keep it" path are the only writes in the job checklist that remove `ticket_proposals` rows.

**The Change path also refreshes `item` on the keys the job keeps**, on §3a's terms: only a key whose item now reads differently, only after the practitioner has been shown both texts and confirmed, and in that same script, under this section's guard:

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

Tick each step of the approved plan as it completes, with `drafting_data__set_step` `status: "done"` (§6b), so that a successor session (after an interrupted `wip` job is taken over) reads off the Milestone what's already done. Read the step's `ordinal` and `text` off the card first. `set` means the stamp landed. `not_held` means the holder changed: stop, and run §2's scope read, whose row says why. `done` means the step was already stamped, and a stamp stays as it is.

**Stamp only work that ran.** A step blocked by a missing credential or an unreachable source is set to ↻ with `drafting_data__set_step` (§6b), never stamped ☑. A stamp is frozen once written, so a step stamped without its work would report that work done for good.

## 6b. Step status

A step not yet done can carry one status besides open (schema v78), set by `drafting_data__set_step` with `db_path`, `ticket_id`, `ordinal`, `session_token` and `status`, the call that ticks it done (§6). A done step is frozen and takes none. The glyphs are ☐ open, ☑ done, ↻ retry, ☒ cancelled, ⏸ deferred and ⏳ waiting:

- **`retry` ↻**: the step is blocked by a missing credential or an unreachable source. It is tried again once the block clears, and is then stamped ☑ when its work runs.
- **`cancelled` ☒** and **`deferred` ⏸**: the practitioner chose to drop the step or put it off. Set only on the practitioner's own words, passed verbatim as `practitioner_words`, which the card prints after the step. A session never sets either on its own judgment.
- **`waiting` ⏳**: the step waits on an external process, such as a Westlaw run. `wait_minutes` (default 5) sets `wait_until` to now plus that many minutes, and the result says `setting timer for N minutes`. `wait_until` is a wake-up time to check whether the process has finished. It is never a deadline or time remaining, is never shown as a countdown, and never goes into a handover or a loose thread. When the minute has passed, the step reads ☐ again and the session checks the process.
- **`open`** clears the status.

A step is resolved when it is done, cancelled or deferred. Gate steps never take a status: a gate waiver stays in the step's text (`references/jobs-gate.md`).

## 6a. Last activity and the session-active stamp

A job's last activity is one stored stamp, which its card prints and its idle tag measures from, and its session-active stamp (`db_meta` `job_active:<id>`) sits beside it. Every job tool given the job's `session_token` moves both in its own write, and a research_filing write given the job's `db_path`, `ticket_id` and `session_token` does too: each `research-paralegal`, `legislation-fetcher` and `citation-checker` dispatch for the job carries those three and the job's `claim_no` (`jobs-common.md` §1), so its last activity moves while the agent is out. A ⏳ step (§6b) counts as activity until its minute passes. A turn that worked the held job (reading, drafting or conversation about it) through no such tool ends with `drafting_data__touch_job` with those three and the `claim_no`. Only the holder's call writes. The board shows the session-active stamp as `session active` on an In progress job only, and only when it is no earlier than the lock, so an earlier holder's stamp never shows and is never deleted. `recorded: false` means the holder changed, so run §2's scope read and stop.

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

`origin_ticket_id` is the job this session holds. Its card (`drafting_forms__board_card` with `jobs`) then lists the loose thread, and §6a moves the job's last activity.

`idea` is captured **verbatim**, at most five sentences, with no options or recommendations — the appearance of alternatives is the tell that outlining has started, and it belongs in an outlining session, not this write. `surfaced_by` is one line naming what surfaced it (a Westlaw memo, a practitioner aside, a document read in passing) — never `TRIGGER`; that column was deliberately not named after the SQLite keyword.

**The open set.** A proceeding's open loose threads are those not outlined into a job, not discarded and not suggested (`shared/html-pages.md`, the Loose Threads page). A session that must compare an item with them, such as `shared/legal-research.md`'s duplicate test, reads them by one `drafting_data__query`:

```sql
SELECT id, filing_id, origin_ticket_id, idea FROM seeds
  WHERE proceeding_id = ? AND charted_into IS NULL AND discarded_at IS NULL AND suggested_at IS NULL
  ORDER BY id;
```

### 8a. With no job held

`shared/legal-research.md`'s after-the-answer step ("With a board, the return's open items are sorted against it") captures a research return's open items for the draft the question came from, in a session holding no job. Same write, same `idea` and `surfaced_by` rules, with `origin_ticket_id` NULL: no job surfaced it, so there is no lock to guard and no job's idle clock to restart. The thread renders under "Loose Threads" with no origin job, like one whose job was deleted (`jobs-closeout.md` §10a).

1. **Session entry.** `drafting_forms__open_session` with the matter root gives `db_path` and `draft_dir`. A refusal, or no drafting database for the matter, means there is no board: capture nothing and report that.
2. **Resolve the board from the origin.**
   - A Writing id: the Writing and its proceeding, `SELECT proceeding_id, retired_on FROM filings WHERE id = ?`. A retired Writing has no Milestone page, so its threads go on the proceeding with `filing_id` NULL, which shows them on every live Writing's board in it. No row: there is no board.
   - A plain draft file attached to a board (a client letter's or a reply's file; `filing-checklists.md` §14): that board, `SELECT proceeding_id, filing_id FROM board_attachments WHERE lower(path) = lower(?)`, the file's stored path.
   - Any other plain draft file: the proceeding it serves. `SELECT id, forum, file_number, style_of_cause FROM proceedings ORDER BY id`. One row is the board, with `filing_id` NULL. Several: ask the practitioner once which proceeding the draft serves, naming each by its forum and file number, and capture every thread of the return on the one they name. None: there is no board.
3. **Write every thread in one script**, one `INSERT` per thread:

```sql
INSERT INTO seeds (proceeding_id, filing_id, origin_ticket_id, created, surfaced_by, idea)
  VALUES (1, NULL, NULL, strftime('%Y-%m-%dT%H:%M', 'now', 'localtime'), 'research answer 2026-01-01 ML re example question.md', 'Would you like me to research whether the example rule applies to the example situation? live_issue: no');
```

4. **Confirm-read**, expected one row per thread written: `SELECT id, idea FROM seeds WHERE proceeding_id = ? AND origin_ticket_id IS NULL AND surfaced_by = ? AND charted_into IS NULL ORDER BY id`.
5. **Re-render** with `draft_dir` (the Writing, or the proceeding's live Writing or the proceeding itself), so the Loose Threads page lists them. `pages_refused` means the page is stale: say so.

Never create a proceeding here, never create a job other than §3i's research offer job, and never assign anything: a loose thread is consumed only by a later outlining session (§3) or by §3i's add path.

**Dropping a loose thread** — only in an outlining session, and only when the practitioner, asked what to do with the quoted loose thread, says to drop it. Or, in any session, a thread the research-offer sort (`shared/legal-research.md`, "After the answer") captured in that session, when the practitioner names that offer to drop. Dropping discards the thread (v75): it stamps `discarded_at`, the minute dropped, `YYYY-MM-DDTHH:MM` in local time, and deletes no row. A discarded thread is kept, is no longer open, and shows on the Loose Threads page as a red struck line with a Restore link. One thread or a group, the write is the same stamp, naming every id positively, never `NOT IN`. Then the confirm-read, expected `0`:

```sql
UPDATE seeds SET discarded_at = strftime('%Y-%m-%dT%H:%M', 'now', 'localtime') WHERE id IN (3, 7, 12) AND discarded_at IS NULL;
SELECT COUNT(*) FROM seeds WHERE id IN (3, 7, 12) AND discarded_at IS NULL;
```

On a database held below v75 the write fails with `no such column`. Say that the matter's records need an update first, and stop: never delete the row instead.

**Dropping a group of loose threads** (`/draft`'s loose-thread triage): on the practitioner's yes to dropping the threads a reported group holds, the stamp above. Same rule: only in an outlining session, and only on the practitioner's word for those threads.

**Restoring a discarded thread** (v75): only on the practitioner's word, usually pasted from the page's Restore link ("restore loose thread #7"), which copies the instruction and writes nothing. The thread is open again, with the rank it had. Then the confirm-read, expected the one row with `discarded_at` NULL:

```sql
UPDATE seeds SET discarded_at = NULL WHERE id = 7 AND discarded_at IS NOT NULL;
SELECT id, discarded_at FROM seeds WHERE id = 7;
```

**Marking a thread suggested** (v75): `suggested_at` is the minute the thread was sent to Probanda as a suggestion about the plugin, and NULL when it was not. No route writes it any more: a `tooling` thread is no longer sent as a suggestion, only reported to Probanda as an observation, which stamps nothing (`work/references/suggestion-box.md`). A thread an earlier version marked keeps its stamp. A suggested thread is kept, is no longer open, and shows on the Loose Threads page as a plain line. Then the confirm-read, expected the one row with `suggested_at` set:

```sql
UPDATE seeds SET suggested_at = strftime('%Y-%m-%dT%H:%M', 'now', 'localtime') WHERE id = 7 AND suggested_at IS NULL AND discarded_at IS NULL;
SELECT id, suggested_at FROM seeds WHERE id = 7;
```

**Ranking the loose threads** (`/draft`'s loose-thread triage, v66): only in an outlining session. `seeds` is not a substance table, so the scope read (`jobs-common.md` §2) does not cover this write. Every open thread of the matter is ranked, meaning the set the Loose Threads page shows, `charted_into IS NULL` or outlined into a deleted job (`charted_into IN (SELECT id FROM tickets WHERE deleted_at IS NOT NULL)`), which shows again, and in either case neither discarded nor suggested (`discarded_at IS NULL AND suggested_at IS NULL`, v75). A database held below v75 has neither column and a statement naming one fails there with `no such column`: on such a database, leave those two clauses out of the reads and guards below. Each gets a job description, a group and a reason, one `UPDATE` per thread, all in one script. `rank_job` (v70) is the job description: the work the thread asks for, stated in actionable form, written before the threads are ranked so that the ranking orders jobs. It restates only what the thread says, with no position, figure, statement of law, recommendation, or research question worded beyond the thread's own words, and never names time remaining or a deadline. `idea` is never overwritten. `rank` is 1 for the best to follow up, then 2, 3 and on. `rank_group` is one of seven slugs, mirroring the triage groups: `decision` (the practitioner's own remark or decision already made), `tooling` (a tool failure, missing feature, skill or page defect), `housekeeping` (matter-data or law-folder housekeeping: ingesting a document, an authority row, filing a text), `research` (a research offer or an open question about the law), `authority` (the Writing departs from an authority as cited), `evidence` (the Writing departs from the evidence or pleadings), `other` (fits none of these). `rank_reason` is one line saying why the thread sits where it does. It states no law, and never names time remaining or a deadline. Ranking orders, it never removes: it deletes no row and never sets `charted_into`, and a weak thread leaves only by the drop write above, on the practitioner's word. A thread captured after the ranking stays unranked (all four NULL) until the next ranking. The four are set together or all left NULL. A CHECK ties `rank`, `rank_group` and `rank_reason`, and another refuses `rank_job` without a rank, but a thread ranked before v70 may still lack `rank_job`, so the confirm-read counts that gap too. A deferred thread (below) is left as it is, unless the practitioner asks for it to be ranked. Then the confirm-read, expected `0`:

```sql
UPDATE seeds SET rank = 1, rank_group = 'tooling', rank_job = 'Fix the exhibit download that fails on the second exhibit.', rank_reason = 'Blocks the exhibit download the evidence threads need.' WHERE id = 7;
UPDATE seeds SET rank = 2, rank_group = 'evidence', rank_job = 'Correct the exhibit letter in paragraph 12 to match the affidavit.', rank_reason = 'One exhibit letter to correct, checked against the record already on file.' WHERE id = 3;
SELECT COUNT(*) FROM seeds WHERE (rank IS NULL OR rank_job IS NULL) AND deferred_at IS NULL
  AND (charted_into IS NULL OR charted_into IN (SELECT id FROM tickets WHERE deleted_at IS NOT NULL))
  AND discarded_at IS NULL AND suggested_at IS NULL;
```

**Correcting a job description** (v70): only when the practitioner names a ranked thread and gives the description it should carry. The session writes their words, changing nothing else on the row. The column does not record who wrote a description. Then the confirm-read, expected the one row with the new text:

```sql
UPDATE seeds SET rank_job = 'Research Rule 22-3 regarding: 1. Should the bracketed notes at the head of new Form 32 be reproduced or are they only drafting instructions? 2. What page formatting governs the 10-page limit?' WHERE id = 7 AND proceeding_id = 1 AND rank IS NOT NULL;
SELECT id, rank_job FROM seeds WHERE id = 7;
```

**Deferring a loose thread** (v68): `deferred_at` is the minute the practitioner deferred the thread indefinitely, `YYYY-MM-DDTHH:MM` in local time, and NULL when it is not deferred. The practitioner usually defers from the Loose Threads page: its status button writes this column through the data server's localhost listener, with no session involved. A session writes it only when the practitioner tells it to defer a named thread, or to bring a deferred one back. Deferring sets a thread aside. It stays open: deferring deletes no row, never sets `charted_into`, and leaves the rank as it was. The triage read still returns it, with `deferred_at` set, and that is where a session reads the state. Triage and every other step that proposes loose threads skip a deferred thread, unless the practitioner asks about it or asks for the deferred threads. The guard is the page's own: the thread's proceeding, open, and not already in the state asked for. Then the confirm-read, expected the one row with `deferred_at` set (or NULL after an undefer):

```sql
UPDATE seeds SET deferred_at = strftime('%Y-%m-%dT%H:%M', 'now', 'localtime')
  WHERE id = 7 AND proceeding_id = 1 AND deferred_at IS NULL
  AND (charted_into IS NULL OR charted_into IN (SELECT id FROM tickets WHERE deleted_at IS NOT NULL))
  AND discarded_at IS NULL AND suggested_at IS NULL;
SELECT id, deferred_at FROM seeds WHERE id = 7;
```

To bring it back, the mirror write: `UPDATE seeds SET deferred_at = NULL WHERE id = 7 AND proceeding_id = 1 AND deferred_at IS NOT NULL AND (charted_into IS NULL OR charted_into IN (SELECT id FROM tickets WHERE deleted_at IS NOT NULL)) AND discarded_at IS NULL AND suggested_at IS NULL;`, then the same confirm-read.

## 9. Complete

**Before the completion, the still-firing check.** A job carrying `ticket_proposals` keys re-renders first and reads which keys on its card's `keys:` line (`drafting_forms__board_card` with `jobs`) still derive, those whose `(now: …)` names a glyph and a current item: §5's premise-check subtraction, read for the keys kept rather than the keys dropped. None still derives: complete. Any does: name them to the practitioner in one line ("its marker still fires on N of M items") and run the completion script only on their yes. Otherwise the job stays `wip` under this session's lock (§10). An unattended run reports that line and stops, the job left `wip`. A job with no `ticket_proposals` keys, outlined by hand, has nothing to check.

**Then the open sources.** A job whose card prints an open source on its `sources to get:` line is completed only as `references/jobs-common.md` §2 ("Before completing a job with open sources") says: named in one line, on the practitioner's yes, each then closed `not_retrieved`.

The completion, its confirm-read and the rewrite of the matter's pages (the Litigation Strategy page and each Milestone page, ADR 0033's 2026-10-05 amendment) run as one call, `drafting_data__complete_job`, with `db_path`, `ticket_id`, `session_token` and `draft_dir` from session entry; the SQL here is what that tool runs and is kept as the documented semantics.

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

If a conflict partner is `wip`, do not touch it — report it to the practitioner (the Milestone already shows it as "Either/or with ... in progress") and let its own session complete or supersede it in turn. The session then ends its job work; it is never assigned another (design §3.4).

The tool then runs the confirm-read:

```sql
SELECT status, completed_at, locked_by, rejected_at FROM tickets WHERE id = 2;
```

and returns its outcome:

- **`completed`** (`status = 'completed'` with `locked_by` NULL) means **the job is complete**. `changes` 1 means this call completed it. `changes` 0 means a successor's completion after a take-over left the same row, and this call wrote nothing. The end state is the same either way, so on either reading the session runs §14's open-jobs read next, before presenting, even with other jobs open (then no write).
- **`not_held`** — another session's token is on the row: a take-over (§4). **`shelved`** — `locked_by` NULL with `rejected_at` stamped: a §10a shelving. **`no_match`** — neither statement matched, and the returned row shows why. On any of these neither statement landed: report which one it was and stop.
- **`steps_open`** — before either statement, the tool read a step not resolved (§6b): ☐, ↻ or ⏳, a ⏳ whose minute has passed included, and wrote nothing. `open_steps` names each one. Finish each, or, on the practitioner's own words, set it ☒ or ⏸ with `drafting_data__set_step`, then complete. On a database held below v78 every unstamped step is open.

Only when `changes` is 1 does the call rewrite the matter's pages, by the render a session runs with `draft_dir`, and it returns `pages_written`, `milestone_path`, `board_changed` and `board_moves`, so no separate render is needed after it. When the result says `pages_written: false` after a completion this call made, say the Milestone was not refreshed and quote `pages_refused` verbatim. The completion stands either way.

## 10. Unfinished

A `wip` job the session does not finish stays `wip`, under this session's own lock, unless the practitioner tells the session to release it (below) or shelve it (§10a). It surfaces on the Milestone as "In Progress" for take-over by a later session (§4). With every step stamped it still surfaces as "In Progress", `wip` under its lock, and is closed only by the practitioner's answer to `/draft`'s close form, which runs §4's take-over variant then §9. Nothing closes it on its own, though its lock lapses after 60 minutes idle (ADR 0015). A session never releases or shelves its own job on its own initiative, except §3f's release on the practitioner's yes, and an unattended run never does either.

**Release (the holding session's own job)** — on the practitioner's typed "release job #N" about the job this session holds, applied at once with no confirmation (ADR 0028). A §3f spin-off ends with this same release, on the practitioner's yes to the spin-off, in the same script as its `ticket_blocks` edges. The job goes back to `queued`, unlocked and **not** shelved, so it shows in Ready again. Its `plan_approved_at`, `ticket_steps` with every `done_at`, `ticket_scope` and `ticket_proposals` are left exactly as they are, so the next session to be assigned it inherits them through the taken-over read-back, as a restored job does (§10a). The guard is this session's own token on a `wip` row:

```sql
UPDATE tickets SET status = 'queued', locked_by = NULL, locked_at = NULL
  WHERE id = 42 AND status = 'wip' AND locked_by = 'sess-a1';
```

The release and its confirm-read (§2, confirm-read after a release) run as one call, `drafting_data__release_job` with `db_path`, `ticket_id` and `session_token`; the SQL here is what that tool runs and is kept as the documented semantics. Its outcome is read off the confirm-read. `released` means the release landed (`changes` 1): re-render. Every other outcome wrote nothing: `taken_over`, another session's token on the row, means the job was taken over before the release; `shelved`, `locked_by` NULL with `rejected_at` stamped, means it was shelved in another session (§10a); `completed` means a successor finished it after a take-over (§9); `no_match` means the guards matched nothing, and the returned `status` shows why. Report which it was and stop. On a landed release, or any of these, this session holds no job and is assigned no other (§9's rule for a completed job).

**Return it to Ready (another session's job)** — the same tool with `expected_holder`, the `holder:` tag off the job's card, run only on the practitioner's choice of "Return it to Ready" on `/draft`'s take-over form (CoClerk ADR 0037). The job goes back to `queued`, unlocked and not shelved, with every column and child row above kept, as the own-job release leaves it. The guard is the holder on the card, on a `wip` row that is not shelved:

```sql
UPDATE tickets SET status = 'queued', locked_by = NULL, locked_at = NULL
  WHERE id = 42 AND status = 'wip' AND substr(locked_by, -8) = 'ss-other' AND rejected_at IS NULL;
```

`'ss-other'` stands in for the `holder:` tag, as in §4's take-over variant. The outcomes read as above, but `taken_over` here means the holder changed since the card was read: nothing was written, so re-render and put the form to the practitioner again on the fresh card, never re-running to win.

Where the practitioner wants the job back in Queued to outline it afresh (§3a) or close it (§9b), the release does that directly. To retire its Writing (§9a), the release or the in-progress shelve each suffices, since the retirement supersedes every `queued` job on the Writing. A confirm-read on a job this session was assigned (§5, §9) that returns `locked_by` NULL with `status = 'queued'` and `rejected_at` NULL means the job was taken over and released, or shelved in progress and restored, in another session: the lock is gone and the job is queued for whoever takes it next. This session's job work is over: report it and stop. On §4's confirm-read the same row is §4's composition-bug reading, not this one. ([#1000](https://github.com/Mharbulous/CoClerk/issues/1000)'s direct release of a matter's Job #6 predates this write. Its `done_at` reset was a one-off practitioner-approved write; this release keeps every stamp.)
