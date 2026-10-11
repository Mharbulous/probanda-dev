---
name: publish-general
description: >
  Renders a general Writing (a letter, a memo, a release, any kind whose type
  declares the general renderer) as a .docx from its filed render, through one
  generic template set by its venue's physical-format file, or on the firm
  letterhead when its type declares one. Routed to by the explicit
  publish-general token, or by a practitioner asking to turn a ready general
  Writing's mockup into its Word document.
---

# Publish General

Turns one `general` Writing into its Word document. `/draft` drafts the Writing and shows the practitioner the mockup. This subskill runs once the practitioner is happy with that mockup. A bespoke kind (a BCSC form, the VanIAC package, a BCCA book or factum) has its own subskill and is never rendered here.

The physical-format file's contract is `shared/declared-format.md`. The knowledge tree, its items and the confirmation sidecar are `shared/knowledge-tree.md`. This file restates neither.

## What this produces

At the top of the draft folder, the one folder matching `0. DRAFT*` under the matter; none, or more than one, fails loudly. `<name>` is the stem step 5 composes.

1. `<name>.docx`, the deliverable.
2. `<name> (format unverified).docx`, the review copy, written only while an item of the format file needs the practitioner's attention (step 8). Its warning is the body's first paragraph and never reaches the deliverable.

The tool responses the fill reads are saved as JSON files in the working folder `<case-data folder>\publish-general\`, the case-data folder being the one `coclerk.json`'s `case_data_dir` names. It must already exist: if it does not, stop and tell the practitioner to run `/case-data` initialize; never create it. In Cowork, make no access request: the host tool below derives that folder itself. Create `publish-general\` if it is absent. The JSON files are rewritten in place on each run.

## In Cowork

In Cowork (this host grants the data tools as `mcp__remote-devices__plugin_probanda_data__<name>`), the sandbox sees neither the matter folder nor the case-data folder, and the Write tool writes into the sandbox, not the host (ADR 0026). Never run the fill in the sandbox shell, and never use the Write tool for a working file. Run steps 1 to 4 for their checks, refusals and payloads, but save nothing: compose `letter.json`'s and `tokens.json`'s content as JSON objects instead of writing them. In place of step 5, call `drafting_forms__publish_general` with:

- `matter_root`: the matter folder's host path, as `drafting_forms__open_session` takes it
- `db_path`: step 1's database path
- `filing_id`: the Writing
- `output_name`: step 5's stem
- `format_path`: step 3's knowledge path
- `letter` and `tokens`: step 4's payloads, only when step 4 calls for them

The server renders the filed face, reads the format file and, for a letterhead Writing, the firm profile itself, writes the working files in the real `<case-data folder>\publish-general\`, runs the fill into the real draft folder and returns the fill's JSON line unchanged. Steps 6 to 10 read it as they read the fill's. Relay any refusal verbatim, whether the fill's, a render refusal (such as `confirmation_gate_failed`), `bespoke_renderer`, `path_out_of_scope` or `python_timeout`: its message says what to do next. Do not look for the files in the sandbox: the tool's result is the check, and a file card names the host path it returns.

## Steps

Tools are named without their prefix. Call each under whichever of `mcp__plugin_probanda_data__<name>` and `mcp__remote-devices__plugin_probanda_data__<name>` this host grants.

1. **Resolve the database.** Invoke `/drafting-data` to resolve `db_path` for the current matter, following its own Configuration section. Never re-derive its path-resolution rules independently.

2. **Render the filed face.** Call `drafting_forms__render` for the Writing with `render_mode: "filed"`. The response carries the filed text and the Writing's stored layout (`stored_layout`) together. It is the only permitted source of the document's text and layout: never hand-author, patch or summarize the text, and never read `/draft`'s tree. If the render refuses (`confirmation_gate_failed`, `unwritten_gate_failed` or any other refusal), tell the practitioner the refusal verbatim and stop. If the stored layout's `renderer` is `bespoke`, name the subskill that fills that kind and stop. Save the response, unchanged, as `filed.json` in the working folder, with the Write tool (never sandbox bash; the Cowork mount-staleness bug, #324).

3. **Check and read the venue's physical-format file**, fresh on every render. Its knowledge path is `publish\<Country>\<Jurisdiction>\<Venue>\format.md`, the three folders being those of the stored layout's `type_file` (`draft\<Country>\<Jurisdiction>\<Venue>\Documents\...`, where `<Venue>` is `_NoVenue` for a Writing that goes to no venue).
   1. Call `sources__check` with `files: [{tree: "knowledge", path}]`. A `no_sources` refusal means the file names no published source, as a file whose every item is practitioner-sourced does: there is nothing to check, so go on. A `gap` reads "freshness not verified": say so once and go on. A changed source is told once on each load.
   2. Call `knowledge__read` on the path. It reads each item's freshness from the check just run. Save the response, unchanged, as `format.json`.
   3. **A miss.** If either call reports the file `not_found`, invoke `/localize` with `operation: create`, the calling skill `publish`, the country, jurisdiction and venue, the Writing's kind as named, and the live matter. Relay an `ambiguous`, `refused` or `no_official_source` return as returned, and stop. On `created`, show the learned-file notice (`shared/knowledge-tree.md`, "The learned-file notice") and start this step again.
   4. Relay `shadowed_local`, `conflicts` and any correction the read reports, once per session.

4. **Letterhead inputs**, when the stored layout declares `letterhead: true`:
   - Call `practice_data__firm_profile` and save its response, unchanged, as `profile.json`.
   - Write `letter.json`, the payload the docstring of `scripts/render_letterhead.py` describes: `signer`, the Writing's signing lawyer as `/drafting-data` reports it; `file_number`, the firm's file number for the matter; `date`, the recipient fields, `salutation` and `re`, each as the filed face prints it, but with `attention`, `re`, `cc` and `enclosures` given without their "Attention:", "Re:", "cc:" or "Encl." label, which the letterhead prints itself; and `body`, the letter's body paragraphs exactly as the filed face prints them, in order. The fill refuses a body paragraph that is not a paragraph of the filed face, a `salutation`, `re` line or `attention` (top-level or in `recipients`) that is not a line of it, a value that carries its label, a `cc` or `enclosures` that is not a list (never a bare string), and a `body` that leaves out a body paragraph of the filed face.

   **Header and footer tokens**, when the Writing is not on the letterhead and the format file's `header` or `footer` carries a letterhead token: write `tokens.json`, mapping each token to its value (the signer's roster name, email and direct line from `practice_data__firm_profile`, and the firm's file number for the matter). A Writing signed by a party has no roster signer, so a signer token (`{{AUTHOR_NAME}}`, `{{AUTHOR_EMAIL}}` or `{{DIRECT_LINE}}`) has no value and the fill refuses `missing_token`. Report that refusal to the practitioner as a limitation of the format file, whose header or footer needs a lawyer signer, not as a defect.

5. **Fill.** Compose the stem from the filed face under `/file-naming`'s grammar (no ` vN`, no extension) and run its gate on it. On a fail, or a date or code you cannot pin down, ask the practitioner; never fall back to the title. Resolve `subskills/publish-general/scripts/fill_general.py` from `/publish`'s folder: in a repo checkout run it as `python .claude/skills/publish/subskills/publish-general/scripts/fill_general.py` from the repo root (in Cowork, never run it: call the host tool instead, as "In Cowork" above says). Then run:

   ```
   python fill_general.py --filed filed.json --format format.json --out-dir "<draft folder>" --out-name "<stem>" [--letter letter.json --profile profile.json] [--tokens tokens.json]
   ```

   It prints one JSON line and exits non-zero on a refusal, never with a traceback. Its docstring holds the full contract, including the generic template's default for each property the format file omits.

6. **Report what the render did,** once per session: `overridden_by_letterhead` (every property the format file sets, which the registered letterhead replaced), `defaulted` (the properties left to the generic template's defaults) and `not_rendered` (any other document the filed render returned, such as a declared companion, which this subskill does not render).

7. **Never overwrite.** A taken name gets the next ` vN`; `versioned_from` (`review_copy_versioned_from`) names the copy passed over. Tell the practitioner, in case it is another Writing's, then present it as current per the workspace output rule.

8. **Unverified format.** On `deliverable_refused` the fill wrote only the review copy. Present it, then ask once, listing each item in the refusal's `unconfirmed` as its `rule_ref`, its verbatim passage (from the `content` in `format.json`) and its `value`, described as the value applied. An item marked `overridden_by_letterhead` still blocks, but describe its `value` as the value the file records (not applied on the letterhead).
   - **A roster lawyer accepts.** Invoke `/localize` with `operation: confirm` for each accepted item, naming the format file's knowledge path, the item's `rule_ref` and the live matter. Then repeat from step 3: the fill writes the deliverable once every item reads confirmed. It is written beside the earlier `<name> (format unverified).docx`: tell the practitioner that review copy is now superseded, and offer to send it to TRASH by `shared/workspace-output-rule.md`.
   - **A staff run stops.** When this machine's `person` is a `staff` roster entry in `practice_data__firm_profile`, stop after the review copy and name the lawyer who must confirm: the Writing's signing lawyer, or else an active roster lawyer.
   - Never confirm on anyone's behalf, and never edit the format file to get past the refusal.

   A `Source changed` warning, in a review copy written beside the deliverable, is told, not asked: the shipped file's source moved, and the practitioner may ask for a repo-session refresh of it.

9. **Any other refusal** (`invalid_format`, `letterhead_refused`, `no_stored_layout` and the rest, apart from a party-signed Writing's `missing_token` in step 4) is a defect: report the code and its detail to the practitioner, and never work around it.

10. **Present the result.** Present the deliverable, and any review copy written, as clickable file cards. On a remote-device-only host, stage each saved file first and send the staged path (`/show-me`, "Presenting a file saved on the PC").

## Boundaries

- Never hand-author, patch or "fix up" the filed text, and never read `/draft`'s tree.
- Never restate the submission database's schema; point at `drafting_forms__render` instead.
- Signature placement is not settable. The fill keeps the signature block on the page of the paragraph before it.
- Sending the document is the practitioner's own act.
