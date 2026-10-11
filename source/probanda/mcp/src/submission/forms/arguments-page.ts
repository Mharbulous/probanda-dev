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

import { submissionDataQuery } from "../backend.js";
import type { ViewPage } from "../view-pages.js";
import type { FilingRow } from "./query.js";
import { fetchOpposingPoints } from "./render-vaniac-submissions.js";
import { VIEW_FOLDER_CSS } from "./view-folder-css.js";

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
export function buildArgumentsData(dbPath: string, filing: FilingRow): ArgumentsData {
  const proceedingId = filing.proceeding_id;
  const submissions = rows<{ id: number; contention: string }>(
    dbPath,
    `SELECT s.id, s.contention FROM submissions s
     LEFT JOIN filing_submissions fs ON fs.submission_id = s.id AND fs.filing_id = ?
     WHERE s.proceeding_id = ? AND s.killed_on IS NULL
     GROUP BY s.id
     ORDER BY MIN(fs.id) IS NULL, MIN(CASE fs.document WHEN 'form' THEN 0 ELSE 1 END),
              MIN(CASE fs.document WHEN 'form' THEN fs.ordinal END), MIN(fs.ordinal), s.ordinal, s.id`,
    [filing.id, proceedingId]
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
    const here = deployedOn.some((d) => d.filing_id === filing.id);
    const elsewhere = deployedOn.map((d) => (d.retired_on === null ? d.title : `${d.title} (retired)`)).join("; ");
    const where = here ? "On this Writing" : deployedOn.length > 0 ? `On ${elsewhere}` : "Held in reserve";
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

const PAGE_CSS = String.raw`
${VIEW_FOLDER_CSS}
.picker{display:inline-flex;flex-wrap:wrap;align-items:center;gap:6px}
.picker input{position:absolute;opacity:0;width:1px;height:1px;margin:0;pointer-events:none}
.picker label{display:grid;place-items:center;box-sizing:border-box;width:26px;height:26px;border-radius:50%;background:#fff;border:1.5px solid #1d5e4a;color:#025056;font-family:var(--sans);font-size:13px;font-weight:600;line-height:1;padding-bottom:1px;font-variant-numeric:tabular-nums;cursor:pointer}
.picker input:checked+label{width:31px;height:31px;background:#a8691c;border-color:#a8691c;color:#fff;font-size:15px;font-weight:800}
.picker input:focus-visible+label{outline:2px solid #1d5e4a;outline-offset:2px}
article.arg{background:var(--card);border:2px solid var(--frame);border-radius:10px;padding:10px 14px;display:flex;flex-direction:column;gap:6px}
.arg>.text{position:relative;font-weight:400;margin:0;padding-bottom:22px;white-space:pre-wrap;cursor:pointer}
.arg>.text::before{content:"▸";display:inline-block;margin-right:6px;color:var(--frame);transition:transform .15s}
.arg.open>.text::before{transform:rotate(90deg)}
.arg>.text:focus-visible{outline:2px solid #1d5e4a;outline-offset:3px;border-radius:4px}
.arg .tag{position:absolute;right:0;bottom:0;padding:1px 9px;border-radius:999px;background:#1d5e4a;color:#fff;font-size:10.5px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;line-height:1.6;white-space:nowrap}
.arg .detail{display:flex;flex-direction:column;gap:6px}
.arg .where,.arg .label,.arg .none{margin:0;font-size:12.5px;color:var(--muted)}
.arg .head{margin:4px 0 0;font-size:17px;font-weight:700}
.arg ul{margin:0;padding-left:20px}
.arg li{margin:2px 0;white-space:pre-wrap}
.arg li.omitted{color:var(--muted);text-decoration:line-through;text-decoration-color:var(--muted)}
.arg .linked{border-top:1px solid var(--line);padding-top:6px}
`;

// Draws window.VIEW_PAGE.data into .board as folder tabs over one panel holding three sections. Each
// section numbers its cards 1..N in page order: a picker of those numbers sits in its heading, the
// selected number's card is the section's one open card, and each card's tag ends its statement with
// the same number. A counter-argument lists the arguments linked to it, so a rebuttal linked to two
// counter-arguments shows under both. One with no link shows no link line.
const PAGE_SCRIPT = String.raw`(function () {
  "use strict";
  var view = window.VIEW_PAGE;
  if (!view) return;
  var data = view.data;
  var board = document.querySelector(".board");
  var KEY = "arguments-filter";

  function el(tag, cls, text) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined) node.textContent = text;
    return node;
  }
  function list(items, cls) {
    var ul = el("ul");
    items.forEach(function (item) { ul.appendChild(el("li", cls ? cls(item) : "", typeof item === "string" ? item : item.text)); });
    return ul;
  }

  var byId = {};
  data.submissions.forEach(function (a) { byId[a.id] = a; });
  var counterByKey = {};
  data.counter_arguments.forEach(function (c) { counterByKey[c.key] = c; });
  var KIND_LABEL = { submission: "Submission", rebuttal: "Rebuttal", raised: "Raised", anticipated: "Anticipated" };

  // A card: its statement, which toggles it and ends in its tag, then its detail.
  function card(cls, kind, text, n) {
    var node = el("article", cls);
    var title = el("p", "text");
    title.setAttribute("role", "button");
    title.tabIndex = 0;
    title.appendChild(el("span", "", text));
    title.appendChild(el("span", "tag", KIND_LABEL[kind] + " #" + n));
    node.appendChild(title);
    var detail = el("div", "detail");
    node.appendChild(detail);
    return { node: node, title: title, detail: detail };
  }
  function argumentCard(a, i) {
    var c = card("arg " + a.kind, a.kind, a.contention, i + 1);
    c.detail.appendChild(el("p", "where", a.where));
    if (a.law.length > 0) {
      c.detail.appendChild(el("p", "head", "Law"));
      c.detail.appendChild(list(a.law.map(function (l) {
        return { text: l.killed_on ? l.text + " (omitted " + l.killed_on + ")" : l.text, omitted: !!l.killed_on };
      }), function (l) { return l.omitted ? "omitted" : ""; }));
    } else {
      c.detail.appendChild(el("p", "none", "No law linked"));
    }
    if (a.facts.length > 0) {
      c.detail.appendChild(el("p", "head", "Facts"));
      c.detail.appendChild(list(a.facts));
    } else {
      c.detail.appendChild(el("p", "none", "No facts linked"));
    }
    if (a.rebuts.length > 0) {
      var linked = el("div", "linked");
      linked.appendChild(el("p", "label", "Linked to counter-arguments"));
      linked.appendChild(list(a.rebuts.map(function (k) { return KIND_LABEL[counterByKey[k].kind] + ": " + counterByKey[k].text; })));
      c.detail.appendChild(linked);
    }
    return c;
  }
  function counterCard(x, i) {
    var c = card("arg counter", x.kind, x.text, i + 1);
    if (x.source) c.detail.appendChild(el("p", "where", x.source));
    if (x.linked.length > 0) {
      var linked = el("div", "linked");
      linked.appendChild(el("p", "label", "Linked arguments"));
      linked.appendChild(list(x.linked.map(function (id) { return KIND_LABEL[byId[id].kind] + ": " + byId[id].contention; })));
      c.detail.appendChild(linked);
    }
    return c;
  }

  var tablist = el("div", "tabs");
  tablist.setAttribute("role", "tablist");
  tablist.setAttribute("aria-label", "Show");
  board.appendChild(tablist);
  var folder = el("div", "folder");
  folder.id = "arguments-panel";
  folder.setAttribute("role", "tabpanel");
  board.appendChild(folder);

  // One section, its picker and its cards. At most one card is open; the picker's selected number
  // is always the open card's, and none is selected when every card is closed.
  var sections = {};
  function section(name, heading, cards) {
    var sec = el("section");
    var h2 = el("h2", "", heading);
    var picker = el("span", "picker");
    picker.setAttribute("role", "radiogroup");
    picker.setAttribute("aria-label", heading + ": open card");
    h2.appendChild(picker);
    sec.appendChild(h2);
    var stack = el("div", "stack");
    sec.appendChild(stack);
    folder.appendChild(sec);
    sections[name] = { node: sec, size: cards.length };

    var current = -1;
    var radios = [];
    function open(index) {
      current = index;
      cards.forEach(function (c, i) {
        var on = i === index;
        c.node.classList.toggle("open", on);
        c.detail.hidden = !on;
        c.title.setAttribute("aria-expanded", String(on));
        radios[i].checked = on;
      });
    }
    cards.forEach(function (c, i) {
      var input = el("input");
      input.type = "radio";
      input.name = "pick-" + name;
      input.id = "pick-" + name + "-" + (i + 1);
      var label = el("label", "", String(i + 1));
      label.htmlFor = input.id;
      picker.appendChild(input);
      picker.appendChild(label);
      radios.push(input);
      input.addEventListener("change", function () { if (input.checked) open(i); });
      label.addEventListener("click", function (e) {
        if (input.checked) { e.preventDefault(); open(-1); }
      });
      input.addEventListener("keydown", function (e) {
        if (e.key === " " && input.checked) { e.preventDefault(); open(-1); }
      });
      c.title.addEventListener("click", function () { open(current === i ? -1 : i); });
      c.title.addEventListener("keydown", function (e) {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(current === i ? -1 : i); }
      });
      stack.appendChild(c.node);
    });
    open(cards.length > 0 ? 0 : -1);
  }
  section("submissions", "Submissions", data.submissions.filter(function (a) { return a.kind === "submission"; }).map(argumentCard));
  section("counter", "Counter-arguments", data.counter_arguments.map(counterCard));
  section("rebuttals", "Rebuttals", data.submissions.filter(function (a) { return a.kind === "rebuttal"; }).map(argumentCard));
  var empty = el("p", "empty", "Nothing recorded under this filter.");
  folder.appendChild(empty);

  var TABS = [["all", "All"], ["submissions", "Submissions"], ["counter", "Counter-arguments"], ["rebuttals", "Rebuttals"]];
  var tabs = TABS.map(function (t) {
    var b = el("button", "", t[1]);
    b.type = "button";
    b.id = "tab-" + t[0];
    b.setAttribute("role", "tab");
    b.setAttribute("aria-controls", folder.id);
    b.setAttribute("data-filter", t[0]);
    tablist.appendChild(b);
    return b;
  });

  var current = "all";
  try {
    var saved = localStorage.getItem(KEY);
    if (TABS.some(function (t) { return t[0] === saved; })) current = saved;
  } catch (e) {}
  function apply() {
    var any = false;
    Object.keys(sections).forEach(function (name) {
      var on = (current === "all" || current === name) && sections[name].size > 0;
      sections[name].node.hidden = !on;
      if (on) any = true;
    });
    tabs.forEach(function (b) {
      var on = b.getAttribute("data-filter") === current;
      b.setAttribute("aria-selected", String(on));
      b.tabIndex = on ? 0 : -1;
      if (on) folder.setAttribute("aria-labelledby", b.id);
    });
    empty.hidden = any;
  }
  function select(b) {
    current = b.getAttribute("data-filter");
    try { localStorage.setItem(KEY, current); } catch (e) {}
    apply();
  }
  tabs.forEach(function (b, i) {
    b.addEventListener("click", function () { select(b); });
    b.addEventListener("keydown", function (e) {
      var step = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
      if (step === 0) return;
      e.preventDefault();
      var next = tabs[(i + step + tabs.length) % tabs.length];
      select(next);
      next.focus();
    });
  });
  apply();
})();
`;

/** The page's view-page registry entry (../view-pages.ts VIEW_PAGES). */
export const ARGUMENTS_PAGE: ViewPage = {
  name: "Arguments",
  css: PAGE_CSS,
  script: PAGE_SCRIPT,
  data: (ctx) => buildArgumentsData(ctx.dbPath, ctx.filing),
};
