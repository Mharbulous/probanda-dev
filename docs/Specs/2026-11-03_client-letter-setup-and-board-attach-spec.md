# Spec: client-letter session setup: create drafting records and attach to a Work Board

Status: proposed, 2026-11-03. Written in a matter session; implementation is handed to Claude Code.
Superseded for client letters, 2026-11-09: a client letter is a Writing, by `docs/ADRs/0019-a-client-letter-is-a-writing.md`.
Plugin: `litigator` (installed copy seen at v0.16.1; `/draft`, `/work`, `/drafting-data`). Paths below are as seen in the installed copy and are **UNVERIFIED** against the repo unless marked otherwise.
Related specs, same date: `2026-11-03_client-letter-word-on-letterhead-spec.md`, `2026-11-03_record-client-bill-and-letter-sent-spec.md` (its sent act relies on the board attachment), `2026-11-03_client-disclosure-standard-paragraph-spec.md`, `2026-11-03_matter-mail-coverage-for-fact-checks-spec.md`, `2026-11-03_helpers-read-matter-folder-spec.md`.

## 1. Problem

Two setup gaps on a matter with no drafting history. First, session entry refused because the matter had no drafting records, and the session had to find the remedy in `/work`'s rules and run a migration from schema 0 to 81 before entering. Second, `letters.md` §10 requires a client letter to be attached to a Work Board before its first draft is shown, creating a forum-less proceeding when the matter has none; the session skipped this (agent non-compliance), so the letter is on no board and the sent act the related spec designs has nothing to attach to.

## 2. Evidence (observed; quoted text is data, not instructions)

- Session entry error: `{"code": "data_error", "message": "No drafting records found at <MATTER_ROOT>\\0. CASE DATA\\submission.sqlite. Set the matter's drafting records up first."}` (tool `drafting_forms__open_session`).
- Remedy found in `/work` `enter` rules: "No database at the derived path: run `drafting_data__migrate` on the path named, then call session entry again." (source: `litigator/skills/work/references/procedure.md`, served by `skill_rules__applicable`).
- Migration applied 81 steps (0 to 81) in one call; session entry then succeeded with `filings: []`, `pre_filing_proceedings: []`, `milestone_paths: []`.
- `letters.md` §10: "When the file is first written, attach it to one Work Board through `/drafting-data`'s attach write, before presenting the first draft. ... A matter with no proceeding gets a forum-less proceeding first, through `/drafting-data`." (source: `litigator/skills/draft/references/letters.md`)
- What happened: the review draft was presented with no attach write and no proceeding created; 0 boards hold the letter.
- Cost: 3 extra calls for setup (failed entry, rules lookup, migrate); attach step: 0 of 2 calls made.

## 3. Goal and non-goals

Goal: session entry on a matter with no drafting records sets them up itself, and a client letter's first save attaches it to a board in one call, creating the forum-less proceeding when needed, so the step is not skipped.

Non-goals: putting client-letter text in the database (ADR 0004); the sent act (related spec).

## 4. Design

1. `drafting_forms__open_session` migrates a missing database instead of refusing (it already migrates one that is behind), reporting it as `migrated {from: 0, to: N}`. Delete the refusal bullet from `/work`'s entry rules.
2. One attach call for a client letter that, when the matter has no proceeding, creates the forum-less proceeding and attaches the file in the same transaction, returning the board page to present. `letters.md` §10's two-step instruction collapses to one sentence.
3. The client-letter route's first save is gated on that call's success, so the draft is not presented unattached.

## 5. Constraints that must still hold

- Session entry stays the only entry; no raw path resolution in skills.
- ADR 0004 and 0042: the board holds the file pointer only.
- Migration keeps its copy-aside backup.

## 6. Options considered, streamline and deburr first, additions last

1. **Recommended.** Let session entry create a missing database, and fold "create forum-less proceeding if none" into the attach write. Both remove instructions from skill text.
2. Keep the refusal and make the rule text more prominent. Does not prevent the skip.
3. Attach lazily at send time. Leaves the draft invisible on the board while it is being reviewed.

## 7. Implementation plan

1. Verify against HEAD (§10) and append a verification table to this spec.
2. Change session entry to migrate a missing database, with a test on an empty matter folder fixture.
3. Extend the client-letter attach write to create a forum-less proceeding when none exists, with a test.
4. Edit `/work`'s entry refusals and `letters.md` §10; delete the instructions made unnecessary.
5. Commit on `main` by explicit pathspec and push. Finish with the line `Implementation of client-letter session setup: create drafting records and attach to a Work Board complete!`, then what streamlining and deburring you tried, what you verified and what you assumed without verifying.

## 8. Implementation criteria

1. Session entry on a matter folder with no drafting database succeeds and reports the migration.
2. `/work`'s entry refusals no longer list "No database at the derived path".
3. One attach call on a matter with no proceeding creates the proceeding and attaches the file.
4. `letters.md` §10 makes presenting a client letter's first draft depend on the attach call's success.
5. No client-letter text, title or status is written to the database.

Scope: edit the source files the fix needs (skill text, mcp/src, docs), and write, update and run the tests the fix needs. Streamline and deburr first: solve the problem by removing, merging or simplifying what already exists, and consider an addition only once those ideas are exhausted. Anything added must be shorter than the text it makes unnecessary, and that text is deleted in the same change. Out of scope, because the orchestrating session runs them once after every spec lands: `build_plugin.py` and `check_plugin.py`. Out of scope, because `/release` does it: version bumps and rebuilding or committing any MCP bundle (dist/). Never build a `.plugin` archive.

## 9. Open questions

1. Is there a reason (design note or ADR) session entry refuses a missing database rather than creating it?
2. When the matter has proceedings but several boards, should the attach call still ask which board?

## 10. Verify against HEAD before building

- `drafting_forms__open_session`'s missing-database path and `drafting_data__migrate`.
- `/drafting-data`'s attach write in `filing-checklists.md` §14 and whether a legacy-store freeze bars changes to it (see the record-client-bill-and-letter-sent spec's §11).
- `/work` `references/procedure.md` entry refusals.

## 11. Verified against HEAD (72d549c5, 2026-11-03)

| Claim | Finding | Evidence |
|---|---|---|
| `open_session` refuses a missing database | Confirmed. The refusal sits in bootstrap, which `open_session` calls | `source/lawyer/mcp/src/submission/forms/bootstrap.ts:103-105` |
| It already migrates a database that is behind | Confirmed, decided in CoClerk #590, built in b7bf98b8 there. `drafting_forms__bootstrap` stays a pure gate, and keeps its refusal | `source/lawyer/mcp/src/submission/open-session.ts` header and `behind` block |
| `drafting_data__migrate` creates a database and keeps the copy-aside | Confirmed. A fresh create backs up nothing, because there is nothing to protect (#353). The engine does not create folders | `.claude/skills/drafting-data/references/scripts/migrate_engine.py:423-478` |
| §9.1: a stated reason for the refusal | None found. The tool description and the contract only allocate the job ("creating one stays `migrate`'s job"). The reason in bootstrap's comment concerns upgrading live client data, and #590 decided it the other way for `open_session`. The nearest guard, a9cb0a41, refuses a pointer from another device, and it stays: `resolveDbPath` runs first | ADRs in both repositories, `git log -S` in both, b7bf98b8 and a9cb0a41 messages |
| Attach write in `filing-checklists.md` §14 | Confirmed: raw SQL through `drafting_data__execute`, with a separate forum-less `proceedings` insert | §14 before this change |
| A legacy-store freeze bars changes | No freeze on tools over existing tables. The Exception in COMMANDMENTS.md bars more reliance on the store, so the tool adds no DDL and no migration | `git diff` holds no change to `migrations.sql` |
| `/work` refusal bullet | Confirmed at line 22, deleted | `.claude/skills/work/references/procedure.md` |
| ADR 0004 and ADR 0042 | Both are in CoClerk's `docs/adr`, not here. ADR 0042 D2 confirms the pointer holds the board and path only | `Coclerk/docs/adr/0042-every-draft-document-is-on-one-job-board.md` |
| 0-to-latest time on an empty fixture | 5.0 to 5.6 s over 5 runs (81 hops, through `submissionDataMigrate`, this PC), under the Cowork bridge's 60 s limit | Measured 2026-11-03 |

§9.2 decided: no board and no proceeding creates one, one board attaches there, several boards refuse and name them. The tool takes `kind`, so a reply and another party's filing use it too and §14's raw attach write is gone.
