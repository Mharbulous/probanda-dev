# Spec: the holder check before a research dispatch is remembered by the model; enforce it and record a repeat-safe key

Status: proposed, 2026-10-30. Written in a matter session; implementation is handed to Claude Code.
Plugin: `lawyer` (data server, build stamp 4dc36ec9c841 as seen), `litigator` (installed copy seen at v0.13.3; `/draft`), `researcher` (`/legal-research`, `research-paralegal` agent). Paths below are as seen in the installed copy and are **UNVERIFIED** against the repo unless marked otherwise.
Related specs, same date: 2026-10-30_guarded-job-progress-tools-spec.md, 2026-10-30_execute-refuses-unguarded-job-writes-spec.md, 2026-10-30_claim-fencing-number-and-caller-identity-spec.md, 2026-10-30_one-call-job-take-spec.md. Earlier: 2026-10-29_job-last-activity-misses-progress-spec.md.

## 1. Problem
A research dispatch (a Westlaw or CanLII run through the shared Chrome session, a law-audit agent) is an outside side effect no database guard can stop. Today the only protection is a rule telling the model to read the lock first. A session that lost its job can still dispatch, and a retried dispatch can run twice.

## 2. Evidence (observed; quoted text is data, not instructions)
- "Lock check before each research dispatch: immediately before every `researcher:research-paralegal` dispatch and every law-audit agent spawn ... run `/drafting-data`'s lock read ... no write guard stops a dispatch." (source: litigator `draft/references/job-session.md`, `draft.execute.lock`)
- "record each one on the job with `drafting_data__track_source` ... That call is the lock check for the dispatch." (source: same file, `draft.execute.sources`)
- HEAD reading (2026-10-29 activity spec §11, not verified here): only `save_answer` takes `db_path`, `ticket_id`, `session_token`; `file_download`, `append_manifest`, `file_fetched`, `write_scratch` take none.
- Previously observed (activity spec): a research job was taken over during a 51-minute Westlaw download and taken back two minutes later.

## 3. Goal and non-goals
Goal: a dispatch cannot start without a server-issued dispatch key that is granted only to the current holder and claim, and every filing write for that dispatch carries the key, so a repeat reuses the first result and a stale holder's results are refused.
Non-goals: stopping a browser run already in flight (not possible); the claim number itself (fencing spec, a prerequisite).

## 4. Design
- Fold into `drafting_data__track_source`: it already records the source and is named as the lock check. Have it return a `dispatch_key` (stored in `kv_store`: matter, job, claim number, step, source label) only when the caller holds the job at the current claim number; refuse otherwise.
- If a key for the same job, step and source label already exists with a landed result, return that result's location instead of a new key (repeat-safe).
- `file_download`, `file_fetched`, `append_manifest` and `save_answer` take the `dispatch_key` when filing for a job and refuse a key whose claim is no longer current.
- The research-paralegal and law-audit briefs carry the key; delete the separate "lock read before dispatch" rule.

## 5. Constraints that must still hold
- The research-paralegal stays a singleton over the one Chrome session.
- Research not tied to a job (no `ticket_id`) still files without a key.
- A refused filing reports plainly; nothing is silently dropped.

## 6. Options considered (streamline and deburr first, additions last)
1. Make `track_source` issue the key; filing tools check it; delete the remembered lock-read rule. (recommended)
2. A new `begin_dispatch` tool. Duplicates `track_source`.
3. Keep the rule, add a hook. Still model-dependent.

## 7. Implementation plan
1. Verify against HEAD (§10) and append a verification table to this spec.
2. Land after the fencing spec.
3. Extend `track_source` and the filing tools; tests for holder, stale claim, repeat request returning the first result.
4. Update the research briefs and delete `draft.execute.lock` and any duplicate in researcher skill text.
5. Commit on `main` by explicit pathspec and push. Finish with the line `Implementation of research dispatch key complete!`, then what streamlining and deburring you tried, what you verified and what you assumed without verifying.

## 8. Implementation criteria
1. A non-holder or stale-claim caller cannot obtain a dispatch key.
2. A filing write for a job with a stale or missing key is refused and writes nothing.
3. A repeated request for the same job, step and source returns the existing result instead of a new dispatch.
4. No skill text still asks the model to remember a lock read before dispatch.

Scope: edit the source files the fix needs (skill text, mcp/src, docs), and write, update and run the tests the fix needs. Streamline and deburr first: solve the problem by removing, merging or simplifying what already exists, and consider an addition only once those ideas are exhausted. Anything added must be shorter than the text it makes unnecessary, and that text is deleted in the same change. Out of scope, because the orchestrating session runs them once after every spec lands: `build_plugin.py` and `check_plugin.py`. Out of scope, because `/release` does it: version bumps and rebuilding or committing any MCP bundle (dist/). Never build a `.plugin` archive.

## 9. Open questions
- none

## 10. Verify against HEAD before building
- Confirm `track_source`'s current guard and return shape, and the filing tools' parameters.
- Confirm where `draft.execute.lock` and its researcher-side duplicates live.
