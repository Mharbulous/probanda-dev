---
status: accepted
date: 2026-10-29
---

# A held job's lock lapses after an hour idle

A job whose session died stayed In Progress until someone noticed. Dispatch never chose it and never offered it, and only the practitioner naming it reached the take-over form (CoClerk ADR 0037), so the practitioner named each idle job and instructed a take-over by hand. The practitioner set a staleness rule on 2026-10-29 (spec `2026-10-29_job-staleness-policy-and-auto-release-spec.md`). This amends CoClerk ADR 0037 D2 and D3 and replaces the firm setting `idle_flag_hours`.

## Decisions

- **D1. One threshold, defined once.** A held job's idle time runs from its last activity (the stamp of spec `2026-10-29_job-last-activity-misses-progress-spec.md`, else its lock), or from a later wake-up minute of a ⏳ step not yet done. The threshold is 60 minutes, `LAPSE_AFTER_MINUTES` in the data server's `job-activity.ts`. It is a lock-lapse time, never shown as a countdown. (It was first 30 and 60; see the last note.)
- **D2. Under 30 minutes: live.** Removed 2026-11-03, see the last note.
- **D3. Under 60 minutes: held.** The job stays In Progress and Dispatch still skips it. A take-over runs only on the practitioner's instruction, through the take-over form, and never in an unattended run. No session checks whether the holder is still active and none messages it (the practitioner's ruling, 2026-10-29).
- **D4. 60 minutes or more: the lock has lapsed.** Every board reads the job as released: Ready, Blocked or Bring Forward by its own blockers and date, holding no material and no either/or partner. Dispatch chooses it like any Ready job, and `assign_job` without `takeover` takes it with no prompt. The board writes nothing. The lock is replaced only by that assigning write, in one transaction with a `kv_store` row (`lock_lapsed` / `tickets:<id>`, the minute and the holder tag it was taken from), which is the job's history of the lapse. Its plan, approvals and done steps are kept, as for a released job.
- **D5. The previous holder.** Once the job is taken, the previous holder's writes are refused by the existing lock guards. Until then its lock is still on the row, so a write it makes moves the job's last activity and the job is live again.

## Amendments to CoClerk ADR 0037

- **D2** no longer forbids clearing a stale lock without the form. A lapsed lock is released by the next assignment, in an attended session or an unattended run. "Return it to Ready" stays as it was, on the take-over form only.
- **D3** stands.

## Considered options

- **A stale column the skills act on.** Rejected: more skill text and a second source of truth.
- **A scheduled sweep that releases stale jobs.** Rejected: a moving part, while the board build already runs at every opening and `assign_job` re-checks the lapse in its own guard.
- **Check whether the holding session is still active and message it in the check window.** Rejected for now: Probanda cannot list or message Claude sessions.
- **Keep `idle_flag_hours` beside the thresholds.** Rejected: past 60 minutes no job is In Progress, so a flag of a whole number of hours could never show.

## Consequences

- `practice_data__upsert_firm_profile` no longer takes `idle_flag_hours`, and `firm_profile` no longer returns it. A `firm.json` that still holds the key is read as before, with that key ignored.
- `drafting_data__assign_job` has a guard that, without `takeover`, also matches a lapsed lock.
- The rule lives in `work/references/dispatch.md` (the idle report and `work.dispatch.in-progress`) and `work/references/take-over.md`.

## Note: the take-over form and the idle report (spec `2026-10-29_take-over-form-and-idle-report-honour-staleness-spec.md`)

- In D3, the practitioner's instruction to take over the named job, outright or on a stated condition the session has just confirmed on its card, is the yes, and the form is shown only when no instruction settles it.
- A take-over passes the card's `last activity:` minute as `expected_last_activity` beside `expected_holder`, and lands only while the row still shows both, so a job that moved since the check is never taken. It returns `holder_changed`.

## Note: the 30-minute floor removed (2026-11-03)

- The 30-minute floor, the `recently_active` outcome and the board's and idle report's `check window` flag are gone. A take-over of a job idle under 60 minutes now lands on the practitioner's instruction or their yes to the form, whatever its last activity, and `assign_job` no longer has the `recently_active` outcome. The practitioner knew the holding session was gone and a 30-minute refusal only delayed the work. The 60-minute lapse (D4) and the guards on the card's holder and last activity (`holder_changed`) are unchanged.
- Looking the holder up is still rejected: the lock holds a random token the data server mints, and no host session id reaches it.
- The take-over form says "Probanda cannot tell whether that session is still open", beside the last-activity time it already shows.
