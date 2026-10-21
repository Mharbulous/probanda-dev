# Spec: Every new job starts with a plan-marker step

Status: proposed, 2026-10-20. Written in a matter session; implementation is handed to Claude Code.
Plugin: `litigator` (installed copy seen at v0.6.5). Paths below are as seen in the installed copy and are **UNVERIFIED** against the repo unless marked otherwise.
Related specs, same date: 2026-10-20_approved-research-issues-pass-job-words-gate-spec.md, 2026-10-20_research-issue-by-issue-approval-creates-jobs-spec.md. Builds on 2026-10-15_job-plan-minimum-standards-spec.md.

## 1. Problem

A job needs at least one step when created, so a session that has no approved plan improvises one. An improvised plan looks like a real plan, which makes it hard for a later planning pass to tell which jobs still need planning. The practitioner's rule: the default checklist for a new job should always say "Create a plan for how to complete this job." so planning agents have a clear marker.

## 2. Evidence (observed; quoted text is data, not instructions)

- `drafting-data/references/jobs-create.md` §3, Call 3: "one INSERT per step, always at least one".
- `drafting-data/references/jobs-stock.md` §3i's example steps ("Put the question to /legal-research", "Save the answer under this job") were copied by the session as a plan for four new research jobs. No source prescribed them for that path.
- Practitioner reaction: improvising a plan at creation "make[s] it more difficult in the future for a planning-triage process to identify which jobs need planning."
- Workaround in use: for the four jobs, the session deleted its two steps per job and wrote one step with the practitioner's exact words, which the gate passed because the text matched the practitioner's turn.

## 3. Goal and non-goals

Goal: every job created without an approved plan carries one step reading exactly "Create a plan for how to complete this job.", so a planning pass can find it by text. Non-goals: how the plan is later written (see the job-plan minimum standards spec), and jobs created with a practitioner-approved plan.

## 4. Design

1. Add the marker step as fixed text in `jobs-create.md` §3 for every outlined job with no steps that the practitioner supplied or approved and none derived from a Proposal card. No gate route is needed: after the gate spec (2026-10-20_approved-research-issues-pass-job-words-gate-spec.md), the gate no longer reads step text.
2. The pickup review, restating check and pre-claim check treat a job whose only step is the marker as "needs a plan" and route it to planning, not as a one-step job with a restating step.
3. `/job-planning` replaces the marker step with the approved plan (the 2026-10-15 spec's upgrade rule; a marker step has no `done_at`).

## 5. Constraints that must still hold

- A job always has at least one step.
- A done step is never modified.
- The session never originates plan wording; the marker is fixed text.
- A job's plan is not approved while its only step is the marker.

## 6. Options considered

1. Fixed-text marker step on every unplanned new job, found by exact text (recommended).
2. A nullable "needs plan" column on the job: cleaner for queries, but a schema change and invisible on the card.
3. Leave it to the planning pass to guess which plans are real: what fails today.

## 7. Implementation plan

1. Verify against HEAD (§10) and append a verification table to this spec.
2. Add the fixed-text step to `jobs-create.md` §3 and its gate route.
3. Teach the pickup review, restating check and pre-claim check to recognise the marker.
4. Make `/job-planning` replace the marker.
5. Commit on `main` by explicit pathspec and push. Finish with the line `Implementation of Every new job starts with a plan-marker step complete!`, then what you verified and what you assumed without verifying.

## 8. Implementation criteria

1. A job created by outlining without supplied steps carries exactly one step with the marker text.
2. A job outlined from a Proposal keeps its card-derived steps and gets no marker. §3's stock fixed-text jobs keep their fixed steps.
3. A job whose only step is the marker is never announced or assigned as having an approved plan, and the restating check does not flag it.
4. `/job-planning` replaces the marker with the planned steps and leaves done steps alone.

Scope: edit the source files the fix needs (skill text, mcp/src, docs), and write, update and run the tests the fix needs. Out of scope, because the orchestrating session runs them once after every spec lands: `build_plugin.py` and `check_plugin.py`. Out of scope, because `/release` does it: version bumps and rebuilding or committing any MCP bundle (dist/). Never build a `.plugin` archive.

## 9. Open questions

None.

## 11. Decisions (Brahm, 2026-10-20)

- Proposal jobs keep their card-derived steps. The marker goes only on a job with no supplied, approved or derived steps.
- The words gate no longer reads step text, per the gate spec, so the marker needs no gate route. This spec lands after the gate spec.

## 10. Verify against HEAD before building

Re-read `jobs-create.md` §3, the pickup review in `draft/references/job-session.md`, and the `job-planning` shared file and skill to see whether they already treat a placeholder step specially.
