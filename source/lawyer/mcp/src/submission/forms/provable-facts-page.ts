// The Provable Facts page (planning/1. Design/2026-10-07_provable-facts-page-spec.md), a view page
// (view-pages.ts): the facts one live filing uses, in the order the filing states them, each in one
// of three classes read from recorded data only.
//
// - Provable: on the court record, admitted by every opposing party, or proved by at least one link
//   to evidence in hand that the practitioner has not recorded as inadmissible.
// - Not yet in evidence: no such link. "In hand" is the `evidence` criterion's own test, read per
//   statement of fact off the inventory the filing's last render saved (isEvidenceWork): a link with
//   evidence work outstanding on a forum document is not in hand. The inventory records only
//   outstanding work, never a finished statement, so its silence on a link counts only when that
//   render saw the link as it stands now: its render stamp carries the database's current revision,
//   which every write to a statement, fact, document or deployment row moves. A filing never
//   rendered, or changed since its last render, has no inventory to read, so none of its links reads
//   as in hand, and the page says why.
// - Inadmissible evidence only: every link carries the practitioner's recorded decision that its
//   evidence is inadmissible (statements_of_fact.inadmissible_on, schema v63), and the fact is
//   neither on the court record nor admitted by every opposing party.
//
// A link's admissibility_note is a concern, not a decision: it shows as a flag and changes no class.
// A statement held for impeachment proves nothing and no forum document prints it, so it is not a
// link here. No class is inferred from document text, and the page states no law.
//
// The order is the filing's: its form's facts by ordinal, then the facts only its Written Arguments
// state, then the facts only its submissions rest on, in submission order.
//
// The page itself is the template set in src/templates/view-pages/ (map #125).

import { composeTemplate } from "../../compose-template.js";
import boardCss from "../../templates/work-board/board.css.js";
import provableFactsCss from "../../templates/view-pages/provable-facts.css.js";
import provableFactsHtml from "../../templates/view-pages/provable-facts.html.js";
import provableFactsJs from "../../templates/view-pages/provable-facts.js.js";
import sharedJs from "../../templates/view-pages/shared.js.js";
import viewHeadHtml from "../../templates/view-pages/view-head.html.js";
import { submissionDataQuery } from "../backend.js";
import { mockupDir, readManifest } from "../render-manifest.js";
import type { ViewPage, ViewPageContext } from "../view-pages.js";
import type { InventoryEntry } from "./proposal-inventory.js";
import { fetchParties } from "./query.js";
import { factStatementCitationLine, fetchFactAdmissionCoverage } from "./render-vaniac-submissions.js";
import { isEvidenceWork } from "./render-work-board.js";

function rows<T>(dbPath: string, sql: string, params: unknown[] = []): T[] {
  return submissionDataQuery(dbPath, sql, params).rows as unknown as T[];
}

interface FactRow {
  id: number;
  postulate: string;
  court_record: number | null;
  court_record_pinpoint: string | null;
  court_record_label: string | null;
}

interface StatementRow {
  id: number;
  fact_id: number;
  witness_name: string;
  instrument: number | null;
  pinpoint: string | null;
  exhibit_id: number | null;
  exhibit_pinpoint: string | null;
  instrument_label: string | null;
  exhibit_label: string | null;
  admissibility_note: string | null;
  purpose: string | null;
  /** Schema v63. Absent (undefined) on a database held below it, since the row is read with sof.*. */
  inadmissible_on?: string | null;
  inadmissible_note?: string | null;
}

type FactClass = "provable" | "pending" | "inadmissible";

interface PageLink {
  witness: string;
  cite: string | null;
  /** null where the link needs no assessing: its fact is on the court record or admitted. */
  state: "in_hand" | "pending" | "inadmissible" | null;
  concern: string | null;
  decided_on: string | null;
  decision: string | null;
}

interface PageFact {
  position: number;
  text: string;
  class: FactClass;
  basis: string | null;
  links: PageLink[];
}

export interface ProvableFactsData {
  /** Whether the filing's last render saw its links as they stand now (`read`), or why not. */
  evidence: "read" | "never_rendered" | "changed_since";
  facts: PageFact[];
}

/** The facts the filing uses, once each, in the order the filing states them. */
function factsInFilingOrder(dbPath: string, filingId: number): FactRow[] {
  const found = rows<FactRow>(
    dbPath,
    `SELECT f.id, f.postulate, f.court_record, f.court_record_pinpoint, cr.label AS court_record_label
     FROM (SELECT fact_id, 0 AS grp, ordinal AS k1, 0 AS k2 FROM filing_facts WHERE filing_id = ? AND document = 'form'
           UNION ALL
           SELECT fact_id, 1, ordinal, 0 FROM filing_facts WHERE filing_id = ? AND document = 'written_argument'
           UNION ALL
           SELECT sf.fact_id, CASE fs.document WHEN 'form' THEN 2 ELSE 3 END, fs.ordinal, sf.fact_id
           FROM filing_submissions fs JOIN submission_facts sf ON sf.submission_id = fs.submission_id
           WHERE fs.filing_id = ?) u
     JOIN facts f ON f.id = u.fact_id
     LEFT JOIN documents cr ON cr.id = f.court_record
     ORDER BY u.grp, u.k1, u.k2`,
    [filingId, filingId, filingId]
  );
  const seen = new Set<number>();
  return found.filter((f) => {
    if (seen.has(f.id)) return false;
    seen.add(f.id);
    return true;
  });
}

function statementsOf(dbPath: string, factIds: number[]): StatementRow[] {
  if (factIds.length === 0) return [];
  return rows<StatementRow>(
    dbPath,
    `SELECT sof.*, w.name AS witness_name, ins.label AS instrument_label, ex.label AS exhibit_label
     FROM statements_of_fact sof
     JOIN witnesses w ON w.id = sof.witness_id
     LEFT JOIN documents ins ON ins.id = sof.instrument
     LEFT JOIN documents ex ON ex.id = sof.exhibit_id
     WHERE sof.fact_id IN (${factIds.map(() => "?").join(", ")})
     ORDER BY sof.id`,
    factIds
  );
}

/** The links with evidence work outstanding on the filing's forum documents: an entry keyed on the
 * statement itself, on its witness for it, or on its instrument or exhibit document. */
function linksWithWork(inventory: readonly InventoryEntry[], statements: readonly StatementRow[]): Set<number> {
  const work = inventory.filter(isEvidenceWork);
  const open = new Set<number>();
  for (const s of statements) {
    const outstanding = work.some(
      (e) =>
        (e.table === "statements_of_fact" && e.id === s.id) ||
        (e.table === "witnesses" && e.generating && e.statement_id === s.id) ||
        (e.table === "documents" && (e.id === s.instrument || e.id === s.exhibit_id))
    );
    if (outstanding) open.add(s.id);
  }
  return open;
}

/** The link's evidence as the mockups cite it: the instrument and its pinpoint, the exhibit and its. */
function citeOf(s: StatementRow): string | null {
  const labels = new Map<number, string>();
  if (s.instrument !== null && s.instrument_label !== null) labels.set(s.instrument, s.instrument_label);
  if (s.exhibit_id !== null && s.exhibit_label !== null) labels.set(s.exhibit_id, s.exhibit_label);
  const line = factStatementCitationLine(new Map(), labels, { instrument_id: s.instrument, pinpoint: s.pinpoint, exhibit_id: s.exhibit_id, exhibit_pinpoint: s.exhibit_pinpoint });
  return line === null ? null : line.replace(/^> /, "");
}

/** The page's data: each of the board's Writings in turn, the survivor's first, each in its own
 * order, a fact two Writings use listed once where it first occurs (ADR 0010). Drafting facts carry no
 * date. The evidence note is the first Writing's that was not read. */
export function provableFactsData(ctx: ViewPageContext): ProvableFactsData {
  const parts = ctx.writings.map((w) => provableFactsFor({ ...ctx, filing: w.filing, proceeding: w.proceeding }));
  const seen = new Set<number>();
  const facts: PageFact[] = [];
  for (const { id, ...f } of parts.flatMap((p) => p.facts)) {
    if (seen.has(id)) continue;
    seen.add(id);
    facts.push({ ...f, position: facts.length + 1 });
  }
  return { evidence: parts.find((p) => p.evidence !== "read")?.evidence ?? "read", facts };
}

function provableFactsFor(ctx: Omit<ViewPageContext, "writings">): { evidence: ProvableFactsData["evidence"]; facts: (PageFact & { id: number })[] } {
  const { dbPath, filing, proceeding, now, revision } = ctx;
  const manifest = readManifest(mockupDir(dbPath, filing.id));
  // The inventory's silence on a link counts only when its render saw the link as it stands now.
  const inventory = manifest !== null && manifest.stamp.revision === revision ? manifest.inventory : null;
  const facts = factsInFilingOrder(dbPath, filing.id);
  const statements = statementsOf(dbPath, facts.map((f) => f.id)).filter((s) => s.purpose !== "impeachment");
  const open = inventory === null ? new Set<number>() : linksWithWork(inventory, statements);
  const unrecorded = facts.filter((f) => f.court_record === null).map((f) => f.id);
  const opposing = unrecorded.length === 0 ? [] : fetchParties(dbPath, proceeding.id).filter((p) => p.is_client !== 1).map((p) => p.id);
  const admitted = unrecorded.length === 0 ? new Set<number>() : fetchFactAdmissionCoverage(dbPath, unrecorded, opposing, now.slice(0, 10));

  return {
    evidence: manifest === null ? "never_rendered" : inventory === null ? "changed_since" : "read",
    facts: facts.map((f, i): PageFact & { id: number } => {
      const onRecord = f.court_record !== null;
      const guarded = onRecord || admitted.has(f.id);
      const links = statements.filter((s) => s.fact_id === f.id);
      const pageLinks = links.map((s): PageLink => {
        const decided = s.inadmissible_on !== undefined && s.inadmissible_on !== null;
        const state = decided ? "inadmissible" : guarded ? null : inventory !== null && !open.has(s.id) ? "in_hand" : "pending";
        return {
          witness: s.witness_name,
          cite: citeOf(s),
          state,
          concern: s.admissibility_note,
          decided_on: decided ? (s.inadmissible_on as string) : null,
          decision: decided ? (s.inadmissible_note ?? null) : null,
        };
      });
      const basis = onRecord
        ? `On the court record${f.court_record_label === null ? "" : `: ${f.court_record_label}`}${f.court_record_pinpoint ? `, ${f.court_record_pinpoint}` : ""}`
        : admitted.has(f.id)
          ? "Admitted by every opposing party"
          : null;
      const cls: FactClass = guarded || pageLinks.some((l) => l.state === "in_hand")
        ? "provable"
        : pageLinks.length > 0 && pageLinks.every((l) => l.state === "inadmissible")
          ? "inadmissible"
          : "pending";
      return { id: f.id, position: i + 1, text: f.postulate, class: cls, basis, links: pageLinks };
    }),
  };
}

export const PROVABLE_FACTS: ViewPage = {
  name: "Provable Facts",
  ...composeTemplate("provable-facts.html", {
    "provable-facts.html": provableFactsHtml,
    "view-head.html": viewHeadHtml,
    "board.css": boardCss,
    "provable-facts.css": provableFactsCss,
    "shared.js": sharedJs,
    "provable-facts.js": provableFactsJs,
  }),
  data: provableFactsData,
};
