(function () {
  "use strict";
  var view = window.VIEW_PAGE;
  if (!view) return;
  var memos = view.data.memos;
  var header = document.querySelector("header");
  var board = document.querySelector(".board");
  var KEY = "legal-memos-filters";

  function el(tag, cls, text) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  // The lanes, in board order, each with the Milestone's chip for its state.
  var LANES = [
    ["in_progress", "In Progress", "wip"],
    ["started", "Started", ""],
    ["completed", "Completed", "done"],
    ["shelved", "Shelved", ""],
    ["no_job", "No job", ""]
  ];
  var LANE = {};
  LANES.forEach(function (l) { LANE[l[0]] = l; });
  var SOURCES = { research_memo: "Research memo", westlaw: "Westlaw Deep Research report", note_up: "Note-up record" };
  var TOP = "Top of 6. LAW";

  function folderName(m) { return m.folder === "" ? TOP : m.folder; }
  function versionText(m) {
    return "v" + m.version + (m.earlier.length === 0 ? "" : " (earlier: " + m.earlier.map(function (n) { return "v" + n; }).join(", ") + ")");
  }

  function row(dl, label, value, none) {
    dl.appendChild(el("dt", "", label));
    var dd = el("dd");
    if (value === null || (Array.isArray(value) && value.length === 0)) {
      dd.className = "none";
      dd.textContent = none;
    } else if (Array.isArray(value)) {
      var ul = el("ul");
      value.forEach(function (v) { ul.appendChild(el("li", "", v)); });
      dd.appendChild(ul);
    } else if (typeof value === "string") {
      dd.textContent = value;
    } else {
      dd.appendChild(value);
    }
    dl.appendChild(dd);
  }

  function card(m) {
    var lane = LANE[m.status];
    var node = el("details", "ticket");
    node.setAttribute("data-status", m.status);
    var summary = el("summary");
    summary.appendChild(el("span", "ref", "v" + m.version));
    summary.appendChild(el("span", "title", m.title));
    var progress = el("span", "progress");
    progress.appendChild(el("span", "chip " + lane[2], lane[1]));
    progress.appendChild(el("span", "chip", SOURCES[m.source]));
    progress.appendChild(document.createTextNode([m.date || "No date", folderName(m)].join(" · ")));
    if (m.earlier.length > 0) progress.appendChild(document.createTextNode(" · " + m.earlier.length + (m.earlier.length === 1 ? " earlier version" : " earlier versions")));
    summary.appendChild(progress);
    node.appendChild(summary);

    var body = el("div", "body");
    var dl = el("dl");
    row(dl, "Issue", m.issues, m.jobs.length === 0 ? "No recorded question: no job saved this memo" : "No question recorded");
    row(dl, "Facts", m.facts, "No facts recorded");
    row(dl, "Status", lane[1], "");
    row(dl, "Date", m.date, "No date");
    row(dl, "Version", versionText(m), "");
    row(dl, "Source", SOURCES[m.source], "");
    row(dl, "Folder", folderName(m), "");
    row(dl, "Jobs", m.jobs.map(function (j) { return "Job #" + j.id + " " + j.title; }), "None");
    var file = m.file.split(/[\\/]/).pop();
    if (m.on_disk) {
      var a = el("a", "", file);
      a.href = m.url;
      row(dl, "File", a, "");
    } else {
      row(dl, "File", file + " (not in the law folder now)", "");
    }
    body.appendChild(dl);
    node.appendChild(body);
    var text = [m.title, m.folder, SOURCES[m.source]].concat(m.issues, m.facts).join(" ").toLowerCase();
    return { node: node, memo: m, text: text };
  }

  // The filters: a folder, a source and a search, kept between visits.
  function select(label, options) {
    var wrap = el("label", "", label + " ");
    var box = el("select");
    options.forEach(function (o) {
      var opt = el("option", "", o[1]);
      opt.value = o[0];
      box.appendChild(opt);
    });
    wrap.appendChild(box);
    return { label: wrap, box: box };
  }
  var folders = [];
  memos.forEach(function (m) { if (folders.indexOf(folderName(m)) === -1) folders.push(folderName(m)); });
  folders.sort();
  var folderBox = select("Folder", [["", "All folders"]].concat(folders.map(function (f) { return [f, f]; })));
  var sourceBox = select("Source", [["", "All sources"]].concat(Object.keys(SOURCES).map(function (k) { return [k, SOURCES[k]]; })));
  var search = el("input");
  search.type = "search";
  search.placeholder = "Search";
  search.setAttribute("aria-label", "Search memos");
  var filters = el("div", "filters");
  filters.appendChild(folderBox.label);
  filters.appendChild(sourceBox.label);
  filters.appendChild(search);
  if (memos.length > 0) header.appendChild(filters);

  var empty = el("p", "empty", "No legal memo is linked to this Milestone.");
  if (memos.length === 0) {
    board.appendChild(empty);
    return;
  }

  var lanes = LANES.map(function (l) {
    var sec = el("section");
    sec.id = l[0].replace("_", "-");
    var h2 = el("h2", "", l[1] + " ");
    var count = el("span", "count", "0");
    h2.appendChild(count);
    sec.appendChild(h2);
    var stack = el("div", "stack");
    var cards = memos.filter(function (m) { return m.status === l[0]; }).map(function (m) {
      var c = card(m);
      stack.appendChild(c.node);
      return c;
    });
    sec.appendChild(stack);
    var none = el("p", "empty");
    sec.appendChild(none);
    board.appendChild(sec);
    return { node: sec, count: count, cards: cards, none: none };
  });

  try {
    var saved = JSON.parse(localStorage.getItem(KEY) || "{}");
    if (folders.indexOf(saved.folder) !== -1) folderBox.box.value = saved.folder;
    if (SOURCES[saved.source]) sourceBox.box.value = saved.source;
  } catch (e) {}

  function apply() {
    var q = search.value.trim().toLowerCase();
    var folder = folderBox.box.value;
    var source = sourceBox.box.value;
    lanes.forEach(function (lane) {
      var visible = 0;
      lane.cards.forEach(function (c) {
        var on = (folder === "" || folderName(c.memo) === folder) && (source === "" || c.memo.source === source) && (q === "" || c.text.indexOf(q) !== -1);
        c.node.hidden = !on;
        if (on) visible += 1;
      });
      lane.count.textContent = String(visible);
      lane.none.hidden = visible > 0;
      lane.none.textContent = folder === "" && source === "" && q === "" ? "None." : "Nothing here under these filters.";
    });
  }
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify({ folder: folderBox.box.value, source: sourceBox.box.value })); } catch (e) {}
  }
  folderBox.box.addEventListener("change", function () { save(); apply(); });
  sourceBox.box.addEventListener("change", function () { save(); apply(); });
  search.addEventListener("input", apply);
  apply();
})();
