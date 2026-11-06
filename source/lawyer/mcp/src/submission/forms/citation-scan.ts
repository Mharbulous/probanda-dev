// The citation scan (spec 2026-10-14 "noting-up criterion on every citing Writing" §4.3;
// drafting-data/references/filing-checklists.md "Citations in the text"). It reads the filed face of
// every document of a Writing that reaches the forum and finds each citation in it: a neutral,
// reporter or statute citation, with or without a pinpoint, and a case name in italics. A citation
// that matches no live `authorities` row of the Writing's proceeding is untracked. Each untracked one
// becomes a non-generating 📇 inventory entry, which the `noting-up` criterion counts, and a
// mockup-only line at the head of the venue document. It never states law and never fetches: it
// only matches text to rows.

import { submissionDataQuery } from "../backend.js";
import { fenceStep } from "./fence.js";
import { toFiledFace } from "./filed-face.js";
import { mockupMessage } from "./markers.js";
import type { MarkerInventory } from "./proposal-inventory.js";

/** The keyed table of an untracked citation's inventory entry. No such table exists: the row the
 * entry asks for is an `authorities` row not yet written, so the entry is keyed on its ordinal. */
export const UNTRACKED_CITATION_TABLE = "untracked_citations";

const YEAR = String.raw`(?:1[6-9]|20)\d{2}`;
/** A neutral citation, `2019 BCCA 123` or `1997 CanLII 400`: a court token with two capitals at least. */
const NEUTRAL = String.raw`\b${YEAR}\s+(?=[A-Za-z]*[A-Z][A-Za-z]*[A-Z])[A-Z][A-Za-z]{1,7}\s+\d+\b`;
/** A reporter citation with its year in brackets or parentheses: `[2008] 1 SCR 190`, `(1990), 74 DLR (4th) 321`. */
const REPORTER = String.raw`[[(]${YEAR}[\])],?\s+(?:\d+\s+)?[A-Z][A-Za-z.&]*(?:\s+[A-Z][A-Za-z.&]*){0,2}(?:\s+\(\d+(?:st|nd|rd|th|d)\))?\s+\d+\b`;
/** A statute or regulation citation: `RSBC 1996, c 238`, `SC 2019, c 29`, `BC Reg 168/2009`, `SOR/98-106`. */
const STATUTE = String.raw`\b(?:R\.?\s?)?S\.?\s?(?:[A-Z]\.?){1,3}\s+${YEAR},?\s+c\.?\s*[A-Z]?-?\d+(?:\.\d+)?\b|\b[A-Z][A-Za-z]{0,3}\.?\s?Reg\.?\s+\d+\/\d{2,4}\b|\bSOR\/\d{2,4}-\d+\b`;
const CITATION_RE = new RegExp(`${NEUTRAL}|${REPORTER}|${STATUTE}`, "g");
/** A case name in italics, `*Smith v Jones*` or `_Re Smith_`: an italic run naming two parties, or a `Re` case. */
const ITALIC_NAME_RE = /(?<![*_\w])([*_])(?![*_\s])((?:[^*_\n]+?\sv\.?\s[^*_\n]+?)|(?:(?:Re|Reference re)\s[^*_\n]+?))\1(?![*_\w])/g;

/** Lower case, periods and commas dropped, whitespace collapsed: two spellings of one citation compare equal. */
function normalCitation(s: string): string {
  return s.toLowerCase().replace(/[.,]/g, "").replace(/\s+/g, " ").trim();
}

/** A style of cause compared by its letters and digits, `v.` read as `v`. */
function normalName(s: string): string {
  return s
    .toLowerCase()
    .replace(/\bv\./g, "v")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

interface Hit {
  /** As printed: the italic name, the citation, or both joined by ", ". */
  text: string;
  name: string | null;
  citation: string | null;
}

/** Every citation on one line, an italic name followed by its citation read as one hit. */
function lineHits(line: string): Hit[] {
  const names = [...line.matchAll(ITALIC_NAME_RE)].map((m) => ({ start: m.index ?? 0, end: (m.index ?? 0) + m[0].length, name: m[2].trim() }));
  const citations = [...line.matchAll(CITATION_RE)].map((m) => ({ start: m.index ?? 0, end: (m.index ?? 0) + m[0].length, citation: m[0].trim() }));
  const hits: Hit[] = [];
  const joined = new Set<number>();
  for (const n of names) {
    const next = citations.findIndex((c) => c.start >= n.end && /^[\s,]*$/.test(line.slice(n.end, c.start)));
    if (next >= 0) {
      joined.add(next);
      hits.push({ text: `${n.name}, ${citations[next].citation}`, name: n.name, citation: citations[next].citation });
    } else {
      hits.push({ text: n.name, name: n.name, citation: null });
    }
  }
  citations.forEach((c, i) => {
    if (!joined.has(i)) hits.push({ text: c.citation, name: null, citation: c.citation });
  });
  return hits;
}

/** Every citation in a filed face, in print order. A fenced block and a `>` quotation are an
 * excerpt's own words, whose citations the Writing does not make, so they are not read. */
function textHits(filedFace: string): Hit[] {
  const hits: Hit[] = [];
  let open = "";
  for (const line of filedFace.split("\n")) {
    const fenced = open !== "";
    const step = fenceStep(open, line);
    open = step.open;
    if (step.fence || fenced || /^\s*>/.test(line)) continue;
    hits.push(...lineHits(line));
  }
  return hits;
}

interface AuthorityRow {
  style_of_cause_or_title: string;
  citation: string | null;
}

/** Whether a live `authorities` row tracks the hit: by citation first, then by style of cause. */
function tracked(hit: Hit, rows: readonly AuthorityRow[]): boolean {
  if (hit.citation !== null) {
    const wanted = normalCitation(hit.citation).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const within = new RegExp(`(^|[^a-z0-9])${wanted}([^a-z0-9]|$)`);
    if (rows.some((r) => r.citation !== null && within.test(normalCitation(r.citation)))) return true;
  }
  if (hit.name !== null) {
    const wanted = normalName(hit.name);
    if (rows.some((r) => normalName(r.style_of_cause_or_title) === wanted)) return true;
  }
  return false;
}

/** The untracked citations on the documents that reach the forum, each recorded on `inventory` as a
 * non-generating 📇 entry stamped with the document it was first found on. Returns the mockup-only
 * lines that name them, for the head of the venue document. */
export function scanUntrackedCitations(
  dbPath: string,
  proceedingId: number,
  docs: readonly { documentType: string; markdown: string }[],
  inventory: MarkerInventory
): string[] {
  const rows = submissionDataQuery(
    dbPath,
    "SELECT style_of_cause_or_title, citation FROM authorities WHERE proceeding_id = ? AND killed_on IS NULL",
    [proceedingId]
  ).rows as unknown as AuthorityRow[];
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const doc of docs) {
    for (const hit of textHits(toFiledFace(doc.markdown))) {
      // One case cited twice, once by name and citation and once by either alone, is one item.
      const keys = [...(hit.citation === null ? [] : [`c:${normalCitation(hit.citation)}`]), ...(hit.name === null ? [] : [`n:${normalName(hit.name)}`])];
      const repeat = keys.some((k) => seen.has(k));
      keys.forEach((k) => seen.add(k));
      if (repeat) continue;
      if (tracked(hit, rows)) continue;
      const item = `cited but not tracked: ${hit.text}`;
      inventory.push({ generating: false, marker: "📇", table: UNTRACKED_CITATION_TABLE, id: lines.length + 1, item, doc: doc.documentType });
      lines.push(mockupMessage("📇", `Cited but not tracked: ${hit.text}`));
    }
  }
  return lines;
}
