# Spec: research memo prints the whole Issue in bold

Status: proposed, 2026-11-03. Written in a matter session; implementation is handed to Claude Code.
Plugin: `researcher` (installed copy seen at v0.12.1; `researcher:research-agent`, `researcher:memo-reviewer`). Paths below are as seen in the installed copy and are **UNVERIFIED** against the repo unless marked otherwise.
Related specs, same date: `2026-11-03_research-memo-holds-only-what-the-issue-asks-spec.md`.

## 1. Problem

A memo's Issue prints its context sentences in plain text and only the question in bold. The practitioner wants the whole Issue in bold, context sentences included.

## 2. Evidence (observed; quoted text is data, not instructions)

- Saved memo's Issue: one context sentence in plain text, then `**<question>?**`.
- Template: "The Issue is the question: any context sentences, then the one question in bold." (source: `shared/research-memo-template.md`, "In every format").
- An earlier spec set this wording: `2026-10-31_memo-template-job-issue-yields-spec.md` replaced "as one bold sentence" with the gate's context-sentences wording.
- Workaround in use: none.

## 3. Goal and non-goals

Goal: the whole Issue, its context sentences and its question, prints in bold in every memo format.

Non-goals: no change to rules A to D, to what the Issue may hold, or to the job's stored title and intent, which carry no markup.

## 4. Design

Change the template line to say the whole Issue is in bold. If a renderer, a save path or a test adds or asserts the bold itself (UNVERIFIED: the memo's `issue` prose slot rendered by `drafting_forms__render` as `General_writing`), change it there so bold is applied in one place only.

## 5. Constraints that must still hold

- The Issue stays the Job question verbatim, character for character, apart from markup.
- memo-reviewer's rule A to D test reads the Issue's words, not its markup.
- A job title's `Legal research: ` prefix plus intent check is unaffected.

## 6. Options considered, streamline and deburr first, additions last

1. **Recommended.** Reword the one template line: "The Issue is the question, in bold: any context sentences, then the one question."
2. Bold the Issue in the renderer and strip it from the template. This only makes sense if the renderer already handles Issue markup.

## 7. Implementation plan

1. Verify against HEAD (§10) and append a verification table to this spec.
2. Land after `2026-11-03_research-memo-holds-only-what-the-issue-asks-spec.md`, which edits the same template file. Pull first.
3. Reword the template line, and fix any renderer or test that asserts question-only bold.
4. Commit on `main` by explicit pathspec and push. Finish with the line `Implementation of research memo prints the whole Issue in bold complete!`, then what streamlining and deburring you tried, what you verified and what you assumed without verifying.

## 8. Implementation criteria

1. The template states that the whole Issue, context sentences and question, is in bold.
2. No other rule file or test requires bold on the question alone.
3. Bold is applied in exactly one place: the template or the renderer, not both.

Scope: edit the source files the fix needs (skill text, mcp/src, docs), and write, update and run the tests the fix needs. Streamline and deburr first: solve the problem by removing, merging or simplifying what already exists, and consider an addition only once those ideas are exhausted. Anything added must be shorter than the text it makes unnecessary, and that text is deleted in the same change. Out of scope, because the orchestrating session runs them once after every spec lands: `build_plugin.py` and `check_plugin.py`. Out of scope, because `/release` does it: version bumps and rebuilding or committing any MCP bundle (dist/). Never build a `.plugin` archive.

## 9. Open questions

None.

## 10. Verify against HEAD before building

| Claim | Where | Check |
|---|---|---|
| "any context sentences, then the one question in bold" | `shared/research-memo-template.md` | UNVERIFIED |
| Renderer or save path adds Issue bold | `drafting_forms__render` `General_writing`, `research_filing__save_answer` | UNVERIFIED |
| A test asserts question-only bold | `legal-research/tests/` or mcp tests | UNVERIFIED |
