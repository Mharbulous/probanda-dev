// The Loose Threads view page: one `Loose Threads - Job Board <id>.html` per live Writing, written by the
// view-page registry (../view-pages.ts), listing the open loose threads of the filing's proceeding --
// the same set board_card's loose_threads lane prints, read by the same loader (fetchOpenSeeds), in
// the same order (inRankOrder):
//   ranked   -- by rank, ties by id, each with its group and the one-line reason the ranking gave it
//               (schema v66).
//   unranked -- by id: the loose threads captured since the last ranking, and every one on a database
//               held below v66. The page calls them Unsorted.
// A ranked card shows the job description the ranking restated it as (schema v70), ending in its
// rank tag and its group's tag under the group's short name; opened, it shows the loose thought
// verbatim, then the reason, the loose thread's id, who surfaced it and where it came from, as the
// lane's line does. An unranked card, and one ranked before v70, shows the idea verbatim instead,
// ending in its tags (a "?" while unranked). The controls are folder tabs, an
// All groups switch with a chip per group over the ranked, and, on each card not yet deferred, a
// Defer button (schema v68). Ranking never drops a loose thread, so the page lists every open one; a
// deferred one shows collapsed to its first line and faded.
//
// Under the All tab two more sections follow (schema v75): Discarded, each thread the practitioner
// dropped as a red struck line with a Restore link that copies an instruction and writes nothing, and
// Suggested, each thread sent to Probanda as a plain line. Neither is in the header's counts.
//
// The Defer button writes through the data server's localhost listener (../../page-api/server.ts):
// the page posts the db_path, proceeding and token embedded here, and the listener writes only
// with a token a render made. The page checks the listener on load and disables the buttons, with
// one line saying why, when it does not answer.
//
// A human interface generated from the database (ADR 0033): no session reads, greps, parses or
// screenshots it. Sessions read the ranks and the deferrals through board_card's loose_threads lane,
// which keeps the long group labels (RANK_GROUP_LABELS).

import { pageApiPort, pageApiToken } from "../../page-api/token.js";
import type { ViewPage } from "../view-pages.js";
import type { FilingRow } from "./query.js";
import { fetchDiscardedSeeds, fetchOpenSeeds, inRankOrder, seedOrigin, withFromFiling, type RankGroup } from "./render-work-board.js";
import { VIEW_FOLDER_CSS } from "./view-folder-css.js";

/** Each group's short name and colour on this page, in triage's group order. */
const GROUP_STYLE: Readonly<Record<RankGroup, { label: string; colour: string }>> = {
  decision: { label: "Practitioner decisions", colour: "#6E4F8E" },
  tooling: { label: "Tooling", colour: "#3F6197" },
  housekeeping: { label: "Housekeeping", colour: "#2F7466" },
  research: { label: "Research", colour: "#8E6620" },
  authority: { label: "Authority mismatch", colour: "#984A43" },
  evidence: { label: "Evidence mismatch", colour: "#85587A" },
  other: { label: "Miscellaneous", colour: "#636B72" },
};

export interface LooseIdea {
  id: number;
  /** Null while unranked. */
  rank: number | null;
  idea: string;
  group: RankGroup | null;
  /** The group's short name on this page (GROUP_STYLE). */
  group_label: string | null;
  reason: string | null;
  /** The job description the ranking wrote (schema v70); null while unranked and on a loose thread ranked before v70. */
  job: string | null;
  surfaced_by: string;
  /** `from Job #N[ on <filing>]` or `from <filing>`, as the lane's line prints it; null for neither. */
  origin: string | null;
  /** When the practitioner deferred it (schema v68); null when not deferred. */
  deferred_at: string | null;
}

/** What the page's Defer button posts to the listener: its port, and the body it sends. */
export interface LooseIdeasApi {
  port: number;
  db_path: string;
  proceeding_id: number;
  token: string;
}

export interface LooseIdeasData {
  /** The groups the ranked loose threads fall in, in triage's group order: one chip each, with its
   * count of ranked loose threads. */
  groups: { key: RankGroup; label: string; colour: string; count: number }[];
  /** Every open loose thread in the shared order: the ranked first, then the unranked. */
  ideas: LooseIdea[];
  /** The proceeding's discarded and suggested loose threads (schema v75), in id order: one with
   * `discarded_at` set is drawn struck under Discarded, any other under Suggested. */
  discarded: { id: number; idea: string; discarded_at: string | null; suggested_at: string | null }[];
  api: LooseIdeasApi;
}

/** The page's data for one filing, from the drafting database, with the listener's port and this
 * page's token read from this device's coclerk.json and page-api.secret. */
export function buildLooseIdeasData(dbPath: string, filing: FilingRow, env: NodeJS.ProcessEnv = process.env): LooseIdeasData {
  const seeds = inRankOrder(withFromFiling(dbPath, filing.proceeding_id, filing.id, fetchOpenSeeds(dbPath, filing.proceeding_id)));
  const ideas = seeds.map(
    (s): LooseIdea => ({
      id: s.id,
      rank: s.rank,
      idea: s.idea,
      group: s.rank === null ? null : s.rank_group,
      group_label: s.rank === null || s.rank_group === null ? null : GROUP_STYLE[s.rank_group].label,
      reason: s.rank === null ? null : s.rank_reason,
      job: s.rank === null ? null : s.rank_job,
      surfaced_by: s.surfaced_by,
      origin: seedOrigin(s),
      deferred_at: s.deferred_at,
    })
  );
  const groups = (Object.keys(GROUP_STYLE) as RankGroup[])
    .map((key) => ({ key, ...GROUP_STYLE[key], count: ideas.filter((i) => i.group === key).length }))
    .filter((g) => g.count > 0);
  const api = { port: pageApiPort(env), db_path: dbPath, proceeding_id: filing.proceeding_id, token: pageApiToken(dbPath, filing.proceeding_id, env) };
  const discarded = fetchDiscardedSeeds(dbPath, filing.proceeding_id).map((s) => ({ id: s.id, idea: s.idea, discarded_at: s.discarded_at, suggested_at: s.suggested_at }));
  return { groups, ideas, discarded, api };
}

/** The header's counts: every open loose thread, the ranked and the unranked. */
function looseIdeasMeta(data: LooseIdeasData): [string, string][] {
  const ranked = data.ideas.filter((i) => i.rank !== null).length;
  return [
    ["Threads", String(data.ideas.length)],
    ["Ranked", String(ranked)],
    ["Unsorted", String(data.ideas.length - ranked)],
  ];
}

const PAGE_CSS = String.raw`
header h1{color:#1d5e4a}
header h1::after{height:3px;background:#a8691c}
header .meta span::before{color:#c49a6c}
${VIEW_FOLDER_CSS}
.folder section>p.note{margin:-6px 0 12px;font-size:12.5px;color:var(--muted)}
article.idea{position:relative;background:#fff;border:2px solid #1d5e4a;border-radius:8px;padding:10px 14px;display:flex;flex-direction:column;gap:6px}
.idea>.text{font-weight:600;margin:0;white-space:pre-wrap;padding-right:64px;cursor:pointer}
.idea>.text::before{content:"▸";display:inline-block;margin-right:6px;color:#1d5e4a;transition:transform .15s}
.idea[data-open=true]>.text::before{transform:rotate(90deg)}
.idea>.text:focus-visible{outline:2px solid #1d5e4a;outline-offset:3px;border-radius:4px}
.idea .tags{white-space:nowrap}
.idea .tag{display:inline-block;margin-left:6px;padding:0 8px;border:1.5px solid #1d5e4a;border-radius:999px;background:#1d5e4a;color:#fff;font-size:10.5px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;line-height:1.6;vertical-align:2px}
.idea .tag.group{background:#fff;border-color:var(--g);color:var(--g)}
.idea>.body{display:flex;flex-direction:column;gap:4px}
.idea>.body>p{margin:0;font-size:12.5px;color:var(--muted)}
.idea>.body>p.thought{white-space:pre-wrap}
.idea>button.defer{position:absolute;top:8px;right:10px;font:inherit;font-size:12px;padding:2px 10px;border:1px solid var(--line-strong);border-radius:999px;background:var(--card);color:var(--ink);cursor:pointer}
.idea>button.defer:disabled{cursor:default;opacity:.5}
.idea>.error{margin:0;font-size:12.5px;color:#b3261e}
article.idea.deferred{opacity:.55}
.idea.deferred>.text{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;padding-right:0;cursor:default}
.idea.deferred>:not(.text){display:none}
.api-off{margin:6px 0 0;font-size:12.5px;color:var(--muted)}
.switch{margin-left:auto;position:relative;z-index:2;display:inline-flex;align-items:center;gap:8px;font:inherit;font-size:13px;font-weight:700;padding:4px 8px 4px 12px;border:1.5px solid #8fb3a0;border-radius:999px;background:#fff;cursor:pointer}
.switch .label{color:#b9c9c0;transition:color .18s}
.switch[aria-checked=true] .label{color:#1d5e4a}
.switch .track{position:relative;width:30px;height:17px;border-radius:999px;background:#b9c9c0;transition:background .18s}
.switch[aria-checked=true] .track{background:#1d5e4a}
.switch .knob{position:absolute;top:2px;left:2px;width:13px;height:13px;border-radius:50%;background:#fff;box-shadow:0 1px 2px rgba(0,0,0,.25);transition:transform .18s}
.switch[aria-checked=true] .knob{transform:translateX(13px)}
.switch:focus-visible{outline:2px solid #1d5e4a;outline-offset:2px}
.chips{position:relative;z-index:1;display:flex;flex-wrap:wrap;gap:6px;margin:0 0 12px}
.chip{display:inline-flex;align-items:center;gap:6px;font:inherit;font-size:12.5px;font-weight:600;padding:3px 11px;border:1.5px solid #c9d3ce;border-radius:999px;background:#fff;color:#8a948f;cursor:pointer}
.chip[aria-pressed=true]{border-color:var(--g);background:color-mix(in srgb,var(--g) 10%,#fff);color:var(--g)}
.chip[aria-pressed=true]::before{content:"✓";font-weight:800}
.chip .n{font-family:var(--mono);font-size:11px;opacity:.8}
.chip:focus-visible{outline:2px solid #1d5e4a;outline-offset:2px}
.folder section>p.empty{margin:0 0 12px}
@media (prefers-reduced-motion:reduce){.switch .label,.switch .track,.switch .knob,.idea>.text::before{transition:none}}
`;

// Draws window.VIEW_PAGE.data into .board as folder tabs (All, Ranked, Unsorted) over one panel
// holding two sections, ranked then unranked. Several cards may be open; each section's first open
// card starts open. The Ranked heading carries the All groups switch: on, every group shows; off,
// a chip per group shows that group when pressed, every chip pressed at first and the selection kept
// across toggles. Turning it off breaks the chips out of a cluster behind the switch; turning it on
// plays the same motion in reverse, then hides them. Each card not yet deferred carries a Defer
// button, enabled once the listener answers /health within 2 s; a click posts the page's api block
// and, on 200, collapses and fades the card in place. A failure shows on the card.
// Two more sections, Discarded and Suggested, show under All only, having no tab of their own: one
// line per thread, a discarded one struck with a Restore link that copies "restore loose thread #N".
// Everything drawn at load uses only element creation, attributes, classList.add and plain
// properties; measuring and animating happen on a click.
const PAGE_SCRIPT = String.raw`(function () {
  "use strict";
  var view = window.VIEW_PAGE;
  if (!view) return;
  var data = view.data;
  var api = data.api;
  var base = "http://127.0.0.1:" + api.port;
  var header = document.querySelector("header");
  var board = document.querySelector(".board");
  var deferButtons = [];
  var colour = {};
  data.groups.forEach(function (g) { colour[g.key] = g.colour; });

  function el(tag, cls, text) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function showError(node, message) {
    var line = node.querySelector(".error");
    if (!line) {
      line = el("p", "error");
      node.appendChild(line);
    }
    line.textContent = message;
  }

  function defer(c, button) {
    button.disabled = true;
    fetch(base + "/seeds/" + c.idea.id + "/defer", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ db_path: api.db_path, proceeding_id: api.proceeding_id, token: api.token })
    }).then(function (res) {
      return res.json().then(function (body) { return { ok: res.ok, body: body }; }, function () { return { ok: false, body: { error: "The listener answered " + res.status + "." } }; });
    }).then(function (reply) {
      if (reply.ok) {
        c.node.classList.add("deferred");
        c.node.removeChild(button);
        c.set(false);
        c.inert = true;
        c.text.tabIndex = -1;
        return;
      }
      button.disabled = false;
      showError(c.node, "Not deferred: " + (reply.body.error || reply.body.outcome || "the listener refused it") + ".");
    }, function () {
      button.disabled = false;
      showError(c.node, "Not deferred: the listener did not answer. Buttons need the Claude desktop app running.");
    });
  }

  // A card: its job description, or the idea when it has none, which toggles it and ends in its
  // tags, then its body, which opens with the idea when the job description stood in for it.
  function ideaCard(i) {
    var node = el("article", i.deferred_at ? "idea deferred" : "idea");
    var text = el("p", "text");
    var body = el("div", "body");
    var c = { node: node, idea: i, text: text, inert: !!i.deferred_at, open: false };
    c.set = function (on) {
      c.open = on;
      node.setAttribute("data-open", String(on));
      text.setAttribute("aria-expanded", String(on));
      body.hidden = !on;
    };
    if (!c.inert) {
      var button = el("button", "defer", "Defer");
      button.type = "button";
      button.title = "Defer indefinitely";
      button.disabled = true;
      button.addEventListener("click", function () { defer(c, button); });
      node.appendChild(button);
      deferButtons.push(button);
    }
    text.setAttribute("role", "button");
    text.tabIndex = c.inert ? -1 : 0;
    text.appendChild(document.createTextNode(i.job || i.idea));
    text.appendChild(document.createTextNode(" "));
    var tags = el("span", "tags");
    var rank = el("span", "tag rank", i.rank === null ? "?" : String(i.rank));
    if (i.rank === null) rank.title = "Unsorted";
    tags.appendChild(rank);
    if (i.rank !== null && i.group_label) {
      var group = el("span", "tag group", i.group_label);
      group.setAttribute("style", "--g:" + colour[i.group]);
      tags.appendChild(group);
    }
    text.appendChild(tags);
    node.appendChild(text);
    if (i.job) body.appendChild(el("p", "thought", "Loose thought: " + i.idea));
    if (i.reason) body.appendChild(el("p", "why", i.reason));
    body.appendChild(el("p", "where", "Loose thread " + i.id + " · " + i.surfaced_by + (i.origin ? "; " + i.origin : "")));
    node.appendChild(body);
    text.addEventListener("click", function () { if (!c.inert) c.set(!c.open); });
    text.addEventListener("keydown", function (e) {
      if (c.inert || (e.key !== "Enter" && e.key !== " ")) return;
      e.preventDefault();
      c.set(!c.open);
    });
    c.set(false);
    return c;
  }

  // A thread that left the board, as a section's inert card: a discarded one struck, with a Restore
  // link that only copies the instruction to paste into a session, and a suggested one plain.
  function discardedSeedLine(d) {
    if (!d.discarded_at) return { node: el("p", "suggested", "Loose thread " + d.id + ":  " + d.idea + " *SUGGESTED*"), inert: true };
    var line = el("p", "deleted");
    line.appendChild(el("s", "", "Loose thread " + d.id + ":  " + d.idea));
    line.appendChild(document.createTextNode(" *DISCARDED* "));
    var restore = el("a", "", "Restore");
    restore.href = "#";
    var instruction = "restore loose thread #" + d.id;
    // Where the clipboard is out of reach, the instruction itself is shown, to select and copy by hand.
    function showInstruction() { restore.textContent = instruction; }
    restore.addEventListener("click", function (event) {
      event.preventDefault();
      if (!navigator.clipboard || !navigator.clipboard.writeText) { showInstruction(); return; }
      navigator.clipboard.writeText(instruction).then(function () {
        restore.textContent = "Copied";
        setTimeout(function () { restore.textContent = "Restore"; }, 1500);
      }, showInstruction);
    });
    line.appendChild(restore);
    return { node: line, inert: true };
  }

  var tablist = el("div", "tabs");
  tablist.setAttribute("role", "tablist");
  tablist.setAttribute("aria-label", "Show");
  board.appendChild(tablist);
  var folder = el("div", "folder");
  folder.id = "loose-threads-panel";
  folder.setAttribute("role", "tabpanel");
  board.appendChild(folder);

  // One section: its heading, whatever sits under the heading, and its cards, the first open.
  var sections = {};
  function section(name, heading, under, cards) {
    var sec = el("section");
    var h2 = el("h2", "", heading);
    sec.appendChild(h2);
    under.forEach(function (node) { sec.appendChild(node); });
    var stack = el("div", "stack");
    cards.forEach(function (c) { stack.appendChild(c.node); });
    sec.appendChild(stack);
    folder.appendChild(sec);
    var first = cards.filter(function (c) { return !c.inert; })[0];
    if (first) first.set(true);
    sections[name] = { node: sec, h2: h2, cards: cards };
  }

  var allGroups = true;
  var picked = {};
  data.groups.forEach(function (g) { picked[g.key] = true; });
  var chips = el("div", "chips");
  chips.setAttribute("role", "group");
  chips.setAttribute("aria-label", "Groups");
  chips.hidden = true;
  var chipButtons = data.groups.map(function (g) {
    var b = el("button", "chip");
    b.type = "button";
    b.setAttribute("style", "--g:" + g.colour);
    b.setAttribute("aria-pressed", "true");
    b.appendChild(el("span", "", g.label));
    b.appendChild(el("span", "n", String(g.count)));
    b.addEventListener("click", function () {
      picked[g.key] = !picked[g.key];
      b.setAttribute("aria-pressed", String(picked[g.key]));
      apply();
    });
    chips.appendChild(b);
    return b;
  });
  var noGroups = el("p", "empty", "No groups selected. Choose a group above, or turn on All groups.");
  noGroups.hidden = true;

  var rankedCards = data.ideas.filter(function (i) { return i.rank !== null; }).map(ideaCard);
  section("ranked", "Ranked", [chips, noGroups], rankedCards);
  section("unsorted", "Unsorted", [el("p", "note", "Captured since the last ranking.")], data.ideas.filter(function (i) { return i.rank === null; }).map(ideaCard));
  section("discarded", "Discarded", [], data.discarded.filter(function (d) { return d.discarded_at; }).map(discardedSeedLine));
  section("suggested", "Suggested", [], data.discarded.filter(function (d) { return !d.discarded_at; }).map(discardedSeedLine));
  var empty = el("p", "empty", data.ideas.length === 0 ? "No open loose threads." : "No loose thread under this tab.");
  folder.appendChild(empty);

  var toggle = el("button", "switch");
  toggle.type = "button";
  toggle.setAttribute("role", "switch");
  toggle.setAttribute("aria-checked", "true");
  toggle.appendChild(el("span", "label", "All groups"));
  var track = el("span", "track");
  track.appendChild(el("span", "knob"));
  toggle.appendChild(track);
  if (rankedCards.length > 0) sections.ranked.h2.appendChild(toggle);

  // The break-out: every chip from a small cluster behind the switch to its place, at once, with
  // the row's height on the same timing. Reversed, the same motion gathers them back.
  var JITTER = [[-6, -3], [5, 2], [-2, 4], [7, -4], [-5, 5], [3, -5], [0, 1]];
  var EASE = "cubic-bezier(.12,.82,.22,1)";
  var running = [];
  function burst(reverse, done) {
    running.forEach(function (a) { a.onfinish = null; a.cancel(); });
    running = [];
    var still = !chips.animate || (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
    if (still) { done(); return; }
    var s = toggle.getBoundingClientRect();
    var sx = s.left + s.width / 2;
    var sy = s.top + s.height / 2;
    var timing = { duration: 780, easing: EASE, direction: reverse ? "reverse" : "normal" };
    running = chipButtons.map(function (b, n) {
      var r = b.getBoundingClientRect();
      var j = JITTER[n % JITTER.length];
      var dx = sx - (r.left + r.width / 2) + j[0];
      var dy = sy - (r.top + r.height / 2) + j[1];
      return b.animate([{ transform: "translate(" + dx + "px," + dy + "px) scale(.85)" }, { transform: "none" }], timing);
    });
    running.push(chips.animate([{ height: "0px" }, { height: chips.offsetHeight + "px" }], timing));
    running[running.length - 1].onfinish = function () { running = []; done(); };
  }
  toggle.addEventListener("click", function () {
    allGroups = !allGroups;
    toggle.setAttribute("aria-checked", String(allGroups));
    if (allGroups) {
      burst(true, function () { chips.hidden = true; });
    } else {
      chips.hidden = false;
      burst(false, function () {});
    }
    apply();
  });

  var TABS = [["all", "All"], ["ranked", "Ranked"], ["unsorted", "Unsorted"]];
  var tabs = TABS.map(function (t) {
    var b = el("button", "", t[1]);
    b.type = "button";
    b.id = "tab-" + t[0];
    b.setAttribute("role", "tab");
    b.setAttribute("aria-controls", folder.id);
    b.setAttribute("data-filter", t[0]);
    tablist.appendChild(b);
    return b;
  });

  var current = "all";
  function apply() {
    rankedCards.forEach(function (c) { c.node.hidden = !allGroups && !picked[c.idea.group]; });
    noGroups.hidden = allGroups || data.groups.some(function (g) { return picked[g.key]; });
    var any = false;
    Object.keys(sections).forEach(function (name) {
      var on = (current === "all" || current === name) && sections[name].cards.length > 0;
      sections[name].node.hidden = !on;
      if (on) any = true;
    });
    tabs.forEach(function (b) {
      var on = b.getAttribute("data-filter") === current;
      b.setAttribute("aria-selected", String(on));
      b.tabIndex = on ? 0 : -1;
      if (on) folder.setAttribute("aria-labelledby", b.id);
    });
    empty.hidden = any;
  }
  function select(b) {
    current = b.getAttribute("data-filter");
    apply();
  }
  tabs.forEach(function (b, i) {
    b.addEventListener("click", function () { select(b); });
    b.addEventListener("keydown", function (e) {
      var step = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
      if (step === 0) return;
      e.preventDefault();
      var next = tabs[(i + step + tabs.length) % tabs.length];
      select(next);
      next.focus();
    });
  });
  apply();

  if (deferButtons.length > 0) {
    var abort = new AbortController();
    var timer = setTimeout(function () { abort.abort(); }, 2000);
    fetch(base + "/health", { signal: abort.signal }).then(function (res) {
      return res.ok ? res.json() : null;
    }).then(function (body) {
      clearTimeout(timer);
      if (!body || body.ok !== true) throw new Error("no listener");
      deferButtons.forEach(function (b) { b.disabled = false; });
    }).catch(function () {
      clearTimeout(timer);
      header.appendChild(el("p", "api-off", "Buttons need the Claude desktop app running."));
    });
  }
})();
`;

/** The page's name. A filing's Job Board names it, in plain text, in its Loose Threads section (workboard-shell.ts).
 * Before 2026-10-08 it was "Loose Ideas"; the page write moves an old file to TRASH (matter-pages.ts OLD_PAGE). */
export const LOOSE_THREADS_PAGE_NAME = "Loose Threads";

/** The page's view-page registry entry (../view-pages.ts VIEW_PAGES). */
export const LOOSE_IDEAS_PAGE: ViewPage = {
  name: LOOSE_THREADS_PAGE_NAME,
  css: PAGE_CSS,
  script: PAGE_SCRIPT,
  data: (ctx) => buildLooseIdeasData(ctx.dbPath, ctx.filing),
  metaExtra: looseIdeasMeta,
};
