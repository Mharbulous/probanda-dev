# Task Prioritization — Vision & Design Philosophy

**Date:** 2026-04-14

## 1. Platform & Scope

A skill within the CoClerk Cowork plugin. Task-prioritization owns the **task registry** — a persistent, ranked list of everything the practitioner and staff need to do. It provides the ranking; it does not schedule work into time slots or manage the calendar.

**Boundary with sibling skills:**

- **task-prioritization** — *what* needs doing and *how important* it is
- **docket-clerk** (agent) — *what must happen by when* (court deadlines, limitation periods, filing dates)
- **executive-assistant** — *when to do it* (combines the task queue with calendar availability to produce "do this next" and "you don't have time for that")

Task-prioritization reads from practice-data (trust balances and unbilled hours) and docket-clerk (deadline proximity for tie-breaking). It writes nothing to those skills — it is a consumer of their data.

## 2. Purpose

### Audience

A sole BC litigation practitioner and a legal assistant, both working within LEAP and UNITY.

### Pain Points

Without a system to surface what needs attention, work defaults to whatever feels most urgent or whoever asks loudest. Client files, administrative duties, and professional obligations all suffer the same pattern: non-urgent work drifts until it becomes urgent. The result for client work specifically is that demanding clients burn through retainers fastest, billing gets deferred, and work performed beyond the retainer balance leads to forced discounts.

### Value Proposition

A ranked task registry that removes the cognitive overhead of triage. The practitioner and staff always know what to work on next without having to think about it. The ranking is transparent — it shows its reasoning so the practitioner can verify and override when needed.

### Killer Use Case

The practitioner opens Cowork and asks "what should I work on?" Task-prioritization returns a ranked list: first, the two retainer replenishment notices that need sending (quick, high-leverage); then the funded client tasks ordered by deadline proximity and file weight; then a note that three files are paused pending retainer replenishment. Each entry shows *why* it's ranked where it is.

## 3. Theme & Design Philosophy

### Design Principles

#### 3.1 The Retainer Signal Is a Demotion Mechanism

The retainer-first model does not promote clients who pay well — it demotes clients who haven't paid. Administrative and professional tasks have no retainer signal and default to the Work tier alongside funded client tasks. A funded retainer is the baseline expectation, not a reward.

**Violation example:** Ranking a $20,000 retainer client above a $2,000 retainer client purely because of the balance difference when neither is depleted. Within the Work tier, retainer balance (net of WIP) is a tie-breaker for file weight, not a primary ranking signal.

#### 3.2 Three Tiers: Remind, Work, Paused

Tasks are ranked into three tiers:

1. **Remind** — Depleted retainer, client hasn't been warned. A single action: send written notice that work is paused pending replenishment. Quick, high-leverage, and creates the paper trail the practitioner needs before stopping work.
2. **Work** — Funded client tasks, all administrative tasks, all professional tasks. The main body of work.
3. **Paused** — Depleted retainer, client warned in writing. Work is on hold pending replenishment.

This ordering refines the model in the project-level Vision.md (Section 5) based on the insight that the reminder action is quick, high-leverage, and unblocks future work — so it belongs at the top.

#### 3.3 Tie-Breaking Within the Work Tier

When multiple tasks share the same tier, rank by:

1. **Deadline proximity** — Tasks with a deadline within one month outrank tasks with a deadline beyond one month, which outrank tasks with no deadline. Among tasks due within a month, sooner deadline wins.
2. **Net available trust** — When deadline status is the same, prioritize tasks for clients with the greatest unused trust funds after subtracting unbilled WIP. This is a proxy for file weight — larger balances correlate with more complex, higher-stakes matters.

#### 3.4 The Registry Is a Ledger, Not a Queue

Tasks are not removed when completed — they become historical records. Each task tracks: creation date, time estimate, completion date, and actual time spent. This data feeds two downstream uses:

- **Billing** — Completed task descriptions feed time-entry-drafting for automated billing
- **Estimate calibration** — Comparing estimated vs actual time improves future time estimates

#### 3.5 Show the Reasoning

Every ranked output must cite the factors that produced the ranking. The practitioner should be able to see *why* a task is ranked where it is — tier assignment, deadline status, net trust balance — not just the final order.

**Violation example:** Returning "1. Smith v Jones, 2. Lee v Park" without showing that Smith has a funded retainer with a filing deadline in 12 days while Lee's deadline is 45 days out.

### Litmus Test

**"Does the lawyer or staff need to be reminded to do this?"**

- "Send retainer replenishment notice to Smith" — **yes**, task registry
- "Follow up with expert witness on report" — **yes**, task registry
- "Complete annual CLE reporting" — **yes**, task registry
- "What's the courthouse phone number?" — **no**, answer it now

## 4. Non-Goals

- **How to do a task** — Task-prioritization tells you *what* needs doing and *how important* it is. It does not draft the retainer notice, prepare the filing, or do the legal work.
- **Calendar management and scheduling** — Fitting tasks into available time slots is executive-assistant's job. Task-prioritization provides the ranked list; executive-assistant decides when each task gets done.
- **Deadline ownership** — Court deadlines, limitation periods, and filing dates belong to docket-clerk. Task-prioritization reads deadline data for tie-breaking but does not calculate, store, or manage deadlines.
- **Trust accounting or compliance reporting** — The skill reads trust balances to inform ranking but does not perform reconciliation, LSBC compliance reporting, or any bookkeeping.

## 5. North Star

**The practitioner always knows what to work on next without having to think about it.**

Validated over time by:
- Fewer tasks slipping through the cracks
- Improving accuracy of time estimates (estimated vs actual convergence)

## 6. Anti-Patterns

*No anti-patterns documented yet — add entries here as they are discovered empirically.*
