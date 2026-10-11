---
name: assemble-vaniac-package
description: >
  Gathers a VanIAC exchange package's cited exhibits into its Package
  folder, then binds the whole package into one PDF: cover, index with page
  numbers, written argument, signed witness statements, expert reports, and
  each exhibit behind a divider page. Routed to by the explicit
  assemble-vaniac-package token, or by a practitioner asking to gather the
  exhibits or bind a VanIAC package.
---

# Assemble VanIAC Package

Gathers and binds a VanIAC exchange package whose documents `/publish` with
`publish-vaniac-package` has already rendered. Two steps, in order, and the
second never follows the first automatically: the practitioner reviews what
the gather put in `Package\` and runs the pre-filing gate before anything is
bound.

Depends on `publish/subskills/publish-vaniac-package/scripts/fill_vaniac.py`
(the binder renders the index again with its page numbers) and on this front
door's `subskills/assemble-bcca-book/scripts/paginate_book.py` (numbering,
Page Labels and bookmarks), so `/publish` must be installed beside
`/assemble`. Binding converts the cover, the index and any .docx to PDF
through Microsoft Word (Windows, through PowerShell), falling back to
LibreOffice (`soffice`) where Word is unreachable. Gathering needs no Word,
but both gathering and binding need PyMuPDF, so both run on the PC only --
see Error handling.

## What this produces

In the filing's mockup folder, `<draft folder>\SUB <filing folder>\`:

1. `Package\Exhibit N - <description>.<ext>`, one per exhibit the filed
   Evidence Index lists
2. `<Claimant|Respondent>'s <Opening|Response|Reply|Non-Participation> Submissions.pdf`,
   beside `Package\`, not inside it, so the pre-filing gate never scans an
   exhibit twice

## Steps

1. **Resolve the mockup folder.** It is the presentation folder `/draft`
   section 9 resolves ("Resolving the presentation folder"). Read that
   section for the mechanics; do not re-derive them here.

   The data folder is `<case-data folder>\vaniac-submissions\<filing folder>\`,
   the mockup folder's name without any leading `YYYY-MM-DD ` and without
   the `SUB` code, the case-data folder being the one `coclerk.json`'s
   `case_data_dir` names (in Cowork, request access to that folder itself,
   never a parent or the firm root). It must hold `Package index.json`. If
   it doesn't but `Package\` already holds the rendered documents, the
   filing was probably retitled after publishing: say so, and ask the
   practitioner to rename the old `vaniac-submissions` subfolder to the new
   title. Otherwise stop and point the practitioner at `/publish` with
   `publish-vaniac-package`.

2. **Gather.** Resolve both scripts below from `/assemble`'s folder: in a
   repo checkout run them as
   `python .claude/skills/assemble/subskills/assemble-vaniac-package/scripts/<script>`
   from the repo root. Both need PyMuPDF, so both run on the PC only: in
   Cowork they refuse with `missing_dependency` (Error handling, below).

   The exhibits' file paths come from the mockup `Evidence Index.md` in the
   mockup folder, whose Source trace the filed render leaves out. It must be
   current: if the filing changed since the last render, re-render through
   `/draft` first. Then run:

   ```
   python gather_exhibits.py --index-json "<data folder>\Package index.json" --evidence-index "<mockup folder>\Evidence Index.md" --matter-root "<matter root>" --package-dir "<mockup folder>\Package"
   ```

   It prints one JSON line. It checks every exhibit before copying any.
   `exhibit_unresolved` names each exhibit with no traced path, a missing
   file or a bad page range: show the practitioner that list and stop.
   `trace_not_in_index` means the mockup and the filed render disagree on the
   exhibits: re-render and run again. A rerun leaves every exhibit already in
   `Package\` alone.

3. **Review.** List the files now in `Package\` as file cards and ask the
   practitioner to check each exhibit against its index description, and to
   place any missing signed witness statement or expert report. Stop here
   until they ask to bind.

4. **The pre-filing gate.** Bind only once the filing's pre-filing gate
   job is closed, every check passed or waived. The gate is `/draft`'s
   pre-filing gate, run with `package_dir` set to
   `<mockup folder>\Package`, never the mockup folder itself. If it is not
   closed, say so and stop.

5. **Bind.** Run:

   ```
   python bind_package.py --index-json "<data folder>\Package index.json" --package-dir "<mockup folder>\Package"
   ```

   If the output PDF already exists, pass `--output` with a version suffix
   (e.g. `Claimant's Opening Submissions v2.pdf`); never overwrite.

   `unsigned_witness` names each witness with no `- signed.pdf`. Tell the
   practitioner and stop. Bind the unsigned statement only if the
   practitioner directs it, and then pass their direction in their own words:
   `--bind-unsigned "<name>=<their words>"`. The script records it in
   `Package index.json`. `missing_file` means a document or exhibit is not in
   `Package\`: name it and stop. On any other refusal, report the code and
   detail and stop. `split_setting_required` means the package is over the
   size limit; splitting a VanIAC package is not built.

6. **Present the result.** Present the bound PDF as a clickable file card,
   and beside it list each bookmark with the file bound under it, so the
   practitioner can check the order.

## Error handling

- On `missing_dependency`, from the gather or the bind, the named module is
  absent. On the PC, run `pip install PyMuPDF`. In Cowork, even if asked,
  never install or fetch a package, probe the network, change admin
  settings, or run or reimplement the scripts in any shell. Say this
  subskill can't run here, offer the Code tab, and stop.

## Boundaries

- Never re-render, edit, rename or stamp a file in `Package\`. The binder
  reads them as they sit.
- Never gather an exhibit the filed Evidence Index does not list.
- Never bind, number pages or add bookmarks by any route other than
  `subskills/assemble-vaniac-package/scripts/bind_package.py`.
- Sending the package to the Centre or the other side is the practitioner's
  own act.
