import { ValidationError } from "../../errors.js";
import {
  active_deadlines,
  ar_data,
  court_calendar_coverage,
  court_calendar_days,
  matter_lookup,
  open_tasks,
  read_signals,
  time_entries_query,
  trust_summary,
  wip_hours,
} from "./reads.js";
import {
  complete_task,
  delete_anchor,
  ingest_court_calendar_year,
  insert_time_entry,
  link_matter,
  manage_payment_in_flight,
  record_retainer_notice,
  set_status,
  set_time_entries_billable,
  upsert_anchor,
  upsert_client_matter,
  upsert_deadline,
  upsert_signal,
  upsert_task,
} from "./writes.js";
import { import_invoices, invoices_query } from "./invoices.js";
import {
  invoice_lines_query,
  issue_invoice,
  rates_query,
  record_adjustment,
  record_invoice_sent,
  upsert_rate,
  upsert_time_entries,
} from "./billing.js";
import { firm_profile, upsert_firm_profile } from "./firm-profile.js";
import { folder_map, set_folder_map } from "./folder-map.js";
import { config_set_root, config_status } from "./config.js";
import { rule_overlay, upsert_rule_overlay } from "./rule-overlay.js";
import { render_practice_board } from "./practice-board.js";
import {
  contact_checks,
  contact_lookup,
  merge_contact,
  upsert_affiliation,
  upsert_contact,
  upsert_matter_role,
} from "./contacts.js";
import type { PracticeStore } from "../../practice/store.js";
import { practiceToolDefinitions } from "../../schema/practice.js";
import { defineTool, pairTools, type PairedTool } from "../../tool-list.js";
import type { ToolInput } from "../../validate.js";

type PracticeFlags = {
  /** Touches files, not practice.db, so it never replays a pending write. */
  file?: true;
  /** Only reads practice.db, so a replay that cannot reach the cloud leaves it answering. */
  read?: true;
};

const practiceTool = defineTool<ToolInput, PracticeStore, PracticeFlags>;

export const practiceTools = [
  practiceTool("practice_data__matter_lookup", (args, store) => matter_lookup(store, args), { read: true }),
  practiceTool("practice_data__trust_summary", (args, store) => trust_summary(store, args), { read: true }),
  practiceTool("practice_data__wip_hours", (args, store) => wip_hours(store, args), { read: true }),
  practiceTool("practice_data__open_tasks", (args, store) => open_tasks(store, args), { read: true }),
  practiceTool("practice_data__active_deadlines", (args, store) => active_deadlines(store, args), { read: true }),
  practiceTool("practice_data__ar_data", (_args, store) => ar_data(store), { read: true }),
  practiceTool("practice_data__read_signals", (args, store) => read_signals(store, args), { read: true }),
  practiceTool("practice_data__time_entries_query", (args, store) => time_entries_query(store, args), { read: true }),
  practiceTool("practice_data__upsert_client_matter", (args, store) => upsert_client_matter(store, args)),
  practiceTool("practice_data__link_matter", (args, store) => link_matter(store, args)),
  practiceTool("practice_data__insert_time_entry", (args, store) => insert_time_entry(store, args)),
  practiceTool("practice_data__set_time_entries_billable", (args, store) => set_time_entries_billable(store, args)),
  practiceTool("practice_data__upsert_task", (args, store) => upsert_task(store, args)),
  practiceTool("practice_data__firm_profile", () => firm_profile(), { file: true }),
  practiceTool("practice_data__upsert_firm_profile", (args) => upsert_firm_profile(args), { file: true }),
  practiceTool("practice_data__folder_map", (args, store) => folder_map(args, store.env), { file: true }),
  practiceTool("practice_data__set_folder_map", (args, store) => set_folder_map(args, store.env), { file: true }),
  practiceTool("practice_data__config_status", (args, store) => config_status(args, store.env), { file: true }),
  practiceTool("practice_data__config_set_root", (args) => config_set_root(args), { file: true }),
  practiceTool("practice_data__complete_task", (args, store) => complete_task(store, args)),
  practiceTool("practice_data__record_retainer_notice", (args, store) => record_retainer_notice(store, args)),
  practiceTool("practice_data__upsert_anchor", (args, store) => upsert_anchor(store, args)),
  practiceTool("practice_data__delete_anchor", (args, store) => delete_anchor(store, args)),
  practiceTool("practice_data__upsert_deadline", (args, store) => upsert_deadline(store, args)),
  practiceTool("practice_data__manage_payment_in_flight", (args, store) => manage_payment_in_flight(store, args)),
  practiceTool("practice_data__upsert_signal", (args, store) => upsert_signal(store, args)),
  practiceTool("practice_data__set_status", (args, store) => set_status(store, args)),
  practiceTool("practice_data__ingest_court_calendar_year", (args, store) => ingest_court_calendar_year(store, args)),
  practiceTool("practice_data__court_calendar_coverage", (args, store) => court_calendar_coverage(store, args), { read: true }),
  practiceTool("practice_data__court_calendar_days", (args, store) => court_calendar_days(store, args), { read: true }),
  practiceTool("practice_data__import_invoices", (args, store) => import_invoices(store, args)),
  practiceTool("practice_data__invoices_query", (args, store) => invoices_query(store, args), { read: true }),
  practiceTool("practice_data__upsert_time_entries", (args, store) => upsert_time_entries(store, args)),
  practiceTool("practice_data__upsert_rate", (args, store) => upsert_rate(store, args)),
  practiceTool("practice_data__rates_query", (args, store) => rates_query(store, args), { read: true }),
  practiceTool("practice_data__record_adjustment", (args, store) => record_adjustment(store, args)),
  practiceTool("practice_data__issue_invoice", (args, store) => issue_invoice(store, args)),
  practiceTool("practice_data__record_invoice_sent", (args, store) => record_invoice_sent(store, args)),
  practiceTool("practice_data__invoice_lines_query", (args, store) => invoice_lines_query(store, args), { read: true }),
  practiceTool("practice_data__upsert_rule_overlay", (args, store) => upsert_rule_overlay(store, args)),
  practiceTool("practice_data__rule_overlay", (args, store) => rule_overlay(store, args), { read: true }),
  practiceTool("practice_data__render_practice_board", (_args, store) => render_practice_board(store), { read: true }),
  practiceTool("practice_data__upsert_contact", (args, store) => upsert_contact(store, args)),
  practiceTool("practice_data__upsert_affiliation", (args, store) => upsert_affiliation(store, args)),
  practiceTool("practice_data__upsert_matter_role", (args, store) => upsert_matter_role(store, args)),
  practiceTool("practice_data__contact_lookup", (args, store) => contact_lookup(store, args), { read: true }),
  practiceTool("practice_data__contact_checks", (args, store) => contact_checks(store, args), { read: true }),
  practiceTool("practice_data__merge_contact", (args, store) => merge_contact(store, args)),
];

let table: Map<string, PairedTool<PracticeStore, PracticeFlags>> | undefined;

function practiceEntry(name: string): PairedTool<PracticeStore, PracticeFlags> {
  table ??= pairTools(practiceToolDefinitions(), practiceTools);
  const entry = table.get(name);
  if (!entry) throw new ValidationError(`Unknown practice tool "${name}"`);
  return entry;
}

// Routes a `practice_data__*` tool to its implementation. Args are already validated by
// dispatch.ts against the tool's inputSchema. Every tool that touches practice.db first
// replays any write the cloud saved but practice.db has not applied
// (docs/Plans/2026-10-14_practice-db-conversion.md, "One write, step by step"), and its
// result names the writes it replayed. A read whose replay cannot reach the cloud still
// answers from practice.db as it stands, the writes left pending.
export async function callPracticeTool(
  store: PracticeStore,
  name: string,
  args: Record<string, unknown>
): Promise<unknown> {
  const { handler, flags } = practiceEntry(name);
  if (flags?.file) return handler(args, store);
  let replayed: Awaited<ReturnType<PracticeStore["replayPending"]>> = [];
  if (store.pendingCount() > 0) {
    try {
      replayed = await store.replayPending();
    } catch (err) {
      if (!flags?.read) throw err;
    }
  }
  let result: unknown;
  try {
    result = await handler(args, store);
  } catch (err) {
    // A refused replay's write is gone, so its question must reach the caller with this error.
    const refused = replayed.filter((r) => !r.saved);
    if (refused.length && err instanceof Error) {
      err.message += refused.map((r) => ` Before this call, Probanda's Cloud refused pending write ${r.write_id} (${r.tool}): ${r.question}`).join("");
    }
    throw err;
  }
  if (replayed.length && result !== null && typeof result === "object" && !Array.isArray(result)) {
    return { ...result, replayed_writes: replayed };
  }
  return result;
}
