# Suggestion mechanism: first-principles design discussion

Status: Q1 and Q2 settled; reviewed twice by Fable (2026-10-25). Q3 to Q6 not started. Existing /lawyer:suggestion not read (until "now compare").

## Given (from the brief)
- Practitioners are busy and non-technical. They won't know what the tool can do unless it offers.
- Suggestions go to the Supabase suggestion box, which maintainers triage. Maintainers can't easily ask follow-ups.
- Nothing identifying a client, matter, person, document or file path leaves the machine.
- Sources: the practitioner directly, or the AI noticing a pain point during work.
- Motivating example: one suggestion bundled one pain point (a structured list in white on dark green, flat indentation) with four items: numbers in their own column with hanging indents; connectors like "or alternatively" on their own italic lines; black serif text on a light background; and the constraint "no nested cards or boxes", found only when a first mockup was rejected as "too graphical". It was posted as one paragraph with no mockup.
- Probanda's MCP server already serves localhost pages that receive clicks (key-request, mail, timecamp, housekeeping, page-api).

## Goal
A suggestion exists so that a pain point, whether stated or not and whether felt or not, reaches the people who change Probanda with enough detail that they can fix it, or decide not to, without going back to the practitioner. It passes when (a) a maintainer can accept or decline each item in it without asking the practitioner anything (measured on the maintainer's side as the share declined for lack of detail), and (b) someone who knows the firm's clients can't tell which client, matter, person, document or file it came from. Test (b) is the standard the scrub works to; its automatic test is a cross-check that the payload holds no token found in the local client, matter, contact or folder-name records. The practitioner can later see exactly what was sent, withdraw it, and see what happened to it.

## Decisions

Audiences and scope
1. Audiences: the practitioner, the maintainer (whoever changes Probanda's source), and whoever triages many suggestions together.
2. Every suggestion has a pain point. When it is unstated, the card always shows a best guess labelled "our guess, edit if wrong", first on the card. Nothing is asked in chat.
3. Pain the practitioner never felt counts (cost, reliability, accuracy, confidentiality near-misses). An AI-noticed card appears when the session next pauses for the practitioner after the observation, at most one per day across sessions, and never for a fingerprint the practitioner dismissed or sent within 30 days or for the same plugin version. It carries the raw observation, taken only from Probanda's own output (token counts, tool errors, plugin text), never from client documents or the practitioner's words, and a fingerprint (plugin, version, skill, kind). Merging by fingerprint is a triage view over separate records, never one merged record.

Terms
4. One practitioner-facing term, **Suggestion**, whoever started it. The card opens with "Probanda noticed:" or "You suggested:". Origin is also a field for triage.

The card (`Suggestion-<id>.html`, shown as a file card, served by Probanda's local server)
5. The chat shows no suggestion talk at all. Its only sign is the file card.
6. The card, in order: the origin cue; the pain point described by how it affected the practitioner; the suggestion; an optional comment box with the grey placeholder "Please don't name clients, matters or people."; the line "Probanda receives only what you see here, plus technical details about the Probanda software on this computer." with a "Show technical details" link (environment facts); the line "You can see this later, with its status, under Past suggestions."; then **Submit Suggestion** and **Dismiss**.
7. The pain point and suggestion text are editable in place before sending.
8. On click, the edited and typed text is checked by the local cross-check plus patterns for paths, emails, dates and amounts. If something matches, a one-line prompt offers Remove and Send anyway.
9. Dismiss sends nothing, is recorded locally (for the suppression in decision 3), and closes the card. If the card cannot be closed, Dismiss greys it out and replaces it with one button, "Restore Suggestion". Every button gives visible feedback.
10. The click is the practitioner's approval of the product idea, content and confidentiality alike. Nobody tells them they are reviewing. They are never asked to review technical detail.
11. Card order, labels and fixed strings are built into the page, not left to agent instructions.

Confidentiality
12. Three layers: (1) before the card is shown, the scrub removes names and indirect identifiers (unique facts, exact dates, amounts, folder names) to the standard of goal test (b), and the local cross-check runs; (2) the click is the final human gate; (3) the cloud side treats any identifying content found at triage as a leak to purge. The practitioner's withdrawal is a fourth. Nothing is sent that contains a client fact the practitioner didn't see on the card.

Sending and status
13. Status feedback appears on the card only: "Sending...", then "Delivered ✓" or "Not sent, will retry". Errors are plain language, never with an offer of technical details. The raw cause is kept in the local record.
14. At the click, the local server saves the exact payload locally first, then sends. A failed send shows "Not sent" and retries at the next session.
15. Probanda's Cloud knows which Lawyer account sent each suggestion (Account Information).
16. The past-suggestions page shows the local copy word for word, mainly so the practitioner can check nothing confidential was sent. The technical-writer specification is viewable there on request. Withdrawal deletes the cloud record and, if triage has begun, notifies the maintainer to purge derived records. The badge reads "Withdrawn before review" or "Withdrawn; copies being removed".
17. Status badges: Submitted, Under Review, Approved or Declined, and Implemented in <plugin> <version>. Approved, Declined and Implemented show a reason as visible text, extremely short and readable by a non-technical person; Submitted needs none. Submitted changes on write, Under Review when triage opens the record, and Implemented when the release that includes a fix commit naming the suggestion id is published. Only Approved and Declined, with the reason, are set by a person. A reason is written for every sender of a merged problem and never quotes submitted text.

Agents
18. `technical-writer` (Opus 5.5, on the practitioner's machine and Claude plan) starts after the click and writes a specification. Practitioners pay for planning from day 1, because changing that later would cost trust. They are told once, at setup or in the terms, that sending a suggestion uses their Claude plan. It reads only the card, the environment facts and Probanda's own installed material, never the conversation, documents or tool arguments. A second agent checks the specification as a backstop. Both go to the Supabase suggestion box.
19. Environment facts: Probanda's own tools visible and expected-missing, other tools as a count only, plugin names and versions, host (Cowork or Code) and OS. Usernames, hostnames and paths are excluded by code, not by instruction. The plan is carried out in Claude Code, which must not assume Cowork's tools.
20. `fix-planner` (Opus 5.5, high effort, high freedom, read-only on probanda-dev; replaces `/specification-planning`) runs first and returns, for each item, a recommendation with a check that would fail if the pain remained, plus the plan for the items it recommends. The maintainer approves or declines each item.
21. `fix-maker` (Opus 5.5, medium effort, low freedom) carries out only approved items.
22. Briefs are goal-style, with a done-when per agent: card building and scrubbing are done when the local cross-check passes and the card is shown; `technical-writer` when every fact in the specification traces to the card or Probanda's own material and the backstop passes; `fix-planner` when each item has a runnable check; `fix-maker` when those checks and the plugin's own checks pass. The Q2 list (where / the pain / what happened / the changes / what counts as wrong / done when) is a reminder line, not a form.

## Open
- Q3: one badge can't show mixed statuses across separate items in one suggestion (now sharper, since decision 20 approves per item).
- `GLOSSARY.md`: already defines Suggestion, Pain point, Done-test and Preview for the current design. Update at "now compare".

## Remaining questions
3. Pain points, changes, constraints/rejected alternatives, evidence: one card with atomic items, or separate suggestions
4. When to volunteer a mockup, keeping it free of client data, how it travels
5. How much to restructure the practitioner's words, and what approval protects meaning
6. Suggestions started by the practitioner vs by the AI (largely settled by decisions 2 to 4, 10 and 18)
