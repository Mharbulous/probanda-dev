# Assembly input contract — `form-32.md` / `form-33.md` / `affidavit-<document_id>.md` (SSOT)

This file is the single source of truth for the interchange contract between a
drafting pipeline and this skill's three strict assembly operations:

| Operation | Input file | Output |
|---|---|---|
| `asm32` | `form-32.md` | Notice of Application (Form 32) `.docx` |
| `asm33` | `form-33.md` | Application Response (Form 33) `.docx` |
| `asmaff` | `affidavit-<document_id>.md` | Affidavit (Form 109) `.docx` |

The parsers at `scripts/steps/asm32/common.py::parse_form32` and
`scripts/steps/asm33/common.py::parse_form33` *implement* this contract and
hard-reject on any violation; this document *owns* it. Do not restate the
validation rules in style guides, docstrings, or other skills — point here.

**Caller (2026-08-27):** `/draft` — its
deterministic filed-face emitters produce these files from the submission
database. The former callers (`/prepare-application` for `asm32`,
`/responding-to-applications` for `asm33`) are retired.

## Division of discipline

- **The validator owns format.** `asm32`/`asm33` reject any deviation from the
  grammar below with the exact error, before anything is filled. They know
  nothing about where the content came from and must never learn any drafting
  pipeline's database shape.
- **The emitter owns filed-face content.** The input file is a **filed face**,
  not a review surface: it must contain only what may reach the court.
  Concretely, the emitter — a deterministic renderer on the drafting-pipeline
  side, never a hand- or LLM-authored file — must:
  - omit any order the practitioner has crossed out, renumbering the remaining
    orders contiguously;
  - omit every work marker, reserve annotation, and mockup-only decoration.
    The grammar's markdown-subset rejection mechanically blocks most marker
    *syntax* (bold, tables, headings), but a plain-text or emoji marker would
    parse — the emitter, not the validator, is the marker fence.

  Review happens on the drafting pipeline's mockup before the emitter runs;
  by the time a `form-32.md`/`form-33.md` exists, its content is
  filing-ready, unless the emit was lenient. A lenient emit (the publish
  route) prints a bracketed placeholder where data is missing; each is a
  warning in the publish sidecar (below) and on the document's NOT FINAL
  cover page, and the document is not filing-ready while one stands.

## Invocation

The caller writes the input file to the matter's substance folder,
`{case-data folder}/bcsc-form-substance/` (the constant location
`asm32.locate`/`asm33.locate` resolve), the case-data folder being the one
`coclerk.json`'s `case_data_dir` names. It then drives the shuttle protocol in
`SKILL.md`, passing that case-data folder and the Writing folder name at
init; the assembled `.docx` and its PDF land in the Writing folder under the
matter's draft folder:

- `asm32` runs only on an explicit `asm32` token in the init request — a
  practitioner's ordinary "assemble Form 32" stays on the lightweight
  Assemble path.
- `asm32` and `asm33` also read the emitter's publish sidecar,
  `form-32-publish.json` / `form-33-publish.json`, from the same substance
  folder (below). It carries the caption, court file number, applicant and
  affected-party names, and the document title, none of which is in the
  grammar. No blank-form Generate run is needed. The frontmatter overrides
  the sidecar's caption where both carry a value. A missing sidecar halts
  nothing: the caption fields print placeholders and the cover says why.
- `asm33` is the strict assemble path for Form 33.

Both sequences run locate → validate → transform → fill → verify, each step
in the harness itself with no subagent. A malformed file still halts at
validate. The fill puts the NOT FINAL cover page in front of the form while
any warning stands, and verify never halts once the file exists. The result
reports the rendered page count (the cover included) and PDF, `warnings`,
and `cover` (whether the document has one).

## `form-32.md` grammar

Frontmatter — flat `key: value` lines between `---` fences; unknown or
duplicate keys reject:

| Key | Required | Value |
|---|---|---|
| `proposed_hearing` | yes | verbatim string, the date, date range or assize the applicant proposes; fills "The applicant(s) propose(s) that the matter will be heard on …" (the notice itself fixes no hearing date). The emitter writes `[proposed hearing]` when none is recorded: a leave-blank the practitioner fills in Word |
| `hearing_place` | yes | string, the courthouse street address; fills "TAKE NOTICE that an application will be made … at the courthouse at …" |
| `registry` | yes | string, the proceeding's bare registry name, e.g. `Vancouver`; fills the style of proceeding's registry line as "Vancouver Registry". A value already ending in "Registry" is refused at fill |
| `time_estimate` | yes | string, e.g. `1 hour 30 minutes`; parsed into hours/minutes fields |
| `associate_judge` | yes | `yes` or `no`; selects "This matter is [not] within the jurisdiction of an associate judge." — never defaulted. A lenient emit writes a bracketed placeholder while the jurisdiction is not determined, and it prints in the sentence's place |
| `orders` | yes | JSON array of `{"order": <int>, "text": "<verbatim order sought>"}`, each entry optionally adding `"against": [<party name>, ...]`, a non-empty array naming the parties the order is sought against; non-empty; no other keys per entry |
| `pure_law_confirmed` | no | JSON `true`/`false` |
| `to_parties` | no | JSON non-empty array of names; fills "To:" in place of the Generate context's `to_affected_parties`. The emitter writes every party of record but the applicant(s) |
| `appendix_types` | no | JSON array of distinct Appendix box labels, exactly as the form prints them (`summary judgment`, `summary trial`, ...; `none of the above` excluded); checks those boxes, and an empty array checks "none of the above". Absent, every box stays unchecked |

Body — exactly one each of `## Part 2`, `## Part 3`, `## Part 4`, in that
order, nothing before the first heading:

- **Parts 2–3:** flat numbered paragraphs (`N. text`), strictly sequential
  starting at 1 and **continuous across the Part 2/Part 3 boundary**; `> `
  excerpt lines, `>> ` citation lines and `Nil.` allowed; only matched inline
  `*italics*` beyond plain text — no bold, subheadings, bullets, links,
  tables, or indented lists; no reference to a paragraph number not yet seen.
- **Blockquote lines (Form 32 only):** a `> ` line is a line of quoted
  excerpt, filled in the template's `Excerpt` style (left-aligned, indented).
  A `>> ` line is the citation of the excerpt above it, filled in `Citation`
  (right-aligned). In Part 2, a `>> ` line is an evidence reference naming
  the document and pinpoint ("Affidavit #2 of <deponent>, at paras 2-4;
  Exhibit A") and is filled in `EvidenceRef`.
- **Italics (Form 32):** the fill turns every `*text*` span, in any Part,
  into an italic run with no asterisks. The emitter wraps each authority name
  the drafting database holds (case names and statute, regulation and rule
  titles) in `*…*` wherever it appears in Parts 2–4, excerpts and citations
  included.
- **Part 4:** a flat `- ` dash list, or `Nil.`.
- An empty Part 2 (`Nil.`) requires `pure_law_confirmed: true` — the pure-law
  posture is affirmatively asserted, never defaulted into.

Transform: Part 1 renders from `orders` (verbatim text, numbered by `order`
ascending); the hearing scalars fill the notice preamble, `registry` fills the
style of proceeding, and `associate_judge` selects its jurisdiction sentence. Advisory (never
rejecting) warnings flag a body likely exceeding the 10-page cap and a
`time_estimate` over 2 hours.

An order with `against` prints its text with "(against <names>)" before any
closing punctuation. The estimate prints as written ("30 minutes", "1 hour 30
minutes"). Part 4 identifies each affidavit as "Affidavit #<n> of <name>, made
<Month D, YYYY>"; the emitter writes `made [date]` when it holds no made date.

After the fill, `shared.verify` runs the Form 32 conformance checks named in the
"Form instructions" table of `/publish`'s identity file for this form
(`references/CAN/BC/BCSC/Documents/notice-of-application.md`). Each failure is a
`verify_warnings` entry on `done`, such as an order naming no party it is sought
against, a Part 4 affidavit without its made date, or an Appendix with no box
checked. None of them rejects.

## `form-33.md` grammar

Frontmatter — same mechanics:

| Key | Required | Value |
|---|---|---|
| `notice_filed` | yes | verbatim string (the "THIS IS A RESPONSE TO … filed [date]" line) |
| `time_estimate` | yes | string, as for Form 32 |
| `orders` | yes | JSON array of `{"order": <applicant's filed order number>, "position": "<consent\|oppose\|no-position>", "terms": "<string>"}`; non-empty; exactly those three keys per entry |
| `pure_law_confirmed` | no | JSON `true`/`false` |

`terms` is consumed only on a `consent` position (an empty string falls back
to `Order N`); it is carried, unused, on the other positions.

Body — exactly one each of `## Part 4`, `## Part 5`, `## Part 6`, same
paragraph discipline as Form 32 (continuous numbering across Parts 4–5;
Part 6 is the dash list; empty Part 4 requires `pure_law_confirmed: true`).

Transform: consent orders' terms render as "ORDER(S) CONSENTED TO"; opposed
and no-position order numbers fill the template's number-list fields.

## Publish sidecar (`form-32-publish.json` / `form-33-publish.json`)

Written by `drafting_forms__emit_form32` / `emit_form33` beside the substance
file (given `case_data_folder`; otherwise returned as `publish_json`). One
JSON object:

- `caption`: the template context keys a Generate run used to collect, read
  from the drafting database: `court_file_number`, `registry`,
  `court_location`, `plaintiff_caption`, `plaintiff_role`,
  `defendant_caption`, `defendant_role`, `additional_captions`,
  `correction_required` (empty: the emitter's party drift gate passed),
  `client_name`, `lawyer_name`, `applicant_names`, `to_affected_parties` and
  `title` (the Writing's title, which names the `.docx`). A value the database
  does not hold is `null`.
- `warnings`: `[{"kind", "field_or_id", "message"}]`, `kind` one of
  `missing_datum` (information the form needs and the database does not
  hold), `unmet_criterion` (a completion criterion unmet or not yet derived,
  read as `drafting_forms__board_card`'s criteria lane reads it, with its
  counts, and each open step of the pre-filing gate) or `other` (an unplaced
  fact, an item counsel suppressed, a line the session adds such as the
  practitioner's words asking for the document).

`asm32`/`asm33` add a `missing_datum` warning for each caption field they
print as the template's own placeholder, and an `other` warning for each
unfilled placeholder left in the filled document. A bracketed token on a
quoted (`> `) line, a law-report year such as `[1903]`, a leave-blank token
and a placeholder some warning already names are not unfilled placeholders.

The cover page is page 1, a section of its own headed "NOT FINAL - DO NOT
FILE", with three numbered lists: missing information, completion criteria
unmet or skipped, and other warnings. It is written whenever any warning
stands, and omitted only when there is none. It is derived, never stored, and
states no law and no deadline. Deleting its section leaves the form as filled,
numbered from page 1.

## `affidavit-<document_id>.md` grammar (`asmaff`)

Written by `drafting_forms__emit_affidavit` for a supporting affidavit of a
Form 32 or 33 `/draft` holds (golden:
`source/practice/mcp/test/fixtures/affidavit-emitted.md`). Parser:
`scripts/steps/asmaff/common.py::parse_affidavit`.

Frontmatter — exactly these three keys, each once, `key: value` with the
value taken verbatim after the first `: `:

| Key | Value |
|---|---|
| `deponent` | non-empty string; fills the identifier block and the opening sentence |
| `affidavit_number` | positive integer; rendered as the identifier block's ordinal (`1` → `1st`) |
| `exhibits` | JSON array of `{"letter", "label", "file_path"}`, letters `A`, `B`, `C` ... in order; `file_path` may be `null` and is not used by the fill |

Body — `N. text` paragraphs numbered from 1 without a gap, at least one.
Bold appears only as an exhibit reference, `**Exhibit "A"**`, and the letters
the paragraphs place, in first-appearance order, must equal the `exhibits`
letters. The paragraphs carry the preamble and every exhibit paragraph, so
the template's numbered paragraphs (its own preamble, its
`[[BLOCK:exhibit]]` paragraph and its empty last paragraph) are dropped. The
unnumbered "I, [DEPONENT NAME] of ... THAT:" line stays.

Invocation: init `asmaff <document_id>` (explicit token only), with the
package's Writing folder. The sequence is `asmaff.locate` (halts naming the
file when it is absent or invalid) → `gen.matter_profile` → `gen.scalars`
(every affidavit field but the deponent's name and the ordinal) →
`asmaff.fill` → `shared.verify`. The caption comes from the matter profile,
as for Generate. The `.docx` is named `Affidavit #<n> of <deponent>`.

## `validate32` / `validate33`

CLI subcommands (`harness.py validate32 <path>` / `validate33 <path>`) that
run the same parser with no session and no output file — exit 0 on pass,
non-zero printing the exact error. **Neither has a live caller at runtime**:
each pipeline delegates the whole `asm32`/`asm33` operation, which
hard-validates through the same parser. They are kept as the **acceptance
oracle for emitter test suites** — an emitter build proves its output against
them without coupling the two pipelines at runtime.
