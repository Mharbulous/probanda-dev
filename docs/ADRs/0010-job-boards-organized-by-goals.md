---
status: accepted
---

# A Milestone is organized by its goals and may hold several Writings, joined only by the practitioner's merge

ADR 0033 (CoClerk, 2026-10-05 amendment) drew one Milestone page per live Writing, never more than one Writing on a page. Related work then sits on separate boards: a Notice of Application and the affidavit that proves its facts each have their own jobs, goals and four view pages, and the practitioner cross-references them by hand. This ADR replaces that rule.

- **A board tracks the work toward one statement of goals.** The statement is a list of self-contained goals, each confirmed, inferred or declined on its own. Every Writing on a board serves its goals as a whole: which goal a Writing serves is not recorded.
- **A board gains a Writing only by a merge.** The practitioner sees both boards' goals side by side and confirms that they overlap or cohere. The tool refuses without that confirmation. Boards in different proceedings may merge, and a Standalone or pre-filing board may merge. Each Writing and job still belongs to its own one proceeding.
- **The survivor** is a board with a Writing over one without, otherwise the lower id; of two pre-filing boards, the lower proceeding id. It keeps every Writing, job, loose thread and goal of both, and keeps its id while any of its Writings is live. The absorbed board's pages go to `TRASH`.
- **Membership is one `db_meta` row per absorbed board** (`board_member:filing:<id>` or `board_member:proceeding:<id>`, valued with the survivor). No job is rewritten. A pre-filing board's proceeding, once merged, puts its first Writing on the survivor.
- **One set of view pages per board**, covering every Writing and proceeding on it. A merged Material Facts page (Provable Facts until ADR 0011) lists the survivor's Writing's facts in its own order, then each other Writing's facts not already listed, in its own order. Drafting facts carried no date, so a date order was considered and dropped. Since ADR 0011 a procedural fact carries the date of its step, and the merged Procedural History page lists the board's procedural facts, each once, in date order.
- **A split** divides a board with more than one goal along goals the practitioner names. The session then proposes which Writings serve each side, and the facts, law and arguments follow the Writings that use them. A Writing is never divided. Specified now, built when first needed.

## Amendment 2026-10-21: a merged board is drawn as one board

The survivor's page first drew each merged board as its own section, each with its own Completion Criteria card and lanes, so the page held two of every panel. It now draws one board: one Completion Criteria card and one panel per lane, holding every Writing's jobs, each job once and naming the Writing it serves. board_summary reads the same one board by any of its Writings' ids. board_card reads it by the survivor's id and refuses an absorbed board's (`board_merged`, naming the survivor), so the absorbed board shows no card of its own, unless the survivor is retired.

- Criteria combine by id. A combined criterion is unmet while any Writing's is unmet, pending while any is pending, and met only when every Writing's is met. In board_card and board_summary, which a session reads to route work, where the Writings word it differently (a pre-filing and a pre-send gate) each Writing's wording is shown, named by its Writing, a criterion only one Writing holds names that Writing, and each item and the card's state name their Writing.
- A deadline criterion is never combined: each Writing keeps its own, named by its Writing in board_card and board_summary.
- The page's Completion Criteria card names no Writing (2026-10-22, on the practitioner's instruction, reversing the page's wording above): it shows one state, the least advanced lifecycle among the board's Writings, with no date. Each criterion has one wording, a gate whose Writings differ reading "The pre-filing and pre-send checks are passed or waived". An item two Writings share prints once. Its counts still count every underlying item, so they equal board_card's. What the board is for belongs in its Goal card.
- The thumbnail strip's viewed order (`board_viewed:*` in `db_meta`, 2026-10-22) is kept per board by its survivor: a page presented through any Writing on the board is recorded on the survivor's row. A merge does not carry the absorbed board's row over, and it is never read again.
- This is presentation only. Each Writing keeps its own documents, numbering, jobs and criteria, and each filing's gate still blocks only its own filing: one filing's gate being met never marks the other's met.

## Amendment 2026-10-22: a merged board holds one goal

A merge appended the absorbed board's statement of goals to the survivor's, so a merged board showed a list of goals, or none when neither board had one. The practitioner's view is that a merged board serves one objective, and the merge is the moment to state it. This replaces "a list of self-contained goals" and "keeps every ... goal of both" above for merged boards.

- The merge question proposes one combined goal, one outcome sentence, in the same turn (`drafting-data` `jobs-closeout.md` §10d). One bare yes confirms the merge and the goal. A sentence the practitioner types replaces the proposal. `merge_job_boards` writes it as the board's one statement, confirmed, through the practitioner-words gate that `set_board_goal`'s confirmed statement passes.
- Every earlier statement of both boards, the survivor's own and the absorbed board's, is kept under the survivor's `merged` as history only. Once the board holds one goal, the history is never drawn on the Goal card, board_summary or board_card's goals lane.
- A merge given no goal leaves the board's goal status `needs_consolidation`. So does a board merged before this amendment that still holds `merged` statements. Such a board's Goal card draws at most its own statement, board_card lists the history as statements to combine, and `/draft` asks once, at the board's next attended Opening, for one combined goal. Any write of the board's own statement ends the status.

## Considered options

- **Keep one Writing per page and move only jobs**: meets no requirement that the work be seen together, and leaves four view pages per Writing.
- **Re-point jobs to the survivor's Writing**: needs no new storage, but loses which Writing a job was for and can never be undone.
- **A boards table with Writings as members**: the cleanest model, but drafting-data is a legacy store under Exception 2 of COMMANDMENTS.md and may not grow its dependence on it.
- **Link every Writing, fact and authority to a goal up front**: most boards are never split, so the links would be wasted work. The seam is worked out only at a split.

## Consequences

- An old copy of the plugin ignores the membership rows and redraws the absorbed board's page, so the release is a minor version.
- Skill text and pages that said "one Writing per page" now say one board per page.
