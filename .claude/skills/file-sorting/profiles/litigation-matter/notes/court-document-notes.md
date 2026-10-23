# Court document folder notes (folder type 5)

Scope: documents that are part of the court file — pleadings, applications,
affidavits, orders, notices, and other filed/fileable court documents.

## Codes typically used here

All pleading codes, affidavit codes, notice/application codes, order codes,
and other court document codes. Also `NTA`, `RTNTA`, `XFD`/`EFD` (shared with
discovery folder). Look up definitions in `code-registry.md`.

## Judgment calls

- **Date rules:** as `/file-naming`'s general conventions ("Date") set
  them. A filed document takes the **court-stamp** date.
- **Status markers:** add trailing `FILED` / `UNFILED` / `signed` where it
  distinguishes versions of the same document.
- **`EFS` attribution:** name an `EFS` for the deponent of the document it
  accompanies, not the certifying lawyer. Example: `EFS IwaschukB re AAPS`.
- **`AFF#` numbering:** `#` is a literal sequential number (e.g. `AFF1`,
  `AFF2`) — read which affidavit it is.
- **Attempted vs completed service:** `AAPS` = attempted but not completed;
  `AFFPS` = completed. Read the affidavit to determine outcome.
- **`LF Court` convention:** a correspondence code (`LF`, `FLF`, etc.) is
  valid here when the letter is from the Court (registry cover letter enclosing
  a filed document). Use institutional-sender token `Court`.
- **`NTA`/`RTNTA` and `XFD`/`EFD`** also appear in Discovery (type 7) — use
  these codes wherever they sit in your folder.
- **`TB`** primarily lives in Trial Brief (type 8); listed here because a
  filed trial brief is a court document.

## Known thin spots

None currently identified for court documents specifically.

## Misfile test

Is the document correspondence (a letter), an invoice, or internal work
product with no court-filing purpose? If yes, it's misfiled — type-(1) escape.
