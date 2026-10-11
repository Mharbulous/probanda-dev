# Statutory currency — verify cited legislation is the version in force

This file owns the *rules* of North Star QC 16 (statutory currency): a cited
statute, regulation, or rule of court must be the version currently in force.
Implementing components own only the *procedure* that applies these rules — the
same ownership split the AJ-jurisdiction ruleset uses ("the agent owns the
procedure; the file owns the rules"), applied one level up. This file carries no
statement of what any instrument says; it defines what "current" means and where
each leg of the check is established.

## Definition

A cited statute, regulation, or rule of court is **current** when both hold:

1. the instrument exists in the jurisdiction's **current (non-archived)**
   legislation database and is not repealed or superseded; and
2. the source text the citation was verified against is a **consolidation
   current at verification time** (the "current to" date on the face of the
   document post-dates any amendment the citation depends on).

## Mechanical procedure (what an implementing component does)

For each relied-on authority of kind statute, regulation, or rule of court:

- Confirm existence-and-current-status from CanLII's legislation metadata,
  through the canlii `legislation_currency` tool, which reads the database list,
  each database's listing and the matched instrument's metadata in one call. An instrument found **only in an
  archived database**, or whose metadata shows **repeal or supersession**,
  fails. A title or citation that no longer matches the current instrument is a
  currency failure, not a pass.
- **Check the consolidated instrument, never an amending regulation.** The
  check is given the instrument the statement relies on, as consolidated. A
  regulation cited only as the source of an amendment to it is never sent to
  the check: CanLII lists the consolidated instrument and returns `not-found`
  for the amending regulation. The amendment's effect on a cited provision is
  source-on-file currency (leg 3), read from the Point in Time page and
  bulletin filed beside the consolidation. The year in a regulation number is
  its deposit year and says nothing about when it took effect. An amending
  regulation relied on for its own text has no route yet (#1670).
- **Practice directions are out of scope** — they are not on CanLII (the
  aj-ruleset records this for PD-50) and are governed by their own maintained
  rulesets. Skip them with no finding.

## Division of labour (three legs — none is the whole)

CanLII metadata establishes the *instrument's* currency. It cannot establish
that a particular *section's quoted text* is the in-force text. The three legs
are checked in different places; no implementer may mistake one for the whole:

1. **Instrument currency** — CanLII legislation metadata (this file's procedure):
   the instrument exists, is non-archived, unrepealed, unsuperseded.
2. **Quoted-text fidelity** — the quoted section text matches the source on
   file. Currency does not verify fidelity, and fidelity does not verify
   currency. (**This leg has no automated implementer in the current pipeline.**
   A verbatim excerpt still needs a human or process to confirm it matches the
   source on file.)
3. **Source-on-file currency** — established at fetch time by the official
   publisher's **"current to" date** on the face of the document. The
   `legislation-fetcher` agent, dispatched by `/legal-research`, reads it when it
   fetches the instrument and records it as the filed file's `currency_marker`, in
   the file's header and its manifest line, and files nothing without one. Beside a
   BC Laws consolidation it also files the Point in Time page the consolidation
   links and, for a B.C. Reg. citation, the current year's Cumulative B.C.
   Regulations Bulletin. It files no amending regulation, no "Amendments Not in
   Force" page and no order-in-council (`legal-research/references/legislation-fetcher-playbook.md`
   section 10). A stamp
   newer than the source on file leaves a quote unconfirmed until its amendment
   attribution is checked or the source is refreshed. A quoted text that is
   verbatim to a *stale* consolidation still fails currency. This leg's result is
   per provision: `/drafting-data` stores it for each pinpointed provision with
   its "current to" date and the newest amendment to that provision effective
   after it, and refuses `current` while that amendment is not recorded as
   checked (`amendment-unchecked`). Where the publisher's own page shows the
   date the provision came into force, relay that date too: `/drafting-data`
   stores it with the provision's result, and a case decided before it is
   marked 🕰️ on the mockup.

## Noting up legislation

This section is the one definition of noting up an authority of kind statute,
regulation or rule (practitioner's decision, 2026-10-04, #1628). Every other file
points here rather than restating it.

- **What it is:** this file's currency check, leg 1, run through
  `/legal-research` as one canlii `legislation_currency` call. There is
  no citator leg. Judicial consideration of a provision belongs to the research on
  the proposition that relies on it, not to noting up.
- **Where the result lives:** `/drafting-data` stores the relayed `currency` value
  as the authority's currency result. Its treatment is not written for these kinds.
- **What closes 📇:** a `current` result. Any other value, or none, leaves 📇.
  `repealed` or `archived` finishes the check, so no Note up job is proposed: the
  authority cannot be relied on, and replacing or killing it is the practitioner's
  call.
- **A rename reopens it:** an edit to the authority's citation or title clears the
  stored result, so 📇 returns until the check runs for the enactment as now named.
- **Doctrine:** an authority of kind doctrine (a secondary authority) is never noted
  up and never carries 📇.
- **Case law** is unchanged: the CanLII citator (`legal-audit-protocol.md` step e),
  its outcome stored as the authority's treatment.

## Professional-conduct frame

Per `legal-research.md`: a currency verdict is a **report of metadata about the
enactment's own text**, never a free-standing statement of law. The implementer reports
findings; the caller surfaces failures to the practitioner through the existing
failed-checks → revise flow; a human decides what to do with an adverse finding.
No component asserts "this is the law in force" from memory. An unverifiable
lookup — tool absent, unconfigured, or erroring after a retry — is
`validation_unavailable`, **never an inferred pass**.

## Consumers

- **The canlii `legislation_currency` tool** — the implementation of leg 1. It
  applies the rules in `shared/research-paralegal/legislation-currency.md` to
  CanLII's legislation metadata in code and reports a `currency` value per
  instrument. The `/legal-research` gate calls it; only `current` reads as
  confirmed. (It replaced `research-paralegal`'s legislation-currency mode on
  2026-10-06.)
- **The general renderer's filed-render gate** (`currency_gate_failed`,
  `plugins/litigation/mcp/src/submission/forms.ts`) — reads the currency result
  stored through `/drafting-data` on the relied-on authority and refuses an unsent Writing's filed face while
  an implied clause names an enactment whose result is not `current`, or whose
  cited provision's result is not `current`, and tags the line per provision. It
  consumes a result and never runs the check. The rule it enforces is `/draft`'s
  release reference, "Legislation citations".
- **The Sent write's pre-send hold** (`drafting_data__record_sent`) — reads the
  same stored result and holds sending on the same rule, waivable by the
  practitioner (`.claude/skills/drafting-data/SKILL.md` "Job and scrutiny operations" §14a). It
  consumes a result and never runs the check.
- **Candidate adopter** — `case-brief` also cites legislation and may adopt
  this protocol by referencing this file. Adoption is a change to *that* skill,
  out of scope for whoever first authored this file.
