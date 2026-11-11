// The time review page's script (build plan slice 7). The page is read-only: it steps through the
// cards the server rendered, filters them and swaps screenshots. It draws nothing from a model.
// nextId is pure, so a test can load this file and call it.

/** The id of the item the step reaches from `currentId`, or null. `items` is in time order, each
 * { id, date, matter, flagged }. Only items that pass the filter count: a matter ("" is all) and,
 * when `flaggedOnly`, the flagged ones. `currentId` need not pass the filter. `step` is 1 or -1. */
function nextId(items, currentId, matter, flaggedOnly, step) {
  var at = -1;
  for (var i = 0; i < items.length; i += 1) {
    if (items[i].id === currentId) at = i;
  }
  var pass = function (item) {
    return (matter === "" || item.matter === matter) && (!flaggedOnly || item.flagged);
  };
  if (step > 0) {
    for (var j = at + 1; j < items.length; j += 1) if (pass(items[j])) return items[j].id;
  } else {
    for (var k = (at < 0 ? items.length : at) - 1; k >= 0; k -= 1) if (pass(items[k])) return items[k].id;
  }
  return null;
}

/** The first item on `date` that passes the matter filter, or null. */
function firstOnDate(items, date, matter) {
  for (var i = 0; i < items.length; i += 1) {
    if (items[i].date === date && (matter === "" || items[i].matter === matter)) return items[i].id;
  }
  return null;
}

if (typeof document !== "undefined") {
  (function () {
    var items = JSON.parse(document.getElementById("review-index").textContent);
    var cards = {};
    Array.prototype.forEach.call(document.querySelectorAll(".card"), function (el) {
      cards[el.getAttribute("data-id")] = el;
    });
    var picker = document.getElementById("date-picker");
    var filter = document.getElementById("matter-filter");
    var note = document.getElementById("nav-note");
    var current = null;

    function show(id) {
      if (id === null) {
        note.textContent = "No further block matches.";
        return;
      }
      note.textContent = "";
      if (current !== null) cards[current].hidden = true;
      current = id;
      cards[id].hidden = false;
      var date = cards[id].getAttribute("data-date");
      if (picker.value !== date) picker.value = date;
      slide(cards[id], 0);
      window.scrollTo(0, 0);
    }

    function slide(card, delta) {
      var shots = card.querySelectorAll(".shot");
      if (shots.length === 0) return;
      var at = 0;
      for (var i = 0; i < shots.length; i += 1) if (!shots[i].hidden) at = i;
      var to = Math.max(0, Math.min(shots.length - 1, at + delta));
      for (var j = 0; j < shots.length; j += 1) shots[j].hidden = j !== to;
      var counter = card.querySelector(".shot-count");
      if (counter) counter.textContent = to + 1 + " of " + shots.length;
    }

    function matter() {
      return filter.value;
    }

    document.getElementById("prev").addEventListener("click", function () {
      show(nextId(items, current, matter(), false, -1));
    });
    document.getElementById("next").addEventListener("click", function () {
      show(nextId(items, current, matter(), false, 1));
    });
    document.getElementById("next-flagged").addEventListener("click", function () {
      show(nextId(items, current, matter(), true, 1));
    });
    picker.addEventListener("change", function () {
      show(firstOnDate(items, picker.value, matter()));
    });
    filter.addEventListener("change", function () {
      var onFilter = current !== null && (matter() === "" || cards[current].getAttribute("data-matter") === matter());
      if (!onFilter) show(firstOnDate(items, picker.value, matter()) || nextId(items, null, matter(), false, 1));
    });
    Array.prototype.forEach.call(document.querySelectorAll(".shot-prev"), function (b) {
      b.addEventListener("click", function () {
        slide(b.closest(".card"), -1);
      });
    });
    Array.prototype.forEach.call(document.querySelectorAll(".shot-next"), function (b) {
      b.addEventListener("click", function () {
        slide(b.closest(".card"), 1);
      });
    });
    document.addEventListener("keydown", function (event) {
      if (current === null || event.target.tagName === "SELECT") return;
      if (event.key === "ArrowLeft") slide(cards[current], -1);
      if (event.key === "ArrowRight") slide(cards[current], 1);
    });

    if (items.length > 0) show(items[0].id);
  })();
}
