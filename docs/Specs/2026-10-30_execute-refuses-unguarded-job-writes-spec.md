# Spec: `drafting_data__execute` accepts any write to job tables; refuse job writes that have a guarded tool

Status: proposed, 2026-10-30. Written in a matter session; implementation is handed to Claude Code.
Plugin: `lawyer` (data server, build stamp 4dc36ec9c841 as seen; installed v0.17.1). Paths below are as seen in the installed copy and are **UNVERIFIED** against the repo unless marked otherwise.
Related specs, same date: 2026-10-30_guarded-job-progress-tools-spec.md, 2026-10-30_claim-fencing-number-and-caller-identity-spec.md, 2026-10-30_research-dispatch-holder-check-and-idempotency-spec.md, 2026-10-30_one-call-job-take-spec.md.

## 1. Problem
`drafting_data__execute` is the general SQL door. It already refuses some writes (filed/sent stamps), but it takes any `UPDATE` or `DELETE` on job rows and their steps with no holder check. Once the guarded tools of the sibling spec exist, a raw job write is either a mistake or a bypass, and nothing stops it.

## 2. Evidence (observed; quoted text is data, not instructions)
- Description: "Run a write SQL script ... in a single transaction, with no compare-and-swap." and "a script that leaves a filing's filed_on or sent_copy_id holding a value it did not hold is refused whole" (tool description). So refusing by effect already exists for some columns.
- The description lists the job tools to use instead ("a job is assigned through drafting_data__assign_job ... a job step's status is set through drafting_data__set_step ...") as prose only; nothing enforces it.
- It reports: "on a script that writes only job tables, changes 0 means its guards matched nothing" (tool description), i.e. job-table writes through it are expected today.
- In this session the model sent two raw job scripts through it (pickup rewrite; step stamps plus active stamp).

## 3. Goal and non-goals
Goal: `execute` refuses, writing nothing, any script that changes job status, lock, steps, plan approval or the active stamp, naming the tool to use instead.
Non-goals: creating the tools (sibling spec, a prerequisite); loose-thread capture or other job-adjacent writes that have no tool yet (list them, leave them allowed).

## 4. Design
- Reuse the existing refuse-by-effect mechanism used for `filed_on` and `sent_copy_id`: compare the guarded columns and rows before and after inside the transaction and roll back on a change.
- Guarded: the job row's `status`, `locked_by`, `locked_at`, `plan_approved_at`, `completed_at`, `rejected_at`, `deleted_at`, `superseded_by`; every `ticket_steps` insert, update or delete; `db_meta` keys `job_active:*`; the claim number of the fencing spec.
- The refusal names the tool: `job_write_refused: use drafting_data__set_step` (and so on).
- Shorten the description's prose list of tools to the refusal rule.

## 5. Constraints that must still hold
- The migrate path and the guarded tools still write these columns.
- A refusal writes nothing and is quoted verbatim by the session.
- Job-adjacent writes with no tool yet keep working until a tool exists.

## 6. Options considered (streamline and deburr first, additions last)
1. Extend the existing before/after refusal to the job columns; delete the prose tool list. (recommended)
2. SQL parsing to reject statements naming job tables. Brittle against triggers and CTEs.
3. A PreToolUse hook. Outside the server; bypassable by another client.

## 7. Implementation plan
1. Verify against HEAD (§10) and append a verification table to this spec.
2. Land after the guarded-tools spec, so no skill text still needs the raw writes.
3. Extend the refusal; tests for each guarded column and for an allowed job-adjacent write.
4. Grep skill text and tests for remaining raw job SQL; route each to its tool or list it as allowed.
5. Commit on `main` by explicit pathspec and push. Finish with the line `Implementation of execute refuses unguarded job writes complete!`, then what streamlining and deburring you tried, what you verified and what you assumed without verifying.

## 8. Implementation criteria
1. A script changing any guarded column or step row through `execute` is refused whole and names the tool.
2. The guarded tools and migrations still write those columns.
3. No skill text instructs a raw write that would now be refused.

Scope: edit the source files the fix needs (skill text, mcp/src, docs), and write, update and run the tests the fix needs. Streamline and deburr first: solve the problem by removing, merging or simplifying what already exists, and consider an addition only once those ideas are exhausted. Anything added must be shorter than the text it makes unnecessary, and that text is deleted in the same change. Out of scope, because the orchestrating session runs them once after every spec lands: `build_plugin.py` and `check_plugin.py`. Out of scope, because `/release` does it: version bumps and rebuilding or committing any MCP bundle (dist/). Never build a `.plugin` archive.

## 9. Open questions
- Which job-adjacent writes (loose-thread capture, scope expansion, shelving scripts) have no tool yet and must stay allowed? Answer from source; ask Brahm only if one is a lock-bearing write with no tool.

## 10. Verify against HEAD before building
- Confirm where the `filed_on`/`sent_copy_id` refusal is implemented and whether it is reusable.
- Confirm the job table and column names, and where the claim number of the fencing spec will live (`kv_store`).
