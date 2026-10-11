// The format block validator (shared/declared-format.md): the settable properties of
// a venue physical-format file in /publish's tree. The runtime is its single
// validator: it runs at knowledge__write and on each read, and fails hard on an
// unknown property, a value of the wrong type or outside its vocabulary, a
// non-positive font_size or line_spacing, or a malformed length, naming the file,
// the property and the rule broken. An omitted property takes the generic template's
// default and is reported under `defaulted`.

import { DataServerError } from "../errors.js";
import { TOKENS as LETTERHEAD_TOKENS } from "../tools/practice/firm-profile.js";

type Json = Record<string, unknown>;

export const FORMAT_PROPERTIES: readonly string[] = [
  "paper", "margins", "typeface", "font_size", "line_spacing",
  "page_numbering", "header", "footer", "filing_stamp_reservation",
];

const PAPER = ["letter", "legal", "a4"];
const POSITIONS = ["top-left", "top-center", "top-right", "bottom-left", "bottom-center", "bottom-right"];
const NUMBER_FORMATS = ["arabic", "lower-roman", "upper-roman"];
const LENGTH = /^\d+(?:\.\d+)? (mm|cm|in|pt)$/;

function fail(file: string, field: string, rule: string): never {
  throw new DataServerError(`${file}: ${field}: ${rule}`, "invalid_format");
}

function isObject(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireLength(value: unknown, file: string, field: string, unit?: string): void {
  const match = typeof value === "string" ? LENGTH.exec(value) : null;
  if (!match) fail(file, field, 'must be a length "<number> <unit>", the unit one of mm, cm, in or pt, e.g. "25 mm"');
  if (unit && match[1] !== unit) fail(file, field, `must be a length in ${unit}`);
}

function requireExactKeys(value: unknown, keys: string[], file: string, field: string): Json {
  if (!isObject(value)) fail(file, field, `must be an object with ${keys.join(", ")}`);
  const have = Object.keys(value);
  const missing = keys.filter((key) => !have.includes(key));
  const extra = have.filter((key) => !keys.includes(key));
  if (missing.length || extra.length) {
    fail(file, field, `must hold exactly ${keys.join(", ")}${missing.length ? `; missing ${missing.join(", ")}` : ""}${extra.length ? `; unknown ${extra.join(", ")}` : ""}`);
  }
  return value;
}

/** A header or footer string may carry only the letterhead tokens `/publish`'s letterhead step substitutes. */
function requireTokenString(value: unknown, file: string, field: string): void {
  if (typeof value !== "string") fail(file, field, "must be a string");
  const unknown = (value.match(/\{\{[^{}]*\}\}/g) ?? []).filter((token) => !LETTERHEAD_TOKENS.includes(token));
  if (unknown.length) fail(file, field, `carries ${unknown.join(", ")}, outside the letterhead token set (${LETTERHEAD_TOKENS.join(", ")})`);
}

function checkValue(property: string, value: unknown, file: string): void {
  const field = `format.${property}.value`;
  switch (property) {
    case "paper":
      if (typeof value !== "string" || !PAPER.includes(value)) fail(file, field, `must be one of ${PAPER.join(", ")}`);
      return;
    case "margins": {
      const margins = requireExactKeys(value, ["top", "bottom", "left", "right"], file, field);
      for (const side of ["top", "bottom", "left", "right"]) requireLength(margins[side], file, `${field}.${side}`);
      return;
    }
    case "typeface":
      if (typeof value !== "string" || value.trim() === "") fail(file, field, "must be a non-empty string");
      return;
    case "font_size":
      requireLength(value, file, field, "pt");
      if (parseFloat(value as string) <= 0) fail(file, field, "must be greater than zero");
      return;
    case "line_spacing":
      if (typeof value !== "number" || !Number.isFinite(value)) fail(file, field, "must be a number");
      if (value <= 0) fail(file, field, "must be greater than zero");
      return;
    case "page_numbering": {
      const numbering = requireExactKeys(value, ["position", "format", "first_page"], file, field);
      for (const [key, allowed] of [["position", POSITIONS], ["format", NUMBER_FORMATS]] as const) {
        const given = numbering[key];
        if (typeof given !== "string" || !allowed.includes(given)) fail(file, `${field}.${key}`, `must be one of ${allowed.join(", ")}`);
      }
      if (typeof numbering.first_page !== "boolean") fail(file, `${field}.first_page`, "must be true or false");
      return;
    }
    case "header":
    case "footer":
      requireTokenString(value, file, field);
      return;
    case "filing_stamp_reservation":
      requireLength(value, file, field);
      return;
  }
}

/** Validate a format block. Returns the omitted properties, which take the generic template's defaults. */
export function validateFormatBlock(raw: unknown, file: string): { defaulted: string[] } {
  if (!isObject(raw)) fail(file, "the format block", "must be a JSON object { \"format\": { ... } }");
  const extra = Object.keys(raw).filter((key) => key !== "format");
  if (extra.length) fail(file, extra[0], 'is not allowed; the block holds only "format"');
  if (!isObject(raw.format)) fail(file, "format", "must be an object of properties");
  const refs = new Map<string, string>();
  for (const [property, entry] of Object.entries(raw.format)) {
    if (!FORMAT_PROPERTIES.includes(property)) {
      fail(file, `format.${property}`, `is not a settable property (the closed vocabulary: ${FORMAT_PROPERTIES.join(", ")}); signature placement is never settable`);
    }
    const cited = requireExactKeys(entry, ["value", "rule_ref"], file, `format.${property}`);
    if (typeof cited.rule_ref !== "string" || cited.rule_ref.trim() === "") fail(file, `format.${property}.rule_ref`, "must be a non-empty string");
    const seen = refs.get(cited.rule_ref);
    if (seen) fail(file, `format.${property}.rule_ref`, `"${cited.rule_ref}" is already cited by format.${seen}; a rule_ref is unique within the file`);
    refs.set(cited.rule_ref, property);
    checkValue(property, cited.value, file);
  }
  return { defaulted: FORMAT_PROPERTIES.filter((property) => !Object.hasOwn(raw.format as Json, property)) };
}

/** The property each rule_ref cites. */
export function formatRefs(block: Json): Map<string, string> {
  const refs = new Map<string, string>();
  for (const [property, entry] of Object.entries(block.format as Json)) refs.set((entry as Json).rule_ref as string, property);
  return refs;
}

/**
 * Substitute each correction (the property's own JSON value) at its rule_ref into a
 * copy of the block, then validate the result. A rule_ref the block does not cite is
 * refused: every correctable item of a format file is a property.
 */
export function substituteFormat(
  raw: Json,
  corrections: Array<{ rule_ref: string; value: unknown }>,
  file: string
): { block: Json; defaulted: string[]; substituted: string[] } {
  const block = structuredClone(raw);
  const refs = formatRefs(block);
  const substituted: string[] = [];
  for (const correction of corrections) {
    const property = refs.get(correction.rule_ref);
    if (!property) fail(file, `corrected value for rule_ref "${correction.rule_ref}"`, "names no property of this file");
    (block.format as Json)[property] = { value: correction.value, rule_ref: correction.rule_ref };
    substituted.push(correction.rule_ref);
  }
  const { defaulted } = validateFormatBlock(block, file);
  return { block, defaulted, substituted };
}
