---
status: accepted
---

# Treatment of a principle is recorded on the treating authority's principle link, and the authority–authority edge keeps whole-decision events

One case can follow a principle from a precedent and distinguish another principle from the same precedent. The pool's `treatment` table has one row per pair of cases, so it cannot hold both. Instead, the treating authority's `principle_authority.relationship` records what it does to each principle: `follows` on one link, `distinguishes` on another. The `treatment` table keeps events that concern a whole decision (`affirms`, `varies`, `reverses`, a whole-decision `overrules`) and citator imports whose principle cannot be identified, each flagged for review. An edge with no principle scope means the whole decision. See `docs/Specs/2026-10-15_per-principle-treatment-vocabulary-spec.md` §7 Q3.

## Considered options

- **Widen the `treatment` table's key to include the principle**: the cleanest model, but it changes the cloud schema, and no change may add schema DDL.
- **Put the principle in the free-text `scope`**: needs no DDL, but the pair key still allows only one row, so the conflict remains.

## Consequences

- Where several authorities state one principle, the link's own `relationship` does not name which of them was followed. Its proposition and finding say so in words.
- `record_treatment` keeps `scope` as free text describing the affected part of a decision.
