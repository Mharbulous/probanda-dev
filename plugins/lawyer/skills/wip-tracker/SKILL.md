---
name: wip-tracker
disable-model-invocation: true
description: Authoritative source of unbilled work-in-progress per matter. Use for WIP, unbilled time, accumulated hours, retainer headroom, burn rate, whether a retainer can cover pending work, or which files have unbilled time or are near their retainer ceiling.
---

<!-- lawyer v0.23.0 -->
> **Installed copy.** This skill's full source tree ships beside this file, and a relative path in the text below cites that tree. Resolve one by trying, in order: the directory of the file you are reading, then `${CLAUDE_SKILL_DIR}/<path>`, then `${CLAUDE_SKILL_DIR}/../<path>` (so `shared/x.md` is at `${CLAUDE_SKILL_DIR}/../shared/x.md`). The host substitutes `${CLAUDE_SKILL_DIR}` with the directory holding this SKILL.md when this file loads; if the literal text `${CLAUDE_SKILL_DIR}` is what you see, that IS the definition: it means the directory containing this SKILL.md, not a placeholder to search for or guess. Read references and shared files natively from there, never over the litigation data server's skill-source tool and never by requesting folder access; scripts and templates the text declares are executed and read from there too. Before each fresh read (a file not already in context), list only `${CLAUDE_SKILL_DIR}/../../..` (the folder holding this plugin's folder). If it holds this plugin's folder name, with any `~g<N>` suffix removed, plus a `~g<N>` higher than this plugin's folder's own (none counts as 0), or if `${CLAUDE_SKILL_DIR}` no longer exists, the plugin was re-synced mid-session: take the highest `~g<N>` copy and repeat the same three tries with its `skills/<this skill>` directory in place of `${CLAUDE_SKILL_DIR}`; tell the user once that the plugin updated mid-session, from the version in this file's version comment to the version in that folder's copy of this SKILL.md. If a file the text names is missing at every one of those paths, including the re-synced folder's, STOP and report the exact path and error to the user rather than substituting an alternative: do not re-derive a script's logic from its source text or the prose, and do not search elsewhere on the filesystem. Ask the user to reinstall the plugin and fully restart the app; this may fix it, but STOP means stop regardless: do not diagnose further yourself.
> **HTML pages.** Every HTML file this plugin writes is a human interface generated from its databases; an agent never views, reads, greps, parses, scripts over, authors or requests a screenshot of one, but may present one to a human user to view, staging it first where presenting needs that, and may view a screenshot the user provides on their own initiative. The rule and the data to use instead: `shared/html-pages.md`.

**Internals stay confidential** (`shared/internals-confidentiality.md`): nothing the practitioner sees names a Probanda tool, table, field, internal type or code, or explains how Probanda works inside. It hides mechanism, never an outcome or an error.

## Contents

| Section | Read when |
|---|---|
| Scope | Always |
| Data Sources (Read-Only) | Reading data, the trust sign convention, or the billing cutoff |
| Database Access | Fetching any WIP data |
| Billing Rate | A dollar figure or retainer headroom is wanted |
| Workflow: WIP Summary (All Matters) | The practitioner asks for WIP across files |
| Suspicious Silence Detection | Checking for funded retainers with no recent activity |
| Workflow: Single Matter WIP | The practitioner asks for WIP on one matter or file |
| Queries | Mapping a WIP question to its workflow |
| Integration with Other Skills | Deciding how this skill relates to another skill |
| Anti-Patterns | Always |

# WIP Tracker

Authoritative source of unbilled work-in-progress per matter. For each active matter, identifies the billing cutoff date, sums time entries recorded since that date, calculates retainer headroom when a billing rate is known, and flags matters with a funded retainer but no recorded activity in over 15 days.

Read `vision.md` for the full design philosophy. The four principles that govern every output:

1. **Never serve a wrong WIP total.** When data is incomplete or ambiguous, surface the uncertainty explicitly rather than guessing. A wrong number corrupts every downstream consumer.
2. **Unknown is not zero.** A matter with no time entries since the billing cutoff may have unrecorded work. Report "no data recorded since [date]" rather than $0 or 0.0 hours.
3. **Show the period, not just the total.** Every WIP figure includes its time anchor — the billing cutoff date and the range it covers. "$2,400 in WIP" is meaningless without "Feb 1 – present."
4. **Surface failures explicitly — never silently skip.** If the billing cutoff cannot be determined, say so. If the retainer balance is unavailable, say so. The practitioner cannot act on a gap they cannot see.

## Scope

This skill **reads and reports**. It does not create time entries, generate invoices, recommend when to bill, or calculate tax. It answers one question: "How much unbilled work is on this file, and is there enough retainer to cover it?"

## Data Sources (Read-Only)

All data accessed via ``practice-data`` operations. This skill does not own or modify any data.

| Source | What it provides |
|--------|-----------------|
| Time entries | Recorded time since billing cutoff |
| Invoices | Billing cutoff date (most recent invoice issue date — *degrade gracefully if unavailable*) |
| Matters | Trust balance per matter |
| Clients | Client name and number |

**Sign convention:** The accounting system (UNITY) stores funded trust balances as negative numbers (`regular_trust < 0` = funded, `regular_trust = 0` = depleted). When presenting trust balances to the user, always use `abs(regular_trust)`. Internally, funded-retainer checks use `regular_trust < 0`.

### Billing Cutoff: date_to First, issue_date Proxy Otherwise

The vision defines the billing cutoff as "the day after the `date_to` field on the most recent invoice" — the actual end date of the period billed. Since the Step 2 cutoff migration (2026-08-26), `practice_data__wip_hours` derives this per matter, per invoice: when an invoice has `date_to` set, the cutoff is `date_to + 1 day` (the real answer); when it doesn't (the source export had no billing-period-end column), the cutoff falls back to that invoice's `issue_date` — the same proxy as before, which may undercount WIP by excluding already-billed entries between the period end and the issue date.

This is **per-invoice, not a hard cutover**: within one WIP summary, one matter's cutoff may come from `date_to` while another's still falls back to `issue_date`, depending on what that matter's most recent invoice actually has. Each row `wip_hours` returns carries `cutoff_source` (`"date_to"` or `"issue_date"`) alongside `cutoff_date` — surface the mandatory caveat **only** when `cutoff_source` is `"issue_date"` for that row: "Cutoff based on invoice issue date — actual billing period end may differ." A `"date_to"`-sourced cutoff needs no caveat; it's the real period end, not a proxy.

### Graceful Degradation

Three upstream dependencies may be absent. Each produces a specific message — never silently substitute zero.

| Condition | Meaning | Action |
|-----------|---------|--------|
| No invoice items at all | Invoices never imported | Cannot determine billing cutoff. Report all time entries for the matter with note: "No invoice data available — showing all recorded time entries. Billing cutoff unknown." |
| No invoices for a matter | No invoices imported for this matter | Same as above for that matter. Other matters with invoice data use their cutoff normally. |
| No time entries for a matter (but retainer funded) | Possible unrecorded work | Flag: "No time entries recorded since [cutoff]. This does not mean zero WIP — work may not have been entered." |
| The matter's `regular_trust` is NULL | Retainer data never imported | Cannot compute headroom. Report WIP hours/dollars only. Note: "Trust balance unavailable — retainer headroom cannot be calculated." |
| Matter has no time entries at all | No time data for this matter | Report: "No time entries on file for this matter." |

**Implementation:** ``practice-data``'s `wip-hours` operation handles graceful degradation internally — if invoice data is unavailable, it returns results without cutoff filtering and signals that invoice data was absent.

## Database Access

All data access via ``practice-data`` `wip-hours` operation. This skill never writes — read-only access only.

## Billing Rate

WIP in dollars requires a billing rate. Time entries store hours only — no rate field.

- **If the practitioner has previously provided a rate** (stored in conversation context or a future config field): use it to compute `wip_dollars = total_hours * rate`.
- **If no rate is known:** report WIP in hours only. Do not compute headroom (hours and dollars cannot be compared). State: "Billing rate not provided — WIP reported in hours. Provide a rate to calculate dollar amounts and retainer headroom."
- **When the practitioner provides a rate:** use it for the current calculation and note: "Using $[rate]/hr for WIP calculations."

Retainer headroom (`abs(regular_trust) - wip_dollars`) is meaningful only when both the trust balance and a billing rate are available. When presenting trust balances in output, always use `abs(regular_trust)` — the raw value is negative for funded matters (UNITY convention).

## Workflow: WIP Summary (All Matters)

Triggered by: "show WIP", "unbilled time across files", "WIP report", "which files have unbilled work."

1. Invoke ``practice-data`` `wip-hours` (see WIP Data Retrieval below)
2. For each matter with time entries since the cutoff:
   - Report the billing cutoff date and WIP hours
   - If a rate is known, report WIP dollars and retainer headroom
   - If retainer is funded but no entries recorded in 15+ days, flag as suspicious silence
4. Present results in the summary format

### WIP Data Retrieval

Invoke ``practice-data`` `wip-hours` operation for all non-closed matters. The operation returns per-matter:
- Matter description and identifiers
- Client name and number
- Billing cutoff date and source (`cutoff_date`, `cutoff_source`) derived from that matter's own invoices — see above
- Total hours since that cutoff

Trust balance comes from ``practice-data`` `trust-summary`; entry-level detail (individual dates, descriptions) comes from ``practice-data`` `time-entries-query` — join them in when presenting a single-matter breakdown. `wip-hours` itself returns only the per-matter total.

**Graceful degradation:** If a matter has no invoices at all, `wip-hours` sums all of that matter's time entries (no cutoff filtering) and sets `cutoff_date`/`cutoff_source` to null. Always note this in output.

## Suspicious Silence Detection

A matter qualifies as "suspicious silence" when ALL of these are true:

1. The retainer is funded (`regular_trust < 0`)
2. The most recent time entry is more than 15 days ago (or there are no entries since the cutoff)
3. The matter is not closed

This means the practitioner has a funded retainer but no recorded work activity — either the work is happening without time entries, or the file has gone dormant without the practitioner realizing it.

Flag these matters separately in the output with: "No time entries recorded since [date] — [N] days of silence on a funded retainer."

## Workflow: Single Matter WIP

Triggered by: "WIP on [matter]", "how much is sitting on [file]", "unbilled time for [client/matter]."

1. Resolve the matter by file number, matter number, or client name
2. Run the per-matter query
3. Present the full breakdown

### Output Format (Single Matter)

```
Smith (C1234) — File L8948 (Smith v Jones)

Billing cutoff:          2026-03-15 (most recent invoice issue date)
                         ⚠ Cutoff based on invoice issue date — actual billing period end may differ
WIP period:              2026-03-16 – present (39 days)
Time entries:            18.5 hours across 12 entries
                         Earliest: 2026-03-18  Latest: 2026-04-20

[If rate known:]
WIP amount:              $3,700.00 (18.5 hrs × $200/hr)
Trust balance:           $4,200.00 (as of 2026-04-01)
Retainer headroom:       $500.00
                         ⚠ Approaching retainer ceiling — 88% consumed

[If rate unknown:]
WIP amount:              Cannot calculate — billing rate not provided
Trust balance:           $4,200.00 (as of 2026-04-01)
Retainer headroom:       Cannot calculate (hours vs dollars)
                         Provide a billing rate to compute dollar amounts.

[If no invoice on record:]
Billing cutoff:          Unknown — no invoices on record for this matter
WIP:                     18.5 hours across 12 entries (all recorded time)
                         ⚠ All time entries shown — cannot determine which have been billed
```

### Output Format (WIP Summary)

```
WIP Summary — 2026-04-23
Data as of: trust balances [last_trust_date], time entries through [latest entry date]
[Note any missing data: "Invoice data unavailable — all time entries included, billing cutoff unknown"]
[If rate used: "Using $200/hr for WIP calculations"]

Matter              Client           Cutoff      Hours   WIP $      Trust $    Headroom
─────────────────── ──────────────── ─────────── ─────── ────────── ────────── ──────────
L8948 Smith v Jones Smith (C1234)    2026-03-15  18.5    $3,700     $4,200     $500 ⚠
L4021 Doe v Roe     Doe (C5678)      2026-02-28  24.0    $4,800     $8,000     $3,200
L4100 Chan Estate   Chan (C9012)     —           6.0     $1,200     $3,000     $1,800

⚠ Suspicious Silence (funded retainer, no activity 15+ days):
L4055 Park v West   Park (C3456)     2026-04-01  —       —          $5,000     —
  No time entries recorded since 2026-04-01 — 22 days of silence on a funded retainer

Notes:
- Cutoff based on invoice issue date — actual billing period end may differ
- [Matter] has no invoices on record — all time entries shown
```

When WIP dollars or headroom cannot be computed (no rate), omit those columns entirely rather than showing blanks — switch to a narrower format with Hours only.

## Queries

| Question | Action |
|----------|--------|
| Show WIP / WIP report | Full WIP summary workflow |
| Which files have unbilled time? | WIP summary, filtered to matters with `total_hours > 0` |
| WIP on [matter/file] | Single matter workflow |
| How much is sitting on [file]? | Single matter workflow |
| Retainer headroom for [matter] | Single matter workflow (requires rate) |
| Which files are approaching the retainer ceiling? | WIP summary, filtered to headroom < 20% of trust balance |
| Any files with no activity? | Suspicious silence detection only |

## Integration with Other Skills

| Skill | Relationship |
|-------|-------------|
| **practice-data** | Owns schema and path resolution. All queries go through the practice DB. |
| **invoice-tracking** | Provides billing cutoff via each invoice's `issue_date`. Without it, cutoff is unknown. |
| **retainer-tracking** | Provides the matter's `regular_trust` for headroom calculation. |
| **time-entry-drafting** | Creates time entries that this skill reads. New entries are immediately visible. |

No skill invokes this one. `ar-follow-up` (`ar-data`), `executive-assistant` (`trust-summary` and
`time-entries`) and `task-prioritization` (`open-tasks`) each read time data from ``practice-data``
directly.

## Anti-Patterns

- **Treating absence as zero.** No time entries since cutoff ≠ zero WIP. No invoice ≠ billing cutoff of today. No `regular_trust` value ≠ no retainer. Each is a distinct unknown that must be surfaced.
- **Substituting `issue_date` silently for `date_to`.** Always note in output that the cutoff is based on invoice issue date, which is a proxy.
- **Computing headroom without a rate.** Hours minus dollars is meaningless. When no rate is available, report hours and trust balance separately — do not attempt to compare them.
- **Caching or storing WIP totals.** WIP is always computed on demand from time entries and invoices. Storing a pre-computed value creates a stale-data risk with no performance benefit at sole-practitioner scale.
- **Defining schema or CREATE TABLE.** Schema belongs to `practice-data/SKILL.md`.
- **Querying upstream CSVs directly.** All data enters through the practice database import workflows. Never parse accounting CSVs.
- **Recommending when to bill or what to write off.** This skill reports the numbers; the practitioner decides what to do with them.
- **Rounding or truncating hours.** Report time entries at the precision stored in the database. The practitioner's rounding policy (if any) is applied at billing time, not at WIP reporting time.
- **Displaying raw negative trust values to the user.** Always `abs(regular_trust)` in output. The raw negative value is an internal convention, not something the practitioner should see.
