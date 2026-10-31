# Spec: step stamps, the session-active stamp and the pickup rewrite are hand-written SQL; give them guarded tools

Status: proposed, 2026-10-30. Written in a matter session; implementation is handed to Claude Code.
Plugin: `lawyer` (data server, build stamp 4dc36ec9c841 as seen; installed v0.17.1) and `litigator` (installed copy seen at v0.13.3; `/work`, `/draft`, `/drafting-data`). Paths below are as seen in the installed copy and are **UNVERIFIED** against the repo unless marked otherwise.
Related specs, same date: 2026-10-30_execute-refuses-unguarded-job-writes-spec.md, 2026-10-30_claim-fencing-number-and-caller-identity-spec.md, 2026-10-30_research-dispatch-holder-check-and-idempotency-spec.md, 2026-10-30_one-call-job-take-spec.md. Earlier: 2026-10-29_job-last-activity-misses-progress-spec.md, 2026-10-29_job-staleness-policy-and-auto-release-spec.md.

## 1. Problem
Three writes that decide or prove who holds a job are composed by the model as raw SQL and sent through `drafting_data__execute`: ticking a step done, the per-turn session-active stamp, and the pickup rewrite of a Ready job's title and steps. The holder guard in each is typed by the model from a template in skill text, with the session token pasted in as a literal. Nothing checks that the guard is present or correct. The locking is only as deterministic as the model's copying.

## 2. Evidence (observed; quoted text is data, not instructions)
- Step stamp template: "UPDATE ticket_steps SET done_at = ... WHERE ticket_id = 2 AND ordinal = 1 AND EXISTS (SELECT 1 FROM tickets WHERE id = 2 AND locked_by = 'sess-a1');" and "No confirm-read here: read `changes` on each tick." (source: litigator `drafting-data/references/jobs-run.md` §6)
- Active stamp: "It is written as the last write of every turn in which this session held the job and worked on it" (source: same file §6a). It is raw SQL into `db_meta`.
- Pickup rewrite: "One script, each statement under that guard, the step list replaced whole and the title set only when it changed" (source: same file, "The pickup rewrite").
- `drafting_data__execute` description: "Run a write SQL script ... in a single transaction, with no compare-and-swap." (tool description)
- In this session, on one 5-step job: one pickup-rewrite script of 6 statements (changes 8) and one script with two step stamps plus the active stamp (changes 3). The session token literal was typed into SQL 3 times. The model read the template by grepping skill files after `skill_rules__applicable` with `skill: "drafting-data"` failed: "skill_rules_lint ... SKILL.md: no vocabulary block".
- HEAD reading from the 2026-10-29 activity spec §11: step-done and loose-thread writes are raw SQL through `drafting_data__execute`; `set_step`, `track_source`, `assign_job`, `save_answer` are server tools. Skill text is under `.claude/skills/`, the server under `source/lawyer/mcp/src/` (verified there at 0cc82b51, not by this session).

## 3. Goal and non-goals
Goal: every write to a held job's steps, its active stamp and a Ready job's pickup rewrite goes through a server tool that applies the holder guard itself and returns an outcome; the model never types a guard.
Non-goals: refusing raw job SQL in `execute` (sibling spec); fencing numbers (sibling spec, which extends these tools' guard); the staleness thresholds (2026-10-29 spec).

## 4. Design
- Extend `drafting_data__set_step` (it already guards on the holder) with `status: "done"`, so one tool covers ☑ and every other step status. A done step stays frozen.
- The active stamp: write it inside every job tool that takes `session_token` and `ticket_id`, so it is never a separate turn-end write. Delete §6a's raw SQL and the "last write of every turn" rule. Where a turn touches the job without a tool call (reading, conversation), add `drafting_data__touch_job` only if the 2026-10-29 activity spec has not already provided an equivalent (check first).
- Pickup rewrite: a tool `drafting_data__rewrite_ready_job {db_path, ticket_id, title?, steps[]}` that applies the existing guard (queued, unlocked, not shelved, no plan approval, no step done) and confirm-reads. The partial replace on a held job becomes a mode of the same tool (`held: true`, guarded on the holder, deletes only undone steps).
- Remove the SQL templates from `jobs-run.md` §5 pickup rewrite, §5 partial replace, §6 and §6a, leaving one line each naming the tool.

## 5. Constraints that must still hold
- A done step is frozen; a stamp lands only on the holder's job; `changes 0` still means the holder changed and the session stops.
- Steps and title are written verbatim from the card's words (paralegal posture).
- A take-over inherits done stamps; nothing here clears one.

## 6. Options considered (streamline and deburr first, additions last)
1. Fold "done" into `set_step`, fold the active stamp into existing job tools, one rewrite tool replacing two SQL templates. Deletes four SQL templates. (recommended)
2. Three new single-purpose tools. More surface, same effect.
3. Keep SQL, add a hook that lints the guard. Still model-typed; brittle.

## 7. Implementation plan
1. Verify against HEAD (§10) and append a verification table to this spec.
2. Add `done` to `set_step` with tests (holder, non-holder, already done).
3. Stamp `job_active:<id>` inside every holder-guarded job tool; test that a `set_step` call moves `session active`.
4. Add the rewrite tool (ready and held modes) with guard tests and a confirm-read.
5. Delete the SQL templates and the turn-end stamp rule from `jobs-run.md` and any skill text that repeats them (grep `job_active`, `done_at =`).
6. Commit on `main` by explicit pathspec and push. Finish with the line `Implementation of guarded job progress tools complete!`, then what streamlining and deburring you tried, what you verified and what you assumed without verifying.

## 8. Implementation criteria
1. No skill text instructs raw SQL for a step stamp, the active stamp, the pickup rewrite or the partial replace.
2. `set_step` with `done` stamps only the holder's step and refuses a frozen one.
3. Every holder-guarded job tool writes the active stamp in the same transaction.
4. The rewrite tool refuses a job that is locked, shelved, approved or has a done step (ready mode), and deletes only undone steps (held mode).

Scope: edit the source files the fix needs (skill text, mcp/src, docs), and write, update and run the tests the fix needs. Streamline and deburr first: solve the problem by removing, merging or simplifying what already exists, and consider an addition only once those ideas are exhausted. Anything added must be shorter than the text it makes unnecessary, and that text is deleted in the same change. Out of scope, because the orchestrating session runs them once after every spec lands: `build_plugin.py` and `check_plugin.py`. Out of scope, because `/release` does it: version bumps and rebuilding or committing any MCP bundle (dist/). Never build a `.plugin` archive.

## 9. Open questions
- none

## 10. Verify against HEAD before building
- Confirm `set_step`'s source and status enum, and whether the 2026-10-29 activity spec already added a touch/heartbeat tool.
- Confirm every place the §5/§6/§6a SQL templates are quoted (skill text, tests, docs).
- Confirm the `drafting-data` skill still has no rules vocabulary block (the lint failure above).
