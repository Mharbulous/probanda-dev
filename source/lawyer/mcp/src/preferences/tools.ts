// The preferences__* and suggestion_log__* tools.
//
// A preference is one person's standing instruction to one named skill, kept in
// `<case_data_root>\_practice\preferences\<person>.json`: one file per person, every kind of
// preference in it as an entry (Commandment 5). Probanda creates the file, and retiring an entry
// stamps `retired_on` inside it, never a delete (Commandment 7).
//
// The suggestion log keeps the IDs of suggestions this device posted, and the last status shown
// for each, in `suggestions.local.json` beside probanda.json. It stays on the device and never goes
// under 0. CASE DATA: a suggestion ID is Cross Data, which only Probanda and this user may see.
//
// Every write is under a lock file beside its target and by temp file plus rename.

import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { configPath } from "../config-path.js";
import { DataServerError, ValidationError } from "../errors.js";
import { withFileLock, writeTextAtomic } from "../knowledge/sidecar.js";
import { resolveCaseDataRoot } from "../practice/matter-data-root.js";
import { pluginVersion } from "../repo-root.js";
import { findRedactionHits } from "./redact.js";

type Args = Record<string, unknown>;

export interface PreferenceEntry {
  id: string;
  skill: string;
  instruction: string;
  created_on: string;
  retired_on: string | null;
  plugin_version: string | null;
}

export const SUGGESTION_STATUSES = ["new", "approved", "approved in part", "rejected"] as const;

export interface SuggestionLogEntry {
  suggestion_id: string;
  title: string;
  posted_on: string;
  last_status: string;
  last_shown_status: string | null;
}

/** Test seam: the install root whose plugin.json gives `plugin_version`. */
export interface PreferenceSeams {
  installRoot?: string;
}

const SKILL = /^[a-z][a-z0-9-]*:[A-Za-z0-9_-]+$/;

// A guiding question per kind of identifying detail (Commandment 6).
const QUESTIONS: Record<string, string> = {
  email: "Could the instruction say who to write to by role, such as \"opposing counsel\", rather than by email address?",
  user_path: "Could the instruction describe the folder by its purpose rather than by a path on this computer?",
  matter_folder: "Could the instruction say \"the matter's folder\" rather than naming a particular matter?",
  too_long: "Could the instruction be said in a few sentences, as a rule the skill should follow every time?",
};

function today(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function text(raw: unknown, name: string): string {
  if (typeof raw !== "string" || raw.trim() === "") throw new ValidationError(`${name} must be a non-empty string`);
  return raw.trim();
}

function readJson(file: string): Record<string, unknown> {
  try {
    return JSON.parse(readFileSync(file, "utf-8")) as Record<string, unknown>;
  } catch (err) {
    throw new DataServerError(`${file} is not valid JSON: ${(err as Error).message}`, "invalid_file");
  }
}

/** This machine's `person`, from probanda.json. Unset is a hard error naming the key. */
function person(env: NodeJS.ProcessEnv): string {
  const config = configPath(env);
  const raw = existsSync(config) ? readJson(config).person : undefined;
  if (raw === undefined || raw === null || raw === "") {
    throw new DataServerError(
      `person is not set: this machine's probanda.json names no firm roster key ("person"), so a preference has no owner. ` +
        "Set it with practice_data__upsert_firm_profile, then retry.",
      "person_unset"
    );
  }
  if (typeof raw !== "string" || !/^[A-Za-z0-9_-]+$/.test(raw)) {
    throw new ValidationError(`person in ${config} must be a roster key of letters, digits, "_" and "-"`);
  }
  return raw;
}

function preferencesFile(env: NodeJS.ProcessEnv): { file: string; person: string } {
  const key = person(env);
  return { file: join(resolveCaseDataRoot(env), "_practice", "preferences", `${key}.json`), person: key };
}

function readEntries(file: string): PreferenceEntry[] {
  if (!existsSync(file)) return [];
  const entries = readJson(file).entries;
  if (!Array.isArray(entries)) throw new DataServerError(`${file} has no "entries" list`, "invalid_file");
  return entries as PreferenceEntry[];
}

export function preferencesRead(args: Args, env: NodeJS.ProcessEnv = process.env): Record<string, unknown> {
  const skill = args.skill === undefined ? undefined : text(args.skill, "skill");
  const { file, person: key } = preferencesFile(env);
  const entries = readEntries(file).filter((entry) => entry.retired_on === null && (skill === undefined || entry.skill === skill));
  return { person: key, entries };
}

export async function preferencesWrite(
  args: Args,
  env: NodeJS.ProcessEnv = process.env,
  seams: PreferenceSeams = {}
): Promise<Record<string, unknown>> {
  const { file, person: key } = preferencesFile(env);
  if (args.op === "add") {
    const skill = text(args.skill, "skill");
    if (!SKILL.test(skill)) throw new ValidationError(`skill must name a plugin and a skill as "<plugin>:<skill>", e.g. "lawyer:draft"`);
    const instruction = text(args.instruction, "instruction");
    const hits = findRedactionHits(instruction);
    if (hits.length) {
      throw new ValidationError(
        `Nothing was saved. ${hits.map((kind) => QUESTIONS[kind]).join(" ")} A preference applies to every matter, so it stays generic.`,
        "identifying_detail"
      );
    }
    const entry: PreferenceEntry = {
      id: randomUUID(),
      skill,
      instruction,
      created_on: today(),
      retired_on: null,
      plugin_version: pluginVersion(seams.installRoot),
    };
    await withFileLock(file, () => {
      const entries = readEntries(file);
      writeTextAtomic(file, `${JSON.stringify({ person: key, entries: [...entries, entry] }, null, 2)}\n`);
    });
    return { status: "saved", id: entry.id };
  }
  if (args.op === "retire") {
    const id = text(args.id, "id");
    return withFileLock(file, () => {
      const entries = readEntries(file);
      const entry = entries.find((candidate) => candidate.id === id);
      if (!entry) throw new DataServerError(`no preference of ${key} has id ${id}; call preferences__read for the ids`, "not_found");
      if (entry.retired_on !== null) return { status: "already_retired", id, retired_on: entry.retired_on };
      entry.retired_on = today();
      writeTextAtomic(file, `${JSON.stringify({ person: key, entries }, null, 2)}\n`);
      return { status: "retired", id, retired_on: entry.retired_on };
    });
  }
  throw new ValidationError(`op must be "add" or "retire"`);
}

// ------------------------------------------------------------ suggestion log --

/** `suggestions.local.json` in the folder that holds probanda.json (or the COCLERK_CONFIG_PATH file). */
export function suggestionLogPath(env: NodeJS.ProcessEnv): string {
  return join(dirname(configPath(env)), "suggestions.local.json");
}

function readLog(file: string): SuggestionLogEntry[] {
  if (!existsSync(file)) return [];
  const suggestions = readJson(file).suggestions;
  if (!Array.isArray(suggestions)) throw new DataServerError(`${file} has no "suggestions" list`, "invalid_file");
  return suggestions as SuggestionLogEntry[];
}

export function suggestionLogRead(env: NodeJS.ProcessEnv = process.env): Record<string, unknown> {
  return { suggestions: readLog(suggestionLogPath(env)) };
}

export async function suggestionLogWrite(args: Args, env: NodeJS.ProcessEnv = process.env): Promise<Record<string, unknown>> {
  const file = suggestionLogPath(env);
  const suggestionId = text(args.suggestion_id, "suggestion_id");
  if (args.op === "add") {
    const title = text(args.title, "title");
    return withFileLock(file, () => {
      const suggestions = readLog(file);
      if (suggestions.some((entry) => entry.suggestion_id === suggestionId)) return { status: "exists", suggestion_id: suggestionId };
      suggestions.push({ suggestion_id: suggestionId, title, posted_on: today(), last_status: "new", last_shown_status: null });
      writeTextAtomic(file, `${JSON.stringify({ suggestions }, null, 2)}\n`);
      return { status: "added", suggestion_id: suggestionId };
    });
  }
  if (args.op === "seen") {
    const status = text(args.status, "status");
    if (!(SUGGESTION_STATUSES as readonly string[]).includes(status)) {
      throw new ValidationError(`status must be one of ${SUGGESTION_STATUSES.map((s) => `"${s}"`).join(", ")}`);
    }
    return withFileLock(file, () => {
      const suggestions = readLog(file);
      const entry = suggestions.find((candidate) => candidate.suggestion_id === suggestionId);
      if (!entry) throw new DataServerError(`no suggestion ${suggestionId} in this device's log`, "not_found");
      entry.last_status = status;
      entry.last_shown_status = status;
      writeTextAtomic(file, `${JSON.stringify({ suggestions }, null, 2)}\n`);
      return { status: "updated", suggestion_id: suggestionId, last_shown_status: status };
    });
  }
  throw new ValidationError(`op must be "add" or "seen"`);
}
