---
name: calculate
description: >
  Figures for a BC matter: court order interest (pre- and post-judgment), interest under a
  contract's own rate, and a bill of costs' disbursements, tariff items, scale A/B/C units
  and totals. Never a deadline or limitation date (the docket-clerk agent).
---

<!-- litigator v0.16.1 -->
> **Installed copy.** This skill's full source tree ships beside this file, and a relative path in the text below cites that tree. Resolve one by trying, in order: the directory of the file you are reading, then `${CLAUDE_SKILL_DIR}/<path>`, then `${CLAUDE_SKILL_DIR}/../<path>` (so `shared/x.md` is at `${CLAUDE_SKILL_DIR}/../shared/x.md`). The host substitutes `${CLAUDE_SKILL_DIR}` with the directory holding this SKILL.md when this file loads; if the literal text `${CLAUDE_SKILL_DIR}` is what you see, that IS the definition: it means the directory containing this SKILL.md, not a placeholder to search for or guess. Read references and shared files natively from there, never over the litigation data server's skill-source tool and never by requesting folder access; scripts and templates the text declares are executed and read from there too. Before each fresh read (a file not already in context), list only `${CLAUDE_SKILL_DIR}/../../..` (the folder holding this plugin's folder). If it holds this plugin's folder name, with any `~g<N>` suffix removed, plus a `~g<N>` higher than this plugin's folder's own (none counts as 0), or if `${CLAUDE_SKILL_DIR}` no longer exists, the plugin was re-synced mid-session: take the highest `~g<N>` copy and repeat the same three tries with its `skills/<this skill>` directory in place of `${CLAUDE_SKILL_DIR}`; tell the user once that the plugin updated mid-session, from the version in this file's version comment to the version in that folder's copy of this SKILL.md. If a file the text names is missing at every one of those paths, including the re-synced folder's, STOP and report the exact path and error to the user rather than substituting an alternative: do not re-derive a script's logic from its source text or the prose, and do not search elsewhere on the filesystem. Ask the user to reinstall the plugin and fully restart the app; this may fix it, but STOP means stop regardless: do not diagnose further yourself.
> **HTML pages.** Every HTML file this plugin writes is a human interface generated from its databases; an agent never views, reads, greps, parses, scripts over, authors or requests a screenshot of one, but may present one to a human user to view, staging it first where presenting needs that, and may view a screenshot the user provides on their own initiative. The rule and the data to use instead: `shared/html-pages.md`.

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
