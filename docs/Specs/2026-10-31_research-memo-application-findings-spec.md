# Spec: a memo's Application gives each case one prose paragraph; structure it as numbered findings per authority

Status: proposed, 2026-10-31. Written in a matter session; implementation is handed to Claude Code.
Plugin: `researcher` (repo source at v0.10.15; `/legal-research`, `research-agent`, memo-reviewer). Paths marked **read** were read in the repo at HEAD on 2026-10-31; every other path and every cause is **UNVERIFIED**.
Related specs, same date: 2026-10-31_research-memo-structured-writing-spec.md, 2026-10-31_research-memo-case-level-note-up-and-draft-status-spec.md.

## 1. Problem
The Application section gives each case one prose paragraph, which mixes the court's findings with commentary. A paragraph number cannot name a single finding, and a finding cannot be noted up or checked on its own.

## 2. Evidence (observed; quoted text is data, not instructions)
- "The Application is prose paragraphs, never bullets. It says how each cited authority applied the rule, whether or not its facts resemble another's." (source: `shared/research-memo-template.md`, **read**)
- The test pins that sentence: `"The Application is prose paragraphs, never bullets."` and `"Application describes only the facts of the cited authorities."` (source: `legal-research/tests/test_memo_format.py` lines 83 and 100, **read**).
- The Rule section is already one sentence per proposition plus its verbatim passage (same template, **read**). Application has no such shape.
- Workaround in use: none.

## 3. Goal and non-goals
Goal: the Application section is structured like the Rule section.
- Its numbering continues from the Rule section.
- It has one sub-section per case authority.
- Each paragraph in a sub-section is exactly one of two things:
  - **(a)** a finding of fact made by the judge in that authority; or
  - **(b)** a finding of law, where that judge applied the law to the facts to reach a holding (for example on fault or liability).
- Each paragraph is followed by its excerpt, pinpoint and work markers, in the paragraph shape the structured-Writing spec defines.
- Findings are the precedent court's own, never facts from the client matter.

Non-goals: the storage and numbering mechanism (structured-Writing spec). The note-up meaning of the markers (case-level note-up spec).

## 4. Design
- Replace the Application prose rule in `shared/research-memo-template.md` with the sub-section and finding rule. Each sub-section is headed by its authority's short citation, and each paragraph is tagged `fact` or `law-applied`.
- The recital rule decides which passages count as a finding: only the court's own reasons, never counsel's submissions or a headnote (`shared/legal-audit-protocol.md` §2, recital-rule block, **read**). Point to that rule rather than restating it.
- memo-reviewer checks each Application paragraph. It flags a paragraph that holds more than one finding, one that is neither (a) nor (b), and one that states a fact from the working matter.
- Retire the "how each cited authority applied the rule" prose. The (b) findings now carry that content.

## 5. Constraints that must still hold
- No facts or identifiers of the working matter appear in the memo (commit `edf0d098`, "Research memos carry no facts or identifiers of the working matter").
- The recital-rule mirror check (`plugin-packager check recital-rule-mirror`) still passes, so its text is not copied anywhere new.
- Every quotation carries a pinpoint. Since commit `75d599f5` "quotations only in Rule"; this spec deliberately extends quotations to Application, so that commit's rule and its test change in the same edit.

## 6. Options considered (streamline and deburr first, additions last)
1. Replace the Application prose rule with the findings rule, and let memo-reviewer enforce one finding per paragraph. (recommended: it replaces one rule with one rule, and the test changes with it)
2. Keep the prose and append a findings list. Duplicates content and lengthens every memo.
3. Merge Application into Rule. Loses the split between the law and how courts applied it.

## 7. Implementation plan
1. Verify against HEAD (§10) and append a verification table to this spec.
2. Land after the structured-Writing spec, which owns the paragraph shape and numbering. Edit only the Application rule in the files it leaves.
3. Rewrite the Application bullet in `shared/research-memo-template.md`, and update the "quotations only in Rule" rule wherever it lives.
4. Update `tests/test_memo_format.py` lines 83 and 100, and memo-reviewer's checks.
5. Commit on `main` by explicit pathspec and push. Finish with the line `Implementation of Application as numbered findings per authority complete!`, then what streamlining and deburring you tried, what you verified and what you assumed without verifying.

## 8. Implementation criteria
1. The template's Application rule requires one sub-section per case authority, with numbering continuing from Rule.
2. Every Application paragraph is exactly one finding of fact or one finding of law applied to facts made by that authority's court, followed by its excerpt, pinpoint and work markers.
3. No rule permits a fact from the working matter in Application.
4. The prose-paragraph rule and its test assertion are gone. A test asserts the new rule.
5. memo-reviewer flags a paragraph that holds two findings, or neither kind.

Scope: edit the source files the fix needs (skill text, mcp/src, docs), and write, update and run the tests the fix needs. Streamline and deburr first: solve the problem by removing, merging or simplifying what already exists, and consider an addition only once those ideas are exhausted. Anything added must be shorter than the text it makes unnecessary, and that text is deleted in the same change. Out of scope, because the orchestrating session runs them once after every spec lands: `build_plugin.py` and `check_plugin.py`. Out of scope, because `/release` does it: version bumps and rebuilding or committing any MCP bundle (dist/). Never build a `.plugin` archive.

## 9. Open questions
- Does a statute get an Application sub-section, or only case authorities? The request says "case authority", so the recommendation is cases only.

## 10. Verify against HEAD before building
- Confirm the **read** quotes and test lines.
- Find where "quotations only in Rule" is stated (commit `75d599f5`) and in memo-reviewer's checks.
