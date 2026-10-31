# Spec: guard job writes with a per-claim fencing number, and stop the model carrying the session identity

Status: proposed, 2026-10-30. Written in a matter session; implementation is handed to Claude Code.
Plugin: `lawyer` (data server, build stamp 4dc36ec9c841 as seen; installed v0.17.1) and `litigator` (installed copy seen at v0.13.3). Paths below are as seen in the installed copy and are **UNVERIFIED** against the repo unless marked otherwise.
Related specs, same date: 2026-10-30_guarded-job-progress-tools-spec.md, 2026-10-30_execute-refuses-unguarded-job-writes-spec.md, 2026-10-30_research-dispatch-holder-check-and-idempotency-spec.md, 2026-10-30_one-call-job-take-spec.md. Depends on: 2026-10-29_job-staleness-policy-and-auto-release-spec.md (locks lapse at 60 minutes).

## 1. Problem
Every job write is guarded by the holder's session token, which the model carries in context and pastes into each call. Two weaknesses: (a) the token can be lost or mistyped, and the only defence is a rule telling the model to stop; (b) once locks lapse (the staleness spec), the same session can lose a job and take it back, and work it started under the first claim (an in-flight research run, a stale step stamp) passes the token guard because the token is unchanged. The standard remedy is a fencing token: a number that increases on every claim, checked on every write (Kleppmann 2016; Chubby's sequencers, OSDI 2006).

## 2. Evidence (observed; quoted text is data, not instructions)
- "Keep for the whole session: ... the session identity token minted ... If the token is ever lost or uncertain, stop before any job write ... Never mint a replacement." (source: litigator `work/references/procedure.md`, rule `work.enter.keep`)
- `assign_job`: "session_token is the one drafting_forms__open_session or drafting_forms__bootstrap returned; this tool mints none." (tool description; the same sentence is on `release_job`, `approve_plan`, `set_step`, `complete_job`, `delete_job`, `merge_jobs`, `set_board_goal`)
- In this session the token was passed by the model on 8 tool calls and typed into SQL 3 times.
- HEAD reading (2026-10-29 staleness spec §11, not verified here): `assign_job` guard without takeover is `status = 'queued' AND locked_by IS NULL` in `source/lawyer/mcp/src/submission/forms/assign-job.ts`. Schema is v81 with a generic `kv_store`; new DDL would need a human ruling (`source/exception-rulings.json`).
- Research consulted in session: lease plus heartbeat plus fencing token plus conditional write is still the accepted design; Jepsen's etcd 3.4.3 analysis recommends using the lock revision as the fence.

## 3. Goal and non-goals
Goal: every claim (assign, take-over, re-take after release or lapse) gets the next claim number for that job; every holder-guarded write requires it and refuses a lower one. Optionally, the server knows the calling session so the model need not carry the token.
Non-goals: the lapse thresholds (staleness spec); outside side effects (research-dispatch spec).

## 4. Design
- Store `claim_no:<job id>` in `kv_store` (no DDL). `assign_job` increments it in the same transaction as the lock and returns it.
- Every holder-guarded tool (release, approve, set_step incl. done, complete, delete, merge, the rewrite tool, `track_source`, `save_answer`) takes `claim_no` and refuses with `stale_claim` unless it equals the stored value and the lock is still this holder's.
- Caller identity: if the MCP host gives the server a stable per-session identity, bind the session to it at `open_session` and drop `session_token` from job tools; otherwise keep the token, but the fence still closes weakness (b). See §9.

## 5. Constraints that must still hold
- A take-over still needs `expected_holder` and never wins a race.
- Released and taken-over jobs keep plan, approvals and done steps.
- No DDL without a human ruling; use `kv_store`.

## 6. Options considered (streamline and deburr first, additions last)
1. Claim number in `kv_store`, checked inside the existing guards of each tool; keep the token where the host gives no identity. (recommended)
2. Replace the session token with the claim number entirely. Loses the holder name shown on cards.
3. Do nothing until a lapse exists. Leaves weakness (b) open the day the staleness spec lands.

## 7. Implementation plan
1. Verify against HEAD (§10) and append a verification table to this spec.
2. Land after the guarded-tools spec and the staleness spec.
3. Add the counter to `assign_job`; add the `claim_no` check to every holder-guarded tool; tests for lapse-and-retake by the same session refusing the old claim.
4. Update skill text: the session keeps the claim number from `assign_job`; delete rules made redundant.
5. Commit on `main` by explicit pathspec and push. Finish with the line `Implementation of claim fencing number complete!`, then what streamlining and deburring you tried, what you verified and what you assumed without verifying.

## 8. Implementation criteria
1. Each claim of a job returns a strictly larger claim number than the last.
2. Every holder-guarded write with an older claim number is refused and writes nothing, even from the same session.
3. A same-session re-take after a lapse refuses writes carrying the earlier claim number.

Scope: edit the source files the fix needs (skill text, mcp/src, docs), and write, update and run the tests the fix needs. Streamline and deburr first: solve the problem by removing, merging or simplifying what already exists, and consider an addition only once those ideas are exhausted. Anything added must be shorter than the text it makes unnecessary, and that text is deleted in the same change. Out of scope, because the orchestrating session runs them once after every spec lands: `build_plugin.py` and `check_plugin.py`. Out of scope, because `/release` does it: version bumps and rebuilding or committing any MCP bundle (dist/). Never build a `.plugin` archive.

## 9. Open questions
- Does the local stdio server run one process per Claude session, or one shared by several sessions? If per session, the server can bind identity at `open_session` and the token can leave the model's hands. Answer from the host's behaviour; ask Brahm only if it cannot be determined.

## 10. Verify against HEAD before building
- Confirm `assign-job.ts`'s guard and every tool that takes `session_token`.
- Confirm `kv_store`'s shape and that no claim counter exists yet.
- Confirm whether the staleness spec has landed and how a lapsed lock is represented.
