# Spec: suggestion card's Submit and Dismiss buttons are dead when shown through the chat

Status: proposed, 2026-10-29. Written in a matter session; implementation is handed to Claude Code.
Plugin: `lawyer` (installed copy seen at v0.15.0). Paths below are as seen in the installed copy and are **UNVERIFIED** against the repo unless marked otherwise.
Related specs, same date: 2026-10-29_suggestion-chat-wording-implies-sent-spec.md, 2026-10-29_suggestion-card-not-shown-on-remote-host-spec.md

## 1. Problem
On a remote-device-only host the card is shown by staging `Suggestion-<id>.html` into the cloud container and sending it with `SendUserFile`. The practitioner reported that the card's "Submit Suggestion" and "Dismiss" buttons were disabled and did nothing. The suggestion therefore cannot be sent from the only place it was shown, and the session is told never to send it any other way.

## 2. Evidence (observed; quoted text is data, not instructions)
- Practitioner's report: "The suggestion card has buttons for \"Submit Suggestion\" and \"Dismiss\" but they are disabled and do not do anything."
- `suggestion_card__wait` description: "Submit and Dismiss work without anyone waiting" and "While this waits, the card's mockup link works". The session called it once and got `pending`.
- `suggestion/SKILL.md` §7: "On Submit Suggestion the card saves the edits, checks everything it would send ... and sends it". §6: "The practitioner's click on the card is their approval of everything on it".
- The copy shown was a staged copy (container path under `/mnt/user-data/uploads/suggestions/`) rendered by the chat app's file preview, not the PC's file opened in a local browser. Inference, **UNVERIFIED**: the buttons need the PC-side page server / local origin and are disabled when that is unreachable (sandboxed preview, different origin).
- No tool exists for the session to submit or dismiss a card on the practitioner's word (tool list holds build, wait, attach_mockup, write_up_*, log read/write, status, past_suggestions).

## 3. Goal and non-goals
Goal: wherever the card is shown, the practitioner can Submit or Dismiss it, and an unusable card never looks usable.
Non-goals: letting the session send a suggestion without the practitioner's own act.

## 4. Design
Two parts. (a) When the card is opened somewhere its buttons cannot work, it says so on the card in place of dead buttons, with the alternative. (b) Give the practitioner a working alternative on remote hosts: either the card opens on the PC (served by the local page server, link returned with the card) or a gated tool lets the session submit/dismiss the exact card text on the practitioner's explicit chat word, with the same pre-send check the card runs. Choose against HEAD.

## 5. Constraints that must still hold
- Nothing is sent without the practitioner's own act (click, or an explicit word gated like other practitioner-words gates).
- The pre-send identifier check (§7 of the skill) runs before anything leaves.
- The text sent is exactly the card's text as the practitioner last saw/edited it.
- Internals confidentiality on the card.

## 6. Options considered (streamline and deburr first, additions last)
1. Card detects that its submit endpoint is unreachable and replaces the buttons with a one-line note plus an "Open on this computer" link to the PC-served card; `suggestion_card__build` returns that link for the session to give. (recommended if the page server already serves cards)
2. Add `suggestion_card__submit` / `__dismiss` taking `card_id`, gated on a bare practitioner yes to a fixed question, running the same check and send code the card uses. More code; works on every host.
3. Skill text only: tell the practitioner to open the card on the PC - leaves dead buttons in the preview.

## 7. Implementation plan
1. Verify against HEAD (§10) and append a verification table to this spec.
2. Find how the card's buttons reach the sender (card template in the lawyer data server, `suggestion_card__*`, **UNVERIFIED**) and why they render disabled in a staged/preview copy.
3. Implement the chosen option; update `suggestion/SKILL.md` §6–§7 to match, deleting text the change makes unnecessary.
4. Add a test: a card rendered without its endpoint shows the note, not enabled-looking or disabled buttons with no explanation; and (option 2) the gated tool refuses without the practitioner's yes.
5. Commit on `main` by explicit pathspec and push. Finish with the line `Implementation of suggestion card's Submit and Dismiss buttons are dead when shown through the chat complete!`, then what streamlining and deburring you tried, what you verified and what you assumed without verifying.

## 8. Implementation criteria
1. A card shown through the chat on a remote-device host can be submitted or dismissed by the practitioner by some route the card or skill names.
2. A card whose buttons cannot work says so on the card.
3. No route sends a suggestion without the practitioner's own act and the pre-send check.

Scope: edit the source files the fix needs (skill text, mcp/src, docs), and write, update and run the tests the fix needs. Streamline and deburr first: solve the problem by removing, merging or simplifying what already exists, and consider an addition only once those ideas are exhausted. Anything added must be shorter than the text it makes unnecessary, and that text is deleted in the same change. Out of scope, because the orchestrating session runs them once after every spec lands: `build_plugin.py` and `check_plugin.py`. Out of scope, because `/release` does it: version bumps and rebuilding or committing any MCP bundle (dist/). Never build a `.plugin` archive.

## 9. Open questions
- Option 1 vs 2 is a design choice for Brahm if HEAD shows no PC-served card URL.

## 10. Verify against HEAD before building
- Confirm how the card's buttons are wired and what disables them.
- Confirm no submit/dismiss tool already exists at HEAD.

## 11. Verification against HEAD (2febfa12, 2026-10-29)

| Claim | At HEAD | Where |
|---|---|---|
| The card's buttons post to the PC-side page server | Confirmed. The card's script posts every click to `http://127.0.0.1:<page_api_port>/cards/<card id>/<route>` with the card's token. The page's CSP allows `connect-src` to that address only. | `source/lawyer/mcp/src/suggestions/card-page.ts` (`SCRIPT`, `renderCardHtml`) |
| What disables the buttons | Confirmed. The script disables Submit and Dismiss on load and enables them only when its first `POST /state` succeeds. When that fails it leaves them disabled and shows "This works while Claude is open on this computer. Open Claude, ask to see this suggestion again, and use it here." That line is wrong for a staged copy seen in the chat while Claude is open. | `card-page.ts`, `poll()` and `SAY.off` |
| Why the staged copy cannot reach it | Not verified. Possible causes: the chat's file preview blocks the request (its own CSP or sandbox), or it renders on a device other than the PC. The listener echoes only `Origin: null` (a page opened from `file://`). | `source/lawyer/mcp/src/page-api/server.ts` (`corsHeaders`) |
| A PC-served card URL exists | No. The page API serves `GET /health` only. The card routes are POST only and serve no HTML. `suggestion_card__build` returns `card_path`, a file on the PC, and no URL. | `page-api/server.ts` (`handle`), `suggestions/card.ts` (`buildCard`) |
| A submit or dismiss tool exists | No. The `suggestion_card__*` tools are build, wait, attach_mockup, write_up_brief, write_up_check, write_up_send, check and environment_facts. | `source/lawyer/mcp/src/schema/suggestions.ts`, `suggestions/tools.ts` |
| Skill §6 and §7 as quoted in §2 | Confirmed. §6 says "Present `card_path` as a file card ... Submit and Dismiss on the card keep working with no one waiting". §7 says "On Submit Suggestion the card saves the edits, checks everything it would send ... and sends it". §9 step 4 says "Submit Suggestion and Dismiss work by themselves". | `.claude/skills/suggestion/SKILL.md` |

Result: HEAD has no PC-served card URL, so §9's choice between option 1 and option 2 goes to Brahm.
