---
name: publish
description: >
  Turn one drafted text into one court document: fill a BCSC, notice-to-admit,
  small claims or bill of costs form, amend a filed pleading, or render a BCCA
  factum, book covers and TOCs or a VanIAC package, or renumber a draft
  affidavit. Drafting -> /draft.
  Binding, or a letter PDF -> /assemble.
---

<!-- probanda v0.1.7 -->
> **Installed copy.** This skill's full source tree ships beside this file, and a relative path in the text below cites that tree. Resolve one by trying, in order: the directory of the file you are reading, then `${CLAUDE_SKILL_DIR}/<path>`, then `${CLAUDE_SKILL_DIR}/../<path>` (so `shared/x.md` is at `${CLAUDE_SKILL_DIR}/../shared/x.md`). The host substitutes `${CLAUDE_SKILL_DIR}` with the directory holding this SKILL.md when this file loads; if the literal text `${CLAUDE_SKILL_DIR}` is what you see, that IS the definition: it means the directory containing this SKILL.md, not a placeholder to search for or guess. Read references and shared files natively from there, never over the litigation data server's skill-source tool and never by requesting folder access; scripts and templates the text declares are executed and read from there too. If `${CLAUDE_SKILL_DIR}` itself no longer exists, the plugin was re-synced mid-session: list only `${CLAUDE_SKILL_DIR}/../../..` (the folder that held this plugin's folder), take the folder named as this plugin's folder with any `~g<N>` suffix removed plus the highest `~g<N>`, and repeat the same three tries with its `skills/<this skill>` directory in place of `${CLAUDE_SKILL_DIR}`; tell the user once that the plugin updated mid-session, from the version in this file's version comment to the version in that folder's copy of this SKILL.md. If a file the text names is missing at every one of those paths, including the re-synced folder's, STOP and report the exact path and error to the user rather than substituting an alternative: do not re-derive a script's logic from its source text or the prose, and do not search elsewhere on the filesystem. Ask the user to reinstall the plugin and fully restart the app; this may fix it, but STOP means stop regardless: do not diagnose further yourself.
> **HTML pages.** Every HTML file this plugin writes is a human interface generated from its databases; an agent never views, reads, greps, parses, scripts over, stages, authors or requests a screenshot of one, but may present one to a human user to view, and may view a screenshot the user provides on their own initiative. The rule and the data to use instead: `shared/html-pages.md`.

# Publish

Front door for turning one drafted text into one court document: filling a
BC Supreme Court form (`publish-bcsc-form`), drafting and verifying a Rule
7-7 Notice to Admit (`publish-notice-to-admit`), filling BC Provincial Court
small claims forms (`publish-small-claims-form`), rendering a BC Court of
Appeal book's covers and tables of contents (`publish-bcca-book`) or a
respondent's factum (`publish-bcca-factum`), rendering a VanIAC exchange
package's documents (`publish-vaniac-package`), and filling a bill of costs
(`publish-boc`).

Formerly `/draft-bcsc-form`: now subskill `publish-bcsc-form` here.
Formerly `/fill-boc`: filling the bill is now subskill `publish-boc` here;
gathering, itemizing and totalling it are `/calculate`.
Formerly `/draft-notice-to-admit`: now subskill `publish-notice-to-admit` here.
Formerly `/draft-small-claims-form`: now subskill `publish-small-claims-form` here.
Formerly `/assemble-submission`: its response-book documents are now
subskill `publish-bcca-book` here, its factum is `publish-bcca-factum` here,
and binding a book into its PDF is `/assemble` with `assemble-bcca-book`.

Private subskills live under `subskills/*/SUBSKILL.md`. They intentionally
use `SUBSKILL.md` instead of `SKILL.md` so recursive skill loaders do not
expose them as global top-level skills.

## Routing

1. If the first word of the request is a subskill's folder name, that is the
   subskill. Pass the remaining words to it unchanged (for example
   `publish-bcsc-form asm32` lands on its strict Form 32 path).
2. Otherwise read only each subskill's frontmatter and description, and
   choose exactly one matching subskill.
3. Read the chosen subskill's full `SUBSKILL.md` and follow it as the active
   workflow.
4. If no subskill fits the request, say so plainly rather than guessing --
   there is no fallback path.

## Available Subskills

- `subskills/publish-bcsc-form/SUBSKILL.md` -- fills BC Supreme Court .dotx
  form templates: a blank form, drafted substance assembled into the final
  .docx (the strict Form 32/33 paths under the `asm32`/`asm33` tokens), a
  converted LEAP template, or an amended filed pleading.
- `subskills/publish-notice-to-admit/SUBSKILL.md` -- drafts and verifies a
  BC Supreme Court Notice to Admit under Rule 7-7 in prescribed Form 26,
  including admissions of fact, document-authenticity requests, and
  attached copies.
- `subskills/publish-small-claims-form/SUBSKILL.md` -- drafts a defendant's
  Reply to a Notice of Claim in BC Small Claims Court and fills the official
  forms, Form 2 (Reply) and Form 38 (Address for Service).
- `subskills/publish-bcca-book/SUBSKILL.md` -- renders a BCCA book's cover
  pages and tables of contents as .docx files: four (Response Book and Book
  of Authorities) from a `bcca_stay_response` filing's stored data, or the
  two Book of Authorities documents from a `bcca_factum` filing's.
- `subskills/publish-bcca-factum/SUBSKILL.md` -- fills the court's
  respondent's factum template from a `bcca_factum` filing's stored data.
- `subskills/publish-vaniac-package/SUBSKILL.md` -- renders a VanIAC
  exchange package's written argument, witness statements and cover and
  index as .docx files from the filing's filed render.
- `subskills/publish-boc/SUBSKILL.md` -- fills a bill of costs: Form 62 from
  the totalled context `/calculate` wrote, or a Form 63 default judgment bill
  through its deterministic Schedule 1 engine.
- `subskills/publish-general/SUBSKILL.md` -- renders a `general` Writing (a
  letter, a memo, a release, any Writing whose type declares the general
  renderer) as a .docx
  from its filed render, through one generic template set by its venue's
  physical-format file, or on the firm letterhead for a letter.
- `subskills/renumber-affidavit/SUBSKILL.md` -- gives an unsworn, unfiled
  draft affidavit a new number in renumbered Word copies.

## Form identity

This section applies to `publish-bcsc-form` only. No other subskill runs it.

After `publish-bcsc-form` fixes the form and before it fills anything, check
that form's identity file in `/publish`'s knowledge tree:
`publish\CAN\BC\BCSC\Documents\<stem>.md`. The stem is set by the form,
whether the fill comes from a Writing, a blank form or a converted template:
Form 32 is `notice-of-application`, Form 33 is `application-response`, Form
17 is `requisition-default-judgment` or `requisition-consent` by the
requisition's purpose, and every other form is its registry key (for example
`form-15` or `affidavit`). Read it with `knowledge__read`, then run
`sources__check` on it with `tree: "knowledge"`.

- **A changed version stops the fill.** The check reports one as
  `pdf_matches: false` or `marker_matches: false`. Name the form, the version
  the file records and the version the check found. The practitioner chooses
  to proceed with the fill, or to stop for a repo-session refresh of the file.
  This stop applies only once the file records a source (`page_url` or
  `sources:`). On a file with none, `sources__check` refuses `no_sources`,
  which reads "Form currency not verified" below.
- **"Form currency not verified."** Say this in one line and fill when the
  file records `version: not recorded`, when the check returns a `gap`, when
  it refuses because the file names no source, or when no file exists for
  the form.
- **An unconformed amendment stops the fill.** After the source check, call
  `drafting_forms__form_currency` with the form's `form_key`. A non-null
  `warning` stops the fill: say it verbatim, then offer two choices: proceed
  with the fill, or stop for the repo-session update in
  `subskills/publish-bcsc-form/references/form-update.md`. Whether the
  change affects this filing is for `/legal-research`. This runs whether or
  not the file records a source, and on a blank-form fill too.
