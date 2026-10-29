// Firm profile (spec §3.4, plan Phase 6). The firm's name and roster live in
// `<case_data_root>\_practice\firm\firm.json`, its letterhead in `letterhead.docx`
// beside it, and each person's email signature template in `email-signatures\`. This machine's roster key (`person`), signature path and the practitioner's
// environment notes (`practice_quirks`) live in the Roaming probanda.json. Files, not
// practice.db rows: these tools never open the DB.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { inflateRawSync } from "node:zlib";

import { configPath, configWritePaths } from "../../config-path.js";
import { NotFoundError, ValidationError } from "../../errors.js";
import { writeTextAtomic } from "../../knowledge/sidecar.js";
import { resolveCaseDataRoot } from "../../practice/backend.js";
import { asString } from "./shared.js";

type RosterEntry = Record<string, unknown>;

const ROSTER_FIELDS = ["key", "name", "designation", "role", "email", "direct_line", "closing", "initials", "active"];
const ROLES = ["lawyer", "staff"];
// What a letter's letterhead needs from its signer (render_letterhead.py SIGNER_FIELDS).
export const SIGNER_FIELDS =["name", "email", "direct_line", "closing", "initials"];
export const TOKENS = ["{{AUTHOR_NAME}}", "{{AUTHOR_EMAIL}}", "{{DIRECT_LINE}}", "{{FILE_NUMBER}}"];
const HEADER_FOOTER_PART = /^word\/(header|footer)\d*\.xml$/;
const THEME_PART = "word/theme/theme1.xml";

function firmPaths(env: NodeJS.ProcessEnv, fallback?: () => string | null): { firm: string; letterhead: string } {
  const dir = join(resolveCaseDataRoot(env, fallback), "_practice", "firm");
  return { firm: join(dir, "firm.json"), letterhead: join(dir, "letterhead.docx") };
}

// A roster person's email signature template, placed by hand in Outlook's layout (<key>.htm, with
// optional <key>.txt and <key>_files beside it). write_email prefers it over Outlook's own signature.
export function emailSignaturePath(env: NodeJS.ProcessEnv, key: string): string {
  return join(dirname(firmPaths(env).firm), "email-signatures", `${key}.htm`);
}

function readJson(path: string): Record<string, unknown> {
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as Record<string, unknown>;
  } catch (err) {
    throw new ValidationError(`${path} is not valid JSON: ${(err as Error).message}`);
  }
}

// This machine's probanda.json (or legacy coclerk.json), or `{version: 1}` (config_set_root's seed) when it is absent.
// A COCLERK_CONFIG_PATH that names a missing file still fails in configPath.
function readConfig(env: NodeJS.ProcessEnv): Record<string, unknown> {
  const path = configPath(env);
  return existsSync(path) ? readJson(path) : { version: 1 };
}

function writeJson(path: string, value: unknown): void {
  writeTextAtomic(path, JSON.stringify(value, null, 2) + "\n");
}

function rosterOf(firm: Record<string, unknown>, firmPath: string): RosterEntry[] {
  if (firm.roster === undefined) return [];
  if (!Array.isArray(firm.roster)) throw new ValidationError(`roster in ${firmPath} is not an array`);
  return firm.roster as RosterEntry[];
}

export interface FirmProfile {
  firm_name: string;
  roster: RosterEntry[];
  letterhead: string | null;
  person: string | null;
  /** This practitioner's environment notes from probanda.json, or null when unset. */
  practice_quirks: string | null;
  /** Roster keys copied on every email write_email addresses from case data; present only when firm.json sets some. */
  cc_on_counsel_email?: string[];
}

function isKeyList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((key) => typeof key === "string" && key !== "");
}

// `letterhead` is null when none is registered: only a letter needs it, and its renderer
// stops on null. `person` is null when this machine's probanda.json does not set it.
export async function firm_profile(env: NodeJS.ProcessEnv = process.env): Promise<FirmProfile> {
  return readFirmProfile(env);
}

// The same read, synchronous, for the render path (drafting_forms__render is synchronous).
// `fallback` supplies the case data root when the per-user probanda.json is absent (resolveCaseDataRoot).
export function readFirmProfile(env: NodeJS.ProcessEnv = process.env, fallback?: () => string | null): FirmProfile {
  const paths = firmPaths(env, fallback);
  const firm = existsSync(paths.firm) ? readJson(paths.firm) : undefined;
  const firmName = typeof firm?.firm_name === "string" ? firm.firm_name : "";
  if (!firm || firmName === "") {
    const missing = firm ? `firm_name in ${paths.firm}` : `firm.json (${paths.firm})`;
    throw new NotFoundError(
      `The firm profile is incomplete. Missing: ${missing}. Set it with practice_data__upsert_firm_profile.`
    );
  }
  const roster = rosterOf(firm, paths.firm);
  const config = configPath(env);
  const machine = existsSync(config) ? readJson(config) : undefined;
  const raw = machine?.person;
  const person = raw === undefined || raw === null || raw === "" ? null : raw;
  const quirks = machine?.practice_quirks;
  if (quirks !== undefined && quirks !== null && typeof quirks !== "string") {
    throw new ValidationError(`practice_quirks in ${config} must be a string`);
  }
  if (person !== null && typeof person !== "string") {
    throw new ValidationError(`person in ${config} must be a string`);
  }
  if (person !== null && !roster.some((entry) => entry.key === person)) {
    throw new ValidationError(
      `person "${person}" in ${config} is not a key in the firm roster (${paths.firm}). ` +
      `Add a roster_entry with that key, or set person to an existing key, with practice_data__upsert_firm_profile.`
    );
  }
  return {
    firm_name: firmName,
    roster,
    letterhead: existsSync(paths.letterhead) ? paths.letterhead : null,
    person,
    practice_quirks: typeof quirks === "string" && quirks !== "" ? quirks : null,
    ...(isKeyList(firm.cc_on_counsel_email) && firm.cc_on_counsel_email.length > 0 ? { cc_on_counsel_email: firm.cc_on_counsel_email } : {}),
  };
}

// Merges `input` into the roster entry with its key, or appends a new entry.
// Mutates `roster`; the caller writes it only once every check has passed.
function upsertRosterEntry(roster: RosterEntry[], input: Record<string, unknown>): { key: string; created: boolean } {
  const unknown = Object.keys(input).filter((field) => !ROSTER_FIELDS.includes(field));
  if (unknown.length > 0) {
    throw new ValidationError(`roster_entry has unknown field(s) ${unknown.join(", ")} (allowed: ${ROSTER_FIELDS.join(", ")})`);
  }
  const key = asString(input.key, "roster_entry.key");
  for (const [field, value] of Object.entries(input)) {
    const type = field === "active" ? "boolean" : "string";
    if (typeof value !== type) throw new ValidationError(`roster_entry.${field} must be a ${type}`);
  }
  if (input.role !== undefined && !ROLES.includes(input.role as string)) {
    throw new ValidationError(`roster_entry.role must be one of: ${ROLES.join(", ")}`);
  }
  const existing = roster.find((entry) => entry.key === key);
  if (existing) {
    Object.assign(existing, input);
    return { key, created: false };
  }
  const missing = ROSTER_FIELDS.filter((field) => field !== "active" && input[field] === undefined);
  if (missing.length > 0) {
    throw new ValidationError(`roster_entry "${key}" is new, so it needs every field. Missing: ${missing.join(", ")}`);
  }
  roster.push({ ...Object.fromEntries(ROSTER_FIELDS.map((field) => [field, input[field]])), active: input.active ?? true });
  return { key, created: true };
}

// Reads the wanted parts of a zip (a .docx) as UTF-8 text from its central directory.
// Word writes stored (0) and deflated (8) entries only; any other method is refused.
function readZipParts(zip: Buffer, source: string, wanted: (name: string) => boolean): Map<string, string> {
  const eocd = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (eocd < 0) throw new ValidationError(`letterhead ${source} is not a .docx: no zip directory found`);
  const count = zip.readUInt16LE(eocd + 10);
  let at = zip.readUInt32LE(eocd + 16);
  const parts = new Map<string, string>();
  for (let i = 0; i < count; i += 1) {
    if (zip.readUInt32LE(at) !== 0x02014b50) throw new ValidationError(`letterhead ${source} has a corrupt zip directory`);
    const method = zip.readUInt16LE(at + 10);
    const size = zip.readUInt32LE(at + 20);
    const nameLength = zip.readUInt16LE(at + 28);
    const local = zip.readUInt32LE(at + 42);
    const name = zip.toString("utf-8", at + 46, at + 46 + nameLength);
    at += 46 + nameLength + zip.readUInt16LE(at + 30) + zip.readUInt16LE(at + 32);
    if (!wanted(name)) continue;
    if (method !== 0 && method !== 8) {
      throw new ValidationError(`letterhead ${source}: part ${name} uses unsupported zip compression method ${method}`);
    }
    const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
    const data = zip.subarray(start, start + size);
    parts.set(name, (method === 8 ? inflateRawSync(data) : data).toString("utf-8"));
  }
  return parts;
}

// A paragraph opens, a paragraph closes, or a text element carries its text. Paragraphs
// nest (a text box inside a run), so each text element joins its innermost paragraph.
const PART_TEXT = /<w:p(?:\s[^>]*?)?(\/?)>|<\/w:p>|<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g;

function occurrences(text: string, token: string): number {
  return text.split(token).length - 1;
}

// A token is split when a paragraph's joined text holds it more often than its
// individual text elements do: some copy of it spans two or more runs.
function splitTokens(xml: string): string[] {
  const split = new Set<string>();
  const paragraphs: string[][] = [];
  for (const [tag, selfClosing, text] of xml.matchAll(PART_TEXT)) {
    if (text !== undefined) {
      paragraphs.at(-1)?.push(text);
    } else if (tag === "</w:p>") {
      const texts = paragraphs.pop() ?? [];
      for (const token of TOKENS) {
        const intact = texts.reduce((sum, t) => sum + occurrences(t, token), 0);
        if (occurrences(texts.join(""), token) > intact) split.add(token);
      }
    } else if (!selfClosing) {
      paragraphs.push([]);
    }
  }
  return [...split];
}

function themeFace(theme: string, slot: "majorFont" | "minorFont"): string | undefined {
  return new RegExp(`<a:${slot}>\\s*<a:latin\\b[^>]*\\btypeface="([^"]*)"`).exec(theme)?.[1];
}

// Registration checks. Throws, naming every split token and its part; otherwise returns
// the theme's heading (major) and body (minor) Latin faces. A letterhead with no theme
// part names no faces, so there is nothing to compare.
function checkLetterhead(zip: Buffer, source: string): { major?: string; minor?: string } {
  const parts = readZipParts(zip, source, (name) => HEADER_FOOTER_PART.test(name) || name === THEME_PART);
  const split: string[] = [];
  for (const [name, xml] of parts) {
    if (name === THEME_PART) continue;
    for (const token of splitTokens(xml)) split.push(`${token} in ${name}`);
  }
  if (split.length > 0) {
    throw new ValidationError(
      `Letterhead ${source} refused; nothing was written. Each token must sit whole in one run, and these are split across runs: ` +
      `${split.join("; ")}. Retype each one in a single run and register again.`
    );
  }
  const theme = parts.get(THEME_PART) ?? "";
  return { major: themeFace(theme, "majorFont"), minor: themeFace(theme, "minorFont") };
}

export interface UpsertFirmProfileResult {
  changed: string[];
  written: string[];
  roster_entry?: { key: string; created: boolean };
  theme_faces_differ?: { major: string; minor: string };
  // Every active lawyer on the resulting roster whose entry cannot yet sign a letter:
  // /publish refuses any letter they sign until a roster_entry with that key supplies the fields.
  signer_fields_missing?: { key: string; fields: string[] }[];
  // This machine's person, when their roster entry has blank initials: /publish refuses
  // every letter prepared on this machine until a roster_entry with that key supplies them.
  preparer_initials_missing?: string;
}

// The cap on practice_quirks. A longer note is refused, never truncated.
export const PRACTICE_QUIRKS_MAX = 1000;

// Any combination of firm_name, roster_entry, person, signature, practice_quirks, letterhead
// and cc_on_counsel_email, at least one. Every input is checked before any file is written, so a
// refusal leaves firm.json, the letterhead and probanda.json as they were.
export async function upsert_firm_profile(
  args: Record<string, unknown>,
  env: NodeJS.ProcessEnv = process.env
): Promise<UpsertFirmProfileResult> {
  const inputs = ["firm_name", "roster_entry", "person", "signature", "practice_quirks", "letterhead", "cc_on_counsel_email"];
  if (inputs.every((input) => args[input] === undefined)) {
    throw new ValidationError(`upsert_firm_profile needs at least one of ${inputs.join(", ")}`);
  }
  // A call that sets only this machine's practice_quirks or signature needs no firm folder, so it
  // still writes when probanda.json or its case_data_root is not set up yet.
  const firmNeeded = ["firm_name", "roster_entry", "person", "letterhead", "cc_on_counsel_email"].some((input) => args[input] !== undefined);
  let resolved: { firm: string; letterhead: string } | undefined;
  try {
    resolved = firmPaths(env);
  } catch (err) {
    if (firmNeeded) throw err;
  }
  const paths = resolved as { firm: string; letterhead: string };
  const result: UpsertFirmProfileResult = { changed: [], written: [] };

  const current = resolved && existsSync(paths.firm) ? readJson(paths.firm) : undefined;
  let firm: Record<string, unknown> | undefined;
  if (args.firm_name !== undefined || args.roster_entry !== undefined || args.cc_on_counsel_email !== undefined) {
    firm = { firm_name: undefined, roster: [], ...current };
    if (args.firm_name !== undefined) {
      firm.firm_name = asString(args.firm_name, "firm_name");
      result.changed.push("firm_name");
    }
    if (args.roster_entry !== undefined) {
      firm.roster = [...rosterOf(firm, paths.firm)];
      result.roster_entry = upsertRosterEntry(firm.roster as RosterEntry[], args.roster_entry as Record<string, unknown>);
      result.changed.push("roster_entry");
    }
    // Replaces the whole list; [] clears it. Each key must be on the roster as this call leaves it.
    if (args.cc_on_counsel_email !== undefined) {
      const keys = args.cc_on_counsel_email;
      if (!isKeyList(keys)) throw new ValidationError("cc_on_counsel_email must be a list of roster keys");
      const roster = rosterOf(firm, paths.firm);
      const unknown = keys.filter((key) => !roster.some((entry) => entry.key === key));
      if (unknown.length > 0) {
        throw new ValidationError(`cc_on_counsel_email names key(s) not in the firm roster (${paths.firm}): ${unknown.join(", ")}. Nothing was written.`);
      }
      if (keys.length === 0) delete firm.cc_on_counsel_email;
      else firm.cc_on_counsel_email = [...new Set(keys)];
      result.changed.push("cc_on_counsel_email");
    }
  }

  const config = args.person !== undefined || args.signature !== undefined || args.practice_quirks !== undefined
    ? readConfig(env)
    : undefined;
  if (config && args.person !== undefined) {
    const person = asString(args.person, "person");
    const rosterSource = firm ?? current;
    if (rosterSource?.roster === undefined) {
      throw new ValidationError(`person "${person}" cannot be checked: ${paths.firm} is absent or has no roster`);
    }
    if (!rosterOf(rosterSource, paths.firm).some((entry) => entry.key === person)) {
      throw new ValidationError(`person "${person}" is not a key in the firm roster (${paths.firm})`);
    }
    config.person = person;
    result.changed.push("person");
  }
  if (config && args.signature !== undefined) {
    const signature = asString(args.signature, "signature");
    if (!existsSync(signature)) throw new NotFoundError(`signature file not found: ${signature}`);
    config.signature = signature;
    result.changed.push("signature");
  }
  // Replaces the whole note; "" clears it.
  if (config && args.practice_quirks !== undefined) {
    const quirks = args.practice_quirks;
    if (typeof quirks !== "string") throw new ValidationError("practice_quirks must be a string");
    if (quirks.length > PRACTICE_QUIRKS_MAX) {
      throw new ValidationError(
        `practice_quirks is ${quirks.length} characters; the cap is ${PRACTICE_QUIRKS_MAX}. Nothing was written. ` +
        `Propose a compacted note to the practitioner for approval and set that instead.`
      );
    }
    if (quirks === "") delete config.practice_quirks;
    else config.practice_quirks = quirks;
    result.changed.push("practice_quirks");
  }

  let letterhead: Buffer | undefined;
  if (args.letterhead !== undefined) {
    const source = asString(args.letterhead, "letterhead");
    if (!existsSync(source)) throw new NotFoundError(`letterhead source not found: ${source}`);
    letterhead = readFileSync(source);
    const { major, minor } = checkLetterhead(letterhead, source);
    if (major !== undefined && minor !== undefined && major !== minor) result.theme_faces_differ = { major, minor };
    result.changed.push("letterhead");
  }

  // Warnings, not refusals: each reads the roster and person as this call leaves them.
  const after = firm ?? current;
  const roster = after ? rosterOf(after, paths.firm) : [];
  const signers = roster.flatMap((entry) => {
    const fields = SIGNER_FIELDS.filter((field) => !entry[field]);
    return entry.role === "lawyer" && entry.active !== false && fields.length > 0 ? [{ key: entry.key as string, fields }] : [];
  });
  if (signers.length > 0) result.signer_fields_missing = signers;
  const person = (config ?? readConfig(env)).person;
  const preparer = roster.find((entry) => typeof person === "string" && entry.key === person);
  if (preparer && !preparer.initials) result.preparer_initials_missing = person as string;

  if (firm || letterhead) mkdirSync(dirname(paths.firm), { recursive: true });
  if (firm) {
    writeJson(paths.firm, firm);
    result.written.push(paths.firm);
  }
  if (letterhead) {
    writeFileSync(paths.letterhead, letterhead);
    result.written.push(paths.letterhead);
  }
  if (config) {
    for (const target of configWritePaths(env)) {
      mkdirSync(dirname(target), { recursive: true });
      writeJson(target, config);
      result.written.push(target);
    }
  }
  return result;
}
