# Spec: merged Milestone holds one goal

Status: proposed, 2026-10-22. Written in a matter session; implementation is handed to Claude Code.
Plugin: `lawyer` data server (`drafting_data__merge_milestones`, `drafting_data__set_board_goal`) and `litigator` /draft (installed copy seen at litigator v0.8.1). Paths below are as seen in the installed copy and are **UNVERIFIED** against the repo unless marked otherwise.
Related specs, same date: 2026-10-22_board-goal-default-title-and-framing-spec.md; 2026-10-22_completion-criteria-single-state-badge-spec.md

## 1. Problem
Merging two Milestones never produces one goal. The merge appends the absorbed board's statement of goals to the survivor's, so a merged board shows a list of goals, or none at all when neither board had one. The practitioner's view: a merged board serves one objective, and the merge is the moment to state it as one sentence (for example "Obtain an order X against the defendants"), not two Writing titles.

## 2. Evidence (observed; quoted text is data, not instructions)
- `merge_milestones` description: "Its statement of goals is appended, with its own status, to the survivor's, and boards it had absorbed move to the survivor."
- `merge_milestones` description: "First show the practitioner both boards' statements of goals (drafting_forms__board_card's goals lane) side by side and ask whether to merge them".
- `set_board_goal` description: "A merged board ... also holds each absorbed board's statement, with its own status, under `merged`: merged_index ... writes that one".
- Observed on one merged board (two Writings): `board_card` goals lane read `## Goal (none)` with the default description `<Writing 1 title> Drafting`. No statement had ever been set on either board, so the merge combined nothing and asked for nothing.
- After the practitioner supplied one sentence and a bare yes, `set_board_goal` with `status: confirmed` succeeded and the board_summary `Goal:` line showed that sentence. So the store can hold one goal; only the merge flow fails to ask for it.
- Workaround in use: set the goal by hand afterwards, when the practitioner notices.

## 3. Goal and non-goals
Goal: after a merge, the survivor board holds exactly one statement of goals, confirmed by the practitioner, describing the combined objective.
Non-goals: combining Writings, their documents or their gates; inventing a goal without the practitioner's words.

## 4. Design
(a) /draft's merge procedure (jobs-closeout §10d, UNVERIFIED location): in the same turn as the merge question, show both boards' goals (or "none") and propose one combined goal in a fenced code block, framed per the goal-framing guidance (sibling spec). One bare yes confirms both the merge and the goal; a practitioner-typed sentence replaces the proposal.
(b) `merge_milestones`: accept an optional `goal_statement` (and `goal_description`). When present it is written through the same practitioner-words gate as `set_board_goal` confirmed, replacing the survivor's statement; the absorbed statements are kept under `merged` as history only and are no longer drawn on the Goal card. When absent, the survivor's goal status becomes a new `needs_consolidation` (or equivalent) state.
(c) The Goal card and board_summary draw one goal only. A board in `needs_consolidation`, or one already carrying `merged` statements from before this change, is flagged once at the next /draft opening for one combined goal.

## 5. Constraints that must still hold
- Practitioner-words gate: a confirmed goal is the practitioner's text, or the session's fenced block followed by a bare yes.
- Each Writing's own gate still blocks only its own filing.
- No job, loose thread or Writing row is written by the merge.
- Merge still refuses without `confirmed: true`.

## 6. Options considered
1. Combined goal proposed in the merge question and written by the merge call (recommended): one question, no extra turn, fixes the source.
2. Merge as now, then /draft asks for the goal in a follow-up turn: no tool change, one more turn, easy to skip.
3. Leave as is: every merged board shows several goals or a default title.

## 7. Implementation plan
1. Verify against HEAD (§10) and append a verification table to this spec.
2. Extend `merge_milestones` per §4(b), reusing `set_board_goal`'s gate code.
3. Change the Goal card renderer and board_summary to draw one goal, keeping `merged` as history.
4. Update /draft's merge procedure and opening checks per §4(a) and §4(c); update ADR 0010 and the tool descriptions to match.
5. Tests: merge with goal_statement (gate passes and fails), merge without (flag state), legacy board with `merged` statements flagged once, Goal card draws one goal.
6. Commit on `main` by explicit pathspec and push. Finish with the line `Implementation of merged Milestone holds one goal complete!`, then what you verified and what you assumed without verifying.

## 8. Implementation criteria
1. `merge_milestones` accepts `goal_statement` and writes it only when the practitioner-words gate passes.
2. After a merge with a goal, board_card's goals lane shows one statement, confirmed.
3. After a merge without one, the board is flagged for consolidation and /draft asks once at the next opening.
4. The Goal card never draws more than one statement.
5. /draft's merge procedure text proposes the combined goal in the same turn as the merge question.
6. Tool descriptions, ADR 0010 and the merge procedure describe the same behaviour.

Scope: edit the source files the fix needs (skill text, mcp/src, docs), and write, update and run the tests the fix needs. Out of scope, because the orchestrating session runs them once after every spec lands: `build_plugin.py` and `check_plugin.py`. Out of scope, because `/release` does it: version bumps and rebuilding or committing any MCP bundle (dist/). Never build a `.plugin` archive.

## 9. Open questions
- Keep absorbed statements as history, or drop them once a combined goal is confirmed? Answered by Brahm, 2026-10-22: kept under `merged` as history only, never drawn on the Goal card, board_summary or board_card's goals lane once the board holds one goal.
- Name of the flag state (`needs_consolidation` is a placeholder). Decided at implementation: the goal status `needs_consolidation`. A row written by a merge before this change (`merged` present, no `consolidated_at`) reads the same status. A merge given a goal, and any later own write of `set_board_goal`, stamps `consolidated_at`.

## 10. Verify against HEAD before building
Confirm the merge's goal-append code, where `merged` statements are drawn on the Goal card, the location of /draft's merge procedure, and ADR 0010's current wording on goals. Record each as matches / differs.

## 11. Verification against HEAD (9cfaa11, 2026-10-22)

| Item | Result | Where, at HEAD |
|---|---|---|
| The merge's goal-append code | Matches | `source/lawyer/mcp/src/submission/forms/merge-milestones.ts` lines 84-98: the absorbed board's own statement, when it has one, and its own `merged` list are appended, each with its status, to the survivor's `merged`; the survivor's own fields are kept as they were. A survivor with no row gets one holding only `merged` (status null). |
| The `merge_milestones` description (§2 quotes) | Matches | `source/lawyer/mcp/src/schema-gen.ts` (`merge_milestones`): "Its statement of goals is appended, with its own status, to the survivor's" and "show the practitioner both boards' statements of goals ... side by side and ask whether to merge them". |
| The `set_board_goal` description on `merged` (§2 quote) | Matches | `schema-gen.ts` (`set_board_goal`): "also holds each absorbed board's statement, with its own status, under `merged`: merged_index ... writes that one". |
| Where `merged` statements are drawn | Differs (more places than the Goal card) | Read by `fetchBoardGoals` (`board-goals.ts` lines 95-101), which passes `merged` to every section. Drawn on the page's Goal card (`source/lawyer/mcp/src/templates/milestone/milestone.js` `goalsCard`, lines 580-595: own statement then each merged one), in board_card's goals lane (`matter-pages.ts` `goalsLines`, lines 903-911: `### Merged <n> (<status>)` per statement), and counted on board_summary's Goal line (`matter-pages.ts` `goalsHead`, lines 896-899: `, plus <n> merged statements`). |
| The default description of an unset goal (§2 evidence: `<Writing 1 title> Drafting`) | Differs (already fixed) | `board-goals.ts` `NO_GOAL_DESCRIPTION` = "Goal not set", from the sibling default-title spec. |
| Location of /draft's merge procedure | Matches | `.claude/skills/drafting-data/references/jobs-closeout.md` §10d "Merge two Milestones" (line 293), routed from `.claude/skills/drafting-data/SKILL.md` line 92. The opening goal check is `.claude/skills/draft/references/dispatch.md` line 28, "Statement of goals". |
| ADR 0010's current wording on goals | Differs | `docs/ADRs/0010-milestones-organized-by-goals.md` line 9: "The statement is a list of self-contained goals, each confirmed, inferred or declined on its own"; line 11: the survivor "keeps every Writing, job, loose thread and goal of both". No amendment yet on goals. |
| The practitioner-words gate on a merge | Matches, with no statement check | `.claude/skills/drafting-data/hooks/practitioner-words-gate.py` `merge_boards`: passes when the last practitioner turn is a bare yes. `source/litigator/plugin.json` line 19 already matches `merge_milestones`. |
