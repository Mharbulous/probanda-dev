// The Cast of Characters page (Cast of Characters spec 4): the model from cast-data.ts rendered to
// full markup here, every value escaped, so the page is complete in a file preview that runs no
// script. Tabs, cards and Show former work through radio inputs and :has (the mockup's CSS); the
// page's script only adds search, the filters, Esc, the remembered tab and copying. Unlike the
// other view pages it embeds no data line: there is nothing for a script to draw.

import { pathToFileURL } from "node:url";

import { type ComposedTemplate, templated } from "../compose-template.js";
import { escapeHtml as esc } from "../suggestions/page.js";
import boardCss from "../templates/practice-board/board.css.js";
import castCss from "../templates/view-pages/cast-of-characters.css.js";
import castHtml from "../templates/view-pages/cast-of-characters.html.js";
import castJs from "../templates/view-pages/cast-of-characters.js.js";
import viewFolderCss from "../templates/view-pages/view-folder.css.js";
import viewHeadHtml from "../templates/view-pages/view-head.html.js";
import { FLAG_LABELS, type CastModel, type Detail, type Entry, type Flag } from "./cast-data.js";

export const CAST_PAGE_NAME = "Cast of Characters";
export const CAST_FILE = `${CAST_PAGE_NAME}.html`;

export const CAST_PAGE = templated({
  entry: "cast-of-characters.html",
  files: {
    "cast-of-characters.html": castHtml, "view-head.html": viewHeadHtml, "board.css": boardCss,
    "view-folder.css": viewFolderCss, "cast-of-characters.css": castCss, "cast-of-characters.js": castJs,
  },
});

export interface CastMeta { matter: string; client: string; revision: number | null; rendered: string }

const copyButton = (label: string, text: string, cls = "") =>
  `<button type="button"${cls ? ` class="${cls}"` : ""} data-copy="${esc(text)}" title="${esc(text)}">${esc(label)}</button>`;

function detail(d: Detail): string {
  if (d.value === null) return `<span class="k">${esc(d.label)}</span><span class="v missing">Missing</span>`;
  const source = d.source
    ? `<span class="src">${d.sourcePath ? `<a href="${esc(pathToFileURL(d.sourcePath).href)}">${esc(d.source)}</a>` : esc(d.source)}</span>`
    : "";
  const priv = d.privileged ? `<span class="pill priv inl">${FLAG_LABELS.priv}</span>` : "";
  return `<span class="k">${esc(d.label)}</span><span class="v">${esc(d.value)}${d.copy ? copyButton("copy", d.value, "copy") : ""}${source}${priv}</span>`;
}

const rows = (heading: string, details: Detail[]) =>
  details.length ? `<h3>${esc(heading)}</h3><div class="rows">${details.map(detail).join("")}</div>` : "";

function summary(e: Entry): string {
  const part = (value: string | null, missing: string) => (value ? esc(value) : `<span class="gap">${missing}</span>`);
  const bits = [part(e.email, "no email"), part(e.phone, "no phone"), ...(e.address ? [esc(e.address)] : [])];
  return bits.join(`<span class="sep">·</span>`);
}

function card(e: Entry, id: string): string {
  const cls = ["card", e.proposed ? "unconfirmed" : "", e.former ? "former" : ""].filter(Boolean).join(" ");
  const pills = e.pills.map((p) => `<span class="pill${p.kind ? ` ${p.kind}` : ""}">${esc(p.text)}</span>`).join("");
  const related = e.related.length
    ? `<h3>Related</h3><div class="rows">${e.related.map((r) => `<span class="k">·</span><span class="v">${esc(r)}</span>`).join("")}</div>`
    : "";
  const counts = e.counts
    ? `<h3>In the case data</h3><div class="rows"><span class="k">Facts</span><span class="v">${e.counts.facts}</span><span class="k">Documents</span><span class="v">${e.counts.documents}</span></div>`
    : "";
  const actions = e.actions.length
    ? `<div class="actions">${e.actions.map((a) => copyButton(a.label === "Missing details" || a.label === "Conflicting details" || a.label === "No matter role" ? `Copy instruction: ${a.label}` : a.label, a.instruction)).join("")}</div>`
    : "";
  return `<div class="${cls}" data-side="${e.side}" data-flags="${e.flags.join(" ")}" data-search="${esc(e.search)}">
  <input type="radio" name="open" class="opener" id="${id}">
  <label class="head" for="${id}">
    <span class="r1">${e.code ? `<span class="code">${esc(e.code)}</span>` : ""}<span class="name">${esc(e.name)}</span><span class="pills">${pills}</span></span>
    <span class="r2">${summary(e)}</span>
  </label>
  <label class="x" for="o-none">Close ✕</label>
  <div class="detail">${e.aliases.length ? `<div class="aka">Also known as: ${esc(e.aliases.join(", "))}</div>` : ""}${rows("Contact", e.contact)}${rows("Service", e.service)}${rows("Counsel", e.counsel)}${related}${rows("Appearances", e.appearances)}${counts}${e.notes.map((n) => `<div class="note">${esc(n)}</div>`).join("")}${actions}</div>
</div>`;
}

/** The page's whole file; `composed` is a preview's template in place of the page's own. */
export function renderCastPage(model: CastModel, meta: CastMeta, composed: ComposedTemplate = CAST_PAGE): string {
  const metaRow = [["Matter", meta.matter], ["Client", meta.client], ["Rev", meta.revision === null ? "" : String(meta.revision)], ["Rendered", meta.rendered]]
    .filter(([, v]) => v !== "").map(([k, v]) => `<span data-k="${esc(k)}">${esc(v)}</span>`).join("");
  const flagOptions = (Object.keys(FLAG_LABELS) as Flag[]).map((f) => `<option value="${f}">${FLAG_LABELS[f]}</option>`).join("");
  const views = model.tabs.map((tab) => {
    const sections = tab.sections.map((s, si) => {
      const shown = s.entries.filter((e) => !e.former).length;
      return `<section><h2>${esc(s.title)} <span class="badge">${shown}</span></h2><div class="list">${s.entries.map((e, ei) => card(e, `o-${tab.id}${si}-${ei}`)).join("")}<div class="none"${shown ? " hidden" : ""}>None.</div></div></section>`;
    }).join("");
    const tools = tab.id === "svc"
      ? `<div class="actions listtools">${copyButton("Copy all service emails", model.serviceEmails)}${copyButton("Copy service list as table", model.serviceTable)}</div>`
      : "";
    return `<div class="view" data-v="${tab.id}">${sections}${tools}</div>`;
  }).join("");
  const radios = model.tabs.map((t, i) => `<input type="radio" name="tab" class="tabr" id="t-${t.id}"${i === 0 ? " checked" : ""}>`).join("");
  const labels = model.tabs.map((t) => `<label class="tab" for="t-${t.id}">${esc(t.label)}</label>`).join("");
  const notices = model.notes.map((n) => `<p class="notice">${esc(n)}</p>`).join("");
  const body = `<main class="page">
  ${radios}<input type="radio" name="open" id="o-none" checked>
  <header>
    <h1>${CAST_PAGE_NAME}</h1>
    <div class="meta">${metaRow}</div>
  </header>
  <div class="tabs">${labels}</div>
  <div class="panel">
    <div class="filters">
      <label>Side <select id="side"><option value="">All sides</option><option value="P">${esc(model.sideLabels.P)}</option><option value="D">${esc(model.sideLabels.D)}</option><option value="N">Neutral</option></select></label>
      <label>Flags <select id="flag"><option value="">All entries</option>${flagOptions}</select></label>
      <label><input type="checkbox" id="former"> Show former</label>
    </div>
    <input type="search" id="q" placeholder="Search names, aliases, file codes, firms">${notices}
    ${views}
  </div>
</main>`;
  return `${composed.head}${body}${composed.tail}`;
}
