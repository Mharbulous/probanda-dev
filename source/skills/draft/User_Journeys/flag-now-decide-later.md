---
journey: Flag now, decide later
kind: ux journey — describes the interaction the practitioner experiences, not the data model. Data-focused journeys use a different format and live in `source/skills/drafting-data/User_Journeys/`.
actor: practitioner
trigger: while evidence is being linked to a fact, the practitioner — or the assistant, spotting it — voices an admissibility concern in one sentence
outcome: the concern is captured on the evidence link without interrupting drafting, renders as a text annotation on the mockup's evidence line, and is disposed of in one consolidated pass before the package goes out
path: happy
status: aspirational (desired UX — not yet verified against the implementation)
source: effort owner's flow selection, 2026-08-23
---

# Flag now, decide later

## The journey

1. **Practitioner:** mid-drafting, linking a fact to the evidence that proves it:

   > Use the Chen email for the delay date — though it's hearsay, Chen is only reporting what the site foreman told him.

2. **Assistant:** captures the concern right there on that evidence link, in the practitioner's own words, through `/drafting-data` — then keeps drafting. One line of acknowledgment, no admissibility discussion, no pause:

   > Noted on the Chen email. Carrying on with the delay chronology.

3. **Assistant:** spotting a problem itself works the same way — it links a letter headed "without prejudice", records a settlement-privilege concern on that link, and says so in passing. It never litigates the point on the spot and never offers its own view of the law. If the practitioner wants the question *answered* rather than noted — will this hearsay survive an objection? — that is a question of law and goes through `/legal-research`; the note itself costs nothing and blocks nothing.

4. **Assistant:** on the next render, the note appears as a plain text annotation on that evidence line of the mockup — the same treatment as the disputed/agreed annotation on a fact. Every review pass sees it without anyone having to remember it exists.

5. **Practitioner:** says the package is ready to go out.

6. **Assistant:** before anything goes out, surfaces every captured concern as one consolidated decision list:

   > Three admissibility notes are outstanding on this package:
   >
   > 1. Chen email — hearsay (foreman's account, second-hand)
   > 2. 14 March letter — headed "without prejudice"
   > 3. Site photos — no witness identified to authenticate
   >
   > For each: keep and defend it, swap the evidence, or hold it in reserve?

7. **Practitioner:** disposes of each in one pass — keeps the Chen email and will defend it if challenged, swaps the letter for the paid invoice, holds the photos in reserve (🂡 reserved — rendered for the practitioner under *Held in reserve*, withheld from the forum).

8. **Mirror use:** when responding to the other side's material, the same habit runs in reverse — concerns noted while reading their evidence become the objection list, already itemized when it is time to respond.

## Principles this journey encodes

- **Capture at the moment of sight.** The concern is recorded where and when it is seen — on the evidence link, by whoever saw it — because that is when the context is free. Paired data journey: `source/skills/drafting-data/User_Journeys/flag-inadmissible-evidence.md`.
- **Drafting is never interrupted to litigate admissibility.** A one-sentence note and onward; the fact still drafts into the document, because the practitioner may choose to run the risk.
- **The mockup carries the reminder.** The note rides the evidence line as a plain text annotation, so it is visible on every review pass — no separate list to maintain or forget.
- **One decision pass, not many interruptions.** Concerns accumulate silently and are disposed of together — keep and defend, swap, or reserve — at the natural gate before the package goes out.
- **The assistant notes; the gate answers.** An admissibility question is a question of law. The assistant records the concern verbatim but any actual answer comes through `/legal-research`, never from the assistant itself.
