---
name: assemble-general
description: >
  Binds a general Writing (a letter, a memo) into one PDF: its .docx first,
  then each enclosure in the order the practitioner names, a whole PDF, pages
  of one, a .docx or an image. Routed to by the explicit assemble-general
  token, or by a practitioner asking to print a letter or memo as a PDF, for
  signature or with its enclosures.
---

# Assemble General

Binds a general Writing whose `.docx` `/publish` with `publish-general` has already written. It runs only when the practitioner asks for the PDF, never as the end of a drafting job. With no enclosures it is the Writing's PDF alone.

Depends on `assemble/subskills/assemble-bcca-book/scripts/paginate_book.py` for the .docx conversion (Word, LibreOffice fallback), which needs lxml, and on PyMuPDF (`fitz`) for the merge.

## In Cowork

In Cowork (this host grants the data tools as `mcp__remote-devices__plugin_lawyer_data__<name>`), the sandbox has neither PyMuPDF nor Word, sees neither the matter folder nor the matter-data folder, and its Write tool writes into the sandbox, not the host (ADR 0027). Never run the binder in the sandbox shell, and never write `enclosures.json` with the Write tool. Run steps 1 and 2 for their checks and the practitioner's answers, but save nothing. In place of writing `enclosures.json` and of step 3, call `drafting_forms__assemble_general` with:

- `matter_root`: the matter folder's absolute host path. The server finds the matter-data folder from the matter's `probanda.json` itself and never opens the drafting database, so do not call `drafting_forms__open_session` for a bind: it can migrate the database and raise counsel refusals that have nothing to do with the bind (#1427)
- `docx_name`: the bare file name of the deliverable `publish-general` reported, at the top of the draft folder
- `pdf_name`: only after an `output_exists`, the next free ` vN UNSIGNED.pdf` name; left out, the PDF is the `.docx` name with ` UNSIGNED.pdf`
- `enclosures`: step 2's list in the letter's order, each `{label, path, pages}`, where `path` is the host path of the file the practitioner named (absolute, or relative to the matter folder) and `pages` is left out for the whole file

The tool binds any file named, from anywhere on the PC: the safeguard is the lawyer's own review and signature, not a folder rule (ADR 0027). So name only the files the practitioner identified, and prefer an enclosure's PDF where one exists, since each `.docx` enclosure is another Word conversion within the tool's 55 s budget. A refusal with a server code (`path_out_of_scope`, `invalid_root`, `case_data_missing`, `draft_dir_missing`, `draft_dir_ambiguous`) comes before anything is written: tell the practitioner and stop. After that, the server's refusals end, and the binder's refusals and its success come back exactly as step 3 describes, so a session may see one kind and then the other. On `python_timeout`, do what the error says. On success the session cannot open the PDF: report its path, page count and bookmark count, and tell the practitioner to open and review it before signing.

## 1. Locate the Writing

The `.docx` is the deliverable at the top of the draft folder, resolved by glob per the workspace output rule (`source/skills/shared/workspace-output-rule.md`): the `deliverable` path `publish-general` reported, else ask the practitioner which file. Never bind its review copy, `<name> (format unverified).docx`. The working folder is `<matter-data folder>\assemble-general\`, the matter-data folder being the one `probanda.json`'s `case_data_dir` names; create `assemble-general\` if it is absent.

## 2. Name the enclosures

Ask which file is each enclosure, in the order the letter lists them, offering the letter's Encl. items as the labels. An enclosure is a PDF, a page or range of pages of one (for an email already printed into an earlier letter's PDF), a `.docx` or an image. An email file (`.eml`, `.msg`) is not bound: ask for it printed to PDF, or for the PDF page that holds it. If the enclosures differ from the letter's Encl. line, in number or in what they are, say so before binding.

Record the answers in `enclosures.json` in the working folder, rewritten on each run:

```json
{
  "docx": "<matter>/0. DRAFT/2026-10-01 LT LiL re smoke reports.docx",
  "output": null,
  "enclosures": [
    {"label": "Letter of September 22",
     "path": "<matter>/0. DRAFT/2026-09-22 LT LiL re smoke reports UNSIGNED.pdf",
     "pages": "4"}
  ]
}
```

`pages` is one page (`"4"`) or a range (`"2-5"`), counted from 1, and is left out for the whole file. `output` defaults to the `.docx` name with ` UNSIGNED.pdf`, the firm's mark for a PDF awaiting signature. When that name is taken, set `output` to the first free ` vN UNSIGNED.pdf` name, per that rule.

## 3. Bind

Run the binder from `/assemble`'s own folder: in a repo checkout, from the repo root as `python source/skills/assemble/subskills/assemble-general/scripts/bind_general.py`. It needs PyMuPDF and Word or LibreOffice, so this step runs on the PC only. In Cowork, call the host tool instead (In Cowork, above).

```
python bind_general.py --manifest "<working folder>/enclosures.json"
```

It prints one JSON line, and it checks every enclosure before it binds anything. `enclosure_unresolved` lists every enclosure it cannot bind and why: show the practitioner that whole list at once and stop. An enclosure is never bound around or skipped. `docx_conversion_failed` names why Word and LibreOffice each failed; no PDF is written. `output_exists` means the name is taken: rerun with the next free ` vN UNSIGNED.pdf` name.

On success it reports the output path, the page count and the bookmark count. Pages are appended untouched, with no separator pages; the PDF's bookmarks name the Writing and each enclosure. Present the PDF as a file card (`shared/present-files.md`).

## Boundaries

- Do not draft or revise the Writing -- that is `/draft`. Do not render its `.docx` -- that is `/publish` with `publish-general`.
- Never edit the `.docx` or an enclosure. Sending the Writing, and recording it as sent, is the practitioner's.
