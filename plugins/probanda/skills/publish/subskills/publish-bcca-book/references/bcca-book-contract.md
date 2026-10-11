# Assembly input contract — `bcca-book.md` (SSOT)

This file is the single source of truth for the interchange between
`/draft`'s `bcca_stay_response` and `bcca_factum` filings and `/publish`'s
`publish-bcca-book` subskill. It is the same kind of document as
`.claude/skills/publish/subskills/publish-bcsc-form/references/assembly-input-contract.md`
(the Form 32/33 precedent) — read that file's "Division of discipline"
section first; the same split applies here:

- **The validator (`scripts/fill_book.py --validate`) owns format.** It
  rejects any deviation from the grammar below with the exact error,
  before anything is filled. It knows nothing about the submission
  database and must never learn its shape.
- **The emitter (`drafting_forms__emit_bcca_book`, in the submissions
  MCP server) owns content.** `bcca-book.md` is a filed face, not a
  review surface — it must contain only what may reach the court. It
  never emits a work marker, a gap comment, or an HTML comment. Where a
  cover-critical field is missing, the emitter refuses (naming the
  field) rather than emitting a placeholder.

Review happens on the drafting pipeline's mockup (`Response Book.md`, or
`Factum.md` for a factum's book of authorities) before the emitter runs;
by the time a `bcca-book.md` exists, its content is filing-ready.

## Invocation

The `publish-bcca-book` subskill writes the emitter's returned
markdown verbatim to the filing's own substance folder, keeping the
filename `bcca-book.md`:

| Filing kind | Path |
|---|---|
| `bcca_stay_response` | `{case-data folder}\bcca-book-substance\bcca-book.md` |
| `bcca_factum` | `{case-data folder}\bcca-factum-substance\bcca-book.md` |

The case-data folder is the one `coclerk.json`'s `case_data_dir` names.
The folders are separate because a matter may hold both filings, and one
shared path would let a factum's book overwrite a filed stay response's.
The factum's folder is the one `bcca-factum.md` already uses.

It then runs:

```
python scripts/fill_book.py --validate bcca-book.md
python scripts/fill_book.py bcca-book.md <output-dir>
```

The first call only validates (exit 0 / prints the JSON envelope with
`"success": false` and an error code on rejection — never a Python
traceback). The second call validates again, then fills the templates and
writes the `.docx` files.

## Scope

Two filing kinds produce a `bcca-book.md`, and the kind decides how many
documents it describes:

- **`bcca_stay_response` — all four documents**: the Response Book cover,
  the Response Book table of contents, the Book of Authorities (BOA)
  cover, and the BOA table of contents.
- **`bcca_factum` — the two BOA documents only**. A respondent's factum
  is one Word document, not a book, so it has no Response Book half; its
  Book of Authorities is a book in its own right and is bound the same
  way. The four `response_book_*` keys are absent, and the filler writes
  the BOA cover and the BOA table of contents alone.

The emitter refuses any third kind, naming both accepted kinds.

The cover fields are shared (one court record, one set of parties, one
set of contacts) — only the record label and title line differ between
the two covers — so one file avoids repeating that data twice.

## Frontmatter

Flat `key: value` lines between `---` fences, exactly as in
`form-32.md`/`form-33.md`. Scalar values are verbatim strings; seven keys
carry JSON (`access_restrictions`, `party_groups`, `contacts`,
`response_book_toc`, `response_book_parts`, `boa_toc`, `boa_parts` -- each
marked "JSON array" in the table below), matching `form-32.md`'s own
`orders: <JSON>` convention. Unknown or duplicate keys reject.

The four `response_book_*` keys are a single **all-or-nothing group**:
present together on a `bcca_stay_response` book, absent together on a
`bcca_factum` book. Some present and some absent rejects with
`partial_response_book`, naming the missing keys — there is no such thing
as half a Response Book.

`Required` is `yes` (always), `no` (optional on its own) or `group` (one of
the four all-or-nothing `response_book_*` keys).

| Key | Required | Value |
|---|---|---|
| `file_number` | yes | verbatim, e.g. `CA51722` |
| `registry` | yes | verbatim, e.g. `Vancouver` |
| `short_style` | yes | verbatim, already composed: `"[First Appellant] vs. [First Respondent]"` — the template's own separator is `vs.`, not `v.`; the emitter composes this from the party groups, the filler does not |
| `under_appeal_judge` | no | verbatim judge name |
| `under_appeal_court` | no | verbatim court/tribunal name |
| `under_appeal_pronounced` | no | ISO date `YYYY-MM-DD` — the filler formats this to the template's ordinal prose ("the 29th day of June, 2026"); the emitter does not pre-format it |
| `access_restrictions` | no | JSON array of strings, one per line to render; omit the key entirely when none apply — never emit an empty array |
| `response_book_record_label` | group | top-right short label for the Response Book cover, e.g. `Response Book` |
| `response_book_title` | group | bold centred title line, already composed, e.g. `Respondents' Response Book` |
| `boa_record_label` | yes | top-right short label for the BOA cover, e.g. `Book of Authorities` |
| `boa_title` | yes | bold centred title line, already composed, e.g. `Respondents' Book of Authorities` |
| `filing_party_phrase` | no | the "name of the filing party" line under the title, already composed (e.g. `"F as in Frank Clothing Corporation, Andrew Heifetz (a.k.a. Drew Heifetz), and Jesse Heifetz"`); omitted for a joint book with no single filing party |
| `party_groups` | yes | JSON array, non-empty, order preserved: `[{"role": "Appellants", "names": ["...", "..."], "lower_court_role": "Plaintiffs"}, ...]`. `role` is the appeal-role label as it should render (already pluralized if needed — `"Appellant"`/`"Appellants"`); `lower_court_role` is optional per group (omit the key on a group with no confirmed value — the filler renders no bracketed line for that group, never a blank one) |
| `contacts` | yes | JSON array, one entry per party_groups role, same order: `[{"role": "Appellants", "names": ["..."], "counsel_name": "...", "counsel_firm": "...", "address": "...", "phone": "...", "email": "..."}, ...]`. Every value nullable except `role`/`names` — a missing contact field renders as an empty table cell, not a placeholder string |
| `response_book_toc` | group | JSON array of row objects (shape below) |
| `response_book_parts` | group | JSON array of the Response Book's part files, in book order: `[{"bookmark": "..."}]` (shape below) |
| `boa_toc` | yes | JSON array of row objects (shape below), may be empty (an empty BOA is valid — the filler renders the header row with no entries) |
| `boa_parts` | yes | JSON array of the BOA's part files, one per `boa_toc` row in the same order; empty when `boa_toc` is |

### `response_book_toc` row shape

```json
{"text": "Part 1: Evidence, Exhibits or Affidavits", "indent": 0, "part": null}
{"text": "Affidavit #1 of Jane Doe, filed 2026-08-01", "indent": 1, "part": 0}
{"text": "Exhibit 1: Letter from Doe to Smith (2026-07-15)", "indent": 2, "part": null}
```

`indent` is `0`, `1`, or `2`; `text` is already composed, plain text (no
markdown, no HTML). The emitter is responsible for the row set and its
order — Cover Page and Table of Contents self-rows first, then Part 1's
document/affidavit/exhibit rows (reusing the same deponent/exhibit
description logic the mockup's `buildToc` already computes, so the
filed table of contents and the mockup never diverge), then Part 2's
four fixed sub-rows, then Part 3 only when the mockup's own
`hasAuthorities || unverifiedDelta` condition holds. Page numbers are
never included; `fill_book.py`'s CLI renders every row's page cell blank. The
paginator (`/assemble` with `assemble-bcca-book`; see "Binding" below) fills them once the
combined PDF's page ranges are known.

`part` says which page the paginator puts in the row's cell: an index into
`response_book_parts` (the first page of that part file), `"cover"` or
`"toc"` for the self-rows, or `null` for a blank cell. The emitter assigns
it: each Part 1 document row opens its own part, the `Part 2: Written
Argument` and `Part 3: Table of Authorities` headings each open one, and
every other row is `null` -- the Part 1 heading, exhibit rows, and the
written argument's four sub-rows, which sit inside a part's file. Those
inner rows stay blank: ticket #652 found their page numbers permitted but
not required. Exhibits get a bookmark instead (see "Binding").

### `response_book_parts` / `boa_parts` entry shape

```json
{"bookmark": "Affidavit #1 of Jane Doe, filed 2026-08-01"}
```

One entry per part file, in book order. `bookmark` is the text of the row
that opens the part; for a BOA part it is `authority, citation` (or the
authority alone when `citation` is `null`).

### `boa_toc` row shape

```json
{"authority": "R. v. Jordan, 2016 SCC 27", "citation": null, "part": 0}
```

`authority` is `style_of_cause_or_title`; `citation` may be `null`
(render the authority text alone). Alphabetical order is the emitter's
responsibility. `part` is the row's index in `boa_parts`, same meaning as
in `response_book_toc`.

On a `bcca_factum` book the rows are the factum's own Appendix: List of
Authorities **narrowed by authority kind** — same citation text, same
order, a subset never a superset. The emitter takes them from the factum
renderer's own list rather than composing a second one, so the two can
never drift on anything but the kind filter.

The book carries `case`, `doctrine`, `statute` and `regulation`. It omits
`rule` outright — no part, and no table-of-contents row either. An omitted
authority still appears on the factum's Appendix: List of Authorities, so
nothing is lost to the court; only the book leaves it out.

**Why each kind is where it is (#813).** `case` and `doctrine` carry an
express duty: R. 27(1)(a), (2)(a) and (4) of BC Reg 120/2022 with the
registrar's *Book of Authorities – Civil Rule 27* completion instructions,
which describe a book as containing "authorities (case law, legal texts
etc.) referred to in a party's factum".

`statute`, `regulation` and `rule` are **the practitioner's call, not a
requirement**. No source imposes, permits or forbids any of them, and the
definitional route is exhausted: R. 27(1) turns on the word "authority",
R. 1(1) of the Rules does not define it, R. 1(2) routes to the *Court of
Appeal Act*, SBC 2021, c 6, and s. 1 of that Act does not define it either.
Their placement here records a decision taken on 2026-09-22 — enactments in,
rules out — which could be reversed without contradicting any authority.
Never describe it as required by the Rules.

An enactment therefore appears both as a book part and in the factum's
Appendix: Enactments. That duplication is deliberate and carries **no
cross-reference in either direction**: no source addresses it, the book's
alphabetical table of contents already serves as the pointer, and adding a
line to a filed face that no source requires was judged the larger risk.

The gated audit behind all of this, with its pinpoints and its expressly
recorded silences, is the 2026-09-22 answer on Book of Authorities content
by kind (R. 27), filed in `Engineering/bcca-appeal-books-inputs/`. One
question it flagged and did not decide: the completion instructions require
"the complete authority, not just case excerpts/headnotes", which is drafted
in case vocabulary and is unresolved for an Act or a treatise. The emitter
only names parts; what a part file contains is settled at assembly.

**What a part contains (#848).** A `case` part is the complete decision,
under the completion instructions quoted above. For the other kinds the book
carries, the rules below are **the practitioner's decision of 2026-09-22,
not a requirement of BC Reg 120/2022 or of the completion instructions**. The
audit found no source that says how much of an Act or a treatise a part
holds, and a registry inquiry has been drafted: the 2026-09-22 draft registry
inquiry (Book of Authorities content by kind), in the same folder as the audit. These rules stand until the registry
answers, and could be reversed without contradicting any authority.

| Kind | The part contains | Relation to the factum's text |
|---|---|---|
| `statute`, `regulation` | The whole enactment, as a copy from BC Laws (or Justice Laws for a federal enactment), in the version the practitioner confirms matches the factum's Appendix: Enactments excerpt | The Appendix: Enactments excerpt appears in the part verbatim, as a subset. The appendix stays excerpt-only |
| `doctrine` | The title page, the publication-details page (edition, year, publisher), and the whole section or chapter containing each cited page | The factum has no doctrine appendix. Any passage Part 3 quotes appears in the part verbatim |

The practitioner supplies every part as a PDF, and assembly binds it page for
page. The pipeline never types a part's text itself, so no part on the filed
face is a reproduction the pipeline composed. There is no per-authority
setting: the practitioner's choice of file is the only lever, and a schema
flag could not check a PDF's contents anyway.

## Body

No body content — `bcca-book.md` is frontmatter-only. (Unlike
`form-32.md`/`form-33.md`, there is no paragraph prose to carry; every
field above is structured.) The validator rejects any non-blank line
after the closing `---`.

## Refusal conditions (emitter-side, before a `bcca-book.md` is ever produced)

The emitter refuses — returning a `bundle_outdated`-shaped envelope with
a `note` naming the missing field, never emitting a partial file — when:

- the filing's kind is neither `bcca_stay_response` nor `bcca_factum`
  (the message names both accepted kinds);
- `file_number`, `registry`, or `short_style` cannot be composed (the
  proceeding or its parties are missing required fields);
- fewer than two party groups exist (an appeal needs both an appellant
  and a respondent side);
- any party group has no corresponding `contacts` entry;
- the database is ahead of the installed bundle's schema (same
  `bundle_outdated` shape as `emit_form32`/`emit_form33`).

`under_appeal_*`, `access_restrictions`, `filing_party_phrase`, and a
group's `lower_court_role` are optional and never refuse — they are
omitted or rendered blank per the field table above.

## Validator error codes (`scripts/fill_book.py --validate`)

Every run prints one JSON line: `{"success": true}` on a clean pass, or
`{"success": false, "error": "<code>", "detail": "<human-readable>"}` on
rejection. Codes (extend this table, never redefine one already listed):

| Code | Meaning |
|---|---|
| `missing_frontmatter` | no `---`-fenced frontmatter block found |
| `unknown_key` | a frontmatter key not in the table above |
| `duplicate_key` | a frontmatter key repeated |
| `missing_required_key` | a `yes`-required key absent |
| `partial_response_book` | some of the four `response_book_*` keys present and some absent; the detail names which are which |
| `invalid_json` | a JSON-typed key's value does not parse |
| `bad_toc_row` | a `response_book_toc`/`boa_toc` entry missing a required field, carrying an unknown one, or with a wrong-typed `text`/`authority`/`citation` |
| `bad_indent` | a `response_book_toc` row's `indent` is not `0`/`1`/`2` |
| `bad_party_group` | `party_groups` is empty, or an entry is missing `role`/`names`, carries an unknown key, or has an empty `role`/`names` |
| `bad_contact` | a `contacts` entry is missing `role`/`names`, carries an unknown key, or `contacts` does not have one entry per `party_groups` entry in the same order (length or `role` mismatch) |
| `bad_access_restrictions` | `access_restrictions` is present but is not a non-empty JSON array of non-empty strings |
| `nonblank_body` | non-whitespace content after the closing `---` |
| `bad_parts` | a `response_book_parts`/`boa_parts` value is not an array of `{"bookmark": "<non-empty text>"}` |
| `bad_part_ref` | a TOC row's `part` is not a valid index into its parts array, `"cover"`, `"toc"` or `null` (a row without `part` is `bad_toc_row`) |

## CLI acceptance oracle

`fill_book.py --validate <path>` mirrors `harness.py validate32`'s role:
no session, no output file, exit 0 on pass. It is the acceptance oracle
for the emitter's own test suite (`plugins/litigation/mcp/test/`) —
proving the TypeScript emitter's output against this Python validator
without coupling the two pipelines at runtime, the same decoupling
`assembly-input-contract.md`'s `validate32`/`validate33` already
establish for Form 32/33.

A fill writes a taken name at the next ` vN` and adds `versioned_from` to that document's line.

## Binding

Combining a book into its filed PDF (the paginator manifest and the manifest
builder) is `/assemble` with `assemble-bcca-book`; its contract is
`assemble/subskills/assemble-bcca-book/references/book-binding-contract.md`.
