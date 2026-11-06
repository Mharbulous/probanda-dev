<!-- REGRESSION-PRONE: CanLII-first research has recurred repeatedly. See docs/design/2026-09-24 research-lawyer Westlaw-first fix plan.md before editing. Tests: legal-research/tests/. -->

# CanLII citator guide

How `citation-checker` reads the CanLII citator for one decision. Fetched by
`shared/citation-checker/note-up.md`. It runs after KeyCite, and only when CanLII's
`configure_status` reports `configured: true`. Call `configure_status` once per run.

**CanLII has no decision text.** Its API returns index metadata and citator links only.
The citator is the only CanLII tool you call. Never use CanLII to find, read or check
the content of any decision.

## The call

One `get_case_citator` call per citation, `metadataType: citingCases`. The citator
takes the court's CanLII database code as `databaseId` (for example `bcsc`, `bcca`,
`csc-scc`) and the neutral citation lowercased with its spaces removed as `caseId`
(`2021 BCSC 963` → `2021bcsc963`). A decision whose ids you cannot form that way is
recorded `not run: no neutral citation`.

## What to record

The tool returns `total` and at most 5 citing cases, newest first by neutral citation
(year, then number), because CanLII gives no date. Record `total`, and each returned case's
citation and title as listed. The CanLII citator returns citing cases with no treatment
classification, so the return carries none. Make no second-hop call on the citing decisions
themselves.

A runtime error is recorded as `not run: <the error message, verbatim>`. A missing key
names itself: record it as `not run: no key`.
