// Shared by the knowledge__* tools: provenance, JSON parsing, the merged index views, a knowledge path's folder and today's date.

import { BUILD_STAMP } from "../build-stamp.js";
import { DataServerError } from "../errors.js";
import { pluginVersion, type ShippedFrom } from "../repo-root.js";
import { mergeKinds, mergeVenues, NO_VENUE, type Conflict, type IndexSource, type KindsView, type VenuesView } from "./venues-kinds.js";
import { grammarProblem, locate, parseKnowledgePath, readLayerFiles, type KnowledgePath, type KnowledgeSeams, type LayerFile } from "./tree.js";

export interface Provenance {
  shipped_from: ShippedFrom | null;
  plugin_version: string | null;
  build_stamp: string | null;
}

export function provenance(shipped_from: ShippedFrom | null, seams: KnowledgeSeams): Provenance {
  return { shipped_from, plugin_version: pluginVersion(seams.installRoot), build_stamp: BUILD_STAMP };
}

export function parseJson(file: LayerFile, label: string): unknown {
  try {
    return JSON.parse(file.text);
  } catch (err) {
    throw new DataServerError(`${label}: ${file.abs} is not valid JSON: ${(err as Error).message}`, "invalid_index");
  }
}

// ------------------------------------------------------------ index files --

export const INDEX_NAMES = { venues: ["venues.json", "venues.local.json"], kinds: ["kinds.json", "kinds.local.json"] } as const;

/** The merged view of the index at a folder (a jurisdiction for `venues`, a Documents\ folder for `kinds`). */
export function mergedIndex(folder: KnowledgePath, index: "venues" | "kinds", seams: KnowledgeSeams, label: string) {
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
export function shadowedRows(conflicts: Conflict[]): Record<string, unknown> {
  const rows = conflicts.filter((conflict) => conflict.shadowed_local).map(({ key, shipped, local }) => ({ key, shipped, local }));
  return rows.length ? { shadowed_local: rows } : {};
}

export function folderOf(kp: KnowledgePath, label: string): KnowledgePath {
  return parseKnowledgePath(kp.segments.slice(0, -1).join("/"), label);
}

export function today(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}
