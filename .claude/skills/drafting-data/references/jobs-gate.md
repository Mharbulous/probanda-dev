Read when: §9's confirm-read reads `completed`, `/draft` step 9 runs the pre-filing gate, the practitioner asks to re-run a stale gate, or `drafting_data__record_sent` refuses `held` or writes a `Pre-send gate` job.
Any §N not in this file: find it in SKILL.md, "Job and scrutiny operations".

## 14. The gate job (pre-filing consistency gate)

The checks themselves are `references/pre-filing-checks.md`; the tool is `drafting_forms__pre_filing_check`. This section is only the job that records the gate's outcome (ADR 0016: the gate is a job, not a lifecycle state). Every write here is exempt from the revision bump like every other job write.

**Trigger — the session that completes a Writing's last open job creates the gate job.** Immediately after §9's confirm-read, in the same session, read what is still open on the Writing. The anchor is the confirm-read and not the completion `UPDATE` itself: a completion that matched nothing must not be followed by gate creation, and the confirm-read is what establishes that it landed. A Writing the Sent write holds (§14a: one that needs no forum parts, and a venue's `letter`) takes no gate job: its gate is §14a's `Pre-send gate`, so this trigger does not apply to it. A `Pre-filing consistency gate` job already sitting on a venue's letter from before that rule is left as it stands: the Milestone's gate row no longer reads it, and the practitioner may supersede it.

```sql
WITH RECURSIVE after_gate(id) AS (
  SELECT b.blocked_id FROM ticket_blocks b JOIN tickets f ON f.id = b.blocker_id JOIN tickets t ON t.id = b.blocked_id
    WHERE f.filing_id = 7 AND f.status <> 'completed' AND f.deleted_at IS NULL AND t.status <> 'completed' AND t.deleted_at IS NULL
      AND (substr(f.title, 1, 14) = 'File and serve' OR substr(f.title, 1, 21) = 'Serve the application' OR substr(f.title, 1, 18) = 'Serve the response')
  UNION
  SELECT b.blocked_id FROM ticket_blocks b JOIN after_gate a ON a.id = b.blocker_id JOIN tickets t ON t.id = b.blocked_id
    WHERE t.status <> 'completed' AND t.deleted_at IS NULL
)
SELECT id, title, status FROM tickets WHERE filing_id = 7 AND status IN ('queued', 'wip') AND rejected_at IS NULL AND deleted_at IS NULL
  AND title NOT IN ('Availability letter', 'Application book', 'Set down for hearing', 'Reply affidavits', 'File the served response', 'Reset for hearing', 'Draft the Writing', 'Draft the letter', 'Deliver', 'Pre-send gate')
  AND substr(title, 1, 14) <> 'File and serve' AND substr(title, 1, 21) <> 'Serve the application' AND substr(title, 1, 18) <> 'Serve the response'
  AND id NOT IN (SELECT id FROM after_gate);
```

`AND rejected_at IS NULL` is load-bearing: a shelved job stays `queued` with `rejected_at` stamped (§10a), so without it a Writing whose only remaining job the practitioner shelved counts as still open and never gets its gate job. The `title` clauses leave out §3b's stock bundle jobs, which are not drafting work, a hand-outlined `File and serve …`, `Serve the application …` or `Serve the response …` job included: an availability letter still queued or in progress must not hold the gate job back, and neither do the two letter jobs, `Draft the letter` and `Deliver`, nor an Unstructured Writing's `Draft the Writing`, which are stock jobs too, nor §14a's `Pre-send gate`, which only the Sent write writes. §3c's `Prepare the review pages` and `Counsel's review of …` jobs are drafting work and count here like any other job, so the gate job cannot be created while the review is open.

`after_gate` leaves out the work that comes after filing or service: every job that waits on one of the Writing's `File and serve …`, `Serve the application …` or `Serve the response …` jobs that is not completed, directly or through a chain of jobs that are not completed (`ticket_blocks`: `blocked_id` waits on `blocker_id`). Such a job runs only after that filing or service job, which Dispatch skips until the gate passes, so counting it would hold the gate open forever. A completed job breaks the chain: a job whose only link to filing or service runs through a completed job counts like any other. A deleted job (§10a) is neither a link nor a result. `UNION`, not `UNION ALL`, so a circular chain ends. The Milestone's `gate` criterion leaves out the same jobs from its open count.

If that returns no rows, and no job titled `Pre-filing consistency gate` already exists on the Writing with a status other than `superseded`, deleted jobs (§10a) aside, create one by one `drafting_data__create_job` call (`jobs-create.md` §3, `guard: "none"`, no `created_by`): `kind: "work"`, `proceeding_id` and `filing_id` the Writing's, `billing_anchor` copied from the job just completed, `priority: "top"`, `title` `Pre-filing consistency gate`, this fixed `intent`, `Run the pre-filing checks on the assembled package and clear or waive every failure before the Writing is presented as ready to file or serve.`, `scope` one row `{entity: "filing_documents", entity_id: null}`, and one step per check id, in `pre-filing-checks.md` order, each ending `not yet run`: `C1 — Exhibit numbering cross-check: not yet run`, `C2 — Unresolved-placeholder scan: not yet run`, `C3 — Cross-document figure consistency: not yet run`, `C4 — Party name and style-of-cause consistency: not yet run`, `C5 — Execution completeness: not yet run`, `C6 — Exhibit file sanity: not yet run`.

**The creation takes no holder guard, and that is a decision.** The job being created has no holder, so there is no session token to prove; what must hold before this call runs is that the completion landed, and §9's confirm-read has already established it. The existing check that no job titled `Pre-filing consistency gate` already exists stays a read rather than a guard for its own reason: a duplicate gate job is visible on the board and reversible, which is not the kind of harm a guard is for.

If the completing session cannot write it (the practitioner ends the session first, the call fails), the next `/draft` session on that Writing creates it at step 9 under the same rule before running the gate. **The unattended run** (the 2026-09-21 design §5.4) never creates the gate job, even when its completion leaves nothing open: it relies on this fallback and says so in its report. A Writing outlined for more work later simply gains new jobs; the gate job stays where it is and is run again after they complete.

**Link the gate job it replaced, at creation and again before every assignment.** A gate job superseded as stale (below) is left with `superseded_by` NULL, because its replacement did not exist yet. Point it at this one, right after the create, and again before §4's assignment or its take-over variant:

```sql
UPDATE tickets SET superseded_by = 12
  WHERE filing_id = 7 AND title = 'Pre-filing consistency gate' AND status = 'superseded' AND superseded_by IS NULL AND deleted_at IS NULL;
```

The Milestone then shows the old job as "Superseded by: Job #12", the same pointer §9 writes for a conflict partner. It takes no confirm-read, because matching no row is the usual result and a second run changes nothing. The run before assignment covers a session interrupted between creating the gate job and linking it. After a retirement it can match more than one row, a gate job superseded by the retirement of a Writing since recovered as well as a stale one, and every one is pointed at this job.

**Running it** is ordinary Branch A: assign (§4), plan approval (§5) as the announcement of the fixed step list, then one tool call. Each step not yet done is rewritten from the result by `drafting_data__set_step` with `text`: `status: "done"` on `pass` and `n/a`, `status: "open"` on a `fail`, which keeps its finding count. Each text ends with the ` [rev N]` token, where `N` is the `revision` integer `drafting_forms__pre_filing_check` returned for that run: `C1 — Exhibit numbering cross-check: pass [rev 412]`, `C2 — Unresolved-placeholder scan: fail (4 findings) [rev 412]`, `C5 — Execution completeness: n/a [rev 412]`. A done step, waived or passed, is frozen, so `set_step` never rewrites it and a re-run rewrites only the steps still open.

**The ` [rev N]` token** records which database revision the check ran against, so the render can tell a current gate from a stale one (the 2026-09-21 design §2.5): it reads the latest token any step carries. It is one space, then `[rev `, the integer, and `]`, written after the result and before any waiver suffix. `not yet run` carries no token. A reader takes the text before the first ` — WAIVED: ` and matches `\[rev (\d+)\]` at its end, so a waiver reason that happens to contain the pattern is never read.

**Waiver — per failed check, one line, verbatim (decision D5, the §8 loose-thread idiom).** A gate step never takes a step status (`references/jobs-run.md` §6b), so the waiver lives in the step's text: `drafting_data__set_step` with `status: "done"` and `text` the step's current text, then ` — WAIVED: `, then the reason, so the step reads as closed. The em-dash spacing is byte-identical every time. The reason is the practitioner's own words, at most one sentence, with no options, recommendations or softening; the Milestone renders it unchanged. One waiver per step: a waived step is done, so no later run or waiver writes it again.

**Fix instead of waive.** A finding the practitioner wants fixed is a new job they outline (Branch B); the gate job is left `wip` under this session's lock (§10). Once the fix job completes, its completing session finds the gate job already present, and the next step-9 session takes it over (§4's take-over variant), re-runs the tool, and rewrites every step still open.

**Completion.** §9 as usual, only once every step carries `done_at` — every check passed, was `n/a`, or was waived. Only then may `/draft` present the Writing as ready to file, or a notice of application or application response as ready to serve, and, on the practitioner's instruction, record its filing date through `drafting_data__record_filed` or its service date through `drafting_data__record_served` (`filing-checklists.md` §11).

**Re-running a stale gate: supersede, then create afresh** (the 2026-09-21 design §2.5). A completed gate job is never re-opened. When its checks ran before the latest changes and the practitioner says yes to re-running them, supersede it. Never do this on a session's own initiative:

```sql
UPDATE tickets SET status = 'superseded', completed_at = NULL
  WHERE id = 9 AND title = 'Pre-filing consistency gate' AND status = 'completed';
```

`completed_at` clears in the same statement because the CHECK ties it to `status = 'completed'`. `superseded_by` stays NULL until the fresh gate job's creation links it (**Link the gate job it replaced**, above). Then run the confirm-read:

```sql
SELECT status, completed_at FROM tickets WHERE id = 9;
```

`superseded` means it landed. `completed` means the guard matched nothing: a wrong id, or a job that is not the completed gate job. Report it and stop. Once it has landed, no gate job with a status other than `superseded` remains, so run this section's nothing-open read and creation rule in the same session, with `billing_anchor` copied from the superseded gate job. Waivers given on the old job do not carry over: every step of the fresh job starts `not yet run` and must pass, be `n/a`, or be waived again.

## 14a. The Pre-send gate job (the pre-send hold)

The pre-send hold (#951 note) is how a general Writing (a Writing that needs no forum parts, or a venue's `letter`, #1236) is kept from going out while its law is unproven or it is addressed to no one. Its checks are four of the Writing's Milestone criteria, as its type declares them: `primary-authority`, `excerpts`, `noting-up` and `recipients`, which is unmet while the Writing has no `'to'` recipient (`filing-checklists.md` §13 "Service list"). `counsel-review` never holds sending. A fifth check, `currency`, is universal and no type declares it: it is unmet while an implied clause that a `terms` part of the Writing prints names an enactment whose stored statute-currency result (`shared/statute-currency.md`) is not `current`, NULL included: the enactment's own result, and, once that is `current`, the result recorded for the provision the clause's statement pinpoints (schema v53), no row included. The Sent write reads that result live from the database after the `render_first` check below, and never runs the currency check itself. A sixth check, `authority-confirmed`, is universal too, no type declares it, and it follows `currency` (#1231): it is unmet while `filings.authority_confirmed_on` is NULL on an unsent Writing that needs no forum parts and whose type declares `primary-authority` and not `noting-up`, and it clears when the column is set, with no waiver beyond `send_anyway`. A venue's `letter` is outside it. Nothing parses the Writing's prose: the column records that the Writing links its cited authority through `filing_law` or cites none (`filing-checklists.md` §13 "Authorities cited"). The Sent write reads it from the Writing's row. A type that declares `noting-up`, as every shipped letter and memo type does, is outside it: the citation scan (`filing-checklists.md` §6b) counts each citation its text makes that no authority row tracks under `noting-up`. A seventh check, `position-conflict`, is universal too and follows `authority-confirmed`: it is unmet while a `queued` or `wip`, unshelved job titled `Decide a position our own correspondence contradicts` (§3g, a Pass 2 finding) is on the Writing, its open count the number of such jobs, and it clears when each is closed, with no waiver beyond `send_anyway`. The Sent write reads it live from the database. Below, "held criterion" includes `currency`, `authority-confirmed` and `position-conflict`. The hold is applied by the Sent write, `drafting_data__record_sent` (`filing-checklists.md` §13 "Sent write"), and this job records its outcome, as §14's job records the pre-filing gate's. A Writing that needs forum parts and is not a general Writing has §14's gate job and no hold. A venue's `letter` must be rendered before the Sent write, because the hold reads the latest render's inventory.

**Only the Sent write writes this job.** It creates it, rewrites its steps, waives them and completes it. A session never inserts, assigns, plans, runs or completes it, and never writes its steps: the tool call is the whole of running it. Its writes are job writes, exempt from the revision bump like every other.

**Creation.** The Sent write reads the inventory of the Writing's latest render and never renders: it refuses `render_first` when that render is older than the revision. When a held criterion is unmet on that inventory, or `currency`, `authority-confirmed` or `position-conflict` is unmet, and no job titled `Pre-send gate` is queued or in progress on the Writing, it creates one: `kind = 'work'`; `billing_anchor` copied from the Writing's `Deliver` job, or else its latest job carrying one (with none, it refuses `no_billing_anchor`); `priority` one above the Writing's highest; this fixed intent:

- Intent: `Meet or waive each criterion that holds this Writing back from being recorded as sent.`

and one step per unmet held criterion, the declared ones in the type's declared order, then `currency`, then `authority-confirmed`, then `position-conflict`, each reading the criterion's id, its card text, its open count and §14's ` [rev N]` token. `currency`'s open count is the number of clauses it withholds, and the `held` refusal names each by `clause_id` and result, a provision's preceded by its pinpoint (`clause_id 3 [currency: s 6 unchecked]`):

- `excerpts — Every excerpt is quoted, pinpointed and checked: unmet (2 open) [rev 57]`
- `currency — No implied clause names an enactment whose statute-currency result is not current: unmet (1 open) [rev 57]`
- `authority-confirmed — The Writing records that its cited authority is linked, or that it cites none: unmet (1 open) [rev 57]`
- `position-conflict — Counsel has decided every position the firm's own correspondence contradicts: unmet (1 open) [rev 57]`

No scope rows: the job writes nothing to this database. The Sent write then refuses `held`, naming each unmet criterion and the job, and writes nothing else.

**A later Sent write re-runs it.** It rewrites every step that does not carry ` — WAIVED: `: `unmet (<n> open) [rev N]` with `done_at` NULL while its criterion is still unmet, `met [rev N]` with `done_at` stamped once it is not. A criterion newly unmet gains a step at the next ordinal. A waived step is never rewritten. These writes, and the creation above, are made on their own only when the Sent write refuses `held`. Otherwise they are made in the transaction that records the Writing as sent, so a refusal after the hold, such as `sent_copy_mismatch`, leaves the job and its steps as they were.

**Send anyway is the waiver.** The practitioner's own words, verbatim, at most one sentence, with no options, recommendations or softening, are passed to the Sent write as `send_anyway`. In the transaction that records the Writing as sent, the Sent write appends §14's waiver form, ` — WAIVED: ` and the words, to every open step, stamps `done_at`, and completes the job. Without `send_anyway`, an unmet held criterion refuses the Sent write. When nothing is held, the Sent write closes any open step as met and completes the job in the same transaction.

**On the Milestone.** The `gate` row of a Writing the Sent write holds reads this job exactly as it reads §14's gate job, under the text `The pre-send checks are passed or waived`, and the card's strings read "to send" where §14's read "to file". With no job, the row reads the held criteria themselves, `currency`, `authority-confirmed` and `position-conflict` included: met when none is unmet. The job sits outside §14's nothing-open test and the open jobs the `gate` completion criterion reads, by its title.
