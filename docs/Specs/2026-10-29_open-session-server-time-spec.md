# Spec: session entry spends ~3.8 s on work the Milestone card does not need

Status: proposed, 2026-10-29. Written in a matter session; implementation is handed to Claude Code.
Plugin: `lawyer` (installed copy seen at v0.16.0; data server, build stamp 4dc36ec9c841 as seen) and `litigator` (installed copy seen at v0.13.3; `work/references/procedure.md`). Paths below are as seen in the installed copy and bundle and are **UNVERIFIED** against the repo unless marked otherwise.
Related specs, same date: 2026-10-29_milestone-card-first-opening-order-spec.md, 2026-10-29_open-session-recency-tie-break-spec.md, 2026-10-29_open-session-matter-root-from-project-spec.md

## 1. Problem
`drafting_forms__open_session` sits on the path to the Milestone card. It took 3.8 s, of which most is duplicated work or pages not shown at the opening, and it can run a 30 s folder-hashing check that is only a notice.

## 2. Evidence (observed; quoted text is data, not instructions)
- Returned timings (ms): matter_lookup 248.5, todos 197.9, dates 203.8; bootstrap parties_drift 261.9; open: parties_drift 242.9, matter_pages 1763.7, open total 2378.9; parties_drift again 275.2; counsel_offers 7, form_currency 15.8, court_file_affidavits 7.1, ingest_coverage 0.1 (skipped: "the opened filing declares no ingest inputs"), background_job 59.9; total 3796.2.
- matter_pages writes 6 Milestone pages, Litigation Strategy and ~30 view pages in one go: `buildMatterPages` l.108377, `writeMatterPages` l.108925 (verified present), which already accepts an `only` filter (UNVERIFIED); the background job's `settle: () => pages()` (l.111965, verified present) rewrites all pages anyway.
- parties_drift spawns a Python driver three times per open: `readPartiesOfRecord` l.94898 (verified present) -> runPythonDriver.
- matter_lookup, todos and dates each call `PracticeStore.snapshot()` (l.75923, verified present), which dumps and parses the whole store.
- `openedIngestCoverage` l.113338 (verified present) runs a folder-hashing driver with a 30 s budget when the opened filing has a Ready job and a folder map. procedure.md:67 calls coverage at entry "a notice, never a gate. The gate is the claim (`references/job-session.md`, \"The input check\")".
- View pages are never presented at the fast open: procedure.md response table, "Present none at the fast open".

## 3. Goal and non-goals
Goal: open_session returns in about 1.5-2 s, with every Milestone page written at the current revision.
Non-goals: model turns (opening-order spec); recency (tie-break spec).

## 4. Design
- Compute parties drift once per call and pass it to the render and the response.
- Take one PracticeStore snapshot per call for matter lookup, to-dos and dates.
- Remove ingest_coverage from open_session and its response; the input check at claim time stays. Delete the procedure.md rows and clause that report it at entry.
- At entry write all Milestone pages and Litigation Strategy only (`only` filter); leave view pages to the background job's settle.

## 5. Constraints that must still hold
- Every Milestone page is written at the current revision before open_session returns (the opening-order spec stages named Milestones from `milestone_paths`).
- parties_drift and counsel_offers content in the response is unchanged.
- The claim-time input check still runs before any job with ingest inputs is assigned.
- A view page asked for after the opening is current (wait for or run the settle if needed).

## 6. Options considered (streamline and deburr first, additions last)
1. Dedupe drift and snapshot, delete entry-time coverage, defer view pages to the existing settle. (recommended)
2. Write only the opened Milestone page: faster, but breaks staging a named Milestone without a server-side title match (an addition).
3. Cache drift across calls: an addition with staleness risk.

## 7. Implementation plan
1. Verify against HEAD (§10) and append a verification table to this spec.
2. Edit open_session / bootstrap / openBoard in mcp/src per §4; edit work/references/procedure.md to delete the entry-time coverage reporting.
3. Tests: drift driver spawned once per open; one snapshot; no coverage field; Milestone pages written, view pages written by settle.
4. Commit on `main` by explicit pathspec and push. Finish with the line `Implementation of open_session server time complete!`, then what streamlining and deburring you tried, what you verified and what you assumed without verifying.

## 8. Implementation criteria
1. One parties-of-record driver spawn per open_session call.
2. One PracticeStore snapshot per open_session call.
3. open_session never runs the ingest coverage driver; procedure.md has no entry-time coverage reporting.
4. View pages are not in the entry-time write; every Milestone page is.
5. Existing open_session tests pass with the response's other fields unchanged.

Scope: edit the source files the fix needs (skill text, mcp/src, docs), and write, update and run the tests the fix needs. Streamline and deburr first: solve the problem by removing, merging or simplifying what already exists, and consider an addition only once those ideas are exhausted. Anything added must be shorter than the text it makes unnecessary, and that text is deleted in the same change. Out of scope, because the orchestrating session runs them once after every spec lands: `build_plugin.py` and `check_plugin.py`. Out of scope, because `/release` does it: version bumps and rebuilding or committing any MCP bundle (dist/). Never build a `.plugin` archive.

## 9. Open questions
- none

## 10. Verify against HEAD before building
- Locate the mcp/src sources of the bundle functions above; confirm the triple drift and triple snapshot.
- Confirm writeMatterPages's `only` filter and that settle rewrites view pages.

## 11. Verification against HEAD (2026-10-29, at 0cc82b51)

| Claim | Source at HEAD | Finding |
|---|---|---|
| `buildMatterPages` / `writeMatterPages` | `source/lawyer/mcp/src/submission/matter-pages-build.ts` `buildMatterPages`; `matter-pages.ts:71` `writeMatterPages` | Confirmed. One call builds the Litigation Strategy, Loose Threads, every Milestone page and every view page. |
| `writeMatterPages` has an `only` filter | `matter-pages.ts:80`, `matter-pages-build.ts:97` | Partly. `only` names one filing and builds that filing's Milestone page and its view pages. No filter leaves out view pages while keeping every Milestone page, so §4's entry write needs a small option for it. |
| The background job's settle rewrites view pages | `forms/bootstrap-job.ts:59` `settle: () => pages()`; `render-job.ts:280` | Partly. Settle writes every page, view pages included, but runs only when the job rendered at least one filing. An empty or all-fresh queue never settles, so deferred view pages would never be written. The job must settle whenever entry deferred them. |
| parties_drift spawns the driver three times | `case/parties-of-record.ts:59` `readPartiesOfRecord`, reached through `parties-drift.ts:93` `draftingParties` | More than three. Per open with one proceeding and a drafting Writing: bootstrap's `rankFilings` (`forms/rank-filings.ts:57`), the opening render's `partiesFor` (`forms/render.ts:165`), that render's page write, whose `buildMatterPages` runs `rankFilings` again because only `section` is reused (not in the timings: it passes `[]`), and open_session's `matterPartiesDrift` (`open-session.ts:422`). `counselOffers` adds one per proceeding whose rows still hold values (below v43), and a migrate adds a second bootstrap. |
| matter_lookup, todos and dates each take a snapshot | `practice/store.ts:99` `snapshot()`; `tools/practice/reads.ts:44` `matter_lookup`, `:204` `open_tasks`, `:240` `active_deadlines`, each `store.items()` | Confirmed: three snapshots per open. |
| `openedIngestCoverage` runs the folder-hashing driver | `open-session.ts:246`, `case/ingest-coverage.ts` `readIngestCoverage` | Confirmed. Its only caller is open_session, so removing the entry check leaves `case/ingest-coverage.ts` orphaned. The claim-time input check (`work/references/job-session.md`) asks `/matter-data` itself and only reads session entry's result as a shortcut. |
| procedure.md reports coverage at entry | `.claude/skills/work/references/procedure.md:44` (response row), `:67` (closing-line clause), `:88` (opening.md trigger) | Confirmed. `opening.md`'s "The ingest-coverage clause" and `job-session.md:40` also read the entry-time field. |
