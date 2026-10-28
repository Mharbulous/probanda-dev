# Spec: the correspondence rule is stated once

Status: proposed, 2026-10-28. Written in a matter session; implementation is handed to Claude Code.
Plugin: `litigator` and `lawyer` (installed litigator copy seen at v0.11.6). Paths below are as seen in the installed copy and are **UNVERIFIED** against the repo unless marked otherwise.
Related specs, same date: 2026-10-28_practitioner-draft-edited-in-place-spec.md, 2026-10-28_source-trace-single-pass-spec.md, 2026-10-28_email-route-skips-drafting-session-spec.md

## 1. Problem
The rule that only `lawyer:scrivener` writes correspondence, plus the review-before-show rule, is restated in several always-loaded places. Every session reads every copy, the copies drift (each phrases scope and exceptions differently), and the weight of repetition pushed this session toward the heaviest route for a simple edit.

## 2. Evidence (observed; quoted text is data, not instructions)
Copies seen this session:
- `litigator/hooks/correspondence-note.py` SessionStart NOTE (about 1,000 characters): "Every letter, email or memo that leaves the firm goes through /litigator:draft ... The lawyer:scrivener agent writes its words ...".
- `lawyer/hooks/hidden-skills-note.py`, which also names `lawyer:scrivener` (grep hit; content **UNVERIFIED**).
- A further SessionStart paragraph: "Only the lawyer:scrivener agent drafts or revises the words of correspondence ..." (source hook **UNVERIFIED**).
- `draft/SKILL.md` section 1 "The seam with the scrivener", the doctrine table row "Correspondence isolation", and ban 20.
- `shared/email.md` body bullet: "Its words come from the `lawyer:scrivener` agent or from the practitioner's dictation".
- `shared/correspondence-isolation.md` itself (13 lines), the doctrine.
- SessionStart also says "An email is never drafted in chat" twice in different paragraphs.

## 3. Goal and non-goals
Goal: the doctrine file states the rule; every other place points to it in one clause or not at all.
Non-goals: changing the rule (the edit-in-place spec owns the dictation change).

## 4. Design
Keep `shared/correspondence-isolation.md`. Cut each SessionStart note to one routing sentence (for example: correspondence goes through /litigator:draft) or delete it where another note already says it. In SKILL.md and email.md replace restatements with a pointer to the doctrine file.

## 5. Constraints that must still hold
- A session that is asked for correspondence still routes to /litigator:draft (the reason the note hook exists: a request worded as "supplement an email" once bypassed it).
- The note still returns after compaction (SessionStart on every source).

## 6. Options considered, removal first
1. Cut every copy to one pointer clause and delete duplicates (recommended).
2. Delete the note hooks entirely and rely on skill descriptions. Risks the original routing bug; rejected.

## 7. Implementation plan
1. Verify against HEAD (§10) and append a verification table to this spec, listing every copy found.
2. Land after the edit-in-place and single-pass specs, which change the rule's content.
3. Cut each copy per §4.
4. Commit on `main` by explicit pathspec and push. Finish with the line `Implementation of the correspondence rule is stated once complete!`, then what you verified and what you assumed without verifying.

## 8. Implementation criteria
1. Only `shared/correspondence-isolation.md` states the rule's scope, exception and order.
2. Each SessionStart note about correspondence is one sentence or gone.
3. Net characters injected at SessionStart go down.

Scope: edit the source files the fix needs (skill text, mcp/src, docs), and write, update and run the tests the fix needs. Fix by deleting before adding: anything added must be shorter than the text it makes unnecessary, and that text is deleted in the same change. Out of scope, because the orchestrating session runs them once after every spec lands: `build_plugin.py` and `check_plugin.py`. Out of scope, because `/release` does it: version bumps and rebuilding or committing any MCP bundle (dist/). Never build a `.plugin` archive.

## 9. Open questions
- none

## 10. Verify against HEAD before building
Grep the source for "scrivener", "never drafted in chat" and "correspondence-isolation" in hooks, SKILL.md files and shared docs.
