// The calendar__* tools of the lawyer plugin's data server: read-only CalDAV, signed in
// with the mail credential (src/dav/session.ts). No tool creates, changes or
// deletes an event. Inputs and outputs match the practitioner's own desktop
// extension's calendar_list_calendars, calendar_list_events and
// calendar_get_event, from which this is ported (MIT). Tool definitions live in
// schema-gen.ts.

import { DataServerError, ValidationError } from "../errors.js";
import { absolute, getObject, requireDav, runDav, type DavClientLike, type DavCollection, type DavContext } from "../dav/session.js";
import { parseDateOnly, parseToUtc, wallToUtc } from "../dav/tz.js";
import { describeObject, expandObject, type Occurrence } from "./ical.js";

type Args = Record<string, unknown>;

export function callCalendarTool(context: DavContext, name: string, args: Args): Promise<unknown> {
  switch (name) {
    case "calendar__list_calendars":
      return listCalendars(context);
    case "calendar__list_events":
      return listEvents(context, args);
    case "calendar__get_event":
      return getEvent(context, args);
    default:
      throw new ValidationError(`Unknown tool "${name}"`);
  }
}

const nameOf = (c: DavCollection): string =>
  (typeof c.displayName === "string" ? c.displayName : "") || decodeURIComponent(c.url.split("/").filter(Boolean).pop() ?? "");

async function eventCalendars(client: DavClientLike): Promise<DavCollection[]> {
  const all = await client.fetchCalendars();
  return all.filter((c) => !c.components || c.components.includes("VEVENT"));
}

function findCalendar(cals: DavCollection[], name: string): DavCollection {
  const hit = cals.find((c) => nameOf(c).toLowerCase() === name.trim().toLowerCase());
  if (!hit) throw new ValidationError(`No calendar named "${name}". Available: ${cals.map(nameOf).join(", ")}.`);
  return hit;
}

/** End of range; a bare date is inclusive (runs to the end of that day). */
function rangeEnd(s: string, tz: string): number {
  if (/^\d{4}-\d{2}-\d{2}$/.test(s.trim())) {
    const { y, mo, d } = parseDateOnly(s);
    return wallToUtc(tz, y, mo, d + 1);
  }
  return parseToUtc(s, tz);
}

type Listed = Occurrence & { calendar: string; url: string; etag?: string };

/**
 * Expanded occurrences across calendars, sorted by start. An item that cannot be read is
 * skipped and reported in warnings, not allowed to fail the list.
 */
async function occurrences(
  client: DavClientLike,
  fromMs: number,
  toMs: number,
  calendarNames: string[] | undefined,
  tz: string
): Promise<{ events: Listed[]; warnings: string[] }> {
  const all = await eventCalendars(client);
  const cals = calendarNames?.length ? calendarNames.map((n) => findCalendar(all, n)) : all;
  const out: Listed[] = [];
  const warnings: string[] = [];
  for (const cal of cals) {
    const objects = await client.fetchCalendarObjects({
      calendar: cal,
      timeRange: { start: new Date(fromMs).toISOString(), end: new Date(toMs).toISOString() },
      urlFilter: () => true, // tsdav's default drops any object whose href lacks ".ics"
    });
    for (const obj of objects) {
      if (!obj.data?.includes("BEGIN:VEVENT")) continue;
      const url = absolute(obj.url, cal.url);
      let occs;
      try {
        occs = expandObject(obj.data, fromMs, toMs, tz);
      } catch (e) {
        warnings.push(`Skipped an item in "${nameOf(cal)}" that could not be read (${e instanceof Error ? e.message : String(e)}): ${url}`);
        continue;
      }
      if (occs.truncated) warnings.push(`A repeating event in "${nameOf(cal)}" has too many occurrences to list them all: ${url}`);
      for (const occ of occs) out.push({ calendar: nameOf(cal), ...occ, url, etag: obj.etag });
    }
  }
  return { events: out.sort((a, b) => a._startMs - b._startMs), warnings };
}

const clip = (s: string | undefined, n: number): string | undefined => (s && s.length > n ? s.slice(0, n) + "…" : s);

function listCalendars(context: DavContext): Promise<unknown> {
  const credential = requireDav(context.mail, "caldav");
  return runDav(context, credential, "caldav", "listing calendars", async (client) => {
    const cals = await eventCalendars(client);
    return { calendars: cals.map((c) => ({ name: nameOf(c), url: c.url, color: c.calendarColor })) };
  });
}

function listEvents(context: DavContext, args: Args): Promise<unknown> {
  const credential = requireDav(context.mail, "caldav");
  const tz = credential.timezone as string;
  if (typeof args.start !== "string" || typeof args.end !== "string") {
    throw new ValidationError("calendar__list_events requires start and end");
  }
  const fromMs = parseToUtc(args.start, tz);
  const toMs = rangeEnd(args.end, tz);
  if (!(toMs > fromMs)) throw new ValidationError("The end of the range must be after the start.");
  const names = args.calendars ?? undefined;
  if (names !== undefined && (!Array.isArray(names) || names.some((n) => typeof n !== "string"))) {
    throw new ValidationError("calendar__list_events.calendars must be a list of calendar names");
  }
  const includeNotes = args.includeNotes === true;
  return runDav(context, credential, "caldav", "listing events", async (client) => {
    const found = await occurrences(client, fromMs, toMs, names as string[] | undefined, tz);
    const events = found.events.map(({ _startMs, _endMs, ...rest }) => {
      const e: Partial<Listed> = rest;
      if (includeNotes) e.notes = clip(e.notes, 500);
      else delete e.notes;
      if (e.alerts?.length === 0) delete e.alerts;
      return e;
    });
    return { timezone: tz, count: events.length, warnings: found.warnings.length ? found.warnings : undefined, events };
  });
}

async function getEvent(context: DavContext, args: Args): Promise<unknown> {
  const credential = requireDav(context.mail, "caldav");
  if (typeof args.url !== "string" || !args.url) throw new ValidationError("calendar__get_event requires url");
  const url = args.url;
  const { text, etag } = await getObject(context, credential, "caldav", url);
  try {
    return { url, etag, ...describeObject(text, credential.timezone as string) };
  } catch (e) {
    throw new DataServerError(`calendar: the item at ${url} could not be read: ${e instanceof Error ? e.message : String(e)}`, "dav_error");
  }
}
