// The confirmation sidecar (shared/knowledge-tree.md section 10).
//
// `<file>.confirmations.local.json` sits beside the knowledge file in the overlay
// only. The knowledge file holds no status; a row here is a roster lawyer's
// confirmation or correction of one item, pinned to the passage it was made against.
// The read half parses a sidecar and computes each item's effective status at read.
// The write half upserts one row under a cross-process lock file, and hashes a
// passage with passageHash() below, so both halves agree.

import { createHash } from "node:crypto";
import { existsSync } from "node:fs";

import { DataServerError } from "../errors.js";
import { withFileLock, writeTextAtomic } from "../file-lock.js";
import type { ShippedFrom } from "../repo-root.js";
import { STAMP_KEYS, stampProblem } from "./venues-kinds.js";
import { readLayerBytes } from "./tree.js";

export interface SidecarRow {
  rule_ref: string;
  status: "confirmed" | "corrected";
  by: string;
  on: string;
  confirmed_against: { passage_hash: string; currency: string | null };
  /** Only on `corrected`: the item's value in the shape its tree's file contract declares. */
  value?: unknown;
  /** The writer's stamp (#992 item 9): which plugin served the copy the passage hash binds to. Absent on rows written before it. */
  plugin_version?: string | null;
  shipped_from?: ShippedFrom;
}

/** The sha256 of a passage with its whitespace collapsed, so line wrapping and line endings never change it. */
export function passageHash(passage: string): string {
  return createHash("sha256").update(passage.replace(/\s+/g, " ").trim(), "utf8").digest("hex");
}

function invalid(file: string, where: string, rule: string): never {
  throw new DataServerError(`${file}: ${where}: ${rule}`, "invalid_sidecar");
}

/** Parse and validate a sidecar. `knowledgePath` is the file it must confirm. */
export function parseSidecar(text: string, file: string, knowledgePath: string): SidecarRow[] {
  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch (err) {
    return invalid(file, "the sidecar", `is not valid JSON: ${(err as Error).message}`);
  }
  if (typeof doc !== "object" || doc === null || Array.isArray(doc)) invalid(file, "the sidecar", "must be an object");
  const top = doc as Record<string, unknown>;
  const extra = Object.keys(top).filter((key) => key !== "file" && key !== "items");
  if (extra.length) invalid(file, "the sidecar", `unknown field(s) ${extra.join(", ")}`);
  if (typeof top.file !== "string" || top.file.split("\\").join("/").toLowerCase() !== knowledgePath.toLowerCase()) {
    invalid(file, "file", `must name the file it sits beside, "${knowledgePath}"`);
  }
  if (!Array.isArray(top.items)) invalid(file, "items", "must be an array");

  const rows: SidecarRow[] = [];
  (top.items as unknown[]).forEach((raw, i) => {
    const where = `items[${i}]`;
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) invalid(file, where, "must be an object");
    const row = raw as Record<string, unknown>;
    const unknown = Object.keys(row).filter((key) => !["rule_ref", "status", "by", "on", "confirmed_against", "value", ...STAMP_KEYS].includes(key));
    if (unknown.length) invalid(file, where, `unknown field(s) ${unknown.join(", ")}`);
    for (const key of ["rule_ref", "by", "on"]) {
      if (typeof row[key] !== "string" || row[key] === "") invalid(file, `${where}.${key}`, "must be a non-empty string");
    }
    if (row.status !== "confirmed" && row.status !== "corrected") invalid(file, `${where}.status`, 'must be "confirmed" or "corrected"');
    if (rows.some((seen) => seen.rule_ref === row.rule_ref)) invalid(file, where, `rule_ref "${row.rule_ref}" has two rows`);
    const against = row.confirmed_against as Record<string, unknown> | undefined;
    if (typeof against !== "object" || against === null || Array.isArray(against)) {
      invalid(file, `${where}.confirmed_against`, "must be {passage_hash, currency}");
    }
    if (typeof against.passage_hash !== "string" || !/^[0-9a-f]{64}$/.test(against.passage_hash)) {
      invalid(file, `${where}.confirmed_against.passage_hash`, "must be a sha256 hex digest");
    }
    if (against.currency !== null && typeof against.currency !== "string") {
      invalid(file, `${where}.confirmed_against.currency`, "must be a string or null");
    }
    const extraAgainst = Object.keys(against).filter((key) => key !== "passage_hash" && key !== "currency");
    if (extraAgainst.length) invalid(file, `${where}.confirmed_against`, `unknown field(s) ${extraAgainst.join(", ")}`);
    const corrected = row.status === "corrected";
    if (corrected !== Object.hasOwn(row, "value")) {
      invalid(file, `${where}.value`, corrected ? "is required on a corrected row" : "appears only on a corrected row");
    }
    const stamp = stampProblem(row);
    if (stamp) invalid(file, `${where}.${stamp[0]}`, stamp[1]);
    rows.push({
      rule_ref: row.rule_ref as string,
      status: row.status as SidecarRow["status"],
      by: row.by as string,
      on: row.on as string,
      confirmed_against: { passage_hash: against.passage_hash, currency: (against.currency as string | null | undefined) ?? null },
      ...(corrected ? { value: row.value } : {}),
      ...(row.plugin_version !== undefined ? { plugin_version: row.plugin_version as string | null } : {}),
      ...(row.shipped_from !== undefined ? { shipped_from: row.shipped_from as ShippedFrom } : {}),
    });
  });
  return rows;
}

// ------------------------------------------------------------ effective status --

/** One item of a knowledge file: a rule_ref with its verbatim passage, from the front matter that holds it. */
export interface StatusItem {
  rule_ref: string;
  passage: string;
  /** The `currency_marker` of the front matter holding the item, or null. */
  currency: string | null;
  /** Knowledge path of the file whose front matter holds the item. */
  record: string;
  /** Transcribed from a PDF or a practitioner's saved copy. */
  from_file: boolean;
  page: string | null;
  source: string | null;
}

/** The memoized sources__check facts for this file: per source record, each item's presence. */
export interface CheckedRecord {
  record: string;
  items?: Array<{ rule_ref: string; present: boolean | null }>;
}

/** Every file is learned: an item reads unconfirmed until this firm's own sidecar confirms or corrects it. */
export type Status = "confirmed" | "corrected" | "unconfirmed";
/** `verified`: the session's source check found the passage. `missing`: it did not. Otherwise not verified. */
export type Freshness = "verified" | "not verified" | "missing";

export interface ItemStatus {
  rule_ref: string;
  status: Status;
  freshness: Freshness;
  passage_hash: string;
  currency: string | null;
  record: string;
  /** Present on an item transcribed from a PDF: its page, for the mockup's `transcribed from PDF p. <n>`. */
  pdf_page?: string;
  /** A /publish format property whose source is the practitioner reads confirmed with no row. */
  practitioner_sourced?: true;
}

export interface EffectiveStatus {
  items: ItemStatus[];
  /** Confirmed rows whose passage changed: the item reads unconfirmed. */
  stale_confirmation: Array<{ rule_ref: string; by: string; on: string; confirmed_against: SidecarRow["confirmed_against"]; passage_hash: string }>;
  /** Rows whose rule_ref is gone from the file. Nothing deletes them. */
  orphaned_confirmations: SidecarRow[];
  /** Confirmed or corrected rows whose currency marker moved while the passage stayed identical. The row stands. */
  currency_moved: Array<{ rule_ref: string; confirmed_currency: string | null; currency: string | null }>;
  /** Corrections in force, disclosed on every read. `passage_changed` reports a passage that moved since; the correction stands. */
  corrections: Array<{ rule_ref: string; value: unknown; by: string; on: string; passage_changed: boolean }>;
  /** Whether a memoized sources__check result for this file was consulted. Without one, freshness is not verified. */
  sources_check: "consulted" | "none";
}

export interface StatusInput {
  items: StatusItem[];
  rows: SidecarRow[];
  /** /publish format files: a practitioner-sourced property needs no row (shared/declared-format.md section 4). */
  practitionerConfirms: boolean;
  /** The session's memoized sources__check result for this file, if any. */
  checked: CheckedRecord[] | undefined;
}

function freshnessOf(item: StatusItem, checked: CheckedRecord[] | undefined): Freshness {
  // Knowledge paths are case-insensitive, as the filesystem is.
  const facts = checked?.find((record) => record.record.toLowerCase() === item.record.toLowerCase());
  const present = facts?.items?.find((entry) => entry.rule_ref === item.rule_ref)?.present;
  if (present === true) return "verified";
  if (present === false) return "missing";
  return "not verified";
}

export function effectiveStatus(input: StatusInput): EffectiveStatus {
  const out: EffectiveStatus = {
    items: [],
    stale_confirmation: [],
    orphaned_confirmations: [],
    currency_moved: [],
    corrections: [],
    sources_check: input.checked ? "consulted" : "none",
  };
  const byRef = new Map(input.rows.map((row) => [row.rule_ref, row]));

  for (const item of input.items) {
    const hash = passageHash(item.passage);
    const freshness = freshnessOf(item, input.checked);
    const row = byRef.get(item.rule_ref);
    let status: Status = "unconfirmed";
    let practitioner = false;

    if (row?.status === "corrected") {
      // A correction stays in force across a passage change and is never reverted; the change is reported.
      status = "corrected";
      out.corrections.push({ rule_ref: row.rule_ref, value: row.value, by: row.by, on: row.on, passage_changed: row.confirmed_against.passage_hash !== hash });
    } else if (row?.status === "confirmed") {
      if (row.confirmed_against.passage_hash === hash) {
        status = "confirmed";
      } else {
        out.stale_confirmation.push({ rule_ref: row.rule_ref, by: row.by, on: row.on, confirmed_against: row.confirmed_against, passage_hash: hash });
      }
    } else if (input.practitionerConfirms && item.source === "practitioner") {
      status = "confirmed";
      practitioner = true;
    }

    if (row && row.confirmed_against.passage_hash === hash && row.confirmed_against.currency !== item.currency) {
      out.currency_moved.push({ rule_ref: row.rule_ref, confirmed_currency: row.confirmed_against.currency, currency: item.currency });
    }
    // The session's source check reported the passage missing: neither a confirmation nor a correction holds for
    // this session. A correction stays recorded and is still reported in `corrections`; it is not reverted.
    if (freshness === "missing" && (status === "confirmed" || status === "corrected")) status = "unconfirmed";

    out.items.push({
      rule_ref: item.rule_ref,
      status,
      freshness,
      passage_hash: hash,
      currency: item.currency,
      record: item.record,
      ...(item.from_file && item.page !== null ? { pdf_page: item.page } : {}),
      ...(practitioner ? { practitioner_sourced: true as const } : {}),
    });
  }

  const refs = new Set(input.items.map((item) => item.rule_ref));
  out.orphaned_confirmations = input.rows.filter((row) => !refs.has(row.rule_ref));
  return out;
}

// ------------------------------------------------------------ write half --

function readRows(sidecarAbs: string, knowledgePath: string): SidecarRow[] {
  if (!existsSync(sidecarAbs)) return [];
  const text = readLayerBytes(sidecarAbs, "the confirmation sidecar").toString("utf-8");
  return parseSidecar(text.startsWith("\uFEFF") ? text.slice(1) : text, sidecarAbs, knowledgePath);
}

/**
 * Upsert one row, keyed by rule_ref, under the sidecar's lock, so two confirmations of
 * different items both land. `check` sees the rows as they will be written and fails
 * hard to refuse them (a correction is validated by substitution there). Returns them.
 */
export async function upsertSidecarRow(
  sidecarAbs: string,
  knowledgePath: string,
  row: SidecarRow,
  check: (rows: SidecarRow[]) => void
): Promise<SidecarRow[]> {
  return withFileLock(sidecarAbs, () => {
    const rows = readRows(sidecarAbs, knowledgePath);
    const at = rows.findIndex((known) => known.rule_ref === row.rule_ref);
    if (at === -1) rows.push(row);
    else rows[at] = row;
    check(rows);
    writeTextAtomic(sidecarAbs, JSON.stringify({ file: knowledgePath, items: rows }, null, 2) + "\n");
    return rows;
  });
}
