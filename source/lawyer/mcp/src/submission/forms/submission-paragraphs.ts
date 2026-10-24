// One submission's numbered paragraphs, and the ledger of the number each contention got.

import { authorityNotKilled, authorityNotOverruled, countsAsSupport, notFailed } from "./brief-only-cap.js";
import { lawStatementCitationLine, lawStatementMarkers, scrutinyFailedTag } from "./law-statement-line.js";
import {
  courtRecordCitation,
  courtRecordPinpointMarker,
  dedupeLineMarkers,
  doctrinalSlotMarker,
  factualBasisMarker,
  noWitnessMarker,
  ordinaryCostsSubmission,
  printMarkerSets,
  propositionNeededMarker,
  sourceRungMarker,
  suppressMarker,
  treatmentMarker,
} from "./markers.js";
import { lawItem, recordCriterionGlyphs, recordFactStatementGlyphs, recordGlyphs, recordLawStatementGlyphs, type MarkerInventory } from "./proposal-inventory.js";
import type { RenderContext } from "./render-context.js";
import { reviewMarkerFor, type ReviewState } from "./review-state.js";
import { factStatementCitationLine, factStatementMarkers, pushStatementLines } from "./statement-lines.js";
import type { SubmissionFactGroup, SubmissionLawGroup } from "./submission-groups.js";
import type { LawAssertionRow, PointerDocument } from "./submission-reads.js";

export interface RenderedParagraphs {
  lines: string[];
  nextPara: number;
}

/**
 * Renders a submission's argument as standalone numbered paragraphs (ticket 2026-09-01,
 * reversing ticket 2026-08-31's Fable-reviewed removal: the contention sentence -- the
 * submission's own plain-English point -- is restored as the argument's opening paragraph,
 * because dropping it left law-only submissions with no printed point and law-free submissions
 * with no printed paragraph at all). The contention always renders first, in normal weight (bold is for headings only), carrying this
 * submission's `<!-- submission_id N -->` trace and any submission-level marker. One paragraph
 * per postulate the submission `rests_on` and per proposition it `requires` follows, each with
 * its own statement's verbatim excerpt(s) and citation(s) stacked beneath it -- facts render
 * before law (preserves the traversal order this file has always used).
 *
 * startPara is the next paragraph number to assign; nextPara is handed back so the caller's own
 * counter convention (single running counter, per-Part restart, or continuous across Parts) stays
 * entirely the caller's business.
 *
 * extraFirstParagraphMarker: an additional *submission-level* marker glyph (already deduped by
 * the caller if composed of several) to attach to the contention line -- e.g. 🧵 loose-thread
 * (NoA/Application Response only). 🧾 factual basis needed is computed internally
 * (facts.length === 0 and no opts.noFactsNeededOn) and merged into the same slot, and so is 📚
 * proposition needed (lawAssertions.length === 0, no opts.noLawNeededOn, and not an ordinary-costs
 * submission per opts.servedOrderWordings). A submission with
 * neither link and no record carries both.
 *
 * A submission with no linked facts and no linked law (the schema allows this -- "neither link
 * required, both ∅ held") still renders its contention as a normal numbered paragraph, with no
 * law/fact paragraphs after it -- it never silently disappears, and it consumes exactly one
 * paragraph number like any other submission.
 *
 * The brief-only cap (schema v10, #380; #370 item 4; extended schema v16 for killed
 * authorities; extended again by #842 for overruled ones): an impeachment fact statement
 * (purpose='impeachment') or a law statement resting on a 'lead', killed
 * (`authorities.killed_on` set) or overruled (`authorities.treatment='overruled'`) authority
 * never rides into a deployed document -- all are simply excluded here. They are not routed
 * anywhere by this function; the reserve inventory (render-companions.ts) records their
 * Proposals from its own whole-pool walk, and no page prints them.
 *
 * renderedLawAssertions (ticket 2026-09-01, one paragraph per assertion, deduped; cross-
 * references settled 2026-09-01): a law assertion is a first-class numbered paragraph, so a
 * proposition two or more submissions `requires` never repeats its full excerpt-and-citation
 * block. Its first occurrence in document order renders in full and records its assigned
 * paragraph number in the Map; every later occurrence renders as its own numbered
 * cross-reference paragraph -- "As set out in paragraph {M}, above, {proposition}" (verbatim
 * proposition, no excerpt, no citation line, no statement markers) -- so every submission keeps
 * a numbered anchor and mockup/filed-face numbering stay aligned. The caller owns one Map per
 * rendered document (one running Analysis/Written Argument section), created before its
 * submissions loop and passed to every call so dedup state carries across submissions; the
 * default `new Map()` makes a caller that passes nothing dedupe only within that single call,
 * i.e. not at all (there are no duplicate law_assertion_id rows within one submission's own
 * group). Facts are deduped only through `factParagraphs`, by the two callers whose document has
 * its own facts part -- otherwise a submission's own `rests_on` link is its own fact paragraph
 * regardless of reuse elsewhere.
 *
 * opts -- every field defaults to the behaviour every
 * venue renderer already had, so the four existing call sites are unchanged and their goldens stay
 * byte-identical. Only recordReserveInventory passes paragraphPrefix, includeLeadStatements or scrutinyLive:
 *   paragraphPrefix        labels paragraphs "R1." instead of "1." (its held-in-reserve walk,
 *                          whose submissions appear in no venue document and so have no number to
 *                          borrow). Applied to cross-references too, which is only sound because
 *                          the caller gives a prefixed section its OWN renderedLawAssertions Map
 *                          -- a prefixed and an unprefixed number must never share one.
 *   includeLeadStatements  lifts the brief-only cap on `verification='lead'` statements AND on
 *                          statements resting on a killed authority (`authorities.killed_on`
 *                          set, schema v16) or an overruled one (`treatment='overruled'`,
 *                          #842) -- all three ride the identical cap. Printing only: the
 *                          proposition's own markers are unaffected by this flag, so a lead-only
 *                          assertion records the same 🔬 (#502) in both walks, with the excerpt's
 *                          own statement lines added only here.
 *   inventory              the render context's Proposal inventory (forms/proposal-inventory.ts),
 *                          which every caller passes as `ctx.inventory`. Optional only so the
 *                          shape stays one object; a caller that omits it records nothing. The
 *                          recording sits beside pushStatementLines, where the source row and the
 *                          glyph string the site just computed are both still in hand -- never a
 *                          second predicate pass, never a markdown scan (design §8).
 *   review                 passed by every forum caller as `ctx.review`; the reserve inventory omits
 *                          it, so it records no 🧐.
 *   scrutinyLive           false for a law assertion that no submission or order deployed on a
 *                          live Writing relies on (spec R6, schema v47): its statement lines then
 *                          raise no 🔬. Read per statement, so a statement shared with a
 *                          live-deployed submission keeps 🔬 on every line it prints on. Only the
 *                          reserve inventory passes it; every other caller renders a deployed
 *                          submission, whose assertions are all relied on (the default).
 *   noFactsNeededOn        submissions.no_facts_needed_on (schema v48), passed by every caller from
 *                          its row: counsel's recorded decision that the contention needs no stated
 *                          fact. Set on a submission with no linked fact, it clears 🧾 and prints
 *                          the plain-text tag ` (no stated fact needed, per counsel <date>)` after
 *                          the contention. With a linked fact it prints nothing. The database
 *                          clears it when the wording changes, so a set value holds for this wording.
 *   noLawNeededOn          submissions.no_law_needed_on (schema v60), passed by every caller from its
 *                          row: counsel's recorded decision that the contention needs no stated law.
 *                          Set on a submission with no linked proposition, it clears 📚 and prints
 *                          the plain-text tag ` (no stated law needed, per counsel <date>)` after the
 *                          contention. With a linked proposition it prints nothing. The database
 *                          clears it when the wording changes, and refuses it beside noFactsNeededOn.
 *   servedOrderWordings    the row's `served_order_wordings` (query.ts servedOrderWordingsColumn),
 *                          passed by every caller beside noLawNeededOn. A submission whose served
 *                          orders are all ordinary costs orders derives no 📚 and prints no tag.
 *   factParagraphs        fact id -> that fact's paragraph number in this document's own facts
 *                          part, passed only by the Notice of Application (Part 2) and the
 *                          Application Response (Part 4). The legal-basis Part prints no fact
 *                          text: a linked fact in the map is not re-printed and records nothing
 *                          here, and the contention line ends with
 *                          `<!-- supporting fact paragraphs: 1, 3 -->` (ascending). A linked fact
 *                          absent from the map (the database places every one on a drafting
 *                          Writing, schema v59, so only a legacy database or a changed kind leaves
 *                          one) is not printed either: the comment names it after the numbers,
 *                          `<!-- supporting fact paragraphs: 1; NOT PLACED: fact 7 "<postulate>" -->`,
 *                          and the filed face refuses (forms/unplaced-facts.ts). With nothing to
 *                          list and 🧾 firing, it ends `🧾<!-- supporting fact paragraphs:  NONE -->`
 *                          and 🧾 leaves the line's marker set; with nothing to list and no 🧾, no
 *                          comment prints. 📚 never moves onto the comment: it stays in the line's
 *                          marker set in this mode too, because law is never folded into a comment.
 *   printUnplacedFacts     true for a sent or retired Writing, which renders as it was sent: a
 *                          linked fact absent from factParagraphs prints in full, as before v59,
 *                          and the comment lists the numbers alone.
 */
export function renderSubmissionParagraphs(
  submissionId: number,
  contention: string,
  startPara: number,
  facts: SubmissionFactGroup[],
  lawAssertions: SubmissionLawGroup[],
  exhibitMap: Map<number, number>,
  labelMap: Map<number, string>,
  copyMarkers: Map<number, string>,
  extraFirstParagraphMarker = "",
  renderedLawAssertions: Map<number, number> = new Map(),
  opts: { paragraphPrefix?: string; includeLeadStatements?: boolean; inventory?: MarkerInventory; review?: ReviewState; scrutinyLive?: (lawAssertionId: number) => boolean; noFactsNeededOn?: string | null; noLawNeededOn?: string | null; servedOrderWordings?: string | null; factParagraphs?: ReadonlyMap<number, number>; printUnplacedFacts?: boolean } = {}
): RenderedParagraphs {
  const prefix = opts.paragraphPrefix ?? "";
  const inv = opts.inventory;
  const lines: string[] = [];
  let para = startPara;
  const submissionTrace = `<!-- submission_id ${submissionId} -->`;
  const factParagraphs = opts.factParagraphs;

  // Site 1: 🧾 and 📚 key on the submission. extraFirstParagraphMarker rides the same line but belongs
  // to the caller (🧵 on its own pointer row, 🂡 which never generates), so it is recorded there,
  // and it prints as its own set beside the submission's.
  const factualBasis = facts.length === 0 && !opts.noFactsNeededOn ? factualBasisMarker(false) : "";
  // A submission that only asks for ordinary costs derives no 📚 at all (markers.ts ordinaryCostsSubmission).
  const ordinaryCosts = ordinaryCostsSubmission(contention, JSON.parse(opts.servedOrderWordings ?? "[]") as string[]);
  const propositionNeeded = lawAssertions.length === 0 && !opts.noLawNeededOn && !ordinaryCosts ? propositionNeededMarker(false) : "";
  const contentionMarker = dedupeLineMarkers([factualBasis, propositionNeeded, extraFirstParagraphMarker]);
  if (inv) recordGlyphs(inv, factualBasis, ["🧾"], { table: "submissions", id: submissionId, item: contention });
  if (inv) recordGlyphs(inv, propositionNeeded, ["📚"], { table: "submissions", id: submissionId, item: contention });
  const review1 = reviewMarkerFor(opts.review, inv, contentionMarker, "submissions", submissionId, contention);
  // Reference mode (factParagraphs set): 🧾 prints against the supporting-fact-paragraphs comment
  // instead of in the line's marker set. Its derivation and recording above are unchanged. 📚 stays
  // in the line's marker set in every mode.
  const contentionLine = printMarkerSets([
    dedupeLineMarkers(factParagraphs ? [propositionNeeded, review1] : [factualBasis, propositionNeeded, review1]),
    extraFirstParagraphMarker,
  ]);
  // Counsel's no-facts-needed decision (schema v48) is plain text, never a glyph (work-markers rule
  // 5), and the filed-face strip removes it (filed-face.ts), as the v47 settled tag.
  // It prints only where it suppresses 🧾: a submission with a linked fact prints neither.
  const noFactsTag = facts.length === 0 && opts.noFactsNeededOn ? ` (no stated fact needed, per counsel ${opts.noFactsNeededOn})` : "";
  // Counsel's no-law-needed decision (schema v60), on the same footing: it prints only where it
  // suppresses 📚. The database refuses both decisions on one row, so at most one tag prints.
  const noLawTag = lawAssertions.length === 0 && opts.noLawNeededOn ? ` (no stated law needed, per counsel ${opts.noLawNeededOn})` : "";
  // The legal-basis Part prints no fact text. A linked fact already numbered in this document's
  // facts part records nothing here: that part printed its line and recorded its glyphs under the
  // same keys. It is named by its paragraph number in a comment instead. A linked fact absent from
  // that part is named NOT PLACED in the same comment, unprinted and unrecorded, except on a sent or
  // retired Writing, which prints it in full as it was sent.
  const unplacedFacts = factParagraphs ? facts.filter((f) => !factParagraphs.has(f.factId)) : [];
  const printedFacts = !factParagraphs ? facts : opts.printUnplacedFacts ? unplacedFacts : [];
  const refNumbers = factParagraphs
    ? facts.filter((f) => factParagraphs.has(f.factId)).map((f) => factParagraphs.get(f.factId) as number).sort((a, b) => a - b)
    : [];
  const refs = [
    ...(refNumbers.length > 0 ? [refNumbers.join(", ")] : []),
    ...(opts.printUnplacedFacts ? [] : unplacedFacts.map((f) => `NOT PLACED: fact ${f.factId} ${JSON.stringify(f.postulate)}`)),
  ];
  const factRefComment = !factParagraphs
    ? ""
    : refs.length > 0
      ? ` <!-- supporting fact paragraphs: ${refs.join("; ")} -->`
      : factualBasis
        ? ` ${factualBasis}<!-- supporting fact paragraphs:  NONE -->`
        : "";
  para += 1;
  lines.push("");
  lines.push(`${prefix}${para}. ${contention}${noFactsTag}${noLawTag}${contentionLine ? ` ${contentionLine}` : ""} ${submissionTrace}${factRefComment}`);

  for (const f of printedFacts) {
    const courtRecordLinked = f.courtRecord !== null;
    // 👤 reads existence across every purpose, not just what's printed below
    // (mirrors the exhibit side, #339/#345) -- an impeachment-only statement
    // still identifies a witness, so f.statements (unfiltered) feeds the
    // marker while the loop below filters what actually prints.
    // Site 2: the court-record 📌 keys on the fact. 👤 never generates (design §4), and is recorded
    // on the fact for the Evidence criterion (Goal card design §2.7).
    const courtRecordPin = courtRecordPinpointMarker(f.courtRecord, f.courtRecordPinpoint, f.courtRecordExecution, f.courtRecordExhibitLetters);
    // A suppressed 👤 (schema v69) prints as 🤫 and is recorded as 👤, flagged, so the criterion
    // counts it met.
    const witnessMarker = noWitnessMarker(courtRecordLinked, f.statements.length > 0, f.admitted, f.spentAdmissionGlyphs);
    const marker = dedupeLineMarkers([suppressMarker(witnessMarker, f.witnessSuppressed), courtRecordPin]);
    if (inv) recordGlyphs(inv, courtRecordPin, ["📌"], { table: "facts", id: f.factId, item: f.postulate });
    if (inv) recordCriterionGlyphs(inv, witnessMarker, ["👤"], { table: "facts", id: f.factId, item: f.postulate, ...(f.witnessSuppressed ? { suppressed: true as const } : {}) });
    const factReview = reviewMarkerFor(opts.review, inv, marker, "facts", f.factId, f.postulate);
    const factLine = printMarkerSets([dedupeLineMarkers([marker, factReview])]);
    const courtRecordCite = courtRecordCitation(f.courtRecord, f.courtRecordPinpoint);
    para += 1;
    lines.push("");
    lines.push(`${prefix}${para}. ${f.postulate}${courtRecordCite ? ` ${courtRecordCite}` : ""}${factLine ? ` ${factLine}` : ""} <!-- fact_id ${f.factId} -->`);
    for (const s of f.statements) {
      if (s.purpose === "impeachment") continue;
      const citationLine = factStatementCitationLine(exhibitMap, labelMap, s);
      const copyMarker = s.instrument_id !== null ? copyMarkers.get(s.instrument_id) ?? "" : "";
      const statementGlyphs = factStatementMarkers(s, courtRecordLinked, f.admitted, copyMarker);
      // Sites 3 / 3' / 3'': one glyph string, three keyed rows. 👃 and 🏆 never generate; the
      // recorder flags them `generating: false` for the Evidence criterion.
      if (inv) recordFactStatementGlyphs(inv, statementGlyphs, s, f.postulate);
      const statementReview = reviewMarkerFor(opts.review, inv, statementGlyphs, "statements_of_fact", s.statement_id, `${s.witness_name}: ${f.postulate}`);
      pushStatementLines(
        lines,
        s.exhibit_id !== null ? s.exhibit_excerpt : s.excerpt,
        citationLine,
        printMarkerSets([dedupeLineMarkers([statementGlyphs, statementReview])]),
        "statement_of_fact_id",
        s.statement_id
      );
    }
  }

  for (const la of lawAssertions) {
    const priorPara = renderedLawAssertions.get(la.lawAssertionId);
    if (priorPara !== undefined) {
      // Already rendered in full earlier in this document: a numbered cross-reference
      // paragraph, nothing stacked beneath it.
      para += 1;
      lines.push("");
      lines.push(`${prefix}${para}. As set out in paragraph ${prefix}${priorPara}, above, ${la.proposition} <!-- law_assertion_id ${la.lawAssertionId} -->`);
      continue;
    }
    // Three lists, deliberately. `live` is every statement of law from a non-killed authority.
    // `counted` narrows it to the set the proposition's own markers read: 📖 🔬 🥉 🥈 🏅 are blind
    // to a killed authority's statements (work-markers.md §4 "Killed") and, since #830, to an
    // overruled authority's too -- it is not good law, so a proposition holding nothing else has
    // lost its doctrinal basis, and leaving those statements in would let an overruled 🥇 mask a
    // live 🥉. `verifiedCounted` is that set's non-lead half, and since #842 it is also what
    // renders: a statement on a killed OR an overruled authority rides the brief-only cap exactly
    // as a lead one does (#370 item 4; schema v16; work-markers.md §1 "Overruled binds every row
    // of 1a"), so all three print on no face and an authority the court has
    // rejected is never quoted to a forum. A failed statement (schema v46) is blind to the
    // proposition's markers on the same ground as an overruled one: the research lawyer found it
    // does not support the proposition, so a proposition holding nothing else reads 📖 again.
    // `verifiedCounted` reads countsAsSupport, so a failed statement never renders either. A settled
    // statement (schema v47, counsel's confirmed close over a finding) counts and renders exactly as
    // a verified one does.
    const live = la.statements.filter(authorityNotKilled);
    const counted = live.filter(authorityNotOverruled).filter(notFailed);
    const verifiedCounted = counted.filter(countsAsSupport);
    const printStatements = opts.includeLeadStatements ? la.statements : verifiedCounted;
    // 🚧 and 📖 own the line whenever either fires, so the rung never merges with them: 📖
    // structurally (no counted statement => sourceRungMarker returns ""), 🚧 by choice (issue #365
    // pinned interpretation -- "researched, nothing found" has already answered the "get better
    // authority" work 🥉/🥈 asks for, and work-markers.md §5 calls 🚧 the only terminal). 🔬 does
    // co-render with the rung (work-markers.md rows 🔬/🥉), so it goes through dedupeLineMarkers
    // rather than the fallback. The rung reads the verified statements when any exist, else the
    // leads: a verified tertiary statement is never masked by a lead primary one, and a lead-only
    // proposition still shows "get primary".
    const bare = doctrinalSlotMarker({ dead_end: la.deadEnd, countedStatements: counted.length, verifiedStatements: verifiedCounted.length });
    const rung = sourceRungMarker((verifiedCounted.length > 0 ? verifiedCounted : counted).map((s) => s.source));
    // ⛔ joins this line while any live statement's authority is overruled (work-markers.md §1
    // "Overruled binds every row of 1a", #1200). Where no counted statement is left it prefixes the
    // 📖 it reopened (Types, ⛔→🏛️⊕📖), as the order's line carries ⛔ 🏛️. Where one survives it
    // renders beside 🧐, the review confirming the overruling, since the overruled statement itself
    // prints on no face; once approved, the bare ⛔ names the routing decision left.
    // 🚧 keeps owning the line alone, since "researched, nothing found" has already answered the
    // reopen.
    const overruled = live.some((s) => s.treatment === "overruled") ? treatmentMarker("overruled") : "";
    const doctrinal = bare === "🚧" ? bare : bare === "📖" ? dedupeLineMarkers([overruled, bare]) : dedupeLineMarkers([overruled, bare, rung]);
    // Site 4: 📖 and the 🥉/🥈 rung key on the proposition. 🔬's proposition-line roll-up, 🚧 and
    // 🏅 never generate (design §4) -- recordGlyphs takes only what this site may propose. The
    // three are recorded on the proposition for the Goal card's criteria (Goal card design §2.7).
    // The rung prints fused to 🏅 (🥈🏅, 🥉🏅), so 🏅 is stripped for the whole-token match (#908).
    // While a live statement of the proposition has failed scrutiny (schema v46), its 📖 still
    // prints and still counts for the criteria, but proposes nothing: the next step is counsel's
    // decision on the finding, not new research.
    const scrutinyFailed = live.some((s) => s.verification === "failed");
    if (inv) recordGlyphs(inv, doctrinal.replaceAll("🏅", ""), scrutinyFailed ? ["🥉", "🥈"] : ["📖", "🥉", "🥈"], { table: "law_assertions", id: la.lawAssertionId, item: la.proposition });
    if (inv) recordCriterionGlyphs(inv, doctrinal, scrutinyFailed ? ["🚧", "🔬", "🏅", "📖"] : ["🚧", "🔬", "🏅"], { table: "law_assertions", id: la.lawAssertionId, item: la.proposition, instance: "proposition" });
    const propositionReview = reviewMarkerFor(opts.review, inv, doctrinal, "law_assertions", la.lawAssertionId, la.proposition);
    const propositionLine = printMarkerSets([dedupeLineMarkers([doctrinal, propositionReview])]);
    // #1202: while ⛔ prints, a plain-text tag names each overruled authority once, so counsel can
    // confirm the overruling, since no face prints the overruled statements themselves. The
    // reserve inventory's walk (includeLeadStatements) carries no tag. It sits
    // immediately before ⛔, the anchor the filed-face strip matches on (filed-face.ts), and is
    // joined here rather than through dedupeLineMarkers, which would split it into words.
    const overruledMarkerPrinted = overruled !== "" && doctrinal.startsWith(overruled); // false when 🚧 owns the line
    const overruledTag = overruledMarkerPrinted && !opts.includeLeadStatements ? ` ${overruledAuthorityTag(live)}` : "";
    // A live statement the research lawyer failed (schema v46) tags the line with its finding,
    // whether or not another statement still supports it, so the line never reads clean while a
    // decision is owed. Like the overruled tag it is left out of the reserve inventory's walk,
    // which includes the failed statement itself. It precedes the overruled tag, which must stay
    // immediately before ⛔; filed-face.ts strips both.
    const failedTag = opts.includeLeadStatements ? "" : scrutinyFailedTag(live);
    para += 1;
    renderedLawAssertions.set(la.lawAssertionId, para);
    lines.push("");
    lines.push(`${prefix}${para}. ${la.proposition}${failedTag}${overruledTag}${propositionLine ? ` ${propositionLine}` : ""} <!-- law_assertion_id ${la.lawAssertionId} -->`);
    for (const s of printStatements) {
      const statementGlyphs = lawStatementMarkers(s, opts.scrutinyLive?.(la.lawAssertionId) ?? true);
      // Sites 5 / 5': 📜 📍 🔬 key on the statement, 📇 and 🏅 on its authority. A killed authority's
      // statement line prints no marker at all, so the recorder is handed an empty glyph string
      // and records nothing -- design §4's "never generate", with no filter of its own.
      if (inv) recordLawStatementGlyphs(inv, statementGlyphs, { ...s, statement_id: s.statement_id as number });
      const statementReview = reviewMarkerFor(opts.review, inv, statementGlyphs, "statements_of_law", s.statement_id as number, lawItem(s));
      pushStatementLines(lines, s.excerpt, lawStatementCitationLine(s), printMarkerSets([dedupeLineMarkers([statementGlyphs, statementReview])]), "statement_of_law_id", s.statement_id as number);
    }
  }

  return { lines, nextPara: para };
}

/** `(overruled: <title>, <citation>; ...)` over a proposition's live statements whose authority is
 * overruled: each authority once, in first-statement order, the citation omitted when none is
 * recorded. Whitespace runs collapse to one space
 * so the tag stays on one line for the filed-face strip. */
function overruledAuthorityTag(live: LawAssertionRow[]): string {
  const names = new Map<number | null, string>();
  for (const s of live) {
    if (s.treatment !== "overruled" || names.has(s.authority_id)) continue;
    const name = `${s.authority_title ?? ""}${s.authority_citation ? `, ${s.authority_citation}` : ""}`;
    names.set(s.authority_id, name.replace(/\s+/g, " ").trim());
  }
  return `(overruled: ${[...names.values()].join("; ")})`;
}

/**
 * Records the paragraph number a venue renderer is about to assign to one submission's contention
 * (always startPara + 1 -- renderSubmissionParagraphs increments before it prints). Called
 * immediately before each renderSubmissionParagraphs call so the reserve inventory can reproduce this
 * document's numbering instead of re-deriving four different base-offset conventions.
 *
 * First-write-wins, and forms.ts's documentsForFiling renders the venue face before the Written
 * Arguments companion, so a submission carried by both documents keeps the venue face's number --
 * the ticket's requirement (filing_submissions.document='form'). A submission the Written
 * Arguments skips as crossed out never reaches here and so has no entry, which is how the reserve inventory
 * tells "struck" from "numbered".
 */
export function recordParagraph(ctx: RenderContext, submissionId: number, document: PointerDocument, startPara: number): void {
  if (!ctx.paragraphLedger.has(submissionId)) ctx.paragraphLedger.set(submissionId, { document, para: startPara + 1 });
}
