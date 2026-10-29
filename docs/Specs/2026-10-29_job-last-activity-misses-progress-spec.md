# Spec: a job's last-activity stamp misses real progress, so a working job looks idle

Status: proposed, 2026-10-29. Written in a matter session; implementation is handed to Claude Code.
Plugin: `lawyer` (data server; drafting_forms / drafting_data / research_filing tools, build stamp 4dc36ec9c841 as seen) and `litigator` (installed copy seen at v0.13.3), `researcher` (installed copy seen at v0.10.13). Paths below are as seen in the installed copy and are **UNVERIFIED** against the repo unless marked otherwise.
Related specs, same date: 2026-10-29_job-staleness-policy-and-auto-release-spec.md, 2026-10-29_take-over-form-and-idle-report-honour-staleness-spec.md

## 1. Problem
Staleness of a held job can only be judged from its last-activity stamp, and that stamp does not move on most of the work a session does on the job. A research job looked idle for 51 minutes while its holding session was running a Westlaw deep-research download into the job's 6. LAW issue folder. A second session took the job over on that reading; the first session took it back two minutes later. The practitioner needs one stamp that moves whenever the job makes any progress.

## 2. Evidence (observed; quoted text is data, not instructions)
- Tool: `drafting_forms__board_card` with `jobs`. Its description defines the stamp: "the last activity being the latest of its lock, its done steps, the loose threads captured from it, the answers saved for it and the sources to get added to it or closed on it" (source: tool description as seen).
- Timeline (local time, one research job, held by session H):
  - 12:55 H locks the job. Card: `taken: 12:55 · last activity: 12:55`.
  - 13:46 Card read by session T: `In Progress 4/7 · idle 50 min, about 57%`, step 5 (the Westlaw step) shown `☐`, no `⏳`, no `session active` stamp.
  - 13:49 A Westlaw Deep Research memo (.docx) and a `case-download-manifest.json` append land in the job's issue folder (file mtimes).
  - 13:50 Step 5 stamped done by H.
  - 13:51 T takes the job over (`drafting_data__assign_job` takeover, outcome `assigned`).
  - 13:53 H holds the lock again (`tickets.locked_by` = H's token, `locked_at` 13:53).
- Not counted as activity today (UNVERIFIED in code, inferred from the definition above): `research_filing__file_download`, `research_filing__append_manifest`, `research_filing__file_fetched`, `research_filing__write_scratch`, an agent dispatched for the job and still out, `rules__move` / skill-rule serves under the job's session token, and a turn ending in the holding session.
- The Westlaw step was not set `⏳` while the run was out, although the doctrine says "After dispatching `research-paralegal` in the background for a held job's Westlaw step, set that step ⏳ for 5 minutes" (source: researcher `shared/legal-research.md`, duty 3).
- The take-over form refers to "its `session active` stamp when the card has one" (source: litigator `work/references/take-over.md`); the card read at 13:46 had none.
- Workaround in use: none reliable; T listed the 6. LAW folder's newest file mtimes by hand after the fact.

## 3. Goal and non-goals
Goal: one per-job activity stamp, read off the card and the board's `idle` tag, that moves on every write any tool makes for the job and on every turn its holding session ends, so "minutes since last activity" is true.
Non-goals: the staleness thresholds and what happens at them (sibling spec on staleness policy); the take-over form's wording (sibling spec on the form).

## 4. Design
- One column or derived value, e.g. `tickets.last_activity_at` (UNVERIFIED name), bumped by a single helper in the data server.
- Every tool that already accepts `db_path` + `ticket_id` + `session_token` (or `session_token` alone, resolved to the job it holds) calls that helper after a successful write: step writes, `save_answer`, sources to get, loose-thread capture, and the research_filing writes (`file_download`, `file_fetched`, `append_manifest`, `write_scratch`) once they take the job identity.
- The holding session's turn-end heartbeat (the existing `session active` stamp, if it exists, UNVERIFIED) also bumps it, so a session waiting on the practitioner is visibly alive.
- A `⏳` step counts as activity until its `wait_until` passes.
- `board_card`'s `last activity` and the `idle` tag read this one value; the hand-written "latest of ..." list in the description is deleted.

## 5. Constraints that must still hold
- No write is recorded against a job whose lock is not the caller's (the same guard `save_answer` uses: `recorded: false`).
- The stamp is never a deadline and never shown as a countdown.
- No new practitioner prompt.
- Revisions do not move on an activity bump.

## 6. Options considered (streamline and deburr first, additions last)
1. Replace the derived "latest of" computation with one stored stamp bumped by one helper called from every job-scoped write, and pass the job identity to the research_filing writes. (recommended)
2. Keep the derived computation and add the folder's newest mtime to it. Cheap, but couples the card to the filesystem and misses non-file progress.
3. Rely on agents setting `⏳` on every long step. Already required and was not done; fragile.

## 7. Implementation plan
1. Verify against HEAD (§10) and append a verification table to this spec.
2. Find where `last activity` and the `idle` tag are computed, and every job-scoped write tool.
3. Add the stamp (migration) and the helper; call it from each write; derive `idle` from it.
4. Give the research_filing write tools optional `db_path`/`ticket_id`/`session_token` and have the research-paralegal, citation-checker and legislation-fetcher briefs pass them (researcher playbooks).
5. Tests: each write bumps the stamp; a write by a non-holder does not.
6. Commit on `main` by explicit pathspec and push. Finish with the line `Implementation of job last-activity stamp complete!`, then what streamlining and deburring you tried, what you verified and what you assumed without verifying.

## 8. Implementation criteria
1. `board_card`'s `last activity` and the `idle` tag read one stored stamp.
2. Each of: step set/done, save_answer, source to get, loose thread, file_download, file_fetched, append_manifest, write_scratch (with job identity), and the holding session's turn end, moves that stamp.
3. A write whose caller does not hold the job's lock moves nothing.
4. The tool description's hand-written list of what counts is removed.

Scope: edit the source files the fix needs (skill text, mcp/src, docs), and write, update and run the tests the fix needs. Streamline and deburr first: solve the problem by removing, merging or simplifying what already exists, and consider an addition only once those ideas are exhausted. Anything added must be shorter than the text it makes unnecessary, and that text is deleted in the same change. Out of scope, because the orchestrating session runs them once after every spec lands: `build_plugin.py` and `check_plugin.py`. Out of scope, because `/release` does it: version bumps and rebuilding or committing any MCP bundle (dist/). Never build a `.plugin` archive.

## 9. Open questions
- Does a turn-end heartbeat exist today (the take-over form's `session active` stamp)? If not, is a hook the right place to write it?

## 10. Verify against HEAD before building
- Confirm the `last activity` derivation and the `session active` stamp in source.
- Confirm which research_filing tools already take job identity (`save_answer` does).
- Confirm the schema version (v79 seen) and the next migration number.

## 11. Verification against HEAD (0cc82b51, 2026-10-29)

| Check | Spec's reading | Found at HEAD |
|---|---|---|
| `last activity` derivation | latest of lock, done steps, loose threads, answers, sources | Confirmed. `source/lawyer/mcp/src/submission/forms/build-proceeding-board.ts` computes `last_activity_at` with `latestStamp([...])` over exactly those five. The idle tag (`board-job-text.ts` `idleTag`) and the idle flag (`ticket-category.ts` `withIdleFlag`) both read it. The hand-written list is in `src/schema/submission-forms.ts` (board_card), `work-board-ticket.ts` and `board-job-text.ts`. |
| `session active` stamp (§9) | UNVERIFIED | Exists, no hook. One `db_meta` row per job, `job_active:<id>`, written by the holding session in raw SQL as the last write of every turn that worked the job (`.claude/skills/drafting-data/references/jobs-run.md` §6a). Read in `build-proceeding-board.ts`, printed as `session active:` on the card. Defined there as "not progress": it never moves last activity. So the turn-end heartbeat needs no new hook. |
| Step done and loose-thread writes | tool writes | Raw SQL through `drafting_data__execute` (jobs-run.md §6 and §8). Step status (`set_step`), sources (`track_source`), the lock (`assign_job`) and answers (`save_answer`) are server tools. |
| research_filing job identity | `save_answer` takes it | Confirmed: only `save_answer` takes `db_path`, `ticket_id`, `session_token`. `file_download`, `append_manifest`, `file_fetched` and `write_scratch` take none. |
| ⏳ step | counts as activity | Not today: the idle tag ignores `wait_until`. |
| Schema version | v79 seen | `TARGET_SCHEMA_VERSION` is 81 (`.claude/skills/drafting-data/references/scripts/migrate_engine.py`). Hop 79 -> 80 added the generic `kv_store` table so that a new attribute of a row needs no further DDL, under a ruling in `source/exception-rulings.json`; new DDL in this legacy store would need a new human ruling. So the stamp is a `kv_store` value and needs no migration. |
| Paths | `plugins/...` | Skill text is under `.claude/skills/`; the data server under `source/lawyer/mcp/src/`. |
