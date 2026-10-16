# iCloud Calendar Reference

Configuration and data details for the practitioner's iCloud calendar. Load this file when fetching iCloud calendar events for the timeline. Registered as the sixth `/timecamping` evidence source in #1199.

## Configuration

**Check which calendars you are reading before you read them.** The iCloud account holds three calendars, and two are in scope:

| Calendar | URL | In scope |
|---|---|---|
| `Work` | `https://caldav.icloud.com/131943092/calendars/F627AFCE-6CEC-4E54-ABA3-8304E5B7127B/` | Yes |
| `Home` | `https://caldav.icloud.com/131943092/calendars/home/` | Yes |
| `Family` | `https://caldav.icloud.com/131943092/calendars/5671cecefcf92139b46cbe0051ef4dbdad534368f607299fe617abd6cc4e9d22/` | No. Never read and never stored |

This is the live calendar list of 2026-09-27. `Work` and `Home` are stored in full. `Home` is a personal calendar: a `Home` event may explain an unbilled gap but never supports billable time on its own (`/timecamping` Step 5). `/timecamping-data`'s ingest script refuses a row from any calendar other than `Work` or `Home`.

**The route is the legal plugin's `data` server.** It reads the calendar over CalDAV with the Probanda mail connector's credential, set once through `mail__configure_credential` with the calendar fields (`time-sorting/protocols/FirstSetup.md`). The read uses exactly two of its calendar tools, `calendar__list_calendars` and `calendar__list_events`. Never call `calendar__get_event` or any `contacts__*` tool. The plugin has no calendar write tool, and build-timeline never writes to a source.

## Qualifying the route

A read of the wrong calendar returns a successful result with no error, as the Google Calendar route showed (`GoogleCalendar.md`, ticket #421). So qualify the route before trusting any result:

1. Call `calendar__list_calendars`.
2. Look up each in-scope calendar by its **URL** from the table above. It is present only when the list holds that URL under the calendar's name in the table. A URL that is absent, or present under another name, counts as missing, because `calendar__list_events` selects calendars by name and a renamed calendar would read the wrong one.
3. **`Work` missing**: stop without reading. The source is `failed`, with an `error_detail` naming the `Work` calendar, its URL and the fix: run `mail__configure_credential` again for the account that holds it, or, if the calendar moved, update this table.
4. **`Home` missing**: read `Work` alone. This is not a failure. Name `Home` as missing in the run summary.
5. `Family` is never read, whatever the list shows.

## Fetching events

Call `calendar__list_events` with:

- `calendars`: the qualified names, `["Work", "Home"]`, or `["Work"]` when `Home` is missing. **Never omit it.** The default is every calendar, `Family` included.
- `includeNotes: true`.
- `start` and `end`: both the target local date, `YYYY-MM-DD`. A date means the whole day, so the read covers exactly that day.

The response carries the configured time zone, `"timezone": "America/Vancouver"`. The tool expands a repeating event into one entry per occurrence. Each event includes:

- `calendar`: the calendar's name
- `title`
- `start`, `end`: a timed event gives ISO 8601 with its offset (`2026-06-01T10:00:00-07:00`). An all-day event gives bare dates with an exclusive end (`2026-06-21` to `2026-06-22` is one day)
- `allDay`
- `location`: absent when the event has none
- `busy`
- `uid`: the iCalendar UID. Every occurrence of a repeating event shares it
- `url`, `etag`: the event's own resource address and version tag. Kept in `raw_payload` only
- `notes`: only with `includeNotes`, trimmed by the tool to 500 characters, so a longer note arrives cut off

**iCloud returns no `created` or `updated` time.** The Google Calendar staleness fingerprint (`updated == created` on a booking whose real time changed) and the created-to-start lead time are unavailable for this source.

**Record `calendar_url` on every row.** It is not a field the event returns: take it from the qualified calendar list, for the calendar the event names. Downstream storage requires the calendar name: `/timecamping-data` refuses a row with no calendar.

## Building the row

iCloud events have a start and end and are stored as **activities** in the `timeline` namespace.

- **`native_id`** is `{uid}_{local start date}`, the date as `YYYY-MM-DD` in the practitioner's timezone (for an all-day event, its bare start date). The row id is `icloud:{uid}_{YYYY-MM-DD}`. The date is needed because repeating occurrences share one `uid`. When one `uid` has more than one occurrence on the same local date, sort them by start and give the second and later ones a `#2`, `#3` suffix (`{uid}_{YYYY-MM-DD}#2`), so no occurrence overwrites another.
- **`start_ts` and `end_ts`** are UTC. A timed event's offset timestamps convert directly. An all-day event runs from local midnight on its start date to local midnight on its exclusive end date, each converted to UTC: `2026-06-21` to `2026-06-22` is stored as `2026-06-21T07:00:00Z` to `2026-06-22T07:00:00Z`.
- **`raw_type`** is `null`, as for Google Calendar.
- **`raw_payload`** is the event verbatim, plus `calendar_url`.

**What the key keeps and what it loses.** An event moved within its day keeps its key, so the re-fetched row replaces the old one. An event moved to another day gets a new key. build-timeline's replace-by-source drops the old row from the timeline store when the old day is re-fetched, but `/timecamping-data` only ever adds iCloud rows, so a stale row can stay on the old day there. Two occurrences of one repeating event on the same local date are kept apart by the `#2` suffix above.

## All-day and free events

Store every event as reported. An all-day event keeps its full extent and `allDay: true`, and an event marked `busy: false` keeps that flag. None is dropped, shortened or converted here. Whether an event is a marker or a work block, and whether a free event happened, is `/timecamping` Step 5's decision, exactly as for Google Calendar (see the hypothesis note in `GoogleCalendar.md`). A multi-day all-day event files under its start date only, as a Google Calendar one does.

## Empty is not failed

A qualified read with zero events is **`empty`**, a terminal status. This calendar is sparse: June 2026 held five events in total. A read that never happened, or was never qualified, is `failed`, never `empty`, because an `empty` for an unread day releases `/timecamping`'s assembly gate on missing evidence.

## Exit paths

Every exit records a status for `/timecamping`, because a registered source blocks every day until it reaches a terminal one. `fetched`, `empty` and `skipped` release the day. `failed` keeps it blocked until a re-run succeeds.

| Situation | Status | `error_detail` |
|---|---|---|
| Route qualified, events returned | `fetched` | none |
| Route qualified, zero events | `empty` | none |
| Registry entry `enabled: false` | `skipped` | none |
| Registry present but has no `icloud` entry | `failed` | No `time_tracking.sources` entry for `icloud`; add one with `enabled: true` or `enabled: false` |
| The calendar is not configured (`calendar__list_calendars` fails `dav_not_configured`) | `failed` | Calendar not configured: run `mail__configure_credential` with the calendar fields, or set the `icloud` entry's `enabled` to `false` to record `skipped` |
| The calendar list has no `Work` calendar | `failed` | Names `Work`, its URL and the fix (qualification step 3) |
| The calendar list has no `Home` calendar | `fetched` or `empty`, on `Work` alone | none. The run summary names `Home` as missing |
| Any other error | `failed` | The error, and the fix |

An unconfigured calendar is `failed`, not `skipped` (decided on #1199): the day waits until the calendar is configured. `enabled: false` is the deliberate way to record `skipped`.
