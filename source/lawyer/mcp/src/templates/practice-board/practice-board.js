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
