// A reply draft's markdown as a plain .docx that pastes into Outlook with its formatting: Calibri
// 11, no letterhead, **bold** (a paragraph that opens bold is a run-in heading), *italic* or _italic_
// (case names), "> " quotations indented both sides, "- " and "1. " lists with a hanging indent, and
// single line breaks kept. Nothing else of markdown is interpreted: the text is the practitioner's.

import { zipParts } from "./zip.js";

const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const QUOTE_INDENT = 720;
const LIST_INDENT = 360;

interface Run {
  text: string;
  bold: boolean;
  italic: boolean;
}

type Block =
  | { kind: "para"; lines: string[] }
  | { kind: "quote"; lines: string[] }
  | { kind: "item"; marker: string; text: string };

function escapeXml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

const WORD = /[\p{L}\p{N}]/u;

/** Inline emphasis: ** toggles bold; * or _ toggles italic at a word edge; \ escapes the next character. */
export function inlineRuns(text: string): Run[] {
  const runs: Run[] = [];
  let bold = false;
  let italic = false;
  let buf = "";
  const flush = () => {
    if (buf) runs.push({ text: buf, bold, italic });
    buf = "";
  };
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (c === "\\" && i + 1 < text.length && "\\*_`#>-".includes(text[i + 1])) {
      buf += text[i + 1];
      i += 1;
      continue;
    }
    if (c === "*" && text[i + 1] === "*") {
      flush();
      bold = !bold;
      i += 1;
      continue;
    }
    if (c === "*" || c === "_") {
      const prev = text[i - 1] ?? " ";
      const next = text[i + 1] ?? " ";
      const opens = !italic && !/\s/.test(next) && (c === "*" || !WORD.test(prev));
      const closes = italic && !/\s/.test(prev) && (c === "*" || !WORD.test(next));
      if (opens || closes) {
        flush();
        italic = !italic;
        continue;
      }
    }
    buf += c;
  }
  flush();
  return runs;
}

export function blocks(markdown: string): Block[] {
  const out: Block[] = [];
  let para: string[] = [];
  let quote: string[] = [];
  const endPara = () => {
    if (para.length) out.push({ kind: "para", lines: para });
    para = [];
  };
  const endQuote = () => {
    if (quote.length) out.push({ kind: "quote", lines: quote });
    quote = [];
  };
  for (const raw of markdown.replace(/\r\n?/g, "\n").split("\n")) {
    const line = raw.replace(/\s+$/, "");
    const q = /^\s{0,3}>\s?(.*)$/.exec(line);
    if (q) {
      endPara();
      if (q[1].trim() === "") endQuote();
      else quote.push(q[1]);
      continue;
    }
    endQuote();
    if (line.trim() === "") {
      endPara();
      continue;
    }
    const item = /^\s{0,3}([-*•]|\d+[.)])\s+(.*)$/.exec(line);
    if (item) {
      endPara();
      out.push({ kind: "item", marker: /\d/.test(item[1]) ? item[1] : "•", text: item[2] });
      continue;
    }
    const heading = /^#{1,6}\s+(.*)$/.exec(line);
    para.push(heading ? `**${heading[1]}**` : line);
  }
  endPara();
  endQuote();
  return out;
}

function runXml(run: Run): string {
  const props = `${run.bold ? "<w:b/>" : ""}${run.italic ? "<w:i/>" : ""}`;
  return `<w:r>${props ? `<w:rPr>${props}</w:rPr>` : ""}<w:t xml:space="preserve">${escapeXml(run.text)}</w:t></w:r>`;
}

function linesXml(lines: string[]): string {
  return lines.map((line) => inlineRuns(line).map(runXml).join("")).join("<w:r><w:br/></w:r>");
}

/** A list item sits tight against the next item; the last item of a list keeps the paragraph gap. */
function blockXml(block: Block, next: Block | undefined): string {
  if (block.kind === "quote") {
    return `<w:p><w:pPr><w:ind w:left="${QUOTE_INDENT}" w:right="${QUOTE_INDENT}"/></w:pPr>${linesXml(block.lines)}</w:p>`;
  }
  if (block.kind === "item") {
    const tight = next?.kind === "item" ? `<w:spacing w:after="0"/>` : "";
    return (
      `<w:p><w:pPr><w:tabs><w:tab w:val="left" w:pos="${LIST_INDENT * 2}"/></w:tabs>` +
      `${tight}<w:ind w:left="${LIST_INDENT * 2}" w:hanging="${LIST_INDENT}"/></w:pPr>` +
      `${runXml({ text: block.marker, bold: false, italic: false })}<w:r><w:tab/></w:r>${linesXml([block.text])}</w:p>`
    );
  }
  return `<w:p>${linesXml(block.lines)}</w:p>`;
}

export function documentXml(markdown: string): string {
  const all = blocks(markdown);
  const body = all.map((block, i) => blockXml(block, all[i + 1])).join("");
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<w:document xmlns:w="${W}"><w:body>${body}` +
    `<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr>` +
    `</w:body></w:document>`
  );
}

const STYLES =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<w:styles xmlns:w="${W}"><w:docDefaults><w:rPrDefault><w:rPr>` +
  `<w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="Calibri" w:cs="Calibri"/>` +
  `<w:sz w:val="22"/><w:szCs w:val="22"/><w:lang w:val="en-CA"/></w:rPr></w:rPrDefault>` +
  `<w:pPrDefault><w:pPr><w:spacing w:after="160" w:line="240" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>` +
  `<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>` +
  `</w:styles>`;

const CONTENT_TYPES =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
  `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
  `<Default Extension="xml" ContentType="application/xml"/>` +
  `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>` +
  `<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>` +
  `</Types>`;

const ROOT_RELS =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
  `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>` +
  `</Relationships>`;

const DOCUMENT_RELS =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
  `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
  `</Relationships>`;

export function markdownToDocx(markdown: string): Buffer {
  return zipParts({
    "[Content_Types].xml": CONTENT_TYPES,
    "_rels/.rels": ROOT_RELS,
    "word/document.xml": documentXml(markdown),
    "word/_rels/document.xml.rels": DOCUMENT_RELS,
    "word/styles.xml": STYLES,
  });
}
