---
name: calculate
description: >
  Use when calculating BC court order or contract interest, or bill of costs
  (disbursements, tariff units, totals). Never deadlines (docket-clerk).
metadata:
  author: Probanda Legal
  tags: [litigation, bc-courts, interest, bill-of-costs]
---

<!-- litigator v0.27.6 -->
> **Installed copy.** Relative paths below cite this skill's shipped tree.
> Resolve in order: current file's dir, `${CLAUDE_SKILL_DIR}/<path>`, then `${CLAUDE_SKILL_DIR}/../<path>` (so `shared/x.md` is `${CLAUDE_SKILL_DIR}/../shared/x.md`).
> `${CLAUDE_SKILL_DIR}` is this SKILL.md's directory even if unsubstituted: never search or guess.
> Read references and shared files with Read (whole or offset/limit), never via shell, the litigation data server's skill-source tool, or a folder-access request; run declared scripts and templates from there too.
> Before each fresh read (not already in context), list only `${CLAUDE_SKILL_DIR}/../../..`. If it holds this plugin's folder name (sans `~g<N>`)
> plus a `~g<N>` higher than this plugin's folder's own (none counts as 0), or if `${CLAUDE_SKILL_DIR}` no longer exists, the plugin was re-synced mid-session:
> retry the three paths with the highest `~g<N>` copy's `skills/<this skill>` dir and tell the user once that the plugin updated mid-session (old version comment to new SKILL.md comment).
> If still missing at every path, STOP and report the exact path and error: do not substitute, re-derive script logic, search elsewhere, or diagnose further; ask the user to reinstall the plugin and fully restart the app.
> **HTML pages.** Every HTML file this plugin writes is a human interface generated from its databases;
> never view, read, grep, parse, script over, author, or request a screenshot of one (you may present it to a human user, staging first where needed, and view screenshots the user provides).
> Rule and data to use instead: `shared/html-pages.md`.

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

## Instructions

### Routing

0. A deadline, limitation date or hearing date is never a figure here. Spawn
   `lawyer:docket-clerk` for it (`shared/deadline-isolation.md`, "Calling docket-clerk"), and
   follow the session note on a Probanda agent missing from your Agent tool's list. Never work
   the date out yourself.
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

## Examples

```text
/calculate pre-judgment interest on CAD 50,000 from 2024-03-15 to today
-> subskills/court-interest-calculator/SUBSKILL.md

/calculate contract interest at prime plus 2% on a CAD 120,000 promissory note
-> subskills/contract-interest-rates/SUBSKILL.md

/calculate bill of costs for Smith v. Jones
-> subskills/gather-disbursements/SUBSKILL.md

/calculate calculate-boc
-> subskills/calculate-boc/SUBSKILL.md

/calculate when is the limitation deadline to file the NOCC?
-> Not a figure here; spawn lawyer:docket-clerk
```
