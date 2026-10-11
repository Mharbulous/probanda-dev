// Firm rule overlay (deadline-rule-overlay spec §6). A court-rule change is stored as one
// record per deadline-type row per effective period, and every deadline calculation
// resolves the shipped rule files against these records. The overlay is firm-wide and
// matter-free: its table has no matter column, a record carrying a field its shape lacks
// (a `matter` field included) is refused, and so is any string matching the client
// matter-code pattern. Phase 2 (legal-commons sharing) reuses the record unchanged.

import { randomUUID } from "node:crypto";

import { UnscopedAdmin, exactlyOne } from "../../db/scope.js";
import { ValidationError } from "../../errors.js";
import { practiceEntityFor } from "../../practice-registry.js";

const overlay = practiceEntityFor("practice_rule_overlay");

// The client matter-code pattern direct_mode.py scans for (MATTER_CODE).
const MATTER_CODE = /\bL\d{3,4}\b/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SNAKE_CASE = /^[a-z][a-z0-9]*(_[a-z0-9]+)*$/;
const SHIPPED_ROW = /^shipped:[a-z][a-z0-9]*(_[a-z0-9]+)*$/;
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

export const RULE_OVERLAY_STATUSES = ["verified", "unverified", "superseded_by_shipped", "conflict"];
export const OFFSET_UNITS = ["days", "business_days", "months", "years"];
export const OFFSET_DIRECTIONS = ["before", "after"];
// The counting methods the rule files already define.
export const COUNTING_METHODS = [
  "calendar",
  "forward_n_business_days",
  "backward_n_business_days",
  "backward_full_business_days",
];
export const SEMANTICS = ["mandatory", "earliest_permissible", "latest_permissible", "permissive"];
export const SOURCE_KINDS = ["oic_pdf", "consolidation", "regulation"];

// Every field of the record and its nested objects, in stored order. Only record_id and
// pool_id may be omitted; any other field the rules let be null is still sent, as null.
// pool_id names the shared-pool row a pulled record came from.
const RECORD_FIELDS = [
  "record_id", "jurisdiction", "enactment", "amending_instrument", "deadline_type", "anchor_type",
  "base", "rule_ref", "offset", "counting", "semantics", "description", "verbatim", "source",
  "effective_from", "effective_to", "supersedes", "open_questions", "status", "verified_by", "verified_at", "pool_id",
];
const NESTED_FIELDS: Record<string, string[]> = {
  enactment: ["name", "citation", "civix_id"],
  amending_instrument: ["reg", "oic", "commencement"],
  offset: ["value", "unit", "direction", "clear"],
  source: ["url", "fetched_at", "kind"],
};

type Fields = Record<string, unknown>;

function isPlainObject(value: unknown): value is Fields {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// Refuses a non-object, an unknown field and a missing one. Returns the fields in the
// order `fields` lists them, so every stored record has one key order.
function shape(value: unknown, label: string, fields: string[], optional: string[] = []): Fields {
  if (!isPlainObject(value)) throw new ValidationError(`${label} must be an object`);
  const unknown = Object.keys(value).filter((key) => !fields.includes(key));
  if (unknown.length > 0) {
    throw new ValidationError(`${label} has unknown field(s) ${unknown.join(", ")} (allowed: ${fields.join(", ")})`);
  }
  const missing = fields.filter((key) => value[key] === undefined && !optional.includes(key));
  if (missing.length > 0) {
    throw new ValidationError(`${label} is missing ${missing.join(", ")} (a field that may be null is still sent, as null)`);
  }
  return Object.fromEntries(fields.filter((key) => value[key] !== undefined).map((key) => [key, value[key]]));
}

// Every string anywhere in the record. The refusal names the field, never the code.
function refuseMatterCodes(value: unknown, label: string): void {
  if (typeof value === "string") {
    if (MATTER_CODE.test(value)) {
      throw new ValidationError(
        `${label} carries a client matter code. A rule overlay record is firm-wide and never carries matter content ` +
        "(no matter code, party name, file name or fact)."
      );
    }
  } else if (Array.isArray(value)) {
    value.forEach((item, index) => refuseMatterCodes(item, `${label}[${index}]`));
  } else if (isPlainObject(value)) {
    for (const [key, item] of Object.entries(value)) refuseMatterCodes(item, `${label}.${key}`);
  }
}

function text(value: unknown, label: string): void {
  if (typeof value !== "string" || value.trim() === "") throw new ValidationError(`${label} must be a non-empty string`);
}

function oneOf(value: unknown, label: string, allowed: string[]): void {
  if (typeof value !== "string" || !allowed.includes(value)) {
    throw new ValidationError(`${label} must be one of: ${allowed.join(", ")}`);
  }
}

function snakeCase(value: unknown, label: string): void {
  if (typeof value !== "string" || !SNAKE_CASE.test(value)) {
    throw new ValidationError(`${label} must be snake_case, e.g. notice_of_hearing_service`);
  }
}

function isoDate(value: unknown, label: string): void {
  const parts = typeof value === "string" ? ISO_DATE.exec(value) : null;
  const [year, month, day] = parts ? parts.slice(1).map(Number) : [];
  const date = new Date(Date.UTC(year, month - 1, day));
  if (!parts || date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    throw new ValidationError(`${label} must be an ISO date (YYYY-MM-DD)`);
  }
}

function strings(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new ValidationError(`${label} must be an array of strings`);
  }
  return value as string[];
}

function isHttpUrl(value: unknown): boolean {
  try {
    return typeof value === "string" && ["http:", "https:"].includes(new URL(value).protocol);
  } catch {
    return false;
  }
}

// The §6 field rules. Returns the record as it is stored: record_id assigned when omitted
// (or null), fields in one key order. Throws a ValidationError naming the field.
export function validateRuleOverlayRecord(input: unknown): Fields {
  const record = shape(input, "record", RECORD_FIELDS, ["record_id", "pool_id"]);
  for (const key of ["enactment", "amending_instrument", "source"]) {
    record[key] = shape(record[key], `record.${key}`, NESTED_FIELDS[key]);
  }
  if (record.offset !== null) record.offset = shape(record.offset, "record.offset", NESTED_FIELDS.offset);
  refuseMatterCodes(record, "record");

  const given = record.record_id;
  if (given !== undefined && given !== null && (typeof given !== "string" || !UUID.test(given))) {
    throw new ValidationError("record.record_id must be a UUID, or omitted on a first write");
  }
  const recordId = typeof given === "string" ? given : randomUUID();

  if (record.jurisdiction !== "CA-BC") throw new ValidationError('record.jurisdiction must be "CA-BC"');
  const enactment = record.enactment as Fields;
  for (const key of NESTED_FIELDS.enactment) text(enactment[key], `record.enactment.${key}`);
  const instrument = record.amending_instrument as Fields;
  text(instrument.reg, "record.amending_instrument.reg");
  if (instrument.oic !== null && typeof instrument.oic !== "string") {
    throw new ValidationError("record.amending_instrument.oic must be a string or null");
  }
  isoDate(instrument.commencement, "record.amending_instrument.commencement");
  snakeCase(record.deadline_type, "record.deadline_type");
  snakeCase(record.anchor_type, "record.anchor_type");
  text(record.rule_ref, "record.rule_ref");

  if (record.offset === null) {
    for (const key of ["counting", "semantics", "base"]) {
      if (record[key] !== null) throw new ValidationError(`record.${key} must be null in a repeal record (offset null)`);
    }
  } else {
    const offset = record.offset as Fields;
    if (!Number.isInteger(offset.value) || (offset.value as number) < 0) {
      throw new ValidationError("record.offset.value must be a non-negative integer");
    }
    oneOf(offset.unit, "record.offset.unit", OFFSET_UNITS);
    oneOf(offset.direction, "record.offset.direction", OFFSET_DIRECTIONS);
    if (typeof offset.clear !== "boolean") throw new ValidationError("record.offset.clear must be a boolean");
    for (const key of ["counting", "semantics", "base"]) {
      if (record[key] === null) {
        throw new ValidationError(`record.${key} is required unless the record is a repeal record (offset null)`);
      }
    }
    oneOf(record.counting, "record.counting", COUNTING_METHODS);
    oneOf(record.semantics, "record.semantics", SEMANTICS);
    snakeCase(record.base, "record.base");
  }

  text(record.description, "record.description");
  text(record.verbatim, "record.verbatim");
  const source = record.source as Fields;
  if (!isHttpUrl(source.url)) throw new ValidationError("record.source.url must be an http or https URL");
  isoDate(source.fetched_at, "record.source.fetched_at");
  oneOf(source.kind, "record.source.kind", SOURCE_KINDS);

  isoDate(record.effective_from, "record.effective_from");
  if (record.effective_to !== null) {
    isoDate(record.effective_to, "record.effective_to");
    if ((record.effective_to as string) < (record.effective_from as string)) {
      throw new ValidationError("record.effective_to must be on or after record.effective_from, or null");
    }
  }

  strings(record.supersedes, "record.supersedes").forEach((item, index) => {
    const otherRecord = UUID.test(item) && item.toLowerCase() !== recordId.toLowerCase();
    if (!SHIPPED_ROW.test(item) && !otherRecord) {
      throw new ValidationError(
        `record.supersedes[${index}] must be "shipped:<deadline_type>" or another record's record_id`
      );
    }
  });
  strings(record.open_questions, "record.open_questions");

  oneOf(record.status, "record.status", RULE_OVERLAY_STATUSES);
  if (record.verified_by !== null && record.verified_by !== "practitioner") {
    throw new ValidationError('record.verified_by must be "practitioner" or null');
  }
  if (record.verified_at !== null) isoDate(record.verified_at, "record.verified_at");
  if (record.status === "verified" && (record.verified_by === null || record.verified_at === null)) {
    throw new ValidationError('record.status "verified" requires verified_by "practitioner" and an ISO verified_at');
  }
  const poolId = record.pool_id;
  if (poolId !== undefined && poolId !== null && (typeof poolId !== "string" || !UUID.test(poolId))) {
    throw new ValidationError("record.pool_id must be a UUID, null, or omitted");
  }

  const { record_id: _given, ...fields } = record;
  return { record_id: recordId, ...fields };
}

// Inserts the record, or replaces the row whose id is its record_id. Returns the stored record.
export async function upsert_rule_overlay(
  admin: UnscopedAdmin,
  ownerId: string,
  args: Record<string, unknown>
): Promise<Fields> {
  const record = validateRuleOverlayRecord(args.record);
  const id = String(record.record_id);
  const row = {
    deadline_type: record.deadline_type,
    rule_ref: record.rule_ref,
    amending_reg: (record.amending_instrument as Fields).reg,
    effective_from: record.effective_from,
    effective_to: record.effective_to,
    status: record.status,
    record: JSON.stringify(record),
  };
  const existing = await admin.query(overlay, { id: `eq.${id}` }, { limit: 1 });
  const stored = existing.length > 0
    ? exactlyOne(await admin.update(overlay, { id: `eq.${id}` }, row), overlay.table, "update")
    : exactlyOne(await admin.insert(overlay, { id, ...row }), overlay.table, "insert");
  return JSON.parse(String(stored.record)) as Fields;
}

function compare(a: unknown, b: unknown): number {
  const [x, y] = [String(a ?? ""), String(b ?? "")];
  return x < y ? -1 : x > y ? 1 : 0;
}

// Every overlay record, optionally filtered, sorted by deadline_type then effective_from.
export async function rule_overlay(
  admin: UnscopedAdmin,
  ownerId: string,
  args: Record<string, unknown>
): Promise<{ records: Fields[] }> {
  const filters: Record<string, string> = {};
  for (const key of ["deadline_type", "amending_reg", "status"]) {
    if (args[key]) filters[key] = `eq.${String(args[key])}`;
  }
  const rows = await admin.query(overlay, filters);
  const records = rows.map((row) => JSON.parse(String(row.record)) as Fields);
  records.sort((a, b) => compare(a.deadline_type, b.deadline_type) || compare(a.effective_from, b.effective_from));
  return { records };
}
