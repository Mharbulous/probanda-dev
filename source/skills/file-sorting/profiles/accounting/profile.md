# Accounting profile

**Detection:** the root folder is, or directly contains, `ACCOUNTING\`, and
that folder has all four of `General Account Bookkeeping\`,
`Trust Account Bookkeeping\`, `LOGICA LAW BILLING\`, and `Family\` as direct
subfolders. Any subset missing → this profile does not match; return
`unknown` and let the caller ask the user which profile or which folder
applies rather than guessing.

**Kind:** route-to-destination

**Extension whitelist:** `.pdf .docx .doc .eml .msg .xls`, case-insensitive,
one glob per extension, nothing else — same as `litigation-matter`. A file
with any other extension sitting loose at root (a `.csv`/`.xlsx` export, a
screenshot, a QuickBooks lock/log artifact) is out of scope for this profile
entirely: never listed, never flagged.

## Scope — routing rules

Reviewable files: every whitelisted-extension file sitting **loose directly
at the `ACCOUNTING\` root** — not recursing into any of the four destination
folders below. A file already inside one of them is, by definition, already
routed and is never re-examined; this is what lets a run make progress with
no record backend (Record backend, below).

**Never descend into:** `General Account Bookkeeping\`,
`Trust Account Bookkeeping\`, `LOGICA LAW BILLING\`, `Family\` (the four
destinations themselves), `Trash\`, `Audits\`, `CRA\`,
`Closing trust accounts\`, `Self Employed Consulting\`, and
`AI assisted organization\` (this profile's own working area — see Working
files). None of these are routing destinations or candidates.

Routing rules apply in this priority order — **the first match wins**:

| # | Match (filename/content signal) | Destination folder | Destination subfolder rule | Content read required? |
|---|---|---|---|---|
| 1 | RBC Business chequing (account …300-3) or RBC Visa Business (…4872) statement or letter | `General Account Bookkeeping\` | `[Year]\[Year-Month]\1. Bank & Credit Card Statements\` — **Month = the file's own date**, not the period the statement covers (a statement dated the 3rd covering the prior month still files under the month it's dated) | Usually not — account tail and doc type are filename/first-page signals |
| 2 | Scotia pooled-trust account (…0419) statement, interest statement, or trustee-designation/attestation correspondence | `Trust Account Bookkeeping\` | `[Year]\` — **flat**, no month or category subfolder. This matches the actual 2024–2025 convention; older years (2016–2023) used month/category subfolders, but that layout was abandoned — do not recreate it for new files | Usually not |
| 3 | BDLC/DorstB ↔ Logica Law fee-share invoice, advance, or payment cheque (`INV#... fee share`, `INV#... advance ... fee share`, `CHQ Logica #...`) | `LOGICA LAW BILLING\` | **loose at root** — no subfolder. The numbered `1A. Logica Law Bills (BILLED)\` / `1B. ... (PAID)\` subfolders are legacy (populated only through ~2022); the working convention since is loose-at-root | Usually not |
| 4 | An invoice/expense whose actual Bill-To / Billing Account is a **different entity than BDLC** (e.g. a Thomson Reuters/Westlaw invoice billed directly to "Logica Law Corp") | follow the **billed entity**, not the vendor or the superficial document type — case by case, per the entity's own folder | *not filename-derivable — open the PDF and check the actual Bill To field.* A generic "general business expense" vendor pattern (Thomson Reuters, Meridian OneCap, Anthropic/Claude, Impark, etc.) is a *default guess*, not a guarantee — confirm it whenever the vendor is one known to sometimes bill Logica Law directly (see `notes/routing-rules.md`), and downgrade to manual review if it can't be confirmed from content | **Yes, always** |
| 5 | A statement, void cheque, or account document for a **personal (non-BDLC) account** — addressed to Brahm Dorst (or another family member) personally at a personal address, or an MBNA Mastercard statement in DorstL's/DorstB's own name rather than BDLC's | `Family\` | loose at root | Usually not |
| 6 | General business-expense invoice/receipt (parking, small SaaS subscriptions, equipment financing, professional subscriptions billed to BDLC) | `General Account Bookkeeping\` | `[Year]\[Year-Month]\6. Business Expenses (paid)\` **if** the document is a receipt (proof of payment already exists) **or** the invoice is more than 30 days old as of the run date; **otherwise** → `...\5. Accounts payable\` | **Yes** — must distinguish receipt vs. unpaid invoice, and read the invoice's own date for the 30-day test against the run date |
| 7 | An internal transfer/receipt recording the General account paying another account or card (including a receipt whose description mentions a personal-sounding card, e.g. "pay Family Visa") | stays in **`General Account Bookkeeping\`** | the month's ad hoc `Receipts\` subfolder, where that month already uses one — it's a record of the General account's own transaction, not a personal document, regardless of what's being paid | Usually not |

**Explicitly not a rule:** a file matching none of the above (e.g. a
content-free screenshot or printout) is **not** filed anywhere by this
profile. Leave it in place and flag it for the practitioner — do not invent
a "misc" bucket.

**Reclassification is human-only.** A subagent must never move a file
already filed as "(paid)" back to "Accounts payable," or vice versa — this
profile's routing rules only ever apply to files still loose at root, so a
file already filed is structurally out of scope; this is stated explicitly
because the rule-6 30-day threshold can pass for an already-filed "payable"
file on a later run, and that alone is never grounds to touch it.

**New-month-folder scaffolding (firm rule):** when a destination
`[Year]\[Year-Month]\` doesn't exist yet, create only the specific numbered
subfolder(s) the matched rule actually calls for (e.g. just
`1. Bank & Credit Card Statements\`) — never the full category template.

## Record backend

**None.** This profile has no review-record backend at all —
`/housekeeping`'s Steps 3b and 6.6 are skipped **unconditionally** for every
run against this profile, not offered as a choice and not a fallback from a
failure. There is no Lookup/Record intent, and no local-cache substitute may
be invented in its place.

This is sound specifically because a route is a *move*: once a file is
routed out of the root (Step 6), it physically leaves the reviewable set and
never resurfaces — the root is self-cleaning, so there is nothing to
remember the way a `rename-in-place` profile must (a file that stays in the
same folder forever needs a remembered verdict, or it is re-opened every
run).

The accepted cost: a file matching **no** routing rule is left in place and
re-flagged **every run** until a human resolves it by hand — this also
re-consumes a Step 3c cap slot and subagent budget each time. If unresolved
leftovers ever approach the 50-file cap, a run works only them; resolving
the leftovers is how a practitioner un-sticks it. This is accepted, not a
defect — do not build a caching workaround for it.

`--force` is a no-op for this profile (there is no record gate to bypass),
and Step 3c's forced-run scoping demand does not apply here — an accounting
run always advances on its own, because routed files leave the root.

## Working files

`route-plan.json` goes in
`ACCOUNTING\AI assisted organization\route-accounting\` — a literal path,
not globbed (unlike a litigation matter, the accounting root is a single
fixed folder once detected, with no ambiguous "lawyer-brief-equivalent"
subfolder to search for). Create `route-accounting\` if absent; overwrite
`route-plan.json` each run. There is no `hashes.json` for this profile —
there is no record backend to hash against.

Do **not** reuse `AI_Processing\` (a sibling folder under
`AI assisted organization\`) — that is a different, already-completed
hand-sort session's own scratch space with its own schema, not this
profile's working directory.
