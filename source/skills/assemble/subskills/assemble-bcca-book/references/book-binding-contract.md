# Binding contract — BCCA book paginator and manifest builder (SSOT)

Split out of `publish/subskills/publish-bcca-book/references/bcca-book-contract.md`,
which owns the `bcca-book.md` grammar, its row shapes and the validator codes
referred to below.

## Book paginator manifest (`subskills/assemble-bcca-book/scripts/paginate_book.py`)

The paginator combines a book's cover, table of contents and ordered parts
into one filed PDF. It takes one JSON manifest and does not read `bcca-book.md`;
for a book `bcca-book.md` describes, `subskills/assemble-bcca-book/scripts/book_manifest.py` writes that
manifest (see "Book manifest builder" below).

```
python subskills/assemble-bcca-book/scripts/paginate_book.py <manifest.json>
```

### Keys

| Key | Required | Value |
|---|---|---|
| `cover` | yes | path to the cover, `.docx` (converted by Word, or by LibreOffice where Word is unreachable) or `.pdf` |
| `toc` | yes | `{"template": "response" \| "boa", "rows": [...]}`. Rows use the `response_book_toc` or `boa_toc` row shape in the book contract, plus a required `part` |
| `parts` | yes | non-empty array, in book order: `{"path": "<.pdf>", "bookmark": "<text>"}`, plus an optional `exhibits` on an affidavit part (below). The bookmark text is used as given |
| `numbering_starts` | yes | `"cover"` or `"after_toc"` |
| `output` | yes | path of the combined `.pdf`. It must not already exist |
| `number_repeated_front_matter` | only when the book splits | `true` or `false`: whether volume 2+'s repeated cover and table of contents take page numbers. It has no default because no written source settles it (ticket #649) |

A row's `part` is a `parts` index, `"cover"`, `"toc"`, or `null`. The row's
page cell gets the stamped number of the first page of that part, of the
cover, or of the table of contents. `null` leaves the cell blank, as on a
heading row. A cover or TOC reference is also blank when those pages carry
no number.

### Exhibit bookmarks

A part whose bookmark starts with `Affidavit` is an affidavit part. Each of its
exhibits gets a bookmark nested under the part's bookmark, pointing at the
exhibit's first page (its stamp page):

```json
{"path": "affidavit.pdf", "bookmark": "Affidavit #1 of Jane Doe, filed 2026-08-01",
 "exhibits": {"text": {"A": "June 1, 2019 – Letter from John to Jane Doe"}, "pages": {"A": 3, "B": 5}}}
```

- **Pages.** Without `pages`, the paginator reads every page's text layer
  and takes each page stamped `This is Exhibit "X" referred to in …` as
  exhibit X's first page. Any single punctuation mark counts as the quote.
  `pages` replaces detection. It maps each exhibit label to its first page,
  counted from 1 within the part PDF.
- **Text.** The bookmark is `Exhibit X – <text>` when `text` has the label,
  otherwise `Exhibit X`.
- `exhibits` on a part that isn't an affidavit is `bad_manifest`.

### What it produces

- Page numbers stamped top centre (Helvetica 12 pt, 0.5 in from the visual top edge, rotated pages included).
- `numbering_starts: "cover"` numbers every page from 1. `"after_toc"` leaves the cover and TOC unstamped and starts the first part at 1.
- Page Labels on every page that equal its stamp. Unstamped pages get lowercase roman labels.
- Bookmarks: `Cover Page`, `Table of Contents`, then one per part, with an affidavit part's exhibit bookmarks nested under it. A part PDF's own bookmarks are not kept.
- The TOC is filled with blank page cells to learn its length, then refilled with the real numbers. If filling the numbers changes the TOC's page count, the numbers are recomputed once.
- **Volume split:** if the combined PDF is over 200 MB, parts are grouped in order, never splitting a part, into volumes named `<output stem> (Volume N of M).pdf`. Each volume carries the cover, stamped `Volume N of M` below the page number, the full TOC, its own bookmarks and Page Labels. Numbering continues across volumes.

Output is one JSON line, `{"success": true, "volumes": [{"path", "page_count", "bytes"}]}`,
or an error envelope in the same shape as the validator's.

### Error codes

| Code | Meaning |
|---|---|
| `bad_manifest` | not JSON, unknown or missing key, or a malformed `cover`/`parts`/`toc`/`numbering_starts`/`number_repeated_front_matter` |
| `missing_file` | the cover or a part file does not exist |
| `bad_part_ref` | a row's `part` is not a valid parts index, `"cover"`, `"toc"` or `null` |
| `bad_toc_row` / `bad_indent` | as in the book contract's validator table, for the rows without `part` |
| `no_text_layer` | an affidavit part without `exhibits.pages` has a page with no text, so its stamps can't be read |
| `exhibit_stamp_repeated` | an affidavit part without `exhibits.pages` has the same exhibit stamp on two pages, e.g. an exhibit that is itself an affidavit |
| `exhibit_text_unmatched` | `exhibits.text` names an exhibit the part doesn't have |
| `bad_exhibit_page` | `exhibits.pages` gives a page outside the part PDF |
| `output_exists` | the output file, or a volume file, already exists |
| `docx_conversion_failed` | neither Word nor LibreOffice could convert the cover or TOC; `detail` names both attempts |
| `missing_dependency` | PyMuPDF (`fitz`) is not installed, so the binder cannot run here; `detail` names the module and points at the PC |
| `toc_page_count_unstable` | the TOC changed page count twice while its numbers were filled in |
| `split_setting_required` | the book must split and `number_repeated_front_matter` is absent |
| `part_over_limit` | one part, with the cover and TOC, cannot fit in a volume under the limit |
| `volume_over_limit` | a built volume came out over the limit |
| `unexpected_exception` | any other failure, with the traceback in `detail` |

## Book manifest builder (`subskills/assemble-bcca-book/scripts/book_manifest.py`)

Writes the paginator manifest for one book in `bcca-book.md`. The rows, their
`part` references and the bookmarks are copied unchanged; the caller supplies
the part PDFs, in the order of the book's parts array, and optionally an
exhibits file. What each Book of Authorities part PDF holds, by kind, is in
the book contract's "What a part contains" table.

```
python subskills/assemble-bcca-book/scripts/book_manifest.py [--exhibits <exhibits .json>] <bcca-book.md> <response|boa> <cover .docx|.pdf> <output .pdf> <manifest .json> <part .pdf>...
```

`response` uses `response_book_toc`/`response_book_parts` and the
`response` TOC template; `boa` uses `boa_toc`/`boa_parts` and the `boa`
template. `numbering_starts` is `"cover"`. `number_repeated_front_matter`
is left out, so a book over the size limit stops with
`split_setting_required` until ticket #649 settles it.

The exhibits file maps a part's bookmark text to that part's `exhibits`
value (see "Exhibit bookmarks"). It is copied onto the part entry unchanged:

```json
{"Affidavit #1 of Jane Doe, filed 2026-08-01": {"text": {"A": "June 1, 2019 – Letter from John to Jane Doe"}}}
```

Output is one JSON line, `{"success": true, "manifest": "<path>", "parts": [{"path", "bookmark"}]}`,
or an error envelope in the validator's shape.

| Code | Meaning |
|---|---|
| any validator code | `bcca-book.md` fails `publish/scripts/fill_book.py --validate` |
| `bad_book` | the book argument is not `response` or `boa` |
| `no_parts` | the book's parts array is empty (a BOA with no authorities), so there is no book to combine |
| `part_count_mismatch` | the number of part PDFs given differs from the book's parts array |
| `unknown_exhibit_part` | the exhibits file names a bookmark that isn't in the book's parts array |

## Book checker (`subskills/assemble-bcca-book/scripts/check_book.py`)

Checks a response book against the two defects the registry returned on
CA59991 (01-SEP-2026 Courtesy Correction, package 4999901): a written argument
over the completion instructions' page cap, and pages that are not numbered
consecutively. Both are read from PDFs, so the script needs PyMuPDF and runs
on the PC only (`missing_dependency` elsewhere, same envelope as the
paginator's).

```
python subskills/assemble-bcca-book/scripts/check_book.py [--argument <written argument .pdf> [--argument-cap N]] [--book <book .pdf>]
```

Give either flag or both. Output is one JSON line,
`{"success": true, "all_passed": <bool>, "checks": [...]}`, or an error
envelope in the same shape as the paginator's. Exit 0 only when the script ran
**and** every check passed; 1 when a check failed or the script refused; 2 on a
usage error. A failed check is never a silent pass and never a `success: false`
— the envelope always says which check failed and why.

### `argument_page_cap` — run before binding

Counts the pages of the written argument's **converted PDF**, the one saved
from Word and later handed to the manifest builder as the `Part 2: Written
Argument` part. The count is taken from the PDF and not from the `.docx`
because the registry counts the filed face, and Word's own page count depends
on the machine that renders it.

The cap comes from e-CI §2.1, recorded at
`draft/references/bcca-response-book-form.md` §6.2: **5 pages** for a response
to a leave **or** stay application, **10** for a combined leave-and-stay
response. `--argument-cap` defaults to 5, because the only book with a written
argument in it is a `bcca_stay_response` filing's Response Book (a
`bcca_factum` filing's book is the Book of Authorities alone, which has no
written argument part); a combined response passes
`--argument-cap 10`. Every result names the cap it applied, so a wrong cap is
visible in the output rather than assumed.

A breach also names the one open question in §6.2: the argument's own §2.1
cover page sits **outside** the count on that reference's flagged inference,
which is not stated expressly in the instructions. A count exactly one over the
cap may therefore still comply; a larger count does not on either reading.

| Key | Value |
|---|---|
| `passed` | `pages <= cap` |
| `pages` | the argument PDF's page count |
| `cap` | the cap applied |

### `sequential_numbering` — run on the emitted book

Reads every page of the combined book and asks whether it carries its own
1-based position as a standalone number in the top inch of the page — where
both this pipeline's stamp (`paginate_book.py`, 0.5 in from the visual top
edge) and a Word running header sit. Word boxes are reported unrotated, so the
band is derotated: a rotated page is read at its **visual** top.

- **A token, not a substring.** `2026` in a running header is not page 2026,
  and `2026 BCCA 123` does not number page 20.
- **A page with no text layer is a hard error** (`no_text_layer`), never a
  pass: whether it carries a number cannot be read, and this check does not
  guess.
- **Front matter is not exempt.** The registry's wording is "all PDF pages of
  your Response Book", so a book bound with `numbering_starts: "after_toc"`
  will be flagged on its cover and table of contents. That is the check
  reporting what the registry asked for, not a defect in the paginator, which
  supports both settings.
- **The book must start at page 1.** The check compares each page against its
  own 1-based position, so it does not apply to volume 2 and later of a split
  book, whose numbering continues from the volume before. No split book can be
  produced today: the paginator stops with `split_setting_required` pending
  ticket #649.
- **Not judged:** whether the number a page carries is the one the table of
  contents points at, and a top-band numeral that coincidentally equals the
  page's position (a `1.` opening a numbered paragraph on page 1 passes).

| Key | Value |
|---|---|
| `passed` | no page is missing its number |
| `page_count` | the book's page count |
| `unnumbered_pages` | every 1-based page whose number is absent or wrong, in order |

### Error codes

| Code | Meaning |
|---|---|
| `bad_arguments` | neither `--argument` nor `--book` given, a non-`.pdf` path, or a non-positive `--argument-cap` |
| `missing_file` | a named file does not exist |
| `no_text_layer` | a book page has no text layer, so its numbering cannot be read |
| `missing_dependency` | PyMuPDF (`fitz`) is not installed; `detail` names the module and points at the PC |
| `unexpected_exception` | any other failure, with the traceback in `detail` |
