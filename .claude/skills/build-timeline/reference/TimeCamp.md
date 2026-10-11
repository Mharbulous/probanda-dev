# TimeCamp Reference

API and configuration details for TimeCamp integration. Load this file when fetching TimeCamp computer activities for the timeline.

## Terminology

This skill aligns with TimeCamp's own concepts:

- **Computer activities** — websites and applications tracked by the TimeCamp desktop app, each with an application name, window title, and duration
- **Time entries** — recorded time segments on the timesheet, either auto-tracked or manually created
- **Projects** — top-level containers in TimeCamp's hierarchy (e.g., "Client Matters", "Administration")
- **Tasks** — children of Projects (e.g., "Smith v Jones (L8948)" under "Client Matters")
- **Subtasks** — children of Tasks for finer granularity (available on Premium/Ultimate plans)
- **Assign / Move** — TimeCamp's term for attributing computer activities to a Task
- **Unassigned computer activities** — time tracked by the desktop app that hasn't been assigned to any Task; does not count toward the daily timesheet total

## Configuration

### API Token

The TimeCamp API token is stored in the time-pipeline store under the `timeline` namespace:

``time-pipeline-data`` `get` — `namespace: "timeline"`, `key: "config:timecamp_token"`

If the returned value is `null` (not found), skip TimeCamp and record `"timecamp"` in `sources_failed`. Tell the practitioner: "TimeCamp token not configured. I'll store it once you provide one."

To set the token:

``time-pipeline-data`` `set` — `namespace: "timeline"`, `key: "config:timecamp_token"`, `value: "YOUR_TOKEN_HERE"`

The practitioner can find their API token at TimeCamp → Avatar → Profile Settings → scroll to the bottom for "Your programming API token".

## Fetching Computer Activities

Retrieve the TimeCamp token:

``time-pipeline-data`` `get` — `namespace: "timeline"`, `key: "config:timecamp_token"`

If the returned value is `null` (not found), skip TimeCamp and record `"timecamp"` in `sources_failed`.

If found, fetch activities with resolved application names and window titles:

```bash
curl -s -H "Authorization: Bearer {token}" -H "Accept: application/json" \
  "https://www.timecamp.com/third_party/api/activity/?dates[]={YYYY-MM-DD}&include=application,window_title&format=json"
```

Trailing slash on `/activity/` is mandatory — confirmed live (2026-09-10,
issue #456 triage). The bare URL 301-redirects to
`/third_party/api/activity/` with the query string stripped, so a
redirect-following client re-sends the request with no `dates[]`,
`include` or `format` and the API answers
`"you must provide \"date\" like 2013-03-20"`. That error is the symptom
of a missing slash, not a missing `dates[]` parameter.

The `include=application,window_title` parameter tells the API to resolve the numeric IDs into human-readable names inline. The `dates[]` parameter (not `date`) is required — it accepts an array of up to 20 dates.

### Response Format

Each entry in the JSON array contains:
- `activity_id` — unique identifier for this activity record (use as `native_id`)
- `end_time` — "YYYY-MM-DD HH:MM:SS"
- `time_span` — seconds (compute start_time as end_time minus time_span)
- `application` — e.g. "Google Chrome", "Visual Studio Code" (resolved from application_id)
- `window_title` — e.g. "Smith v Jones - LEAP - Documents" (resolved from window_title_id)
- `application_id` — numeric ID
- `window_title_id` — numeric ID
- `task_id` — TimeCamp Task ID if already assigned, "0" if unassigned
- `entry_id` — the time entry this record's seconds count toward, "0" if none. An entry's `duration` is the sum of the `time_span` of the records carrying its id, so this key, not an entry's clock span, says which entry tracked a second (#1102)

If the API returns an error status code, empty response, or unparseable JSON, record `"timecamp"` in `sources_failed` with the error reason. Tell the practitioner what went wrong (e.g., "TimeCamp API returned 401 — token may be invalid"). Proceed with other sources.

## Computing native_id

Each TimeCamp activity record's `native_id` is the `activity_id` field from the API response as a string, e.g. `"48291"`. The stable row ID is `timecamp:{activity_id}`.

If `activity_id` is absent (not expected from the TimeCamp API), fall back to a composite of `end_time + "_" + time_span`, e.g. `"2026-04-15 14:30:00_225"`. Document the fallback so re-fetch logic is reproducible.
