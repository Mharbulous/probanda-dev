// The Work Board: Work Board.html, one self-contained file beside practice.db, showing the open work
// of every matter in the practice (billable or not) in four panels: Overdue, Due today, Coming up,
// then Other open work. Written only by practice_data__render_practice_board, which joins the deadline
// lane, so no drafting session ever writes or presents it. Its internal name is practice_board, never
// Work_board (the Job Board's document type).
//
// No model reads this file (shared/html-pages.md). Practice data enters only through
// renderPracticeBoardHtml's one data line. The page draws stored dates only: it derives no deadline
// and prints no day count. A provisional alternative, a review-flagged deadline and a conflicted date
// draw flagged, as an unconfirmed date, never as a plain due date. A to-do's BF date draws as a plain
// label (ADR 0021 D2). Built from the board design template (BOARD_CSS).

import { BOARD_CSS } from "./board-template.js";

export const PRACTICE_BOARD_FILE = "Work Board.html";

/** On the page's root element. The overwrite guard recognises this server's own page by it. */
export const PRACTICE_BOARD_MARKER = "data-practice-board-shell";

/** One card: a deadline, an event (an anchor) or a to-do, with its matter. */
export interface PracticeBoardItem {
  kind: "deadline" | "event" | "todo";
  label: string;
  /** The stored date the item is placed by, or null for an undated to-do. */
  date: string | null;
  /** Set when the date is not a confirmed date: a provisional alternative, a review flag, a conflict. */
  flag: string | null;
  /** A to-do's BF date, a start date drawn as a plain label. */
  bf_date: string | null;
  matter: string;
  client: string;
  matter_status: string | null;
  billable: boolean;
}

export interface PracticeBoardData {
  meta: { rendered: string; today: string; horizon_days: number };
  panels: {
    overdue: PracticeBoardItem[];
    due_today: PracticeBoardItem[];
    coming_up: PracticeBoardItem[];
    other: PracticeBoardItem[];
  };
  /** Why a read failed; drawn above the panels. A failed read is never drawn as nothing due. */
  notes: string[];
  conflicted: number;
  excluded_test_matters: number;
}

const PRACTICE_CSS = String.raw`
ul.items{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:10px}
li.item{background:var(--card);border:2px solid var(--frame);border-radius:10px;padding:10px 14px;display:flex;flex-direction:column;gap:4px}
li.item .head{display:flex;flex-wrap:wrap;align-items:baseline;gap:4px 12px}
li.item .label{font-weight:500}
li.item .date,li.item .bf{font-family:var(--mono);font-size:12px;color:var(--muted)}
li.item .flag{font-size:12px;font-weight:600;color:var(--accent);border:1px solid var(--accent);border-radius:999px;padding:0 8px}
li.item.flagged{border-color:var(--accent)}
li.item .line{margin:0;font-size:13px;color:var(--muted)}
header p.alert{margin:8px 0 0;padding:6px 10px;border:2px solid var(--accent);border-radius:8px;color:var(--accent);font-weight:600;font-size:13.5px}
p.note{margin:0 0 12px;color:var(--accent);font-size:13.5px}
footer{margin:18px 0 0;font-size:12px;color:var(--muted)}
`;

const HEAD = String.raw`<!doctype html>
<html lang="en" ${PRACTICE_BOARD_MARKER}>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Work Board</title>
<style>
${BOARD_CSS}${PRACTICE_CSS}</style>
</head>
<body>
<main>
  <header>
    <h1>Work Board</h1>
    <div class="meta"></div>
  </header>
  <div class="board"></div>
  <footer></footer>
</main>
<script>
`;

const TAIL = String.raw`</script>
<script>
(function () {
  "use strict";
  var data = window.PRACTICE_BOARD;
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
  var metaRow = header.querySelector(".meta");
  [["Today", meta.today], ["Rendered", meta.rendered]].forEach(function (pair) {
    var span = el("span", "", pair[1]);
    span.setAttribute("data-k", pair[0]);
    metaRow.appendChild(span);
  });
  if (data.conflicted > 0) {
    header.appendChild(el("p", "alert", data.conflicted === 1
      ? "1 conflicted date: ask the docket clerk to resolve it."
      : data.conflicted + " conflicted dates: ask the docket clerk to resolve them."));
  }
  data.notes.forEach(function (note) { board.appendChild(el("p", "note", note)); });

  var KIND = { deadline: "Due", event: "Event", todo: "To-do due" };

  function item(i) {
    var li = el("li", i.flag ? "item flagged" : "item");
    var head = el("div", "head");
    head.appendChild(el("span", "label", i.label));
    if (i.flag) {
      head.appendChild(el("span", "flag", i.flag));
      if (i.date !== null) head.appendChild(el("span", "date", "Unconfirmed date " + i.date));
    } else if (i.date !== null) {
      head.appendChild(el("span", "date", KIND[i.kind] + " " + i.date));
    }
    if (i.bf_date !== null) head.appendChild(el("span", "bf", "BF " + i.bf_date));
    li.appendChild(head);
    var line = el("p", "line");
    var parts = [i.matter, i.client];
    parts.forEach(function (part, n) {
      if (n > 0) line.appendChild(document.createTextNode(" · "));
      line.appendChild(el("span", "", part));
    });
    if (i.matter_status) {
      line.appendChild(document.createTextNode(" · "));
      line.appendChild(el("span", "chip", i.matter_status.replace(/_/g, " ")));
    }
    if (!i.billable) {
      line.appendChild(document.createTextNode(" · "));
      line.appendChild(el("span", "chip", "Non-billable"));
    }
    li.appendChild(line);
    return li;
  }

  function section(id, heading, items, emptyText) {
    var sec = el("section");
    sec.id = id;
    var h2 = el("h2", "", heading + " ");
    h2.appendChild(el("span", "count", String(items.length)));
    sec.appendChild(h2);
    if (items.length === 0) {
      sec.appendChild(el("p", "empty", emptyText));
    } else {
      var ul = el("ul", "items");
      items.forEach(function (i) { ul.appendChild(item(i)); });
      sec.appendChild(ul);
    }
    board.appendChild(sec);
  }

  var p = data.panels;
  section("overdue", "Overdue", p.overdue, "Nothing recorded as overdue.");
  section("due-today", "Due today", p.due_today, "Nothing recorded as due today.");
  section("coming-up", "Coming up — next " + meta.horizon_days + " days", p.coming_up, "Nothing recorded in the next " + meta.horizon_days + " days.");
  section("other", "Other open work", p.other, "No other open work recorded.");

  var foot = "Every matter in the practice, billable or not. Met and dismissed deadlines and events that have occurred are not shown.";
  if (data.excluded_test_matters > 0) foot += " " + data.excluded_test_matters + (data.excluded_test_matters === 1 ? " matter" : " matters") + " with status 'test' left out.";
  else foot += " Matters with status 'test' are left out.";
  document.querySelector("footer").textContent = foot;
})();
</script>
</body>
</html>
`;

/** The data line starts at column 0 and every `<` is escaped, so no recorded text can close the script. */
export function renderPracticeBoardHtml(data: PracticeBoardData): string {
  return `${HEAD}window.PRACTICE_BOARD = ${JSON.stringify(data).replace(/</g, "\\u003c")};\n${TAIL}`;
}
