// The Job Board's dates (ADR 0013, both 2026-10-04 amendments): the matter's anchors and the
// deadlines that run from them, read through the practice gatekeeper's own tool,
// practice_data__active_deadlines, at each page write. This is the one place an anchor or deadline
// row becomes page data, built field by field. A deadline whose anchor is linked to a filing becomes
// a criterion on that filing's Goal card, which carries its name, state and order within its anchor
// and never its date; every date goes only into the Job Board's HTML file: never into a board
// section, the state file, a log line or a tool response. The page's header draws the anchors linked
// to its own Writing on one row and the matter's other anchors on the next.

import type { PracticeStore } from "../practice/store.js";
import { active_deadlines } from "../tools/practice/reads.js";
import type { GoalCriterion, WorkBoardData } from "./forms/render-work-board.js";

/** One deadline that runs from an anchor, as much of it as the Job Board draws. */
export interface MatterDeadline {
  deadline_type: string;
  deadline_date: string;
  party_label: string | null;
  /** `active`, `met`, or `not_applicable` for the other side's obligation. */
  status: string | null;
  review_flag: string | null;
  /** Names one of several unresolved provisional alternatives of this deadline, else null. */
  scenario_label: string | null;
}

/** One anchor, with the deadlines that run from it. */
export interface MatterAnchor {
  anchor_type: string;
  anchor_date: string;
  party_label: string | null;
  proceeding_label: string | null;
  /** `active`, or `conflicted` when its sources disagree. */
  status: string | null;
  /** `filing:<id>` when the anchor is linked to the filing its event is for, else null. */
  filing_ref: string | null;
  deadlines: MatterDeadline[];
}

/** The matter's anchors, or why none were read. A page that could not read them says so. */
export type MatterDates = { anchors: MatterAnchor[] } | { note: string };

/** One plain date in the page header: a label, the date as stored, and a flag drawn after it. */
export interface PageDate {
  label: string;
  date: string;
  flag: string | null;
}

/** The Job Board page's dates: the Writing's row, the matter's row, and each deadline criterion's
 * date by filing id, then criterion id, which the page joins to the criterion at draw time. */
export interface PageDates {
  /** Anchors linked to a filing on this page, each with its deadlines no card carries. */
  writing: PageDate[];
  /** Every other anchor, each with its deadlines no card carries. */
  header: PageDate[];
  criteria: Record<string, Record<string, { date: string; flag: string | null }>>;
  /** Why no date was read; drawn in the header row. */
  note?: string;
}

const text = (value: unknown): string | null => (value === null || value === undefined ? null : String(value));

export async function readMatterDates(practiceDb: PracticeStore, matterNo: string | undefined): Promise<MatterDates> {
  if (matterNo === undefined) return { note: "No matter number was given, so this matter's dates were not read." };
  let read: { anchors: Record<string, unknown>[]; deadlines: Record<string, unknown>[] };
  try {
    read = await active_deadlines(practiceDb, { matt_num: matterNo, include_met: true });
  } catch (err) {
    return { note: `This matter's dates could not be read (${matterNo}): ${(err as Error).message}` };
  }
  return {
    anchors: read.anchors
      .map((anchor) => ({
        anchor_type: String(anchor.anchor_type),
        anchor_date: text(anchor.anchor_date) ?? "",
        party_label: text(anchor.party_label),
        proceeding_label: text(anchor.proceeding_label),
        status: text(anchor.status),
        filing_ref: text(anchor.filing_ref),
        deadlines: read.deadlines
          .filter((deadline) => text(deadline.anchor_id) === String(anchor.id))
          .map((deadline) => ({
            deadline_type: String(deadline.deadline_type),
            deadline_date: text(deadline.deadline_date) ?? "",
            party_label: text(deadline.party_label),
            status: text(deadline.status),
            review_flag: text(deadline.review_flag),
            scenario_label: text(deadline.scenario_label),
          }))
          .sort((a, b) => a.deadline_date.localeCompare(b.deadline_date)),
      }))
      .sort((a, b) => a.anchor_date.localeCompare(b.anchor_date)),
  };
}

/** `notice_of_application_service` -> "Notice of application service". */
export function humanise(type: string): string {
  const words = type.replace(/_/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** The filing id an anchor is linked to, or null. */
function linkedFiling(anchor: MatterAnchor): number | null {
  const m = /^filing:([1-9]\d*)$/.exec(anchor.filing_ref ?? "");
  return m === null ? null : Number(m[1]);
}

/** A deadline's criterion id, unique per party when it has one. */
function criterionId(deadline: MatterDeadline): `deadline:${string}` {
  const party = deadline.party_label ? `:${deadline.party_label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}` : "";
  return `deadline:${deadline.deadline_type}${party}`;
}

/** A deadline's name: its type in words, then its party when it has one. Never its rule or date. */
const deadlineText = (deadline: MatterDeadline): string => humanise(deadline.deadline_type) + (deadline.party_label ? ` — ${deadline.party_label}` : "");

/** A deadline the Goal card carries: one of ours, met or not. */
const isCriterion = (deadline: MatterDeadline): boolean => deadline.status === "active" || deadline.status === "met";

/**
 * The anchor's deadlines its filing's Goal card can carry, in date order: every criterion deadline,
 * except that of a deadline's unresolved provisional alternatives only the earliest is carried, so
 * the card keeps one condition per obligation. The other alternatives go to a date row.
 */
function cardDeadlines(anchor: MatterAnchor): MatterDeadline[] {
  const carried = new Set<string>();
  return anchor.deadlines
    .filter(isCriterion)
    .sort((a, b) => a.deadline_date.localeCompare(b.deadline_date))
    .filter((d) => {
      if (d.scenario_label === null) return true;
      const id = criterionId(d);
      if (carried.has(id)) return false;
      carried.add(id);
      return true;
    });
}

/**
 * The Goal criteria filing `filingId` draws from the deadlines of each anchor linked to it, in
 * anchor order: name and state only, never a date, a rule or a review flag. Within one anchor they
 * run in date order, and each names, in `follows`, the criteria at the previous date; equal dates
 * share a rank. No order runs across anchors. Empty when the dates were not read.
 */
export function deadlineCriteria(dates: MatterDates, filingId: number): GoalCriterion[] {
  if (!("anchors" in dates)) return [];
  return dates.anchors
    .filter((anchor) => linkedFiling(anchor) === filingId)
    .flatMap((anchor) => {
      const ranked = cardDeadlines(anchor);
      const dateOrder = [...new Set(ranked.map((d) => d.deadline_date))];
      return ranked.map((d): GoalCriterion => {
        const rank = dateOrder.indexOf(d.deadline_date);
        const follows = rank === 0 ? [] : ranked.filter((p) => p.deadline_date === dateOrder[rank - 1]).map(criterionId);
        return {
          id: criterionId(d),
          text: deadlineText(d),
          state: d.status === "met" ? "met" : "unmet",
          outstanding: 0,
          items: [],
          source: "practice",
          ...(follows.length > 0 ? { follows } : {}),
        };
      });
    });
}

/**
 * The page's dates, once its sections are built: each deadline a section's Goal card carries as a
 * criterion goes to `criteria` under its filing; every anchor, and every deadline no card carries
 * (the other side's, an unlinked anchor's, or one whose filing has no Goal card on this page), goes
 * to a header row, each anchor followed by its own: `writing` when the anchor is linked to a filing
 * on this page, `header` otherwise.
 */
export function pageDates(dates: MatterDates, sections: readonly WorkBoardData[]): PageDates {
  if (!("anchors" in dates)) return { writing: [], header: [], criteria: {}, note: dates.note };
  const writing: PageDate[] = [];
  const header: PageDate[] = [];
  const criteria: PageDates["criteria"] = {};
  for (const anchor of dates.anchors) {
    const labels = [anchor.party_label, anchor.proceeding_label].filter((label): label is string => label !== null && label !== "");
    const filingId = linkedFiling(anchor);
    const onPage = filingId !== null && sections.some((s) => s.meta.filing_id === filingId);
    const row = onPage ? writing : header;
    row.push({ label: [humanise(anchor.anchor_type), ...labels].join(" — "), date: anchor.anchor_date, flag: anchor.status === "conflicted" ? "conflicted" : null });
    const card = filingId === null ? undefined : sections.find((s) => s.meta.filing_id === filingId)?.criteria;
    const carried = new Set(cardDeadlines(anchor));
    for (const d of anchor.deadlines) {
      const id = criterionId(d);
      if (carried.has(d) && card?.some((c) => c.id === id)) {
        (criteria[String(filingId)] ??= {})[id] = { date: d.deadline_date, flag: d.review_flag };
        continue;
      }
      const scenario = d.scenario_label ? ` — ${d.scenario_label}` : "";
      const whose = d.status === "not_applicable" ? " (other side)" : d.status === "met" ? " (met)" : "";
      row.push({ label: deadlineText(d) + scenario + whose, date: d.deadline_date, flag: d.review_flag });
    }
  }
  return { writing, header, criteria };
}
