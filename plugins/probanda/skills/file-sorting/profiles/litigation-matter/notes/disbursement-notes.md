# Disbursement folder notes (folder type 9)

Scope: the matter's money trail — cheques, cash, invoices, receipts,
statements, e-transfers, and trust-account movements. Always include `$Amount`.

## Codes typically used here

`CHQ#`, `CASH`, `INV#`, `RCPT`, `STMT`, `INTERAC`, `DEP`. Look up definitions
in `code-registry.md`.

## Judgment calls

- **`CHQ#` and `INV#`:** `#` is followed by the literal cheque/invoice number
  read from the document (e.g. `CHQ#423`, `INV#1087`).
- **CSO receipt derivation procedure:** a CSO "Package Submission Fee" receipt
  shows no court file number or document description. Derive `re <subject>` by:
  1. Note the receipt's Transaction Package ID (e.g. `1513402121`).
  2. Search Lawyer Brief > CSO `SUBSHT` PDFs for that Package ID inside their
     transaction tables (not the SUBSHT's own file number).
  3. Read the matched SUBSHT's document description to derive subject (e.g.
     `re NOCC (new action no)`). If the SUBSHT lists more than one document
     (see `lawyer-brief-notes.md`'s multi-document package rule), carry
     forward *all* its codes, space-separated, not just one — the receipt's
     `<code>` slot mirrors whatever the matched SUBSHT lists.
- **Deposit-slip pattern:** when a deposit slip is scanned, the cheque becomes
  part of the deposit's description — e.g. `CHQ#423 re Microtech $43,000`
  becomes `DEP CHQ re Microtech $43,000` once deposited. Flag (don't silently
  fix) a `CHQ#` that looks deposited but never converted.
- **Institutional payee tokens:** when payee is an institution, use `CSO`,
  `Court`, `CRA`, `LTSA`, `LSBC` instead of `LastnameF`. For CSO receipts,
  include Package ID in subject using the pattern
  `RCPT CSO re PKG <id> <code> $<amount>`. This applies to all CSO fee types:
  - **Package Submission Fee ($7):** `<code>` is derived from the matched SUBSHT
    (see derivation procedure above) — e.g.
    `RCPT CSO re PKG 1513402121 NOCC $7.pdf`
  - **Document Filing Fee ($25, $200, etc.):** `<code>` is simply `filing fee` —
    e.g. `RCPT CSO re PKG 3740226 filing fee $25.pdf`
- Client-side receipts/statements may also live in Solicitor Client (type 2) —
  that's expected, not a misfile.

## Known thin spots

No dedicated codes for: bills of costs, disbursement ledger exports. Log
type-(2) if encountered.

## Misfile test

Is the document non-financial (a pleading, a letter with no money in it)?
If yes, it's misfiled — type-(1) escape.
