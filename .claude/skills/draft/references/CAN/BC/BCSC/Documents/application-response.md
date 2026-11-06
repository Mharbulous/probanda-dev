```json
{
  "renderer": "bespoke",
  "needs_forum_parts": true,
  "title": "Application Response",
  "exhibit_numbering": "writing",
  "goal_criteria": ["orders-positioned", "primary-authority", "excerpts", "noting-up", "evidence", "open-items", "opposing-points", "counsel-review"],
  "ingest_inputs": ["court_filings", "documents_exchanged"]
}
```

# BCSC Application Response

Draft it by `/draft`'s `SKILL.md`, whose setup, substance and authorities sections govern it, and by the sections below.

## Route

Forum: BC Supreme Court. Assembly route: `/publish` with `publish-bcsc-form`, Form 33 strict path.

A Writing lives in exactly one pipeline, never both. `publish-bcsc-form`'s matter-data-backed route stays available through `/publish`.

**Caller: `/publish`'s `publish-bcsc-form`**, as a pointer: substance drafting for Form 32 and Form 33 belongs to `/draft`, which calls back into `/publish` with `publish-bcsc-form` and an explicit token.

## Response seam

This kind answers a served BCSC Notice of Application. Offer it by name when the practitioner names that incoming document (`/draft`'s `SKILL.md` section 8, the response seam).

Capture the served application's sought orders before responding to them. Prefer structured capture already in `/matter-data`; failing that, read the served document from the matter file. For a PDF, call lawyer's `pdf_pages__images` first, and read a page it returns as `scanned` only from its PNGs, never from the PDF or its text layer, and a `born_digital` page with `Read` `pages:` (`/matter-data`'s design decision #71). If the tool refuses, say so with its reason and read the PDF no other way. Confirm paragraph numbers and wording with the practitioner before writing. An accuracy check, not a blocking approval.

## Deployment

A newly drafted fact or submission reaches the venue form. To hold one back, deploy it nowhere. It has no orders of its own. A Writing with Written Arguments follows `.claude/skills/drafting-data/references/filing-checklists.md` §9 instead.

## Court-ready assembly

This kind is assembled by `/draft`'s `references/court-ready-assembly.md`: its common rule, then these steps.

Call `drafting_forms__emit_form33` with `lenient: true` and `case_data_folder`, the matter-data folder's host path (the folder holding `db_path`), in every environment. When the practitioner's override applies, also pass their request verbatim in `cover_notes`. Its strict path is unconditional, there is no ordinary path to distinguish it from. Lenient, it never refuses for missing data: a served notice with no date, an order with no stance taken (left off the response), a missing time estimate, no position on the applicant's hearing date, an empty factual-basis part with no pure-law decision of counsel and a missing citation each come back in `warnings`, with a placeholder where the form prints one. It still refuses on integrity: a database ahead of the installed bundle, party drift, factual-basis facts recorded together with a pure-law decision, and a response with nothing to answer (no responded-to document resolvable, or no stance taken on any order). The server writes `form-33.md` and its sidecar `form-33-publish.json` to `<matter-data folder>\bcsc-form-substance\` and returns `written_path` and `publish_path`, so write neither again. Then invoke `/publish` with `publish-bcsc-form asm33`, drive its protocol to completion, present the result as a file card (`shared/present-files.md`). `asm33` reads the caption from the sidecar and puts a NOT FINAL cover page in front of the form while any warning stands. `publish/subskills/publish-bcsc-form/references/assembly-input-contract.md` owns the substance-file grammar and the sidecar.
