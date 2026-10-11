// An RTF body's text and highlight runs. Two shapes reach here from a .msg:
// - HTML mail that Outlook encapsulated in RTF (\fromhtml1, [MS-OXRTFEX]): the original HTML is
//   rebuilt from the \*\htmltag groups and the text between them, \htmlrtf regions skipped, and the
//   highlights then come from html.ts;
// - native RTF mail: text and \highlightN / \cbN / \chcbpatN runs against the \colortbl.

import { colourName, type HighlightRun, mergeRuns } from "./highlight.js";

interface State {
  skip: boolean;
  htmlTag: boolean;
  htmlRtf: boolean;
  highlight: number;
  cb: number;
  uc: number;
}

/** Destinations whose text is never body text. */
const SKIP_DESTINATIONS = new Set([
  "fonttbl", "colortbl", "stylesheet", "info", "pict", "header", "footer", "headerl", "headerr",
  "footerl", "footerr", "object", "listtable", "listoverridetable", "rsidtbl", "generator", "xmlnstbl",
  "themedata", "colorschememapping", "latentstyles", "datastore", "fldinst", "pntext", "pntxta", "pntxtb",
]);

export interface RtfReading {
  /** The rebuilt HTML when the body is encapsulated HTML, else undefined. */
  html?: string;
  text: string;
  highlights: HighlightRun[];
}

export function readRtf(rtf: Buffer): RtfReading {
  const src = rtf.toString("latin1");
  const fromHtml = /\\fromhtml1/.test(src.slice(0, 2048));
  let decoder = textDecoder(1252);

  const colours: string[] = [];
  let colourR = 0;
  let colourG = 0;
  let colourB = 0;
  let inColourTable = false;

  const stack: State[] = [];
  let st: State = { skip: false, htmlTag: false, htmlRtf: false, highlight: 0, cb: 0, uc: 1 };
  let groupStart = false;

  let html = "";
  const runs: HighlightRun[] = [];
  let pendingBytes: number[] = [];
  let skipChars = 0;

  const colourOf = (): string | null => {
    const idx = st.highlight || st.cb;
    if (!idx) return null;
    const rgb = colours[idx];
    return rgb ? colourName(rgb) : null;
  };
  const emitText = (text: string) => {
    if (!text || st.skip) return;
    if (fromHtml) {
      if (st.htmlRtf && !st.htmlTag) return;
      html += st.htmlTag ? text : escapeHtml(text);
      return;
    }
    runs.push({ text, colour: colourOf() ?? "" });
  };
  const flushBytes = () => {
    if (pendingBytes.length === 0) return;
    const text = decoder.decode(Buffer.from(pendingBytes));
    pendingBytes = [];
    emitText(text);
  };

  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (ch === "{") {
      flushBytes();
      stack.push(st);
      st = { ...st };
      groupStart = true;
      i += 1;
      continue;
    }
    if (ch === "}") {
      flushBytes();
      if (inColourTable && st.skip && stack.length > 0 && !stack[stack.length - 1].skip) inColourTable = false;
      st = stack.pop() ?? st;
      groupStart = false;
      i += 1;
      continue;
    }
    if (ch === "\\") {
      const next = src[i + 1];
      if (next === "'") {
        const byte = parseInt(src.slice(i + 2, i + 4), 16);
        i += 4;
        if (skipChars > 0) {
          skipChars -= 1;
          continue;
        }
        if (!Number.isNaN(byte)) pendingBytes.push(byte);
        continue;
      }
      flushBytes();
      if (next === "*") {
        i += 2;
        // \*\htmltag is kept; every other optional destination is skipped.
        const m = /^\\(htmltag|mhtmltag)(-?\d+)? ?/.exec(src.slice(i, i + 32));
        if (m && m[1] === "htmltag") {
          st.htmlTag = true;
          i += m[0].length;
        } else {
          st.skip = true;
        }
        groupStart = false;
        continue;
      }
      if (next === "\\" || next === "{" || next === "}") {
        emitLiteral(next);
        i += 2;
        continue;
      }
      if (next === "~") {
        emitLiteral("\u00a0");
        i += 2;
        continue;
      }
      if (next === "\r" || next === "\n") {
        emitLiteral("\n");
        i += 2;
        continue;
      }
      const m = /^\\([a-zA-Z]+)(-?\d+)? ?/.exec(src.slice(i, i + 40));
      if (!m) {
        i += 2;
        continue;
      }
      i += m[0].length;
      const word = m[1];
      const param = m[2] === undefined ? undefined : Number(m[2]);
      const wasGroupStart = groupStart;
      groupStart = false;
      if (wasGroupStart && SKIP_DESTINATIONS.has(word)) {
        st.skip = true;
        if (word === "colortbl") {
          inColourTable = true;
          colours.length = 0;
          colourR = colourG = colourB = 0;
        }
        continue;
      }
      if (inColourTable) {
        if (word === "red") colourR = param ?? 0;
        else if (word === "green") colourG = param ?? 0;
        else if (word === "blue") colourB = param ?? 0;
        continue;
      }
      switch (word) {
        case "ansicpg":
          if (param) decoder = textDecoder(param);
          break;
        case "htmlrtf":
          st.htmlRtf = param !== 0;
          break;
        case "highlight":
          st.highlight = param ?? 0;
          break;
        case "cb":
        case "chcbpat":
          st.cb = param ?? 0;
          break;
        case "plain":
          st.highlight = 0;
          st.cb = 0;
          break;
        case "uc":
          st.uc = param ?? 1;
          break;
        case "u": {
          const code = param === undefined ? 0 : param < 0 ? param + 65536 : param;
          emitLiteral(String.fromCharCode(code));
          skipChars = st.uc;
          break;
        }
        case "par":
        case "line":
          emitLiteral(fromHtml && !st.htmlTag ? "\r\n" : "\n");
          break;
        case "tab":
          emitLiteral("\t");
          break;
        case "emdash":
          emitLiteral("\u2014");
          break;
        case "endash":
          emitLiteral("\u2013");
          break;
        case "lquote":
          emitLiteral("\u2018");
          break;
        case "rquote":
          emitLiteral("\u2019");
          break;
        case "ldblquote":
          emitLiteral("\u201c");
          break;
        case "rdblquote":
          emitLiteral("\u201d");
          break;
        case "bullet":
          emitLiteral("\u2022");
          break;
        default:
          break;
      }
      continue;
    }
    if (ch === ";" && inColourTable) {
      colours.push(`${hex(colourR)}${hex(colourG)}${hex(colourB)}`);
      colourR = colourG = colourB = 0;
      i += 1;
      continue;
    }
    groupStart = false;
    if (ch === "\r" || ch === "\n") {
      i += 1;
      continue;
    }
    // A run of plain characters.
    let j = i;
    while (j < src.length && !"\\{}\r\n".includes(src[j]) && !(inColourTable && src[j] === ";")) j += 1;
    let chunk = src.slice(i, j);
    i = j;
    if (skipChars > 0) {
      const drop = Math.min(skipChars, chunk.length);
      chunk = chunk.slice(drop);
      skipChars -= drop;
    }
    for (const c of chunk) pendingBytes.push(c.charCodeAt(0));
  }
  flushBytes();

  function emitLiteral(text: string): void {
    flushBytes();
    if (skipChars > 0) {
      skipChars -= 1;
      return;
    }
    emitText(text);
  }

  if (fromHtml) return { html, text: "", highlights: [] };
  const text = runs.map((r) => r.text).join("");
  return { text, highlights: mergeRuns(runs) };
}

function hex(n: number): string {
  return Math.max(0, Math.min(255, n)).toString(16).padStart(2, "0");
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function textDecoder(codepage: number): TextDecoder {
  const label = codepage === 65001 ? "utf-8" : codepage === 1200 ? "utf-16le" : `windows-${codepage}`;
  try {
    return new TextDecoder(label);
  } catch {
    return new TextDecoder("windows-1252");
  }
}
