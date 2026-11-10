// Characters: everything is in the markup, and tabs and cards work in CSS. This script only adds
// the Esc key, the remembered tab and the copy buttons (spec 4.4). It writes nothing but the
// clipboard and one localStorage key.
(function () {
  "use strict";
  var KEY = "cast-of-characters-tab";
  var none = document.getElementById("o-none");

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
})();
