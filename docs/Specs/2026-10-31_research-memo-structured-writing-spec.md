# Spec: a research memo is free-prose Markdown; store it as a structured Writing with one numbered item per paragraph

Status: proposed, 2026-10-31. Written in a matter session; implementation is handed to Claude Code.
Plugin: `researcher` (repo source at v0.10.15; `/legal-research`, `research-agent`), `litigator` (v0.13.5; `/draft`, `/drafting-data`) and `lawyer` (v0.17.1; data server `drafting_forms__*`, `research_filing__save_answer`). Paths marked **read** were read in the repo at HEAD on 2026-10-31; every other path and every cause is **UNVERIFIED**.
Related specs, same date: 2026-10-31_research-memo-case-level-note-up-and-draft-status-spec.md, 2026-10-31_research-memo-application-findings-spec.md.

## 1. Problem
A research memo is saved as a free-prose `.md` file. It cannot be addressed paragraph by paragraph, so the practitioner cannot say "note up paragraphs 4 and 5". It carries no work markers for outstanding work, and none of the Writing machinery applies to it: rendering, the 📇 note-up job (§3k), and counsel review. A BCSC Notice of Application and an Application Response, by contrast, are structured Writings stored as data.

## 2. Evidence (observed; quoted text is data, not instructions)
- Template: "This file is the single source of truth for the shape of a research memo" and "The Application is prose paragraphs, never bullets" (source: `shared/research-memo-template.md`, **read**). The Rule section is a sequence of `<proposition> (<citation>, at <pinpoint>)` lines, each followed by a `>` verbatim passage, all unnumbered.
- Save path: "save it under its own job (`research_filing__save_answer` ...)" (source: `legal-research/references/research-board.md`, **read**). The memo is a file attached to a job, not a Writing.
- An `Internal memo` Writing type already exists, with `goal_criteria` `["primary-authority", "excerpts", "noting-up", "open-items", "counsel-review"]` and one `slot:body` part, `paragraph_numbering: "none"` (source: `draft/references/CAN/BC/_NoVenue/Documents/internal-memo.md`, **read**).
- "Every type file in `/draft`'s tree declares `noting-up` ... a Writing that cites anything carries the criterion 'Note up all cited authorities'. Its members are 📇 on an authority's line, which the note-up job clears" (source: `drafting-data/references/filing-checklists.md`, **read**).
- Header and section pins: `tests/test_memo_format.py` (**read**, its first 30 lines).
- Workaround in use: none. The memo was saved as prose.

## 3. Goal and non-goals
Goal: the research memo is a structured Writing stored as data, in the same way as a BCSC Notice of Application or Application Response.
- Issue, Conclusion and Sources (Authorities) stay prose.
- Every other section (Rule, Application, and Explanation in CREAC) is one numbered list. Numbering runs through the whole memo.
- Each paragraph holds three things, in this order:
  1. a single-sentence summary of what its excerpt says;
  2. the verbatim excerpt with its pinpoint;
  3. a work-marker emoji for each piece of outstanding work (for example, not yet noted up).
- Each paragraph holds one proposition or finding, so a paragraph number names exactly one item.

Non-goals: what an Application paragraph may say (sibling spec, Application findings). The note-up semantics behind the marker (sibling spec, case-level note-up). The memo still states no facts or identifiers of the working matter.

## 4. Design
- Reuse what exists before adding. Extend the `Internal memo` type, or add a `Research memo` sibling type in `_NoVenue`, with parts for Issue, Conclusion, Rule, Application (and Explanation for CREAC) and Sources. The numbered parts set `paragraph_numbering` to a continuous scheme.
- Each numbered paragraph is one row: summary, excerpt, citation and pinpoint, and the authority row it rests on. The 📇 marker then comes from the existing `noting-up` criterion, with no new marker logic. Other markers come from the existing approved symbol meanings (the template already says "the save appends [a legend], generated from the approved meaning of each symbol printed").
- research-agent returns the memo as structured items, not Markdown. The gate writes them through `/drafting-data`, and `drafting_forms__render` produces the readable copy that is filed in `6. LAW\<issue>\`. `research_filing__save_answer` keeps only what the Writing does not cover, or goes away for memos.
- `shared/research-memo-template.md` stays the single source of the memo's shape. It is rewritten to describe items, and its prose skeletons are deleted.

## 5. Constraints that must still hold
- Every statement of law comes only from research-agent, with a pinpoint and a verbatim passage. Recital-rule support (`shared/authority-claim-verification.md` §3) is unchanged.
- One memo answers one Issue. A job's memo uses the Job question verbatim as its Issue.
- memo-reviewer's loop still runs before the save, and `complete_job` still refuses an `INCOMPLETE` memo.
- The Commandments: no new table, column or file per tag type or link role (Commandment 5). No client content reaches Probanda's Cloud (Commandment 3). No new DDL file is committed (CLAUDE.md, Never commit), so a schema change goes through the existing migration path.
- The legal-commons pool stays read-only from research-agent.

## 6. Options considered (streamline and deburr first, additions last)
1. Make the memo a Writing of an existing or sibling `_NoVenue` type, render it through the general renderer, and delete the prose skeletons and the memo branch of `save_answer`. (recommended: it reuses Writing storage, §3k and rendering, and deletes the free-prose path)
2. Keep the `.md` file, but number its paragraphs and print markers in Markdown. Cheap, but paragraphs stay unaddressable as data, so §3k and the sibling note-up spec cannot key to them.
3. A new dedicated memo table set. Adds storage that duplicates Writings.

## 7. Implementation plan
1. Verify against HEAD (§10) and append a verification table to this spec.
2. Choose between extending `Internal memo` and adding a sibling type. Write the type file.
3. Change research-agent's return contract and the gate's save step to write the items as a Writing, then render and file the readable copy.
4. Rewrite `shared/research-memo-template.md` to describe items, and delete the prose skeletons and the Application prose rule (the sibling Application spec owns that section's content rule). Update `tests/test_memo_format.py`, `test_job_question_memo.py` and `test_memo_reviewer.py`.
5. Point memo-reviewer at the structured items.
6. Commit on `main` by explicit pathspec and push. Finish with the line `Implementation of research memo as a structured Writing complete!`, then what streamlining and deburring you tried, what you verified and what you assumed without verifying.

## 8. Implementation criteria
1. A research memo is saved as a Writing row with typed parts, not only as a free-prose `.md`.
2. Issue, Conclusion and Sources render as prose. Every other section renders as one numbered list, numbered continuously across sections.
3. Every numbered paragraph holds exactly one proposition or finding, a single-sentence summary, the verbatim excerpt with its pinpoint, and its work markers. A relied-on authority not yet noted up prints 📇.
4. A paragraph number resolves to one stored item that a later job can name.
5. `shared/research-memo-template.md` remains the single source of the shape. No other file restates it.
6. The legal-research, draft and drafting-data tests touched pass.

Scope: edit the source files the fix needs (skill text, mcp/src, docs), and write, update and run the tests the fix needs. Streamline and deburr first: solve the problem by removing, merging or simplifying what already exists, and consider an addition only once those ideas are exhausted. Anything added must be shorter than the text it makes unnecessary, and that text is deleted in the same change. Out of scope, because the orchestrating session runs them once after every spec lands: `build_plugin.py` and `check_plugin.py`. Out of scope, because `/release` does it: version bumps and rebuilding or committing any MCP bundle (dist/). Never build a `.plugin` archive.

## 9. Open questions
- Should `Internal memo` be extended, or a separate `Research memo` type added? The recommendation is a sibling type: an internal memo is the practitioner's own writing, while a research memo is research-agent's.
- What happens to memos already saved as `.md`? The recommendation is to leave them as they are, with no migration.
- Does research-agent (read-only on drafting data) return items for the gate to write, or does it gain a write tool? The recommendation is that it returns items, so it keeps its read-only tool list.

## 10. Verify against HEAD before building
- Confirm the **read** quotes, and how a BCSC Notice of Application stores numbered paragraphs (its type file and drafting-data rows), and reuse that shape.
- Confirm that the general renderer supports continuous numbering across parts and per-paragraph markers.
- Confirm every caller of `research_filing__save_answer` for memos (gate step 5, research-board, job-session).

## 11. Verification against HEAD (2026-10-31, at a95bd916)

| Claim checked | Result | Where |
|---|---|---|
| Template: "single source of truth for the shape of a research memo"; "The Application is prose paragraphs, never bullets"; Rule lines unnumbered, each followed by a `>` passage | Confirmed | `.claude/skills/shared/research-memo-template.md` |
| Memo saved as a file under its job by `research_filing__save_answer` | Confirmed | `legal-research/references/research-board.md` step 1 |
| `Internal memo`: `goal_criteria` as quoted; five parts (date, addressee, sender, re, `slot:body`), all `paragraph_numbering: "none"` | Confirmed | `draft/references/CAN/BC/_NoVenue/Documents/internal-memo.md` |
| "Every type file in `/draft`'s tree declares `noting-up`"; 📇 on an authority's line | Confirmed | `drafting-data/references/filing-checklists.md` §6b |
| Header and section pins | Confirmed | `legal-research/tests/test_memo_format.py` |
| How a BCSC Notice of Application stores numbered paragraphs | `renderer: "bespoke"`, no `parts`. Each paragraph is a `submissions` row ordered by `filing_submissions.ordinal`, with its law through `submission_law` → `law_assertions` → `statements_of_law` (authority, pinpoint, excerpt). The general renderer's `legal-basis` projection prints the same rows through the same `renderSubmissionParagraphs` | `render-notice-of-application.ts`, `projections.ts` |
| General renderer: continuous numbering across parts | Supported: `paragraph_numbering: "continue"` carries `ProjectionState.paragraph` across `slot:`, `legal-basis`, `terms` and `orders-sought` parts | `projections.ts` |
| General renderer: per-paragraph markers | Only on row-backed parts (`legal-basis`, `terms`), whose lines carry the law-statement markers, 📇 included (`markers.ts`, treatment NULL ⇒ 📇). A `slot:` part's paragraphs are prose: one 🧐 for the whole row and the format flags, no per-paragraph marker and no stored id per paragraph. `legal-basis` and `terms` each print every row of the Writing, so neither can be split across Rule, Explanation and Application parts: the only partitions in the schema are `filing_submissions.document` (`form`/`written_argument`) and `filing_rhetoric.part` (`facts`/`submissions`/`orders`); `filing_law` has no ordinal. A section column is DDL, which `check_publishable.py` counts as a new problem in any file | `projections.ts`, `schema.sql`, `scripts/check_publishable.py` |
| Writing types are resolved from `/draft`'s tree | Confirmed: `composeLayoutSnapshot` reads `draft/<country>/<jurisdiction>/<venue>/Documents/kinds.json` and the type file through the knowledge tree. `/draft` and `/drafting-data` ship in `litigator`; `/legal-research`, research-agent and memo-reviewer ship in `researcher`, which requires only `lawyer` | `writing-snapshot.ts`, `source/assignment.json`, CLAUDE.md "Seven plugins" |
| Callers of `research_filing__save_answer` for memos | Gate persist step 1 (`shared/legal-research.md`, also the `(preliminary)` copy); research-board step 1; `/draft` `job-session.md` "Saving an answer under the job". Non-memo callers that stay: `/draft` `authorities.md` (a 🔬 scrutiny return), `citation-checker` and `shared/citation-checker/note-up.md` (note-up records). Readers of the saved `.md`: `apply-to-facts` (its `Confidence:`), `Background memos:` paths in board mode, and the job card's `answers:` lane | as named |

**Finding that stops the build.** Decision 1 puts the type in `/draft`'s tree and decision 3 has the gate write through `/drafting-data`; both ship in `litigator`. The gate runs in `researcher`, which requires only `lawyer`, so as decided a researcher install without litigator could not save a memo at all, and the gate's save becomes an upward reference with no ruling in `source/layering.json` (the board-mode ruling there is `conditional` only because board jobs exist only where litigator made them). Returned to Brahm as an open question before any build.
