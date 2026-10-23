// The knowledge__* tools (spec §3.2, shared/knowledge-tree.md sections 4-10).
//
// knowledge__read and knowledge__list (plan Phase 7) merge the shipped and overlay
// layers: per file the shipped copy wins and a shadowed overlay copy is reported; index
// files merge by row. A document read also returns each item's effective status from
// the firm's confirmation sidecar and the session's memoized sources__check result, and
// a layout or format block validated with the firm's corrections substituted. Both are
// read-only.
//
// knowledge__write and knowledge__retire (plan Phase 8) write the firm's overlay only,
// each change under a lock file beside its target and by temp file plus rename. The
// only deletion is of a `_fetched\` PDF no excerpt records any more. Every result
// carries `shipped_from`, `plugin_version` and `build_stamp`, and nothing in the
// namespace touches the network: excerpts are checked against the fetch memo.

import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, unlinkSync } from "node:fs";
import { win32 as pathWin32 } from "node:path";

import { BUILD_STAMP } from "../build-stamp.js";
import { DataServerError, ValidationError } from "../errors.js";
import { assertContained } from "../files/scope.js";
import { resolveCaseDataRoot } from "../practice/backend.js";
import { pluginVersion, type ShippedFrom } from "../repo-root.js";
import { memoizedKnowledgeCheck, parseItems, readFrontMatter, sourcesListOf, type FrontMatter } from "../sources/check.js";
import { htmlBlocks, passagePresent, sourcesFetcher, type SourceFetcher } from "../sources/fetch.js";
import { admittedHost, readHostEntries } from "../sources/hosts.js";
import { firm_profile, type FirmProfile } from "../tools/practice/firm-profile.js";
import { extractJsonBlock, substituteLayout, validateTypeBlock, validateVenueBlock, citedItems, type BlockKind } from "./declared-layout.js";
import { formatRefs, substituteFormat, validateFormatBlock } from "./declared-format.js";
import {
  mergeKinds,
  mergeVenues,
  NO_VENUE,
  normalizeName,
  resolveKind,
  resolveVenue,
  STAMP_KEYS,
  type Conflict,
  type IndexSource,
  type KindsView,
  type Resolution,
  type VenuesView,
} from "./index.js";
import {
  effectiveStatus,
  parseSidecar,
  passageHash,
  upsertSidecarRow,
  withFileLock,
  writeTextAtomic,
  type EffectiveStatus,
  type SidecarRow,
  type StatusItem,
} from "./sidecar.js";
import {
  grammarProblem,
  identicalText,
  indexAt,
  inTree,
  joinRelative,
  KNOWLEDGE_SKILLS,
  locate,
  OVERLAY_RESERVED,
  parseKnowledgePath,
  readLayerBytes,
  readLayerDir,
  readLayerFiles,
  readServed,
  shippedLayer,
  SIDECAR_SUFFIX,
  entryType,
  type EntryType,
  type KnowledgePath,
  type KnowledgeSeams,
  type Layer,
  type LayerFile,
  type LayerRoot,
} from "./tree.js";

interface Provenance {
  shipped_from: ShippedFrom | null;
  plugin_version: string | null;
  build_stamp: string | null;
}

function provenance(shipped_from: ShippedFrom | null, seams: KnowledgeSeams): Provenance {
  return { shipped_from, plugin_version: pluginVersion(seams.installRoot), build_stamp: BUILD_STAMP };
}

function parseJson(file: LayerFile, label: string): unknown {
  try {
    return JSON.parse(file.text);
  } catch (err) {
    throw new DataServerError(`${label}: ${file.abs} is not valid JSON: ${(err as Error).message}`, "invalid_index");
  }
}

// ------------------------------------------------------------ index files --

const INDEX_NAMES = { venues: ["venues.json", "venues.local.json"], kinds: ["kinds.json", "kinds.local.json"] } as const;

/** The merged view of the index at a folder (a jurisdiction for `venues`, a Documents\ folder for `kinds`). */
function mergedIndex(folder: KnowledgePath, index: "venues" | "kinds", seams: KnowledgeSeams, label: string) {
  const problem = grammarProblem(folder.head, folder.rest, "dir", "shipped");
  if (problem) throw new DataServerError(`${label}: ${folder.path} breaks the folder grammar: ${problem}`, "grammar_violation");
  const [shippedName, localName] = INDEX_NAMES[index];
  const shippedKp = parseKnowledgePath(`${folder.path}/${shippedName}`, label);
  const localKp = parseKnowledgePath(`${folder.path}/${localName}`, label);
  const shipped = readLayerFiles(locate(shippedKp, seams, label), label).shipped;
  const loc = locate(localKp, seams, label);
  const local = readLayerFiles(loc, label).local;
  if (!shipped && !local) {
    throw new DataServerError(`${label}: no ${index} index at ${folder.path} in either layer`, "index_missing");
  }
  const source = (file: LayerFile | null): IndexSource | null => (file ? { doc: parseJson(file, label), file: file.abs } : null);
  const noVenue = index === "kinds" && folder.rest[2] === NO_VENUE;
  const view: VenuesView | KindsView =
    index === "venues" ? mergeVenues(source(shipped), source(local)) : mergeKinds(source(shipped), source(local), noVenue);
  return { view, layers: { shipped: shipped !== null, local: local !== null }, shipped_from: loc.shipped_from, noVenue };
}

/** Index rows whose local `name` a shipped one shadows (section 7), for the top level of an index result. */
function shadowedRows(conflicts: Conflict[]): Record<string, unknown> {
  const rows = conflicts.filter((conflict) => conflict.shadowed_local).map(({ key, shipped, local }) => ({ key, shipped, local }));
  return rows.length ? { shadowed_local: rows } : {};
}

// ------------------------------------------------------------ knowledge__read --

export interface KnowledgeReadResult extends Provenance {
  path: string;
  [key: string]: unknown;
}

function folderOf(kp: KnowledgePath, label: string): KnowledgePath {
  return parseKnowledgePath(kp.segments.slice(0, -1).join("/"), label);
}

/** Header fields: the front matter's single values (the learned-file notice is filled from these alone). */
function headerOf(front: FrontMatter | null): Record<string, string | null> {
  const header: Record<string, string | null> = {};
  for (const [key, value] of Object.entries(front ?? {})) {
    if (!Array.isArray(value)) header[key] = value;
  }
  return header;
}

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
function itemsOf(kp: KnowledgePath, front: FrontMatter | null, seams: KnowledgeSeams, label: string): { items: StatusItem[]; shadowed_sources: ShadowedSource[] } {
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
function blockKindOf(kp: KnowledgePath): { kind: BlockKind | "format"; noVenue: boolean } | null {
  const noVenue = kp.rest[2] === NO_VENUE;
  const name = kp.rest[kp.rest.length - 1];
  if (kp.skill === "draft" && kp.rest.length === 4 && name === "venue.md") return { kind: "venue", noVenue };
  if (kp.skill === "draft" && kp.rest.length === 5 && kp.rest[3] === "Documents" && name.endsWith(".md")) return { kind: "type", noVenue };
  if (kp.skill === "publish" && kp.rest.length === 4 && name === "format.md") return { kind: "format", noVenue };
  return null;
}

function sidecarRows(kp: KnowledgePath, seams: KnowledgeSeams, label: string) {
  const sidecarKp = parseKnowledgePath(`${kp.path}${SIDECAR_SUFFIX}`, label);
  const loc = locate(sidecarKp, seams, label);
  const type = entryType(loc.local, label, sidecarKp.path);
  if (type === null) return [];
  if (type === "dir") throw new DataServerError(`${label}: ${sidecarKp.path} is a folder, not a sidecar`, "invalid_sidecar");
  const text = readLayerBytes(loc.local.abs, label).toString("utf-8");
  const rows = parseSidecar(text.startsWith("\uFEFF") ? text.slice(1) : text, loc.local.abs, kp.path);
  // A Sources\ excerpt is not correctable: its wrong passage is fixed by refresh (shared/knowledge-tree.md section 10).
  if (kp.rest.length === 5 && kp.rest[3] === "Sources") {
    const i = rows.findIndex((row) => row.status === "corrected");
    if (i !== -1) {
      throw new DataServerError(
        `${loc.local.abs}: items[${i}]: rule_ref "${rows[i].rule_ref}" of ${kp.path} is corrected, but a Sources\\ excerpt is not correctable; its passage is fixed by refresh`,
        "invalid_sidecar"
      );
    }
  }
  return rows;
}

/**
 * Validate a layout or format block with the firm's corrections substituted, and cross-check its cited rule_refs.
 * knowledge__write runs it with no corrections, so a write refuses what a read would.
 */
function blockOf(kp: KnowledgePath, content: string, status: Pick<EffectiveStatus, "corrections">, items: StatusItem[]): Record<string, unknown> {
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

function rawResult(kp: KnowledgePath, file: LayerFile, shipped_from: ShippedFrom | null, seams: KnowledgeSeams): KnowledgeReadResult {
  return {
    path: kp.path,
    layer: file.layer,
    size: file.bytes.byteLength,
    content: file.text,
    ...provenance(shipped_from, seams),
  };
}

export function knowledgeRead(path: unknown, seams: KnowledgeSeams = {}): KnowledgeReadResult {
  const label = "knowledge__read.path";
  const kp = parseKnowledgePath(path, label);
  const name = kp.segments[kp.segments.length - 1];

  // Overlay-only entries: the reserved set and confirmation sidecars, served as they are.
  if (!kp.skill || name.endsWith(SIDECAR_SUFFIX)) {
    const problem = grammarProblem(kp.head, kp.rest, "file", "local");
    if (problem) throw new DataServerError(`${label}: ${kp.path} breaks the folder grammar: ${problem}`, "grammar_violation");
    const loc = locate(kp, seams, label);
    const { local } = readLayerFiles(loc, label);
    if (!local) throw new DataServerError(`${label} not found in the overlay: ${kp.path}`, "not_found");
    return rawResult(kp, local, loc.shipped_from, seams);
  }

  // Index files: callers never parse one; they read the merged view.
  const index = indexAt(kp);
  if (index) {
    const merged = mergedIndex(folderOf(kp, label), index, seams, label);
    return { path: kp.path, index, view: merged.view, layers: merged.layers, ...shadowedRows(merged.view.conflicts), ...provenance(merged.shipped_from, seams) };
  }

  const served = readServed(kp, seams, label);
  const content = served.served.text;
  const front = readFrontMatter(content, kp.path);
  const learnedBy = front?.learned_by;
  if (learnedBy !== undefined && learnedBy !== null && learnedBy !== "agent") {
    throw new DataServerError(`${kp.path}: learned_by is "agent" or absent, not ${JSON.stringify(learnedBy)}`, "invalid_front_matter");
  }
  const learned = learnedBy === "agent";
  const { items, shadowed_sources } = itemsOf(kp, front, seams, label);
  const status = effectiveStatus({
    items,
    rows: sidecarRows(kp, seams, label),
    practitionerConfirms: blockKindOf(kp)?.kind === "format",
    checked: memoizedKnowledgeCheck(kp.path)?.sources,
  });

  return {
    path: kp.path,
    layer: served.served.layer,
    size: served.served.bytes.byteLength,
    content,
    learned,
    header: headerOf(front),
    ...status,
    ...blockOf(kp, content, status, items),
    ...(served.shadowed
      ? { shadowed_local: { path: served.shadowed.abs, identical: identicalText(content, served.shadowed.text) } }
      : {}),
    ...(shadowed_sources.length ? { shadowed_sources } : {}),
    ...provenance(served.shipped_from, seams),
  };
}

// ------------------------------------------------------------ knowledge__list --

export interface ListEntry {
  path: string;
  type: EntryType;
  layers: Layer[];
  /** At the knowledge root, each skill folder's own shipped root. */
  shipped_from?: ShippedFrom;
}

export interface GrammarBreak {
  path: string;
  layer: Layer;
  reason: string;
}

export interface ListArgs {
  dir?: string;
  recursive?: boolean;
  resolve?: string;
  recipient?: string;
}

export function knowledgeList(args: ListArgs = {}, seams: KnowledgeSeams = {}): Record<string, unknown> {
  const label = "knowledge__list.dir";
  const kp = parseKnowledgePath(args.dir, label, true);
  if (args.resolve !== undefined) return resolveAt(kp, args.resolve, args.recipient, seams);
  if (args.recipient !== undefined) throw new ValidationError("knowledge__list.recipient applies only with `resolve`");

  const entries: ListEntry[] = [];
  const breaks: GrammarBreak[] = [];
  let shipped_from: ShippedFrom | null = null;
  if (kp.path === "") {
    listRoot(args.recursive === true, seams, entries, breaks);
  } else {
    shipped_from = walk(kp, args.recursive === true, seams, entries, breaks, true);
  }
  entries.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return { dir: kp.path, entries, grammar_breaks: breaks, ...provenance(shipped_from, seams) };
}

/** The knowledge root: each tree-owning skill, and the overlay's own top-level entries. */
function listRoot(recursive: boolean, seams: KnowledgeSeams, entries: ListEntry[], breaks: GrammarBreak[]): void {
  const label = "knowledge__list.dir";
  const root = parseKnowledgePath("", label, true);
  const overlay = readLayerDir(locate(root, seams, label).local, label, "(knowledge root)") ?? [];
  for (const skill of KNOWLEDGE_SKILLS) {
    const { layer, shipped_from } = shippedLayer(skill, [], seams);
    const layers: Layer[] = [];
    if (entryType(layer, label, skill) === "dir") layers.push("shipped");
    if (overlay.some((entry) => entry.name === skill && entry.type === "dir")) layers.push("local");
    if (layers.length === 0) continue;
    entries.push({ path: skill, type: "dir", layers, shipped_from });
    if (recursive) walk(parseKnowledgePath(skill, label), true, seams, entries, breaks, false);
  }
  for (const entry of overlay) {
    if (KNOWLEDGE_SKILLS.includes(entry.name) && entry.type === "dir") continue;
    if (!OVERLAY_RESERVED.includes(entry.name)) {
      breaks.push({ path: entry.name, layer: "local", reason: `"${entry.name}" is neither a skill with a knowledge tree nor a reserved entry (${OVERLAY_RESERVED.join(", ")})` });
      continue;
    }
    const problem = grammarProblem(entry.name, [], entry.type, "local");
    entries.push({ path: entry.name, type: entry.type, layers: ["local"] });
    if (problem) breaks.push({ path: entry.name, layer: "local", reason: problem });
    else if (recursive && entry.type === "dir") walk(parseKnowledgePath(entry.name, label), true, seams, entries, breaks, false);
  }
}

/** One folder of both layers, merged; recurses into grammar-conforming folders on request. Returns the folder's shipped_from. */
function walk(kp: KnowledgePath, recursive: boolean, seams: KnowledgeSeams, entries: ListEntry[], breaks: GrammarBreak[], top: boolean): ShippedFrom | null {
  const label = "knowledge__list.dir";
  const loc = locate(kp, seams, label);
  const shipped = readLayerDir(loc.shipped, label, kp.path);
  const local = readLayerDir(loc.local, label, kp.path);
  if (top && shipped === null && local === null) throw new DataServerError(`${label} not found in either layer: ${kp.path}`, "not_found");

  const merged = new Map<string, { name: string; types: Partial<Record<Layer, EntryType>> }>();
  const add = (layer: Layer, list: Array<{ name: string; type: EntryType }> | null) => {
    for (const entry of list ?? []) {
      // A shipped root holds the skill's ordinary references beside its tree; only country folders are the tree.
      if (layer === "shipped" && !inTree([...kp.rest, entry.name])) continue;
      const key = entry.name.toLowerCase();
      const known = merged.get(key) ?? { name: entry.name, types: {} };
      known.types[layer] = entry.type;
      merged.set(key, known);
    }
  };
  add("shipped", shipped);
  add("local", local);

  const indexedKinds =
    kp.skill && kp.rest.length === 4 && kp.rest[3] === "Documents" && grammarProblem(kp.head, kp.rest, "dir", "shipped") === null
      ? kindFiles(kp, seams)
      : null;
  for (const { name, types } of merged.values()) {
    const path = `${kp.path}/${name}`;
    const layers = (["shipped", "local"] as const).filter((layer) => types[layer] !== undefined);
    const type = types.shipped ?? types.local!;
    entries.push({ path, type, layers: [...layers] });
    let broken = false;
    if (types.shipped && types.local && types.shipped !== types.local) {
      breaks.push({ path, layer: "local", reason: `a ${types.local} in the overlay where the shipped tree has a ${types.shipped}` });
      broken = true;
    }
    for (const layer of layers) {
      const rest = [...kp.rest, name];
      const problem = grammarProblem(kp.head, rest, types[layer]!, layer);
      if (problem) {
        breaks.push({ path, layer, reason: problem });
        broken = true;
      } else if (indexedKinds && types[layer] === "file" && name.endsWith(".md") && !indexedKinds.has(name.slice(0, -3))) {
        breaks.push({ path, layer, reason: `no row of this folder's kinds index names "${name.slice(0, -3)}"` });
        broken = true;
      }
    }
    if (recursive && type === "dir" && !broken) walk(parseKnowledgePath(path, label), true, seams, entries, breaks, false);
  }
  return loc.shipped_from;
}

/** The kind files a Documents\ folder's merged index names; empty when it has no index. */
function kindFiles(documents: KnowledgePath, seams: KnowledgeSeams): Set<string> {
  try {
    const merged = mergedIndex(documents, "kinds", seams, "knowledge__list.dir");
    return new Set((merged.view as KindsView).kinds.map((row) => row.file));
  } catch (err) {
    if (err instanceof DataServerError && err.code === "index_missing") return new Set();
    throw err;
  }
}

// ------------------------------------------------------------ resolve --

function resolveAt(kp: KnowledgePath, given: string, recipient: string | undefined, seams: KnowledgeSeams): Record<string, unknown> {
  const label = "knowledge__list.dir";
  const atJurisdiction = kp.skill !== null && kp.rest.length === 2;
  const atDocuments = kp.skill !== null && kp.rest.length === 4 && kp.rest[3] === "Documents";
  if (!atJurisdiction && !atDocuments) {
    throw new ValidationError(
      `knowledge__list.resolve needs \`dir\` to be a jurisdiction folder (<skill>/<Country>/<Jurisdiction>, for a venue) ` +
        `or a Documents folder (<skill>/<Country>/<Jurisdiction>/<Venue>/Documents, for a kind); got "${kp.path}"`
    );
  }
  const problem = grammarProblem(kp.head, kp.rest, "dir", "shipped");
  if (problem) throw new DataServerError(`${label}: ${kp.path} breaks the folder grammar: ${problem}`, "grammar_violation");
  const jurisdiction = kp.rest[1];
  if (atJurisdiction) {
    if (recipient !== undefined) throw new ValidationError("knowledge__list.recipient applies only to a _NoVenue Documents folder");
    const merged = mergedIndex(kp, "venues", seams, label);
    const resolution: Resolution = resolveVenue(merged.view as VenuesView, given, jurisdiction);
    return { dir: kp.path, index: "venues", resolve: given, ...resolution, conflicts: merged.view.conflicts, ...shadowedRows(merged.view.conflicts), ...provenance(merged.shipped_from, seams) };
  }
  const noVenue = kp.rest[2] === NO_VENUE;
  const merged = mergedIndex(kp, "kinds", seams, label);
  const resolution = resolveKind(merged.view as KindsView, given, jurisdiction, noVenue, recipient);
  return {
    dir: kp.path,
    index: "kinds",
    resolve: given,
    ...(recipient !== undefined ? { recipient } : {}),
    ...resolution,
    conflicts: merged.view.conflicts,
    ...shadowedRows(merged.view.conflicts),
    ...provenance(merged.shipped_from, seams),
  };
}

// ------------------------------------------------------------ knowledge__write --
//
// Granted only to the /localize helper. It writes the firm's overlay and nothing else:
// a document file whole (create, with an explicit overwrite for a refresh), one index
// row, or one confirmation sidecar row (confirm, correct).

/**
 * The record contract's repo-run marker (shared/knowledge-tree.md section 8). A repo
 * session writes the shipped tree through the scratchpad and a reviewed commit (section
 * 9), never the overlay, and never confirms or corrects (section 10).
 */
export const REPO_RUN_MARKER = "repo-run";

/** The one reserved overlay entry knowledge__write writes: the firm's approved fetch hosts. */
const HOSTS_FILE = "_hosts.json";

/** The size cap on one document file written to the overlay. */
export const MAX_DOCUMENT_BYTES = 200 * 1024;

/** Header fields the runtime stamps on every overlay document it writes, replacing any the content carries. */
const STAMPED = ["learned_by", "matter", "plugin_version", "shipped_from"] as const;
type Stamp = Record<(typeof STAMPED)[number], string | null>;

export interface WriteSeams extends KnowledgeSeams {
  /** Tests only: the fetcher whose memo excerpts are checked against. Production uses the runtime's one fetcher. */
  fetcher?: SourceFetcher;
  /** The practice-data matters whose `matt_num` is the given number. Production wires practice_data__matter_lookup. */
  lookUpMatter?: (mattNum: string) => Promise<Record<string, unknown>[]>;
}

type Args = Record<string, unknown>;
type Json = Record<string, unknown>;

/** The live matter a write serves. The repo-run marker is refused: the overlay is written only from a matter session. */
function matterOf(raw: unknown, tool: string): string {
  if (typeof raw !== "string" || raw.trim() === "" || /[\r\n]/.test(raw)) {
    throw new ValidationError(`${tool}.matter must name, on one line, the live matter this run serves`);
  }
  if (raw.trim() === REPO_RUN_MARKER) {
    throw new DataServerError(
      `${tool}: a repo session never writes the firm overlay and never confirms or corrects: it writes the shipped tree ` +
        "through the scratchpad and a reviewed commit, and confirmation happens only in a matter session (shared/knowledge-tree.md sections 9 and 10)",
      "repo_session"
    );
  }
  return raw.trim();
}

/**
 * The matter number a document is stamped with: the `matt_num` of the one practice-data
 * matter the caller's `matter` names. The caller's string itself is never stamped, so a
 * style of cause or a party's name cannot reach the shared overlay.
 */
async function stampedMatter(matter: string, seams: WriteSeams, path: string): Promise<string> {
  if (!seams.lookUpMatter) throw new Error("knowledge__write: no practice-data matter lookup is wired");
  const rows = await seams.lookUpMatter(matter);
  if (rows.length !== 1 || typeof rows[0].matt_num !== "string") {
    throw new DataServerError(
      `${path}: matter_unknown: ${JSON.stringify(matter)} is not the matter number of exactly one practice-data matter ` +
        `(found ${rows.length}). Pass the live matter's number (e.g. L1234), never its name. Nothing was written.`,
      "matter_unknown"
    );
  }
  return rows[0].matt_num;
}

function refuseArgs(args: Args, keys: string[], why: string): void {
  const present = keys.filter((key) => args[key] !== undefined);
  if (present.length) throw new ValidationError(`knowledge__write: ${present.join(", ")} ${present.length === 1 ? "does" : "do"} not apply ${why}`);
}

function grammarCheck(kp: KnowledgePath, type: EntryType, label: string): void {
  const problem = grammarProblem(kp.head, kp.rest, type, "local");
  if (problem) throw new DataServerError(`${label}: ${kp.path} breaks the folder grammar: ${problem}`, "grammar_violation");
}

/**
 * Create `dir` and its missing parents, but only after proving that its deepest existing
 * ancestor's real path lies inside `root`, so a junction cannot put new folders outside it.
 */
function mkdirInside(root: string, dir: string, label: string, original: string): void {
  let existing = dir;
  while (!existsSync(existing)) {
    const parent = pathWin32.dirname(existing);
    if (parent === existing) break;
    existing = parent;
  }
  assertContained(root, realpathSync.native(existing), label, original);
  mkdirSync(dir, { recursive: true });
}

/** The overlay root's real path, created when absent and proven inside the case data root. */
function overlayCanon(seams: KnowledgeSeams, label: string): string {
  const root = parseKnowledgePath("", label, true);
  let layer = locate(root, seams, label).local;
  if (layer.canon === null) {
    mkdirInside(realpathSync.native(resolveCaseDataRoot(seams.env ?? process.env)), layer.abs, label, "(knowledge root)");
    layer = locate(root, seams, label).local;
  }
  return layer.canon!;
}

/** Where `kp` lives in the overlay, its folder created and proven inside the overlay root, as is any entry already there. */
function writableOverlayPath(kp: KnowledgePath, seams: KnowledgeSeams, label: string): LayerRoot & { canon: string } {
  locate(kp, seams, label); // the path-length check
  const canon = overlayCanon(seams, label);
  const abs = pathWin32.join(canon, ...kp.segments);
  mkdirInside(canon, pathWin32.dirname(abs), label, kp.path);
  assertContained(canon, realpathSync.native(pathWin32.dirname(abs)), label, kp.path);
  entryType({ canon, abs }, label, kp.path);
  return { canon, abs };
}

export async function knowledgeWrite(args: Args, seams: WriteSeams = {}): Promise<Record<string, unknown>> {
  const label = "knowledge__write.path";
  const matter = matterOf(args.matter, "knowledge__write");
  const kp = parseKnowledgePath(args.path, label);
  if (kp.path === HOSTS_FILE) return writeHostEntry(kp, args, seams, label);
  if (!kp.skill) {
    throw new DataServerError(
      `${label}: knowledge__write writes a skill's tree and ${HOSTS_FILE} only; "${kp.head}" is written by its own tool (knowledge__retire, sources__fetch) or by the practitioner`,
      "reserved_entry"
    );
  }
  const name = kp.segments[kp.segments.length - 1];
  if (args.operation === "confirm" || args.operation === "correct") return confirmItem(kp, args, args.operation, seams, label);
  if (args.operation !== "create") throw new ValidationError('knowledge__write.operation must be "create", "confirm" or "correct"');

  refuseArgs(args, ["rule_ref", "value"], "to create");
  if (name.endsWith(SIDECAR_SUFFIX)) {
    throw new DataServerError(`${label}: the ${SIDECAR_SUFFIX} suffix is reserved for confirm and correct, and create refuses it (${kp.path})`, "reserved_suffix");
  }
  if (name === "venues.json" || name === "kinds.json") {
    throw new DataServerError(`${label}: the overlay never holds ${name}; write one row to ${name.replace(".json", ".local.json")} beside it (${kp.path})`, "grammar_violation");
  }
  grammarCheck(kp, "file", label);
  const index = indexAt(kp);
  if (index) return writeIndexRow(kp, index, args, seams, label);
  return writeDocument(kp, args, matter, seams, label);
}

// ------------------------------------------------------------ documents --

/**
 * The content with the runtime's fields opening its front matter, replacing any it carried:
 * the provenance stamp (section 8), and a saved PDF copy's `pdf_sha256`.
 */
function stampHeader(content: string, stamp: Record<string, string | null>): string {
  const keys = Object.keys(stamp);
  const eol = content.includes("\r\n") ? "\r\n" : "\n";
  const lines = content.split(/\r?\n/);
  const end = lines.findIndex((line, i) => i > 0 && (line.trimEnd() === "---" || line.trimEnd() === "..."));
  const kept: string[] = [];
  for (let i = 1; i < end; i++) {
    const key = /^([A-Za-z_][A-Za-z0-9_-]*):/.exec(lines[i])?.[1];
    if (key !== undefined && keys.includes(key)) {
      // The key's own continuation lines (a block list or block scalar) go with it.
      while (i + 1 < end && (lines[i + 1].trim() === "" || /^\s/.test(lines[i + 1]))) i++;
      continue;
    }
    kept.push(lines[i]);
  }
  const header = keys.map((key) => `${key}: ${stamp[key] === null ? "null" : JSON.stringify(stamp[key])}`);
  return [lines[0], ...header, ...kept, ...lines.slice(end)].join(eol);
}

/** The joined text of a page's live memoized fetch, or a memo_expired refusal naming the URL (#989 item 2). */
function memoizedPage(path: string, pageUrl: string, fetcher: SourceFetcher): string {
  const memo = fetcher.memoized(pageUrl);
  if (memo === null || memo === "expired") {
    throw new DataServerError(
      `${path}: memo_expired: ${pageUrl} has no live memoized fetch in this session (${memo === null ? "never fetched" : "fetched over 24 hours ago"}); ` +
        "fetch it again with sources__fetch, then retry the write. Nothing was written.",
      "memo_expired"
    );
  }
  return htmlBlocks(memo.bytes.toString("utf-8")).join(" ");
}

/**
 * Every HTML-sourced item of a source record must appear in the memoized text of its page.
 * An item transcribed from a file (`checked_by: file_sha256`) is not checked here, nor is a
 * /publish property the practitioner sourced; any other item outside a record with a
 * `page_url` has nothing to be checked against and is refused.
 */
function checkExcerpts(path: string, front: FrontMatter, fetcher: SourceFetcher): void {
  const pageUrl = front.page_url;
  const items = parseItems(front, path).filter((item) => !item.fromFile && item.source !== "practitioner");
  if (items.length === 0) return;
  if (typeof pageUrl !== "string" || pageUrl === "") {
    throw new DataServerError(
      `${path}: rule_ref ${items.map((item) => JSON.stringify(item.rule_ref)).join(", ")} is neither transcribed from a file ` +
        "(checked_by: file_sha256) nor in a source record with a page_url, so its passage cannot be checked. Nothing was written.",
      "invalid_source_record"
    );
  }
  const joined = memoizedPage(path, pageUrl, fetcher);
  const missing = items.filter((item) => !passagePresent(joined, item.passage)).map((item) => JSON.stringify(item.rule_ref));
  if (missing.length) {
    throw new DataServerError(
      `${path}: excerpt_mismatch: the passage of rule_ref ${missing.join(", ")} is not in the memoized text of ${pageUrl}. Nothing was written.`,
      "excerpt_mismatch"
    );
  }
}

/** A currency marker as a date: ISO or "September 1, 2020". Any other marker is not ordered. */
function markerTime(marker: string): number {
  return /^(?:\d{4}-\d{2}-\d{2}|[A-Z][a-z]+ \d{1,2}, \d{4})$/.test(marker) ? Date.parse(marker) : NaN;
}

/** How a refresh's currency markers were compared: in order, not orderable (a marker that is not a date), or not at all. */
type StaleCheck = "compared" | "not_ordered" | "no_pattern";

/**
 * A refresh (an overwrite of a source record) is refused as `stale_body` when the page it
 * was fetched from shows a currency marker older than the one the file records (#989 item 4).
 * Returns how the markers were compared, or null when the new file is not a source record.
 */
function checkStaleBody(path: string, existingAbs: string, previous: string, front: FrontMatter, fetcher: SourceFetcher): StaleCheck | null {
  const pageUrl = front.page_url;
  if (typeof pageUrl !== "string") return null;
  const old = readFrontMatter(previous, `the existing overlay copy of ${path} at ${existingAbs}`);
  const recorded = old?.currency_marker;
  const pattern = old?.currency_marker_pattern;
  if (typeof pattern !== "string") return "no_pattern";
  if (typeof recorded !== "string") return "not_ordered";
  let regex: RegExp;
  try {
    regex = new RegExp(pattern, "g");
  } catch (err) {
    throw new DataServerError(`${path}: its recorded currency_marker_pattern is not a valid regular expression: ${(err as Error).message}`, "invalid_source_record");
  }
  const found = [...new Set([...memoizedPage(path, pageUrl, fetcher).matchAll(regex)].map((m) => (m.length > 1 ? (m[1] ?? "") : m[0])))];
  const times = found.map(markerTime);
  const recordedTime = markerTime(recorded);
  if (found.length === 0 || Number.isNaN(recordedTime) || times.some((time) => Number.isNaN(time))) return "not_ordered";
  if (Math.max(...times) < recordedTime) {
    throw new DataServerError(
      `${path}: stale_body: ${pageUrl} shows ${found.map((marker) => JSON.stringify(marker)).join(", ")}, older than the recorded currency marker ${JSON.stringify(recorded)}. Nothing was written.`,
      "stale_body"
    );
  }
  return "compared";
}

async function writeDocument(kp: KnowledgePath, args: Args, matter: string, seams: WriteSeams, label: string): Promise<Record<string, unknown>> {
  refuseArgs(args, ["row"], "to a document file");
  const mattNum = await stampedMatter(matter, seams, kp.path);
  const content = args.content;
  if (typeof content !== "string" || content.trim() === "") throw new ValidationError("knowledge__write.content must be the document's full text");
  if (!kp.path.endsWith(".md")) {
    throw new DataServerError(`${label}: knowledge__write creates .md documents and index rows only; ${kp.path} is neither`, "grammar_violation");
  }
  if (/\x00/.test(content)) throw new ValidationError("knowledge__write.content must be text; it holds a NUL character");
  const size = Buffer.byteLength(content, "utf-8");
  if (size > MAX_DOCUMENT_BYTES) {
    throw new DataServerError(`${kp.path}: ${size} bytes, over the ${MAX_DOCUMENT_BYTES}-byte cap on a knowledge document`, "too_large");
  }
  const loc = locate(kp, seams, label);
  if (loc.shipped && entryType(loc.shipped, label, kp.path) !== null) {
    throw new DataServerError(
      `${label}: ${kp.path} exists in the shipped tree, so the overlay never holds it: a firm correction is a correct row, ` +
        "and a shipped file changes only by a repo-session refresh",
      "shipped_path"
    );
  }
  const front = readFrontMatter(content, kp.path);
  if (!front) throw new DataServerError(`${kp.path}: a learned file opens with its front matter header (shared/knowledge-tree.md section 8)`, "invalid_front_matter");
  blockOf(kp, content, { corrections: [] }, itemsOf(kp, front, seams, label).items);
  const fetcher = seams.fetcher ?? sourcesFetcher;
  checkExcerpts(kp.path, front, fetcher);
  const saved = args.saved_copy === undefined ? null : savedCopyOf(args.saved_copy, kp.path, front, seams);

  const stamp: Stamp = { learned_by: "agent", matter: mattNum, plugin_version: pluginVersion(seams.installRoot), shipped_from: loc.shipped_from };
  const text = stampHeader(content, saved?.pdf ? { ...stamp, pdf_sha256: saved.pdf.sha256 } : stamp);
  const target = writableOverlayPath(kp, seams, label);
  const previous = await withFileLock(target.abs, () => {
    const existing = entryType(target, label, kp.path);
    if (existing === "dir") throw new DataServerError(`${label}: ${kp.path} is a folder in the overlay`, "not_a_file");
    if (existing === "file" && args.overwrite !== true) {
      throw new DataServerError(
        `${kp.path} already exists in the overlay: re-read it with knowledge__read and return that path, or pass overwrite: true to replace it`,
        "exists"
      );
    }
    const old = existing === "file" ? readFileSync(target.abs, "utf-8") : null;
    const stale_check = old === null ? null : checkStaleBody(kp.path, target.abs, old, front, fetcher);
    writeTextAtomic(target.abs, text);
    return { old, stale_check };
  });
  return {
    path: kp.path,
    layer: "local",
    status: previous.old === null ? "created" : "overwritten",
    size: Buffer.byteLength(text, "utf-8"),
    header: stamp,
    ...(previous.stale_check ? { stale_check: previous.stale_check } : {}),
    ...(saved ? { saved_copy: copySavedCopy(saved, seams, label) } : {}),
    fetched_deleted: previous.old === null ? [] : deleteUnreferencedPdfs(pdfHashesIn(previous.old), seams, label),
    ...provenance(loc.shipped_from, seams),
  };
}

// ------------------------------------------------------------ saved copies --

interface SavedCopy {
  /** The knowledge path the caller named, under `_inbox\`. */
  path: string;
  abs: string;
  /** Present when the file is a PDF: its hash and the `_fetched\` path it is copied to. */
  pdf: { sha256: string; to: KnowledgePath } | null;
}

/**
 * The practitioner's saved copy a source record's create names (#1143): a file under
 * `_inbox\`, proven there by its real path, read and hashed before anything is written.
 * A PDF (by its `%PDF-` bytes) goes to `_fetched\<host>\<first 12 hex>.pdf`, the host of
 * `pdf_url` when the record has one, else of `page_url`. Any other file is left unhashed.
 */
function savedCopyOf(raw: unknown, record: string, front: FrontMatter, seams: KnowledgeSeams): SavedCopy {
  const label = "knowledge__write.saved_copy";
  if (typeof raw !== "string") throw new ValidationError(`${label} must be the knowledge path of a file under _inbox`);
  const kp = parseKnowledgePath(raw, label);
  if (kp.head !== "_inbox" || kp.rest.length === 0) {
    throw new DataServerError(`${label}: ${kp.path} is not a file under _inbox, where the practitioner saves a copy`, "invalid_saved_copy");
  }
  grammarCheck(kp, "file", label);
  if (typeof front.page_url !== "string" || front.page_url === "") {
    throw new DataServerError(`${label}: ${record} is not a source record (its front matter has no page_url), so it takes no saved copy`, "invalid_saved_copy");
  }
  const url = typeof front.pdf_url === "string" ? front.pdf_url : front.page_url;
  const canon = overlayCanon(seams, label);
  const inboxAbs = pathWin32.join(canon, "_inbox");
  const abs = pathWin32.join(inboxAbs, ...kp.rest);
  const inboxCanon = existsSync(inboxAbs) ? realpathSync.native(inboxAbs) : null;
  if (inboxCanon !== null) assertContained(canon, inboxCanon, label, kp.path);
  const type = entryType({ canon: inboxCanon, abs }, label, kp.path);
  if (type === null) throw new DataServerError(`${label}: ${kp.path} is not in the overlay`, "not_found");
  if (type === "dir") throw new DataServerError(`${label}: ${kp.path} is a folder; name the saved file`, "not_a_file");
  const bytes = readLayerBytes(abs, label);
  if (bytes.subarray(0, 5).toString("latin1") !== "%PDF-") {
    if (front.pdf_sha256 !== undefined) {
      throw new DataServerError(`${label}: ${kp.path} is not a PDF, so ${record} records no pdf_sha256 for it; remove the field`, "invalid_saved_copy");
    }
    return { path: kp.path, abs, pdf: null };
  }
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    throw new ValidationError(`${record}: ${JSON.stringify(url)} is not a URL, so the saved copy has no host folder`);
  }
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const to = parseKnowledgePath(`_fetched/${host}/${sha256.slice(0, 12)}.pdf`, label);
  grammarCheck(to, "file", label);
  return { path: kp.path, abs, pdf: { sha256, to } };
}

/**
 * Copy a saved PDF into `_fetched\` once its record is written, leaving the original in
 * `_inbox\`: a file Probanda did not create is only ever read or copied, never moved. The
 * record already holds its hash, so a failed copy is reported in the result, not thrown.
 */
function copySavedCopy(saved: SavedCopy, seams: KnowledgeSeams, label: string): Record<string, unknown> {
  if (!saved.pdf) return { path: saved.path, copied: false, reason: "not_pdf" };
  try {
    copyFileSync(saved.abs, writableOverlayPath(saved.pdf.to, seams, label).abs);
  } catch (err) {
    const code = (err as { code?: unknown }).code;
    if (typeof code !== "string") throw err;
    return { path: saved.path, copied: false, error: code };
  }
  return { path: saved.path, copied: true, to: saved.pdf.to.path, sha256: saved.pdf.sha256 };
}

// ------------------------------------------------------------ fetched PDFs --

const PDF_SHA_LINE = /^\s*pdf_sha256:\s*["']?([0-9a-fA-F]{64})["']?\s*$/gm;

function pdfHashesIn(text: string): string[] {
  return [...new Set([...text.matchAll(PDF_SHA_LINE)].map((m) => m[1].toLowerCase()))];
}

/**
 * The text of every live knowledge file: each skill tree in the overlay and in the shipped
 * layer, never `_superseded`, `_fetched` or `_inbox`.
 */
function liveKnowledgeTexts(canon: string, seams: KnowledgeSeams): string[] {
  const texts: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const abs = pathWin32.join(dir, entry.name);
      if (entry.isDirectory()) walk(abs);
      else if (entry.isFile() && entry.name.endsWith(".md")) texts.push(readFileSync(abs, "utf-8").toLowerCase());
    }
  };
  for (const skill of KNOWLEDGE_SKILLS) {
    const dir = pathWin32.join(canon, skill);
    if (existsSync(dir)) walk(dir);
    // A shipped root holds the skill's ordinary references beside its tree; only country folders are the tree.
    const shipped = shippedLayer(skill, [], seams).layer.canon;
    if (shipped === null) continue;
    for (const entry of readdirSync(shipped, { withFileTypes: true })) {
      if (entry.isDirectory() && inTree([entry.name])) walk(pathWin32.join(shipped, entry.name));
    }
  }
  return texts;
}

/**
 * After a retire or a refresh took `hashes` out of a file, delete each
 * `_fetched\<host>\<first 12>.pdf` whose hash no live excerpt, overlay or shipped, records
 * any more. The overlay's only deletion (shared/knowledge-tree.md section 6).
 */
function deleteUnreferencedPdfs(hashes: string[], seams: KnowledgeSeams, label: string): string[] {
  if (hashes.length === 0) return [];
  const canon = overlayCanon(seams, label);
  const fetched = pathWin32.join(canon, "_fetched");
  if (!existsSync(fetched)) return [];
  const live = liveKnowledgeTexts(canon, seams);
  const deleted: string[] = [];
  for (const hash of hashes) {
    if (live.some((text) => text.includes(hash))) continue;
    for (const host of readdirSync(fetched, { withFileTypes: true })) {
      if (!host.isDirectory()) continue;
      const name = `${hash.slice(0, 12)}.pdf`;
      const pdf = pathWin32.join(fetched, host.name, name);
      if (!existsSync(pdf)) continue;
      try {
        unlinkSync(pdf);
      } catch (err) {
        // A concurrent retire or refresh deleted it first.
        if ((err as NodeJS.ErrnoException).code === "ENOENT") continue;
        throw err;
      }
      deleted.push(`_fetched/${host.name}/${name}`);
    }
  }
  return deleted;
}

// ------------------------------------------------------------ index rows --

type IndexList = "venues" | "not_venues" | "kinds";

function rowString(row: Json, key: string): string {
  const value = row[key];
  if (typeof value !== "string" || value === "") throw new ValidationError(`knowledge__write.row.${key} must be a non-empty string`);
  return value;
}

/** The list a row belongs to and its key there: `code`, the normalized not-venue `name`, or `file`. */
function listAndKey(index: "venues" | "kinds", row: Json): { list: IndexList; key: string } {
  if (index === "kinds") return { list: "kinds", key: rowString(row, "file") };
  if (row.resolves_to !== undefined) return { list: "not_venues", key: normalizeName(rowString(row, "name")) };
  return { list: "venues", key: rowString(row, "code") };
}

function keyIn(list: IndexList, row: unknown): string | null {
  if (typeof row !== "object" || row === null) return null;
  const value = (row as Json)[list === "venues" ? "code" : list === "kinds" ? "file" : "name"];
  if (typeof value !== "string") return null;
  return list === "not_venues" ? normalizeName(value) : value;
}

/**
 * A row's aliases against the merged view without it (section 4): no alias twice, none
 * already in `taken`, none equal after normalization to one of `official` (the codes,
 * file names and official names). Under _NoVenue the caller passes as `taken` only the
 * aliases of kinds with the same recipient, because a shared alias sits on each audience kind.
 */
function checkAliases(row: Json, official: string[], taken: string[], file: string): void {
  const officialSet = new Set(official.map(normalizeName));
  const takenSet = new Set(taken.map(normalizeName));
  const seen = new Set<string>();
  for (const alias of Array.isArray(row.aliases) ? row.aliases : []) {
    const name = typeof alias === "object" && alias !== null ? (alias as Json).name : undefined;
    if (typeof name !== "string") continue; // the merge below refuses the malformed alias
    const n = normalizeName(name);
    if (seen.has(n) || takenSet.has(n)) {
      throw new DataServerError(`${file}: alias ${JSON.stringify(name)} is already an alias in this index; a duplicate alias is refused`, "duplicate_alias");
    }
    if (officialSet.has(n)) {
      throw new DataServerError(
        `${file}: alias ${JSON.stringify(name)} equals, after normalization, a code, file name or official name in this index`,
        "alias_collision"
      );
    }
    seen.add(n);
  }
}

function checkIndexRow(kp: KnowledgePath, view: VenuesView | KindsView, list: IndexList, key: string, row: Json, noVenue: boolean, file: string): void {
  if (list === "kinds") {
    const kinds = (view as KindsView).kinds;
    if (key.endsWith(".md")) {
      throw new DataServerError(`${file}: kinds row file "${key}" must be the type file's name without ".md" ("${key.slice(0, -3)}")`, "grammar_violation");
    }
    const problem = grammarProblem(kp.head, [...kp.rest.slice(0, 4), `${key}.md`], "file", "local");
    if (problem) throw new DataServerError(`${file}: kind file "${key}" is not a tree file name: ${problem}`, "grammar_violation");
    const shipped = kinds.find((kind) => kind.file === key && kind.layer === "shipped");
    if (shipped && row.name !== undefined) {
      throw new DataServerError(`${file}: kind "${key}" ships; the overlay may add aliases to it but never its name`, "shipped_name");
    }
    const recipient = typeof row.recipient === "string" ? row.recipient : shipped?.recipient;
    const peers = noVenue ? kinds.filter((kind) => kind.recipient === recipient) : kinds;
    const official = [...kinds.flatMap((kind) => [kind.file, kind.name]), key, ...(typeof row.name === "string" ? [row.name] : [])];
    checkAliases(row, official, peers.flatMap((kind) => kind.aliases.map((alias) => alias.name)), file);
    return;
  }
  const venues = view as VenuesView;
  if (list === "venues") {
    if (key === NO_VENUE) throw new DataServerError(`${file}: the ${NO_VENUE} row is never stored; the runtime adds it`, "invalid_index");
    const problem = grammarProblem(kp.head, [kp.rest[0], kp.rest[1], key], "dir", "local");
    if (problem) throw new DataServerError(`${file}: venue code "${key}" is its folder name, and ${problem}`, "grammar_violation");
    if (row.name !== undefined && venues.venues.some((venue) => venue.code === key && venue.layer === "shipped" && !venue.reserved)) {
      throw new DataServerError(`${file}: venue "${key}" ships; the overlay may add aliases to it but never its name`, "shipped_name");
    }
  }
  const real = venues.venues.filter((venue) => !venue.reserved);
  const official = [
    ...real.flatMap((venue) => [venue.code, venue.name]),
    ...venues.not_venues.map((ruling) => ruling.name),
    ...(typeof row.code === "string" ? [row.code] : []),
    ...(typeof row.name === "string" ? [row.name] : []),
  ];
  const taken = [...real, ...venues.not_venues].flatMap((entry) => entry.aliases.map((alias) => alias.name));
  checkAliases(row, official, taken, file);
}

async function writeIndexRow(kp: KnowledgePath, index: "venues" | "kinds", args: Args, seams: WriteSeams, label: string): Promise<Record<string, unknown>> {
  refuseArgs(args, ["content", "overwrite", "saved_copy"], "to an index file, which is written one row at a time");
  const given = args.row;
  if (typeof given !== "object" || given === null || Array.isArray(given)) throw new ValidationError("knowledge__write.row must be one index row (an object)");
  const callerStamp = STAMP_KEYS.filter((field) => Object.hasOwn(given, field));
  if (callerStamp.length) {
    throw new ValidationError(
      `knowledge__write.row: ${callerStamp.join(", ")} ${callerStamp.length === 1 ? "is not a caller field" : "are not caller fields"} of an index row; ` +
        "the runtime stamps plugin_version and shipped_from"
    );
  }
  const { list, key } = listAndKey(index, given as Json);
  const folder = folderOf(kp, label);
  const noVenue = index === "kinds" && kp.rest[2] === NO_VENUE;
  const shippedKp = parseKnowledgePath(`${folder.path}/${INDEX_NAMES[index][0]}`, label);
  const shippedFile = readLayerFiles(locate(shippedKp, seams, label), label).shipped;
  const shipped: IndexSource | null = shippedFile ? { doc: parseJson(shippedFile, label), file: shippedFile.abs } : null;
  const merge = (doc: Json, file: string): VenuesView | KindsView =>
    index === "venues" ? mergeVenues(shipped, { doc, file }) : mergeKinds(shipped, { doc, file }, noVenue);
  const loc = locate(kp, seams, label);
  // The writer's stamp, per row (#992 item 9): the row is the write unit, and each writer's row keeps its own.
  // A skill-tree path always has a shipped layer, so shipped_from is never null here.
  const row: Json = { ...(given as Json), plugin_version: pluginVersion(seams.installRoot), shipped_from: loc.shipped_from };
  const target = writableOverlayPath(kp, seams, label);

  return withFileLock(target.abs, () => {
    const existing = entryType(target, label, kp.path);
    let doc: Json = {};
    if (existing === "file") {
      const text = readFileSync(target.abs, "utf-8");
      try {
        doc = JSON.parse(text.startsWith("\uFEFF") ? text.slice(1) : text) as Json;
      } catch (err) {
        throw new DataServerError(`${label}: ${target.abs} is not valid JSON: ${(err as Error).message}`, "invalid_index");
      }
      merge(doc, target.abs); // the file as it stands must validate before a row joins it
    }
    const rows = Array.isArray(doc[list]) ? [...(doc[list] as unknown[])] : [];
    const at = rows.findIndex((known) => keyIn(list, known) === key);
    const without = rows.filter((_, i) => i !== at);
    checkIndexRow(kp, merge({ ...doc, [list]: without }, target.abs), list, key, row as Json, noVenue, target.abs);
    if (at === -1) rows.push(row);
    else rows[at] = row;
    const next = { ...doc, [list]: rows };
    const view = merge(next, target.abs);
    writeTextAtomic(target.abs, JSON.stringify(next, null, 2) + "\n");
    return { path: kp.path, index, list, key, status: at === -1 ? "created" : "updated", view, ...provenance(loc.shipped_from, seams) };
  });
}

// ------------------------------------------------------------ firm hosts --

/** The official-source categories a firm host is approved under (#948 item 5): the venue's own publications, the official statute publisher, a regulator. */
const HOST_CATEGORIES: readonly string[] = ["venue", "statute", "regulator"];

/** A DNS name of two or more labels whose last label is not all digits, so never an IP address, a port or a URL. */
const HOSTNAME = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?=[a-z0-9-]*[a-z])[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

/**
 * Record the practitioner's yes to a fetch host: one `{host, category, page_url}` row, to
 * which the runtime adds `added` and `approved_by: "practitioner"` (#989 section 6). Keyed
 * by host under a lock; an entry already there for the host is left as it is.
 */
async function writeHostEntry(kp: KnowledgePath, args: Args, seams: WriteSeams, label: string): Promise<Record<string, unknown>> {
  if (args.operation !== "create") throw new ValidationError(`knowledge__write: ${HOSTS_FILE} takes operation "create" with one row`);
  refuseArgs(args, ["content", "overwrite", "rule_ref", "value", "saved_copy"], `to ${HOSTS_FILE}, which is written one host row at a time`);
  const row = args.row;
  if (typeof row !== "object" || row === null || Array.isArray(row)) {
    throw new ValidationError(`knowledge__write.row must be one ${HOSTS_FILE} entry: {host, category, page_url}`);
  }
  const extra = Object.keys(row).filter((key) => !["host", "category", "page_url"].includes(key));
  if (extra.length) throw new ValidationError(`knowledge__write.row: ${extra.join(", ")} is not a caller field of a ${HOSTS_FILE} entry; the runtime stamps added and approved_by`);
  const host = rowString(row as Json, "host").toLowerCase();
  if (!HOSTNAME.test(host)) throw new ValidationError(`knowledge__write.row.host must be a hostname, such as civilresolutionbc.ca; got ${JSON.stringify((row as Json).host)}`);
  const category = rowString(row as Json, "category");
  if (!HOST_CATEGORIES.includes(category)) {
    throw new ValidationError(`knowledge__write.row.category must be one of ${HOST_CATEGORIES.join(", ")} (the admitted official sources); got ${JSON.stringify(category)}`);
  }
  const page_url = rowString(row as Json, "page_url");

  const target = writableOverlayPath(kp, seams, label);
  return withFileLock(target.abs, () => {
    if (entryType(target, label, kp.path) === "dir") throw new DataServerError(`${label}: ${kp.path} is a folder in the overlay`, "not_a_file");
    const entries = readHostEntries(target.abs);
    const known = entries.find((entry) => typeof entry === "object" && entry !== null && String((entry as Json).host).toLowerCase() === host);
    if (known && admittedHost(known) === null) {
      throw new DataServerError(
        `${target.abs}: the entry for ${host} lacks a category or approved_by "practitioner", so it is not admitted, and only the practitioner corrects it by hand. Nothing was written.`,
        "invalid_hosts_file"
      );
    }
    if (known) return { path: kp.path, host, status: "exists", entry: known, ...provenance(null, seams) };
    const entry = { host, category, page_url, added: today(), approved_by: "practitioner" };
    writeTextAtomic(target.abs, JSON.stringify([...entries, entry], null, 2) + "\n");
    return { path: kp.path, host, status: "created", entry, ...provenance(null, seams) };
  });
}

// ------------------------------------------------------------ confirm and correct --

function today(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

/** What a roster-lawyer check guards, as its refusals word it: `unset` finishes "so ...", `act`
 * finishes "only a roster lawyer ...", and `why` follows it on the not-a-lawyer refusal. */
export interface LawyerAct {
  unset: string;
  act: string;
  why: string;
}

const CONFIRM_ACT: LawyerAct = { unset: "a confirmation has no author", act: "confirms or corrects", why: ", because a confirmation lifts the filed refusal" };

/** This machine's `person`, which must be an active lawyer on the firm roster (section 10). Shared
 * with the Sent write (submission/forms/sent-write.ts). */
export function rosterLawyer(profile: FirmProfile, what: LawyerAct): string {
  if (profile.person === null) {
    throw new DataServerError(
      `person is not set: this machine's probanda.json names no firm roster key ("person"), so ${what.unset}. ` +
        "Set it with practice_data__upsert_firm_profile, then retry.",
      "person_unset"
    );
  }
  const entry = profile.roster.find((candidate) => candidate.key === profile.person);
  const role = entry?.role;
  if (role !== "lawyer") {
    throw new DataServerError(
      `person "${profile.person}" is ${role === "staff" ? "staff" : `not a lawyer (role ${JSON.stringify(role)})`} on the firm roster; ` +
        `only a roster lawyer ${what.act}${what.why}`,
      "not_a_lawyer"
    );
  }
  if (entry!.active === false) {
    throw new DataServerError(
      `person "${profile.person}" (${String(entry!.name)}) is a lawyer marked inactive on the firm roster; only an active roster lawyer ${what.act}`,
      "not_active"
    );
  }
  return profile.person;
}

/** `by`: this machine's `person`, which must be a lawyer on the firm roster (section 10). */
async function confirmingLawyer(env: NodeJS.ProcessEnv): Promise<string> {
  return rosterLawyer(await firm_profile(env), CONFIRM_ACT);
}

/** Substitute every correction into the merged file's block and run that tree's validator, failing hard. */
function validateCorrections(kp: KnowledgePath, content: string, kind: BlockKind | "format", noVenue: boolean, rows: SidecarRow[]): void {
  const corrections = rows.filter((row) => row.status === "corrected").map(({ rule_ref, value }) => ({ rule_ref, value }));
  if (kind === "format") {
    substituteFormat(extractJsonBlock(content, kp.path, false, "invalid_format") as Json, corrections, kp.path);
  } else {
    substituteLayout(extractJsonBlock(content, kp.path, true) as Json, kind, corrections, kp.path, { noVenue });
  }
}

async function confirmItem(kp: KnowledgePath, args: Args, operation: "confirm" | "correct", seams: WriteSeams, label: string): Promise<Record<string, unknown>> {
  refuseArgs(args, ["content", "row", "overwrite", "saved_copy"], `to ${operation}`);
  if (operation === "confirm") refuseArgs(args, ["value"], "to confirm; value appears only on a correction");
  else if (!Object.hasOwn(args, "value")) {
    throw new ValidationError("knowledge__write.value is required to correct: the item's value, in the shape its file contract declares");
  }
  const ruleRef = args.rule_ref;
  if (typeof ruleRef !== "string" || ruleRef === "") throw new ValidationError(`knowledge__write.rule_ref is required to ${operation}`);
  if (kp.path.endsWith(SIDECAR_SUFFIX)) throw new DataServerError(`${label}: name the knowledge file itself; its sidecar follows from it (${kp.path})`, "reserved_suffix");
  if (indexAt(kp)) throw new DataServerError(`${label}: ${kp.path} is an index file, whose rows carry no rule_ref`, "not_confirmable");

  const by = await confirmingLawyer(seams.env ?? process.env);
  const served = readServed(kp, seams, label);
  const content = served.served.text;
  const { items } = itemsOf(kp, readFrontMatter(content, kp.path), seams, label);
  const item = items.find((candidate) => candidate.rule_ref === ruleRef);
  if (!item) {
    throw new DataServerError(`${kp.path}: no item of the merged file carries rule_ref ${JSON.stringify(ruleRef)}`, "rule_ref_not_found");
  }
  const kindOf = blockKindOf(kp);
  if (operation === "correct") {
    if (kp.rest.length === 5 && kp.rest[3] === "Sources") {
      throw new DataServerError(`${kp.path}: a Sources\\ excerpt is not correctable; its passage is fixed by refresh`, "not_correctable");
    }
    if (!kindOf) {
      throw new DataServerError(
        `${kp.path}: the runtime holds no validator for this file's contract, so its items are not correctable here ` +
          "(a /draft type file or venue.md, or a /publish format.md, is)",
        "not_correctable"
      );
    }
  }

  const row: SidecarRow = {
    rule_ref: ruleRef,
    status: operation === "confirm" ? "confirmed" : "corrected",
    by,
    on: today(),
    confirmed_against: { passage_hash: passageHash(item.passage), currency: item.currency },
    ...(operation === "correct" ? { value: args.value } : {}),
    // The writer's stamp (#992 item 9): the plugin that served the copy the passage hash binds to.
    // A skill-tree path always has a shipped layer, so shipped_from is never null here.
    plugin_version: pluginVersion(seams.installRoot),
    shipped_from: served.shipped_from!,
  };
  const sidecarKp = parseKnowledgePath(`${kp.path}${SIDECAR_SUFFIX}`, label);
  grammarCheck(sidecarKp, "file", label);
  const target = writableOverlayPath(sidecarKp, seams, label);
  const rows = await upsertSidecarRow(target.abs, kp.path, row, (next) => {
    if (operation === "correct") validateCorrections(kp, content, kindOf!.kind, kindOf!.noVenue, next);
  });
  return { path: kp.path, sidecar: sidecarKp.path, row, rows: rows.length, ...provenance(served.shipped_from, seams) };
}

// ------------------------------------------------------------ knowledge__retire --

interface Retired {
  path: string;
  to: string;
  sidecar_to?: string;
  pdf_hashes: string[];
}

/** Move one overlay file, and its sidecar with it, to `_superseded\<same path>`. */
async function retireOne(kp: KnowledgePath, seams: KnowledgeSeams, label: string): Promise<Retired> {
  if (entryType(locate(kp, seams, label).local, label, kp.path) === null) {
    throw new DataServerError(`${kp.path} is not in the overlay (a second retire getting not_found counts as done)`, "not_found");
  }
  const dest = parseKnowledgePath(`_superseded/${kp.path}`, label);
  grammarCheck(dest, "file", label);
  const source = writableOverlayPath(kp, seams, label);
  const sidecar = `${source.abs}${SIDECAR_SUFFIX}`;
  // Both locks before any check, so a concurrent confirm cannot write a sidecar beside a file being retired.
  return withFileLock(source.abs, () =>
    withFileLock(sidecar, () => {
      const type = entryType(source, label, kp.path);
      if (type === null) throw new DataServerError(`${kp.path} is not in the overlay (a second retire getting not_found counts as done)`, "not_found");
      if (type === "dir") throw new DataServerError(`${label}: ${kp.path} is a folder; retire moves one file and its sidecar`, "not_a_file");
      const hasSidecar = existsSync(sidecar);
      const to = pathWin32.join(source.canon, ...dest.segments);
      for (const abs of [to, ...(hasSidecar ? [`${to}${SIDECAR_SUFFIX}`] : [])]) {
        if (existsSync(abs)) {
          throw new DataServerError(`${abs} already holds a retired copy, which is never overwritten; nothing was moved`, "superseded_exists");
        }
      }
      // The destination folder is made only now, once the move is certain, so a refused retire leaves none behind.
      const target = writableOverlayPath(dest, seams, label);
      const text = readFileSync(source.abs, "utf-8");
      renameSync(source.abs, target.abs);
      if (hasSidecar) renameSync(sidecar, `${target.abs}${SIDECAR_SUFFIX}`);
      return {
        path: kp.path,
        to: dest.path,
        ...(hasSidecar ? { sidecar_to: `${dest.path}${SIDECAR_SUFFIX}` } : {}),
        pdf_hashes: pdfHashesIn(text),
      };
    })
  );
}

/** A file the sweep left in place because `_superseded\` already holds a retired copy of it. */
interface Skipped {
  path: string;
  reason: string;
}

/**
 * The sweep: every overlay file whose shipped copy is identical after line-ending
 * normalization. A file whose retired copy already exists is skipped and reported; the sweep goes on.
 */
async function retireShadowed(seams: KnowledgeSeams, label: string): Promise<{ retired: Retired[]; skipped: Skipped[] }> {
  const listing = knowledgeList({ recursive: true }, seams);
  const broken = new Set((listing.grammar_breaks as GrammarBreak[]).map((entry) => entry.path));
  const retired: Retired[] = [];
  const skipped: Skipped[] = [];
  for (const entry of listing.entries as ListEntry[]) {
    if (entry.type !== "file" || entry.layers.length !== 2 || broken.has(entry.path)) continue;
    const kp = parseKnowledgePath(entry.path, label);
    const { shipped, local } = readLayerFiles(locate(kp, seams, label), label);
    if (!shipped || !local || !identicalText(shipped.text, local.text)) continue;
    try {
      retired.push(await retireOne(kp, seams, label));
    } catch (err) {
      if (!(err instanceof DataServerError && err.code === "superseded_exists")) throw err;
      skipped.push({ path: entry.path, reason: err.message });
    }
  }
  return { retired, skipped };
}

/**
 * knowledge__retire: move one overlay file and its sidecar to `_superseded\`, or with
 * `shadowed_only: true` sweep every overlay file the shipped tree now holds identically.
 * Then delete each `_fetched\` PDF whose hash no live excerpt records any more.
 */
export async function knowledgeRetire(args: Args, seams: WriteSeams = {}): Promise<Record<string, unknown>> {
  const label = "knowledge__retire.path";
  matterOf(args.matter, "knowledge__retire");
  let retired: Retired[];
  let skipped: Skipped[] | null = null;
  if (args.shadowed_only === true) {
    if (args.path !== undefined) throw new ValidationError("knowledge__retire.shadowed_only sweeps the whole overlay; pass no path");
    ({ retired, skipped } = await retireShadowed(seams, label));
  } else {
    const kp = parseKnowledgePath(args.path, label);
    if (!kp.skill) throw new DataServerError(`${label}: knowledge__retire moves a skill tree's file; "${kp.head}" is not one`, "reserved_entry");
    if (kp.path.endsWith(SIDECAR_SUFFIX)) throw new DataServerError(`${label}: a sidecar moves with its file; name the file (${kp.path})`, "reserved_suffix");
    grammarCheck(kp, "file", label);
    retired = [await retireOne(kp, seams, label)];
  }
  const hashes = [...new Set(retired.flatMap((entry) => entry.pdf_hashes))];
  return {
    retired: retired.map(({ pdf_hashes: _hashes, ...entry }) => entry),
    ...(skipped ? { skipped } : {}),
    fetched_deleted: deleteUnreferencedPdfs(hashes, seams, label),
    ...provenance(null, seams),
  };
}
