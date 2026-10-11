---
journey: Fact work on the witness statement
actor: drafter reviewing a witness-statement mockup
trigger: the witness-statement mockup is regenerated for a VanIAC submissions package
outcome: every fact attributed to a witness is either drafted into a numbered paragraph of that witness's statement or visible on the mockup as work still to do — never silently missing, never misdescribed as "sign it"
preceded_by:
  - Link facts to evidence (statements of fact)
followed_by:
  - Render and review the mockup
schema:
  - statements_of_fact (witness_id NOT NULL, interviewed, exhibit_pinpoint, disposition='included' — the rows this journey lists; the row's own `pinpoint` is the instrument's locator and is unreachable here, since an unlinked fact has no instrument)
  - facts (postulate, posture)
  - statement_paragraphs / paragraph_statements_of_fact (the link that moves a fact out of the subsection)
  - documents (instrument='witness_statement', execution — the statement's own sign-it column)
machinery:
  - renderer: renderWitnessStatements (source/probanda/mcp/src/submission/forms/render-vaniac-submissions.ts) — the statement-level 🧩 and the trailing "Facts attributed to this witness, not yet in this statement" subsection (build #329)
work_markers: 🧩 no facts attributed to this witness (statement-level, derived) · 🗣️ talk to witness · ✍️ draft it · 📌 exhibit pinpoint missing — never 🖋️ and never 🧷 on an unlinked fact (build #329, decision #320; pinpoint split by basis #511)
documents: VanIAC witness-statement mockups (one per witness)
source: issue 329 build, 2026-08-23 (implements issue #320's ratified decision)
status: ratified
---

# Fact work on the witness statement

## The journey

1. A witness is attributed one or more statements of fact before any paragraph exists to hold them — attribution and drafting are separate acts, and the gap between them is real, ongoing work, not an error state.
2. The drafter opens the witness's statement mockup. If the witness has no included statement of fact at all, the statement's own line reads 🧩 *no facts attributed to this witness* in place of the (empty) paragraph list — there is nothing to sign because nothing has been attributed yet, and the mockup says so instead of the old, wrong "sign it."
3. If the witness does have attributed facts, each one not yet linked to a numbered paragraph of *this* statement lists in a trailing subsection: the fact's postulate, its posture note if one exists, and its rung — 🗣️ if the witness hasn't been interviewed on it yet, ✍️ once interviewed but not yet written into a paragraph, 📌 if an exhibit backs it and that exhibit's pinpoint is not recorded. The rung never includes 🖋️ or ✒️: an unlinked fact was never written into this instrument, so there is nothing here to sign. For the same reason it never includes 🧷: the testimony locator points into an instrument, and this fact has not been written into one. 📌 is unaffected, because it points into the exhibit rather than the instrument.
4. The drafter works the rungs in order — interview, draft the paragraph, link it via `paragraph_statements_of_fact` — and the fact drops out of the subsection the moment the link exists, whether or not the statement is signed yet.
5. Once at least one paragraph is linked, the statement's own 🖋️ becomes reachable again: NULL `execution` now correctly means "drafted, not yet signed," not "nothing here yet."
6. Subsection and statement-level 🧩 are mutually exclusive by construction — an empty included-fact set has nothing to list — but a witness with attributed facts and zero paragraphs gets the subsection with no 🧩 and no 🖋️, which is the correct reading of both predicates at once.

## Why the data is shaped this way

- The subsection is rendered for the human and withheld from the filed face by the same trailing-section mechanism as *Held in reserve* — it is drafting to-do, not something a tribunal should ever see.
- The rung reuses the fact-side ladder's existing emoji (🗣️/✍️/📌) rather than inventing new ones for the "not yet in this statement" case — same emoji, same work, work-markers.md's established symmetry.
- 🖋️/✒️ are structurally unreachable for an unlinked fact (the renderer passes a null instrument to the shared marker predicate, not just a convention to remember) so the subsection can never assert "sign it" about work that hasn't been drafted.
- The statement-level 🧩 and the per-paragraph 🧩 (an existing marker: a drafted paragraph with no fact linked) read different directions of the same gap — one flags a paragraph with nothing behind it, the other flags a witness with nothing drafted yet — and both can appear on the same mockup without conflict.

## What would break if this were deleted

Without the statement-level 🧩 and the corrected 🖋️ predicate, an empty witness statement — no facts attributed, nothing drafted — renders "sign it," which asks the witness to swear to a document with no content. That was the actual live-matter bug this journey fixes: on the VanIAC L8212 file, the Andrew and Jesse Marlowe witness statements had zero paragraphs and rendered 🖋️ anyway, misdirecting the practitioner's next action from "find out what this witness knows" to "get this signed."
