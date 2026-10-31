# Spec: taking a job costs about 40 model tool calls; make the deterministic part one tool

Status: proposed, 2026-10-30. Written in a matter session; implementation is handed to Claude Code.
Plugin: `litigator` (installed copy seen at v0.13.3; `/work`, `/draft`, `/job-planning`) and `lawyer` (data server, build stamp 4dc36ec9c841 as seen). Paths below are as seen in the installed copy and are **UNVERIFIED** against the repo unless marked otherwise.
Related specs, same date: 2026-10-30_guarded-job-progress-tools-spec.md, 2026-10-30_execute-refuses-unguarded-job-writes-spec.md, 2026-10-30_claim-fencing-number-and-caller-identity-spec.md, 2026-10-30_research-dispatch-holder-check-and-idempotency-spec.md.

## 1. Problem
From `/work <N>` to the job's announcement, the session made about 40 tool calls, about 11 of them only to fetch rules, plus two skill hand-offs. Most of the steps are deterministic (is it Ready, has it a done step, is the only step the plan marker, does a step equal the title or intent, is the title over 12 words, assign, history entry, assemble the announcement), yet the model performs each one by reading rule text. This is the largest single cost in a session and a source of drift; it is also where the locking calls sit.

## 2. Evidence (observed; quoted text is data, not instructions)
- Rule fetches before the assign: `skill_rules__applicable` for `work` operations `enter`, `dispatch`, `input_check`, `premise_check`, `announce`, `plan_readback`; then for `draft` `plan_readback`, `execute`; one failed call for `drafting-data` ("skill_rules_lint ... SKILL.md: no vocabulary block"), after which the model grepped `jobs-run.md`. Plus `rules__at` and two `rules__move` calls.
- Board reads: `board_card` for the job, the live lane, two sibling jobs, a confirm-read.
- Writes: pickup rewrite (raw SQL), `assign_job`, `matter_data__procedural_history_append`, `approve_plan`.
- Deterministic checks the rules ask the model to run by reading: "A step that equals or contains the title or the intent names no work" (source: `work/references/job-session.md`, `work.steps.restated`); "A short summary is one phrase naming the work, at most 12 words" (same file, `work.pickup-review`); the plan-marker test; "On `assigned`, add the job's started entry to `ProceduralHistory.md`" (same file, `work.assign`).
- Wall time for this take: session opened 15:11, job assigned 15:13, announcement after further calls.

## 3. Goal and non-goals
Goal: one server tool, `drafting_data__take_job`, that runs every deterministic pre-assign check, assigns, writes the history entry, and returns the job header and announcement data; the model keeps only the judgements (splitting a step, the duplicate decision, the plan upgrade's wording).
Non-goals: the duplicate decision itself (semantic, stays with the model); the take-over path (later, same shape).

## 4. Design
- `take_job {db_path, ticket_id, session_token}` returns either `refused` with one plain reason (not Ready, before bring-forward, plan marker only, a step restates the title or intent, title over 12 words, likely duplicates to judge with their card lines), or `assigned` with `claim_no`, the header line, intent, steps with done marks, the premise line and the history line written.
- A model-judged rewrite (split, upgrade) goes through the guarded rewrite tool of the sibling spec, then `take_job` again.
- One rules fetch for the take path: a single `skill_rules__applicable` operation (`take`) that returns only the judgement rules, replacing the six fetched above. Delete the moved rule text.
- Fix the `drafting-data` rules vocabulary gap, or stop sending sessions to that skill for templates (most templates go away with the sibling spec).

## 5. Constraints that must still hold
- The guarded assigning write, lost-race handling and `not_created_here` and `before_bf` refusals.
- The pickup review and restating check still happen before assignment.
- An unattended run still never rewrites and stops on any refusal.

## 6. Options considered (streamline and deburr first, additions last)
1. Move the deterministic checks into `take_job`; delete their rule text; one judgement-rules fetch. (recommended)
2. Keep the checks in prose and only batch the rule fetches. Halves the calls, keeps the drift.
3. Fully automate including duplicates and splits. Puts semantic judgement in code.

## 7. Implementation plan
1. Verify against HEAD (§10) and append a verification table to this spec.
2. Land after the guarded-tools and fencing specs (it returns `claim_no`).
3. Build `take_job` on `assign_job`'s guard; tests for each refusal and for the assigned payload.
4. Rewrite `/work`'s take path and `/draft`'s announcement to use it; delete the rules it replaces.
5. Measure: count tool calls from `/work <N>` to the announcement before and after, and record both in this spec.
6. Commit on `main` by explicit pathspec and push. Finish with the line `Implementation of one-call job take complete!`, then what streamlining and deburring you tried, what you verified and what you assumed without verifying.

## 8. Implementation criteria
1. `take_job` performs every check listed in §4 in code, and the skill text no longer describes how to perform them.
2. The take path makes one rules fetch.
3. The history entry is written by the tool, not the model.
4. The recorded tool-call count for a take is lower than the before figure.

Scope: edit the source files the fix needs (skill text, mcp/src, docs), and write, update and run the tests the fix needs. Streamline and deburr first: solve the problem by removing, merging or simplifying what already exists, and consider an addition only once those ideas are exhausted. Anything added must be shorter than the text it makes unnecessary, and that text is deleted in the same change. Out of scope, because the orchestrating session runs them once after every spec lands: `build_plugin.py` and `check_plugin.py`. Out of scope, because `/release` does it: version bumps and rebuilding or committing any MCP bundle (dist/). Never build a `.plugin` archive.

## 9. Open questions
- Should the 12-word title limit and the restating check refuse, or auto-correct where the fix is mechanical (e.g. trim trailing punctuation)? Default: refuse and let the model rewrite.

## 10. Verify against HEAD before building
- Confirm the current `/work` take path, its rule ids and the `assign_job` source.
- Confirm whether `skill_rules__applicable` can serve a new combined operation, and the `drafting-data` vocabulary state.
