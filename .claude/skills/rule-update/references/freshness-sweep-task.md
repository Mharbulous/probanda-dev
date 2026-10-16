# Weekly rule-freshness sweep

A desktop-app scheduled task, `rule-freshness-sweep`, fires once a week, Monday at 6:00 am local time (cron `0 6 * * 1`), before the morning briefing. It finds a court-rule change before any matter calculation meets it. Decided 2026-10-09: weekly, and it only diarizes.

**Why a scheduled task here.** The no-scheduler rule (`docket-clerk.md` Anti-Patterns, `task-prioritization`) is about a practitioner's per-item reminders, which are nudge fields on a to-do. This task is different: it is firm-wide maintenance that checks the published law, and it owns no reminder of its own. What it finds becomes an ordinary to-do.

**Where it runs.** On the practitioner's PC with the desktop app open, because `sources__check` and the bclaws fetches run there. If the PC is offline, the sweep reports "freshness not verified" and blocks nothing, as the gate says (`rule-freshness.md`, Offline / sandbox degrade). A missed week is caught by the next run, or by the next matter calculation's own gate.

## What it does

1. Spawns `legal:docket-clerk` for workflow 12, "Freshness sweep (no matter)".
2. Relays the clerk's reply as the run's final message.

That is all. It never runs `/rule-update`, never fetches a regulation's text, never asks for an approval, and never writes an overlay record, a deadline or an anchor. Its one write, made by the clerk, is a to-do whose description begins `Rule change:`. The next morning briefing shows that to-do as "Rule change detected — run /rule-update" (`executive-assistant`, Workflow 2), and the practitioner runs `/rule-update` in a session that is not drafting.

## The task prompt

The prompt names its only write, because the desktop app's scheduled-run preamble otherwise tells the run to skip writes the prompt does not name:

```text
Weekly rule-freshness sweep. Spawn legal:docket-clerk with this prompt: "Freshness sweep (workflow 12). No matter." Its only write is a practice-data to-do whose description begins "Rule change:", which you may let it make. Do not run /rule-update, fetch any regulation, or write any overlay record, deadline or anchor. Final message: the clerk's reply, verbatim.
```

## Installing it

The practitioner installs it once, in the desktop app, with `create_scheduled_task`: name `rule-freshness-sweep`, cron `0 6 * * 1`, and the prompt above. Running it in a session other than the morning briefing's keeps the briefing session free of the deadline lane.
