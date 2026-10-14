import type { UnscopedAdmin } from "../../db/scope.js";
import { practiceEntityFor } from "../../practice-registry.js";
import {
  clientContext,
  effectiveCutoff,
  ensureDefaultPolicies,
  isBillable,
  loadClientsById,
  normalizeMattNum,
  requireMatter,
  resolveMatter,
  type EffectiveCutoff,
} from "./shared.js";

const matters = practiceEntityFor("practice_matters");
const timeEntries = practiceEntityFor("practice_time_entries");
const invoices = practiceEntityFor("practice_invoices");
const tasks = practiceEntityFor("practice_tasks");
const retainerNotices = practiceEntityFor("practice_retainer_notices");
const anchors = practiceEntityFor("practice_anchors");
const anchorSources = practiceEntityFor("practice_anchor_sources");
const deadlines = practiceEntityFor("practice_deadlines");
const paymentInFlight = practiceEntityFor("practice_payment_in_flight");
const matterSignals = practiceEntityFor("practice_matter_signals");
const statusPolicies = practiceEntityFor("practice_status_policies");
const courtCalendarCoverage = practiceEntityFor("practice_court_calendar_coverage");
const courtCalendarDays = practiceEntityFor("practice_court_calendar_days");

function withClient(
  matter: Record<string, unknown>,
  clients: Map<string, Record<string, unknown>>
): Record<string, unknown> {
  return { ...matter, ...clientContext(clients.get(String(matter.client_id))) };
}

export async function matter_lookup(
  admin: UnscopedAdmin,
  ownerId: string,
  args: Record<string, unknown>
): Promise<{ rows: Record<string, unknown>[] }> {
  const clients = await loadClientsById(admin, ownerId);
  let matched: Record<string, unknown>[] = [];

  if (args.matter_id) {
    matched = await admin.query(matters, { id: `eq.${String(args.matter_id)}` });
  } else if (args.matt_num) {
    matched = await admin.query(matters, { matt_num: `eq.${normalizeMattNum(args.matt_num)}` });
  } else if (args.file_number) {
    matched = await admin.query(matters, { file_number: `eq.${String(args.file_number)}` });
  } else if (args.client_name) {
    const needle = String(args.client_name).toLowerCase();
    const matchingClientIds = new Set(
      [...clients.values()]
        .filter((client) => typeof client.name === "string" && client.name.toLowerCase().includes(needle))
        .map((client) => String(client.id))
    );
    const rows = await admin.query(matters, {});
    matched = rows.filter((matter) => matchingClientIds.has(String(matter.client_id)));
  }

  return { rows: matched.map((matter) => withClient(matter, clients)) };
}

export async function trust_summary(
  admin: UnscopedAdmin,
  ownerId: string,
  args: Record<string, unknown>
): Promise<{ rows: Record<string, unknown>[] }> {
  const clients = await loadClientsById(admin, ownerId);
  let filters: Record<string, string> = {};
  if (args.matt_num) {
    filters = { matt_num: `eq.${normalizeMattNum(args.matt_num)}` };
  } else if (args.filter === "funded") {
    filters = { regular_trust: "lt.0" };
  } else if (args.filter === "depleted") {
    filters = { regular_trust: "eq.0" };
  }

  const rows = await admin.query(matters, filters);
  return { rows: rows.map((row) => withClient(row, clients)) };
}

export async function wip_hours(
  admin: UnscopedAdmin,
  ownerId: string,
  args: Record<string, unknown>
): Promise<{ rows: Record<string, unknown>[] }> {
  const clients = await loadClientsById(admin, ownerId);
  const matterRows = await admin.query(matters, {});
  const matterById = new Map(matterRows.map((row) => [String(row.id), row]));

  let target: string | null = null;
  if (args.matt_num || args.matter_id) {
    const resolved = await requireMatter(admin, ownerId, args);
    target = resolved.id;
  }

  // An explicit cutoff_date (e.g. bill-client's PDF-derived exact date)
  // overrides uniformly for every matter, exactly as before this Step 2
  // change -- one DB-side filter, one cutoff reported for every row.
  // Omitting it derives each matter's OWN cutoff from its own invoices
  // (Step 2, 2026-08-26): date_to + 1 day when a matter's invoice states it,
  // else that invoice's issue_date (the pre-existing proxy) -- see
  // shared.ts effectiveCutoff. A matter with no invoices at all keeps the
  // prior "sum everything" behavior (cutoff_date: null).
  const explicitCutoff = typeof args.cutoff_date === "string" && args.cutoff_date ? args.cutoff_date : null;

  // Non-billable entries are never work in progress, whatever their matter says.
  const entryFilters: Record<string, string> = { billable: "eq.true" };
  if (target) entryFilters.matter_id = `eq.${target}`;
  if (explicitCutoff) entryFilters.entry_date = `gte.${explicitCutoff}`;

  const entries = await admin.query(timeEntries, entryFilters);
  const entriesByMatter = new Map<string, Record<string, unknown>[]>();
  for (const entry of entries) {
    const matterId = String(entry.matter_id);
    const list = entriesByMatter.get(matterId) ?? [];
    list.push(entry);
    entriesByMatter.set(matterId, list);
  }

  const rows: Record<string, unknown>[] = [];
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
      const invoiceRows = await admin.query(invoices, { matter_id: `eq.${matterId}` });
      const derived: EffectiveCutoff | null = effectiveCutoff(invoiceRows);
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
  admin: UnscopedAdmin,
  ownerId: string,
  args: Record<string, unknown>
): Promise<{ rows: Record<string, unknown>[] }> {
  const clients = await loadClientsById(admin, ownerId);
  const matterRows = await admin.query(matters, {});
  const matterById = new Map(matterRows.map((row) => [String(row.id), row]));

  const filters: Record<string, string> = {};
  if (args.matt_num || args.matter_id || args.file_number) {
    const resolved = await requireMatter(admin, ownerId, args);
    filters.matter_id = `eq.${resolved.id}`;
  }
  // from_date filters at the DB; to_date is applied after fetch to avoid a
  // two-sided filter on one column.
  if (args.from_date) filters.entry_date = `gte.${String(args.from_date)}`;

  const entryRows = await admin.query(timeEntries, filters);
  const toDate = args.to_date ? String(args.to_date) : null;

  const rows = entryRows
    .filter((entry) => !toDate || String(entry.entry_date ?? "") <= toDate)
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
  admin: UnscopedAdmin,
  ownerId: string,
  args: Record<string, unknown>
): Promise<{ rows: Record<string, unknown>[] }> {
  const clients = await loadClientsById(admin, ownerId);
  const matterRows = await admin.query(matters, {});
  const matterById = new Map(matterRows.map((row) => [String(row.id), row]));

  const filters: Record<string, string> = { status: "eq.open" };
  if (args.task_type) filters.task_type = `eq.${String(args.task_type)}`;
  if (args.matt_num || args.matter_id) filters.matter_id = `eq.${(await requireMatter(admin, ownerId, args)).id}`;
  const taskRows = await admin.query(tasks, filters, { limit: 1000 });

  // Latest retainer notice per matter.
  const notices = await admin.query(retainerNotices, {}, { limit: 1000 });
  const latestNotice = new Map<string, string>();
  for (const notice of notices) {
    const matterId = String(notice.matter_id);
    const sentAt = String(notice.sent_at ?? "");
    if (!latestNotice.has(matterId) || sentAt > (latestNotice.get(matterId) ?? "")) {
      latestNotice.set(matterId, sentAt);
    }
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
  admin: UnscopedAdmin,
  ownerId: string,
  args: Record<string, unknown>
): Promise<{ anchors: Record<string, unknown>[]; deadlines: Record<string, unknown>[] }> {
  let matterFilter: Record<string, string> = {};
  if (args.matt_num || args.matter_id) {
    const resolved = await requireMatter(admin, ownerId, args);
    matterFilter = { matter_id: `eq.${resolved.id}` };
  }

  // Matter identity rides on every row so an all-matters sweep is resolvable
  // without string-guessing party names out of source_document (#230 4.6) --
  // same join open_tasks carries.
  const clients = await loadClientsById(admin, ownerId);
  const matterRows = await admin.query(matters, {});
  const matterById = new Map(matterRows.map((row) => [String(row.id), row]));
  const matterContext = (matterId: unknown): Record<string, unknown> => {
    const matter = matterById.get(String(matterId));
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
  const anchorRows = await admin.query(
    anchors,
    { status: "neq.superseded", ...matterFilter },
    { limit: 1000 }
  );
  const sourceRows = await admin.query(anchorSources, {}, { limit: 1000 });
  const sourcesByAnchor = new Map<string, Record<string, unknown>[]>();
  for (const source of sourceRows) {
    const anchorId = String(source.anchor_id);
    const list = sourcesByAnchor.get(anchorId) ?? [];
    list.push(source);
    sourcesByAnchor.set(anchorId, list);
  }

  const includeOccurred = args.include_occurred === true;
  const anchorsOut = anchorRows
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
  // unless include_met asks; 'stale' and 'superseded' never return (unchanged
  // prior behavior, no toggle).
  const includeDismissed = args.include_dismissed === true;
  const includeNotified = args.include_notified === true;
  const includeMet = args.include_met === true;

  const activeDeadlineRows = await admin.query(
    deadlines,
    { status: "eq.active", ...matterFilter },
    { limit: 1000 }
  );
  const notApplicableFilters: Record<string, string> = { status: "eq.not_applicable", ...matterFilter };
  if (!includeNotified) notApplicableFilters.expiry_notified_at = "is.null";
  const notApplicableRows = await admin.query(deadlines, notApplicableFilters, { limit: 1000 });
  const dismissedRows = includeDismissed
    ? await admin.query(deadlines, { status: "eq.dismissed", ...matterFilter }, { limit: 1000 })
    : [];
  const metRows = includeMet ? await admin.query(deadlines, { status: "eq.met", ...matterFilter }, { limit: 1000 }) : [];

  const deadlineRows = [...activeDeadlineRows, ...notApplicableRows, ...dismissedRows, ...metRows];
  const deadlinesOut = deadlineRows.map((deadline) => {
    return { ...deadline, ...matterContext(deadline.matter_id) };
  });

  return { anchors: anchorsOut, deadlines: deadlinesOut };
}

export async function ar_data(
  admin: UnscopedAdmin,
  ownerId: string
): Promise<{ rows: Record<string, unknown>[] }> {
  const clients = await loadClientsById(admin, ownerId);
  const matterRows = await admin.query(matters, {});

  // Same rule as wip_hours without an explicit cutoff: only billable entries
  // dated on or after each matter's own effectiveCutoff count toward WIP; a
  // matter with no invoices counts every billable entry (cutoff null).
  const invoiceRows = await admin.query(invoices, {});
  const invoicesByMatter = new Map<string, Record<string, unknown>[]>();
  for (const invoice of invoiceRows) {
    const matterId = String(invoice.matter_id);
    const list = invoicesByMatter.get(matterId) ?? [];
    list.push(invoice);
    invoicesByMatter.set(matterId, list);
  }
  const cutoffByMatter = new Map<string, EffectiveCutoff | null>();
  for (const [matterId, list] of invoicesByMatter) cutoffByMatter.set(matterId, effectiveCutoff(list));

  const entries = await admin.query(timeEntries, { billable: "eq.true" });
  const wipByMatter = new Map<string, number>();
  for (const entry of entries) {
    const matterId = String(entry.matter_id);
    const cutoff = cutoffByMatter.get(matterId);
    if (cutoff && String(entry.entry_date ?? "") < cutoff.cutoff_date) continue;
    wipByMatter.set(matterId, (wipByMatter.get(matterId) ?? 0) + Number(entry.hours ?? 0));
  }

  const pending = await admin.query(paymentInFlight, { cleared: "eq.false" });
  const pendingByMatter = new Map<string, Record<string, unknown>[]>();
  for (const row of pending) {
    const matterId = String(row.matter_id);
    const list = pendingByMatter.get(matterId) ?? [];
    list.push(row);
    pendingByMatter.set(matterId, list);
  }

  const rows = matterRows
    .filter((matter) => (matter.status === null || matter.status === undefined || matter.status !== "closed") && isBillable(matter))
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
  admin: UnscopedAdmin,
  ownerId: string,
  args: Record<string, unknown>
): Promise<{ rows: Record<string, unknown>[] }> {
  const years = Array.isArray(args.years) ? (args.years as unknown[]).map(Number) : null;
  const rows = await admin.query(courtCalendarCoverage, {}, { limit: 1000 });
  return { rows: years ? rows.filter((row) => years.includes(Number(row.year))) : rows };
}

// Exception-day rows (closures/limited/regional) in a date range. from_date
// filters at the DB; to_date is applied after fetch (see time_entries_query).
export async function court_calendar_days(
  admin: UnscopedAdmin,
  ownerId: string,
  args: Record<string, unknown>
): Promise<{ rows: Record<string, unknown>[] }> {
  const filters: Record<string, string> = {};
  if (args.from_date) filters.calendar_date = `gte.${String(args.from_date)}`;
  const rows = await admin.query(courtCalendarDays, filters, { limit: 1000 });
  const toDate = args.to_date ? String(args.to_date) : null;
  return { rows: toDate ? rows.filter((row) => String(row.calendar_date ?? "") <= toDate) : rows };
}

export async function read_signals(
  admin: UnscopedAdmin,
  ownerId: string,
  args: Record<string, unknown>
): Promise<{ matter_id: string; status: unknown; signals: Record<string, unknown>[]; policies: Record<string, unknown>[] }> {
  await ensureDefaultPolicies(admin, ownerId);
  const matter = await requireMatter(admin, ownerId, args);

  const signals = await admin.query(matterSignals, { matter_id: `eq.${matter.id}` }, { limit: 1000 });
  const policyRows = await admin.query(statusPolicies, {}, { limit: 1000 });

  return {
    matter_id: matter.id,
    status: matter.row.status ?? null,
    signals,
    policies: policyRows,
  };
}
