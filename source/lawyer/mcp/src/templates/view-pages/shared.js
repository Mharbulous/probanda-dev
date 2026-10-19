(function () {
  "use strict";
  var view = window.VIEW_PAGE;
  if (!view) return;
  var meta = view.meta;
  if (meta.filing !== "") document.title = view.name + " — " + meta.filing;
  var row = document.querySelector("header .meta");
  [
    ["Writing", meta.filing],
    ["Matter", meta.matter],
    ["Client", meta.client],
    ["Rev", String(meta.revision)]
  ].concat(view.extra || [], [["Rendered", meta.rendered]]).forEach(function (pair) {
    if (pair[1] === "") return;
    var span = document.createElement("span");
    span.textContent = pair[1];
    span.setAttribute("data-k", pair[0]);
    row.appendChild(span);
  });
})();
