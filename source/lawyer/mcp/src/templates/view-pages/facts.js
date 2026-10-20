(function () {
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
