// case_data__procedural_history_append: the one writer of a matter's ProceduralHistory.md
// (.claude/skills/shared/procedural-history.md). It runs host-side, so last_updated is the
// host's own local time with its offset, never a session's hand conversion from a UTC shell.

import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { ValidationError } from "../errors.js";
import { validateMatterRoot } from "../files/matter-root.js";

const FILE_NAME = "ProceduralHistory.md";
const TITLE = "# Procedural history";
const HEADING = /^## (\d{4}-\d{2}-\d{2})\s*$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

export interface ProceduralHistoryAppendArgs {
  matter_root: string;
  date?: string;
  line?: string;
  source_path?: string;
  told_on?: string;
  replaces?: string;
}

interface Section {
  date: string;
  lines: string[];
}

/** The host's local wall-clock time as ISO 8601 with its UTC offset, e.g. 2026-10-14T13:14:07-07:00. */
export function localIsoWithOffset(d: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const offset = -d.getTimezoneOffset();
  const sign = offset >= 0 ? "+" : "-";
  const abs = Math.abs(offset);
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}` +
    `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
  );
}

function checkIsoDate(value: string, field: string): void {
  const [y, m, d] = value.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  if (!ISO_DATE.test(value) || date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) {
    throw new ValidationError(`case_data__procedural_history_append.${field} must be a real date, YYYY-MM-DD: ${value}`, "invalid_date");
  }
}

/** Every calendar date written in `text`: 2026-10-14, October 14, 2026 (or Oct. 14 2026), 14 October 2026. */
function datesIn(text: string): string[] {
  const found: string[] = [];
  const iso = (y: number, m: number, d: number) => `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  const month = (name: string) => MONTHS.findIndex((full) => full.startsWith(name.toLowerCase().replace(/\.$/, ""))) + 1;
  for (const m of text.matchAll(/\b(\d{4})-(\d{2})-(\d{2})\b/g)) found.push(iso(+m[1], +m[2], +m[3]));
  for (const m of text.matchAll(/\b([A-Za-z]{3,9}\.?)\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})\b/g)) {
    const mo = month(m[1]);
    if (mo > 0) found.push(iso(+m[3], mo, +m[2]));
  }
  for (const m of text.matchAll(/\b(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3,9}\.?),?\s+(\d{4})\b/g)) {
    const mo = month(m[2]);
    if (mo > 0) found.push(iso(+m[3], mo, +m[1]));
  }
  return found;
}

function parse(text: string): { sections: Section[] } {
  const lines = text.split(/\r?\n/);
  let i = 0;
  if (lines[0] === "---") {
    const end = lines.indexOf("---", 1);
    if (end < 0) throw new ValidationError(`${FILE_NAME} has an unclosed YAML header; fix the file by hand first`, "malformed_file");
    i = end + 1;
  }
  const sections: Section[] = [];
  for (; i < lines.length; i++) {
    const heading = HEADING.exec(lines[i]);
    if (heading) {
      sections.push({ date: heading[1], lines: [] });
    } else if (sections.length > 0) {
      sections[sections.length - 1].lines.push(lines[i]);
    } else if (lines[i].trim() !== "" && lines[i].trim() !== TITLE) {
      throw new ValidationError(
        `${FILE_NAME} has text before its first date heading that this tool would drop: ${JSON.stringify(lines[i])}`,
        "malformed_file"
      );
    }
  }
  return { sections };
}

function trimTrailingBlank(lines: string[]): string[] {
  const out = [...lines];
  while (out.length > 0 && out[out.length - 1].trim() === "") out.pop();
  return out;
}

function serialize(stamp: string, sections: Section[], eol: string): string {
  const out = ["---", `last_updated: ${stamp}`, "---", TITLE];
  for (const section of sections) {
    out.push("", `## ${section.date}`, ...trimTrailingBlank(section.lines));
  }
  return out.join(eol) + eol;
}

export function proceduralHistoryAppend(args: ProceduralHistoryAppendArgs, now: Date = new Date()) {
  const root = validateMatterRoot(args.matter_root);
  const path = join(root, FILE_NAME);
  const hasEntry = args.date !== undefined || args.line !== undefined;
  if (hasEntry && (args.date === undefined || args.line === undefined)) {
    throw new ValidationError("case_data__procedural_history_append takes date and line together, or neither to stamp last_updated alone", "invalid_entry");
  }
  if (!hasEntry && (args.source_path !== undefined || args.told_on !== undefined || args.replaces !== undefined)) {
    throw new ValidationError("case_data__procedural_history_append: source_path, told_on and replaces need an entry (date and line)", "invalid_entry");
  }
  if (args.source_path !== undefined && args.told_on !== undefined) {
    throw new ValidationError("case_data__procedural_history_append takes source_path or told_on, never both", "invalid_entry");
  }

  const existing = existsSync(path) ? readFileSync(path, "utf-8") : undefined;
  const eol = existing?.includes("\r\n") ? "\r\n" : "\n";
  const { sections } = existing === undefined ? { sections: [] as Section[] } : parse(existing);

  let bullet: string | undefined;
  let headingCreated = false;
  let replaced = false;
  if (hasEntry) {
    const date = args.date as string;
    checkIsoDate(date, "date");
    const line = (args.line as string).trim().replace(/^- /, "");
    if (line === "" || /[\r\n]/.test(line)) {
      throw new ValidationError("case_data__procedural_history_append.line must be one non-empty line", "invalid_entry");
    }
    const later = datesIn(line).filter((d) => d > date);
    if (later.length > 0) {
      throw new ValidationError(
        `case_data__procedural_history_append.line holds ${later.join(", ")}, later than its heading ${date}. No entry holds a date later than its own heading: record the event without that date (shared/procedural-history.md)`,
        "date_after_heading"
      );
    }
    if (args.told_on !== undefined) checkIsoDate(args.told_on, "told_on");
    const source = args.source_path !== undefined
      ? ` \`${args.source_path.trim()}\``
      : args.told_on !== undefined ? ` (the practitioner, ${args.told_on})` : "";
    bullet = `- ${line}${source}`;

    if (args.replaces !== undefined) {
      const target = `- ${args.replaces.trim().replace(/^- /, "")}`;
      const hits = sections.flatMap((s) => s.lines.filter((l) => l.trim() === target).map(() => s));
      if (hits.length !== 1) {
        throw new ValidationError(
          `case_data__procedural_history_append.replaces matches ${hits.length} entries; pass the full text of exactly one existing entry`,
          "replaces_not_found"
        );
      }
      const owner = hits[0];
      owner.lines = owner.lines.filter((l) => l.trim() !== target);
      if (!owner.lines.some((l) => l.trim() !== "")) sections.splice(sections.indexOf(owner), 1);
      replaced = true;
    }

    let section = sections.find((s) => s.date === date);
    if (section === undefined) {
      section = { date, lines: [] };
      const at = sections.findIndex((s) => s.date < date);
      sections.splice(at < 0 ? sections.length : at, 0, section);
      headingCreated = true;
    }
    if (section.lines.some((l) => l.trim() === bullet)) {
      throw new ValidationError(`case_data__procedural_history_append: ${date} already holds ${JSON.stringify(bullet)}`, "duplicate_entry");
    }
    section.lines = [...trimTrailingBlank(section.lines), bullet];
  }

  const stamp = localIsoWithOffset(now);
  const temp = `${path}.tmp-${process.pid}`;
  writeFileSync(temp, serialize(stamp, sections, eol), "utf-8");
  renameSync(temp, path);
  return {
    ok: true,
    path,
    last_updated: stamp,
    created: existing === undefined,
    added: bullet ?? null,
    heading_created: headingCreated,
    replaced,
  };
}
