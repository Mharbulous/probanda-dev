// The Arguments view page: one `Arguments - Job Board <id>.html` per live Writing, written by the
// view-page registry (../view-pages.ts), listing the submissions and counter-arguments the drafting
// database records for the filing's proceeding in three kinds:
//   submission       -- a live submission deployed by a document of some filing of the proceeding:
//                       this filing's first (the venue form's, then the Written Arguments'), then
//                       those only on another filing.
//   rebuttal         -- a live submission held in reserve: deployed by no document of any filing of
//                       the proceeding (terms-and-symbols.md, Deployment). Derived, never stored.
//   counter-argument -- an opposing point (raised, in a served document) or an anticipated point
//                       (the practitioner's own prediction).
// Each submission and rebuttal shows the facts and propositions of law linked to it. A rebuttal is
// grouped with the counter-arguments it answers by the advisory rebuts links (schema v65), which are
// neither complete nor exhaustive: the page never calls a counter-argument unanswered for want of a
// link, and never reads answered_by_submission_id or its ↩️ marker.
//
// A human interface generated from the database (ADR 0033): no session reads, greps, parses or
// screenshots it. Sessions read submissions through /drafting-data and the mockups.
//
// The page itself is the template set in src/templates/view-pages/ (map #125).

import { composeTemplate } from "../../compose-template.js";
import boardCss from "../../templates/work-board/board.css.js";
import argumentsCss from "../../templates/view-pages/arguments.css.js";
import argumentsHtml from "../../templates/view-pages/arguments.html.js";
import argumentsJs from "../../templates/view-pages/arguments.js.js";
import sharedJs from "../../templates/view-pages/shared.js.js";
import viewFolderCss from "../../templates/view-pages/view-folder.css.js";
import viewHeadHtml from "../../templates/view-pages/view-head.html.js";
import { submissionDataQuery } from "../backend.js";
import type { ViewPage } from "../view-pages.js";
import type { FilingRow } from "./query.js";
import { fetchOpposingPoints } from "./render-vaniac-submissions.js";

export type SubmissionKind = "submission" | "rebuttal";

export interface SubmissionLaw {
  text: string;
  /** The date the practitioner omitted the proposition (v64), or null. */
  killed_on: string | null;
}

export interface PageSubmission {
  id: number;
  kind: SubmissionKind;
  contention: string;
  /** Where it is deployed: "On this Writing", "On <filing title>[ (retired)]", or "Held in reserve". */
  where: string;
  facts: string[];
  law: SubmissionLaw[];
  /** The keys of the counter-arguments it is linked to, in the page's counter-argument order. */
  rebuts: string[];
}

export interface CounterArgument {
  /** `raised:<opposing point id>` or `anticipated:<anticipated point id>`. */
  key: string;
  kind: "raised" | "anticipated";
  text: string;
  /** A raised point's component and pinpoint in the served document; null for an anticipated one. */
  source: string | null;
  /** The ids of the submissions and rebuttals linked to it. */
  linked: number[];
}

export interface ArgumentsData {
  submissions: PageSubmission[];
  counter_arguments: CounterArgument[];
}

function rows<T>(dbPath: string, sql: string, params: unknown[] = []): T[] {
  return submissionDataQuery(dbPath, sql, params).rows as unknown as T[];
}

function tableHeld(dbPath: string, table: string): boolean {
  return rows<{ n: number }>(dbPath, "SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name = ?", [table])[0].n > 0;
}

function columnHeld(dbPath: string, table: string, column: string): boolean {
  return rows<{ n: number }>(dbPath, `SELECT COUNT(*) AS n FROM pragma_table_info('${table}') WHERE name = ?`, [column])[0].n > 0;
}

/** The page's data for one filing, from the drafting database alone. */
export function buildArgumentsData(dbPath: string, filing: FilingRow | FilingRow[]): ArgumentsData {
  // A merged board's page (ADR 0010): each proceeding's arguments read against the board's Writings in it.
  const filings = Array.isArray(filing) ? filing : [filing];
  const out: ArgumentsData = { submissions: [], counter_arguments: [] };
  for (const proceedingId of [...new Set(filings.map((f) => f.proceeding_id))]) {
    const part = argumentsFor(dbPath, proceedingId, filings.filter((f) => f.proceeding_id === proceedingId).map((f) => f.id), filings.length > 1);
    out.submissions.push(...part.submissions);
    out.counter_arguments.push(...part.counter_arguments);
  }
  return out;
}

function argumentsFor(dbPath: string, proceedingId: number, ids: number[], merged: boolean): ArgumentsData {
  const inIds = `(${ids.map(() => "?").join(", ")})`;
  const submissions = rows<{ id: number; contention: string }>(
    dbPath,
    `SELECT s.id, s.contention FROM submissions s
     LEFT JOIN filing_submissions fs ON fs.submission_id = s.id AND fs.filing_id IN ${inIds}
     WHERE s.proceeding_id = ? AND s.killed_on IS NULL
     GROUP BY s.id
     ORDER BY MIN(fs.id) IS NULL, MIN(CASE fs.document WHEN 'form' THEN 0 ELSE 1 END),
              MIN(CASE fs.document WHEN 'form' THEN fs.ordinal END), MIN(fs.ordinal), s.ordinal, s.id`,
    [...ids, proceedingId]
  );
  const deployments = rows<{ submission_id: number; filing_id: number; title: string; retired_on: string | null }>(
    dbPath,
    `SELECT DISTINCT fs.submission_id, f.id AS filing_id, f.title, f.retired_on
     FROM filing_submissions fs JOIN filings f ON f.id = fs.filing_id
     WHERE f.proceeding_id = ?
     ORDER BY f.id`,
    [proceedingId]
  );
  const facts = rows<{ submission_id: number; postulate: string }>(
    dbPath,
    `SELECT sf.submission_id, f.postulate FROM submission_facts sf JOIN facts f ON f.id = sf.fact_id
     WHERE f.proceeding_id = ? ORDER BY f.id`,
    [proceedingId]
  );
  const killedOn = columnHeld(dbPath, "law_assertions", "killed_on") ? "la.killed_on" : "NULL AS killed_on";
  const law = rows<{ submission_id: number; proposition: string; killed_on: string | null }>(
    dbPath,
    `SELECT sl.submission_id, la.proposition, ${killedOn}
     FROM submission_law sl JOIN law_assertions la ON la.id = sl.law_assertion_id
     WHERE la.proceeding_id = ? ORDER BY la.id`,
    [proceedingId]
  );
  // The rebuts links (schema v65); a database below it has none.
  const raisedLinks = tableHeld(dbPath, "submission_rebuts_opposing_points")
    ? rows<{ submission_id: number; point_id: number }>(dbPath, "SELECT submission_id, opposing_point_id AS point_id FROM submission_rebuts_opposing_points")
    : [];
  const anticipatedLinks = tableHeld(dbPath, "submission_rebuts_anticipated_points")
    ? rows<{ submission_id: number; point_id: number }>(dbPath, "SELECT submission_id, anticipated_point_id AS point_id FROM submission_rebuts_anticipated_points")
    : [];
  const links = [
    ...raisedLinks.map((l) => ({ submission_id: l.submission_id, key: `raised:${l.point_id}` })),
    ...anticipatedLinks.map((l) => ({ submission_id: l.submission_id, key: `anticipated:${l.point_id}` })),
  ];

  const live = new Set(submissions.map((s) => s.id));
  const counterArguments: CounterArgument[] = [
    ...fetchOpposingPoints(dbPath, proceedingId).map((p): CounterArgument => ({
      key: `raised:${p.id}`,
      kind: "raised",
      text: p.verbatim_words ?? "(no words recorded)",
      source: [p.component, p.pinpoint].filter((part) => part !== null && part !== "").join(", "),
      linked: [],
    })),
    ...rows<{ id: number; point: string }>(dbPath, "SELECT id, point FROM anticipated_points WHERE proceeding_id = ? ORDER BY id", [proceedingId]).map(
      (p): CounterArgument => ({ key: `anticipated:${p.id}`, kind: "anticipated", text: p.point, source: null, linked: [] })
    ),
  ];
  const counterByKey = new Map(counterArguments.map((c) => [c.key, c]));
  for (const l of links) {
    const counter = counterByKey.get(l.key);
    if (counter !== undefined && live.has(l.submission_id) && !counter.linked.includes(l.submission_id)) counter.linked.push(l.submission_id);
  }
  const counterOrder = new Map(counterArguments.map((c, i) => [c.key, i]));

  const items = submissions.map((s): PageSubmission => {
    const deployedOn = deployments.filter((d) => d.submission_id === s.id);
    const here = deployedOn.filter((d) => ids.includes(d.filing_id));
    const elsewhere = deployedOn.map((d) => (d.retired_on === null ? d.title : `${d.title} (retired)`)).join("; ");
    const where =
      here.length > 0 ? (merged ? `On this board: ${here.map((d) => d.title).join("; ")}` : "On this Writing") : deployedOn.length > 0 ? `On ${elsewhere}` : "Held in reserve";
    return {
      id: s.id,
      kind: deployedOn.length > 0 ? "submission" : "rebuttal",
      contention: s.contention,
      where,
      facts: facts.filter((f) => f.submission_id === s.id).map((f) => f.postulate),
      law: law.filter((l) => l.submission_id === s.id).map((l) => ({ text: l.proposition, killed_on: l.killed_on })),
      rebuts: links
        .filter((l) => l.submission_id === s.id && counterByKey.has(l.key))
        .map((l) => l.key)
        .sort((a, b) => (counterOrder.get(a) ?? 0) - (counterOrder.get(b) ?? 0)),
    };
  });
  return { submissions: items, counter_arguments: counterArguments };
}

// The page's script (arguments.js) draws window.VIEW_PAGE.data into .board as folder tabs over one
// panel holding three sections. Each
// section numbers its cards 1..N in page order: a picker of those numbers sits in its heading, the
// selected number's card is the section's one open card, and each card's tag ends its statement with
// the same number. A counter-argument lists the arguments linked to it, so a rebuttal linked to two
// counter-arguments shows under both. One with no link shows no link line.
/** The page's view-page registry entry (../view-pages.ts VIEW_PAGES). */
export const ARGUMENTS_PAGE: ViewPage = {
  name: "Arguments",
  ...composeTemplate("arguments.html", {
    "arguments.html": argumentsHtml,
    "view-head.html": viewHeadHtml,
    "board.css": boardCss,
    "view-folder.css": viewFolderCss,
    "arguments.css": argumentsCss,
    "shared.js": sharedJs,
    "arguments.js": argumentsJs,
  }),
  data: (ctx) => buildArgumentsData(ctx.dbPath, ctx.writings.map((w) => w.filing)),
};
