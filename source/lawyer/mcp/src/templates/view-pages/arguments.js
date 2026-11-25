(function () {
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
  function links(label, items) {
    var linked = el("div", "linked");
    linked.appendChild(el("p", "label", label));
    linked.appendChild(list(items));
    return linked;
  }

  // One open number for both tabs: a card opens with every card of its number on either tab. A card
  // with no number opens alone.
  function keyOf(a) { return a.number !== null ? "n" + a.number : "id" + a.id; }
  var openKey = null;
  var allCards = [];
  function setOpen(key) {
    openKey = key;
    allCards.forEach(function (c) {
      var on = c.key === key;
      c.node.classList.toggle("open", on);
      c.detail.hidden = !on;
      c.title.setAttribute("aria-expanded", String(on));
    });
  }

  // A card: its statement, which toggles it and ends in its tags, then its detail.
  function card(a, noun) {
    var node = el("article", "arg " + a.side + (a.killed ? " killed" : ""));
    var title = el("p", "text");
    title.setAttribute("role", "button");
    title.tabIndex = 0;
    title.appendChild(el("span", "", a.contention));
    var tags = el("span", "tags");
    tags.appendChild(el("span", "tag", noun + " " + a.label));
    a.tags.forEach(function (t) { tags.appendChild(el("span", "tag flag", t)); });
    title.appendChild(tags);
    node.appendChild(title);
    var detail = el("div", "detail");
    node.appendChild(detail);
    if (a.where) detail.appendChild(el("p", "where", a.where));
    if (a.law.length > 0) {
      detail.appendChild(el("p", "head", "Law"));
      detail.appendChild(list(a.law.map(function (l) {
        return { text: l.killed_on ? l.text + " (omitted " + l.killed_on + ")" : l.text, omitted: !!l.killed_on };
      }), function (l) { return l.omitted ? "omitted" : ""; }));
    } else {
      detail.appendChild(el("p", "none", "No law linked"));
    }
    if (a.facts.length > 0) {
      detail.appendChild(el("p", "head", "Facts"));
      detail.appendChild(list(a.facts));
    } else {
      detail.appendChild(el("p", "none", "No facts linked"));
    }
    if (a.rebuts.length > 0) detail.appendChild(links("Rebuts", a.rebuts));
    if (a.rebutted_by.length > 0) detail.appendChild(links("Rebuttals", a.rebutted_by));
    var c = { node: node, title: title, detail: detail, key: keyOf(a), number: a.number };
    function toggle() { setOpen(openKey === c.key ? null : c.key); }
    title.addEventListener("click", toggle);
    title.addEventListener("keydown", function (e) {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(); }
    });
    allCards.push(c);
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

  // One tab's section, its picker and its cards. The picker's selected label lists that card alone,
  // and none selected lists them all.
  var sections = {};
  function section(name, heading, items, noun, note) {
    var cards = items.map(function (a) { return card(a, noun); });
    var sec = el("section");
    var h2 = el("h2", "", heading);
    if (note) h2.appendChild(el("span", "count", note));
    var picker = el("span", "picker");
    picker.setAttribute("role", "radiogroup");
    picker.setAttribute("aria-label", heading + ": show card");
    h2.appendChild(picker);
    sec.appendChild(h2);
    var stack = el("div", "stack");
    sec.appendChild(stack);
    folder.appendChild(sec);
    var radios = [];
    function filter(index) {
      cards.forEach(function (c, i) { c.node.hidden = index >= 0 && i !== index; });
    }
    // A session's pointer (focus): every card listed, that number opened.
    function show(number) {
      var first = cards.filter(function (c) { return c.number === number; })[0];
      if (!first) return false;
      radios.forEach(function (r) { r.checked = false; });
      filter(-1);
      setOpen(first.key);
      first.node.scrollIntoView({ block: "start" });
      return true;
    }
    sections[name] = { node: sec, size: cards.length, show: show };
    cards.forEach(function (c, i) {
      var input = el("input");
      input.type = "radio";
      input.name = "pick-" + name;
      input.id = "pick-" + name + "-" + (i + 1);
      radios.push(input);
      var label = el("label", "", items[i].label.replace("#", ""));
      label.htmlFor = input.id;
      picker.appendChild(input);
      picker.appendChild(label);
      function clear(e) { e.preventDefault(); input.checked = false; filter(-1); }
      input.addEventListener("change", function () { if (input.checked) filter(i); });
      label.addEventListener("click", function (e) { if (input.checked) clear(e); });
      input.addEventListener("keydown", function (e) { if (e.key === " " && input.checked) clear(e); });
      stack.appendChild(c.node);
    });
  }
  var unanswered = data.arguments.filter(function (a) { return a.tags.indexOf("No rebuttal") >= 0; }).length;
  section("arguments", "Arguments", data.arguments, "Argument", unanswered + " with no rebuttal");
  section("rebuttals", "Rebuttals", data.rebuttals, "Rebuttal", null);
  setOpen(null);
  var empty = el("p", "empty", "Nothing recorded on this tab.");
  folder.appendChild(empty);

  var TABS = [["arguments", "Arguments"], ["rebuttals", "Rebuttals"]];
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

  var current = "arguments";
  try {
    var saved = localStorage.getItem(KEY);
    if (TABS.some(function (t) { return t[0] === saved; })) current = saved;
  } catch (e) {}
  function apply() {
    Object.keys(sections).forEach(function (name) { sections[name].node.hidden = name !== current; });
    tabs.forEach(function (b) {
      var on = b.getAttribute("data-filter") === current;
      b.setAttribute("aria-selected", String(on));
      b.tabIndex = on ? 0 : -1;
      if (on) folder.setAttribute("aria-labelledby", b.id);
    });
    empty.hidden = sections[current].size > 0;
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

  // A session can point this page at an argument number (drafting_forms__focus_view_page): the page
  // asks the data server's listener every 2 s and moves to each new pointer. A pointer older than 30 s
  // when the page opens is old news and left alone. Without the listener the page stays as it is.
  var api = data.api;
  if (!api) return;
  var seen = null;
  var first = true;
  function poll() {
    fetch("http://127.0.0.1:" + api.port + "/focus", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ db_path: api.db_path, proceeding_id: api.proceeding_id, token: api.token, filing_ids: api.filing_ids })
    }).then(function (res) { return res.ok ? res.json() : null; }).then(function (body) {
      var f = body && body.focus;
      var fresh = !first || (f && Date.now() - Date.parse(f.at) < 30000);
      first = false;
      if (!f || f.id === seen) return;
      seen = f.id;
      var s = sections[f.section];
      if (!fresh || !s) return;
      var tab = tabs.filter(function (b) { return b.getAttribute("data-filter") === f.section; })[0];
      if (s.show(f.number)) select(tab);
    }).catch(function () {}).then(function () { setTimeout(poll, 2000); });
  }
  poll();
})();
