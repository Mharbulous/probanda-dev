# Practice-Database — Vision & Design Philosophy

**Date:** 2026-07-13 (rewritten for the three-layer re-architecture, workstream B4; supersedes the 2026-04-23 pre-migration draft)

## 1. Platform & Scope

`practice-data` is a helper gatekeeper skill within CoClerk, a Claude plugin for BC litigation practice management. It is **not user-invocable** — the practitioner never calls it directly. Every other skill that touches practice data (matters, clients, time entries, invoices, retainers, tasks, deadlines, anchors, court-calendar reference data) delegates to this skill, which routes each operation to a `practice_data__*` MCP tool.

**Where the data lives (B4 end state).** Practice data is a single **local SQLite database** — `0. CASE DATA\_practice\practice.db` — reached exclusively through the `practice_data__*` tools served by the plugin MCP runtime. The runtime's practice backend shells out to the host Python `sqlite3` module (spec §5/§10): no `node:sqlite`, no added build step, and — critically — **no `practice_data__*` read or write touches Supabase.** This is the re-localized end state after the three-layer re-architecture retired the Phase 0 practice-data cloud migration.

**Encapsulation.** This skill is a **router that holds no schema, no SQL, and no database path.** The local schema (14 tables) and path resolution are owned by the MCP runtime's practice backend, the single place any database particular may live. Consumers treat the database as opaque and reach it only by invoking ``practice-data`` with an operation name — never by opening a connection, embedding a query, or knowing the file's location.

## 2. Purpose

### Audience

The direct audience is every other CoClerk skill that reads or writes practice data. The practitioner is the indirect beneficiary: because one gatekeeper owns the tool surface and one runtime owns the schema, every skill's output draws from the same consistently structured data with stable, documented column semantics.

### Pain points this design removes

- **Schema fragmentation.** Without a single owner, each skill needing persistent state would define its own tables and diverge. One runtime owns the DDL; the gatekeeper skill exposes only named operations.
- **Uncoordinated connections.** Each skill opening its own `sqlite3.connect()` and constructing its own path produces a system where one file move, rename, or sync event breaks different skills differently. All access funnels through the MCP tools.
- **Backend churn leaking to consumers.** Practice storage has moved (local → cloud → local) without a single consumer changing: the tool signatures are the stable contract, and the backend behind them is invisible. A future backend change must preserve that invisibility.
- **Data-sovereignty fragility.** Client practice data must stay on the practitioner's machine (LSBC requirements). Keeping it in local SQLite with no cloud path enforces this structurally, not by policy.

### Value proposition

A single, stable data layer every skill trusts. Retainer balances, WIP, task state, matter status, deadlines — all come from one place with known column semantics and ISO-8601 dates, without any skill knowing where the database lives or how it is reached.

## 3. Design Philosophy

**1. One gatekeeper owns the tool surface; one runtime owns the schema — no exceptions.**
No consumer skill may define a table, write SQL, resolve the database path, or open its own connection to `practice.db`. Database particulars live only in the MCP runtime's practice backend; the gatekeeper skill exposes named operations.
**Why:** a schema definition or query hidden in a downstream skill is invisible to every other skill; the first conflicting assumption breaks data integrity silently, and the source is opaque by the time it surfaces.

**2. The tool signatures are the contract; the backend is invisible.**
Consumers depend on tool names, arguments, and the documented consumer contract (sign convention, date format, absence semantics, party/proceeding discriminators, review flags) — never on how the tool is implemented.
**Why:** this is exactly what let the backend flip Supabase → local SQLite with zero consumer changes. Any future change must keep the signatures and guarantees stable.

**3. Absence is not zero — distinguish unknown from confirmed empty.**
No `matters` row means retainer status is *unknown*; `regular_trust = 0` means *confirmed depleted*. Reads return `{rows: []}` on no match and never synthesize a placeholder.
**Why:** treating absence as zero makes a funded file look depleted, so it is deprioritized and work falls behind. `regular_trust` is never positive (UNITY reports credits as negative; the stored value is the raw negative or zero).

**4. Data sovereignty is a hard architectural constraint, not a preference.**
Practice data resides only in the local `practice.db`. No client practice data is uploaded, embedded in plugin files, or written to cloud storage. Even public reference data (the court calendar) is local — a cloud calendar would be read on every routine deadline calculation and would puncture the permission-prompt boundary that keeps cloud touches deliberate.
**Why:** LSBC requires the lawyer to control client information; a design that lets it leave the machine, even as a cache, is a compliance violation regardless of reason.

**5. Storage discipline: never leave a live SQLite handle on synced storage.**
`0. CASE DATA` sits inside the SharePoint-synced library, so the protection is *discipline, not folder choice*: the runtime opens the DB per call under `PRAGMA journal_mode = DELETE` and closes it before returning, leaving no `-wal`/`-shm` sidecars on synced storage.
**Why:** a synced/FUSE-style mount serves stale file-size metadata that corrupts binary SQLite reads and writes; a lingering handle is the exposure, and the open-close-per-call model closes it.

**6. Never bypass the gatekeeper by reading source data directly.**
If a read returns nothing or errors, surface it. Do not fall back to parsing a UNITY CSV, a LEAP export, or any other source file to answer a query.
**Why:** source files enter only through the import workflow, which applies normalization (sign convention, date, column mapping). Reading them directly bypasses that and produces answers that contradict the database once the import runs.

### Litmus test

> "Does this involve a named practice-data operation, its consumer contract, or the local practice backend?"

- **Yes → here:** looking up a matter, recording a retainer notice, reading trust balances, ingesting the court calendar, upserting a deadline.
- **No → downstream skill:** calculating WIP from time entries, ranking files by priority, parsing a UNITY CSV, generating an invoice.

## 4. Non-Goals

- **Business logic or decision-making** — practice-data stores and retrieves; it does not calculate WIP, rank files, or decide when to send a retainer notice.
- **Reporting or summarization** — human-readable output belongs to downstream skills.
- **Accounting-system integration** — data enters through the import workflow of dedicated skills (retainer-tracking, invoice-tracking); practice-data does not read UNITY CSVs or call LEAP's API.
- **Trust-accounting compliance** — the schema tracks retainer balances and time entries for practice management; LSBC trust reconciliation and compliance reporting are out of scope.
- **Multi-database or cloud practice data** — exactly one local practice database per practitioner; no practice data in the cloud, and no databases outside the two-tier structure (practice.db + per-matter case databases).

## 5. North Star

**Zero backend leakage:** no consumer skill ever writes SQL, resolves the database path, or opens its own connection to `practice.db`; every field-level guarantee in the consumer contract holds, so no downstream skill ever inspects a raw UNITY value, applies a sign correction, or reparses a date. Success is measured by the absence of failures — a new skill can be built against the practice data with no knowledge of where it lives, how it is reached, or what backend serves it.
