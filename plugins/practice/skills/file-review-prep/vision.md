# File Review Prep — Vision & Design Philosophy

**Date:** 2026-04-23

## 1. Theme & Design Philosophy

### Vision Statement

File-review-prep is a Cowork plugin skill that assembles a structured briefing for a single client matter from the shared SQLite database, giving a sole BC litigation practitioner everything they need to pick up a file cold — matter status, retainer picture, open tasks, and approaching deadlines — in one place, in seconds, without mental reconstruction. It is a pure read-only synthesizer: it consumes data owned by other skills and presents it; it never writes, never recommends, and never owns state of its own.

### Design Principles

#### 1.1 Read-Only, Always

File-review-prep never writes to the database. It invokes only `practice-data` read operations (`matter-lookup`, `read-signals`, `trust-summary`, `open-tasks`, `active-deadlines`, `ar-data`) — it touches no row, updates no column, and creates no record. Any output that looks like an action item is a display artifact, not a DB write.

**Why:** The skill is called immediately before the practitioner engages with a file. A read operation at that moment carries no risk of corruption or side effects. Allowing writes would conflate briefing with data entry, violating the separation of concerns that keeps the plugin's data layer clean.

**Violation example:** Updating `matters.status` or inserting a `tasks` row as a side effect of generating the briefing — even if the update looks correct.

#### 1.2 Synthesize, Don't Recommend

The briefing presents the current state of the file — what is true as of now. It does not tell the practitioner what to do about it. Recommendations ("send the replenishment notice," "this file is your top priority today") belong to `executive-assistant`. File-review-prep supplies the raw material the practitioner needs to exercise their own judgment when they open the file.

**Why:** The practitioner is about to engage with the file. They need a clear picture of where things stand, not a pre-computed action list that may not match the immediate context of the upcoming call or review. Surfacing state and letting the practitioner decide respects their professional judgment.

**Violation example:** Appending "Suggested next step: send retainer replenishment notice" based on the depleted retainer signal — that recommendation belongs to `executive-assistant` and `ar-follow-up`.

#### 1.3 Cite Every Data Point

Every item in the briefing must state where it came from and how current it is. Trust balance: show the import date. Task list: show creation and deadline dates. Matter status: show which signals drove it and when they were confirmed. The practitioner must be able to verify the briefing without running their own queries.

**Why:** A confident-looking briefing with a stale trust balance or an unconfirmed status signal can cause real harm in a litigation practice. Citing sources and freshness dates lets the practitioner weigh each data point appropriately before acting on it.

**Violation example:** Showing "Retainer: $3,200" without noting that the trust data was last imported 22 days ago.

#### 1.4 Surface Gaps, Never Fill Them

When a data point is missing — no trust import on file, no signals confirmed, no tasks recorded — the briefing must say so explicitly. It never extrapolates a current balance from a burn rate, assumes a status from partial signals, or omits a section because the underlying data is absent. A blank or "unknown" entry is correct output. A plausible-looking substitute is not.

**Why:** The practitioner is about to speak to a client or engage with a file. Acting on fabricated or extrapolated data — a guessed balance, an assumed status — causes exactly the kind of harm the plugin exists to prevent.

**Violation example:** Showing a retainer balance computed by subtracting recent time entries from the last known balance, when no fresh trust import exists.

#### 1.5 Fail Loudly on Upstream Schema Gaps

If a required table (`matter_signals`, `status_policies`) does not yet exist in the database, the briefing must surface that explicitly rather than silently omitting the affected section. Partial briefings that look complete are worse than clearly incomplete ones.

**Violation example:** Silently omitting the "Matter Status" section of the briefing because `matter_signals` hasn't been migrated yet, leaving the practitioner to assume status is current.

### Litmus Test

**"Does a practitioner need to know this before picking up the file?"**

- Matter status and engagement lifecycle signals — **yes**, include.
- Current retainer balance and data freshness — **yes**, include.
- Open tasks with deadlines — **yes**, include.
- Approaching court deadlines and limitation periods — **yes**, include.
- AR state (outstanding invoices, replenishment notices sent) — **yes**, include.
- "You should send a replenishment notice" — **no**, that is `executive-assistant`.
- Drafting correspondence or legal documents — **no**, out of scope.
- Cross-matter ranking or prioritization — **no**, that is `task-prioritization`.
- Trust accounting reconciliation — **no**, out of scope per plugin Vision.


## 2. Purpose

### Audience

A sole BC litigation practitioner and, secondarily, a legal assistant — both working within LEAP and UNITY. The practitioner is the primary consumer: they invoke the skill before picking up a file, whether triggered by a client call, a task on their queue, or a scheduled review.

### Pain Points

A BC litigation practice runs many active matters simultaneously. Before engaging with any file — before a client call, before drafting a letter, before reviewing a file on the queue — the practitioner needs to reconstruct the current state from scattered sources: LEAP for tasks and status, UNITY for trust balance, memory for the last thing that happened. This reconstruction is slow, error-prone, and mentally expensive when done repeatedly across many files. The cost compounds for the legal assistant, who may not have the practitioner's full context and has to ask before proceeding.

A depleted retainer discovered mid-call is awkward. A missed deadline uncovered during file review is worse. A stale trust balance acted on as current can produce real financial and professional consequences. The problem is not that the data doesn't exist — it does, scattered across the shared DB — but that nobody assembles it on demand.

### Value Proposition

File-review-prep closes the gap between data existing in the shared DB and the practitioner being briefed. One invocation produces a complete, sourced, freshness-stamped snapshot of a single matter: status, retainer, tasks, deadlines, AR state. The practitioner picks up the file knowing what they're walking into. No reconstruction. No surprises mid-call.

### Killer Use Case

A client calls unexpectedly. The practitioner has thirty seconds before picking up. They invoke ``file-review-prep` Smith` and get back: matter status (active; retainer agreement confirmed, deposit confirmed), trust balance ($2,850 as of 18 days ago — flagged as approaching stale), three open tasks (discovery response due in 12 days; retainer replenishment notice sent 8 days ago, no confirmation yet; draft demand letter — no deadline), and one approaching deadline (examination for discovery scheduled 34 days out). The practitioner picks up the phone fully briefed. The call does not surface any surprises that the DB already knew about.


## 3. North Star

**The practitioner can pick up any active file cold and be fully briefed within seconds — no mental reconstruction required.**

Progress markers:
- Every section of the briefing is populated or explicitly marked as missing/stale — no silently absent sections.
- Trust freshness flag fires correctly when `last_trust_date` exceeds the staleness threshold.
- The briefing accurately reflects what `matter-status-tracking`, `task-prioritization`, `ar-follow-up`, and `docket-clerk` currently hold — no divergence between the briefing and the underlying data.


## 4. Non-Goals

- **Recommendations and next-step advice** — telling the practitioner what to do belongs to `executive-assistant`. File-review-prep shows what is true; it does not prescribe action.
- **Cross-matter ranking and prioritization** — which file to work on first belongs to `task-prioritization`. File-review-prep scopes to a single matter on demand.
- **Drafting correspondence, legal documents, or time entries** — out of scope per the plugin's litmus test (per-matter decisions, not universal across all matters).
- **Trust accounting reconciliation or LSBC compliance reporting** — out of scope per the plugin Vision.
- **Writing to the database** — the skill is a pure read consumer; it owns no state and makes no changes.
- **Legal research or substantive legal advice** — out of scope per the plugin Vision.


## 5. Foundations

**Pure consumer: no DB writes, no owned data.** File-review-prep reads practice data that other skills own, defines nothing of its own, and writes nothing. All schema is owned by `practice-data`. This is not a convenience; it is what makes the skill safe to call immediately before engaging with a client file without risk of side effects.

**Reads only through `practice-data` read operations.** File-review-prep invokes only `practice-data` read operations. It never resolves a database path, opens a connection, or knows where the database lives. This ensures the briefing reads from the same database that every other skill writes to, and makes the read-only contract explicit: no write operation is ever invoked.

**Layer 5 consumer in the dependency graph.** File-review-prep sits at the top of the skill dependency graph, consuming from `matter-status-tracking` (`read-signals`), `task-prioritization` (`open-tasks`), `ar-follow-up` (retainer notice and payment state, `ar-data`), and `docket-clerk` (court dates, `active-deadlines`). It does not call sibling skills directly — it invokes the `practice-data` operations that serve what those skills write. This means the briefing is only as current as the last time each upstream skill ran and wrote its output.


## 6. Anti-Patterns

*No anti-patterns documented yet — add entries here as they are discovered empirically.*
