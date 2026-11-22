---
name: ar-follow-up
disable-model-invocation: true
description: >
  Use when tracking accounts receivable or checking what clients owe —
  consolidates unpaid invoices, unbilled WIP, depleted retainers, and upcoming
  court-date retainer top-ups into one prioritized ask per client.
metadata:
  author: Probanda
  tags:
    - billing
    - accounts-receivable
    - retainers
    - legal-practice
---

**Internals stay confidential** (`shared/internals-confidentiality.md`): nothing the practitioner sees names a Probanda tool, table, field, internal type or code, or explains how Probanda works inside. It hides mechanism, never an outcome or an error.

## Contents

| Section | Read when |
|---|---|
| Purpose & Design Principles | Always |
| Prerequisites & Data Sources | Before querying upstream data, or when a source is missing |
| Owned State: Payment-in-Flight | Recording a payment-in-flight, or applying suppression and the clearing window |
| Instructions | Running the AR list, recording payment-in-flight, checking one client, or mapping queries |
| Examples | Formatting the AR list or a single-client breakdown |
| Integration with Other Skills | Before relying on another skill's data |
| Limitations & Troubleshooting | When a source is missing, a write fails, or a request is out of scope |
| Anti-Patterns | Always, before presenting any result |

# AR Follow-Up

## Purpose

Produce a prioritized list of clients who need a money conversation, consolidating all outstanding amounts into a single ask per client, timed to the court calendar.

Read `vision.md` for the full design philosophy. Five principles govern every output:

1. **One Conversation, One Number** — Never surface a client for one component when other amounts are outstanding. Consolidate invoices + WIP + retainer shortfall + court-date increases into one total.
2. **Time the Ask to the Calendar** — Prioritize by court date proximity, not amount owed.
3. **Suppress During Clearing** — When payment-in-flight is recorded, suppress all reminders for that client until cleared or expired.
4. **Advise on Policy, Not Exceptions** — State what retainer policy requires. Never advise whether to make exceptions.
5. **Show the Math** — Every recommendation cites its components so the practitioner can verify before calling.

## Prerequisites

This skill reads upstream data exclusively via ``practice-data`` operations (it never connects to a database or parses accounting CSVs directly) and owns payment-in-flight tracking via ``practice-data``'s `manage-payment-in-flight` operation.

| Upstream Source | What it provides |
|---|---|
| retainer-tracking | Current trust balance per matter |
| `ar-data` | WIP hours per matter since that matter's billing cutoff |
| docket-clerk (agent) | Upcoming court dates |
| invoice-tracking | Outstanding invoices |

**Graceful degradation:** When an upstream source is unavailable (not yet initialized, no rows, or not yet implemented), include available data and note what is missing. Never fail entirely because one source is absent (e.g., if court dates are unavailable, fall back to retainer status and amount ordering and note `"Court date data unavailable — prioritized by retainer status and amount only."`).

## Owned State: Payment-in-Flight

Payment-in-flight records are managed through ``practice-data``'s `manage-payment-in-flight` operation.

- **Default clearing window:** **5 business days** from `recorded_at` (practitioner can override when recording).
- **Expiry:** A payment-in-flight expires and the client resurfaces when:
  - The clearing window elapses before a deposit is confirmed, OR
  - The next retainer-tracking CSV import shows the deposit (retainer-tracking confirms; this skill does not verify deposits).

## Instructions

### Generate AR List

1. Query upstream data sources via ``practice-data``
2. Build a consolidated record for each client with any outstanding amount
3. Apply retainer policy rules and payment-in-flight suppression
4. Prioritize the list by court-date urgency
5. Present results with component math and suppressed clients listed at the bottom

#### Step 1: Query Data Sources

Invoke ``practice-data`` `ar-data` to retrieve all non-closed billable matters (funded or not — it does not filter by trust balance) with:
- Matter description, identifiers, client name, and client number
- Trust balance and last update date (presented as positive numbers; zero = depleted, non-zero = funded; confirm sign convention via ``practice-data``)
- WIP hours and entry count since the matter's billing cutoff, plus `cutoff_date` and `cutoff_source` (`date_to`, `issue_date`, or null when no invoices exist)
- Payment-in-flight status (amount, recorded date, expected clearing date); if unavailable, set a flag to skip suppression

#### Step 2: Build Consolidated Client Records

Group by client and compute:

| Component | Source | Calculation |
|---|---|---|
| Outstanding invoices | invoice-tracking | Sum of unpaid invoice amounts |
| Unbilled WIP | `ar-data` | Hours since billing cutoff × hourly rate (ask practitioner if rate unknown) |
| Current trust balance | retainer-tracking | Amount currently held in trust |
| Retainer shortfall | Retainer policy | Required retainer minus current trust balance |
| Court-date increase | docket-clerk (agent) | Additional retainer required for upcoming hearing/trial |
| **Total ask** | All above | Outstanding invoices + unbilled WIP + retainer shortfall + court-date increase |

Omit unavailable components from the total and note them. Always state the WIP period (`cutoff_date`):
- If `cutoff_source` is `issue_date`, add: `"Cutoff based on invoice issue date — actual billing period end may differ."`
- If cutoff is null, add: `"no invoices on record, all time shown"`.

#### Step 3: Retainer Policy Rules

Apply BC litigation retainer defaults (practitioner can override any threshold per matter):

| Upcoming event | Default requirement | Request window | Due by | Rationale |
|---|---|---|---|---|
| Trial | Practitioner-defined per matter (no default — ask) | 120+ days before trial | 90 days before trial | 90-day window allows withdrawal application if unfunded; 120-day request gives 30 days to clear |
| Hearing (per day) | CAD 5,000/hearing-day | 28+ days before hearing | 14 days before hearing | 14-day due date allows 10-business-day clearing plus buffer |
| No upcoming dates | CAD 3,000 base retainer | When trust reaches CAD 0 | Ongoing | Covers routine disbursements and 10–15 hours of work |

If no per-matter trial retainer is set, do not guess — ask: `"Trial retainer amount not set for [matter]. What amount should I use for future calculations?"`

State the applicable policy (never advise on exceptions):
- **Retainer funded, no action needed** — trust covers requirements
- **Retainer low, replenishment recommended** — below required level, work can continue
- **Retainer depleted, policy requires cease work** — `regular_trust = 0`, no payment in flight
- **Consider withdrawal** — retainer depleted and client unresponsive to prior requests

#### Step 4: Prioritization

Calendar proximity always outranks dollar amounts (e.g., a CAD 3,000 shortfall with a hearing in 2 weeks outranks a CAD 10,000 balance with no upcoming dates). Assign `(tier, sort_key_1, sort_key_2)` and sort once (see `references/prioritization.md` for the Python `priority_key` reference):

| Tier | Criteria | Sort keys (within tier) |
|---|---|---|
| 1 | Court date within 30 days + retainer shortfall | Days to court date ASC, total ask DESC |
| 2 | Court date within 120 days + retainer shortfall | Days to court date ASC, total ask DESC |
| 3 | Retainer depleted (CAD 0 trust), no court date | Total ask DESC |
| 4 | Retainer low (below policy threshold), no court date | Shortfall % of required DESC |
| 5 | Unbilled WIP only (retainer adequate) | WIP amount DESC |
| 6 | Outstanding invoices only | Invoice age DESC (oldest first) |

When court dates are unavailable, skip tiers 1–2 and note that prioritization reflects retainer status and amount only.

### Record Payment-in-Flight

When the practitioner says a client has sent payment (e.g., `"Smith sent an e-transfer for CAD 2,500"`):
1. Resolve the matter by client name or number.
2. Record via ``practice-data`` `manage-payment-in-flight` (`record`): amount, `recorded_at = now`, `expected_clear_by = now + 5 business days`.
3. Confirm: `"Recorded: Smith (C1234) — CAD 2,500 payment in flight. Suppressing reminders until [clear-by date]. The next trust CSV import will confirm when it clears."`

### Check Single Client

When asked `"what does Smith owe?"` or `"financial picture for file L8948"`:
1. Query all data sources for that client/matter.
2. Build the consolidated record (same as Step 2).
3. Present the full breakdown with every component and the math (see `## Examples` and `references/prioritization.md`).

### Queries

| Question | Action |
|---|---|
| Who needs a money conversation? / Show the AR list | Full AR list workflow |
| What does [client] owe? / Financial picture for [file] | Single client workflow |
| [Client] sent payment of CAD X | Record payment-in-flight |
| Has [client]'s payment cleared? | Check `manage-payment-in-flight` status; if none, say `"No payment-in-flight recorded. Check retainer-tracking for the latest trust balance."` |
| Clear [client]'s payment-in-flight | Mark cleared via `manage-payment-in-flight` (note: retainer-tracking's next CSV import normally handles this automatically) |
| Which files are at risk for [upcoming hearing/trial]? | AR list filtered to clients with court dates |

## Examples

### AR List Output

Always list suppressed clients at the bottom so the practitioner knows they are held:

```text
AR Follow-Up — [Date]
Data as of: trust balances [last_trust_date], WIP [latest time entry date]
[Note any missing data sources]

Priority  Client        Total Ask    Breakdown                                            Due By      Policy
───────── ───────────── ──────────── ──────────────────────────────────────────────────── ─────────── ───────────────────────
1         Smith (C1234) CAD 8,200    CAD 800 invoice + CAD 2,400 WIP (since 2026-03-01)   2026-05-15  Cease work pending
                                     + CAD 5,000 trial retainer                                       replenishment
2         Doe (C5678)   CAD 5,000    CAD 5,000 hearing retainer (trust: CAD 0)            2026-04-28  Replenishment needed
3         Jones (C9012) CAD 3,000    CAD 3,000 base retainer (trust: CAD 0, no dates)     —           Replenishment needed

[Suppressed: Lee (C3456) — payment-in-flight CAD 2,500, recorded 2026-04-12, clears by 2026-04-19]
```

### Single-Client Financial Picture

```text
Smith (C1234) — File L8948 (Smith v Jones)

Current trust balance:     CAD 0.00 (depleted, as of 2026-04-01)
Outstanding invoices:      CAD 800.00 (Invoice #1234, issued 2026-03-15)
Unbilled WIP:              CAD 2,400.00 (12.0 hrs @ CAD 200/hr, since 2026-03-01)
Retainer required:         CAD 5,000.00 (trial 2026-08-15 — CAD 5,000/day x 1 day)
                           ────────────
Total ask:                 CAD 8,200.00
Due by:                    2026-05-15 (90 days before trial)

Policy: Retainer depleted. Cease work pending replenishment. Trial in 123 days.
Payment-in-flight:         None
```

See `references/prioritization.md` for `issue_date` and no-invoice WIP line formatting.

## Integration with Other Skills

| Skill | Relationship |
|---|---|
| **retainer-tracking** | Provides current trust balances and confirms deposits via CSV import |
| **docket-clerk** (agent) | Provides court dates for calendar-based prioritization |
| **invoice-tracking** | Provides outstanding invoice data |
| **practice-data** | Owns schema, path resolution, and `manage-payment-in-flight` |

## Limitations

- **Read-only on upstream data:** Cannot import trust CSVs, modify invoices, or confirm bank deposits (retainer-tracking confirms cleared deposits).
- **No client correspondence:** Surfaces who to ask, how much, and when — does not draft retainer letters or emails.
- **Policy only, no exception advice:** Reports what retainer policy requires; exception decisions belong to the practitioner.
- **Bound by upstream freshness:** Accuracy depends on the latest trust import, invoice import, time entries, and court dates.

## Troubleshooting

| Symptom / Error | Cause | Solution |
|---|---|---|
| Payment-in-flight record fails to save | Probanda's Cloud refused the write, or cloud is unreachable | Nothing was saved. Relay the cloud's question if refused, or report that the cloud could not be reached and skip suppression for that payment; the AR list still runs. |
| Court date data missing | `docket-clerk` has no rows or is unavailable | Skip tiers 1–2, prioritize by retainer status and amount, and note court dates are unavailable. |
| Trial retainer amount unknown | No per-matter trial retainer configured | Prompt the practitioner for the amount instead of assuming a default. |
| Hourly rate missing for WIP | Matter has WIP hours but no rate on record | Ask the practitioner for the hourly rate before totalling unbilled WIP. |

## Anti-Patterns

- **Surfacing a client for one component** when other amounts are outstanding. Always consolidate first.
- **Ranking by amount owed** instead of court date urgency.
- **Sending reminders during clearing.** Suppress clients with active payment-in-flight.
- **Advising on exceptions to policy.** Say `"Policy requires cease work"`, not `"You should stop working on this file."`
- **Treating absence as zero.** No matter record = retainer status unknown; no time entries = WIP unknown. Flag unknowns explicitly.
- **Querying upstream CSVs directly.** All data comes through ``practice-data``. Never parse accounting CSVs.
