---
name: publish-bcca-book
description: >
  Renders a BCCA book's cover pages and tables of contents as filing-ready
  .docx files, from a bcca_stay_response filing's stored data (Response Book
  and Book of Authorities, four documents) or a bcca_factum filing's (Book of
  Authorities only, two documents). Routed to by the explicit
  publish-bcca-book token, or by a practitioner asking to turn a ready
  response-book or book-of-authorities mockup into the actual court documents.
---

# Publish BCCA Book

Turns a BCCA book's stored data into court-ready `.docx` files. `/draft`
elicits and stores the filing's substance and shows the practitioner a
markdown mockup to review; this subskill runs once the practitioner is happy
with that mockup and wants the actual documents. Binding the books into their
filed PDFs is a separate step: `/assemble` with `assemble-bcca-book`.

**In Cowork, stop here.** In Cowork (this host grants the data tools as
`mcp__remote-devices__plugin_lawyer_data__<name>`), stop before any tool
call or file write. This step runs on the PC, in a Claude Code session in the
desktop app's Code tab, where the Probanda plugin is installed, not in a
Cowork cloud sandbox, which cannot see the matter or matter-data folders (ADR
0026). Tell the practitioner so, and how to run it there: open a Code-tab
session in the matter's folder and ask for the same publish step. Do not
retry or probe in Cowork.

## What this produces

For a `bcca_stay_response` filing, four documents:

1. `1. Cover Page Response Book.docx`
2. `2. Table of Contents Response Book.docx`
3. `1. Cover Page BOA.docx`
4. `2. Table of Contents (BOA).docx`

For a `bcca_factum` filing, the last two only. A respondent's factum is one
Word document, not a book, so it has no Response Book half; its Book of
Authorities is a book in its own right. The factum itself is
`publish-bcca-factum`, not this subskill.

The table-of-contents files are review copies. The binder re-renders
each table with its page numbers, so an edit made to them in Word is lost
at binding.

## Steps

1. **Resolve the database.** Invoke `/drafting-data` to resolve `db_path`
   for the current matter, following its own Configuration section. Never
   re-derive its path-resolution rules independently.

2. **Confirm the filing.** The filing this subskill acts on must have
   `kind = 'bcca_stay_response'` or `kind = 'bcca_factum'`. If the
   practitioner's request names a filing of any other kind, say so and stop
   -- this subskill only knows how to render a stay-application response
   book and a respondent's factum's book of authorities. Note which of the
   two kinds it is: step 4 writes to a different folder for each.

3. **Call the emitter.** Call `drafting_forms__emit_bcca_book` for the
   filing. This is the only permitted way to produce a `bcca-book.md` --
   never hand-author or patch one yourself, even to work around a refusal.

   If the emitter refuses, it returns a `bundle_outdated`-shaped envelope
   naming what's missing (per
   `subskills/publish-bcca-book/references/bcca-book-contract.md`'s "Refusal
   conditions" section). Tell the practitioner plainly what's missing --
   e.g. an unpositioned party group, a missing contact, an out-of-date
   installed bundle -- and stop. Never try to work around the refusal by
   guessing at the missing data.

4. **Write the interchange file.** Write the emitter's returned markdown
   **verbatim, byte-for-byte** to the folder for the filing kind step 2
   confirmed, keeping the filename `bcca-book.md`:

   | Filing kind | Path |
   |---|---|
   | `bcca_stay_response` | `{matter-data folder}\bcca-book-substance\bcca-book.md` |
   | `bcca_factum` | `{matter-data folder}\bcca-factum-substance\bcca-book.md` |

   A matter may hold both filings, so one shared path would let a factum's
   book overwrite a filed stay response's. The factum's folder is the one
   `bcca-factum.md` already uses.

   The matter-data folder is the one `probanda.json`'s `case_data_dir` names.
   It must already exist: if it does not, stop and tell the practitioner to
   run `/matter-data` initialize; never create it.

   Use the first-class Write tool -- never sandbox bash. Sandbox-path writes are
   subject to the Cowork mount-staleness bug
   ([#324](https://github.com/Mharbulous/CoClerk/issues/324)); the same
   reason `/draft` step 6 writes this way. Create the `-substance` folder
   if it doesn't exist.

5. **Validate, then fill.** Resolve `scripts/fill_book.py` from `/publish`'s
   folder: in a repo checkout run `python .claude/skills/publish/scripts/fill_book.py`
   from the repo root. Then run, via Bash:

   ```
   python fill_book.py --validate bcca-book.md
   python fill_book.py bcca-book.md <output-dir>
   ```

   Both calls print a single JSON line per run (or one per document on a
   successful fill -- see
   `subskills/publish-bcca-book/references/bcca-book-contract.md`'s "CLI
   acceptance oracle" section) and exit non-zero on any rejection, never a
   Python traceback. A rejection at this stage means the emitter produced a
   `bcca-book.md` that doesn't match the contract -- report the exact error
   code and detail to the practitioner as a defect to flag, not something to
   patch around; do not edit `bcca-book.md` and retry. Exception:
   `output_exists` means a file appeared mid-run. Tell the practitioner,
   present the paths already printed, and stop.

   A successful fill may also print `WARNING: substitution key never
   matched: <key>` lines on stderr. These exit zero but mean a placeholder
   is still sitting unreplaced in a court-bound document -- report every
   such line to the practitioner at step 7 alongside the files, as a defect
   to flag.

6. **Resolve the output folder.** The documents land in the filing's
   Writing folder under the draft folder -- the folder `/draft` renders the
   filing's mockups into, named after the filing, and whose name it passes
   (glob `0. DRAFT*`). `/draft` section 11 ("The Writing's folder") holds the
   mechanics; do not re-derive them independently here. Point `<output-dir>`
   at that same folder, never at the top of the draft folder.

7. **Present the result.** Present every path the fill printed as a
   clickable file card (`shared/present-files.md`), in the order listed above. The fill never
   overwrites: a taken name gets the next ` vN` (e.g. `1. Cover Page
   Response Book v2.docx`), and `versioned_from` names the copy passed
   over. Tell the practitioner, then present it (`shared/present-files.md`) as current per the
   workspace output rule. Never overwrite, rename or delete an existing
   book yourself.

## Next

Binding each book into its filed PDF is `/assemble` with
`assemble-bcca-book`, once the written argument and the table of
authorities have been saved to PDF from Word. A factum's Book of
Authorities binds the same way; the factum itself never does.

## Boundaries

- Never hand-author, patch, or "fix up" `bcca-book.md`. If the emitter
  refuses or produces something the validator rejects, that is a defect to
  report, not a gap to paper over.
- Never restate the submission database's schema anywhere in this
  subskill's output or conversation -- point at
  `drafting_forms__emit_bcca_book` and
  `subskills/publish-bcca-book/references/bcca-book-contract.md` instead.
