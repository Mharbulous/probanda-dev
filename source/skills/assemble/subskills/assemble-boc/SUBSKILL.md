---
name: assemble-boc
description: >
  Binds a filled BC Supreme Court bill of costs, Form 62 or Form 63, into one PDF
  with its vouchers: the bill first, then one invoice or receipt per claimed
  disbursement in the bill's order, each bookmarked to its line. Routed to by the
  explicit assemble-boc token, or by a practitioner asking to bind a bill of
  costs or attach its receipts.
---

# Assemble Bill of Costs

Binds a bill `/publish` with `publish-boc` has already filled. Three steps, in
order, and the third never follows the second automatically: the practitioner
sees every unmatched line before anything is bound.

Depends on `assemble/subskills/assemble-bcca-book/scripts/paginate_book.py` for
the .docx conversion, and on PyMuPDF (`fitz`) for the merge.

## 1. Locate the bill

The working folder is `<matter-data folder>/bill-of-costs/`, the matter-data folder
being the one `probanda.json`'s `case_data_dir` names (in Cowork, request access
to that folder itself, never a parent or the firm root). The filled bill is the
`.docx` at the top of the draft folder, where `/publish` wrote it, the draft
folder resolved by glob per the workspace output rule
(`.claude/skills/shared/workspace-output-rule.md`): the path `publish-boc`
printed as written, else ask the practitioner which file. The bound PDF goes
beside it, at the top of the draft folder, as `<bill stem> - bound.pdf`.

The bound bill is the practitioner's saved PDF when there is one, and otherwise
the `.docx` converted here — this member converts it itself and never asks the
practitioner to export one by hand.

## 2. Gather the vouchers

Read the bill's disbursement lines from the working folder's context file, in the
order the bill carries them — `boc-context.json` for a Form 62 bill, or
`form63-context.json` for a Form 63 one, whose entries carry `amount` rather
than a date and a `claimed` figure. Ask for one invoice or receipt per line: file
cards, one per line, showing the line's description and claimed amount, and its
date where the form carries one, with an `.elicit-files` dropzone or a path for
each.

Record the answers in `vouchers.json` in the working folder:

```json
{
  "bill_docx": "<matter>/0. DRAFT/<stem>.docx",
  "bill_pdf": null,
  "output": null,
  "lines": [
    {"description": "Court filing fee — Notice of Civil Claim",
     "claimed": "200.00",
     "voucher": "<matter>/9. DISBURSEMENTs/2024-02-26 filing fee.pdf"}
  ]
}
```

`bill_docx` is the path `publish-boc` printed as written, which carries a
` vN` suffix when an earlier bill already held the name. Leave `output` null:
the binder names the bound PDF from the bill (`bill_pdf` when set, else
`bill_docx`) and writes it beside it.

A voucher may be a PDF, a `.docx` or a scanned image. A line with no voucher
carries `"voucher": null`.

## 3. Review, then bind

Run the binder from `/assemble`'s own folder: in a repo checkout, from the repo
root as
`python .claude/skills/assemble/subskills/assemble-boc/scripts/bind_boc.py`. It
needs PyMuPDF, so it runs on the PC only: in Cowork it refuses with
`missing_dependency` (Error handling, below).

```
python bind_boc.py --vouchers "<working folder>/vouchers.json"
```

It prints one JSON line, and it checks every line before it binds anything.
`voucher_unresolved` lists every line with no voucher recorded or a file that is
not there: show the practitioner that whole list at once and stop. A missing
receipt is never bound around and never silently skipped.

On success it reports the output path, the page count and the bookmark count. The
output is never overwritten: a taken name gets the next ` vN` (one above the
highest copy present), and `versioned_from` names the copy passed over. Tell the
practitioner, then present the output as current per the workspace output rule.
`no_out_dir` means the output's folder is not there; the binder never creates
it.

## Error handling

- On `missing_dependency`, the named module is absent. On the PC, run
  `pip install PyMuPDF`. In Cowork, even if asked, never install or fetch a
  package, probe the network, change admin settings, or run or reimplement
  the scripts in any shell. Say this subskill can't run here, offer the
  Code tab, and stop.

## Boundaries

- Do not draft, gather or total — those are `/calculate`'s bill-of-costs members.
- Do not fill the bill — that is `/publish` with `publish-boc`.
- Do not decide whether a disbursement is recoverable. This member binds what the
  bill claims; what the bill claims was settled at gathering and review.
