---
journey: Offer what the matter already knows
kind: ux journey — describes the interaction the practitioner experiences, not the data model. Data-focused journeys use a different format and live in `source/skills/drafting-data/User_Journeys/`.
actor: practitioner
trigger: /draft invoked to start a Writing, on a matter whose drafting database predates the current schema and whose proceeding has not yet been recorded
outcome: the database is brought current without conversation, the proceeding and its parties are recorded once from confirmed details the matter already held, and the Writing's mockup is presented — the practitioner re-typed nothing
path: happy
status: aspirational (desired UX — not yet verified against the implementation)
source: effort owner's flow selection, 2026-08-23
---

# Offer what the matter already knows

## The journey

1. **Practitioner:** invokes `/draft` to start a Notice of Application on this matter.

2. **Assistant:** enters the session through bootstrap, which reports the matter's drafting database is on an older schema version. Before doing anything else it migrates the database to current — no question asked, no plan presented. The practitioner never asked about schema versions and sees at most one line:

   > Brought this matter's drafting database up to date.

   Then straight on to the work. (A migrate on entry was observed live in `docs/E2E-tests/2026-08-23-1220 draft-submission-e2e-test.md` §3.6–3.7.)

3. **Assistant:** this matter has no proceeding on record yet, so the shared prologue comes first — the proceeding and every party with their role, gathered once and reused by every later Writing (`source/skills/drafting-data/references/filing-checklists.md` §0). But instead of opening with blank questions, the assistant first consults `/matter-data` and the practice database's matter lookup, and proposes what the matter already knows:

   > This proceeding isn't recorded yet. From the matter file, here is what I would record — confirm or correct anything:
   >
   > - BCSC, Vancouver registry, file S-245678
   > - Plaintiff: Norgate Holdings Ltd. (our client), counsel B. Whatisfair
   > - Defendant: Pacific Crane Services Inc., counsel R. Osei of Harrow LLP

4. **Practitioner:** corrects one detail — opposing counsel moved firms last month — and confirms the rest.

5. **Assistant:** counsel of record is court-record state that matter-data owns, so the corrected firm is written to matter-data first, through `/matter-data`'s own gate. Then it records the confirmed proceeding and parties through `/drafting-data`, each party linked to its matter-data party, and moves to the Writing's own substance the same way: anything the matter already holds is offered as a starting point, and only what nobody has recorded yet — relief sought, tactical choices — is asked fresh. Apart from counsel of record and the address for service, nothing written here flows back while the Writing is live: the drafting database is deliberately separate from matter-data for drafting, and the assistant says so once if asked, not as a recurring disclaimer. The one designed flow-back comes much later, when the Writing is retired and its research is handed to matter-data on purpose — see `retire-a-filing.md`.

6. **Assistant:** writes the Writing's elicited substance and renders the mockup, presenting the mockup file itself (`shared/present-files.md`) into the conversation for the practitioner to open in one click. Anything a work marker flags as unresearched law stays an open slot for `/legal-research` — the assistant proposes matter facts, never legal content.

7. **Practitioner:** weeks later, starts a second Writing on the same proceeding. The assistant reuses the recorded proceeding and parties without asking a single question already answered, and the conversation begins at the new Writing's substance. Counsel of record is the one thing checked again: session entry compares each party's counsel and address for service with matter-data, which has applied every notice filed since. When the defendant's lawyer has since filed a Notice of Withdrawal, the assistant shows the stored counsel beside matter-data's (none, the defendant at its own address) and the practitioner confirms before the party and its recipients are refreshed. A Writing already sent keeps the counsel it printed.

## Principles this journey encodes

- **Migrations are housekeeping, not conversation.** Entering a session brings the database current before anything else, transparently — the practitioner manages a matter, never a schema version.
- **Offer, don't re-ask.** Details the matter already holds are proposed for confirmation, never re-typed by the practitioner. Confirming borrowed data checks its accuracy; it is not an approval checkpoint — writing and rendering still never pause for approval.
- **A convenience, not an integration.** The lookup flows one way. Nothing the practitioner confirms or corrects here syncs back to matter-data or the practice database — and that holds for as long as the Writing is being drafted. Retiring the Writing is the single designed moment when its research does flow back, once, deliberately (`retire-a-filing.md`); a running sync is still never built. Counsel of record and the address for service are the exception, because matter-data owns them: they are read live, and a correction to them goes to matter-data first, through `/matter-data` (ADR 0011's 2026-09-30 amendment).
- **Elicit once per proceeding.** The proceeding and its parties are the shared prologue: recorded on the first Writing, reused by every later Writing without repetition. Counsel of record and the address for service are compared with matter-data at every session entry instead.
- **Facts are offered, law is not.** The assistant proposes party and matter details from the record; statements of law come only through `/legal-research`, and an unresearched slot stays honestly open on the mockup.
