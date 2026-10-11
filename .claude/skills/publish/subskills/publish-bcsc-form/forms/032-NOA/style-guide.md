# Form 32 — Notice of Application

Read this guide only when the classified form is Form 32 (`NOA`).

Apply `subskills/publish-bcsc-form/forms/000-SOP/style-guide.md`.

## Parts and numbering

- Part 1 contains the orders sought.
- Part 2 contains the factual basis.
- Part 3 contains the legal basis.
- Part 4 contains the material to be relied on.

Parts 2 and 3 share the same numbering instance, so paragraph numbering
continues across both Parts. Unnumbered `> ` excerpt lines and `>> ` citation
lines take the paragraph styles the assembly input contract assigns them.
Part 4 material is supplied as a flat list and rendered with the template's
affidavit-entry numbering.

Leave `[mmmm d, yyyy]` unchanged. The court-only box prints dotted blanks and
the Appendix prints its boxes unchecked; neither takes a value on Generate.

## Strict assembly contract

The Form 32 markdown subset has one owner:
`subskills/publish-bcsc-form/references/assembly-input-contract.md`, implemented by
`scripts/steps/asm32/common.py::parse_form32`. Do not restate or independently
implement that parser's validation rules here.

Strict `asm32` assembly renders the final DOCX to PDF because the Rule 8-1(4)
10-page cap applies to the rendered document. The completion action returns:

- `page_count`, the renderer's true PDF page count, the NOT FINAL cover page
  included when `cover` is true;
- `pdf_path`, the sibling rendered PDF; and
- `tail_text`, the closing, appointment, signature, and address-for-service
  tail verbatim.

Use Microsoft Word COM when available, otherwise LibreOffice `soffice`. If
neither renderer exists, fail and identify the missing renderer; never
substitute a word-count estimate.
