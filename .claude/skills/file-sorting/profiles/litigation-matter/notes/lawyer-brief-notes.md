# Lawyer brief folder notes (folder type 4)

Scope: the firm's internal work product about the matter — memos, notes,
searches and summaries the lawyer prepares for their own use. Not
correspondence, not court filings.

## Codes typically used here

`MT`, `MTF`, `ML`, `RPT`, `Notes`, `SRCH`, `SMRY`, `SUBSHT`, `REJN`, `AGMT`,
`RMA`, `LTSANOR`, `LTSAREL`, `CALCN`, `CHRON`, `SCR`, `WSS`. Look up
definitions in `code-registry.md`.

## Judgment calls

- **`MT` vs `MTF`:** `MT` (memorandum to a named person) takes an
  author/recipient in `LastnameF` form; `MTF` (memo to file) generally doesn't.
- **`EFS` attribution in SUBSHT context:** name a `SUBSHT` for the filing it
  accompanies, not the submitting lawyer.
- **`ML` bridge to Law folder:** a stored piece of legal research authored as
  a firm memo is `ML` and lives here; external case law / authorities themselves
  belong in the Law folder (type 6).
- **Westlaw AI research memo** = `ML`.
- **`AGMT` / `RMA`:** use `RMA` for rental/property management agreements,
  `AGMT` for any other signed agreement.
- **`LTSANOR`:** covers myLTSA companions to LTSA filings; distinguish in the
  subject (e.g. `re CPL notice of receipt` vs `re CPL notice of registration`).
- **`LTSAREL`:** Land Title Act Form C Release discharging a registered charge.
- **`CALCN`:** any internal financial model, interest calculation, or damages
  spreadsheet.
- **`SRCH` — LTSA title search vs BC Assessment property lookup:** `SRCH`
  covers searches of both public property registers; the **subject** slot is
  what distinguishes them. An LTSA title search names the title searched
  (`SRCH re title PID 000-000-000`); a BC Assessment property-information
  printout or raw browser screenshot names the register and the property
  (`SRCH re BC Assessment 1234 Main St Vancouver`). Date it the day the search
  was run or captured — on a raw browser capture with no document date, the
  timestamp in the original filename is that date.
- **Assessed value is not an `$Amount`:** never put a BC Assessment assessed
  value (or any valuation) in the `$Amount` slot. That slot is for transaction
  amounts — payments, invoices, receipts, settlements — and a valuation there
  pollutes every dollar-amount search of the firm's accounting records. If the
  roll year matters, put it in the subject instead: `SRCH re BC Assessment
  1234 Main St Vancouver 2026 roll`.
- **LTSANOR subject conventions:** `LTSANOR re CPL notice of receipt`;
  `LTSANOR re CPL notice of registration`.

## CSO subfolder

`SUBSHT` (CSO Submission Sheets) and `REJN` (CSO rejection notices) must be
saved in the **`CSO/`** subfolder of this folder, never the root. Name them:
- `SUBSHT re PKG <id> <code>` — where `<code>` is the document type submitted
- `REJN re PKG <id> <code>` — same `<code>`; pair with matching RCPT in disbursements

**Multi-document packages:** a single CSO package can submit more than one
document type. When it does, list every submitted document's code in the
subject slot, space-separated, in the order they appear on the SUBSHT's
transaction table: `SUBSHT re PKG <id> <code1> <code2> ...`.

Example: package 4345803 submits an Affidavit and an Electronic Filing
Statement → `SUBSHT re PKG 4345803 AFF EFS.pdf`.

This also affects the matching disbursement receipt (see
`disbursement-notes.md`'s CSO derivation procedure) — the receipt's `<code>`
slot should mirror whatever the matched SUBSHT lists.

`RGN` (Registrar's Notice, physical/paper) may live in CSO/ or the root as found.

## Known thin spots

Expert reports from retained witnesses use `RPT` (not `ML`). `ML` is for
firm-authored memoranda of law only. Log type-(2) if other internal
work-product types not listed are encountered.

## Misfile test

Is the document correspondence (has a sender/recipient outside the firm) or a
court filing? If yes, it belongs in Correspondence (type 3) or Court File
(type 5).
