// The table of mockup symbols (symbol table and on-mockup legend plan, stage 1).
//
// One row per glyph markers.ts can print, keyed by the glyph itself, spelled byte for byte as in
// ALL_MARKER_GLYPHS. The wording was taken from the rows two reference docs held before stage 5
// (.claude/skills/drafting-data/references/work-markers.md tables 1a to 1c and the emoji legend of
// terms-and-symbols.md), with schema detail removed; those rows now live only here. Nothing here is read at runtime from a
// file. markers.ts's print step imports it (splitGlyphs), legend.ts builds the legend from it, and
// proposal-inventory.ts derives GLYPH_SLUGS and WORK_NAMES from its slugs and titles, so a Job
// Board title is written only here. test/symbol-table.unit.test.mjs pins it to ALL_MARKER_GLYPHS
// and WORK_MARKER_GLYPHS.
//
// Every text field but `modelNote`, `condition` and `history` is written for the lawyer reading the
// legend: no column names, no backticks, none of terms-and-symbols.md's banned terms, and never a
// statement of what the law is. An empty string means the docs give no usable wording for that field.
//
// `condition` and `history` are for developers only: each symbol's Predicate and Schema cells from
// work-markers.md tables 1a and 1b (for a hold, its part of table 1c, with no history), moved here
// verbatim in stage 5. This file is their only copy. They never print in the legend, never go into
// symbol_notes, and the lawyer-facing test does not read them, so they keep their column names and
// backticks.

import type { ProposalSlug } from "./proposal-inventory.js";

/** work-markers.md types: work (table 1a) is ours to do, event (1b) is what happened, hold (1c) is
 * a posture shown in the Counsel Brief. */
export type SymbolGroup = "work" | "event" | "hold";

export interface SymbolRow {
  glyph: string;
  name: string;
  group: SymbolGroup;
  meaning: string;
  work: string;         // for an event, the work it routes
  actor: string;
  /** A procedure the model must follow, from the docs. Never printed in the legend. */
  modelNote?: string;
  /** Generating glyphs only: the Proposal slug the glyph carries (GLYPH_SLUGS is derived from this)
   * and the Job Board title for it (WORK_NAMES is derived from this). */
  slug?: ProposalSlug;
  title?: string;
  /** Developer only: when the marker prints, verbatim from work-markers.md (the Predicate cell of
   * table 1a or 1b, or the symbol's part of table 1c). Never printed in the legend, never put into
   * symbol_notes, and not lawyer-facing, so the backtick and banned-term test does not read it. */
  condition: string;
  /** Developer only: the schema and shipping record, verbatim from the Schema cell of work-markers.md
   * table 1a or 1b; empty for a hold. Never printed, never in symbol_notes, not lawyer-facing. */
  history: string;
}

/** Two or more glyphs printed fused with no space, where the docs state what they mean together. */
export interface CombinationRow {
  key: string;
  meaning: string;
  work: string;
  modelNote?: string;
}

/** One sense of a glyph by where it sits: a list of documentType strings, a line kind in plain
 * words, or both. */
export interface PlacementRow {
  glyph: string;
  documents?: readonly string[];
  line?: string;
  text: string;
  modelNote?: string;
  /** A sense of the glyph that generates its own Proposal, apart from the symbol row's: the slug and
   * its Job Board title. Never put into GLYPH_SLUGS, which maps the glyph's symbol-row slug. */
  slug?: ProposalSlug;
  title?: string;
}

export const SYMBOLS: readonly SymbolRow[] = [
  // Table 1a, work, in the table's order.
  {
    glyph: "🧩", name: "gap", group: "work",
    meaning: "a legally significant fact, or its evidence, is missing, or a required piece of the Writing is not yet supplied",
    work: "supply it; the Job Board and the source view name what is asked",
    actor: "drafter or investigator; practitioner for a signer or a To recipient",
    condition:
      "`gaps.kind='gap'`; derived — no rendered instance reads a `gaps` row (the stored row is admitted, not " +
      "yet rendered); instances include, each cleared by the work it names: witness statement with no included " +
      "`statements_of_fact` row — the whole line `🧩 no facts attributed to this witness`, cleared by " +
      "attributing a fact (#320/#329) · witness-statement paragraph with no linked assertion — the inline tag " +
      "`🧩 [GAP -- no fact linked]` after the paragraph, cleared by linking one (filing-checklists §1) · a " +
      "general Writing's whole mockup-only gap lines, each `🧩 ________ <!-- <what> -->` with <what>: " +
      "`<name> not written` (a slot with no text; write it) ∨ " +
      "`<source> empty` (a DB-backed projection with no rows; supply them) — both also refuse `render_mode " +
      "'filed'` — ∨ `counsel empty` (a lawyer-signed, non-letter block with no client party; record one; " +
      "refuses nothing) ∨ `signer not chosen` (choose one) ∨ `no To recipient` (add a `'to'` recipient, cc-only " +
      "included; printed only where the type declares `recipients`); of these five, all but `no To recipient` " +
      "count toward `open-items`, and `no To recipient` toward `recipients` (declared-layout) · a general " +
      "Writing's `filing_prose` line holding wording that will not be printed — the inline tag " +
      "`🧩 <!-- format: <rules> -->` appended to the line with one space, with <rules> any of `bracket` (a bracketed placeholder, " +
      "pre-filing C2's pattern) ∨ `tbd` (a bare `TBD`, `TODO` or `TBC`) ∨ `note` (a line opening `Note:` or " +
      "`Draft note:`) ∨ `emoji` (an emoji this table does not hold) ∨ `underscores` (three or more " +
      "underscores), cleared when the line breaks none; it counts toward `open-items` as `<slot> format: " +
      "<rules>`, and every rule but `underscores` also refuses `render_mode 'filed'` " +
      "(`prose_format_gate_failed`). Every instance is " +
      "rendered for the human and withheld from the filed face. The bespoke form renderers also print 🧩 for " +
      "blank fields (#1219/#1226); which row owns them is unresolved, and none is admitted here",
    history:
      "v1; `wrapper` → `kind` shipped v10 (#380); statement instance built #329; general-line instance recorded " +
      "as `open-items` entries #1213; `no To recipient` shipped #1234 (`recipients` criterion; no schema " +
      "column); prose format tag shipped plan 2026-10-07 step 5 (`prose_format_gate_failed`; no schema " +
      "column)",
  },
  {
    glyph: "🏛️", name: "jurisdictional basis needed", group: "work",
    meaning: "no law in hand yet for the power to grant this order",
    work: "find the law for the power to grant",
    actor: "research lawyer",
    slug: "jurisdictional-basis", title: "Find jurisdictional basis",
    condition:
      "`order_sought.requires` edge `basis_state='needed'`; also, derived per edge, a `filled` edge whose " +
      "authority is killed — the practitioner rejected what was to supply the basis — or whose statement is " +
      "`'failed'` — the research lawyer returned that it does not supply the power to grant (§1 → Failed); " +
      "either reads as needed again (§4). A `filled` edge whose statement is `'settled'` fills, as a verified " +
      "one does (§1 → Settled). The order's line is not the killed authority's own line, so the kill re-fires " +
      "🏛️ rather than silencing it. Renders on the order's own line, PART 1",
    history:
      "shipped #297; full ladder past 🏛️ built #348 (v7: `jurisdiction_excerpt_id` → statements_of_law); edge " +
      "`basis_state` realized v10 (#380)",
  },
  {
    glyph: "📖", name: "doctrinal basis needed", group: "work",
    meaning: "no authority in hand supports this proposition",
    work: "find the law for the test applied in deciding",
    actor: "research lawyer",
    slug: "doctrinal-basis", title: "Find doctrinal authority",
    condition:
      "law assertion with no counted statement of law, lead, verified or settled — no supporting authority in " +
      "hand (twin of 👤); a killed or overruled authority's statements and a failed statement do not count " +
      "(§1); renders on the proposition's own line, PART 3. A lead-only proposition shows 🔬, not 📖",
    history:
      "v3 (#323/#328: `argument_authorities` dissolved into statements of law; derived, no slot column); " +
      "renderer's lead filter moved to 🔬's predicate (#502, shipped 2026-09-20)",
  },
  {
    glyph: "📜", name: "authority excerpt needed", group: "work",
    meaning: "the authority's passage is not captured verbatim",
    work: "capture the passage verbatim from the authority's own text",
    actor: "research lawyer",
    slug: "authority-excerpt", title: "Quote the authority",
    condition:
      "statement of law with `excerpt` ∅ — doctrinal, jurisdictional and prose-cited alike. A prose-cited " +
      "statement is a statement of law a Writing's own text cites (`filing_law`), printed on its own line in " +
      "the Writing's mockup-only *Authorities cited* block, rendered for the human and withheld from the sent " +
      "face.",
    history:
      "v3 (`statements_of_law.excerpt`); split off 💬 (#502); prose-cited instance admitted #1214 (`filing_law` " +
      "v36)",
  },
  {
    glyph: "📑", name: "exhibit excerpt needed", group: "work",
    meaning: "the document's passage is not captured verbatim",
    work: "capture the document's passage verbatim",
    actor: "drafter",
    slug: "exhibit-excerpt", title: "Quote the exhibit",
    condition:
      "statement of fact with `exhibit_id` set ∧ `exhibit_excerpt` ∅ — the citation quotes the exhibit and " +
      "cites through the instrument to it (*Affidavit #1 of A. Marlowe, para 3, Ex. A, s. 2.3*); also " +
      "admissions past 🤝 ⊕ ⏰ (derived state, table 1b — holds through 🕹️ and ✅) ∧ `response` set ∧ " +
      "`response_excerpt` ∅ where `method` is `notice_to_admit` ⊕ `pleading` (answers drafted by counsel); also " +
      "a clause with `basis='express'` ∧ `excerpt` ∅ — the passage of the document the clause is taken from " +
      "(the offer, the acceptance, a proposed form), captured verbatim; an implied clause never owes it, since " +
      "the schema forbids its own `excerpt`. Unordered with 📌 on the clause line",
    history:
      "`statements_of_fact.exhibit_excerpt` shipped v25 (#774, design #502; the hop listed every existing " +
      "`exhibit_id` row for the practitioner to sort — no blind move), render shipped #777 — VanIAC Written " +
      "Arguments statement lines only; admissions v5 (#339); clause instance admitted #1158 (`clauses.excerpt`, " +
      "v31), render shipped #1158",
  },
  {
    glyph: "💬", name: "testimony excerpt needed", group: "work",
    meaning: "the witness's words are not captured verbatim",
    work: "capture the witness's words verbatim",
    actor: "drafter",
    slug: "testimony-excerpt", title: "Quote the testimony",
    condition:
      "statement of fact with `exhibit_id` ∅ ∧ `excerpt` ∅; also admissions past 🤝 ⊕ ⏰ (derived state, table " +
      "1b — holds through 🕹️ and ✅) ∧ `response` set ∧ `response_excerpt` ∅ where `method` is " +
      "`interrogatories` ⊕ `oral` (the party's own words)",
    history: "fact v4 (#321); admissions v5 (#339); narrowed to testimony (#502)",
  },
  {
    glyph: "📍", name: "authority pinpoint missing", group: "work",
    meaning: "no locator into the authority",
    work: "find the pinpoint in the authority",
    actor: "research lawyer",
    slug: "authority-pinpoint", title: "Locate the authority pinpoint",
    condition:
      "statement of law `pinpoint` ∅ — doctrinal, jurisdictional and prose-cited alike (capture-then-locate: " +
      "after 📜); also a clause with `basis='implied'` ∧ `excerpt_id` set ∧ that statement of law's `pinpoint` " +
      "∅ — an implied clause citing no statement of law owes no locator. A cited statement whose authority is " +
      "killed or overruled counts as none (§1), and the clause line says so: an overruled one contributes ⛔ " +
      "alone, bare, the routing decision being counsel's (Types); a killed one is tagged `(killed <date>)` in " +
      "text (§4 (ii))",
    history:
      "v1; law-only since #511 (the fact and admission locators split to 📌 🧷); clause instance admitted #1122 " +
      "(`clauses` v31, #1121), render shipped #1126",
  },
  {
    glyph: "📌", name: "exhibit pinpoint missing", group: "work",
    meaning: "no locator into the document, or a court record's locator cites an exhibit its sworn version may not hold",
    work: "find the pinpoint in the document",
    actor: "drafter; the holder of the record for a court record",
    slug: "exhibit-pinpoint", title: "Locate the exhibit pinpoint",
    condition:
      "statement of fact with `exhibit_id` set ∧ `exhibit_pinpoint` ∅ (*Ex. A, s. 2.3*); also admission past 🤝 " +
      "⊕ ⏰ (derived state, table 1b — holds through 🕹️ and ✅) ∧ `instrument`/`response` set ∧ its pinpoint ∅ " +
      "where `method` is `notice_to_admit` ⊕ `pleading`; also `facts.court_record` set ∧ (" +
      "`court_record_pinpoint` ∅ ∨ (the court record's `execution` set ∧ ((the pinpoint cites ≥1 exhibit letter ∧ its " +
      "`exhibit_letters` ∅, unparseable or lacking a cited letter) ∨ the pinpoint's *Exhibits* list is malformed, e.g. " +
      "a reversed range))) → holder of the record — letters are read only from *Exhibit X* (also *Exhibit \"X\"*, " +
      "straight or curly quotes, and *Ex. X*, quoted or not), *Exhibits X-Y* and *Exhibits X, Y* (items may be ranges; a letter is 1–2 uppercase letters, A..Z " +
      "then AA..ZZ); any other wording cites none; also a clause with `basis='express'` ∧ `pinpoint` ∅ — " +
      "the locator into the document the clause is taken from (the offer, the acceptance, a proposed form). " +
      "Unordered with 📑 and 🧷; renders beside 🧷 when a statement owes both locators",
    history:
      "`statements_of_fact.exhibit_pinpoint` shipped v25 (#774, design #502), render shipped #777; admissions " +
      "v5; court-record link shipped v8 (#362); split off 📍 (#511); clause instance admitted #1122 (`clauses` " +
      "v31, #1121), render shipped #1126; sworn court-record exhibit re-check, `documents.exhibit_letters` v56 " +
      "(E2E 2026-10-05 finding 4.3)",
  },
  {
    glyph: "🧷", name: "testimony pinpoint missing", group: "work",
    meaning: "no locator into the witness's instrument",
    work: "find the paragraph in the witness's instrument",
    actor: "drafter",
    slug: "testimony-pinpoint", title: "Locate the testimony pinpoint",
    condition:
      "statement of fact with `instrument` set ∧ `pinpoint` ∅ — the instrument's paragraph, on an " +
      "exhibit-backed statement too (*Affidavit #1 of A. Marlowe, para 3*); no instrument (✍️, oral): nothing " +
      "to locate. Also admission past 🤝 ⊕ ⏰ (derived state, table 1b — holds through 🕹️ and ✅) ∧ " +
      "`instrument`/`response` set ∧ its pinpoint ∅ where `method` is `interrogatories` ⊕ `oral`. Unordered " +
      "with 💬 ⊕ 📑 and 📌",
    history: "v1; admissions v5; split off 📍 (#511)",
  },
  {
    glyph: "🔬", name: "scrutinize", group: "work",
    meaning: "a lead is in hand, not yet verified",
    work: "confirm the excerpt supports this proposition and is the court's own reasoning, not a recited argument",
    actor: "research lawyer",
    modelNote:
      "One act: the verbatim diff through /verify-law first, then fit and ratio through /legal-research. It clears on the " +
      "research lawyer's return either way: verified, or failed with the finding seated under 👃.",
    slug: "scrutinize", title: "Scrutinize",
    condition:
      "statement line: `statement.verification='lead'` ∧ its authority's `killed_on` ∅ — not for a statement " +
      "under a submission or order deployed on no live Writing (a Writing with `retired_on` ∅), nothing relying " +
      "on it there: every reserved 🂡 item is one, and so is an item deployed only on retired Writings, which " +
      "is not reserved (1c, #959); re-linking makes it derive again (v47); the same for the order's line where " +
      "such an order's ladder prints. Proposition line: ≥1 counted statement of law (from a non-killed, " +
      "non-overruled authority, not `'failed'`) ∧ none verified or settled — so 📖 ⊕ 🔬 per proposition by " +
      "construction; a `'failed'` or `'settled'` statement renders no 🔬 on any line (§1 → Failed, Settled); 🚧 " +
      "owns the line when it fires. Clause line: an implied clause whose cited statement is a lead from an " +
      "authority neither killed nor overruled — so no implied clause rests on unverified law and reads clean; " +
      "co-renders (∨) with 📍. Doctrinal, jurisdictional and prose-cited alike. Co-renders (∨) with 📜 📍 📇 🏅 " +
      "on the statement line and with 🥉 ⊕ 🥈 ⊕ 🏅 on the proposition line. The lead statement itself stays " +
      "under the brief-only cap, except a prose-cited one, which prints on its mockup-only line, since the " +
      "Counsel Brief lists no prose-cited statement and the block reaches no sent face; the proposition-line 🔬 " +
      "renders on every mockup so no line reads falsely clean (rule 6); never on a filed face",
    history:
      "`authorities.verification` → `statements_of_law.verification` shipped v25 (#774, design #502; an " +
      "authority is a lead when none of its statements is verified, derived); renderer shipped 2026-09-20, " +
      "reading `statements_of_law.verification` since v25 — proposition line, doctrinal statement line and the " +
      "order's own line (the jurisdictional ladder); clause line admitted #1122, render shipped #1126; " +
      "prose-cited instance admitted #1214; `'failed'` admitted v46 (2026-10-02): the negative return, finding " +
      "in `doubt` (CHECK-required), counts as none across statements; v47 (2026-10-02): a failed row is never " +
      "reset by an edit, `'settled'` admitted (counsel's confirmed close, counts as support), a verified or " +
      "settled row returns to `'lead'` by trigger when its `authority_id`, `pinpoint` or `excerpt` moves off " +
      "its snapshot, and no statement-line or order-line 🔬 under a submission or order deployed on no live " +
      "Writing",
  },
  {
    glyph: "↩️", name: "rebuttal needed", group: "work",
    meaning: "their statement, of fact or law, is unanswered",
    work: "answer it",
    actor: "drafter",
    condition: "`opposing_point.answered_by` ∅ (→ submission)",
    history: "v1; target renamed v3 (#323: answers are submissions)",
  },
  {
    glyph: "👃", name: "suspicious (fact) or dubious (law)", group: "work",
    meaning: "asserted, but doubted",
    work: "check it",
    actor: "investigator for a fact, research lawyer for law; practitioner where a statement of law failed scrutiny",
    modelNote:
      "On a statement of law that failed scrutiny the check is done: the work is that statement's scrutiny review job, " +
      "the practitioner's, closed only on counsel's confirmation of a change, a keep over the finding, or a drop. Never " +
      "re-dispatch it, the noting-up sweep included.",
    condition:
      "`statement.doubt` set — both domains, named per domain; law no longer reads the treatment column (→ 📇); " +
      "a `'failed'` statement of law always carries one (v46 CHECK); not on a `'settled'` statement, which " +
      "keeps its finding in `doubt` as the record (v47 CHECK, §1 → Settled)",
    history: "`doubt` shipped v10 (#380 — was `facts.posture`); renderer reads 📇 for `treatment` ∅ since #363",
  },
  {
    glyph: "📇", name: "note up", group: "work",
    meaning: "the authority is not yet noted up; mandatory before filing, and routine",
    work: "note it up; for a statute, regulation or rule, confirm it is current",
    actor: "research lawyer",
    slug: "note-up", title: "Note up",
    condition:
      "by `authority.kind` — a case: `treatment` ∅; a statute, regulation or rule: `currency_status` anything " +
      "but `'current'` (∅ included; shared/statute-currency.md → Noting up legislation); `kind` doctrine (a " +
      "secondary authority): never — law side only",
    history:
      "column live since v2 (#307; name kept #327 — `check` is SQLite-reserved); marker split off 👃 " +
      "(ADR-0007); renderer shipped #363 — doctrinal and jurisdictional alike; by authority kind since #1628",
  },
  {
    glyph: "🏷️", name: "not recorded", group: "work",
    meaning: "a record field is empty, holds a value its closed set does not recognize, or holds a value the record that owns it does not confirm; nothing usable is recorded",
    work: "look it up; do not draft it",
    actor: "drafter",
    slug: "not-recorded", title: "Record label, date or description",
    condition:
      "`gaps.kind='not_recorded'`; derived, **three instances**: document identity (label · date · description) " +
      "∅ — 🧩 precedent · a Form 8 provision with `order_sought.template_key` set but outside the Form 8 " +
      "renderer's closed template set — the `unrecognized template_key \"<key>\"` text, on a primary or " +
      "alternative provision alike, ⊕ ⬜ by construction (a `template_key` ∅ is ⬜'s); `render_mode 'filed'` " +
      "refuses while it holds, struck provisions excepted (#825) · a party row of a drafting Writing that case " +
      "data does not confirm: `parties.case_party_id` ∅, or linked to a case-data party not of record in the " +
      "proceeding, or whose counsel of record (name, firm, email, telephone) or address for service differs " +
      "from case data's, or unchecked because case data could not be read — one mockup-only line per party at " +
      "the head of the venue document, no Job Board entry; `render_mode 'filed'` refuses while any holds. Never " +
      "on a sent Writing (it prints from `parties_snapshot`), and never on a proceeding with no file number or " +
      "a matter with no case-data database (party/counsel SSOT, schema v41)",
    history:
      "v1; derived instance partly shipped — description ∅ only, on the VanIAC Evidence Index only; label and " +
      "date queued; the other filing kinds' lists queued (#777 defect 5); unrecognized-key instance shipped, " +
      "filed gate shipped #825; definition broadened #858; party-drift instance shipped v41 (party/counsel " +
      "SSOT, 2026-09-30); definition broadened again to \"does not confirm\" 2026-09-30",
  },
  {
    glyph: "🕵️", name: "open question", group: "work",
    meaning: "both the answer and its legal significance are unknown",
    work: "investigate",
    actor: "investigator",
    condition: "`gaps.kind='question'`",
    history: "v2 (#307 added the CHECK value)",
  },
  {
    glyph: "⬜", name: "unchosen", group: "work",
    meaning: "a choice not yet made, or a required checklist attachment not yet present; never means wrong, and never marks relief sought in the alternative",
    work: "make the choice, or attach the missing item",
    actor: "practitioner",
    slug: "unchosen", title: "Attach the missing order or affidavit",
    condition:
      "`gaps.kind='unchosen'` (not `'not_started'`); derived: a requisition filing with no `filing_documents` " +
      "`role='order'` ⊕ `role='affidavit'` row — the \"not yet attached\" line · a Notice of Application with " +
      "`hearing_details.associate_judge` ∅ ∨ no `hearing_details` row — the line in place of the jurisdiction " +
      "sentence; both `render_mode 'filed'` and `emit_form32` refuse while it holds · an Application Response ⊕ " +
      "BCCA stay response with an `opposing_orders` row of the responded-to document ∧ no `filing_positions` " +
      "row for this filing — the \"Positions not yet taken\" listing, mockup only; an explicit " +
      "`position='no_position'` row clears it (a stance taken); `emit_form33` refuses while it holds · a Form 8 " +
      "provision with `order_sought.template_key` ∅ — the \"(template not chosen)\" text, on a primary or " +
      "alternative provision alike; `render_mode 'filed'` refuses while it holds, struck provisions excepted " +
      "(#825)",
    history:
      "v1, stored instance's render queued; requisition derived instance shipped (filing-checklists §3); " +
      "associate-judge derived instance shipped v20 (#451); unpositioned-order instance shipped #386, ratified " +
      "#826; template instance shipped, filed gate shipped #825; Form 8 alternative-relief instance struck #826 " +
      "(§6)",
  },
  {
    glyph: "👤", name: "get a witness", group: "work",
    meaning: "nobody is identified to prove this fact, as against this party",
    work: "find a witness",
    actor: "investigator",
    modelNote: "Never record a separate gap for what this marker derives: a duplicate is two markers for one job.",
    condition:
      "fact with no statement row ∧ not admitted by this party (derived, ADR-0006) ∧ `facts.court_record` ∅ — a " +
      "fact linked to its proving court document needs no witness, conclusive against **all** parties (the one " +
      "non-per-party silence). **Second instance** (#330): a filing-selected document of `role` `'evidence'` ⊕ " +
      "`'other'` (#398 — never `witness_statement`/`affidavit`/`order`/`pleading`: testimony instruments, " +
      "relief drafts, and court-record documents are not things a witness tenders) with no `statement.exhibit` " +
      "and no `admissions.exhibit` pointing to it — same emoji, same work (find the tendering witness or record " +
      "the admission), on the document's own line: Evidence Index ∧ NoA Part 4 (#398); flat existence across " +
      "parties, not per party (#339 — one line per document, nothing to partition against)",
    history:
      "every statement witness-backed: `witness_id` NOT NULL (#320/#328); guard per-party since #345; exhibit " +
      "instance built #333/#339, role scope + Part 4 parity #398; spent rungs prefix 👤 (#345/#361); " +
      "`court_record` shipped v8 (#362)",
  },
  {
    glyph: "🗣️", name: "interview", group: "work",
    meaning: "the identified witness is not yet interviewed",
    work: "interview the witness",
    actor: "investigator",
    slug: "interview", title: "Interview",
    condition: "`statement.interviewed=0`",
    history: "v3 (`sworn_status` struck); plain name was *talk to witness*",
  },
  {
    glyph: "✍️", name: "draft it", group: "work",
    meaning: "the witness is interviewed, but the account is not yet written",
    work: "write the oral account",
    actor: "drafter",
    slug: "draft-it", title: "Draft the statement",
    condition: "`interviewed=1` ∧ `statement.instrument` ∅",
    history:
      "v3 — `instrument` is the statement's own pointer (the old paragraph link / `affidavit_document_id` " +
      "collapsed into it)",
  },
  {
    glyph: "🖋️", name: "sign it", group: "work",
    meaning: "the witness statement is unsigned; the work is ours, nothing waits",
    work: "get it signed",
    actor: "witness; the drafter obtains it",
    slug: "sign-it", title: "Get it signed",
    condition:
      "the statement's `instrument` is an unsigned `witness_statement` — read from its execution; ≥1 paragraph " +
      "linked (#329). 🖋️⊕✒️ by instrument",
    history: "v3 (`witness_statements` folded into `documents` — #327/#328)",
  },
  {
    glyph: "✒️", name: "swear it", group: "work",
    meaning: "the affidavit is unsworn; the work is ours, nothing waits",
    work: "get it sworn",
    actor: "deponent and commissioner; the drafter obtains it",
    slug: "swear-it", title: "Get it sworn",
    condition: "the statement's `instrument` is an unsworn `affidavit` (`deponent` set ⇔ instrument)",
    history: "v3; deponent gate — bare `sworn_on` ∅ is true of every contract",
  },
  {
    glyph: "🎾", name: "serve it", group: "work",
    meaning: "the admission instrument is not yet served",
    work: "serve the pleading, notice to admit or interrogatories",
    actor: "practitioner",
    slug: "serve-it", title: "Serve",
    condition:
      "admissions row: `instrument` set ∧ `response` ∅ ∧ the admission instrument's `served_on` ∅ — never from " +
      "a bare document `served_on`; oral rows are born answered (🎾 ⏳ never apply)",
    history:
      "table v5 (#339); `served_on` v6 (#344); render shipped #344 — VanIAC Evidence Index only; the NoA Part " +
      "4, Application Response Part 6 and BCCA material lists emit none (#777 defect 5). *Instrument* names " +
      "both vehicles — the witness's (`statement.instrument`) and the admission's (`admissions.instrument`, " +
      "#327). No finalized gate: 🖋️/✒️ attach only to the witness's instrument, so they cannot co-fire",
  },
  {
    glyph: "🕹️", name: "enter it", group: "work",
    meaning: "the admission is not yet before the tribunal",
    work: "put the admission before the tribunal by tendering it",
    actor: "practitioner",
    slug: "enter-it", title: "Enter the admission; pleading route: Requisition default judgment",
    condition:
      "(🤝 ⊕ ⏰) ∧ no filing selects the response (for ⏰: the admission instrument + affidavit of service) — " +
      "admission proof only; pleading route: the default-judgment requisition",
    history: "derivation v5/v6; render shipped #344 — VanIAC Evidence Index only, as 🎾 (#777 defect 5)",
  },
  {
    glyph: "🥉", name: "only tertiary", group: "work",
    meaning: "the best support for this proposition is a tertiary statement, a finding aid; none primary or secondary",
    work: "get primary or secondary authority",
    actor: "research lawyer",
    slug: "primary-authority", title: "Find primary authority",
    condition:
      "best-`source` rung of the proposition's counted statements of law (non-killed, non-overruled authority, " +
      "not `'failed'` — §1): the verified or settled statements when any exist, else the lead statements — so a " +
      "verified tertiary statement is never masked by a lead primary one, and a lead-only proposition still " +
      "shows \"get primary\". 🥉⊕🥈 exclusive by construction; neither co-fires with 📖 (📖 = no statement at all " +
      "— they sit after 📖 fills); both co-render with 🔬, and with 🏅 when an unrated statement sits alongside " +
      "a rated one (🥉🏅). An unrated statement is **not** a 🥉 one — ∅ is 🏅's, not this row's (#597). " +
      "`source` is read off `authority.kind`, never off what the excerpt cites — a case quoting an earlier case " +
      "is 🥇, and a 🥉 is a finding aid (terms-and-symbols → Tertiary 🥉; #718)",
    history:
      "`statements_of_law.source` shipped v9 (#365); doubles as the *tertiary* `source` value (dual role as ⚠️ " +
      "🚨 ⛔); the verified-else-lead read shipped 2026-09-20 (#502)",
  },
  {
    glyph: "🥈", name: "only secondary", group: "work",
    meaning: "the best support for this proposition is secondary; none primary",
    work: "get primary authority",
    actor: "research lawyer",
    slug: "primary-authority", title: "Find primary authority",
    condition:
      "as 🥉; any 🥇 clears all three. 🥇 stays a value only, never renders — primary support is the goal " +
      "state, as ✅",
    history: "as 🥉",
  },
  {
    glyph: "🏅", name: "unrated", group: "work",
    meaning: "a statement of law carries no rating as primary, secondary or tertiary",
    work: "rate the authorities held",
    actor: "research lawyer",
    modelNote: "Rating classifies the kind of the authority itself, never what its excerpt cites: a case quoting an earlier case is rated primary.",
    slug: "authority-rating", title: "Rate the authority",
    condition:
      "reads `source` alone, as 🥉. **Two sites** (as 🔬): *statement line* — that row's `source` ∅, fires " +
      "regardless of its siblings' ratings, doctrinal, jurisdictional and prose-cited alike; *proposition line* " +
      "— in the read set (as 🥉) no statement rated 🥇 ∧ ≥1 unrated, i.e. the rung is **undeterminable, not a " +
      "lower rank**. Co-renders with 🥉 ⊕ 🥈; any 🥇 clears it; never co-fires with 📖. A marker on the " +
      "*blank*, never a fourth `source` value — the axis stays 🥇 ⊕ 🥈 ⊕ 🥉 ; ∅ ⇒ 🏅, as `treatment` ∅ ⇒ 📇 on a case",
    history:
      "`statements_of_law.source` ∅ (v9 column, #365); marker admitted #597, no schema change; prose-cited " +
      "instance admitted #1214",
  },
  {
    glyph: "🦵", name: "unserved petitum", group: "work",
    meaning: "no submission serves this order",
    work: "draft a submission for it",
    actor: "drafter",
    slug: "unserved-petitum", title: "Draft a submission for the order",
    condition:
      "`order_sought` with no `served_by` row; renders on the order's own line, primary or alternative alike " +
      "(#832) — never on the face of a requisition form (Form 8 Default Judgment, Consent Order): a requisition " +
      "files no argument, so no submission is owed to its orders and there is no work to name (rule 1; #960). " +
      "The same order still carries 🦵 on the filing's Written Arguments companion where it is deployed there, " +
      "and on its Counsel Brief line while reserved — an alternative placed under a form-deployed primary on " +
      "the Form 8 is deployed by that placement, not reserved, so it carries neither 🂡 nor 🦵 there (#960)",
    history:
      "v10 (`served_by` junction, #380); render shipped — NoA Part 1, Written Arguments, Counsel Brief reserved " +
      "orders; requisition faces excepted #960",
  },
  {
    glyph: "🧵", name: "loose thread", group: "work",
    meaning: "the form deploys it, the Written Arguments never argues it",
    work: "reconcile the two",
    actor: "drafter",
    slug: "loose-thread", title: "Reconcile the loose thread",
    condition: "item pointed by the venue form, unpointed by the WA — derived from the pointer lists, no column",
    history: "pointer model v10 (#380); render shipped #384",
  },
  {
    glyph: "🧾", name: "factual basis needed", group: "work",
    meaning: "this contention rests on no stated fact",
    work: "link or draft the facts it rests on",
    actor: "drafter",
    slug: "factual-basis", title: "Link or draft the factual basis",
    condition:
      "`submissions` row with no `submission_facts` row, and no recorded no-facts-needed decision for the " +
      "current wording (v48) — a contention resting on no stated fact; renders on " +
      "the first numbered paragraph belonging to the submission — its own contention line, restored as the " +
      "argument's opening numbered paragraph by ticket 2026-09-01 (WA *Submissions*; Form 32 Part 3; Form 33 " +
      "Part 5; the BCCA stay response book's Part 2 written argument at its *Part 3: Analysis*; BCCA factum " +
      "Part 3; Counsel Brief, deployed and held-in-reserve alike — a reserved submission appears in no venue " +
      "document, so the brief is the only surface on which its missing factual basis can be seen; a killed " +
      "submission is never in that section — it renders no contention paragraph at all, only a plain unnumbered " +
      "line under *Killed submissions* (§4); never delivered, so never a filed face). A submission with no " +
      "linked facts and no linked law still renders that contention paragraph, numbered like any other and " +
      "carrying 🧾 — it never disappears and never degrades to an unnumbered marker-only line — but the marker " +
      "itself never reaches a filed face. Contention-level, above 👤 (which proves each fact); not 📖's twin — " +
      "its law-side mirror (`submission_law` ∅) is 📚 (§6). Fires on a law-only submission until counsel " +
      "records that it needs no stated fact (v48). On the Form 32 Part 3 and Form 33 Part 5 mockups it leaves " +
      "the line's marker set and prints after the submission's trace comment, joined to the fact-reference " +
      "comment with no space: `🧾<!-- supporting fact paragraphs:  NONE -->` (two spaces before NONE, verbatim)",
    history:
      "derived from the junction, no column (#373); render site moved off the contention line 2026-08-31 (the " +
      "contention sentence stopped rendering at all); moved back onto it 2026-09-01 when the contention " +
      "paragraph was restored (§6); exemption built v48 (2026-10-04): counsel's recorded decision clears it; " +
      "reset when the wording changes; on the Form 32/33 mockups moved off the marker set and onto the " +
      "supporting-fact-paragraphs comment (7ad3c44)",
  },
  {
    glyph: "📚", name: "proposition needed", group: "work",
    meaning: "this contention rests on no stated law",
    work: "link or draft the proposition it requires",
    actor: "drafter",
    slug: "proposition", title: "Link or draft the proposition it requires",
    condition:
      "`submissions` row with no `submission_law` row, no recorded no-law-needed decision for the current " +
      "wording (v60), and not an ordinary-costs submission (below) — a contention resting on no stated law. It reads the junction's existence, not statement " +
      "counts, as 🧾 reads `submission_facts`: a proposition with no authority yet is 📖's work on the " +
      "proposition's own line, not 📚's. Renders at 🧾's one site, the submission's contention line, so on " +
      "🧾's surfaces (WA *Submissions*; Form 32 Part 3; Form 33 Part 5; the BCCA stay response book's *Part 3: " +
      "Analysis*; BCCA factum Part 3; Counsel Brief, deployed and held-in-reserve alike); a killed submission's " +
      "line carries none (§1 → Killed). It renders for the human on every mockup and is withheld from the " +
      "filed face, as every marker is. Unlike 🧾 it stays in the line's marker set on the " +
      "Form 32 Part 3 and Form 33 Part 5 mockups and never moves onto the supporting-fact-paragraphs comment: " +
      "law is never folded into a comment. A submission with neither link and no record carries both 🧾 and " +
      "📚. Fires on a fact-only submission until counsel records that it needs no stated law (v60); the line " +
      "then prints ` (no stated law needed, per counsel <date>)`, which the filed face strips. A submission that " +
      "only asks for ordinary costs never fires it, and prints no tag of its own: it serves at least one order, " +
      "every wording of every order it serves that is not crossed out (`order_sought.wording` and each " +
      "`filing_orders.wording_override`) contains the word *costs* and only the fixed ordinary-costs words " +
      "(`markers.ts` `ORDINARY_COSTS_WORDS`), and its contention mentions costs and names none of the " +
      "unusual-costs modifiers (special, any event, scale, solicitor, double, lump, increased, non-party, " +
      "non party, nonparty, lawyer, counsel, personally, indemnity, uplift, against). It is the " +
      "practitioner's fixed classification rule, never a legal judgment made at runtime, and it fails closed: " +
      "any other word or any number keeps 📚",
    history:
      "the law-side mirror of 🧾, held until admitted 2026-10-06 (application-paragraphs spec §4.6, P5; work-markers §6); derived " +
      "from the junction, no column; counsel's no-law-needed record v60 (`submissions.no_law_needed_on`, reset " +
      "when the wording changes, refused beside `no_facts_needed_on`); ordinary costs exempt 2026-10-07 " +
      "(practitioner: asking for ordinary costs needs no proposition of law; unusual costs orders still fire)",
  },
  {
    glyph: "🧐", name: "final review", group: "work",
    meaning: "nothing else is owed on the line, and counsel has not approved it as it now reads",
    work: "review the content in context and approve it",
    actor: "practitioner",
    condition:
      "no other 1a work marker renders on the object's line (on a merged line, such as a Notice of Application " +
      "fact line joining a postulate with its statements of fact, every object's markers count) ∧ no approval " +
      "matches its current content: its stored fields as reviewed (statement, paragraph or slot text, excerpt, " +
      "pinpoint — never the rendered wording) differ byte for byte from its latest approval snapshot, or it has " +
      "none. Computed, never stored: any later change re-raises it with no trigger and no invalidation write. " +
      "Attaches to statements of law, statements of fact, propositions, postulates, submissions, orders sought, " +
      "clauses, prose slots and rhetorical paragraphs — never a whole document. A prose slot is one slot of a Writing's own text (a " +
      "`filing_prose` row that a `slot:<name>`, `addressee` or `sender` part of its stored layout renders), " +
      "reviewed whole and marked once, on its last line. The last rung before clean on both ladders (§5). ⚠️ ⊕ " +
      "🚨, and 🕰️ (§1 → Fit tells), render beside it as bare events — they route no 1a work, and the routing decision is counsel's, taken " +
      "in the review, so the 🧐 on that statement carries counsel's review of the treatment, including one set " +
      "in the noting-up sweep. The authority's treatment is part of the statement snapshot (review.md), so any " +
      "later change of it re-raises 🧐 on an approved statement. The order's line takes the same rule for its " +
      "basis: ⚠️ ⊕ 🚨 from a jurisdictional statement's ladder render beside the order's 🧐, and the statement " +
      "filling each of the order's `filled` edges, with its authority's treatment, is part of the order " +
      "snapshot (review.md), so a later change of treatment, or of which statement fills the basis, re-raises " +
      "🧐 on an approved order. The kill is not part of it, as elsewhere. Killed and overruled silence it as " +
      "every 1a row (§1). An overruling does not silence 🧐 on the proposition's line, which is not the " +
      "authority's own line: while a counted statement survives, a proposition with an overruled statement " +
      "carries ⛔ beside 🧐 wherever 🧐 fires, until approved, the review confirming the overruling. Which of " +
      "its statements are overruled is part of the proposition snapshot (review.md), so a later overruling " +
      "re-raises 🧐 on an approved proposition, and a later kill does not. The `(overruled: …)` tag beside that " +
      "⛔ (§1) is not part of it, so an edit of the authority's title or citation re-raises nothing. Neither the " +
      "kill nor the overruling silences 🧐 on the clause line, which is neither the cited authority's own line " +
      "nor its statement's and takes no 🏛️ ⊕ 📖 reopen prefix (📍 row): until approved, a clause citing an " +
      "overruled authority reads ⛔ 🧐, the review confirming the overruling as well as the wording, and one " +
      "citing a killed authority reads `(killed <date>)` 🧐, the statement counting as none. Whether the cited " +
      "authority is overruled is part of the clause snapshot (review.md), so a later overruling re-raises 🧐 on " +
      "an approved clause; its `killed_on` is not, since the kill is counsel's own act. Once approved, the bare " +
      "⛔ names the routing work (Types), and the `(killed <date>)` tag keeps the clean line from being read as " +
      "finished (§4 (ii), rule 6). Content filled by an unattended run carries it like any other unapproved " +
      "content. Documents that are sent only (a Filing, or a Writing that is sent, an internal memo included) — " +
      "the Counsel Brief is never sent and carries none. Renders for the human on every mockup of such a " +
      "document; never on a filed or sent face",
    history:
      "`review_approvals` v27 (#868 — append-only, revision-exempt); marker admitted #861 as 📋 *counsel's " +
      "review*, re-glyphed and renamed 2026-09-24 (§6); render shipped #912, glyph shipped #1061; clause kind " +
      "admitted #1122 (review.md snapshot row), render shipped #1126; prose slot kind admitted #1207 (review.md " +
      "snapshot row), render shipped #1207; rhetorical paragraph kind admitted v71 (review.md snapshot row, " +
      "wording alone; its plain-text tells hold nothing back)",
  },

  // Table 1b, events: the work column is the work each routes.
  {
    glyph: "🚧", name: "dead end", group: "event",
    meaning: "research or investigation ran dry",
    work: "reframe, drop, or proceed unsupported",
    actor: "practitioner",
    modelNote: "Never record the reframe, drop or proceed decision as a separate gap: this marker carries it.",
    condition:
      "law: a proposition researched with nothing found (doctrinal) ∨ `order_sought.requires` edge " +
      "`basis_state='dead_end'` (jurisdictional); fact: dead-end value where the investigation lives",
    history:
      "doctrinal derived v3 (#323); jurisdictional shipped #297/#348, edge `basis_state` v10 (#380); fact " +
      "queued",
  },
  {
    glyph: "⚠️", name: "distinguishable", group: "event",
    meaning: "the authority stands on dissimilar facts; the authority is fine, the gap is factual",
    work: "argue past it or replace it",
    actor: "",
    condition: "`treatment='distinguishable'`",
    history: "v2",
  },
  {
    glyph: "🚨", name: "negative treatment", group: "event",
    meaning: "questioned or not followed in similar cases, but still law",
    work: "disclose it or replace it",
    actor: "",
    condition: "`treatment='negative'`",
    history: "v2",
  },
  {
    glyph: "⛔", name: "not good law", group: "event",
    meaning: "overturned or overruled",
    work: "replace the authority; the basis it supplied reopens",
    actor: "research lawyer",
    condition: "`treatment='overruled'`",
    history: "v2",
  },
  {
    glyph: "🕰️", name: "predates the provision", group: "event",
    meaning: "the case was decided in an earlier year than a provision this proposition also cites dates from",
    work: "confirm in the review that the case speaks to the provision, or replace it",
    actor: "practitioner",
    modelNote:
      "Before a statement carrying it is reused in a new draft or answer, offer /verify-law Mode A on it. It rates " +
      "nothing and blocks nothing: never record the review's call as a separate gap.",
    condition:
      "statement line, the authority `kind='case'` ∧ another statement of the same `law_assertion_id` whose authority " +
      "is a `statute`, `regulation` or `rule` with `killed_on` ∅ has a year later than the case's — the case's year " +
      "is the first four-digit year of its `citation`; the provision's is the year of its `provision_currency." +
      "in_force_on` (keyed by that statement's `pinpoint`), else the first four-digit year of its `citation`; an " +
      "unknown year on either side, or the same year, raises nothing (authority-fit.ts). An event: it holds back no " +
      "🧐 and renders beside it, like ⚠️. It is not part of the statement snapshot (review.md), so one first raised " +
      "after approval renders bare until the next edit re-raises 🧐. Killed and overruled silence it (§1). Renders for the human on every " +
      "mockup; never on a filed or sent face",
    history:
      "admitted v61 (2026-10-06, planning/1. Design/2026-10-06_authority-fit-checks-spec.md): `provision_currency." +
      "in_force_on` added; the spec's ⏳ declined, the glyph being the admission ladder's *waiting on others*",
  },
  {
    glyph: "🏆", name: "not best copy", group: "event",
    meaning: "the copy relied on is not the best copy held",
    work: "mark it missing or stale",
    actor: "practitioner, on ingest's proposal",
    modelNote: "Never record the copy choice as a separate gap: this marker carries it.",
    condition: "label group on `documents` with no `is_best_copy=1`, or `id` > the mark's `best_copy_as_of`",
    history:
      "was 🥉 until the 2026-08-22 grill (🥉 now *tertiary* + *only tertiary*); half v1, stale half needs " +
      "`best_copy_as_of` (queued)",
  },
  {
    glyph: "⏳", name: "waiting on others", group: "event",
    meaning: "the next move is an external party's: a response period is running",
    work: "diarize, then classify the response",
    actor: "",
    condition:
      "served ∧ (`response` ∅ ∨ `struck_on` set) ∧ `response_due` unexpired — response period running, first or " +
      "court-reset (precedes ⚡️)",
    history: "v5/v6; the genus has no column — each further kind of waiting needs its own reader + column first",
  },
  {
    glyph: "⏰", name: "deemed admission", group: "event",
    meaning: "the response period expired unanswered",
    work: "confirm it and record it as proof",
    actor: "practitioner",
    condition:
      "served ∧ `response_due` passed ∧ (`response` ∅ ∨ late per method ∨ NtA `answer` ∅ ∨ `struck_on` set) ∧ " +
      "(`struck_on` ∅ ∨ `response_due` > `struck_on`) — derived, never stored. \"A later response does **not** " +
      "falsify\" holds for notice to admit only; pleading route reverts to `answer` if a Response is filed " +
      "before judgment is entered (per-method table, terms-and-symbols → Admissions)",
    history: "v5/v6; ladder derivation built #344",
  },
  {
    glyph: "🤝", name: "admitted", group: "event",
    meaning: "expressly admitted",
    work: "record it as proof",
    actor: "drafter",
    condition: "`response` in time ∧ `struck_on` ∅ ∧ `answer='agreed'` — per party per method",
    history: "v5/v6; #344",
  },
  {
    glyph: "🙅🏻‍♂️", name: "denied", group: "event",
    meaning: "refused to admit",
    work: "prove it by evidence",
    actor: "practitioner",
    condition: "`answer='denied'`; clears when the evidence branch begins",
    history: "v5/v6; #344, prefix render #345/#361",
  },
  {
    glyph: "🫸", name: "refused", group: "event",
    meaning: "refused to answer",
    work: "prove it by evidence, as on a denial",
    actor: "practitioner",
    condition: "`answer='refused'`",
    history: "v5/v6; #344, #345/#361",
  },
  {
    glyph: "🤷", name: "no knowledge", group: "event",
    meaning: "can neither admit nor deny",
    work: "prove it by evidence, as on a denial",
    actor: "practitioner",
    condition: "`answer='no_knowledge'`; pleading ∧ `answer` ∅ ⇒ 🤷",
    history: "v5/v6; #344, #345/#361",
  },
  {
    glyph: "⚡️", name: "struck", group: "event",
    meaning: "the court struck the admission",
    work: "wait out a new response period where the court set one; otherwise prove it by evidence",
    actor: "practitioner",
    condition:
      "`struck_on` set ∧ `response_due` ≤ `struck_on`; prefixes ⏳ (new `response_due` set) ⊕ 👤 — no suffix " +
      "convention",
    history: "v5/v6; #344",
  },
  {
    glyph: "🤫", name: "suppressed", group: "event",
    meaning:
      "counsel set aside the requirement on this one line, in their own recorded words; it replaces 👤 (get a " +
      "witness), the requirement still stands, and an admission rung before it still reports that admission's " +
      "outcome",
    work: "none while it stands; ask to unsuppress it to restore 👤, and rewording the line restores it",
    actor: "practitioner",
    modelNote:
      "Suppress only on the practitioner's own explicit words, recorded verbatim with the date, one item at a time; " +
      "never from inference, a deadline or time pressure, and never in an unattended run.",
    condition:
      "fact-side 👤 fires ∧ a `marker_suppressions` row (`marker='👤'`, `keyed_table='facts'`, `keyed_id`) ⇒ 🤫 " +
      "in 👤's place, any spent rung prefix kept; the 👤 derivation is unchanged and its Evidence criterion " +
      "entry is flagged suppressed, counted met; the row is deleted when the fact's `postulate` moves off its " +
      "`item` or the fact is deleted",
    history: "v69",
  },

  // Table 1c, holds: printed in the Counsel Brief only.
  {
    glyph: "🂡", name: "held in reserve", group: "hold",
    meaning: "drafted and deliberately held: no document of the filing deploys it, and for an order, submission or rhetorical paragraph no document of any filing of the proceeding",
    work: "decide later whether to deploy or abandon it",
    actor: "practitioner",
    condition:
      "🂡 **reserved** — derived, never stored: a pool item deployed by no document of the filing — for an " +
      "order, submission or rhetorical paragraph (v71), of any filing of the proceeding (#959: one deployed only on another filing is " +
      "listed marker-free under *used on other filings*, not reserved) — drafted, deliberately held; " +
      "deploy-or-abandon deferred → practitioner (later); renders only in the Counsel Brief. When the " +
      "practitioner abandons, the decision lands as *killed* (`killed_on` on the submission or authority, " +
      "schema v16) — not a marker (rule 5, as crossed out; §4); the Counsel Brief's *Killed* sections are its " +
      "rendering, and a killed item never shows 🂡 — nothing is deferred any more; a reserved rhetorical " +
      "paragraph is abandoned by deleting its placements, links and row (v71), never killed.",
    history: "",
  },
  {
    glyph: "🤥", name: "impeachment", group: "hold",
    meaning: "a statement held for impeachment",
    work: "decide later whether to deploy or abandon it",
    actor: "practitioner",
    condition:
      "🤥 **impeachment** — statement-level: `purpose='impeachment'`; Counsel Brief only, alongside lead and " +
      "failed statements of law (`statement.verification` `'lead'` ⊕ `'failed'`, the brief-only cap). No longer " +
      "🂡's subset by storage; same hold posture.",
    history: "",
  },
  {
    glyph: "🚩", name: "adverse", group: "hold",
    meaning: "harmful to our own position: a fact flagged adverse, or a point we predict the other side may run",
    work: "decide on disclosure and prepare a rebuttal, at application review",
    actor: "practitioner",
    modelNote:
      "The pipeline never decides whether disclosure is required; that question goes through /legal-research. When a " +
      "predicted point is actually raised, record it as their point to answer and remove the prediction; no link is kept.",
    condition:
      "🚩 **adverse** — disclosure judgment (candour) and rebuttal preparation deferred → practitioner, at " +
      "application review; Counsel Brief only, never delivered — the pipeline never decides whether disclosure " +
      "is required (routes through `/legal-research`). Two predicates, one posture: `facts.adverse=1` " +
      "(assertion level) ⊕ an `anticipated_points` row existing (the practitioner's own prediction of a point " +
      "the other side may run, not yet raised). Orthogonal to 🂡, not a subset of it like 🤥 — reads no " +
      "deployment state at all: `anticipated_points` is never pointed to by any document, so it must never be " +
      "read by 🂡's \"deployed by no document\" predicate (which would otherwise fire vacuously on every row); a " +
      "`facts.adverse` flag is likewise silent to deployment, so an adverse fact can be deployed — even " +
      "disclosed — and still carry 🚩 (§4 → adverse orthogonal).",
    history: "",
  },
];

export const COMBINATIONS: readonly CombinationRow[] = [
  // Event-to-work routes (work-markers.md "Types" and section 5 "Proof (admission)").
  { key: "⏰📑", meaning: "deemed admission; the response passage is not captured verbatim", work: "capture the passage verbatim to record the admission as proof" },
  { key: "⏰📌", meaning: "deemed admission; no locator into the admission instrument or its response", work: "find the pinpoint to record the admission as proof" },
  { key: "⏰🕹️", meaning: "deemed admitted, not yet before the tribunal", work: "tender the admission instrument and the affidavit of service; pleading route: requisition default judgment" },
  { key: "🤝📑", meaning: "admitted; the response passage is not captured verbatim", work: "capture the passage verbatim to record the admission as proof" },
  { key: "🤝📌", meaning: "admitted; no locator into the admission instrument or its response", work: "find the pinpoint to record the admission as proof" },
  { key: "🤝💬", meaning: "admitted in the party's own words, not yet captured verbatim", work: "capture the answer verbatim to record the admission as proof" },
  { key: "🤝🧷", meaning: "admitted; no locator into the answers or the transcript", work: "find the pinpoint to record the admission as proof" },
  { key: "🤝🕹️", meaning: "admitted, not yet before the tribunal", work: "tender the response" },
  { key: "🙅🏻‍♂️👤", meaning: "denied, and nobody yet identified to prove it", work: "find a witness" },
  { key: "🫸👤", meaning: "refused to answer, and nobody yet identified to prove it", work: "find a witness" },
  { key: "🤷👤", meaning: "no knowledge, and nobody yet identified to prove it", work: "find a witness" },
  { key: "⚡️⏳", meaning: "the court struck the admission and set a new response period, now running", work: "diarize, then classify the response" },
  { key: "⚡️👤", meaning: "the court struck the admission and set no new response period", work: "find a witness to prove it by evidence" },
  { key: "⛔🏛️", meaning: "the authority that supplied the power to grant is not good law, so the basis is needed again", work: "find the law for the power to grant" },
  { key: "⛔📖", meaning: "the authority that supported this proposition is not good law, and no other is in hand", work: "find the law for the test applied in deciding" },
  // Beside 🧐 (work-markers.md table 1a row 🧐): the routing decision is counsel's, in the review.
  { key: "⚠️🧐", meaning: "the authority stands on dissimilar facts, and counsel has not yet reviewed it", work: "decide in the review whether to argue past it or replace it" },
  { key: "🚨🧐", meaning: "the authority is questioned or not followed, and counsel has not yet reviewed it", work: "decide in the review whether to disclose it or replace it" },
  { key: "🕰️🧐", meaning: "the case was decided in an earlier year than a provision this proposition also cites dates from, and counsel has not yet reviewed it", work: "decide in the review whether the case speaks to the provision, or replace it" },
  { key: "⛔🧐", meaning: "an authority relied on here is overruled, and counsel has not yet confirmed the overruling", work: "confirm the overruling in the review and approve the content as it now reads" },
  // Co-rendering pairs the docs name.
  { key: "🥉🏅", meaning: "the best rated support is tertiary, and at least one statement is unrated", work: "rate the unrated statements, and get primary or secondary authority" },
  { key: "🥈🏅", meaning: "the best rated support is secondary, and at least one statement is unrated", work: "rate the unrated statements, and get primary authority" },
  { key: "📌🧷", meaning: "an exhibit-backed statement owes both locators: the instrument's paragraph and the exhibit's pinpoint", work: "find both pinpoints" },
  { key: "🔬👃", meaning: "a lead not yet verified, which is also doubted", work: "scrutinize the lead, and check the doubt" },
];

export const PLACEMENTS: readonly PlacementRow[] = [
  // Senses by line (proposal-inventory.ts NON_GENERATING_GLYPHS and GlyphInstance).
  { glyph: "🔬", line: "statement of law line", text: "this statement is a lead, not yet verified: scrutinize it" },
  { glyph: "🔬", line: "proposition line", text: "at least one lead supports this proposition and none is verified yet; each lead is scrutinized on its own line" },
  { glyph: "🔬", line: "clause line", text: "this implied clause cites a lead not yet verified" },
  { glyph: "🏅", line: "statement of law line", text: "this statement carries no rating" },
  { glyph: "🏅", line: "proposition line", text: "no statement is rated primary and at least one is unrated, so the rung cannot be told; it is not a lower rank" },
  { glyph: "📖", line: "proposition line", text: "no authority in hand supports this proposition; while a statement of it has failed scrutiny, the next step is the practitioner's decision, not new research" },
  { glyph: "🚧", line: "proposition line", text: "researched, and nothing found" },
  { glyph: "🚧", line: "order line", text: "no jurisdictional basis was found for this order" },
  { glyph: "🚧", line: "fact line", text: "investigated, and nobody found to prove it" },
  { glyph: "👃", line: "statement of fact line", text: "suspicious: the fact is asserted but doubted; the investigator checks it" },
  { glyph: "👃", line: "statement of law line", text: "dubious: the legal basis is doubted; the research lawyer checks it" },
  {
    glyph: "👃", line: "statement of law line, where scrutiny failed",
    text: "the research lawyer found the excerpt does not support the proposition or is not the court's own reasoning; the practitioner decides to change it, keep it over the finding, or drop it, and counsel confirms",
  },
  { glyph: "⬜", documents: ["Requisition"], text: "a required order or affidavit is not yet attached" },
  { glyph: "⬜", documents: ["Notice_of_application"], line: "in place of the jurisdiction sentence", text: "whether the application is before an associate judge is not yet chosen" },
  { glyph: "⬜", documents: ["Application_response", "Response_book"], text: "no position is yet taken on an order the other side seeks; taking no position is a choice and clears it" },
  {
    glyph: "⬜", documents: ["Default_judgment"], text: "the order template is not yet chosen",
    slug: "choose-template", title: "Choose the order template",
  },
  // Document-specific notes the docs state.
  { glyph: "🏷️", documents: ["Default_judgment"], text: "the template named for this provision is not one the form recognizes" },
  { glyph: "🏷️", documents: ["Evidence_index"], text: "a document's description is not recorded" },
  {
    glyph: "🏷️", line: "party line at the head of the document",
    text: "the party's details are not confirmed by the matter's case record: not linked, not of record, counsel or the address for service differs, or the case record could not be read",
  },
  { glyph: "🎾", documents: ["Evidence_index"], text: "prints on the Evidence Index only; the other material lists do not show it" },
  { glyph: "🕹️", documents: ["Evidence_index"], text: "prints on the Evidence Index only; the other material lists do not show it" },
  {
    glyph: "👤", documents: ["Evidence_index", "Notice_of_application"], line: "a document's own line",
    text: "no witness tenders this document and no admission covers it: find the tendering witness or record the admission",
  },
  { glyph: "🧩", documents: ["Witness_statement"], text: "as a whole line, no facts are attributed to this witness; after a paragraph, no fact is linked to it" },
  { glyph: "🧩", documents: ["General_writing"], text: "a part not written, a section with nothing in it yet, no signer chosen, or no To recipient" },
  { glyph: "🂡", documents: ["Counsel_brief"], text: "prints in the Counsel Brief only; never delivered" },
  { glyph: "🤥", documents: ["Counsel_brief"], text: "prints in the Counsel Brief only; never delivered" },
  { glyph: "🚩", documents: ["Counsel_brief"], text: "prints in the Counsel Brief only; never delivered" },
];

/** Glyphs longest first, so a sequence that begins with a shorter glyph's code points is matched
 * whole. */
const GLYPHS_LONGEST_FIRST = SYMBOLS.map((s) => s.glyph).sort((a, b) => b.length - a.length);

/** Splits a fused run of glyphs into table glyphs. Throws on any text that is not a table glyph,
 * naming the leftover, so a caller cannot mistake a partial split for a whole one. */
export function splitGlyphs(run: string): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < run.length) {
    const glyph = GLYPHS_LONGEST_FIRST.find((g) => run.startsWith(g, i));
    if (!glyph) throw new Error(`splitGlyphs: "${run.slice(i)}" in "${run}" is not a table glyph`);
    out.push(glyph);
    i += glyph.length;
  }
  return out;
}
