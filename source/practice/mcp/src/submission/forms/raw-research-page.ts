// The Raw Research view page (planning/1. Design/2026-10-07_raw-research-page-spec.md): one
// `Raw Research - Job Board <id>.html` per live Writing, written by the view-page registry
// (../view-pages.ts), listing every proposition of law the drafting database records for the
// filing's proceeding, each with its statements of law: citation, pinpoint, excerpt, verification
// and note-up status, and the submissions it is linked to. The registry's shell writes the page,
// its header, its marker and the data line; this file gives the data, the stylesheet and the script.
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
export function buildRawResearchData(dbPath: string, filing: FilingRow): RawResearchData {
  const proceedingId = filing.proceeding_id;
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
     WHERE fs.filing_id = ? AND s.killed_on IS NULL
     ORDER BY CASE fs.document WHEN 'form' THEN 0 ELSE 1 END, fs.ordinal, fs.id`,
    [filing.id]
  );
  const elsewhere = rows<SubmissionRow>(
    dbPath,
    `SELECT s.id, s.contention FROM submissions s
     WHERE s.proceeding_id = ? AND s.killed_on IS NULL
       AND NOT EXISTS (SELECT 1 FROM filing_submissions fs WHERE fs.submission_id = s.id AND fs.filing_id = ?)
     ORDER BY s.ordinal, s.id`,
    [proceedingId, filing.id]
  );
  // An order's requires edge names a proposition, or a jurisdictional citation by its statement
  // (excerpt_id, a statement with no proposition), or both.
  const required = rows<{ law_assertion_id: number | null; excerpt_id: number | null; on_filing: number }>(
    dbPath,
    `SELECT r.law_assertion_id, r.excerpt_id,
            EXISTS (SELECT 1 FROM filing_orders fo WHERE fo.order_sought_id = r.order_sought_id AND fo.filing_id = ?) AS on_filing
     FROM order_sought_requires r JOIN order_sought o ON o.id = r.order_sought_id
     WHERE o.proceeding_id = ? AND (r.law_assertion_id IS NOT NULL OR r.excerpt_id IS NOT NULL)`,
    [filing.id, proceedingId]
  );
  const citedHere = new Set(rows<{ statement_id: number }>(dbPath, "SELECT statement_id FROM filing_law WHERE filing_id = ?", [filing.id]).map((r) => r.statement_id));

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
    push(s.contention, "Submission on this Writing", take(linkedTo(s.id)));
  }
  push("Required by an order sought", "Order on this Writing", orderGroup(required.filter((r) => r.on_filing === 1)));
  const cited = statements.filter((s) => citedHere.has(s.statement_id));
  push("Cited in this Writing's text", null, [...take(present(cited.map((s) => s.law_assertion_id))), ...takeLoose(cited.map((s) => s.statement_id))]);
  for (const s of elsewhere) push(s.contention, "Submission not on this Writing", take(linkedTo(s.id)));
  push("Required by an order sought", "Order not on this Writing", orderGroup(required.filter((r) => r.on_filing !== 1)));
  push("Not linked", null, [...take(cards.keys()), ...takeLoose(loose.keys())]);

  return { counts, groups };
}

const PAGE_CSS = String.raw`
.filters{display:flex;flex-wrap:wrap;align-items:center;gap:8px 18px;margin:6px 0 0;font-size:13px}
.filters label{display:flex;align-items:center;gap:6px;cursor:pointer}
.filters input[type=search]{font:inherit;padding:4px 8px;border:1px solid var(--line-strong);border-radius:6px;background:var(--card);color:var(--ink);min-width:200px;flex:1 1 200px;max-width:360px}
.counts{font-family:var(--mono);font-size:12px;color:var(--muted);display:flex;flex-wrap:wrap;gap:4px 16px}
section>p.note{margin:-6px 0 10px;font-size:12px;color:var(--muted)}
article.prop{background:var(--card);border:2px solid var(--frame);border-radius:10px;padding:10px 14px;display:flex;flex-direction:column;gap:6px}
.prop>.text{font-weight:600;margin:0;white-space:pre-wrap}
.prop>.text.none{font-weight:400;font-style:italic;color:var(--muted)}
.prop>.linked,.prop>.dead{margin:0;font-size:12.5px;color:var(--muted)}
.stmt{border-top:1px solid var(--line);padding-top:6px;display:flex;flex-direction:column;gap:4px}
.stmt .cite{margin:0}
.stmt blockquote{margin:0;padding:2px 0 2px 12px;border-left:3px solid var(--line-strong);white-space:pre-wrap}
.stmt .status{margin:0;font-family:var(--mono);font-size:11.5px;color:var(--muted)}
.prop.undecided>p,.stmt.undecided{color:var(--muted);opacity:.6}
.prop.not_relevant>p,.stmt.not_relevant{color:var(--muted)}
.prop.not_relevant>.text,.stmt.not_relevant .cite,.stmt.not_relevant blockquote{text-decoration:line-through;text-decoration-color:var(--muted)}
.board>p.empty{margin:0;font-size:13px;color:var(--muted);background:var(--card);padding:12px 14px;border:1px dashed var(--frame);border-radius:8px}
[hidden]{display:none!important}
@media (max-width:600px){main{padding:16px}}
`;

// Draws window.VIEW_PAGE.data into .board, and the class counts and the filters into the header
// the shell wrote, under its meta row.
const PAGE_SCRIPT = String.raw`(function () {
  "use strict";
  var view = window.VIEW_PAGE;
  if (!view) return;
  var data = view.data;
  var header = document.querySelector("header");
  var board = document.querySelector(".board");
  var KEY = "raw-research-filters";

  function el(tag, cls, text) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  // Counted by statement; a proposition with no statement counts once.
  var countsRow = el("div", "counts");
  countsRow.appendChild(el("span", "", "Statements:"));
  [["In use", data.counts.in_use], ["Undecided", data.counts.undecided], ["Not relevant", data.counts.not_relevant]].forEach(function (pair) {
    countsRow.appendChild(el("span", "", pair[0] + " " + pair[1]));
  });
  header.appendChild(countsRow);
  function checkbox(text) {
    var label = el("label");
    var box = el("input");
    box.type = "checkbox";
    label.appendChild(box);
    label.appendChild(document.createTextNode(" " + text));
    return { label: label, box: box };
  }
  var undecidedBox = checkbox("Show undecided");
  var notRelevantBox = checkbox("Show not relevant");
  var search = el("input");
  search.type = "search";
  search.placeholder = "Search";
  search.setAttribute("aria-label", "Search propositions");
  var filters = el("div", "filters");
  filters.appendChild(undecidedBox.label);
  filters.appendChild(notRelevantBox.label);
  filters.appendChild(search);
  header.appendChild(filters);

  // Every card and statement keeps its own search text; the filters only toggle hidden.
  var entries = [];
  function statementNode(s) {
    var node = el("div", "stmt " + s.class);
    var cite = el("p", "cite");
    if (s.citation_title !== null) cite.appendChild(el("em", "", s.citation_title));
    cite.appendChild(document.createTextNode(s.citation_rest));
    node.appendChild(cite);
    if (s.excerpt) node.appendChild(el("blockquote", "", s.excerpt));
    if (s.status.length > 0) node.appendChild(el("p", "status", s.status.join(" · ")));
    return node;
  }
  function card(p) {
    var node = el("article", "prop " + p.class);
    node.appendChild(p.text === null ? el("p", "text none", "No proposition recorded") : el("p", "text", p.text));
    if (p.killed_on) node.appendChild(el("p", "dead", "Omitted " + p.killed_on));
    if (p.dead_end) node.appendChild(el("p", "dead", "Dead end: researched, nothing found"));
    if (p.linked_to.length > 0) node.appendChild(el("p", "linked", "Linked to: " + p.linked_to.join("; ")));
    var rows = p.statements.map(function (s) {
      var row = statementNode(s);
      node.appendChild(row);
      return { node: row, cls: s.class, text: [s.citation_title || "", s.citation_rest, s.excerpt || ""].join(" ").toLowerCase() };
    });
    if (p.statements.length === 0) node.appendChild(el("p", "linked", "No authority recorded"));
    return { node: node, cls: p.class, text: (p.text || "").toLowerCase(), rows: rows };
  }

  data.groups.forEach(function (g) {
    var sec = el("section");
    var h2 = el("h2", "", g.heading + " ");
    var count = el("span", "count", "0");
    h2.appendChild(count);
    sec.appendChild(h2);
    if (g.note) sec.appendChild(el("p", "note", g.note));
    var stack = el("div", "stack");
    var cards = g.propositions.map(function (p) {
      var c = card(p);
      stack.appendChild(c.node);
      return c;
    });
    sec.appendChild(stack);
    board.appendChild(sec);
    entries.push({ node: sec, count: count, cards: cards });
  });
  var empty = el("p", "empty", data.groups.length === 0 ? "No propositions of law are recorded for this proceeding." : "Nothing to show with these filters.");
  board.appendChild(empty);

  var showUndecided = undecidedBox.box;
  var showNotRelevant = notRelevantBox.box;
  try {
    var saved = JSON.parse(localStorage.getItem(KEY) || "{}");
    showUndecided.checked = saved.undecided === true;
    showNotRelevant.checked = saved.not_relevant === true;
  } catch (e) {}

  function shown(cls) {
    return cls === "in_use" || (cls === "undecided" && showUndecided.checked) || (cls === "not_relevant" && showNotRelevant.checked);
  }
  function apply() {
    var q = search.value.trim().toLowerCase();
    var any = false;
    entries.forEach(function (sec) {
      var visible = 0;
      sec.cards.forEach(function (c) {
        var cardMatch = q === "" || c.text.indexOf(q) !== -1;
        var rowsShown = 0;
        c.rows.forEach(function (r) {
          var on = shown(r.cls) && (cardMatch || r.text.indexOf(q) !== -1);
          r.node.hidden = !on;
          if (on) rowsShown += 1;
        });
        var on = c.rows.length === 0 ? shown(c.cls) && cardMatch : rowsShown > 0;
        c.node.hidden = !on;
        if (on) visible += 1;
      });
      sec.count.textContent = String(visible);
      sec.node.hidden = visible === 0;
      if (visible > 0) any = true;
    });
    empty.hidden = any;
  }
  function save() {
    try {
      localStorage.setItem(KEY, JSON.stringify({ undecided: showUndecided.checked, not_relevant: showNotRelevant.checked }));
    } catch (e) {}
  }
  showUndecided.addEventListener("change", function () { save(); apply(); });
  showNotRelevant.addEventListener("change", function () { save(); apply(); });
  search.addEventListener("input", apply);
  apply();
})();
`;

/** The page's view-page registry entry (../view-pages.ts VIEW_PAGES). */
export const RAW_RESEARCH_PAGE: ViewPage = {
  name: "Raw Research",
  css: PAGE_CSS,
  script: PAGE_SCRIPT,
  data: (ctx) => buildRawResearchData(ctx.dbPath, ctx.filing),
};
