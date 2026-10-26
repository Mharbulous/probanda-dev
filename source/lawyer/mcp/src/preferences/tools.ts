// The preferences__* tools.
//
// A preference is one person's standing instruction to one named skill, kept in
// `<case_data_root>\_practice\preferences\<person>.json`: one file per person, every kind of
// preference in it as an entry (Commandment 5). Probanda creates the file, and retiring an entry
// stamps `retired_on` inside it, never a delete (Commandment 7).
//
// The suggestion log that sat beside probanda.json moved into the suggestion store
// (../suggestions/store.ts), which reads the old file once.
//
// Every write is under a lock file beside its target and by temp file plus rename.

import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { configPath } from "../config-path.js";
import { DataServerError, ValidationError } from "../errors.js";
import { today } from "../knowledge/common.js";
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
  const active = readEntries(file).filter((entry) => entry.retired_on === null);
  if (skill === undefined) return { person: key, entries: active };
  const entries = active.filter((entry) => entry.skill === skill);
  // Echo the filter and count what it left out, so a wrong key is told apart from no preferences.
  return { person: key, entries, skill, excluded: active.length - entries.length };
}

export async function preferencesWrite(
  args: Args,
  env: NodeJS.ProcessEnv = process.env,
  seams: PreferenceSeams = {}
): Promise<Record<string, unknown>> {
  const { file, person: key } = preferencesFile(env);
  if (args.op === "add") {
    const skill = text(args.skill, "skill");
    if (!SKILL.test(skill)) throw new ValidationError(`skill must name a plugin and a skill as "<plugin>:<skill>", e.g. "lawyer:show-me"`);
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
