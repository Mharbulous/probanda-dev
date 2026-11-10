---
journey: Pick up where you left off (resume, review, orchestrate)
kind: ux journey — describes the interaction the practitioner experiences, not the data model. Data-focused journeys use a different format and live in `source/skills/drafting-data/User_Journeys/`.
actor: practitioner
trigger: /draft invoked with no arguments, in a project whose workspace is a specific litigation matter folder
outcome: the in-progress submission's mockups are regenerated and shown immediately, outstanding work is dispatched to parallel subagents under the practitioner's own list of what to do, read back and approved, and a revised mockup (revision bumped) is presented when they finish
path: happy
status: aspirational (desired UX — not yet verified against the implementation)
source: effort owner's description, 2026-08-23; steps 2/4/5 amended 2026-08-23 for the generate-present-confirm-then-read sequence (issue #337); steps 5–6 amended 2026-09-13 so the practitioner, not the assistant, says what is done about each gap (`Engineering/1. Design/2026-09-13_paralegal-posture-and-outline-vocabulary-design.md` §5.1)
note: superseded in part by schema v15 / ADR 0009 (2026-09-02) — a session is now job-driven; the "one approval, of the practitioner's own list" model below describes work done *inside* an approved job's plan, not a standalone flow entered without a claimed job.
---

# Pick up where you left off (resume, review, orchestrate)

## The journey

1. **Practitioner:** invokes `/draft` with no arguments. The project's workspace is a specific litigation matter folder, so the matter is already known — nothing to ask.

2. **Assistant:** identifies the submission most recently worked on for this client matter, immediately calls the engine to generate the mockup projection of every document whose drafting has started for that submission, and presents the mockup markdown files (`shared/present-files.md`) as soon as they are generated. Mockups first, questions second — the practitioner should be looking at their work product before they are asked anything. (SKILL.md step 2 asks first now; this order stays aspirational.)

   The assistant **generates and presents without reading**. `drafting_forms__bootstrap` returns paths, never content ([#337](https://github.com/Mharbulous/CoClerk/issues/337)), so this step costs nothing beyond the file list — the practitioner may be about to say "no, the other one", and reading a document that is about to be set aside is wasted. Then:

   > Are these the submissions you want to work on?
   > Other submissions with incomplete drafting work include:
   >
   > 1. Notice of Application (Better particulars)
   > 2. Requisition for Consent Order (List of Documents)

3. **Practitioner:** asks to switch to the Notice of Application.

4. **Assistant:** immediately calls the engine to generate the mockup projection of the documents whose drafting has started for the Notice of Application (Better particulars), and presents those mockup markdown files for review. Same pattern as step 2: no confirmation prompt before rendering — rendering is cheap and read-only, so showing is always better than asking. Still no reading: the practitioner has named this Writing, but they have not yet said they are done switching.

5. **Assistant:** with the Writing settled, the assistant now reads it — calling `drafting_forms__render` on that one Writing, which writes the mockups into the Writing's own folder itself, and interpreting the work markers (the emojis — see the mockup's closing Legend) in the `markdown` it returns for each document named in its `documents`, to understand what work remains. It reads through the tool response, not by opening the file: a session never opens the mockup files itself (ADR 0013 keeps that rule now that they sit in the matter's `0. CASE DATA` folder), so the response is the reliable channel ([#337](https://github.com/Mharbulous/CoClerk/issues/337)) — only a document too large to return inline is read from its presentation copy. Reading the text here is not licence to paste it into chat — the practitioner still reviews the file. The markers tell the assistant what the Writing still lacks. What to do about each gap is the practitioner's to say, so the assistant asks, one gap at a time, and records each answer as given:

   > The better-particulars order has no authority behind it yet. What do you want done about that?

   When the practitioner has dealt with every gap, the assistant reads their list back in their words and asks whether it stands:

   > You asked for: research on the court's power to order better particulars; a demand letter to opposing counsel before anything is filed; the costs point left until after the hearing. Is that the list, or has anything changed?

   How the list runs is a mechanical choice and the assistant's alone, stated in one line: independent items fan out to subagents in parallel, items touching the same passage run in turn, and an item waiting on another runs after it.

6. **Practitioner:** confirms the list as read back and approves it.

7. **Assistant:** dispatches custom subagents to work the practitioner's list. Each time a subagent completes its task — or gets stuck and needs the practitioner's input — the assistant reports back with a TLDR summary. The practitioner watches progress without having to supervise it.

8. **Assistant:** when all subagents have completed, calls the engine again to regenerate the mockup projection. The regenerated file overwrites the existing mockup, bumps the mockup's revision number, and is presented to the practitioner for review — closing the loop where it started: looking at the current state of the work product.

## Principles this journey encodes

- **Show before asking.** Every context switch (session start, submission switch, work completion) leads with a freshly rendered mockup, not a question. The mockup is the review surface; conversation is secondary.

- **Render everything, read one thing.** Generating the mockups is cheap and happens for every Writing; reading them costs context and happens only for the Writing the practitioner has confirmed. Bootstrap therefore hands back paths and no content, and the read is a separate call on the settled Writing. A session that reads on entry pays for every document the practitioner is about to skip past.
- **The mockup is also the worklist.** The assistant finds the gaps by reading the same work markers the practitioner sees. There is no separate task list to maintain or drift out of sync.
- **The practitioner says what is done.** The assistant asks about each gap and never decides what to do about one. The list that runs is the practitioner's, read back in their words.
- **One approval, of the practitioner's own list.** The only pause is approval of that list as read back. How it fans out is a mechanical choice the assistant states and makes. Writing and rendering individual changes still never block on approval, consistent with the no-blocking-checkpoint rule in `SKILL.md`.
- **Report by TLDR, interrupt only when stuck.** Subagent completions arrive as short summaries; questions surface only when a subagent genuinely needs the practitioner.
- **Revisions supersede.** Regeneration replaces the prior mockup, bumps its revision number, and archives the superseded copy — the practitioner always has exactly one current mockup per document, with a paper trail behind it.
