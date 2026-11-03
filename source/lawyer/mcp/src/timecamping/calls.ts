// timecamping_data__calls: the phone calls in a date range, matched to contacts on the digits of
// their numbers. Matching needs code on both sides, practice.db's contacts and the timecamping
// call rows, so this one module is the stated exception to backend.ts's rule that the server
// holds no table or column name: it names telus_calls and source_fetch_log. A second carrier adds
// its own table here. /timecamping-data stays the gatekeeper.

import { ValidationError } from "../errors.js";
import { rowsOf, type Row } from "../practice/items.js";
import type { PracticeStore } from "../practice/store.js";
import { phoneDigits } from "../tools/practice/contacts.js";
import { addDaysIso, requireMatter, resolveMatter } from "../tools/practice/shared.js";
import { timecampingDataQuery } from "./backend.js";

const DATE = /^\d{4}-\d{2}-\d{2}$/;
// Shorter than this is an internal extension, never a match on a contact's number.
const MIN_MATCH_DIGITS = 7;

// The native id is c{local date}T{local HH:MM}{number}, so the local time needs no timezone here.
const CALLS_SQL = `
  SELECT local_date AS date, substr(native_id, 13, 5) AS time,
         json_extract(raw_payload, '$.direction') AS direction,
         duration_seconds, action_result, phone_number AS number, contact_name
    FROM telus_calls
   WHERE local_date BETWEEN ? AND ?
   ORDER BY local_date, time, id`;

const COVERED_SQL = `
  SELECT local_date FROM source_fetch_log
   WHERE source_name = 'telus_calls' AND status IN ('fetched', 'empty') AND local_date BETWEEN ? AND ?`;

export interface CallsArgs {
  from: string;
  to: string;
  matter?: string;
  numbers?: string[];
}

interface CallContact {
  contact_id: unknown;
  name: unknown;
  role: unknown;
  matt_num: unknown;
}

function phonesOf(contact: Row): string[] {
  return Array.isArray(contact.phones) ? contact.phones.filter((phone): phone is string => typeof phone === "string") : [];
}

export async function timecampingCalls(
  args: CallsArgs,
  store: PracticeStore,
  env: NodeJS.ProcessEnv = process.env
): Promise<Record<string, unknown>> {
  if (!DATE.test(args.from) || !DATE.test(args.to) || args.from > args.to) {
    throw new ValidationError("from and to must be YYYY-MM-DD dates, from no later than to");
  }
  const items = store.items();
  const matterId = args.matter === undefined ? null : (
    resolveMatter(items, { matt_num: args.matter }) ??
    resolveMatter(items, { file_number: args.matter }) ??
    requireMatter(items, { matter_id: args.matter })
  ).id;

  const matters = new Map(rowsOf(items, "matter").map((row) => [String(row.id), row]));
  const roles = rowsOf(items, "matter_role").filter((row) => matterId === null || row.matter_id === matterId);
  const directory = new Map<string, CallContact[]>();
  const contactsWithoutPhone: Record<string, unknown>[] = [];
  for (const contact of rowsOf(items, "contact")) {
    const held = roles.filter((row) => row.contact_id === contact.id);
    if (matterId !== null && held.length === 0) continue;
    const entries: CallContact[] = (held.length ? held : [null]).map((row) => ({
      contact_id: contact.id,
      name: contact.name,
      role: row?.role ?? null,
      matt_num: row ? matters.get(String(row.matter_id))?.matt_num ?? null : null,
    }));
    const digits = phonesOf(contact).map(phoneDigits).filter((value) => value.length >= MIN_MATCH_DIGITS);
    if (digits.length === 0 && matterId !== null) {
      contactsWithoutPhone.push(...entries.map(({ contact_id, name, role }) => ({ contact_id, name, role })));
    }
    for (const value of new Set(digits)) directory.set(value, [...(directory.get(value) ?? []), ...entries]);
  }

  const given = new Set((args.numbers ?? []).map(phoneDigits).filter((value) => value.length >= MIN_MATCH_DIGITS));
  const wanted = matterId !== null
    ? (value: string) => directory.has(value) || given.has(value)
    : (value: string) => given.size === 0 || given.has(value);

  const range = [args.from, args.to];
  const calls = timecampingDataQuery(CALLS_SQL, range, env).rows
    .filter((call) => wanted(phoneDigits(String(call.number))))
    .map((call) => ({ ...call, contacts: directory.get(phoneDigits(String(call.number))) ?? [] }));

  const covered = new Set(timecampingDataQuery(COVERED_SQL, range, env).rows.map((row) => row.local_date));
  const uncoveredDates: string[] = [];
  for (let day = args.from; day <= args.to; day = addDaysIso(day, 1)) {
    if (!covered.has(day)) uncoveredDates.push(day);
  }

  return {
    calls,
    contacts_without_phone: contactsWithoutPhone,
    numbers_searched: matterId !== null ? [...new Set([...directory.keys(), ...given])] : [...given],
    uncovered_dates: uncoveredDates,
  };
}
