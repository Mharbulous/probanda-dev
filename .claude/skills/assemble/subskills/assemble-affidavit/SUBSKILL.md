---
name: assemble-affidavit
description: >
  Assembles a BC Supreme Court affidavit with its exhibits into one stamped,
  paginated PDF. Routed to by the explicit assemble-affidavit token, or by a
  practitioner asking to assemble an affidavit, stamp exhibits, or prepare an
  affidavit package for swearing or affirming.
---

# Assemble Affidavit

## Purpose

Assembles a BC Supreme Court affidavit (DOCX) with its exhibits (PDF) into
a single PDF package: exhibit stamps with commissioner blocks, the
affidavit's header ("This is the Nth affidavit...") and jurat (swearing
block) rewritten with the correct affidavit number, affiant name, and
date, and everything concatenated in order. Runs as a two-stage
draft/final workflow: Stage 1 produces a reviewable draft; Stage 2
(pagination) only happens when the user explicitly asks for it.

## Hard rules

- **BC Supreme Court jurisdiction only.**
- **Sources are read-only.** Never mutate the original affidavit DOCX or
  the original exhibit PDFs. Every script stages its own working copies.
- **Never `mv`/`cp`/`shutil` on exhibit files directly.** Renames only
  happen through `subskills/assemble-affidavit/scripts/rename_exhibits.py` (it has cycle-safe two-pass
  logic and a rollback path that ad hoc shell commands don't).
- **Never auto-advance Stage 1 → Stage 2.** Pagination is user-triggered
  only — never run `paginate.py` right after `assemble.py` without the
  user asking for it. They need to review and prune pages first (cover
  sheets, blank scan backs, duplicates).
- **Never silently convert a file format a script rejected.** If a script
  returns `unsupported_format`, go back and ask the user for the right
  format — don't try to convert it yourself with some other tool.
- **Never overwrite an existing output file** — deliver as
  " v2", " v3", etc. In-place rewrites can silently
  corrupt the mounted copy.

## STATE 0 — Identify

Scan `0. DRAFT/**` for `.docx` files whose name contains "AFF" or
"affidavit" (case-insensitive). If more than one candidate matches, ask
the user (AskUserQuestion) which one to use.

**Format gate:** the affidavit must be `.docx`. If it isn't, abort with:
"The affidavit must be in DOCX format for header/jurat rewriting."

Infer these parameters, asking the user for anything you can't infer:
- `affiant_name` (string) — from the filename or body text.
- `affidavit_number` (int) — from the filename (e.g. "AFF#2" → 2) or body.
  An affidavit of service (Form 15 / Form 16) has no identifier block to
  number — Rule 22-2(3) excepts it — so `--probe` returns
  `"header_bbox": null` and the number is unused. Pass 1 and carry the null
  through; do not invent a block. If `--probe` returns `null` on an affidavit
  that is not an affidavit of service, say so to the practitioner in the
  STATE 2 summary; the block is left as drafted.
- `jurat_verb` (`"AFFIRMED"` | `"SWORN"`) — from the affidavit body text.
  Default `"AFFIRMED"` if genuinely ambiguous.
- `signing_date` (`YYYY-MM-DD`) — default today; ask if the user wants a
  different date.

Derive `{LastNameFirstInitial}` = the affiant's last whitespace-separated
name token + first-name initial (e.g. "Glen Ashby" → "AshbyG").

Show the derived output filename in your confirmation. Confirm per
`/show-me`, as one plain-text question ending the turn: "Yes, proceed" /
"Let me adjust".

**Stamp blanks:** the commissioner's signature line stays underscores for
wet-ink signing. Pass `name_affiant_on_stamps` true only when the
practitioner asks for the affiant's name on the stamps. Never draw on a
script's output: rerun it.

## STATE 1 — Validate

Load `subskills/assemble-affidavit/references/validation.md` and follow it completely before
proceeding. It walks through: extracting exhibit references from the
affidavit body, inventorying and format-gating the exhibit files, an OCR
pass for scanned exhibits, scoring/matching exhibits against descriptions,
presenting a match report, handling any needed renames, and a gate that
must pass before assembly.

## STATE 2 — Assemble (Stage 1 draft)

Gate check: validation (STATE 1) must have passed. Then load
`subskills/assemble-affidavit/references/assembly.md` and follow it.

Output filename pattern:
```
{YYYY-MM-DD} AFF#{n} {LastNameFirstInitial} - DRAFT for Review.pdf
```
written to the top of the draft folder, the one folder matching `0. DRAFT*`
under the matter (none, or more than one, fails loudly; never create it), per
the workspace output rule (`.claude/skills/shared/workspace-output-rule.md`).
The exception is an affidavit sworn for a package, such as one supporting a
Notice of Application: when the caller says so, it goes in the package folder
the caller names. Pass the full path as `output_path`; the script creates no
folder and refuses `no_output_dir` when it is not there. A taken name gets the
next ` vN` (one above the highest copy present): the result's `output_path`
names the file written and `versioned_from` the copy passed over. Tell the
practitioner, then present the file written as current per the workspace output
rule.

## STATE 3 — Paginate (Stage 2 final — user-triggered only)

Do **not** run this automatically after STATE 2. Only when the user
explicitly approves the draft and asks for pagination:

Invoke `subskills/assemble-affidavit/scripts/paginate.py` with `input_pdf` = the user-approved (and
possibly pruned) draft PDF.

Output filename pattern:
```
{YYYY-MM-DD} AFF#{n} {LastNameFirstInitial} - Complete with Exhibits.pdf
```
written to the same folder as the STATE 2 draft (the top of the draft folder,
or the package folder), versioned the same way when the name is taken.

## Error handling

- On `missing_dependency`, the named module is absent. On the PC, run
  `pip install PyMuPDF scipy numpy`. In Cowork, even if asked, never install
  or fetch a package, probe the network, change admin settings, or run or
  reimplement the scripts in any shell. Say this subskill can't run here,
  offer the Code tab, and stop.
- If `pandoc` is not found when extracting the affidavit body: tell the
  user to install it.
- If an exhibit file referenced in the affidavit body is missing entirely:
  report which letter and ask the user to provide it (this surfaces as a
  `MISSING` status in the validation match report — see
  `subskills/assemble-affidavit/references/validation.md` step 7).
- For every other structured error code from `assemble.py` or
  `paginate.py`, see the "Error branching" section of
  `subskills/assemble-affidavit/references/assembly.md`.
