// ------------------------------------------------------------ index rows --

import { readFileSync } from "node:fs";

import { DataServerError, ValidationError } from "../errors.js";
import { pluginVersion } from "../repo-root.js";
import { mergeKinds, mergeVenues, NO_VENUE, normalizeName, STAMP_KEYS, type IndexSource, type KindsView, type VenuesView } from "./index.js";
import { withFileLock, writeTextAtomic } from "./sidecar.js";
import { grammarProblem, locate, parseKnowledgePath, readLayerFiles, entryType, type KnowledgePath } from "./tree.js";
import { folderOf, INDEX_NAMES, parseJson, provenance } from "./common.js";
import { refuseArgs, rowString, writableOverlayPath, type Args, type Json, type WriteSeams } from "./overlay.js";

type IndexList = "venues" | "not_venues" | "kinds";

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

export async function writeIndexRow(kp: KnowledgePath, index: "venues" | "kinds", args: Args, seams: WriteSeams, label: string): Promise<Record<string, unknown>> {
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
