// A statement of law's line: its citation and its statement-line markers. Shared by the doctrinal
// statement line (render-vaniac-submissions.ts's renderSubmissionParagraphs) and the general
// renderer's prose-cited line under "Authorities cited" (render-general.ts, #1214), so the two
// can never drift.

import { parseLinkedProvisions, predatedProvision } from "./authority-fit.js";
import {
  anachronismMarker,
  authorityPinpointMarker,
  dedupeLineMarkers,
  doubtMarker,
  excerptMarker,
  noteUpMarker,
  scrutinizeMarker,
  statementSourceMarker,
  treatmentMarker,
} from "./markers.js";

/** Ticket 2026-08-31 (one paragraph per assertion): the literal placeholder printed in place of
 * a missing authorities.citation. Exported so the filing gate (forms.ts, render-form32-filed-
 * face.ts, render-form33-filed-face.ts) scans for/rejects the exact same string every emitter
 * can produce -- never a re-typed copy. */
export const CITATION_MISSING = "[citation missing]";

/** The fields a statement-of-law line reads: the statement's own, and its authority's. */
export interface LawStatementLine {
  pinpoint: string | null;
  excerpt: string | null;
  doubt: string | null;
  source: string | null;
  verification: string | null;
  treatment: string | null;
  authority_kind: string | null;
  currency_status: string | null;
  currency_checked_on: string | null;
  treatment_note: string | null;
  authority_title: string | null;
  authority_citation: string | null;
  authority_killed_on: string | null;
  settled_on: string | null;
  excerpt_speaker: string | null;
  linked_provisions: string | null;
}

/** ` (scrutiny failed: <doubt>)` over the given statements whose verification is 'failed' (schema
 * v46, the research lawyer's negative return), each finding once in order, joined by "; ". Empty
 * when none failed. Plain text, never a glyph. Whitespace runs collapse to one space so the tag
 * stays on one line: on a line that can reach a filed face (the proposition line, the clause line)
 * it is the last text before the markers, and the filed-face strip removes it through the line's
 * last ")" (filed-face.ts), since a finding can hold parentheses of its own. */
export function scrutinyFailedTag(rows: readonly { verification: string | null; doubt: string | null }[]): string {
  const findings = rows.filter((r) => r.verification === "failed").map((r) => (r.doubt ?? "").replace(/\s+/g, " ").trim());
  return findings.length > 0 ? ` (scrutiny failed: ${findings.join("; ")})` : "";
}

/** ` (settled by counsel <settled_on> over scrutiny finding)` on a settled statement (schema v47:
 * counsel's confirmed close over a failed finding), else empty. Plain text, never a glyph: it is the
 * human tell that the statement counts as support by counsel's call and not by the research
 * lawyer's pass, and it replaces the 👃 the kept finding would otherwise raise. It prints on every
 * mockup line the statement prints on, and the filed-face strip removes it (filed-face.ts), since a
 * settled statement reaches the filed face. */
function settledTag(row: Pick<LawStatementLine, "verification" | "settled_on">): string {
  return row.verification === "settled" ? ` (settled by counsel ${row.settled_on} over scrutiny finding)` : "";
}

/** ` (note-up: <note>)` while the statement's authority holds a note-up note (schema v51: the
 * research lawyer's coverage line and qualifications, verbatim), else empty. Plain text, never a
 * glyph. Whitespace runs collapse to one space so the tag stays on one line. It is the line's last
 * text, and the filed-face strip removes it through the line's last ")" (filed-face.ts), since a
 * note can hold parentheses of its own. */
function noteUpTag(row: Pick<LawStatementLine, "treatment_note">): string {
  return row.treatment_note === null ? "" : ` (note-up: ${row.treatment_note.replace(/\s+/g, " ").trim()})`;
}

/** ` (quoting <source>)` while the statement records that its excerpt is words the judgment quotes
 * from another source (schema v61), else empty. Plain text, never a glyph: it is the human tell that
 * the words are not the court's own. It sits right after the pinpoint, before every other tag, and
 * the filed-face strip removes it (filed-face.ts): it is rendered for the human and withheld from the
 * forum. Whitespace runs collapse to one space so the tag stays on one line. */
function quotingTag(row: Pick<LawStatementLine, "excerpt_speaker">): string {
  const speaker = row.excerpt_speaker?.replace(/\s+/g, " ").trim() ?? "";
  return speaker === "" ? "" : ` (quoting ${speaker})`;
}

/** Law-side twin of factStatementCitationLine: `> *{style of cause}*, {citation or
 * CITATION_MISSING} {pinpoint}`. row.authority_title === null is structurally unreachable via
 * SubmissionLawGroup.statements (groupSubmissionLaw only ever pushes rows with statement_id !==
 * null, and statements_of_law.authority_id is NOT NULL) -- kept as a defensive fallback, not
 * deleted as dead code. */
export function lawStatementCitationLine(row: LawStatementLine): string | null {
  // A killed authority's statement now renders no marker at all (design §4), so without this
  // tag its line in the Counsel Brief would read like sound supporting authority -- the only
  // tell would be the "Killed authorities" section further down. Plain text, not a glyph, so
  // the no-marker rule holds and no status label is reintroduced. Same shape as the "Killed
  // authorities" and "Killed submissions" sections print (render-companions.ts).
  // A failed statement (schema v46) takes the same footing: without its tag the line would show
  // 👃 with no word of what the research lawyer found. The line rides the brief-only cap, so it
  // reaches no filed face and needs no strip. A settled statement (schema v47) carries its own tag,
  // last, and does reach the filed face, which strips it (see settledTag). An authority's note-up
  // note (schema v51) follows it, last of all, stripped the same way (see noteUpTag). The quoting
  // tag (schema v61) comes first, right after the pinpoint, stripped the same way (see quotingTag).
  const tags = `${quotingTag(row)}${row.authority_killed_on !== null ? ` (killed ${row.authority_killed_on})` : ""}${scrutinyFailedTag([row])}${settledTag(row)}${noteUpTag(row)}`;
  if (row.authority_title === null) return row.pinpoint ? `> ${row.pinpoint}${tags}` : null;
  const citation = row.authority_citation ?? CITATION_MISSING;
  // Stored pinpoints sometimes repeat the citation ("2023 BCCA 182, para. 34"); strip that
  // prefix so the line never prints the citation twice.
  let pin = row.pinpoint;
  if (pin && row.authority_citation && pin.startsWith(row.authority_citation)) {
    pin = pin.slice(row.authority_citation.length).replace(/^[\s,;]+/, "") || null;
  }
  return `> *${row.authority_title}*, ${citation}${pin ? `, ${pin}` : ""}${tags}`;
}

/** `deployed` is false for a statement nothing on a live Writing relies on (spec R6, schema v47):
 * a doctrinal statement whose law assertion no submission or order deployed on a live Writing
 * requires. 🔬 does not derive there, so no Scrutinize Proposal is raised. Re-linking it makes 🔬
 * derive again. */
export function lawStatementMarkers(row: LawStatementLine, deployed = true): string {
  // A killed item's own lines render no marker of any type, work or event (design §4 of
  // planning/1. Design/2026-09-15_work-board-proposals-design.md; §8 names markers printed on
  // killed-authority statements a defect to fix before the collector ships). The statement's
  // citation line carries a plain-text "(killed <date>)" tag instead -- see
  // lawStatementCitationLine.
  if (row.authority_killed_on !== null) return "";
  // An overruled authority's own statement lines render no work marker (#828). ⛔ is an event,
  // and work-markers.md's ⛔ row gives the work it routes as "research-lawyer replaces; basis
  // reopens (⛔→🏛️⊕📖)", so 📜 📍 🔬 🏅 are withheld on rule 1 (a marker names remaining work) --
  // the same ground the killed rule gives one line above. 👃 stays -- not because doubt is not
  // work (work-markers.md lists 👃 in table 1a, so it is), but because its predicate reads the
  // statement's own `doubt` column and "no longer reads the treatment column (→ 📇)": the
  // treatment spends the authority's rungs, never the statement's doubt. 📇 is withheld with the
  // rest, on a statute, regulation or rule whose currency is unchecked too (#1628).
  // A settled statement (schema v47) keeps its finding in doubt as the record of what counsel
  // decided over, so 👃 is withheld on it: the decision has been made, and the settled tag on its
  // citation line is the human tell.
  const doubt = row.verification === "settled" ? "" : doubtMarker(row.doubt);
  if (row.treatment === "overruled") {
    return dedupeLineMarkers([treatmentMarker(row.treatment), doubt]);
  }
  return dedupeLineMarkers([
    excerptMarker("authority", row.excerpt),
    authorityPinpointMarker(row.pinpoint),
    statementSourceMarker(row.source),
    // 🔬 sits between 📍 and 📇 on the authority-support ladder (work-markers.md §5). Not on a
    // statement deployed on no live Writing (R6).
    deployed ? scrutinizeMarker(row.verification, row.authority_killed_on) : "",
    treatmentMarker(row.treatment),
    // 🕰️ (schema v61) is an event, like ⚠️: a case decided before a provision the same
    // proposition cites came into force. It holds back no 🧐 and names no work of its own.
    anachronismMarker(predatedProvision(row, parseLinkedProvisions(row.linked_provisions)) !== null),
    noteUpMarker(row.authority_kind, row.treatment, row.currency_status, row.currency_checked_on),
    doubt,
  ]);
}
