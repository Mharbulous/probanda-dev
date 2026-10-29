# Spec: a staleness policy for held jobs: 30-minute check, 60-minute auto-release and take-over

Status: proposed, 2026-10-29. Written in a matter session; implementation is handed to Claude Code.
Plugin: `litigator` (installed copy seen at v0.13.3; `/work`, `/draft`) and `lawyer` (data server: `drafting_data__assign_job`, `drafting_data__release_job`, board render). Paths below are as seen in the installed copy and are **UNVERIFIED** against the repo unless marked otherwise.
Related specs, same date: 2026-10-29_job-last-activity-misses-progress-spec.md, 2026-10-29_take-over-form-and-idle-report-honour-staleness-spec.md

## 1. Problem
There is no rule for when a held job is abandoned. An In Progress job is never chosen or offered, and only the practitioner naming it reaches the take-over form, so a job whose session died stays locked until a human notices. The practitioner's rule (Brahm, stated in session) is:
- Under 30 minutes with no activity: live. Leave it alone.
- 30 to 60 minutes: possibly abandoned. Check whether the holding session is still active (not archived or deleted), and message it, because it may be waiting on a question for the practitioner or have nothing left to do. Take it over only if that session is not active.
- 60 minutes or more: stale, whoever holds it, because any cached context has expired by then. Release it from the holding session at once; any other session that sees it takes it over.

## 2. Evidence (observed; quoted text is data, not instructions)
- "An In Progress job, including one with every step resolved, is never chosen and never offered: the take-over form (`references/take-over.md`) is reached only by the practitioner naming that job." (source: litigator `work/references/dispatch.md`, rule `work.dispatch.in-progress`)
- Idle report: "State only these facts: never say or imply whether its session is alive or has ended, and never offer a take-over." (source: `work/references/dispatch.md`, `work.opening.idle`)
- Take-over: "Nothing about it says whether the other session is live (ADR 0037)." (source: `work/references/take-over.md`)
- `drafting_data__assign_job`: "takeover: true admits a wip job held by another session; pass it only after the practitioner's explicit yes to the take-over prompt." (source: tool description)
- The board's idle tag already prints `idle past <N> h` (source: `work.opening.idle`).
- Workaround in use: the practitioner names each idle job and instructs a take-over by hand.

## 3. Goal and non-goals
Goal: the thresholds above enforced from one place, with a 60-minute lock treated as released and taken without a prompt, and a 30-to-60-minute lock checked before any take-over.
Non-goals: making the activity stamp accurate (sibling spec, a prerequisite); the take-over form's wording (sibling spec).

## 4. Design
- Thresholds live in one constant pair in the data server (30, 60 minutes), read from the last-activity stamp of the sibling spec.
- 60+ minutes: the board render (or `assign_job`) treats the lock as lapsed: the job reads Ready to every session's Dispatch walk, and `assign_job` without `takeover` may take it (lapse cleanup may already exist: section 14's "lapse cleanup", UNVERIFIED). The previous holder's later writes are refused by the existing lock guards. Record the release in the job's history.
- 30-60 minutes: Dispatch still skips the job, but the idle report says it is in the check window; on the practitioner's instruction, or in an unattended run, the session checks whether the holder is active and messages it before any take-over. ADR 0037's "never say whether live" is amended for this window only.
- Under 30 minutes: unchanged.
- How "session still active" is read and how a message reaches it is an open question (§9): Probanda cannot list Claude sessions today (UNVERIFIED).

## 5. Constraints that must still hold
- A take-over is guarded by `expected_holder`; a race never overwrites a newer holder.
- A released job keeps its plan, approvals and done steps.
- Never a deadline: the thresholds are lock-lapse times, never shown as countdowns.
- No take-over of a job active in the last 30 minutes, ever.

## 6. Options considered (streamline and deburr first, additions last)
1. Lapse the lock at 60 minutes in the data server, so the existing Ready-job path handles it with no new prompt; add the 30-60 window as one idle-report state. Deletes the "never offered" carve-out for lapsed jobs. (recommended)
2. Leave the lock and add a "stale" column the skills act on. More skill text, two sources of truth.
3. A scheduled sweep that releases stale jobs. Adds a moving part; the render already runs at every opening.

## 7. Implementation plan
1. Verify against HEAD (§10) and append a verification table to this spec.
2. Find the lapse cleanup, ADR 0037 and every rule that forbids saying a session is live or offering a take-over.
3. Implement option 1 in the data server; amend ADR 0037; edit `work/references/dispatch.md` and `take-over.md` (coordinate with the form spec, §Coordination in the block).
4. Tests: a 61-minute lock is assignable without takeover; a 45-minute lock is not; a 10-minute lock is never taken.
5. Commit on `main` by explicit pathspec and push. Finish with the line `Implementation of job staleness policy complete!`, then what streamlining and deburring you tried, what you verified and what you assumed without verifying.

## 8. Implementation criteria
1. One pair of thresholds, 30 and 60 minutes, defined once.
2. A job with 60+ minutes of no activity is taken by an ordinary Dispatch with no practitioner prompt, and its previous holder's writes are refused.
3. A job at 30-60 minutes is flagged and taken over only after the holder is found inactive.
4. A job active in the last 30 minutes is never taken over.
5. ADR 0037 records the amendment.

Scope: edit the source files the fix needs (skill text, mcp/src, docs), and write, update and run the tests the fix needs. Streamline and deburr first: solve the problem by removing, merging or simplifying what already exists, and consider an addition only once those ideas are exhausted. Anything added must be shorter than the text it makes unnecessary, and that text is deleted in the same change. Out of scope, because the orchestrating session runs them once after every spec lands: `build_plugin.py` and `check_plugin.py`. Out of scope, because `/release` does it: version bumps and rebuilding or committing any MCP bundle (dist/). Never build a `.plugin` archive.

## 9. Open questions
- How does a session tell whether another Claude session is active, archived or deleted, and how does it message it? (Cowork session list, cross-agent messaging, or the turn-end heartbeat of the sibling spec as a proxy.) Ask Brahm before building the 30-60 check.

## 10. Verify against HEAD before building
- Confirm ADR 0037's text and the lapse cleanup's current behaviour.
- Confirm where `idle` and `idle past <N> h` are computed.

## 11. Verification against HEAD (80170fa0, 2026-10-29)

| Check | Spec's reading | Found at HEAD |
|---|---|---|
| ADR 0037 | in `docs/ADRs/` | Not in this repo (`docs/ADRs/` stops at 0014). It is CoClerk's `docs/adr/0037-a-session-can-return-another-sessions-stale-job-to-ready.md` (2026-10-05), which added "Return it to Ready" to the take-over form. D2 offers it only on the form, reached only by the practitioner naming the job, never in an unattended run. D3: "The session never says or implies whether the other session is live or has ended." It is cited as plain "ADR 0037" in `.claude/skills/work/references/take-over.md`, `.claude/skills/drafting-data/references/jobs-run.md` (§2 and §10) and `source/lawyer/mcp/src/submission/forms/release-job.ts`. CoClerk is no longer edited, so the amendment follows ADR 0014's precedent: a new ADR here that names the CoClerk one. |
| Lapse cleanup | may already lapse locks | It does not touch locks. "Lapse cleanup" (`.claude/skills/work/references/opening.md` `work.lapse`, `drafting-data/references/jobs-closeout.md`) deletes Proposal shelvings whose marker or item changed. No code or rule lapses a job's lock today: a `wip` lock clears only by the holder's release, the take-over form's "Return it to Ready", an in-progress shelving or completion. |
| Where `idle` is computed | idle tag prints `idle past <N> h` | Two tags. `idle <elapsed>, about <p>%` is `idleTag` in `source/lawyer/mcp/src/submission/board-job-text.ts`, past a fixed 15 minutes (`IDLE_AFTER_MINUTES`). `idle past <N> h` is `idle_flag`, set by `withIdleFlag` in `submission/forms/ticket-category.ts` from the firm setting `idle_flag_hours` (`tools/practice/firm-profile.ts` `idleFlagHours`), called in `build-work-board.ts` and `no-writing-boards.ts`, drawn on the page by `templates/milestone`. Both measure from `idleSince` (`ticket-category.ts`): the stamp of the sibling spec (`job-activity.ts`, falling back to `locked_at`) or a later ⏳ `wait_until`. |
| Category of a held job | — | `classify` (`ticket-category.ts`) returns `wip` for every `status = 'wip'` row, whatever its age. `holdsMaterial` reads `status`. `buildProceedingBoard` takes only the local date, not the Rendered minute. |
| `assign_job` guard | — | Without `takeover`: `status = 'queued' AND locked_by IS NULL` (`source/lawyer/mcp/src/submission/forms/assign-job.ts`). A `wip` row is reachable only with `takeover` and `expected_holder`. |
| Rules forbidding liveness talk or a take-over offer | `dispatch.md`, `take-over.md` | `.claude/skills/work/references/dispatch.md` `work.opening.idle` ("never say or imply whether its session is alive or has ended, and never offer a take-over") and `work.dispatch.in-progress`; `take-over.md` `work.take-over.choices` (cites ADR 0037); `opening-routes.md` (a release asked for takes the take-over form); the `assign_job` description in `src/schema/submission-data.ts` ("pass it only after the practitioner's explicit yes"). |
| Job history | release recorded in the job's history | No history table. The job tables carry no revision triggers. Since schema v80 a job's per-row attributes go in `kv_store` (sibling spec §11), so no DDL is needed. |
| §9 open question | ask Brahm | Settled 2026-10-29: flag only. In the 30-60 minute window the job is labelled, Dispatch still skips it, and a take-over there runs only on the practitioner's instruction. No liveness check and no messaging. |
