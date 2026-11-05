---
name: task-prioritization
description: Maintain and rank the practitioner's to-do registry (retainer-first). Use to add or complete a to-do, see the ranked to-do list, or which files need attention, or to show the Practice Board (every matter's open work on one page). 'What should I work on' is answered only when the practitioner types /executive-assistant; do not route to it. Re-ranks when a retainer notice is sent, a trust balance changes, or a deadline updates.
user-invocable: true
---

<!-- lawyer v0.24.0 -->
> **Installed copy.** This skill's full source tree ships beside this file, and a relative path in the text below cites that tree. Resolve one by trying, in order: the directory of the file you are reading, then `${CLAUDE_SKILL_DIR}/<path>`, then `${CLAUDE_SKILL_DIR}/../<path>` (so `shared/x.md` is at `${CLAUDE_SKILL_DIR}/../shared/x.md`). The host substitutes `${CLAUDE_SKILL_DIR}` with the directory holding this SKILL.md when this file loads; if the literal text `${CLAUDE_SKILL_DIR}` is what you see, that IS the definition: it means the directory containing this SKILL.md, not a placeholder to search for or guess. Read references and shared files natively from there, never over the litigation data server's skill-source tool and never by requesting folder access; scripts and templates the text declares are executed and read from there too. Before each fresh read (a file not already in context), list only `${CLAUDE_SKILL_DIR}/../../..` (the folder holding this plugin's folder). If it holds this plugin's folder name, with any `~g<N>` suffix removed, plus a `~g<N>` higher than this plugin's folder's own (none counts as 0), or if `${CLAUDE_SKILL_DIR}` no longer exists, the plugin was re-synced mid-session: take the highest `~g<N>` copy and repeat the same three tries with its `skills/<this skill>` directory in place of `${CLAUDE_SKILL_DIR}`; tell the user once that the plugin updated mid-session, from the version in this file's version comment to the version in that folder's copy of this SKILL.md. If a file the text names is missing at every one of those paths, including the re-synced folder's, STOP and report the exact path and error to the user rather than substituting an alternative: do not re-derive a script's logic from its source text or the prose, and do not search elsewhere on the filesystem. Ask the user to reinstall the plugin and fully restart the app; this may fix it, but STOP means stop regardless: do not diagnose further yourself.
> **HTML pages.** Every HTML file this plugin writes is a human interface generated from its databases; an agent never views, reads, greps, parses, scripts over, authors or requests a screenshot of one, but may present one to a human user to view, staging it first where presenting needs that, and may view a screenshot the user provides on their own initiative. The rule and the data to use instead: `shared/html-pages.md`.

**Internals stay confidential** (`shared/internals-confidentiality.md`): nothing the practitioner sees names a Probanda tool, table, field, internal type or code, or explains how Probanda works inside. It hides mechanism, never an outcome or an error.

## Contents

| Section | Read when |
|---|---|
| Three-Tier Ranking Model | Ranking to-dos into Remind, Work or Paused, or breaking ties within Work |
| Core Workflows | Adding, completing, withdrawing or rewording a to-do, pointing one at a filing, recording a retainer notice, or surfacing due nudges |
| Read Query: Ranked To-Do List | Fetching open to-dos and applying the tier and sort logic |
| Output Format | Displaying the ranked to-do list |
| Anti-Patterns | Before any ranking, write or reminder change, to check what to avoid |

This skill deliberately carries no `disable-model-invocation` line: `/executive-assistant` opens it
through the Skill tool, which refuses a skill carrying that line. It is a stated
exception. Do not add the line back.

# Task Prioritization

Maintain a ranked registry of to-dos — client work, administrative duties, and professional
obligations — and answer "what should I work on next?" The registry is persistent (to-dos
are never deleted) and every ranked output shows the reasoning behind each placement.

**Vocabulary.** A registry row is a **to-do** in everything the practitioner sees: the list, its
headings, confirmations and questions (ADR 0021 D4). "Task" survives only in internal names: the
`task` item kind and the `upsert-task`, `complete-task` and `open-tasks` operations.

**Reads:** matters, clients, time entries and retainer notices through `/practice-data`
**Writes:** tasks and retainer notices through `/practice-data`
**Items defined in:** `practice-data/SKILL.md` — do not redefine here

## Three-Tier Ranking Model

To-dos are ranked into three tiers, in this order:

| Tier | Condition | Action |
|------|-----------|--------|
| **Remind** | `regular_trust = 0` AND no retainer notice recorded for this matter | Send written replenishment notice — quick, high-leverage, creates paper trail |
| **Work** | Funded matter (`regular_trust < 0`), OR admin/professional to-do, OR retainer status unknown (no matter item) | Active work |
| **Paused** | `regular_trust = 0` AND a retainer notice is recorded (client warned in writing) | Work on hold pending replenishment |

**Sign convention:** A funded retainer is stored as a negative number (`regular_trust < 0` = funded, `regular_trust = 0` = depleted). No matter item = unknown → treat as Work tier with a `[retainer unknown]` flag.

### Tie-Breaking Within the Work Tier

1. **Deadline proximity** — due within 30 days → highest; due beyond 30 days → middle; no deadline → lowest. Among to-dos due within 30 days: sooner deadline wins.
2. **Net available trust** (when deadline status is equal) — `abs(regular_trust) − unbilled_wip_hours`. Higher net trust wins. Admin/professional to-dos: treat net trust as 0.

## Core Workflows

### 1. Rank and display the to-do list

When the user asks "what should I work on?", "what's next?", or wants the ranked list:

1. Fetch all open to-dos (see [Read query](#read-query-ranked-to-do-list))
2. Assign each to-do to Remind, Work, or Paused per the tier model
3. Within Work tier, apply tie-breaking (deadline proximity → net trust)
4. Display using the [Output format](#output-format) — always show the reasoning

When the user asks to see the practice board, or all work across the practice as a page, do not rank. Call `practice-data`'s practice-board operation (`practice_data__render_practice_board`), present the page as a file card (`shared/present-files.md`) by its `practice_board_path`, and relay only the panel counts it returns. Never read the page (`shared/html-pages.md`).

### 2. Add a to-do

A to-do is one outcome the practitioner would cross off, such as "Re-file default judgment
application". Work toward it (research, checks, attaching evidence) is jobs on the Work Board of the
filing it points to, never another to-do. Research that serves a filing is always a job on that
filing. Apart from the follow-up and rule-change diary to-dos `lawyer:docket-clerk` writes, this
skill is the only one that creates a to-do, and a drafting session hands its to-do requests here
(ADR 0023 D1, D2).

1. If a client to-do: match against the matter's `matt_num` or the client's name; confirm if ambiguous
2. Read the matter's open to-dos first (``practice-data`` `open-tasks` with the matter ref). If one
   is the same outcome, or points to the same filing, offer to fold the new work into it instead.
3. Collect: description, time estimate (optional), deadline (optional), and — when the practitioner
   asks to be reminded on a cadence ("remind me weekly until the order arrives") — the nudge fields:
   `nudge_interval_days` ("weekly" → 7, "monthly" → 30, or an explicit day count; omit for a one-shot
   reminder) and `next_nudge_date` (the first date it should surface; default today + interval, or
   today for a one-shot). A deadline goes in `deadline_date`, never in the description: the
   description shows on the matter's Litigation Strategy page, which drafting sessions see (ADR 0021 D2). A to-do about a filing is created only once that filing or pre-filing proceeding exists in the submission
   database, and always with its pointer ([workflow 7](#7-point-a-to-do-at-a-filing-or-clear-the-pointer)).
   If it is not saved yet, say so and add nothing: `/draft` saves it first (ADR 0023 D3). A letter
   or email to the forum or to another party is a Writing like any filing: "it's a letter, not a
   filing" is never a reason to add its to-do without the pointer (ADR 0024 D13).
4. Invoke ``practice-data`` `upsert-task` to create the to-do. If it refuses because the filing
   already has an open to-do, name that to-do from the refusal and offer to fold the new work into it
   as jobs on the filing's Work Board.
5. Confirm: "Added to-do: [description] — [matter name if applicable]". Never echo the returned row.
6. Ask if they want to see the updated ranked list

### 3. Complete a to-do

1. Identify the to-do by description or ID
2. Ask for actual time spent (optional — feeds billing and estimate calibration)
3. Invoke ``practice-data`` `complete-task` with the to-do's ID and actual hours
4. Confirm completion; when the timekeeper plugin is installed, tell the practitioner they can run `/time-entry-drafting` for the day the work was done (without it, say nothing about time entries)

### 4. Send retainer replenishment notice

When the user confirms a replenishment notice has been sent:

1. Identify the matter
2. Invoke ``practice-data`` `record-retainer-notice` for the matter
3. Confirm: "Recorded notice for [matter name]. To-dos for this file will move to Paused."
4. Show updated tier assignment for that matter's to-dos

### 5. Retainer replenished

When a formerly-depleted matter is now funded (after a new import via `retainer-tracking`):

- To-dos automatically re-enter the Work tier on next ranking — no action in this skill
- Retainer data is live from the matter items

### 6. Surface and advance due nudges

The recurring-reminder loop. The caller (normally `executive-assistant`) states its mode:
**briefing mode** (the cron-fired morning briefing) or **on-demand mode** (anything else).

1. Invoke ``practice-data`` `open-tasks` and select every row whose `next_nudge_date` is on or before
   today and whose `last_nudged_at` is null or dated before `next_nudge_date`. Those are the due
   nudges. Compare by calendar date: a `last_nudged_at` on or after `next_nudge_date` means that
   date's nudge was delivered.
2. Return the due list to the caller — each with matter, description, `last_nudged_at`,
   `nudge_interval_days`, and, for a recurring item, the date it will next nudge after advancing.
3. **Briefing mode only** — advance each surfaced item via ``practice-data`` `upsert-task`, keyed by
   `id`:
   - Recurring (`nudge_interval_days` set): `next_nudge_date = today + nudge_interval_days`,
     `last_nudged_at = now`. Advance from **today**, never from the stored date — a missed run must
     not produce a catch-up burst.
   - One-shot (`nudge_interval_days` null): stamp `last_nudged_at = now` and leave `next_nudge_date`
     as it is. It is the to-do's BF date, which stays on the Litigation Strategy page (ADR 0021, amendment of
     2026-09-22). The stamp alone keeps the to-do out of later runs, and moving the BF date later
     re-arms it.

   In on-demand mode, perform **no writes** — showing a due nudge must not consume tomorrow
   morning's reminder.
4. After any advancing run, take the export snapshot per ``practice-data`` conventions.

### 7. Point a to-do at a filing, or clear the pointer

A to-do may point to one filing, or one pre-filing proceeding, of its own matter. The matter's To
Do List then shows that filing's one-line status under the to-do, and the filing stays in the
list of filings below (ADR 0021 D5). The pointer holds no jobs and no plan: a filing's jobs stay on
its own Work Board.

1. Identify the to-do. It must belong to a matter: an admin or professional to-do with no matter
   points nowhere.
2. Ask `/drafting-data` for the matter's filings and pre-filing proceedings, each with its id,
   and confirm with the practitioner which one is meant. If the `drafting-data` skill is not
   available in this session, the `litigator` plugin is not installed and there is no filing to
   point to: say so and stop.
3. **Set:** invoke ``practice-data`` `upsert-task` keyed by the to-do's `id`, with `filing_ref`
   `filing:<id>` for a filing or `proceeding:<id>` for a pre-filing proceeding. Pointing it
   elsewhere is the same call with the new value. A filing has at most one open to-do in its matter
   (ADR 0023 D4), so `upsert-task` refuses a pointer to a filing another open to-do already points
   to, and names that to-do. Offer to fold this to-do into it, or to withdraw one of them
   ([workflow 8](#8-withdraw-a-to-do)).
4. **Clear:** invoke `upsert-task` keyed by `id` with `filing_ref: null`. The to-do stays open.
5. Confirm: "[description] now points to [filing title]" or "[description] no longer points to a filing."

A pointer whose filing was deleted, or whose proceeding has since gained a filing, no longer
resolves: the Litigation Strategy page shows the to-do without a status line and nothing fails. Re-point or clear
it when the practitioner asks.

### 8. Withdraw a to-do

A to-do entered in error, or merged into another, is withdrawn. The row stays, it is not completed,
and the ranked list and the Litigation Strategy page leave it out (ADR 0023 D6).

1. Identify the to-do by description or ID
2. Invoke ``practice-data`` `upsert-task` keyed by its `id` with `status: "withdrawn"`. Withdrawing
   leaves any earlier completion date and actual hours untouched.
3. Confirm: "Withdrew to-do: [description]", naming the to-do it was merged into when it was merged

### 9. Reword a to-do

A registry rejection's package number and date go into the filing's to-do this way (ADR 0023 D5).

1. Identify the to-do by description or ID
2. Invoke ``practice-data`` `upsert-task` keyed by its `id` with the new `description`
3. Confirm the new wording: "Reworded to-do: [new description]"

## Read Query: Ranked To-Do List

Invoke ``practice-data`` `open-tasks` operation to retrieve all open to-dos with their associated matter, client, trust balance, unbilled hours, and retainer-notice count.

**Note on WIP value:** The operation returns hours (not dollar value) because hourly rates are not yet stored.

**Tier assignment and sort logic:**

For each to-do returned by the operation:
1. **Tier assignment:**
   - Admin/professional to-do (no matter): → Work
   - Trust balance unknown (no matter record): → Work, flagged as `[retainer unknown]`
   - Trust balance = 0, no retainer notice sent: → Remind
   - Trust balance = 0, retainer notice on file: → Paused
   - Trust balance funded (non-zero): → Work
2. **Deadline ranking** (within Work tier):
   - Due within 30 days: highest priority (sorted by deadline date)
   - Due beyond 30 days: middle
   - No deadline: lowest
3. **Net trust tie-breaker:** `abs(trust_balance) − unbilled_hours` — higher net trust wins. Admin/professional to-dos: treat as 0.

Final sort key: `(tier_order, deadline_rank, -net_trust)`

## Output Format

```
## To-Do List — [date]

### Remind (2)
1. Send retainer replenishment notice — Smith v Jones [L1234]
   Why: Retainer depleted ($0). No written notice on file. Quick action; creates paper trail.

### Work (3)
2. File response to notice of civil claim — Patel v Chen [L2201]
   Why: Funded retainer ($4,200 net of WIP). Deadline: 2026-05-01 (8 days). Est. 3 h.

3. Complete annual CLE reporting  [admin]
   Why: No retainer signal. No deadline on file. Est. 2 h.

### Paused (1)
4. Draft statement of claim — Hernandez v BC Hydro [L0991]
   Why: Retainer depleted ($0). Written notice sent 2026-04-10. Awaiting replenishment.
```

Rules:
- Show all three tier headings even when empty (mark as "(0)")
- Every item must have a "Why:" line citing tier assignment, deadline, and net trust
- Display `abs(regular_trust)` — never the raw negative value
- Flag unknown retainer status: append `[retainer unknown]` to the Why line
- Admin/professional to-dos always show `[admin]` or `[professional]` label

## Anti-Patterns

- **Ranking by retainer balance within the Work tier** — net trust is a tie-breaker after deadline proximity, not a primary signal
- **Classifying Remind/Paused when matter has no matter item** — unknown retainer status belongs in Work, flagged
- **Displaying raw negative trust values** — always `abs(regular_trust)`
- **Deleting completed to-dos** — set `status='completed'`; keep the row for billing and estimate calibration
- **Completing a to-do to remove it** — a to-do entered in error or merged into another is withdrawn ([workflow 8](#8-withdraw-a-to-do)). Completing it pollutes the actual-hours and estimate data
- **Writing a deadline into a to-do's description** — it goes in `deadline_date`, which the Litigation Strategy page never shows; a description is shown to drafting sessions
- **Creating a `scheduled-tasks` entry for a per-item reminder** — cadence lives on the to-do's row as `next_nudge_date` + `nudge_interval_days` (see ``practice-data``'s operations/consumer-contract.md); the scheduler is a clock tick, not a record of what is due
- **Advancing `next_nudge_date` outside briefing mode, or from the stale stored date instead of from today**
- **Feeding nudge-due items into the ranking model** — they are a separate surfaced list, not a tier input or tie-breaker
- **Calculating or storing deadlines** — read `deadline_date` from the to-do (manual entry) or from `lawyer:docket-clerk`; never recalculate
- **Parsing the accounting CSV directly** — trust data enters only through `retainer-tracking`'s import workflow
