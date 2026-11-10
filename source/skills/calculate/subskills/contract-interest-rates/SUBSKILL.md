---
name: contract-interest-rates
description: >
  Calculate interest owed under a contract's own interest term -- a promissory note, loan
  agreement, mortgage, or pleaded interest clause -- whether a fixed rate or one pegged to a
  bank benchmark such as "prime plus X%". Also use when asked where a pleaded interest rate or
  percentage came from. NOT for statutory BC Court Order Interest Act interest, including
  ordinary pre- and post-judgment interest: use the `court-interest-calculator` subskill.
---

# Contract interest rates

Calculate interest owed under a contract's own interest term, where that term is pegged to
a bank benchmark rate (most commonly "prime plus a spread") rather than to the BC Court Order
Interest Act. A contractual rate is whatever the parties agreed to, proven by the contract's
wording and, where the rate floats, by the benchmark's own published history over the
interest period.

## Why this is a different problem than court-interest-calculator

The `court-interest-calculator` subskill calculates interest off a fixed, publicly-set table
of BC Court rates that changes every six months. Here there is no table. The rate has to be
read out of the contract, classified as fixed or floating -- a real determination that
changes the math completely and is often not spelled out -- and, where it floats, run
against the benchmark's own published history. Steps 1 to 3 below are those three jobs.
Skipping any of them produces a plausible-looking figure tied to neither what the contract
says nor what the bank rate did.

## Workflow

### 1. Find and pin down the contract's interest term

Ask `matter-data` to identify matter sources that may contain the executed agreement and related
instruments; also inspect documents attached or quoted in the current session. Do not embed
matter-data storage, query, or tool particulars here—the gatekeeper owns source discovery.

Before calculating, establish whether the following are available: the executed agreement,
supplementary conditions, schedules, appendices, change orders, and later written amendments.
If `matter-data` does not locate the executed agreement, ask whether it exists elsewhere in the
matter folder. Read the whole available source set for provisions that delete, replace, or
modify the interest term. The base clause alone is not the operative term when another
instrument changes it.

On a default judgment those sources rank by what is *proved*, not merely by accuracy: read
`references/default-judgment-proof.md` before calculating. A pleaded interest term remains a
paraphrase awaiting verification while an available executed agreement is unread. If the
agreement cannot be obtained or the practitioner directs the work to proceed first, label the
fixed/floating classification, compounding treatment, assumptions, and every resulting total
**provisional on the face of the output**.

Before calculating, quote each operative interest provision and each amending provision
separately, in full, with its own pinpoint. Never use ellipses to remove language affecting a
rate tier, timing, benchmark, fixed/floating treatment, day-count, payment allocation, or
compounding. Then state the combined operative reading separately. If that reading depends on
an inference—for example, that an amendment leaves another sentence untouched—identify the
inference expressly.

Surface and ask about any ambiguity that could materially change the total. This includes
fixed-versus-floating treatment; the benchmark's identity or anchor date; the accrual start
date; the first capitalization date and its recurrence when the contract says only
"compounded monthly"; and the contractual day-count basis. Do not silently supply a
convention. Invoked from inside a skill that bars questions, raise the ambiguity through that
skill's practitioner surface rather than opening an interaction its pipeline cannot accept.

When the practitioner's answer relies on a factual premise about the outside world—how a bank
publishes its prime rate, what a benchmark history shows, or what a published calculation
convention means—verify that premise before using it. A bank's quoted annual benchmark does
not itself establish a compounding convention; compounding must come from the operative
contract words. If a source contradicts the premise or an answer contradicts the document,
report the contradiction as a new ambiguity instead of silently following or correcting it.
After disclosure, an expressly directed hypothetical may be calculated, but label both the
inputs and result as assumption-based.

When a benchmark rate or date comes from a **pleading**, rather than from the contract itself,
cross-check the pleaded date/rate pair against the benchmark's actual history before
calculating. On a mismatch, report the discrepancy as a distinct finding, give the
likely-correct reading where primary history supports one, and ask which figure governs. Do
not silently repair the pleading or calculate from a known mismatch.
### 2. Classify: fixed or floating

Read `references/fixed-vs-floating.md` for the language patterns that distinguish the two and
worked examples of each. In short:

- **Fixed** -- the clause anchors the rate to the benchmark on one specific date (signing,
  the date of default, the date of the notice of civil claim) and the number does not move
  again after that. Once you know that one date's benchmark rate, the whole calculation is a
  single flat rate for the whole period -- structurally identical to a fixed-rate run of the
  `court-interest-calculator` subskill.
- **Floating** -- the clause ties the rate to the benchmark as it exists "from time to time"
  or "as adjusted by the Bank," so the effective rate changes every time the benchmark does,
  for the whole interest period. This requires the full rate history and a sub-period
  calculation (step 4).

State your classification and the clause language it rests on before moving on.

### 3. Get the benchmark rate(s)

Read `references/bank-prime-rate-sources.md` for where to find a given bank's published prime
rate and prime rate history, and which source to prefer. Canadian bank prime rates track each
other closely but are not identical to the US prime rate -- never substitute a US prime-rate
series (e.g. FRED's `PRIME`) for a Canadian bank's own published rate.

When delegating benchmark-history research to a subagent, require URLs on the
bank's own domain, accept aggregators only as locators, and state any JavaScript-rendering
constraint so the subagent does not spend its run on empty text fetches. The main
session must still verify every returned article/date/rate pairing under the reference's
pairing-verification rule.

- **Fixed rate:** fetch the single rate in effect on the anchor date.
- **Floating rate:** fetch every rate-change date and the rate that took effect on it, for the
  full interest period (plus the rate in effect immediately before the period starts, so the
  first sub-period has a rate). Build an ordered list of `{effective_date, rate}`.

### 4. Calculate

Use `subskills/contract-interest-rates/scripts/calculate_contract_interest.py`. Its four positional arguments retain the
original fixed/floating simple-interest interface and exact no-flag output:

```bash
python3 subskills/contract-interest-rates/scripts/calculate_contract_interest.py <principal> <start_date> <end_date> '<rate_schedule_json>' [options]
```

- `principal`: the opening amount in dollars.
- `start_date` / `end_date`: the inclusive interest period, `YYYY-MM-DD`.
- `rate_schedule_json`: an ascending JSON array of
  `{"effective_date": "YYYY-MM-DD", "rate": <annual percent including spread>}`. It must
  contain the rate in force on or before `start_date`; duplicate effective dates are invalid.
- `--compound none|monthly`: defaults to `none`.
- `--first-rest-date YYYY-MM-DD`: required exactly when monthly compounding is selected. It is
  the first date whose **opening** balance includes interest accrued through the previous day.
  An October 15 anniversary rest therefore capitalizes before October 15 interest; a calendar
  month-end rest is represented by the first day of the next month. Monthly recurrence keeps
  the anchor day, clamps in shorter months, and returns to the anchor day afterward.
- `--payment DATE AMOUNT`: repeatable in either mode. Payments occur at the start of the stated
  day and payments sharing a date are aggregated.

On any date carrying multiple events, the calculator activates a rate change first, applies
payments to uncapitalized interest, then capitalized interest, then original principal,
capitalizes remaining accrued interest on a rest date, and finally accrues that day's interest
on the post-payment, post-capitalization balance. It rejects invalid dates or amounts,
payments outside the period, overpayments, reversed periods, and invalid rate schedules.

The calculator uses `Decimal`, a 365-day basis, full-precision carry-forward, and
`ROUND_HALF_UP` only for displayed and final currency. When compounding or payments are used,
retain its line-by-line ledger: opening balances, dates, rates, inclusive days, accruals,
payment allocation, capitalization events, closing balances, total interest, total payments,
and ending balance. Do not replace that auditable carry-forward with a bare total.

The calculator ledger (above) is the artifact.
### 5. Report the result, showing the work

Report principal, period, classification (fixed/floating) and why, each sub-period's dates,
rate, inclusive days, and interest, the total, and every source cited. Quote each operative
interest provision and amendment completely and separately with its pinpoint; do not elide
language affecting the calculation. State the combined operative reading separately and
label every inference or assumption. For each benchmark entry, provide the bank's own URL
and access date.

Where the executed agreement remains unread, place the provisional label beside the
classification and totals, not only in background prose. A contractual interest figure is
only as trustworthy as its source set and rate history: never hand back a bare total without
the breakdown and sources, even when the caller asks only for the total. For a default
judgment, follow `references/default-judgment-proof.md`: pinpoint-cited pleaded passages and
inputs separated by evidentiary standing.

If the rate history will be sworn or filed, read
`references/evidencing-rate-changes.md` before drafting exhibit references. It defines the
affidavit content pattern and capture protocol; the form itself remains a forms-skill handoff.
## Where this hands off

- **Whether the contractual rate survives into post-judgment interest is a HARD STOP.** It is
  a statement of law, and this skill does not make one. Do not calculate a post-judgment
  period on the contractual rate, do not calculate one on the statutory rate, and do not
  report a total that silently spans judgment. Stop, route the question to
  `/researcher:legal-research`, and calculate only what its answer supports. A calculation
  that ran first and asked afterwards is the defect this stop exists to prevent -- the number
  is already in the practitioner's hands by then.

  This is a stop rather than a warning because the answer has consistently gone *against* the
  intuitive default. The Court Order Interest Act's Part 1 (prejudgment) carries an express
  contracting-out provision at s. 2(b); its Part 2 (postjudgment, ss. 7-9) carries no
  analogue, and s. 7(2) applies the statutory rate to a pecuniary judgment. Section 8 is the
  only route to a different postjudgment rate and it is a discretion, exercised by the court
  of original jurisdiction on the application of a person affected -- and s. 3, which is what
  lets a registrar act at all on a default order, gives the registrar the court's powers
  "under this Part", meaning Part 1 only. Treat all of that as the reason the question is
  worth routing, never as the answer: it is the statutory text, and how it applies to a given
  contract is what `/legal-research` is for.
- **Once a court or the parties have settled on the applicable post-judgment rate**, run
  that period through the `court-interest-calculator` subskill if it is the statutory rate, or
  through this skill again if the contractual rate was preserved.
- **Drafting or reviewing the pleading/affidavit language** that states the interest figure is
  outside this skill's scope -- it calculates and sources the number; drafting the document
  that uses it belongs to whatever forms or correspondence skill is doing that drafting.
