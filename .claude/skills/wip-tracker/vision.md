# WIP Tracker — Vision & Design Philosophy

**Date:** 2026-04-23

## 1. Theme & Design Philosophy

### Vision Statement

wip-tracker is the authoritative source of unbilled work-in-progress per matter. For each active matter, it identifies the billing cutoff date — the day after the last date billed on the most recent invoice — sums time entries recorded since that date, calculates retainer headroom (trust balance minus unbilled WIP), and flags matters with a funded retainer but no recorded activity in over 15 days. It reports to the practitioner. No other skill invokes it: skills that need hours read them from practice-data.

### Design Principles

**1. Never serve a wrong WIP total.**
Accuracy is the only thing the practitioner asks of wip-tracker. A wrong number — whether understated because entries were missed or overstated because already-billed entries were included — leads the practitioner to bill too late or ask the client for the wrong amount. When data is incomplete or ambiguous, surface the uncertainty explicitly rather than guessing.

**2. Unknown is not zero.**
A matter with no time entries recorded since the billing cutoff is not a matter with $0 in WIP — it may be a matter where work was done but entries were never added. When a matter has a funded retainer and no recorded activity for more than 15 days since the last billed date, report "no data recorded since [date]" rather than $0. Silence from the database is not the same as absence of work.

**3. Show the period, not just the total.**
Every WIP figure is meaningless without its time anchor. Always report the billing cutoff date alongside the WIP total: "Feb 1 – present: $2,400." The practitioner needs this context to evaluate whether the number is reasonable.

**4. Surface failures explicitly — never silently skip.**
If the billing cutoff date cannot be determined (no invoice on record for a matter), say so. If the retainer balance is unavailable, say so. Do not substitute zero, a default, or a guess. The practitioner cannot act on a gap they cannot see.

### Litmus Test

*Does this feature help establish or report the accurate unbilled WIP total and retainer headroom for a matter?*

- **Yes → in scope:** Calculating WIP from time entries since the billing cutoff. Reporting the billing period start date. Comparing WIP to the trust balance. Flagging suspicious silence on active-retainer matters.
- **No → out of scope:** Drafting or editing time entries. Generating invoices. Recommending when to bill. Calculating billing rates or applying HST. Deciding which matters to prioritize.


## 2. Purpose

### Audience

A BC litigation lawyer running a small practice — one to three lawyers — who manages retainer-funded client files and bills periodically. They track time in a separate system (LEAP, TimeCamp) and need a consolidated view of what has accumulated since the last invoice before they can decide when and how much to bill.

### Pain Points

**Retainer overrun discovered at billing time.** The practitioner has been actively working a file for six weeks since the last invoice. When they sit down to bill, they discover the accumulated work exceeds the retainer balance. The client must be asked for a top-up after the fact — an awkward conversation that could have been avoided with earlier visibility.

**Invoice prep is a manual reconciliation exercise.** At month-end, the practitioner opens each active matter and manually checks whether there are time entries since the last invoice. There is no consolidated view of which files have unbilled work sitting on them.

### Value Proposition

wip-tracker gives the practitioner a single, reliable answer to "how much unbilled work is on this file, and is there enough retainer to cover it?" Before, that answer required manually opening each matter and doing arithmetic.

### Killer Use Case

The practitioner asks for a WIP report at the start of the week. One file — Jones v. Ames — shows $3,800 in unbilled WIP against a $4,200 trust balance, with the billing period running since March 3. Another file shows "no data recorded since March 15" despite a $5,000 funded retainer. wip-tracker surfaces both: one as approaching the retainer ceiling, the other as a suspicious gap requiring investigation. The practitioner addresses both before they become problems — no end-of-month surprise.


## 3. North Star

The practitioner never needs to second-guess the number. Operationally: the WIP figure wip-tracker reports for any matter equals what a practitioner would calculate by hand from the same time entries — no more, no less.

A secondary signal: the 15-day suspicious-silence flag surfaces actionable gaps that would otherwise be invisible until invoice prep.


## 4. Non-Goals

- **Drafting or editing time entries** — that is time-entry-drafting's role; wip-tracker reads entries, it does not create them.
- **Invoice generation or billing calculations** — applying rates, calculating HST, or producing invoice documents belongs to invoice-tracking and billing-summary.
- **Billing recommendations** — wip-tracker does not tell the practitioner when to bill or whether to write off work; it surfaces the data, the practitioner decides.
- **Trust accounting or LSBC compliance reporting** — wip-tracker informs practice management decisions, not bookkeeping or regulatory obligations.
- **Predictive or trend analysis** — litigation work volume is irregular; wip-tracker reports what has accumulated, not what will accumulate.


## 5. Foundations

**wip-tracker reads from the shared practice database; it does not own a separate data store.**
Time entries and invoices are governed by practice-data. wip-tracker reads them through `/practice-data`; it does not duplicate or cache them elsewhere. This keeps the single source of truth in one place and ensures that entries added by time-entry-drafting are immediately visible to wip-tracker without a sync step.

**The billing cutoff date is derived from invoice records, not hardcoded or assumed.**
The WIP period start is always calculated as the day after the `date_to` field on the most recent invoice for that matter in invoice-tracking. If no invoice exists, wip-tracker must say so — it does not substitute a default date or assume the matter's open date.

**Retainer headroom is a derived output, not stored state.**
wip-tracker calculates retainer headroom (trust balance minus unbilled WIP) on demand by combining its WIP total with the current balance from retainer-tracking. It does not store a pre-computed headroom figure. This ensures that a retainer replenishment recorded in retainer-tracking is immediately reflected in the next wip-tracker query.


## 6. Anti-Patterns

*No anti-patterns documented yet — add entries here as they are discovered empirically.*
