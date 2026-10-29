# Spec: session entry opens the lowest-numbered Writing, not the most recently worked one

Status: proposed, 2026-10-29. Written in a matter session; implementation is handed to Claude Code.
Plugin: `lawyer` (installed copy seen at v0.16.0; data server, build stamp 4dc36ec9c841 as seen). Paths below are as seen in the installed bundle `lawyer/mcp/dist/litigation-mcp.js` and are **UNVERIFIED** against mcp/src unless marked otherwise.
Related specs, same date: 2026-10-29_milestone-card-first-opening-order-spec.md, 2026-10-29_open-session-server-time-spec.md, 2026-10-29_open-session-matter-root-from-project-spec.md, 2026-10-29_job-last-activity-misses-progress-spec.md

## 1. Problem
With no Milestone named, `/work` must show the Milestone worked on most recently. `drafting_forms__open_session` already orders Writings by recency, but a tie-break makes all Writings in a proceeding tie whenever the latest activity is on a General Job (a job with no Writing), and the lowest filing id wins. A wrong default costs a second render, stage and card (about 10-15 s) and violates the objective.

## 2. Evidence (observed; quoted text is data, not instructions)
- Bundle: `function orderByRecency(filings)` at l.111723 (verified present); `openBoard` at l.113278 (verified present) opens the first live, non-milestone-only entry of that order.
- `latest_activity` is the max of tickets created / locked_at / plan_approved_at / completed_at, step done_at and seeds created (~l.94850, UNVERIFIED).
- `activityFor` (~l.111743-111753, UNVERIFIED) counts activity on a job with `filing_id NULL` as shared activity of every filing in its proceeding.
- In the run: six Writings on one proceeding; filing 1 opened by "the first live filing" rule (tool description: "opens filing_id, or the first live filing that is not a Milestone with no Writing").

## 3. Goal and non-goals
Goal: with no filing named, open the Writing with the most recent own activity; shared (General Job) activity only breaks ties among Writings with none of their own, then most recent shared, then lowest id.
Non-goals: which events count as activity (sibling last-activity spec).

## 4. Design
Change the comparison in orderByRecency/activityFor (mcp/src source of these) to rank own activity before shared activity. No new data, no new parameter.

## 5. Constraints that must still hold
- A caller's `filing_id` always wins.
- Retired Writings and Milestones with no Writing are still never opened by default.
- Listing order shown to the practitioner stays recency order.

## 6. Options considered (streamline and deburr first, additions last)
1. Fix the tie-break inside the existing comparison. (recommended)
2. Drop shared activity from recency entirely: a matter worked only through General Jobs would fall back to id order.
3. Store a "last opened Milestone" stamp: an addition, unnecessary.

## 7. Implementation plan
1. Verify against HEAD (§10) and append a verification table to this spec.
2. Edit the recency comparison in mcp/src.
3. Tests: own activity beats a newer shared activity; shared breaks a tie of no own activity; filing_id override.
4. Commit on `main` by explicit pathspec and push. Finish with the line `Implementation of open_session recency tie-break complete!`, then what streamlining and deburring you tried, what you verified and what you assumed without verifying.

## 8. Implementation criteria
1. A test with a newer General Job activity and an older own activity on Writing 2 opens Writing 2.
2. Existing recency and filing_id tests still pass.
3. No new column, parameter or stored stamp.

Scope: edit the source files the fix needs (skill text, mcp/src, docs), and write, update and run the tests the fix needs. Streamline and deburr first: solve the problem by removing, merging or simplifying what already exists, and consider an addition only once those ideas are exhausted. Anything added must be shorter than the text it makes unnecessary, and that text is deleted in the same change. Out of scope, because the orchestrating session runs them once after every spec lands: `build_plugin.py` and `check_plugin.py`. Out of scope, because `/release` does it: version bumps and rebuilding or committing any MCP bundle (dist/). Never build a `.plugin` archive.

## 9. Open questions
- none

## 10. Verify against HEAD before building
- Find orderByRecency, activityFor and latest_activity in mcp/src and confirm the shared-activity tie.
- Check whether the last-activity spec changes latest_activity's inputs; land after it if both edit the same function.
