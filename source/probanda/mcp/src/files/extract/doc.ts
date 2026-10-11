// .doc (Word 97-2003 binary) text inside the server, with no Word and no host package. Two layers:
// the Compound File Binary container ([MS-CFB]: a FAT-chained sector file holding named streams),
// then the Word document ([MS-DOC]): the FIB in the WordDocument stream points at the piece table
// (CLX) in the 0Table or 1Table stream, and each piece names where its run of characters sits in
// WordDocument, as cp1252 bytes or UTF-16LE. The main document comes first, then its footnotes and
// endnotes. Field codes are dropped and their results kept. A Word 6/95 file or a password-protected
// one throws DocUnsupported / Error with a reason the caller reports as-is.

import { readFileSync } from "node:fs";

const CFB_SIGNATURE = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
const END_OF_CHAIN = 0xfffffffe;
const FREE_SECT = 0xffffffff;
const WORD_IDENT = 0xa5ec;
const NFIB_WORD97 = 0xc1;

/** A .doc this reader recognises but does not read; the caller reports it `unsupported_type`. */
export class DocUnsupported extends Error {}

interface DirEntry {
  name: string;
  type: number;
  start: number;
  size: number;
}

/** The named streams of a Compound File Binary file. */
export function cfbStreams(file: Buffer): Map<string, Buffer> {
  if (file.length < 512 || !file.subarray(0, 8).equals(CFB_SIGNATURE)) {
    throw new Error("not a Word 97-2003 file (no compound file signature)");
  }
  const sectorSize = 1 << file.readUInt16LE(0x1e);
  const miniSectorSize = 1 << file.readUInt16LE(0x20);
  const miniCutoff = file.readUInt32LE(0x38);
  const sectorCount = Math.ceil((file.length - sectorSize) / sectorSize);
  const sector = (n: number): Buffer => {
    if (n >= sectorCount) throw new Error(`compound file sector ${n} is past the end of the file`);
    return file.subarray((n + 1) * sectorSize, (n + 2) * sectorSize);
  };

  // The FAT's own sectors: the first 109 are listed in the header, the rest in the DIFAT chain.
  const fatSectors: number[] = [];
  for (let i = 0; i < 109; i++) fatSectors.push(file.readUInt32LE(0x4c + 4 * i));
  let difat = file.readUInt32LE(0x44);
  for (let guard = 0; difat !== END_OF_CHAIN && difat !== FREE_SECT; guard++) {
    if (guard > sectorCount) throw new Error("compound file DIFAT chain loops");
    const s = sector(difat);
    for (let i = 0; i < sectorSize / 4 - 1; i++) fatSectors.push(s.readUInt32LE(4 * i));
    difat = s.readUInt32LE(sectorSize - 4);
  }
  const fat: number[] = [];
  for (const n of fatSectors.slice(0, file.readUInt32LE(0x2c))) {
    if (n === FREE_SECT) continue;
    const s = sector(n);
    for (let i = 0; i < sectorSize / 4; i++) fat.push(s.readUInt32LE(4 * i));
  }

  const chain = (start: number, table: number[]): number[] => {
    const out: number[] = [];
    for (let n = start; n !== END_OF_CHAIN; n = table[n]) {
      if (n === undefined || n >= table.length || out.length > table.length) throw new Error("compound file chain is broken");
      out.push(n);
    }
    return out;
  };
  const readChain = (start: number): Buffer => Buffer.concat(chain(start, fat).map(sector));

  const dirBytes = readChain(file.readUInt32LE(0x30));
  const entries: DirEntry[] = [];
  for (let at = 0; at + 128 <= dirBytes.length; at += 128) {
    const nameLen = dirBytes.readUInt16LE(at + 0x40);
    entries.push({
      name: dirBytes.toString("utf16le", at, at + Math.max(0, nameLen - 2)),
      type: dirBytes.readUInt8(at + 0x42),
      start: dirBytes.readUInt32LE(at + 0x74),
      size: dirBytes.readUInt32LE(at + 0x78),
    });
  }
  const root = entries[0];
  if (!root || root.type !== 5) throw new Error("compound file has no root entry");

  const miniStream = root.start === END_OF_CHAIN ? Buffer.alloc(0) : readChain(root.start).subarray(0, root.size);
  const miniFatStart = file.readUInt32LE(0x3c);
  const miniFat: number[] = [];
  if (miniFatStart !== END_OF_CHAIN) {
    const bytes = readChain(miniFatStart);
    for (let i = 0; i + 4 <= bytes.length; i += 4) miniFat.push(bytes.readUInt32LE(i));
  }

  const streams = new Map<string, Buffer>();
  for (const e of entries) {
    if (e.type !== 2) continue;
    let data: Buffer;
    if (e.size === 0) data = Buffer.alloc(0);
    else if (e.size < miniCutoff) {
      data = Buffer.concat(chain(e.start, miniFat).map((n) => miniStream.subarray(n * miniSectorSize, (n + 1) * miniSectorSize)));
    } else data = readChain(e.start);
    streams.set(e.name, data.subarray(0, e.size));
  }
  return streams;
}

// cp1252's 0x80-0x9F block; every other byte is Latin-1. 0 marks the five unassigned bytes.
const CP1252_HIGH = [
  0x20ac, 0, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030, 0x0160, 0x2039, 0x0152, 0, 0x017d, 0,
  0, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x02dc, 0x2122, 0x0161, 0x203a, 0x0153, 0, 0x017e, 0x0178,
];

function cp1252(bytes: Buffer): string {
  let out = "";
  for (const b of bytes) out += String.fromCharCode(b >= 0x80 && b < 0xa0 ? CP1252_HIGH[b - 0x80] || 0xfffd : b);
  return out;
}

/** Word's in-text control characters made plain: paragraph and break marks to newlines, cell
 * marks to tabs, field codes dropped (their displayed results kept), object anchors removed. */
function plain(raw: string): string {
  let out = "";
  const fields: ("code" | "result")[] = [];
  for (const ch of raw) {
    const c = ch.charCodeAt(0);
    if (c === 0x13) {
      fields.push("code");
      continue;
    }
    if (c === 0x14) {
      if (fields.length) fields[fields.length - 1] = "result";
      continue;
    }
    if (c === 0x15) {
      fields.pop();
      continue;
    }
    if (fields.includes("code")) continue;
    if (c === 0x0d || c === 0x0b || c === 0x0c) out += "\n";
    else if (c === 0x07) out += "\t";
    else if (c === 0x1e) out += "-";
    else if (c === 0x09 || c >= 0x20) out += ch;
  }
  return out;
}

/** The text of the .doc at `path`: main document, then footnotes and endnotes. */
export function docText(path: string): string {
  const streams = cfbStreams(readFileSync(path));
  const wd = streams.get("WordDocument");
  if (!wd || wd.length < 154) throw new Error("not a Word document (no WordDocument stream)");
  if (wd.readUInt16LE(0) !== WORD_IDENT) throw new Error("not a Word document (bad FIB identifier)");
  const nFib = wd.readUInt16LE(2);
  if (nFib < NFIB_WORD97) throw new DocUnsupported(`.doc (Word 6/95 format, nFib ${nFib})`);
  const flags = wd.readUInt16LE(0x0a);
  if (flags & 0x0100) throw new Error("password-protected");
  const table = streams.get(flags & 0x0200 ? "1Table" : "0Table");
  if (!table) throw new Error("the document's table stream is missing");

  // FibRgLw97 follows FibBase (32 bytes) and the counted FibRgW97; FibRgFcLcb97 follows it.
  const csw = wd.readUInt16LE(32);
  const rgLw = 34 + 2 * csw + 2;
  const cslw = wd.readUInt16LE(rgLw - 2);
  const ccp = (i: number) => wd.readInt32LE(rgLw + 4 * i);
  const [ccpText, ccpFtn, ccpHdd, ccpAtn, ccpEdn] = [ccp(3), ccp(4), ccp(5), ccp(7), ccp(8)];
  const rgFcLcb = rgLw + 4 * cslw + 2;
  const fcClx = wd.readUInt32LE(rgFcLcb + 33 * 8);
  const lcbClx = wd.readUInt32LE(rgFcLcb + 33 * 8 + 4);
  if (fcClx + lcbClx > table.length || lcbClx === 0) throw new Error("the document's piece table is out of range");
  const clx = table.subarray(fcClx, fcClx + lcbClx);

  // Skip the Prc (formatting) entries to the Pcdt, whose PlcPcd is n+1 CPs then n 8-byte PCDs.
  let at = 0;
  while (at < clx.length && clx[at] === 0x01) at += 3 + clx.readInt16LE(at + 1);
  if (clx[at] !== 0x02) throw new Error("the document's piece table is malformed");
  const lcb = clx.readUInt32LE(at + 1);
  const plc = clx.subarray(at + 5, at + 5 + lcb);
  const n = (lcb - 4) / 12;
  if (!Number.isInteger(n) || n < 1) throw new Error("the document's piece table is malformed");

  const total = ccpText + ccpFtn + ccpHdd + ccpAtn + ccpEdn;
  let text = "";
  for (let i = 0; i < n && text.length < total; i++) {
    const cpStart = plc.readUInt32LE(4 * i);
    const chars = plc.readUInt32LE(4 * (i + 1)) - cpStart;
    const fc = plc.readUInt32LE(4 * (n + 1) + 8 * i + 2);
    if (fc & 0x40000000) {
      const off = (fc & 0x3fffffff) / 2;
      text += cp1252(wd.subarray(off, off + chars));
    } else {
      text += wd.toString("utf16le", fc, fc + 2 * chars);
    }
  }

  const main = plain(text.slice(0, ccpText));
  const notes = [text.slice(ccpText, ccpText + ccpFtn), text.slice(total - ccpEdn, total)]
    .map((story) => plain(story).trim())
    .filter((story) => story !== "");
  // The main story ends on its own paragraph mark, so one more newline makes the blank line.
  return notes.length ? `${main}\n${notes.join("\n\n")}\n` : main;
}
