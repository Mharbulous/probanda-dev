---
name: executive-assistant
user-invocable: true
description: Explicit invocation only. Runs when the practitioner types /executive-assistant, or when a scheduled task names this skill for the morning briefing. Never trigger from natural-language requests such as "what should I work on", "what's next" or "give me a briefing" — leave those to the practitioner unless the slash command was typed.
---

<!-- legal v0.8.4 -->
> **Installed copy.** This skill's full source tree ships beside this file, and a relative path in the text below cites that tree. Resolve one by trying, in order: the directory of the file you are reading, then `${CLAUDE_SKILL_DIR}/<path>`, then `${CLAUDE_SKILL_DIR}/../<path>` (so `shared/x.md` is at `${CLAUDE_SKILL_DIR}/../shared/x.md`). The host substitutes `${CLAUDE_SKILL_DIR}` with the directory holding this SKILL.md when this file loads; if the literal text `${CLAUDE_SKILL_DIR}` is what you see, that IS the definition: it means the directory containing this SKILL.md, not a placeholder to search for or guess. Read references and shared files natively from there, never over the litigation data server's skill-source tool and never by requesting folder access; scripts and templates the text declares are executed and read from there too. If `${CLAUDE_SKILL_DIR}` itself no longer exists, the plugin was re-synced mid-session: list only `${CLAUDE_SKILL_DIR}/../../..` (the folder that held this plugin's folder), take the folder named as this plugin's folder with any `~g<N>` suffix removed plus the highest `~g<N>`, and repeat the same three tries with its `skills/<this skill>` directory in place of `${CLAUDE_SKILL_DIR}`; tell the user once that the plugin updated mid-session, from the version in this file's version comment to the version in that folder's copy of this SKILL.md. If a file the text names is missing at every one of those paths, including the re-synced folder's, STOP and report the exact path and error to the user rather than substituting an alternative: do not re-derive a script's logic from its source text or the prose, and do not search elsewhere on the filesystem. Ask the user to reinstall the plugin and fully restart the app; this may fix it, but STOP means stop regardless: do not diagnose further yourself.
> **HTML pages.** Every HTML file this plugin writes is a human interface generated from its databases; an agent never views, reads, greps, parses, scripts over, stages, authors or requests a screenshot of one, but may present one to a human user to view, and may view a screenshot the user provides on their own initiative. The rule and the data to use instead: `shared/html-pages.md`.

## Contents

| Section | Read when |
|---|---|
| Core Principle: Surface, Don't Rank | Always |
| Data Fetch | Every run, first |
| Workflow 1: On-Demand ("What should I work on?") | The practitioner typed /executive-assistant on demand |
| Workflow 2: Morning Briefing | The cron-fired morning briefing runs |
| Workflow 3: Briefing Delivery (morning-briefing mode only) | Workflow 2 has composed the briefing and it is to be emailed |
| On-Demand Format | Composing the on-demand output |
| Morning Briefing Format | Composing the morning briefing output |
| Anti-Patterns | Before composing or delivering any output |

# Executive Assistant

Synthesize the ranked to-do list from `task-prioritization` with deadline urgency, WIP signals, and
matter status into a single actionable recommendation. Two invocation modes share one data layer:

- **On-demand** (``executive-assistant``): answers "what now?" with a current-state snapshot
- **Morning briefing** (cron-triggered): answers "what today?" as an exception report — what is
  newly due since the last run, not everything on file. The scheduling trigger is external (one
  fixed weekday cron; this skill never creates or re-arms a trigger); it handles the briefing
  output when invoked.

**This skill writes nothing to the practice database.** The only DB mutation in its pipeline is
`task-prioritization`'s nudge-advance workflow, invoked in morning-briefing mode only. Morning-briefing
mode also sends one email ([Workflow 3](#workflow-3-briefing-delivery-morning-briefing-mode-only));
on-demand runs are strictly read-only and never email.

Reads from: `task-prioritization` (ranked to-do registry and due nudges), `legal:docket-clerk`
(upcoming deadlines), and `practice-data` (matter context and trust balances via `ar-data`, the WIP
silence signal via `trust-summary` and `time-entries`, matter status via `read-signals`).

## Core Principle: Surface, Don't Rank

Tier assignments (Remind / Work / Paused) belong to `task-prioritization`. Never recompute tiers
from `regular_trust` or `notice_count` in this skill — that is the violation vision §3.1 names.

Invoke `task-prioritization`'s ranking workflow and consume its ranked output, then layer on
deadline urgency, WIP silence signals, and matter status as supplementary context.

## Data Fetch

All practice-database access goes through ``practice-data``. This skill composes read operations; it
never opens the database, resolves a path, or writes SQL. Compute the date windows skill-side from
today: `today`, `today + 30 days` (the enrichment horizon), and the WIP cutoff `today − 21 days`.
The briefing's threshold ladder needs no window of its own — it works off days-remaining and the
lookback in Workflow 2 step 3.

Run **`ar-data`** first. On error, report it and stop. Otherwise build the matter-context map from
its non-closed matters (`matt_num`, `client_name`, matter row id, `regular_trust`, WIP hours, and
payment-in-flight), keyed by matter row id to enrich deadlines and signals below.

1. **Upcoming deadlines.** Spawn `legal:docket-clerk` for its **workflow 5** ("Query deadlines for a matter (or
   all matters)") as an all-matters sweep — never raw `active-deadlines`. Going through workflow 5
   inherits its Step-0 rule-freshness gate, its prominent conflicted-anchor reporting, and its
   `rule_stale` / `shift_pending` / `limited_day` / `practitioner_choice` flag surfacing; offline it degrades to "freshness
   not verified" rather than blocking. Keep deadlines whose `deadline_date` falls between `today` and
   `today + 30 days`; enrich each with `matt_num` / `client_name` from the ar-data map. If it returns
   no deadlines, treat deadline data as absent (see the gap table).

2. **WIP silence — funded matters with no time entries in the last 21 days.** Call **`trust-summary`**
   with `filter: funded` for the funded matter set, and **`time-entries`** with no matter ref for all
   entry rows. Compute `MAX(entry_date)` per matter row id skill-side. A funded, non-closed matter whose
   most recent entry is `≥ 21 days` before today — or which has no entries at all — is **silent**;
   record `last_entry_date` and `days_since_entry` for the output.

3. **Matter status — unconfirmed signals.** For each non-closed matter in the ar-data map, call
   **`read-signals`** and keep the signals whose `state` is `unconfirmed`; enrich with
   `matt_num` / `client_name`. (Practice data is small; a per-matter loop is acceptable.)

4. **Due nudges.** Run `task-prioritization` **workflow 6** ("Surface and advance due nudges"),
   stating this invocation's mode — **briefing** for the cron-fired morning briefing, **on-demand**
   otherwise. That mode is what decides whether the nudges advance; this skill never writes them.

5. **Contact gaps.** Call **`contact-checks`** with no matter ref, and keep the two counts:
   `matters_without_client` and `parties_without_role` (ADR 0009).

Report data gaps explicitly — never silently omit matters:

| Condition | Report |
|-----------|--------|
| the deadline sweep returns no deadlines | "No active deadlines on file — spawn `legal:docket-clerk` to record court dates first." |
| `read-signals` returns no signals across matters | "No matter status signals on file — run `matter-status-tracking` to set them up." |
| `open-tasks` (via `task-prioritization`) returns nothing | "No open to-dos on file — add to-dos via `task-prioritization`." |
| `ar-data` returns no matters | "No matters found — check that `retainer-tracking` has been imported." |
| any required fetch fails | "Data source unavailable — [exact error]. Briefing incomplete." |

## Workflow 1: On-Demand ("What should I work on?")

1. After `ar-data` succeeds, run `task-prioritization`'s rank-and-display workflow to get the current ranked to-do list with tier assignments.
2. Fetch upcoming deadlines and WIP silence data using the operations above.
3. Enrich each to-do in the ranked list:
   - Append deadline proximity if the to-do's matter has a deadline within 30 days
   - Append WIP silence flag if the matter qualifies
   - Append matter status if unconfirmed signals exist
4. Append the to-dos coming forward (the due-nudge list) from Data Fetch step 4 — read-only, invoked in on-demand mode, so
   nothing advances.
5. Output using the [On-Demand Format](#on-demand-format).

## Workflow 2: Morning Briefing

Fired by an external cron trigger. Frames the day ahead rather than repeating the ranked queue.
It is an **exception report**: it surfaces what is newly due since the last run, not everything on
file. The full listings stay one question away.

1. After `ar-data` succeeds, fetch the ranked to-do list from `task-prioritization`.
2. Fetch deadlines, WIP silence, matter status, and due nudges using the operations above — Data
   Fetch step 4 runs in **briefing** mode here, so surfaced nudges advance.
3. Determine the **lookback window**: local calendar days from this scheduled task's previous
   successful run to today, minimum 1. That run is the `started_at` of the newest `list_task_runs`
   entry with status `succeeded`, for the taskId the launching prompt names. Never use `lastRunAt`:
   it is stamped at run start, so it is this run. If `list_task_runs` fails or has no such entry,
   use 3 days and end the briefing with the line "Lookback fallback: no earlier successful run
   found, 3 days used." The window is what makes Monday's run pick up Saturday's and Sunday's
   crossings, and stops a skipped week from swallowing a threshold entirely.
4. Compose the briefing in four sections (omit sections with nothing to report):
   - **Requires action today** — to-dos whose deadline is today or tomorrow; Remind-tier to-dos
   - **To-dos coming forward today** — the workflow-6 list; each item shows matter, description, when it last
     nudged, and its nudge line per the [Morning Briefing Format](#morning-briefing-format) rules
     (a next-nudge date for a recurring item only)
   - **Newly urgent deadlines** — for `active` deadlines: those whose days-remaining crossed a ladder
     threshold **{30, 14, 7, 3, 1, 0}** within the lookback window, plus **every overdue deadline,
     daily**, until it is superseded or resolved. A deadline that crossed nothing today does not
     appear. `not_applicable` deadlines (the other side's obligation) invert this: never ladder-crossed,
     never reported before their due date — surface one only once it is overdue and its
     `expiry_notified_at` is unset, then immediately spawn `legal:docket-clerk` to stamp
     `expiry_notified_at` on it (via `upsert-deadline`) so it does not repeat tomorrow; label it
     distinctly from an overdue own-side deadline (e.g. "other side's deadline expired"), since it is
     informational, not a to-do of ours. `dismissed` deadlines never appear — `active-deadlines`
     excludes them from the sweep already. A deadline's `practitioner_choice` alternatives (same
     matter, deadline type and party, each with its own `scenario_label`) are **one item**: run the
     ladder and overdue tests on the earliest alternative's date and show that date flagged
     `practitioner_choice`, with "N alternatives, unresolved — choose via `legal:docket-clerk`".
     Never present any alternative as the deadline.
   - **Flags** — WIP silence on funded files; unconfirmed matter lifecycle signals; and each open
     to-do whose description begins `Rule change:` (written by the docket-clerk's rule-freshness
     gate or its freshness sweep), shown as "Rule change detected: <amending reg> — run
     /rule-update" in a session that is not drafting. Show it every day the to-do stays open. And,
     when either count from Data Fetch step 5 is above zero, one contact-gaps line naming both counts
     and "set up contacts from existing matters".
5. Add the standing footer count: "N other tracked deadlines, none newly urgent — ask for the full list."
6. Conclude with the top 3 to-dos from the full ranked list, for practitioners who want to work straight through the queue.
7. **Quiet-day short-circuit:** if no section has content, the whole briefing is two lines —
   "Nothing newly due today. N deadlines and M to-dos coming forward on file, all on schedule."
8. Output using the [Morning Briefing Format](#morning-briefing-format).
9. Deliver it by [Workflow 3](#workflow-3-briefing-delivery-morning-briefing-mode-only).

## Workflow 3: Briefing Delivery (morning-briefing mode only)

Runs after Workflow 2 has composed the briefing (or its two-line quiet summary, or its data-gap
notice). On-demand runs skip this workflow. The email goes out through the iCloud desktop
extension's `mail_send_email` tool, written by the practitioner's executive assistant, **Claudia**.
The extension is kept for this send alone: all mail reading goes through the legal plugin's data server's
`mail__*` tools.
Never call a Hostinger tool or endpoint (`email_call_api_read`, `email_call_api_write`).

0. **Read the delivery identity.** Read the `briefing` block of the per-install `probanda.json`
   (schema owned by `/practice-data`): `mailbox` (sending address), `to` (recipient) and
   `greeting_name`. If the block or any of its three values is absent, do not send and do not
   substitute any other address or name: record the data gap "Briefing delivery not configured:
   probanda.json has no complete `briefing` block" and go to step 5. If `mail_send_email` is not in
   this session's tools, record "iCloud mail extension not available in this session" and go to
   step 5.
1. **Confirm the sending address.** Call `mail_send_email` with the step 2 fields and
   `dryRun: true`. If the address in its `from` is not `briefing.mailbox`, do not send: record
   "Sending address is {from}, not {briefing.mailbox}" and go to step 5.
2. **Compose.** Call `mail_send_email` with:
   - `to`: `briefing.to`
   - `subject`: `Morning briefing — {Day}, {D Mon YYYY}`; on a quiet day append
     `: nothing newly due`; on a data-gap run append `: incomplete`
   - `text`: plain-text rendering of the briefing
   - `html`: simple HTML rendering — `<h3>`, `<ul>`, `<strong>` only, no other styling; one
     deadline, nudge or flag per `<li>`. The one exception: the text of each overdue own-side
     deadline's `<li>` is wrapped in `<span style="color:#c00000">`. The `⚠ OVERDUE` marker stays
     in both the text and html parts, so the plain-text part and mail clients that drop styling
     still show it. An "other side's deadline expired" item is not red.
3. **Voice (Claudia).** First person, brief, no emojis. A one-sentence opening line and the sign-off
   are the only prose Claudia adds — the briefing body is the Workflow 2 output verbatim, never
   paraphrased or reordered, and nothing is added that the briefing did not contain. The opening
   line greets `briefing.greeting_name`. Sign-off:
   `— Claudia`. Footer (last line): `Automated briefing · executive-assistant skill.` Never sign as,
   or write in the voice of, the practitioner.
4. **Send exactly once per run.** Send on quiet days too — a missing email is the signal that the
   pipeline failed; a short email is not noise. Treat any response without `sent: true` as a send
   failure. The step 1 dry run sends nothing and does not count.
5. **Failure path.** If the send fails, or the configuration, the mail tool or the sending address is missing or wrong, emit the briefing via
   PushNotification with the send error in its first line, so nothing is lost. Retry the send at
   most once.

Example (quiet day):

```
Subject: Morning briefing — Tue, 22 Sep 2026: nothing newly due

Good morning {greeting_name},

Nothing newly due today. 14 deadlines and 3 to-dos coming forward on file, all on schedule.

— Claudia

Automated briefing · executive-assistant skill.
```

## On-Demand Format

```
## To-Do Recommendation — [date]

### Remind (N)
1. Send retainer replenishment notice — Smith v Jones [L1234]
   Tier: Remind | Retainer: $0, no written notice on file | Est. 5 min

### Work (N)
2. File response to notice of civil claim — Patel v Chen [L2201]
   Tier: Work | Retainer: $4,200 | Deadline: 2026-05-01 (8 days) | Est. 3 h

3. Complete annual CLE reporting [admin]
   Tier: Work | No retainer signal | No deadline on file | Est. 2 h

### Paused (N)
4. Draft statement of claim — Hernandez v BC Hydro [L0991]
   Tier: Paused | Retainer: $0, written notice sent 2026-04-10

### To-dos Coming Forward (N)
- Follow up on the entered order — Smith v Jones [L1234]
  Last nudged 7 days ago | weekly | next nudge 2026-08-17
- Confirm the registry received the filing — Patel v Chen [L2201]
  Last nudged never | one-shot | no further nudge

---
[Data gaps, if any — e.g. "⚠ Deadline data unavailable"]
```

Rules:
- Show all three tier headings even when empty — mark as "(0)"
- Every item must show: tier, retainer status, deadline (if any), estimate (if any)
- Display `abs(regular_trust)` as the trust balance — never the raw negative
- Flag unknown retainer status: append `[retainer unknown]` to the item
- Admin/professional to-dos always show `[admin]` or `[professional]`
- To-dos coming forward follow the nudge-line rule in the [Morning Briefing Format](#morning-briefing-format) rules
- Report data gaps explicitly at the bottom — never silently omit matters

## Morning Briefing Format

```
## Morning Briefing — [day, date]

### Requires Action Today
- Send retainer replenishment notice — Smith v Jones [L1234]
  Retainer depleted, no notice on file. Quick action; creates paper trail.

### To-dos Coming Forward Today
- Follow up on the entered order — Smith v Jones [L1234]
  Last nudged 7 days ago | weekly | next nudge 2026-05-05
- Confirm the registry received the filing — Patel v Chen [L2201]
  Last nudged never | one-shot | no further nudge

### Newly Urgent Deadlines
- File response to civil claim — Patel v Chen [L2201]
  Deadline: 2026-05-01 (3 days — crossed the 3-day mark) | Rule 3-3 | Retainer: $4,200
- ⚠ OVERDUE — Witness list — Harrison v Chan [L1887]
  Deadline: 2026-04-14 (10 days overdue) | Rule 11-6(3) | Retainer: $6,200

14 other tracked deadlines, none newly urgent — ask for the full list.

### Flags
- ⚠ WIP silence — Harrison v Chan [L1887]: funded ($6,200), no time entries in 23 days
- ⚠ Matter signal unconfirmed — Boyd v Metro [L2044]: retainer_agreement_signed unconfirmed
- ⚠ Contact gaps — 2 open matters with no client recorded, 9 case-data parties with no matter role: set up contacts from existing matters

---
Top 3 to-dos for today (full ranked list via `task-prioritization`):
1. Send retainer replenishment notice — Smith v Jones [L1234]  [Remind]
2. File response to civil claim — Patel v Chen [L2201]  [Work, deadline 3 days]
3. Draft factual summary — Boyd v Metro [L2044]  [Work]

[Data gaps, if any]
```

Rules:
- The briefing is an exception report — group by what newly crossed, not by tier
- Omit sections that have nothing to report; if all sections are empty, use the two-line quiet summary
- The "N other tracked deadlines" count is always present when any deadline was withheld — silence about withheld items is what turns an exception report into a blind spot
- Every deadline item must show the deadline date, days remaining, the threshold it crossed (or "overdue"), and the rule reference
- Every to-do coming forward must show when it last nudged, or "never" when `last_nudged_at` is null. The rest of the line depends on its kind. The same rule applies to the On-Demand Format:
  - A recurring to-do (`nudge_interval_days` set) shows its cadence and its next nudge date, as workflow 6 returns it: `Last nudged 7 days ago | weekly | next nudge 2026-05-05`
  - A one-shot to-do (`nudge_interval_days` null) shows `one-shot | no further nudge` in place of a cadence and date: `Last nudged never | one-shot | no further nudge`. Never print a one-shot's stored `next_nudge_date` under a "next nudge" label. That value is its BF date, today or earlier, not a future nudge
- Every WIP silence flag must show the trust balance and exact days since last entry
- The "Top 3" footer is always present — it anchors the briefing to the ranked queue
- Show raw `abs(regular_trust)` as the retainer balance

## Anti-Patterns

- **Assigning tiers from `regular_trust`** — read tiers from `task-prioritization`'s output
- **Fetching retainer data differently in each mode** — both modes use the same DB queries
- **Treating the morning briefing as a dump of the ranked to-do list** — it must be temporally framed
- **Silently skipping matters with no matter item** — surface them with `[retainer unknown]`
- **Treating `regular_trust = NULL` as depleted** — NULL = unknown; only `= 0` is depleted
- **Drafting notices or invoices** — surface the need; leave execution to the appropriate skill
- **Re-calculating deadline dates** — read the stored deadline items; never recalculate
- **Advancing nudges on an on-demand run** — only the cron-fired briefing advances; an afternoon "what's next?" must not silently consume tomorrow morning's reminder
- **Reporting the full deadline listing daily** — the briefing is an exception report; the full list is on request
- **Fetching deadline data via raw `active-deadlines`** — go through `legal:docket-clerk` workflow 5, or the briefing skips the rule-freshness and anchor-conflict gates
- **Surfacing an overdue `not_applicable` deadline without stamping `expiry_notified_at`** — this is exactly the bug the status exists to fix: without the stamp, the same other-side deadline resurfaces as "overdue" every single run
- **Reaching practice data other than by a `practice-data` operation** — invoke the operation; never resolve a database path
- **Wrapping deadline reads but not signal reads (or vice versa)** — both are
  externally owned and may return nothing or fail; handle both symmetrically with try/except
- **Emailing on an on-demand run** — only the cron-fired briefing emails
- **Rewriting the briefing in Claudia's voice** — Claudia frames; she does not edit. The body must
  be the Workflow 2 output byte for byte
- **Sending without the dry-run address check** — the extension sends from whatever address it is
  configured with, so confirm its `from` matches `briefing.mailbox` on every run
- **Silently skipping the email on a quiet day** — the quiet-day email is the pipeline's heartbeat
