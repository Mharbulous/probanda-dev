// The practice reads. Each reads practice.db's items once and filters them in memory; none
// calls Probanda's Cloud, so every read works offline. What each returns by default (L2), the
// billing cutoff (L1) and matter references (L4) stay here, on the user's machine.

import type { Item, Row } from "../../practice/items.js";
import { rowsOf } from "../../practice/items.js";
import type { PracticeStore } from "../../practice/store.js";
import {
  clientContext,
  effectiveCutoff,
  isBillable,
  loadClientsById,
  normalizeMattNum,
  requireMatter,
  type EffectiveCutoff,
} from "./shared.js";

function withClient(matter: Row, clients: Map<string, Row>): Row {
  return { ...matter, ...clientContext(clients.get(String(matter.client_id))) };
}

function byId(rows: Row[]): Map<string, Row> {
  return new Map(rows.map((row) => [String(row.id), row]));
}

function groupBy(rows: Row[], field: string): Map<string, Row[]> {
  const groups = new Map<string, Row[]>();
  for (const row of rows) {
    const key = String(row[field]);
    const list = groups.get(key) ?? [];
    list.push(row);
    groups.set(key, list);
  }
  return groups;
}

export async function matter_lookup(
  store: PracticeStore,
  args: Record<string, unknown>
): Promise<{ rows: Row[] }> {
  const items = store.items();
  const clients = loadClientsById(items);
  const matters = rowsOf(items, "matter");
  let matched: Row[] = [];

  if (args.matter_id) {
    matched = matters.filter((matter) => matter.id === String(args.matter_id));
  } else if (args.matt_num) {
    matched = matters.filter((matter) => matter.matt_num === normalizeMattNum(args.matt_num));
  } else if (args.file_number) {
    matched = matters.filter((matter) => matter.file_number === String(args.file_number));
  } else if (args.client_name) {
    const needle = String(args.client_name).toLowerCase();
    const matchingClientIds = new Set(
      [...clients.values()]
        .filter((client) => typeof client.name === "string" && client.name.toLowerCase().includes(needle))
        .map((client) => String(client.id))
    );
    matched = matters.filter((matter) => matchingClientIds.has(String(matter.client_id)));
  }

  return { rows: matched.map((matter) => withClient(matter, clients)) };
}

export async function trust_summary(
  store: PracticeStore,
  args: Record<string, unknown>
): Promise<{ rows: Row[] }> {
  const items = store.items();
  const clients = loadClientsById(items);
  let matters = rowsOf(items, "matter");
  if (args.matt_num) {
    matters = matters.filter((matter) => matter.matt_num === normalizeMattNum(args.matt_num));
  } else if (args.filter === "funded") {
    matters = matters.filter((matter) => matter.regular_trust !== null && matter.regular_trust !== undefined && Number(matter.regular_trust) < 0);
  } else if (args.filter === "depleted") {
    matters = matters.filter((matter) => matter.regular_trust !== null && matter.regular_trust !== undefined && Number(matter.regular_trust) === 0);
  }
  return { rows: matters.map((row) => withClient(row, clients)) };
}

export async function wip_hours(
  store: PracticeStore,
  args: Record<string, unknown>
): Promise<{ rows: Row[] }> {
  const items = store.items();
  const clients = loadClientsById(items);
  const matterById = byId(rowsOf(items, "matter"));

  let target: string | null = null;
  if (args.matt_num || args.matter_id) target = requireMatter(items, args).id;

  // An explicit cutoff_date (e.g. bill-client's PDF-derived exact date)
  // overrides uniformly for every matter, one cutoff reported for every row.
  // Omitting it derives each matter's OWN cutoff from its own invoices
  // (Step 2, 2026-08-26): date_to + 1 day when a matter's invoice states it,
  // else that invoice's issue_date (the pre-existing proxy) -- see
  // shared.ts effectiveCutoff. A matter with no invoices at all keeps the
  // prior "sum everything" behavior (cutoff_date: null).
  const explicitCutoff = typeof args.cutoff_date === "string" && args.cutoff_date ? args.cutoff_date : null;

  // Non-billable entries are never work in progress, whatever their matter says.
  const entries = rowsOf(items, "time_entry").filter((entry) =>
    entry.billable === true &&
    (!target || entry.matter_id === target) &&
    (!explicitCutoff || String(entry.entry_date ?? "") >= explicitCutoff));
  const entriesByMatter = groupBy(entries, "matter_id");
  const invoicesByMatter = groupBy(rowsOf(items, "invoice"), "matter_id");

  const rows: Row[] = [];
  for (const [matterId, matterEntries] of entriesByMatter) {
    const matter = matterById.get(matterId);
    // No explicit target = the all-matters sweep; exclude non-billable matters
    // from it so they don't leak into aggregate WIP reporting. A targeted call
    // (matt_num/matter_id given) still returns hours for that matter regardless.
    if (!target && !isBillable(matter)) continue;

    let cutoffDate: string | null = explicitCutoff;
    let cutoffSource: "date_to" | "issue_date" | "explicit" | null = explicitCutoff ? "explicit" : null;
    let scopedEntries = matterEntries;

    if (!explicitCutoff) {
      const derived: EffectiveCutoff | null = effectiveCutoff(invoicesByMatter.get(matterId) ?? []);
      if (derived) {
        cutoffDate = derived.cutoff_date;
        cutoffSource = derived.cutoff_source;
        scopedEntries = matterEntries.filter((entry) => String(entry.entry_date ?? "") >= derived.cutoff_date);
      }
    }

    const totalHours = scopedEntries.reduce((sum, entry) => sum + Number(entry.hours ?? 0), 0);

    rows.push({
      matter_id: matterId,
      matt_num: matter?.matt_num ?? null,
      file_number: matter?.file_number ?? null,
      description: matter?.description ?? null,
      ...clientContext(matter ? clients.get(String(matter.client_id)) : undefined),
      total_hours: totalHours,
      cutoff_date: cutoffDate,
      cutoff_source: cutoffSource,
    });
  }
  return { rows };
}

export async function time_entries_query(
  store: PracticeStore,
  args: Record<string, unknown>
): Promise<{ rows: Row[] }> {
  const items = store.items();
  const clients = loadClientsById(items);
  const matterById = byId(rowsOf(items, "matter"));

  const matterId = args.matt_num || args.matter_id || args.file_number ? requireMatter(items, args).id : null;
  const fromDate = args.from_date ? String(args.from_date) : null;
  const toDate = args.to_date ? String(args.to_date) : null;

  const rows = rowsOf(items, "time_entry")
    .filter((entry) =>
      (!matterId || entry.matter_id === matterId) &&
      (!fromDate || String(entry.entry_date ?? "") >= fromDate) &&
      (!toDate || String(entry.entry_date ?? "") <= toDate))
    .map((entry) => {
      const matter = matterById.get(String(entry.matter_id));
      return {
        ...entry,
        matt_num: matter?.matt_num ?? null,
        file_number: matter?.file_number ?? null,
        matter_description: matter?.description ?? null,
        ...clientContext(matter ? clients.get(String(matter.client_id)) : undefined),
      };
    });
  return { rows };
}

export async function open_tasks(
  store: PracticeStore,
  args: Record<string, unknown>
): Promise<{ rows: Row[] }> {
  const items = store.items();
  const clients = loadClientsById(items);
  const matterById = byId(rowsOf(items, "matter"));

  const matterId = args.matt_num || args.matter_id ? requireMatter(items, args).id : null;
  const taskRows = rowsOf(items, "task").filter((task) =>
    task.status === "open" &&
    (!args.task_type || task.task_type === String(args.task_type)) &&
    (!matterId || task.matter_id === matterId));

  // Latest retainer notice per matter.
  const latestNotice = new Map<string, string>();
  for (const notice of rowsOf(items, "retainer_notice")) {
    const id = String(notice.matter_id);
    const sentAt = String(notice.sent_at ?? "");
    if (!latestNotice.has(id) || sentAt > (latestNotice.get(id) ?? "")) latestNotice.set(id, sentAt);
  }

  const rows = taskRows.map((task) => {
    const matter = task.matter_id ? matterById.get(String(task.matter_id)) : undefined;
    return {
      ...task,
      matt_num: matter?.matt_num ?? null,
      file_number: matter?.file_number ?? null,
      matter_description: matter?.description ?? null,
      ...clientContext(matter ? clients.get(String(matter.client_id)) : undefined),
      last_retainer_notice_at: task.matter_id ? latestNotice.get(String(task.matter_id)) ?? null : null,
    };
  });
  return { rows };
}

export async function active_deadlines(
  store: PracticeStore,
  args: Record<string, unknown>
): Promise<{ anchors: Row[]; deadlines: Row[] }> {
  const items = store.items();
  const matterId = args.matt_num || args.matter_id ? requireMatter(items, args).id : null;
  const inMatter = (row: Row) => !matterId || row.matter_id === matterId;

  // Matter identity rides on every row so an all-matters sweep is resolvable
  // without string-guessing party names out of source_document (#230 4.6) --
  // same join open_tasks carries.
  const clients = loadClientsById(items);
  const matterById = byId(rowsOf(items, "matter"));
  const matterContext = (id: unknown): Row => {
    const matter = matterById.get(String(id));
    return {
      matt_num: matter?.matt_num ?? null,
      file_number: matter?.file_number ?? null,
      matter_description: matter?.description ?? null,
      ...clientContext(matter ? clients.get(String(matter.client_id)) : undefined),
    };
  };

  // Active and conflicted anchors surface (the skill reports conflicts prominently);
  // superseded tombstones must not leak to consumers (#189 D5), and occurred
  // anchors are spent events -- excluded unless include_occurred asks (#230 4.1).
  const sourcesByAnchor = groupBy(rowsOf(items, "anchor_source"), "anchor_id");
  const includeOccurred = args.include_occurred === true;
  const anchorsOut = rowsOf(items, "anchor")
    .filter((anchor) => anchor.status !== "superseded" && inMatter(anchor))
    .filter((anchor) => includeOccurred || anchor.status !== "occurred")
    .map((anchor) => ({
      ...anchor,
      ...matterContext(anchor.matter_id),
      sources: sourcesByAnchor.get(String(anchor.id)) ?? [],
    }));

  // 'active' and 'not_applicable' (other side's obligation) return by default;
  // a not_applicable row whose one-shot post-expiry notice already fired
  // (expiry_notified_at set) drops out unless include_notified asks; 'dismissed'
  // rows are always excluded unless include_dismissed asks, and 'met' rows
  // unless include_met asks; 'stale' and 'superseded' never return.
  const deadlines = rowsOf(items, "deadline").filter(inMatter);
  const withStatus = (status: string) => deadlines.filter((row) => row.status === status);
  const deadlineRows = [
    ...withStatus("active"),
    ...withStatus("not_applicable").filter((row) => args.include_notified === true || row.expiry_notified_at === null || row.expiry_notified_at === undefined),
    ...(args.include_dismissed === true ? withStatus("dismissed") : []),
    ...(args.include_met === true ? withStatus("met") : []),
  ];

  return { anchors: anchorsOut, deadlines: deadlineRows.map((deadline) => ({ ...deadline, ...matterContext(deadline.matter_id) })) };
}

export async function ar_data(store: PracticeStore): Promise<{ rows: Row[] }> {
  const items = store.items();
  const clients = loadClientsById(items);

  // Same rule as wip_hours without an explicit cutoff: only billable entries
  // dated on or after each matter's own effectiveCutoff count toward WIP; a
  // matter with no invoices counts every billable entry (cutoff null).
  const cutoffByMatter = new Map<string, EffectiveCutoff | null>();
  for (const [id, list] of groupBy(rowsOf(items, "invoice"), "matter_id")) cutoffByMatter.set(id, effectiveCutoff(list));

  const wipByMatter = new Map<string, number>();
  for (const entry of rowsOf(items, "time_entry")) {
    if (entry.billable !== true) continue;
    const id = String(entry.matter_id);
    const cutoff = cutoffByMatter.get(id);
    if (cutoff && String(entry.entry_date ?? "") < cutoff.cutoff_date) continue;
    wipByMatter.set(id, (wipByMatter.get(id) ?? 0) + Number(entry.hours ?? 0));
  }

  const pendingByMatter = groupBy(rowsOf(items, "payment").filter((row) => row.cleared === false), "matter_id");

  const rows = rowsOf(items, "matter")
    .filter((matter) => matter.status !== "closed" && isBillable(matter))
    .map((matter) => {
      const cutoff = cutoffByMatter.get(String(matter.id)) ?? null;
      return {
        ...matter,
        ...clientContext(clients.get(String(matter.client_id))),
        wip_hours: wipByMatter.get(String(matter.id)) ?? 0,
        cutoff_date: cutoff?.cutoff_date ?? null,
        cutoff_source: cutoff?.cutoff_source ?? null,
        payments_in_flight: pendingByMatter.get(String(matter.id)) ?? [],
      };
    });
  return { rows };
}

// Coverage status per year (confirmed / unavailable / absent-means-never-checked).
export async function court_calendar_coverage(
  store: PracticeStore,
  args: Record<string, unknown>
): Promise<{ rows: Row[] }> {
  const years = Array.isArray(args.years) ? (args.years as unknown[]).map(Number) : null;
  const rows = store.rows("calendar_year");
  return { rows: years ? rows.filter((row) => years.includes(Number(row.year))) : rows };
}

// Exception-day rows (closures/limited/regional) in a date range.
export async function court_calendar_days(
  store: PracticeStore,
  args: Record<string, unknown>
): Promise<{ rows: Row[] }> {
  const fromDate = args.from_date ? String(args.from_date) : null;
  const toDate = args.to_date ? String(args.to_date) : null;
  const rows = store.rows("calendar_day").filter((row) =>
    (!fromDate || String(row.calendar_date ?? "") >= fromDate) && (!toDate || String(row.calendar_date ?? "") <= toDate));
  return { rows };
}

export async function read_signals(
  store: PracticeStore,
  args: Record<string, unknown>
): Promise<{ matter_id: string; status: unknown; signals: Row[] }> {
  const items: Map<string, Item> = store.items();
  const matter = requireMatter(items, args);
  const signals = rowsOf(items, "signal").filter((row) => row.matter_id === matter.id);
  return { matter_id: matter.id, status: matter.row.status ?? null, signals };
}
