// Time zone helpers built on Intl (the IANA zone database shipped with Node):
// wall-clock time <-> UTC, and an RFC 5545 VTIMEZONE block for a zone an
// event names without defining it. Ported from the practitioner's own
// mail, calendar and contacts desktop extension (MIT).

import { ValidationError } from "../errors.js";

interface Wall {
  y: number;
  mo: number;
  d: number;
  h: number;
  mi: number;
  s: number;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function wallParts(tz: string, ms: number): Wall {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatters.set(tz, f);
  }
  const p: Record<string, number> = {};
  for (const { type, value } of f.formatToParts(new Date(ms))) p[type] = Number(value);
  return { y: p.year, mo: p.month, d: p.day, h: p.hour, mi: p.minute, s: p.second };
}

export function isValidTimeZone(tz: string): boolean {
  try {
    wallParts(tz, 0);
    return true;
  } catch {
    return false;
  }
}

/** UTC offset of `tz` at instant `ms`, in minutes (e.g. -420 for PDT). */
export function offsetMinutes(tz: string, ms: number): number {
  const p = wallParts(tz, ms);
  const asUtc = Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, p.s);
  return Math.round((asUtc - Math.floor(ms / 1000) * 1000) / 60000);
}

/**
 * Wall-clock time in `tz` -> UTC milliseconds. A time inside a spring-forward gap
 * is moved forward by the gap; an ambiguous fall-back time resolves to the first one.
 */
export function wallToUtc(tz: string, y: number, mo: number, d: number, h = 0, mi = 0, s = 0): number {
  const guess = Date.UTC(y, mo - 1, d, h, mi, s);
  const before = offsetMinutes(tz, guess - 86400000);
  const after = offsetMinutes(tz, guess + 86400000);
  const valid = [guess - before * 60000, guess - after * 60000]
    .filter((t) => t + offsetMinutes(tz, t) * 60000 === guess)
    .sort((a, b) => a - b);
  if (valid.length) return valid[0];
  return guess - before * 60000; // inside a spring-forward gap
}

const pad = (n: number, w = 2): string => String(Math.abs(n)).padStart(w, "0");

/** "2026-09-27T10:00:00-07:00" for instant `ms` in `tz`. */
export function formatInZone(tz: string, ms: number): string {
  const p = wallParts(tz, ms);
  const off = offsetMinutes(tz, ms);
  const sign = off < 0 ? "-" : "+";
  return `${p.y}-${pad(p.mo)}-${pad(p.d)}T${pad(p.h)}:${pad(p.mi)}:${pad(p.s)}${sign}${pad(Math.trunc(off / 60))}:${pad(off % 60)}`;
}

const LOCAL_RE = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?$/;

/**
 * Parse input into a UTC instant. Accepts "YYYY-MM-DD", "YYYY-MM-DDTHH:mm[:ss]"
 * (wall-clock time in `tz`), or an ISO string with Z or an offset (absolute).
 */
export function parseToUtc(input: string, tz: string): number {
  const m = LOCAL_RE.exec(input.trim());
  if (m) {
    const [, y, mo, d, h = "0", mi = "0", s = "0"] = m;
    return wallToUtc(tz, +y, +mo, +d, +h, +mi, +s);
  }
  // Otherwise only a full ISO time with an explicit Z or offset is accepted, so nothing is
  // silently read in the computer's own time zone.
  const iso = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/i.test(input.trim());
  const ms = iso ? Date.parse(input) : NaN;
  if (Number.isNaN(ms)) {
    throw new ValidationError(`Cannot understand the date/time "${input}". Use e.g. "2026-10-05T14:30" or "2026-10-05".`);
  }
  return ms;
}

/** Parse "YYYY-MM-DD" strictly. */
export function parseDateOnly(input: string): { y: number; mo: number; d: number } {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(input.trim());
  if (!m) throw new ValidationError(`Expected a date like "2026-10-05", got "${input}".`);
  return { y: +m[1], mo: +m[2], d: +m[3] };
}

// ---- VTIMEZONE generation ----

interface Transition {
  at: number;
  from: number;
  to: number;
}

function findTransitions(tz: string, year: number): Transition[] {
  const out: Transition[] = [];
  const start = Date.UTC(year, 0, 1);
  const end = Date.UTC(year + 1, 0, 1);
  const day = 86400000;
  let prev = offsetMinutes(tz, start);
  for (let t = start + day; t <= end; t += day) {
    const cur = offsetMinutes(tz, t);
    if (cur !== prev) {
      let lo = t - day;
      let hi = t; // the offset changes within (lo, hi]
      while (hi - lo > 60000) {
        const mid = lo + Math.floor((hi - lo) / 120000) * 60000;
        if (offsetMinutes(tz, mid) === prev) lo = mid;
        else hi = mid;
      }
      out.push({ at: hi, from: prev, to: cur });
      prev = cur;
    }
  }
  return out;
}

const DAYS = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];
const fmtOffset = (m: number): string => `${m < 0 ? "-" : "+"}${pad(Math.trunc(m / 60))}${pad(m % 60)}`;

function nthWeekdayOf(year: number, month: number, weekday: number, n: number): number {
  if (n > 0) {
    const first = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
    return 1 + ((weekday - first + 7) % 7) + (n - 1) * 7;
  }
  const lastDate = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const lastDow = new Date(Date.UTC(year, month - 1, lastDate)).getUTCDay();
  return lastDate - ((lastDow - weekday + 7) % 7);
}

function ruleComponent(t: Transition): string[] {
  // Local wall time just before the transition (in the old offset).
  const w = new Date(t.at + t.from * 60000);
  const month = w.getUTCMonth() + 1;
  const date = w.getUTCDate();
  const weekday = w.getUTCDay();
  const daysInMonth = new Date(Date.UTC(w.getUTCFullYear(), month, 0)).getUTCDate();
  const n = date + 7 > daysInMonth ? -1 : Math.ceil(date / 7);
  const d1970 = nthWeekdayOf(1970, month, weekday, n);
  const kind = t.to > t.from ? "DAYLIGHT" : "STANDARD";
  return [
    `BEGIN:${kind}`,
    `TZOFFSETFROM:${fmtOffset(t.from)}`,
    `TZOFFSETTO:${fmtOffset(t.to)}`,
    `DTSTART:1970${pad(month)}${pad(d1970)}T${pad(w.getUTCHours())}${pad(w.getUTCMinutes())}00`,
    `RRULE:FREQ=YEARLY;BYMONTH=${month};BYDAY=${n}${DAYS[weekday]}`,
    `END:${kind}`,
  ];
}

/**
 * VTIMEZONE text (CRLF lines) describing the zone's current yearly DST rule,
 * the rule in force this year, which is what calendar clients also use.
 */
export function buildVTimezone(tz: string, year = new Date().getUTCFullYear()): string {
  const transitions = findTransitions(tz, year);
  const lines = ["BEGIN:VTIMEZONE", `TZID:${tz}`];
  if (transitions.length === 0) {
    const off = fmtOffset(offsetMinutes(tz, Date.UTC(year, 0, 1)));
    lines.push("BEGIN:STANDARD", `TZOFFSETFROM:${off}`, `TZOFFSETTO:${off}`, "DTSTART:19700101T000000", "END:STANDARD");
  } else {
    for (const t of transitions) lines.push(...ruleComponent(t));
  }
  lines.push("END:VTIMEZONE");
  return lines.join("\r\n");
}
