// The layout block validator (shared/declared-layout.md). The runtime is its single
// validator: it runs wherever a block is written or read for use, and fails hard on
// any violation, naming the file, the field and the rule broken. There is no default
// for a missing required field and no repair of a malformed one.
//
// Two blocks: a type file's (every `Documents\<kind>.md` in /draft's tree) and a
// `venue.md`'s. A cited item carries a `rule_ref`; a firm's `corrected` sidecar row
// replaces that item's value, and the block is validated again after substitution.

import { DataServerError } from "../errors.js";
import { COMPANIONS } from "./companions.js";
import { documentTypes } from "../tools/practice/folder-map.js";

type Json = Record<string, unknown>;

function fail(file: string, field: string, rule: string): never {
  throw new DataServerError(`${file}: ${field}: ${rule}`, "invalid_layout");
}

// ------------------------------------------------------------ the fenced block --

/**
 * The first fenced `json` block after the front matter, parsed. `exactlyOne` refuses a
 * file carrying a second block (a type file and a venue.md each carry exactly one).
 */
export function extractJsonBlock(content: string, file: string, exactlyOne: boolean, code = "invalid_layout"): unknown {
  const lines = content.split(/\r?\n/);
  let start = 0;
  if (lines[0]?.trimEnd() === "---") {
    const end = lines.findIndex((line, i) => i > 0 && (line.trimEnd() === "---" || line.trimEnd() === "..."));
    start = end === -1 ? lines.length : end + 1;
  }
  // Only a top-level ```json fence counts: one inside another fenced block (a ```text example in prose) is that block's text.
  const opens: number[] = [];
  let fence: string | null = null;
  for (let i = start; i < lines.length; i++) {
    const line = lines[i];
    if (fence === null) {
      const open = /^(`{3,}|~{3,})/.exec(line);
      if (!open) continue;
      fence = open[1];
      if (/^```json\s*$/.test(line)) opens.push(i);
    } else if (line.trimEnd().length >= fence.length && line.trimEnd() === fence[0].repeat(line.trimEnd().length)) {
      fence = null;
    }
  }
  if (opens.length === 0) throw new DataServerError(`${file}: has no fenced json block after its front matter`, code);
  if (exactlyOne && opens.length > 1) throw new DataServerError(`${file}: carries ${opens.length} fenced json blocks; exactly one is allowed`, code);
  const close = lines.findIndex((line, i) => i > opens[0] && /^```\s*$/.test(line));
  if (close === -1) throw new DataServerError(`${file}: its fenced json block is never closed`, code);
  try {
    return JSON.parse(lines.slice(opens[0] + 1, close).join("\n"));
  } catch (err) {
    throw new DataServerError(`${file}: its fenced json block is not valid JSON: ${(err as Error).message}`, code);
  }
}

// ------------------------------------------------------------ vocabularies --

export const PROJECTIONS: readonly string[] = [
  "caption", "orders-sought", "facts", "legal-basis", "material-relied-on", "witness-statements",
  "positions", "hearing-details", "parties", "addressee", "sender", "signature-block", "terms", "form-source",
];
export const GOAL_CRITERIA: readonly string[] = [
  "orders-sought", "orders-positioned", "primary-authority", "excerpts", "noting-up",
  "evidence", "open-items", "opposing-points", "counsel-review", "terms-traced", "recipients", "hearing-date",
];
export { COMPANIONS };
const HEADING_NUMBERING = ["none", "part-roman", "part-arabic", "letter"];
const PARAGRAPH_NUMBERING = ["none", "restart", "continue"];
const PART_KEYS = ["heading", "heading_numbering", "paragraph_numbering", "source", "text", "rule_ref"];
/** Typography belongs to /publish's physical-format file (shared/declared-format.md), never to layout. */
const TYPOGRAPHY = ["typeface", "font", "font_size", "line_spacing", "margins", "paper", "page_numbering", "header", "footer", "filing_stamp_reservation"];

/** `folder_code` is optional and no shipped type declares it (spec 2026-10-22: every Writing's folder is
 * named after the document). A type file an older build learned may still carry it, and a stored
 * layout's copy is read only to find a Writing folder an older build named with it (writing-folder.ts). */
const TYPE_FIELDS = [
  "renderer", "needs_forum_parts", "folder_code", "title", "exhibit_numbering",
  "parts", "goal_criteria", "companions", "page_limit", "letterhead", "marker", "signer", "ingest_inputs",
];
/** Only these may be written as a cited scalar `{value, rule_ref}` in a type file. */
const CITABLE_TYPE_FIELDS = ["title", "page_limit", "exhibit_numbering"];
export const VENUE_FIELDS: readonly string[] = ["caption_lines", "file_number_label", "registry_label", "party_roles", "display_label"];

export type BlockKind = "type" | "venue";

// ------------------------------------------------------------ scalars --

function isObject(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isCited(value: unknown): value is { value: unknown; rule_ref: unknown } {
  return isObject(value) && Object.hasOwn(value, "value") && Object.hasOwn(value, "rule_ref");
}

function checkRuleRef(ref: unknown, file: string, field: string): void {
  if (typeof ref !== "string" || ref.trim() === "") fail(file, `${field}.rule_ref`, "must be a non-empty string");
}

/**
 * A scalar field, bare or, where citable, as `{value, rule_ref}`. Returns the bare
 * value for the caller's own type check.
 */
function scalar(block: Json, key: string, file: string, citable: boolean): unknown {
  const raw = block[key];
  if (!isObject(raw)) return raw;
  if (!citable) fail(file, key, "never carries a rule_ref; it cannot be cited, confirmed or corrected");
  if (!isCited(raw) || Object.keys(raw).length !== 2) fail(file, key, "a cited scalar is exactly { value, rule_ref }");
  checkRuleRef(raw.rule_ref, file, key);
  return raw.value;
}

function requireString(value: unknown, file: string, field: string): void {
  if (typeof value !== "string" || value.trim() === "") fail(file, field, "must be a non-empty string");
}

function requireEnum(value: unknown, allowed: readonly string[], file: string, field: string): void {
  if (typeof value !== "string" || !allowed.includes(value)) fail(file, field, `must be one of ${allowed.join(", ")}`);
}

function requireNameList(value: unknown, allowed: readonly string[], file: string, field: string): void {
  if (!Array.isArray(value)) fail(file, field, "must be an array");
  (value as unknown[]).forEach((name, i) => {
    if (field === "goal_criteria" && name === "gate") {
      fail(file, `${field}[${i}]`, `"${name}" is universal; every card carries it and no type declares it`);
    }
    requireEnum(name, allowed, file, `${field}[${i}]`);
  });
}

// ------------------------------------------------------------ parts --

function validatePart(part: unknown, file: string, field: string): void {
  if (!isObject(part)) fail(file, field, "must be an object");
  const extra = Object.keys(part).filter((key) => !PART_KEYS.includes(key));
  if (extra.length) fail(file, field, `unknown member(s) ${extra.join(", ")} (allowed: ${PART_KEYS.join(", ")})`);
  for (const key of ["heading", "heading_numbering", "paragraph_numbering", "source"]) {
    if (!Object.hasOwn(part, key)) fail(file, `${field}.${key}`, "is required");
  }
  if (part.heading !== null) requireString(part.heading, file, `${field}.heading`);
  requireEnum(part.heading_numbering, HEADING_NUMBERING, file, `${field}.heading_numbering`);
  requireEnum(part.paragraph_numbering, PARAGRAPH_NUMBERING, file, `${field}.paragraph_numbering`);
  const source = part.source;
  if (typeof source !== "string") fail(file, `${field}.source`, "must be a projection, slot:<name> or literal");
  const literal = source === "literal";
  if (!literal && !PROJECTIONS.includes(source) && !/^slot:[^\s]+$/.test(source)) {
    fail(file, `${field}.source`, `"${source}" is not in the closed vocabulary (a projection: ${PROJECTIONS.join(", ")}; slot:<name>; or literal)`);
  }
  if (literal) requireString(part.text, file, `${field}.text`);
  else if (Object.hasOwn(part, "text")) fail(file, `${field}.text`, "is present only when source is literal");
  if (Object.hasOwn(part, "rule_ref")) checkRuleRef(part.rule_ref, file, field);
}

// ------------------------------------------------------------ the validators --

export interface TypeContext {
  /** The type file sits under `_NoVenue`. */
  noVenue: boolean;
}

/** Validate a type file's layout block. */
export function validateTypeBlock(raw: unknown, file: string, context: TypeContext): void {
  if (!isObject(raw)) fail(file, "the layout block", "must be a JSON object");
  const block = raw;
  for (const key of Object.keys(block)) {
    if (TYPOGRAPHY.includes(key)) fail(file, key, "typography is not in the layout contract; it belongs to /publish's physical-format file");
    if (!TYPE_FIELDS.includes(key)) fail(file, key, `is not a layout field (allowed: ${TYPE_FIELDS.join(", ")})`);
  }
  for (const key of ["renderer", "needs_forum_parts", "title", "exhibit_numbering"]) {
    if (!Object.hasOwn(block, key)) fail(file, key, "is required; a missing required field has no default");
  }

  const renderer = scalar(block, "renderer", file, false);
  requireEnum(renderer, ["bespoke", "general"], file, "renderer");
  const needsForum = scalar(block, "needs_forum_parts", file, false);
  if (typeof needsForum !== "boolean") fail(file, "needs_forum_parts", "must be true or false");
  if (needsForum && context.noVenue) fail(file, "needs_forum_parts", "a type declaring true cannot resolve under _NoVenue");
  if (Object.hasOwn(block, "folder_code")) requireString(scalar(block, "folder_code", file, false), file, "folder_code");
  requireString(scalar(block, "title", file, true), file, "title");
  requireEnum(scalar(block, "exhibit_numbering", file, true), ["proceeding", "writing"], file, "exhibit_numbering");

  const general = renderer === "general";
  if (general) {
    if (!Object.hasOwn(block, "parts")) fail(file, "parts", "is required on a general type");
    if (!Array.isArray(block.parts)) fail(file, "parts", "must be an ordered array");
    (block.parts as unknown[]).forEach((part, i) => validatePart(part, file, `parts[${i}]`));
  } else if (Object.hasOwn(block, "parts")) {
    fail(file, "parts", "a bespoke type declares no parts");
  }

  if (Object.hasOwn(block, "goal_criteria")) requireNameList(block.goal_criteria, GOAL_CRITERIA, file, "goal_criteria");
  if (Object.hasOwn(block, "companions")) requireNameList(block.companions, COMPANIONS, file, "companions");
  if (Object.hasOwn(block, "ingest_inputs")) {
    // The document types a type may declare as its jobs' ingest inputs (declared-layout.md section 5):
    // the glossary's (shared/document-types.md), less the types nothing ingests.
    const ingestable = documentTypes().filter((t) => !t.flags.includes("never_ingest")).map((t) => t.id);
    requireNameList(block.ingest_inputs, ingestable, file, "ingest_inputs");
    if ((block.ingest_inputs as unknown[]).length === 0) fail(file, "ingest_inputs", "must name at least one document type; a type that reads no matter folder omits the key");
  }
  if (Object.hasOwn(block, "page_limit")) {
    const limit = scalar(block, "page_limit", file, true);
    if (!Number.isInteger(limit) || (limit as number) < 1) fail(file, "page_limit", "must be a positive integer of pages");
  }
  if (Object.hasOwn(block, "letterhead")) {
    const letterhead = scalar(block, "letterhead", file, false);
    if (typeof letterhead !== "boolean") fail(file, "letterhead", "must be true or false");
    if (letterhead && !general) fail(file, "letterhead", "is allowed on general types only");
  }
  if (Object.hasOwn(block, "marker")) {
    // One bold line the letterhead prints above the address, e.g. a privilege marker.
    requireString(scalar(block, "marker", file, false), file, "marker");
    if (scalar(block, "letterhead", file, false) !== true) fail(file, "marker", "is allowed only where letterhead is true");
  }
  if (Object.hasOwn(block, "signer")) {
    const signer = scalar(block, "signer", file, false);
    requireEnum(signer, ["lawyer", "party"], file, "signer");
    if (signer === "party" && scalar(block, "letterhead", file, false) === true) {
      fail(file, "signer", "party is allowed only where letterhead is not true; a letterhead render requires a roster lawyer as signer");
    }
  }
  citedItems(block, "type", file);
}

/** Validate a venue.md block. Every field in the table is required; `registry_label` may be null. */
export function validateVenueBlock(raw: unknown, file: string): void {
  if (!isObject(raw)) fail(file, "the venue block", "must be a JSON object");
  const block = raw;
  for (const key of Object.keys(block)) {
    if (!VENUE_FIELDS.includes(key)) fail(file, key, `is not a venue.md field (allowed: ${VENUE_FIELDS.join(", ")})`);
  }
  for (const key of VENUE_FIELDS) {
    if (!Object.hasOwn(block, key)) fail(file, key, "is required; a missing required field has no default");
  }
  const caption = scalar(block, "caption_lines", file, true);
  if (Array.isArray(caption)) {
    if (caption.length === 0) fail(file, "caption_lines", "must name at least one line");
    caption.forEach((line, i) => requireString(line, file, `caption_lines[${i}]`));
  } else {
    requireString(caption, file, "caption_lines");
  }
  requireString(scalar(block, "file_number_label", file, true), file, "file_number_label");
  const registry = scalar(block, "registry_label", file, true);
  if (registry !== null) requireString(registry, file, "registry_label");
  // party_roles is itself an object, so only the exact {value, rule_ref} shape reads as cited.
  let roles = block.party_roles;
  if (cited(roles)) {
    checkRuleRef((roles as Json).rule_ref, file, "party_roles");
    roles = (roles as Json).value;
  }
  if (!isObject(roles) || Object.keys(roles).length === 0) fail(file, "party_roles", "must map each role key to its printed label");
  for (const [role, label] of Object.entries(roles)) requireString(label, file, `party_roles.${role}`);
  requireString(scalar(block, "display_label", file, true), file, "display_label");
  citedItems(block, "venue", file);
}

/** A cited item is exactly `{value, rule_ref}`. */
function cited(value: unknown): boolean {
  return isCited(value) && Object.keys(value).length === 2;
}

// ------------------------------------------------------------ cited items --

export interface CitedItem {
  rule_ref: string;
  /** `parts[3]`, `title`, `caption_lines`, ... */
  field: string;
  /** The index in `parts`, for a cited part; absent for a cited scalar. */
  part?: number;
}

/** Every item the block cites, each rule_ref once. A rule_ref cited twice fails: it is unique within the file. */
export function citedItems(block: Json, kind: BlockKind, file: string): CitedItem[] {
  const out: CitedItem[] = [];
  const add = (rule_ref: unknown, field: string, part?: number) => {
    const ref = rule_ref as string;
    const seen = out.find((item) => item.rule_ref === ref);
    if (seen) fail(file, field, `rule_ref "${ref}" is already cited by ${seen.field}; a rule_ref is unique within the file`);
    out.push({ rule_ref: ref, field, ...(part === undefined ? {} : { part }) });
  };
  const fields = kind === "type" ? CITABLE_TYPE_FIELDS : VENUE_FIELDS;
  for (const field of fields) {
    if (cited(block[field])) add((block[field] as Json).rule_ref, field);
  }
  if (kind === "type" && Array.isArray(block.parts)) {
    block.parts.forEach((part, i) => {
      if (isObject(part) && Object.hasOwn(part, "rule_ref")) add(part.rule_ref, `parts[${i}]`, i);
    });
  }
  return out;
}

// ------------------------------------------------------------ corrections --

export interface Correction {
  rule_ref: string;
  value: unknown;
}

/**
 * Substitute each correction into a copy of the block at its rule_ref, in the shape
 * the item's kind takes (declared-layout.md section 9), then validate the result.
 * A correction whose rule_ref the block does not cite is a prose-guidance item: its
 * value must be a string, and it is reported, not substituted.
 */
export function substituteLayout(
  raw: Json,
  kind: BlockKind,
  corrections: Correction[],
  file: string,
  context: TypeContext
): { block: Json; substituted: string[] } {
  const block = structuredClone(raw);
  const items = citedItems(block, kind, file);
  const substituted: string[] = [];
  for (const correction of corrections) {
    const item = items.find((candidate) => candidate.rule_ref === correction.rule_ref);
    const where = `corrected value for rule_ref "${correction.rule_ref}"`;
    if (!item) {
      if (typeof correction.value !== "string") fail(file, where, "a cited prose-guidance item takes a string");
      continue;
    }
    if (item.part !== undefined) {
      if (!isObject(correction.value)) fail(file, where, "a parts[] entry takes the whole part object");
      if (Object.hasOwn(correction.value, "rule_ref")) fail(file, where, "a corrected part carries no rule_ref of its own");
      (block.parts as unknown[])[item.part] = { ...correction.value, rule_ref: correction.rule_ref };
    } else {
      const bare = correction.value;
      const isRoles = item.field === "party_roles";
      const isCaption = item.field === "caption_lines";
      if (isObject(bare) && !isRoles) fail(file, where, `${item.field} takes a scalar`);
      if (Array.isArray(bare) && !isCaption) fail(file, where, `${item.field} takes a scalar`);
      block[item.field] = { value: bare, rule_ref: correction.rule_ref };
    }
    substituted.push(correction.rule_ref);
  }
  if (kind === "type") validateTypeBlock(block, file, context);
  else validateVenueBlock(block, file);
  return { block, substituted };
}
