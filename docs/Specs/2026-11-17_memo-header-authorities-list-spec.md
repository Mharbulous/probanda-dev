# Spec: Research memo mockup lists authorities in its YAML header

Status: proposed, 2026-11-17. Written in a matter session; implementation is handed to Claude Code. Plugin: `lawyer` (installed copy seen at v0.31.0; its data server reported `server_outdated` at session entry). Paths below are as seen in the installed copy and are UNVERIFIED against the repo unless marked otherwise. Related specs, same date: `2026-11-17_memo-sources-case-name-italics-spec.md`

## 1. Problem

The mockup of a research memo Writing (`Memorandum of Law.md`, written by `drafting_forms__render`) carries an `Authorities cited:` key in its YAML header. The practitioner's rule: authorities cited are never listed in the YAML header. The body of the memo (propositions, excerpts, citation lines) is correct.

## 2. Evidence (observed; quoted text is data, not instructions)

- Tool: `drafting_forms__render` on a `research_memo` Writing, ICRA layout. Mockup rendered 2026-11-17, board revision 116.
- The header runs from line 1 to line 45 of a 337-line file. Lines 13 to 44 are the key `Authorities cited:` and 31 list items, one per stored statement of law, not one per authority: seven decisions produce 31 lines, and the same decision and paragraph appears up to three times.
- Each item has this shape: `- > *CASE NAME*, NEUTRAL CITATION, para N 🔬📇 <!-- statement_of_law_id N -->`. It is the body's citation line (block-quote marker, italics, work markers, hidden id comment) copied into the header.
- An item beginning `>` is not a plain YAML string, so the header may not parse as YAML. UNVERIFIED: not parsed in session.
- Other header keys seen, for context only, no change asked: `Matter no`, `Matter Description`, `Client Name`, `Client no`, `Document Type`, `Document Name`, `Document Date: ________`, `Venue:` (empty), `Proceeding File no:` (empty), `Revision`, `Rendered`.
- The same authorities are listed correctly, once each with collected pinpoints, in the body's `## Sources` > `### Case authority` section.
- Error text: none. Workaround in use: none; the practitioner reads past the header.
- Cause: UNVERIFIED. Not read in source. Likely the header builder collects every citation line of the Writing, which suits a filing's list of authorities, and the research memo type inherits it.

## 3. Goal and non-goals

Goal: a research memo mockup's YAML header holds no list of authorities. Non-goals: changing the body, the Sources section, the work markers or the other header keys. Whether other Writing types should keep such a list is an open question (§9), not decided here.

## 4. Design

Remove the `Authorities cited` key from the header the renderer writes for a research memo. Prefer deleting the code that emits it over adding a per-type switch, if no Writing type needs it.

## 5. Constraints that must still hold

- A session still orients from the mockup's work markers; no marker may be lost from the body.
- The Sources section still lists every cited authority.
- The hidden `statement_of_law_id` comments stay on the body's citation lines.
- Any reader of the header (publish, board card, Legal Research page) that consumed `Authorities cited` still works. UNVERIFIED whether any does.

## 6. Options considered, streamline and deburr first, additions last

1. Delete the header's authorities list for every Writing type (recommended, if no reader depends on it).
2. Delete it for research memos only.
3. Keep a list but de-duplicate it and strip markers: rejected, the practitioner's rule is that it is never in the header.

## 7. Implementation plan

1. Verify against HEAD (§10) and append a verification table to this spec.
2. Find where the mockup header is built and where `Authorities cited` is emitted.
3. Find every reader of that key.
4. Remove the emission (and dead readers), update tests.
5. Commit on `main` by explicit pathspec and push. Finish with the line `Implementation of Research memo mockup lists authorities in its YAML header complete!`, then what streamlining and deburring you tried, what you verified and what you assumed without verifying.

## 8. Implementation criteria

1. A rendered research memo mockup's header contains no `Authorities cited` key and no citation lines.
2. The body and the Sources section of the same render are byte-identical to before, apart from the header.
3. No code path still reads the removed key.
4. Tests covering the memo header pass.

Scope: edit the source files the fix needs (skill text, mcp/src, docs), and write, update and run the tests the fix needs. Streamline and deburr first: solve the problem by removing, merging or simplifying what already exists, and consider an addition only once those ideas are exhausted. Anything added must be shorter than the text it makes unnecessary, and that text is deleted in the same change. Out of scope, because the orchestrating session runs them once after every spec lands: `build_plugin.py` and `check_plugin.py`. Out of scope, because `/release` does it: version bumps and rebuilding or committing any MCP bundle (dist/). Never build a `.plugin` archive.

## 9. Open questions

- Does any other Writing type (a filing, a letter) want an authorities list in its header, or is the rule "never" for all types? The practitioner's words were "not ever".

## 10. Verify against HEAD before building

- The installed server was reported outdated: confirm HEAD still emits the key before changing anything.
- Confirm which module builds the header and whether the list is per statement of law.

## 11. Verification against HEAD (2026-11-17, at da9d1edf)

| Claim in this spec | At HEAD | Where |
|---|---|---|
| HEAD still emits the `Authorities cited` key | Yes. `renderGeneral` passes it as the first of the header's four optional list fields | `source/lawyer/mcp/src/submission/forms/render-general.ts` lines 235-238, 271 |
| The module that builds the header | `renderGeneral` builds it through `frontmatterHeader` (`components.ts`). Every `general` Writing renders through it (`render-documents.ts` line 70), the research memo kinds and letters alike | `render-general.ts`, `render-documents.ts` |
| The list is one item per statement of law, not per authority | Yes. One item per `filing_law` row (`fetchFilingLaw`), each the body's citation line, its markers and a `statement_of_law_id` comment (`authorityCitedLine`) | `render-general.ts` lines 140-146, 238 |
| The list is research-memo only | No. It is the general renderer's list for every `general` Writing. For a letter it is the only place a prose-cited statement prints (#1214), and it carries the #1231 "Authority not confirmed" line for an unsent Writing that declares `primary-authority` | `render-general.ts` lines 115-134; `test/prose-cited-authority.db.test.mjs` (a letter) |
| No reader depends on the list (§5) | No. Rendering a header item is what records each linked statement's markers (📜 📍 🔬 📇 🏅) on the marker inventory and computes its 🧐 review marker. A memo body's item lines deliberately record nothing, relying on the header, so the Work Board's counts read the header's recording | `render-general.ts` lines 140-145; `projections.ts` lines 163-176 (comment: "The markers are not recorded here") |
| Other mentions | `filed-face.ts` (comment only: the filed face drops the whole header), `law-statement-line.ts` (comment only: shares the citation line), `symbol-table.ts` (glossary text naming the block), `skills/drafting-data/references/filing-checklists.md` §13 "Authorities cited" and `terms-and-symbols.md` (documentation of the block) | as named |
| Tests | `render-general.db.test.mjs`, `prose-cited-authority.db.test.mjs` (7 assertions on the block, letters), `filed-face.db.test.mjs`, `legend.unit.test.mjs`, `saved-brief.db.test.mjs` | `source/lawyer/mcp/test/` |

Result: §4 option 1 (delete for every type) would remove a letter's only rendering of its prose-cited authorities, the #1231 hold line and the marker recording the Work Board counts. Option 2 (memo only) needs the memo body's item lines to take over the marker and 🧐 recording. §9 decides between them, so it goes back to the practitioner before building.
