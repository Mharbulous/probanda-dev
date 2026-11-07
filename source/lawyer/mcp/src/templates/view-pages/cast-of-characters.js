// Cast of Characters: everything is in the markup and tabs, cards and Show former work in CSS.
// This script only adds search, the Side and Flags filters, the Esc key, the remembered tab and
// the copy buttons (spec 4.4). It writes nothing but the clipboard and one localStorage key.
(function () {
  "use strict";
  var KEY = "cast-of-characters-tab";
  var q = document.getElementById("q");
  var side = document.getElementById("side");
  var flag = document.getElementById("flag");
  var former = document.getElementById("former");
  var none = document.getElementById("o-none");

  function fold(text) {
    // The same fold as cast-data.ts, which folded each card's data-search.
    return text.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase()
      .replace(/['’-]/g, "").replace(/[^\p{L}\p{N}@.]+/gu, " ").trim();
  }

  function filter() {
    var t = fold(q.value), s = side.value, f = flag.value, showFormer = former.checked;
    document.querySelectorAll(".view section").forEach(function (sec) {
      var n = 0;
      sec.querySelectorAll(".card").forEach(function (c) {
        var ok = (!t || c.getAttribute("data-search").indexOf(t) !== -1) &&
          (!s || c.getAttribute("data-side") === s) &&
          (!f || c.getAttribute("data-flags").split(" ").indexOf(f) !== -1);
        c.classList.toggle("hidebyfilter", !ok);
        if (ok && (showFormer || !c.classList.contains("former"))) n++;
      });
      sec.querySelector(".badge").textContent = String(n);
      sec.querySelector(".none").hidden = n > 0;
    });
  }
  [q, side, flag, former].forEach(function (el) { el.addEventListener("input", filter); el.addEventListener("change", filter); });

  document.addEventListener("keydown", function (e) { if (e.key === "Escape") none.checked = true; });

  var tabs = document.querySelectorAll(".tabr");
  try {
    var saved = localStorage.getItem(KEY);
    tabs.forEach(function (r) { if (r.id === saved) r.checked = true; });
  } catch (e) {}
  tabs.forEach(function (r) {
    r.addEventListener("change", function () {
      none.checked = true;
      try { localStorage.setItem(KEY, r.id); } catch (e) {}
    });
  });

  // A copy button copies its data-copy text; where the clipboard is refused it shows the text instead.
  document.querySelectorAll("button[data-copy]").forEach(function (b) {
    var label = b.textContent;
    var text = b.getAttribute("data-copy");
    function show() { b.textContent = text; }
    b.addEventListener("click", function (event) {
      event.preventDefault();
      event.stopPropagation();
      if (!navigator.clipboard || !navigator.clipboard.writeText) { show(); return; }
      navigator.clipboard.writeText(text).then(function () {
        b.textContent = "Copied";
        setTimeout(function () { b.textContent = label; }, 1500);
      }, show);
    });
  });

  filter();
})();
