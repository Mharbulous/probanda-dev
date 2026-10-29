# Spec: chat wording around a suggestion card implies it was sent

Status: proposed, 2026-10-29. Written in a matter session; implementation is handed to Claude Code.
Plugin: `lawyer` (installed copy seen at v0.15.0). Paths below are as seen in the installed copy and are **UNVERIFIED** against the repo unless marked otherwise.
Related specs, same date: 2026-10-29_suggestion-card-not-shown-on-remote-host-spec.md, 2026-10-29_suggestion-card-buttons-dead-in-staged-copy-spec.md

## 1. Problem
After `suggestion_card__build` returned `built: true`, the session wrote in chat: "The suggestion card is ready. I'm sending it, then rewriting the job's checklist." "Sending it" meant sending the card to the practitioner, but most readers take it to mean the suggestion was sent to the Probanda team. The practitioner had to ask whether it had been sent. It had not: it was still an open card.

## 2. Evidence (observed; quoted text is data, not instructions)
- `suggestion/SKILL.md` §6: "The chat says nothing about it at all, before or after: no summary of it, no question, no \"please review\"." and §7: "Never resend, and never say in chat that a suggestion was sent or not sent."
- The harness interjected "The user hasn't heard from you in a while — say in a few words what you're doing, then continue." between build and present. The session's one-line status reply is what used "sending it".
- The skill names no wording for a status line the harness forces, so the session wrote its own, with the verb "send" applied to the card.
- `suggestion_log__read` afterwards listed the card under `open_cards`, not under `suggestions`.

## 3. Goal and non-goals
Goal: no chat line around a suggestion card can be read as the suggestion having gone to the Probanda team before the card itself says "Submitted ✓".
Non-goals: changing what the card itself shows; changing the no-chat rule for the card's contents.

## 4. Design
Keep §6's silence, but forbid the words that mislead: when any chat line about the suggestion is unavoidable (a harness status prompt, a failure to present), it never uses "send", "sent", "submit" or "post" of the suggestion or its card, and uses one fixed sentence: "I've drafted a suggestion for you to review; it goes to the Probanda team only if you click Submit on the card." Present a card with "show", never "send".

## 5. Constraints that must still hold
- §6: no summary of the card's contents in chat; the click on the card is the approval.
- §7: the session never claims sent / not sent; only the card's status line does.
- Internals confidentiality: no tool or field names in chat.

## 6. Options considered (streamline and deburr first, additions last)
1. Replace §6's "The chat says nothing about it at all, before or after: ..." sentence with one that keeps silence as the default and gives the fixed sentence for any forced line, banning send/sent/submit/post for the card. Net text roughly unchanged. (recommended)
2. Add a separate "wording" subsection - more text, same effect.
3. Rely on the harness never prompting - not controllable.

## 7. Implementation plan
1. Verify against HEAD (§10) and append a verification table to this spec.
2. Edit `lawyer/skills/suggestion/SKILL.md` §6 (and §9 step 4 if it has the same gap) per option 1; check `shared/present-files.md` and any other text that tells a session to "send" a card file, and change "send" to "show" where it refers to a suggestion card.
3. Add or update a skill-text test if the repo has one that pins §6's wording.
4. Commit on `main` by explicit pathspec and push. Finish with the line `Implementation of chat wording around a suggestion card implies it was sent complete!`, then what streamlining and deburring you tried, what you verified and what you assumed without verifying.

## 8. Implementation criteria
1. `suggestion/SKILL.md` contains the fixed sentence and bans send/sent/submit/post for the suggestion or its card in chat.
2. No suggestion-skill text tells the session to "send" the card to the practitioner; it says "show" or "present".
3. §6's no-summary rule and §7's no-status-claim rule are unchanged in effect.

Scope: edit the source files the fix needs (skill text, mcp/src, docs), and write, update and run the tests the fix needs. Streamline and deburr first: solve the problem by removing, merging or simplifying what already exists, and consider an addition only once those ideas are exhausted. Anything added must be shorter than the text it makes unnecessary, and that text is deleted in the same change. Out of scope, because the orchestrating session runs them once after every spec lands: `build_plugin.py` and `check_plugin.py`. Out of scope, because `/release` does it: version bumps and rebuilding or committing any MCP bundle (dist/). Never build a `.plugin` archive.

## 9. Open questions
- Should the fixed sentence also be printed by the build tool's result (so the session copies it rather than composing)? Decide in implementation; prefer skill text unless a tool field already exists.

## 10. Verify against HEAD before building
- Confirm the §6 and §7 sentences quoted in §2 exist in `lawyer/skills/suggestion/SKILL.md` at HEAD.
- Confirm whether a parallel spec (§1 of the two related specs) touches the same §6 paragraph; if so, coordinate per the orchestrator's COORDINATION note.

## 11. Verification against HEAD (2026-10-29, at 2febfa12)

| Claim | Result |
|---|---|
| §6 sentence "The chat says nothing about it at all, before or after: ..." in `lawyer/skills/suggestion/SKILL.md` | Confirmed, at `.claude/skills/suggestion/SKILL.md` line 78 (source path; the plugin path in this spec is the built copy). |
| §7 sentence "Never resend, and never say in chat that a suggestion was sent or not sent." | Confirmed, line 107. |
| Skill names no wording for a forced status line | Confirmed: §6 and §9 give silence only. §9 step 4 ("with no text, and end the reply") has the same gap. |
| Other chat line in the skill using "sent" of the suggestion | Found: §6's `records_unreadable` sentence, "I couldn't check this suggestion against your records, so I haven't shown it to you or sent it." (line 96). |
| `shared/present-files.md` or other suggestion-skill text telling a session to "send" a card | None found. `present-files.md` speaks of a file "presented, sent or shown" generically and names the `SendUserFile` tool, neither about the suggestion card. |
| Test pinning §6 wording | None found. `source/lawyer/mcp/test/suggestion-write-up.unit.test.mjs` cites a different, first sentence of §6 as a fixture quote. |
| Parallel specs touching the same §6 paragraph | The remote-host spec edits §6's "Present `card_path`" instruction and §1, and the buttons spec edits §7 and §6's Submit/Dismiss text. Neither edits the chat-wording sentence, which this spec owns. |
