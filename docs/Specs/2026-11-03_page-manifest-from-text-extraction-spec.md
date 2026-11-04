# Spec: a fully born-digital PDF needs no separate page check

Status: proposed, 2026-11-03. Written in a matter session; implementation is handed to Claude Code.
Plugin: `researcher` (installed copy seen at v0.12.1; `/legal-research`, `researcher:research-agent`) and `lawyer` (v0.21.9; `research_filing__law_folder_text`, `pdf_pages__images`). Paths below are as seen in the installed copy and are **UNVERIFIED** against the repo unless marked otherwise.
Related specs, same date: `2026-11-03_note-up-cap-heavily-cited-decisions-spec.md`, `2026-11-03_note-up-agent-batch-cap-spec.md`, `2026-11-03_research-agent-sources-staged-in-one-step-spec.md`, `2026-11-03_legal-research-rules-served-by-operation-spec.md`.

## 1. Problem

research-agent refuses to read any PDF without a page manifest from `pdf_pages__images`, even when `law_folder_text` has already extracted the PDF's text and would have reported any scanned page as `ocr_unavailable`. The caller makes one extra call per PDF to learn what extraction already implied.

## 2. Evidence (observed; quoted text is data, not instructions)

- Agent rule: "A PDF with no manifest is recorded UNREAD, never absent, with your confidence capped." (source: `researcher/agents/research-agent.md`, line 40)
- `law_folder_text`: "a PDF with any scanned or OCR'd page comes back `ocr_unavailable`" (source: `shared/legal-research.md`, duty 2).
- This run: 20 `pdf_pages__images` calls; all 20 PDFs (6 to 35 pages each) were `born_digital` on every page; `render_dir` null every time. All 20 had already extracted `status: ok`.
- The first audit spawn recorded every decision UNREAD for want of manifests.
- Workaround in use: the caller runs `pdf_pages__images` per PDF and pastes `{pages: "1-N"}` manifests.

## 3. Goal and non-goals

Goal: a PDF that `law_folder_text` extracts `ok` counts as born-digital throughout, with its page count, so no separate manifest call is needed for it.

Non-goals: weakening the scanned-page rule: a PDF with any scanned page still needs `pdf_pages__images` and page images.

## 4. Design

`law_folder_text` returns `page_count` and `scanned_pages: []` on each PDF row it extracts `ok` (it already classifies pages to decide `ocr_unavailable`). That row is the manifest. The agent rule accepts it; only an `ocr_unavailable` row sends the caller to `pdf_pages__images`.

## 5. Constraints that must still hold

- A scanned or OCR'd page is never read from its text layer (`/matter-data` design decision #71).
- Same classifier for both tools, so they cannot disagree.

## 6. Options considered, streamline and deburr first, additions last

1. **Recommended.** Add the two fields to the extraction row; delete the caller's per-PDF manifest step for `ok` rows from duty 2.
2. Agent infers born-digital from `status: ok` without new fields. Cheaper, but loses the page count.
3. Batch `pdf_pages__images` over a folder. Still a second pass.

## 7. Implementation plan

1. Verify against HEAD (§10) and append a verification table to this spec.
2. Expose the classifier's result on `law_folder_text` PDF rows, with a test on a born-digital and a mixed PDF.
3. Update duty 2 and the research-agent rule so an `ok` row is its manifest.
4. Commit on `main` by explicit pathspec and push. Finish with the line `Implementation of a fully born-digital PDF needs no separate page check complete!`, then what streamlining and deburring you tried, what you verified and what you assumed without verifying.

## 8. Implementation criteria

1. Each `ok` PDF row from `law_folder_text` carries its page count and an empty scanned-page list.
2. research-agent reads such a PDF's extracted text without a separate manifest.
3. A PDF with any scanned page is still `ocr_unavailable` and still read only from page images.

Scope: edit the source files the fix needs (skill text, mcp/src, docs), and write, update and run the tests the fix needs. Streamline and deburr first: solve the problem by removing, merging or simplifying what already exists, and consider an addition only once those ideas are exhausted. Anything added must be shorter than the text it makes unnecessary, and that text is deleted in the same change. Out of scope, because the orchestrating session runs them once after every spec lands: `build_plugin.py` and `check_plugin.py`. Out of scope, because `/release` does it: version bumps and rebuilding or committing any MCP bundle (dist/). Never build a `.plugin` archive.

## 9. Open questions

None.

## 10. Verify against HEAD before building

- `lawyer` MCP `research_filing__law_folder_text` and `pdf_pages__images` (shared classifier?).
- `researcher` research-agent agent file, line on page manifests; `shared/legal-research.md` duty 2.

## 11. Verification against HEAD (2026-11-03, at 22a3fdae)

| Item in the spec | Found at HEAD | Effect |
|---|---|---|
| `law_folder_text` classifies pages to decide `ocr_unavailable` | Confirmed. `extractText` (`source/lawyer/mcp/src/files/text-extract.ts`) calls `classifyPdfPages` before any text is read. `lawFolderText` (`source/lawyer/mcp/src/files/research-filing.ts`) reads it through `cachedExtract`. | The fields come from that run, with no second pass. |
| Same classifier for both tools | Confirmed. `classifyPdfPages` and `pdfPageImages` both call the private `classify` in `source/lawyer/mcp/src/files/extract/page-images.ts`. | Constraint §5 holds by construction. |
| `ok` PDF rows carry no page count today | Confirmed. `LawTextRow` has `file, text_path, bytes, method?, status, reason?`. `extractText` already returns `pages`, counted by a second reader (`pdfPages`). | The row takes the classifier's count, and `pages` changes to it. |
| Agent rule, "line 40" of `researcher/agents/research-agent.md` | Confirmed at line 50 of `source/researcher/agents/research-agent.md`, not 40. | Edited there. |
| Duty 2 of `shared/legal-research.md` | Confirmed at `.claude/skills/shared/legal-research.md`, lines 110 to 143: the caller calls `pdf_pages__images` for each PDF in the folder. | Edited there. |
| Other text stating the rule (not in the spec) | The same "no manifest means UNREAD" rule is in `.claude/skills/shared/legal-audit-protocol.md` (tier 3) and `.claude/skills/shared/legal-audit-scoped.md` (matter folder), which research-agent also obeys. `/matter-data` design decision #71 and the `research_filing__law_folder_text` and `pdf_pages__images` tool descriptions describe it too. | All change with the rule, or the agent would still refuse the row. |
| `mode: case_brief` (not in the spec) | `.claude/skills/case-brief/SKILL.md` step 5 makes the same extra call for a PDF. `case-brief/agents/brief.md` and `source/researcher/agents/brief-reviewer.md` already read a `Decision text:` path. | Step 5's two routes merge into one. The agents need no change. |
| Pattern mode of `law_folder_text` | Its `searched` rows hand over matching lines and no text file, so they are no manifest for a read. | They stay as they are. |

No finding changes the design, and §9 stays empty.
