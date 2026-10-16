---
name: assemble-bcca-book
description: >
  Binds a BCCA book into its filed PDFs: a stay response's Response Book and,
  when authorities are cited, the Book of Authorities -- or a factum's Book of
  Authorities on its own. Each gets its cover, table of contents and parts,
  numbered and bookmarked, with the table's page column filled. Routed to by
  the explicit assemble-bcca-book token, or by a practitioner asking to bind
  or combine a response book or a book of authorities.
---

# Assemble BCCA Book

Binds a BCCA book whose documents `/publish` with `publish-bcca-book` has
already rendered -- a stay-application response book, or a respondent's
factum's Book of Authorities. Run it once the practitioner has saved the
written argument and the table of authorities to PDF from Word. The factum
document itself is never bound here; only its Book of Authorities is.

Depends on `publish/scripts/fill_book.py`: the binder re-renders each
table of contents with its page numbers through `/publish`'s own script, so
`/publish` must be installed beside `/assemble`. It converts the cover and
table of contents to PDF through Microsoft Word (Windows, through
PowerShell), falling back to LibreOffice (`soffice`) where Word is
unreachable; `docx_conversion_failed` reports both attempts when neither
works. Binding and both page checks need PyMuPDF, so they run on the PC
only -- see Error handling.

## What this produces

1. `Response Book.pdf` -- cover, table of contents and parts, numbered and
   bookmarked, with the table's page column filled. A stay response only.
2. `Book of Authorities.pdf` -- the same, only when the filing cites an
   authority

## Steps

1. **Resolve the writing folder.** The filing's own folder under the
   matter's `0. DRAFT*` folder, where the books are written, never the top
   of the draft folder: the name `/draft` passes (the folder its render
   wrote the filing's mockup copy into), or with none passed, resolved the
   way `/draft` step 6 resolves it (glob `0. DRAFT*`,
   the filing's own code -- `AR` for a stay response, `FACTUM` for a
   factum -- and the legacy-folder safeguard). Do not re-derive the
   mechanics here.

2. **Locate the inputs.** Find `bcca-book.md` in the substance folder for
   the filing kind the practitioner named -- `bcca-book-substance` for a
   `bcca_stay_response` filing, `bcca-factum-substance` for a `bcca_factum`
   filing, both under the case-data folder (the one `coclerk.json`'s
   `case_data_dir` names, passed by `/draft`; in Cowork, request access to that
   folder itself, never a parent or the firm root). Resolve the folder
   from the kind rather than probing both: a matter may hold one of each,
   and they are different books. If the file isn't there, stop and point the
   practitioner at `/publish` with
   `publish-bcca-book`. In the writing folder, find the cover file
   `publish-bcca-book` actually wrote for each book, version suffix
   included (e.g. `1. Cover Page Response Book v2.docx`). When more than
   one version exists, ask the practitioner which one to bind.

3. **Collect the part PDFs.** Combine the Response Book only when
   `bcca-book.md` carries the `response_book_*` keys (a factum's book has
   no Response Book half, so it omits all four), and the
   Book of Authorities only when `bcca-book.md`'s `boa_parts` is non-empty.
   For each book, read its parts array (`response_book_parts` or
   `boa_parts`) from `bcca-book.md` and find exactly one PDF per entry, in
   that order: each Part 1 document as its filed PDF, the written argument
   and the table of authorities saved to PDF from Word, and each authority
   as a PDF holding what its kind's row of the "What a part contains" table
   says, in
   `publish/subskills/publish-bcca-book/references/bcca-book-contract.md`.
   When a PDF's contents cannot be matched to that row from the file
   itself, ask the practitioner. Look in the writing folder from step 1
   first. When an entry has no PDF there, or more than one file could be it, ask the
   practitioner which file it is. Never guess, and never use one file for
   two entries.

   Then collect the exhibit bookmark text. For each part whose bookmark
   starts with `Affidavit`, invoke `/case-data` for that affidavit's
   exhibits, each with its exhibit letter or number, its description and
   its date. Write each description as `June 1, 2019 – <description>`,
   or the description alone when case-data has no date. Leave out any exhibit
   case-data doesn't have. Write the result to
   `<bcca-book-substance folder>\response-book-exhibits.json` with the Write
   tool, in the shape
   `subskills/assemble-bcca-book/references/book-binding-contract.md` "Book
   manifest builder" gives. The paginator finds each exhibit's page from its
   stamp in the PDF and bookmarks an exhibit with no text as `Exhibit A`
   alone.

4. **Check the written argument against the page cap, before binding.**
   Response Book only -- a factum's book has no written argument part, so
   skip this step when step 3 found no `response_book_*` keys. The
   registry returned the CA59991 response book for a written argument over the
   cap, and a book already bound is too late to find that out. Run
   `subskills/assemble-bcca-book/scripts/check_book.py` on the written
   argument's PDF from step 3 — the converted PDF, never the `.docx`, because
   the registry counts the filed face:

   ```
   python check_book.py --argument "<writing folder>\<written argument>.pdf"
   ```

   The cap defaults to 5 pages, the stay-only response cap; a combined
   leave-and-stay response takes `--argument-cap 10`
   (`subskills/assemble-bcca-book/references/book-binding-contract.md`, "Book
   checker"). On a failure, show the practitioner the count and the cap the
   check names and stop — a shorter argument is theirs to write, never yours
   to trim. Do not bind until it passes or they tell you to bind anyway.
   The check needs PyMuPDF, so it runs on the PC only: in Cowork it refuses
   with `missing_dependency` (Error handling, below).

5. **Build each book.** Resolve `subskills/assemble-bcca-book/scripts/book_manifest.py`
   and `subskills/assemble-bcca-book/scripts/paginate_book.py` from
   `/assemble`'s folder: in a repo checkout run them as
   `python .claude/skills/assemble/subskills/assemble-bcca-book/scripts/<script>`
   from the repo root; in Cowork, run `book_manifest.py` from the folder this
   front door was opened from (its `Base directory for this skill:` line).
   `paginate_book.py` binds and needs PyMuPDF, so it runs on the PC only: in
   Cowork it refuses with `missing_dependency` (Error handling, below).
   For the Response Book, when step 3 found one, run:

   ```
   python book_manifest.py --exhibits "<bcca-book-substance folder>\response-book-exhibits.json" bcca-book.md response "<writing folder>\1. Cover Page Response Book.docx" "<writing folder>\Response Book.pdf" "<bcca-book-substance folder>\response-book-manifest.json" <part PDFs, in parts order>
   python paginate_book.py "<bcca-book-substance folder>\response-book-manifest.json"
   ```

   For the Book of Authorities, run the same two commands without
   `--exhibits` and with `boa`,
   `1. Cover Page BOA.docx`, `Book of Authorities.pdf` and
   `boa-manifest.json` beside the `bcca-book.md` step 2 found. Pass the cover file step 2 found,
   including any version suffix. If the output PDF already exists, give
   the new one a version suffix (e.g. `Response Book v2.pdf`); never
   overwrite. Each call prints one
   JSON line (`subskills/assemble-bcca-book/references/book-binding-contract.md`,
   "Book manifest builder" and "Book paginator manifest"). On a rejection,
   report the code and detail to the practitioner and stop.
   `split_setting_required` means the
   book is over the size limit, and splitting it waits on ticket #649.
   `no_text_layer` or `exhibit_stamp_repeated` means the stamps can't be
   read reliably: ask the practitioner for each exhibit's first page within
   that affidavit's PDF, add them as `pages` in the exhibits file, and rerun
   both commands. `exhibit_text_unmatched` means case-data and the PDF
   disagree on an exhibit's letter: show the practitioner both and stop.

6. **Check the numbering of each book that was built.** The same registry
   return also named pages that were not numbered consecutively. Run the
   checker on each combined PDF:

   ```
   python check_book.py --book "<writing folder>\Response Book.pdf"
   ```

   It passes silently on a book this pipeline bound with the default
   `numbering_starts` of `"cover"`. A failure names every page missing its
   number: report it to the practitioner as a defect in the bound book and
   stop — never renumber by hand, and never stamp a page yourself. Like the
   written-argument check, it needs PyMuPDF and runs on the PC only (Error
   handling, below).

   The check reads a book that starts at page 1, so it does not apply to
   volume 2 and later of a split book, whose numbering continues from the
   volume before. That does not arise today: step 5 stops with
   `split_setting_required` on a book over the size limit, which waits on
   ticket #649.

7. **Present the result.** Present every file as a clickable file card (`shared/present-files.md`), in
   the order listed above. Beside each combined PDF, list each bookmark
   with the file used for it, so the practitioner can check the matching.

## Error handling

- On `missing_dependency`, from the written-argument check, the bind or the
  numbering check, the named module is absent. On the PC, run
  `pip install PyMuPDF`. In Cowork, even if asked, never install or fetch a
  package, probe the network, change admin settings, or run or reimplement
  the scripts in any shell. Say this subskill can't run here, offer the
  Code tab, and stop.

## Closing note

Court Services Online packaging is not built, and is not a gap. The firm has
decided against CSO automation: no write tool, no automation of submission, no
scraping of filing status. Submitting the bound books is the practitioner's
own step, deliberately.

## Boundaries

- Never hand-author, patch, or "fix up" `bcca-book.md`; it comes only from
  `/publish` with `publish-bcca-book`.
- Never combine a book, add bookmarks or number pages by any route other
  than `subskills/assemble-bcca-book/scripts/book_manifest.py` and
  `subskills/assemble-bcca-book/scripts/paginate_book.py`.
