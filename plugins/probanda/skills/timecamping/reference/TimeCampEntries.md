# TimeCamp Time Entries Reference

API and configuration details for fetching TimeCamp's own pre-categorized
time entries — the amber/green timesheet blocks `/timecamping` exists to
correct. Load this file at Step 2 when populating `timecamp_time_entries`.

This is a **different** TimeCamp endpoint from `build-timeline/reference/TimeCamp.md`'s
computer-*activity* fetch: that file covers the desktop app's raw
application/window-title tracking (`/third_party/api/activity`); this one
covers the practitioner's actual **timesheet entries** — the rows with a
project/task assignment and a colour, shown in TimeCamp's own timesheet view.
`/timecamping` fetches both (see `SKILL.md`'s source-integration table).

## Configuration

Same token as build-timeline's activity fetch — one TimeCamp account, one
token, two endpoints. Retrieve it the same way:

``time-pipeline-data`` `get` — `namespace: "timeline"`, `key: "config:timecamp_token"`

If `null`, skip this source for the day and record it as `failed` in
`source_fetch_log` with the reason (never proceed to the assembly gate for
that day until either the token is set or the source is deliberately
disabled in the registry, in which case it is `skipped`, not `failed`).

## Fetching

```bash
curl -s -H "Authorization: Bearer {token}" -H "Accept: application/json" \
  "https://www.timecamp.com/third_party/api/entries/?from={YYYY-MM-DD}&to={YYYY-MM-DD}&format=json"
```

Trailing slash on `/entries/` is mandatory — confirmed live (2026-08-28,
issue #430 build), mirroring the same Cloudflare trap already documented for
the legacy tasks endpoint. `from`/`to` accept the same date for a single-day
fetch (this source is fetched one local day at a time, same discipline as
every other source in this skill's Step 2 — see `SKILL.md`).

**The response is not scoped to one user.** A workspace with more than one
TimeCamp user (e.g. an assistant) returns every user's entries for the
range, distinguished by `user_id`/`user_name`. A `user_ids[]` query
parameter was tried live and returned zero rows rather than a filtered set —
do not rely on it. **Filter client-side** to the practitioner's own
`user_id` after fetching (the practitioner's `user_id` is a config value the
skill resolves once, not re-discovered per fetch — if not already known,
ask the practitioner to confirm it from one fetched row's `user_name`, then
store it: `time-pipeline-data set` — `namespace: "timeline"`,
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
- `name` — the assigned task's **display name**, already resolved inline (e.g. `"ZhuP - L145 - 1500746 B.C. LTD."`, `"Phone calls (to be sorted)"`) — **no separate `/third_party/api/tasks/` call is needed** to resolve this; it was a planned extra fetch that a live check showed unnecessary
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
  reviewed like amber under `SKILL.md`'s P10. Identify it by task, never by
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

If the API returns an error status code, empty response, or unparseable
JSON, record this source as `failed` in `source_fetch_log` with the reason,
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

```bash
curl -s -X PUT -H "Authorization: Bearer {token}" -H "Accept: application/json" \
  --data-urlencode "id={entry id}" \
  --data-urlencode "task_id={matter's TimeCamp task_id}" \
  --data-urlencode "note={note}" \
  "https://www.timecamp.com/third_party/api/entries/"
```

- Form-encoded body, same token and same trailing-slash URL as the read.
- **The note is sent as `note` but read back as `description`.** Sending
  `note=` (empty) clears it.
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
- A success is HTTP 200 with a JSON echo (`entry_id`, `task_id`, `note`, …).
  The echo is not the check. **Re-fetch the entry's date with the read
  request above and compare `task_id` and `description`** — only that re-read
  confirms the write.
- The echo's `last_modify` and the re-read's disagree by hours, and neither
  matches local time. Do not use `last_modify` for anything.
