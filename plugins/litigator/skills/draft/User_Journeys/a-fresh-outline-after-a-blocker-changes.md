---
journey: A fresh outline after a blocker changes
kind: ux journey — describes the interaction the practitioner experiences, not the data model. Data-focused journeys use a different format and live in `.claude/skills/drafting-data/User_Journeys/`.
actor: practitioner
trigger: a job the practitioner outlined was waiting on another, what it waited on was superseded and came out differently, and the Work Board shows the waiting job as Blocked by a superseded job
outcome: the practitioner decides, in their own words, how the waiting job now stands; that decision and their reasoning are recorded verbatim and the job is written afresh; a loose thread from an earlier session is put to them as a three-way choice and handled as they say
path: happy
status: aspirational
source: Engineering/1. Design/2026-09-13_paralegal-posture-and-outline-vocabulary-design.md
---

# A fresh outline after a blocker changes

Continues `outline-a-new-application.md`. The orders job was outlined as waiting on the draft bill of costs. The bill was redone, the original bill-of-costs job was superseded, and the redone bill came in at $48,000 rather than the $60,000 the orders were outlined around.

## The journey

1. **Practitioner:** opens `/draft` on the Notice of Application and chooses "Something else…". The Work Board shows the orders job under Blocked, its blocker superseded and needing a fresh outline, and one loose thread under "Loose Threads".

2. **Assistant:** says what changed, from the record, and asks how the practitioner wants to handle it. It does not suggest a new figure.

   > The orders job was waiting on the bill of costs, and the bill came in at $48,000, not $60,000. The board shows the orders as needing a fresh outline. How do you want to handle it?

3. **Practitioner:** decides.

   > Ask for $50,000. Round up — the bill is a floor, not a ceiling.

4. **Assistant:** records the decision and the reasoning in the practitioner's words, says so, names the waiting-on that is now gone, and reads back the steps the orders job had. One job is not a list, so the read-back is the ordinary approve-or-change decision form, not the multi-select that starts at two items (`.claude/skills/shared/elicitation-widget.md` §2a).

   > Recorded as your reasoning, in those words. The orders job is no longer waiting on the bill of costs. Same three steps as before?
   >
   > *(decision form, abbreviated here to its two options: **Approve** · **Change**)*

   **Practitioner:** approves.

5. **Assistant:** writes the orders job afresh with the practitioner's figure, reasoning and confirmed steps.

6. **Assistant:** quotes the loose thread and puts it to a three-way choice. It does not recommend one.

   > Written. There's one loose thread from last session — you mentioned Mr. Baker might have a counterclaim. Outline it now, leave it as an idea, or drop it?

7. **Practitioner:** leave it. **Assistant:** leaves the loose thread untouched under "Loose Threads" and re-renders; the Writing's own Work Board page updates.

## Principles this journey encodes

- **A superseded blocker reopens the practitioner's decision, never the assistant's.** What changed is stated from the record, and how the waiting job now stands is asked (`.claude/skills/shared/paralegal-posture.md`).
- **Reasoning is recorded verbatim.** The practitioner's reason for the new figure goes in as they said it, and they are told so.
- **Steps are read back, not re-planned.** The job's existing steps are put back to the practitioner to confirm or change.
- **A loose thread is quoted and put to a three-way choice.** Outline it now, leave it as an idea, or drop it. The practitioner chooses; the assistant never ranks the options.
