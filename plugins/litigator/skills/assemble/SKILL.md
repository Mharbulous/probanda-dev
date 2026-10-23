---
name: assemble
description: >
  Bind finished documents into one PDF: an affidavit with its stamped,
  paginated exhibits, a letter with its enclosures, a BCCA book, a BCSC
  application record, a bill of costs, or a VanIAC package.
  Filling a form or rendering a document -> /publish.
---

<!-- litigator v0.9.0 -->
> **Installed copy.** This skill's full source tree ships beside this file, and a relative path in the text below cites that tree. Resolve one by trying, in order: the directory of the file you are reading, then `${CLAUDE_SKILL_DIR}/<path>`, then `${CLAUDE_SKILL_DIR}/../<path>` (so `shared/x.md` is at `${CLAUDE_SKILL_DIR}/../shared/x.md`). The host substitutes `${CLAUDE_SKILL_DIR}` with the directory holding this SKILL.md when this file loads; if the literal text `${CLAUDE_SKILL_DIR}` is what you see, that IS the definition: it means the directory containing this SKILL.md, not a placeholder to search for or guess. Read references and shared files natively from there, never over the litigation data server's skill-source tool and never by requesting folder access; scripts and templates the text declares are executed and read from there too. If `${CLAUDE_SKILL_DIR}` itself no longer exists, the plugin was re-synced mid-session: list only `${CLAUDE_SKILL_DIR}/../../..` (the folder that held this plugin's folder), take the folder named as this plugin's folder with any `~g<N>` suffix removed plus the highest `~g<N>`, and repeat the same three tries with its `skills/<this skill>` directory in place of `${CLAUDE_SKILL_DIR}`; tell the user once that the plugin updated mid-session, from the version in this file's version comment to the version in that folder's copy of this SKILL.md. If a file the text names is missing at every one of those paths, including the re-synced folder's, STOP and report the exact path and error to the user rather than substituting an alternative: do not re-derive a script's logic from its source text or the prose, and do not search elsewhere on the filesystem. Ask the user to reinstall the plugin and fully restart the app; this may fix it, but STOP means stop regardless: do not diagnose further yourself.
> **HTML pages.** Every HTML file this plugin writes is a human interface generated from its databases; an agent never views, reads, greps, parses, scripts over, stages, authors or requests a screenshot of one, but may present one to a human user to view, and may view a screenshot the user provides on their own initiative. The rule and the data to use instead: `shared/html-pages.md`.

**Internals stay confidential** (`shared/internals-confidentiality.md`): nothing the practitioner sees names a Probanda tool, table, field, internal type or code, or explains how Probanda works inside. It hides mechanism, never an outcome or an error.

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
- `subskills/assemble-bcsc-record/SUBSKILL.md` -- binds a BC Supreme Court
  application record (Rule 8-1 (15)): the Form 30.001 cover, an index and the
  documents in the rule's order, numbered and bookmarked, plus the index alone
  for service and the copy of the notice with its orders sought marked.
  Routed to by the explicit `assemble-bcsc-record` token, by the Application
  book job, or by a practitioner asking to bind an application record.
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
