---
journey: Flag evidence that may not be admissible
actor: drafting skill or practitioner at the moment of linking; practitioner later deciding
trigger: a fact is being linked to the evidence that proves it, and the evidence has an admissibility problem
outcome: every admissibility concern is recorded where it was seen and surfaces later in one list for a fact-by-fact decision
preceded_by:
  - Link facts to evidence (statements_of_fact)
followed_by:
  - Evidence table review (future evidence-table skill)
  - Responding to an application (the same list is the objection list)
schema:
  - statements_of_fact (admissibility_note, interviewed)
  - facts
machinery:
  - drafting skills that write statements_of_fact rows
  - future evidence-table skill (lists every noted fact for decision)
  - renderer: nothing in v1 renders the note (open question below)
work_markers: none in v1
documents: any document whose facts rest on the noted evidence; objection list when responding
source: issue 301 grilling, 2026-08-19 (ratified by the effort owner)
status: ratified
---

# Flag evidence that may not be admissible

## The journey

1. While linking a fact to its evidence, the drafting skill or the practitioner notices the evidence has an admissibility problem: hearsay in an affidavit on a final application, a without-prejudice letter, a document no witness can authenticate, lay opinion, a witness who will not attend.
2. The concern is recorded on the `statements_of_fact` row as `admissibility_note`, at the point where the link is made, because that is the moment the problem is visible and the person who saw it is still in context.
3. The fact still drafts into the document — the practitioner may decide to run the risk — but the note follows the link.
4. A later pass (the future evidence-table skill) lists every fact with an admissibility note so the practitioner decides, fact by fact: find better evidence, reword, drop, or proceed. When responding to the other side's application, the same table is the objection list.

## Why the data is shaped this way

- The note lives on `statements_of_fact`, not on `facts`, because admissibility is a property of a particular piece of evidence proving a particular fact; the same fact may have a clean source and a tainted one.
- Free text, not an enum: the concern is a lawyer's sentence, and the reader is the practitioner.

## Open question for v1

Nothing in v1 renders the note, so in v1 the practitioner has no surface for it. If it is worth recording in v1 it is worth showing: the natural place is a text annotation on the evidence line of the mockup, the way `facts.posture` shows disputed/agreed. Decided in issue 301's resolution.
