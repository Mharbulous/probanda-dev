---
name: calculate
description: >
  Figures for a BC matter: court order interest (pre- and post-judgment), interest under a
  contract's own rate, and a bill of costs' disbursements, tariff items, scale A/B/C units
  and totals. Never a deadline or limitation date (the docket-clerk agent).
---

**Internals stay confidential** (`shared/internals-confidentiality.md`): nothing the practitioner sees names a Probanda tool, table, field, internal type or code, or explains how Probanda works inside. It hides mechanism, never an outcome or an error.

# Calculate

Front door for figures a BC litigation matter needs: BC Court Order Interest Act pre- and
post-judgment interest, interest owed under a contract's own rate, and the three members
that build a bill of costs up to the point it is filled. Formerly
`/court-interest-calculator` and `/contract-interest-rates`. Formerly `/fill-boc`: now
`gather-disbursements`, `itemize-boc` and `calculate-boc` here, then `/publish` with
`publish-boc`.

Private subskills live under `subskills/*/SUBSKILL.md`. They intentionally use `SUBSKILL.md`
instead of `SKILL.md` so recursive skill loaders do not expose them as global top-level skills.
Asset paths (scripts, references) inside a subskill's `SUBSKILL.md` are written relative to
this front door's own folder, not to the subskill's folder.

## Routing

1. If the first word of the request is a subskill's folder name, that is the subskill.
   Pass the remaining words to it unchanged.
2. Otherwise read only each subskill's frontmatter and description, and choose exactly
   one matching subskill.
3. Read the chosen subskill's full `SUBSKILL.md` and follow it as the active workflow.
4. If no subskill fits the request, say so plainly rather than guessing -- there is no
   fallback calculation path.

A bill-of-costs request that names no member starts at `gather-disbursements`.

## Available Subskills

- `subskills/court-interest-calculator/SUBSKILL.md` -- BC Court pre- and post-judgment
  interest, including with special damages. Routed to when asked to calculate court interest,
  interest on a judgment, or about BC Court interest rates.
- `subskills/contract-interest-rates/SUBSKILL.md` -- interest owed under a contract's own
  interest term (a promissory note, loan agreement, mortgage, or pleaded interest clause),
  fixed or pegged to a bank benchmark such as "prime plus X%". Routed to when asked to
  calculate contractual interest, or where a pleaded interest rate or percentage came from.
- `subskills/gather-disbursements/SUBSKILL.md` -- gathers a bill of costs' disbursements
  from a CSV export or by interview, and reviews every flagged item. Serves both Form 62
  and Form 63 bills, and is where a bill-of-costs request naming no member starts.
- `subskills/itemize-boc/SUBSKILL.md` -- picks the costs scale and unit value, verifies the
  Appendix B tariff against live BC sources, and maps the matter's litigation steps to
  tariff items with their units. Form 62 only.
- `subskills/calculate-boc/SUBSKILL.md` -- totals a Form 62 bill (tariff fees, GST and PST
  on those fees, disbursements, grand total), puts the summary up for approval, and writes
  the context file `/publish` fills from.

The three bill-of-costs members share one working folder and one state file, described in
`references/bill-of-costs-workspace.md`. None of them hands off automatically: each ends by
offering the next member, and the practitioner chooses.
