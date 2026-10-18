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
import { firm_profile, upsert_firm_profile } from "./firm-profile.js";
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

// The tools that touch files, not practice.db.
const FILE_TOOLS = new Set([
  "practice_data__firm_profile",
  "practice_data__upsert_firm_profile",
  "practice_data__config_status",
  "practice_data__config_set_root",
]);

// The tools that only read practice.db.
const READ_TOOLS = new Set([
  "practice_data__matter_lookup",
  "practice_data__trust_summary",
  "practice_data__wip_hours",
  "practice_data__open_tasks",
  "practice_data__active_deadlines",
  "practice_data__ar_data",
  "practice_data__read_signals",
  "practice_data__time_entries_query",
  "practice_data__court_calendar_coverage",
  "practice_data__court_calendar_days",
  "practice_data__invoices_query",
  "practice_data__rule_overlay",
  "practice_data__render_practice_board",
  "practice_data__contact_lookup",
  "practice_data__contact_checks",
]);

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
  if (FILE_TOOLS.has(name)) return route(store, name, args);
  let replayed: Awaited<ReturnType<PracticeStore["replayPending"]>> = [];
  if (store.pendingCount() > 0) {
    try {
      replayed = await store.replayPending();
    } catch (err) {
      if (!READ_TOOLS.has(name)) throw err;
    }
  }
  const result = await route(store, name, args);
  if (replayed.length && result !== null && typeof result === "object" && !Array.isArray(result)) {
    return { ...result, replayed_writes: replayed };
  }
  return result;
}

function route(store: PracticeStore, name: string, args: Record<string, unknown>): Promise<unknown> {
  switch (name) {
    case "practice_data__matter_lookup":
      return matter_lookup(store, args);
    case "practice_data__trust_summary":
      return trust_summary(store, args);
    case "practice_data__wip_hours":
      return wip_hours(store, args);
    case "practice_data__open_tasks":
      return open_tasks(store, args);
    case "practice_data__active_deadlines":
      return active_deadlines(store, args);
    case "practice_data__ar_data":
      return ar_data(store);
    case "practice_data__read_signals":
      return read_signals(store, args);
    case "practice_data__time_entries_query":
      return time_entries_query(store, args);
    case "practice_data__upsert_client_matter":
      return upsert_client_matter(store, args);
    case "practice_data__insert_time_entry":
      return insert_time_entry(store, args);
    case "practice_data__set_time_entries_billable":
      return set_time_entries_billable(store, args);
    case "practice_data__upsert_task":
      return upsert_task(store, args);
    case "practice_data__firm_profile":
      return firm_profile();
    case "practice_data__upsert_firm_profile":
      return upsert_firm_profile(args);
    case "practice_data__config_status":
      return config_status(args, store.env);
    case "practice_data__config_set_root":
      return config_set_root(args);
    case "practice_data__complete_task":
      return complete_task(store, args);
    case "practice_data__record_retainer_notice":
      return record_retainer_notice(store, args);
    case "practice_data__upsert_anchor":
      return upsert_anchor(store, args);
    case "practice_data__delete_anchor":
      return delete_anchor(store, args);
    case "practice_data__upsert_deadline":
      return upsert_deadline(store, args);
    case "practice_data__manage_payment_in_flight":
      return manage_payment_in_flight(store, args);
    case "practice_data__upsert_signal":
      return upsert_signal(store, args);
    case "practice_data__set_status":
      return set_status(store, args);
    case "practice_data__ingest_court_calendar_year":
      return ingest_court_calendar_year(store, args);
    case "practice_data__court_calendar_coverage":
      return court_calendar_coverage(store, args);
    case "practice_data__court_calendar_days":
      return court_calendar_days(store, args);
    case "practice_data__import_invoices":
      return import_invoices(store, args);
    case "practice_data__invoices_query":
      return invoices_query(store, args);
    case "practice_data__upsert_rule_overlay":
      return upsert_rule_overlay(store, args);
    case "practice_data__rule_overlay":
      return rule_overlay(store, args);
    case "practice_data__render_practice_board":
      return render_practice_board(store);
    case "practice_data__upsert_contact":
      return upsert_contact(store, args);
    case "practice_data__upsert_affiliation":
      return upsert_affiliation(store, args);
    case "practice_data__upsert_matter_role":
      return upsert_matter_role(store, args);
    case "practice_data__contact_lookup":
      return contact_lookup(store, args);
    case "practice_data__contact_checks":
      return contact_checks(store, args);
    case "practice_data__merge_contact":
      return merge_contact(store, args);
    default:
      throw new ValidationError(`Unknown practice tool "${name}"`);
  }
}
