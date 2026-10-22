---
status: accepted
---

# A Job Board is organized by its goals and may hold several Writings, joined only by the practitioner's merge

ADR 0033 (CoClerk, 2026-10-05 amendment) drew one Job Board page per live Writing, never more than one Writing on a page. Related work then sits on separate boards: a Notice of Application and the affidavit that proves its facts each have their own jobs, goals and four view pages, and the practitioner cross-references them by hand. This ADR replaces that rule.

- **A board tracks the work toward one statement of goals.** The statement is a list of self-contained goals, each confirmed, inferred or declined on its own. Every Writing on a board serves its goals as a whole: which goal a Writing serves is not recorded.
- **A board gains a Writing only by a merge.** The practitioner sees both boards' goals side by side and confirms that they overlap or cohere. The tool refuses without that confirmation. Boards in different proceedings may merge, and a Standalone or pre-filing board may merge. Each Writing and job still belongs to its own one proceeding.
- **The survivor** is a board with a Writing over one without, otherwise the lower id; of two pre-filing boards, the lower proceeding id. It keeps every Writing, job, loose thread and goal of both, and keeps its id while any of its Writings is live. The absorbed board's pages go to `TRASH`.
- **Membership is one `db_meta` row per absorbed board** (`board_member:filing:<id>` or `board_member:proceeding:<id>`, valued with the survivor). No job is rewritten. A pre-filing board's proceeding, once merged, puts its first Writing on the survivor.
- **One set of view pages per board**, covering every Writing and proceeding on it. A merged Material Facts page (Provable Facts until ADR 0011) lists the survivor's Writing's facts in its own order, then each other Writing's facts not already listed, in its own order. Drafting facts carried no date, so a date order was considered and dropped. Since ADR 0011 a procedural fact carries the date of its step, and the merged Procedural History page lists the board's procedural facts, each once, in date order.
- **A split** divides a board with more than one goal along goals the practitioner names. The session then proposes which Writings serve each side, and the facts, law and arguments follow the Writings that use them. A Writing is never divided. Specified now, built when first needed.

## Amendment 2026-10-21: a merged board is drawn as one board

The survivor's page first drew each merged board as its own section, each with its own Completion Criteria card and lanes, so the page held two of every panel. It now draws one board: one Completion Criteria card and one panel per lane, holding every Writing's jobs, each job once and naming the Writing it serves. board_summary reads the same one board by any of its Writings' ids. board_card reads it by the survivor's id and refuses an absorbed board's (`board_merged`, naming the survivor), so the absorbed board shows no card of its own, unless the survivor is retired.

- Criteria combine by id. A combined criterion is unmet while any Writing's is unmet, pending while any is pending, and met only when every Writing's is met. Where the Writings word it differently (a pre-filing and a pre-send gate), each Writing's wording is shown, named by its Writing. A criterion only one Writing holds names that Writing.
- A deadline criterion is never combined: each Writing keeps its own, named by its Writing.
- This is presentation only. Each Writing keeps its own documents, numbering, jobs and criteria, and each filing's gate still blocks only its own filing: one filing's gate being met never marks the other's met.

## Considered options

- **Keep one Writing per page and move only jobs**: meets no requirement that the work be seen together, and leaves four view pages per Writing.
- **Re-point jobs to the survivor's Writing**: needs no new storage, but loses which Writing a job was for and can never be undone.
- **A boards table with Writings as members**: the cleanest model, but drafting-data is a legacy store under Exception 2 of COMMANDMENTS.md and may not grow its dependence on it.
- **Link every Writing, fact and authority to a goal up front**: most boards are never split, so the links would be wasted work. The seam is worked out only at a split.

## Consequences

- An old copy of the plugin ignores the membership rows and redraws the absorbed board's page, so the release is a minor version.
- Skill text and pages that said "one Writing per page" now say one board per page.
