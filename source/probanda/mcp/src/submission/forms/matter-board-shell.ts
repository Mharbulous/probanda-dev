// The Litigation Strategy (ADR 0021; the Matter Board of #583, #585): Litigation Strategy.html, one self-contained
// file at the top of a matter's 0. DRAFT folder. Like the Job Board (workboard-shell.ts) its
// stylesheet, its data and its script are all inline, so it draws completely as a lone chat file
// card (#551, ADR 0015's 2026-09-15 amendment). The page's code is identical for every matter; only
// the data line differs.
//
// No model reads this file. Matter data enters only through renderMatterBoardHtml's one data line.
// A to-do's BF date draws as a plain date: no day count, no overdue marking, no reason for its
// position (ADR 0021 D2).
//
// Live status (#589, ADR 0015's 2026-09-15 amendment) is the page's one sibling file:
// workboard-status.js, written by the background render job beside this page. The page injects it
// with a ?t= cache-buster (#587) every 2 s while the job runs. The first failed load -- a lone copy
// in a chat file card, or a page no job has written beside -- stops polling for good and hides the
// indicator, so a copy is a snapshot. No status is ever inlined here: its updated_at would be stale
// on arrival and trip the stall guard.

import type { MatterBoardData } from "./render-matter-board.js";
import { WORKBOARD_CSS } from "./workboard-assets.js";

export const MATTER_BOARD_FILE = "Litigation Strategy.html";

/** On the page's root element. The overwrite guard recognises this server's own page by it. */
export const MATTER_BOARD_MARKER = "data-matter-board-shell";

const MATTER_CSS = String.raw`
ul.todos{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:10px}
li.todo{background:var(--card);border:2px solid var(--frame);border-radius:10px;padding:10px 14px;display:flex;flex-direction:column;gap:4px}
li.todo .head{display:flex;flex-wrap:wrap;align-items:baseline;gap:4px 12px}
li.todo .description{font-weight:500}
li.todo .bf{font-family:var(--mono);font-size:12px;color:var(--muted)}
li.todo .line{margin:0;font-size:13px;color:var(--muted)}
article.filing{background:var(--card);border:2px solid var(--frame);border-radius:10px;padding:10px 14px;font-size:13.5px}
.name{font-weight:600}
.line .name{font-weight:500}
.mockups,.jobs{color:var(--muted)}
details.retired{background:var(--card);border:1px solid var(--line);border-radius:10px;opacity:.7}
details.retired>summary{cursor:pointer;padding:12px 14px}
details.retired>p{margin:0;padding:0 14px 12px;font-size:13px;color:var(--muted)}
header .job{display:flex;align-items:center;gap:8px;margin:6px 0 0;font-size:13px;color:var(--muted)}
header .job[hidden]{display:none}
header .job.stalled{color:var(--accent)}
header .job .spinner{width:10px;height:10px;border:2px solid var(--line);border-top-color:var(--ink);border-radius:50%;animation:job-spin 1s linear infinite}
@keyframes job-spin{to{transform:rotate(360deg)}}
`;

const HEAD = String.raw`<!doctype html>
<html lang="en" ${MATTER_BOARD_MARKER}>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Litigation Strategy</title>
<style>
${WORKBOARD_CSS}${MATTER_CSS}</style>
</head>
<body>
<main>
  <header>
    <h1>Litigation Strategy</h1>
    <div class="meta"></div>
    <p class="job" hidden></p>
  </header>
  <div class="board"></div>
</main>
<script>
`;

const TAIL = String.raw`</script>
<script>
(function () {
  "use strict";
  var data = window.MATTER_BOARD;
  var header = document.querySelector("header");
  var board = document.querySelector(".board");

  function el(tag, cls, text) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  if (!data) return;

  var meta = data.meta;
  if (meta.matter !== "") document.title = "Litigation Strategy — " + meta.matter;
  var metaRow = header.querySelector(".meta");
  [
    ["Matter", meta.matter],
    ["Client", meta.client],
    ["Rev", String(meta.revision)],
    ["Rendered", meta.rendered]
  ].forEach(function (pair) {
    if (pair[1] === "") return;
    var span = el("span", "", pair[1]);
    span.setAttribute("data-k", pair[0]);
    metaRow.appendChild(span);
  });

  var MOCKUPS = { fresh: "Mockups ready", stale: "Mockups need re-rendering", never: "Mockups not yet rendered" };

  function proceedingLine(p) {
    return [p.proceeding.court_or_centre, p.proceeding.file_number].filter(function (part) { return part; }).join(" ");
  }
  function jobs(n) {
    return n === 0 ? "No jobs in progress" : n === 1 ? "1 job in progress" : n + " jobs in progress";
  }

  // One line (ADR 0021 D3): name · lifecycle state · mockup status · jobs in progress. The same
  // line is drawn under a to-do that points at the filing or proceeding (D5).
  function fill(node, parts) {
    parts.forEach(function (part, i) {
      if (i > 0) node.appendChild(document.createTextNode(" · "));
      node.appendChild(el("span", part[0], part[1]));
    });
    return node;
  }
  function filingParts(f) {
    var parts = [["name", f.title], ["chip", f.state_since === null ? f.state_label : f.state_label + " " + f.state_since]];
    if (f.render_state) parts.push(["mockups", MOCKUPS[f.render_state]]);
    if (f.in_progress !== undefined) parts.push(["jobs", jobs(f.in_progress)]);
    return parts;
  }
  function proceedingParts(p) {
    var where = proceedingLine(p);
    return [["name", "Proceeding " + p.proceeding_id + (where === "" ? "" : " (" + where + ")")], ["chip", p.state_label], ["jobs", jobs(p.in_progress)]];
  }

  function filingLine(f) {
    var line = fill(el("article", "filing"), filingParts(f));
    line.setAttribute("data-filing-id", String(f.filing_id));
    return line;
  }
  function preFilingLine(p) {
    var line = fill(el("article", "filing"), proceedingParts(p));
    line.setAttribute("data-proceeding-id", String(p.proceeding_id));
    return line;
  }

  function todoItem(t) {
    var li = el("li", "todo");
    li.setAttribute("data-todo-id", t.id);
    var head = el("div", "head");
    head.appendChild(el("span", "description", t.description));
    if (t.bf_date !== null) head.appendChild(el("span", "bf", "BF " + t.bf_date));
    li.appendChild(head);
    var filing = t.filing_id === undefined ? null : data.filings.filter(function (f) { return f.filing_id === t.filing_id; })[0];
    var proceeding = t.proceeding_id === undefined ? null : data.pre_filing.filter(function (p) { return p.proceeding_id === t.proceeding_id; })[0];
    if (filing) {
      var line = fill(el("p", "line"), filingParts(filing));
      line.setAttribute("data-filing-id", String(filing.filing_id));
      li.appendChild(line);
    } else if (proceeding) {
      li.appendChild(fill(el("p", "line"), proceedingParts(proceeding)));
    }
    return li;
  }

  function retiredCard(f) {
    var card = el("details", "retired");
    card.setAttribute("data-filing-id", String(f.filing_id));
    card.appendChild(el("summary", "", f.title));
    // A Job Board with no Writing is closed, never retired, and prints no reason.
    card.appendChild(el("p", "", f.job_only ? "Closed " + f.retired_on : "Retired " + f.retired_on + (f.retirement_reason ? " — " + f.retirement_reason.replace(/_/g, " ") : "")));
    return card;
  }

  function section(id, heading, count, body) {
    var sec = el("section");
    sec.id = id;
    var h2 = el("h2", "", heading + " ");
    h2.appendChild(el("span", "count", String(count)));
    sec.appendChild(h2);
    sec.appendChild(body);
    board.appendChild(sec);
  }
  function stack(cards, emptyText) {
    if (cards.length === 0) return el("p", "empty", emptyText);
    var div = el("div", "stack");
    cards.forEach(function (c) { div.appendChild(c); });
    return div;
  }

  var todos = el("ul", "todos");
  data.todos.forEach(function (t) { todos.appendChild(todoItem(t)); });
  section("todos", "To-dos", data.todos.length, data.todos.length > 0 ? todos : el("p", "empty", data.todos_note || "No open to-dos for this matter."));

  // A Job Board with no Writing is no Writing: it is counted and drawn in a section of its own.
  var writings = data.filings.filter(function (f) { return !f.job_only; });
  var live = writings.filter(function (f) { return !f.retired_on; });
  var jobBoards = data.filings.filter(function (f) { return f.job_only && !f.retired_on; });
  var retired = data.filings.filter(function (f) { return f.retired_on; });
  section("filings", "Writings", live.length, stack(live.map(filingLine), writings.length === 0 ? "No Writings in this matter." : "No live Writings."));
  if (jobBoards.length > 0) section("job-boards", "Job Boards", jobBoards.length, stack(jobBoards.map(filingLine), ""));
  if (data.pre_filing.length > 0) section("pre-filing", "Before filing", data.pre_filing.length, stack(data.pre_filing.map(preFilingLine), ""));
  if (retired.length > 0) section("retired", "Retired", retired.length, stack(retired.map(retiredCard), ""));

  // Live status from the background render job (#589). See the file header for the rules.
  var STALLED = "Rendering may have stalled — re-open the session to retry";
  var job = header.querySelector(".job");
  var boardMs = (function (m) {
    return m ? new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]).getTime() : 0;
  })(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})/.exec(meta.rendered));
  var tag = null;

  function showJob(text, stalled) {
    job.textContent = "";
    if (!stalled) job.appendChild(el("span", "spinner"));
    job.appendChild(document.createTextNode(text));
    job.className = stalled ? "job stalled" : "job";
    job.hidden = false;
  }
  // A filing's line and every to-do line pointing at it carry the same mockup status.
  function mark(id, text) {
    board.querySelectorAll('[data-filing-id="' + id + '"] .mockups').forEach(function (span) { span.textContent = text; });
  }
  function apply(s) {
    // A status older than this board says nothing about it: the board was written after the job.
    if (Date.parse(s.updated_at) > boardMs) {
      s.done.forEach(function (id) { mark(id, MOCKUPS.fresh); });
      s.failed.forEach(function (f) { mark(f.filing_id, "Mockups failed to render"); });
    }
    if (s.state === "running") {
      var finished = s.done.length + s.failed.length;
      var total = finished + s.queued.length + (s.current === null ? 0 : 1);
      if (Date.now() - Date.parse(s.updated_at) > s.stall_after_ms) showJob(STALLED, true);
      else showJob("Rendering mockups — " + finished + " of " + total, false);
      setTimeout(poll, 2000);
    } else if (s.state === "aborted") {
      showJob(STALLED, true);
    } else {
      job.hidden = true;
    }
  }
  function poll() {
    if (tag) tag.remove();
    window.WORKBOARD_STATUS = undefined;
    tag = document.createElement("script");
    tag.onload = function () {
      if (window.WORKBOARD_STATUS) apply(window.WORKBOARD_STATUS);
    };
    tag.onerror = function () {
      job.hidden = true;
    };
    tag.src = "workboard-status.js?t=" + Date.now();
    document.body.appendChild(tag);
  }
  poll();
})();
</script>
</body>
</html>
`;

/** The data line starts at column 0 with meta.revision as its first key, and every `<` is escaped
 * so no filing title or to-do description can close the script. */
export function renderMatterBoardHtml(data: MatterBoardData): string {
  return `${HEAD}window.MATTER_BOARD = ${JSON.stringify(data).replace(/</g, "\\u003c")};\n${TAIL}`;
}
