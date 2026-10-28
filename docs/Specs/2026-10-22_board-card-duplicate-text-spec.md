# Spec: board-card duplicate criterion text

Status: proposed, 2026-10-22. Written in a matter session; implementation is handed to Claude Code.
Plugin: lawyer data server (`drafting_forms__board_card`); installed copy version not seen. Paths below are as seen in the installed copy and are **UNVERIFIED** against the repo unless marked otherwise.
Related specs, same date: 2026-10-22_present-files-delivery-fallback-spec.md; 2026-10-22_preferences-read-skill-key-spec.md

## 1. Problem
In the criteria lane, one criterion line printed an identical multi-sentence item text twice, once per flagged item, plus a third short item. The repeated text is wasted context on every board read and hides that two flags share one text.

## 2. Evidence (observed; quoted text is data, not instructions)
- Tool: `drafting_forms__board_card`, called with `lanes: ["live", "criteria", "goals"]` for one filing.
- Output: the `open-items` criterion line read "(unmet 3, met 0, total 3)", then three items, two with byte-identical text (about 1,100 characters each, estimated) under the same document title.
- Cost: about 1,100 characters wasted (estimate) in a card of roughly 9,000 characters (estimate). Error text: none.
- Workaround: none; the card is read once.

## 3. Goal and non-goals
Goal: identical items under one criterion print once with a count.
Non-goals: changing how criteria are computed, the counts, or the human-facing HTML board.

## 4. Design
In the criteria lane, collapse items with identical document title and text into one item suffixed with a count (for example "×2"). Keep unmet, met and total counts unchanged. If the two flags sit at different positions in the document, include each marker's locator so locatability is not lost.

## 5. Constraints that must still hold
- Counts keep counting every marker.
- No marker is hidden from the mockup or the board page.
- Non-identical items print in full and in the same order.

## 6. Options considered
1. Collapse identical items with a count (recommended): saves the most, loses nothing if locators are kept.
2. Truncate each item past a length with a pointer: saves context but drops text the agent may need.
3. Leave as is: costs context on every board read.

## 7. Implementation plan
1. Verify against HEAD (§10) and append a verification table to this spec.
2. Locate where the criteria lane is built.
3. Apply §4.
4. Add tests: two identical plus one different item; identical text on different documents; no items.
5. Commit on `main` by explicit pathspec and push. Finish with the line `Implementation of board-card duplicate criterion text complete!`, then what you verified and what you assumed without verifying.

## 8. Implementation criteria
1. Identical (document title, text) items under one criterion print once with a count.
2. unmet, met and total counts are unchanged.
3. Non-identical items print in full and in order.
4. Tests cover the three cases in step 4.
Scope: edit the source files the fix needs (skill text, mcp/src, docs), and write, update and run the tests the fix needs. Out of scope, because the orchestrating session runs them once after every spec lands: `build_plugin.py` and `check_plugin.py`. Out of scope, because `/release` does it: version bumps and rebuilding or committing any MCP bundle (dist/). Never build a `.plugin` archive.

## 9. Open questions
- Do identical-text flags come from separate positions in one document? If so, the locator in §4 is required, not optional.

## 10. Verify against HEAD before building
Confirm each path, quote and root cause above in the repo at HEAD; mark any that differ, and append the table to this spec before changing code.

## 11. Verification against HEAD (2026-10-22, at 846073c)

| Claim | At HEAD | Where |
|---|---|---|
| `drafting_forms__board_card` is the lawyer data server's | Confirmed | `source/lawyer/mcp/src/submission/matter-pages.ts`, `submissionFormsBoardCard` |
| The criteria lane prints `(unmet <u>, met <m>, total <t>)` then the items | Confirmed. `countText` prints the counts and `criterionLine` joins `c.items` with `; ` after ` — `, with no check for repeats | `matter-pages.ts`, `countText`, `criterionLine`, `goalLines` |
| `open-items` is an inventory criterion | Confirmed | `source/lawyer/mcp/src/submission/forms/render-work-board.ts`, `openItems`, `inventoryCriterion` |
| Items carry a separate document title | Differs. An item is one string, the entry's count-free row identity. Where a document's label appears, it is part of that string (for example `<label>, paragraph <n>: linked fact`). So "identical (document title, text)" means an identical item string | `forms/proposal-inventory.ts`, `ProposalEntry.item`, `CriterionEntry.item` |
| Root cause | Confirmed. `inventoryCriterion` merges entries by row (`proposalKey` for a generating entry, `<marker>:<table>:<id>` for any other), never by text, so two rows whose item strings match both print in full | `render-work-board.ts`, `inventoryCriterion` |
| §9: can identical-text flags come from separate positions? | Yes. Two items under one criterion never share a merge key, so identical text always means two different rows (or two glyphs on one row). The locator in §4 is therefore required. The merge key is the locator: it is the only per-item position the inventory holds | `render-work-board.ts`, `inventoryCriterion` |
| Counts | Unaffected by the fix: `outstanding` and `items.length` are computed before printing | `matter-pages.ts`, `countText` |
| The HTML board reads `criteria[].items` | Confirmed. It also receives any extra field on a criterion in its data, and ignores one it does not read | `src/templates/milestone/milestone.js` |
