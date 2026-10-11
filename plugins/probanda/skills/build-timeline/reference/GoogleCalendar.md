# Google Calendar Reference

Configuration and data details for Google Calendar integration. Load this file when fetching calendar events for the timeline.

## Configuration

**Check which calendar you are reading before you read it.** This practitioner
has three Google identities, and only one carries the practice:

| Calendar | Contents |
|---|---|
| `brahm@logicalaw.ca` | **The work calendar.** Client meetings, matter deadlines, Zoom bookings. Shown in the Google Calendar sidebar as **"Brahm Dorst"** — the label does not match the address. |
| `brahm@dorst.ca` | Near-empty. A test row and two deadline markers. |
| `brahmwhatisfair@gmail.com` | Personal, plus a holidays calendar. |

Reading the wrong one returns a successful, empty-looking result and no error,
which is how a walkthrough once concluded the calendar held four events a year
when the work calendar held 33 in five months (ticket #421). To confirm which
calendar an event belongs to, base64-decode its `data-eventid`: the decoded
value is `{event_id} {calendar_address}`.

Two routes reach it, and which exists depends on the session surface:

1. **MCP connector** — a Cowork connector (Settings > Customize > Connectors),
   authorized once per account. If it is present but not authenticated, prompt
   the practitioner to authenticate before proceeding. **Verify its calendar
   list before trusting a result**: a connector authorized against the wrong
   identity returns a valid, incomplete answer silently.
2. **Browser read** — Claude in Chrome against the practitioner's own signed-in
   `calendar.google.com` session. Read-only, and the route that reaches every
   calendar the practitioner can see.

An empty `list_connectors` result does **not** prove the connector is absent: it
reports neither custom nor unconnected connectors, nor connectors belonging to a
different session surface. Do not conclude from it alone.

If neither route is available, skip and record `"gcal"` in `sources_failed`, the
same as the other sources in this directory. Tell the practitioner which source
failed and why, naming the route that would restore it.

## Fetching Events

Retrieve events for the date range `{YYYY-MM-DD}T00:00:00` to
`{YYYY-MM-DD}T23:59:59` in the practitioner's local timezone.

Over the MCP connector, list events for the target date directly. Over the
browser route, the day view is
`https://calendar.google.com/calendar/u/0/r/day/{YYYY}/{M}/{D}` and the schedule
view is `https://calendar.google.com/calendar/u/0/r/agenda/{YYYY}/{M}/{D}`;
clicking a row opens its full detail (location, guests and RSVP state,
description, reminders, transparency).

A day with no events is **`empty`**, not `failed` — also terminal. This calendar
is sparse by nature: the expected number of events on a working day is zero, and
absence says nothing about whether the day was worked.

Each event includes:
- `id` — the Google Calendar event ID (stable, unique per event; use as `native_id`)
- `summary` — event title
- `start` — start datetime (with timezone info)
- `end` — end datetime (with timezone info)
- `description` — optional event description
- `location` — optional location string
- `attendees` — optional list of attendees, each with a `responseStatus`
- `created` — when the row was written
- `updated` — when it was last edited
- `calendar_id` — the calendar the event was read from. Not a field the event
  resource returns: the fetch knows which calendar it queried, and records it.
  Store it on every row. Downstream storage requires it (`/timecamping`'s
  `gcal_events` table makes it NOT NULL) because a row whose calendar is
  unknown is the wrong-calendar failure above, silently reasoned over.

**Store `created` and `updated`.** They are structured source fields, not
interpretation, and downstream classification needs them: the distance from
`created` to `start` says how much of a forecast the entry ever was (a row
written by a scheduler minutes beforehand is near-contemporaneous; one written
days ahead records intent, and intent decays), and `updated == created` on a
booking whose real-world time changed is the fingerprint of a reschedule that
bypassed the calendar. Worked figures: the both-verdicts and stale-booking
fixtures.

Google Calendar events have a start and end and are stored as **activities** in the `timeline` namespace.

> **Do not treat a calendar slot as time worked — classify it downstream, not
> here.** A calendar entry is a *hypothesis*: direct evidence confirms or refutes
> it, and on real data both outcomes are frequent. Some events are not
> appointments at all (a `DEADLINE:` or `Decision Due` marker occupies a slot
> without consuming any of the practitioner's time; an all-day one marked `Busy`
> would claim 24 hours as an interval). But **guest structure alone does not
> discriminate** — a self-blocked work slot has the same shape as a marker, and
> `Work on letter for Joe Dart` 11:00-13:00 on 2026-02-02 is a real work block
> that no structural test separates from a marker.
>
> That judgment is classification and does not belong in this skill: per SKILL.md
> above, never infer a type from a title string here. Store what the calendar
> reported; let `/timecamping` Step 5 decide what it means. Worked fixtures and
> the failure modes each produces:
> `docs/E2E-tests/*timecamping-gcal-*.md` (ticket #421).

## Computing native_id

Use the Google Calendar event's `id` field (the iCal UID or GCal event ID) directly as `native_id`. The stable row ID is `gcal:{event_id}`.

If the event has no `id` field (unusual), compose from `start_time + "_" + calendar_id`.

Google Calendar events have a start and end and are stored as **activities** in the timeline namespace, not events.
