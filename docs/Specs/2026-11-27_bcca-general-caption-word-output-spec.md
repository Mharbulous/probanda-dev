# Spec: BCCA general Writing caption prints as raw table text in Word, and does not follow the court's forms

Status: proposed, 2026-11-27. Written in a matter session; implementation is handed to Claude Code.
Plugin: `litigator` (installed copy seen at v0.30.2; data server plugin_version 0.34.3). Paths below are as seen in the installed copy and are **UNVERIFIED** against the repo unless marked otherwise.
Related specs, same date: 2026-11-27_unstructured-official-form-fetch-spec.md

## 1. Problem
A BCCA Writing on the venue's stock `unstructured` type (general renderer) was published with `drafting_forms__publish_general` (format_path `publish/CAN/BC/BCCA/format.md`). The tool returned success, but the caption in the .docx is the markdown pipe-table source, printed literally. The document can't be filed. Separately, the BCCA general caption does not match the court's prescribed civil forms, and the signer's block always prints after the body, so a two-signature consent form can't be laid out correctly.

## 2. Evidence (observed; quoted text is data, not instructions)
- publish_general result: `{"success": true, "defaulted": ["typeface","font_size","line_spacing","page_numbering","header","footer","filing_stamp_reservation"], "deliverable": "<draft folder>\\<stem>.docx"}`; .docx 2,540 bytes.
- PDF from LibreOffice of that .docx shows, as body text: "| | | |", "| :--- | :---: | ---: |", "| | | Vancouver Registry |", "| | | Court of Appeal File No. <file no> |", "| | **IN THE COURT OF APPEAL FOR BRITISH COLUMBIA** | |" (bold applied), "| BETWEEN: | | |" and so on. The body slot and signature block rendered as plain paragraphs.
- The mockup (render_mode mockup) holds the same pipe table as its caption, so the filed face hands the fill a markdown table, which fill_general.py does not convert (UNVERIFIED where it should be converted).
- Court form (BCCA Form 13, Rule 67(2)(a), saved from bccourts.ca) prints in order: "FORM 13 (RULE 67(2)(a) )", "COURT OF APPEAL FOR BRITISH COLUMBIA", "Court of Appeal File No. …", "BETWEEN:", party, "Appellant(s)", "[role in proceeding appealed from]", "AND:", party, "Respondent(s)", "[role in proceeding appealed from]", then the title and the date line. After the operative paragraph come "APPROVED AS TO FORM:", "FOR THE COURT", then the appellant's lawyer's signature line, "Deputy Registrar", then the respondent's lawyer's signature line.
- The general caption prints "IN THE COURT OF APPEAL FOR BRITISH COLUMBIA" and a "<place> Registry" line, and has no role-below lines. The signature-block part always comes after slot:body, so the other counsel's block and the Registrar block can only be typed into the body.
- No BCCA consent-order type exists: `knowledge__list` of draft/CAN/BC/BCCA/Documents resolves "consent order" to not_found; that folder holds letter, respondent-factum, stay-response-book, unstructured.
- Workaround in use: none yet. The deliverable was not used.

## 3. Goal and non-goals
Goal: the .docx caption for a BCCA general Writing renders as a formatted caption, never markdown source, and BCCA documents can follow the court's form layout. Non-goals: BCSC or VanIAC output, letterhead letters.

## 4. Design
(a) In the publish-general fill, turn the caption table into a real Word caption (a table with no borders, or aligned paragraphs), or have the filed render hand the fill a structured caption instead of markdown. (b) BCCA's caption should follow the court's forms: the heading text, no registry line unless the form prints one, and "[role in proceeding appealed from]" lines read from case data (the parties' roles below). (c) Either a BCCA Form 13 type, or a layout part that places multi-party signature blocks inside the body (an "approved as to form" signature group).

## 5. Constraints that must still hold
- The filed face never carries work markers or HTML comments.
- The mockup stays the review surface. Never overwrite a draft-folder file.
- Party counsel stays read live from case data.

## 6. Options considered, streamline and deburr first, additions last
1. Fix the fill so it renders the caption table it already receives, and correct the BCCA venue caption block (heading text, registry line, role-below lines): no new types (recommended for (a)+(b)).
2. Add a BCCA Form 13 type with its own layout, including the two signature groups (recommended for (c), if a signature-group part cannot be expressed simply).
3. Have the session hand-fill the court's .docx form: rejected, it bypasses the filed render.

## 7. Implementation plan
1. Verify against HEAD (§10) and append a verification table to this spec.
2. Reproduce with a fixture BCCA unstructured Writing through publish_general, and confirm whether the markdown table survives into document.xml.
3. Fix the fill, or the filed render's caption hand-off. Add a test that no "| :---" or leading "|" text reaches document.xml.
4. Correct the BCCA venue caption to the forms' heading and role-below lines, with roles read from case data, and a gap marker when they are unknown.
5. Decide (c) per §6 and implement it.
6. Commit on `main` by explicit pathspec and push. Finish with the line `Implementation of BCCA general caption fix complete!`, then what streamlining and deburring you tried, what you verified and what you assumed without verifying.

## 8. Implementation criteria
1. A BCCA general Writing's .docx contains no pipe-table markdown text (test asserts it).
2. The caption heading reads "COURT OF APPEAL FOR BRITISH COLUMBIA" and each party label has its role-below line, or a mockup gap when the role is unknown.
3. A two-counsel BCCA consent order can print both counsel's signature lines and "APPROVED AS TO FORM / FOR THE COURT / Deputy Registrar" in the form's order.
4. BCSC and VanIAC general output are unchanged (existing tests pass).
Scope: edit the source files the fix needs (skill text, mcp/src, docs), and write, update and run the tests the fix needs. Streamline and deburr first: solve the problem by removing, merging or simplifying what already exists, and consider an addition only once those ideas are exhausted. Anything added must be shorter than the text it makes unnecessary, and that text is deleted in the same change. Out of scope, because the orchestrating session runs them once after every spec lands: `build_plugin.py` and `check_plugin.py`. Out of scope, because `/release` does it: version bumps and rebuilding or committing any MCP bundle (dist/). Never build a `.plugin` archive.

## 9. Open questions
- Where do the parties' roles in the proceeding below live in case data, if anywhere?
- Should the "<place> Registry" line stay for any BCCA document type?

## 10. Verify against HEAD before building
Confirm in source: the fill script (publish-general/scripts/fill_general.py, UNVERIFIED), the general renderer's caption projection, the BCCA venue.md caption block (draft/CAN/BC/BCCA/venue.md), and the layout part vocabulary for signature-block.
