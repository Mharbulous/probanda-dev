```json
{
  "renderer": "bespoke",
  "needs_forum_parts": true,
  "folder_code": "AR",
  "title": "Stay-response book",
  "exhibit_numbering": "writing",
  "goal_criteria": ["noting-up", "open-items", "counsel-review"],
  "ingest_inputs": ["5. COURT*", "7. DISCOVERY*"]
}
```

# BCCA stay-response book

Read this file before eliciting: it holds this kind's specifics, and `/draft`'s `SKILL.md` governs the rest.

The filed document is a response book under Court of Appeal Rules Rule 21(1)(a). No prescribed form exists. Its contents follow the registrar's completion instructions, mapped by the gatekeeper's checklist for this kind, with the canonical requirements in `/draft`'s `references/bcca-response-book-form.md`.

The book's written argument is the substantive document (maximum five pages, stay only), so like VanIAC and unlike the BCSC kinds, every item deploys to the venue document and there is no Written Argument deployment question.

The four court-ready Word documents (the book's cover page and table of contents, and the book of authorities' cover page and table of contents) come from the assembly step once the mockup is filing-ready: see "Court-ready assembly" below. Combining them into one filed PDF stays manual.

**Elicit, alongside the rest of the kind's substance:**

- **The order under appeal:** the judge, the court or tribunal below, and the date the order was pronounced, for the cover page's "ON APPEAL FROM" line. Usually already in hand from the matter, confirm rather than re-ask.
- **Any sealing order, publication ban or anonymity order:** ask. Most matters have none, in which case leave the field open rather than writing a placeholder. Where one applies, record the authorising legislative provision (or inherent jurisdiction) and its precise terms verbatim.
- **Counsel contact details for both sides:** firm, telephone, email, for the cover page's contact table. Ours directly, the appellant's from their served materials.
- **Party names and order:** confirm they match the notice of appeal or notice of application for leave to appeal exactly, since the cover page and the multi-party boilerplate both read from them.
- **Each party's role in the court below:** usually already in hand from the pleadings. Confirm rather than re-ask.
- **The opposing party's application book's own table of authorities:** needed to compute the response book's table-of-authorities delta, which lists only authorities not already in the application book. Read the served application book directly, transcribe its table entries verbatim, and confirm the transcription with the practitioner before writing, the same accuracy-check discipline as the served-orders seeding seam, not a blocking approval. Until that is done, the mockup lists every authority this Writing cites and flags the exclusion as unverified. That is expected on a Writing this early, not a defect.

## Route

Forum: BC Court of Appeal. Assembly route: `/publish` with `publish-bcca-book`, then `/assemble` with `assemble-bcca-book`.

## Response seam

This kind answers a served BCCA stay application. Offer it by name when the practitioner names that incoming document (`/draft`'s `SKILL.md` section 8, the response seam).

Capture the served application's sought orders before responding to them. Prefer structured capture already in `/case-data`; failing that, read the served document from the matter file. Confirm paragraph numbers and wording with the practitioner before writing. An accuracy check, not a blocking approval.

## Court-ready assembly

This kind is assembled by `/draft`'s `references/court-ready-assembly.md`: its common rule, then these steps.

Call `drafting_forms__emit_bcca_book`. Refusals: database ahead of the bundle, or missing cover-critical data, naming the field. On success, write the markdown to `<case-data folder>\bcca-book-substance\bcca-book.md`, then invoke `/publish` with `publish-bcca-book`, drive its protocol to completion, and present the resulting four Word documents as file cards (`shared/present-files.md`). Binding them into the filed PDFs is `/assemble` with `assemble-bcca-book`, once the written argument and table of authorities are saved to PDF from Word. `publish/subskills/publish-bcca-book/references/bcca-book-contract.md` owns the substance-file grammar; `/draft`'s `references/bcca-response-book-form.md` is the canonical form record to check a renderer change or a form question against.
