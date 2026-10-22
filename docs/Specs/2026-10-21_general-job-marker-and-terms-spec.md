# Spec: General Job marker and terms

Status: proposed, 2026-10-21. Written in a matter session; implementation is handed to Claude Code.
Plugin: `lawyer` (data server; installed copy seen at v0.5.6) and `litigator` (installed copy seen at v0.7.6). Paths below are as seen in the installed copy and are **UNVERIFIED** against the repo unless marked otherwise.
Related specs, same date: 2026-10-21_merged-job-board-one-board-spec.md

## 1. Problem
A job with no Writing (`tickets.filing_id` NULL) is drawn on every Writing's board in its proceeding with nothing marking it as shared. On a second board the practitioner read it as a duplicate. The concept also had no name they recognized. The practitioner approved these terms: **Writing Job** (tied to one Writing) and **General Job** (tied to no Writing: shared-substance work done once for every Writing).

## 2. Evidence (observed; quoted text is data, not instructions)
- board_card on two boards of one proceeding listed the same 27 jobs with no Writing (1 Ready, 1 Superseded, 25 Completed) in both, with identical lines and no tag.
- The Loose Threads count was identical on both boards (proceeding-wide), also untagged.
- Current wording: "A job with no filing is on every filing's page in its proceeding" (shared/html-pages.md); "Proceeding scope (`filing_id` NULL)" (jobs-closeout.md §10c).
- Practitioner, in session: "I've never heard of those, have I?" They then agreed: "Writing Job/General Job".

## 3. Goal and non-goals
Goal: every General Job card and board_card line is marked General, and skill text uses the two terms. Non-goals: changing when a job gets `filing_id` NULL; the merged-page layout (Spec A).

## 4. Design
- On the page, a General Job card carries a "General" tag.
- In board_card, each General Job's line ends ` · general` in every lane.
- Add the two terms to the glossary and skill text (drafting-data SKILL.md, references/jobs-*.md, shared/html-pages.md, /draft text that names these jobs), keeping "job with no Writing" as the defined synonym.

## 5. Constraints that must still hold
- No schema change.
- board_card's other fixed-grammar fields keep their order, and the tag is appended.
- Writing Jobs are unmarked.

## 6. Options considered
1. Tag plus terms (recommended): cheap and clear.
2. Show a General Job only on the lowest-id Writing's board: hides it from the other Writing's view.
3. A separate General lane: duplicates the lane set.

## 7. Implementation plan
1. Verify against HEAD (§10) and append a verification table to this spec.
2. Add the tag to the page card renderer and the board_card line grammar, and update the tool description.
3. Adopt the terms in skill text and the glossary.
4. Add tests for the tag on General Jobs only.
5. Commit on `main` by explicit pathspec and push. Finish with the line `Implementation of General Job marker and terms complete!`, then what you verified and what you assumed without verifying.

## 8. Implementation criteria
1. board_card marks every `filing_id` NULL job ` · general`, and no other job.
2. The page card renderer adds the General tag for the same set (generator test).
3. The board_card tool description documents the tag.
4. The skill text and glossary define Writing Job and General Job.
Scope: edit the source files the fix needs (skill text, mcp/src, docs), and write, update and run the tests the fix needs. Out of scope, because the orchestrating session runs them once after every spec lands: `build_plugin.py` and `check_plugin.py`. Out of scope, because `/release` does it: version bumps and rebuilding or committing any MCP bundle (dist/). Never build a `.plugin` archive.

## 9. Open questions
- Should proceeding-wide loose threads carry a matching tag on boards with several Writings?

## 10. Verify against HEAD before building
Confirm that jobs with `filing_id` NULL still render on every Writing's board untagged, and that the quoted wording still stands. Record each as matches / differs.
