(function () {
  var cards = document.querySelectorAll("details.ticket, details.seed");
  var reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  var printing = null;
  function centre(d) {
    requestAnimationFrame(function () {
      d.scrollIntoView({ block: "center", inline: "nearest", behavior: reduce ? "auto" : "smooth" });
    });
  }
  cards.forEach(function (d) {
    d.addEventListener("toggle", function () {
      if (!d.open || printing) return;
      cards.forEach(function (o) { if (o !== d && o.open) o.open = false; });
      centre(d);
    });
  });
  function openHash() {
    var t = location.hash && document.querySelector(location.hash);
    if (t && t.matches("details")) t.open = true;
  }
  addEventListener("hashchange", openHash);
  // CSS cannot show a closed card's body, so printing opens every card and afterprint puts each back.
  // The shared name attribute lets the browser keep only one card open, so it is lifted meanwhile.
  addEventListener("beforeprint", function () {
    printing = Array.prototype.map.call(document.querySelectorAll("details.ticket, details.seed, details.goal, details.items"), function (d) {
      var was = [d, d.open, d.getAttribute("name")];
      d.removeAttribute("name");
      d.open = true;
      return was;
    });
  });
  addEventListener("afterprint", function () {
    if (!printing) return;
    printing.forEach(function (p) { p[0].open = p[1]; });
    // Names go back only once the open cards are down to their old state, or the browser would close some.
    printing.forEach(function (p) { if (p[2] !== null) p[0].setAttribute("name", p[2]); });
    printing = null;
  });
  openHash();
})();
