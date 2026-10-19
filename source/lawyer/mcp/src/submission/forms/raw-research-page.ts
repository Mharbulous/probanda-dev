// The Raw Research view page (planning/1. Design/2026-10-07_raw-research-page-spec.md): one
// `Raw Research - Job Board <id>.html` per live Writing, written by the view-page registry
// (../view-pages.ts), listing every proposition of law the drafting database records for the
// filing's proceeding, each with its statements of law: citation, pinpoint, excerpt, verification
// and note-up status, and the submissions it is linked to. The page itself is the template set in
// src/templates/view-pages/ (map #125); the registry adds the data line, and this file gives the data.
//
// A human interface generated from the database (ADR 0033): no session reads, greps, parses or
// screenshots it. Sessions read propositions through /drafting-data and the mockups.
//
// Classes come from recorded data only, never from inference (rawResearchClass):
//   in use        -- the proposition is deployed on this filing: linked to a submission on it that
//                    is not killed, or required by an order on it; or the statement is cited in the
//                    filing's own text or is an order's jurisdictional citation on it. Ordinary text.
//   undecided     -- recorded but not in use on this filing. Held in reserve is this class: reserve
//                    is derived from the same "deployed by no document of the filing" test.
//   not relevant  -- the practitioner omitted the proposition (law_assertions.killed_on, v64), or
//                    the statement's authority is killed. Struck through.
//
// The page shows only what is recorded: a research return's propositions are not in the drafting
// database until a session records one (spec §9.1: no). It adds no wording, summary or rating to a
// proposition. The citation line is the mockups' own (lawStatementCitationLine), so the two never drift.

import { composeTemplate } from "../../compose-template.js";
import boardCss from "../../templates/work-board/board.css.js";
import rawResearchCss from "../../templates/view-pages/raw-research.css.js";
import rawResearchHtml from "../../templates/view-pages/raw-research.html.js";
import rawResearchJs from "../../templates/view-pages/raw-research.js.js";
import sharedJs from "../../templates/view-pages/shared.js.js";
import viewHeadHtml from "../../templates/view-pages/view-head.html.js";
import { submissionDataQuery } from "../backend.js";
import type { ViewPage } from "../view-pages.js";
import { lawStatementCitationLine, type LawStatementLine } from "./law-statement-line.js";
import { excerptSpeakerColumn, type FilingRow, settledOnColumn, treatmentNoteColumn } from "./query.js";

export type RawResearchClass = "in_use" | "undecided" | "not_relevant";

/** What the class rule reads: the two recorded rejections, and whether this filing uses it. */
export interface RawResearchClassInput {
  proposition_killed_on: string | null;
  authority_killed_on: string | null;
  in_use: boolean;
}

/** The page's one class rule: not relevant when the proposition is omitted or the authority is killed,
 * else in use or undecided. */
export function rawResearchClass(row: RawResearchClassInput): RawResearchClass {
  if (row.proposition_killed_on !== null || row.authority_killed_on !== null) return "not_relevant";
  return row.in_use ? "in_use" : "undecided";
}

export interface RawResearchStatement {
  statement_id: number;
  class: RawResearchClass;
  /** The authority's style of cause or title, printed in italics; null only on a malformed line. */
  citation_title: string | null;
  /** The rest of the mockups' citation line: citation, pinpoint and its plain-text tags. */
  citation_rest: string;
  excerpt: string | null;
  /** Recorded values, labelled: verification, then note-up or currency. */
  status: string[];
}

export interface RawResearchProposition {
  /** Null on a statement recorded with no proposition (a Writing's prose-cited statement, or an
   * order's jurisdictional citation). */
  law_assertion_id: number | null;
  text: string | null;
  dead_end: boolean;
  /** The date the practitioner omitted the proposition, or null. */
  killed_on: string | null;
  /** The card's class: in use when any statement is, else undecided when any is, else not
   * relevant. A proposition with no statement is classed by rawResearchClass alone. */
  class: RawResearchClass;
  /** Every submission linked to it, killed ones tagged ` (killed <date>)`. */
  linked_to: string[];
  statements: RawResearchStatement[];
}

export interface RawResearchGroup {
  heading: string;
  note: string | null;
  propositions: RawResearchProposition[];
}

export interface RawResearchData {
  /** One per statement, and one per proposition with no statement. */
  counts: Record<RawResearchClass, number>;
  groups: RawResearchGroup[];
}

function rows<T>(dbPath: string, sql: string, params: unknown[] = []): T[] {
  return submissionDataQuery(dbPath, sql, params).rows as unknown as T[];
}

/** Columns known to be held, by database and `table.column`. Only a present column is remembered,
 * as query.ts does: no hop drops one, while a database can be migrated mid-session. */
const columnsHeld = new Set<string>();

function columnHeld(dbPath: string, table: string, column: string): boolean {
  const key = `${dbPath}\u0000${table}.${column}`;
  if (columnsHeld.has(key)) return true;
  const held = rows<{ n: number }>(dbPath, `SELECT COUNT(*) AS n FROM pragma_table_info('${table}') WHERE name = '${column}'`)[0].n > 0;
  if (held) columnsHeld.add(key);
  return held;
}

/** The select expression for a statement's `verified_on` (alias `sl`, schema v61), or NULL below it. */
function verifiedOnColumn(dbPath: string): string {
  return columnHeld(dbPath, "statements_of_law", "verified_on") ? "sl.verified_on" : "NULL AS verified_on";
}

/** The select expression for a proposition's `killed_on` (schema v64), or NULL below it. */
function propositionKilledOnColumn(dbPath: string): string {
  return columnHeld(dbPath, "law_assertions", "killed_on") ? "killed_on" : "NULL AS killed_on";
}

type StatementRow = Omit<LawStatementLine, "linked_provisions"> & {
  statement_id: number;
  law_assertion_id: number | null;
  verified_on: string | null;
};

function fetchStatements(dbPath: string, proceedingId: number): StatementRow[] {
  return rows<StatementRow>(
    dbPath,
    `SELECT sl.id AS statement_id, sl.law_assertion_id, sl.pinpoint, sl.excerpt, sl.doubt, sl.source, sl.verification,
            ${settledOnColumn(dbPath)}, ${excerptSpeakerColumn(dbPath)}, ${verifiedOnColumn(dbPath)},
            auth.style_of_cause_or_title AS authority_title, auth.citation AS authority_citation, auth.treatment,
            auth.kind AS authority_kind, auth.currency_status, auth.currency_checked_on, ${treatmentNoteColumn(dbPath)}, auth.killed_on AS authority_killed_on
     FROM statements_of_law sl
     JOIN authorities auth ON auth.id = sl.authority_id
     WHERE sl.proceeding_id = ?
     ORDER BY sl.id`,
    [proceedingId]
  );
}

interface PropositionRow {
  id: number;
  proposition: string;
  dead_end: number;
  killed_on: string | null;
}

interface SubmissionLinkRow {
  law_assertion_id: number;
  submission_id: number;
  contention: string;
  killed_on: string | null;
}

interface SubmissionRow {
  id: number;
  contention: string;
}

/** The mockups' citation line split for HTML: the italic title, then the rest as printed. */
function citationParts(row: StatementRow): { title: string | null; rest: string } {
  const line = lawStatementCitationLine({ ...row, linked_provisions: null }) ?? "";
  const head = row.authority_title === null ? null : `> *${row.authority_title}*`;
  if (head !== null && line.startsWith(head)) return { title: row.authority_title, rest: line.slice(head.length) };
  return { title: null, rest: line.replace(/^> /, "") };
}

/** The statement's recorded verification and note-up values, labelled, never rated. */
function statusLines(row: StatementRow): string[] {
  const when = row.verification === "verified" ? row.verified_on : row.verification === "settled" ? row.settled_on : null;
  const lines = [`Verification: ${row.verification}${when ? ` ${when}` : ""}`];
  if (row.authority_kind === "case") lines.push(`Note-up: ${row.treatment === null ? "not yet noted up" : row.treatment.replace(/_/g, " ")}`);
  else if (row.authority_kind !== "doctrine") lines.push(`Currency: ${row.currency_status ?? "not yet checked"}`);
  return lines;
}

const CLASS_RANK: Record<RawResearchClass, number> = { in_use: 0, undecided: 1, not_relevant: 2 };

/**
 * The page's data for one filing, from the drafting database alone: every proposition of the
 * filing's proceeding with its statements, each statement classed by rawResearchClass, placed once
 * under the first group it belongs to -- this filing's submissions in their order on the filing
 * (the venue form's, then the Written Arguments'), an order on this filing requiring it or citing
 * one of its statements, this Writing's own text citing it, the proceeding's other submissions not
 * killed, an order not on this filing, else Not linked.
 */
export function buildRawResearchData(dbPath: string, filing: FilingRow | FilingRow[]): RawResearchData {
  // A merged board's page (ADR 0010): each proceeding's propositions read against the board's Writings in it.
  const filings = Array.isArray(filing) ? filing : [filing];
  const counts: Record<RawResearchClass, number> = { in_use: 0, undecided: 0, not_relevant: 0 };
  const groups: RawResearchGroup[] = [];
  for (const proceedingId of [...new Set(filings.map((f) => f.proceeding_id))]) {
    const part = rawResearchFor(dbPath, proceedingId, filings.filter((f) => f.proceeding_id === proceedingId).map((f) => f.id), filings.length > 1);
    for (const k of Object.keys(counts) as RawResearchClass[]) counts[k] += part.counts[k];
    groups.push(...part.groups);
  }
  return { counts, groups };
}

function rawResearchFor(dbPath: string, proceedingId: number, ids: number[], merged: boolean): RawResearchData {
  const inIds = `(${ids.map(() => "?").join(", ")})`;
  const here = merged ? "this board's Writings" : "this Writing";
  const propositions = rows<PropositionRow>(
    dbPath,
    `SELECT id, proposition, dead_end, ${propositionKilledOnColumn(dbPath)} FROM law_assertions WHERE proceeding_id = ? ORDER BY id`,
    [proceedingId]
  );
  const statements = fetchStatements(dbPath, proceedingId);
  const links = rows<SubmissionLinkRow>(
    dbPath,
    `SELECT sbl.law_assertion_id, s.id AS submission_id, s.contention, s.killed_on
     FROM submission_law sbl JOIN submissions s ON s.id = sbl.submission_id
     WHERE s.proceeding_id = ?
     ORDER BY s.ordinal, s.id`,
    [proceedingId]
  );
  const onFiling = rows<SubmissionRow>(
    dbPath,
    `SELECT s.id, s.contention
     FROM filing_submissions fs JOIN submissions s ON s.id = fs.submission_id
     WHERE fs.filing_id IN ${inIds} AND s.killed_on IS NULL
     ORDER BY CASE fs.document WHEN 'form' THEN 0 ELSE 1 END, fs.ordinal, fs.id`,
    ids
  );
  const elsewhere = rows<SubmissionRow>(
    dbPath,
    `SELECT s.id, s.contention FROM submissions s
     WHERE s.proceeding_id = ? AND s.killed_on IS NULL
       AND NOT EXISTS (SELECT 1 FROM filing_submissions fs WHERE fs.submission_id = s.id AND fs.filing_id IN ${inIds})
     ORDER BY s.ordinal, s.id`,
    [proceedingId, ...ids]
  );
  // An order's requires edge names a proposition, or a jurisdictional citation by its statement
  // (excerpt_id, a statement with no proposition), or both.
  const required = rows<{ law_assertion_id: number | null; excerpt_id: number | null; on_filing: number }>(
    dbPath,
    `SELECT r.law_assertion_id, r.excerpt_id,
            EXISTS (SELECT 1 FROM filing_orders fo WHERE fo.order_sought_id = r.order_sought_id AND fo.filing_id IN ${inIds}) AS on_filing
     FROM order_sought_requires r JOIN order_sought o ON o.id = r.order_sought_id
     WHERE o.proceeding_id = ? AND (r.law_assertion_id IS NOT NULL OR r.excerpt_id IS NOT NULL)`,
    [...ids, proceedingId]
  );
  const citedHere = new Set(rows<{ statement_id: number }>(dbPath, `SELECT statement_id FROM filing_law WHERE filing_id IN ${inIds}`, ids).map((r) => r.statement_id));

  // In use on this filing: a link to a submission on it (killed ones are not in onFiling), an
  // order on it requiring the proposition or citing the statement, or this Writing's text citing it.
  const onFilingIds = new Set(onFiling.map((s) => s.id));
  const present = (list: (number | null)[]) => list.filter((id): id is number => id !== null);
  const deployed = new Set([
    ...links.filter((l) => onFilingIds.has(l.submission_id)).map((l) => l.law_assertion_id),
    ...present(required.filter((r) => r.on_filing === 1).map((r) => r.law_assertion_id)),
  ]);
  const usedHere = new Set([...citedHere, ...present(required.filter((r) => r.on_filing === 1).map((r) => r.excerpt_id))]);

  const counts: Record<RawResearchClass, number> = { in_use: 0, undecided: 0, not_relevant: 0 };
  function statementOf(row: StatementRow, killedOn: string | null): RawResearchStatement {
    const inUse = (row.law_assertion_id !== null && deployed.has(row.law_assertion_id)) || usedHere.has(row.statement_id);
    const cls = rawResearchClass({ proposition_killed_on: killedOn, authority_killed_on: row.authority_killed_on, in_use: inUse });
    counts[cls] += 1;
    const { title, rest } = citationParts(row);
    return { statement_id: row.statement_id, class: cls, citation_title: title, citation_rest: rest, excerpt: row.excerpt, status: statusLines(row) };
  }
  function cardClass(own: RawResearchStatement[], killedOn: string | null, inUse: boolean): RawResearchClass {
    if (own.length === 0) {
      const cls = rawResearchClass({ proposition_killed_on: killedOn, authority_killed_on: null, in_use: inUse });
      counts[cls] += 1;
      return cls;
    }
    return own.reduce<RawResearchClass>((best, s) => (CLASS_RANK[s.class] < CLASS_RANK[best] ? s.class : best), "not_relevant");
  }

  const cards = new Map<number, RawResearchProposition>();
  for (const p of propositions) {
    const own = statements.filter((s) => s.law_assertion_id === p.id).map((s) => statementOf(s, p.killed_on));
    const linkedTo = links.filter((l) => l.law_assertion_id === p.id).map((l) => (l.killed_on === null ? l.contention : `${l.contention} (killed ${l.killed_on})`));
    cards.set(p.id, {
      law_assertion_id: p.id,
      text: p.proposition,
      dead_end: p.dead_end === 1,
      killed_on: p.killed_on,
      class: cardClass(own, p.killed_on, deployed.has(p.id)),
      linked_to: linkedTo,
      statements: own,
    });
  }
  // A statement recorded with no proposition is its own card.
  const loose = new Map(
    statements
      .filter((s) => s.law_assertion_id === null)
      .map((s): [number, RawResearchProposition] => {
        const own = [statementOf(s, null)];
        return [s.statement_id, { law_assertion_id: null, text: null, dead_end: false, killed_on: null, class: own[0].class, linked_to: [], statements: own }];
      })
  );

  const placed = new Set<number>();
  function take(ids: Iterable<number>): RawResearchProposition[] {
    const out: RawResearchProposition[] = [];
    for (const id of ids) {
      const card = cards.get(id);
      if (card === undefined || placed.has(id)) continue;
      placed.add(id);
      out.push(card);
    }
    return out;
  }
  const placedLoose = new Set<number>();
  function takeLoose(ids: Iterable<number>): RawResearchProposition[] {
    const out: RawResearchProposition[] = [];
    for (const id of ids) {
      const card = loose.get(id);
      if (card === undefined || placedLoose.has(id)) continue;
      placedLoose.add(id);
      out.push(card);
    }
    return out;
  }
  const linkedTo = (submissionId: number) => links.filter((l) => l.submission_id === submissionId).map((l) => l.law_assertion_id);
  const groups: RawResearchGroup[] = [];
  const push = (heading: string, note: string | null, list: RawResearchProposition[]) => {
    if (list.length > 0) groups.push({ heading, note, propositions: list });
  };
  // An order's requirements: the propositions its edges name and those of the statements they cite,
  // then the cited statements that have no proposition.
  const propositionOf = new Map(statements.map((s) => [s.statement_id, s.law_assertion_id]));
  const orderGroup = (edges: typeof required) => [
    ...take(present([...edges.map((r) => r.law_assertion_id), ...edges.map((r) => (r.excerpt_id === null ? null : (propositionOf.get(r.excerpt_id) ?? null)))])),
    ...takeLoose(present(edges.map((r) => r.excerpt_id))),
  ];
  const seen = new Set<number>();
  for (const s of onFiling) {
    if (seen.has(s.id)) continue;
    seen.add(s.id);
    push(s.contention, `Submission on ${here}`, take(linkedTo(s.id)));
  }
  push("Required by an order sought", `Order on ${here}`, orderGroup(required.filter((r) => r.on_filing === 1)));
  const cited = statements.filter((s) => citedHere.has(s.statement_id));
  push(merged ? "Cited in the text of this board's Writings" : "Cited in this Writing's text", null, [...take(present(cited.map((s) => s.law_assertion_id))), ...takeLoose(cited.map((s) => s.statement_id))]);
  for (const s of elsewhere) push(s.contention, `Submission not on ${here}`, take(linkedTo(s.id)));
  push("Required by an order sought", `Order not on ${here}`, orderGroup(required.filter((r) => r.on_filing !== 1)));
  push("Not linked", null, [...take(cards.keys()), ...takeLoose(loose.keys())]);

  return { counts, groups };
}

// The page's script (raw-research.js) draws window.VIEW_PAGE.data into .board, and the class counts
// and the filters into the header the template wrote, under its meta row.
/** The page's view-page registry entry (../view-pages.ts VIEW_PAGES). */
export const RAW_RESEARCH_PAGE: ViewPage = {
  name: "Raw Research",
  ...composeTemplate("raw-research.html", {
    "raw-research.html": rawResearchHtml,
    "view-head.html": viewHeadHtml,
    "board.css": boardCss,
    "raw-research.css": rawResearchCss,
    "shared.js": sharedJs,
    "raw-research.js": rawResearchJs,
  }),
  data: (ctx) => buildRawResearchData(ctx.dbPath, ctx.writings.map((w) => w.filing)),
};
