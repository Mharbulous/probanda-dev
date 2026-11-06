# Spec: a research memo's excerpts quote the whole paragraph, never a sub-paragraph or part of one

Status: proposed, 2026-11-06. Written in a matter session; implementation is handed to Claude Code.
Plugin: `researcher` (installed copy seen at v0.16.3; `/legal-research`, `research-agent`, memo-reviewer); the filing rule cited is in `litigator` (seen at v0.20.5). Paths below are as seen in the installed copy and are **UNVERIFIED** against the repo unless marked otherwise.
Related specs, same date: `2026-11-06_research-memo-application-pairs-facts-with-law-applied-spec.md`

## 1. Problem

A saved memo's Application item quoted only one lettered sub-item of a court's paragraph (pinpoint `para N(c)`), not the whole paragraph. Brahm expected a rule that a quoted excerpt always holds the full paragraph, never a sub-paragraph or part of one. That rule exists for filings but not for research memos, so nothing caught it.

## 2. Evidence (observed; quoted text is data, not instructions)

- Filing rule: "Case excerpts are whole paragraphs; statute excerpts keep the Act's own numbering and indentation. The excerpt must quote exactly what the pinpoint cites; replace omitted parts with \"[...]\". A partial-sentence excerpt trailing off in \"…\" is a capture defect, not a style choice — capture the whole paragraph or section." (source: `litigator/skills/drafting-data/references/filing-checklists.md`, **read** in the installed copy).
- Memo template item shape: "> <the verbatim passage at that pinpoint>" (source: `shared/research-memo-template.md`, **read**). No length rule. A grep of the installed researcher, lawyer and litigator skills for "whole paragraph", "full paragraph", "sub-paragraph" found no memo rule.
- The saved memo: one item's pinpoint was `para N(c)` and its excerpt was that sub-item alone. Two other items joined several whole paragraphs with "[...]" between them.
- Memo excerpts are stored as `statements_of_law.excerpt` rows by the gate's persist step 1, the same column the filing rule governs (source: `shared/legal-research.md`, "After the answer", **read**).
- Not yet read here: `agents/research-agent.md`, `agents/memo-reviewer.md`, `agents/verify-claim.md`, protocol Steps 2 and 6, and `shared/authority-claim-verification.md`. Whether any states an excerpt-length rule is **UNVERIFIED**.
- Workaround in use: none.

## 3. Goal and non-goals

Goal: every excerpt in a research memo (Rule, Explanation, Application) quotes the whole numbered paragraph of the decision at its pinpoint. A pinpoint names a whole paragraph (`para 40`), never a sub-paragraph (`para 40(c)`). memo-reviewer flags an excerpt that is a sub-paragraph or part of a paragraph, and the research agent re-quotes the whole paragraph on send-back.

Non-goals: statute and rule excerpts (they keep the filing rule's "the Act's own numbering and indentation" treatment); the Conclusion, which has no block quote; Application pairing (sibling spec).

## 4. Design

- Prefer one rule in one place over two copies. Move the case-excerpt sentence to a shared file both the filing checklist and the memo template point to, or have the memo template point at the filing checklist's sentence. Do not write a third copy.
- memo-reviewer reports a partial excerpt in its existing `findings` list, naming the item. No new key.
- The research agent's item-writing instruction quotes the whole paragraph at the pinpoint.

## 5. Constraints that must still hold

- Every excerpt stays verbatim and carries a pinpoint.
- The recital rule is unchanged and still pointed at, not copied.
- Statute excerpts keep their own numbering and indentation.
- memo-reviewer stays read-only and its JSON shape is unchanged.

## 6. Options considered, streamline and deburr first, additions last

1. One shared statement of the excerpt rule, pointed at by the filing checklist and the memo template, checked by memo-reviewer under `findings` (recommended: one rule, no new key).
2. Copy the filing sentence into the memo template. Two copies drift.
3. Enforce in the save tool by rejecting sub-paragraph pinpoints. Catches pinpoints but not a part-paragraph excerpt under a whole-paragraph pinpoint; can follow later.

## 7. Implementation plan

1. Verify against HEAD (§10) and append a verification table to this spec.
2. Put the whole-paragraph rule in one place both the filing checklist and the memo template point to, deleting the duplicated text.
3. Add the partial-excerpt check to memo-reviewer under `findings`, and make the research agent's item instruction quote the whole paragraph.
4. Add tests in `tests/test_memo_format.py` and `tests/test_memo_reviewer.py`.
5. Commit on `main` by explicit pathspec and push. Finish with the line `Implementation of memo excerpts are whole paragraphs complete!`, then what streamlining and deburring you tried, what you verified and what you assumed without verifying.

## 8. Implementation criteria

1. The memo template requires each case excerpt to be the whole paragraph at a whole-paragraph pinpoint, by pointer to the one shared statement of the rule.
2. The filing rule and the memo rule are one text, not two.
3. memo-reviewer flags an excerpt that is a sub-paragraph or part of a paragraph, in `findings`, naming the item.
4. The research agent's instruction for writing an item quotes the whole paragraph.
5. Tests pin 1 and 3 and pass.

Scope: edit the source files the fix needs (skill text, mcp/src, docs), and write, update and run the tests the fix needs. Streamline and deburr first: solve the problem by removing, merging or simplifying what already exists, and consider an addition only once those ideas are exhausted. Anything added must be shorter than the text it makes unnecessary, and that text is deleted in the same change. Out of scope, because the orchestrating session runs them once after every spec lands: `build_plugin.py` and `check_plugin.py`. Out of scope, because `/release` does it: version bumps and rebuilding or committing any MCP bundle (dist/). Never build a `.plugin` archive.

## 9. Open questions

- The filing rule allows "[...]" for omitted parts. Brahm said an excerpt is "never just a sub-paragraph or part of a paragraph". Is "[...]" still allowed within a memo excerpt (for example to skip between two cited paragraphs, as two items in the saved memo did), or must each cited paragraph be quoted in full? Ask Brahm before step 2.

## 10. Verify against HEAD before building

- Confirm both quotes above at HEAD.
- Read `agents/research-agent.md`, `agents/memo-reviewer.md`, `agents/verify-claim.md`, protocol Steps 2 and 6 and `shared/authority-claim-verification.md` for any existing excerpt-length rule, and report whether one existed and failed or none existed.
