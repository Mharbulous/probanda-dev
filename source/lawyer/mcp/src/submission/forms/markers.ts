// Work-marker glyph predicates for the submission form renderers (build
// ticket #297). Source of truth: .claude/skills/drafting-data/
// references/work-markers.md (SSOT, issue #305; each marker's own row is
// symbol-table.ts, whose counts test/symbol-table.unit.test.mjs pins).
//
// The jurisdictional/doctrinal basis pair (🏛️/📖) needs no special-casing
// against the SSOT: #302/#312 moved both onto their own tables (no shared
// basis_kind column ever shipped), and work-markers.md's current table
// already matches that split directly (issue #363).
//
// Only markers whose backing column exists in the live schema.sql are
// implemented. Not renderable and deliberately omitted: fact-side 🚧
// (needs a fact-side dead-end value, unbuilt). 🏆 not the best copy built
// issue #364 (v1 half -- the stale-mark half needs documents.
// best_copy_as_of, unbuilt, stays queued). 🥉/🥈 only tertiary/only
// secondary built issue #365 (statements_of_law.source, schema v9) --
// see sourceRungMarker below. Nothing here ever renders ✅ (work-markers.md
// rule 6).
//
// Schema v3 (issue #328, widened by #323/#330/#327): evidence_uses ->
// statements_of_fact (sworn_status retired for interviewed + the instrument
// link); arguments -> submissions; argument_authorities dissolved into
// law_assertions (the proposition) + statements_of_law (renamed from
// excerpts) -- 📖/💬/📍/dead_end now read those two tables directly instead
// of one argument_authorities row's slot_state/point_of_law. Schema v4
// (issue #321, Fable-reviewed 2026-08-23): statements_of_fact gains its own
// excerpt column (mirrors statements_of_law.excerpt). The excerpt and
// pinpoint markers then split by basis (#502/#511): 📜 📍 authority,
// 📑 📌 exhibit, 💬 🧷 testimony -- see excerptMarker below.

import { splitGlyphs } from "./symbol-table.js";

export function gapMarker(wrapper: string): string {
  switch (wrapper) {
    case "gap":
      return "🧩";
    case "not_recorded":
      return "🏷️";
    case "question":
      return "🕵️";
    case "unchosen":
      return "⬜";
    default:
      // 'authority' / 'source' -- unmarked live values (work-markers.md
      // "Unmarked live values": every gaps row is work, but v1 has no
      // marker claiming these two wrapper values yet).
      return "";
  }
}

/** Invisible tag on a whole-sentence work message: the mockup shows the line, toFiledFace drops it
 * whole (#1243). Never wrap the sentence itself in a comment -- the practitioner reads it. */
export const MOCKUP_ONLY_TAG = "<!-- mockup-only -->";

export function mockupMessage(glyph: string, text: string): string {
  return `${glyph} ${text} ${MOCKUP_ONLY_TAG}`;
}

export function jurisdictionSlotMarker(state: string): string {
  if (state === "needed") return "🏛️";
  if (state === "dead_end") return "🚧";
  return "";
}

/** One order_sought_requires row (schema v10, #380 -- relief_items.jurisdiction_slot_state/
 * jurisdiction_excerpt_id retired in favour of a 0..N edge table per order). */
export interface JurisdictionRequiresEdge {
  basis_state: string; // order_sought_requires.basis_state ('needed'|'filled'|'dead_end')
  statement_id: number | null; // statements_of_law.id via excerpt_id (LEFT JOIN)
  excerpt: string | null; // statements_of_law.excerpt
  pinpoint: string | null; // statements_of_law.pinpoint
  treatment: string | null; // authorities.treatment
  authority_kind: string | null; // authorities.kind -- with currency_status, picks what 📇 reads (#1628)
  currency_status: string | null; // authorities.currency_status
  currency_checked_on: string | null; // authorities.currency_checked_on -- with currency_status, 📇's freshness window
  source: string | null; // statements_of_law.source -- NULL on a filled edge renders 🏅 (#597)
  verification: string | null; // statements_of_law.verification (schema v25) -- 'lead' renders 🔬 (#502); 'settled' (v47) fills like 'verified'
  // authorities.killed_on -- on a 'filled' edge, set re-fires 🏛️ on the order's own line, which is
  // not the killed authority's own line, because the kill is what leaves the basis owed; it
  // silences every rung past 🏛️, all of which key on the statement or on the authority, the
  // treatment markers included (#796). A 'needed' or 'dead_end' edge returns its own bare marker
  // above the kill check and never reaches it. See jurisdictionEdgeMarker below and
  // work-markers.md §1a's 🏛️ row.
  authority_killed_on: string | null;
  // The three below are read by the Proposal inventory alone (forms/proposal-inventory.ts): the
  // 📇 entry keys on the authority, and both the statement and authority entries carry its style
  // of cause and citation as their item. No predicate here reads them.
  authority_id: number | null; // authorities.id via statements_of_law.authority_id (LEFT JOIN)
  authority_title: string | null; // authorities.style_of_cause_or_title
  authority_citation: string | null; // authorities.citation
}

/** Does this edge actually fill the order's jurisdictional basis? Only a 'filled' edge does. The
 * practitioner rejected a killed authority, so the stored basis_state records the pointer, not a
 * live basis, and nothing is written back. Per edge -- jurisdictionEdgeMarker is the only caller,
 * and any non-filling edge puts 🏛️ on the order's line, except a 'dead_end' edge, which returns
 * 🚧 early and never reaches this predicate. That per-edge shape is how the 🏛️ row states its
 * predicate.
 *
 * The `authority_killed_on` clause is now unreachable-as-false: since #796 the only caller
 * returns 🏛️ outright on a killed edge, above this call, so every edge arriving here is live.
 * Kept rather than reduced to the basis_state test alone, so the predicate stays true standing
 * on its own if a second consumer is ever added -- #795 made this function module-local
 * precisely so that would be a deliberate act. */
function jurisdictionBasisFilled(edge: JurisdictionRequiresEdge): boolean {
  return edge.basis_state === "filled" && edge.authority_killed_on === null && edge.verification !== "failed";
}

function jurisdictionEdgeMarker(row: JurisdictionRequiresEdge, deployed: boolean): string {
  const bare = jurisdictionSlotMarker(row.basis_state);
  if (bare) return bare;
  if (row.statement_id === null) return jurisdictionSlotMarker("needed");
  // A killed item's own lines render no marker of any type, work or event (design §4 of
  // planning/1. Design/2026-09-15_work-board-proposals-design.md: "Dropped authorities never
  // generate. Neither does a statement of law whose authority is dropped, nor 📇 on a dropped
  // authority"; §8 names markers printed on killed-authority statements a defect to fix before
  // the collector ships). A killed edge therefore contributes exactly 🏛️ -- the basis is still
  // owed, because the practitioner rejected the authority that was to supply it -- and nothing
  // else. This return sits above the 'overruled' handling deliberately: ⛔ is an event marker on
  // a killed item and goes with the rest, since its job is to route the reopen and the kill has
  // already routed it.
  if (row.authority_killed_on !== null) return jurisdictionSlotMarker("needed");
  // A failed statement (schema v46: the research lawyer found it does not support the order)
  // fills no basis either, so the edge contributes 🏛️ alone, as a killed one does. Its 👃 and
  // its finding are recorded on the statement, which no venue face prints; the decision is counsel's.
  if (row.verification === "failed") return jurisdictionSlotMarker("needed");
  // An overruled authority's own statement lines render no work marker either (#828). ⛔ is an
  // event, and work-markers.md's ⛔ row gives the work it routes as "research-lawyer replaces;
  // basis reopens (⛔→🏛️⊕📖)" -- so the edge contributes exactly ⛔ 🏛️, the event prefixing the
  // work it routed, and 📜 📍 🔬 🏅 are all withheld. Same ground as the killed rule one line
  // above, which is rule 1 (a marker names remaining work): "nobody is asked to excerpt, locate,
  // scrutinize, rate or note up" an authority no longer relied on. Overruled differs only in who
  // rejected it -- the court, not the practitioner. This also restores the invariant every other
  // branch here holds: 🏛️ on an order's line is bare. 📇 is withheld with the rest, on a statute,
  // regulation or rule whose currency is unchecked too (#1628).
  if (row.treatment === "overruled") {
    return `${treatmentMarker(row.treatment)} ${jurisdictionSlotMarker("needed")}`;
  }
  const treatment = treatmentMarker(row.treatment);
  return dedupeLineMarkers([
    // Reachable-as-false only on a basis_state outside the documented three: 'needed' and
    // 'dead_end' returned bare above, and a killed row returned above that.
    jurisdictionBasisFilled(row) ? "" : jurisdictionSlotMarker("needed"),
    excerptMarker("authority", row.excerpt),
    authorityPinpointMarker(row.pinpoint),
    statementSourceMarker(row.source),
    // 🔬 between 📍 and 📇, the same rung the doctrinal ladder runs: work-markers.md's 🔬 row is
    // "doctrinal and jurisdictional alike", and §5 gives the order's citation the same
    // 📜 📍 🔬 📇 ladder. Without this an order whose basis rests on an unverified lead renders a
    // clean line (rule 6) -- the jurisdictional twin of the #502 doctrinal defect. Not on an order
    // deployed on no live Writing (spec R6, schema v47): nothing relies on its basis there.
    deployed ? scrutinizeMarker(row.verification, row.authority_killed_on) : "",
    treatment,
    noteUpMarker(row.authority_kind, row.treatment, row.currency_status, row.currency_checked_on),
  ]);
}

/** The jurisdictional ladder one string per edge, in edge order -- the un-deduped half of
 * jurisdictionLadderMarker below. Exported for the Proposal inventory alone
 * (forms/proposal-inventory.ts's recordJurisdictionLadder): the ladder's glyphs key on three
 * different rows (🏛️ the order, 📜 📍 🔬 the statement, 📇 the authority), so a recorder needs
 * them per edge, while the rendered line still needs the dedupe. No edge at all returns the
 * single synthetic "🏛️" -- no basis recorded, failing toward showing work. `deployed` is false for
 * an order deployed on no live Writing (spec R6, schema v47), whose edges then raise no 🔬. */
export function jurisdictionEdgeMarkers(edges: readonly JurisdictionRequiresEdge[], deployed = true): string[] {
  if (edges.length === 0) return [jurisdictionSlotMarker("needed")];
  return edges.map((edge) => jurisdictionEdgeMarker(edge, deployed));
}

/** Full jurisdictional ladder past 🏛️ (issue #348, re-shaped onto order_sought_requires by
 * #380): an order can require zero or more edges now, not one slot. No edge at all means no
 * basis recorded -- fails toward showing work, matching the old NULL-slot behaviour (basis
 * needed). Multiple edges dedupe through dedupeLineMarkers -- see jurisdictionEdgeMarker for the
 * per-edge ladder (unchanged from the pre-#380 single-slot logic, including the 'filled'-with-
 * no-statement fail-visible case and the ⛔→🏛️ overruled-reopens-basis prefix, never a stored
 * write). */
export function jurisdictionLadderMarker(edges: readonly JurisdictionRequiresEdge[]): string {
  return dedupeLineMarkers(jurisdictionEdgeMarkers(edges));
}

/** law_assertions row (schema v3, #328/#323): argument_authorities.slot_state no longer stored --
 * dead_end moved onto law_assertions.dead_end and owns the line whenever it fires.
 *
 * 📖 and 🔬 split the rest of the slot (#502, work-markers.md rows 📖/🔬). Both count only
 * statements from a non-killed authority (`authorities.killed_on` ∅ -- a killed authority's
 * statements are invisible to 📖 🔬 🥉 🥈 🏅) that is also not overruled (#830 -- work-markers.md
 * §1 "Overruled binds every row of 1a": an authority the court has rejected supplies no doctrinal
 * basis, so the proposition reads ⛔ 📖 again). Which statements count is the caller's call, as
 * with sourceRungMarker; this predicate is handed the two counts. No counted statement at all is
 * the only state 📖 still names; a counted statement none of which is verified means a lead is in
 * hand and the work is scrutiny, not research, so 🔬 renders instead. They are exclusive per
 * proposition by construction. "Verified" reads countsAsSupport (brief-only-cap.ts): `statements_of_law.verification`
 * 'verified' (schema v25 moved that column off authorities: an authority is a lead when none of its
 * statements is verified) or 'settled' (schema v47, counsel's confirmed close over a finding). A
 * 'failed' statement (schema v46) is not counted at all, as an overruled authority's is not. */
export function doctrinalSlotMarker(assertion: { dead_end: number; countedStatements: number; verifiedStatements: number }): string {
  if (assertion.dead_end === 1) return "🚧";
  if (assertion.countedStatements === 0) return "📖";
  return assertion.verifiedStatements === 0 ? "🔬" : "";
}

/** 🔬 scrutinize, statement-line instance (#502, work-markers.md row 🔬): this statement of law
 * rests on an unverified lead whose authority is not killed -- confirm the excerpt supports the
 * proposition and is the court's own reasoning. The lead statement itself prints on no venue face
 * (the brief-only cap is unchanged); this marker is recorded on it as a Proposal.
 *
 * As with jurisdictionBasisFilled, the `authorityKilledOn` guard is now unreachable-as-non-null:
 * since #796 both callers return early on a killed row, so nothing killed reaches here. Kept so
 * the predicate stays true standing alone. */
export function scrutinizeMarker(verification: string | null, authorityKilledOn: string | null): string {
  return verification === "lead" && authorityKilledOn === null ? "🔬" : "";
}

/** 🥉 only tertiary / 🥈 only secondary / 🏅 unrated (issues #365, #597):
 * the best-`source` rung across one proposition's statements of law. Reads
 * `source` alone; which statements it reads is the caller's call (work-markers.md
 * row 🥉: the verified ones when any exist, else the leads, so a verified tertiary
 * statement is never masked by a lead primary one). 🥇 'primary' is the goal state
 * and never renders, like ✅ (rule 6); it clears all three.
 *
 * 🏅 is a marker on the *blank*, never a fourth value on the axis (the axis
 * stays 🥇 ⊕ 🥈 ⊕ 🥉 ; ∅ ⇒ 🏅, exactly as treatment ∅ ⇒ 📇 on a case). It means the rung
 * is **undeterminable, not a lower rank** -- so it co-renders with whichever
 * rung the rated statements support (🥉🏅, 🥈🏅) rather than replacing it.
 *
 * #365 originally routed NULL to 🥉 as a fail-visible default. That asserted a
 * falsehood: a proposition resting on an unrated SCC decision or on the
 * governing statute itself was told to go find primary or secondary authority
 * (#597). 🥉 now requires an actual 'tertiary', mirroring 🥈's "a 🥈 statement
 * exists" form, and the unrated state keeps its own marker -- fail-visible
 * preserved, falsehood removed.
 *
 * Empty input returns "" with no special-casing: that is 📖's state (no
 * statement at all), which is why the two structurally cannot co-fire
 * (work-markers.md: "they sit after 📖 fills"). Doctrinal only -- a
 * jurisdictional statements_of_law row has law_assertion_id NULL and no
 * proposition to aggregate over; never call this from the jurisdictional
 * ladder, which carries its own per-statement 🏅 via jurisdictionEdgeMarker. */
export function sourceRungMarker(sources: readonly (string | null)[]): string {
  if (sources.length === 0) return "";
  if (sources.includes("primary")) return "";
  const unrated = sources.some((s) => s === null || s === "") ? "🏅" : "";
  if (sources.includes("secondary")) return `🥈${unrated}`;
  return sources.includes("tertiary") ? `🥉${unrated}` : unrated;
}

/** 🏅 unrated, statement-line instance (#597): this one statement of law has no
 * `source` rating yet. Finishing event: that row is rated, by /legal-research
 * or the practitioner -- never guessed, and never inferred from the authority's
 * court (filing-checklists.md). Fires regardless of its siblings' ratings, and
 * doctrinal and jurisdictional alike: a jurisdictional statement has no
 * proposition line, so a proposition-only 🏅 would leave it unmarked. */
export function statementSourceMarker(source: string | null): string {
  return source === null || source === "" ? "🏅" : "";
}

/** Which kind of source a passage is being captured out of -- the cell that picks the excerpt
 * glyph (work-markers.md rows 📜 📑 💬, split off the old dual-domain 💬 by #502). */
export type ExcerptBasis = "authority" | "exhibit" | "testimony";

/** 📜 authority / 📑 exhibit / 💬 testimony excerpt needed: this passage is not captured
 * verbatim yet. One glyph, picked by the basis the caller is reading -- a statement of law is
 * always "authority" (doctrinal and jurisdictional alike); a statement of fact is "exhibit" when
 * an exhibit backs it and "testimony" otherwise (factExcerptMarker); an admission response is
 * "exhibit" for notice_to_admit/pleading (answers drafted by counsel) and "testimony" for
 * interrogatories/oral (the party's own words). */
export function excerptMarker(basis: ExcerptBasis, excerpt: string | null): string {
  if (excerpt !== null && excerpt !== "") return "";
  switch (basis) {
    case "authority":
      return "📜";
    case "exhibit":
      return "📑";
    default:
      return "💬";
  }
}

/** The fact side's excerpt marker (work-markers.md rows 📑/💬): an exhibit-backed statement owes
 * 📑 on the exhibit's own passage and never 💬 -- 💬's predicate is exhibit_id ∅. */
export function factExcerptMarker(row: { exhibit_id: number | null; exhibit_excerpt: string | null; excerpt: string | null }): string {
  return row.exhibit_id !== null ? excerptMarker("exhibit", row.exhibit_excerpt) : excerptMarker("testimony", row.excerpt);
}

/** 🕰️ predates the provision (symbol-table.ts row 🕰️, schema v61): an event, like ⚠️, raised when
 * the statement's case was decided before a provision the same proposition cites came into force
 * (authority-fit.ts predatedProvision). It names no work of its own and holds back no 🧐. */
export function anachronismMarker(predates: boolean): string {
  return predates ? "🕰️" : "";
}

/** 📍 authority pinpoint missing (work-markers.md row 📍, law-only since #511): the locator into
 * the authority, doctrinal and jurisdictional alike, after 📜 captures the passage. */
export function authorityPinpointMarker(pinpoint: string | null): string {
  return pinpoint === null || pinpoint === "" ? "📍" : "";
}

/** 📌 exhibit pinpoint missing (work-markers.md row 📌): the locator into the document. No
 * exhibit means nothing to locate, so the link gates the glyph; it renders beside 🧷 when one
 * statement owes both locators (§2: ⊕ per locator, ∨ per line). */
export function exhibitPinpointMarker(exhibitId: number | null, exhibitPinpoint: string | null): string {
  return exhibitId !== null && (exhibitPinpoint === null || exhibitPinpoint === "") ? "📌" : "";
}

/** 🧷 testimony pinpoint missing (work-markers.md row 🧷): the locator into the witness's own
 * instrument, on an exhibit-backed statement too. No instrument (✍️, oral) means nothing to
 * locate, so the link gates the glyph. */
export function testimonyPinpointMarker(instrument: number | null, pinpoint: string | null): string {
  return instrument !== null && (pinpoint === null || pinpoint === "") ? "🧷" : "";
}

/** An exhibit letter's place in A..Z then AA..ZZ, or -1 when it is not 1-2 uppercase letters. */
function exhibitLetterIndex(letter: string): number {
  if (!/^[A-Z]{1,2}$/.test(letter)) return -1;
  const code = (i: number) => letter.charCodeAt(i) - 65;
  return letter.length === 1 ? code(0) : 26 + code(0) * 26 + code(1);
}

/** The letters one list item names: a letter, or a range `X-Y` running forward. Null when malformed. */
function exhibitLetterItem(item: string): string[] | null {
  const [from, to = from, ...rest] = item.split("-");
  const start = exhibitLetterIndex(from);
  const end = exhibitLetterIndex(to);
  if (rest.length > 0 || start < 0 || end < start) return null;
  const letters: string[] = [];
  for (let i = start; i <= end; i++) {
    letters.push(i < 26 ? String.fromCharCode(65 + i) : String.fromCharCode(65 + Math.floor((i - 26) / 26), 65 + ((i - 26) % 26)));
  }
  return letters;
}

/** The letters a comma-separated list of letters and ranges names (`A-J, L`). Null when any item is malformed. */
function exhibitLetterList(list: string): string[] | null {
  const letters: string[] = [];
  for (const item of list.split(",")) {
    const named = exhibitLetterItem(item.trim());
    if (named === null) return null;
    letters.push(...named);
  }
  return letters;
}

/** The sworn exhibit letters `documents.exhibit_letters` records (v56: `A-J` or `A-J, L`), or null
 * when the column is NULL or unparseable. */
export function swornExhibitLetters(exhibitLetters: string | null): Set<string> | null {
  if (exhibitLetters === null) return null;
  const letters = exhibitLetterList(exhibitLetters.trim());
  return letters === null ? null : new Set(letters);
}

/** The exhibit letters a pinpoint cites, read only from `Exhibit X` (also `Exhibit "X"`, straight
 * or curly quotes, and `Ex. X`), `Exhibits X-Y` and `Exhibits X, Y` (items may be ranges). Any
 * other wording cites no letters. Null when an `Exhibits` list is recognised but malformed (a
 * reversed range such as `Exhibits M-K`): it cites letters no one can name. */
export function citedExhibitLetters(pinpoint: string): string[] | null {
  const cited: string[] = [];
  for (const m of pinpoint.matchAll(/\b(?:Exhibit|Ex\.) ["“]?([A-Z]{1,2})(?:["”]|(?![A-Za-z0-9]))|\bExhibits ([A-Z]{1,2}(?:-[A-Z]{1,2})?(?:, ?[A-Z]{1,2}(?:-[A-Z]{1,2})?)*)\b/g)) {
    const letters = exhibitLetterList(m[1] ?? m[2]);
    if (letters === null) return null;
    cited.push(...letters);
  }
  return cited;
}

/** 📌 on the fact's own line (issue #360/#362; work-markers.md row 📌, which names the
 * court-record locator alongside the exhibit one): the court-record proof link is set but its
 * pinpoint is not -- the link's own citation work, routed to the holder of the record.
 * Deliberately OUTSIDE isAdmittedGuard: the link silences evidence work while still owing
 * its locator (same "not silenced -- every proof path ends at a pinpoint" rule as the
 * admission instrument's own 📌 ⊕ 🧷). It also fires when the court record is sworn and the
 * pinpoint cites an exhibit letter its sworn exhibit letters do not hold, or those letters are
 * unknown, or the pinpoint's `Exhibits` list is malformed (E2E 2026-10-05 finding 4.3): the
 * pinpoint must be re-found in the sworn version. */
export function courtRecordPinpointMarker(
  courtRecord: number | null,
  courtRecordPinpoint: string | null,
  recordExecution: string | null,
  recordExhibitLetters: string | null
): string {
  if (courtRecord === null) return "";
  if (courtRecordPinpoint === null || courtRecordPinpoint === "") return "📌";
  if (recordExecution === null) return "";
  const cited = citedExhibitLetters(courtRecordPinpoint);
  if (cited === null) return "📌";
  if (cited.length === 0) return "";
  const sworn = swornExhibitLetters(recordExhibitLetters);
  return sworn === null || cited.some((letter) => !sworn.has(letter)) ? "📌" : "";
}

/** The court-record link's own citation text once its pinpoint is captured (issue #440):
 * courtRecordPinpointMarker only ever signalled the pinpoint was *missing* -- nothing carried
 * the locator itself onto the fact's line once it was captured, so the pinpoint text never
 * reached any rendered document. Mirrors the no-label branch of factStatementCitation/
 * lawStatementCitation ("(pinpoint)"): the court-record link gets no exhibit-numbering pass
 * here, so there is no label to prefix. Text, not a glyph -- deliberately outside
 * dedupeLineMarkers/ALL_MARKER_GLYPHS, since it is evidentiary content that belongs on the
 * filed face, not work still owed (CLAUDE.md: "render for the human, withhold from the
 * forum" governs *unverified* material, not a captured citation). Renders only when the link
 * is actually set, matching courtRecordPinpointMarker's own guard. */
export function courtRecordCitation(courtRecord: number | null, courtRecordPinpoint: string | null): string {
  if (courtRecord === null || courtRecordPinpoint === null || courtRecordPinpoint === "") return "";
  return `(${courtRecordPinpoint})`;
}

/** One selected clause as the `terms` projection reads it (filing-checklists.md "Clauses (schema
 * v31)"), with the statement of law an implied clause cites and that statement's authority, all
 * NULL when `excerpt_id` is. */
export interface ClauseRow {
  basis: "express" | "implied";
  document_id: number | null; // clauses.document_id -- set on every express clause
  pinpoint: string | null; // clauses.pinpoint -- express only
  excerpt: string | null; // clauses.excerpt -- express only
  excerpt_id: number | null; // clauses.excerpt_id -- implied only, optional
  statement_pinpoint: string | null; // statements_of_law.pinpoint
  verification: string | null; // statements_of_law.verification -- 'lead' renders 🔬 (#502)
  treatment: string | null; // authorities.treatment
  authority_killed_on: string | null; // authorities.killed_on
}

/** The clause line's work and event markers (work-markers.md rows 📑 📌 📍 🔬): on an express
 * clause, 📑 while its passage is not captured and 📌 while it has no pinpoint, unordered (#1158);
 * on an implied clause citing a statement of law, 📍 while that statement's pinpoint is missing and 🔬 while it is a lead, co-rendering in ladder order. A cited statement whose
 * authority is killed or overruled counts as none (§1): overruled contributes ⛔ alone, bare, the
 * routing decision being counsel's; killed contributes nothing, the projection tagging the line
 * `(killed <date>)` in text. 🧐 is the caller's, through reviewMarkerFor. */
export function clauseMarkers(row: ClauseRow): string {
  if (row.basis === "express") return dedupeLineMarkers([excerptMarker("exhibit", row.excerpt), exhibitPinpointMarker(row.document_id, row.pinpoint)]);
  if (row.excerpt_id === null || row.authority_killed_on !== null) return "";
  if (row.treatment === "overruled") return treatmentMarker(row.treatment);
  return dedupeLineMarkers([authorityPinpointMarker(row.statement_pinpoint), scrutinizeMarker(row.verification, row.authority_killed_on)]);
}

/**
 * Collapse duplicate glyphs across tokens into one space-joined string, the internal format every
 * marker function returns and recordGlyphs reads (work-markers.md "Connectives": ∨ per line -- an
 * inclusive or, a set, not a list). Two rows contributing the same marker (e.g. two open
 * argument_authorities slots on one argument, both firing 📖) give that glyph once; different
 * glyphs from different rows (⚠️ on one authority, 🚨 on another) are all kept. Accepts
 * space-joined glyph strings (as the individual glyph functions above return) or empty/null
 * tokens; order is first-occurrence. Never the print step: a rendered line prints its markers
 * through printMarkerSets below.
 */
export function dedupeLineMarkers(tokens: Array<string | null | undefined>): string {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const token of tokens) {
    if (!token) continue;
    for (const glyph of token.split(" ")) {
      if (!glyph || seen.has(glyph)) continue;
      seen.add(glyph);
      out.push(glyph);
    }
  }
  return out.join(" ");
}

/** A token's glyphs in order, or null when any of it is not a table glyph (a tag, a message). */
function tokenGlyphs(token: string): string[] | null {
  try {
    return token.split(" ").filter(Boolean).flatMap(splitGlyphs);
  } catch {
    return null;
  }
}

/**
 * The print step for one rendered line's markers (symbol table plan, stage 2). Each token is one
 * set: the markers one stored row raises, including the work an event on that row routes to, in the
 * internal space-joined format the marker functions return (a caller joins several results for one
 * row with dedupeLineMarkers first). A set's glyphs print fused with no space, in token order, each
 * once; identical sets print once; different sets are separated by one space, so a glyph may recur
 * in two sets. A token that is not wholly table glyphs prints unchanged, as its own item. Never feed
 * it its own output: a printed line's space no longer separates glyphs of one set.
 */
export function printMarkerSets(sets: Array<string | null | undefined>): string {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const token of sets) {
    if (!token || !token.trim()) continue;
    const glyphs = tokenGlyphs(token);
    const printed = glyphs === null ? token : [...new Set(glyphs)].join("");
    if (seen.has(printed)) continue;
    seen.add(printed);
    out.push(printed);
  }
  return out.join(" ");
}

export function rebuttalMarker(answeredBySubmissionId: number | null): string {
  return answeredBySubmissionId === null ? "↩️" : "";
}

/**
 * Every glyph this module can emit, for the filed-face strip (forms/filed-face.ts,
 * build ticket #359). Enumerated by reading every marker function above, not
 * derived mechanically -- glyphs live inside composed return strings across a
 * dozen functions, so there is no reflection-based way to collect them. Kept
 * in sync by the pictograph-leak scan over golden filed-face fixtures
 * (test/filed-face.test.mjs): a marker shipped here without joining this list
 * fails that scan loud, rather than silently leaking onto the filed face.
 * Ordered longest-grapheme-first (the one ZWJ+skin-tone sequence first) so a
 * naive sequential strip never has to special-case it, though as full string
 * literals none of these actually collide as substrings of one another.
 */
export const ALL_MARKER_GLYPHS: readonly string[] = [
  "🙅🏻‍♂️", // denied (admission ladder)
  "🧩", // gap
  "🏷️", // not recorded
  "🕵️", // question
  "⬜", // unchosen
  "🏛️", // jurisdictional basis needed
  "🚧", // dead end (doctrinal / jurisdictional)
  "📖", // doctrinal basis needed
  "🔬", // scrutinize an unverified lead (#502)
  "🥈", // only secondary
  "🥉", // only tertiary
  "🏅", // unrated source (#597)
  "📜", // authority excerpt needed
  "📑", // exhibit excerpt needed
  "💬", // testimony excerpt needed
  "📍", // authority pinpoint missing
  "📌", // exhibit pinpoint missing
  "🧷", // testimony pinpoint missing
  "↩️", // rebuttal needed
  "📇", // note up
  "⚠️", // treatment: distinguishable
  "🚨", // treatment: negative
  "⛔", // treatment: overruled
  "🕰️", // predates the provision (schema v61)
  "🏆", // not best copy
  "🤥", // reserved for impeachment
  "🂡", // reserved
  "🚩", // adverse (hold, printed on no page)
  "🦵", // unserved petitum
  "🧵", // loose thread
  "🧾", // factual basis needed
  "📚", // proposition needed
  "👃", // doubt (suspicious fact / dubious law)
  "👤", // no witness
  "🤫", // suppressed by counsel (schema v69)
  "🗣️", // talk to witness
  "✍️", // draft it
  "🖋️", // sign it (witness statement)
  "✒️", // swear it (affidavit)
  "🎾", // admission: serve it
  "⏳", // admission: waiting
  "🫸", // admission: refused
  "🤷", // admission: no knowledge
  "⏰", // admission: deemed
  "⚡️", // admission: struck
  "🤝", // admission: tendered/agreed
  "🕹️", // tender the proof
  "🧐", // final review (#861)
] as const;

/** The 31 work glyphs of work-markers.md table 1a: the 1a subset of ALL_MARKER_GLYPHS. Read by
 * counselReviewMarker alone, which fires 🧐 only on a line carrying none of the other 30. */
export const WORK_MARKER_GLYPHS: readonly string[] = [
  "🧩", "🏛️", "📖", "📜", "📑", "💬", "📍", "📌", "🧷", "🔬", "↩️", "👃", "📇", "🏷️", "🕵️",
  "⬜", "👤", "🗣️", "✍️", "🖋️", "✒️", "🎾", "🕹️", "🥉", "🥈", "🏅", "🦵", "🧵", "🧾", "📚", "🧐",
] as const;

/** 🧐 final review (work-markers.md row 🧐; practitioner-review design §3, §5): no other 1a work
 * marker fires on the object, and no approval matches its current stored fields. `otherWorkMarkers`
 * is the glyph string the emit site composed for the object's line; containment, not whole-token
 * matching, so a fused `🥈🏅` counts. Events and holds (⚠️ 🚨 ⛔ 🚧 🏆 …) are not in
 * WORK_MARKER_GLYPHS, so they never hold 🧐 back. `latestApproval` null (never approved) fires. */
export function counselReviewMarker(otherWorkMarkers: string, currentSnapshot: string, latestApproval: string | null): string {
  if (WORK_MARKER_GLYPHS.some((g) => g !== "🧐" && otherWorkMarkers.includes(g))) return "";
  return latestApproval === currentSnapshot ? "" : "🧐";
}

/** The stored fields a counsel's-review snapshot holds, per reviewed table, in key order. Mirrors
 * the "Snapshot fields" table of .claude/skills/drafting-data/references/review.md;
 * test/counsel-review-marker.unit.test.mjs pins the two together, so change both or neither. */
export const REVIEW_SNAPSHOT_FIELDS = {
  statements_of_law: ["excerpt", "pinpoint", "treatment"],
  statements_of_fact: ["excerpt", "pinpoint", "exhibit_excerpt", "exhibit_pinpoint"],
  law_assertions: ["proposition", "overruled_statement_ids", "supporting_statements"],
  facts: ["postulate", "court_record_pinpoint"],
  submissions: ["contention"],
  order_sought: ["wording", "template_key", "template_values", "amount", "basis_statements", "basis_excerpts"],
  filing_orders: ["wording_override"],
  clauses: ["wording", "basis", "pinpoint", "excerpt", "excerpt_id", "cited_overruled"],
  filing_prose: ["text"],
  rhetorical_paragraphs: ["wording"],
} as const;

export type ReviewedTable = keyof typeof REVIEW_SNAPSHOT_FIELDS;

/** Snapshot keys that are no column of the row: the expression that computes each. `cited_overruled`
 * is 1 while an implied clause's cited authority is overruled, else NULL, so an overruling after
 * approval re-raises 🧐 on the clause line (work-markers.md row 🧐, #1198). `treatment` is the
 * statement's authority's, so a change of treatment after approval re-raises 🧐 on the statement
 * line; `overruled_statement_ids` lists a proposition's statements whose authority is overruled,
 * killed or not, so an overruling after approval re-raises it on the proposition line and a kill
 * does not (#1200). `basis_statements` pairs each filled jurisdictional edge's statement id with its
 * authority's treatment (`id:treatment`, `id:` while unnoted, since `concat` reads NULL as empty),
 * in edge-id order, so a change of treatment or of which statement fills the basis re-raises it on
 * the order line (#1201). `treatment` and `basis_statements` each fold in the authority's note-up
 * note (schema v51) after " — ", so a changed note re-raises 🧐 too, and a NULL note computes the
 * same bytes the two keys computed before v51. `supporting_statements` (a proposition's statements)
 * and `basis_excerpts` (the statements on an order's filled edges) are each a JSON array of
 * `{id, excerpt}` in statement-id order, `[]` with none, so linking, unlinking or replacing a
 * statement, or an in-place excerpt change, re-raises 🧐 on the proposition or order line; the
 * pinpoint is left out (review.md "Snapshot fields"). */
const DERIVED_SNAPSHOT_KEYS: Record<string, string> = {
  cited_overruled:
    "(SELECT 1 FROM statements_of_law s JOIN authorities a ON a.id = s.authority_id WHERE s.id = clauses.excerpt_id AND a.treatment = 'overruled')",
  treatment: "(SELECT a.treatment || COALESCE(' — ' || a.treatment_note, '') FROM authorities a WHERE a.id = statements_of_law.authority_id)",
  overruled_statement_ids:
    "(SELECT group_concat(s.id ORDER BY s.id) FROM statements_of_law s JOIN authorities a ON a.id = s.authority_id WHERE s.law_assertion_id = law_assertions.id AND a.treatment = 'overruled')",
  supporting_statements:
    "(SELECT json_group_array(json_object('id', s.id, 'excerpt', s.excerpt) ORDER BY s.id) FROM statements_of_law s WHERE s.law_assertion_id = law_assertions.id)",
  basis_statements:
    "(SELECT group_concat(concat(r.excerpt_id, ':', a.treatment, ' — ' || a.treatment_note) ORDER BY r.id) FROM order_sought_requires r JOIN statements_of_law s ON s.id = r.excerpt_id JOIN authorities a ON a.id = s.authority_id WHERE r.order_sought_id = order_sought.id AND r.basis_state = 'filled')",
  basis_excerpts:
    "(SELECT json_group_array(json_object('id', s.id, 'excerpt', s.excerpt) ORDER BY s.id) FROM order_sought_requires r JOIN statements_of_law s ON s.id = r.excerpt_id WHERE r.order_sought_id = order_sought.id AND r.basis_state = 'filled')",
};

/** The two note-folding keys as they read before v51, for a database held below it, which has no
 * `authorities.treatment_note`: each computes what its v51 form computes while the note is NULL. */
const PRE_V51_SNAPSHOT_KEYS: Record<string, string> = {
  ...DERIVED_SNAPSHOT_KEYS,
  treatment: "(SELECT a.treatment FROM authorities a WHERE a.id = statements_of_law.authority_id)",
  basis_statements:
    "(SELECT group_concat(concat(r.excerpt_id, ':', a.treatment) ORDER BY r.id) FROM order_sought_requires r JOIN statements_of_law s ON s.id = r.excerpt_id JOIN authorities a ON a.id = s.authority_id WHERE r.order_sought_id = order_sought.id AND r.basis_state = 'filled')",
};

/** `json_object('proposition', proposition, ...)` -- the one serializer (review.md). A
 * string only: this module executes nothing. `treatmentNoteHeld` false selects the pre-v51 keys,
 * for a database held below v51. */
export function reviewSnapshotSql(table: ReviewedTable, treatmentNoteHeld = true): string {
  const derived = treatmentNoteHeld ? DERIVED_SNAPSHOT_KEYS : PRE_V51_SNAPSHOT_KEYS;
  return `json_object(${REVIEW_SNAPSHOT_FIELDS[table].map((c) => `'${c}', ${derived[c] ?? c}`).join(", ")})`;
}

/** `${table}:${id}` -- the `review_approvals` (entity, entity_id) shape. */
export function reviewKey(table: string, id: number): string {
  return `${table}:${id}`;
}

/** Law-side authorities.treatment: ⚠️ 🚨 ⛔, for every kind of authority. NULL renders nothing
 * here -- whether the authority still owes its note-up is noteUpMarker's call (#1628). */
export function treatmentMarker(treatment: string | null): string {
  switch (treatment) {
    case "distinguishable":
      return "⚠️";
    case "negative":
      return "🚨";
    case "overruled":
      return "⛔";
    case "good_law":
      return "";
    default:
      return "";
  }
}

/** The authority kinds noted up by the statute-currency check alone (#1628; shared/statute-currency.md
 * → Noting up legislation). */
export const LEGISLATION_KINDS: ReadonlySet<string> = new Set(["statute", "regulation", "rule"]);

/** How many days a statute's or regulation's 'current' result stays fresh. A freshness window for
 * the currency check, never a deadline: it only re-raises 📇, and no date it yields is stored or
 * shown. A Court Rule (kind `rule`) is not on it: it is noted up at each reliance
 * (ADR 0003). */
export const LEGISLATION_CURRENCY_FRESH_DAYS = 30;

/** Today's local date less LEGISLATION_CURRENCY_FRESH_DAYS, `YYYY-MM-DD`. */
function currencyFreshSince(): string {
  const d = new Date();
  d.setDate(d.getDate() - LEGISLATION_CURRENCY_FRESH_DAYS);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** 📇 note up, by `authorities.kind` (#1628): a case -- or any kind outside the schema's five --
 * while `treatment` is NULL (issue #363); a statute, regulation or rule while `currency_status` is
 * anything but 'current', NULL included, treatment playing no part; a statute or regulation also
 * while its 'current' result was relayed more than LEGISLATION_CURRENCY_FRESH_DAYS ago, or on no
 * recorded date; doctrine, a secondary authority, never. */
export function noteUpMarker(kind: string | null, treatment: string | null, currencyStatus: string | null, currencyCheckedOn: string | null): string {
  if (kind === "doctrine") return "";
  if (kind !== null && LEGISLATION_KINDS.has(kind)) {
    if (currencyStatus !== "current") return "📇";
    if (kind === "rule") return "";
    return currencyCheckedOn !== null && currencyCheckedOn >= currencyFreshSince() ? "" : "📇";
  }
  return treatment === null ? "📇" : "";
}

export interface DocumentCopyRow {
  id: number;
  label: string;
  is_best_copy: number; // 0 | 1
}

/** 🏆 not best copy (issue #364, v1 half -- work-markers.md 1b). Bare event:
 * the routing decision (mark the best copy) is the work; never a prefix, never
 * guarded by isAdmittedGuard (not in §2's Silenced list). Caller passes every
 * documents row for one proceeding -- a sibling copy marked best elsewhere
 * clears the whole label group even if that sibling is never rendered.
 * Singleton groups fire: the SSOT predicate has no group-size gate, and even a
 * sole copy owes the mark (affidavit assembly resolves file_path through it). */
export function notBestCopyMarkers(documents: readonly DocumentCopyRow[]): Map<number, string> {
  const labelHasBest = new Set<string>();
  for (const d of documents) if (d.is_best_copy === 1) labelHasBest.add(d.label);
  const result = new Map<number, string>();
  for (const d of documents) result.set(d.id, labelHasBest.has(d.label) ? "" : "🏆");
  return result;
}

/** 🦵 unserved petitum (schema v10, #380): an order_sought row with no order_sought_served_by
 * row -- no submission serves this order. Renders on the order's own line. */
export function unservedPetitumMarker(hasServedBy: boolean): string {
  return hasServedBy ? "" : "🦵";
}

/** ⬜ unchosen, third derived instance (build #386, pending SSOT ratification -- work-markers.md's
 * own reading rule 3, "only ⬜ means nothing started, nothing decided," is why this reuses ⬜
 * rather than a new glyph, per this session's Fable-reviewed design): an opposing_orders row of
 * the document an application_response filing responds to, with no filing_positions row for this
 * filing -- the practitioner hasn't yet taken a position on it. An explicit 'no_position' row
 * clears this (a decided stance, not indecision). Renders on the order's own line in the
 * mockup-only "Positions not yet taken" listing (never on Parts 1-3, which are the position
 * pointer lists themselves and so cannot list an item with no pointer). */
export function unpositionedOrderMarker(): string {
  return gapMarker("unchosen");
}

/** 🧵 loose thread (schema v10, #380; work-markers.md: "render lands #384"): an item the venue
 * form deploys (document='form') that the Written Arguments never argues (no document='written_argument'
 * pointer row for the same item in the same filing). Renders on the form item's own line. */
export function looseThreadMarker(deployedByForm: boolean, deployedByWrittenArgument: boolean): string {
  return deployedByForm && !deployedByWrittenArgument ? "🧵" : "";
}

/** 🧾 factual basis needed (#400; SSOT dual-approved #388/#373): a submissions row with no
 * submission_facts row, and no recorded no-facts-needed decision for the current wording -- a
 * contention resting on no stated fact. A legitimate law-only jurisdiction submission still fires
 * until counsel records that decision (schema v48, `submissions.no_facts_needed_on`, which the
 * caller passes; the database clears it when the wording changes). The exemption is counsel's,
 * never inferred (terms-and-symbols.md decision log).
 * Contention-level, one level above 👤 (which proves each fact); not 📖's twin -- the law-side
 * mirror (submission_law ∅) is 📚, below. Renders on the contention's own
 * line (WA Submissions; NoA Part 3; AR Part 5). A held-in-reserve submission appears in no venue
 * document, so its 🧾 is recorded as a Proposal and printed nowhere. Never on a filed face. */
export function factualBasisMarker(hasSubmissionFacts: boolean): string {
  return hasSubmissionFacts ? "" : "🧾";
}

/** 📚 proposition needed (planning/1. Design/2026-10-06_application-paragraphs-spec.md §4.2): a
 * submissions row with no submission_law row, and no recorded no-law-needed decision for the current
 * wording -- a contention resting on no stated law. The law-side mirror of 🧾: it reads the junction's
 * existence, not statement counts (a proposition with no authority yet is 📖's work on its own line).
 * A deliberately fact-only contention still fires until counsel records that decision (schema v60,
 * `submissions.no_law_needed_on`, which the caller passes; the database clears it when the wording
 * changes), except a submission that only asks for ordinary costs (ordinaryCostsSubmission, below),
 * which the caller exempts. Renders on the contention's own line, beside 🧾, and stays in the line's marker set on
 * every surface, the Form 32/33 reference mode included. Withheld from every filed face. */
export function propositionNeededMarker(hasSubmissionLaw: boolean): string {
  return hasSubmissionLaw ? "" : "📚";
}

/** The only words an ordinary costs order may contain (practitioner's rule, 2026-10-07). */
const ORDINARY_COSTS_WORDS = new Set([
  "costs", "of", "this", "the", "application", "an", "order", "that", "to", "be", "paid",
  "payable", "awarded", "granted", "and", "pay", "pays", "by", "its", "their", "his", "her",
  "plaintiff", "plaintiffs", "defendant", "defendants", "applicant", "applicants", "respondent",
  "respondents", "petitioner", "petitioners", "claimant", "claimants", "appellant", "appellants",
]);

/** Unusual-costs modifiers that keep 📚 on a contention whose orders are all ordinary costs. */
const UNUSUAL_COSTS_MODIFIERS = [
  "special", "any event", "scale", "solicitor", "double", "lump", "increased", "non-party", "non party", "nonparty",
  "lawyer", "counsel", "personally", "indemnity", "uplift", "against",
];

/** An ordinary costs order ("Costs of this application.", "The defendant pay the plaintiff's costs."):
 * it contains the word "costs" and no word or number outside ORDINARY_COSTS_WORDS. A fixed classification rule the
 * practitioner gave (asking for ordinary costs needs no proposition of law), never a legal judgment
 * made at runtime. It fails closed: any other word -- special, scale, event, against, a party's name,
 * a substantive order "with costs" -- leaves the order unusual, so 📚 fires. */
export function ordinaryCostsOrder(wording: string): boolean {
  const words = wording.toLowerCase().replace(/['’]s\b/g, "").replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(Boolean);
  return words.includes("costs") && words.every((w) => ORDINARY_COSTS_WORDS.has(w));
}

/** A submission that only asks for ordinary costs needs no proposition of law, so 📚 does not derive:
 * it serves at least one order, every wording of every order it serves is an ordinary costs order,
 * and its contention mentions costs and names no unusual-costs modifier. When in doubt it is false
 * and 📚 fires. */
export function ordinaryCostsSubmission(contention: string, servedOrderWordings: readonly string[]): boolean {
  const text = contention.toLowerCase();
  return servedOrderWordings.length > 0 && servedOrderWordings.every(ordinaryCostsOrder) && text.includes("cost") && !UNUSUAL_COSTS_MODIFIERS.some((m) => text.includes(m));
}

/** 👃 suspicious (fact) / dubious (law) (schema v10, #380 -- was facts.posture; work-markers.md
 * row 27): stage-independent doubt seated on the statement itself (statements_of_fact.doubt /
 * statements_of_law.doubt), never the assertion/fact it statements. */
export function doubtMarker(doubt: string | null): string {
  return doubt ? "👃" : "";
}

/** Unless-admitted guard (ADR-0006; GLOSSARY.md glossary "Unless-admitted guard"). A court-record fact needs no proof; an *admitted* fact is admitted only as against the admitting party, so the caller supplies the derived per-fact answer to "has every opposing party tendered an admission of this postulate?". The court-record half reads facts.court_record IS NOT NULL (issue #360/#362 -- facts.source_kind is struck; the query layer derives the boolean). Exported (schema v4, #321) -- callers rendering a fact-side factExcerptMarker() call need the same gate statementOfFactMarkers/noWitnessMarker already apply internally. */
export function isAdmittedGuard(courtRecordLinked: boolean, admittedAgainstAllOpposing: boolean): boolean {
  return courtRecordLinked || admittedAgainstAllOpposing;
}

/** 👤 no witness -- an articulated fact with no statements_of_fact row (every such row is witness-backed: witness_id NOT NULL, schema v3 #328/#320). Issue #345 removed the old allowlist that restricted this to a source_kind subset -- it was the exact complement of the guard under the old flat 'admitted' check and so never fired. Issue #361: a spent admission's rung (🙅🏻‍♂️/🫸/🤷/⚡️) prefixes 👤 the same way renderEvidenceIndex prefixes it onto the unsponsored-exhibit marker (terms-and-symbols.md's routing rule, "🙅🏻‍♂️→👤" etc) -- rung only, no capture markers (💬/📍 are the admission-instrument's own citation concern, and would silently collide under dedupeLineMarkers with the fact-side pinpoint marker in the PART 2 loop). The prefix exists only where 👤 exists: guard or witness-backing suppress both together, matching the exhibit side's hasTender suppression. Flat across parties, no opposing-party filter -- same as the exhibit side (#339). */
export function noWitnessMarker(courtRecordLinked: boolean, hasStatementOfFact: boolean, admittedAgainstAllOpposing: boolean, spentAdmissionGlyphs: string): string {
  if (isAdmittedGuard(courtRecordLinked, admittedAgainstAllOpposing)) return "";
  if (hasStatementOfFact) return "";
  return spentAdmissionGlyphs ? `${spentAdmissionGlyphs} 👤` : "👤";
}

/** 🤫 suppressed (schema v69, terms-and-symbols.md): counsel has set aside the fact-side 👤 on this one
 * line, in their own recorded words. The requirement stands, so the derivation above is unchanged:
 * the caller swaps the printed 👤 for 🤫, leaving any spent rung prefix in place, and still records
 * the 👤 for the Evidence criterion, flagged suppressed. */
export function suppressMarker(witnessMarker: string, suppressed: boolean): string {
  return suppressed ? witnessMarker.replace("👤", "🤫") : witnessMarker;
}

/** Role gate for the exhibit-side 👤 (#398, dual-approved 2026-08-27): only a document a filing
 * selects as substantive evidence can want a tendering witness or admission. 'evidence' and
 * 'other' are eligible; 'witness_statement'/'affidavit'/'order'/'pleading' are testimony
 * instruments, relief drafts, or already part of the court record -- never tendered, never 👤.
 * Gates the marker and its spent-glyph prefix together (the prefix exists only where 👤 exists);
 * it does not gate the Evidence Index's Tendered-by cell, which reports tender rows as data.
 * One shared rule: renderEvidenceIndex and the NoA's Part 4 both call this. */
export function isExhibitTenderRole(role: string): boolean {
  return role === "evidence" || role === "other";
}

/** 👤 no witness, second instance (#330/#333/#339): a filing-selected exhibit no statements_of_fact row and no *tendering* admissions row (statements_of_fact.exhibit_id / admissions.exhibit) tenders it. Reads existence across both dispositions and both sources -- 👤 reads whether anyone is identified at all, not just who's currently deployed (same rule as the fact side, SubmissionFactGroup). No court-record gate -- documents have none. Flat existence across parties, not per-party (#339: the Evidence Index has one row per exhibit, nothing to partition against) -- but state-aware since issue #345: the caller only counts an admissions row toward hasTender once its derived ladder state is a genuine admission (admissionRole === "tenders"), so a denied/refused/no-knowledge/struck admission from any party no longer clears this line. Role-gated since #398 -- see isExhibitTenderRole. */
export function unsponsoredExhibitMarker(hasTender: boolean): string {
  return hasTender ? "" : "👤";
}

export interface StatementOfFactRow {
  interviewed: number; // 0 | 1
  instrument_id: number | null; // statements_of_fact.instrument -- the vehicle document, if any
  instrument_kind: "witness_statement" | "affidavit" | null; // that document's documents.instrument
  instrument_execution: string | null; // that document's documents.execution -- null = unsigned/unsworn
  fact_court_record_linked: boolean; // issue #360/#362: facts.court_record IS NOT NULL
  fact_admitted_by_all_opposing: boolean; // issue #345: derived per-fact coverage, see admittedAgainstAllOpposing
}

/** 🗣️ talk to witness / ✍️ draft it / 🖋️ sign it / ✒️ swear it, gated by the unless-admitted guard (schema v3 #328/#320: sworn_status retired, written/executed derive from the instrument link). */
export function statementOfFactMarkers(row: StatementOfFactRow): string {
  if (isAdmittedGuard(row.fact_court_record_linked, row.fact_admitted_by_all_opposing)) return "";
  const out: string[] = [];
  if (row.interviewed === 0) out.push("🗣️");
  if (row.interviewed === 1 && row.instrument_id === null) out.push("✍️");
  if (row.instrument_id !== null && row.instrument_execution === null) {
    if (row.instrument_kind === "witness_statement") out.push("🖋️");
    if (row.instrument_kind === "affidavit") out.push("✒️");
  }
  return out.join(" ");
}

// --- Admission ladder (issue #344) ------------------------------------
//
// The per-party per-method admission-ladder state (∅ 🎾 ⏳ 🤝 🙅🏻‍♂️ 🫸 🤷 ⏰
// ⚡️ 🕹️ ✅), derived at render time -- never stored (ADR-0006:
// docs/adr/0006-submission-admissions-derived-per-party-per-route.md).
// Source of truth: .claude/skills/drafting-data/references/
// terms-and-symbols.md's ladder table (lines 168-177) and per-method table
// (179-184) -- NOT work-markers.md's superseded single-flag ladder
// (📮 / ⏳ / ⏰⊕🤝⊕🙅🏻‍♂️ on facts.source_kind), which is not implemented
// here and must not be built against (work-markers.md is change-controlled
// and still carries that stale ladder pending #346's gated-edits batch).
//
// Scope (see issue #344's resolution comment for the full reasoning): this
// builds the derivation and renders the rung as decoration on the Evidence
// Index Tendered-by cell (render-vaniac-submissions.ts), including the
// admission-local 🕹️/💬/📍 work it routes. It does NOT touch isAdmittedGuard,
// make unsponsoredExhibitMarker per-party, or change any Tendered-by
// suppression/clearing boolean -- that is issue #345, the blocked follow-on.

export interface AdmissionLadderInput {
  method: "notice_to_admit" | "pleading" | "interrogatories" | "oral";
  instrument: number | null; // admissions.instrument
  instrumentServedOn: string | null; // that document's served_on (issue #344 column)
  instrumentPinpoint: string | null; // admissions.instrument_pinpoint
  responseDue: string | null; // admissions.response_due
  response: number | null; // admissions.response
  responseDate: string | null; // that document's document_date
  responsePinpoint: string | null; // admissions.response_pinpoint
  responseExcerpt: string | null; // admissions.response_excerpt
  answer: "agreed" | "denied" | "refused" | "no_knowledge" | null;
  struckOn: string | null; // admissions.struck_on
  // Caller-fetched booleans for the 🕹️ predicate (terms-and-symbols.md line 264,
  // "no filing selects the response ⊕, for ⏰, the admission instrument +
  // affidavit of service") -- reads across all filings in the proceeding,
  // not just the one being rendered (pinned interpretation, #344).
  responseFilingSelected: boolean; // some filing_documents row selects the response document
  instrumentAndServiceSelected: boolean; // some filing selects the instrument AND (same filing) carries a role='affidavit' row
  defaultJudgmentRequisitionExists: boolean; // some filings row is kind='requisition_default_judgment' (pleading ⏰'s 🕹️)
}

export type AdmissionLadderState =
  | "not_sought" // ∅ -- instrument not yet drafted, never prints
  | "serve" // 🎾 -- drafted, serve it
  | "waiting" // ⏳ -- served, response period running (possibly a court-reset one)
  | "admitted" // intermediate only -- always refined to "tender"/"clean" by refineTender
  | "denied" // 🙅🏻‍♂️
  | "refused" // 🫸
  | "no_knowledge" // 🤷
  | "deemed" // ⏰ -- bare when the route's deemed consequence is undefined (interrogatories); otherwise refined
  | "struck" // ⚡️ -- bare, no new response_due (or one no later than the strike)
  | "tender" // event prefixing 🕹️ -- tender the proof, base names which event
  | "clean"; // ✅ -- 🕹️ cleared, never prints

export interface AdmissionLadderResult {
  state: AdmissionLadderState;
  /** Set only when state is "tender" or "clean": which rung 🕹️ refined. */
  base?: "admitted" | "deemed";
  /** Set only when state is "waiting" reached via a court-reset response_due after a strike (renders "⚡️ ⏳" instead of bare "⏳"). */
  struckReset?: boolean;
}

function classifyAdmission(row: AdmissionLadderInput): AdmissionLadderResult {
  if (row.method === "pleading" && row.answer === null) {
    // Ladder rung 4's pleading rule: a silent pleading response ⇒ 🤷.
    return { state: "no_knowledge" };
  }
  switch (row.answer) {
    case "agreed":
      return refineTender({ state: "admitted", base: "admitted" }, row);
    case "denied":
      return { state: "denied" };
    case "refused":
      return { state: "refused" };
    case "no_knowledge":
      return { state: "no_knowledge" };
    default:
      // Reached only for a non-pleading row with a response but no answer
      // yet -- schema's CHECK(answer IS NULL OR response IS NOT NULL)
      // permits it. No rung names this state; treat as unclassified.
      return { state: "no_knowledge" };
  }
}

function deemedOrWaitingAdmission(row: AdmissionLadderInput, today: string): AdmissionLadderResult {
  if (row.responseDue === null) return { state: "waiting" };
  if (today <= row.responseDue) return { state: "waiting" };
  // today > response_due -- deemed.
  if (row.method === "interrogatories") {
    // Undefined route: bare ⏰, no 🕹️ refinement -- the routing decision is the work.
    return { state: "deemed" };
  }
  return refineTender({ state: "deemed", base: "deemed" }, row);
}

function refineTender(result: AdmissionLadderResult, row: AdmissionLadderInput): AdmissionLadderResult {
  let outstanding: boolean;
  if (result.base === "admitted") {
    outstanding = !row.responseFilingSelected;
  } else if (row.method === "notice_to_admit") {
    outstanding = !row.instrumentAndServiceSelected;
  } else {
    // pleading, deemed -- per-method table: 🕹️ = default-judgment requisition.
    outstanding = !row.defaultJudgmentRequisitionExists;
  }
  return outstanding ? { state: "tender", base: result.base } : { state: "clean", base: result.base };
}

/**
 * The admission-ladder state for one `admissions` row. `today` is
 * caller-supplied ("YYYY-MM-DD") -- this function never reads the clock,
 * so golden-fixture tests stay reproducible. Dates compare lexicographically
 * (SQLite DATE columns here are ISO text, which orders correctly as strings).
 * "In time" is inclusive of the due date (date <= response_due).
 *
 * Pinned interpretations (flagged in issue #344's resolution comment, not
 * improvised): "judgment entered" has no schema representation, so a late
 * pleading response always classifies by its answer (never "after judgment:
 * no effect"), and pleading-⏰'s 🕹️ clears on the default-judgment
 * requisition existing, not on judgment actually entering.
 */
export function admissionLadderState(row: AdmissionLadderInput, today: string): AdmissionLadderResult {
  // ∅ -- not sought from this party.
  if (row.instrument === null) return { state: "not_sought" };

  // Oral rows are born answered: 🎾/⏳/⏰ never apply (no response period).
  if (row.method === "oral") {
    if (row.struckOn !== null) return { state: "struck" };
    if (row.answer !== null) return classifyAdmission(row);
    // Answer-less oral row: incomplete seed data the schema's CHECK
    // permits but the ladder names no rung for -- render nothing.
    return { state: "not_sought" };
  }

  // 🎾 drafted, unserved -- never from a bare document served_on, only via
  // this admissions row (terms-and-symbols.md marker-table line 263). A
  // response with no recorded service date falls through instead -- the
  // response proves service happened.
  if (row.instrumentServedOn === null && row.response === null) {
    return { state: "serve" };
  }

  // Struck: classifyAdmission() requires struck_on ∅, so every struck row
  // resolves here, never by its response.
  if (row.struckOn !== null) {
    const struckOn = row.struckOn;
    if (row.responseDue === null || row.responseDue <= struckOn) {
      return { state: "struck" };
    }
    // A court-reset response_due beyond the strike date exists.
    if (today <= row.responseDue) return { state: "waiting", struckReset: true };
    // The reset deadline has itself now expired -- falls through to deemed.
    return deemedOrWaitingAdmission(row, today);
  }

  // Response present, not struck.
  if (row.response !== null) {
    const late = row.responseDue !== null && row.responseDate !== null && row.responseDate > row.responseDue;

    if (row.method === "pleading") {
      // Judgment-entered is not derivable (pinned interpretation) -- a
      // pleading response always classifies, late or not.
      return classifyAdmission(row);
    }
    if (row.method === "interrogatories") {
      // The practitioner's own classification is the routing decision the
      // undefined-route bare ⏰ waits for -- classify whenever answer is
      // set, regardless of lateness.
      if (row.answer !== null) return classifyAdmission(row);
      // No classification yet -- fall through to the deemed/waiting timing
      // check below (bare ⏰, undefined route).
    } else if (row.method === "notice_to_admit") {
      if (!late && row.answer !== null) return classifyAdmission(row);
      // Late, or in time but silent (answer NULL) -- "silent on an item
      // counts as no response" -- fall through to the timing check.
    }
  }

  // No (effective) response, served -- waiting/deemed by response_due.
  return deemedOrWaitingAdmission(row, today);
}

/** Bare rung glyph for an AdmissionLadderResult ("" for not_sought/clean -- ∅ and ✅ never print, work-markers.md rule 6). */
export function admissionRungMarker(r: AdmissionLadderResult): string {
  switch (r.state) {
    case "not_sought":
    case "clean":
      return "";
    case "serve":
      return "🎾";
    case "waiting":
      return r.struckReset ? "⚡️ ⏳" : "⏳";
    case "denied":
      return "🙅🏻‍♂️";
    case "refused":
      return "🫸";
    case "no_knowledge":
      return "🤷";
    case "deemed":
      return "⏰";
    case "struck":
      return "⚡️";
    case "admitted":
      // Not normally reachable -- classifyAdmission always refines an
      // "agreed" answer through refineTender before returning.
      return "🤝";
    case "tender":
      // Event prefixes the work it routed (work-markers.md §1b).
      return `${r.base === "deemed" ? "⏰" : "🤝"} 🕹️`;
    default:
      return "";
  }
}

// --- Per-party guard (issue #345) --------------------------------------

/** How one admissions row's derived state bears on proof (ADR-0006; terms-and-symbols.md ladder).
 *  "tenders"     -- 🤝 🕹️ / ⏰ 🕹️ / ✅: a genuine admission. Clears 👤 on the exhibit it
 *                   names and silences the evidence ladder for its fact *as against this party*.
 *  "outstanding" -- 🎾 ⏳ and the bare ⏰ of an undefined route (interrogatories): the admission
 *                   is still live work. Not proof (ADR-0006: never invent the outcome of a route
 *                   the practitioner has not defined), but its rung is real work and the Evidence
 *                   Index's Tendered-by cell is the only surface that renders it today, so it keeps
 *                   its line there.
 *  "spent"       -- 🙅🏻‍♂️ 🫸 🤷 ⚡️ and ∅: never becoming an admission. Drops off the Tendered-by
 *                   cell and routes the work to 👤 (terms-and-symbols.md: "🙅🏻‍♂️→👤", "⚡️→⏳ ⊕ 👤").
 *  The unreachable bare "admitted" rung sits in "outstanding" deliberately -- refineTender always
 *  refines an "agreed" answer, and if that ever changed, failing toward *showing* work is safe. */
export type AdmissionRole = "tenders" | "outstanding" | "spent";
export function admissionRole(r: AdmissionLadderResult): AdmissionRole {
  switch (r.state) {
    case "tender":
    case "clean":
      return "tenders";
    case "serve":
    case "waiting":
    case "deemed":
    case "admitted":
      return "outstanding";
    default:
      return "spent";
  }
}

/** The unless-admitted guard's per-party half (ADR-0006, GLOSSARY.md "Unless-admitted guard").
 *  A fact renders on one line, not one line per party, so the only rendering that honours
 *  "still needs proof against B" is: silence the line only once *every* opposing party has a
 *  tendering admission on that fact, by any method. A party never asked has no row and so is
 *  never covered. No opposing parties at all returns false -- a proceeding with none is
 *  malformed data, and failing toward showing work is the safe direction. */
export function admittedAgainstAllOpposing(tenderingPartyIds: ReadonlySet<number>, opposingPartyIds: readonly number[]): boolean {
  return opposingPartyIds.length > 0 && opposingPartyIds.every((id) => tenderingPartyIds.has(id));
}

/** Admission-local capture work (terms-and-symbols.md marker-table lines ~253-254, admission clauses;
 * work-markers.md rows 📑 💬 📌 🧷) -- fires on the response's captured passage and on either
 * pinpoint, and the *pair* is set by `method`: notice_to_admit ⊕ pleading owe 📑 and 📌 (answers
 * drafted by counsel), interrogatories ⊕ oral owe 💬 and 🧷 (the party's own words).
 *
 * Gated on the derived state (work-markers.md §5 "Proof (admission)": ⏰/🤝 → ((📑 ∨ 📌) ⊕ (💬 ∨
 * 🧷)) ∨ 🕹️ → clean): capture is owed only once the row is deemed or admitted, or a tender/clean
 * refinement of either. Before that rung the response is not yet proof of anything, and a spent
 * rung (denied/refused/no-knowledge/struck) never becomes one -- neither owes capture work. Past
 * the gate nothing else silences it (§2: "every proof path ends at a pinpoint"). */
export function admissionCaptureMarkers(row: AdmissionLadderInput, state: AdmissionLadderResult): string {
  if (state.state !== "deemed" && state.state !== "admitted" && state.state !== "tender" && state.state !== "clean") return "";
  const basis: ExcerptBasis = row.method === "notice_to_admit" || row.method === "pleading" ? "exhibit" : "testimony";
  const out: string[] = [];
  if (row.response !== null) {
    const excerpt = excerptMarker(basis, row.responseExcerpt);
    if (excerpt) out.push(excerpt);
  }
  const instrumentPinpointMissing = row.instrument !== null && (row.instrumentPinpoint === null || row.instrumentPinpoint === "");
  const responsePinpointMissing = row.response !== null && (row.responsePinpoint === null || row.responsePinpoint === "");
  if (instrumentPinpointMissing || responsePinpointMissing) out.push(basis === "exhibit" ? "📌" : "🧷");
  return out.join(" ");
}
