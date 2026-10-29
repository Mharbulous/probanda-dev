# Spec: the take-over form asks again after an instruction, and the idle report hides what the practitioner needs

Status: proposed, 2026-10-29. Written in a matter session; implementation is handed to Claude Code.
Plugin: `litigator` (installed copy seen at v0.13.3; `/work`) and `lawyer` (data server: `drafting_data__assign_job` description). Paths below are as seen in the installed copy and are **UNVERIFIED** against the repo unless marked otherwise.
Related specs, same date: 2026-10-29_job-last-activity-misses-progress-spec.md, 2026-10-29_job-staleness-policy-and-auto-release-spec.md

## 1. Problem
The practitioner said: check the two idle jobs again, and if they are still idle, take them over. The session re-checked, then showed the take-over form and asked "Take it over?" anyway, because the rules demand a bare yes to that form. The practitioner had to repeat himself. The idle report is also forbidden from saying whether the holding session is alive, so the practitioner cannot apply his own staleness rule from it.

## 2. Evidence (observed; quoted text is data, not instructions)
- "Before any write, render a decision form ... and the question \"This job is in progress in another session. Take it over?\" with options \"Take over\", \"Return it to Ready\" and \"Pick a different job.\"" (source: litigator `work/references/take-over.md`, `work.take-over.form`)
- "Take over: run `drafting_data__assign_job` with `takeover: true` ... only after the yes." (source: same file, `work.take-over.choices`)
- `assign_job`: "pass it only after the practitioner's explicit yes to the take-over prompt." (source: tool description)
- Idle report: "never say or imply whether its session is alive or has ended, and never offer a take-over." (source: `work/references/dispatch.md`, `work.opening.idle`)
- Practitioner's reply to the form (paraphrased, no client content): he had already said what to do, and asked whether a rule was forcing the question.
- Cost: one extra round trip and practitioner frustration; the form also carries no staleness reading of its own.

## 3. Goal and non-goals
Goal: an instruction that already says to take over (outright, or on a condition the session can check) counts as the yes; the form is shown only when the instruction did not say. The idle report states which staleness window each held job is in (live, check window, stale), per the staleness spec.
Non-goals: the thresholds and auto-release (staleness spec); the activity stamp (activity spec).

## 4. Design
- In `take-over.md`, replace "only after the yes" with: the practitioner's instruction to take over the named job, or to take it over if a stated, checkable condition holds and the session has just confirmed it, is the yes. Otherwise show the form. The `Taking over does not stop the other session` line is said in the announcement instead.
- The same change in `assign_job`'s description and in any hook that checks for a bare yes (UNVERIFIED that one exists for take-over).
- The idle report's line names the window from the staleness spec; the "never say alive" clause is removed for the windows that spec defines.
- Before the assigning write, the session re-reads the card (and the activity stamp) immediately before `assign_job`, and aborts if it moved since the check; this closes the 13:46 check / 13:51 write gap seen in session.

## 5. Constraints that must still hold
- A take-over still passes `expected_holder` and never wins a race.
- A job active within the last 30 minutes is never taken over on any instruction.
- An unattended run never takes over a job outside the staleness rules.

## 6. Options considered (streamline and deburr first, additions last)
1. Shorten the form rule: an instruction that settles it is the answer; delete the "only after the yes" duplicates in the tool description. (recommended)
2. Keep the form but pre-select "Take over" when an instruction exists. Still a round trip.
3. Remove the form entirely. Loses the decision for a job named without an instruction.

## 7. Implementation plan
1. Verify against HEAD (§10) and append a verification table to this spec.
2. Find every place that requires the bare yes for a take-over (skill text, tool description, hooks, tests).
3. Edit per option 1 and §4, after the staleness spec's edits to the same files land.
4. Tests: an instruction "take over job N if idle" with the condition confirmed assigns without a form; a bare naming of the job shows the form; a job active within 30 minutes is refused.
5. Commit on `main` by explicit pathspec and push. Finish with the line `Implementation of take-over form honours instructions complete!`, then what streamlining and deburring you tried, what you verified and what you assumed without verifying.

## 8. Implementation criteria
1. A take-over instruction with a confirmed condition assigns with no form shown.
2. The form appears only when no instruction settles the choice.
3. The card and activity stamp are re-read immediately before the assigning write, and a change aborts it.
4. The idle report names each held job's staleness window.

Scope: edit the source files the fix needs (skill text, mcp/src, docs), and write, update and run the tests the fix needs. Streamline and deburr first: solve the problem by removing, merging or simplifying what already exists, and consider an addition only once those ideas are exhausted. Anything added must be shorter than the text it makes unnecessary, and that text is deleted in the same change. Out of scope, because the orchestrating session runs them once after every spec lands: `build_plugin.py` and `check_plugin.py`. Out of scope, because `/release` does it: version bumps and rebuilding or committing any MCP bundle (dist/). Never build a `.plugin` archive.

## 9. Open questions
- none

## 10. Verify against HEAD before building
- Confirm the take-over rule text and any yes-checking hook.
- Confirm `assign_job`'s description source.

## 11. Verification against HEAD (2026-10-29, at dbdb52f6)

| Item | Spec said | HEAD |
|---|---|---|
| Take-over rule text | `work/references/take-over.md`, `work.take-over.form` and `work.take-over.choices` | Confirmed at `.claude/skills/work/references/take-over.md`. The form also carries the line "The other session last ended a turn on this job <n> min ago." from the card's `session active` stamp, and the choices name the staleness spec's `recently_active` outcome. "only after the yes" is in the Take over choice. |
| Other bare-yes duplicates for a take-over | tool description only | Also `.claude/skills/drafting-data/SKILL.md` (the "Assign a job" row: "`takeover: true` only after the practitioner's explicit yes"), `.claude/skills/drafting-data/references/jobs-run.md` §4 ("only after the practitioner has explicitly said yes to the take-over prompt") and the `takeover` field's comment in `source/lawyer/mcp/src/submission/forms/assign-job.ts`. ADR 0014 D4 mentions "the take-over form and its explicit yes" as history and stays. |
| Yes-checking hook for a take-over | UNVERIFIED that one exists | None. `practitioner-words-gate.py` gates merges, goal statements and revisions, and `rule-gate.py` gates Rules. No hook or test matches `assign_job` or `takeover`. |
| `assign_job` description source | tool description | `source/lawyer/mcp/src/schema/submission-data.ts`, the `assign_job` entry ("pass it only after the practitioner's explicit yes to the take-over prompt"). |
| Idle report rule | `work/references/dispatch.md`, `work.opening.idle` | Confirmed. Since the staleness spec it copies `check window: idle past 30 min`, and still ends "never say or imply whether its session is alive or has ended, and never offer a take-over." `.claude/skills/work/references/opening-routes.md` also says "There is no lock timeout; the practitioner is the liveness check" and forbids saying a lock is live, abandoned or ended, which ADR 0015 made stale. |
| Stale window on the idle report | the report names live, check window and stale | A job idle 60 minutes or more is read as released (Ready) by every board (ADR 0015 D4), so it has no In Progress line and no idle tag. The idle report can name only the live (idle tag, under 30 minutes) and check-window jobs. |
| Re-read before the assigning write | session re-reads the card and stamp | `assign_job`'s take-over guard already re-checks, inside the write, the holder (`expected_holder`) and that the job has been idle 30 minutes (`recently_active`). A move after the check and less than 30 minutes before the write is refused. A move followed by 30 or more idle minutes before the write is not. |
| Skill tests pinning take-over wording | grep | None under `.claude/skills/*/tests/`. `source/lawyer/mcp/test/release-job.db.test.mjs` calls a take-over. |
