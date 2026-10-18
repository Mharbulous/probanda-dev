// The order the Matter Board presents filings in (#584, carrying the first-board grilling's
// decision). Bootstrap's own list uses orderByRecency below, so /draft reopens the filing worked
// on last.
//
// The rule is recorded in the design brief and its ADR, and deliberately nowhere a session
// loads: a session that knew it could read a filing's hearing proximity off its position in
// the list, which is what `shared/deadline-isolation.md` exists to prevent. Bootstrap returns
// the order and carries no hearing date, no time remaining and no reason. Keep it that way --
// this rule must not be restated in a skill file, a reference, or a tool description.

/** Local `YYYY-MM-DD HH:MM`, the single injectable clock reading the whole call shares. */
export type Stamp = string;

export interface Orderable {
  filing_id: number;
  /** The stored hearing date, `YYYY-MM-DD`, or null. `hearing_time` is ignored: it is free text. */
  hearing_date: string | null;
  /** Newest activity timestamp on this filing, or null when it has none. */
  latest_activity: string | null;
  retired: boolean;
}

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

/** Explicit local-time construction: `new Date("2026-09-15 10:00")` is implementation-defined. */
function localMs(date: string, hours = 0, minutes = 0): number {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(y, m - 1, d, hours, minutes, 0, 0).getTime();
}

function stampMs(stamp: Stamp): number {
  const [date, time] = stamp.split(" ");
  const [hh, mm] = (time ?? "00:00").split(":").map(Number);
  return localMs(date, hh, mm);
}

/**
 * A live filing is imminent when its hearing is at most a week away and that hearing day has
 * not yet been over for half a day -- so a hearing still ahead, today's hearing, and last
 * night's hearing all count, while one from two days ago does not.
 */
export function isImminent(hearingDate: string | null, now: Stamp): boolean {
  if (hearingDate === null) return false;
  const hearing = localMs(hearingDate);
  if (hearing - localMs(now.slice(0, 10)) > 7 * DAY_MS) return false;
  const endOfHearingDay = localMs(hearingDate, 23, 59);
  return stampMs(now) - endOfHearingDay <= 12 * HOUR_MS;
}

/**
 * Imminent filings first, earliest hearing first; then every other live filing by latest
 * activity, most recent first; then live filings with no activity at all; then the retired
 * ones. Every tie inside a band breaks on filing id, so the order is total and stable.
 */
export function orderFilings<T extends Orderable>(filings: T[], now: Stamp): T[] {
  const band = (f: T): number => (f.retired ? 3 : isImminent(f.hearing_date, now) ? 0 : f.latest_activity === null ? 2 : 1);
  return [...filings].sort((a, b) => {
    const bandA = band(a);
    const bandB = band(b);
    if (bandA !== bandB) return bandA - bandB;
    if (bandA === 0 && a.hearing_date !== b.hearing_date) return (a.hearing_date as string) < (b.hearing_date as string) ? -1 : 1;
    if (bandA === 1 && a.latest_activity !== b.latest_activity) return (a.latest_activity as string) > (b.latest_activity as string) ? -1 : 1;
    return a.filing_id - b.filing_id;
  });
}

/**
 * The order bootstrap returns filings in: live filings by latest activity, most recent first;
 * then live filings with no activity; then the retired ones; ties on filing id. No hearing date
 * enters it, so a session reading it learns nothing about hearing proximity. The Matter Board
 * keeps orderFilings, which a session never reads.
 */
export function orderByRecency<T extends Orderable>(filings: T[]): T[] {
  const band = (f: T): number => (f.retired ? 2 : f.latest_activity === null ? 1 : 0);
  return [...filings].sort((a, b) => {
    const bandA = band(a);
    const bandB = band(b);
    if (bandA !== bandB) return bandA - bandB;
    if (bandA === 0 && a.latest_activity !== b.latest_activity) return (a.latest_activity as string) > (b.latest_activity as string) ? -1 : 1;
    return a.filing_id - b.filing_id;
  });
}
