// Phase timings on every render and bootstrap response, and the local wall clock.




/** Per-phase durations in ms, on every render and bootstrap response and in the call log (call-log.ts)
 * (2026-09-14 board-first bootstrap brief §0, #579). Later optimisations are measured against them. */
export type PhaseTimings = { phase: string; ms: number }[];

export function elapsedMs(start: number): number {
  return Math.round((performance.now() - start) * 10) / 10;
}

export function timed<T>(timings: PhaseTimings, phase: string, fn: () => T): T {
  const start = performance.now();
  const value = fn();
  timings.push({ phase, ms: elapsedMs(start) });
  return value;
}

/** Appends the call's whole duration as `total`, so untimed work shows as the gap. */
export function withTotal(timings: PhaseTimings, start: number): PhaseTimings {
  timings.push({ phase: "total", ms: elapsedMs(start) });
  return timings;
}

// Local wall-clock, deliberately not UTC (#383): every practitioner-facing
// date in the pipeline follows the practitioner's calendar, including the
// admission-ladder "today" and bench-line dates derived from ctx.rendered.
export function nowStamp(): string {
  return nowMinute().replace("T", " ");
}

// A job's stamps and every comparison against them read Node's clock, the clock the board's nowStamp()
// reads, never SQLite's 'localtime': the two can read a zone's rules an hour apart. The SQL forms are
// literals of digits, `-`, `T` and `:` only, so they go straight into a statement.

/** Node's local minute in the stored `YYYY-MM-DDTHH:MM` form, `offset` minutes ahead (negative: ago). */
export function nowMinute(offset = 0): string {
  const d = new Date(Date.now() + offset * 60_000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** nowMinute as a quoted SQL literal. */
export function nowMinuteSql(offset = 0): string {
  return `'${nowMinute(offset)}'`;
}

/** Node's local date as a quoted SQL literal, `YYYY-MM-DD`. */
export function todaySql(): string {
  return `'${nowMinute().slice(0, 10)}'`;
}
