---
status: accepted
---

# The pool's `edge_treatment` stamp gains `superseded_by_statute` and `abrogated`, and nothing else

The stamp warns anyone relying on a principle link that the authority under it has been treated. Statutory displacement and implied overruling both mean the principle no longer stands on that authority, so they stamp. `questioned` and `disapproved` leave the authority good law. They also would overwrite a stronger stamp, because a link holds one stamp. So they stay as treatment edges, found through `treatment_chain`. The stamps are now `affirmed`, `reversed`, `varied`, `distinguished`, `overruled`, `superseded_by_statute` and `abrogated`. See `docs/Specs/2026-10-15_per-principle-treatment-vocabulary-spec.md` §7 Q5.

## Considered options

- **Keep the five stamps**: a statute that displaces a principle would leave every link standing on the old authority unmarked.
- **Add all four**: a later `questioned` would overwrite an earlier `superseded_by_statute`.

## Consequences

- The change is pool-only. The local `concept_authorities.treatment` and `legal_criteria.treatment` columns are limited by CHECKs to the five original values. They gain nothing until case-data is converted (ADR 0006).
