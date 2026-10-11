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

function provableFactsData(ctx: ViewPageContext): ProvableFactsData {
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
    facts: facts.map((f, i): PageFact => {
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
      return { position: i + 1, text: f.postulate, class: cls, basis, links: pageLinks };
    }),
  };
}

const CSS = String.raw`
.controls{display:flex;flex-direction:column;gap:8px}
.controls .counts{margin:0;font-size:13px;display:flex;flex-wrap:wrap;gap:4px 16px}
.controls .counts span::before{content:attr(data-k) " ";color:var(--muted)}
.controls label{display:flex;align-items:center;gap:8px;font-size:13.5px;cursor:pointer}
p.note{margin:0 0 12px;font-size:13px;color:var(--muted)}
ul.facts{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:10px}
li.fact{background:var(--card);border:2px solid var(--frame);border-radius:10px;padding:10px 14px;display:flex;flex-direction:column;gap:6px}
li.fact .head{display:flex;gap:10px;align-items:baseline}
li.fact .num{font-family:var(--mono);font-size:12px;color:var(--muted);min-width:2.5em}
li.fact .basis{margin:0 0 0 calc(2.5em + 10px);font-size:13px;color:var(--muted)}
ul.evidence{list-style:none;margin:0 0 0 calc(2.5em + 10px);padding:0;display:flex;flex-direction:column;gap:2px;font-size:13px}
ul.evidence .chip{font-family:var(--mono);font-size:11px;border:1px solid var(--line-strong);border-radius:999px;padding:0 6px;margin-left:6px;color:var(--muted)}
ul.evidence .flag{color:var(--accent);cursor:help;margin-left:6px}
ul.evidence .decision{display:block;color:var(--deleted)}
li.fact[data-class="pending"]{opacity:.5;border-style:dashed}
li.fact[data-class="inadmissible"] .text{text-decoration:line-through}
.board:not(.show-pending) li.fact[data-class="pending"],.board:not(.show-inadmissible) li.fact[data-class="inadmissible"]{display:none}
`;

const SCRIPT = String.raw`(function () {
  "use strict";
  var view = window.VIEW_PAGE;
  if (!view) return;
  var data = view.data;
  var board = document.querySelector(".board");
  var KEY = "coclerk.provable-facts.filters";

  function el(tag, cls, text) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  var counts = { provable: 0, pending: 0, inadmissible: 0 };
  data.facts.forEach(function (f) { counts[f["class"]] += 1; });

  var saved = {};
  try { saved = JSON.parse(localStorage.getItem(KEY) || "{}") || {}; } catch (e) { saved = {}; }

  var controls = el("section", "controls");
  var countRow = el("p", "counts");
  [
    ["Provable", counts.provable],
    ["Not yet in evidence", counts.pending],
    ["Inadmissible evidence only", counts.inadmissible]
  ].forEach(function (pair) {
    var span = el("span", "", String(pair[1]));
    span.setAttribute("data-k", pair[0]);
    countRow.appendChild(span);
  });
  controls.appendChild(countRow);
  board.appendChild(controls);

  var list = el("section");
  var h2 = el("h2", "", "Facts ");
  h2.appendChild(el("span", "count", String(data.facts.length)));
  list.appendChild(h2);
  list.appendChild(el("p", "note", "In the order the Writing states the facts."));
  var EVIDENCE_NOTES = {
    never_rendered: "This Writing has not been rendered yet, so no evidence shows as in hand.",
    changed_since: "The matter's data has changed since this Writing was last rendered, so no evidence shows as in hand until it is rendered again."
  };
  if (data.evidence !== "read") list.appendChild(el("p", "note", EVIDENCE_NOTES[data.evidence]));
  var empty = el("p", "empty", "");
  var ul = el("ul", "facts");

  var STATES = { in_hand: "in hand", pending: "not yet in hand", inadmissible: "inadmissible" };
  data.facts.forEach(function (f) {
    var li = el("li", "fact");
    li.setAttribute("data-class", f["class"]);
    var head = el("div", "head");
    head.appendChild(el("span", "num", f.position + "."));
    head.appendChild(el("span", "text", f.text));
    li.appendChild(head);
    if (f.basis !== null) li.appendChild(el("p", "basis", f.basis));
    if (f.links.length > 0) {
      var ev = el("ul", "evidence");
      f.links.forEach(function (l) {
        var item = el("li", "", l.cite === null ? l.witness : l.witness + ": " + l.cite);
        if (l.state !== null) item.appendChild(el("span", "chip", STATES[l.state]));
        if (l.concern) {
          var flag = el("span", "flag", "⚑ admissibility concern");
          flag.setAttribute("title", l.concern);
          item.appendChild(flag);
        }
        if (l.decided_on !== null) item.appendChild(el("span", "decision", "Recorded inadmissible on " + l.decided_on + (l.decision ? ": " + l.decision : "")));
        ev.appendChild(item);
      });
      li.appendChild(ev);
    }
    ul.appendChild(li);
  });
  list.appendChild(ul);
  list.appendChild(empty);
  board.appendChild(list);

  function apply() {
    var shown = counts.provable + (board.classList.contains("show-pending") ? counts.pending : 0) + (board.classList.contains("show-inadmissible") ? counts.inadmissible : 0);
    empty.textContent = data.facts.length === 0 ? "This Writing uses no facts." : "No fact to show. Tick a box above to show the others.";
    empty.hidden = shown > 0;
  }

  [
    ["pending", "Show facts not yet in evidence"],
    ["inadmissible", "Show facts with only inadmissible evidence"]
  ].forEach(function (pair) {
    var label = el("label");
    var box = document.createElement("input");
    box.type = "checkbox";
    box.checked = saved[pair[0]] === true;
    board.classList.toggle("show-" + pair[0], box.checked);
    box.addEventListener("change", function () {
      board.classList.toggle("show-" + pair[0], box.checked);
      saved[pair[0]] = box.checked;
      try { localStorage.setItem(KEY, JSON.stringify(saved)); } catch (e) { /* the page works without it */ }
      apply();
    });
    label.appendChild(box);
    label.appendChild(document.createTextNode(pair[1]));
    controls.appendChild(label);
  });
  apply();
})();
`;

export const PROVABLE_FACTS: ViewPage = { name: "Provable Facts", css: CSS, script: SCRIPT, data: provableFactsData };
