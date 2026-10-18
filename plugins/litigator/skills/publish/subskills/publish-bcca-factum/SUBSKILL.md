---
name: publish-bcca-factum
description: >
  Renders a BCCA respondent's factum as one filing-ready .docx, filled into
  the court's own respondent's factum template from a bcca_factum filing's
  stored data. Routed to by the explicit publish-bcca-factum token, or by a
  practitioner asking to turn a ready factum mockup into the actual court
  document.
---

# Publish BCCA Factum

Turns a BCCA respondent's factum's stored data into one court-ready `.docx`:
the court's template with its cover, chronology, opening statement, Parts
1–4, List of Authorities and Enactments filled, and its instruction tables
removed. `/draft` elicits the substance and shows the
practitioner the `Factum.md` mockup; this subskill runs once that mockup is
filing-ready.

## What this produces

`<name>.docx` at the top of the draft folder, the one folder matching
`0. DRAFT*` under the matter; none, or more than one, fails loudly. `<name>`
is the stem step 6 composes. Word refreshes its table of contents and the
List of Authorities' page numbers when it is opened.

## In Cowork

In Cowork (this host grants the data tools as
`mcp__remote-devices__plugin_lawyer_data__<name>`), the sandbox sees
neither the matter folder nor the case-data folder, and the Write tool writes
into the sandbox, not the host (ADR 0026). Never run the fill in the sandbox
shell, and never use the Write tool for `bcca-factum.md`. Run steps 1, 2, 3
and 6, then, in place of steps 4, 5 and 7, call
`drafting_forms__publish_bcca_factum` with:

- `matter_root`: the matter folder's host path, as
  `drafting_forms__open_session` takes it
- `db_path`: step 1's database path
- `filing_id`: the factum filing
- `output_name`: step 6's stem
- `dated_on`: step 3's date, `YYYY-MM-DD`

The server calls the emitter, writes `bcca-factum.md` verbatim in the real
`{case-data folder}\bcca-factum-substance\`, validates it, fills the factum
into the real draft folder and returns the JSON line unchanged. Step 7
reads it as it reads the fill's. Relay any refusal verbatim, whether the
emitter's (what is missing), the fill's, `path_out_of_scope` or
`python_timeout`: its message says what to do next. Do not look for the files
in the sandbox: the tool's result is the check, and the file card names the
host path it returns.

## Steps

1. **Resolve the database.** Invoke `/drafting-data` to resolve `db_path`
   for the current matter, following its own Configuration section.

2. **Confirm the filing.** The filing must have `kind = 'bcca_factum'`. If
   the request names a filing of any other kind, say so and stop.

3. **Get the date.** Ask the practitioner the date the factum is to be
   dated, unless they already gave it. It is never stored.

4. **Call the emitter.** Call `drafting_forms__emit_bcca_factum` with the
   filing and `dated_on` (`YYYY-MM-DD`). This is the only permitted way to
   produce a `bcca-factum.md` -- never hand-author or patch one. If it
   refuses (`bundle_outdated`, or an error naming what is missing), tell the
   practitioner plainly what is missing and stop.

5. **Write the interchange file.** Write the returned markdown **verbatim,
   byte-for-byte** to
   `{case-data folder}\bcca-factum-substance\bcca-factum.md`
   with the first-class Write tool, never sandbox bash (mount-staleness bug,
   [#324](https://github.com/Mharbulous/CoClerk/issues/324)). The case-data
   folder is the one `probanda.json`'s `case_data_dir` names. It must already
   exist: if it does not, stop and tell the practitioner to run `/matter-data`
   initialize; never create it. Create the `bcca-factum-substance` folder
   if it doesn't exist.

6. **Name the output.** The factum is an individual document: it goes at the
   top of the draft folder, never in a Writing folder under it. Compose the
   stem from the factum under `/file-naming`'s grammar (no ` vN`, no
   extension) and run its gate on it. On a fail, or a date or code you
   cannot pin down, ask the practitioner; never fall back to the title.

7. **Validate, then fill.** Resolve `subskills/publish-bcca-factum/scripts/fill_factum.py`
   from `/publish`'s folder: in a repo checkout run
   `python .claude/skills/publish/subskills/publish-bcca-factum/scripts/fill_factum.py`
   from the repo root (in Cowork, never run it: call the host tool instead,
   as "In Cowork" above says). Then run:

   ```
   python fill_factum.py --validate bcca-factum.md
   python fill_factum.py bcca-factum.md "<draft folder>" --out-name "<stem>"
   ```

   Each call prints one JSON line (`subskills/publish-bcca-factum/references/bcca-factum-contract.md`). A
   rejection means the emitter produced a file that breaks the contract:
   report the code and detail as a defect and stop; never edit
   `bcca-factum.md` and retry. A taken name gets the next ` vN`;
   `versioned_from` names the copy passed over. Tell the practitioner, in
   case it is another Writing's, then present it (`shared/present-files.md`) as current per the
   workspace output rule.

8. **Present the result.** Present the `.docx` as a clickable file card (`shared/present-files.md`).
   Tell the practitioner to let Word update the fields when it asks, check
   the page count of Parts 1–4 against the 30-page limit, and save the PDF
   from Word.

## Boundaries

- Never hand-author, patch, or "fix up" `bcca-factum.md`.
- Never restate the submission database's schema -- point at
  `drafting_forms__emit_bcca_factum` and
  `subskills/publish-bcca-factum/references/bcca-factum-contract.md` instead.
- A factum is one Word document, not a book: never bind the factum itself
  with `/assemble` and `assemble-bcca-book`. Its Book of Authorities is a
  separate book -- `publish-bcca-book` renders it from the same filing, and
  `assemble-bcca-book` binds it.
