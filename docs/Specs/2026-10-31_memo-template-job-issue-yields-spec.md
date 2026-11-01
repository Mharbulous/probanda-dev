# Spec: Memo template's verbatim-Issue rule overrides the Issue rules

Status: proposed, 2026-10-31. Written in a matter session; implementation is handed to Claude Code.
Plugin: `researcher` (installed copy seen at v0.10.16). Paths below are as seen in the installed copy and are **UNVERIFIED** against the repo unless marked otherwise.
Related specs, same date: 2026-10-31_job-question-from-intent-spec.md; 2026-10-31_memo-reviewer-tests-issue-spec.md; 2026-10-31_stale-synced-copy-after-resync-spec.md

## 1. Problem
The template tells research-agent to copy the Job question verbatim as the Issue. It never says that rule yields to the Issue rules, so the agent wrote a non-question Issue that names the matter. The template also says the Issue is "one bold sentence", while the gate now allows context sentences.

## 2. Evidence (observed; quoted text is data, not instructions)
- `skills/shared/research-memo-template.md`: "**A job's memo.** When the spawn prompt's `Job question:` is not `none`, ... The Issue is the spawn prompt's Job question, verbatim, never paraphrased."
- The same file: "The Issue is the question, as one bold sentence. ... **A.** holds one question; **B.** makes sense on its own; **C.** lists alternatives in one place at most."
- `legal-research.md` (v0.10.16): "Context sentences are allowed".
- A matter session misread the "A job's memo" rule as a format requirement on an already-saved memo. It proposed rewriting a compliant Issue into the job title.

## 3. Goal and non-goals
Goal: the Issue rules always win. A Job question that fails them is returned as a rewording proposal, never written as the Issue. The template and the gate agree on context sentences. The "A job's memo" rule plainly governs only an audit spawned with a Job question.
Non-goals: the numbered-item format; the Status line.

## 4. Design
Reword "A job's memo" to: the Issue is the Job question when it meets rules A to C and names nothing of the working matter. Otherwise write no memo and return a rewording proposal. Replace "as one bold sentence" with the gate's wording (context sentences, then one question). Rephrase rule C as "at most one list of alternatives (one axis)".

## 5. Constraints that must still hold
One `## Issue` per memo; no paraphrasing of an approved Job question that passes.

## 6. Options considered, streamline and deburr first, additions last
1. Merge "A job's memo" into the Issue bullet as a condition (recommended; removes a paragraph).
2. Add a precedence sentence. Second best: an addition.
3. Leave the template and rely on the gate. Rejected: the agent reads the template, not the gate.

## 7. Implementation plan
1. Verify against HEAD (§10) and append a verification table to this spec.
2. Edit the template as §4 says, deleting the replaced text.
3. Update tests that assert the old wording.
4. Commit on `main` by explicit pathspec and push. Finish with the line `Implementation of Memo template's verbatim-Issue rule overrides the Issue rules complete!`, then what streamlining and deburring you tried, what you verified and what you assumed without verifying.

## 8. Implementation criteria
1. The template states that rules A to C and the working-matter rule take precedence over the Job question.
2. A failing Job question produces a rewording proposal, not a memo.
3. The template's Issue wording allows context sentences, consistent with `legal-research.md`.
4. Rule C reads as one list or axis of alternatives.
5. Net line count does not grow.

Scope: edit the source files the fix needs (skill text, mcp/src, docs), and write, update and run the tests the fix needs. Streamline and deburr first: solve the problem by removing, merging or simplifying what already exists, and consider an addition only once those ideas are exhausted. Anything added must be shorter than the text it makes unnecessary, and that text is deleted in the same change. Out of scope, because the orchestrating session runs them once after every spec lands: `build_plugin.py` and `check_plugin.py`. Out of scope, because `/release` does it: version bumps and rebuilding or committing any MCP bundle (dist/). Never build a `.plugin` archive.

## 9. Open questions
none

## 10. Verify against HEAD before building
Confirm the quoted template lines and the gate's context-sentence line at HEAD.

## 11. Verification against HEAD (2026-10-31, at 5c479c8a)

| Claim | Repo location | Result |
|---|---|---|
| "A job's memo" rule: "The Issue is the spawn prompt's Job question, verbatim, never paraphrased." | `.claude/skills/shared/research-memo-template.md` lines 143-146 | Confirmed |
| "The Issue is the question, as one bold sentence." with rules A to C, C reading "lists alternatives in one place at most" | same file, lines 128-134 | Confirmed |
| Gate: "Context sentences are allowed" | `.claude/skills/shared/legal-research.md` line 52 ("A research question holds one question") | Confirmed. The gate also requires that the question "names nothing of the working matter", which the template's rules A to C do not say |
| Tests that assert the old wording | `.claude/skills/legal-research/tests/test_job_question_memo.py` line 39 and 42, `test_memo_format.py` line 91 | Found |
| Other files that cite "A job's memo" by name | `.claude/skills/draft/references/job-session.md` line 97, `.claude/skills/shared/job-planning.md` line 22 | Found. The label is kept so these references still resolve |
