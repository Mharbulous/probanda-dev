(function () {
  "use strict";
  var view = window.VIEW_PAGE;
  if (!view) return;
  var data = view.data;
  var board = document.querySelector(".board");
  var TAB_KEY = "legal-research-tab";

  function el(tag, cls, text) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined) node.textContent = text;
    return node;
  }
  function stored(key) {
    try { return JSON.parse(localStorage.getItem(key) || "{}") || {}; } catch (e) { return {}; }
  }
  function store(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) {}
  }
  function searchBox(label) {
    var search = el("input");
    search.type = "search";
    search.placeholder = "Search";
    search.setAttribute("aria-label", label);
    return search;
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
  function versionText(m) {
    return "v" + m.version + (m.earlier.length === 0 ? "" : " (earlier: " + m.earlier.map(function (n) { return "v" + n; }).join(", ") + ")");
  }
  function fileRow(dl, m) {
    var file = m.file.split(/[\\/]/).pop();
    if (m.on_disk) {
      var a = el("a", "", file);
      a.href = m.url;
      row(dl, "File", a, "");
    } else {
      row(dl, "File", file + " (not in the law folder now)", "");
    }
  }
  function ticket(ref, title, chips, line) {
    var node = el("details", "ticket");
    var summary = el("summary");
    summary.appendChild(el("span", "ref", ref));
    summary.appendChild(el("span", "title", title));
    var progress = el("span", "progress");
    chips.forEach(function (c) { progress.appendChild(el("span", "chip " + c[1], c[0])); });
    progress.appendChild(document.createTextNode(line));
    summary.appendChild(progress);
    node.appendChild(summary);
    var body = el("div", "body");
    var dl = el("dl");
    body.appendChild(dl);
    node.appendChild(body);
    return { node: node, dl: dl };
  }

  // Propositions: every one recorded, undecided shown unless the practitioner hid them.
  function drawPropositions(tab) {
    var props = data.propositions;
    var KEY = "legal-research-propositions";
    var counts = el("div", "counts");
    counts.appendChild(el("span", "", "Statements:"));
    [["In use", props.counts.in_use], ["Undecided", props.counts.undecided], ["Not relevant", props.counts.not_relevant]].forEach(function (pair) {
      counts.appendChild(el("span", "", pair[0] + " " + pair[1]));
    });
    tab.appendChild(counts);
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
    var search = searchBox("Search propositions");
    var filters = el("div", "filters");
    filters.appendChild(undecidedBox.label);
    filters.appendChild(notRelevantBox.label);
    filters.appendChild(search);
    tab.appendChild(filters);

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
        var stmt = statementNode(s);
        node.appendChild(stmt);
        return { node: stmt, cls: s.class, text: [s.citation_title || "", s.citation_rest, s.excerpt || ""].join(" ").toLowerCase() };
      });
      if (p.statements.length === 0) node.appendChild(el("p", "linked", "No authority recorded"));
      return { node: node, cls: p.class, text: (p.text || "").toLowerCase(), rows: rows };
    }
    props.groups.forEach(function (g) {
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
      tab.appendChild(sec);
      entries.push({ node: sec, count: count, cards: cards });
    });
    var empty = el("p", "empty", props.groups.length === 0 ? "No propositions of law are recorded for this proceeding." : "Nothing to show with these filters.");
    tab.appendChild(empty);

    var saved = stored(KEY);
    undecidedBox.box.checked = saved.undecided !== false;
    notRelevantBox.box.checked = saved.not_relevant === true;
    function shown(cls) {
      return cls === "in_use" || (cls === "undecided" && undecidedBox.box.checked) || (cls === "not_relevant" && notRelevantBox.box.checked);
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
      store(KEY, { undecided: undecidedBox.box.checked, not_relevant: notRelevantBox.box.checked });
    }
    undecidedBox.box.addEventListener("change", function () { save(); apply(); });
    notRelevantBox.box.addEventListener("change", function () { save(); apply(); });
    search.addEventListener("input", apply);
    apply();
  }

  // Case Briefs: the cases relied on, then the rest. Asking for a brief happens in a session.
  function drawBriefs(tab) {
    var cases = data.briefs.cases;
    var CHIPS = { briefed: ["Briefed", "done"], requested: ["Requested", "wip"], not_briefed: ["Not briefed", ""] };
    tab.appendChild(el("p", "hint", "To request a brief, ask a session, for example: brief the cases this Milestone relies on."));
    if (cases.length === 0) {
      tab.appendChild(el("p", "empty", "The Writings on this Milestone rely on no case yet, and no case brief is saved."));
      return;
    }
    var search = searchBox("Search case briefs");
    var filters = el("div", "filters");
    filters.appendChild(search);
    tab.appendChild(filters);
    function card(c) {
      var chip = CHIPS[c.status];
      var t = ticket(c.brief ? "v" + c.brief.version : "—", c.title, [chip], c.citation || (c.brief && c.brief.date) || "");
      row(t.dl, "Citation", c.citation, "None recorded");
      row(t.dl, "Status", chip[0], "");
      row(t.dl, "Jobs", c.jobs.map(function (j) { return "Job #" + j.id + " " + j.title; }), "None");
      if (c.brief) {
        row(t.dl, "Date", c.brief.date, "No date");
        row(t.dl, "Version", versionText(c.brief), "");
        fileRow(t.dl, c.brief);
      }
      return { node: t.node, text: [c.title, c.citation || ""].join(" ").toLowerCase() };
    }
    var sections = [["Relied on by this Milestone's Writings", true], ["Not relied on by this Milestone's Writings", false]].map(function (s) {
      var list = cases.filter(function (c) { return c.relied_on === s[1]; });
      var sec = el("section");
      var h2 = el("h2", "", s[0] + " ");
      var count = el("span", "count", "0");
      h2.appendChild(count);
      sec.appendChild(h2);
      var stack = el("div", "stack");
      var cards = list.map(function (c) {
        var made = card(c);
        stack.appendChild(made.node);
        return made;
      });
      sec.appendChild(stack);
      tab.appendChild(sec);
      return { node: sec, count: count, cards: cards };
    });
    var none = el("p", "empty", "Nothing to show with this search.");
    tab.appendChild(none);
    function apply() {
      var q = search.value.trim().toLowerCase();
      var any = false;
      sections.forEach(function (sec) {
        var visible = 0;
        sec.cards.forEach(function (c) {
          var on = q === "" || c.text.indexOf(q) !== -1;
          c.node.hidden = !on;
          if (on) visible += 1;
        });
        sec.count.textContent = String(visible);
        sec.node.hidden = visible === 0;
        if (visible > 0) any = true;
      });
      none.hidden = any;
    }
    search.addEventListener("input", apply);
    apply();
  }

  // Legal Memos: the status lanes, with a folder filter, a source filter and a search.
  function drawMemos(tab) {
    var memos = data.memos.memos;
    var KEY = "legal-research-memos";
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
    if (memos.length === 0) {
      tab.appendChild(el("p", "empty", "No legal memo is linked to this Milestone."));
      return;
    }
    function card(m) {
      var lane = LANE[m.status];
      var line = [m.date || "No date", folderName(m)].join(" · ");
      if (m.earlier.length > 0) line += " · " + m.earlier.length + (m.earlier.length === 1 ? " earlier version" : " earlier versions");
      var t = ticket("v" + m.version, m.title, [[lane[1], lane[2]], [SOURCES[m.source], ""]], line);
      t.node.setAttribute("data-status", m.status);
      row(t.dl, "Issue", m.issues, m.jobs.length === 0 ? "No recorded question: no job saved this memo" : "No question recorded");
      row(t.dl, "Facts", m.facts, "No facts recorded");
      row(t.dl, "Status", lane[1], "");
      row(t.dl, "Date", m.date, "No date");
      row(t.dl, "Version", versionText(m), "");
      row(t.dl, "Source", SOURCES[m.source], "");
      row(t.dl, "Folder", folderName(m), "");
      row(t.dl, "Jobs", m.jobs.map(function (j) { return "Job #" + j.id + " " + j.title; }), "None");
      fileRow(t.dl, m);
      return { node: t.node, memo: m, text: [m.title, m.folder, SOURCES[m.source]].concat(m.issues, m.facts).join(" ").toLowerCase() };
    }
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
    var search = searchBox("Search memos");
    var filters = el("div", "filters");
    filters.appendChild(folderBox.label);
    filters.appendChild(sourceBox.label);
    filters.appendChild(search);
    tab.appendChild(filters);

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
      tab.appendChild(sec);
      return { node: sec, count: count, cards: cards, none: none };
    });

    var saved = stored(KEY);
    if (folders.indexOf(saved.folder) !== -1) folderBox.box.value = saved.folder;
    if (SOURCES[saved.source]) sourceBox.box.value = saved.source;
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
      store(KEY, { folder: folderBox.box.value, source: sourceBox.box.value });
    }
    folderBox.box.addEventListener("change", function () { save(); apply(); });
    sourceBox.box.addEventListener("change", function () { save(); apply(); });
    search.addEventListener("input", apply);
    apply();
  }

  // The folder tabs, the last one chosen remembered.
  var TABS = [["propositions", "Propositions", drawPropositions], ["briefs", "Case Briefs", drawBriefs], ["memos", "Legal Memos", drawMemos]];
  var tablist = el("div", "tabs");
  tablist.setAttribute("role", "tablist");
  tablist.setAttribute("aria-label", "Show");
  board.appendChild(tablist);
  var folder = el("div", "folder");
  folder.id = "legal-research-panel";
  folder.setAttribute("role", "tabpanel");
  board.appendChild(folder);
  var built = TABS.map(function (t) {
    var button = el("button", "", t[1]);
    button.type = "button";
    button.id = "tab-" + t[0];
    button.setAttribute("role", "tab");
    button.setAttribute("aria-controls", folder.id);
    tablist.appendChild(button);
    var body = el("div", "tab-body");
    folder.appendChild(body);
    t[2](body);
    return { id: t[0], button: button, body: body };
  });
  var current = TABS[0][0];
  try {
    var saved = localStorage.getItem(TAB_KEY);
    if (TABS.some(function (t) { return t[0] === saved; })) current = saved;
  } catch (e) {}
  function apply() {
    built.forEach(function (b) {
      var on = b.id === current;
      b.body.hidden = !on;
      b.button.setAttribute("aria-selected", String(on));
      b.button.tabIndex = on ? 0 : -1;
      if (on) folder.setAttribute("aria-labelledby", b.button.id);
    });
  }
  function choose(b) {
    current = b.id;
    try { localStorage.setItem(TAB_KEY, current); } catch (e) {}
    apply();
  }
  built.forEach(function (b, i) {
    b.button.addEventListener("click", function () { choose(b); });
    b.button.addEventListener("keydown", function (e) {
      var step = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
      if (step === 0) return;
      e.preventDefault();
      var next = built[(i + step + built.length) % built.length];
      choose(next);
      next.button.focus();
    });
  });
  apply();
})();
