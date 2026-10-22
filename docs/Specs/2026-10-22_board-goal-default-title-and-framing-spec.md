# Spec: Job Board goal default title and framing

Status: proposed, 2026-10-22. Written in a matter session; implementation is handed to Claude Code.
Plugin: `lawyer` data server (`drafting_data__set_board_goal`, Goal card and board_summary) and `litigator` /draft (installed copy seen at litigator v0.8.1). Paths below are as seen in the installed copy and are **UNVERIFIED** against the repo unless marked otherwise.
Related specs, same date: 2026-10-22_merged-board-one-goal-spec.md; 2026-10-22_completion-criteria-single-state-badge-spec.md

## 1. Problem
A board with no goal set shows a step as its goal: the default title is the Writing's title followed by "Drafting". The practitioner's rule: the Goal panel title is always one goal, and a goal should usually not include "Drafting", because drafting is a step towards a goal, not the goal itself.

## 2. Evidence (observed; quoted text is data, not instructions)
- `set_board_goal` description: "description is the line the closed card shows; omitted, the stored one stays, else the board's default: `<Writing title> Drafting`, a Job Board with no Writing's own title, or `Proceeding <id>`."
- Observed board_summary line on a board with no goal: `Goal: <Writing title> Drafting (none)`.
- No /draft rule or tool check seen in session that steers goal wording towards an outcome.
- Workaround in use: practitioner supplies a goal sentence by hand.

## 3. Goal and non-goals
Goal: the Goal title never shows a drafting step by default, and goals the session proposes are framed as one outcome.
Non-goals: refusing a goal the practitioner words differently; rewriting stored confirmed goals.

## 4. Design
(a) Default description with no goal set: "Goal not set" (recommended) or the Writing's title alone, never with "Drafting" appended.
(b) /draft goal elicitation text: a goal is one outcome sentence (an order obtained, a settlement reached, a claim defended), not a document or step; propose it in that frame.
(c) `set_board_goal`: a soft warning (returned in `note`, never a refusal) when the statement or description contains "draft"/"drafting" or reads as more than one goal (e.g. joined Writing titles). The session relays the warning once; the practitioner decides.

## 5. Constraints that must still hold
- Practitioner-words gate unchanged; a confirmed goal is stored verbatim.
- The warning never blocks a write.
- No existing confirmed goal is altered.

## 6. Options considered
1. Change the default, add elicitation guidance, add a soft warning (recommended): small, fixes every unset board at once.
2. Default change only: fixes display, but proposals can still name steps.
3. Leave as is: every unset board shows a step as its goal.

## 7. Implementation plan
1. Verify against HEAD (§10) and append a verification table to this spec.
2. Change the default description in the Goal card, board_summary and board_card goals lane.
3. Add the soft warning to `set_board_goal`.
4. Update /draft's goal elicitation text and the tool description.
5. Tests: unset board shows the new default in all three places; warning on "Drafting"; no warning on an outcome sentence; confirmed write still succeeds with the warning.
6. Commit on `main` by explicit pathspec and push. Finish with the line `Implementation of Job Board goal default title and framing complete!`, then what you verified and what you assumed without verifying.

## 8. Implementation criteria
1. No code path builds a default goal title ending in "Drafting".
2. `set_board_goal` returns a warning note, not a refusal, for a statement naming drafting.
3. /draft's goal elicitation text tells the session to frame one outcome.
4. The tool description states the new default.

Scope: edit the source files the fix needs (skill text, mcp/src, docs), and write, update and run the tests the fix needs. Out of scope, because the orchestrating session runs them once after every spec lands: `build_plugin.py` and `check_plugin.py`. Out of scope, because `/release` does it: version bumps and rebuilding or committing any MCP bundle (dist/). Never build a `.plugin` archive.

## 9. Open questions
- Default text: "Goal not set" or the Writing's title alone?

## 10. Verify against HEAD before building
Confirm where the default description is built (one place or several), where /draft elicits a goal, and the current `set_board_goal` description. Record each as matches / differs.
