# Spec: source-trace review runs once and never blocks writing the .eml

Status: proposed, 2026-10-28. Written in a matter session; implementation is handed to Claude Code.
Plugin: `litigator` (installed copy seen at v0.11.6). Paths below are as seen in the installed copy and are **UNVERIFIED** against the repo unless marked otherwise.
Related specs, same date: 2026-10-28_practitioner-draft-edited-in-place-spec.md, 2026-10-28_email-route-skips-drafting-session-spec.md, 2026-10-28_correspondence-rule-stated-once-spec.md

## 1. Problem
An email cannot be written until a source-trace review has returned on its exact text, and any change the review asks for triggers a full second review. The practitioner waited through draft, review, revision and re-review before getting the `.eml` they asked for, and complained: "I'm getting impatient waiting for you to show me the file card for .eml". The `.eml` finally went out under the DRAFT-label bypass, which was available all along.

## 2. Evidence (observed; quoted text is data, not instructions)
- `draft/references/source-trace.md` §4: "When any finding changed the text, spawn the reviewer again on the final text ... Until then it goes out only labelled DRAFT".
- `shared/correspondence-isolation.md`, "The order": "Any change a review calls for is a revision the scrivener writes, and the review runs again on the new text."
- `draft/SKILL.md` ban 20: no `.eml` "before `references/source-trace.md`'s review has returned on that exact text ... unless it is labelled a draft".
- `hooks/correspondence-review-gate.py` docstring: write_email "passes only when the session itself ... has spawned source-tracer with a prompt holding the call's body ... and that agent has returned ... a subject carrying the word DRAFT in capitals ... passes".
- Cost: second review alone 40 tool calls, about 418 s wall time, about 175k subagent tokens, for an email the practitioner reviews before sending in any case. First review plus a scrivener revision round came before it.
- Workaround in use: write the `.eml` with DRAFT in the subject.

## 3. Goal and non-goals
Goal: the `.eml` is written as soon as the text exists; a review, when it runs, runs once and its findings go to the practitioner.
Non-goals: removing the source-trace agent; letting Probanda send mail (it never does).

## 4. Design
Delete, in order of value: (a) the re-review loop (source-trace §4's second spawn, and "the review runs again on the new text"); (b) the write gate: ban 20's pre-write condition and the write_email branch of `correspondence-review-gate.py`, so the `.eml` is always written first as an unsent draft. With (b), the DRAFT label and the rule about when it comes off are unnecessary and are deleted too. The review then runs after the `.eml` is shown, and its findings are reported once. Keep the gate's other branches (no hand-written `.eml`; `mail__save_draft` only for an `.eml` this route wrote).

## 5. Constraints that must still hold
- Probanda never sends email; every `.eml` is unsent (X-Unsent: 1).
- No `.eml` is authored except by write_email.
- A review finding is shown to the practitioner, never silently applied.

## 6. Options considered, removal first
1. Delete the re-review loop and the write gate; review once, after the `.eml` (recommended).
2. Delete only the re-review loop; keep the gate. Halves the wait; still blocks the deliverable.
3. Make DRAFT the default subject. Keeps all machinery and adds a convention; rejected.

## 7. Implementation plan
1. Verify against HEAD (§10) and append a verification table to this spec.
2. Delete source-trace §4's second spawn and isolation's "runs again" clause.
3. Delete ban 20's pre-write condition and the DRAFT-label text; state once that the review runs after the `.eml` is shown.
4. Delete the write_email branch of `correspondence-review-gate.py` and its tests; keep the other branches and their tests.
5. Commit on `main` by explicit pathspec and push. Finish with the line `Implementation of source-trace review runs once and never blocks writing the .eml complete!`, then what you verified and what you assumed without verifying.

## 8. Implementation criteria
1. No source text requires a second review after a revision.
2. write_email is not refused for want of a review, and no text depends on a DRAFT subject label.
3. The gate still refuses a Write/Edit of an `.eml` and an unknown `mail__save_draft`; their tests pass.
4. Net lines in the touched files go down.

Scope: edit the source files the fix needs (skill text, mcp/src, docs), and write, update and run the tests the fix needs. Fix by deleting before adding: anything added must be shorter than the text it makes unnecessary, and that text is deleted in the same change. Out of scope, because the orchestrating session runs them once after every spec lands: `build_plugin.py` and `check_plugin.py`. Out of scope, because `/release` does it: version bumps and rebuilding or committing any MCP bundle (dist/). Never build a `.plugin` archive.

## 9. Open questions
- Option 1 removes a safety gate Brahm added deliberately (ban 20, "Every letter can be used as evidence of what it states"). Brahm decides between options 1 and 2 before step 3.

## 10. Verify against HEAD before building
Confirm the quoted texts, every file mentioning the DRAFT label, and the gate's branches and tests.
