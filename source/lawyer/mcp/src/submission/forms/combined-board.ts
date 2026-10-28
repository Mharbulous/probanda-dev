// A merged Milestone as one board (docs/ADRs/0010-milestones-organized-by-goals.md, 2026-10-21
// amendment): the sections drawn on one page pooled into one section, so the page, board_summary and
// board_card all show one Completion Criteria card and one set of lanes. Each job is tagged with the
// Writing it serves. Criteria combine by id and read unmet while any Writing's is unmet; each
// filing's own gate row and pre_filing_check are untouched, so one filing's gate never meets
// another's. A deadline criterion is never combined: on an id two Writings share, the later one's
// becomes `<id>@filing:<n>`. One section passes through as the same object, so an unmerged board is
// unchanged. The page's copy (2026-10-22 amendment) names no Writing on its Completion Criteria card:
// one lifecycle state, one wording per criterion, and an item two Writings share printed once.

import { submissionDataQuery } from "../backend.js";
import { LIFECYCLE_LABELS, type LifecycleState } from "./lifecycle.js";
import type { GoalCriterion, GoalState, WorkBoardData, WorkBoardEdge, WorkBoardTicket } from "./render-work-board.js";

/** A criterion as the page draws it: `counts` holds the underlying items and suppressed items where
 * the page prints an item two Writings share once, so its labels still count every one. */
export type PageCriterion = GoalCriterion & { counts?: { items: number; suppressed: number } };

/** The page's one wording for a gate criterion whose Writings' gates differ. */
const GATE_TEXT = "The pre-filing and pre-send checks are passed or waived";

/** A section's Writing as a job's tag and a criterion's prefix names it. */
function writingOf(section: WorkBoardData): string {
  return section.meta.filing_id === null ? `Proceeding ${section.meta.proceeding_id}` : section.meta.filing;
}

/** The worst of several states: unmet, then pending, then met. */
function worst(states: GoalState[]): GoalState {
  return states.includes("unmet") ? "unmet" : states.includes("pending") ? "pending" : "met";
}

/** Each id once, in the first section that has it: a proceeding-wide row is in every section of its proceeding. */
function distinct<T extends { id: number }>(lists: T[][]): T[] {
  const seen = new Set<number>();
  return lists.flat().filter((r) => {
    if (seen.has(r.id)) return false;
    seen.add(r.id);
    return true;
  });
}

/** Per section, by index, each deadline criterion's id on the combined board: its own, or
 * `<id>@filing:<n>` when an earlier section already holds that id. */
export function combinedDeadlineIds(sections: readonly WorkBoardData[]): Map<string, string>[] {
  const taken = new Set<string>();
  return sections.map((s) => {
    const ids = new Map<string, string>();
    for (const c of s.criteria ?? []) {
      if (c.source !== "practice") continue;
      const id = taken.has(c.id) ? `${c.id}@filing:${s.meta.filing_id}` : c.id;
      taken.add(id);
      ids.set(c.id, id);
    }
    return ids;
  });
}

/** The least advanced lifecycle among the sections that have one, in lifecycle order; null when none has one. */
function leastAdvanced(sections: WorkBoardData[]): LifecycleState | null {
  const order = Object.keys(LIFECYCLE_LABELS) as LifecycleState[];
  const states = sections.map((s) => s.meta.state).filter((x): x is LifecycleState => x !== null && x !== undefined);
  return states.length === 0 ? null : order[Math.min(...states.map((x) => order.indexOf(x)))];
}

/** A combined criterion's items as the page prints them: an item whose text an earlier Writing's
 * items already hold is dropped, with its `replaces` and `locators` entries; `counts` keeps the totals. */
function pageItems(held: { c: GoalCriterion }[], combined: GoalCriterion): PageCriterion {
  const seen = new Set<string>();
  const keep: boolean[] = [];
  for (const { c } of held) {
    const own = c.items.map((item) => !seen.has(item));
    c.items.forEach((item) => seen.add(item));
    keep.push(...own);
  }
  if (keep.every(Boolean)) return combined;
  const pick = <T>(list: T[]) => list.filter((_, i) => keep[i]);
  return {
    ...combined,
    items: pick(combined.items),
    ...(combined.replaces ? { replaces: pick(combined.replaces) } : {}),
    ...(combined.locators ? { locators: pick(combined.locators) } : {}),
    counts: { items: combined.items.length, suppressed: (combined.replaces ?? []).filter((r) => r !== null).length },
  };
}

/** The Goal-bearing sections' criteria as one list, in first-appearance order. On the page no text
 * names a Writing. */
function combinedCriteria(goaled: WorkBoardData[], deadlineIds: Map<string, string>[], page: boolean): PageCriterion[] {
  const several = goaled.length > 1 && !page;
  const tag = (s: WorkBoardData, text: string) => (several ? `${writingOf(s)}: ${text}` : text);
  const order: string[] = [];
  const byId = new Map<string, { section: WorkBoardData; c: GoalCriterion }[]>();
  goaled.forEach((s, i) => {
    for (const c of s.criteria ?? []) {
      if (c.source === "practice") {
        const id = deadlineIds[i].get(c.id) ?? c.id;
        const follows = c.follows?.map((f) => deadlineIds[i].get(f) ?? f);
        const own: GoalCriterion = { ...c, id: id as GoalCriterion["id"], text: several ? `${c.text} (${writingOf(s)})` : c.text, ...(follows ? { follows } : {}) };
        order.push(id);
        byId.set(id, [{ section: s, c: own }]);
        continue;
      }
      if (!byId.has(c.id)) {
        order.push(c.id);
        byId.set(c.id, []);
      }
      (byId.get(c.id) as { section: WorkBoardData; c: GoalCriterion }[]).push({ section: s, c });
    }
  });
  return order.map((id) => {
    const held = byId.get(id) as { section: WorkBoardData; c: GoalCriterion }[];
    const [first] = held;
    if (held.length === 1) {
      if (first.c.source === "practice") return first.c;
      return { ...first.c, text: several ? `${first.c.text} (${writingOf(first.section)})` : first.c.text };
    }
    const texts = new Set(held.map((h) => h.c.text));
    const withReplaces = held.some((h) => h.c.replaces !== undefined);
    const withLocators = held.some((h) => h.c.locators !== undefined);
    const pageText = id === "gate" ? GATE_TEXT : [...texts].join("; ");
    const combined: GoalCriterion = {
      ...first.c,
      text: texts.size === 1 ? first.c.text : page ? pageText : held.map((h) => tag(h.section, h.c.text)).join("; "),
      state: worst(held.map((h) => h.c.state)),
      outstanding: held.reduce((n, h) => n + h.c.outstanding, 0),
      items: held.flatMap((h) => h.c.items.map((item) => tag(h.section, item))),
      ...(withReplaces ? { replaces: held.flatMap((h) => h.c.replaces ?? h.c.items.map(() => null)) } : {}),
      ...(withLocators ? { locators: held.flatMap((h) => h.c.locators ?? h.c.items.map(() => null)) } : {}),
    };
    return page ? pageItems(held, combined) : combined;
  });
}

/** Each job's Writing, read from its own filing: a job's card carries no filing. */
function writingTags(dbPath: string, ids: number[]): Map<number, string> {
  if (ids.length === 0) return new Map();
  const found = submissionDataQuery(
    dbPath,
    `SELECT t.id, t.proceeding_id, f.title FROM tickets t LEFT JOIN filings f ON f.id = t.filing_id WHERE t.id IN (${ids.map(() => "?").join(",")})`,
    ids
  ).rows as unknown as { id: number; proceeding_id: number; title: string | null }[];
  return new Map(found.map((r) => [r.id, r.title ?? `Proceeding ${r.proceeding_id}`]));
}

/** A merged board's sections as one: the first section's, the survivor's, with every section's rows.
 * `page` gives the HTML page's copy, whose Completion Criteria card names no Writing: its state is the
 * least advanced lifecycle among the Writings, with no date. board_summary and board_card read the
 * other copy, which names each Writing so a session can route work. */
export function combineSections(dbPath: string, sections: WorkBoardData[], page = false): WorkBoardData {
  if (sections.length < 2) return sections[0];
  const [first] = sections;
  const pooled = distinct(sections.map((s) => s.tickets));
  const byId = new Map(pooled.map((t) => [t.id, t]));
  const tags = writingTags(dbPath, pooled.map((t) => t.id));
  // An edge to a job in another proceeding on this board now has a card to link to.
  const linked = (e: WorkBoardEdge): WorkBoardEdge => {
    const other = e.status === null ? byId.get(e.id) : undefined;
    return other === undefined ? e : { id: e.id, status: other.status, rejected: other.status === "queued" && other.rejected_at !== null };
  };
  const tickets = pooled.map((t): WorkBoardTicket => ({
    ...t,
    superseded_by: t.superseded_by === null ? null : linked(t.superseded_by),
    blocked_by: t.blocked_by.map(linked),
    conflicts: t.conflicts.map(linked),
    writing: tags.get(t.id) as string,
  }));

  const goaled = sections.filter((s) => s.goal !== undefined);
  const deadlineIds = combinedDeadlineIds(goaled);
  const goalTexts = [...new Set(goaled.filter((s) => s.goal?.text != null).map((s) => (goaled.length > 1 && !page ? `${writingOf(s)}: ${s.goal?.text}` : (s.goal?.text as string))))];
  const goal =
    goaled.length === 0
      ? {}
      : {
          goal: { sentence: (goaled[0].goal as NonNullable<WorkBoardData["goal"]>).sentence, state: worst(goaled.map((s) => (s.goal as NonNullable<WorkBoardData["goal"]>).state)), text: goalTexts.length === 0 ? null : goalTexts.join("; ") },
          criteria: combinedCriteria(goaled, deadlineIds, page),
        };

  const proposalSeen = new Set<string>();
  const proposals = sections
    .flatMap((s) => s.proposals)
    .filter((p) => {
      const key = JSON.stringify([p.key, p.item, p.lane]);
      if (proposalSeen.has(key)) return false;
      proposalSeen.add(key);
      return true;
    });
  const ingest = sections.filter((s) => s.meta.ingest_inputs !== undefined).map((s) => s.meta.ingest_inputs as NonNullable<WorkBoardData["meta"]["ingest_inputs"]>);
  const { ingest_inputs: _ingest, job_only: _jobOnly, ...meta } = first.meta;
  const least = page ? leastAdvanced(sections) : null;

  return {
    ...first,
    meta: {
      ...meta,
      filing: sections.map(writingOf).join("; "),
      state_label: least !== null ? LIFECYCLE_LABELS[least] : sections.map((s) => `${writingOf(s)}: ${s.meta.state_since === null ? s.meta.state_label : `${s.meta.state_label} ${s.meta.state_since}`}`).join(" · "),
      state_since: null,
      ready_to_retire: false,
      ...(ingest.length > 0 ? { ingest_inputs: { types: [...new Set(ingest.flatMap((i) => i.types))], ready_jobs: [...new Set(ingest.flatMap((i) => i.ready_jobs))] } } : {}),
      ...(sections.every((s) => s.meta.job_only) ? { job_only: true as const } : {}),
      writing_states: sections.map((s) => ({ filing_id: s.meta.filing_id, proceeding_id: s.meta.proceeding_id, title: writingOf(s), state_label: s.meta.state_label, state_since: s.meta.state_since, ready_to_retire: s.meta.ready_to_retire })),
    },
    tickets,
    seeds: distinct(sections.map((s) => s.seeds)),
    deleted: distinct(sections.map((s) => s.deleted)),
    discardedSeeds: distinct(sections.map((s) => s.discardedSeeds)),
    attachments: distinct(sections.map((s) => s.attachments)),
    proposals,
    lapsed_keys: [...new Set(sections.flatMap((s) => s.lapsed_keys))],
    goals: first.goals,
    ...goal,
  };
}
