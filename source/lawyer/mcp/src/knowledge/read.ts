// ------------------------------------------------------------ knowledge__read --

import { DataServerError } from "../errors.js";
import type { ShippedFrom } from "../repo-root.js";
import { memoizedKnowledgeCheck, readFrontMatter, type FrontMatter } from "../sources/check.js";
import { effectiveStatus, parseSidecar } from "./sidecar.js";
import {
  grammarProblem,
  identicalText,
  indexAt,
  locate,
  parseKnowledgePath,
  readLayerBytes,
  readLayerFiles,
  readServed,
  SIDECAR_SUFFIX,
  entryType,
  type KnowledgePath,
  type KnowledgeSeams,
  type LayerFile,
} from "./tree.js";
import { folderOf, mergedIndex, provenance, shadowedRows, type Provenance } from "./common.js";
import { blockKindOf, blockOf, itemsOf } from "./items.js";

export interface KnowledgeReadResult extends Provenance {
  path: string;
  [key: string]: unknown;
}

/** Header fields: the front matter's single values (the learned-file notice is filled from these alone). */
function headerOf(front: FrontMatter | null): Record<string, string | null> {
  const header: Record<string, string | null> = {};
  for (const [key, value] of Object.entries(front ?? {})) {
    if (!Array.isArray(value)) header[key] = value;
  }
  return header;
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
