# Executive Assistant — Vision & Design Philosophy

**Date:** 2026-04-23

## 1. Platform & Scope

A Cowork plugin skill; practice data stays on the practitioner's machine and is reached only through `practice-data`. executive-assistant is the **single recommendation engine** for what to work on next — the only skill that tells the practitioner "do this now." It synthesizes data from across the practice into a unified surfacing and timing layer.

**Two invocation modes:**

- **Slash command (on-demand):** Mid-day "what should I tackle next?" query. Returns the current ranked task list with context drawn from the live state of all upstream data sources. Reactive — answers the question as of now.
- **Cron-triggered scheduled run (morning briefing):** Fires automatically each morning. Produces a proactive aggregate briefing covering the day ahead: approaching deadlines, retainer status, suspicious WIP gaps, and the top tasks to address. Unlike the on-demand query, the morning briefing is framed temporally — "here is what today looks like."

Both modes read the same underlying data; they differ in framing (current-state snapshot vs. day-ahead aggregate) and in what triggers them.

**Boundary with sibling skills:**

- **task-prioritization** — *what* needs doing and *how important* it is (three-tier ranking: Remind → Work → Paused)
- **executive-assistant** — *what to surface and when to surface it* (synthesizes the ranked task list with deadline urgency and WIP signals; presents the recommendation at the right moment)

executive-assistant reads from: `practice:docket-clerk`, `task-prioritization`, and `practice-data` (trust balances, time entries, matter signals). It writes nothing to those skills — it is a consumer of their data, not a manager of it.

**Calendar-aware scheduling** ("you don't have time for that today") is a deliberately deferred extension. The current skill surfaces work from the task registry and deadline data alone, without reasoning about available time slots. When calendar integration becomes necessary, Google Calendar events are already fetched by the `build-timeline` skill and could be consumed directly; that source would be added to the consumes-from list at that point.

## 2. Purpose

### Audience

A sole BC litigation practitioner and, secondarily, a legal assistant. Both need to know what to act on without doing the synthesis work themselves.

### Pain Points

The practitioner already has ranked tasks (task-prioritization) and deadline records (docket-clerk). The gap is the jump from *data* to *guidance*: knowing that a retainer is depleted, a deadline is approaching, and WIP has hit the ceiling is not the same as receiving a clear "send the replenishment notice now, then draft the response — the motion deadline is seven days out." Without a single place that synthesizes all of this, the practitioner must mentally correlate retainer status, WIP levels, and deadline proximity every time they sit down to work.

The morning briefing gap is even sharper: the practitioner currently has no proactive signal. Nothing fires automatically to say "before you open your inbox, this file needs attention today." The work-of-the-day has to be consciously assembled from scratch each morning.

### Value Proposition

executive-assistant closes the last mile between data and action. It converts the ranked task list, deadline calendar, and WIP state into a single recommendation the practitioner can act on immediately, without triage. The morning briefing removes the daily assembly cost entirely — the practitioner starts with a briefed view of the day rather than a blank slate.

### Killer Use Case

The practitioner's day starts. The morning briefing has already fired. It shows: one retainer replenishment notice to send (Smith v Jones, retainer depleted, no notice on file — quick action, five minutes); one filing with a hard deadline in eight days that has $3,800 in WIP against a $4,200 retainer (the window to bill before the retainer ceiling is tight); and a flag on Harrison v. Chan — funded retainer, no time entries recorded in 16 days. The practitioner doesn't decide what to work on. They just work through the briefing, starting at the top.

## 3. Theme & Design Philosophy

### Design Principles

#### 3.1 Surface, Don't Rank

executive-assistant presents the output of task-prioritization's ranking; it does not re-rank, re-tier, or second-guess it. The three-tier model (Remind → Work → Paused), the tie-breaking logic, and the retainer-first rules belong to task-prioritization. executive-assistant's job is to take that ranked output, combine it with deadline urgency and WIP signals, and present the result at the right time in the right framing.

**Violation example:** executive-assistant computing its own tier assignment for a matter — checking `regular_trust` and deciding the matter belongs in Work — rather than reading the tier from task-prioritization's output.

#### 3.2 Two Modes, One Data Layer

The slash command and the scheduled run are presentation modes, not separate data pipelines. Both read the same upstream sources (task-prioritization, docket-clerk, practice-data). The difference is framing: the on-demand mode answers "what now?" with a current-state snapshot; the morning briefing answers "what today?" with a temporal aggregate that looks ahead. Maintaining a separate data pathway for the scheduled run — or diverging the sources between modes — is a design error.

**Violation example:** The morning briefing fetching retainer balances from one practice-data operation while the slash command reads them from another. Any source consumed differently in different modes creates divergence.

#### 3.3 Show the Reasoning

Every recommendation must state the factors behind it. The practitioner can see *why* a task is surfaced first — its tier, deadline status, WIP level, retainer headroom — not just the final order. This lets the practitioner verify the recommendation and override when their judgment differs from the model.

**Violation example:** "1. Smith v Jones" with no explanation of why Smith is first — no tier label, no deadline, no trust context.

#### 3.4 Proactive Surfaces What Reactive Cannot

The morning briefing's value is not just convenience — it is timing. An on-demand recommendation only fires when the practitioner thinks to ask. The scheduled briefing fires before the day begins, surfacing issues that might not have triggered a "what's next?" query: a suspicious WIP silence on a funded file, a deadline approaching in 10 days, a retainer that depleted overnight. If a signal is better acted on early in the day than mid-afternoon, it belongs in the scheduled briefing.

**Violation example:** Treating the scheduled briefing as a simple dump of the current ranked task list — identical output to the slash command, just fired automatically. The briefing must frame the day ahead, not just repeat the queue.

#### 3.5 Fail Loudly, Surface Data Gaps

If a required data source is unavailable or returns no data, executive-assistant reports the gap explicitly rather than silently omitting the affected matters. A silent omission would produce a recommendation that looks complete but is not.

**Violation example:** Silently skipping matters that have no `matters` row (and therefore no retainer signal) rather than surfacing them with a `[retainer unknown]` flag.

### Litmus Test

**"Does this help the practitioner know what to work on next — and when — without having to think about it?"**

- Surfacing the top Remind task from task-prioritization's output — **yes**, in scope.
- Flagging a matter with a funded retainer and 17 days of silence — **yes**, in scope.
- Framing the morning briefing around the day's timeline — **yes**, in scope.
- Re-calculating which tier a matter belongs in — **no**, that is task-prioritization's job.
- Drafting the retainer notice — **no**, that is time-entry-drafting and client-communications.
- Scheduling tasks into time slots based on calendar availability — **no**, deferred pending calendar source integration.

## 4. Non-Goals

- **Ranking logic** — The three-tier ranking (Remind → Work → Paused) and tie-breaking belong to task-prioritization. executive-assistant reads ranked output; it does not produce it.
- **Data ownership** — executive-assistant does not store its own copy of trust balances, WIP totals, or deadline records. It reads from the skills that own those tables.
- **Client-facing output** — All output is for the practitioner's internal use only. No client-facing notices, letters, or billing summaries.
- **Billing and invoicing** — executive-assistant surfaces WIP signals, but it does not draft invoices or calculate billable amounts.
- **Calendar scheduling** — Fitting work into available time slots requires a calendar source not yet connected to this skill. Deferred; see Platform & Scope.

## 5. North Star

**The practitioner starts each morning already briefed — no triage required.**

A day succeeds when:
- The practitioner acts on the first recommendation without needing to verify it against raw data.
- No matter slips through the cracks between morning briefing and end of day.
- The WIP silence flag catches a billable-but-unrecorded file before billing prep, not during.

The on-demand slash command succeeds when mid-day re-prioritization takes seconds rather than minutes of mental assembly.

## 6. Anti-Patterns

*No anti-patterns documented yet — add entries here as they are discovered empirically.*
