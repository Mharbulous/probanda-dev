# TimeCamp Time Entries Reference

How to fetch and write back TimeCamp's own pre-categorized
time entries — the amber/green timesheet blocks `/timecamping` exists to
correct. Load this file at Step 2 when populating `timecamp_time_entries`.

This is a **different** TimeCamp endpoint from `build-timeline/reference/TimeCamp.md`'s
computer-*activity* fetch: that file covers the desktop app's raw
application/window-title tracking (`/third_party/api/activity`); this one
covers the practitioner's actual **timesheet entries** — the rows with a
project/task assignment and a colour, shown in TimeCamp's own timesheet view.
`/timecamping` fetches both (see `sources.md`'s source-integration table).

## The TimeCamp connector

Same connector as build-timeline's activity fetch: the billing plugin's
`timecamp` server (each tool under whichever of `mcp__plugin_billing_timecamp__<name>` and
`mcp__remote-devices__plugin_billing_timecamp__<name>` this host grants), which holds the one
API token for the account. No skill reads, stores or passes the token.

**Hard rule.** Call the connector's `status` first. If it reports
`usable: false`, record this source as `failed` in `source_fetch_log` with its
`reason` and tell the practitioner that reason (never proceed to the assembly
gate for that day until either the API is usable or the source is
deliberately disabled in the registry, in which case it is `skipped`, not
`failed`). Never open the TimeCamp web app as a substitute. When no token is
set, `build-timeline/reference/TimeCamp.md` says how the practitioner sets it
through `configure_credential`.

## Fetching

Call the connector's `entries` with `from` and `to` both the day's date and
`out_file` a new scratch file's absolute path. It writes the rows to that file
as a JSON array, exactly as TimeCamp returns them, and returns only the count
and totals, so no row passes through the session. The connector keeps the
mandatory trailing slash on `/entries/` (confirmed live 2026-08-28, issue
#430 build). This source is fetched one local day at a time, same discipline
as every other source in this skill's Step 2 (see `SKILL.md`).

**The response is not scoped to one user.** A workspace with more than one
TimeCamp user (e.g. an assistant) returns every user's entries for the
range, distinguished by `user_id`/`user_name`. A `user_ids[]` query
parameter was tried live and returned zero rows rather than a filtered set,
so the connector never sends one. **Filter client-side** to the practitioner's
own `user_id`: `build_ingest.py timecamp-entries` does it from the file (the
practitioner's `user_id` is a config value the skill resolves once, not
re-discovered per fetch — if not already known, take it from `status`'s
`user`, ask the practitioner to confirm that name is theirs, then store it: `time-pipeline-data set` — `namespace: "timeline"`,
`key: "config:timecamp_user_id"`).

### Response Format

Each entry in the JSON array contains, **confirmed against a real response**
(2026-08-27 data, the same day the six E2E regression fixtures under
`docs/E2E-tests/` were captured from):

- `id` — the entry's own numeric id (use as `native_id`)
- `duration` — seconds, as a numeric string (e.g. `"1650"`)
- `start_time` / `end_time` — `"HH:MM:SS"`, local 24-hour time
- `date` — `"YYYY-MM-DD"`, local date
- `task_id` — the existing project/task assignment (TimeCamp's internal id, string; `"0"` would mean unassigned, though every entry observed carries a real task_id — TimeCamp entries are always under *some* task, even a placeholder one like "Phone calls (to be sorted)")
- `name` — the assigned task's **display name**, already resolved inline (e.g. `"ExampleP - L8145 - 0999999 B.C. LTD."`, `"Phone calls (to be sorted)"`) — **no separate `/third_party/api/tasks/` call is needed** to resolve this; it was a planned extra fetch that a live check showed unnecessary
- `color` — the assigned task's hex colour, also already resolved inline (e.g. `"#E5C947"` amber, `"#5CCB72"` green) — see below for the colour convention
- `billable` — `0`/`1`, already an integer
- `locked` — `"0"`/`"1"` as a string — set once an entry is invoiced; a locked entry should not normally be write-backed (see `SKILL.md` Step 7)
- `description` — the entry's own free-text note field; typically empty pre-categorization, and the write-back target once a categorization is approved
- `task_note` — **a task-level field, not an entry-level one**: it repeats identically across every entry sharing that `task_id` (observed holding standing instructions like `"If the file does not have a lawyer's name, it is Qainoor's file"`, or a generic `"Message (HTML)"` for email-drafting placeholder tasks). Not a first-class column — store verbatim in `raw_payload` if useful context, never treat it as per-entry evidence.
- `user_id` / `user_name` — see the filtering note above
- `invoiceId` — `"0"` when not yet invoiced

### Colour convention (confirmed live)

- **Amber `#E5C947`** — a placeholder/work-queue task ("Viewing Outlook Email
  Inbox", "Phone calls (to be sorted)", "MS Teams (uncategorized)", "Email
  Drafting (to be sorted)") — needs assignment. This is the queue
  `/timecamping` works through.
- **Green `#5CCB72`** — an actual billable client-matter task, already
  correctly assigned in TimeCamp's own view — not part of the work queue
  unless the practitioner explicitly asks for a recheck.
- **`Switching File`** (task id `80544222`) — also in the default queue,
  reviewed like amber under `inference.md`'s P10. Identify it by task, never by
  its brown `#8B6A49`, which `Write-off` and `MS Teams Write off` share.
- **`Write-off`** — reviewed on request only, never in the default queue
  (practitioner decision, #856). A write-off may be deliberate, and
  `/timecamping` itself writes capped overflow there, so a default review
  would resurface both. When the practitioner names `Write-off`, its entries
  are evidence-reviewed and routed like amber, and client content gets an
  ordinary routing proposal.
- Other observed colours (`#F6B042` "App building", `#4DC2E8` several
  internal/admin tasks, `#8B6A49` "Write-off", `#7767BF` non-billable
  own-file work and `PERSONAL`) are neither the queue nor a client matter —
  leave them alone unless the practitioner names one explicitly. Do not
  treat "not in the queue" as "safe to ignore forever" — amber and
  `Switching File` are only the *default* queue; a practitioner-directed
  recheck can target any colour.

If `entries` returns an error, record this source as `failed` in `source_fetch_log` with the reason,
and tell the practitioner what went wrong. Proceed with other sources — a
failed source never blocks the rest of Step 2 (though it does block the
Step 3 gate for the day, same as any other unresolved source).

## Computing native_id

`native_id` is the entry's own `id` field, as a string (e.g. `"282918696"`).
No fallback composite is needed — every entry observed carries this field.

## Write-back (Step 7) — confirmed live 2026-09-22

Confirmed against the live account on 2026-09-22 (issue #852) with a
practitioner-approved reversible probe on entry `285145944`: one write moved
it to another task with a note, the re-read matched, and a second write
restored it exactly. The shape comes from a public client
(`gisforgirard/php-timecamp-api`, `TimeEntries::update`), because TimeCamp's
own docs page renders only in a browser.

The write is the connector's `update_entry` with `entry_id`, `task_id` (the
matter's TimeCamp task) and `note`, sent only after the practitioner has said
to commit (`SKILL.md` Step 7). The connector sends TimeCamp's form-encoded
`PUT` on the same trailing-slash `/entries/` URL as the read.

- **The note is sent as `note` but read back as `description`.**
- The probe changed only `task_id`, `description`, the derived
  `name`/`color`, and `last_modify`. `duration`, `start_time`/`end_time` and
  `locked` are left alone, confirmed again by four real write-backs in #942.
- **`billable` is not left alone: it follows the new task.** In #942, two
  entries moved from billable "Brahm to review" (`billable` 1) to
  non-billable ADMIN tasks re-read as `billable` 0, though the write never
  sent `billable`. A move between tasks with the same flag leaves it
  unchanged (#852's probe, which evidently stayed on one side; #942's move from `billable` 1 to a billable
  matter, and from `Switching File` at 0 to an ADMIN task). The reverse
  direction also follows the task: non-billable entries moved to billable
  matters re-read as `billable` 1 (#942, from 2026-05-29 on).
- A success returns TimeCamp's JSON echo (`entry_id`, `task_id`, `note`, …).
  The echo is not the check. **Re-fetch the entry's date with `entries` (no
  `out_file`) and compare `task_id` and `description`** — only that re-read
  confirms the write.
- The echo's `last_modify` and the re-read's disagree by hours, and neither
  matches local time. Do not use `last_modify` for anything.
