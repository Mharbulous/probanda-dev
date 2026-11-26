// The Arguments view page: one `Arguments - Work Board <id>.html` per live Writing, written by the
// view-page registry (../view-pages.ts), listing the `arguments` rows the drafting database records
// for the filing's proceeding (schema v83) on two tabs:
//   arguments -- every row with no `argument_rebuts` link out, ours, opposing or neutral, by its
//                fixed per-proceeding number (#2).
//   rebuttals -- every row with a link out, labelled under the one row it answers (#2.a, and
//                #1.a.i for a rebuttal of a rebuttal).
// Both are derived from the links, never stored. A killed row stays on its tab, last, in kill-date
// order, so it is never re-proposed. Each card shows its tags ("Held in reserve" for one of ours
// deployed by no document of the proceeding, "Killed <date>", "Anticipated", and "No rebuttal" for a
// live opposing argument no live rebuttal answers), the facts and propositions of law linked to it, and its
// cross-links.
//
// A human interface generated from the database (ADR 0033): no session reads, greps, parses or
// screenshots it. Sessions read submissions through /drafting-data and the mockups.
//
// The page itself is the template set in src/templates/view-pages/ (map #125).

import { templated } from "../../compose-template.js";
import { pageApiPort, pageApiToken } from "../../page-api/token.js";
import boardCss from "../../templates/practice-board/board.css.js";
import argumentsCss from "../../templates/view-pages/arguments.css.js";
import argumentsHtml from "../../templates/view-pages/arguments.html.js";
import argumentsJs from "../../templates/view-pages/arguments.js.js";
import sharedJs from "../../templates/view-pages/shared.js.js";
import viewFolderCss from "../../templates/view-pages/view-folder.css.js";
import viewHeadHtml from "../../templates/view-pages/view-head.html.js";
import type { ViewPage } from "../view-pages.js";
import type { FilingRow } from "./query.js";
import { rows } from "../query-rows.js";
import { hasColumn } from "../schema-capabilities.js";

export type Side = "ours" | "opposing" | "neutral";

export interface SubmissionLaw {
  text: string;
  /** The date the practitioner omitted the proposition (v64), or null. */
  killed_on: string | null;
}

export interface PageCard {
  /** The `arguments` row. */
  id: number;
  /** "#2" for an argument; "#2.a", or "#1.a.i" under a rebuttal, for a rebuttal; "#?" with no number to hang on. */
  label: string;
  /** The argument number the card opens with: its own, or its label's for a rebuttal. Null with none. */
  number: number | null;
  side: Side;
  contention: string;
  /** Where it is deployed ("On this Writing", "On <filing title>[ (retired)]") or, unless deployed,
   * where the other side raised it (component, pinpoint); else null. */
  where: string | null;
  /** "Held in reserve", "Anticipated", "No rebuttal", "Killed <date>". */
  tags: string[];
  killed: boolean;
  facts: string[];
  law: SubmissionLaw[];
  /** The label of the card it answers, or none. */
  rebuts: string[];
  /** Its rebuttals' labels in link order. */
  rebutted_by: string[];
}

export interface ArgumentsData {
  arguments: PageCard[];
  rebuttals: PageCard[];
}

/** The page's data for one filing, from the drafting database alone. */
export function buildArgumentsData(dbPath: string, filing: FilingRow | FilingRow[]): ArgumentsData {
  // A merged board's page (ADR 0010): each proceeding's arguments read against the board's Writings in it.
  const filings = Array.isArray(filing) ? filing : [filing];
  const out: ArgumentsData = { arguments: [], rebuttals: [] };
  for (const proceedingId of [...new Set(filings.map((f) => f.proceeding_id))]) {
    const part = argumentsFor(dbPath, proceedingId, filings.filter((f) => f.proceeding_id === proceedingId).map((f) => f.id), filings.length > 1);
    out.arguments.push(...part.arguments);
    out.rebuttals.push(...part.rebuttals);
  }
  return out;
}

interface ArgumentRow {
  id: number;
  contention: string;
  side: Side;
  number: number | null;
  anticipated: number;
  component: string | null;
  pinpoint: string | null;
  killed_on: string | null;
}

const letter = (i: number): string => String.fromCharCode(97 + (i % 26)).repeat(Math.floor(i / 26) + 1);

function roman(n: number): string {
  const steps: [number, string][] = [[1000, "m"], [900, "cm"], [500, "d"], [400, "cd"], [100, "c"], [90, "xc"], [50, "l"], [40, "xl"], [10, "x"], [9, "ix"], [5, "v"], [4, "iv"], [1, "i"]];
  let out = "";
  for (const [value, digits] of steps) for (; n >= value; n -= value) out += digits;
  return out;
}

function argumentsFor(dbPath: string, proceedingId: number, ids: number[], merged: boolean): ArgumentsData {
  const all = rows<ArgumentRow>(
    dbPath,
    "SELECT id, contention, side, number, anticipated, component, pinpoint, killed_on FROM arguments WHERE proceeding_id = ? ORDER BY id",
    [proceedingId]
  );
  const byId = new Map(all.map((a) => [a.id, a]));
  const links = rows<{ rebuttal_id: number; argument_id: number }>(
    dbPath,
    `SELECT r.rebuttal_id, r.argument_id FROM argument_rebuts r JOIN arguments a ON a.id = r.argument_id
     WHERE a.proceeding_id = ? ORDER BY r.rowid`,
    [proceedingId]
  ).filter((l) => byId.has(l.rebuttal_id));
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
  const killedOn = hasColumn(dbPath, "law_assertions", "killed_on") ? "la.killed_on" : "NULL AS killed_on";
  const law = rows<{ submission_id: number; proposition: string; killed_on: string | null }>(
    dbPath,
    `SELECT sl.submission_id, la.proposition, ${killedOn}
     FROM submission_law sl JOIN law_assertions la ON la.id = sl.law_assertion_id
     WHERE la.proceeding_id = ? ORDER BY la.id`,
    [proceedingId]
  );

  const targetOf = new Map<number, number>();
  const rebuttalsOf = new Map<number, number[]>();
  for (const l of links) {
    targetOf.set(l.rebuttal_id, l.argument_id);
    rebuttalsOf.set(l.argument_id, [...(rebuttalsOf.get(l.argument_id) ?? []), l.rebuttal_id]);
  }

  // A rebuttal's number is its target's. A loop of rebuttals with no argument has none.
  const numberOf = (id: number, seen = new Set<number>()): number | null => {
    const target = targetOf.get(id);
    if (target === undefined) return byId.get(id)?.number ?? null;
    if (seen.has(id)) return null;
    seen.add(id);
    return numberOf(target, seen);
  };
  const labels = new Map<number, { label: string; path: number[] }>();
  const labelOf = (id: number, seen = new Set<number>()): { label: string; path: number[] } => {
    const known = labels.get(id);
    if (known !== undefined) return known;
    let out: { label: string; path: number[] };
    const n = numberOf(id);
    const parent = targetOf.get(id);
    if (parent === undefined) out = { label: n === null ? "#?" : `#${n}`, path: [] };
    else if (seen.has(id)) out = { label: "#?", path: [] };
    else {
      seen.add(id);
      const base = labelOf(parent, seen);
      const i = (rebuttalsOf.get(parent) ?? []).indexOf(id);
      out = { label: `${base.label}.${base.path.length % 2 === 0 ? letter(i) : roman(i + 1)}`, path: [...base.path, i] };
    }
    labels.set(id, out);
    return out;
  };
  const byNumber = (a: number, b: number): number => {
    const x = numberOf(a);
    const y = numberOf(b);
    return x === y ? 0 : x === null ? 1 : y === null ? -1 : x - y;
  };

  const card = (a: ArgumentRow): PageCard => {
    const deployedOn = deployments.filter((d) => d.submission_id === a.id);
    const here = deployedOn.filter((d) => ids.includes(d.filing_id));
    const elsewhere = deployedOn.map((d) => (d.retired_on === null ? d.title : `${d.title} (retired)`)).join("; ");
    const source = [a.component, a.pinpoint].filter((part) => part !== null && part !== "").join(", ");
    const where =
      here.length > 0 ? (merged ? `On this board: ${here.map((d) => d.title).join("; ")}` : "On this Writing") : deployedOn.length > 0 ? `On ${elsewhere}` : source || null;
    const rebuttals = rebuttalsOf.get(a.id) ?? [];
    const tags: string[] = [];
    if (a.side === "ours" && a.killed_on === null && deployedOn.length === 0) tags.push("Held in reserve");
    if (a.anticipated === 1) tags.push("Anticipated");
    if (a.side === "opposing" && a.killed_on === null && !targetOf.has(a.id) && !rebuttals.some((r) => byId.get(r)?.killed_on === null)) tags.push("No rebuttal");
    if (a.killed_on !== null) tags.push(`Killed ${a.killed_on}`);
    return {
      id: a.id,
      label: labelOf(a.id).label,
      number: numberOf(a.id),
      side: a.side,
      contention: a.contention,
      where,
      tags,
      killed: a.killed_on !== null,
      facts: facts.filter((f) => f.submission_id === a.id).map((f) => f.postulate),
      law: law.filter((l) => l.submission_id === a.id).map((l) => ({ text: l.proposition, killed_on: l.killed_on })),
      rebuts: targetOf.has(a.id) ? [labelOf(targetOf.get(a.id) as number).label] : [],
      rebutted_by: rebuttals.map((r) => labelOf(r).label),
    };
  };
  // Live cards first, by number and then label; killed ones last, in kill-date order.
  const order = (x: ArgumentRow, y: ArgumentRow): number => {
    if ((x.killed_on === null) !== (y.killed_on === null)) return x.killed_on === null ? -1 : 1;
    if (x.killed_on !== null && y.killed_on !== null && x.killed_on !== y.killed_on) return x.killed_on < y.killed_on ? -1 : 1;
    const byN = byNumber(x.id, y.id);
    if (byN !== 0) return byN;
    const px = labelOf(x.id).path;
    const py = labelOf(y.id).path;
    for (let i = 0; i < Math.min(px.length, py.length); i++) if (px[i] !== py[i]) return px[i] - py[i];
    return px.length - py.length || x.id - y.id;
  };
  const sorted = [...all].sort(order);
  return {
    arguments: sorted.filter((a) => !targetOf.has(a.id)).map(card),
    rebuttals: sorted.filter((a) => targetOf.has(a.id)).map(card),
  };
}

// The page's script (arguments.js) draws window.VIEW_PAGE.data into .board as two folder tabs,
// Arguments and Rebuttals. A picker of the card labels in each tab's heading lists only the selected
// card. One open number is shared by both tabs: opening Argument #2 opens Rebuttals #2.a, #2.b and
// #2.a.i on the other tab, and the reverse.
/** The page's view-page registry entry (../view-pages.ts VIEW_PAGES). */
export const ARGUMENTS_PAGE: ViewPage = {
  name: "Arguments",
  ...templated({
    entry: "arguments.html",
    files: {
      "arguments.html": argumentsHtml,
      "view-head.html": viewHeadHtml,
      "board.css": boardCss,
      "view-folder.css": viewFolderCss,
      "arguments.css": argumentsCss,
      "shared.js": sharedJs,
      "arguments.js": argumentsJs,
    },
  }),
  // The listener the page asks which card a session pointed it at (../../page-api/focus.ts).
  data: (ctx) => ({
    ...buildArgumentsData(ctx.dbPath, ctx.writings.map((w) => w.filing)),
    api: {
      port: pageApiPort(),
      db_path: ctx.dbPath,
      proceeding_id: ctx.proceeding.id,
      token: pageApiToken(ctx.dbPath, ctx.proceeding.id),
      filing_ids: ctx.writings.map((w) => w.filing.id),
    },
  }),
};
