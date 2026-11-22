---
name: publish
description: >
  Turn one drafted text into one court document: fill a BCSC, notice-to-admit,
  small claims or bill of costs form, amend a filed pleading, or render a BCCA
  factum, book covers and TOCs or a VanIAC package, or renumber a draft
  affidavit. Drafting -> /draft.
  Binding, or a letter PDF -> /assemble.
---

<!-- litigator v0.27.6 -->
> **Installed copy.** Relative paths below cite this skill's shipped tree.
> Resolve in order: current file's dir, `${CLAUDE_SKILL_DIR}/<path>`, then `${CLAUDE_SKILL_DIR}/../<path>` (so `shared/x.md` is `${CLAUDE_SKILL_DIR}/../shared/x.md`).
> `${CLAUDE_SKILL_DIR}` is this SKILL.md's directory even if unsubstituted: never search or guess.
> Read references and shared files with Read (whole or offset/limit), never via shell, the litigation data server's skill-source tool, or a folder-access request; run declared scripts and templates from there too.
> Before each fresh read (not already in context), list only `${CLAUDE_SKILL_DIR}/../../..`. If it holds this plugin's folder name (sans `~g<N>`)
> plus a `~g<N>` higher than this plugin's folder's own (none counts as 0), or if `${CLAUDE_SKILL_DIR}` no longer exists, the plugin was re-synced mid-session:
> retry the three paths with the highest `~g<N>` copy's `skills/<this skill>` dir and tell the user once that the plugin updated mid-session (old version comment to new SKILL.md comment).
> If still missing at every path, STOP and report the exact path and error: do not substitute, re-derive script logic, search elsewhere, or diagnose further; ask the user to reinstall the plugin and fully restart the app.
> **HTML pages.** Every HTML file this plugin writes is a human interface generated from its databases;
> never view, read, grep, parse, script over, author, or request a screenshot of one (you may present it to a human user, staging first where needed, and view screenshots the user provides).
> Rule and data to use instead: `shared/html-pages.md`.

**Internals stay confidential** (`shared/internals-confidentiality.md`): nothing the practitioner sees names a Probanda tool, table, field, internal type or code, or explains how Probanda works inside. It hides mechanism, never an outcome or an error.

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

A subskill that shows the practitioner a file reads `shared/present-files.md`.

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
  with the fill, or stop until a plugin release conforms the form (ask for
  it with `/lawyer:suggestion` naming the form and the amending regulation). Whether the
  change affects this filing is for `/legal-research`. This runs whether or
  not the file records a source, and on a blank-form fill too.
