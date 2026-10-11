# Invoice-Tracking — Vision & Design Philosophy

**Date:** 2026-04-14

## 1. Platform & Scope

Invoice-tracking is a skill within CoClerk, a Claude Cowork plugin for BC litigation practice management. It ingests invoice exports from the user's practice management system (format varies by user), normalizes the raw invoice data, and stores current invoice state for all client matters in the shared DB.

This skill is infrastructure — it owns the invoice data layer. It does not surface information to the user, make recommendations, or trigger any action. Downstream skills (`ar-follow-up`) consume its data via shared DB queries.

Data enters exclusively via user-initiated CSV export from their practice management system. There is no direct API integration with LEAP, PCLaw, Clio, or any other system.

## 2. Purpose

### Audience

A sole BC litigation practitioner managing retainer-funded client matters.

### Pain Points

**Trust-invoice mismatch:** A client replenishes their trust account while an outstanding invoice on that same matter goes unnoticed. Because trust balances and invoice status live in separate systems, the two are never reconciled — the lawyer doesn't see that money is sitting in trust while a bill remains unpaid.

**Quiet client blindspot:** Invoices fall through the cracks when a client goes quiet. Without new work arriving to trigger engagement, an unpaid invoice can sit for months without surfacing.

### Value Proposition

Invoice-tracking is the invoice-status data layer for CoClerk — it normalizes invoice exports from the user's practice management system and stores current invoice state in the shared database, giving downstream skills a complete, queryable picture of the practice's accounts receivable.

### Killer Use Case

A lawyer imports an invoice export at the start of the week and asks ar-follow-up which matters need collection attention. Because invoice-tracking has already normalized and stored the full invoice state, ar-follow-up can immediately cross-reference outstanding invoices against retainer balances and surface the complete AR picture — including the trust-invoice mismatches that would otherwise go unnoticed.

## 3. Theme & Design Philosophy

### Design Principles

**1. Pure data layer — no opinions.**
Invoice-tracking normalizes and stores. It does not interpret, flag, recommend, or act. Any judgment about what the data means belongs to downstream skills. A skill that starts annotating invoices as "urgent" or "overdue" has drifted out of scope.

**2. Source-agnostic normalization.**
Invoice data format varies by user (LEAP, PCLaw, Clio, etc.). Invoice-tracking must normalize whatever CSV the user provides into a consistent internal schema without assuming a specific source format. The shared DB schema is the contract; the import format is not.

**3. Warn on stale data (Design Principle 3.6).**
When invoice data has not been updated recently, that staleness must be surfaced before any downstream skill acts on it. A downstream skill should never silently operate on months-old invoice data.

**Violation:** ar-follow-up generates a collection list using invoice data last imported six weeks ago, without flagging that the data may not reflect recent payments.

**4. All state through the shared DB.**
No skill maintains its own copy of invoice state. Invoice-tracking writes to the shared database; downstream skills read from there. No caching, no local state, no skill-to-skill direct communication.

### Litmus Test

**"Does this require knowing what invoices exist and their payment status?"**

- "Which matters have outstanding invoices?" — **Yes**, invoice-tracking provides this
- "Which clients should I call about unpaid bills?" — **No**, that's ar-follow-up
- "How much unbilled work do I have?" — **No**, that's wip-tracker
- "Is this invoice amount correct?" — **No**, that's invoice-reviewing
- "Has this retainer been replenished?" — **No**, that's retainer-tracking

## 4. Non-Goals

- **Generating or drafting invoices** — invoice-tracking reads invoice records; it does not create them
- **Collection action or follow-up** — surfacing which clients to contact is ar-follow-up's domain
- **Trust accounting or LSBC compliance reporting** — out of scope for the entire plugin
- **Billing rate calculation or WIP tracking** — those belong to wip-tracker
- **Invoice QA or error detection** — that is invoice-reviewing's role
- **Direct practice management system integration** — data enters only via user-exported CSV

## 5. North Star

Downstream skills can always answer AR questions accurately. The measure of success is that when a lawyer asks "which matters are behind on their payments?", invoice-tracking has complete and current invoice state in the shared DB — with no silent gaps, no stale data served without warning, and no matter omitted because its invoice format wasn't recognized.

## 6. Anti-Patterns

*No anti-patterns documented yet — add entries here as they are discovered empirically.*
