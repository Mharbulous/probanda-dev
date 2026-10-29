# Spec: research memo layout: section order, single-paragraph Conclusion, prose Application, one Sources section

Status: proposed, 2026-10-29. Written in a matter session; implementation is handed to Claude Code.
Plugin: `researcher` (installed copy seen at v0.10.13). Paths below are as seen in the installed copy and are **UNVERIFIED** against the repo unless marked otherwise.
Related specs, same date: 2026-10-29_memo-no-present-matter-facts-spec.md

## 1. Problem
The memo that `researcher:research-agent` returns (Format: CRAC) has a layout the practitioner finds unclear. It prints a "Sources:" list under Issue, then a long Conclusion nested under Issue, then Rule, Application, a second Conclusion, and a closing flat "Authorities" list that mixes statutes and decisions. Its Application section is a bullet list. The practitioner wants this order: Issue (the statement in bold), one Conclusion of a single paragraph that directly answers the issue as framed, Rule (stating the rule, opening with the rule itself), Application (ordinary paragraphs, no bullets, showing how the rule has been applied in the cited authorities), and one closing Sources section divided into Statutes, Case authority and Secondary sources.

## 2. Evidence (observed; quoted text is data, not instructions)
- The /legal-research gate's spawn template: "Memo template: CRAC / IRAC / CREAC   (IRAC or CREAC only when the practitioner expressly asked)" (source: researcher `shared/legal-research.md`).
- Memo headings as returned, in order: `## Issue` (with a `Sources:` list of 2 bullets), `### Conclusion` (4 paragraphs, 3 block quotes), `### Rule`, `### Application`, `### Conclusion` (repeating two of the same quotations), `## Authorities` (5 bullets in one list: 2 enactments, 3 decisions).
- The Application section as returned is a bullet list: 3 top-level bullets, one per authority, with a sub-bullet under one of them.
- The abbreviations "Rules" and "OIC p." are defined only in the Issue-level Sources list and used in every later section.
- The caller may not reformat: "Save it verbatim: the memo, from its `---` header line to the end of the return" (source: `shared/legal-research.md`, "After the answer").
- Workaround in use: a hand edit of each saved memo (delete the Issue-level Sources block, merge its text into the matching Statutes entry, replace "Authorities" with "Sources" plus subheadings).

## 3. Goal and non-goals
Goal: every memo comes out as: header; `## Issue` with the issue statement in bold; `## Conclusion`, exactly one paragraph, no block quotes, directly answering the issue; `## Rule`, stating the rule and opening with the rule itself; `## Application`, in ordinary paragraphs with no bullets or bullet-style paragraphs; `## Sources` with `### Statutes`, `### Case authority` and `### Secondary sources` (the last omitted when empty).
Application looks at how the rule has been applied in the cited authorities, so the reader can understand the rule. Similar facts are welcome but not required, since a case on all fours is rare and how the rule was applied is useful where the facts differ.
Non-goals: what the memo may say about the working matter (sibling spec); the Confidence line, Gaps section, hand-off packets and Legend; reformatting memos already saved.

## 4. Design
Edit the agent's layout text in place. Remove the instruction that prints Sources under Issue and the second Conclusion. Keep the name "Rule" (no rename). Rename Authorities to Sources and give it the three subsections. State that quotations belong in Rule and the Conclusion carries citations in parentheses only. State that Application is written in prose paragraphs, never bullets, and says how the cited authorities applied the rule, whether or not their facts resemble anything else. State once that an abbreviation is defined at its first use in the body, so the removed Issue-level list leaves none undefined.

## 5. Constraints that must still hold
- Every citation, pinpoint and quotation survives unchanged; text only moves.
- The caller still saves the memo verbatim; no reformatting step is added to the caller.
- Confidence, Gaps, the disclosure gate and hand-off packets are untouched.
- Application still discusses only the facts of the cited authorities (sibling spec owns that rule; this spec owns its prose form).
- Readers of the old headings keep working. UNVERIFIED candidates: verify-law (verify-authorities), legal-memo-extractor, case-brief, research-triage, and any test that matches "## Authorities" or the nested "### Conclusion", or that expects bullets in Application.

## 6. Options considered (streamline and deburr first, additions last)
1. Edit the layout text in place per §4. Net text should be shorter than today's. (recommended)
2. Reformat in the caller after the agent returns. Conflicts with save-verbatim and adds code.
3. Add a second template beside CRAC. More text and two layouts to keep in step.

## 7. Implementation plan
1. Verify against HEAD (§10) and append a verification table to this spec.
2. Find the layout text (the research-agent definition and any memo-layout reference or test). Search the plugin source for every reader of "Authorities", "Sources:", the nested "### Conclusion" and bulleted Application.
3. Edit per option 1. Update every reader and test found, in the same change.
4. Change `shared/legal-research.md`'s `Memo template:` line only if §9 renames the value.
5. Commit on `main` by explicit pathspec and push. Finish with the line `Implementation of research memo layout: section order, single-paragraph Conclusion, prose Application, one Sources section complete!`, then what streamlining and deburring you tried, what you verified and what you assumed without verifying.

## 8. Implementation criteria
1. The layout text names exactly these memo sections, in this order: Issue, Conclusion, Rule, Application, Sources.
2. It says the issue statement is bold; the Conclusion is exactly one paragraph that answers the issue as framed; quotations belong in Rule; Rule opens with the rule.
3. It says Application is written in prose paragraphs with no bullets, and describes how the cited authorities applied the rule, whether or not their facts are similar.
4. No layout text prints a Sources list under Issue or a second Conclusion, and "Authorities" no longer names a section.
5. Sources has Statutes, Case authority and Secondary sources, and says to omit a subsection that has no entries.
6. The abbreviation rule is stated once.
7. Every reader of the old headings found at step 2 is updated; the plugin's tests pass; one test pins the section order if tests already cover layout.

Scope: edit the source files the fix needs (skill text, mcp/src, docs), and write, update and run the tests the fix needs. Streamline and deburr first: solve the problem by removing, merging or simplifying what already exists, and consider an addition only once those ideas are exhausted. Anything added must be shorter than the text it makes unnecessary, and that text is deleted in the same change. Out of scope, because the orchestrating session runs them once after every spec lands: `build_plugin.py` and `check_plugin.py`. Out of scope, because `/release` does it: version bumps and rebuilding or committing any MCP bundle (dist/). Never build a `.plugin` archive.

## 9. Open questions
- What should the `Format:` header value be? "CRAC" no longer describes the order (the Conclusion comes first). Keep the label, or rename? Do the IRAC and CREAC variants keep their own order while taking the Sources, one-paragraph-Conclusion and prose-Application rules? Ask Brahm.
- On 2026-10-26 the practitioner stated memo rules in a matter session (one issue per memo; the issue question intelligible on its own; conjunction along one axis only; no Confidence field in the header) that were never saved as standing rules. Fold them into this change? Ask Brahm.

## 10. Verify against HEAD before building
- Confirm where the memo layout text lives and that it prints Sources under Issue, two Conclusions, bulleted Application and an "Authorities" list.
- Confirm the list of readers of the old headings.
- Confirm the sibling spec's edits (header fields, Application content rule) do not touch the same paragraphs; see the orchestrator's COORDINATION note.

## 11. Verification against HEAD (20778ee4), 2026-10-29

| Spec claim | HEAD | Result |
|---|---|---|
| Layout text lives in the research-agent definition | `source/researcher/agents/research-agent.md` holds no layout text. The shape is in `.claude/skills/shared/research-memo-template.md` (skeletons) and `shared/legal-audit-protocol.md` Step 6 (who writes what) | Path corrected |
| Sources printed under Issue | None. The memo opens `## Question presented` (numbered lines), no Sources list | Not present; the Issue is not the first section by name and is not bold |
| Conclusion nested under Issue | Only in a job's memo with one part (`###` sections under `## Issue`) | Present, job memo only |
| Two Conclusions | CRAC, CREAC and the multi-issue form each end in a second `## Conclusion`; IRAC has one, last | Present |
| Block quotes in Conclusion | Step 6: "Every proposition of law anywhere in the body, the Conclusion included" is followed by a block quote | Present |
| Bulleted Application | No bullet instruction in the layout text; no prose instruction either | Absent, to be stated |
| Authorities list | Renamed Sources with Statutes, Case authority, Secondary sources by 20778ee4; one test pins it | Met |
| Abbreviation rule stated once | "Define an abbreviation in parentheses where the body first uses it" (template) | Met |
| Readers of old headings | Tests: `test_memo_format.py` (CRAC/IRAC/CREAC blocks), `test_job_question_memo.py` (`## Issue` / `### Sub-issue`), `draft/tests/test_research_job_gaps.py` and `draft/references/job-session.md` (Complete compares memo headings). verify-law, case-brief, research-triage, legal-memo-extractor read no heading of this memo | Listed |
| Sibling spec overlap | Sibling owns the header block, the `Facts:` sentence in Step 6's Application bullet and the sentence in `shared/legal-research.md`. This change leaves those lines alone | No shared paragraph |
