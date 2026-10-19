(function () {
  "use strict";
  var data = JSON.parse(document.getElementById("hk-data").textContent);
  var P = data.proposal, A = data.approval, GROUPS = data.groups, INFO = data.info;
  var APPROVED = "Approved. You can go back to Claude.";
  var base = location.pathname.replace(/\/+$/, "");
  var approved = !!A;
  var state = {}, views = [], app = document.getElementById("app");
  var head, banner = null;

  function el(tag, props, kids) {
    var node = document.createElement(tag);
    if (props) Object.keys(props).forEach(function (k) {
      if (k === "text") node.textContent = props[k];
      else if (k === "className") node.className = props[k];
      else node.setAttribute(k, props[k]);
    });
    (kids || []).forEach(function (kid) { if (kid) node.appendChild(typeof kid === "string" ? document.createTextNode(kid) : kid); });
    return node;
  }
  function baseName(p) { var s = p.split(/[\\/]/); return s[s.length - 1]; }
  // The folder part of a matter-relative path, with its trailing separator, or "" at the root.
  function folderOf(p) { var i = Math.max(p.lastIndexOf("\\"), p.lastIndexOf("/")); return i < 0 ? "" : p.slice(0, i + 1); }
  function count(s) { return P.rows.filter(function (r) { return r.section === s; }).length; }
  // A stuck or misfiled row is shown for information only: nothing to approve on it.
  function informational(kind) { return INFO.indexOf(kind) >= 0; }
  function two(n) { return (n < 10 ? "0" : "") + n; }
  function stamp(iso) {
    var d = new Date(iso);
    if (isNaN(d)) return iso;
    return d.getFullYear() + "-" + two(d.getMonth() + 1) + "-" + two(d.getDate()) + " " + two(d.getHours()) + ":" + two(d.getMinutes());
  }

  function header() {
    var h = P.header;
    function meta(label, value) { return el("span", { "data-k": label, text: String(value) }); }
    head = el("header", null, [
      el("h1", { text: "Housekeeping approvals" }),
      el("div", { className: "meta" }, [
        meta("matter", P.matter_root.split(/[\\/]/).filter(Boolean).pop()),
        meta("run", stamp(P.created_at)),
        meta("to decide", decidable.length),
        meta("ingested, nothing to approve", count("ingested_only")),
        meta("left for the next run", count("deferred"))
      ])
    ]);
    if (h.finished_line) head.appendChild(el("p", { className: "note", text: h.finished_line }));
    if (h.open_in_word.length) head.appendChild(el("p", { className: "note", text: "Open in Word, skipped this run: " + h.open_in_word.join(", ") }));
    if (h.folders_not_looked_inside.length) head.appendChild(el("p", { className: "note", text: "Folders not looked inside: " + h.folders_not_looked_inside.join(", ") }));
    app.appendChild(head);
  }
  function showBanner() { if (!banner) banner = head.appendChild(el("div", { className: "banner", text: APPROVED })); }

  // The file where it is now: a subfolder file's folder in bold, then its name as a link that opens it.
  function src(r) {
    var dir = folderOf(r.current_path);
    return el("div", { className: "src" }, [
      dir ? el("span", { className: "dir", text: dir }) : null,
      el("a", { href: base + "/file/" + encodeURIComponent(r.row_id), target: "_blank", rel: "noopener", text: baseName(r.current_path) })
    ]);
  }

  // The arrow and the one proposed result (spec §B7.5): no verb word, folders and TRASH and the
  // other matter bold, names normal weight; then the short notes that change what Approve does.
  function to(r) {
    var a = r.action, parts;
    function arrow(kids) { return [el("span", { className: "verb" }), el("span", { className: "tgt" }, kids)]; }
    function bold(text) { return el("span", { className: "dest-f", text: text }); }
    function name(text) { return el("span", { className: "nn", text: text }); }
    if (a.kind === "file") parts = arrow([el("span", { className: "dir", text: a.folder + "\\" }), name(a.name)]);
    else if (a.kind === "rename") parts = arrow([name(a.name)]);
    else if (a.kind === "move") parts = arrow([bold(a.folder)]);
    else if (a.kind === "draft") parts = arrow([bold(P.draft_folder)]);
    else if (a.kind === "duplicate") parts = arrow([bold("TRASH")]);
    else if (a.kind === "misfiled") parts = arrow([bold("client matter " + a.matter)]);
    else if (a.kind === "unreadable") parts = [el("span", { className: "verb solo", text: "TRY AGAIN NEXT RUN" })];
    else parts = [el("span", { className: "verb solo", text: "LEAVE WHERE IT IS" }), el("span", { className: "why", text: a.reason })];
    var notes = [];
    if (a.create_folder) notes.push("new folder");
    if (a.file_no_ingest) notes.push("filed without reading it into the case database");
    if (a.answer) notes.push("read in with the answer: " + a.answer);
    if (a.final) notes.push("read in first");
    notes.forEach(function (n) { parts.push(el("span", { className: "aside", text: "(" + n + ")" })); });
    return el("div", { className: "to" }, parts);
  }

  function refresh() { views.forEach(function (v) { v(); }); tally(); }

  function rowView(r) {
    var what = el("div", { className: "what" }, [src(r), to(r)]);
    if (informational(r.action.kind)) return el("li", { className: "card", id: "row-" + r.row_id, "data-state": "info" }, [what]);
    var pair = "r-" + r.row_id;
    var ok = el("input", { type: "radio", name: pair, value: "ok", className: "ok" });
    var leave = el("input", { type: "radio", name: pair, value: "leave", className: "leave" });
    var card = el("li", { className: "card", id: "row-" + r.row_id }, [
      what,
      el("div", { className: "pick", role: "radiogroup", "aria-label": "Decision" }, [
        el("label", { className: "opt ok" }, [ok, el("span", { text: "Approve" })]),
        el("label", { className: "opt leave" }, [leave, el("span", { text: "Leave as is" })])
      ])
    ]);
    ok.addEventListener("change", function () { state[r.row_id] = true; refresh(); });
    leave.addEventListener("change", function () { state[r.row_id] = false; refresh(); });
    views.push(function () {
      var on = state[r.row_id];
      ok.checked = on;
      leave.checked = !on;
      ok.disabled = leave.disabled = approved;
      card.setAttribute("data-state", on ? "ok" : "leave");
    });
    return card;
  }

  function group(kind, heading, rows) {
    var list = el("ol", { className: "stack" });
    var h2 = el("h2", null, [el("span", { className: "gt", text: heading }), el("span", { className: "count", text: String(rows.length) })]);
    var section = el("section", { className: "grp", id: "grp-" + kind, "data-kind": kind }, [h2, list]);
    rows.forEach(function (r) { list.appendChild(rowView(r)); });
    if (informational(kind)) return section;
    var all = el("input", { type: "checkbox", "aria-label": "Approve every row in " + heading });
    h2.appendChild(el("label", { className: "all" }, [all, el("span", { className: "box", "aria-hidden": "true" }), el("span", { className: "lbl", text: "Approve all / none" })]));
    function approvedHere() { return rows.filter(function (r) { return state[r.row_id]; }).length; }
    // A click when every row is approved sets them all to Leave as is; any other click approves them all.
    all.addEventListener("change", function () {
      var approve = approvedHere() !== rows.length;
      rows.forEach(function (r) { state[r.row_id] = approve; });
      refresh();
    });
    views.push(function () {
      var n = approvedHere();
      all.checked = n === rows.length;
      all.indeterminate = n > 0 && n < rows.length;
      all.disabled = approved;
    });
    return section;
  }

  var offered = P.rows.filter(function (r) { return r.section === "offered"; });
  var decidable = offered.filter(function (r) { return !informational(r.action.kind); });
  decidable.forEach(function (r) { state[r.row_id] = false; });
  if (approved) A.rows.forEach(function (e) { if (e.row_id in state) state[e.row_id] = e.approve === true; });

  header();
  if (approved) showBanner();
  var board = el("div", { className: "board" });
  GROUPS.forEach(function (g) {
    var rows = offered.filter(function (r) { return r.action.kind === g[0]; });
    if (rows.length) board.appendChild(group(g[0], g[1], rows));
  });
  app.appendChild(board);

  var ingested = P.rows.filter(function (r) { return r.section === "ingested_only"; });
  if (ingested.length) {
    var details = el("details", { className: "ingested" }, [el("summary", { text: "Ingested, nothing to approve (" + ingested.length + ")" })]);
    ingested.forEach(function (r) {
      var line = src(r);
      if (r.notes.length) line.appendChild(document.createTextNode(" \u2014 " + r.notes.join("; ")));
      details.appendChild(line);
    });
    app.appendChild(details);
  }

  var nOk = el("b"), nLeave = el("b"), message = el("span", { className: "msg" });
  var button = el("button", { type: "button", className: "submit", text: "Submit" });
  document.body.appendChild(el("div", { className: "bar" }, [el("div", { className: "in" }, [
    el("div", { className: "tally" }, [el("span", { className: "t-ok" }, [nOk, " approved"]), el("span", null, [nLeave, " left as is"])]),
    message,
    button
  ])]));
  function tally() {
    var n = decidable.filter(function (r) { return state[r.row_id]; }).length;
    nOk.textContent = String(n);
    nLeave.textContent = String(decidable.length - n);
    if (approved) { button.style.display = "none"; message.className = "msg done"; message.textContent = APPROVED; }
  }
  // Always enabled: submitting with nothing approved posts rows: [], a valid approval (spec §B8.3).
  button.addEventListener("click", function () {
    var rows = decidable.filter(function (r) { return state[r.row_id]; }).map(function (r) { return { row_id: r.row_id, approve: true }; });
    button.disabled = true; message.className = "msg"; message.textContent = "Saving\u2026";
    fetch(base + "/approve", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ run: P.run_id, rows: rows }) })
      .then(function (res) { return res.json().then(function (body) { return { ok: res.ok, body: body }; }); })
      .then(function (out) {
        if (!out.ok) throw new Error(out.body && out.body.error || "The approval was not saved.");
        approved = true;
        refresh();
        showBanner();
        window.scrollTo(0, 0);
      })
      .catch(function (err) { message.className = "msg error"; message.textContent = err.message; button.disabled = false; });
  });
  refresh();
})();
