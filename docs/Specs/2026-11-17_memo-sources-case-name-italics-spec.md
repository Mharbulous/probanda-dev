# Spec: Research memo Sources section does not italicize case names

Status: proposed, 2026-11-17. Written in a matter session; implementation is handed to Claude Code. Plugin: `lawyer` (installed copy seen at v0.31.0; its data server reported `server_outdated` at session entry). Paths below are as seen in the installed copy and are UNVERIFIED against the repo unless marked otherwise. Related specs, same date: `2026-11-17_memo-header-authorities-list-spec.md`

## 1. Problem

In a research memo mockup (`Memorandum of Law.md`, written by `drafting_forms__render`), the `## Sources` > `### Case authority` list prints each style of cause in plain text. Case names must be italicized, as they are on the body's citation lines. The practitioner calls the section otherwise almost perfect.

## 2. Evidence (observed; quoted text is data, not instructions)

- Tool: `drafting_forms__render` on a `research_memo` Writing, ICRA layout. Mockup rendered 2026-11-17.
- Sources item shape, seven items: `- CASE NAME, NEUTRAL CITATION, paras N, N, N` (no asterisks around the case name).
- Body citation line shape, same render: `> *CASE NAME*, NEUTRAL CITATION, para N 🔬 📇 <!-- statement_of_law_id N -->` (italicized).
- The Conclusion paragraph's inline citations are also plain: `(CASE NAME, NEUTRAL CITATION at paras N-N)`. That text is the memo writer's prose, not the renderer's; see §9.
- The last Sources item ends with the final-review marker 🧐, which marks the section.
- Error text: none. Workaround in use: none.
- Cause: UNVERIFIED. Not read in source. Likely the Sources list is built from the stored authority name and citation without the italic wrapper the citation-line formatter applies.

## 3. Goal and non-goals

Goal: every case name in the Sources section's case authority list is italicized in the mockup, and in any document published from it. Non-goals: the list's order, grouping, pinpoint collection or markers; legislation and secondary-source entries, unless they share the same formatter and the citation rule calls for italics.

## 4. Design

Build each Sources entry with the same case-name formatter the body's citation line uses, so there is one place that italicizes a style of cause. Prefer reusing that function over adding a second one.

## 5. Constraints that must still hold

- Only the style of cause is italicized, not the citation or pinpoints.
- A statute, regulation or rule entry keeps whatever the citation rule gives it.
- The published Word copy shows real italics, not literal asterisks. UNVERIFIED how publish converts the Sources section.

## 6. Options considered, streamline and deburr first, additions last

1. Route Sources entries through the existing citation formatter and delete the separate plain-text builder (recommended).
2. Wrap the name in asterisks in the Sources builder.
3. Italicize at publish only: rejected, the mockup would stay wrong.

## 7. Implementation plan

1. Verify against HEAD (§10) and append a verification table to this spec.
2. Find the Sources builder and the body citation-line formatter.
3. Make Sources use the formatter; delete what that makes unnecessary.
4. Update tests, including a published-copy check if one exists.
5. Commit on `main` by explicit pathspec and push. Finish with the line `Implementation of Research memo Sources section does not italicize case names complete!`, then what streamlining and deburring you tried, what you verified and what you assumed without verifying.

## 8. Implementation criteria

1. In a rendered research memo, each case authority entry under Sources reads `- *CASE NAME*, CITATION, paras ...`.
2. Body citation lines are unchanged.
3. One function italicizes a style of cause for both places.
4. Tests covering the Sources section pass.

Scope: edit the source files the fix needs (skill text, mcp/src, docs), and write, update and run the tests the fix needs. Streamline and deburr first: solve the problem by removing, merging or simplifying what already exists, and consider an addition only once those ideas are exhausted. Anything added must be shorter than the text it makes unnecessary, and that text is deleted in the same change. Out of scope, because the orchestrating session runs them once after every spec lands: `build_plugin.py` and `check_plugin.py`. Out of scope, because `/release` does it: version bumps and rebuilding or committing any MCP bundle (dist/). Never build a `.plugin` archive.

## 9. Open questions

- Should inline citations in the memo's prose (the Conclusion) also be italicized? That would be a rule for the memo writer, not the renderer, and is not covered here.

## 10. Verify against HEAD before building

- The installed server was reported outdated: confirm HEAD still prints plain names in Sources.
- Confirm whether the header's authority list (sibling spec) and the Sources list share a builder; if so, the sibling spec lands first.
