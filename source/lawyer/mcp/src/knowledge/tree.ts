// Knowledge trees: roots, confinement and folder grammar (shared/knowledge-tree.md
// sections 2, 3 and 6; spec §3.2).
//
// A knowledge path is `<skill>/<tree path>` (e.g. `draft/CAN/BC/BCSC/venue.md`), or
// an entry of the overlay's fixed reserved set. Two layers can hold it:
//
//   shipped  `<skill>/references/<tree path>` under the root resolveShippedRoot picks
//            for the skill (the install's skill-source/ mirror, else a checkout);
//   overlay  `<case_data_root>\_practice\knowledge\<skill>\<tree path>`, the firm's own.
//
// Relative paths only. The first segment must be a tree-owning skill on the roster
// below (fixed in the bundle, never read from a checkout) or a reserved entry. Every
// segment is checked against the names Windows and OneDrive refuse, and the overlay
// path against MAX_PATH. Every violation fails hard. Nothing here writes, and nothing
// in the knowledge__* namespace touches the network.

import { readFileSync, readdirSync, realpathSync, statSync } from "node:fs";
import { win32 as pathWin32 } from "node:path";

import { DataServerError } from "../errors.js";
import { assertContained, assertRelativeSyntax, canonicalRoot, PathOutOfScopeError } from "../files/scope.js";
import { resolveCaseDataRoot } from "../practice/backend.js";
import { resolveShippedRoot, type ShippedFrom } from "../repo-root.js";

/** The skills that own a knowledge tree (shared/knowledge-tree.md section 2). */
export const KNOWLEDGE_SKILLS: readonly string[] = ["draft", "publish", "assemble", "legal-research", "docket-clerk"];

/** A tree whose shipped folder is not `<skill>/` (docket-clerk is an agent; its files ship under shared/). */
const SHIPPED_DIR: Readonly<Record<string, string>> = { "docket-clerk": "shared/docket-clerk" };

/** The overlay's fixed reserved set, allowed beside the skill folders (section 6). */
export const OVERLAY_RESERVED: readonly string[] = ["_superseded", "_fetched", "_inbox", "_hosts.json"];

export const SIDECAR_SUFFIX = ".confirmations.local.json";

/** Windows MAX_PATH is 260 including the terminating NUL. OneDrive's own limit (400) is looser. */
const MAX_PATH_CHARS = 259;
const MAX_SEGMENT_CHARS = 255;

export type Layer = "shipped" | "local";
export type EntryType = "file" | "dir";

export interface KnowledgeSeams {
  env?: NodeJS.ProcessEnv;
  /** Test seam only: the install root resolveShippedRoot reads. */
  installRoot?: string;
  /** The case data root when the per-user probanda.json is absent (resolveCaseDataRoot's fallback); never passed to a write. */
  caseDataRoot?: () => string | null;
}

export interface KnowledgePath {
  /** Forward-slash form, as every result reports it. "" is the knowledge root. */
  path: string;
  segments: string[];
  /** The first segment: a skill or a reserved entry. */
  head: string;
  /** The skill, or null for a reserved entry and the root. */
  skill: string | null;
  /** Segments after the head. */
  rest: string[];
}

// ------------------------------------------------------------ path grammar --

const FORBIDDEN_CHARS = /[<>:"|?*\u0000-\u001f]/;
const DEVICE_NAME = /^(?:con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i;
/** shared/knowledge-tree.md "Name characters": the plugin upload validator's set, in both layers. */
const NAME_CHARS = /^[A-Za-z0-9._-]+$/;

/** Why Windows, OneDrive or the plugin upload validator would refuse this one name, or null. */
export function segmentProblem(segment: string): string | null {
  if (segment === "." || segment === "..") return "is not a file or folder name";
  if (FORBIDDEN_CHARS.test(segment)) return 'contains a character Windows or OneDrive refuses (< > : " | ? * or a control character)';
  if (DEVICE_NAME.test(segment)) return "is a reserved Windows device name";
  if (/[ .]$/.test(segment)) return "ends with a space or a period";
  if (segment.startsWith(" ")) return "begins with a space, which OneDrive refuses";
  if (segment.startsWith("~$")) return "begins with ~$, which OneDrive refuses";
  if (/_vti_/i.test(segment)) return "contains _vti_, which OneDrive refuses";
  if (/^(?:\.lock|desktop\.ini)$/i.test(segment)) return "is a name OneDrive refuses";
  if (segment.length > MAX_SEGMENT_CHARS) return `is longer than ${MAX_SEGMENT_CHARS} characters`;
  if (!NAME_CHARS.test(segment)) return 'holds a character other than a letter, a digit, ".", "_" or "-", which the plugin upload validator refuses';
  return null;
}

/** Parse a caller's knowledge path. `allowRoot` admits "" (or undefined) as the knowledge root. */
export function parseKnowledgePath(raw: unknown, label: string, allowRoot = false): KnowledgePath {
  if (allowRoot && (raw === undefined || raw === "")) return { path: "", segments: [], head: "", skill: null, rest: [] };
  if (typeof raw !== "string") throw new PathOutOfScopeError(`${label} must be a relative knowledge path`);
  assertRelativeSyntax(raw, label);
  const segments = raw.split(/[\\/]+/).filter((segment) => segment !== "");
  if (segments.length === 0) throw new PathOutOfScopeError(`${label} must be a non-empty relative path`);
  for (const segment of segments) {
    const problem = segmentProblem(segment);
    if (problem) throw new PathOutOfScopeError(`${label}: "${segment}" ${problem} (${raw})`);
  }
  const head = segments[0];
  const isSkill = KNOWLEDGE_SKILLS.includes(head);
  if (!isSkill && !OVERLAY_RESERVED.includes(head)) {
    throw new PathOutOfScopeError(
      `${label} must start with a skill that owns a knowledge tree (${KNOWLEDGE_SKILLS.join(", ")}) ` +
        `or an overlay reserved entry (${OVERLAY_RESERVED.join(", ")}); got "${head}" (${raw})`
    );
  }
  return { path: segments.join("/"), segments, head, skill: isSkill ? head : null, rest: segments.slice(1) };
}

/** A path relative to a knowledge file's folder, joined and `..`-collapsed, as a knowledge path string. */
export function joinRelative(fromPath: string, relative: string): string {
  const slash = fromPath.lastIndexOf("/");
  const dir = slash === -1 ? "" : fromPath.slice(0, slash);
  return pathWin32.normalize(dir ? `${dir}\\${relative}` : relative).split("\\").join("/");
}

// ------------------------------------------------------------ folder grammar --

const COUNTRY = /^[A-Z]{3}$/;
const JURISDICTION = /^[A-Z]{2,3}$/;
const RESERVED_FOLDERS = ["Documents", "Locations", "Judges", "Sources"];
const FETCHED_PDF = /^[0-9a-f]{12}\.pdf$/;
const HOST_NAME = /^[a-z0-9.-]+$/i;

/** Whether a first tree segment is a country folder, so the entry is in the tree at all. */
export function inTree(rest: string[]): boolean {
  return rest.length === 0 || COUNTRY.test(rest[0]);
}

/**
 * Why an entry at this position breaks the folder grammar, or null. `head` and `rest`
 * are the entry's own knowledge path; `layer` decides the index-file names and
 * whether a sidecar may sit there.
 */
export function grammarProblem(head: string, rest: string[], type: EntryType, layer: Layer): string | null {
  const name = rest.length ? rest[rest.length - 1] : head;
  const segment = segmentProblem(name);
  if (segment) return `"${name}" ${segment}`;
  if (head === "_hosts.json") return rest.length === 0 && type === "file" ? null : "_hosts.json is a file with nothing below it";
  if (head === "_inbox") return rest.length === 0 && type === "file" ? "_inbox is a folder" : null;
  if (head === "_fetched") {
    if (rest.length === 0) return type === "dir" ? null : "_fetched is a folder";
    if (!HOST_NAME.test(rest[0])) return `"${rest[0]}" is not a host name`;
    if (rest.length === 1) return type === "dir" ? null : "_fetched holds one folder per host";
    if (rest.length > 2 || type === "dir" || !FETCHED_PDF.test(rest[1])) {
      return "_fetched holds <host>\\<first 12 hex characters of the sha256>.pdf only";
    }
    return null;
  }
  if (head === "_superseded") {
    if (rest.length === 0) return type === "dir" ? null : "_superseded is a folder";
    if (!KNOWLEDGE_SKILLS.includes(rest[0])) return `_superseded holds skill trees only; "${rest[0]}" is not one`;
    return treeProblem(rest[0], rest.slice(1), type, "local");
  }
  return treeProblem(head, rest, type, layer);
}

function treeProblem(skill: string, rest: string[], type: EntryType, layer: Layer): string | null {
  if (rest.length === 0) return type === "dir" ? null : `${skill} is a folder`;
  const [country, jurisdiction, venue, folder, leaf] = rest;
  if (!COUNTRY.test(country)) return `"${country}" is not a three-letter ISO country code (CAN, USA)`;
  if (rest.length === 1) return type === "dir" ? null : "a country folder holds jurisdiction folders only";
  if (!JURISDICTION.test(jurisdiction)) return `"${jurisdiction}" is not a jurisdiction code (BC, CA, NY or FED)`;
  if (rest.length === 2) return type === "dir" ? null : "a jurisdiction is a folder";

  if (rest.length === 3 && type === "file") return jurisdictionFileProblem(skill, venue, layer);
  if (venue.startsWith("_") && venue !== "_NoVenue") return `"${venue}": _NoVenue is the only member of the reserved "_" prefix`;
  if (RESERVED_FOLDERS.includes(venue)) return `"${venue}" is a reserved folder name, not a venue`;
  if (rest.length === 3) return null;

  const noVenue = venue === "_NoVenue";
  if (rest.length === 4 && type === "file") return venueFileProblem(skill, folder, noVenue, layer);
  if (folder === "Locations" || folder === "Judges") return noVenue ? `${folder}\\ is refused under _NoVenue` : null;
  if (folder === "Documents" && skill === "legal-research") return "/legal-research's tree holds no Documents\\ folder";
  if (folder !== "Documents" && folder !== "Sources") return `"${folder}" is not a venue folder (Documents, Sources, Locations or Judges)`;
  if (rest.length === 4) return null;
  if (rest.length > 5 || type === "dir") return `${folder}\\ holds files only`;
  return folder === "Documents" ? documentsFileProblem(leaf, layer) : fileProblem(leaf, layer, mdOnly(folder));
}

function mdOnly(folder: string): (base: string) => string | null {
  return (base) => (base.endsWith(".md") ? null : `${folder}\\ holds .md files only; "${base}" is not one`);
}

/** A confirmation sidecar is valid where the .md file it confirms would be, and in the overlay only. */
function fileProblem(name: string, layer: Layer, check: (base: string) => string | null): string | null {
  if (!name.endsWith(SIDECAR_SUFFIX)) return check(name);
  if (layer === "shipped") return "a confirmation sidecar never ships";
  const base = name.slice(0, -SIDECAR_SUFFIX.length);
  if (!base.endsWith(".md")) return "a confirmation sidecar sits only beside a .md knowledge file";
  return check(base);
}

function indexNameProblem(name: string, shippedName: string, localName: string, layer: Layer): string | null | undefined {
  if (name === (layer === "shipped" ? shippedName : localName)) return null;
  if (name === shippedName) return `the overlay never holds ${shippedName}; it writes ${localName}`;
  if (name === localName) return `${localName} belongs to the overlay only`;
  return undefined;
}

function jurisdictionFileProblem(skill: string, name: string, layer: Layer): string | null {
  const index = indexNameProblem(name, "venues.json", "venues.local.json", layer);
  if (index !== undefined) return index;
  if (name === "sources.json" && skill === "legal-research") return null;
  return `"${name}" is not a jurisdiction file (the venues index${skill === "legal-research" ? " or sources.json" : ""})`;
}

function venueFileProblem(skill: string, name: string, noVenue: boolean, layer: Layer): string | null {
  if (name === "sources.json" && skill === "legal-research") return null;
  return fileProblem(name, layer, (base) => {
    if (base === "venue.md") {
      if (skill !== "draft") return "venue.md sits only in /draft's tree";
      return noVenue ? "venue.md is refused under _NoVenue" : null;
    }
    if (base === "format.md") return skill === "publish" ? null : "format.md sits only in /publish's tree";
    return `"${base}" is not a venue file (venue.md in /draft's tree, format.md in /publish's)`;
  });
}

function documentsFileProblem(name: string, layer: Layer): string | null {
  const index = indexNameProblem(name, "kinds.json", "kinds.local.json", layer);
  if (index !== undefined) return index;
  return fileProblem(name, layer, mdOnly("Documents"));
}

/** The index a knowledge path names, by position, or null: `venues` at a jurisdiction, `kinds` in Documents\. */
export function indexAt(kp: KnowledgePath): "venues" | "kinds" | null {
  if (!kp.skill) return null;
  const name = kp.rest[kp.rest.length - 1];
  if (kp.rest.length === 3 && (name === "venues.json" || name === "venues.local.json")) return "venues";
  if (kp.rest.length === 5 && kp.rest[3] === "Documents" && (name === "kinds.json" || name === "kinds.local.json")) return "kinds";
  return null;
}

// ------------------------------------------------------------ the two layers --

export interface LayerRoot {
  /** Canonical (realpath) root every path in this layer must stay within, or null when it does not exist yet. */
  canon: string | null;
  /** The entry's absolute path in this layer. */
  abs: string;
}

export interface Located {
  kp: KnowledgePath;
  /** Null for the knowledge root and for reserved entries, which exist in the overlay only. */
  shipped: LayerRoot | null;
  local: LayerRoot;
  shipped_from: ShippedFrom | null;
}

/**
 * The shipped root of one skill's tree: `<root>/<skill>/references`. Containment is
 * proven against that folder's own real path, never the whole skills tree, so a
 * junction under it cannot reach another skill's files.
 */
export function shippedLayer(skill: string, rest: string[], seams: KnowledgeSeams): { layer: LayerRoot; shipped_from: ShippedFrom } {
  const env = seams.env ?? process.env;
  const dir = SHIPPED_DIR[skill] ?? skill;
  const shipped = resolveShippedRoot([dir, "references", ...rest].join("/"), env, { installRoot: seams.installRoot });
  const skillsRoot = canonicalRoot(
    shipped.root,
    shipped.shipped_from === "install"
      ? `bundled skill source not found at ${shipped.root}; reinstall the plugin and fully restart`
      : `skills tree not found at ${shipped.root}; the repo has moved or COCLERK_REPO_ROOT is wrong`,
    "skills_root_missing"
  );
  const references = pathWin32.join(skillsRoot, ...dir.split("/"), "references");
  let canon: string | null = null;
  try {
    canon = realpathSync.native(references);
  } catch {
    canon = null;
  }
  if (canon !== null) assertContained(skillsRoot, canon, `${skill}/references`, references);
  return { layer: { canon, abs: pathWin32.join(canon ?? references, ...rest) }, shipped_from: shipped.shipped_from };
}

/**
 * The overlay root, `<case_data_root>\_practice\knowledge`. A missing case data root
 * fails hard: a merged read without the overlay would hide the firm's corrections.
 * A missing `_practice\knowledge` is an empty overlay.
 */
function overlayLayer(segments: string[], seams: KnowledgeSeams, label: string): LayerRoot {
  const configured = resolveCaseDataRoot(seams.env ?? process.env, seams.caseDataRoot);
  const shown = pathWin32.join(configured, "_practice", "knowledge", ...segments);
  if (shown.length > MAX_PATH_CHARS) {
    throw new DataServerError(
      `${label}: the overlay path is ${shown.length} characters, over the Windows limit of ${MAX_PATH_CHARS}: ${shown}`,
      "path_too_long"
    );
  }
  const caseRoot = canonicalRoot(configured, `case_data_root not found: ${configured}`, "case_data_root_missing");
  const knowledgeDir = pathWin32.join(caseRoot, "_practice", "knowledge");
  let canon: string | null = null;
  try {
    canon = realpathSync.native(knowledgeDir);
  } catch {
    canon = null;
  }
  if (canon !== null) assertContained(caseRoot, canon, label, knowledgeDir);
  return { canon, abs: pathWin32.join(canon ?? knowledgeDir, ...segments) };
}

export function locate(kp: KnowledgePath, seams: KnowledgeSeams, label = "path"): Located {
  const local = overlayLayer(kp.segments, seams, label);
  if (!kp.skill) return { kp, shipped: null, local, shipped_from: null };
  const { layer, shipped_from } = shippedLayer(kp.skill, kp.rest, seams);
  return { kp, shipped: layer, local, shipped_from };
}

/** What sits at `root.abs`, after proving its real path stays inside the layer; null when nothing does. */
export function entryType(root: LayerRoot, label: string, original: string): EntryType | null {
  if (root.canon === null) return null;
  let real: string;
  try {
    real = realpathSync.native(root.abs);
  } catch {
    return null;
  }
  assertContained(root.canon, real, label, original);
  return statSync(real).isDirectory() ? "dir" : "file";
}

/**
 * Read one file's bytes. A OneDrive online-only file that cannot be fetched from the
 * cloud reads as Node's UNKNOWN (or EIO) error; that returns its own `not_downloaded`
 * code rather than a generic failure.
 */
export function readLayerBytes(abs: string, label: string): Buffer {
  try {
    return readFileSync(abs);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") throw new DataServerError(`${label} not found: ${abs}`, "not_found");
    if (code === "UNKNOWN" || code === "EIO") {
      throw new DataServerError(
        `${label} exists but could not be read (${code}): ${abs}. It is most likely a OneDrive online-only file that ` +
          'is not downloaded. Open its folder in File Explorer, choose "Always keep on this device", and retry.',
        "not_downloaded"
      );
    }
    throw err;
  }
}

export interface LayerFile {
  layer: Layer;
  abs: string;
  bytes: Buffer;
  text: string;
}

/** Both layers' copies of one file. A folder where a file is asked for fails. */
export function readLayerFiles(loc: Located, label: string): { shipped: LayerFile | null; local: LayerFile | null } {
  const read = (layer: Layer, root: LayerRoot | null): LayerFile | null => {
    if (!root) return null;
    const type = entryType(root, label, loc.kp.path);
    if (type === null) return null;
    if (type === "dir") throw new DataServerError(`${label} is a folder, not a file: ${loc.kp.path} (use knowledge__list)`, "not_a_file");
    const bytes = readLayerBytes(root.abs, label);
    const text = bytes.toString("utf-8");
    return { layer, abs: root.abs, bytes, text: text.startsWith("\uFEFF") ? text.slice(1) : text };
  };
  return { shipped: read("shipped", loc.shipped), local: read("local", loc.local) };
}

/** Whether two copies are the same text once line endings are normalized. */
export function identicalText(a: string, b: string): boolean {
  const lf = (text: string) => text.replace(/\r\n?/g, "\n");
  return lf(a) === lf(b);
}

export interface ServedFile {
  kp: KnowledgePath;
  served: LayerFile;
  /** The overlay copy the shipped copy shadows, when both exist. */
  shadowed: LayerFile | null;
  shipped_from: ShippedFrom | null;
}

/** Refuse a file path that breaks the folder grammar, as knowledge__read does. */
export function assertTreeFile(kp: KnowledgePath, label: string): void {
  const problem = grammarProblem(kp.head, kp.rest, "file", kp.skill ? "shipped" : "local");
  if (problem) throw new DataServerError(`${label}: ${kp.path} is not a knowledge-tree file: ${problem}`, "grammar_violation");
}

/** The copy a knowledge path serves: the shipped file wins, per file (section 7). The path must keep the folder grammar. */
export function readServed(kp: KnowledgePath, seams: KnowledgeSeams, label = "path"): ServedFile {
  assertTreeFile(kp, label);
  const loc = locate(kp, seams, label);
  const { shipped, local } = readLayerFiles(loc, label);
  const served = shipped ?? local;
  if (!served) throw new DataServerError(`${label} not found in either layer: ${kp.path}`, "not_found");
  return { kp, served, shadowed: shipped && local ? local : null, shipped_from: loc.shipped_from };
}

export interface DirEntry {
  name: string;
  type: EntryType;
}

/** A layer folder's direct entries, each proven inside the layer; null when the folder is absent. */
export function readLayerDir(root: LayerRoot | null, label: string, original: string): DirEntry[] | null {
  if (!root) return null;
  const type = entryType(root, label, original);
  if (type === null) return null;
  if (type === "file") throw new DataServerError(`${label} is a file, not a folder: ${original} (use knowledge__read)`, "not_a_folder");
  return readdirSync(root.abs).map((name) => {
    const child = entryType({ canon: root.canon, abs: pathWin32.join(root.abs, name) }, label, `${original}/${name}`);
    return { name, type: child ?? "file" };
  });
}
