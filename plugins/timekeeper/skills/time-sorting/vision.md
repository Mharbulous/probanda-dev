# Time-Sorting — Vision & Design Philosophy

**Date:** 2026-04-12

## 1. Platform & Scope

Time-sorting is a skill within CoClerk, a Claude Cowork plugin. It classifies raw computer activity data from three sources — TimeCamp (screen activity), Telus Connect/RingCentral (phone calls), and Google Calendar (court appearances and meetings) — into matter-attributed and category-attributed time blocks stored in the time-pipeline store.

**2026-08-26 revision:** this skill was originally framed as a bridge solution, to be replaced wholesale once SyncoPaid — a standalone desktop app — was ready to own the full capture-and-classify pipeline. That framing is superseded: SyncoPaid is now treated as one more evidence source feeding this same classification pipeline, not a replacement for it. Reason: `Engineering/2. Plan/2026-08-26_billing-pipeline-plan.md` (§ Decision, extending the existing build-timeline/time-sorting pair rather than building a new unified raw→WIP skill) — a future SyncoPaid integration adds a registered source, per the existing per-source registry pattern, rather than retiring this skill. See §6 History.

### Platform Constraints

- **Data sources:** TimeCamp REST API (token auth), Google Calendar, Telus Connect/RingCentral call logs
- **Read-only:** All data source interactions are read-only — the skill never writes back to any source
- **Storage:** local SQLite via the Probanda plugin's MCP data runtime, behind a dedicated gatekeeper skill (Python `sqlite3`, no binaries) — decided 2026-08-26, see `Engineering/1. Design/2026-08-26_time-pipeline-store-design.md`. Supersedes the retired Go `cowork-db` CLI, which has no source in this repo and ships no executable.
- **API constraint:** TimeCamp's API supports per-day queries only — no date-range fetches

## 2. Purpose

### Audience

A sole BC litigation practitioner — the same audience as the parent plugin.

### Pain Points

**Time classification overhead.** TimeCamp captures screen activity automatically, but the raw data is a stream of window titles and application names. Converting that into "0.3 hours on the Smith file" is manual work that gets deferred, leading to lost billable time and inaccurate records.

**Coverage gaps.** TimeCamp only sees screen activity. Phone calls (Telus Connect) and in-person meetings or court appearances (Google Calendar) leave no trace in TimeCamp. Without merging these sources, the reconstructed day has holes.

**Backlog accumulation.** When daily classification is skipped, unclassified days pile up. Reconstructing a week of activity from memory is far harder than reviewing today's.

### Value Proposition

The practitioner gets a classified account of how every hour of the day was spent — billable matters and non-billable categories alike — without manually sorting through raw activity logs. The output is available for review, querying, and consumption by downstream billing skills.

### Killer Use Case

End of a busy day. The practitioner asks "sort today's time." The skill fetches TimeCamp activities, Telus call logs, and calendar events, merges them into a timeline, classifies each block to a client matter or non-billable category, and presents the result. The practitioner reviews, corrects one or two entries, and the day's time is accounted for — in minutes rather than the usual end-of-week reconstruction exercise.

## 3. Theme & Design Philosophy

### Design Principles

#### 3.1 Read-Only Interaction with Data Sources

ALWAYS treat TimeCamp, Google Calendar, and Telus Connect as read-only data sources. NEVER write back to any source API.
**Why:** These are the ground truth for what actually happened. Writing back risks corrupting or losing source data that can't be reconstructed.
**Violation example:** The skill detects a misclassified TimeCamp entry and "helpfully" updates the TimeCamp task assignment via the API, overwriting the original activity record.

#### 3.2 Merge Before Classifying

ALWAYS reconstruct a complete timeline from all available sources before classifying any individual block. NEVER classify activities from one source in isolation.
**Why:** A Telus phone call at 2pm changes the meaning of TimeCamp screen activity at 2pm. Classifying TimeCamp data without knowing the call exists produces incorrect results.
**Violation example:** The skill processes TimeCamp activities first, classifies the 2-2:30pm block as "research on Smith file" based on window titles, then processes Telus data and discovers a phone call during that same window — but the TimeCamp classification has already been committed.

#### 3.3 Source Hierarchy for Activity Type, Context from All

The source that best captures what the practitioner was *doing* determines the activity type. Lower-priority sources provide context for matter attribution.

- **Telus Connect** — strongest signal when present. A phone call is unambiguous activity. TimeCamp window titles during the call may indicate which matter the call concerned.
- **TimeCamp** — highest volume, covers most of the day. Yields to Telus when call data exists, but provides the primary classification signal for screen-based work.
- **Google Calendar** — weakest signal, but sometimes the only one. Court appearances and in-person meetings leave no trace in TimeCamp or Telus. Calendar events fill gaps where no other source has data.

**Violation example:** Telus shows a 20-minute call at 2pm. TimeCamp shows the practitioner had the Jones file open during that call. The skill classifies the block as "screen work on Jones file" based on TimeCamp's window title — but the practitioner was on a phone call, and the Jones window title is supplementary context for matter attribution, not the activity type.

#### 3.4 Source Attribution for Every Classified Block

Every classified time block must trace back to the raw source data that produced the classification. The practitioner should be able to see *why* a block was classified the way it was — which sources contributed, what signals were used.
**Why:** This is the time-sorting-specific application of the parent plugin's "Show, Don't Tell" principle (3.5). Time classifications inform billing decisions. An opaque classification that turns out to be wrong erodes trust in the entire system.
**Violation example:** The skill outputs "2:00-2:30pm — Smith file, phone call" without showing that the activity type came from a Telus call record and the matter attribution came from a TimeCamp window title showing "Smith - LEAP" during the call.

### Litmus Test

**"Is this about classifying, storing, or reporting how time was spent from raw activity data?"**

- "Classify today's activities across all sources" → **Yes**, time-sorting
- "How much time did I spend on the Smith file this month?" → **Yes**, time-sorting (reporting on classified data)
- "What's the Smith file's current retainer balance?" → **No**, retainer-tracker
- "Generate an invoice for March" → **No**, billing/invoicing skill
- "Draft a time entry narrative for today's Smith file work" → **Aspirational** — not current scope, but a future goal

## 4. Non-Goals

- **Time capture** — The skill classifies and reconciles data that other tools have already captured. It does not record screen activity, track keystrokes, or monitor application usage.
- **Real-time monitoring or alerts** — The skill operates on historical activity data, not live streams. No idle detection, no "you've been unfocused for 30 minutes" notifications.
- **Billing rates or financial calculations** — The skill classifies *what* was done, *for whom*, *when*, and *for how long*. Attaching dollar values, tracking retainer balances, and generating invoices belong to downstream skills.
- ~~Future-proofing for SyncoPaid~~ — **superseded 2026-08-26**, see §1 and §6 History. This non-goal assumed SyncoPaid would replace the pipeline wholesale; it is now planned as one more registered evidence source instead, so the source-registry mechanism this non-goal disclaimed is now in scope (owned by build-timeline, not this skill).

## 5. North Star

**Percentage of a day's tracked time that is classified** — whether to a billable client matter or a non-billable category (admin, billing, training, professional development, business development, technology troubleshooting, onboarding, bookkeeping, etc.).

The goal is to drive unclassified and lost time toward zero. A perfect day means every tracked hour has a classification and no significant time is unaccounted for.

## 6. Anti-Patterns

*No anti-patterns documented yet — add entries here as they are discovered empirically.*

### History

- 2026-08-26: SyncoPaid reframed from wholesale replacement to one more evidence source; §1/§4 rewrite scheduled with the storage decision.
