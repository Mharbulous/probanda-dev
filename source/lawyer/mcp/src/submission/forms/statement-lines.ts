// One fact or law statement's printed lines: its citation, its markers and its verbatim excerpt.

import { dedupeLineMarkers, doubtMarker, exhibitPinpointMarker, factExcerptMarker, isAdmittedGuard, statementOfFactMarkers, testimonyPinpointMarker } from "./markers.js";
import type { FactStatementRow } from "./submission-reads.js";

/** Citation as its own blockquote line (ticket 2026-08-31 -- previously folded into the excerpt's
 * parenthetical by the now-removed factStatementCitation). Returns null when there is nothing to
 * cite at all (no exhibit/instrument label resolved and no pinpoint) -- pushStatementLines omits
 * the line entirely rather than printing an empty "> ". The fact side never prints
 * CITATION_MISSING: its "citation" is an exhibit/instrument label, not a nullable authorities
 * column, so a resolved label is either present or the statement has nothing to point at yet
 * (covered by 📑/💬 and 📌/🧷, not this placeholder). The Form 32 filed face passes `prefix` ">> ":
 * asm32 sets a citation in its own style. */
export function factStatementCitationLine(
  exhibitMap: Map<number, number>,
  labelMap: Map<number, string>,
  s: Pick<FactStatementRow, "instrument_id" | "pinpoint" | "exhibit_id" | "exhibit_pinpoint">,
  prefix = "> "
): string | null {
  const parts: string[] = [];
  if (s.instrument_id !== null) {
    const instrumentLabel = labelMap.get(s.instrument_id);
    if (instrumentLabel !== undefined) parts.push(instrumentLabel);
    if (s.pinpoint) parts.push(s.pinpoint);
  } else if (s.pinpoint) {
    parts.push(s.pinpoint);
  }
  if (s.exhibit_id !== null) {
    const num = exhibitMap.get(s.exhibit_id);
    const exhibitLabel = num !== undefined ? `Ex. ${num}` : labelMap.get(s.exhibit_id);
    if (exhibitLabel !== undefined) parts.push(exhibitLabel);
    if (s.exhibit_pinpoint) parts.push(s.exhibit_pinpoint);
  }
  return parts.length === 0 ? null : `${prefix}${parts.join(", ")}`;
}

/** copyMarker is looked up by the caller from s.instrument_id (never exhibit_id --
 * an exhibited document's copy status already shows once at its own Evidence
 * Index/PART 4 line). Computed outside isAdmittedGuard: 🏆 is not in
 * work-markers.md §2's Silenced list, so it still renders on an otherwise-silenced
 * (admitted/court-record) line. */
export function factStatementMarkers(s: FactStatementRow, courtRecordLinked: boolean, admitted: boolean, copyMarker: string): string {
  if (isAdmittedGuard(courtRecordLinked, admitted)) return dedupeLineMarkers([doubtMarker(s.doubt), copyMarker]);
  return dedupeLineMarkers([
    factExcerptMarker(s),
    exhibitPinpointMarker(s.exhibit_id, s.exhibit_pinpoint),
    testimonyPinpointMarker(s.instrument_id, s.pinpoint),
    statementOfFactMarkers({
      interviewed: s.interviewed,
      instrument_id: s.instrument_id,
      instrument_kind: s.instrument_kind,
      instrument_execution: s.instrument_execution,
      fact_court_record_linked: courtRecordLinked,
      fact_admitted_by_all_opposing: admitted,
    }),
    doubtMarker(s.doubt),
    copyMarker,
  ]);
}

/** Every rendered document's one shape for a quoted statement, under the proposition it supports: the
 * excerpt verbatim in a code fence longer than any backtick run inside it, when there is one (💬 already
 * signals "excerpt needed"), a blank line, then the citation as a blockquote line of its own ending with
 * the markers and the id comment. With no citation the markers and comment stand alone. */
export function statementBlock(excerpt: string | null, citationLine: string | null, markers: string, tag: string, id: number, indent: string): string[] {
  const out: string[] = [];
  if (excerpt) {
    const fence = "`".repeat(Math.max(3, ...[...excerpt.matchAll(/`+/g)].map((m) => m[0].length + 1)));
    out.push(`${indent}${fence}`, ...excerpt.split("\n").map((l) => (l ? `${indent}${l}` : "")), `${indent}${fence}`, "");
  }
  out.push(`${indent}${[citationLine, markers, `<!-- ${tag} ${id} -->`].filter(Boolean).join(" ")}`);
  return out;
}

/** Pushes one statement's block (statementBlock) inside a numbered paragraph, after a blank line. */
export function pushStatementLines(lines: string[], excerpt: string | null, citationLine: string | null, markers: string, tag: string, id: number): void {
  lines.push("", ...statementBlock(excerpt, citationLine, markers, tag, id, "   "));
}
