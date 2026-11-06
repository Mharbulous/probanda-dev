# Spec: Written Arguments must not be attached by default to every Work Board

Status: proposed, 2026-11-05. Written in a matter session; implementation is handed to Claude Code.
Plugin: `litigator` (installed copy seen at v0.20.4) and the `lawyer` data server (seen at v0.25.4). Paths below are as seen in the installed copy and are **UNVERIFIED** against the repo unless marked otherwise.
Related specs, same date: `2026-11-05_unlink-written-arguments-from-work-board-spec.md`

## 1. Problem

Every Writing created on a BCSC Notice of Application, Application Response, consent requisition or default-judgment requisition also gets a Written Arguments document, and so every such Work Board shows one. The practitioner never asked for it. Its role has been taken over by the Arguments board, one of the four boards (structured HTML pages generated from the database) that every Work Board carries: Procedural History, Material Facts, Legal Research and Arguments. Written Arguments is a structured document type, like a Notice of Application, and most Work Boards should not have one.

## 2. Evidence (observed; quoted text is data, not instructions)

- Four shipped type files each declare the companion: `draft/references/CAN/BC/BCSC/Documents/notice-of-application.md` (line 9), `application-response.md` (line 9), `requisition-consent.md` (line 8), `requisition-default-judgment.md` (line 8), all as `"companions": ["written-arguments"]`.
- `shared/declared-layout.md`: row `companions` reads "The companion documents rendered with this type." and "`companions` members. One: `written-arguments`. A type whose venue document is itself the written argument does not declare it."
- `drafting-data/references/filing-checklists.md` line 150: "Companions: the Written Arguments renders for this kind exactly as for every other (build #384) — nothing here populates it separately."
- One mockup render of a Writing on the Notice of Application type returned three documents: the notice, a Written Arguments file (864 characters, nothing drafted for it) and the Work Board.
- `drafting_data__create_writing` stores the type's layout on the Writing at creation; `drafting_data__resnapshot_writing` re-reads the type file, so a re-snapshot restores any companion the type declares.
- Other text that assumes a Written Arguments exists: `drafting-data/references/terms-and-symbols.md` lines 160, 166 and 366 (each advocacy document carries its own ordered pointer list; the form-versus-WA loose thread), `filing-checklists.md` line 239 (loose thread "Reconcile the venue form with the Written Arguments and record the pointer"), line 254 (the scan reads the filed face of the venue document and Written Arguments) and line 652.
- Workaround in use: none. The session left the unwanted document in place and told the practitioner.

## 3. Goal and non-goals

Goal: a new Writing gets no Written Arguments unless asked for. The only default items on a Work Board are the four boards. The Written Arguments document type and its renderer stay, for Writings that want one.

Non-goals: changing the four boards; deleting the Written Arguments renderer; removing a Written Arguments already stored on an existing Writing (the related spec does that, per Writing, on request).

## 4. Design

Stop the four type files declaring the companion. A Writing created afterwards stores a layout with no companion, so its render produces no Written Arguments file and its board draws none. Existing Writings keep the layout they stored. Anything that reads Written Arguments (the pointer lists, the form-versus-WA loose thread, the scan, any completion criterion) must treat its absence as normal and raise no marker, criterion or loose thread for a missing one. How a Writing later asks for Written Arguments is an open question (§9).

## 5. Constraints that must still hold

- A Writing that already has Written Arguments renders, validates and scans exactly as before.
- No completion criterion becomes unmeetable, and no marker fires, because a Writing has no Written Arguments.
- Submissions and orders sought keep a home on the Arguments board and the venue form.

## 6. Options considered (streamline and deburr first, additions last)

1. Delete the `companions` line from the four type files and the matching vocabulary text. Smallest change, deletes text (recommended).
2. Keep the line and add a default-off switch. Adds a switch and text for no gain.
3. Keep attaching it and hide it in the board page. The file would still render and still be scanned.

## 7. Implementation plan

1. Verify against HEAD (§10) and append a verification table to this spec.
2. Read the four type files, `shared/declared-layout.md` and every place §2 lists. Confirm that a layout with no `companions` validates and renders.
3. Delete the declaration from the four type files. Trim the vocabulary text in `shared/declared-layout.md` and the "Companions" bullet in `filing-checklists.md` to what still applies.
4. Make each reader in §2 treat a missing Written Arguments as normal. Add tests: a Writing created on each of the four types has no Written Arguments file or board entry; a Writing whose stored layout still names it renders it unchanged.
5. Commit on `main` by explicit pathspec and push. Finish with the line `Implementation of Written Arguments no longer a default companion complete!`, then what streamlining and deburring you tried, what you verified and what you assumed without verifying.

## 8. Implementation criteria

1. None of the four type files declares `written-arguments`.
2. A new Writing on each of the four types stores a layout with no Written Arguments, and its render writes no Written Arguments file.
3. A Writing whose stored layout names Written Arguments still renders it.
4. No marker, completion criterion or loose thread depends on a Writing having Written Arguments.
5. The text deleted is longer than any text added.

Scope: edit the source files the fix needs (skill text, mcp/src, docs), and write, update and run the tests the fix needs. Streamline and deburr first: solve the problem by removing, merging or simplifying what already exists, and consider an addition only once those ideas are exhausted. Anything added must be shorter than the text it makes unnecessary, and that text is deleted in the same change. Out of scope, because the orchestrating session runs them once after every spec lands: `build_plugin.py` and `check_plugin.py`. Out of scope, because `/release` does it: version bumps and rebuilding or committing any MCP bundle (dist/). Never build a `.plugin` archive.

## 9. Open questions

- How does a practitioner ask for Written Arguments on a Writing that should have one (for example "Add the Written Arguments to this Work Board")? The related spec's removal write may be reusable in reverse. If the design needs this, the orchestrating session asks Brahm.
- Does any completion criterion, pointer list or scan genuinely need Written Arguments for the requisition types? Confirm in the source before editing them.

## 10. Verify against HEAD before building

Check every path, line number and quotation in §2 against HEAD, mark each confirmed or not, and correct this spec before building on anything that moved.

## 11. Verification against HEAD (2026-11-05, at `caee95e6`)

Paths are under `.claude/skills/` (skills) and `source/lawyer/mcp/src/` (server).

| §2 claim | Result |
|---|---|
| `draft/references/CAN/BC/BCSC/Documents/notice-of-application.md` line 9 declares `"companions": ["written-arguments"]` | Confirmed |
| `application-response.md` line 9, same | Confirmed |
| `requisition-consent.md` line 8, same | Confirmed |
| `requisition-default-judgment.md` line 8, same | Confirmed |
| `shared/declared-layout.md` `companions` row and "`companions` members" text | Confirmed, lines 69 and 112 |
| `drafting-data/references/filing-checklists.md` line 150, "Companions" bullet | Confirmed |
| `create_writing` stores the type's layout; `resnapshot_writing` re-reads the type file | Confirmed (`submission/forms/layout-snapshot.ts`, `submission/writing-snapshot.ts`) |
| `terms-and-symbols.md` lines 160, 166, 366 | Confirmed (160 pointer lists, 166 Rendering of crossed-out material, 366 the 🧵 decision-log line) |
| `filing-checklists.md` lines 239, 254, 652 | Confirmed (239 the `loose-thread` key row, 254 the citation scan, 652 the WA numbering row) |

Corrections to §4, found in the server:

- All four types are `renderer: "bespoke"`. A bespoke Writing's render takes its companions from the live type file (`submission/forms/render-documents.ts`, `venueDocumentsForFiling` reads `composeFiller(...).block.companions`), not from the Writing's stored layout. Deleting the declaration alone would therefore drop Written Arguments from every existing Writing too, breaking §5's first constraint. The render must read companions from the stored layout.
- 🧵 *loose thread* (`markers.ts` `looseThreadMarker`, called in `render-notice-of-application.ts` and `render-application-response.ts`) fires on every item the form deploys that no Written Arguments pointer row deploys. On a Writing with no Written Arguments it would fire on every item, and the `open-items` criterion (`goal-criteria.ts`, slug `loose-thread`) could never be met. It must fire only when the Writing has Written Arguments.
- §9's second question: the requisition renderers read no Written Arguments pointer and raise no 🧵. Their criteria (`noting-up`, `open-items`, `counsel-review`) need Written Arguments only through 🧵, so none needs it once 🧵 is scoped as above.
- The citation scan reads the documents the render produced, so a Writing with no Written Arguments scans the venue document alone. No change needed beyond the text.
