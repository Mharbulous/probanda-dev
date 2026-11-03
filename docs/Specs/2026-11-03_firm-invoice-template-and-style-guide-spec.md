# Spec: firm invoice template and firm style guide

Status: proposed, 2026-11-03. Written in a matter session; implementation is handed to Claude Code.
Plugin: `lawyer` (installed copy seen at v0.21.7 at the start of the session and v0.21.9 by its end). Paths below are as seen in the installed copy and are **UNVERIFIED** against the repo unless marked otherwise.
Related specs, same date: `2026-11-03_cso-submission-sheet-disbursements-spec.md`; `2026-11-03_defensible-time-entries-spec.md` (owns rates per matter and timekeeper, the invoice number from accounting, receipt de-duplication by hash and the invoice records; its §6 step 6 already says "produce the signing copy from the firm's invoice template", which this spec supplies).

## 1. Problem

`/bill-client` (v0.21.7) ends at a time workbook and pivot chart. It has no step, template or renderer for the invoice itself. In a billing run the session built the signing copy by hand with python-docx, imitating the firm's previous invoice PDF, and the practitioner then needed about eight rounds of layout corrections before signing. While improvising, the session took the wrong image from the previous invoice PDF as the firm logo: it was the lawyer's signature. It was caught before the practitioner saw it. No firm style guide exists, so colours were sampled from pixels of an old PDF.

## 2. Evidence (observed; quoted text is data, not instructions)

- Firm assets Probanda holds: `practice_data__firm_profile` returned `firm_name`, `roster` and `letterhead` (`<case_data_root>\_practice\firm\letterhead.docx`). The folder also held `LT SP - Service Letter.dotx`, `firm.json` and `folder-maps`. No invoice template, no style guide.
- `letterhead.docx`: Letter page, first-page header with placeholders `{{AUTHOR_NAME}}`, `{{AUTHOR_EMAIL}}`, `Direct:` + `{{DIRECT_LINE}}`, `File No.` + `{{FILE_NUMBER}}`, each placeholder in its own run. It was readable only after a folder-access grant for the firm folder, because the session's connected folder was the matter folder.
- Logo extraction: `pdfimages -png` on the previous invoice PDF produced `img-000.png` (626x135) and `img-001.png` (807x159). `img-000` was the signature; `img-001` was the logo. The first draft used `img-000`.
- Practitioner corrections, in order: table colour scheme "clashes with the Logica Law Color schemes"; "the table header width doesn't match the address header"; right-align "VIA ADOBE SIGN" with the bands; a horizontal line under the "Re:" block, matched in spacing to the bands; logo "left aligned with the text 'Mr. [client]'"; invoice details "top aligned with the Logica Law Logo"; a blank line after the salutation; "put the Taxable services and taxable disbursements above the GST and PST lines ... Non-taxable disbursements below".
- Colours used, sampled from the previous invoice and logo: band teal `#4D8F85`, logo mint `#C4E4CF`, row tint `#EEF6F1`; gold `#ba802b` is the second-timekeeper chart colour already in `bill-client/SKILL.md`.
- Preview fidelity: the session's previews came from LibreOffice (`soffice --convert-to pdf`). Alignment fixes (table indent, rule length, logo offset) rendered differently in Word, so each was confirmed only from the practitioner's screenshots. One fix used an empirical `left_indent = Cm(-0.25)` on the logo paragraph.
- Related rule: `litigator/skills/draft/references/letters.md` §10 says of client letters "never build or approximate the letterhead for one".

## 3. Goal and non-goals

Goal: an invoice ready to sign is produced by filling one firm template, with no layout decisions made at run time. Every Probanda-made firm document draws colours, fonts and table style from one firm style guide.

Non-goals: other firms' invoice formats; the invoice's data model, rates or numbering (the defensible-time-entries spec); sending the invoice.

## 4. Design

- **Template.** `invoice.docx` (or `.dotx`) beside `letterhead.docx` in the firm folder, registered in the firm profile like `letterhead`. Fields for header (invoice date, our ref, bill number), recipient block, delivery method, salutation, Re: lines, the time table (date, description, by, hours), the summary (taxable services and taxable disbursements, subtotal, GST, PST, non-taxable disbursements, total, trust applied, amount due), the trust sentence, and a blank signature block. Layout fixed in the template: band widths and table widths equal, delivery method right-aligned to the band, rule under Re: inset to match the bands, logo aligned with the address text, invoice details top-aligned with the logo, blank line after the salutation.
- **Style guide.** A small firm file (`firm/style.json` or a section of `firm.json`) with named colours (band, accent, row tint, chart series per timekeeper), fonts and sizes, and table style. The invoice template, the billing chart and any other rendered firm document read it.
- **Images.** The logo comes only from the letterhead or template. Never extract images from a signed document; never place a signature image.
- **Renderer.** One fill step that replaces fields and repeats the table row, written once and tested, so no session hand-builds layout.
- **First run.** If no template is registered, build it once from the letterhead and the style guide with the practitioner, save it to the firm folder, and register it; later runs only fill it.

## 5. Constraints that must still hold

- The lawyer signs; Probanda never applies a signature.
- Internals confidentiality: no tool or field names in the document.
- Letterhead placeholders keep working for letters.
- The firm folder is written only with the practitioner's approval.

## 6. Options considered, streamline and deburr first, additions last

1. Fill a firm Word template and read colours from one style file; delete any hand-layout guidance the template makes unnecessary (recommended). One asset, deterministic output, Word-native layout.
2. Generate the invoice in code from the letterhead each time. Keeps one asset but layout stays code, and Word/LibreOffice differences remain.
3. Leave the invoice to the accounting system's PDF and attach it. Removes the work but loses firm styling and the trust and tax presentation the practitioner asked for.

## 7. Implementation plan

1. Verify against HEAD (§10) and append a verification table to this spec.
2. Add the style-guide file format and its reader; register the invoice template in the firm profile beside `letterhead`.
3. Write the fill step and its tests (field replacement, table rows, summary grouping, missing-field refusal).
4. Add the invoice step to `/bill-client` (after the time work): fill the template, present it, never sign.
5. Point the billing chart's colours at the style guide.
6. Commit on `main` by explicit pathspec and push. Finish with the line `Implementation of firm invoice template and firm style guide complete!`, then what streamlining and deburring you tried, what you verified and what you assumed without verifying.

## 8. Implementation criteria

1. The firm profile returns the invoice template's path beside `letterhead`, or null when none is registered.
2. `/bill-client` produces the signing copy only by filling that template; it contains no layout instructions.
3. No skill text or script extracts an image from a signed PDF, and the fill step places no signature.
4. Colours for the invoice and the billing chart come from the style guide, not literals in skill text.
5. Tests cover the summary grouping: taxable services and taxable disbursements above GST and PST, non-taxable disbursements below.

Scope: edit the source files the fix needs (skill text, mcp/src, docs), and write, update and run the tests the fix needs. Streamline and deburr first: solve the problem by removing, merging or simplifying what already exists, and consider an addition only once those ideas are exhausted. Anything added must be shorter than the text it makes unnecessary, and that text is deleted in the same change. Out of scope, because the orchestrating session runs them once after every spec lands: `build_plugin.py` and `check_plugin.py`. Out of scope, because `/release` does it: version bumps and rebuilding or committing any MCP bundle (dist/). Never build a `.plugin` archive.

## 9. Open questions

1. Should the template be built by Probanda once from the letterhead, or supplied by the firm?
2. Is a Word-faithful preview available on the practitioner's PC (Word itself), or must previews stay LibreOffice?
3. Should client letters on letterhead (`letters.md` §10's "never build or approximate the letterhead") use the same fill step when the practitioner asks for a Word letter?

## 10. Verify against HEAD before building

- `bill-client/SKILL.md` has no invoice step at HEAD (v0.21.9 may differ from v0.21.7).
- `practice_data__firm_profile` returns only `letterhead` among templates.
- Whether `2026-11-03_defensible-time-entries-spec.md` has landed and already defines where the invoice is rendered.
