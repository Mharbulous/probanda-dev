// Filing lifecycle derivation (schema v19; 2026-09-08 "retire a filing"
// design, extended 2026-09-10 with "entered"): the seven states a filing
// passes through, plus `sent` for a Writing that needs no forum parts (the
// fact is filings.needs_forum_parts, schema v30), derived -- never a stored
// state column. Four of the inputs are stored on the filing itself (filed_on,
// decided_on, entered_on, retired_on); hearing_date comes from the filing's
// hearing_details row; the
// appeal deadline is supplied per call by the caller from
// the docket-clerk agent and is never stored (deadlines are on
// /drafting-data's "not stored, deliberately" list).
//
// `served` (2026-10-21, amended Rule 8-1, B.C. Reg. 105/2026): a Notice of Application or
// Application Response recorded by drafting_data__record_served, which sets filed_on to the service
// date and sent_copy_id to the served copy. It takes the `filed` slot: the later registry filing is
// a job step, not a state. One recorded the old way, by record_filed, has no sent_copy_id and reads
// `filed`.
//
// Pure: no database, no clock. `today` is passed in (forms.ts derives it from
// nowStamp(), the same local wall-clock every mockup is stamped with), so the
// same inputs always give the same state.

export type LifecycleState = "drafting" | "served" | "filed" | "sent" | "heard" | "decided" | "entered" | "appeal_expired" | "retired";

export interface Lifecycle {
  state: LifecycleState;
  /** The date that put the filing in this state -- null only in `drafting`, which is the absence of every other input. */
  since: string | null;
  /** True only in `appeal_expired`: the one state from which retirement is the ordinary next step. */
  readyToRetire: boolean;
  /** True only in `sent`, on a Writing that needs no forum parts: the session offers retirement with
   * reason `delivered` when the Writing is recorded as sent (ADR 0024 D5 as reconciled). Whether the
   * Writing asks for nothing is the practitioner's answer at that offer, not a stored fact. */
  offerDelivered: boolean;
}

export const LIFECYCLE_LABELS: Record<LifecycleState, string> = {
  drafting: "Drafting",
  served: "Served",
  filed: "Filed",
  sent: "Sent",
  heard: "Heard",
  decided: "Decided",
  entered: "Entered",
  appeal_expired: "Appeal period expired",
  retired: "Retired",
};

/** The kinds amended Rule 8-1 serves before filing (8-1 (3), (9)). */
export const SERVED_KINDS: ReadonlySet<string> = new Set(["notice_of_application", "application_response"]);

/** Later states win: a retired filing reads as retired whatever else is set, and an expired appeal
 * period outranks both entry and the decision that started it running -- appeal time runs from the
 * date the order was pronounced (decided), not the date it was entered, so entry neither resets nor
 * extends the appeal clock. `hearingDate` is NULL-guarded -- VanIAC and requisition filings may
 * never set one, and a missing hearing date is "not heard", never "heard today". Every date here is
 * ISO `YYYY-MM-DD`, so plain string comparison is date comparison.
 *
 * A Writing with `needs_forum_parts` 0 has three states, retired, sent and drafting, from
 * `retired_on` and `filed_on` alone: the hearing date, `decided_on`, `entered_on` and the appeal
 * deadline are ignored for it (the schema refuses the three dates on it, v32). */
export function deriveLifecycle(
  filing: {
    filed_on: string | null;
    decided_on: string | null;
    entered_on: string | null;
    retired_on: string | null;
    needs_forum_parts?: 0 | 1;
    kind?: string;
    sent_copy_id?: number | null;
  },
  hearingDate: string | null,
  today: string,
  appealDeadline?: string | null
): Lifecycle {
  if (filing.retired_on) return { state: "retired", since: filing.retired_on, readyToRetire: false, offerDelivered: false };
  if (filing.needs_forum_parts === 0) {
    if (filing.filed_on) return { state: "sent", since: filing.filed_on, readyToRetire: false, offerDelivered: true };
    return { state: "drafting", since: null, readyToRetire: false, offerDelivered: false };
  }
  if (appealDeadline && appealDeadline < today) return { state: "appeal_expired", since: appealDeadline, readyToRetire: true, offerDelivered: false };
  if (filing.entered_on) return { state: "entered", since: filing.entered_on, readyToRetire: false, offerDelivered: false };
  if (filing.decided_on) return { state: "decided", since: filing.decided_on, readyToRetire: false, offerDelivered: false };
  if (hearingDate && hearingDate <= today) return { state: "heard", since: hearingDate, readyToRetire: false, offerDelivered: false };
  if (filing.filed_on) {
    const served = filing.kind !== undefined && SERVED_KINDS.has(filing.kind) && filing.sent_copy_id != null;
    return { state: served ? "served" : "filed", since: filing.filed_on, readyToRetire: false, offerDelivered: false };
  }
  return { state: "drafting", since: null, readyToRetire: false, offerDelivered: false };
}
