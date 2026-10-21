// Synthetic PDF, .docx and .doc files for the text-extraction and page-image tests, built byte by byte with no
// extra dependency and no host Python. Placeholder text only.

import { crc32, deflateRawSync, deflateSync } from "node:zlib";

/** A minimal PDF, one entry of `pages` per page, each "\n"-separated line a Helvetica text line.
 * `compress` deflates each content stream (/FlateDecode), as real PDFs do. */
export function pdfBytes(pages, { compress = false } = {}) {
  const texts = Array.isArray(pages) ? pages : [pages];
  const esc = (t) => t.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
  const fontObj = 3 + 2 * texts.length;
  const objs = [
    Buffer.from("<< /Type /Catalog /Pages 2 0 R >>", "latin1"),
    Buffer.from(`<< /Type /Pages /Kids [${texts.map((_, i) => `${3 + 2 * i} 0 R`).join(" ")}] /Count ${texts.length} >>`, "latin1"),
  ];
  texts.forEach((text, i) => {
    const raw = Buffer.from(`BT /F1 12 Tf 72 720 Td ${text.split("\n").map((l) => `(${esc(l)}) Tj`).join(" 0 -16 Td ")} ET`, "latin1");
    const stream = compress ? deflateSync(raw) : raw;
    const filter = compress ? " /Filter /FlateDecode" : "";
    objs.push(Buffer.from(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${4 + 2 * i} 0 R /Resources << /Font << /F1 ${fontObj} 0 R >> >> >>`, "latin1"));
    objs.push(Buffer.concat([Buffer.from(`<< /Length ${stream.length}${filter} >>\nstream\n`, "latin1"), stream, Buffer.from("\nendstream", "latin1")]));
  });
  objs.push(Buffer.from("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>", "latin1"));
  return assemblePdf(objs);
}

/** A PDF of three pages, or four with `form`, for the page renderer: (1) a full-page image under
 * invisible (render mode 3) text, as an OCR'd scan; (2) the same image under visible text; (3)
 * text alone; (4) the image and invisible text wrapped in a form XObject. `mediaBox` sizes every
 * page. `encrypted` adds a Standard security handler whose user password is not empty. */
export function scannedPdfBytes({ mediaBox = [612, 792], form = false, encrypted = false } = {}) {
  const [w, h] = mediaBox;
  // Object numbers: 1 catalog, 2 pages, 3 font, 4 image, 5 form, then page/content pairs from 6.
  const image = `q ${w} 0 0 ${h} 0 0 cm /Im1 Do Q`;
  const text = (mode) => `BT ${mode} Tr /F1 12 Tf 72 ${h - 72} Td (Placeholder text layer) Tj ET`;
  const contents = [`${image} ${text(3)}`, `${image} ${text(0)}`, text(0)];
  if (form) contents.push("/Fm1 Do");
  const pixels = Buffer.alloc(8 * 8 * 3, 0x80);
  // The form draws the image at quarter area and its /Matrix doubles it, so the page is covered only
  // when the form's matrix is applied.
  const formBody = Buffer.from(`q ${w / 2} 0 0 ${h / 2} 0 0 cm /Im1 Do Q ${text(3)}`, "latin1");
  const resources = "<< /Font << /F1 3 0 R >> /XObject << /Im1 4 0 R /Fm1 5 0 R >> >>";
  const objs = [
    Buffer.from("<< /Type /Catalog /Pages 2 0 R >>", "latin1"),
    Buffer.from(`<< /Type /Pages /Kids [${contents.map((_, i) => `${6 + 2 * i} 0 R`).join(" ")}] /Count ${contents.length} >>`, "latin1"),
    Buffer.from("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>", "latin1"),
    stream("/Type /XObject /Subtype /Image /Width 8 /Height 8 /ColorSpace /DeviceRGB /BitsPerComponent 8", pixels),
    stream(`/Type /XObject /Subtype /Form /BBox [0 0 ${w} ${h}] /Matrix [2 0 0 2 0 0] /Resources ${resources}`, formBody),
  ];
  contents.forEach((content, i) => {
    objs.push(Buffer.from(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] /Contents ${7 + 2 * i} 0 R /Resources ${resources} >>`, "latin1"));
    objs.push(stream("", Buffer.from(content, "latin1")));
  });
  let trailer = "";
  if (encrypted) {
    const filler = "11".repeat(32);
    objs.push(Buffer.from(`<< /Filter /Standard /V 1 /R 2 /O <${filler}> /U <${filler}> /P -4 >>`, "latin1"));
    trailer = ` /Encrypt ${objs.length} 0 R /ID [<${"22".repeat(16)}> <${"22".repeat(16)}>]`;
  }
  return assemblePdf(objs, trailer);
}

function stream(dict, data) {
  return Buffer.concat([Buffer.from(`<< ${dict} /Length ${data.length} >>\nstream\n`, "latin1"), data, Buffer.from("\nendstream", "latin1")]);
}

/** `objs` (object 1 first, the catalog) as a whole PDF with its xref table. */
function assemblePdf(objs, trailerExtra = "") {
  const parts = [Buffer.from("%PDF-1.4\n", "latin1")];
  let length = parts[0].length;
  const offsets = [];
  objs.forEach((body, i) => {
    offsets.push(length);
    const chunk = Buffer.concat([Buffer.from(`${i + 1} 0 obj\n`, "latin1"), body, Buffer.from("\nendobj\n", "latin1")]);
    parts.push(chunk);
    length += chunk.length;
  });
  let tail = `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (const o of offsets) tail += `${String(o).padStart(10, "0")} 00000 n \n`;
  tail += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R${trailerExtra} >>\nstartxref\n${length}\n%%EOF\n`;
  parts.push(Buffer.from(tail, "latin1"));
  return Buffer.concat(parts);
}

/** A ZIP archive of `entries` ({name: Buffer|string}), each deflated. */
export function zipBytes(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const [name, content] of Object.entries(entries)) {
    const data = Buffer.from(content);
    const packed = deflateRawSync(data);
    const nameBuf = Buffer.from(name, "utf-8");
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(crc32(data), 14);
    local.writeUInt32LE(packed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(crc32(data), 16);
    central.writeUInt32LE(packed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, nameBuf, packed);
    centrals.push(central, nameBuf);
    offset += 30 + nameBuf.length + packed.length;
  }
  const cd = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(Object.keys(entries).length, 8);
  eocd.writeUInt16LE(Object.keys(entries).length, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, eocd]);
}

/** A .docx whose body is one paragraph per "\n"-separated line of `text`. */
export function docxBytes(text) {
  const esc = (t) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const body = text.split("\n").map((line) => `<w:p><w:r><w:t xml:space="preserve">${esc(line)}</w:t></w:r></w:p>`).join("");
  return zipBytes({
    "[Content_Types].xml": '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>',
    "word/document.xml": `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`,
  });
}

const END = 0xfffffffe;
const FREE = 0xffffffff;

/** A version-3 Compound File Binary file (512-byte sectors) holding `streams` ({name: Buffer}).
 * Streams under 4096 bytes go in the mini stream, as Word puts them. */
export function cfbBytes(streams) {
  const SS = 512;
  const names = Object.keys(streams);
  const small = names.filter((n) => streams[n].length < 4096);
  const big = names.filter((n) => streams[n].length >= 4096);

  const miniStart = {};
  const miniFat = [];
  const miniParts = [];
  for (const n of small) {
    const count = Math.max(1, Math.ceil(streams[n].length / 64));
    miniStart[n] = miniFat.length;
    for (let i = 0; i < count; i++) miniFat.push(i === count - 1 ? END : miniFat.length + 1);
    const padded = Buffer.alloc(count * 64);
    streams[n].copy(padded);
    miniParts.push(padded);
  }
  const miniStream = Buffer.concat(miniParts);

  const sectorsOf = (bytes) => Math.ceil(bytes / SS);
  const dirSectors = sectorsOf((1 + names.length) * 128);
  const miniFatSectors = sectorsOf(miniFat.length * 4);
  const miniStreamSectors = sectorsOf(miniStream.length);
  const bigSectors = big.map((n) => sectorsOf(streams[n].length));
  const dataSectors = dirSectors + miniFatSectors + miniStreamSectors + bigSectors.reduce((a, b) => a + b, 0);
  let fatSectors = 1;
  while (fatSectors * (SS / 4) < dataSectors + fatSectors) fatSectors++;

  const fat = new Array(fatSectors * (SS / 4)).fill(FREE);
  let next = 0;
  const run = (count) => {
    const start = next;
    for (let i = 0; i < count; i++) fat[start + i] = i === count - 1 ? END : start + i + 1;
    next += count;
    return count ? start : END;
  };
  for (let i = 0; i < fatSectors; i++) fat[next++] = 0xfffffffd;
  const dirStart = run(dirSectors);
  const miniFatStart = run(miniFatSectors);
  const miniStreamStart = run(miniStreamSectors);
  const bigStart = Object.fromEntries(big.map((n, i) => [n, run(bigSectors[i])]));

  const header = Buffer.alloc(SS);
  Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]).copy(header, 0);
  header.writeUInt16LE(0x3e, 0x18);
  header.writeUInt16LE(3, 0x1a);
  header.writeUInt16LE(0xfffe, 0x1c);
  header.writeUInt16LE(9, 0x1e);
  header.writeUInt16LE(6, 0x20);
  header.writeUInt32LE(fatSectors, 0x2c);
  header.writeUInt32LE(dirStart, 0x30);
  header.writeUInt32LE(4096, 0x38);
  header.writeUInt32LE(miniFatStart, 0x3c);
  header.writeUInt32LE(miniFatSectors, 0x40);
  header.writeUInt32LE(END, 0x44);
  for (let i = 0; i < 109; i++) header.writeUInt32LE(i < fatSectors ? i : FREE, 0x4c + 4 * i);

  const dir = Buffer.alloc(dirSectors * SS);
  const entry = (i, name, type, start, size, right) => {
    const at = i * 128;
    dir.write(name, at, "utf16le");
    dir.writeUInt16LE((name.length + 1) * 2, at + 0x40);
    dir.writeUInt8(type, at + 0x42);
    dir.writeUInt8(1, at + 0x43);
    dir.writeUInt32LE(FREE, at + 0x44);
    dir.writeUInt32LE(right, at + 0x48);
    dir.writeUInt32LE(type === 5 && names.length ? 1 : FREE, at + 0x4c);
    dir.writeUInt32LE(start, at + 0x74);
    dir.writeUInt32LE(size, at + 0x78);
  };
  entry(0, "Root Entry", 5, miniStream.length ? miniStreamStart : END, miniStream.length, FREE);
  names.forEach((n, i) => {
    const start = n in miniStart ? miniStart[n] : bigStart[n];
    entry(i + 1, n, 2, start, streams[n].length, i + 1 < names.length ? i + 2 : FREE);
  });
  for (let i = names.length + 1; i < dirSectors * 4; i++) {
    dir.writeUInt32LE(FREE, i * 128 + 0x44);
    dir.writeUInt32LE(FREE, i * 128 + 0x48);
    dir.writeUInt32LE(FREE, i * 128 + 0x4c);
  }

  const fatBuf = Buffer.alloc(fatSectors * SS);
  fat.forEach((v, i) => fatBuf.writeUInt32LE(v, 4 * i));
  const miniFatBuf = Buffer.alloc(miniFatSectors * SS, 0xff);
  miniFat.forEach((v, i) => miniFatBuf.writeUInt32LE(v, 4 * i));
  const pad = (buf, count) => {
    const out = Buffer.alloc(count * SS);
    buf.copy(out);
    return out;
  };
  return Buffer.concat([
    header,
    fatBuf,
    dir,
    miniFatBuf,
    pad(miniStream, miniStreamSectors),
    ...big.map((n, i) => pad(streams[n], bigSectors[i])),
  ]);
}

/** A Word 97-2003 .doc whose text is `pieces`: each {text, unicode} a piece of the piece table,
 * stored as cp1252 bytes (unicode false) or UTF-16LE. `nFib` defaults to Word 97's; `ccpFtn`
 * marks that many trailing characters as the footnote story. */
export function docBytes(pieces, { nFib = 0xc1, encrypted = false, ccpFtn = 0 } = {}) {
  const wd = Buffer.alloc(8192);
  wd.writeUInt16LE(0xa5ec, 0);
  wd.writeUInt16LE(nFib, 2);
  wd.writeUInt16LE(0x0200 | (encrypted ? 0x0100 : 0) | 0x0004, 0x0a);
  wd.writeUInt16LE(14, 32);
  wd.writeUInt16LE(22, 62);
  const total = pieces.reduce((n, p) => n + p.text.length, 0);
  wd.writeInt32LE(total - ccpFtn, 64 + 12);
  wd.writeInt32LE(ccpFtn, 64 + 16);
  wd.writeUInt16LE(93, 152);

  // Text starts at 1024; each piece follows the last.
  let at = 1024;
  const cps = [0];
  const fcs = [];
  for (const p of pieces) {
    if (p.unicode) {
      fcs.push(at);
      at += wd.write(p.text, at, "utf16le");
    } else {
      fcs.push(((at * 2) | 0x40000000) >>> 0);
      at += wd.write(p.text, at, "latin1");
    }
    cps.push(cps[cps.length - 1] + p.text.length);
  }

  // CLX: one Prc entry (to be skipped), then the Pcdt.
  const plc = Buffer.alloc(4 * cps.length + 8 * pieces.length);
  cps.forEach((cp, i) => plc.writeUInt32LE(cp, 4 * i));
  fcs.forEach((fc, i) => plc.writeUInt32LE(fc, 4 * cps.length + 8 * i + 2));
  const prc = Buffer.from([0x01, 0x02, 0x00, 0xaa, 0xbb]);
  const pcdtHead = Buffer.alloc(5);
  pcdtHead.writeUInt8(0x02, 0);
  pcdtHead.writeUInt32LE(plc.length, 1);
  const clx = Buffer.concat([prc, pcdtHead, plc]);
  const table = Buffer.alloc(600);
  const fcClx = 64;
  clx.copy(table, fcClx);
  wd.writeUInt32LE(fcClx, 154 + 33 * 8);
  wd.writeUInt32LE(clx.length, 154 + 33 * 8 + 4);
  return cfbBytes({ WordDocument: wd, "1Table": table });
}
