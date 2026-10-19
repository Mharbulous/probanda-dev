(function () {
  "use strict";
  var view = window.VIEW_PAGE;
  if (!view) return;
  var data = view.data;
  var api = data.api;
  var base = "http://127.0.0.1:" + api.port;
  var header = document.querySelector("header");
  var board = document.querySelector(".board");
  var statusButtons = [];
  var colour = {};
  data.groups.forEach(function (g) { colour[g.key] = g.colour; });

  function el(tag, cls, text) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function showError(node, message) {
    var line = node.querySelector(".error");
    if (!line) {
      line = el("p", "error");
      node.appendChild(line);
    }
    line.textContent = message;
  }

  // The section an open loose thread belongs under: deferred, else ranked or unranked.
  function home(c) { return c.deferred ? "deferred" : c.idea.rank === null ? "unranked" : "ranked"; }
  function label(c) {
    c.button.textContent = c.deferred ? "Deferred" : c.idea.rank === null ? "Unranked" : "Ranked";
    c.button.title = c.deferred ? "Click to bring back" : "Click to defer";
  }

  function toggleDeferral(c) {
    var button = c.button;
    var failed = c.deferred ? "Not brought back: " : "Not deferred: ";
    button.disabled = true;
    fetch(base + "/seeds/" + c.idea.id + (c.deferred ? "/undefer" : "/defer"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // A page spanning several proceedings posts the thread's own proceeding and its token.
      body: JSON.stringify(c.idea.proceeding_id === undefined
        ? { db_path: api.db_path, proceeding_id: api.proceeding_id, token: api.token }
        : { db_path: api.db_path, proceeding_id: c.idea.proceeding_id, token: api.tokens[String(c.idea.proceeding_id)] })
    }).then(function (res) {
      return res.json().then(function (body) { return { ok: res.ok, body: body }; }, function () { return { ok: false, body: { error: "The listener answered " + res.status + "." } }; });
    }).then(function (reply) {
      button.disabled = false;
      if (reply.ok) {
        var from = sections[home(c)];
        from.cards.splice(from.cards.indexOf(c), 1);
        c.deferred = !c.deferred;
        var to = sections[home(c)];
        to.cards.push(c);
        to.stack.appendChild(c.node);
        label(c);
        apply();
        return;
      }
      showError(c.node, failed + (reply.body.error || reply.body.outcome || "the listener refused it") + ".");
    }, function () {
      button.disabled = false;
      showError(c.node, failed + "the listener did not answer. Buttons need the Claude desktop app running.");
    });
  }

  // A card: its job description, or the idea when it has none, which toggles it and ends in its
  // tags, then its body, which opens with the idea when the job description stood in for it.
  function ideaCard(i) {
    var node = el("article", "idea");
    var text = el("p", "text");
    var body = el("div", "body");
    var button = el("button", "status");
    var c = { node: node, idea: i, text: text, button: button, deferred: !!i.deferred_at, inert: false, open: false };
    c.set = function (on) {
      c.open = on;
      node.setAttribute("data-open", String(on));
      text.setAttribute("aria-expanded", String(on));
      body.hidden = !on;
    };
    button.type = "button";
    button.disabled = true;
    label(c);
    button.addEventListener("click", function () { toggleDeferral(c); });
    node.appendChild(button);
    statusButtons.push(button);
    text.setAttribute("role", "button");
    text.tabIndex = 0;
    text.appendChild(document.createTextNode(i.job || i.idea));
    text.appendChild(document.createTextNode(" "));
    var tags = el("span", "tags");
    var rank = el("span", "tag rank", i.rank === null ? "?" : String(i.rank));
    if (i.rank === null) rank.title = "Unranked";
    tags.appendChild(rank);
    if (i.rank !== null && i.group_label) {
      var group = el("span", "tag group", i.group_label);
      group.setAttribute("style", "--g:" + colour[i.group]);
      tags.appendChild(group);
    }
    text.appendChild(tags);
    node.appendChild(text);
    if (i.job) body.appendChild(el("p", "thought", "Loose thought: " + i.idea));
    if (i.reason) body.appendChild(el("p", "why", i.reason));
    body.appendChild(el("p", "where", "Loose thread " + i.id + " · " + i.surfaced_by + (i.origin ? "; " + i.origin : "")));
    node.appendChild(body);
    text.addEventListener("click", function () { c.set(!c.open); });
    text.addEventListener("keydown", function (e) {
      if (e.key !== "Enter" && e.key !== " ") return;
      e.preventDefault();
      c.set(!c.open);
    });
    c.set(false);
    return c;
  }

  // A resolved thread, as its section's inert card: one line ending in how it left the board. A
  // discarded one is struck, with a Restore link that only copies the instruction to paste into a
  // session; a suggested one and one taken up by a job are plain lines. Discarded and suggested lines
  // carry their date. A job's line names the job only: the thread was either outlined into it or
  // worked inside the loose-threads job, the data does not say which, and no date records either.
  function resolvedLine(d) {
    var date = d.at.slice(0, 10);
    var thread = "Loose thread " + d.id + ":  " + d.idea;
    if (d.how === "suggested") return { node: el("p", "suggested", thread + " *SUGGESTED* Suggested " + date), inert: true };
    if (d.how === "job") return { node: el("p", "suggested", thread + " Taken up by Job #" + d.job_id + ": " + d.job_title), inert: true };
    var line = el("p", "deleted");
    line.appendChild(el("s", "", thread));
    line.appendChild(document.createTextNode(" *DISCARDED* "));
    var restore = el("a", "", "Restore");
    restore.href = "#";
    var instruction = "restore loose thread #" + d.id;
    // Where the clipboard is out of reach, the instruction itself is shown, to select and copy by hand.
    function showInstruction() { restore.textContent = instruction; }
    restore.addEventListener("click", function (event) {
      event.preventDefault();
      if (!navigator.clipboard || !navigator.clipboard.writeText) { showInstruction(); return; }
      navigator.clipboard.writeText(instruction).then(function () {
        restore.textContent = "Copied";
        setTimeout(function () { restore.textContent = "Restore"; }, 1500);
      }, showInstruction);
    });
    line.appendChild(restore);
    line.appendChild(document.createTextNode(" Discarded " + date));
    return { node: line, inert: true };
  }

  var tablist = el("div", "tabs");
  tablist.setAttribute("role", "tablist");
  tablist.setAttribute("aria-label", "Show");
  board.appendChild(tablist);
  var folder = el("div", "folder");
  folder.id = "loose-threads-panel";
  folder.setAttribute("role", "tabpanel");
  board.appendChild(folder);

  // One section: its heading, whatever sits under the heading, and its cards, the first open.
  var sections = {};
  function section(name, heading, under, cards) {
    var sec = el("section");
    var h2 = el("h2", "", heading);
    sec.appendChild(h2);
    under.forEach(function (node) { sec.appendChild(node); });
    var stack = el("div", "stack");
    cards.forEach(function (c) { stack.appendChild(c.node); });
    sec.appendChild(stack);
    folder.appendChild(sec);
    var first = cards.filter(function (c) { return !c.inert; })[0];
    if (first) first.set(true);
    sections[name] = { node: sec, h2: h2, stack: stack, cards: cards };
  }

  // A resolved line, ending in its inert status label.
  function resolvedCard(d) {
    var r = resolvedLine(d);
    r.node.appendChild(el("span", "status", "Resolved"));
    return r;
  }

  var allGroups = true;
  var picked = {};
  data.groups.forEach(function (g) { picked[g.key] = true; });
  var chips = el("div", "chips");
  chips.setAttribute("role", "group");
  chips.setAttribute("aria-label", "Groups");
  chips.hidden = true;
  var chipButtons = data.groups.map(function (g) {
    var b = el("button", "chip");
    b.type = "button";
    b.setAttribute("style", "--g:" + g.colour);
    b.setAttribute("aria-pressed", "true");
    b.appendChild(el("span", "", g.label));
    b.appendChild(el("span", "n", String(g.count)));
    b.addEventListener("click", function () {
      picked[g.key] = !picked[g.key];
      b.setAttribute("aria-pressed", String(picked[g.key]));
      apply();
    });
    chips.appendChild(b);
    return b;
  });
  var noGroups = el("p", "empty", "No groups selected. Choose a group above, or turn on All groups.");
  noGroups.hidden = true;

  var open = data.ideas.filter(function (i) { return !i.deferred_at; });
  var rankedCards = open.filter(function (i) { return i.rank !== null; }).map(ideaCard);
  section("ranked", "Ranked", [chips, noGroups], rankedCards);
  section("unranked", "Unranked", [el("p", "note", "Captured since the last ranking.")], open.filter(function (i) { return i.rank === null; }).map(ideaCard));
  section("deferred", "Deferred", [], data.ideas.filter(function (i) { return !!i.deferred_at; }).map(ideaCard));
  section("resolved", "Resolved", [], data.resolved.map(resolvedCard));
  var empty = el("p", "empty", data.ideas.length === 0 ? "No open loose threads." : "No loose thread under this tab.");
  folder.appendChild(empty);

  var toggle = el("button", "switch");
  toggle.type = "button";
  toggle.setAttribute("role", "switch");
  toggle.setAttribute("aria-checked", "true");
  toggle.appendChild(el("span", "label", "All groups"));
  var track = el("span", "track");
  track.appendChild(el("span", "knob"));
  toggle.appendChild(track);
  var showResolved = false;
  var resolvedToggle = null;
  if (data.resolved.length > 0) {
    resolvedToggle = el("button", "resolved-toggle", "☐ Show/Hide Resolved Threads");
    resolvedToggle.type = "button";
    resolvedToggle.setAttribute("role", "checkbox");
    resolvedToggle.setAttribute("aria-checked", "false");
    resolvedToggle.addEventListener("click", function () {
      showResolved = !showResolved;
      resolvedToggle.textContent = showResolved ? "☑ Show/Hide Resolved Threads" : "☐ Show/Hide Resolved Threads";
      resolvedToggle.setAttribute("aria-checked", String(showResolved));
      apply();
    });
  }
  if (rankedCards.length > 0) {
    if (resolvedToggle) sections.ranked.h2.appendChild(resolvedToggle);
    sections.ranked.h2.appendChild(toggle);
  }

  // The break-out: every chip from a small cluster behind the switch to its place, at once, with
  // the row's height on the same timing. Reversed, the same motion gathers them back.
  var JITTER = [[-6, -3], [5, 2], [-2, 4], [7, -4], [-5, 5], [3, -5], [0, 1]];
  var EASE = "cubic-bezier(.12,.82,.22,1)";
  var running = [];
  function burst(reverse, done) {
    running.forEach(function (a) { a.onfinish = null; a.cancel(); });
    running = [];
    var still = !chips.animate || (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
    if (still) { done(); return; }
    var s = toggle.getBoundingClientRect();
    var sx = s.left + s.width / 2;
    var sy = s.top + s.height / 2;
    var timing = { duration: 780, easing: EASE, direction: reverse ? "reverse" : "normal" };
    running = chipButtons.map(function (b, n) {
      var r = b.getBoundingClientRect();
      var j = JITTER[n % JITTER.length];
      var dx = sx - (r.left + r.width / 2) + j[0];
      var dy = sy - (r.top + r.height / 2) + j[1];
      return b.animate([{ transform: "translate(" + dx + "px," + dy + "px) scale(.85)" }, { transform: "none" }], timing);
    });
    running.push(chips.animate([{ height: "0px" }, { height: chips.offsetHeight + "px" }], timing));
    running[running.length - 1].onfinish = function () { running = []; done(); };
  }
  toggle.addEventListener("click", function () {
    allGroups = !allGroups;
    toggle.setAttribute("aria-checked", String(allGroups));
    if (allGroups) {
      burst(true, function () { chips.hidden = true; });
    } else {
      chips.hidden = false;
      burst(false, function () {});
    }
    apply();
  });

  var TABS = [["all", "All"], ["ranked", "Ranked"], ["unranked", "Unranked"], ["deferred", "Deferred"], ["resolved", "Resolved"]];
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
  // With nothing ranked the Ranked heading is hidden, so the checkbox ends the tab row.
  if (resolvedToggle && rankedCards.length === 0) tablist.appendChild(resolvedToggle);

  var current = "all";
  function apply() {
    // A card deferred from Ranked drops out of the group filter; one brought back rejoins it.
    sections.deferred.cards.forEach(function (c) { c.node.hidden = false; });
    sections.ranked.cards.forEach(function (c) { c.node.hidden = !allGroups && !picked[c.idea.group]; });
    noGroups.hidden = allGroups || data.groups.some(function (g) { return picked[g.key]; });
    var any = false;
    Object.keys(sections).forEach(function (name) {
      var shown = current === name || (current === "all" && (name !== "resolved" || showResolved));
      var on = shown && sections[name].cards.length > 0;
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
    if (resolvedToggle) resolvedToggle.hidden = current !== "all";
  }
  function select(b) {
    current = b.getAttribute("data-filter");
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

  if (statusButtons.length > 0) {
    var abort = new AbortController();
    var timer = setTimeout(function () { abort.abort(); }, 2000);
    fetch(base + "/health", { signal: abort.signal }).then(function (res) {
      return res.ok ? res.json() : null;
    }).then(function (body) {
      clearTimeout(timer);
      if (!body || body.ok !== true) throw new Error("no listener");
      statusButtons.forEach(function (b) { b.disabled = false; });
    }).catch(function () {
      clearTimeout(timer);
      header.appendChild(el("p", "api-off", "Buttons need the Claude desktop app running."));
    });
  }
})();
