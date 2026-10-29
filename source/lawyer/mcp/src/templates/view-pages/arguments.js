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

  var byId = {};
  data.submissions.forEach(function (a) { byId[a.id] = a; });
  var counterByKey = {};
  data.counter_arguments.forEach(function (c) { counterByKey[c.key] = c; });
  var KIND_LABEL = { submission: "Submission", rebuttal: "Rebuttal", killed: "Killed", raised: "Raised", anticipated: "Anticipated" };

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
  section("killed", "Killed", data.submissions.filter(function (a) { return a.kind === "killed"; }).map(argumentCard));
  var empty = el("p", "empty", "Nothing recorded under this filter.");
  folder.appendChild(empty);

  var TABS = [["all", "All"], ["submissions", "Submissions"], ["counter", "Counter-arguments"], ["rebuttals", "Rebuttals"], ["killed", "Killed"]];
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
