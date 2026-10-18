# Retainer-Tracking — Vision & Design Philosophy

**Date:** 2026-04-12

## 1. Platform & Scope

Retainer-tracking is a skill within CoClerk, a Claude Cowork plugin. It ingests UNITY TrustListing CSV exports, normalizes the raw trust data, and stores current retainer balances for all client matters in the practice database through the `practice-data` operation `upsert-client-matter`.

This skill is infrastructure — it owns the retainer data layer. It does not make decisions or produce reports. Downstream skills (`wip-tracker`, `executive-assistant`, `invoice-tracking`, `ar-follow-up`) consume its data through the `practice-data` operation `trust-summary`.

Data enters exclusively via manual UNITY CSV export. There is no direct UNITY API integration.

## 2. Purpose

### Audience

A sole BC litigation practitioner managing retainer-funded client matters.

### Pain Points

All three of these were real before this skill existed:

- **Reactive awareness** — not knowing a retainer is running low until it's already a problem
- **Tedious reconciliation** — manually cross-referencing UNITY exports with active files to track balances
- **Pre-work blind spot** — not knowing whether a file has a funded retainer before doing significant work on it

### Value Proposition

A single, always-current source of retainer balance data that every skill in the plugin can query without touching a UNITY CSV directly. Skills that need to make billing or prioritization decisions get a clean, normalized answer; none of them maintain their own copy of retainer data.

### Killer Use Case

A UNITY TrustListing CSV is dropped into the session. After import, any skill can read the current retainer balance for any matter with a single `practice-data` `trust-summary` call — normalized sign convention, ISO 8601 dates, stale-safe — without knowing anything about UNITY's export format.

## 3. Theme & Design Philosophy

### Design Principles

**1. Never store or serve a wrong balance.**
This is the primary failure mode the skill exists to prevent. Wrong balances propagate silently to every downstream skill and corrupt billing and prioritization decisions. Stale data is one cause; incorrect normalization is another. Both are equally serious.

**2. Surface import failures explicitly — never silently skip.**
If a CSV row is unparseable, malformed, or ambiguous, report it. A silent skip is indistinguishable from a successful import and will leave a matter with no balance entry, which is worse than a visible error.

**3. Normalize UNITY's quirks so consumers see clean data.**
UNITY exports trust balances as negative numbers (credit owed to client) and dates in DD/MM/YYYY format. These are traps. Consumers receive `abs(Total)` and ISO 8601 dates. No downstream skill should need to know anything about UNITY's internal conventions.

**4. Guard against stale overwrites.**
Before replacing a stored balance, compare the CSV's `Last Trust Date` against the stored `last_trust_date`. Only overwrite if the CSV date is strictly newer. This prevents an older export from silently degrading fresher data.

**5. Always timestamp stored data.**
Every balance record carries `last_trust_date` (from UNITY) and `imported_at` (import time). Timestamps are the mechanism that allows consuming skills to assess freshness — they are not a feature, they are how the accuracy guarantee is maintained.

### Litmus Test

> "Does this involve tracking a client's current retainer status?"

- **Yes** → belongs in retainer-tracking
- **No** → belongs elsewhere

This skill is about *current status only*. Historical trust ledgers, past transactions, reconciliation, and full trust accounting belong to UNITY. Decisions that *use* retainer status (billing triggers, matter prioritization) belong to downstream skills.

## 4. Non-Goals

- **Burn rate calculation** — past burn rate does not predict future burn rate in litigation; each matter's work volume is irregular
- **Historical trust ledger** — UNITY owns the full transaction history; this skill only cares about the current balance
- **Trust reconciliation / LSBC compliance reporting** — bookkeeping functions, explicitly out of scope
- **Non-retainer trust money** — settlements, disbursements held in trust, and other trust funds are not retainer money and are not tracked here
- **Direct UNITY API integration** — data enters via CSV export only
- **Decision-making** — the skill stores and serves data; it does not decide when to bill or which matter to prioritize

## 5. North Star

Single source of truth coverage: every skill in the plugin that needs retainer data gets it from one place, and that place is always normalized and timestamped. Success is measured by whether any skill ever needs to maintain its own copy of retainer data — the answer should always be no.

## 6. Anti-Patterns

- **Downstream skill parsing a UNITY CSV directly** instead of invoking `practice-data` `trust-summary` — violates the single-source-of-truth principle.
- **Storing dot-prefixed matter numbers** in the practice database — forces every consumer to know about UNITY's naming convention (violates principle 3). `upsert-client-matter` strips the prefix on write.
- **Treating absence as zero balance** — no entry means unknown status, not depleted. A depleted retainer has an explicit `balance: 0.00` entry.
- **Silent import skips** — any row that cannot be parsed must be reported, not silently dropped (violates principle 2).
