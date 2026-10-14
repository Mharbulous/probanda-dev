// The Job Board's stylesheet and its open-one-card / centring behaviour (design doc
// docs/design/2026-09-03 work-board-html-engine-design.md §4). Held here as
// string constants, not as .css/.js files: the test suite imports from
// build/ (tsc output) and the shipped runtime is a single esbuild bundle --
// neither copies loose asset files, so a real file on disk would be present
// in the repo and absent everywhere the code actually runs. Since 2026-09-15
// workboard-shell.ts inlines both into every Job Board.html; neither is
// written to disk as its own file any more (local-only design, amended).
//
// Nothing here is templated, and neither string carries matter data.

export const WORKBOARD_CSS = String.raw`/* Job Board stylesheet (design doc §7, 2026-09-08). System fonts only: no
   network fetch, so the board reads offline and inside a sandboxed pane. One
   accent, used three times: the Ready heading, the in-progress chip, links.
   Palette and heading font evoke the Logica Law brand sheet (2026-09-18)
   without embedding its logo or its exact typeface -- teal/mint/gold, and a
   system geometric-sans stack in place of the brand's Sackers/Questrial.
   Mid Teal, Mint and Bronze (2026-09-19, ticket #691) dress the section
   panel, the card frame, the count pill and the title's gradient rule. */
:root{
  --paper:#F4FAF7;--card:#FFFFFF;--ink:#025056;--muted:#436864;--line:#D7E8E0;--line-strong:#B9D3C8;
  --accent:#8A5F1F;--accent-soft:#F7ECD6;--done:#025056;
  --panel:#C1E3CF;--frame:#4D8F85;--pill-bg:#BA802B;--pill-ink:#1A1A1A;--gradient:linear-gradient(90deg,#E5B521,#BA802B);
  --deleted:#A3221B;
  --sans:system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;
  --sans-heading:"Trebuchet MS","Century Gothic",var(--sans);
  --mono:ui-monospace,"Cascadia Mono",Consolas,Menlo,monospace;
}
@media (prefers-color-scheme: dark){:root:not([data-theme="light"]){
  --paper:#0E2224;--card:#133034;--ink:#D9F0E8;--muted:#8FB8B0;--line:#23494A;--line-strong:#35635F;
  --accent:#E5B521;--accent-soft:#3A2F14;--done:#D9F0E8;
  --panel:#163330;--frame:#4D8F85;--pill-bg:#BA802B;--pill-ink:#1A1A1A;
  --deleted:#FF8A80;
}}
:root[data-theme="dark"]{
  --paper:#0E2224;--card:#133034;--ink:#D9F0E8;--muted:#8FB8B0;--line:#23494A;--line-strong:#35635F;
  --accent:#E5B521;--accent-soft:#3A2F14;--done:#D9F0E8;
  --panel:#163330;--frame:#4D8F85;--pill-bg:#BA802B;--pill-ink:#1A1A1A;
  --deleted:#FF8A80;
}
*{box-sizing:border-box}
body{margin:0;background:var(--paper);color:var(--ink);font-family:var(--sans);font-size:14px;line-height:1.5}
main{padding:28px}
header{display:flex;flex-direction:column;gap:6px;margin-bottom:28px}
header h1{font-family:var(--sans-heading);font-weight:600;font-size:22px;margin:0;letter-spacing:-.01em}
header h1::after{content:"";display:block;height:4px;width:140px;margin-top:8px;border-radius:2px;background:var(--gradient)}
header .meta{font-family:var(--mono);font-size:12px;color:var(--muted);display:flex;flex-wrap:wrap;gap:4px 16px}
header .meta span::before{content:attr(data-k) " ";color:var(--line-strong)}
header .notice{margin:4px 0 0;font-size:13px;color:var(--wip);background:var(--wip-soft);border:1px solid var(--wip);border-radius:6px;padding:8px 12px}

/* One vertical list at every width (practitioner, 2026-09-15): sections stack,
   and each section's cards stack one per row. No card grid and no width
   breakpoint, however wide the pane or window. */
.board{display:flex;flex-direction:column;gap:28px}
section{background:var(--panel);border-radius:12px;padding:16px 18px}
section>h2{font-family:var(--sans-heading);font-size:13px;font-weight:600;color:var(--ink);margin:0 0 12px;padding-bottom:8px;border-bottom:1px solid var(--frame);display:flex;align-items:baseline;gap:8px}
#ready>h2{color:var(--accent)}
section>h2 .count{font-family:var(--mono);font-size:11px;font-weight:600;color:var(--pill-ink);background:var(--pill-bg);border-radius:999px;padding:1px 8px;line-height:1.5}
section>p.empty{margin:0;font-size:13px;color:var(--muted);background:var(--card);padding:12px 14px;border:1px dashed var(--frame);border-radius:8px}
.stack{display:flex;flex-direction:column;gap:10px}

/* Cards. */
details.ticket,details.seed{background:var(--card);border:2px solid var(--frame);border-radius:10px;overflow:hidden;transition:border-color .15s}
details.ticket:hover,details.seed:hover{border-color:var(--line-strong)}
details.ticket[open],details.seed[open]{border-color:var(--ink)}
details.ticket[data-status="superseded"],details.ticket[data-status="completed"]{opacity:.7}
details.ticket>summary{list-style:none;cursor:pointer;display:grid;grid-template-columns:auto 1fr;gap:6px 10px;align-items:baseline;padding:12px 14px}
details.seed>summary{list-style:none;cursor:pointer;display:block;padding:12px 14px}
details.ticket>summary::-webkit-details-marker,details.seed>summary::-webkit-details-marker{display:none}
details.ticket>summary:focus-visible,details.seed>summary:focus-visible{outline:2px solid var(--accent);outline-offset:-2px}
.ref{font-family:var(--mono);font-size:12px;color:var(--muted)}
.title{font-weight:500}
details.seed .title{font-weight:400}
.progress{grid-column:1/-1;font-family:var(--mono);font-size:12px;color:var(--muted);font-variant-numeric:tabular-nums;display:flex;align-items:center;gap:8px}
.bar{width:64px;height:3px;background:var(--line);border-radius:2px;overflow:hidden}
.bar i{display:block;height:100%;background:var(--pill-bg);width:var(--pct)}
.chip{font-size:11px;font-weight:500;padding:0 7px;border-radius:999px;white-space:nowrap;border:1px solid var(--muted);color:var(--muted);line-height:1.6}
.chip.wip{background:var(--accent-soft);border-color:var(--accent-soft);color:var(--accent)}
.chip.done{background:var(--line);border-color:var(--line);color:var(--muted)}
.body{border-top:1px solid var(--line);padding:14px 14px 16px;display:flex;flex-direction:column;gap:14px;max-width:72ch}
.body p{margin:0}
.body dl{margin:0;display:grid;grid-template-columns:max-content 1fr;gap:4px 14px;font-size:13px}
.body dt{color:var(--muted)}
.body dd{margin:0}
.body dd.mono{font-family:var(--mono);font-size:12px}
.body a{color:var(--accent)}
ol.steps{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:5px}
ol.steps li{display:grid;grid-template-columns:18px 1fr;gap:10px;align-items:start;font-size:13.5px}
ol.steps li::before{content:"";width:14px;height:14px;margin-top:3px;border:1.5px solid var(--line-strong);border-radius:3px}
ol.steps li.done{color:var(--muted);text-decoration:line-through;text-decoration-color:var(--line-strong)}
ol.steps li.done::before{border-color:var(--done);background-color:var(--done);background-image:url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 12'><path d='M2.5 6.2l2.3 2.3L9.5 3.7' fill='none' stroke='white' stroke-width='1.8' stroke-linecap='round' stroke-linejoin='round'/></svg>");background-size:11px;background-repeat:no-repeat;background-position:center}
@media (prefers-color-scheme: dark){:root:not([data-theme="light"]) ol.steps li.done::before{background-image:url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 12'><path d='M2.5 6.2l2.3 2.3L9.5 3.7' fill='none' stroke='%230E2224' stroke-width='1.8' stroke-linecap='round' stroke-linejoin='round'/></svg>")}}
:root[data-theme="dark"] ol.steps li.done::before{background-image:url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 12'><path d='M2.5 6.2l2.3 2.3L9.5 3.7' fill='none' stroke='%230E2224' stroke-width='1.8' stroke-linecap='round' stroke-linejoin='round'/></svg>")}
ol.steps li.next{font-weight:500}
ol.steps li.next::before{border-color:var(--ink)}

/* A deleted job (schema v54): one struck red line in Completed, never a card. pre-wrap keeps the
   two spaces after the colon. */
p.deleted{margin:0;font-size:13.5px;color:var(--deleted)}
p.deleted s{white-space:pre-wrap}
p.deleted a{color:inherit}
/* A discarded loose thread (schema v75) draws as a deleted job does. A suggested one is the same
   line in ordinary ink, unstruck. */
p.suggested{margin:0;font-size:13.5px;white-space:pre-wrap}

/* Proposal cards (design §13). Read-only: text, then glyph, with any status pinned right. A long
   line's text truncates with an ellipsis at a narrow card width, and the row's tooltip carries the
   whole line. */
.proposal{background:var(--card);border:2px solid var(--frame);border-radius:10px;padding:12px 14px}
.proposal .head{margin:0 0 6px;font-weight:500}
.proposal ul.lines{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:5px}
.proposal ul.lines li{display:flex;flex-wrap:wrap;gap:2px 10px;align-items:baseline;font-size:13.5px}
/* The row's text and glyph stay together and left-aligned: only the text truncates, and the glyph
   never shrinks, so the ellipsis can never eat it. overflow:hidden is what lets the text shrink
   past its own content width. */
.proposal .line{flex:1 1 12ch;display:flex;align-items:baseline;overflow:hidden}
.proposal .line .text{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.proposal .line .glyph{flex:0 0 auto;white-space:pre}
/* Pinned right beside the line where it fits, on its own right-aligned row where it does not --
   a status long enough to squeeze the line away would leave nothing legible at 268px. */
.proposal .status{margin-left:auto;font-family:var(--mono);font-size:11.5px;color:var(--muted);white-space:nowrap}
section>p.cue{margin:12px 0 0;font-size:12px;color:var(--muted)}

@media (prefers-reduced-motion: reduce){details.ticket,details.seed{transition:none}}

/* Print: the same vertical list on paper, everything open. */
@media print{
  section{break-inside:avoid}
  details.ticket,details.seed,details.goal,.proposal{opacity:1;break-inside:avoid}
  details.ticket>.body,details.seed>.body,details.goal>ul.criteria,details.items>ul.items{display:flex}
  .chip,.bar,.bar i,ol.steps li.done::before{-webkit-print-color-adjust:exact;print-color-adjust:exact}
}
`;

export const WORKBOARD_JS = String.raw`(function () {
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
`;
