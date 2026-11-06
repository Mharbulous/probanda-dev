# Spec: let the practitioner remove Written Arguments from a Work Board by saying so

Status: proposed, 2026-11-05. Written in a matter session; implementation is handed to Claude Code.
Plugin: `litigator` (installed copy seen at v0.20.4) and the `lawyer` data server (seen at v0.25.4). Paths below are as seen in the installed copy and are **UNVERIFIED** against the repo unless marked otherwise.
Related specs, same date: `2026-11-05_written-arguments-not-a-default-companion-spec.md`

## 1. Problem

Many existing Writings already carry Written Arguments, and there is no way to take it off one. The practitioner asked a session to delete the Written Arguments mockup of one Work Board and remove it from the board. The session could not: the document comes from the layout the Writing stored when it was created, and the next render would write it back. The practitioner wants to say something like "Remove the Written Arguments from this Work Board" and have Probanda do it.

## 2. Evidence (observed; quoted text is data, not instructions)

- `drafting_data__create_writing` stores the type's layout (`layout_snapshot`) on the Writing. Its description calls it "the one door for a new Writing, because only this tool writes its stored layout".
- `drafting_data__resnapshot_writing` "resolves the stored kind again from /draft's knowledge tree, reads the type file" and rewrites the layout, so it restores the companion the type declares. It runs only on the practitioner's explicit instruction and only while the Writing is drafting.
- `drafting_data__execute` refuses to create a Writing or re-snapshot one; no tool removes one companion from one Writing.
- `drafting_forms__render` output for one Writing listed three documents (the notice, `Written_arguments`, `Work_board`). Its timings include a phase named "archive dropped files", so the renderer already archives the file of a document that leaves the layout.
- `shared/declared-layout.md`: row `companions` reads "The companion documents rendered with this type."
- The skill text for `/work` and `/draft` has no operation for removing a document from a board.
- Workaround in use: none. The session left the document and said it could not be removed per Writing.

## 3. Goal and non-goals

Goal: on the practitioner's word ("Remove the Written Arguments from this Work Board", or close variants), Probanda removes Written Arguments from that Writing's stored layout, the next render archives its file instead of rewriting it, and the board no longer draws it. Nothing is lost for good.

Non-goals: stopping new Writings getting it (the related spec); removing any of the four boards; touching a sent or retired Writing.

## 4. Design

A gatekeeper write that removes one named companion from one drafting Writing's stored layout (a new narrowly scoped operation, or an option on the existing re-snapshot, whichever is shorter), refused for a sent or retired Writing. A short rule in the skill that serves a Work Board's bookkeeping routes the phrase to it, names the Writing when a merged board has several, renders afterwards and presents the board. The file is archived by the renderer, not deleted. If the Written Arguments holds any drafted content (pointer lists, submissions), the practitioner is told so in one line and the content stays recoverable. That choice is an open question (§9).

## 5. Constraints that must still hold

- Only the practitioner's instruction triggers it, and never on a sent or retired Writing.
- Nothing is deleted irreversibly; the file is archived.
- The Writing's other documents, the four boards and the stored layout's other fields are unchanged.
- No deadline, law or client content enters the rule text.

## 6. Options considered (streamline and deburr first, additions last)

1. Extend the existing re-snapshot with a "without <companion>" option, reuse its guards and add one routing rule (recommended: fewest new surfaces).
2. A new dedicated removal tool. Clearer name, more surface.
3. Edit the stored layout through the generic write. Refused by the gatekeeper's own guard and breaks its single door.

## 7. Implementation plan

1. Verify against HEAD (§10) and append a verification table to this spec.
2. Read the layout write path and the renderer's dropped-file handling. Confirm a layout without the companion is archived, not overwritten.
3. Implement the removal under the guards in §5, with tests: drafting Writing succeeds; sent and retired Writings refuse; the file is archived; another Writing on the same board is untouched.
4. Add the routing rule to the skill that serves a Work Board's bookkeeping, in a few lines, and delete any text it makes unnecessary.
5. Commit on `main` by explicit pathspec and push. Finish with the line `Implementation of removing Written Arguments from a Work Board complete!`, then what streamlining and deburring you tried, what you verified and what you assumed without verifying.

## 8. Implementation criteria

1. Saying "Remove the Written Arguments from this Work Board" on a drafting Writing removes it from the stored layout and the next render writes no Written Arguments file.
2. The earlier file is archived, not deleted.
3. A sent or retired Writing refuses, with a plain one-line reason.
4. On a board holding several Writings, the rule names which Writing it acts on instead of guessing.
5. The new text is shorter than the text it makes unnecessary, or nothing was made unnecessary and the addition is as small as the routing rule needs.

Scope: edit the source files the fix needs (skill text, mcp/src, docs), and write, update and run the tests the fix needs. Streamline and deburr first: solve the problem by removing, merging or simplifying what already exists, and consider an addition only once those ideas are exhausted. Anything added must be shorter than the text it makes unnecessary, and that text is deleted in the same change. Out of scope, because the orchestrating session runs them once after every spec lands: `build_plugin.py` and `check_plugin.py`. Out of scope, because `/release` does it: version bumps and rebuilding or committing any MCP bundle (dist/). Never build a `.plugin` archive.

## 9. Open questions

- If the Written Arguments already holds drafted submissions or pointer lists, should removal ask first, or just archive and say so? The orchestrating session asks Brahm if the design needs it.
- Should the reverse ("Add the Written Arguments to this Work Board") be built here or in the related spec? Keep it out unless the design needs it.

## 10. Verify against HEAD before building

Check every path, tool behaviour and quotation in §2 against HEAD, mark each confirmed or not, and correct this spec before building on anything that moved.

## 11. Verification against HEAD (2026-11-05, at caee95e6)

| §2 item | Status | Where, and correction |
|---|---|---|
| `create_writing` stores `layout_snapshot`; "the one door for a new Writing, because only this tool writes its stored layout" | Confirmed | `source/lawyer/mcp/src/schema/submission-data.ts` line 106 |
| `resnapshot_writing` "resolves the stored kind again from /draft's knowledge tree, reads the type file", runs only on explicit instruction and only while drafting | Confirmed | `schema/submission-data.ts` lines 921-931, `src/submission/writing-snapshot.ts` (`notDrafting`, v32 trigger `guard_filings_layout_frozen`). It rewrites the whole layout from the type file, so it cannot remove one companion while keeping the stored layout's other fields |
| `execute` refuses to create or re-snapshot a Writing; no tool removes one companion | Partly confirmed | `execute`'s description routes both to their tools, but no code guard was found refusing either a `filings` INSERT or an `UPDATE filings SET layout_snapshot` through `execute` while drafting. No tool removes one companion: confirmed |
| Render lists the notice, `Written_arguments`, `Work_board`; phase "archive dropped files" archives a document that leaves the layout | Confirmed, with a correction | `forms/render.ts` line 385, tested by `test/mockup-dropped-files.db.test.mjs`. The Work Board is no document of the filing (#1365). **Correction:** a bespoke Writing (all four BCSC types) takes its companions from the live type file (`render-documents.ts` line 99, `composeFiller(...).block.companions`), not from its stored layout. Only a general Writing reads them from the stored layout. So editing the stored layout alone would not stop a bespoke Writing rendering Written Arguments: the bespoke branch must read the stored layout's `companions` |
| `shared/declared-layout.md` row `companions`: "The companion documents rendered with this type." | Confirmed | line 69 |
| `/work` and `/draft` have no operation for removing a document from a board | Confirmed | no match in `work/`, `draft/` or `drafting-data/`. The bookkeeping skill is `/work` (`work/SKILL.md` §1, "applies the board's bookkeeping"); its reply routes are `work/references/opening-routes.md` |
