# Validation procedure

Follow these steps in order. Do not proceed to `subskills/assemble-affidavit/references/assembly.md` until
step 7's gate passes.

## 1. Extract affidavit body

Run (via Bash): `pandoc <affidavit.docx> -t plain`

Search the plain-text output for exhibit references using these regex
patterns (case-sensitive on "Exhibit"):
- `attached as Exhibit [A-Z]`
- `attached hereto and marked as Exhibit [A-Z]`
- `is attached as Exhibit [A-Z]`
- bare `Exhibit [A-Z]`

For each reference, capture:
- `letter` — the exhibit letter
- `paragraph` — the paragraph number it appears in
- `description` — the full sentence/clause describing the exhibit

If the body references no exhibits at all — an affidavit of service proving
service of already-filed documents has none — skip the rest of this procedure
and assemble with `"exhibits": []`.

Then apply judgment (not scripted) to extract key terms from each
description, in these categories:
1. **Dates** — `(January|...|December) DD, YYYY` style
2. **Dollar amounts** — `$[\d,]+(\.\d{2})?`
3. **Document-type keywords** — promissory note, amending agreement, share
   purchase agreement, demand, notice of default, confirmation, employment
   agreement, spreadsheet, letter, termination, invoice, etc.
4. **Proper nouns / entity names**
5. **Sender/signatory names**

Classify each extracted term as:
- **identity** — the document's own defining attribute (its own date,
  title/type, signatory, unique dollar amount)
- **context** — a reference to some *other* document's date/amount

Heuristic: the first date mentioned in a description is usually the
document's own (identity) date; later dates mentioned are context
references to other documents. Prefer specific, discriminating terms over
generic ones.

Build a `descriptions` JSON array:
```json
[{"letter": "A", "paragraph": 3, "description": "...",
  "identity_date": "June 1, 2024", "identity_terms": [...],
  "context_terms": [...], "key_terms": [...]}]
```
`key_terms` is the union of `identity_terms` and `context_terms` — this is
what `match_exhibits.py` scores against.

## 2. Inventory + format gate

Run `subskills/assemble-affidavit/scripts/inspect_exhibits.py` with input:
```json
{"exhibit_dirs": ["<dir>", ...], "exhibit_files": ["<source-named pdf>", ...], "png_out_dir": "<scratchpad>/ocr_png"}
```

Before using any extracted text, enforce the format gate on the output:
- The affidavit must be `.docx` (already checked in STATE 0).
- Every exhibit must be `.pdf`. If any exhibit file matched to a letter is
  not a PDF, abort: "These exhibits must be converted to PDF before
  assembly: `<list>`."
- If both a PDF and a non-PDF file exist for the same letter, the script
  already silently prefers the PDF — this is not a gate failure, just note
  it if relevant.

## 3. OCR pass

For every file the script classified `SCANNED`, it rendered pages 0–1 to
PNG under `png_out_dir` (paths in that file's `png_paths`). Read those PNGs
with the Read tool and extract identifying info: date, title/type, dollar
amounts, party/signatory names.

If you can read something useful, reclassify that file's `classification`
to `TEXT_OCR` in the JSON you build for step 4, and set its `page1_text` to
what you extracted. If nothing useful can be read, leave it `SCANNED` (it
still passes the gate later, just flagged unverified in the report).

## 4. Match

Build the input for `subskills/assemble-affidavit/scripts/match_exhibits.py`:
```json
{"descriptions": [...from step 1...],
 "files": [...from step 2/3, with page1_text/file_own_date/classification...]}
```
Run it. It returns per-exhibit `assignments` with `status` in one of:
`CONFIRMED`, `CONFIRMED (OCR)`, `MISLABELED`, `WEAK`, `UNVERIFIED`,
`MISSING` — plus a `rename_mapping` for any `MISLABELED` exhibits.

## 5. Report format

Present a table with one row per exhibit letter:

| Marker | Status |
|---|---|
| ✓ | CONFIRMED / CONFIRMED (OCR) |
| ⚠ | WEAK / UNVERIFIED / CONFIRMED with `file_letter` null (content only) |
| ? | MISLABELED |
| ✗ | MISSING |

Columns: marker, exhibit letter, file matched, score.

If any `MISLABELED` exhibits are present, show the rename mapping table
(current name → correct name, reason: which description it matched).

If any file had a `pre_existing_stamp`, note it will be overwritten/removed
during assembly.

Flag any `UNVERIFIED` exhibit that came from the SCANNED leftover-by-letter
assignment as "position-based, not content-verified."

## 6. Rename decision

If `rename_mapping` is non-empty, ask the user per `/show-me`, as one
plain-text question ending the turn, with options:
- "Yes, rename files" → invoke `subskills/assemble-affidavit/scripts/rename_exhibits.py` with the
  mapping (never use bash `mv`/`cp`/`shutil` directly on exhibit files).
- "No, I'll fix manually" → stop here, do not assemble.
- "Skip renames, proceed anyway" → proceed with files as-named, carry the
  mismatch warnings forward into the assembly report.

## 7. Gate rule

A zero-exhibit affidavit passes this gate on step 1's finding alone.

Proceed to `subskills/assemble-affidavit/references/assembly.md` only if every exhibit's status is one
of: `CONFIRMED`, `CONFIRMED (OCR)`, `WEAK`, `UNVERIFIED`. If any exhibit is
`MISSING`, present the gap to the user and ask whether to proceed without
it or stop. Do not load `assembly.md` before this gate passes.
