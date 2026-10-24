import type { ToolDefinition } from "./shared.js";

// The calendar__* tools: the practitioner's calendar over CalDAV, signed in with
// the Probanda mail connector's credential. Read-only; no tool writes an event.
// Served by the `data` server only, never by file-manager's `files` server.
export function calendarToolDefinitions(): ToolDefinition[] {
  const errors =
    " Errors: `dav_not_configured` (run mail__configure_credential with the calendar fields), `dav_auth` (the " +
    "server refused the sign-in), `dav_timeout` (no answer within 30 s; retry once), `dav_error`.";
  return [
    {
      name: "calendar__list_calendars",
      description:
        "List the calendars of the Probanda mail connector's account that hold events: {calendars: [{name, url, " +
        "color}]}. Use the names with calendar__list_events. Read-only." +
        errors,
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: true },
    },
    {
      name: "calendar__list_events",
      description:
        "List calendar events in a date range, with repeating events expanded into individual occurrences (an " +
        "occurrence moved on the phone shows at its new time; cancelled ones are left out). Times are shown in the " +
        "configured timezone. Returns {timezone, count, warnings?, events: [{calendar, title, start, end, allDay, " +
        "location?, notes?, status?, busy, recurrence?, alerts?, attendees?, uid, recurring?, occurrenceId?, " +
        "modifiedOccurrence?, url, etag}]}. A timed event's start and end are ISO 8601 with the offset; an all-day " +
        "event's are bare dates with an exclusive end. `notes` comes only with `includeNotes`, trimmed to 500 " +
        "characters. An item that cannot be read is skipped and named in `warnings`. Read-only." +
        errors,
      inputSchema: {
        type: "object",
        properties: {
          start: { type: "string", description: "Range start: a date \"2026-09-28\" or local time \"2026-09-28T09:00\"." },
          end: { type: "string", description: "Range end: a date (inclusive, whole day) or local time (exclusive)." },
          calendars: { type: "array", items: { type: "string" }, description: "Calendar names to include. Default: all." },
          includeNotes: { type: "boolean", description: "Include each event's notes (trimmed to 500 characters). Default false." },
        },
        required: ["start", "end"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true },
    },
    {
      name: "calendar__get_event",
      description:
        "Get the full details of one event (the whole series, for a repeating event) by the url from " +
        "calendar__list_events: {url, etag, title, start, end, allDay, location?, notes?, status?, busy, recurrence?, " +
        "alerts, attendees?, uid, modifiedOccurrences?, excludedDates?}. Only an https url on the configured calendar " +
        "server, or on a server it moved the account to during this session's sign-in, is accepted; any other url is " +
        "refused, so the password is never sent elsewhere. Read-only." +
        errors,
      inputSchema: {
        type: "object",
        properties: { url: { type: "string", description: "Event url from calendar__list_events" } },
        required: ["url"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true },
    },
  ];
}
