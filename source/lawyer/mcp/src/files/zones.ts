// A matter's zones: the one place that knows which folders each act may not touch. Every tool that
// reads, scans, writes or moves a file in a matter asks zoneProblem for its act (its purpose)
// rather than listing folders of its own.
//
// The privileged and disclosed trees (the firewall) are off-limits to every act. TRASH and
// 0. CASE DATA are never read, scanned or written into; a scan also skips the `0. DRAFT*` folder.
// A move never takes a file out of 0. CASE DATA, out of a top-level TRASH, or the matter's pointer
// or root, and never puts one into folders 0 and 1 or TRASH (housekeeping spec §B8.1, §B9.2,
// §B9.3, §B12.2). Housekeeping's own run files live inside 0. CASE DATA, so they are held to the
// firewall alone.
//
// A rule that applies anywhere is checked on every segment of the whole path, above the matter
// root as well as below it: a stricter reading never opens a gap. A top-level rule is checked on
// the first segment below the matter root. Names match whole segments, in any case.

import { win32 as pathWin32 } from "node:path";

import { POINTER_FILES } from "./matter-root.js";

export type ZonePurpose = "read" | "scan" | "write" | "move-from" | "move-to" | "run-files";

const FIREWALL = /^(privileged|disclosed)$/i;
const TRASH = /^trash$/i;
const CASE_DATA = /^0\. case data$/i;
/** The matter's draft folder: `0. DRAFT*`, whatever follows the word (.claude/skills/AGENTS.md). */
const DRAFT_FOLDER = /^0\. DRAFT/i;
const FOLDERS_0_AND_1 = /^[01]\./;

const ZONES: Record<ZonePurpose, { anywhere: RegExp[]; top: RegExp[]; phrase: string }> = {
  read: { anywhere: [FIREWALL, TRASH, CASE_DATA], top: [], phrase: "never read" },
  scan: { anywhere: [FIREWALL, TRASH, CASE_DATA, DRAFT_FOLDER], top: [], phrase: "never scanned" },
  write: { anywhere: [FIREWALL, TRASH, CASE_DATA], top: [], phrase: "never written to" },
  "move-from": { anywhere: [FIREWALL, CASE_DATA], top: [TRASH], phrase: "never moved out of" },
  "move-to": { anywhere: [FIREWALL], top: [TRASH, FOLDERS_0_AND_1], phrase: "never a destination" },
  "run-files": { anywhere: [FIREWALL], top: [], phrase: "never used for run files" },
};

/** `name` is a draft folder's name: `0. DRAFT*`. */
export function isDraftFolder(name: string): boolean {
  return DRAFT_FOLDER.test(name);
}

/**
 * Why `path` is off-limits for `purpose`, or null. `root` is the matter root: move-from and move-to
 * need it for their top-level rules, the matter root and its pointer. With `draftUnchanged` ("Move to
 * 0. DRAFT unchanged"), move-to allows the matter's `0. DRAFT*` folder itself and nothing else.
 */
export function zoneProblem(purpose: "read" | "scan" | "write" | "run-files", path: string, root?: string): string | null;
export function zoneProblem(purpose: "move-from" | "move-to", path: string, root: string, draftUnchanged?: boolean): string | null;
export function zoneProblem(purpose: ZonePurpose, path: string, root?: string, draftUnchanged = false): string | null {
  const zone = ZONES[purpose];
  const segments = path.split(/[\\/]+/);
  if (segments.some((s) => FIREWALL.test(s))) return `a privileged or disclosed folder is ${zone.phrase}`;
  const below = root === undefined ? [] : pathWin32.relative(root, path).split(pathWin32.sep).filter(Boolean);
  if (purpose === "move-to" && draftUnchanged) {
    return below.length === 1 && DRAFT_FOLDER.test(below[0]) ? null : "Move to 0. DRAFT unchanged moves only into the matter's 0. DRAFT folder";
  }
  const blocked = segments.find((s) => zone.anywhere.some((rule) => rule.test(s)));
  if (blocked) return `${blocked} is ${zone.phrase}`;
  if (below.length && zone.top.some((rule) => rule.test(below[0]))) return `${below[0]} is ${zone.phrase}`;
  if (purpose === "move-from") {
    if (below.length === 0) return "the matter folder itself is never moved";
    if (below.length === 1 && POINTER_FILES.includes(below[0].toLowerCase())) return "the matter pointer is never moved";
  }
  return null;
}

/**
 * Why the matter-root-relative folder `segments` is not where a superseded version goes, or null.
 * matter-data's supersede-draft files the earlier version of a court document in exactly
 * `<draftFolder>\Superseded`, `draftFolder` being the matter's one `0. DRAFT*` folder.
 */
export function supersededDestinationProblem(segments: string[], draftFolder: string): string | null {
  return segments.length === 2 &&
    segments[0].toLowerCase() === draftFolder.toLowerCase() &&
    segments[1].toLowerCase() === "superseded"
    ? null
    : `a superseded version moves only into ${draftFolder}\\Superseded`;
}
