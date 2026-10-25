# TimeCamp Reference

How TimeCamp computer activities are fetched for the timeline. Load this file when fetching them.

## Terminology

This skill aligns with TimeCamp's own concepts:

- **Computer activities** — websites and applications tracked by the TimeCamp desktop app, each with an application name, window title, and duration
- **Time entries** — recorded time segments on the timesheet, either auto-tracked or manually created
- **Projects** — top-level containers in TimeCamp's hierarchy (e.g., "Client Matters", "Administration")
- **Tasks** — children of Projects (e.g., "Smith v Jones (L8948)" under "Client Matters")
- **Subtasks** — children of Tasks for finer granularity (available on Premium/Ultimate plans)
- **Assign / Move** — TimeCamp's term for attributing computer activities to a Task
- **Unassigned computer activities** — time tracked by the desktop app that hasn't been assigned to any Task; does not count toward the daily timesheet total

## The TimeCamp connector

TimeCamp is read only through the timekeeper plugin's `timecamp` connector, a
local server. Its tools are named without their prefix. Call each under
whichever of `mcp__plugin_timekeeper_timecamp__<name>` and
`mcp__remote-devices__plugin_timekeeper_timecamp__<name>` this host grants. It holds the
API token itself: no skill reads, stores or passes the token.

**Hard rule.** Before fetching, call the connector's `status`. If it reports
`usable: false`, skip TimeCamp, record `"timecamp"` in `sources_failed` with
its `reason` (no token, token unreadable, auth refused, network), and tell the
practitioner that reason. Never open the TimeCamp web app as a substitute.

When the reason is that no token is set, call the connector's
`configure_credential`, send the practitioner the link it returns, and ask
them to paste the token on that page, never in chat. They find it at
TimeCamp → Avatar → Profile Settings → scroll to the bottom for "Your
programming API token". Call `status` again once they say it is done.

## Fetching Computer Activities

Call the connector's `activities` with `dates: ["{YYYY-MM-DD}"]` (up to 20
dates per call). It returns the rows with application names and window titles
already resolved, and keeps the mandatory trailing slash on `/activity/` (the
bare URL redirects and drops the query string, confirmed live 2026-09-10,
issue #456 triage).

### Response Format

Each row in the `rows` that `activities` returns contains:
- `activity_id` — unique identifier for this activity record (use as `native_id`)
- `end_time` — "YYYY-MM-DD HH:MM:SS"
- `time_span` — seconds (compute start_time as end_time minus time_span)
- `application` — e.g. "Google Chrome", "Visual Studio Code" (resolved from application_id)
- `window_title` — e.g. "Smith v Jones - LEAP - Documents" (resolved from window_title_id)
- `application_id` — numeric ID
- `window_title_id` — numeric ID
- `task_id` — TimeCamp Task ID if already assigned, "0" if unassigned
- `entry_id` — the time entry this record's seconds count toward, "0" if none. An entry's `duration` is the sum of the `time_span` of the records carrying its id, so this key, not an entry's clock span, says which entry tracked a second (#1102)

If `activities` returns an error, record `"timecamp"` in `sources_failed` with its message and tell the practitioner what went wrong (e.g., "TimeCamp refused the request (HTTP 401)"). Proceed with other sources.

## Computing native_id

Each TimeCamp activity record's `native_id` is the `activity_id` field from the API response as a string, e.g. `"48291"`. The stable row ID is `timecamp:{activity_id}`.

If `activity_id` is absent (not expected from the TimeCamp API), fall back to a composite of `end_time + "_" + time_span`, e.g. `"2026-04-15 14:30:00_225"`. Document the fallback so re-fetch logic is reproducible.
