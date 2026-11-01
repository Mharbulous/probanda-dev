# Legal Memos board (replaces Raw Research)

Built 2026-10-31. Code: `source/lawyer/mcp/src/submission/forms/legal-memos-page.ts`. Doctrine: `.claude/skills/shared/html-pages.md`, View pages.

## What a memo is

A file under the matter's `6. LAW` folder, at any depth, that is either:

- an answer a job recorded (`ticket_answers`), or
- named as one of three kinds:
  - **Research memo**: a `.md` file named `… ML re …` or `… research-lawyer answer …`.
  - **Note-up record**: a `.md` file named `… note-up …`.
  - **Westlaw Deep Research report**: a `.docx` file not named after a neutral citation. Westlaw decisions download as `.doc`.

Statutes, practice directions, decisions, `.docx.txt` extracts and `case-download-manifest.json` files are not memos. `<stem> vN<ext>` is version N of `<stem><ext>`, which is version 1, in the same folder. All versions are one memo, shown at its highest version, with the earlier version numbers listed.

## "Linked to this Milestone"

A memo is on a board when either:

1. a job drawn on that board saved any version of it. A job is drawn on a board by the Milestone page's own rule (`onFilingBoard`): each of the board's Writings' jobs, plus its proceeding's General jobs (no Writing). Or:
2. no live (undeleted) job in the matter saved any version of it. Nothing recorded ties it to one board, so it is on every board, in the No job lane.

A memo saved only by jobs on other boards is not shown. A General Job's memo is therefore on every Writing's board in its proceeding, and a merged board lists each memo once.

The page and `drafting_forms__board_card`'s `memos` lane both call `buildLegalMemosData`, so the rule exists once.

## Fields

- **Issue**: each saving job's intent, verbatim. Since 2026-10-31 a research job's intent is its `Job question:`. No summary is ever generated. A memo with no job says so and shows no issue.
- **Facts**: the `facts` rows the saving jobs' scope names (`facts:<id>`). A memo's text names nothing of the matter, so nothing is read from it.
- **Status**: In Progress when any saving job is held, Completed when any is completed, else Started. A lapsed lock reads as released, as on the Milestone. No job when none saved it.
- **Date**: the leading `YYYY-MM-DD` of the current version's name, else a `(YYYY-MM-DD)` in it, else when its job saved it, else the file's modified date.
- **Link**: an absolute `file:///` URL to the current version. A relative link would resolve against a previewed card's web origin.

Only file names and modified dates are read from disk.

## Layout

The Milestone's vocabulary from `board.css`: status lanes as section panels with count pills (In Progress, Started, Completed, No job), each memo a `details.ticket` card with the version as its ref, the Milestone's `wip` and `done` chips, and a source chip. The header carries a folder filter, a source filter and a search, saved between visits as the Raw Research filters were. An empty lane says so, and a board with no memo shows one empty line.

## Rename and compatibility

- The page is `Legal Memos.html`. `OLD_PAGE` sweeps `Raw Research.html` and `Raw Research - Milestone|Job Board <id>.html` into `TRASH` on the next write, only when the file carries the view-page marker.
- A saved viewing order holding `view:Raw Research` reads as `view:Legal Memos`, so the thumbnail keeps its place.
- No schema change. An older bundle writes `Raw Research.html` and leaves `Legal Memos.html` alone, because it does not know that name. The next newer write trashes the old file again.
- The html-pages hook refuses both names.

## Left for later

- **Application items as a Facts source.** The research memo Writing's Application findings are not read yet. Facts come from job scope only, which research jobs often leave empty.
- **Issue for a memo with no job.** Most memos on L4443 predate `ticket_answers`, so they show no issue. Reading the memo's own Issue section would fill this, but it reads memo text.
- **Recognition by name.** A memo named outside the three patterns, and saved by no job, is not listed. A manifest field for the memo kind would end the guessing.
- **The link inside a file card.** Whether a `file:///` link opens from the Cowork card preview is untested.
- **Raw Research's proposition view.** Removed with the page. Propositions stay readable through `/drafting-data`, and the Arguments page shows the ones linked to submissions.
