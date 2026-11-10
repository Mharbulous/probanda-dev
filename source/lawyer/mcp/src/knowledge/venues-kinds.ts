// Index files: merge on read and resolve (shared/knowledge-tree.md sections 4, 5 and 7).
//
// `venues.json` (a jurisdiction's venues and not-venue rulings) and `kinds.json` (a
// Documents\ folder's kinds) ship; the overlay writes `venues.local.json` and
// `kinds.local.json` beside them. Callers never parse either: they read the merged
// view built here. Rows merge by key (`code`, `file`), the shipped name and fields
// win, aliases union, every row and alias carries its `layer`, and the view carries
// `conflicts`.
//
// Resolve is deterministic: normalize, then three named candidate rules. There is no
// edit distance anywhere: BCSC, BCCA and BCPC differ by one character.

import { DataServerError, ValidationError } from "../errors.js";
import type { Layer } from "./tree.js";

export const AUDIENCES: readonly string[] = ["opposing-counsel", "opposing-party", "witness", "expert", "public-body", "non-party", "client", "internal"];
const ALIAS_SOURCES = ["official", "practitioner", "agent"];
export const NO_VENUE = "_NoVenue";

type Json = Record<string, unknown>;

export interface Alias {
  name: string;
  source?: string;
  ref?: string;
  recorded?: string;
  layer: Layer;
}

export interface VenueRow {
  code: string;
  name: string;
  aliases: Alias[];
  source?: string;
  ref?: string;
  recorded?: string;
  layer: Layer;
  /** Only on the synthesized _NoVenue row, which every forum picker skips. */
  reserved?: true;
}

export interface NotVenueRow {
  name: string;
  aliases: Alias[];
  resolves_to: typeof NO_VENUE;
  source: "practitioner";
  ref: string;
  recorded: string;
  note?: string;
  layer: Layer;
}

export interface KindRow {
  file: string;
  name: string;
  aliases: Alias[];
  recipient?: string;
  layer: Layer;
}

/** A key both layers define with different values. The shipped value is the one in force. */
export interface Conflict {
  key: string;
  field: string;
  shipped: unknown;
  local: unknown;
  /** A local `name` differing from a shipped one: a plugin update shipped a code the firm had already learned. */
  shadowed_local?: true;
}

export interface VenuesView {
  jurisdiction: string | null;
  name: string | null;
  venues: VenueRow[];
  not_venues: NotVenueRow[];
  conflicts: Conflict[];
}

export interface KindsView {
  kinds: KindRow[];
  conflicts: Conflict[];
}

export interface IndexSource {
  /** The parsed JSON, not yet validated. */
  doc: unknown;
  /** Named in every refusal. */
  file: string;
}

// ------------------------------------------------------------ validation --

function invalid(file: string, where: string, rule: string): never {
  throw new DataServerError(`${file}: ${where}: ${rule}`, "invalid_index");
}

function objectAt(value: unknown, file: string, where: string): Json {
  if (typeof value !== "object" || value === null || Array.isArray(value)) invalid(file, where, "must be an object");
  return value as Json;
}

function onlyKeys(obj: Json, allowed: string[], file: string, where: string): void {
  const extra = Object.keys(obj).filter((key) => !allowed.includes(key));
  if (extra.length) invalid(file, where, `unknown field(s) ${extra.join(", ")} (allowed: ${allowed.join(", ")})`);
}

function stringAt(obj: Json, key: string, file: string, where: string, required: boolean): string | undefined {
  const value = obj[key];
  if (value === undefined) {
    if (required) invalid(file, `${where}.${key}`, "is required");
    return undefined;
  }
  if (typeof value !== "string" || value === "") invalid(file, `${where}.${key}`, "must be a non-empty string");
  return value as string;
}

function arrayAt(obj: Json, key: string, file: string, where: string, required: boolean): unknown[] {
  const value = obj[key];
  if (value === undefined) {
    if (required) invalid(file, `${where}.${key}`, "is required");
    return [];
  }
  if (!Array.isArray(value)) invalid(file, `${where}.${key}`, "must be an array");
  return value as unknown[];
}

/** Aliases. A shipped alias may omit source, ref and recorded (the commit is its provenance); a local one may not. */
function aliasesOf(obj: Json, file: string, where: string, layer: Layer, required: boolean): Alias[] {
  return arrayAt(obj, "aliases", file, where, required).map((raw, i) => {
    const at = `${where}.aliases[${i}]`;
    const alias = objectAt(raw, file, at);
    onlyKeys(alias, ["name", "source", "ref", "recorded"], file, at);
    const local = layer === "local";
    const out: Alias = { name: stringAt(alias, "name", file, at, true)!, layer };
    const source = stringAt(alias, "source", file, at, local);
    if (source !== undefined && !ALIAS_SOURCES.includes(source)) invalid(file, `${at}.source`, `must be one of ${ALIAS_SOURCES.join(", ")}`);
    const ref = stringAt(alias, "ref", file, at, local);
    const recorded = stringAt(alias, "recorded", file, at, local);
    return { ...out, ...(source ? { source } : {}), ...(ref ? { ref } : {}), ...(recorded ? { recorded } : {}) };
  });
}

/**
 * The writer's stamp an overlay row write adds (#992 item 9). Optional on read in both layers:
 * overlay rows written before the stamp carry none, and a promoted row may keep it. The view leaves it out.
 */
export const STAMP_KEYS = ["plugin_version", "shipped_from"];

/** The first malformed stamp field of a row, with its rule, or null. Shared with the sidecar parser. */
export function stampProblem(obj: Json): [field: string, rule: string] | null {
  if (obj.plugin_version !== undefined && obj.plugin_version !== null && (typeof obj.plugin_version !== "string" || obj.plugin_version === "")) {
    return ["plugin_version", "must be a non-empty string or null"];
  }
  if (obj.shipped_from !== undefined && obj.shipped_from !== "install" && obj.shipped_from !== "checkout") {
    return ["shipped_from", 'must be "install" or "checkout"'];
  }
  return null;
}

function checkStamp(obj: Json, file: string, where: string): void {
  const problem = stampProblem(obj);
  if (problem) invalid(file, `${where}.${problem[0]}`, problem[1]);
}

function provenance(obj: Json, file: string, where: string): Pick<VenueRow, "source" | "ref" | "recorded"> {
  const out: Pick<VenueRow, "source" | "ref" | "recorded"> = {};
  for (const key of ["source", "ref", "recorded"] as const) {
    const value = stringAt(obj, key, file, where, false);
    if (value !== undefined) out[key] = value;
  }
  return out;
}

/** Union local aliases into a row's, skipping any whose normalized name the row already carries. */
function unionAliases(into: Alias[], extra: Alias[]): void {
  const seen = new Set(into.map((alias) => normalizeName(alias.name)));
  for (const alias of extra) {
    const key = normalizeName(alias.name);
    if (seen.has(key)) continue;
    seen.add(key);
    into.push(alias);
  }
}

function compare(conflicts: Conflict[], key: string, field: string, shipped: unknown, local: unknown): void {
  if (shipped === undefined || local === undefined || shipped === local) return;
  conflicts.push({ key, field, shipped, local, ...(field === "name" ? { shadowed_local: true as const } : {}) });
}

// ------------------------------------------------------------ venues --

function notVenueRow(raw: unknown, file: string, where: string, layer: Layer): NotVenueRow {
  const row = objectAt(raw, file, where);
  onlyKeys(row, ["name", "aliases", "resolves_to", "source", "ref", "recorded", "note", ...STAMP_KEYS], file, where);
  checkStamp(row, file, where);
  if (row.resolves_to !== NO_VENUE) invalid(file, `${where}.resolves_to`, `must be "${NO_VENUE}"`);
  if (row.source !== "practitioner") invalid(file, `${where}.source`, 'must be "practitioner"');
  const note = stringAt(row, "note", file, where, false);
  return {
    name: stringAt(row, "name", file, where, true)!,
    aliases: aliasesOf(row, file, where, layer, true),
    resolves_to: NO_VENUE,
    source: "practitioner",
    ref: stringAt(row, "ref", file, where, true)!,
    recorded: stringAt(row, "recorded", file, where, true)!,
    ...(note ? { note } : {}),
    layer,
  };
}

const VENUES_KEYS = ["jurisdiction", "name", "venues", "not_venues"];
const VENUE_ROW_KEYS = ["code", "name", "aliases", "source", "ref", "recorded", ...STAMP_KEYS];

/** The synthesized `_NoVenue` row: never stored, always in the view, skipped by every forum picker. */
export const NO_VENUE_ROW: VenueRow = { code: NO_VENUE, name: "No venue", aliases: [], layer: "shipped", reserved: true };

export function mergeVenues(shipped: IndexSource | null, local: IndexSource | null): VenuesView {
  const conflicts: Conflict[] = [];
  const view: VenuesView = { jurisdiction: null, name: null, venues: [], not_venues: [], conflicts };
  const byCode = new Map<string, VenueRow>();
  const notByName = new Map<string, NotVenueRow>();

  if (shipped) {
    const doc = objectAt(shipped.doc, shipped.file, "the index");
    onlyKeys(doc, VENUES_KEYS, shipped.file, "the index");
    view.jurisdiction = stringAt(doc, "jurisdiction", shipped.file, "the index", true)!;
    view.name = stringAt(doc, "name", shipped.file, "the index", true)!;
    arrayAt(doc, "venues", shipped.file, "the index", true).forEach((raw, i) => {
      const where = `venues[${i}]`;
      const row = objectAt(raw, shipped.file, where);
      onlyKeys(row, VENUE_ROW_KEYS, shipped.file, where);
      checkStamp(row, shipped.file, where);
      const code = stringAt(row, "code", shipped.file, where, true)!;
      if (byCode.has(code)) invalid(shipped.file, where, `code "${code}" appears twice`);
      const venue: VenueRow = {
        code,
        name: stringAt(row, "name", shipped.file, where, true)!,
        aliases: aliasesOf(row, shipped.file, where, "shipped", true),
        ...provenance(row, shipped.file, where),
        layer: "shipped",
      };
      byCode.set(code, venue);
      view.venues.push(venue);
    });
    arrayAt(doc, "not_venues", shipped.file, "the index", false).forEach((raw, i) => {
      const row = notVenueRow(raw, shipped.file, `not_venues[${i}]`, "shipped");
      notByName.set(normalizeName(row.name), row);
      view.not_venues.push(row);
    });
  }

  if (local) {
    const doc = objectAt(local.doc, local.file, "the index");
    onlyKeys(doc, VENUES_KEYS, local.file, "the index");
    const jurisdiction = stringAt(doc, "jurisdiction", local.file, "the index", false);
    const name = stringAt(doc, "name", local.file, "the index", false);
    compare(conflicts, "(index)", "jurisdiction", view.jurisdiction ?? undefined, jurisdiction);
    compare(conflicts, "(index)", "name", view.name ?? undefined, name);
    view.jurisdiction ??= jurisdiction ?? null;
    view.name ??= name ?? null;
    arrayAt(doc, "venues", local.file, "the index", false).forEach((raw, i) => {
      const where = `venues[${i}]`;
      const row = objectAt(raw, local.file, where);
      onlyKeys(row, VENUE_ROW_KEYS, local.file, where);
      checkStamp(row, local.file, where);
      const code = stringAt(row, "code", local.file, where, true)!;
      const aliases = aliasesOf(row, local.file, where, "local", false);
      const existing = byCode.get(code);
      if (existing) {
        if (existing.layer === "local") invalid(local.file, where, `code "${code}" appears twice`);
        compare(conflicts, code, "name", existing.name, stringAt(row, "name", local.file, where, false));
        unionAliases(existing.aliases, aliases);
        return;
      }
      // A venue learned only in the overlay is a full row.
      const venue: VenueRow = {
        code,
        name: stringAt(row, "name", local.file, where, true)!,
        aliases,
        ...provenance(row, local.file, where),
        layer: "local",
      };
      if (row.aliases === undefined) invalid(local.file, `${where}.aliases`, "is required on a venue learned only in the overlay");
      byCode.set(code, venue);
      view.venues.push(venue);
    });
    arrayAt(doc, "not_venues", local.file, "the index", false).forEach((raw, i) => {
      const row = notVenueRow(raw, local.file, `not_venues[${i}]`, "local");
      const existing = notByName.get(normalizeName(row.name));
      if (existing) {
        unionAliases(existing.aliases, row.aliases);
        return;
      }
      notByName.set(normalizeName(row.name), row);
      view.not_venues.push(row);
    });
  }

  view.venues.push(NO_VENUE_ROW);
  return view;
}

// ------------------------------------------------------------ kinds --

const KIND_ROW_KEYS = ["file", "name", "aliases", "recipient", ...STAMP_KEYS];

function recipientOf(row: Json, file: string, where: string, noVenue: boolean): string | undefined {
  if (!noVenue) {
    if (row.recipient !== undefined) invalid(file, `${where}.recipient`, "appears only under _NoVenue");
    return undefined;
  }
  const recipient = stringAt(row, "recipient", file, where, false);
  if (recipient !== undefined && !AUDIENCES.includes(recipient)) {
    invalid(file, `${where}.recipient`, `must be one of ${AUDIENCES.join(", ")}`);
  }
  return recipient;
}

export function mergeKinds(shipped: IndexSource | null, local: IndexSource | null, noVenue: boolean): KindsView {
  const conflicts: Conflict[] = [];
  const view: KindsView = { kinds: [], conflicts };
  const byFile = new Map<string, KindRow>();

  const rows = (source: IndexSource) => {
    const doc = objectAt(source.doc, source.file, "the index");
    onlyKeys(doc, ["kinds"], source.file, "the index");
    return arrayAt(doc, "kinds", source.file, "the index", true).map((raw, i) => {
      const where = `kinds[${i}]`;
      const row = objectAt(raw, source.file, where);
      onlyKeys(row, KIND_ROW_KEYS, source.file, where);
      checkStamp(row, source.file, where);
      const file = stringAt(row, "file", source.file, where, true)!;
      if (file.endsWith(".md")) {
        throw new DataServerError(
          `${source.file}: ${where}: kinds row file "${file}" must be the type file's name without ".md" ("${file.slice(0, -3)}")`,
          "grammar_violation"
        );
      }
      return { row, where, file };
    });
  };

  if (shipped) {
    for (const { row, where, file } of rows(shipped)) {
      if (byFile.has(file)) invalid(shipped.file, where, `file "${file}" appears twice`);
      const recipient = recipientOf(row, shipped.file, where, noVenue);
      if (noVenue && recipient === undefined) invalid(shipped.file, `${where}.recipient`, "is required under _NoVenue");
      const kind: KindRow = {
        file,
        name: stringAt(row, "name", shipped.file, where, true)!,
        aliases: aliasesOf(row, shipped.file, where, "shipped", true),
        ...(recipient ? { recipient } : {}),
        layer: "shipped",
      };
      byFile.set(file, kind);
      view.kinds.push(kind);
    }
  }

  if (local) {
    for (const { row, where, file } of rows(local)) {
      const aliases = aliasesOf(row, local.file, where, "local", false);
      const recipient = recipientOf(row, local.file, where, noVenue);
      const existing = byFile.get(file);
      if (existing) {
        if (existing.layer === "local") invalid(local.file, where, `file "${file}" appears twice`);
        compare(conflicts, file, "name", existing.name, stringAt(row, "name", local.file, where, false));
        compare(conflicts, file, "recipient", existing.recipient, recipient);
        unionAliases(existing.aliases, aliases);
        continue;
      }
      if (row.aliases === undefined) invalid(local.file, `${where}.aliases`, "is required on a kind learned only in the overlay");
      if (noVenue && recipient === undefined) invalid(local.file, `${where}.recipient`, "is required under _NoVenue");
      const kind: KindRow = {
        file,
        name: stringAt(row, "name", local.file, where, true)!,
        aliases,
        ...(recipient ? { recipient } : {}),
        layer: "local",
      };
      byFile.set(file, kind);
      view.kinds.push(kind);
    }
  }
  return view;
}

// ------------------------------------------------------------ resolve --

/** NFKC, case-fold, drop a leading "the", keep only letters and digits. */
export function normalizeName(name: string): string {
  const words = wordsOf(name);
  if (words.length > 1 && words[0] === "the") words.shift();
  return words.join("");
}

function wordsOf(text: string): string[] {
  return text.normalize("NFKC").toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
}

const VENUE_STOPWORDS = [["court"], ["tribunal"], ["of"], ["the"], ["british", "columbia"]];
const KIND_STOPWORDS = [["of"], ["the"], ["form"]];

function tokensOf(text: string, stopwords: string[][]): string[] {
  const words = wordsOf(text);
  const out: string[] = [];
  for (let i = 0; i < words.length; ) {
    const stop = stopwords.find((phrase) => phrase.every((word, k) => words[i + k] === word));
    if (stop) {
      i += stop.length;
      continue;
    }
    out.push(words[i]);
    i += 1;
  }
  return out;
}

/** The initials of the official name's capitalized words. */
function initialsOf(name: string): string {
  const words = name.normalize("NFKC").match(/[\p{L}\p{N}]+/gu) ?? [];
  return words.filter((word) => /^\p{Lu}/u.test(word)).map((word) => word[0]).join("").toLowerCase();
}

function withoutAffix(code: string, affix: string): string[] {
  if (affix === "" || code === affix) return [];
  const out: string[] = [];
  if (code.startsWith(affix)) out.push(code.slice(affix.length));
  if (code.endsWith(affix)) out.push(code.slice(0, code.length - affix.length));
  return out;
}

export type Rule = "jurisdiction_affix" | "acronym" | "token_containment";

export interface Candidate {
  code: string;
  name: string;
  rule: Rule;
}

type Via = "code" | "name" | "alias" | "not_venue";

export type Resolution =
  | { result: "resolved"; code: string; name: string; via: Via; row: VenueRow | KindRow; not_venue?: NotVenueRow }
  | { result: "near_miss"; candidates: Candidate[] }
  | { result: "not_found" }
  | { result: "ambiguous"; alias_split: Array<{ code: string; name: string; via: Via }> };

interface Entity {
  code: string;
  name: string;
  /** Every name equality is tested against, with how it matched. */
  names: Array<{ text: string; via: Via }>;
  row: VenueRow | KindRow;
  not_venue?: NotVenueRow;
  /** Whether the jurisdiction-affix rule may test this entity's code. */
  affix: boolean;
}

function resolveAmong(given: string, entities: Entity[], jurisdiction: string, stopwords: string[][]): Resolution {
  const n = normalizeName(given);
  if (n === "") throw new ValidationError(`resolve: ${JSON.stringify(given)} holds no letters or digits`);

  const equal: Array<{ entity: Entity; via: Via }> = [];
  for (const entity of entities) {
    const hit = entity.names.find((candidate) => normalizeName(candidate.text) === n);
    if (hit) equal.push({ entity, via: hit.via });
  }
  if (equal.length === 1) {
    const { entity, via } = equal[0];
    return {
      result: "resolved",
      code: entity.code,
      name: entity.name,
      via,
      row: entity.row,
      ...(entity.not_venue ? { not_venue: entity.not_venue } : {}),
    };
  }
  if (equal.length > 1) {
    return { result: "ambiguous", alias_split: equal.map(({ entity, via }) => ({ code: entity.code, name: entity.name, via })) };
  }

  const j = normalizeName(jurisdiction);
  const givenTokens = tokensOf(given, stopwords);
  const ours = new Set(givenTokens);
  const candidates: Candidate[] = [];
  const add = (entity: Entity, rule: Rule) => {
    if (!candidates.some((c) => c.code === entity.code && c.name === entity.name && c.rule === rule)) {
      candidates.push({ code: entity.code, name: entity.name, rule });
    }
  };
  for (const entity of entities) {
    // 1. Jurisdiction affix (venues only): CRT against BCCRT, or BC + name equal to a code.
    if (entity.affix) {
      const code = normalizeName(entity.code);
      if (withoutAffix(code, j).includes(n) || j + n === code) add(entity, "jurisdiction_affix");
    }
    // 2. Acronym: the initials of the official name's capitalized words, with or without the jurisdiction code.
    const initials = initialsOf(entity.name);
    if (initials !== "" && [initials, j + initials, initials + j, ...withoutAffix(initials, j)].includes(n)) add(entity, "acronym");
    // 3. Token containment, stopwords removed; a name left with no tokens yields no candidate.
    if (givenTokens.length > 0) {
      for (const { text, via } of entity.names) {
        if (via === "code") continue;
        const other = tokensOf(text, stopwords);
        if (other.length === 0) continue;
        const theirs = new Set(other);
        if (givenTokens.every((t) => theirs.has(t)) || other.every((t) => ours.has(t))) {
          add(entity, "token_containment");
          break;
        }
      }
    }
  }
  return candidates.length ? { result: "near_miss", candidates } : { result: "not_found" };
}

/** Resolve a venue name against a jurisdiction's merged index. The reserved _NoVenue row is never matched by name. */
export function resolveVenue(view: VenuesView, given: string, jurisdiction: string): Resolution {
  const entities: Entity[] = [];
  for (const row of view.venues) {
    if (row.reserved) continue;
    entities.push({
      code: row.code,
      name: row.name,
      names: [
        { text: row.code, via: "code" },
        { text: row.name, via: "name" },
        ...row.aliases.map((alias) => ({ text: alias.name, via: "alias" as const })),
      ],
      row,
      affix: true,
    });
  }
  for (const nv of view.not_venues) {
    entities.push({
      code: NO_VENUE,
      name: nv.name,
      names: [nv.name, ...nv.aliases.map((alias) => alias.name)].map((text) => ({ text, via: "not_venue" as const })),
      row: NO_VENUE_ROW,
      not_venue: nv,
      affix: false,
    });
  }
  return resolveAmong(given, entities, jurisdiction, VENUE_STOPWORDS);
}

/**
 * Resolve a kind name against a Documents\ folder's merged index. Under _NoVenue the
 * caller's `recipient` decides among kinds sharing an alias, and is required.
 */
export function resolveKind(view: KindsView, given: string, jurisdiction: string, noVenue: boolean, recipient: string | undefined): Resolution {
  if (noVenue && recipient === undefined) {
    throw new ValidationError(`a _NoVenue resolve needs \`recipient\` (${AUDIENCES.join(", ")})`);
  }
  if (!noVenue && recipient !== undefined) {
    throw new ValidationError("`recipient` applies only under _NoVenue; a venue's kinds carry no recipient");
  }
  if (recipient !== undefined && !AUDIENCES.includes(recipient)) {
    throw new ValidationError(`recipient must be one of ${AUDIENCES.join(", ")}`);
  }
  const entities: Entity[] = view.kinds
    .filter((row) => recipient === undefined || row.recipient === recipient)
    .map((row) => ({
      code: row.file,
      name: row.name,
      names: [
        { text: row.file, via: "code" as const },
        { text: row.name, via: "name" as const },
        ...row.aliases.map((alias) => ({ text: alias.name, via: "alias" as const })),
      ],
      row,
      affix: false,
    }));
  return resolveAmong(given, entities, jurisdiction, KIND_STOPWORDS);
}
