---
name: publish-vaniac-package
description: >
  Renders a VanIAC exchange package's drafted texts as .docx files: the
  written argument, each witness statement (unsigned, for signature) and
  the cover and index, from the filing's filed render. Routed to by the
  explicit publish-vaniac-package token, or by a practitioner asking to turn
  a ready VanIAC submissions mockup into the package documents.
---

# Publish VanIAC Package

Turns a VanIAC submissions filing into the Word documents of its exchange
package. `/draft` populates the substance and shows the practitioner the mockup.
This subskill runs once the practitioner is happy with that mockup and wants
the package documents. Gathering the exhibits and binding the package into
one PDF are the next step: `/assemble` with `assemble-vaniac-package`.

## What this produces

In the filing's mockup folder, `<draft folder>\SUB <filing folder>\`:

1. `Package\Written Argument of the <Claimant|Respondent>.docx`
2. `Package\Witness Statement of <name>.docx`, one per witness, unsigned. The
   practitioner places each signed copy beside it as
   `Witness Statement of <name> - signed.pdf`.
3. `Package\Index.docx`: the cover page, then the index of the whole
   package. Its page column stays blank; the bound PDF carries the numbers.

In the filing's data folder, `<case-data folder>\vaniac-submissions\<filing folder>\`:

4. The source files the render returned: `Written Arguments.md`,
   `Evidence Index.md` and one `Witness Statement - <name>.md` per witness.
5. `Package index.json`: the side, the round, the caption, the witnesses and
   the exhibit rows, for `assemble-vaniac-package`. Any directions the
   practitioner gave for binding an unsigned statement in the previous set
   are kept under `previous_unsigned_directions`.

Items 4 and 5 are data, rewritten in place on every publish. Items 1 to 3
are deliverables and are never overwritten: `assemble-vaniac-package` binds
`Package\` by exact file name against the one index, so a re-publish needs
the previous set's argument, witness statements and `Index.docx` moved out
of `Package\` first (step 6). Expert reports and exhibits stay.

Nothing is rendered for exhibits or expert reports: neither is a drafted
text. The practitioner places each expert report in `Package\` as
`Expert Report of <name>.pdf`. There is no placeholder file.

## In Cowork

In Cowork (this host grants the data tools as
`mcp__remote-devices__plugin_legal_data__<name>`), the sandbox sees
neither the matter folder nor the case-data folder, and the Write tool writes
into the sandbox, not the host (ADR 0026). Never run the fill in the sandbox
shell, and never use the Write tool for a source file. Run steps 1 to 4 (from
step 3, only the mockup folder's name), then, in place of steps 5 to 8, call
`drafting_forms__publish_vaniac_package` with:

- `matter_root`: the matter folder's host path, as
  `drafting_forms__open_session` takes it
- `db_path`: step 1's database path
- `filing_id`: the VanIAC submissions filing
- `writing_folder`: the mockup folder's name, `SUB <filing folder>`, one
  folder name under the draft folder
- `round`: step 4's round, as `opening`, `response`, `reply` or
  `non-participation`

The server runs step 6's check on the real `Package\`, renders the filed face,
writes the source files in the real data folder, passes one `--witness` per
witness statement the render returned, runs the fill and returns its JSON line
unchanged. Step 8 reads it as it reads the fill's, and a refusal
`output_exists` is step 6's: ask the practitioner to move the previous set
aside. Relay any refusal verbatim, whether the fill's, a render refusal,
`path_out_of_scope` or `python_timeout`: its message says what to do next. Do
not look for the files in the sandbox: the tool's result is the check, and
each file card names a host path it returns.

## Steps

1. **Resolve the database.** Invoke `/drafting-data` to resolve `db_path`
   for the current matter, following its own Configuration section. Never
   re-derive its path-resolution rules independently.

2. **Confirm the filing.** The filing must be a VanIAC submissions package.
   If the practitioner's request names a filing of any other kind, say so and
   stop.

3. **Resolve the mockup folder.** It is the presentation folder `/draft`
   section 9 resolves ("Resolving the presentation folder"): the draft folder,
   the `SUB` code and the filing folder. Read that section for the mechanics;
   do not re-derive them here. It holds no date prefix.

   The data folder is `<case-data folder>\vaniac-submissions\<filing folder>\`,
   the mockup folder's name without any leading `YYYY-MM-DD ` and without
   the `SUB` code. The case-data folder
   is the one `probanda.json`'s `case_data_dir` names; in Cowork, make no
   access request: the host tool derives it. If the
   case-data folder does not exist, stop: the matter is not initialized
   (`/case-data` initialize). Create `vaniac-submissions\<filing folder>\`
   under it if it doesn't exist.

4. **Take the round.** Read it from the filing folder's name: `Opening`,
   `Response`, `Reply` or `Non-Participation`. If the name carries none of
   them, or more than one, ask the practitioner which round this is.

5. **Render the filed face.** Call `drafting_forms__render` for the filing
   with `render_mode: "filed"`. This is the only permitted source of the
   package's text: never hand-author, patch or summarize it. If the render
   refuses, tell the practitioner the refusal verbatim and stop.

6. **Never overwrite a deliverable.** Before writing anything, check
   `Package\` for `Index.docx` and for any `Written Argument of the *` or
   `Witness Statement of *` file, including the practitioner's own PDFs
   (`Written Argument of the <Side>.pdf`, `Witness Statement of <name> -
   signed.pdf`), which the binder takes by name in place of the Word files.
   If any is there, stop and ask the practitioner to move the previous set
   aside by hand. Never overwrite, rename or delete one yourself. This check
   is wider than the script's, which looks only at this render's names, so
   it also catches a statement left from a witness the render dropped.

7. **Write the source files.** Write each returned document whose
   `file_name` is `Written Arguments.md`, `Evidence Index.md` or
   `Witness Statement - <name>.md` **verbatim, byte for byte**, with the Write
   tool (never sandbox bash; the Cowork mount-staleness bug, #324), into
   the data folder, replacing any earlier copy in place. Skip any other
   document the render returns. Note each witness `<name>` for step 8. The
   data folder keeps these files out of `Package\`, which the pre-filing
   gate scans, and away from the mockup copies of the same names.

8. **Fill.** Resolve `subskills/publish-vaniac-package/scripts/fill_vaniac.py`
   from `/publish`'s folder: in a repo checkout run it as
   `python .claude/skills/publish/subskills/publish-vaniac-package/scripts/fill_vaniac.py`
   from the repo root (in Cowork, never run it: call the host tool instead,
   as "In Cowork" above says). Then run:

   ```
   python fill_vaniac.py "<data folder>" "<mockup folder>\Package" --round <opening|response|reply|non-participation> --index-json "<data folder>\Package index.json" --witness "<name>" --witness "<name>"
   ```

   Pass one `--witness` per witness statement this render returned, and
   none when it returned none. The script rewrites `Package index.json` in
   place.

   It prints one JSON line and exits non-zero on a refusal, never with a
   traceback. `out_of_grammar` means the render produced a line the script
   does not know how to set in Word: report the code and the named line to
   the practitioner as a defect, and never edit the source file to get past
   it. `output_exists` means a file step 6 should have caught: treat it as
   step 6 does. Report any other refusal the same way. A non-empty
   `ignored_sources` names witness source files an earlier publish left in
   the data folder that this render did not return: tell the practitioner
   they were not used.

9. **Present the result.** Present every document in `Package\` as a
   clickable file card (`shared/present-files.md`), in the order listed above.

## Next

Once the practitioner has placed the signed witness statements and any
expert reports in `Package\`: `/assemble` with `assemble-vaniac-package`
gathers the exhibits into `Package\`, then binds the whole package into one
PDF with the index page numbers filled.

## Boundaries

- Never hand-author, patch or "fix up" the rendered text or the source
  files in the data folder. A refusal is a defect to report, not a gap to paper
  over.
- Never restate the submission database's schema; point at
  `drafting_forms__render` instead.
- Sending the package to the Centre or the other side is the practitioner's
  own act.
