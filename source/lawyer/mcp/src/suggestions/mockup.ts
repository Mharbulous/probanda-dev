// A suggestion card's mockup (docs/Plans/2026-10-25_suggestion-design.md, decisions 24 to 26).
//
// The mockup is one self-contained HTML file: inline styles only, no script, no link, no external
// resource, under 1 MB. Its visible text is only Probanda's fixed placeholder text, the shipped set in
// the suggestion skill's tree (PLACEHOLDERS_DIR), each piece used whole, and none of it matches the
// date, amount, email or path patterns. checkMockup refuses anything else, naming the rule broken and
// never the text. Those bytes are what travels with the suggestion, and only while the mockup is the
// one on the card at the click (card.ts).
//
// The practitioner sees the mockup through a page of its own, `Suggestion-<id>-mockup-<n>.html` beside
// the card, a file Probanda creates (Commandment 7). That page shows the mockup in an iframe sandboxed
// with no permissions, its srcdoc the checked bytes, under the visual items it shows, and carries the
// "Not like this, because..." box, whose text the page posts through the page API
// (../page-api/server.ts) with the card's token. Only the bytes inside the frame travel.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { DataServerError } from "../errors.js";
import { resolveShippedRoot } from "../repo-root.js";
import { findPatterns } from "./crosscheck.js";

/** The shipped placeholder set, under the suggestion skill's tree. */
export const PLACEHOLDERS_DIR = "suggestion/references/mockup";
export const PLACEHOLDERS_FILE = "placeholders.txt";
export const MAX_MOCKUP_BYTES = 1_000_000;

const normal = (text: string) => text.replace(/\s+/g, " ").trim();

/** The lines of a placeholder file, `#` starting a comment line. */
export function parsePlaceholders(text: string): string[] {
  return text.split(/\r?\n/).map(normal).filter((line) => line !== "" && !line.startsWith("#"));
}

/** The shipped placeholder set. Refused when the file is missing: a mockup could not be checked without it. */
export function loadPlaceholders(env: NodeJS.ProcessEnv = process.env, installRoot?: string): string[] {
  const root = resolveShippedRoot(PLACEHOLDERS_DIR, env, { subject: "the suggestion mockup placeholders", plugin: "lawyer", installRoot }).root;
  const path = join(root, ...PLACEHOLDERS_DIR.split("/"), PLACEHOLDERS_FILE);
  if (!existsSync(path)) throw new DataServerError("The suggestion mockup is missing its placeholder text. Update the lawyer plugin.", "placeholders_missing");
  return parsePlaceholders(readFileSync(path, "utf-8"));
}

// Anything that would make the page load or run something (decision 26), as the cloud's own check
// refuses it (cloud/legal-commons/supabase/functions/suggestion-submit/shape.ts), plus forms,
// inline event handlers, javascript: and any url().
const REFUSED: Array<[RegExp, string]> = [
  [/<script/i, "a script"],
  [/<link/i, "a link element"],
  [/<a[\s>][^>]*\bhref/i, "a link"],
  [/<(?:iframe|frame|object|embed|form|base|img|video|audio|source|svg|math)\b/i, "an embedded or loading element"],
  [/\bsrc\s*=/i, "a src attribute"],
  [/\bhref\s*=/i, "an href attribute"],
  [/\bon[a-z]+\s*=/i, "an event handler"],
  [/@import/i, "a stylesheet import"],
  [/url\s*\(/i, "a url()"],
  [/javascript:/i, "a script address"],
  [/http/i, "an address"],
];

const ALLOWED_TAGS = new Set([
  "html", "head", "body", "meta", "title", "style",
  "main", "header", "footer", "section", "article", "aside", "nav",
  "div", "span", "p", "h1", "h2", "h3", "h4", "h5", "h6",
  "ul", "ol", "li", "dl", "dt", "dd",
  "table", "thead", "tbody", "tfoot", "tr", "th", "td", "caption", "colgroup", "col",
  "strong", "em", "b", "i", "u", "s", "small", "sup", "sub", "mark", "blockquote",
  "br", "hr", "button", "label",
]);

// Attributes that carry no text: a style, a class of plain names, table spans, a page's charset.
const ALLOWED_ATTRIBUTES: Record<string, RegExp> = {
  style: /^[^<>]*$/,
  class: /^[a-z][a-z0-9 _-]*$/i,
  colspan: /^\d{1,2}$/,
  rowspan: /^\d{1,2}$/,
  charset: /^utf-8$/i,
  lang: /^[a-z]{2}(?:-[a-z]{2})?$/i,
};

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "–", mdash: "—", bull: "•" };

function decode(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, name: string) => {
    if (name[0] === "#") {
      const code = name[1] === "x" || name[1] === "X" ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    return ENTITIES[name.toLowerCase()] ?? whole;
  });
}

export interface MockupProblem {
  /** What is wrong, in a few words; never the text found. */
  problem: string;
}

/** Every piece of visible text in `html`, as it would read: tags, styles, comments and the doctype removed. */
export function visibleTexts(html: string): string[] {
  const stripped = html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<!doctype[^>]*>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, " ");
  return stripped.split(/<[^>]*>/).map((piece) => normal(decode(piece))).filter((piece) => piece !== "");
}

/** What is wrong with `html` as a mockup, or null when nothing is. The first problem found only. */
export function checkMockup(html: unknown, placeholders: string[]): MockupProblem | null {
  if (typeof html !== "string" || !html.trim()) return { problem: "the mockup is empty" };
  if (Buffer.byteLength(html, "utf-8") > MAX_MOCKUP_BYTES) return { problem: "the mockup is over 1 MB" };
  for (const [pattern, what] of REFUSED) if (pattern.test(html)) return { problem: `the mockup holds ${what}` };
  const withoutComments = html.replace(/<!--[\s\S]*?-->/g, " ").replace(/<!doctype[^>]*>/gi, " ");
  for (const tag of withoutComments.matchAll(/<\/?([a-zA-Z][a-zA-Z0-9]*)([^>]*)>/g)) {
    const name = tag[1].toLowerCase();
    if (!ALLOWED_TAGS.has(name)) return { problem: `the mockup holds a <${name}> element, which a mockup may not use` };
    if (tag[0].startsWith("</")) continue;
    for (const attr of tag[2].matchAll(/([^\s=/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) {
      const attrName = attr[1].toLowerCase();
      const value = attr[2] ?? attr[3] ?? attr[4] ?? "";
      const allowed = ALLOWED_ATTRIBUTES[attrName];
      if (!allowed || !allowed.test(value)) return { problem: `the mockup holds a ${attrName} attribute, which a mockup may not use` };
    }
  }
  // A style may set how text looks, never add text of its own.
  if (/(?<![\w-])content\s*:/i.test(html)) return { problem: "the mockup's styles add text of their own" };
  const allowed = new Set(placeholders.map(normal));
  if (visibleTexts(html).some((piece) => !allowed.has(piece))) {
    return { problem: "the mockup holds text that is not Probanda's placeholder text" };
  }
  const patterns = findPatterns(html);
  if (patterns.length) return { problem: `the mockup holds what reads as ${patterns[0].kind === "amount" ? "an amount" : `a ${patterns[0].kind}`}` };
  return null;
}

// ---- the page the practitioner sees ----

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

const STYLE =
  ":root{--bg:#fafafa;--fg:#222;--muted:#555;--line:#ccc;--accent:#2f5f8a;--warn:#a00}" +
  "@media (prefers-color-scheme: dark){:root{--bg:#1e1e1e;--fg:#eee;--muted:#aaa;--line:#555;--accent:#8fb8e0;--warn:#f88}}" +
  "body{font-family:system-ui,sans-serif;margin:0;padding:16px;background:var(--bg);color:var(--fg)}" +
  "main{max-width:60rem;margin:0 auto}h1{font-size:1.3rem}.note{color:var(--muted);font-size:.9rem}" +
  ".frame{width:100%;height:36rem;border:1px solid var(--line);background:#fff}" +
  "textarea{width:100%;min-height:4rem;font:inherit;box-sizing:border-box}" +
  "button{padding:.4rem 1rem;font-size:1rem;margin-top:.5rem}.feedback{min-height:1.2em;font-size:.9rem}.feedback.error{color:var(--warn)}" +
  ".done{opacity:.55}";

const SCRIPT = `
(function () {
  var api = JSON.parse(document.getElementById("api").textContent);
  var base = "http://127.0.0.1:" + api.port;
  var box = document.getElementById("reason");
  var button = document.getElementById("reject");
  var feedback = document.getElementById("feedback");
  function say(text, error) { feedback.textContent = text; feedback.className = error ? "feedback error" : "feedback"; }
  button.addEventListener("click", function () {
    var reason = box.value.trim();
    if (!reason) { say("Say what is wrong with this mockup first.", true); box.focus(); return; }
    button.disabled = true;
    button.textContent = "Sending to your suggestion...";
    fetch(base + "/cards/" + encodeURIComponent(api.card) + "/reject", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: api.token, mockup: api.mockup, reason: reason })
    }).then(function (r) { return r.json(); }).then(function (reply) {
      if (reply && reply.outcome === "rejected") {
        document.querySelector("main").className = "done";
        box.disabled = true;
        button.textContent = "Added to your suggestion";
        say("Your reason is now a line on your suggestion." + (reply.mockup_available ? " You can ask for another mockup there." : ""), false);
        return;
      }
      button.disabled = false;
      button.textContent = "Not like this";
      say(reply && reply.outcome === "gone" ? "This mockup is no longer on your suggestion." : "That did not work. Open your suggestion and try again.", true);
    }).catch(function () {
      button.disabled = false;
      button.textContent = "Not like this";
      say("This works while Claude is open on this computer. Open Claude and try again.", true);
    });
  });
})();
`;

/** The page that shows mockup `n` of a card, with its "Not like this, because..." box. */
export function renderMockupPage(opts: { cardId: string; n: number; html: string; items: string[]; port: number; token: string }): string {
  const api = JSON.stringify({ port: opts.port, card: opts.cardId, mockup: opts.n, token: opts.token }).replace(/</g, "\\u003c");
  const items = opts.items.length ? `<ul class="items">${opts.items.map((t) => `<li>${escapeHtml(t)}</li>`).join("")}</ul>` : "";
  return (
    '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">' +
    `<meta http-equiv="Content-Security-Policy" content="script-src 'unsafe-inline'; connect-src http://127.0.0.1:${opts.port}; object-src 'none'; base-uri 'none'; form-action 'none'">` +
    `<title>Mockup</title><style>${STYLE}</style></head><body><main>` +
    "<h1>Mockup</h1>" +
    '<p class="note">How the page could look with these changes, shown with placeholder text:</p>' +
    items +
    `<iframe class="frame" sandbox="" title="Mockup" srcdoc="${escapeHtml(opts.html)}"></iframe>` +
    '<label for="reason"><p>Not like this, because...</p></label>' +
    '<textarea id="reason" placeholder="Please don\'t name clients, matters, people or files."></textarea>' +
    '<button type="button" id="reject">Not like this</button><p class="feedback" id="feedback" role="status"></p>' +
    `</main><script type="application/json" id="api">${api}</script><script>${SCRIPT}</script></body></html>`
  );
}
