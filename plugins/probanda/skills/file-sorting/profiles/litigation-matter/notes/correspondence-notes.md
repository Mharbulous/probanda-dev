# Correspondence folder notes (folder type 3)

Scope: incoming and outgoing correspondence with anyone outside the firm —
opposing counsel, the court registry, experts, witnesses, third parties.
(Correspondence with the client lives in folder type 2.)

## Codes typically used here

All delivery/direction codes (incoming and outgoing). Look up definitions in
`code-registry.md`.

## Judgment calls

- **Order-of-sending rule:** the method-letters in a code mirror the order the
  methods were actually used — `LET` = letter first then emailed; `ELT` =
  emailed first then original mailed to follow. When several methods go
  together, default order is email > fax > courier > mail > registered; actual
  sequence governs when it differs.
- **Delivery code is content-independent:** the delivery code (e.g. `ELT`) for
  a covering email that transmits an attached letter is set by delivery
  method alone — never by whether the email also carries its own substantive
  content. A bare "please find attached" email and one that also raises new
  substantive points (e.g. proposing hearing dates, flagging an overdue
  document) both get the same code. Content only changes the subject/
  description component: with no independent content, the description just
  mirrors the letter's own description; with independent content, describe
  that instead of (or in addition to) the letter's description. This is not
  a code-choice ambiguity — don't escalate it as a type-(2) gap.
- **No periods in filenames** except immediately before the file extension.
  Periods mid-filename cause file-reading errors. Use hyphens, spaces, or omit
  punctuation (e.g. `BC` not `B.C.`).
- **Combined `re/srv/encl` flags:** a document can both demand something on a
  deadline and enclose a supporting document — combine flags rather than picking
  one (e.g. `re demand letter srv RTB order`).
- **Assistant sends, lawyer cc'd:** when a legal assistant is the literal
  `From:` sender but a lawyer is cc'd and is the evident author/signatory of
  the substance (e.g. an attached letter), attribute Author/Recipient to the
  cc'd lawyer, not the sending assistant — legal assistants routinely send on
  the file lawyer's behalf. If no lawyer is cc'd, or the email's own content
  is administrative only (e.g. scheduling, transmittal with no substantive
  authorship), attribute to the literal sender instead.
  Example: email from `clinag@firm.com` (assistant), cc `aswabuk@firm.com`
  (lawyer), transmitting a substantive letter → Author/Recipient is
  `SwabukA`, not `LinagC`.
- **Institutional / government senders.** When the sender/recipient is an
  institution with no individual signatory, use a short institution token:
  `Court`, `MinistryJustice`, `CSO`, `LandTitle`, `CRA`, `LSBC`. If unlisted,
  coin a concise CamelCase token and log a type-(2) gap.
- A substantive court document (bare pleading, order) that turns up here is
  likely **misfiled** — type-(1) escape.

## Standalone third-party bills and invoices

`BILL#` and `INV#` are two vantage points on the same document:

- `INV#` — accounts receivable (money the client owes the firm)
- `BILL#` — liability (money the firm owes a third-party vendor)

`INV#` is the canonical code in `code-registry.md`. Use `BILL#` when the
document is a vendor's Statement of Account addressed *to* the firm (e.g. a
process server, courier, or external law firm). Format:
`YYYY-MM-DD BILL#<number> <VendorToken> re <description> $<amount>`.

If the invoice arrived as an email attachment, file both documents separately:
the `.eml`/`.msg` gets a delivery code (`EF`, `LEF`, etc.); the attached PDF
gets `BILL#<number>` as the code with no delivery prefix. This mirrors how
`INV#` works for firm invoices in folders 2 and 9.

## Misfile test

Does the document contain substantive legal content that isn't correspondence
(a filed pleading, a court order with no transmittal wrapper)? If yes, it
probably belongs in Court File (type 5).
