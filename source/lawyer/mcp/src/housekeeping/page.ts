// The /housekeeping approval page (spec Part A2/A3, §B7.2, §B7.5), rendered whole from
// proposal.json. Self-contained: inline CSS and script, no external request (the server's CSP
// enforces it). Every value from the proposal reaches the DOM through textContent, never as HTML.
// Look and structure follow the committed mockup 2026-09-25_housekeeping-approval-page-mockup.html.
//
// One line per offered row, grouped by action: the file, an arrow, the one proposed action, and a
// radio pair, Approve and Leave as is, starting on Leave as is. A `stuck` or `misfiled` row is
// information only: no radio pair, no group box, and not counted. The page posts one entry per
// approved row, keyed by row id, carrying `approve: true` and nothing else; none at all is a valid
// approval. After approval it renders read-only.

import { ACTION_GROUPS, type Approval, INFORMATION_ONLY, type Proposal } from "./proposal.js";

export function renderApprovalPage(proposal: Proposal, approval: Approval | null): string {
  const data = JSON.stringify({ proposal, approval, groups: Object.entries(ACTION_GROUPS), info: INFORMATION_ONLY }).replace(/</g, "\\u003c");
  const matter = proposal.matter_root.split(/[\\/]/).filter(Boolean).pop() ?? proposal.matter_root;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Housekeeping: ${escapeHtml(matter)}</title>
<style>${CSS}</style>
</head>
<body>
<main id="app"></main>
<script type="application/json" id="hk-data">${data}</script>
<script>${SCRIPT}</script>
</body>
</html>
`;
}

/** The page shown for a token that no longer works. */
export function stalePage(): string {
  return simplePage(
    "This page is out of date",
    "A newer housekeeping run has started for this matter, or the Claude session that made this page has ended. Nothing was approved from it. Go back to Claude."
  );
}

export function simplePage(title: string, body: string): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>${CSS}</style></head>
<body><main><h1>${escapeHtml(title)}</h1><p>${escapeHtml(body)}</p></main></body></html>
`;
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

// The mockup's stylesheet: the Job Board / Litigation Strategy palette and system font stack, dark mode
// through prefers-color-scheme, a sticky footer tally. CSS escapes are doubled for the template.
const CSS = `
:root{
  --paper:#F4FAF7;--card:#FFFFFF;--ink:#025056;--muted:#436864;--line:#D7E8E0;--line-strong:#B9D3C8;
  --accent:#8A5F1F;--accent-soft:#F7ECD6;
  --panel:#C1E3CF;--frame:#4D8F85;--pill-bg:#BA802B;--pill-ink:#1A1A1A;--gradient:linear-gradient(90deg,#E5B521,#BA802B);
  --ok:#025056;--ok-ink:#FFFFFF;--ok-soft:#E3F2EC;--bad:#B3261E;
  --shadow:0 1px 2px rgba(2,80,86,.06),0 4px 14px rgba(2,80,86,.06);
  --sans:system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;
  --sans-heading:"Trebuchet MS","Century Gothic",var(--sans);
  --mono:ui-monospace,"Cascadia Mono",Consolas,Menlo,monospace;
}
@media (prefers-color-scheme: dark){:root:not([data-theme="light"]){
  --paper:#0E2224;--card:#133034;--ink:#D9F0E8;--muted:#8FB8B0;--line:#23494A;--line-strong:#35635F;
  --accent:#E5B521;--accent-soft:#3A2F14;--panel:#163330;--frame:#4D8F85;
  --ok:#7FC8B4;--ok-ink:#0E2224;--ok-soft:#1B3F3E;--bad:#F28B82;--shadow:0 1px 2px rgba(0,0,0,.3),0 4px 14px rgba(0,0,0,.25);
}}
:root[data-theme="dark"]{
  --paper:#0E2224;--card:#133034;--ink:#D9F0E8;--muted:#8FB8B0;--line:#23494A;--line-strong:#35635F;
  --accent:#E5B521;--accent-soft:#3A2F14;--panel:#163330;--frame:#4D8F85;
  --ok:#7FC8B4;--ok-ink:#0E2224;--ok-soft:#1B3F3E;--bad:#F28B82;--shadow:0 1px 2px rgba(0,0,0,.3),0 4px 14px rgba(0,0,0,.25);
}
*{box-sizing:border-box}
body{margin:0;background:var(--paper);color:var(--ink);font-family:var(--sans);font-size:14px;line-height:1.5}
main{padding:28px 28px 96px;max-width:1080px;margin:0 auto}
header{display:flex;flex-direction:column;gap:6px;margin-bottom:24px}
header h1{font-family:var(--sans-heading);font-weight:600;font-size:22px;margin:0;letter-spacing:-.01em}
header h1::after{content:"";display:block;height:4px;width:140px;margin-top:8px;border-radius:2px;background:var(--gradient)}
.meta{font-family:var(--mono);font-size:12px;color:var(--muted);display:flex;flex-wrap:wrap;gap:4px 16px}
.meta span::before{content:attr(data-k) " ";color:var(--line-strong)}
.note{font-size:12.5px;color:var(--muted);margin:0}
.banner{padding:10px 14px;border-radius:10px;border:2px solid var(--ok);background:var(--ok-soft);font-weight:600;margin-top:6px}
.board{display:flex;flex-direction:column;gap:22px}

/* Group panel */
section.grp{background:var(--panel);border-radius:12px;padding:14px 16px 16px}
section.grp>h2{font-family:var(--sans-heading);font-size:17px;font-weight:700;letter-spacing:-.005em;margin:0 0 12px;padding-bottom:9px;border-bottom:1px solid var(--frame);display:flex;align-items:center;gap:10px}
label.all{margin-left:auto;display:inline-flex;align-items:center;gap:8px;cursor:pointer;user-select:none;font-family:var(--sans);font-size:12.5px;font-weight:500;color:var(--muted);padding:4px 8px;border-radius:8px}
label.all:hover{color:var(--ink);background:var(--card)}
label.all input{position:absolute;opacity:0;pointer-events:none}
.box{width:18px;height:18px;border-radius:5px;border:2px solid var(--frame);background:var(--card);display:grid;place-items:center;transition:background .12s,border-color .12s}
label.all input:checked+.box{background:var(--ok);border-color:var(--ok)}
label.all input:checked+.box::after{content:"";width:9px;height:5px;border:2px solid var(--ok-ink);border-top:0;border-right:0;transform:translateY(-1px) rotate(-45deg)}
label.all input:indeterminate+.box{background:var(--ok);border-color:var(--ok)}
label.all input:indeterminate+.box::after{content:"";width:9px;height:2px;background:var(--ok-ink);border-radius:1px}
label.all input:focus-visible+.box{outline:2px solid var(--accent);outline-offset:2px}
label.all input:disabled+.box{opacity:.6}
.count{font-family:var(--mono);font-size:11px;font-weight:600;color:var(--pill-ink);background:var(--pill-bg);border-radius:999px;padding:1px 8px;line-height:1.5}
section[data-kind="misfiled"]>h2,section[data-kind="stuck"]>h2{color:var(--accent)}

/* Row card */
ol.stack{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:8px}
li.card{background:var(--card);border:2px solid var(--frame);border-radius:10px;padding:10px 14px;display:flex;gap:8px 18px;align-items:center;flex-wrap:wrap;box-shadow:var(--shadow);transition:border-color .15s,background .15s}
li.card:hover{border-color:var(--line-strong)}
li.card[data-state="ok"]{border-color:var(--ok);background:var(--ok-soft)}
.what{flex:1 1 420px;min-width:0;display:flex;flex-direction:column;gap:2px}
.src{font-size:13px;overflow-wrap:anywhere}
.src a{color:var(--muted);text-decoration:none;border-bottom:1px dotted var(--line-strong)}
.src a:hover{color:var(--ink);border-bottom-color:var(--ink)}
.dir{font-weight:700}
.to{display:flex;flex-wrap:wrap;gap:2px 10px;align-items:baseline}
.verb{font-family:var(--mono);font-size:11px;letter-spacing:.04em;color:var(--frame);white-space:nowrap}
.verb::before{content:"\\2192"}
.verb.solo::before{content:"\\2192\\00A0\\00A0"}
.verb.solo{font-size:12px;font-weight:600;color:var(--ink)}
.tgt{font-weight:400;font-size:14px;overflow-wrap:anywhere}
.dest-f{font-weight:700}
.why{font-size:12.5px;color:var(--muted)}
.why::before{content:"\\2014\\00A0"}
.aside{font-size:12.5px;color:var(--muted)}

/* Decision toggles */
.pick{display:flex;gap:6px;flex:0 0 auto}
label.opt{position:relative;cursor:pointer;user-select:none}
label.opt input{position:absolute;opacity:0;pointer-events:none}
label.opt span{display:inline-block;padding:5px 12px;border-radius:999px;border:1.5px solid var(--line-strong);font-size:12.5px;font-weight:500;color:var(--muted);background:var(--card);transition:all .12s;white-space:nowrap}
label.opt:hover span{border-color:var(--frame);color:var(--ink)}
label.opt.ok input:checked+span{background:var(--ok);border-color:var(--ok);color:var(--ok-ink)}
label.opt.ok input:checked+span::before{content:"\\2713\\00A0"}
label.opt.leave input:checked+span{background:var(--line);border-color:var(--line-strong);color:var(--ink)}
label.opt input:focus-visible+span{outline:2px solid var(--accent);outline-offset:2px}
label.opt input:disabled+span{cursor:default}

/* Ingested, nothing to approve */
details.ingested{margin-top:22px;background:var(--panel);border-radius:12px;padding:12px 16px}
details.ingested summary{font-family:var(--sans-heading);font-size:15px;font-weight:700;cursor:pointer}
details.ingested .src{padding:6px 0 0}

/* Sticky footer tally */
.bar{position:fixed;left:0;right:0;bottom:0;background:var(--card);border-top:1px solid var(--line-strong);box-shadow:0 -4px 16px rgba(2,80,86,.08)}
.bar .in{max-width:1080px;margin:0 auto;padding:12px 28px;display:flex;align-items:center;gap:16px;flex-wrap:wrap}
.tally{font-family:var(--mono);font-size:12px;color:var(--muted);display:flex;gap:14px;flex-wrap:wrap}
.tally b{color:var(--ink);font-weight:600}
.tally .t-ok b{color:var(--ok)}
.msg{font-size:13px}
.msg.done{color:var(--ok);font-weight:600}
.msg.error{color:var(--bad)}
button.submit{margin-left:auto;font:600 14px var(--sans-heading);padding:8px 22px;border-radius:8px;border:0;background:var(--ink);color:var(--paper);cursor:pointer;transition:transform .08s,opacity .12s}
button.submit:hover{opacity:.92}
button.submit:active{transform:translateY(1px)}
button.submit:disabled{opacity:.4;cursor:default}

@media (max-width:640px){main{padding:18px 16px 120px}.bar .in{padding:10px 16px}.what{flex-basis:100%}}
@media (prefers-reduced-motion: reduce){*{transition:none!important}}
`;

// Client script. Plain ES5-style strings only: no backticks and no template placeholders, so it
// embeds in the template literal above unchanged.
const SCRIPT = `
(function () {
  "use strict";
  var data = JSON.parse(document.getElementById("hk-data").textContent);
  var P = data.proposal, A = data.approval, GROUPS = data.groups, INFO = data.info;
  var APPROVED = "Approved. You can go back to Claude.";
  var base = location.pathname.replace(/\\/+$/, "");
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
  function baseName(p) { var s = p.split(/[\\\\/]/); return s[s.length - 1]; }
  // The folder part of a matter-relative path, with its trailing separator, or "" at the root.
  function folderOf(p) { var i = Math.max(p.lastIndexOf("\\\\"), p.lastIndexOf("/")); return i < 0 ? "" : p.slice(0, i + 1); }
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
        meta("matter", P.matter_root.split(/[\\\\/]/).filter(Boolean).pop()),
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
    if (a.kind === "file") parts = arrow([el("span", { className: "dir", text: a.folder + "\\\\" }), name(a.name)]);
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
      if (r.notes.length) line.appendChild(document.createTextNode(" \\u2014 " + r.notes.join("; ")));
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
    button.disabled = true; message.className = "msg"; message.textContent = "Saving\\u2026";
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
`;
