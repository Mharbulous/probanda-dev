import type { UnscopedAdmin } from "../../db/scope.js";
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

// Routes a `practice_data__*` tool to its implementation. Bootstrap-mode only;
// runs on UnscopedAdmin with owner RLS scoping (P-D2). Args are already validated
// by dispatch.ts against the tool's inputSchema.
export function callPracticeTool(
  admin: UnscopedAdmin,
  ownerId: string,
  name: string,
  args: Record<string, unknown>
): Promise<unknown> {
  switch (name) {
    case "practice_data__matter_lookup":
      return matter_lookup(admin, ownerId, args);
    case "practice_data__trust_summary":
      return trust_summary(admin, ownerId, args);
    case "practice_data__wip_hours":
      return wip_hours(admin, ownerId, args);
    case "practice_data__open_tasks":
      return open_tasks(admin, ownerId, args);
    case "practice_data__active_deadlines":
      return active_deadlines(admin, ownerId, args);
    case "practice_data__ar_data":
      return ar_data(admin, ownerId);
    case "practice_data__read_signals":
      return read_signals(admin, ownerId, args);
    case "practice_data__time_entries_query":
      return time_entries_query(admin, ownerId, args);
    case "practice_data__upsert_client_matter":
      return upsert_client_matter(admin, ownerId, args);
    case "practice_data__insert_time_entry":
      return insert_time_entry(admin, ownerId, args);
    case "practice_data__set_time_entries_billable":
      return set_time_entries_billable(admin, ownerId, args);
    case "practice_data__upsert_task":
      return upsert_task(admin, ownerId, args);
    case "practice_data__firm_profile":
      return firm_profile();
    case "practice_data__upsert_firm_profile":
      return upsert_firm_profile(args);
    case "practice_data__config_status":
      return config_status(args);
    case "practice_data__config_set_root":
      return config_set_root(args);
    case "practice_data__complete_task":
      return complete_task(admin, ownerId, args);
    case "practice_data__record_retainer_notice":
      return record_retainer_notice(admin, ownerId, args);
    case "practice_data__upsert_anchor":
      return upsert_anchor(admin, ownerId, args);
    case "practice_data__delete_anchor":
      return delete_anchor(admin, ownerId, args);
    case "practice_data__upsert_deadline":
      return upsert_deadline(admin, ownerId, args);
    case "practice_data__manage_payment_in_flight":
      return manage_payment_in_flight(admin, ownerId, args);
    case "practice_data__upsert_signal":
      return upsert_signal(admin, ownerId, args);
    case "practice_data__set_status":
      return set_status(admin, ownerId, args);
    case "practice_data__ingest_court_calendar_year":
      return ingest_court_calendar_year(admin, ownerId, args);
    case "practice_data__court_calendar_coverage":
      return court_calendar_coverage(admin, ownerId, args);
    case "practice_data__court_calendar_days":
      return court_calendar_days(admin, ownerId, args);
    case "practice_data__import_invoices":
      return import_invoices(admin, ownerId, args);
    case "practice_data__invoices_query":
      return invoices_query(admin, ownerId, args);
    case "practice_data__upsert_rule_overlay":
      return upsert_rule_overlay(admin, ownerId, args);
    case "practice_data__rule_overlay":
      return rule_overlay(admin, ownerId, args);
    default:
      throw new ValidationError(`Unknown practice tool "${name}"`);
  }
}
