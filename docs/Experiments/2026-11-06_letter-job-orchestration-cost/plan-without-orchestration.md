# One letter job with phase steps

## Context

A letter Writing's save writes one stock job, `Deliver` (send, record as sent). Since 2026-10-23 no job covers drafting the letter, so the Work Board implies sending is the whole task. The practitioner wants the research-job model: one job for one letter, showing the letter's phases as its steps.

Decisions taken in this session (practitioner, 2026-11-06):
- (a) One job under a new title. Old letters keep `Deliver`.
- (c) Delivered, acknowledgement and follow-up are steps inside the job, after sending.
- (b)/(d) Steps that do not apply are omitted at creation.
- Criteria: the job's steps are the checklist. The goal_criteria lists and the criteria code stay unchanged.

Duplication check: no plan or issue covers this fix. Today's diagram `docs/diagrams/Built/Letter drafting.html` (ff552963) describes the current process. A busy peer session could not be asked, because the message expired undelivered.

## Scope

- **Covered:** every letter kind (`_NoVenue` letter kinds and a venue's `letter` kind) at its own save.
- **Unchanged:** `internal-memo`, `unstructured*`, a letter saved under the `Availability letter` job (it already has a drafting job, so it keeps `Deliver`), and every letter already saved.

## The job (fixed text, `drafting-data/references/jobs-stock.md` §3b)

- **Title:** `Draft and send the letter`. This name is proposed. Change it at approval if you want another, because a stock title is permanent once shipped.
- **Intent:** `Draft this letter, send it to its recipients, and see it through to a reply.`
- **Steps.** † marks a step the save omits when the practitioner's request already rules it out:
  1. `Frame the letter: real audience, purpose as an outcome, fit with the goal, capacity and register, without prejudice, delivery method, copies, enclosures, what it must not say`
  2. `Source or attribute each fact, and list the gaps`
  3. † `Settle the law: propositions, research jobs, excerpts and note-ups`
  4. `Approve the outline; the scrivener drafts`
  5. `Review: facts traced, tone and audience, risk, counsel's paragraph review, DRAFT label removed`
  6. † `Client approval`
  7. `Finalize: letterhead, enclosures, signature`
  8. `Send the letter to its recipients` (Deliver's text, unchanged)
  9. `Record the letter as sent` (Deliver's text, unchanged)
  10. `Confirm delivery`
  11. † `Acknowledgement received`
  12. † `Follow up on the date the practitioner set, and log the response`
- **Scope:** Deliver's (`filings`, the letter's id) and (`documents`, NULL), plus `Draft the letter`'s (`filing_prose`, NULL) and (`filing_recipients`, NULL).
- **Steps that don't apply.** A † step is omitted at save only on the practitioner's words. A step found not to apply later is set `cancelled` on their words (`set_step`, which exists).
- **No dates.** No step stores or computes a date. Step 12's date is the practitioner's, held by the existing `/task-prioritization` follow-up.

## Changes

**Skill text** (source under `.claude/skills/`):
- `drafting-data/references/jobs-stock.md` §3b:
  - Table row: a letter kind gets the new job alone. `Deliver` stays only for a save under `Availability letter`, and for letters saved before this change.
  - Replace the `Deliver`-alone letter idiom SQL with the new job's SQL.
  - Add the job's text block.
  - Add the new title to the "twelve jobs" exclusion sentence.
- `drafting-data/references/jobs-gate.md:20`: add the title to the SQL exclusion list, before `'Draft the letter'`, so the substring the test asserts survives.
- `draft/references/procedure.md:37` (save first): a letter's save writes the new job, and the saving session takes it, because the practitioner named this letter.
- `draft/references/letters.md` §8:
  - Rewrite the `Deliver` paragraph for the new job.
  - Add one line per phase saying which existing check ticks its step:
    - source-trace pass → step 5
    - the Sent write → steps 8 and 9
    - delivery-checker → step 10
  - Delete the prose the steps now make unnecessary.
- One-line title mentions in:
  - `work/references/dispatch.md:41` (practitioner's own)
  - `work/SKILL.md:22`
  - `draft/references/job-session.md:39`
  - `draft/references/delivery-check.md`
  - `draft/SKILL.md:59` (ban 19 text unchanged in substance)
  - `prepare/SKILL.md:92`

**Server code** (`source/lawyer/mcp/src/submission/forms/`):
- `goal-gate.ts`: add the title to `STOCK_TITLES`. This also covers `take-job.ts` `fixedText()`.
- `sent-write.ts`:
  - **The new title:** stamp only the steps whose text is `Send the letter to its recipients` or `Record the letter as sent`. Complete the job only when every step is resolved, using the resolved test from `step-state.ts` (as `complete-job.ts` uses it). Report it under the existing closed-job result field.
  - **Old `Deliver`:** behaviour unchanged.
  - **Billing anchor (line 184):** `title IN ('Deliver', <new>)`.
- `build-proceeding-board.ts:188`: the new title is `practitioner_own` too.
- `build-work-board.ts:61-62`: unchanged. Those skips stay `Deliver`-only, and the new job is already skipped as practitioner's own.

**Diagram:** update stage 1 ("its Deliver job") and stage 5 ("Deliver job closed") in `docs/diagrams/Built/Letter drafting.html`, with a new commit tag and date.

## Tests

- `.claude/skills/drafting-data/tests/test_migrate_engine.py` `TestLetterStockJobIdioms`:
  - The plain-save block yields the new title and its 12 steps.
  - The Availability block still yields `Deliver`.
  - The jobs-gate substring holds.
- `source/lawyer/mcp/test/sent-write.db.test.mjs`, with new cases for the new title:
  - Only steps 8 and 9 are stamped.
  - The earlier unticked steps stay open.
  - The job stays queued while step 10 or later is open.
  - The job is completed when every remaining step is cancelled or done.
  - The existing `Deliver` cases pass unchanged.
- The board test: the new job shows `dispatch: skip (practitioner's own)` and is left out of the `gate` count.

## Constraints kept

- The scrivener alone words the letter.
- Source-trace (ban 20) and the delivery check (ban 19) are unchanged and only tick steps.
- No deadline is stored.
- Purpose comes from the practitioner.
- The criteria code and the type files are untouched.

## Verification

1. `npm --prefix "$HOME/Git/probanda-dev/source/lawyer/mcp" run build`, then `APPDATA=<scratch> node --test` on the sent-write, recipients-criterion, forms-render-workboard and take-job tests.
2. `python -m pytest -q` on `.claude/skills/drafting-data/tests`, `.claude/skills/draft/tests` and `.claude/skills/shared/scrivener/tests`.
3. `python scripts/build_plugin.py`, then `--check`, then `python scripts/check_plugin.py`, `python scripts/check_layering.py` and `python scripts/check_publishable.py --new-since origin/main`.
4. Commit the source and `plugins/` by pathspec, then pull `--ff-only` and push. No version bump and no dist/ bundle, because /release does those.
