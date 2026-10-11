// An HTML mail body's text and highlight runs. A run is highlighted by an inline element (span,
// mark, font and the like) whose style carries mso-highlight or a background colour, or by <mark>.
// A block's background (a table cell, a signature box) is layout, not a highlight, and is ignored.

import { colourName, type HighlightRun, mergeRuns } from "./highlight.js";

const INLINE = new Set(["span", "mark", "font", "b", "strong", "i", "em", "u", "a", "s", "sub", "sup", "small", "big", "code"]);
const VOID = new Set(["br", "img", "hr", "meta", "link", "input", "col", "area", "base", "wbr", "source"]);
const BLOCK = new Set(["p", "div", "li", "tr", "h1", "h2", "h3", "h4", "h5", "h6", "blockquote", "table", "ul", "ol", "pre"]);
const HIDDEN = new Set(["head", "style", "script", "title", "xml"]);

const ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: "\u00a0", rsquo: "\u2019", lsquo: "\u2018",
  rdquo: "\u201d", ldquo: "\u201c", ndash: "\u2013", mdash: "\u2014", hellip: "\u2026", sect: "\u00a7",
  para: "\u00b6", copy: "\u00a9", eacute: "\u00e9", egrave: "\u00e8", agrave: "\u00e0", ccedil: "\u00e7",
};

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, body: string) => {
    if (body[0] === "#") {
      const code = body[1] === "x" || body[1] === "X" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    return ENTITIES[body.toLowerCase()] ?? whole;
  });
}

function highlightOf(name: string, attrs: string): string | null | undefined {
  const style = /\bstyle\s*=\s*("([^"]*)"|'([^']*)')/i.exec(attrs);
  const css = style ? decodeEntities(style[2] ?? style[3] ?? "") : "";
  const mso = /mso-highlight\s*:\s*([^;]+)/i.exec(css);
  if (mso) return colourName(mso[1]);
  const bg = /background(?:-color)?\s*:\s*([^;]+)/i.exec(css);
  if (bg) return colourName(bg[1].split(/\s+(?![^(]*\))/)[0]);
  if (name === "mark") return "yellow";
  return undefined;
}

export interface HtmlReading {
  text: string;
  highlights: HighlightRun[];
}

export function readHtml(html: string): HtmlReading {
  const stack: { name: string; colour: string | null | undefined }[] = [];
  const runs: HighlightRun[] = [];
  let hidden = 0;
  const current = (): string => {
    for (let k = stack.length - 1; k >= 0; k -= 1) {
      const c = stack[k].colour;
      if (c !== undefined) return c ?? "";
    }
    return "";
  };
  const push = (text: string) => {
    if (hidden === 0 && text) runs.push({ text, colour: current() });
  };

  const token = /<!--[\s\S]*?-->|<!\[[\s\S]*?\]>|<!(?:[^>]*)>|<\/?([a-zA-Z][\w:-]*)([^>]*)>|([^<]+)|</g;
  let m: RegExpExecArray | null;
  while ((m = token.exec(html)) !== null) {
    if (m[3] !== undefined) {
      push(decodeEntities(m[3].replace(/[\r\n\t ]+/g, " ")));
      continue;
    }
    if (m[1] === undefined) continue;
    const name = m[1].toLowerCase().replace(/^o:/, "");
    const closing = m[0][1] === "/";
    if (HIDDEN.has(name)) {
      if (closing) hidden = Math.max(0, hidden - 1);
      else if (!m[0].endsWith("/>")) hidden += 1;
      continue;
    }
    if (name === "br") {
      push("\n");
      continue;
    }
    if (BLOCK.has(name)) push("\n");
    if (VOID.has(name) || m[0].endsWith("/>")) continue;
    if (closing) {
      const at = stack.map((e) => e.name).lastIndexOf(name);
      if (at >= 0) stack.length = at;
      continue;
    }
    stack.push({ name, colour: INLINE.has(name) ? highlightOf(name, m[2]) : undefined });
  }

  const text = runs
    .map((r) => r.text)
    .join("")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]*\n[ \t]*/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { text, highlights: mergeRuns(runs) };
}
