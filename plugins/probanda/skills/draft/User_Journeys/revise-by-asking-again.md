---
journey: Revise by asking again
kind: ux journey — describes the interaction the practitioner experiences, not the data model. Data-focused journeys use a different format and live in `.claude/skills/drafting-data/User_Journeys/`.
actor: practitioner
trigger: the practitioner, reviewing a rendered mockup, asks for a change — new substance, or a reorder/insert/remove spoken in the mockup's own numbering
outcome: the change is elicited, written, and re-rendered with no approval pause; the new mockup carries a bumped revision number and the superseded copy is archived
path: happy
status: verified (E2E 2026-08-25, BCSC Notice of Application, docs/E2E-tests/2026-08-25 draft-submission-e2e-test.md — reorder + reinstate exercised on Part 1's orders sought: revision bumped, superseded mockup archived, exactly one current copy)
source: effort owner's flow selection, 2026-08-23
---

# Revise by asking again

## The journey

1. **Practitioner:** has the current mockup open and asks for a change the same way they asked for the first draft:

   > Submission 2 should rest on the deemed admission, not the invoice. And move submission 3 above submission 2.

2. **Assistant:** re-enters elicitation — there is no separate revision mode. It asks only what it still needs (anything only the practitioner knows), draws on what the matter already holds, and where the change touches a statement of law it invokes `/legal-research` rather than supplying legal content itself. A slot whose research hasn't come back stays open and renders its own work marker (📖 doctrinal basis needed) on the mockup.

3. **Assistant:** writes the change through `/drafting-data`, re-renders, and presents the new mockup as a clickable file card — no summary of its contents in chat, no pause for approval before writing or rendering. The mockup carries the review.

4. **Practitioner:** reviewing the new copy, keeps going in the numbers on the page:

   > Add an order between the first and second — costs in any event. And drop the third order sought.

5. **Assistant:** treats reorder, insert, and remove as ordinary revision requests. The practitioner speaks only in the numbers they see on the mockup; renumbering everything downstream is the machinery's job, never something the practitioner tracks or is asked about. The assistant writes the change, re-renders, and hands over the file card.

6. **Practitioner:** opens the new mockup. Every submission and order sought reads in the requested sequence, correctly numbered, and the mockup's revision number has bumped again. The superseded copy has been archived — there is exactly one current mockup, with a paper trail of the prior ones behind it.

## Principles this journey encodes

- **Revision is the same door as drafting.** A "change this" request re-enters elicitation exactly like the first draft: elicit what's changing, write it, re-render. No revision mode, no different vocabulary to learn.
- **The mockup's numbers are the shared language.** The practitioner says "submission 3" and "the second order" as printed on the page they are looking at; renumbering after a move, insert, or removal is entirely the machinery's job.
- **No approval pauses.** Writing and rendering never block on confirmation — write, render, and let the mockup carry the review, consistent with `SKILL.md`'s anti-patterns.
- **One current copy, a paper trail behind it.** Every substantive change bumps the mockup's revision number and archives the superseded copy — the practitioner never wonders which file is current, and prior revisions remain retrievable. The mockup's place among a document's later versions: `.claude/skills/drafting-data/User_Journeys/drafted-document-lifecycle.md`.
- **Legal content only through the gate.** A revision that needs an authority routes through `/legal-research`; an open slot rendering its work marker is correct data, never something to paper over.
