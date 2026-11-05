---
name: ar-follow-up
disable-model-invocation: true
description: >
  Track accounts receivable and flag clients needing a money conversation — outstanding invoices,
  depleted retainers, and upcoming retainer top-ups.
---

<!-- lawyer v0.25.3 -->
> **Installed copy.** This skill's full source tree ships beside this file, and a relative path in the text below cites that tree. Resolve one by trying, in order: the directory of the file you are reading, then `${CLAUDE_SKILL_DIR}/<path>`, then `${CLAUDE_SKILL_DIR}/../<path>` (so `shared/x.md` is at `${CLAUDE_SKILL_DIR}/../shared/x.md`). The host substitutes `${CLAUDE_SKILL_DIR}` with the directory holding this SKILL.md when this file loads; if the literal text `${CLAUDE_SKILL_DIR}` is what you see, that IS the definition: it means the directory containing this SKILL.md, not a placeholder to search for or guess. Read references and shared files natively from there, never over the litigation data server's skill-source tool and never by requesting folder access; scripts and templates the text declares are executed and read from there too. Before each fresh read (a file not already in context), list only `${CLAUDE_SKILL_DIR}/../../..` (the folder holding this plugin's folder). If it holds this plugin's folder name, with any `~g<N>` suffix removed, plus a `~g<N>` higher than this plugin's folder's own (none counts as 0), or if `${CLAUDE_SKILL_DIR}` no longer exists, the plugin was re-synced mid-session: take the highest `~g<N>` copy and repeat the same three tries with its `skills/<this skill>` directory in place of `${CLAUDE_SKILL_DIR}`; tell the user once that the plugin updated mid-session, from the version in this file's version comment to the version in that folder's copy of this SKILL.md. If a file the text names is missing at every one of those paths, including the re-synced folder's, STOP and report the exact path and error to the user rather than substituting an alternative: do not re-derive a script's logic from its source text or the prose, and do not search elsewhere on the filesystem. Ask the user to reinstall the plugin and fully restart the app; this may fix it, but STOP means stop regardless: do not diagnose further yourself.
> **HTML pages.** Every HTML file this plugin writes is a human interface generated from its databases; an agent never views, reads, greps, parses, scripts over, authors or requests a screenshot of one, but may present one to a human user to view, staging it first where presenting needs that, and may view a screenshot the user provides on their own initiative. The rule and the data to use instead: `shared/html-pages.md`.

**Internals stay confidential** (`shared/internals-confidentiality.md`): nothing the practitioner sees names a Probanda tool, table, field, internal type or code, or explains how Probanda works inside. It hides mechanism, never an outcome or an error.

## Contents

| Section | Read when |
|---|---|
| Design Principles | Always |
| Data Sources (Read-Only) | Before querying any upstream data, or when a source is missing |
| Owned State: Payment-in-Flight | Recording a payment-in-flight, or applying suppression and the clearing window |
| Workflow: Generate AR List | The practitioner asks who needs a money conversation, or asks for the AR list |
| Workflow: Record Payment-in-Flight | The practitioner says a client has sent payment |
| Workflow: Check Single Client | The practitioner asks what a client owes, or for a file's financial picture |
| Queries | Mapping a practitioner question to the workflow or operation to run |
| Integration with Other Skills | Before relying on another skill's data |
| Anti-Patterns | Always, before presenting any result |

# AR Follow-Up

Produce a prioritized list of clients who need a money conversation, consolidating all outstanding amounts into a single ask per client, timed to the court calendar.

## Design Principles

Read `vision.md` for the full design philosophy. The five principles that govern every output:

1. **One Conversation, One Number** — Never surface a client for just one component when other amounts are outstanding. Consolidate invoices + WIP + retainer shortfall + court-date increases into one total.
2. **Time the Ask to the Calendar** — Prioritize by court date proximity, not amount owed.
3. **Suppress During Clearing** — When payment-in-flight is recorded, suppress all reminders for that client until cleared or expired.
4. **Advise on Policy, Not Exceptions** — State what retainer policy requires. Never advise whether to make exceptions.
5. **Show the Math** — Every recommendation cites its components so the practitioner can verify before calling.

## Data Sources (Read-Only)

This skill reads from upstream skills via ``practice-data``. It does not own or modify upstream data.

| Source | What it provides |
|--------|-----------------|
| retainer-tracking | Current trust balance per matter |
| `ar-data` | WIP hours per matter, counting time since that matter's billing cutoff |
| docket-clerk (agent) | Upcoming court dates |
| invoice-tracking | Outstanding invoices |

All data accessed via ``practice-data`` operations — this skill never connects to the database directly.

**Graceful degradation:** When upstream data is unavailable (not yet initialized, no rows, or skill not yet implemented), include what is available and note what is missing. Never fail entirely because one source is absent. Example: if no court dates exist, skip calendar-based prioritization and fall back to amount-based ordering, noting "Court date data unavailable — prioritized by amount only."

## Owned State: Payment-in-Flight

This skill owns payment-in-flight tracking via ``practice-data``'s `manage-payment-in-flight` operation. Payment items are defined by ``practice-data``.

**If recording a payment-in-flight fails:** nothing was saved. If Probanda's Cloud refused it, relay its question to the practitioner; if the cloud could not be reached, say so, and skip suppression logic for that payment. The AR list still functions — it just cannot suppress clients with pending payments.

### Clearing Window

Default clearing window: **5 business days** from `recorded_at`. The practitioner can override when recording.

A payment-in-flight expires (and the client resurfaces) when:
- The clearing window passes without confirmation, OR
- The next retainer-tracking CSV import shows the deposit (retainer-tracking confirms; this skill does not verify deposits)

## Workflow: Generate AR List

1. Query each data source (see queries below)
2. For each client with any outstanding amount, build a consolidated record
3. Apply payment-in-flight suppression
4. Prioritize the list
5. Present results

### Step 1: Query Data Sources

Invoke ``practice-data`` `ar-data` operation to retrieve all non-closed matters with:
- Matter description and identifiers
- Client name and number
- Trust balance and last update date
- WIP hours and entry count, counting only time since the matter's billing cutoff
- The billing cutoff used (`cutoff_date`) and where it came from (`cutoff_source`: `date_to`, `issue_date`, or null when the matter has no invoices on record)
- Payment-in-flight status (amount, recorded date, expected clearing date)

The operation returns every non-closed billable matter, funded or not. It does not filter by trust balance. Sorting matters into funded, low and depleted happens in Steps 3 and 4, from each matter's trust balance. If payment-in-flight data is unavailable, the operation returns results without it — set a flag so suppression logic is skipped.

**Sign convention:** Trust balances are presented as positive numbers to the user. A zero balance means depleted; a non-zero balance means funded. Check the sign convention via ``practice-data``.

### Step 2: Build Consolidated Client Records

Group all data by client. For each client, compute:

| Component | Source | Calculation |
|-----------|--------|-------------|
| Outstanding invoices | invoice-tracking | Sum of unpaid invoice amounts |
| Unbilled WIP | `ar-data` | Hours since the billing cutoff × hourly rate (ask practitioner for rate if unknown) |
| Current trust balance | retainer-tracking | Amount currently held in trust |
| Retainer shortfall | Retainer policy | Required retainer minus current trust balance |
| Court-date increase | docket-clerk (agent) | Additional retainer required for upcoming hearing/trial |
| **Total ask** | All above | Outstanding invoices + unbilled WIP + retainer shortfall + court-date increase |

If a component is unavailable, omit it from the total and note it in the output.

**Unbilled WIP states its period.** Show the WIP figure with the date it runs from (`cutoff_date`). When `cutoff_source` is `issue_date`, add: "Cutoff based on invoice issue date — actual billing period end may differ." When the cutoff is null, add: "no invoices on record, all time shown".

### Step 3: Retainer Policy Rules

Apply BC litigation retainer policy to determine required retainer level. These defaults reflect typical BC Supreme Court timelines — the practitioner can override any threshold per matter.

| Upcoming event | Default retainer requirement | Request window | Due by | Rationale |
|---------------|----------------------------|----------------|--------|-----------|
| Trial | Practitioner-defined per matter (no default — ask) | 120+ days before trial | 90 days before trial | 90-day window allows time for withdrawal application if client does not fund; 120-day request gives 30 days for the client to respond and funds to clear |
| Hearing (per day) | $5,000/hearing-day | 28+ days before hearing | 14 days before hearing | 14-day due date allows a 10-business-day clearing window plus buffer; 28-day request gives the client 14 days to act |
| No upcoming dates | $3,000 base retainer (practitioner-adjustable) | When trust reaches $0 | Ongoing | Minimum working retainer to cover routine disbursements and 10-15 hours of work at typical rates |

**When the practitioner has not set a per-matter trial retainer amount:** prompt them to specify one rather than guessing. State: "Trial retainer amount not set for [matter]. What amount should I use for future calculations?"

**Policy advisory** — based on the financial picture, state the applicable policy:

- **Retainer funded, no action needed** — trust balance covers requirements
- **Retainer low, replenishment recommended** — trust balance below required level but work can continue
- **Retainer depleted, policy requires cease work** — `regular_trust = 0`, no payment in flight. State the policy; do not advise on exceptions.
- **Consider withdrawal** — retainer depleted AND client unresponsive to prior requests. State policy only.

### Step 4: Prioritization

Rank clients by urgency, not amount. Calendar proximity always outranks dollar amounts — a $3,000 shortfall with a hearing in 2 weeks outranks a $10,000 balance with no upcoming dates.

| Tier | Criteria | Sort keys (within tier) |
|------|----------|------------------------|
| 1 | Court date within 30 days + retainer shortfall | Days to court date ASC, then total ask DESC |
| 2 | Court date within 120 days + retainer shortfall | Days to court date ASC, then total ask DESC |
| 3 | Retainer depleted ($0 trust), no court date | Total ask DESC |
| 4 | Retainer low (below policy threshold), no court date | Shortfall as % of required DESC |
| 5 | Unbilled WIP only (retainer adequate) | WIP amount DESC |
| 6 | Outstanding invoices only | Invoice age DESC (oldest first) |

**Implementation:** Assign each client a `(tier, sort_key_1, sort_key_2)` tuple and sort once. A single `sorted()` call with this composite key produces the final list — no multi-pass sorting needed.

```python
# Example: tier assignment + sort
def priority_key(client):
    if client['nearest_court_days'] is not None and client['nearest_court_days'] <= 30 and client['shortfall'] > 0:
        return (1, client['nearest_court_days'], -client['total_ask'])
    elif client['nearest_court_days'] is not None and client['nearest_court_days'] <= 120 and client['shortfall'] > 0:
        return (2, client['nearest_court_days'], -client['total_ask'])
    elif client['trust_balance'] == 0:
        return (3, -client['total_ask'], 0)
    elif client['shortfall'] > 0:
        return (4, -client['shortfall_pct'], 0)
    elif client['wip_amount'] > 0:
        return (5, -client['wip_amount'], 0)
    else:
        return (6, -client['invoice_age_days'], 0)

ranked = sorted(clients_with_amounts, key=priority_key)
```

**When court dates are unavailable:** Skip tiers 1-2 entirely and note "Court date data unavailable — prioritized by retainer status and amount only." Clients that would otherwise be tier 1-2 fall to tier 3 or 4 based on their retainer status.

### Step 5: Present Results

```
AR Follow-Up — [Date]
Data as of: trust balances [last_trust_date], WIP [latest time entry date]
[Note any missing data sources]

Priority  Client              Total Ask    Breakdown                           Due By      Policy
───────── ─────────────────── ──────────── ─────────────────────────────────── ─────────── ──────────────────
1         Smith (C1234)       $8,200       $800 invoice + $2,400 WIP          2026-05-15  Cease work pending
                                           (since 2026-03-01) +                           replenishment
                                           $5,000 trial retainer
2         Doe (C5678)         $5,000       $5,000 hearing retainer            2026-04-28  Replenishment needed
                                           (trust: $0)
3         Jones (C9012)       $3,000       $3,000 base retainer               —           Replenishment needed
                                           (trust: $0, no court dates)

[Suppressed: Lee (C3456) — payment-in-flight $2,500, recorded 2026-04-12, clears by 2026-04-19]
```

Always show the suppressed clients at the bottom so the practitioner knows they exist but are being held.

## Workflow: Record Payment-in-Flight

When the practitioner says a client has sent payment (e.g., "Smith sent an e-transfer for $2,500"):

1. Resolve the matter by client name or number
2. Record the payment in flight through ``practice-data`` `manage-payment-in-flight` (`record`): amount, `recorded_at = now`, `expected_clear_by = now + 5 business days`
3. Confirm: "Recorded: Smith (C1234) — $2,500 payment in flight. Suppressing reminders until [clear-by date]. The next trust CSV import will confirm when it clears."

## Workflow: Check Single Client

When asked "what does Smith owe?" or "financial picture for file L8948":

1. Query all data sources for that client/matter
2. Build the consolidated record (same as Step 2 above)
3. Present the full breakdown with all components and the math

```
Smith (C1234) — File L8948 (Smith v Jones)

Current trust balance:     $0.00 (depleted, as of 2026-04-01)
Outstanding invoices:      $800.00 (Invoice #1234, issued 2026-03-15)
Unbilled WIP:             $2,400.00 (12.0 hrs @ $200/hr, since 2026-03-01)
Retainer required:         $5,000.00 (trial 2026-08-15 — $5,000/day x 1 day)
                          ──────────
Total ask:                 $8,200.00
Due by:                    2026-05-15 (90 days before trial)

Policy: Retainer depleted. Cease work pending replenishment. Trial in 123 days.

Payment-in-flight:         None
```

When the cutoff came from an invoice issue date, or the matter has no invoices, the WIP line reads:

```
Unbilled WIP:             $2,400.00 (12.0 hrs @ $200/hr, since 2026-03-01)
                          Cutoff based on invoice issue date — actual billing period end may differ.
Unbilled WIP:             $2,400.00 (12.0 hrs @ $200/hr; no invoices on record, all time shown)
```

## Queries

| Question | Action |
|----------|--------|
| Who needs a money conversation? | Full AR list workflow |
| Show the AR list | Full AR list workflow |
| What does [client] owe? | Single client workflow |
| Financial picture for [file] | Single client workflow |
| [Client] sent payment of $X | Record payment-in-flight |
| Has [client]'s payment cleared? | Invoke ``practice-data`` `manage-payment-in-flight` to check status. If pending, show status. If no record, say "No payment-in-flight recorded. Check retainer-tracking for the latest trust balance." |
| Clear [client]'s payment-in-flight | Invoke ``practice-data`` `manage-payment-in-flight` to mark cleared. Note: normally retainer-tracking's next CSV import handles this automatically. |
| Which files are at risk for [upcoming hearing/trial]? | AR list filtered to clients with court dates |

## Integration with Other Skills

| Skill | Relationship |
|-------|-------------|
| **retainer-tracking** | Provides current trust balances and confirms deposits via CSV import |
| **docket-clerk** (agent) | Provides court dates for calendar-based prioritization |
| **invoice-tracking** | Provides outstanding invoice data |
| **practice-data** | Owns schema and path resolution. Payment-in-flight operations: `manage-payment-in-flight`. |

## Anti-Patterns

- **Surfacing a client for one component** when other amounts are also outstanding. Always consolidate first.
- **Ranking by amount owed** instead of court date urgency. A $3,000 shortfall with a hearing in 2 weeks outranks a $10,000 balance with no upcoming dates.
- **Sending reminders during clearing.** If payment-in-flight is recorded, suppress that client entirely.
- **Advising on exceptions to policy.** Say "Policy requires cease work" not "You should stop working on this file."
- **Treating absence as zero.** No matter record = retainer status unknown, not depleted. No time entries = WIP unknown, not zero. Flag unknowns explicitly.
- **Querying upstream CSVs directly.** All data comes through the practice database. Never parse accounting CSVs.
