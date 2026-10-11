# Assembly input contract — `bcca-factum.md` (SSOT)

This file is the single source of truth for the interchange between
`/draft`'s `bcca_factum` filings and `/publish`'s
`publish-bcca-factum` subskill. The division of discipline is the same as
`subskills/publish-bcca-book/references/bcca-book-contract.md`'s:

- **The validator (`subskills/publish-bcca-factum/scripts/fill_factum.py --validate`) owns format.** It
  rejects any deviation from the grammar below with the exact error code,
  before anything is filled. It knows nothing about the submission database.
- **The emitter (`drafting_forms__emit_bcca_factum`) owns content.**
  `bcca-factum.md` is a filed face, not a review surface: no work marker,
  gap comment or HTML comment. Where required content is missing, the
  emitter refuses and names it rather than emitting a placeholder.

Review happens on the drafting pipeline's mockup (`Factum.md`) before the
emitter runs. Its paragraph numbers and authorities list match this file's.

## Invocation

The `publish-bcca-factum` subskill writes the emitter's returned markdown
verbatim to `{case-data folder}\bcca-factum-substance\bcca-factum.md` (the
case-data folder being the one `coclerk.json`'s `case_data_dir` names),
then runs:

```
python subskills/publish-bcca-factum/scripts/fill_factum.py --validate bcca-factum.md
python subskills/publish-bcca-factum/scripts/fill_factum.py bcca-factum.md <draft-dir> --out-name STEM
```

Each call prints one JSON line: `{"success": true}`, or
`{"success": false, "error": "<code>", "detail": "..."}` with a non-zero
exit. A fill run adds `{"success": true, "document": "factum", "path": ...}`.
The fill writes `<stem>.docx` at the top of `<draft-dir>`, the matter's
draft folder, which must already exist (else `no_out_dir`); it creates no
folder. The stem is composed by the caller under the firm's file-naming
convention; one that is empty, carries `\ / : * ? " < > |`, ends in a file
extension or ends in ` v<n>` is refused (`bad_input`). The unsuffixed name
counts as v1 and `<stem> vN.docx` as vN: with none present the unsuffixed
name is written, else v(highest + 1), and the result reports the highest
existing copy as `versioned_from`. The copy is written to a `~`-prefixed
temporary file in the same folder and then renamed, so an existing file is
never overwritten and a killed fill leaves no partial deliverable.

## What the fill produces

One Word document from `subskills/publish-bcca-factum/templates/bcca-factum-respondent.dotx`, a
byte-for-byte copy of the court's `tpl_factum_respondent.dotx` (Last
Updated September 8, 2026). The fill:

- deletes every instruction table and all example content;
- fills the cover, the chronology table, the Opening Statement, Parts 1–4,
  the place and date line, the name authorizing filing, the List of
  Authorities table and the Enactments appendix;
- puts Parts 1–4's numbered paragraphs on the template's own numbering
  list, so Word numbers them consecutively (the Opening Statement stays
  unnumbered);
- leaves the template's table of contents field and its page-number header
  alone;
- fills each authority's "Page # in factum" cell with a `PAGEREF` field to a
  bookmark on the first paragraph citing it, and sets `updateFields` so Word
  refreshes the table of contents and those page numbers when the document
  opens.

Saving the PDF from Word stays with the practitioner (the factum
instructions require saving from Word, not scanning). The factum itself is
not a book: it is never bound by `/assemble` with `assemble-bcca-book`. Its
Book of Authorities is a separate book, produced by `publish-bcca-book` from
the same filing and bound the normal way.

## Frontmatter

`key: value`, one per line, between `---` fences. JSON values are one line.

| Key | Required | Value |
|---|---|---|
| `file_number` | yes | Court of Appeal file number, e.g. `CA51722` |
| `short_style` | yes | `First Appellant vs. First Respondent` |
| `record_label` | yes | The cover's short label, e.g. `Respondents' Factum` |
| `title` | yes | The cover's title line, e.g. `RESPONDENTS' FACTUM` |
| `filing_party_phrase` | no | Names of the filing respondents; the line is removed when absent |
| `under_appeal_judge`, `under_appeal_court`, `under_appeal_pronounced` | together or not at all | The ON APPEAL FROM line; `under_appeal_pronounced` is `YYYY-MM-DD`. Absent, the line is removed |
| `access_restrictions` | no | JSON array of lines (sealing order, publication ban, anonymity order). Absent, both template placeholders are removed |
| `party_groups` | yes | JSON array, at least two: `{"role", "names": [...], "lower_court_role"?}`; `role` as printed (pluralized) |
| `contacts` | yes | JSON array of exactly two: the appellant side, then the respondent side. `{"role", "names", "counsel_name"?, "counsel_firm"?, "address"?, "phone"?, "email"?}` |
| `chronology` | yes | JSON array, non-empty: `{"date": "YYYY-MM-DD", "event"}` |
| `authorities` | yes | JSON array, possibly empty, alphabetical: `{"authority", "citation", "paras": [n, ...]}`; each para at most the last numbered paragraph |
| `enactments` | yes | JSON array, possibly empty: `{"title", "citation" (or null), "excerpts": [{"pinpoint" (or null), "text"}]}` |
| `signing_place` | yes | City for "Dated at the City of …" |
| `dated_on` | yes | `YYYY-MM-DD`; printed "this September 16 of 2026" (template Part 4 step 5) |
| `authorizing_name` | yes | Name of the lawyer or party authorizing filing (R. 79(4)(b)) |
| `authorizing_line` | yes | The line under it, e.g. `Counsel for the Respondents` |

## Body

Five `## ` headings, exactly these and in this order:

```
## OPENING STATEMENT
## PART 1 - STATEMENT OF FACTS
## PART 2 - ISSUES ON APPEAL
## PART 3 - ARGUMENT
## PART 4 - NATURE OF ORDER SOUGHT
```

Blank lines are ignored. Other lines take one of four forms:

| Form | Meaning |
|---|---|
| `N. text` | Numbered paragraph. Numbers run 1, 2, 3 … across Parts 1–4 |
| `> text` | Quoted excerpt line, indented and single-spaced |
| `cite: text` | Source line (record reference or authority citation) under the paragraph above |
| any other text | Unnumbered paragraph |

- The Opening Statement holds unnumbered paragraphs only, at least one.
- Parts 1–3 each open with a numbered paragraph and hold only numbered
  paragraphs, quote lines and cite lines.
- Part 4 is a numbered lead-in ("The respondents seek an Order:"), one or
  more unnumbered order paragraphs, then the numbered closing line ("All of
  which is respectfully submitted.").
- No `<!--` and no `**` anywhere.

## Validator error codes

| Code | Raised when |
|---|---|
| `missing_frontmatter` | No opening or closing fence, or a frontmatter line without `:` |
| `unknown_key` / `duplicate_key` / `missing_required_key` | Frontmatter key not in the table, repeated, absent, or empty |
| `invalid_json` | A JSON key's value does not parse |
| `bad_party_group` / `bad_contact` / `bad_chronology` / `bad_authority` / `bad_enactment` / `bad_access_restrictions` | That key's value breaks its shape above |
| `bad_on_appeal_from` | Only some of the three `under_appeal_*` keys given |
| `bad_date` | A date is not a real `YYYY-MM-DD` date |
| `unknown_heading` / `duplicate_heading` / `heading_order` / `missing_heading` / `content_before_heading` | Body headings break the list above |
| `bad_opening_statement` | Opening Statement empty or holds a numbered, quote or cite line |
| `empty_part` / `numbering` / `unnumbered_paragraph` | Part 1–4 numbering broken, a Part with no numbered paragraph, or an unnumbered paragraph in Parts 1–3 |
| `bad_part4` | Part 4 not lead-in, orders, closing line |
| `disallowed_markup` | `<!--` or `**` in the body |
| `bad_input` | (fill only) The `--out-name` stem is not a bare file name stem |
| `no_out_dir` | (fill only) The draft folder given is not a folder |
| `output_exists` | (fill only) The next versioned name was taken while the fill wrote its copy |
