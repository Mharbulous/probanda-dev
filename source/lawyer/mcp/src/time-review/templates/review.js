// The time review page's script (build plan slices 7 and 8). It steps through the cards the server
// rendered, filters them, swaps screenshots, and posts the Approve, Correct and Write off clicks to
// the page's own listener, which saves the act to the block. It draws nothing from a model.
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
    var clearBadge = document.getElementById("day-clear");
    var clear = JSON.parse(document.getElementById("review-clear").textContent);
    var base = location.pathname.replace(/\/?$/, "/");
    var current = null;

    function showClear() {
      var date = current === null ? picker.value : cards[current].getAttribute("data-date");
      var isClear = clear[date] === true;
      clearBadge.textContent = isClear ? "This day is clear" : "This day is not clear";
      clearBadge.className = isClear ? "day-clear is-clear" : "day-clear";
    }

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
      showClear();
      window.scrollTo(0, 0);
    }

    function find(card, cls) {
      return card.querySelector("." + cls);
    }

    /** Posts one click. On success the page is reloaded at the same block, so it shows what was saved. */
    function post(card, body, then) {
      var message = find(card, "act-note");
      message.textContent = "";
      fetch(base + "click", { method: "POST", body: JSON.stringify(body) })
        .then(function (res) {
          return res.json().then(function (json) {
            return { ok: res.ok, json: json };
          });
        })
        .then(function (result) {
          if (!result.ok) {
            message.textContent = result.json.error || "The click was not saved.";
            return;
          }
          then();
        })
        .catch(function () {
          message.textContent = "The click could not be sent. Is the session still open?";
        });
    }

    function reloadAt(id) {
      location.hash = id;
      location.reload();
    }

    /** Refreshes what the session writes after a click (the TimeCamp line) and each day's clear mark. */
    function refresh() {
      fetch(base + "state")
        .then(function (res) {
          return res.ok ? res.json() : null;
        })
        .then(function (state) {
          if (!state) return;
          Object.keys(state.blocks).forEach(function (id) {
            var card = cards[id];
            if (!card) return;
            var line = find(card, "tc-text");
            line.textContent = state.blocks[id].timecamp_text;
            line.className = "tc-text " + state.blocks[id].timecamp_class;
          });
          clear = state.clear;
          showClear();
        })
        .catch(function () {});
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
      var tag = event.target.tagName;
      if (current === null || tag === "SELECT" || tag === "INPUT" || tag === "TEXTAREA") return;
      if (event.key === "ArrowLeft") slide(cards[current], -1);
      if (event.key === "ArrowRight") slide(cards[current], 1);
    });

    Object.keys(cards).forEach(function (id) {
      var card = cards[id];
      var correct = find(card, "edit-correct");
      var writeoff = find(card, "edit-writeoff");
      find(card, "act-approve").addEventListener("click", function () {
        post(card, { act: "approve", block: id }, function () {
          reloadAt(id);
        });
      });
      find(card, "act-correct-open").addEventListener("click", function () {
        writeoff.hidden = true;
        correct.hidden = !correct.hidden;
      });
      find(card, "act-writeoff-open").addEventListener("click", function () {
        correct.hidden = true;
        writeoff.hidden = !writeoff.hidden;
      });
      find(card, "correct-cancel").addEventListener("click", function () {
        correct.hidden = true;
      });
      find(card, "writeoff-cancel").addEventListener("click", function () {
        writeoff.hidden = true;
      });
      find(card, "correct-save").addEventListener("click", function () {
        post(
          card,
          {
            act: "correct",
            block: id,
            matter: find(card, "f-matter").value,
            description: find(card, "f-description").value,
            start: find(card, "f-start").value,
            end: find(card, "f-end").value,
          },
          function () {
            reloadAt(id);
          }
        );
      });
      find(card, "writeoff-save").addEventListener("click", function () {
        post(card, { act: "write_off", block: id, reason: find(card, "f-reason").value }, function () {
          reloadAt(id);
        });
      });
    });

    var wanted = decodeURIComponent(location.hash.replace(/^#/, ""));
    if (items.length > 0) show(cards[wanted] ? wanted : items[0].id);
    setInterval(refresh, 3000);
  })();
}
