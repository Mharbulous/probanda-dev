// The matter's protected zones for /housekeeping (spec §B8.1, §B9.2, §B9.3, §B12.2): the one
// place that knows which folders are firewalled and which are never a destination. Used by the
// run directory, the page server, the resolve function and the confined move alike.

/** Folder names that open a firewall tree: nothing /housekeeping writes, serves or moves lies in one. */
const FIREWALL_SEGMENTS = new Set(["privileged", "disclosed"]);

/** The matter's draft folder: `0. DRAFT*`, whatever follows the word (.claude/skills/AGENTS.md). */
const DRAFT_FOLDER = /^0\. DRAFT/i;

/** `name` is a draft folder's name: `0. DRAFT*`. */
export function isDraftFolder(name: string): boolean {
  return DRAFT_FOLDER.test(name);
}

/** Some segment of `segments` (a path split into folder names) opens a firewall tree. */
export function inFirewall(segments: string[]): boolean {
  return segments.some((s) => FIREWALL_SEGMENTS.has(s.toLowerCase()));
}

/**
 * Why the matter-root-relative folder `segments` is never a destination, or null. Never folders
 * 0 and 1 and everything inside them, `TRASH`, or a firewall tree. With `draftUnchanged` ("Move to
 * 0. DRAFT unchanged"), the matter's `0. DRAFT*` folder itself is the one destination allowed.
 */
export function destinationProblem(segments: string[], draftUnchanged = false): string | null {
  if (draftUnchanged) {
    return segments.length === 1 && DRAFT_FOLDER.test(segments[0]) ? null : "Move to 0. DRAFT unchanged moves only into the matter's 0. DRAFT folder";
  }
  if (inFirewall(segments)) return "a privileged or disclosed folder is never a destination";
  const first = segments[0] ?? "";
  if (first.toLowerCase() === "trash") return "TRASH is never a destination";
  if (/^[01]\./.test(first)) return `${first} is never a destination`;
  return null;
}

/**
 * Why the matter-root-relative folder `segments` is not where a superseded version goes, or null.
 * Case-data's supersede-draft files the earlier version of a court document in exactly
 * `<draftFolder>\Superseded`, `draftFolder` being the matter's one `0. DRAFT*` folder.
 */
export function supersededDestinationProblem(segments: string[], draftFolder: string): string | null {
  return segments.length === 2 &&
    segments[0].toLowerCase() === draftFolder.toLowerCase() &&
    segments[1].toLowerCase() === "superseded"
    ? null
    : `a superseded version moves only into ${draftFolder}\\Superseded`;
}
