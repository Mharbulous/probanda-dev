# Treatment vocabulary — how an authority treats a principle or another authority

This file is the single source of truth for every treatment and relationship
value Probanda writes or reads, and for what each one means. Every writer and
reader points here and none restates the definitions: matter-data's extractors and
verifiers, `ingest_authority.py`, `submission_law_bridge.py`, the legal-commons
tools (`push`, `link_authority`, `amend_authority_edge`, `record_treatment`), and
any citator import. Code that enforces these values keeps a bare list of code
values that names this file.

Design and reasons: `docs/Specs/2026-10-15_per-principle-treatment-vocabulary-spec.md`
and ADRs 0004–0008.

## Read this first: Probanda departs from the citator norm

- **Treatment is recorded per principle, not per case.** Westlaw, Lexis, CanLII
  and the ICLR label how one *case* treats another *case*. Probanda puts the
  label on the link between an authority and a principle. One case can follow a
  principle from a precedent and distinguish another principle from the same
  precedent. Both are recorded, and neither overwrites the other.
- **`establishes`, `extends`, `reformulates` and `considers` relate an authority
  to a principle.** They are valid only on a principle link, never on an
  authority–authority edge.
- **`affirms` means appellate history only.** It never means "endorses a
  principle": use `approves` or `follows`.
- **There is no "overturns".** Use `overrules`, `reverses` or
  `superseded_by_statute`, by what happened. Never merge them.
- **`considers` means fact comparison** (ADR 0004). A citator's "Considered" is
  not `considers`.
- **Two tenses, two jobs.** Present tense is what the treating decision *does*
  (`relationship` and treatment-edge values). Past tense is the status stamp on
  a link whose authority *has been* treated (`edge_treatment`). Never use one in
  the other's column.

## Definitions

Each term is what the citing authority does. The stored code value is in
backticks.

### Favourable or neutral

- `follows`: treats the cited authority's statement of the principle as
  binding, or adopts it as persuasive, and decides the same point the same way,
  usually on the same or substantially similar facts.
- `applies`: applies the principle to a materially different set of facts.
- `approves`: a higher court endorses a lower court's statement of the
  principle as correctly stating the law.
- `explains`: interprets the cited statement of the principle and states what
  it means or why it was decided as it was, without changing it.
- `harmonizes`: reconciles an apparent inconsistency between the cited
  statement and another authority.
- `refers_to`: names the authority with little or no discussion, or discusses
  its principle without following, applying, distinguishing or criticizing it.
- `considers`: cites the authority for its facts or outcome as a comparator,
  not for its principle. Examples: a damages range in a quantum assessment, or
  a judge listing similar-fact cases without discussing them.

### Restrictive

- `distinguishes`: holds the principle inapplicable because of a material
  difference in fact or law. The cited authority remains good law.
- `limits`: confines the principle to specific circumstances, restricting its
  reach without rejecting it.
- `declines_to_extend`: refuses to carry the principle beyond the situations it
  addressed.

### Adverse

- `declines_to_follow` ("does not follow"): a court not bound by the cited
  authority declines to follow it on the principle, for a reason other than
  distinguishing it.
- `declines_to_apply`: chooses not to apply a persuasive authority or dictum on
  the principle.
- `questions`: doubts the correctness of the cited statement of the principle
  without deciding that it is wrong.
- `disapproves`: says the cited statement is wrong without overruling it.
- `overrules`: a court with power to do so holds, in different and later
  proceedings, that the cited authority's ratio on the principle is wrong.
- `departs_from`: a final court declines to follow its own earlier decision on
  the principle.
- `abrogates`: makes the cited authority untenable on the principle without
  expressly overruling it ("impliedly overruled").

### Appellate history of the same case (authority–authority edges only)

- `affirms`: a higher court upholds the decision in the same proceeding.
- `varies`: a higher court changes the decision in the same proceeding in part.
- `reverses`: a higher court sets aside the decision in the same proceeding.

### Statutory displacement

- `superseded_by_statute`: later legislation, enacted or repealed, displaces the
  rule the authority stated. It is recorded against the principle link and the
  authority.

### What an authority does to the principle itself (principle links only)

- `establishes`: creates or recognizes the principle.
- `extends`: broadens an existing principle to new circumstances.
- `reformulates`: restates an existing principle, or fuses several authorities
  on it, into a changed statement of the law (ADR 0005). Distinct from
  `explains`, which interprets without changing. A reformulated statement is
  pushed as a variant and never rewrites the principle text.

## Where each value is valid

**Principle–authority link** (`relationship` on matter-data
`concept_authorities` and pool `principle_authority`): `establishes`,
`extends`, `reformulates`, `follows`, `applies`, `approves`, `explains`,
`harmonizes`, `refers_to`, `considers`, `distinguishes`, `limits`,
`declines_to_extend`, `declines_to_follow`, `declines_to_apply`, `questions`,
`disapproves`, `overrules`, `departs_from`, `abrogates`,
`superseded_by_statute`.

**Authority–authority treatment edge** (`treatment` on pool `treatment` and
matter-data `authority_treatments`): `follows`, `applies`, `approves`,
`explains`, `harmonizes`, `refers_to`, `distinguishes`, `limits`,
`declines_to_extend`, `declines_to_follow`, `declines_to_apply`, `questions`,
`disapproves`, `overrules`, `departs_from`, `abrogates`, `affirms`, `varies`,
`reverses`, `superseded_by_statute`, and the oral-reasons note `not_considered`.
Per-principle treatment goes on the treating authority's principle link (ADR
0007). The edge records events about a whole decision, and citator imports whose
principle cannot be identified. An edge with no principle scope means the whole
decision.

**Past-tense status stamp** (`edge_treatment`, written to the pool's
`principle_authority.treatment` and `criterion.treatment`): `affirmed`,
`reversed`, `varied`, `distinguished`, `overruled`, `superseded_by_statute`,
`abrogated` (ADR 0008).

**Local matter-data store, until matter-data leaves Exception 2** (ADR 0006): its
CHECKs hold only part of the vocabulary.
- A new link's `relationship` is written only as `establishes`, `applies` or
  `distinguishes`. An extracted link whose correct value is any other
  principle-link value is held back and reported to the practitioner, never
  remapped to a nearer value.
- `refines` and `affirms` are no longer written on any link. Rows holding them
  were written before these definitions and await the practitioner's review.
- The local stamp (`concept_authorities.treatment`, `legal_criteria.treatment`)
  takes only the first five stamps.

## Outside the vocabulary

- `answered` is not a treatment. It records that the other side cited this
  authority against this concept and the filing answered it. Only a
  practitioner's tie writes it, the tie verifies it, and it never crosses to the
  pool (matter-data design decision 48).
- `not_considered` is not the opposite of `considers`. It is the oral-reasons
  note that the court did not consider an authority it was referred to,
  recorded from the practitioner's own account. It carries no `edge_treatment`.

## Importing from a citator

Map by meaning, not by word.

| Publisher term | Probanda value |
|---|---|
| Followed | `follows`; Canadian and US "followed" may mean `applies`, so check the use |
| Applied | `applies` |
| Approved | `approves` |
| Explained | `explains` |
| Harmonized | `harmonizes` |
| Considered | `refers_to`, or `explains` where the court interprets the statement. Never `considers` |
| Referred to / Cited / Mentioned | `refers_to` |
| Distinguished | `distinguishes` |
| Limited; Limitation of Holding Recognized | `limits` |
| Declined to Extend | `declines_to_extend` |
| Not followed | `declines_to_follow` |
| Not applied | `declines_to_apply` |
| Questioned; Doubted; Called into Doubt | `questions` |
| Disapproved; Criticized | `disapproves` |
| Overruled | `overrules` |
| Departed from | `departs_from` |
| Abrogated (judicial) | `abrogates` |
| Superseded (by statute) | `superseded_by_statute` |
| Affirmed / Varied / Reversed | `affirms` / `varies` / `reverses` (history) |

A publisher's treatment concerns a whole case. Attach it to the specific
principle link, using the headnote where the publisher gives one. Where the
principle cannot be identified, record an authority–authority edge with no
principle scope and flag it for review. Never copy the label onto every
principle link of the cited case.
