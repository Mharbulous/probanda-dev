---
name: assemble
description: >
  Bind finished documents into one PDF: an affidavit with its stamped,
  paginated exhibits, a letter with its enclosures, a BCCA book, a bill of
  costs, or a VanIAC package.
  Filling a form or rendering a document -> /publish.
---

# Assemble

Front door for binding finished documents into one PDF. Assembly is binding
only: filling a form or rendering a drafted text into a court document is
never assembly.

Private subskills live under `subskills/*/SUBSKILL.md`. They intentionally
use `SUBSKILL.md` instead of `SKILL.md` so recursive skill loaders do not
expose them as global top-level skills.

Formerly `/assemble-affidavit`: now subskill `assemble-affidavit` here.
Formerly `/assemble-submission`: binding a response book into its PDFs is
now subskill `assemble-bcca-book` here. Its .docx documents and the factum
are `/publish` (`publish-bcca-book`, `publish-bcca-factum`).

## Routing

1. If the first word of the request names a subskill folder (e.g.
   `assemble-affidavit`), choose that subskill.
2. Otherwise inspect available private subskills under
   `subskills/*/SUBSKILL.md`, read only each subskill's frontmatter and
   description, and choose exactly one matching subskill.
3. Read the chosen subskill's full `SUBSKILL.md` and follow it as the active
   workflow.
4. If no subskill fits the request, say so plainly rather than guessing --
   there is no fallback assembly path.

## Available Subskills

- `subskills/assemble-affidavit/SUBSKILL.md` -- assembles a BC Supreme Court
  affidavit with its exhibits into one stamped PDF for review, then paginates
  the approved package. Routed to by the explicit `assemble-affidavit` token,
  or by a practitioner asking to assemble an affidavit or stamp its exhibits.
- `subskills/assemble-bcca-book/SUBSKILL.md` -- binds a BCCA stay-response
  book's cover, table of contents and part PDFs into the filed Response
  Book and Book of Authorities PDFs, numbered and bookmarked. Routed to by
  the explicit `assemble-bcca-book` token, or by a practitioner asking to
  bind a response book.
- `subskills/assemble-vaniac-package/SUBSKILL.md` -- gathers a VanIAC
  package's cited exhibits into its `Package` folder, then binds the whole
  package into one PDF with divider pages and the index page numbers filled.
  Routed to by the explicit `assemble-vaniac-package` token, or by a
  practitioner asking to gather the exhibits or bind a VanIAC package.
- `subskills/assemble-boc/SUBSKILL.md` -- binds a filled Form 62 bill of
  costs with one invoice or receipt per claimed disbursement, each bookmarked
  to its bill line. Routed to by the explicit `assemble-boc` token, or by a
  practitioner asking to bind a bill of costs or attach its receipts.
- `subskills/assemble-general/SUBSKILL.md` -- binds a letter or memo's .docx
  with its enclosures into one PDF.

## Boundaries

- Do not draft or revise substance here -- that is `/draft`.
- Do not fill a court form or render a document -- that is
  `/publish`.
