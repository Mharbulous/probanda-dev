```json
{
  "renderer": "bespoke",
  "needs_forum_parts": true,
  "title": "Notice of Application",
  "exhibit_numbering": "writing",
  "goal_criteria": ["primary-authority", "excerpts", "noting-up", "evidence", "counsel-review", "open-items", "orders-sought", "hearing-date"],
  "ingest_inputs": ["court_filings", "documents_exchanged"]
}
```

# BCSC Notice of Application

Draft it by `/draft`'s `SKILL.md`, whose setup, substance and authorities sections govern it, and by the sections below.

## Route

Forum: BC Supreme Court. Assembly route: `/publish` with `publish-bcsc-form`, Form 32 strict path.

A Writing lives in exactly one pipeline, never both. `publish-bcsc-form`'s matter-data-backed route stays available through `/publish`.

**Caller: `/publish`'s `publish-bcsc-form`**, as a pointer: substance drafting for Form 32 and Form 33 belongs to `/draft`, which calls back into `/publish` with `publish-bcsc-form` and an explicit token.

## Deployment

A newly drafted item reaches the venue form. To hold one back, deploy it nowhere. A Writing with Written Arguments follows `source/skills/drafting-data/references/filing-checklists.md` §9 instead.

## Render refusal

The render refuses while associate-judge jurisdiction is not yet determined. Surface it and stop, never retry to force a result (`/draft`'s `SKILL.md` section 11).

## Court-ready assembly

This kind is assembled by `/draft`'s `references/court-ready-assembly.md`: its common rule, then these steps.

Call `drafting_forms__emit_form32` with `lenient: true` and `case_data_folder`, the matter-data folder's host path (the folder holding `db_path`), in every environment. When the practitioner's override applies, also pass their request verbatim in `cover_notes`. Lenient, it never refuses for missing data: an undetermined associate judge, a missing proposed hearing or time estimate, an empty factual-basis part with no pure-law decision of counsel, a missing citation and the like each print a placeholder and come back in `warnings`. It still refuses on integrity: a database ahead of the installed bundle, party drift, or factual-basis facts recorded together with a pure-law decision. The server writes `form-32.md` and its sidecar `form-32-publish.json` to `<matter-data folder>\bcsc-form-substance\` and returns `written_path` and `publish_path`, so write neither again: a Cowork session's own write lands in the sandbox, where `asm32` never looks. Then invoke `/publish` with an initial request of `publish-bcsc-form asm32`, drive its protocol to completion, and present the resulting Word document or PDF as a file card (`shared/present-files.md`). No Generate run comes first: `asm32` reads the caption from the sidecar and puts a NOT FINAL cover page in front of the form while any warning stands. `publish/subskills/publish-bcsc-form/references/assembly-input-contract.md` owns the substance-file grammar and the sidecar.
