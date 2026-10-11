# Form 33 — Application Response

Read this guide only when the classified form is Form 33 (`AR`).

Apply `subskills/publish-bcsc-form/forms/000-SOP/style-guide.md`. Originating- and responding-party caption
names are inserted as separate template paragraphs rather than flattened into
one text substitution.

## Parts and excerpts

The assembled body supplies:

- Part 1, orders consented to;
- Part 4, factual basis;
- Part 5, legal basis; and
- Part 6, material to be relied on.

Lines beginning with `> ` are rendered as unnumbered excerpt paragraphs.
Other supplied lines inherit the Form 33 paragraph formatting. Part 6 uses the
template's affidavit-entry numbering.

The template intentionally preserves its date variants, name, time-estimate,
paragraph-list, affidavit-sequence, and proposed-terms placeholders for later
completion.

## Strict assembly contract

The Form 33 markdown subset is implemented by
`scripts/steps/asm33/common.py::parse_form33` under the subset ownership rule in
`subskills/publish-bcsc-form/references/assembly-input-contract.md`. Do not duplicate its
validation rules here.

Strict `asm33` assembly renders the final DOCX to PDF for the page-fit loop and
returns the true `page_count` (the NOT FINAL cover page included when `cover`
is true) and sibling `pdf_path`. Use Microsoft Word COM
when available, otherwise LibreOffice `soffice`; if neither exists, fail and
name the missing renderer. Never use a word-count estimate as the page count.
