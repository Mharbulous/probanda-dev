// Each practitioner's folder map: where they keep each document type (shared/document-types.md).
// One file per roster person, `<case_data_root>\_practice\firm\folder-maps\<key>.json`, beside
// `email-signatures\<key>.htm`. The person is the one this machine's probanda.json names. No
// person, or no file for that person, is the no-map case: nothing falls back to another
// person's map or to any built-in layout.

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, win32 as pathWin32 } from "node:path";

import { configPath } from "../../config-path.js";
import { DataServerError, ValidationError } from "../../errors.js";
import { resolveCaseDataRoot } from "../../practice/matter-data-root.js";
import { resolveShippedRoot } from "../../repo-root.js";
import { readFirmProfile } from "./firm-profile.js";

export type DocumentTypeFlag = "never_ingest" | "privileged_by_default" | "authority";
const FLAGS: readonly DocumentTypeFlag[] = ["never_ingest", "privileged_by_default", "authority"];

export interface DocumentType {
  id: string;
  name: string;
  definition: string;
  flags: DocumentTypeFlag[];
}

export interface FolderMapEntry {
  type: string;
  folders: string[];
}

/** Where this person keeps their precedents and how they name them. Firm-level, so not a folder map entry. */
export interface PrecedentSettings {
  folder: string;
  name_pattern: string;
}

export type FolderMap =
  | { status: "ok"; person: string; map_path: string; entries: FolderMapEntry[]; precedents?: PrecedentSettings }
  | { status: "no_map"; person: string | null; map_path: string | null; reason: string };

export interface PathTypes {
  path: string;
  /** The types whose folders hold this path, in glossary order; empty when no mapped folder does. */
  types: string[];
  /** Each flag holds only when every one of `types` carries it, and never when `types` is empty. */
  never_ingest: boolean;
  privileged: boolean;
  authority: boolean;
}

const GLOSSARY = "shared/document-types.md";
const ROW = /^\| `([a-z_]+)` \| ([^|]+?) \| ([^|]+?) \|([^|]*)\|$/;

/** The glossary's types, parsed from the shipped shared/document-types.md, the one source of them. */
export function documentTypes(env: NodeJS.ProcessEnv = process.env): DocumentType[] {
  const root = resolveShippedRoot(GLOSSARY, env, { subject: "the document-type glossary", plugin: "lawyer" }).root;
  const path = join(root, ...GLOSSARY.split("/"));
  if (!existsSync(path)) throw new DataServerError(`the document-type glossary is missing: ${path}`, "skills_root_missing");
  const types: DocumentType[] = [];
  for (const line of readFileSync(path, "utf-8").split(/\r?\n/)) {
    const m = ROW.exec(line.trim());
    if (!m) continue;
    const flags = [...m[4].matchAll(/`([a-z_]+)`/g)].map((f) => f[1]);
    const bad = flags.filter((f) => !FLAGS.includes(f as DocumentTypeFlag));
    if (bad.length) throw new DataServerError(`${path}: type ${m[1]} has unknown flag(s) ${bad.join(", ")}`, "invalid_glossary");
    types.push({ id: m[1], name: m[2], definition: m[3], flags: flags as DocumentTypeFlag[] });
  }
  if (types.length === 0) throw new DataServerError(`${path} lists no document types`, "invalid_glossary");
  return types;
}

function folderMapsDir(env: NodeJS.ProcessEnv): string {
  return join(resolveCaseDataRoot(env), "_practice", "firm", "folder-maps");
}

/** A roster person's folder map file. */
export function folderMapPath(env: NodeJS.ProcessEnv, key: string): string {
  return join(folderMapsDir(env), `${key}.json`);
}

/** This machine's roster key from probanda.json, or null when it sets none. */
function machinePerson(env: NodeJS.ProcessEnv): string | null {
  const config = configPath(env);
  if (!existsSync(config)) return null;
  let person: unknown;
  try {
    person = (JSON.parse(readFileSync(config, "utf-8")) as Record<string, unknown> | null)?.person;
  } catch (err) {
    throw new ValidationError(`${config} is not valid JSON: ${(err as Error).message}`);
  }
  if (person === undefined || person === null || person === "") return null;
  if (typeof person !== "string") throw new ValidationError(`person in ${config} must be a string`);
  return person;
}

function splitGlob(glob: string): string[] {
  return glob.split(/[\\/]/);
}

/** A folder glob is relative to the matter root: no drive, no leading separator, no `.` or `..` segment. */
function checkGlob(glob: unknown, where: string): string {
  if (typeof glob !== "string" || glob.trim() === "") throw new ValidationError(`${where}: a folder must be a non-empty string`);
  if (pathWin32.isAbsolute(glob) || /^[a-z]:/i.test(glob) || /^[\\/]/.test(glob)) {
    throw new ValidationError(`${where}: "${glob}" must be relative to the matter folder`);
  }
  if (splitGlob(glob).some((s) => s === "" || s === "." || s === "..")) {
    throw new ValidationError(`${where}: "${glob}" has an empty, "." or ".." segment`);
  }
  return glob;
}

/** Validates a map's entries against the glossary. Throws, naming the first fault. */
export function checkEntries(raw: unknown, types: DocumentType[], where: string): FolderMapEntry[] {
  if (!Array.isArray(raw)) throw new ValidationError(`${where}: entries must be an array`);
  const known = new Set(types.map((t) => t.id));
  const seen = new Set<string>();
  return raw.map((entry, i) => {
    const at = `${where}: entries[${i}]`;
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) throw new ValidationError(`${at} must be an object`);
    const { type, folders, ...rest } = entry as Record<string, unknown>;
    if (Object.keys(rest).length) throw new ValidationError(`${at} has unknown field(s) ${Object.keys(rest).join(", ")}`);
    if (typeof type !== "string" || !known.has(type)) throw new ValidationError(`${at}: "${String(type)}" is not a document type`);
    if (seen.has(type)) throw new ValidationError(`${at}: type ${type} appears twice`);
    seen.add(type);
    if (!Array.isArray(folders) || folders.length === 0) throw new ValidationError(`${at}: folders must be a non-empty array`);
    return { type, folders: folders.map((g) => checkGlob(g, at)) };
  });
}

const NAME_TOKENS = new Set(["{YYYY-MM-DD}", "{vN}", "{description}"]);

/** `folder` is absolute, or relative to the folder holding the case data root. `name_pattern` needs {description} once. */
export function checkPrecedents(raw: unknown, where: string): PrecedentSettings {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) throw new ValidationError(`${where} must be an object`);
  const { folder, name_pattern, ...rest } = raw as Record<string, unknown>;
  if (Object.keys(rest).length) throw new ValidationError(`${where} has unknown field(s) ${Object.keys(rest).join(", ")}`);
  if (typeof folder !== "string" || folder.trim() === "") throw new ValidationError(`${where}: folder must be a non-empty string`);
  const absolute = pathWin32.isAbsolute(folder);
  if (!absolute && /^[a-z]:/i.test(folder)) throw new ValidationError(`${where}: "${folder}" has a drive but no full path`);
  if (splitGlob(folder).some((s) => s === "." || s === ".." || (!absolute && s === ""))) {
    throw new ValidationError(`${where}: "${folder}" has an empty, "." or ".." segment`);
  }
  if (typeof name_pattern !== "string") throw new ValidationError(`${where}: name_pattern must be a string`);
  const tokens = name_pattern.match(/\{[^{}]*\}/g) ?? [];
  const bad = tokens.filter((t) => !NAME_TOKENS.has(t));
  if (bad.length) throw new ValidationError(`${where}: name_pattern has unknown part(s) ${bad.join(", ")}`);
  if (tokens.filter((t) => t === "{description}").length !== 1) {
    throw new ValidationError(`${where}: name_pattern must hold {description} exactly once`);
  }
  if (/[<>:"\\/|?*]/.test(name_pattern)) throw new ValidationError(`${where}: name_pattern holds a character a file name cannot`);
  return { folder, name_pattern };
}

/** The settings' folder as a full path on this device. */
function precedentsPath(settings: PrecedentSettings, env: NodeJS.ProcessEnv): string {
  if (pathWin32.isAbsolute(settings.folder)) return settings.folder;
  return join(dirname(resolveCaseDataRoot(env)), ...splitGlob(settings.folder));
}

/** The folder map of the person this machine's probanda.json names, or the no-map case. */
export function readFolderMap(env: NodeJS.ProcessEnv = process.env, types: DocumentType[] = documentTypes(env)): FolderMap {
  const person = machinePerson(env);
  if (person === null) {
    return { status: "no_map", person: null, map_path: null, reason: "this machine names no person, so no folder map applies" };
  }
  const path = folderMapPath(env, person);
  if (!existsSync(path)) {
    return { status: "no_map", person, map_path: path, reason: `no folder map is recorded for ${person}` };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf-8"));
  } catch (err) {
    throw new ValidationError(`${path} is not valid JSON: ${(err as Error).message}`);
  }
  const stored = parsed as Record<string, unknown> | null;
  const entries = checkEntries(stored?.entries, types, path);
  const precedents = stored?.precedents === undefined ? undefined : checkPrecedents(stored.precedents, `${path}: precedents`);
  return { status: "ok", person, map_path: path, entries, ...(precedents ? { precedents } : {}) };
}

function segmentMatches(glob: string, name: string): boolean {
  const pattern = glob.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".");
  return new RegExp(`^${pattern}$`, "i").test(name);
}

/** `path` (matter-root relative) lies inside a folder `glob` matches. */
export function inFolder(glob: string, path: string): boolean {
  const g = splitGlob(glob);
  const p = path.split(/[\\/]/).filter((s) => s !== "");
  return g.length < p.length && g.every((s, i) => segmentMatches(s, p[i]));
}

/** The existing folders under `root` that `glob` matches, as absolute paths, sorted. A folder that
 * cannot be listed throws. */
export function expandGlob(root: string, glob: string): string[] {
  let dirs = [root];
  for (const segment of splitGlob(glob)) {
    dirs = dirs.flatMap((dir) =>
      readdirSync(dir, { withFileTypes: true })
        .filter((e) => (e.isDirectory() || e.isSymbolicLink()) && segmentMatches(segment, e.name))
        .map((e) => join(dir, e.name))
        .sort()
    );
  }
  return dirs;
}

/** The types holding each path, with the flags every one of them carries. */
export function classifyPaths(entries: FolderMapEntry[], types: DocumentType[], paths: string[]): PathTypes[] {
  return paths.map((path) => {
    const held = types.filter((t) => entries.some((e) => e.type === t.id && e.folders.some((g) => inFolder(g, path))));
    const all = (flag: DocumentTypeFlag) => held.length > 0 && held.every((t) => t.flags.includes(flag));
    return {
      path,
      types: held.map((t) => t.id),
      never_ingest: all("never_ingest"),
      privileged: all("privileged_by_default"),
      authority: all("authority"),
    };
  });
}

/** Every folder glob the map gives the named types, each once, in map order. */
export function globsFor(entries: FolderMapEntry[], typeIds: readonly string[]): string[] {
  return [...new Set(entries.filter((e) => typeIds.includes(e.type)).flatMap((e) => e.folders))];
}

function stringList(value: unknown, name: string): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || !value.every((v) => typeof v === "string")) throw new ValidationError(`${name} must be an array of strings`);
  return value as string[];
}

/** practice_data__folder_map: the glossary, this practitioner's map, and optionally which types hold
 * each of `paths` and which folders hold each of `types`. */
export async function folder_map(args: Record<string, unknown>, env: NodeJS.ProcessEnv = process.env): Promise<unknown> {
  const paths = stringList(args.paths, "paths");
  const asked = stringList(args.types, "types");
  const types = documentTypes(env);
  const unknown = (asked ?? []).filter((id) => !types.some((t) => t.id === id));
  if (unknown.length) throw new ValidationError(`not a document type: ${unknown.join(", ")}`);
  const map = readFolderMap(env, types);
  if (map.status === "no_map") return { ...map, document_types: types };
  return {
    ...map,
    document_types: types,
    ...(map.precedents ? { precedents: { ...map.precedents, path: precedentsPath(map.precedents, env) } } : {}),
    ...(paths ? { paths: classifyPaths(map.entries, types, paths) } : {}),
    ...(asked ? { folders: Object.fromEntries(asked.map((id) => [id, globsFor(map.entries, [id])])) } : {}),
  };
}

/** practice_data__set_folder_map: replaces this person's map, their precedent settings, or both.
 * Whichever is not passed stays as recorded. */
export async function set_folder_map(args: Record<string, unknown>, env: NodeJS.ProcessEnv = process.env): Promise<unknown> {
  const types = documentTypes(env);
  const newEntries = args.entries === undefined ? undefined : checkEntries(args.entries, types, "entries");
  const newPrecedents = args.precedents === undefined ? undefined : checkPrecedents(args.precedents, "precedents");
  if (newEntries === undefined && newPrecedents === undefined) throw new ValidationError("pass entries, precedents or both. Nothing was written.");
  const person = readFirmProfile(env).person;
  if (person === null) {
    throw new ValidationError("this machine names no person, so there is no one to record a folder map for. Set person with practice_data__upsert_firm_profile first. Nothing was written.");
  }
  const current = readFolderMap(env, types);
  const held = current.status === "ok" ? current : null;
  const entries = newEntries ?? held?.entries;
  if (entries === undefined) throw new ValidationError(`no folder map is recorded for ${person}, so entries is required. Nothing was written.`);
  const precedents = newPrecedents ?? held?.precedents;
  const path = folderMapPath(env, person);
  mkdirSync(dirname(path), { recursive: true });
  const record = { entries, ...(precedents ? { precedents } : {}) };
  writeFileSync(path, JSON.stringify(record, null, 2) + "\n", "utf-8");
  return { person, written: path, ...record };
}
