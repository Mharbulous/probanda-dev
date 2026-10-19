(function () {
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
