# Spec: Merged Milestone draws one board

Status: proposed, 2026-10-21. Written in a matter session; implementation is handed to Claude Code.
Plugin: `lawyer` (data server; installed copy seen at v0.5.6) and `litigator` (drafting-data skill; installed copy seen at v0.7.6). Paths below are as seen in the installed copy and are **UNVERIFIED** against the repo unless marked otherwise.
Related specs, same date: 2026-10-21_general-job-marker-and-terms-spec.md

## 1. Problem
Two Milestones of one proceeding (survivor S, absorbed A, both live drafting Writings) were merged with drafting_data__merge_job_boards. Afterwards the practitioner saw a "badly merged" page, and the absorbed board kept its own page and section. To get one board they had to move jobs by hand, which re-attached A's Writing Jobs to S's Writing. The practitioner wants each Writing Job to keep its Writing.

## 2. Evidence (observed; quoted text is data, not instructions)
- db_meta holds `board_member:filing:<A> = {"filing_id":<S>,"proceeding_id":<P>}`.
- With that row present, drafting_forms__render (filing A, draft_dir) returned Work_board path `<DRAFT>\Milestone <A>.html` with `pages_written: true`, and drafting_forms__open_session returned both `Milestone <S>.html` and `Milestone <A>.html` in job_board_paths, plus a full set of view pages for each board.
- drafting_forms__board_card on filing A answered A's own section (lanes, criteria). It did not refuse `board_merged`, and board_card on S listed only S's jobs and the jobs with no Writing.
- Conflicting specs of what a merge draws:
  - merge_job_boards tool description: "The survivor's page then draws every board's section, each with its own jobs, Completion Criteria card and Writings".
  - litigator drafting-data/references/jobs-closeout.md §10d: "the survivor's page draws both as one board, with one Completion Criteria card and one set of lanes holding both boards' jobs, each naming its Writing, and one set of view pages spans the board's Writings."
- The practitioner's definition of merged, stated in session: one page, one board, one Completion Criteria card, one row of document thumbnails, and one each of the Ready, In Progress, Bring Forward, Blocked, Completed, Shelved, Superseded, Loose Threads and Attached panels.
- Workaround used: §10c whole-board move (8 rows), a hand UPDATE of 3 completed jobs' filing_id, and 3 forced releases of other sessions' jobs. A's page still drew its own criteria card, thumbnails, 27 jobs with no Writing and the proceeding's loose threads.

## 3. Goal and non-goals
Goal: a merge makes S's page draw one board that holds both boards' content, and A gets no page or section of its own. No row is rewritten. Non-goals: moving jobs between Writings; combining Writings or their documents; splitting a merged board.

## 4. Design
- One section built from the union of member boards: every job of every member Writing, and each job with no Writing once, each card naming its Writing.
- One Completion Criteria card, listing each member Writing's criteria under that Writing's title.
- One document-thumbnail row, holding every member Writing's documents, grouped by Writing.
- One of each lane panel, plus one Loose Threads and one Attached panel, with proceeding loose threads listed once per proceeding.
- No page or view pages for A. The next page write moves A's pages to TRASH, and job_board_paths and view_page_paths omit them.
- board_card on A refuses `board_merged`, naming S. board_card and board_summary on S return the union.
- Find why the existing `board_member:` row did not stop A's page (UNVERIFIED cause), and fix it.
- Make the tool description and §10d say the same thing.

## 5. Constraints that must still hold
- Each Writing keeps its own mockup, numbering, criteria evaluation, pre-filing or pre-send gate and filed face.
- No job, loose thread, attachment or Writing row is written by a merge or a render.
- Pages are never read by sessions (shared/html-pages.md), and the job-board-card-gate hook still names the survivor's page.
- A render of A's Writing still renders its mockups.

## 6. Options considered
1. One merged section as in §4 (recommended): meets the practitioner's definition, and no data moves.
2. Stacked sections, as the tool description says: two criteria cards and two lane sets; fails the definition.
3. Have the merge move every job onto S: relabels Writing Jobs, and the practitioner rejected that.

## 7. Implementation plan
1. Verify against HEAD (§10) and append a verification table to this spec.
2. Find where the matter pages and board_card build a section, and where `board_member:` rows are read. Fix the path that ignored the row.
3. Build the merged section (union, dedupe of jobs with no Writing and of loose threads, per-Writing criteria groups, one thumbnail row).
4. Make board_card on an absorbed board refuse `board_merged`; make board_card and board_summary on the survivor return the union.
5. Stop writing absorbed pages, and trash old ones.
6. Align the merge_job_boards description, jobs-closeout.md §10d and shared/html-pages.md.
7. Add tests: two member Writings plus jobs with no Writing produce one section, one criteria card, no duplicates, and no absorbed page.
8. Commit on `main` by explicit pathspec and push. Finish with the line `Implementation of Merged Milestone draws one board complete!`, then what you verified and what you assumed without verifying.

## 8. Implementation criteria
1. With a `board_member:` row, render and open_session return no Milestone page or view page for the absorbed board.
2. board_card on the survivor lists every job of both Writings in one set of lanes, each job with no Writing exactly once.
3. board_card on the absorbed board refuses `board_merged`, naming the survivor.
4. The survivor's page has exactly one Completion Criteria card and one thumbnail row (test on generator output, not by a session).
5. No merge or render writes `tickets`, `seeds` or `board_attachments`.
6. The tool description and §10d describe the same result.
Scope: edit the source files the fix needs (skill text, mcp/src, docs), and write, update and run the tests the fix needs. Out of scope, because the orchestrating session runs them once after every spec lands: `build_plugin.py` and `check_plugin.py`. Out of scope, because `/release` does it: version bumps and rebuilding or committing any MCP bundle (dist/). Never build a `.plugin` archive.

## 9. Open questions
- Criteria card: per-Writing groups (proposed), or one flat list with Writing tags?
- The board_summary shape for a merged board.
- A merge across proceedings: which proceeding's jobs with no Writing and loose threads show, presumably both, each once.

## 10. Verify against HEAD before building
Confirm that the merge_job_boards description and §10d still conflict, that the `board_member:` row is written as quoted, and where the page writer and board_card decide a board's pages. Record each finding as matches / differs.

## 11. Verification against HEAD (80ed4de5, 2026-10-21)

Most of this spec landed before it was handed over: 7f26c0ae pooled a merged board's sections into one (`source/lawyer/mcp/src/submission/forms/combined-board.ts`), and 84f46602 aligned the tool descriptions, ADR 0010 (2026-10-21 amendment), `jobs-closeout.md` §10d and `shared/html-pages.md`. Both shipped in Lawyer 0.5.7. Only the gaps below are built.

| §10 check | Finding |
|---|---|
| merge_job_boards description and §10d conflict | differs: at HEAD both say one board, one Completion Criteria card and one set of lanes, each job naming its Writing (`schema-gen.ts` merge_job_boards, `jobs-closeout.md` §10d) |
| `board_member:` row written as quoted | matches: `board_member:filing:<A>` = `{"filing_id":<S>,"proceeding_id":<P>}` (`merge-job-boards.ts`, `board-members.ts`) |
| Where the page writer decides a board's pages | `matter-pages.ts` `pageGroups` groups every live section by `BoardIndex.survivorOf`, one page and one view-page set per survivor; every page write (render, render job, bootstrap, open_session) goes through `writeMatterPages` |
| Where board_card decides its section | `matter-pages.ts` `submissionFormsBoardCard` reads `boardSectionOf`, which pools the survivor's group for any member, the absorbed board included |
| Why the row did not stop A's page (§4) | not reproduced: the 0.5.6 bundle already grouped pages by survivor, in the same commit (70d90d4b) that added the merge tool, and HEAD's test writes no absorbed page. Assumed, unverified: the render ran on a data server process older than the merge code |

| §8 criterion | At HEAD |
|---|---|
| 1. No Milestone or view page for the absorbed board from render or open_session | already met: one writer, pages per survivor; the absorbed board's old pages go to TRASH through the sweep, and its `job_board_paths` / `view_page_paths` entries name the survivor's files |
| 2. board_card on the survivor lists both Writings' jobs in one set of lanes, each job with no Writing once | already met (`combineSections`, test "board_card and board_summary read the merged board") |
| 3. board_card on the absorbed board refuses `board_merged`, naming the survivor | gap: it returns the pooled board |
| 4. One Completion Criteria card and one thumbnail row on the survivor's page | card already met and tested; thumbnail row met (one `writings` strip, the members' Writings in order) but not tested: gap in tests only |
| 5. No merge or render writes `tickets`, `seeds` or `board_attachments` | already met in code (the merge writes `db_meta` only); asserted only for `tickets` after the merge: gap in tests only |
| 6. Tool description and §10d describe the same result | already met, except the board_card behaviour that changes with criterion 3 |

§9 first question: answered by HEAD and kept. Criteria combine by id, each text naming its Writing where they differ (ADR 0010, 2026-10-21 amendment), not per-Writing groups. board_summary on a merged board is the pooled board's summary, whichever Writing rendered.
