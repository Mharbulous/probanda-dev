// ------------------------------------------------------------ knowledge__list --

import { DataServerError, ValidationError } from "../errors.js";
import type { ShippedFrom } from "../repo-root.js";
import { NO_VENUE, resolveKind, resolveVenue, type KindsView, type Resolution, type VenuesView } from "./venues-kinds.js";
import {
  grammarProblem,
  inTree,
  KNOWLEDGE_SKILLS,
  locate,
  OVERLAY_RESERVED,
  parseKnowledgePath,
  readLayerDir,
  shippedLayer,
  entryType,
  type EntryType,
  type KnowledgePath,
  type KnowledgeSeams,
  type Layer,
} from "./tree.js";
import { mergedIndex, provenance, shadowedRows } from "./common.js";

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
