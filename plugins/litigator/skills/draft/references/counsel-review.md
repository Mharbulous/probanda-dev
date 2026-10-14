Read when: the assigned job is `Prepare the review pages`, or its title starts with `Counsel's review of `.
Assumes SKILL.md and `references/job-session.md` are loaded. Rules are not restated here.

Both jobs are `/drafting-data`'s fixed-text jobs (`/drafting-data` §3c), created at the Opening once the pre-review passes leave nothing open (SKILL.md section 14). Every read and write below goes through the gatekeeper. Its storage rules for approvals and discussion points are `.claude/skills/drafting-data/references/review.md`.

A **unit** is one 🧐 line on a forum mockup (the mockup of a document that is sent, a letter's or memo's included), the line of one statement, proposition, postulate, submission, order sought, clause or prose slot. A prose slot is one slot of a Writing's own text, reviewed whole, and has no source (`"source": null`). One line can carry the 🧐 of several objects: a Notice of Application fact line merges a postulate with each of its statements of fact, and an order sought's line merges the order with the Writing's own wording of it, where the Writing has one (`review.md` "Snapshot fields"). The unit's approval is therefore an approval of every object whose 🧐 is on that line, and the line's 🧐 clears only when each of them has one. The Counsel Brief is never reviewed.

## Prepare the review pages

An ordinary AI job with one step, dispatched like any other. It never writes the drafting database.

1. Render (SKILL.md section 11) and read each forum mockup, one document per call, for every unit in document order.
2. For each unit, ask the gatekeeper for its source: the local PDF the record names for it, the pinpoint and the excerpt. A unit whose source is not a local PDF gets `"source": null`. Never search the matter folder for a document with no file on record, because a draft there can pass for the sworn copy. Give `pages` when the pinpoint names pages of that PDF. When it names paragraphs or a whole exhibit, read the PDF's pages yourself, as images where a page has no text layer, and give the pages that hold them: each cited paragraph's pages, and for an exhibit cited whole, the page carrying its stamp, which may be the exhibit's own first page, through its last page. Never locate them in another copy, such as an unsworn draft, whose text and page numbers can differ. Give the unit a `note` naming each cited paragraph or exhibit the PDF does not hold, for example "para. 20 is not in the source, which ends at para. 19". Otherwise leave `pages` null and the script finds the excerpt.
3. Write the list as a manifest in the scratchpad and run `scripts/extract_review_pages.py <manifest> <presentation folder>`, using the presentation folder the render reported. The script replaces the folder's `Review pages/` contents and prints its index.
4. Report in one line the units with no source on file, naming each document that has no file on record so the practitioner can record its path, and any unit the script could not locate, by the status it printed. Then complete the job (`/drafting-data` §9).

## The review session

The review job is a one-step job whose step is the practitioner's. Assigning it follows `job-session.md` Branch A, and then this section runs in place of dispatch. The session executes the review and only records: approvals, discussion points, and the wording changes the practitioner dictates. Work needing AI becomes a job only in a later outlining session.

**Mode.** Four modes: scope is **full review** or **review changed**, and comments are **at the end** or **per paragraph**. Read the stored `review` block from `coclerk.json` through `/practice-data`. If it is absent, ask once, one form per choice, and write the answers back there. The practitioner may switch mode at any point. Keep to the new mode until told otherwise, and write nothing back for a switch.

**Order and position.** Units are taken in document order. Where to start or resume is derived, never stored: `review.md` "## Reads" states the rule. So a pause, a resume, a take-over and a context compaction all land on the same unit.

**Bulk approval (the default).** Counsel normally reviews the mockups as a whole, so the first ask covers every unit in scope. Present each forum mockup as a file card, list its 🧐 units in document order with a count per document, and ask one plain-text question: "Do you approve all 38 units listed as they stand, or are there units you want to comment on or change?" This is one decision, not a merge (`/show-me` rule 1). Only the practitioner's explicit words approving all the units, or all but units they name, are a bulk approval. Never infer one from silence, a partial answer or an earlier remark. On those words, write one approval per object on every listed unit not named, as one `execute` script (`review.md` "Writes"), and confirm-read each. Each unit the practitioner names then goes through the per-unit flow below. Under review changed, the list holds the units that mode selects.

**Show and ask per unit**, one unit at a time, per `/show-me`, for each unit the practitioner names in the bulk ask, and for every unit when the practitioner asks to go one at a time. The wording goes in chat. The unit's pages from `Review pages/` go in the side panel as a file card, or the line "no source on file", or the note the index gives for a page (for example, a scanned page shown whole). The prompt asks about substance in the paralegal read-back shape, never "approve?": "Paragraph 12 says X, relying on Ex. A s. 2.3, shown at right. Does it say what you want the court to take from it?"

- **It stands:** write the unit's approval.
- **A comment:** record it verbatim as a discussion point on the unit. At the end, move on. Per paragraph, discuss it now and resolve it before moving on.
- **A dictated wording change:** an ordinary revision (SKILL.md section 12), which re-raises 🧐 on the unit. Re-render, show the new wording, and ask again. After a change to a unit's excerpt or pinpoint, re-run the script for that unit before showing it.
- **A question:** answer it in conversation. Nothing is recorded.

**Review changed** takes the units whose 🧐 carries an earlier approval, which the gatekeeper's latest-approval read shows. A diff alone hides context, so show each with its neighbouring units and any paragraph that cross-references it. A unit that was never approved is still shown as in a full review, because the job cannot complete while its 🧐 stands.

**Discussion.** Every open point is resolved as one of three:

- **answered** or **leave it:** close the point, then write the unit's approval of its wording as it now stands.
- **change wanted:** close the point and capture the practitioner's words as an idea, in the gatekeeper's single write. The unit stays unapproved, so its 🧐 stands until the change lands in a later job and the unit is reviewed again.

**Completion.** The job completes (`/drafting-data` §9) only when no point is open and no 🧐 stands on any forum mockup. Then, in the same session, `/drafting-data` §14 creates the gate job. Where either condition fails, the job stays in progress under this session's lock (`job-session.md` "Complete"). Say in one line what it waits on.
