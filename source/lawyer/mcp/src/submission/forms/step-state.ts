// A job step's state (schema v78), read the same way by every renderer and by complete_job. done_at
// is the only meaning of done and always wins, so a stamp already written is never reinterpreted.
// A waiting step whose wait_until has come reads as open again: wait_until is the minute to check a
// process, never a deadline, and nothing here measures time remaining. On a database held below v78
// a step has no status, so it reads as open or done.

import { STEP_GLYPHS } from "./symbol-table.js";

export const STEP_STATUSES = ["retry", "cancelled", "deferred", "waiting"] as const;

export interface StepStateFields {
  done_at: string | null;
  status?: string | null;
  wait_until?: string | null;
  status_note?: string | null;
}

export type StepView = keyof typeof STEP_GLYPHS;

/** A minute stamp with a `T` or a space, made comparable as text. */
const minute = (stamp: string): string => stamp.replace(" ", "T").slice(0, 16);

/** The step's state at `now` (a local minute stamp, `T` or space). */
export function stepView(s: StepStateFields, now: string): StepView {
  if (s.done_at !== null) return "done";
  if (s.status === "waiting") return s.wait_until && minute(s.wait_until) > minute(now) ? "waiting" : "open";
  if (s.status === "retry" || s.status === "cancelled" || s.status === "deferred") return s.status;
  return "open";
}

/** Done, or dropped or put off on the practitioner's words. */
export function stepResolved(s: StepStateFields): boolean {
  return s.done_at !== null || s.status === "cancelled" || s.status === "deferred";
}

/** The glyph a step prints with, and on a waiting one the plain minute it is next checked: never a
 * countdown. */
export function stepGlyphText(s: StepStateFields, now: string): string {
  const view = stepView(s, now);
  return view === "waiting" ? `${STEP_GLYPHS.waiting} until ${minute(s.wait_until as string).slice(11)}` : STEP_GLYPHS[view];
}
