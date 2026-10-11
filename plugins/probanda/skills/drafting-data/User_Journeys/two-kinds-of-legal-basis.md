---
journey: Two kinds of legal basis for every order sought
actor: drafting skill (opens the slots), research-agent agent (fills them), practitioner (reviews on the mockup)
trigger: an order sought is added to a Writing, or an argument supporting one is drafted
outcome: every order sought has an authority for the power to grant it and an authority for the test applied to decide whether to grant it, or a dead end recorded for each
preceded_by:
  - Draft the submission skeleton (orders sought and submissions with open slots)
followed_by:
  - Broad sweep to verified authority (how the slots get filled)
  - Render and review the mockup
schema:
  - relief_items (the order sought; jurisdiction_slot_state)
  - submissions, law_assertions, statements_of_law (schema v3, #328/#323 — argument_authorities dissolved into law_assertions + statements_of_law)
  - authorities
machinery:
  - legal-research gate / research-agent agent
  - renderer: 🏛️ and 📖 on open slots, 🚧 on dead ends (⚖️ struck #312; the pair moved onto separate columns, no longer a shared slot)
work_markers: 🏛️ jurisdictional basis needed; 📖 doctrinal basis needed; 🚧 dead end
documents: VanIAC written argument; Form 32 Part 3 legal basis; Form 8 recital (jurisdictional only, by rule reference)
source: issue 301 grilling, 2026-08-19 (effort owner's description); vocabulary from prepare-application's glossary "Basis"
status: verified (#305, 2026-08-19; the #302 open question on slot placement stands)
---

# Two kinds of legal basis for every order sought

## The journey

1. An order sought goes into a Writing — "that the respondent pay $X", "that the claim be dismissed". Two legal questions open at once, and each needs its own authority:
   - **Jurisdictional basis** — *can* this court or tribunal make this order at all? Answered by a rule, a statute, or a case in which the order was made. It proves the power exists; it says nothing about whether the power should be exercised here. Every order has exactly one.
   - **Doctrinal basis** — *how* does the decision-maker decide whether to make it? The test: the elements that must be proven, the factors to be weighed. An order may rest on several.
2. The drafting skill opens an authority slot for each: `relief_items.jurisdiction_slot_state` for the jurisdictional slot, a `law_assertions` row (linked via `submission_law`) for the doctrinal one, each with its own wording in words so the research lawyer knows what is wanted.
3. The research lawyer fills each slot through the legal-research gate (often starting from a tier-3 lead — see `broad-sweep-to-verified-authority.md`). A jurisdictional slot research cannot fill becomes `jurisdiction_slot_state='dead_end'` (🚧); a doctrinal one becomes `law_assertions.dead_end=1` (🚧), and the practitioner decides what to do about it.
4. The practitioner reviews the mockup: an order with a 🏛️ still showing has no proven power behind it; a submission with a 📖 still showing has no test to argue. These are different deficiencies and are fixed by different research, which is why they are two markers and not one.

## Why the data is shaped this way

- The two slots live on separate columns/tables (#302: jurisdictional on `relief_items`, doctrinal on `law_assertions`/`statements_of_law`) — a shared slot column (the old `basis_kind`, itself a rename of `tier_required`) described the two slots by the *weight* of authority expected, which is the wrong axis: a jurisdictional basis is usually a rule, not a "binding case", and what distinguishes the slots is the question they answer.
- `statements_of_law.verification` is a different thing again: the reliability of the support (verified law vs a tier-3 lead — schema v25, #502, where that state moved off the authority). Do not confuse the two. A slot that is filled but filled by a lead reads 🔬 *scrutinize*, not 🏛️ or 📖.
- Settled by #302 (superseding the earlier open question here): `relief_items.jurisdiction_slot_state` carries the jurisdictional basis (one per order sought); doctrinal bases hang off `submissions` via `law_assertions` (schema v3, #328/#323 — previously `arguments`/`argument_authorities`).

## What would break if this were collapsed

With one "authority needed" marker, a practitioner cannot tell from the mockup whether an order lacks the power to be made or lacks the test to be argued, and the research lawyer has to open each slot to find out which research to run.
