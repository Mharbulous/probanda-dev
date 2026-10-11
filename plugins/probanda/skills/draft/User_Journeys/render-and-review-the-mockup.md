---
journey: Render and review the mockup
kind: ux journey — describes the interaction the practitioner experiences, not the data model. Data-focused journeys use a different format and live in `.claude/skills/drafting-data/User_Journeys/`.
actor: practitioner
trigger: any drafting journey reaches a point where something was written — or the practitioner simply asks to see the current state of a document
outcome: the practitioner has opened the one current mockup of the document, read the outstanding work off its markers without a manual, and asked for the next change in plain words
path: happy
status: verified (E2E 2026-08-25, BCSC Notice of Application, docs/E2E-tests/2026-08-25 draft-submission-e2e-test.md — steps 1-4, 6-7 confirmed; step 5's reserved-material bullet holds with the court-form exception noted above)
source: effort owner's flow selection, 2026-08-23
---

# Render and review the mockup

Every other journey funnels into this one. Whatever was just written — a new submission, a research result, a revision — the loop closes the same way: render, present, review.

## The journey

1. **Practitioner:** finishes describing a change, or asks to see where a document stands.

2. **Assistant:** calls the engine to render the mockup. Rendering is deterministic, cheap, and read-only — a fresh projection of whatever is stored right now, never an authored file, so there is nothing to lose by regenerating and no reason to ask first. The new mockup overwrites the old one in the matter's mockups folder, which sits beside the matter's database rather than in the working document tree; the mockup carries a revision stamp showing its currency, and when the revision has moved since the last render, the superseded copy is archived. The practitioner always has exactly one current mockup per document, never a pile of stale copies.

3. **Assistant:** presents the mockup by sending the file itself into the conversation as a clickable file card — the way a chat client surfaces an attached document. It never pastes or summarizes the mockup's content into chat: the mockup is the review surface, chat is not.

   > Here is the current mockup of the Written Argument (revision 14).
   >
   > *(file card: the practitioner opens it in one click)*

4. **Practitioner:** opens the card and reviews on their own schedule — now, after the next phone call, or tomorrow. Nothing in the pipeline waits on approval.

5. **Practitioner:** reads the surface without needing a manual, because it follows four rules:
   - **Our outstanding work** renders as a marker immediately after the component it belongs to — 📜 excerpt needed after an authority's passage not yet captured, 👤 no witness after a fact nobody yet proves. The excerpt and pinpoint markers name their kind of source, so the same work on an exhibit reads 📑 and 📌, and on a witness's own words 💬 and 🧷.
   - **Events caused by the other side or the world** render as a prefix in front of the work they routed — ⏰ deemed admission in front of the capture work it triggered, 🙅🏻‍♂️ denied in front of the evidence work it sent us to.
   - **Reserved material** sits in the trailing *Held in reserve* section — rendered for the human, withheld from the forum. Unverified authority leads sit there too, beside the slot they might fill. **Court-form exception** (the BCSC Notice of Application, [#367](https://github.com/Mharbulous/CoClerk/issues/367)): this form has no trailing section at all, so a reserved order instead renders inline in Part 1, crossed out (struck through, unnumbered), and a reserved submission/statement simply does not render on it — both still never reach the filed face.
   - **A finished component carries no mark at all.** Nothing prints for done — a clean line is the good news.

6. **Practitioner:** ends the review the same way the drafting started — by asking for the next change in plain words.

   > Paragraph 6 overstates it. Say the invoice was disputed, not refused. And drop the second relief item.

7. **Assistant:** treats that as re-entering the drafting flow — elicit, write, re-render — per `revise-by-asking-again.md`. The next mockup arrives the same way this one did, revision bumped.

## Principles this journey encodes

- **Render freely, never ask first.** The mockup is a projection, not an authored file — regenerating it is free and destroys nothing, so a fresh render always beats a confirmation prompt.
- **Hand over the file, not a summary.** The mockup arrives as a clickable file card; chat carries the conversation, the mockup carries the work product.
- **One current copy.** Overwrite on regeneration, revision stamp for currency, archive for the superseded — the practitioner never has to guess which file is live.
- **The markers are the worklist.** Our to-dos after their components, the world's events as prefixes, reserve in its own trailing section, silence for done — the document reports its own remaining work.
- **Review has no exit gate.** It ends when the practitioner asks for the next change, in the same plain words that started the draft.

## What happens next

In v1 the mockup is this pipeline's only output — there is no export to Word or PDF yet. The road from Word draft through sworn to filed is the data journey `.claude/skills/drafting-data/User_Journeys/drafted-document-lifecycle.md`.
