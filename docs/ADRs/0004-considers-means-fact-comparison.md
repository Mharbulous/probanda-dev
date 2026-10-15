---
status: accepted
---

# `considers` records an authority cited for its facts or outcome as a comparator

Judges often list similar-fact cases without discussing them, for example to set a damages range. No citator records why a case is cited, so Probanda needs a word for that use. The practitioner chose `considers`: it is neutral and does not imply that the cited case supports the result. Because one word cannot carry two meanings, a citator's "Considered" (discussed without following, applying, distinguishing or criticizing) is imported as `refers_to` or `explains`, chosen by how the case is used, never as `considers`. `considers` is a principle–authority value. It is not an authority–authority treatment. See `docs/Specs/2026-10-15_per-principle-treatment-vocabulary-spec.md` §7 Q1.

## Considered options

- **The standard citator sense, plus a new word for fact comparison**: matches Westlaw, Lexis and CanLII, so "Considered" imports one-to-one, but the practitioner preferred the neutral word for the more common local use.

## Consequences

- An import of "Considered" maps by meaning to `refers_to` or `explains`, never by word to `considers`.
- Q1 is decided, so automated paths may write `considers` in this sense.
- `considers` and `not_considered` are not opposites. `not_considered` stays the oral-reasons note.
