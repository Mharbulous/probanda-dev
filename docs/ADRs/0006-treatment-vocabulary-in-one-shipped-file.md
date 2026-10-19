---
status: accepted
---

# The treatment vocabulary and its definitions live in one shipped file, `shared/treatment-vocabulary.md`, as Cross Data

The extractors and verifiers that label a treatment run on the practitioner's machine, where the decision is read. They need the definitions there. Commandment 4 lets the plugin hold only links from Probanda's Cloud in memory, so definitions kept only in the cloud could never reach them. The practitioner ruled that the definitions are Cross Data under Exception 1, because labelling works better where extraction runs. They live in `.claude/skills/shared/treatment-vocabulary.md`, which the build copies into every plugin. Every writer and reader points to that file, and the definitions appear nowhere else. Code that enforces the values keeps a list of bare code values that names the file. See `docs/Specs/2026-10-15_per-principle-treatment-vocabulary-spec.md` §7 Q4.

The local case-data store cannot take the new terms. `concept_authorities.relationship` is limited by a CHECK to six values, and widening it is schema DDL that would deepen case-data's reliance on Exception 2. So, until case-data is converted out of Exception 2:

- local writers write only `establishes`, `applies` and `distinguishes` (plus `answered` on a practitioner tie);
- an extracted link whose correct term the local store cannot hold is held back and reported to the practitioner, never remapped to a nearer term;
- existing local rows are not flagged in bulk, because writing a flag into every installed database needs a data hop in `migrations.sql`.

## Considered options

- **Definitions in Probanda's Cloud, local stores holding code values only**: the extractors could not read the definitions, which is the failure this vocabulary fixes. Cloud validation would also need new SQL or a rerouting through an Edge Function.
- **Shipped definitions plus a widened local CHECK**: adds schema DDL and deepens a legacy store's reliance on Exception 2, which the Commandments forbid.
- **Stop, change no code**: leaves the extractor with six undefined labels and the observed `affirms` mislabel unfixed.

## Consequences

- The pool's tool layer enforces the full vocabulary. The local store enforces its subset.
- Spec §9's criteria that case-data and the pool list the same values, and that existing rows are flagged, stay open until case-data is converted.
- `refines` and `affirms` are no longer written on any local link. Existing rows keep them until they are reviewed.
