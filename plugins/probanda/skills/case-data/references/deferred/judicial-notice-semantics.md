schema-context: v6.9

# Judicial Notice Semantics

## When this memo fires

- The agent is asked "which eligible facts haven't been noticed?" or an equivalent query.
- A document records the court taking judicial notice on the record.
- A pleading or submission invokes judicial notice of a fact.

## Problem

The schema has no way to distinguish two different things that both get called "judicial notice":

1. **Eligibility** — a fact is the kind of thing a court *could* take judicial notice of (notorious, or capable of immediate accurate verification). This is a static property of the fact itself, knowable at the time the fact is recorded.
2. **Notice taken** — the court *actually* took judicial notice of that fact, on the record, at a specific point in a proceeding. This is an event with a date, a proceeding, and a source (the record where it happened).

Today there is no field or table that records either of these. A fact's `verified` value says nothing about notice — it says extraction/classification quality was checked. `positions` records party stances, not court action. Nothing distinguishes "this fact is noticeable" from "the court noticed it."

## Insights

- Eligibility and notice-taken have different lifecycles: eligibility can be assessed the moment a fact is captured; notice-taken can only happen inside a proceeding, usually well after the fact was first recorded, and only if someone asks for it.
- Conflating them invites two failure modes: treating an eligible-but-unnoticed fact as if the court already accepted it, or losing track of facts that are strong judicial-notice candidates but were never raised.
- Judicial notice is proceeding-specific (the same fact could be noticed in one proceeding and not another), which echoes the per-proceeding posture problem in `counterclaim-asymmetry.md` — any future design should check whether the two memos converge on a shared per-(fact, proceeding) event model.
- This is a small-volume, high-stakes category: most matters will have zero or a handful of judicial-notice-eligible facts, so the mechanism doesn't need to scale, but it needs to be reliably queryable when it does show up.

## Direction (non-binding)

- A future design could record eligibility as a flag or note on `facts`, and notice-taken as a distinct event row (proceeding, date, source, locator) rather than overloading `positions` or `verified`.
- Any such design should reuse the existing citation/locator conventions (`source_id` + `source_locator`) rather than inventing a new reference format.

## Left open

- Whether eligibility should be a stored field or a derived/query-time judgment call.
- Whether "notice taken" belongs in a new table, or as a specialized row in an existing table.
- How this interacts with appeal — if a court's judicial notice is later disturbed on appeal, this memo does not address that (the skill's load-bearing design notes already treat court findings/appeals as out of scope for posture).

---

This memo is problem+insight capital, not a spec. When the trigger fires, absorb the problem framing and insights above and design fresh against the schema in force at that time. Do not copy the Direction section verbatim into an implementation plan.
