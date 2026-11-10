---
journey: A better copy arrives
kind: ux journey — describes the interaction the practitioner experiences, not the data model. Data-focused journeys use a different format and live in `source/skills/drafting-data/User_Journeys/`.
actor: practitioner
trigger: partway through drafting, a better copy of a source document turns up — the sworn original replacing an unsigned draft, a clean scan replacing a photo of a screen, the filed copy coming back court-stamped
outcome: the new copy is recorded, the best-copy selection moves to it, and the next render reflects the change everywhere the document appears — with the 🏆 not best copy marker appearing or clearing accordingly, and every prior copy kept
path: happy
status: aspirational (desired UX — not yet verified against the implementation)
source: effort owner's flow selection, 2026-08-23
---

# A better copy arrives

## The journey

1. **Practitioner:** is mid-session drafting a VanIAC submissions package. The Consulting Agreement is Exhibit B, and the only copy on file is the client's unsigned draft. The client's email lands:

   > The client just sent over the signed original of the Consulting Agreement — here it is.

   One sentence, one dropped file. No instructions about exhibits, indexes, or references.

2. **Assistant:** records the arrival through `/drafting-data` as another copy of the same document — the label the exhibit already points at. The unsigned draft is not overwritten or deleted; the new copy joins it, and the paper trail keeps both. The assistant then compares the copies on the three ranked dimensions — lifecycle stage, then completeness, then quality, in strict order, never averaged (see `source/skills/drafting-data/User_Journeys/choose-the-best-copy.md`) — and the signed original wins on stage, so the best-copy selection moves to it.

3. **Assistant:** re-renders immediately and presents the regenerated mockup file into the conversation as a clickable file card (`shared/present-files.md`) — no approval pause, no summary of its contents in chat beyond:

   > Recorded the signed original as a new copy of the Consulting Agreement. The selection moved to it, and the mockup is regenerated.

4. **Practitioner:** opens the mockup. The change is everywhere the document appears — the evidence index line now shows the signed original as the selected copy, and the Exhibit B reference resolves to it. The 🏆 *not best copy* marker that had sat on the line while the selection lagged behind what the firm actually held is gone. The practitioner re-plumbed nothing: the exhibit reference and the index line name the document, and the selection decides which copy answers (see `source/skills/drafting-data/User_Journeys/exhibit-the-best-copy.md`).

5. **Practitioner:** later in the same session, mentions in passing:

   > The registry sent back our filed affidavit, court-stamped. It's in the matter folder.

6. **Assistant:** same move without being asked twice — records the court-stamped copy, re-runs the ranked comparison (it ties the prior copy on stage and completeness and wins on quality), moves the selection, re-renders, presents the mockup file card. Where a new copy has been recorded but the selection has not yet been re-judged, 🏆 renders on the document's line until it is — the mockup catches a stale selection on review, before anything is assembled from it.

## Principles this journey encodes

- **One sentence carries the whole ripple.** The practitioner names the new copy once; recording, re-selection, and every rendered reference update through one write and one render. They never edit an index line or an exhibit reference by hand.
- **References name the document; the selection picks the copy.** That is why nothing needs re-plumbing — the paired data journeys (`choose-the-best-copy.md`, `exhibit-the-best-copy.md`) carry the shape, this journey carries the experience.
- **The paper trail keeps every copy.** A superseded copy is never deleted, and anything assembled before the selection moved keeps what it attached.
- **🏆 is the safety net, not the workflow.** The marker renders whenever no copy is selected or a copy arrived after the selection was last judged, so a stale choice surfaces on the mockup — rendered for the human, never silently carried into the filed bundle.
- **No approval pause.** Recording and re-rendering happen on the practitioner's sentence alone; the regenerated mockup is the review surface, consistent with the no-blocking-checkpoint rule in `SKILL.md`.
