# Spec: Job question comes from the job's label, not its question

Status: proposed, 2026-10-31. Written in a matter session; implementation is handed to Claude Code.
Plugin: `researcher` (installed copy seen at v0.10.16), with `litigator` drafting-data as context. Paths below are as seen in the installed copy and are **UNVERIFIED** against the repo unless marked otherwise.
Related specs, same date: 2026-10-31_memo-template-job-issue-yields-spec.md; 2026-10-31_memo-reviewer-tests-issue-spec.md; 2026-10-31_stale-synced-copy-after-resync-spec.md

## 1. Problem
A research job's memo took the job's title verbatim as its Issue. Titles are short labels by design, so the Issue came out as an instruction ("Research the meaning of "<term>" in section <n> of the <DOC>"). That is not a question, makes no sense on its own and names a document of the working matter. The job's intent held a real question.

## 2. Evidence (observed; quoted text is data, not instructions)
- researcher `skills/shared/legal-research.md` spawn template: "Job question: "<the held job's title, verbatim>" / none", and: "A caller working a `/draft` job fills `Job question:` with the job's title character for character".
- litigator `skills/drafting-data/references/jobs-create.md`: "A new job's title is a cleaned label; its intent is the record. ... the intent carries what was asked".
- `research-board.md`: "`Job question:` is its title".
- The gate (v0.10.16) now has "A research question holds one question ... names nothing of the working matter ... Context sentences are allowed ... A question that fails is never split or researched as it stands: ... propose one rewording". The Job-question fill rule does not point at it.
- The session filled `Job question:` while holding no job. The template says every other caller writes none, but the condition sits about 30 lines below the field, in prose.

## 3. Goal and non-goals
Goal: the question a job's memo answers is the job's recorded question, checked against "A research question holds one question" before any dispatch. Only a session holding the job's lock fills it.
Non-goals: changing how titles are cleaned; changing jobs-create.

## 4. Design
`Job question:` takes the job's intent, not its title. Before any dispatch, the gate applies "A research question holds one question" to it. On failure it runs that rule's rewording proposal (reword the held job by §3m) and researches nothing. The field line itself says that a caller not holding the job's lock writes `none`.

## 5. Constraints that must still hold
One question per memo; no matter identifiers in a memo; the lock read before every dispatch; the practitioner approves every rewording.

## 6. Options considered, streamline and deburr first, additions last
1. Replace "title" with "intent" in the field and fill rule, and point the fill rule at "A research question holds one question" (recommended; net shorter).
2. Keep the title and require titles to be questions. Rejected: it conflicts with jobs-create's label rule.
3. Add a separate title validator. Rejected: an addition the existing rule already covers.

## 7. Implementation plan
1. Verify against HEAD (§10) and append a verification table to this spec.
2. Edit the spawn template field and fill rule in `legal-research.md`, and the matching line in `research-board.md`. Delete the superseded wording.
3. Update any test that asserts the old field text.
4. Commit on `main` by explicit pathspec and push. Finish with the line `Implementation of Job question comes from the job's label, not its question complete!`, then what streamlining and deburring you tried, what you verified and what you assumed without verifying.

## 8. Implementation criteria
1. No file in researcher says the Job question is the job's title.
2. The fill rule names the job's intent and the lock condition on the field's own line.
3. The fill rule sends a failing Job question to "A research question holds one question" before any dispatch.
4. Net line count of the edited files does not grow.

Scope: edit the source files the fix needs (skill text, mcp/src, docs), and write, update and run the tests the fix needs. Streamline and deburr first: solve the problem by removing, merging or simplifying what already exists, and consider an addition only once those ideas are exhausted. Anything added must be shorter than the text it makes unnecessary, and that text is deleted in the same change. Out of scope, because the orchestrating session runs them once after every spec lands: `build_plugin.py` and `check_plugin.py`. Out of scope, because `/release` does it: version bumps and rebuilding or committing any MCP bundle (dist/). Never build a `.plugin` archive.

## 9. Open questions
Should an intent that passes A to C but names the matter be reworded on the job, or only generalised in the memo? (This spec assumes reworded on the job, by the gate's existing rule.)

## 10. Verify against HEAD before building
Confirm the quoted lines exist at HEAD and that §3m rewording exists in drafting-data.
