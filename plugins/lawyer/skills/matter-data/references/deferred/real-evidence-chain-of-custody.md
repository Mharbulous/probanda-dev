schema-context: pre-v6.9

> **This memo predates v6.9.** It was written against an earlier schema version. Any table or column names below must be re-checked against the current schema (see `references/schema.sql`) before this memo is acted on — do not assume they still exist or still mean the same thing.

# Real Evidence Chain of Custody

## When this memo fires

- The integrity of a physical exhibit is challenged.
- A physical exhibit has passed through multiple custodians.

## Problem

Physical (real) evidence needs a defensible chain-of-custody record — who had it, when, and how it moved between custodians — to establish it wasn't tampered with or substituted. Today there is no structured way to record a sequence of custody events for a piece of evidence. The schema treats evidence as a link between a source and a fact, with a strength rating, but has no concept of a physical object moving through multiple hands over time.

## Insights

- This is only needed for physical/real evidence, not documentary evidence — most sources in the schema are documents, where "custody" isn't a live question in the same way.
- The need is reactive: it matters when custody is actually challenged, or when the exhibit passed through enough custodians that a challenge is plausible. It is not something to build into routine evidence intake.
- A chain of custody is inherently a sequence of events (transfers), not a single fact — this is closer in shape to an event log than to a single-row attribute, which may make it structurally similar to what the ADR-event-tracking memo needs for mediation events.
- Because this predates the current schema, any future implementation must re-derive which table (if any) already models "evidence" in a way this could attach to, rather than assuming the old attachment point still holds.

## Direction (non-binding)

- A future design could add a custody-event table — one row per transfer (from custodian, to custodian, date, method/location) — linked to the physical exhibit's evidence or source row.

## Left open

- Whether custody events attach to the source, the evidence link, or a new concept of "physical exhibit" distinct from both.
- How much of this should be structured data versus a citation to an affidavit/certificate describing the chain.
- Whether this shares a general event-log mechanism with ADR event tracking.

---

This memo is problem+insight capital, not a spec. When the trigger fires, absorb the problem framing and insights above and design fresh against the schema in force at that time. Do not copy the Direction section verbatim into an implementation plan.
