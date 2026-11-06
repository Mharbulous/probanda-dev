// The quirks__* tools.
//
// A practice quirk is one short entry about how this practice works: a `rule` (what Probanda must or
// must not do here) or `knowledge` (a fact that informs reasoning and directs nothing). Entries sit in
// one file, `<case_data_root>\_practice\quirks\quirks.json`, with their type and areas as values and not
// as files or columns (Commandment 5). Probanda creates the file. Retiring or revising an entry stamps
// it inside the file and never deletes it (Commandment 7). Every write is under a lock file beside the
// target and by temp file plus rename.
//
// The tools cannot see the practitioner's messages. A rule is saved only when the harness hook
// hooks/quirk-gate.py has found the exact wording in the practitioner's own last message.
// `expect_type` and `expect_title` on a call about an existing entry let that hook know the entry's
// type and title without reading this file; the tool refuses a call whose echo does not match.

import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { DataServerError, NotFoundError, ValidationError } from "../errors.js";
import { today } from "../knowledge/common.js";
import { withFileLock, writeTextAtomic } from "../file-lock.js";
import { resolveCaseDataRoot } from "../practice/matter-data-root.js";
import { pluginVersion } from "../repo-root.js";
import { checkEntry, SEED_AREAS, type QuirkType } from "./validate.js";

type Args = Record<string, unknown>;

export interface QuirkEntry {
  id: string;
  type: QuirkType;
  areas: string[];
  title: string;
  body: string;
  created_on: string;
  last_confirmed_on: string;
  retired_on: string | null;
  retired_reason: string | null;
  supersedes: string | null;
  plugin_version: string | null;
}

/** Test seam: the install root whose plugin.json gives `plugin_version`. */
export interface QuirkSeams {
  installRoot?: string;
}

const REASON_MAX = 200;

function quirksFile(env: NodeJS.ProcessEnv): string {
  return join(resolveCaseDataRoot(env), "_practice", "quirks", "quirks.json");
}

function readEntries(file: string): QuirkEntry[] {
  if (!existsSync(file)) return [];
  let parsed: { entries?: unknown };
  try {
    parsed = JSON.parse(readFileSync(file, "utf-8")) as { entries?: unknown };
  } catch (err) {
    throw new DataServerError(`${file} is not valid JSON: ${(err as Error).message}`, "invalid_file");
  }
  if (!Array.isArray(parsed.entries)) throw new DataServerError(`${file} has no "entries" list`, "invalid_file");
  return parsed.entries as QuirkEntry[];
}

function save(file: string, entries: QuirkEntry[]): void {
  writeTextAtomic(file, `${JSON.stringify({ version: 1, entries }, null, 2)}\n`);
}

const active = (entries: QuirkEntry[]) => entries.filter((entry) => entry.retired_on === null);

function areasInUse(entries: QuirkEntry[]): string[] {
  return [...new Set(active(entries).flatMap((entry) => entry.areas))].sort();
}

function wanted(raw: unknown, name: string): string[] | undefined {
  if (raw === undefined) return undefined;
  if (!Array.isArray(raw) || raw.some((item) => typeof item !== "string")) {
    throw new ValidationError(`${name} must be a list of strings`);
  }
  return raw.map((item) => (item as string).trim().toLowerCase());
}

function filtered(entries: QuirkEntry[], args: Args): QuirkEntry[] {
  const ids = args.ids === undefined ? undefined : wanted(args.ids, "ids");
  const areas = wanted(args.areas, "areas");
  if (args.type !== undefined && args.type !== "rule" && args.type !== "knowledge") {
    throw new ValidationError(`type must be "rule" or "knowledge"`);
  }
  return entries.filter(
    (entry) =>
      (ids === undefined || ids.includes(entry.id)) &&
      (areas === undefined || entry.areas.some((tag) => areas.includes(tag))) &&
      (args.type === undefined || entry.type === args.type)
  );
}

/** The index a session sees first: no bodies. Rules come before knowledge, each by creation date. */
export function quirksList(args: Args, env: NodeJS.ProcessEnv = process.env): Record<string, unknown> {
  const all = readEntries(quirksFile(env));
  const shown = filtered(args.include_retired === true ? all : active(all), args);
  shown.sort((a, b) => Number(b.type === "rule") - Number(a.type === "rule") || a.created_on.localeCompare(b.created_on));
  return {
    entries: shown.map((entry) => ({
      id: entry.id,
      type: entry.type,
      areas: entry.areas,
      title: entry.title,
      created_on: entry.created_on,
      last_confirmed_on: entry.last_confirmed_on,
      ...(entry.retired_on === null ? {} : { retired_on: entry.retired_on }),
    })),
    areas_in_use: areasInUse(all),
    suggested_areas: SEED_AREAS,
  };
}

/** Full active entries, all of them or those matching `ids`, `areas` (any of) and `type`. */
export function quirksRead(args: Args, env: NodeJS.ProcessEnv = process.env): Record<string, unknown> {
  return { entries: filtered(active(readEntries(quirksFile(env))), args) };
}

/** The active entries as the plain note older readers expect, or null when there are none or the store is out of reach. */
export function renderQuirksNote(env: NodeJS.ProcessEnv = process.env): string | null {
  let entries: QuirkEntry[];
  try {
    entries = active(readEntries(quirksFile(env)));
  } catch {
    return null;
  }
  const line = (entry: QuirkEntry) => `${entry.type.toUpperCase()} [${entry.areas.join(", ")}] ${entry.title}: ${entry.body}`;
  const lines = [
    ...entries.filter((entry) => entry.type === "rule").map(line),
    ...entries.filter((entry) => entry.type === "knowledge").map(line),
  ];
  return lines.length === 0 ? null : lines.join("\n");
}

/** Whether the store holds an active entry, so the old single note stops taking new text. */
export function hasQuirkEntries(env: NodeJS.ProcessEnv = process.env): boolean {
  try {
    return active(readEntries(quirksFile(env))).length > 0;
  } catch {
    return false;
  }
}

function text(raw: unknown, name: string): string {
  if (typeof raw !== "string" || raw.trim() === "") throw new ValidationError(`${name} must be a non-empty string`);
  return raw.trim();
}

/** The active entry `id` names, after the caller's echo of its type and title matched. */
function target(entries: QuirkEntry[], args: Args): QuirkEntry {
  const id = text(args.id, "id");
  const entry = entries.find((candidate) => candidate.id === id);
  if (!entry) throw new NotFoundError(`no quirk has id ${id}; call quirks__list for the ids`, "not_found");
  if (entry.retired_on !== null) throw new NotFoundError(`quirk ${id} was retired on ${entry.retired_on}`, "already_retired");
  if (args.expect_type !== entry.type) {
    throw new ValidationError(`Nothing was written. Is the entry ${id} a ${entry.type}? expect_type did not match it.`, "type_mismatch");
  }
  if (typeof args.expect_title !== "string" || args.expect_title.trim() !== entry.title) {
    throw new ValidationError(
      `Nothing was written. Is this the entry titled "${entry.title}"? expect_title did not match it.`,
      "title_mismatch"
    );
  }
  return entry;
}

function reason(raw: unknown): string | null {
  if (raw === undefined) return null;
  const value = text(raw, "reason");
  if (value.length > REASON_MAX || /[\r\n]/.test(value)) {
    throw new ValidationError(`reason must be one line of at most ${REASON_MAX} characters`);
  }
  return value;
}

export async function quirksWrite(
  args: Args,
  env: NodeJS.ProcessEnv = process.env,
  seams: QuirkSeams = {}
): Promise<Record<string, unknown>> {
  const file = quirksFile(env);
  const op = args.op;
  if (op !== "add" && op !== "revise" && op !== "confirm" && op !== "retire") {
    throw new ValidationError(`op must be "add", "revise", "confirm" or "retire"`);
  }
  // Checked before the lock: a refusal writes nothing and takes no lock.
  const checked = op === "add" || op === "revise" ? checkEntry(args) : undefined;
  const why = op === "retire" ? reason(args.reason) : null;
  const version = pluginVersion(seams.installRoot);

  return withFileLock(file, () => {
    const entries = readEntries(file);
    const before = areasInUse(entries);
    const day = today();
    if (op === "add" && checked) {
      const entry: QuirkEntry = {
        id: randomUUID(), ...checked, created_on: day, last_confirmed_on: day,
        retired_on: null, retired_reason: null, supersedes: null, plugin_version: version,
      };
      save(file, [...entries, entry]);
      const after = [...before, ...checked.areas.filter((tag) => !before.includes(tag))].sort();
      return { status: "saved", id: entry.id, areas_in_use: after, new_areas: checked.areas.filter((tag) => !before.includes(tag)) };
    }
    const old = target(entries, args);
    if (op === "revise" && checked) {
      old.retired_on = day;
      old.retired_reason = "revised";
      const entry: QuirkEntry = {
        id: randomUUID(), ...checked, created_on: day, last_confirmed_on: day,
        retired_on: null, retired_reason: null, supersedes: old.id, plugin_version: version,
      };
      save(file, [...entries, entry]);
      return { status: "revised", id: entry.id, retired: old.id, areas_in_use: areasInUse([...entries, entry]) };
    }
    if (op === "confirm") {
      old.last_confirmed_on = day;
      save(file, entries);
      return { status: "confirmed", id: old.id, last_confirmed_on: day };
    }
    old.retired_on = day;
    old.retired_reason = why;
    save(file, entries);
    return { status: "retired", id: old.id, retired_on: day };
  });
}
