import { createHash } from "node:crypto";

import { ValidationError } from "../errors.js";
import type { LegalCommonsClient } from "./client.js";
import { contributorId } from "./contributor.js";

// Court-rule periods in the pool (spec 2026-10-05_legal-commons-court-rule-sharing).
// A pushed record is a rule-overlay record (rule-overlay spec §6). It is checked
// here against that shape field by field — the generic input validator does not
// look inside array items — and refused on any field outside it or any client
// matter code anywhere in its text, before a network call.

type Shape = "string" | "number" | "boolean" | "date" | "strings" | { [field: string]: Shape };

const RECORD_SHAPE: { [field: string]: Shape } = {
  record_id: "string",
  jurisdiction: "string",
  enactment: { name: "string", citation: "string", civix_id: "string" },
  amending_instrument: { reg: "string", oic: "string", commencement: "string" },
  deadline_type: "string",
  anchor_type: "string",
  rule_ref: "string",
  offset: { value: "number", unit: "string", direction: "string", clear: "boolean" },
  counting: "string",
  semantics: "string",
  description: "string",
  verbatim: "string",
  source: { url: "string", fetched_at: "string", kind: "string" },
  effective_from: "date",
  effective_to: "date",
  supersedes: "strings",
  open_questions: "strings",
  status: "string",
  verified_by: "string",
  verified_at: "string",
};

const REQUIRED = [
  "jurisdiction",
  "enactment.citation",
  "amending_instrument.reg",
  "deadline_type",
  "rule_ref",
  "verbatim",
  "source.url",
  "source.fetched_at",
  "status",
];

// The local bookkeeping fields. The pool keeps its own ids and status, and a
// puller sets its own local status, so these never cross.
const LOCAL_FIELDS = ["record_id", "status", "verified_by", "verified_at"];

// The same pattern as direct_mode.py's MATTER_CODE. A rule record carries no
// UTBMS task codes, so its UTBMS exception is not needed here.
const MATTER_CODE = /\bL\d{3,4}\b/;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function checkShape(label: string, value: unknown, shape: Shape): void {
  if (value === null) return;
  if (typeof shape === "object") {
    if (!isPlainObject(value)) throw new ValidationError(`${label} must be an object`);
    for (const [field, inner] of Object.entries(value)) {
      if (!(field in shape)) throw new ValidationError(`${label}.${field} is not a rule-record field`);
      checkShape(`${label}.${field}`, inner, shape[field]);
    }
    return;
  }
  if (shape === "strings") {
    if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
      throw new ValidationError(`${label} must be an array of strings`);
    }
    return;
  }
  if (shape === "date") {
    if (typeof value !== "string" || !ISO_DATE.test(value)) {
      throw new ValidationError(`${label} must be a YYYY-MM-DD date`);
    }
    return;
  }
  if (typeof value !== shape) throw new ValidationError(`${label} must be a ${shape}`);
}

function pathValue(record: Record<string, unknown>, path: string): unknown {
  return path.split(".").reduce<unknown>((node, key) => (isPlainObject(node) ? node[key] : undefined), record);
}

// Every string in the record, with the field path it sits at.
function strings(value: unknown, path: string, out: Array<[string, string]>): Array<[string, string]> {
  if (typeof value === "string") out.push([path, value]);
  else if (Array.isArray(value)) value.forEach((item, i) => strings(item, `${path}[${i}]`, out));
  else if (isPlainObject(value)) for (const [k, v] of Object.entries(value)) strings(v, `${path}.${k}`, out);
  return out;
}

// Keys sorted at every level, so equal content always serializes the same way.
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (isPlainObject(value)) {
    return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

// The hash covers what the rule does, not how a contributor described or
// sourced it, so two contributors with the same rule hold one row and a
// different offset, base or quote makes a new row for the key.
function contentHash(record: Record<string, unknown>): string {
  const enactment = record.enactment as Record<string, unknown>;
  const operative = {
    jurisdiction: record.jurisdiction,
    enactment_citation: enactment.citation,
    rule_ref: record.rule_ref,
    deadline_type: record.deadline_type,
    effective_from: record.effective_from ?? null,
    effective_to: record.effective_to ?? null,
    amending_instrument: record.amending_instrument,
    anchor_type: record.anchor_type ?? null,
    offset: record.offset ?? null,
    counting: record.counting ?? null,
    semantics: record.semantics ?? null,
    verbatim: String(record.verbatim).replace(/\s+/g, " ").trim(),
    supersedes: record.supersedes ?? null,
  };
  return createHash("sha256").update(canonical(operative)).digest("hex");
}

function prepareRecord(label: string, raw: unknown): Record<string, unknown> {
  checkShape(label, raw, RECORD_SHAPE);
  const record = raw as Record<string, unknown>;
  for (const path of REQUIRED) {
    const value = pathValue(record, path);
    if (value === undefined || value === null || value === "") {
      throw new ValidationError(`${label}.${path} is required`);
    }
  }
  if (record.status !== "verified") {
    throw new ValidationError(`${label}.status must be "verified": only a locally verified record may be shared`);
  }
  if (!record.effective_from && !record.effective_to) {
    throw new ValidationError(`${label} needs effective_from or effective_to`);
  }
  if (!/^https?:\/\//.test(String(pathValue(record, "source.url")))) {
    throw new ValidationError(`${label}.source.url must be an http(s) link to the primary source`);
  }
  // Names the field, never the text, so a refusal cannot repeat what it caught.
  const hit = strings(record, label, []).find(([, text]) => MATTER_CODE.test(text));
  if (hit) throw new ValidationError(`${hit[0]} holds a client matter code; rule records must be matter-free`);

  const stored = Object.fromEntries(Object.entries(record).filter(([field]) => !LOCAL_FIELDS.includes(field)));
  return {
    jurisdiction: record.jurisdiction,
    enactment_citation: (record.enactment as Record<string, unknown>).citation,
    rule_ref: record.rule_ref,
    deadline_type: record.deadline_type,
    effective_from: record.effective_from ?? null,
    amending_reg: (record.amending_instrument as Record<string, unknown>).reg,
    content_hash: contentHash(record),
    record: stored,
  };
}

export async function pushRulePeriods(client: LegalCommonsClient, args: Record<string, unknown>): Promise<unknown> {
  if (!Array.isArray(args.records) || args.records.length === 0) {
    throw new ValidationError("rule_period_push requires a non-empty records array");
  }
  // Every record is checked before any is sent: the push is one transaction.
  const prepared = args.records.map((raw, i) => prepareRecord(`records[${i}]`, raw));
  const contributor = await contributorId();
  const results = await client.rpc("rule_periods_push", { p_records: prepared, p_contributor: contributor });
  return { contributor, results };
}

// One current row per key: the cloud picks the latest live row, else the latest
// retired one, which `retired_at` marks.
const FIND_REPLY_FIELDS = ["rule_period_id", "contributed_at", "record", "retired_at", "retire_reason", "shipped_version"];

export async function findRulePeriods(client: LegalCommonsClient, args: Record<string, unknown>): Promise<unknown> {
  const rows = (await client.rpc("rule_periods_find", {
    p_jurisdiction: String(args.jurisdiction),
    p_enactment_citation: String(args.enactment),
    p_amending_reg: args.amending_reg ?? null,
    p_rule_ref: args.rule_ref ?? null,
    p_deadline_type: args.deadline_type ?? null,
  })) as Array<Record<string, unknown>> | null;
  // Named fields only, so no status, verification or attribution reaches a
  // reader, whatever the pool returns (lawyer-only-access plan §7 rules 7 and 15).
  return (rows ?? []).map((row) =>
    Object.fromEntries(FIND_REPLY_FIELDS.map((field) => [field, row[field] ?? null]))
  );
}

export async function retireRulePeriod(client: LegalCommonsClient, args: Record<string, unknown>): Promise<unknown> {
  return client.rpc("rule_periods_retire", {
    p_id: String(args.id),
    p_caller: await contributorId(),
    p_reason: String(args.reason),
    p_shipped_version: args.shipped_version ?? null,
  });
}
