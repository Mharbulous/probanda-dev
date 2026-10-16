// iCalendar (RFC 5545) reading and recurrence expansion, via ical.js. Read-only:
// nothing here builds or changes an event. Ported from the practitioner's own
// mail, calendar and contacts desktop extension (MIT).

import ICAL from "ical.js";

import { buildVTimezone, formatInZone, isValidTimeZone, wallToUtc } from "../dav/tz.js";

// ical.js's component and value types are loose, so these are untyped.
type Component = any;
type IcalTime = any;

const MAX_ITERATIONS = 20000;

export interface Occurrence {
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  location?: string;
  notes?: string;
  status?: string;
  busy: boolean;
  recurrence?: string;
  alerts?: Array<{ minutesBefore: number } | { at: string }>;
  attendees?: number;
  uid?: string;
  recurring?: boolean;
  occurrenceId?: string;
  modifiedOccurrence?: boolean;
  modifiedOccurrences?: number;
  excludedDates?: number;
  _startMs: number;
  _endMs: number;
}

export type Occurrences = Occurrence[] & { truncated?: boolean };

/**
 * Run fn with every TZID in the text resolvable. The object's own VTIMEZONEs win and are
 * registered only while fn runs (ical.js keeps one global registry, and different objects
 * can define the same TZID differently, e.g. Outlook "Customized Time Zone").
 * TZIDs without a definition fall back to the IANA database.
 */
function withZones<T>(vcal: Component, text: string, fn: () => T): T {
  const restore: Array<[string, unknown]> = [];
  for (const vtz of vcal.getAllSubcomponents("vtimezone")) {
    const zone = new ICAL.Timezone(vtz);
    if (!zone.tzid) continue;
    restore.push([zone.tzid, ICAL.TimezoneService.has(zone.tzid) ? ICAL.TimezoneService.get(zone.tzid) : null]);
    ICAL.TimezoneService.register(zone);
  }
  for (const [, , raw] of text.matchAll(/TZID=("?)([^";:]+)\1[;:]/g)) {
    if (!ICAL.TimezoneService.has(raw) && isValidTimeZone(raw)) registerZone(raw);
  }
  try {
    return fn();
  } finally {
    for (const [tzid, prev] of restore.reverse()) {
      if (prev) ICAL.TimezoneService.register(prev as InstanceType<typeof ICAL.Timezone>);
      else ICAL.TimezoneService.remove(tzid);
    }
  }
}

function registerZone(tzid: string): void {
  if (ICAL.TimezoneService.has(tzid)) return;
  const comp = new ICAL.Component(ICAL.parse(buildVTimezone(tzid)) as any);
  ICAL.TimezoneService.register(new ICAL.Timezone(comp));
}

/** ICAL.Time -> UTC ms. Floating times and dates are read as wall-clock time in `tz`. */
function toMs(t: IcalTime, tz: string): number {
  const zone = t.zone?.tzid;
  if (!t.isDate && zone && zone !== "floating") return t.toUnixTime() * 1000;
  return wallToUtc(tz, t.year, t.month, t.day, t.isDate ? 0 : t.hour, t.isDate ? 0 : t.minute, t.isDate ? 0 : t.second);
}

const dateStr = (t: IcalTime): string =>
  `${t.year}-${String(t.month).padStart(2, "0")}-${String(t.day).padStart(2, "0")}`;

function alarmsOf(vevent: Component): Array<{ minutesBefore: number } | { at: string }> {
  return vevent.getAllSubcomponents("valarm").map((a: Component) => {
    const trig = a.getFirstPropertyValue("trigger");
    if (trig instanceof ICAL.Duration) return { minutesBefore: -Math.round(trig.toSeconds() / 60) };
    return { at: String(trig) };
  });
}

const text = (v: unknown): string | undefined => (v === null || v === undefined ? undefined : String(v));

function describe(vevent: Component, start: IcalTime, end: IcalTime, tz: string, extra: Partial<Occurrence>): Occurrence {
  if (!start) throw new Error("event has no start time (DTSTART)");
  const allDay = Boolean(start.isDate);
  const s = toMs(start, tz);
  const e = end ? toMs(end, tz) : s;
  const rrule = vevent.getFirstPropertyValue("rrule");
  return {
    title: text(vevent.getFirstPropertyValue("summary")) ?? "",
    start: allDay ? dateStr(start) : formatInZone(tz, s),
    end: allDay ? (end ? dateStr(end) : dateStr(start)) : formatInZone(tz, e),
    allDay,
    location: text(vevent.getFirstPropertyValue("location")),
    notes: text(vevent.getFirstPropertyValue("description")),
    status: text(vevent.getFirstPropertyValue("status")),
    busy: vevent.getFirstPropertyValue("transp") !== "TRANSPARENT",
    recurrence: rrule ? rrule.toString() : undefined,
    alerts: alarmsOf(vevent),
    attendees: vevent.getAllProperties("attendee").length || undefined,
    ...extra,
    _startMs: s,
    _endMs: e,
  };
}

function endOf(vevent: Component, start: IcalTime): IcalTime {
  const dtend = vevent.getFirstPropertyValue("dtend");
  if (dtend) return dtend;
  const dur = vevent.getFirstPropertyValue("duration");
  if (dur) {
    const e = start.clone();
    e.addDuration(dur);
    return e;
  }
  if (start.isDate) {
    const e = start.clone();
    e.day += 1;
    e.normalize();
    return e;
  }
  return start;
}

// A cancelled occurrence (STATUS:CANCELLED, usually one occurrence of a series) is left out.
function overlaps(occ: Occurrence, from: number, to: number): boolean {
  if (occ.status?.toUpperCase() === "CANCELLED") return false;
  return (occ._endMs > from && occ._startMs < to) || (occ._startMs === occ._endMs && occ._startMs >= from && occ._startMs < to);
}

/**
 * All occurrences of the events in one calendar object that overlap [fromMs, untilMs).
 * Handles RRULE/RDATE/EXDATE and RECURRENCE-ID overrides.
 */
export function expandObject(icsText: string, fromMs: number, untilMs: number, tz: string): Occurrences {
  const vcal = new ICAL.Component(ICAL.parse(icsText) as any);
  return withZones(vcal, icsText, () => expand(vcal, fromMs, untilMs, tz));
}

function expand(vcal: Component, fromMs: number, untilMs: number, tz: string): Occurrences {
  const vevents: Component[] = vcal.getAllSubcomponents("vevent");
  const master = vevents.find((v) => !v.hasProperty("recurrence-id"));
  const overrides = vevents.filter((v) => v.hasProperty("recurrence-id"));
  const out: Occurrences = [];

  if (!master) {
    // Only detached occurrences (e.g. an invitation to one instance of someone else's series).
    for (const v of overrides) {
      const s = v.getFirstPropertyValue("dtstart");
      const occ = describe(v, s, endOf(v, s), tz, { uid: text(v.getFirstPropertyValue("uid")) });
      if (overlaps(occ, fromMs, untilMs)) out.push(occ);
    }
    return out;
  }

  const event = new ICAL.Event(master, { exceptions: overrides });
  const uid = event.uid;
  if (!event.isRecurring()) {
    const occ = describe(master, event.startDate, endOf(master, event.startDate), tz, { uid });
    return overlaps(occ, fromMs, untilMs) ? [occ] : [];
  }

  const seen = new Set<number>(); // recurrence ids as UTC ms (an override may write its id in another zone form)
  const it = event.iterator();
  let i = 0;
  for (let next; (next = it.next()); i++) {
    if (i >= MAX_ITERATIONS) {
      out.truncated = true;
      break;
    }
    const det = event.getOccurrenceDetails(next);
    const recurrenceMs = toMs(det.recurrenceId, tz);
    const occ = describe(det.item.component, det.startDate, det.endDate, tz, {
      uid,
      recurring: true,
      occurrenceId: det.recurrenceId.toString(),
      modifiedOccurrence: det.item !== event || undefined,
    });
    if (recurrenceMs >= untilMs && occ._startMs >= untilMs) break;
    seen.add(recurrenceMs);
    if (overlaps(occ, fromMs, untilMs)) out.push(occ);
  }
  // Overrides whose original slot is after the range but were moved into it.
  for (const v of overrides) {
    const rid = v.getFirstPropertyValue("recurrence-id");
    if (seen.has(toMs(rid, tz))) continue;
    const s = v.getFirstPropertyValue("dtstart");
    const occ = describe(v, s, endOf(v, s), tz, { uid, recurring: true, occurrenceId: rid.toString(), modifiedOccurrence: true });
    if (overlaps(occ, fromMs, untilMs)) out.push(occ);
  }
  return out;
}

/** The master (series or single) event of a calendar object, described without expansion. */
export function describeObject(icsText: string, tz: string): Omit<Occurrence, "_startMs" | "_endMs"> {
  const vcal = new ICAL.Component(ICAL.parse(icsText) as any);
  return withZones(vcal, icsText, () => describeMaster(vcal, tz));
}

function describeMaster(vcal: Component, tz: string): Omit<Occurrence, "_startMs" | "_endMs"> {
  const vevents: Component[] = vcal.getAllSubcomponents("vevent");
  const master = vevents.find((v) => !v.hasProperty("recurrence-id")) ?? vevents[0];
  if (!master) throw new Error("This calendar item is not an event.");
  const s = master.getFirstPropertyValue("dtstart");
  const { _startMs, _endMs, ...ev } = describe(master, s, endOf(master, s), tz, {
    uid: text(master.getFirstPropertyValue("uid")),
    modifiedOccurrences: vevents.length - 1 || undefined,
    excludedDates: master.getAllProperties("exdate").length || undefined,
  });
  return ev;
}
