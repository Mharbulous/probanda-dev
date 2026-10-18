schema-context: v6.9

# ADR Event Tracking

## When this memo fires

- A partial settlement occurs.
- The matter has a multi-event ADR (mediation, settlement conference, etc.) history.

## Problem

Mediations and other ADR events are happenings in a matter's history, distinct from the per-fact position consequences they may produce. Today, if a mediation settles some facts or issues, the only trace of that in the schema would be changes to `positions` (or `v_fact_status` derived posture) for the facts involved — there is no record of the ADR event itself: when it happened, what kind it was, who participated, or that a given batch of position changes came from that event rather than from a pleading or admission made elsewhere. A partial settlement is especially awkward: some facts/issues resolve, others don't, and nothing ties the resolved subset back to the mediation that produced it.

## Insights

- Position changes and the event that caused them are two different things: `positions` (bitemporal, per fact/party) already records *what* changed; nothing records the ADR event itself as a first-class happening with its own date, type, and participants.
- Partial settlement is the case that most exposes the gap — full settlement usually ends the matter (or a proceeding) and needs little further tracking, but a partial settlement leaves a live matter where "why did this fact's posture change" has no answer without external memory.
- Multiple ADR events over a matter's life (e.g., an early mediation, then a later settlement conference) compound the problem — without an event record, there's no way to distinguish which changes came from which event.
- This is structurally an event log, similar in shape to what the chain-of-custody memo needs for physical exhibits — a future design might consider whether a general event-tracking mechanism could serve both, though the two domains are otherwise unrelated.

## Direction (non-binding)

- A future design could add an ADR-event record (date, type, participants, outcome summary) and a way to associate position changes with the event that produced them, without changing how `positions`/`v_fact_status` work for non-ADR-driven changes.

## Left open

- Whether ADR events should be a new table or could be modeled as a distinctive source category.
- How to link a batch of position changes to the ADR event that produced them without overloading `positions.notes`.
- Whether partial settlement needs any concept beyond "some facts/issues now have a settled posture."

---

This memo is problem+insight capital, not a spec. When the trigger fires, absorb the problem framing and insights above and design fresh against the schema in force at that time. Do not copy the Direction section verbatim into an implementation plan.
