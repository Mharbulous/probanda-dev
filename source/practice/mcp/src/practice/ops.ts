// The one generic op builder, with the guard every value passes before it may
// leave the machine (L3 of docs/Plans/2026-10-14_practice-db-conversion.md).
//
// An op sends raw only ids, kind, tags, state and links, each a vocabulary
// value, and the cross record of a rule overlay. Every data field is sent as
// HMAC-SHA256 of its canonical JSON value under the practice's hash_key, which
// never leaves practice.db; a null field is sent as null. No data value is
// ever sent in clear.

import { createHmac } from "node:crypto";

import { ValidationError } from "../errors.js";

/** A raw string may leave the machine only as a vocabulary value... */
const VOCABULARY = /^[a-z0-9][a-z0-9_:.-]*$/;
/** ...and never carrying a client matter code. */
const MATTER_CODE = /\bL\d{3,4}\b/;

export type OpType = "create" | "upsert" | "update" | "delete";

/** One op as a tool describes it, with its data in clear. */
export interface OpSpec {
  op: OpType;
  id: string;
  kind: string;
  /** Omitted: not changed. null: cleared. */
  state?: string | null;
  tags?: Record<string, unknown>;
  links?: Record<string, string | null | undefined>;
  /** Stored locally in clear and sent only as hashes. An undefined field is neither. */
  data?: Record<string, unknown>;
  /** Data fields whose empty string is sent as null (an empty label). */
  blank?: string[];
  /** A rule overlay record: plugin-made and firm-wide, sent as it is. */
  cross?: Record<string, unknown>;
  /** Tags that repeat a value of `cross`, guarded as cross data. */
  crossTags?: string[];
}

/** The op as it is sent. */
export interface CloudOp {
  op: OpType;
  id: string;
  kind: string;
  state?: string | null;
  tags?: Record<string, unknown>;
  links?: Record<string, string | null>;
  hashes: Record<string, string | null>;
  cross?: Record<string, unknown>;
}

function refuse(field: string, why: string): never {
  throw new ValidationError(`Refused before anything was sent to Probanda's Cloud: ${field} ${why}. Nothing was saved.`);
}

/** Refuses a matter code anywhere in a cross value, naming the field and never the code. */
export function guardCross(value: unknown, field: string): void {
  if (typeof value === "string") {
    if (MATTER_CODE.test(value)) refuse(field, "carries a client matter code, and cross data never carries matter content");
  } else if (Array.isArray(value)) {
    value.forEach((item, index) => guardCross(item, `${field}[${index}]`));
  } else if (value !== null && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) guardCross(item, `${field}.${key}`);
  }
}

/** Refuses a raw string that is not a vocabulary value or carries a matter code. Booleans, numbers and null pass. */
export function guardRaw(value: unknown, field: string): void {
  if (value === null || value === undefined || typeof value === "boolean" || typeof value === "number") return;
  if (typeof value !== "string") refuse(field, "is not a single value");
  if (!VOCABULARY.test(value)) refuse(field, "is not a vocabulary value (lower-case letters, digits, _ : . -), so it would leave the machine as raw text");
  if (MATTER_CODE.test(value)) refuse(field, "carries a client matter code");
}

/** JSON with every object's keys sorted, so equal values hash equally. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.keys(value as Record<string, unknown>).sort()
      .filter((key) => (value as Record<string, unknown>)[key] !== undefined)
      .map((key) => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value);
}

/** HMAC-SHA256 (hex) of the value's canonical JSON; null stays null. The field name is not hashed. */
export function hashValue(hashKey: Buffer, value: unknown): string | null {
  if (value === null) return null;
  return createHmac("sha256", hashKey).update(canonicalJson(value)).digest("hex");
}

/** Builds one op, guarding every raw value first. Throws before anything is sent. */
export function buildOp(spec: OpSpec, hashKey: Buffer): CloudOp {
  const at = `op ${spec.kind} ${spec.id}`;
  guardRaw(spec.id, `the id of ${at}`);
  guardRaw(spec.kind, `the kind of ${at}`);
  const op: CloudOp = { op: spec.op, id: spec.id, kind: spec.kind, hashes: {} };
  if (spec.state !== undefined) {
    guardRaw(spec.state, `the state of ${at}`);
    op.state = spec.state;
  }
  if (spec.tags) {
    const tags: Record<string, unknown> = {};
    for (const [tag, value] of Object.entries(spec.tags)) {
      if (value === undefined) continue;
      guardRaw(tag, `a tag name of ${at}`);
      if (spec.crossTags?.includes(tag)) guardCross(value, `tag ${tag} of ${at}`);
      else guardRaw(value, `tag ${tag} of ${at}`);
      tags[tag] = value;
    }
    op.tags = tags;
  }
  if (spec.links) {
    const links: Record<string, string | null> = {};
    for (const [role, target] of Object.entries(spec.links)) {
      if (target === undefined) continue;
      guardRaw(role, `a link role of ${at}`);
      guardRaw(target, `link ${role} of ${at}`);
      links[role] = target;
    }
    op.links = links;
  }
  for (const [field, value] of Object.entries(spec.data ?? {})) {
    if (value === undefined) continue;
    op.hashes[field] = hashValue(hashKey, spec.blank?.includes(field) && value === "" ? null : value);
  }
  if (spec.cross !== undefined) {
    guardCross(spec.cross, "record");
    op.cross = spec.cross;
  }
  return op;
}
