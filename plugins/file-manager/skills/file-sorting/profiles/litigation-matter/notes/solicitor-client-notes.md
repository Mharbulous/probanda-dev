# Solicitor-client folder notes (folder type 2)

Scope: communications and records between the firm and its own client —
letters/emails to/from the client, retainer and account records, client
receipts and statements, and internal solicitor-client memos.

## Codes typically used here

Direction codes (`LT`, `ET`, `ELT`, `LET`, `LF`, `EF`, `LEF`, `UP`, `HT`,
`HF`), accounting codes (`RCPT`, `INV#`, `STMT`, `CHQ#`, `INTERAC`, `DEP`),
intake codes (`ICCF`, `ID`, `CCS`, `CONF`, `RET`), memo codes (`MTF`, `Notes`),
and `IE` for internal email.
Look up definitions in `code-registry.md`.

## Judgment calls

- **Misfile test:** "Is the other party the client?" A letter to opposing
  counsel that landed here is misfiled (belongs in Correspondence) — type-(1).
- **Retainer agreements** use `RET`, not a generic `LT` transmittal. `RET` is
  the agreement itself; the cover letter (if separate) gets `LT`.
- **Client account documents** always include `$Amount`.
- **Memo codes** (`MTF`, `Notes`) cover internal notes about the client
  relationship — instructions taken, advice given, file-opening notes.
- **Internal email** (`IE`): a staff-only email or chain about this client's
  account or relationship (billing, trust handling, a refund) belongs here and
  is not misfiled, even though no client is on it. Name it like any account
  document, with the amount: e.g.
  `2024-07-30 IE SmithJ re INV#6217 cheque trust refund $448.msg`.

## Known thin spots

None currently identified — between direction, accounting, intake, and memo
codes this folder is well-covered.
