# Dry run: `/triage-issue` with `fix-planner` on a past suggestion issue

Lifecycle plan Phase 7, done-when: "a dry run on a past suggestion issue gives every item a runnable check and ends `ready-for-human`". Nothing was written to GitHub or to the Suggestion Box.

## How it was run

- **Issue:** #123, the goals-card suggestion (closed 2026-10-19, built as `lawyer` 0.2.2). Read with the GitHub tools, read-only. It is the motivating example in the design's "Given" section.
- **Record:** the Suggestion Box was not reached (no `POOL_SECRET_KEY` in the session), so the cloud record was a fixture: suggestion id `7905138b`, three items and two context lines rebuilt from the design's "Given" section, worded as a practitioner might. The fixture stayed in the session's scratch folder and is not committed.
- **Planner:** the session had no tool to dispatch a subagent, so the orchestrator followed `source/developer/agents/fix-planner.md` itself, on `main` at `a3b5189`, reading only `source/lawyer/mcp/src/templates/job-board/job-board.js`, `job-board.css` and `workboard.css`, and issue #123.
- **Step 2:** the titles of every other `suggestion` issue (#150 to #192) were compared by meaning; none concerns the goals card. #123 itself is the issue under triage, so it is not a repeat of itself.
- **Step 4:** the three checks were written as one scratch test file (invented data, reading the shipped template source) and run against `main` with `node --test`: 2 pass, 1 fails.
- **Guard:** `python scripts/check_verbatim.py --suggestion <fixture> docs/Plans/2026-10-26_fix-planner-dry-run.md` passes on this file.

## The brief triage would post

**Category:** enhancement: a display change. **State:** ready-for-human: a suggestion issue always waits for the maintainer, one decision per item. **Location:** cloud: no approved-for-build item needs Windows, a browser or a secret.

**Verification:** the goals card's rows (label cell, text cell, an indent step per level) and its italic connector rows are in `job-board.js` (`statementRows`) and `job-board.css`, as #123 built them. The card is light text (`--paper`, `#F4FAF7`) on a dark ground (`--ink`, `#025056`), a contrast of 8.7:1, above the 7:1 of WCAG AAA. The card shares its look with the Completion Criteria card (`.goal`). No specification was attached.

### Item 1
**Item:** give each goal's label a column of its own, so a wrapped line returns to the text's left edge, with one indent step per level.
**Recommendation:** decline: already works as asked. **Reason:** Already works as asked.
**Check:** `goals-card.test.mjs`: the label is a `span.label` in a flex row beside a `flex:1 1 0` text cell, and each row is indented 1.5em per level. Command: `node --test goals-card.test.mjs`. Result on main: green.

### Item 2
**Item:** set the joining words between alternatives on rows of their own, in italic.
**Recommendation:** decline: already works as asked. **Reason:** Already works as asked.
**Check:** `goals-card.test.mjs`: the joining-word lines get the `connector` class on a confirmed statement, and `.goals .row .connector` is italic. Command: `node --test goals-card.test.mjs`. Result on main: green.

### Item 3
**Item:** turn the card to dark type in a serif face on a pale ground.
**Recommendation:** decline: cost outweighs benefit. **Reason:** The card already reads at well above the usual contrast standard, and it matches the card beside it on purpose.
**Check:** `goals-card.test.mjs`: the `.goal` background token is lighter than its text token, and the card's body font is a serif. Command: `node --test goals-card.test.mjs`. Result on main: red, `the background is lighter than the text`.
**Why:** a preference with no measurable defect: 8.7:1 passes. Approving it would recolour the Completion Criteria card too, or split two cards that match by design. The constraint against nested boxes is met either way.

### Scope
None is recommended for building. Were item 3 approved: `source/lawyer/mcp/src/templates/job-board/job-board.css` (`.goal` and `.goals`), the pinned hashes in `source/lawyer/mcp/test/job-board.unit.test.mjs`, and a `lawyer` patch release; nothing outside the job board.

### Done when
Item 3, were it approved: the item 3 check passes, then `python scripts/build_plugin.py --check` and `python scripts/check_plugin.py`.

### Open decisions
- Item 1: approve or decline? Recommended: decline, already works as asked, reason "Already works as asked".
- Item 2: approve or decline? Recommended: decline, already works as asked, reason "Already works as asked".
- Item 3: approve or decline? Recommended: decline, cost outweighs benefit, reason as above.

Labels: `enhancement`, `ready-for-human`, `cloud`; `needs-triage` removed. The suggestion would have been opened for review with issue 123. No item status was set.

## Result

Every item has a runnable check (three, all run: two green, one red), each has one open decision, and the issue ends `ready-for-human`. The outcome agrees with what Brahm decided by hand on #123: the layout parts were built, and the recolour was turned down for the same reason.
