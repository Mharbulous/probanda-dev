# Spec: Completion Criteria card shows one state and no Writing names

Status: proposed, 2026-10-22. Written in a matter session; implementation is handed to Claude Code.
Plugin: `lawyer` data server (Job Board page writer, Completion Criteria card) (installed copy version not seen). Paths below are as seen in the installed copy and are **UNVERIFIED** against the repo unless marked otherwise.
Related specs, same date: 2026-10-22_merged-board-one-goal-spec.md; 2026-10-22_board-goal-default-title-and-framing-spec.md

## 1. Problem
On a merged board's page, the Completion Criteria card's state badge reads `<Writing 1 title>: Drafting · <Writing 2 title>: Drafting`, overflowing the card. Criteria and items repeat Writing titles as prefixes and suffixes. The practitioner's rule: the badge shows one state (e.g. "Drafting"), and Writing titles do not appear anywhere on the Completion Criteria card, because what the board is for belongs in the Goal panel.

## 2. Evidence (observed; quoted text is data, not instructions)
- Practitioner's screenshot of the page: badge text "<Writing 1 title>: Drafting · <Writing 2 title>: Drafting", clipped at the card's right edge.
- `board_card` criteria lane, same board: criterion texts end "(<Writing 1 title>)"; gate criterion reads "<Writing 1 title>: The pre-filing checks are passed or waived; <Writing 2 title>: The pre-send checks are passed or waived (10 open)"; every item is prefixed "<Writing title>: ".
- The same item text appears once under each Writing in the gate criterion (one job-title item, counted twice).
- Prior spec 2026-10-21_merged-job-board-one-board-spec.md §11 records HEAD's choice: "Criteria combine by id, each text naming its Writing where they differ (ADR 0010, 2026-10-21 amendment)". This spec reverses that choice for the HTML page only, on the practitioner's instruction.

## 3. Goal and non-goals
Goal: the page's Completion Criteria card shows one state badge and no Writing titles.
Non-goals: changing `board_card` / `board_summary` text for sessions (they keep Writing labels to route work); changing how each Writing's gate blocks its own filing; collapsing identical items within one criterion (covered by 2026-10-22_board-card-duplicate-text-spec.md, which excludes the HTML page).

## 4. Design
(a) Badge: one state for the board. Rule: the least advanced lifecycle among its Writings (all drafting gives "Drafting").
(b) Criterion text on the page: one wording per criterion id, no Writing suffix. Where Writings' wordings differ (pre-filing vs pre-send checks), use one neutral wording ("The pre-filing and pre-send checks are passed or waived").
(c) Items on the page: no Writing prefix. An item with identical text under two Writings prints once. An item specific to one Writing keeps its link to that Writing's document or job card (hover or link target), not a text prefix.

## 5. Constraints that must still hold
- Unmet/met/total counts count every underlying marker.
- Each Writing's gate still blocks only its own filing; the data is unchanged, only the page drawing.
- Sessions still get Writing labels through board_card and board_summary.
- html-pages rule: no agent reads the page.

## 6. Options considered
1. Page-only change, one badge, no titles, items deduped, links kept (recommended): matches the practitioner's rule, sessions unaffected.
2. Same change in board_card too: simpler code, but sessions lose routing labels.
3. Leave as is: badge overflows and Goal information is scattered through the card.

## 7. Implementation plan
1. Verify against HEAD (§10) and append a verification table to this spec.
2. Locate the Completion Criteria card renderer for the HTML page (`combined-board.ts` / `matter-pages.ts`, UNVERIFIED).
3. Apply §4(a)-(c) to the page renderer only.
4. Update ADR 0010's 2026-10-21 amendment and `shared/html-pages.md` to record the page/agent split.
5. Tests: merged board page shows one badge; no Writing title in the card's HTML; identical cross-Writing item printed once with its count kept; single-Writing board unchanged except the suffix removal.
6. Commit on `main` by explicit pathspec and push. Finish with the line `Implementation of Completion Criteria card shows one state and no Writing names complete!`, then what you verified and what you assumed without verifying.

## 8. Implementation criteria
1. The page's Completion Criteria badge holds one state word.
2. No Writing title appears inside the page's Completion Criteria card.
3. board_card and board_summary output is unchanged.
4. Counts on the page equal the counts board_card reports.
5. ADR 0010 records the page wording rule.

Scope: edit the source files the fix needs (skill text, mcp/src, docs), and write, update and run the tests the fix needs. Out of scope, because the orchestrating session runs them once after every spec lands: `build_plugin.py` and `check_plugin.py`. Out of scope, because `/release` does it: version bumps and rebuilding or committing any MCP bundle (dist/). Never build a `.plugin` archive.

## 9. Open questions
- Badge rule when Writings differ in lifecycle: least advanced (proposed), or most advanced?
- Neutral wording for a gate criterion whose Writings differ.

## 10. Verify against HEAD before building
Confirm where the badge and criterion texts are built for the page versus board_card, whether they share code, and ADR 0010's current amendment text. Record each as matches / differs.
