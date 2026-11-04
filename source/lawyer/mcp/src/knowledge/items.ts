// A knowledge file's items, and the layout or format block contract that governs it.

import { DataServerError } from "../errors.js";
import { parseItems, readFrontMatter, sourcesListOf, type FrontMatter } from "../sources/check.js";
import { extractJsonBlock, substituteLayout, validateTypeBlock, validateVenueBlock, citedItems, type BlockKind } from "./declared-layout.js";
import { formatRefs, substituteFormat, validateFormatBlock } from "./declared-format.js";
import { NO_VENUE } from "./venues-kinds.js";
import type { EffectiveStatus, StatusItem } from "./sidecar.js";
import { identicalText, joinRelative, parseKnowledgePath, readServed, type KnowledgePath, type KnowledgeSeams } from "./tree.js";

/** A source record a dependent names that the overlay also holds: the shipped copy was read. */
export interface ShadowedSource {
  path: string;
  identical: boolean;
}

/**
 * Every item of a knowledge file: those in its own front matter, then those of each
 * source record its `sources:` list names (read as knowledge__read serves them, so each
 * must keep the folder grammar). An item's currency is the `currency_marker` of the
 * front matter holding it. A named record in both layers is reported in `shadowed_sources`.
 */
export function itemsOf(kp: KnowledgePath, front: FrontMatter | null, seams: KnowledgeSeams, label: string): { items: StatusItem[]; shadowed_sources: ShadowedSource[] } {
  const items: StatusItem[] = [];
  const shadowed_sources: ShadowedSource[] = [];
  const take = (record: string, recordFront: FrontMatter) => {
    const marker = recordFront.currency_marker;
    const currency = typeof marker === "string" ? marker : null;
    for (const item of parseItems(recordFront, record)) {
      const seen = items.find((known) => known.rule_ref === item.rule_ref);
      if (seen) {
        throw new DataServerError(`${kp.path}: rule_ref "${item.rule_ref}" is carried by both ${seen.record} and ${record}; a rule_ref is unique across a file and the records its "sources:" list names; a dependent file names the record in "sources:" and cites its rule_ref; it does not restate the item`, "invalid_source_record");
      }
      items.push({ rule_ref: item.rule_ref, passage: item.passage, currency, record, from_file: item.fromFile, page: item.page, source: item.source });
    }
  };
  if (front) take(kp.path, front);
  for (const relative of sourcesListOf(front, kp.path)) {
    const entryLabel = `${label}: ${kp.path}'s "sources:" entry ${relative}`;
    const recordKp = parseKnowledgePath(joinRelative(kp.path, relative), entryLabel);
    const record = readServed(recordKp, seams, entryLabel);
    const recordFront = readFrontMatter(record.served.text, recordKp.path);
    if (!recordFront) throw new DataServerError(`${recordKp.path}, named in ${kp.path}'s "sources:" list, has no front matter`, "invalid_source_record");
    take(recordKp.path, recordFront);
    if (record.shadowed) {
      shadowed_sources.push({ path: record.shadowed.abs, identical: identicalText(record.served.text, record.shadowed.text) });
    }
  }
  return { items, shadowed_sources };
}

/** Which block contract, if any, governs a file by its position in the tree. */
export function blockKindOf(kp: KnowledgePath): { kind: BlockKind | "format"; noVenue: boolean } | null {
  const noVenue = kp.rest[2] === NO_VENUE;
  const name = kp.rest[kp.rest.length - 1];
  if (kp.skill === "draft" && kp.rest.length === 4 && name === "venue.md") return { kind: "venue", noVenue };
  // A type file sits in /draft's Documents\, or in /legal-research's under _NoVenue (the research memo).
  const typeTree = kp.skill === "draft" || (kp.skill === "legal-research" && noVenue);
  if (typeTree && kp.rest.length === 5 && kp.rest[3] === "Documents" && name.endsWith(".md")) return { kind: "type", noVenue };
  if (kp.skill === "publish" && kp.rest.length === 4 && name === "format.md") return { kind: "format", noVenue };
  return null;
}

/**
 * Validate a layout or format block with the firm's corrections substituted, and cross-check its cited rule_refs.
 * knowledge__write runs it with no corrections, so a write refuses what a read would.
 */
export function blockOf(kp: KnowledgePath, content: string, status: Pick<EffectiveStatus, "corrections">, items: StatusItem[]): Record<string, unknown> {
  const kindOf = blockKindOf(kp);
  if (!kindOf) return {};
  const known = new Set(items.map((item) => item.rule_ref));
  const corrections = status.corrections.map(({ rule_ref, value }) => ({ rule_ref, value }));
  const uncited = (refs: string[]) => {
    const missing = refs.filter((ref) => !known.has(ref));
    if (missing.length) {
      throw new DataServerError(
        `${kp.path}: its block cites rule_ref ${missing.map((ref) => `"${ref}"`).join(", ")}, which no item of the file or its source records carries`,
        kindOf.kind === "format" ? "invalid_format" : "invalid_layout"
      );
    }
  };
  if (kindOf.kind === "format") {
    const raw = extractJsonBlock(content, kp.path, false, "invalid_format") as Record<string, unknown>;
    validateFormatBlock(raw, kp.path);
    uncited([...formatRefs(raw).keys()]);
    const { block, defaulted, substituted } = substituteFormat(raw, corrections, kp.path);
    return { format: block.format, defaulted, corrections_substituted: substituted };
  }
  const raw = extractJsonBlock(content, kp.path, true) as Record<string, unknown>;
  const context = { noVenue: kindOf.noVenue };
  if (kindOf.kind === "type") validateTypeBlock(raw, kp.path, context);
  else validateVenueBlock(raw, kp.path);
  uncited(citedItems(raw, kindOf.kind, kp.path).map((item) => item.rule_ref));
  const { block, substituted } = substituteLayout(raw, kindOf.kind, corrections, kp.path, context);
  return { layout: block, corrections_substituted: substituted };
}
