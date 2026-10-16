---
journey: Requisition in minutes
kind: ux journey — describes the interaction the practitioner experiences, not the data model. Data-focused journeys use a different format and live in `.claude/skills/drafting-data/User_Journeys/`.
actor: practitioner
trigger: practitioner asks for a BCSC requisition — default judgment or consent order — on a matter whose proceeding is already known
outcome: both drafts of the Writing — the requisition and its draft order or judgment — rendered and presented as file cards, with attachment status visible on the requisition mockup
path: happy
status: verified — both requisition paths exercised end to end in Cowork, independence confirmed (default judgment: 2026-08-25, issue #368; consent order: 2026-08-26, issue #369); the Form 8 mockup-fileability re-check flagged by #368 landed clean under #381 before #369 ran
source: effort owner's flow selection, 2026-08-23; step 6 amended 2026-09-13 so recitals are recorded as dictated, not drafted (`Engineering/1. Design/2026-09-13_paralegal-posture-and-outline-vocabulary-design.md` §5.2)
---

# Requisition in minutes

## The journey

A requisition is the small filing. The conversation is a picker, not the guided elicitation of the big VanIAC package: the assistant offers choices, the practitioner picks, and two drafts appear.

1. **Practitioner:** asks for a requisition for default judgment against the defendant.

2. **Assistant:** the operative terms of a default judgment come from a closed set of term templates — this is a menu, not a drafting exercise. The assistant lists the choices in plain language:

   > Which orders should the judgment contain? Pick any that apply:
   > judgment for a fixed sum · damages to be assessed · delivery of goods or their assessed value · interest as claimed · Court Order Interest Act interest · costs fixed at an amount · costs to be assessed.

3. **Practitioner:** picks a fixed sum with interest as claimed and fixed costs, and adds an alternative chain: "delivery of the Bobcat, or failing that, its assessed value."

4. **Assistant:** elicits each picked template's values — the sum, the costs figure, the goods description. For the interest amount it never computes or estimates: it elicits the principal and the interest dates as matter facts, hands the arithmetic to the Probanda plugin's `/calculate` with `court-interest-calculator` (`contract-interest-rates` for a contractual term), and stores the total that skill reports. It also asks the two quick attachment questions — is the draft order attached, is the affidavit of service on file — then writes the Writing and renders immediately, no approval pause. Two mockups come out of the one Writing: the requisition and the draft judgment, each sent into the conversation as its own clickable file card (`shared/present-files.md`). On the requisition mockup, each attachment not yet on file carries its own not-yet-attached line — the checklist lives on the mockup, not in chat.

5. **Practitioner:** opens the cards, sees the not-yet-attached line for the affidavit of service, and deals with it on their own schedule. Later the same session: "Now a consent order on the Harrison file — the parties have settled."

6. **Assistant:** switches texture with the subkind. Consent order terms are free-form numbered recitals, not templates, so it asks the practitioner for the wording, records each recital as dictated, reads the recitals back, and asks for the wording wherever the dictation leaves a term open — never drafting one from the settlement terms itself. It also confirms counsel of record for each consenting party:

   > Confirming who signs: Chen Law for the plaintiff, Osler for the defendant Harrison. The second defendant is self-represented, so the signature block will carry the two counsel only.

   A party with no counsel of record is omitted from the signature block by design — that is the correct rendering, not a gap.

7. **Assistant:** writes and renders. Again two file cards: the requisition and the draft consent order, recitals numbered, signature blocks for represented parties only.

## Principles this journey encodes

- **Texture follows the Writing.** Default judgment is a picker over a closed set of term templates; consent order is free-form recitals, recorded as the practitioner dictates them and read back. The assistant never makes the small filing feel like the big package.
- **Arithmetic is delegated, never inferred.** Interest amounts come only from `/calculate` with `court-interest-calculator`. The assistant elicits the principal and dates as matter facts; the calculation is never its own.
- **Alternatives chain, they don't multiply.** "Grant X, or failing that Y" is one order with a fallback, rendered as its own top-level order paragraph marked "in the alternative" — not two competing orders.
- **The checklist lives on the mockup.** Whether the draft order and affidavit of service are attached renders as not-yet-attached lines on the requisition mockup; chat asks once, the mockup remembers.
- **One Writing, two drafts.** The requisition and its draft order or judgment always render together, each presented as its own file card — consistent with the no-blocking-checkpoint rule in `SKILL.md`.
