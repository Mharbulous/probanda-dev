# Assembly procedure (Stage 1 — draft)

Sources are read-only. Do not pre-convert or pre-stamp anything yourself —
`subskills/assemble-affidavit/scripts/assemble.py` copies the affidavit and every exhibit into its own
scratch directory and does all mutation there. The originals are never
touched.

## 1. Coordinate discovery

Run:
```
python subskills/assemble-affidavit/scripts/assemble.py --probe <affidavit.docx path>
```
This converts the DOCX to PDF in a scratch directory (Word COM first, then
`soffice` if Word/PowerShell fails) and returns:
```json
{"success": true, "header_bbox": [x0, y0, x1, y1], "converted_pdf": "<scratch path>"}
```
`header_bbox` is computed from `page.get_text("words")` on page 0, keeping
only words with `y0 < 150` on lines "This is the" to "made on". On each line
only the run of words ending rightmost counts: a gap of more than 18pt between
neighbouring words ends a run, so a label at the left on the same baseline is
excluded however far left the longest identifier line reaches. A baseline
whose run does not overlap the first line's horizontally (a left-margin label
between the identifier lines) is skipped. The bbox is those words' min/max
extent padded 5pt on every side.

**The header check recognises Form 109's wording only.** Rule 22-2(3) requires
the top right hand corner of the first page of an affidavit *other than an
affidavit of service* to set out the affiant's name, the sequential number of
that affiant's affidavit in the same proceeding, and the date the affidavit was
made. R. 22-2(2)(d) makes Form 109 permissive, so a compliant affidavit could
state those items in other words. This pipeline does not try to recognise them:
every affidavit it admits is the firm's own, drafted on the LEAP or `/publish`
Form 109 template, and `rewrite_header` re-renders the block in Form 109
wording. `--probe` therefore looks for "This is the … affidavit … made on" and returns

```json
{"success": true, "header_bbox": null, "converted_pdf": "...", "note": "..."}
```

when it is absent. Forms 15 and 16 carry no block at all, so for them pass the
`null` straight through: the header pass is skipped and the run reports it in
`warnings`. For any other affidavit a `null` means the block was not
recognised. Still pass the `null` (never hand-build a bbox), but tell the
practitioner that the top-right block was left exactly as drafted and that its
number and date need a manual check on the draft.

The check is by content, not position, because the same top-right region holds
the court file number and the registry. A bbox computed there without it would
redact the style of proceeding — so `rewrite_header` independently refuses a
bbox that touches any word outside the identifier block's runs, or that cuts
through an identifier line it touches (which would leave fragments of the old
line beside the redrawn one), returning
`{"error": "header_bbox_not_identifier_block", "found_text": "..."}`.

The scratch `converted_pdf` is left in place (not cleaned up) so you can
either:
- pass it back as `affidavit_pdf` in the main call (skips re-conversion), or
- pass the original `.docx` as `affidavit_pdf` along with the returned
  `header_bbox` (the main call will convert it again itself).

`jurat_bbox` is always the fixed value `[72, 325, 340, 370]`. This is
schema completeness only — `assemble.py` actually relocates the jurat by
text search (see below), not by this bbox. It always blanks the city
line to underscores even if pre-filled — flag that to the user first.

If `--probe` itself fails, it returns
`{"success": false, "error": "docx_conversion_failed", "detail": "..."}`.

## 2. Main call

Input JSON schema (all fields required; `header_bbox` may be `null`):
```json
{
  "affiant_name": "string",
  "affidavit_number": 2,
  "jurat_verb": "AFFIRMED",
  "signing_date": "2026-06-10",
  "affidavit_pdf": "path to .docx or .pdf",
  "header_bbox": [x0, y0, x1, y1],
  "jurat_bbox": [72, 325, 340, 370],
  "exhibits": [{"letter": "A", "path": "..."}],
  "name_affiant_on_stamps": false,
  "output_path": "..."
}
```
`header_bbox` is required but nullable — pass whatever `--probe` returned,
including `null` for an affidavit of service. Omitting the key entirely is a
caller error (`missing_field`), not a way to opt out: a forgotten header_bbox
on an ordinary affidavit must fail loudly rather than silently skip the
identifier rewrite.

Invoke: `python subskills/assemble-affidavit/scripts/assemble.py <path-to-input.json>` — write the JSON
to a scratchpad file and pass its path (stdin also works if no argument is
given, but a file path is preferred so the JSON is inspectable afterward).

On success, it returns:
```json
{"success": true, "output_path": "...", "page_count": N,
 "exhibits": [{"letter": "A", "pages": "12-15", "stamp_placement": "whitespace"}, ...],
 "warnings": [], "versioned_from": "..."}
```
`output_path` is the file actually written: the input's `output_path`, or its
next ` vN` when that name was taken, and then `versioned_from` names the copy
passed over (absent otherwise).
`stamp_placement` is `"whitespace"` (stamped in the exhibit's existing
clear space) or `"blank_page_inserted"` (a fresh blank page was inserted
and stamped instead, because the exhibit's first page was rotated, too
small, or had no clear window).

## 3. Error branching

Every failure is `{"success": false, "error": "<code>", ...}`:

- **`unsupported_format`** (`file` field names the offending path) — a
  non-PDF exhibit slipped past the validation.md format gate. Do NOT
  convert it yourself — go back to the format gate and ask the user for a
  PDF.
- **`bbox_validation_failed`** (`which: "header"` or `"jurat"`):
  - `which: "header"` → re-derive coordinates by re-running `--probe`.
  - `which: "jurat"` → `check` names the search that failed:
    - `"verb"`: no "{jurat_verb} BEFORE ME" on the jurat page. Usually
      `jurat_verb` doesn't match the body (`AFFIRMED` vs `SWORN`): fix it
      and retry.
    - `"city"` (no line below the verb) or `"date"` (no "day of" or
      "on <date>" line below the city line): report it, do not retry.
- **`header_bbox_not_identifier_block`** (`found_text` shows what the bbox
  actually covers) — the bbox does not sit over a Rule 22-2(3) identifier
  block. On a Form 15 or Form 16 that is expected: re-run `--probe` and pass
  the `null` it returns. Otherwise the coordinates are stale — re-probe.
  If re-probing returns `null` on a non-service affidavit, the block is not in
  Form 109 wording; report it, do not retry.
  Never widen the bbox to make this pass; the check exists because redacting
  the wrong region destroys the court file number and registry.
- **`missing_field`** (`field` names it) — a required key was absent. For
  `header_bbox`, pass `null` rather than omitting it.
- **`no_output_dir`** — `output_path`'s folder is not there. The script never
  creates one: check the draft folder path, or ask the caller for the package
  folder it meant.
- **`docx_conversion_failed`** (`detail` has both Word-COM and soffice
  failure messages) — neither Word nor LibreOffice could convert the file.
  Report this to the user; ask them to supply a pre-converted PDF affidavit
  instead, or install one of those tools.
- **`font_not_found`** (`role: "stamp"` or `"body"`) — no bundled or system
  font could be resolved. Tell the user which role failed.
- **`concat_failed`** / **`exhibit_open_failed`** / **`exhibit_empty_after_stamp_strip`**
  — report the `detail`/`file` to the user; these indicate a genuinely
  corrupt or unusual exhibit PDF that needs manual attention.
- **`unexpected_exception`** — anything unanticipated; `detail` holds the
  full traceback. Treat as a bug to report, not something to route around.

## 4. Delivery

Scan the draft for landscape exhibit pages and offer to rotate
them (header to the left edge).

The script writes the draft straight to its `output_path`:
```
<draft folder>/{YYYY-MM-DD} AFF#{n} {LastNameFirstInitial} - DRAFT for Review.pdf
```
or the same name in the package folder, as SUBSKILL.md STATE 2 resolves it.
Present the file it reports as written, naming any `versioned_from` copy, with
the validation summary (page count, per-exhibit
`stamp_placement`, any `warnings`). Remind them to review and prune pages
(cover sheets, blank scan backs, duplicates) before requesting pagination
(STATE 3 — user-triggered only, never automatic).
