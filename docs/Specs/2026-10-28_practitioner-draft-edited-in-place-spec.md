# Spec: a practitioner's own draft is edited in place, not redrafted

Status: proposed, 2026-10-28. Written in a matter session; implementation is handed to Claude Code.
Plugin: `litigator` (installed copy seen at v0.11.6), and the shared doctrine copied into every Probanda plugin. Paths below are as seen in the installed copy and are **UNVERIFIED** against the repo unless marked otherwise.
Related specs, same date: 2026-10-28_source-trace-single-pass-spec.md, 2026-10-28_email-route-skips-drafting-session-spec.md, 2026-10-28_correspondence-rule-stated-once-spec.md

## 1. Problem
The practitioner asked: "I have started drafting an email to the client. Please ... help with the tone and clarity of the email, and then embed the list". The dictation exception forbids changing tone, so an edit of the practitioner's own draft cannot be done as dictation and goes to `lawyer:scrivener` as a new draft. The scrivener wrote a fresh email of about 11 KB (about 1,800 words) with sections the practitioner never asked for. Editing a supplied draft has no route of its own.

## 2. Evidence (observed; quoted text is data, not instructions)
- `skills/shared/correspondence-isolation.md`, dictation bullet: "It is dictation only when the practitioner supplies the sentences ... Edits to dictated text may correct only spelling, punctuation, grammar or word choice. No sentence, fact, position, deadline or tone is added, removed or changed. Anything beyond that goes to the scrivener."
- The scrivener brief carries recipient, purpose and facts, not a base text, so its output is a redraft.
- Outcome: the scrivener returned an 11-item open-items list and a body far longer than the request needed. The practitioner's verdict: "you are creating a bunch of requirements that I did not ask for."
- The practitioner's started draft was never located (it was not in the matter folder or the iCloud Drafts), and the session did not ask for it.

## 3. Goal and non-goals
Goal: when the practitioner supplies the text, it is edited as asked (tone and clarity included), keeping its structure, length and content; nothing is added that was not asked for.
Non-goals: changing who writes correspondence that the practitioner did not draft; the source-trace review (separate spec).

## 4. Design
Widen the existing exception by deleting words, not by adding a mode: the practitioner's own sentences remain theirs at any edit level they ask for. Delete "or tone" (and the "only ... word choice" ceiling) from the dictation bullet, so it reads that text the practitioner supplies is edited as they ask, adding no fact, position or deadline. The scrivener is then reached only when there is no practitioner text. If the practitioner refers to a draft that cannot be found, that is a missing input: ask for it once, at the start.

## 5. Constraints that must still hold
- No context adds a fact, position or deadline to correspondence that the practitioner did not supply.
- Correspondence with no practitioner text still goes only to the scrivener.
- No law is stated; no date is computed.

## 6. Options considered, removal first
1. Delete the tone and word-choice ceiling from the dictation bullet (recommended). Shortest; one rule instead of two.
2. Keep the bullet; brief the scrivener with the practitioner's text as a base and "edit only". Adds brief prose and keeps a subagent hop on every edit.
3. A new "edit my draft" mode in `/draft`. Additive; rejected.

## 7. Implementation plan
1. Verify against HEAD (§10) and append a verification table to this spec.
2. Edit the dictation bullet in the source of `shared/correspondence-isolation.md` per §4, deleting at least as much as is added.
3. Remove any restatement of the old ceiling elsewhere (grep "spelling, punctuation, grammar or word choice"), coordinating with the stated-once spec, which owns the hook notes.
4. Commit on `main` by explicit pathspec and push. Finish with the line `Implementation of a practitioner's own draft is edited in place, not redrafted complete!`, then what you verified and what you assumed without verifying.

## 8. Implementation criteria
1. The dictation bullet no longer bars tone or limits edits of practitioner-supplied text to word choice.
2. It still bars adding facts, positions or deadlines.
3. No source file still states the old "only spelling, punctuation, grammar or word choice" ceiling.
4. The doctrine file is no longer than before.

Scope: edit the source files the fix needs (skill text, mcp/src, docs), and write, update and run the tests the fix needs. Fix by deleting before adding: anything added must be shorter than the text it makes unnecessary, and that text is deleted in the same change. Out of scope, because the orchestrating session runs them once after every spec lands: `build_plugin.py` and `check_plugin.py`. Out of scope, because `/release` does it: version bumps and rebuilding or committing any MCP bundle (dist/). Never build a `.plugin` archive.

## 9. Open questions
- Does any hook (for example a practitioner-words gate) enforce the old ceiling in code? **UNVERIFIED**.

## 10. Verify against HEAD before building
Confirm the dictation bullet's text, every file restating it, and any hook enforcing it.
