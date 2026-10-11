# Accounting routing rules (expanded)

This is the routing subagent's sole reference file. `profile.md`'s Scope
table is the terse, canonical version of these same 7 rules — read it first
for the priority order and destination paths; this file adds the judgment
calls and worked examples needed to apply them to a real file.

Reviewable set: whitelisted-extension files loose directly at the
`ACCOUNTING\` root — never a file already inside a subfolder. Rules apply in
order; the **first match wins**, so check rule 1 before rule 6 even if a
file might loosely fit both.

## Rule 1 — RBC business accounts

Account tails: chequing **…300-3**, Visa Business **…4872**. Both belong to
BDLC (the firm's operating entity). Look for the account number on the
statement's first page, or in the letter's reference line.

**Month = the file's own date, not the period it covers.** A statement
dated 2026-08-03 for the period 2026-07-01 to 2026-07-31 still files under
`2026\2026-08\1. Bank & Credit Card Statements\` — the *dated* month, not
the *covered* month. This was confirmed against every existing 2025/2026
example in the folder; do not "correct" it to the covered period.

## Rule 2 — Scotia pooled trust account

Account tail: **…0419**. Covers statements, interest statements, and
trustee-designation/attestation correspondence (LSBC trust-account paperwork
tied to this account).

Destination is **flat**: `Trust Account Bookkeeping\[Year]\`, no month or
category subfolder — this is the live 2024–2025 convention. Years
2016–2023 in that folder use a month/category subfolder layout; that's
abandoned, not a pattern to continue. If in doubt, look at what the two most
recent years in `Trust Account Bookkeeping\` actually do, not what an older
year does.

## Rule 3 — BDLC/DorstB ↔ Logica Law fee-share

Filename forms: `INV#... fee share`, `INV#... advance ... fee share`,
`CHQ Logica #...`. These record the fee-sharing arrangement between BDLC
and Logica Law — invoices, advances against future fees, and the cheques
paying them.

Destination: `LOGICA LAW BILLING\`, **loose at root**. The folder also
contains legacy numbered subfolders `1A. Logica Law Bills (BILLED)\` and
`1B. Logica Law Bills (PAID)\`, populated only through roughly 2022 — do not
file new matches there; the working convention since is loose-at-root,
confirmed by the long run of loose `INV#...` files from 2023–2025 already
sitting there.

## Rule 4 — Different billed entity (requires opening the file)

The vendor and the document type can both look like a routine
"General Account Bookkeeping" business expense while the invoice is
actually billed to a different entity — most often **directly to
"Logica Law Corp"** rather than to BDLC. When that's true, the file follows
the **billed entity's own folder**, not the vendor-pattern default.

This is never filename-derivable. **Always open the PDF and read the actual
Bill To / Billing Account field** before proposing a destination for any
file matching this rule's trigger vendors.

**Vendors known to sometimes bill Logica Law directly** (treat these as a
default guess needing confirmation, not a guarantee): Thomson
Reuters/Westlaw, Meridian OneCap, Anthropic/Claude, Impark. This list is a
starting point, not exhaustive — any invoice/expense should get the same
Bill-To check if something about it (letterhead, addressee) looks
inconsistent with BDLC.

If the Bill-To can't be confirmed within the subagent's page budget,
downgrade to manual review rather than guessing — a wrong entity assignment
is worse than an unresolved file.

## Rule 5 — Personal (non-BDLC) accounts

Signals: a statement, void cheque, or account document addressed to Brahm
Dorst personally (a personal address, not BDLC's), or an MBNA Mastercard
statement carrying DorstL's or DorstB's own personal name rather than
BDLC's.

Destination: `Family\`, loose at root — no subfolder structure exists there
today; don't invent one.

## Rule 6 — General business expenses (requires opening the file)

Covers ordinary BDLC business expenses that aren't the fee-share billing of
rule 3 or the account statements of rules 1/2: parking, small SaaS
subscriptions, equipment financing, professional subscriptions.

**Receipt vs. payable split** — this is the part that needs the file
opened:
- **Receipt** (proof of payment already exists — a payment confirmation, a
  paid stamp, a statement showing the charge cleared) → files as **paid**:
  `General Account Bookkeeping\[Year]\[Year-Month]\6. Business Expenses (paid)\`.
- **Unpaid invoice, less than 30 days old as of the run date** → files as
  **payable**: `...\5. Accounts payable\`.
- **Unpaid invoice, 30 days or older as of the run date** → also files as
  **paid** (`6. Business Expenses (paid)\`) — the age threshold assumes it
  was settled even without an explicit receipt on file. Compute age against
  the run date the orchestrator hands the subagent, never against "today"
  guessed from context.

**Reclassification is human-only, always.** Once a file has been filed under
either `5. Accounts payable\` or `6. Business Expenses (paid)\`, it is out
of this profile's scope — it's no longer loose at root — and must never be
moved between the two by an automated run, even if the 30-day threshold has
since passed for a file already sitting in "Accounts payable." Only a human
reclassifies an already-filed file.

## Rule 7 — Internal transfers between the firm's own accounts

A receipt or record showing the General account paying another of the
firm's own accounts or cards — including a description that names a
personal-sounding card, e.g. "pay Family Visa." Despite the personal-sounding
description, this is a record of the **General account's own transaction**,
not a personal document, so it stays in
`General Account Bookkeeping\`, filed into that month's ad hoc `Receipts\`
subfolder — only where that month's folder already uses one (don't create a
`Receipts\` subfolder in a month that has never used it; if none exists,
this file needs manual review instead of inventing the subfolder).

## No match

A file matching none of the 7 rules — most often a content-free screenshot
or printout with no bookkeeping substance — is not filed anywhere. Leave it
in place, put it on Needs manual review with reason "matches no routing
rule," and let it be. Do not invent a "misc" or "uncategorized" destination.
