---
journey: Outline a new application
kind: ux journey — describes the interaction the practitioner experiences, not the data model. Data-focused journeys use a different format and live in `.claude/skills/drafting-data/User_Journeys/`.
actor: practitioner
trigger: the practitioner asks to start an application on a matter whose proceeding is already recorded and which has no Writing of that kind yet
outcome: the empty Writing exists, and the work on its Job Board was outlined by the practitioner, recorded in their words, and read back before it was written — the assistant proposed none of it
path: happy
status: aspirational
source: Engineering/1. Design/2026-09-13_paralegal-posture-and-outline-vocabulary-design.md; steps 8 to 12 amended 2026-09-14 so the assistant divides the work into jobs without asking (that design's Amendment, #569)
---

# Outline a new application

Hypothetical: Northgate, an Alberta numbered company, sues our client Hasbro and its principal Donathon Baker personally.

## The journey

1. **Practitioner:** opens `/draft`.

   > Clients have instructed us to apply for security for costs against the plaintiff in the Northgate matter. Let's get that started.

2. **Assistant:** confirms the proceeding rather than assuming it.

   > Would that be in the BCSC Proceeding S-145212, Vancouver Registry?

   **Practitioner:** yes.

3. **Assistant:** finds no security-for-costs application in the works, and no retired one to recover, and asks before creating the Writing.

   > No security for costs applications are in the works yet. Shall I create it as a new BCSC Notice of Application in the same proceeding?

   **Practitioner:** yes. **Assistant:** creates the empty Writing and renders it. Its Job Board is empty.

4. **Assistant:** opens the outlining session with the practitioner talking. It offers no candidate jobs.

   > Done. The Job Board is empty and I'm ready to record your ideas. Can you outline the application? Which parties will you specifically be seeking costs from?

5. **Practitioner:** outlines it.

   > Northgate is suing our client, Hasbro, but they've also named the principal of Hasbro personally. We'd like an order for security for costs in relation to the claims against the principal, Donathon Baker, in his personal capacity. We want a stay of proceedings until Northgate either drops all claims against Donathon personally or $60,000 is paid into court.

6. **Assistant:** records it and confirms the scope of what is sought.

   > Recorded. So the security is sought only in respect of the personal claims against Mr. Baker, not the claims against Hasbro — is that right?

   **Practitioner:** correct.

7. **Assistant:** asks where the figure comes from. It does not estimate one.

   > Where does the $60,000 figure come from?

   **Practitioner:** a rough estimate of Mr. Baker's costs through trial, to be firmed up.

8. **Assistant:** asks how the figure will be firmed up.

   > How will the figure be firmed up?

   **Practitioner:** a draft bill of costs, and the orders can't be finalized until it is done. **Assistant:** records the bill of costs as its own job, with the orders waiting on it.

9. **Assistant:** asks what the court will be told.

   > What will you be telling the court about Northgate?

   **Practitioner:** two things. Northgate has no assets in BC that anyone can find, and the personal claim against Mr. Baker is bound to fail because there is no pleaded basis for piercing the corporate veil. **Assistant:** records the two propositions as separate jobs.

10. **Assistant:** asks what evidence is in hand.

    > What evidence do you have in hand on Northgate's finances?

    **Practitioner:** a corporate registry search and a land title search that came back empty; an affidavit exhibiting them, and a demand letter to Northgate's counsel first. **Assistant:** records one evidence job, the demand letter as a step before the affidavit.

11. **Assistant:** records the merits point as the practitioner's own legal view and asks whether to verify it. It states no law and dispatches nothing.

    > On the merits point, you've stated a view. Do you want that verified as a research job before it goes into the argument, or are you content to rely on your own reading of the pleadings for now?

    **Practitioner:** research it. **Assistant:** records a research job for it.

12. **Assistant:** asks what else the practitioner wants in place.

    > Anything else you'd want in place before this is heard?

    **Practitioner:** Northgate will say ordering security stifles a bona fide claim, and they want to be ready for that. **Assistant:** records it as its own job.

13. **Assistant:** reads the jobs back in the practitioner's words before writing anything: the draft bill of costs; the orders, waiting on the bill; Northgate's finances (demand letter, then the affidavit exhibiting the searches); the merits point; research on the merits point; the answer to the stifling argument. It asks nothing about order.

14. **Assistant:** presents the six jobs as a multi-select read-back, each card in the practitioner's words, and writes the ones selected, the bill of costs before the orders that wait on it. It re-renders; the Writing's own Job Board page updates.

    > Written. The Job Board shows six jobs.

## Principles this journey encodes

- **Four question shapes, no others.** Every prompt confirms a fact the practitioner gave, asks for a missing piece, asks them to choose, or reads back and asks whether it still stands (`.claude/skills/shared/paralegal-posture.md`).
- **The practitioner supplies what the record cannot.** The assistant never proposes a position, a figure, a legal test, or a priority. Where the record already holds the candidates, it proposes them with their sources and the practitioner approves or changes them. An empty board with nothing on record to draw from opens with a question, not candidates. How the work divides into jobs, and what waits on what, is the assistant's and never asked.
- **Reasoning is recorded verbatim.** What the practitioner says, including why, goes in as they said it, and is read back before anything is written.
- **Legal views are the practitioner's propositions.** A stated view of the law is recorded as theirs and becomes research only on their instruction, never by the assistant's own dispatch.
- **Order is never asked.** Jobs that depend on each other are worked blocker first; the rest are worked in parallel. An order the practitioner volunteers is recorded.
